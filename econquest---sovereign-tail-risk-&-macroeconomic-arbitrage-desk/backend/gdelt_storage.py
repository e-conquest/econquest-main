"""Immutable GDELT daily event snapshots; partial days cannot activate."""

import hashlib
import json
import sqlite3

from .gdelt import CONTRACT, LIMITATION, MAX_ROWS, intervals
from .storage import Conflict, NotFound, _audit, _health
from .validation import utc_now

SUMMARY_KEYS = ("contractVersion", "day", "errors", "transportComplete", "rowCount", "completedIntervals", "expectedIntervals")


class GdeltStore:
    def __init__(self, store):
        self.store = store

    def summaries(self, conn):
        result = []
        for row in conn.execute("SELECT * FROM gdelt_runs ORDER BY created_at,id"):
            report = json.loads(row["report"])
            result.append({"id": row["id"], "createdAt": row["created_at"], "status": row["status"], "active": bool(row["active"]),
                           "report": {k: report[k] for k in SUMMARY_KEYS if k in report}, "progress": json.loads(row["progress"])})
        return result

    def _get(self, conn, run_id):
        row = conn.execute("SELECT * FROM gdelt_runs WHERE id=?", (run_id,)).fetchone()
        if not row:
            raise NotFound("GDELT snapshot not found")
        sources = [dict(r) for r in conn.execute(
            "SELECT s.ordinal,s.path,s.http_status AS httpStatus,s.sha256,s.retrieved_at AS retrievedAt,o.size AS bytes "
            "FROM gdelt_sources s JOIN originals o ON s.sha256=o.sha256 WHERE run_id=? ORDER BY ordinal", (run_id,))]
        chunks = [dict(r) for r in conn.execute(
            "SELECT interval,row_count AS rowCount FROM gdelt_chunks WHERE run_id=? ORDER BY interval", (run_id,))]
        return {"id": run_id, "createdAt": row["created_at"], "status": row["status"], "active": bool(row["active"]),
                "report": json.loads(row["report"]), "progress": json.loads(row["progress"]), "sources": sources, "chunks": chunks}

    def get(self, run_id):
        with self.store.connection() as conn:
            conn.execute("BEGIN")
            return self._get(conn, run_id)

    def source(self, run_id, path, status, content):
        sha = hashlib.sha256(content).hexdigest()
        with self.store.connection() as conn, self.store.transaction(conn):
            conn.execute("INSERT OR IGNORE INTO originals VALUES (?,?,?)", (sha, content, len(content)))
            ordinal = conn.execute("SELECT COALESCE(max(ordinal),0)+1 FROM gdelt_sources WHERE run_id=?", (run_id,)).fetchone()[0]
            conn.execute("INSERT INTO gdelt_sources VALUES (?,?,?,?,?,?)", (run_id, ordinal, path, status, sha, utc_now()))

    def progress(self, run_id, details):
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT progress FROM gdelt_runs WHERE id=? AND status='running'", (run_id,)).fetchone()
            if not row:
                raise Conflict("GDELT acquisition is not running")
            conn.execute("UPDATE gdelt_runs SET progress=? WHERE id=?", (json.dumps(json.loads(row[0]) | details | {"updatedAt": utc_now()}), run_id))

    def initialize(self, run_id, day):
        report = {"contractVersion": CONTRACT, "day": day, "errors": [], "transportComplete": False,
                  "expectedIntervals": intervals(day), "completedIntervals": 0, "rowCount": 0,
                  "library": "gdelt==0.1.14 (gdeltPyR)", "libraryLicense": "GPL-3.0; private local research; review redistribution obligations",
                  "limitation": LIMITATION, "startedAt": utc_now()}
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT report FROM gdelt_runs WHERE id=? AND status='running'", (run_id,)).fetchone()
            if not row or json.loads(row[0]):
                raise Conflict("GDELT run is not an uninitialized running acquisition")
            conn.execute("UPDATE gdelt_runs SET report=? WHERE id=?", (json.dumps(report), run_id))

    def chunk(self, run_id, interval, rows):
        with self.store.connection() as conn, self.store.transaction(conn):
            run = conn.execute("SELECT report FROM gdelt_runs WHERE id=? AND status='running'", (run_id,)).fetchone()
            if not run:
                raise Conflict("GDELT acquisition is not running")
            report = json.loads(run[0])
            if interval not in report["expectedIntervals"] or report["rowCount"] + len(rows) > MAX_ROWS:
                raise Conflict("GDELT interval scope or daily event budget exceeded")
            source = conn.execute("SELECT sha256 FROM gdelt_sources WHERE run_id=? AND path=? AND http_status=200 ORDER BY ordinal DESC LIMIT 1",
                                  (run_id, f"https://data.gdeltproject.org/gdeltv2/{interval}.export.CSV.zip")).fetchone()
            if not source or any(r["interval"] != interval or r["sourceHash"] != source[0] for r in rows):
                raise Conflict("GDELT event provenance does not match captured interval")
            try:
                conn.executemany("INSERT INTO gdelt_rows VALUES (?,?,?,?,?,?)",
                                 ((run_id, r["eventId"], interval, r["country"], r["eventRootCode"], json.dumps(r, allow_nan=False)) for r in rows))
                conn.execute("INSERT INTO gdelt_chunks VALUES (?,?,?,?)", (run_id, interval, len(rows), source[0]))
            except sqlite3.IntegrityError:
                raise Conflict("GDELT duplicate source event ID/interval; no silent deduplication or overwrite") from None
            report["rowCount"] += len(rows)
            report["completedIntervals"] += 1
            conn.execute("UPDATE gdelt_runs SET report=? WHERE id=?", (json.dumps(report), run_id))

    def _validated(self, conn, run_id, report):
        expected = intervals(report["day"]) if report.get("day") else []
        chunks = conn.execute("SELECT interval,row_count FROM gdelt_chunks WHERE run_id=? ORDER BY interval", (run_id,)).fetchall()
        count = conn.execute("SELECT count(*) FROM gdelt_rows WHERE run_id=?", (run_id,)).fetchone()[0]
        sources = conn.execute("SELECT path,http_status FROM gdelt_sources WHERE run_id=? ORDER BY ordinal", (run_id,)).fetchall()
        if (report.get("contractVersion") != CONTRACT or report.get("errors") or len(expected) != 96 or
            report.get("expectedIntervals") != expected or [r[0] for r in chunks] != expected or
            report.get("completedIntervals") != 96 or not count or count != report.get("rowCount") or
            sum(r[1] for r in chunks) != count or len(sources) != 96 or
            sorted(r[0] for r in sources) != [f"https://data.gdeltproject.org/gdeltv2/{i}.export.CSV.zip" for i in expected] or
            any(r[1] != 200 for r in sources)):
            raise Conflict("Only a nonempty GDELT day with all 96 verified export intervals can stage or activate")
        if conn.execute("SELECT 1 FROM gdelt_chunks c WHERE c.run_id=? AND c.row_count<>(SELECT count(*) FROM gdelt_rows r WHERE r.run_id=c.run_id AND r.interval=c.interval)", (run_id,)).fetchone():
            raise Conflict("GDELT stored per-interval row counts do not match")

    def finish(self, run_id):
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT report FROM gdelt_runs WHERE id=? AND status='running'", (run_id,)).fetchone()
            if not row:
                raise Conflict("GDELT acquisition is not running")
            report = json.loads(row[0])
            self._validated(conn, run_id, report)
            report |= {"transportComplete": True, "completedAt": utc_now(),
                       "countries": [{"code": r[0], "count": r[1]} for r in conn.execute(
                           "SELECT country,count(*) FROM gdelt_rows WHERE run_id=? GROUP BY country ORDER BY country", (run_id,))]}
            conn.execute("UPDATE gdelt_runs SET status='staged',report=? WHERE id=?", (json.dumps(report), run_id))
            conn.execute("UPDATE provider_pulls SET status='staged',finished_at=?,report=? WHERE id=?", (utc_now(), '{"errors":[]}', run_id))
            _audit(conn, "gdelt_staged", gdeltRunId=run_id, rows=report["rowCount"])
            _health(conn, "provider:gdelt", "ok", gdeltRunId=run_id)

    def fail(self, run_id, reason):
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT report FROM gdelt_runs WHERE id=? AND status='running'", (run_id,)).fetchone()
            if not row:
                raise Conflict("GDELT acquisition is not running")
            report = json.loads(row[0]) | {"errors": [reason], "transportComplete": False}
            conn.execute("UPDATE gdelt_runs SET status='interrupted',report=? WHERE id=?", (json.dumps(report), run_id))
            conn.execute("UPDATE provider_pulls SET status='interrupted',finished_at=?,report=? WHERE id=?", (utc_now(), json.dumps({"errors": [reason]}), run_id))
            _audit(conn, "gdelt_interrupted", gdeltRunId=run_id, reason=reason)
            _health(conn, "provider:gdelt", "error", gdeltRunId=run_id)

    def activate(self, run_id):
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT * FROM gdelt_runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                raise NotFound("GDELT snapshot not found")
            report = json.loads(row["report"])
            if row["status"] not in ("staged", "committed") or report.get("transportComplete") is not True:
                raise Conflict("Incomplete GDELT snapshots cannot activate")
            self._validated(conn, run_id, report)
            if row["active"]:
                return
            previous = conn.execute("SELECT id FROM gdelt_runs WHERE active=1").fetchone()
            conn.execute("UPDATE gdelt_runs SET active=0 WHERE active=1")
            conn.execute("UPDATE gdelt_runs SET status='committed',active=1,previous_id=? WHERE id=?", (previous[0] if previous else None, run_id))
            _audit(conn, "gdelt_activated", gdeltRunId=run_id)

    def rollback(self, run_id):
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT * FROM gdelt_runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                raise NotFound("GDELT snapshot not found")
            if row["status"] != "committed":
                raise Conflict("Only a committed GDELT snapshot can roll back")
            conn.execute("UPDATE gdelt_runs SET status='rolled_back',active=0 WHERE id=?", (run_id,))
            previous, visited = row["previous_id"], {run_id}
            while row["active"] and previous and previous not in visited:
                visited.add(previous)
                candidate = conn.execute("SELECT * FROM gdelt_runs WHERE id=?", (previous,)).fetchone()
                if candidate is None:
                    raise Conflict("GDELT rollback predecessor missing")
                if candidate["status"] == "committed":
                    conn.execute("UPDATE gdelt_runs SET active=1 WHERE id=?", (previous,))
                    break
                previous = candidate["previous_id"]
            _audit(conn, "gdelt_rolled_back", gdeltRunId=run_id)

    def page(self, run_id, *, country="", root="", offset=0, limit=100):
        where, args = "run_id=?", [run_id]
        if country:
            where += " AND country IS NULL" if country == "UNKNOWN" else " AND country=?"
            if country != "UNKNOWN":
                args.append(country)
        if root:
            where += " AND event_root=?"
            args.append(root)
        with self.store.connection() as conn:
            conn.execute("BEGIN")
            if not conn.execute("SELECT 1 FROM gdelt_runs WHERE id=?", (run_id,)).fetchone():
                raise NotFound("GDELT snapshot not found")
            count = conn.execute(f"SELECT count(*) FROM gdelt_rows WHERE {where}", args).fetchone()[0]
            rows = conn.execute(f"SELECT payload FROM gdelt_rows WHERE {where} ORDER BY interval,event_id LIMIT ? OFFSET ?", [*args, limit, offset])
            return {"rows": [json.loads(r[0]) for r in rows], "total": count, "offset": offset, "limit": limit,
                    "country": country, "root": root, "runId": run_id}

    def original(self, run_id, ordinal):
        with self.store.connection() as conn:
            row = conn.execute("SELECT s.path,o.content FROM gdelt_sources s JOIN originals o ON s.sha256=o.sha256 WHERE run_id=? AND ordinal=?", (run_id, ordinal)).fetchone()
            if not row:
                raise NotFound("GDELT original not found")
            return row["content"]

    def export(self, run_id):
        with self.store.connection() as conn:
            conn.execute("BEGIN")
            yield json.dumps({"type": "manifest", **self._get(conn, run_id)}) + "\n"
            for row in conn.execute("SELECT payload FROM gdelt_rows WHERE run_id=? ORDER BY interval,event_id", (run_id,)):
                yield '{"type":"event","data":' + row[0] + "}\n"
