"""Immutable full ACLED snapshots with count and two-read consistency gates."""

import hashlib
import json
import sqlite3
from urllib.parse import parse_qs, urlsplit

from .acled import BASE, CONTRACT, LIMITATION, MAX_ROWS, PAGE_SIZE, canonical
from .storage import Conflict, NotFound, _audit, _health
from .validation import utc_now


class AcledStore:
    def __init__(self, store):
        self.store = store

    def summaries(self, conn):
        keys = ("contractVersion", "startDate", "endDate", "errors", "rowCount", "transportComplete", "consistencyVerified")
        return [{"id": r["id"], "createdAt": r["created_at"], "status": r["status"], "active": bool(r["active"]),
                 "progress": json.loads(r["progress"]), "report": {k: v for k, v in json.loads(r["report"]).items() if k in keys}}
                for r in conn.execute("SELECT * FROM acled_runs ORDER BY created_at,id")]

    def _get(self, conn, identifier):
        row = conn.execute("SELECT * FROM acled_runs WHERE id=?", (identifier,)).fetchone()
        if row is None:
            raise NotFound("ACLED snapshot not found")
        sources = [dict(r) for r in conn.execute(
            "SELECT s.ordinal,s.path,s.http_status AS httpStatus,s.sha256,s.retrieved_at AS retrievedAt,o.size AS bytes "
            "FROM acled_sources s JOIN originals o ON o.sha256=s.sha256 WHERE s.run_id=? ORDER BY ordinal", (identifier,))]
        chunks = [dict(r) for r in conn.execute("SELECT page,row_count AS rowCount FROM acled_chunks WHERE run_id=? ORDER BY page", (identifier,))]
        return {"id": identifier, "createdAt": row["created_at"], "status": row["status"], "active": bool(row["active"]),
                "report": json.loads(row["report"]), "progress": json.loads(row["progress"]), "sources": sources, "chunks": chunks}

    def get(self, identifier):
        with self.store.connection() as conn:
            conn.execute("BEGIN")
            return self._get(conn, identifier)

    def initialize(self, identifier, start, end):
        report = {"contractVersion": CONTRACT, "startDate": start, "endDate": end, "errors": [], "rowCount": 0,
                  "transportComplete": False, "consistencyVerified": False, "library": "acled==1.0.2",
                  "limitation": LIMITATION, "startedAt": utc_now()}
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT report FROM acled_runs WHERE id=? AND status='running'", (identifier,)).fetchone()
            if not row or json.loads(row[0]):
                raise Conflict("ACLED run is not an uninitialized running acquisition")
            conn.execute("UPDATE acled_runs SET report=? WHERE id=?", (json.dumps(report), identifier))

    def source(self, identifier, path, status, content):
        sha = hashlib.sha256(content).hexdigest()
        with self.store.connection() as conn, self.store.transaction(conn):
            if not conn.execute("SELECT 1 FROM acled_runs WHERE id=? AND status='running'", (identifier,)).fetchone():
                raise Conflict("ACLED acquisition is not running")
            conn.execute("INSERT OR IGNORE INTO originals VALUES (?,?,?)", (sha, content, len(content)))
            ordinal = conn.execute("SELECT COALESCE(max(ordinal),0)+1 FROM acled_sources WHERE run_id=?", (identifier,)).fetchone()[0]
            conn.execute("INSERT INTO acled_sources VALUES (?,?,?,?,?,?)", (identifier, ordinal, path, status, sha, utc_now()))

    def progress(self, identifier, details):
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT progress FROM acled_runs WHERE id=? AND status='running'", (identifier,)).fetchone()
            if not row:
                raise Conflict("ACLED acquisition is not running")
            conn.execute("UPDATE acled_runs SET progress=? WHERE id=?",
                         (json.dumps(json.loads(row[0]) | details | {"updatedAt": utc_now()}), identifier))

    def chunk(self, identifier, page, rows):
        with self.store.connection() as conn, self.store.transaction(conn):
            run = conn.execute("SELECT report FROM acled_runs WHERE id=? AND status='running'", (identifier,)).fetchone()
            if not run:
                raise Conflict("ACLED acquisition is not running")
            report = json.loads(run[0])
            expected = conn.execute("SELECT count(*)+1 FROM acled_chunks WHERE run_id=?", (identifier,)).fetchone()[0]
            source = conn.execute("SELECT path,sha256,http_status FROM acled_sources WHERE run_id=? ORDER BY ordinal DESC LIMIT 1", (identifier,)).fetchone()
            if (page != expected or len(rows) > PAGE_SIZE or report["rowCount"] + len(rows) > MAX_ROWS or not source or
                source["http_status"] != 200 or any(r["sourceHash"] != source["sha256"] or
                not report["startDate"] <= r["eventDate"] <= report["endDate"] for r in rows)):
                raise Conflict("ACLED page boundary, scope or original provenance mismatch")
            try:
                conn.executemany("INSERT INTO acled_rows VALUES (?,?,?,?,?,?)",
                                 ((identifier, r["eventId"], page, r["country"], r["eventType"], json.dumps(r, allow_nan=False)) for r in rows))
                conn.execute("INSERT INTO acled_chunks VALUES (?,?,?,?)", (identifier, page, len(rows), source["sha256"]))
            except sqlite3.IntegrityError:
                raise Conflict("ACLED duplicate event ID/page; no silent deduplication or overwrite") from None
            report["rowCount"] += len(rows)
            conn.execute("UPDATE acled_runs SET report=? WHERE id=?", (json.dumps(report), identifier))

    def _validate(self, conn, identifier, report):
        count = conn.execute("SELECT count(*) FROM acled_rows WHERE run_id=?", (identifier,)).fetchone()[0]
        chunks = conn.execute("SELECT page,row_count FROM acled_chunks WHERE run_id=? ORDER BY page", (identifier,)).fetchall()
        if (report.get("contractVersion") != CONTRACT or report.get("errors") or not count or count != report.get("rowCount") or
            count != report.get("expectedRows") or not report.get("consistencyVerified") or not chunks or
            [r[0] for r in chunks] != list(range(1, len(chunks) + 1)) or sum(r[1] for r in chunks) != count or
            any(r[1] != PAGE_SIZE for r in chunks[:-1]) or not 1 <= chunks[-1][1] <= PAGE_SIZE or
            conn.execute("SELECT count(*) FROM acled_sources WHERE run_id=? AND http_status=200", (identifier,)).fetchone()[0] != 2 * len(chunks)):
            raise Conflict("Only nonempty ACLED snapshots with matching totals and two consistent complete reads can stage/activate")
        if conn.execute("SELECT 1 FROM acled_chunks c WHERE c.run_id=? AND c.row_count<>(SELECT count(*) FROM acled_rows r WHERE r.run_id=c.run_id AND r.page=c.page)", (identifier,)).fetchone():
            raise Conflict("ACLED per-page count mismatch")
        sources = conn.execute("SELECT s.*,o.content FROM acled_sources s JOIN originals o ON s.sha256=o.sha256 WHERE s.run_id=? ORDER BY ordinal", (identifier,)).fetchall()
        if len(sources) != 2 * len(chunks):
            raise Conflict("ACLED original request manifest incomplete")
        fingerprints = [{}, {}]
        for index, source in enumerate(sources):
            page, phase = index % len(chunks) + 1, index // len(chunks)
            url = urlsplit(source["path"])
            expected = {"event_date": [report["startDate"] + "|" + report["endDate"]], "event_date_where": ["BETWEEN"],
                        "limit": [str(PAGE_SIZE)], "page": [str(page)], "_format": ["json"], "export_type": ["dyadic"], "with_total": ["true"]}
            if (source["ordinal"] != index + 1 or source["http_status"] != 200 or url.fragment or
                url.scheme + "://" + url.netloc + url.path != BASE or parse_qs(url.query) != expected or
                hashlib.sha256(source["content"]).hexdigest() != source["sha256"]):
                raise Conflict("ACLED original page scope/status/hash mismatch")
            body = json.loads(source["content"])
            rows = body.get("data")
            if (body.get("success") is not True or not isinstance(rows, list) or
                str(body.get("count")) != str(len(rows)) or str(body.get("total_count")) != str(count) or
                len(rows) != chunks[page - 1]["row_count"]):
                raise Conflict("ACLED original page total/schema mismatch")
            for raw in rows:
                key = raw["event_id_cnty"]
                if key in fingerprints[phase]:
                    raise Conflict("ACLED duplicate event in original pagination")
                fingerprints[phase][key] = canonical(raw)
            if phase == 0:
                stored = {r[0]: json.loads(r[1]) for r in conn.execute("SELECT event_id,payload FROM acled_rows WHERE run_id=? AND page=?", (identifier, page))}
                if any(stored.get(r["event_id_cnty"], {}).get("attributes") != r or
                       stored[r["event_id_cnty"]]["sourceHash"] != source["sha256"] for r in rows):
                    raise Conflict("ACLED stored native records do not match original page")
        if fingerprints[0] != fingerprints[1] or len(fingerprints[0]) != count:
            raise Conflict("ACLED original verification read changed; snapshot cannot activate")

    def finish(self, identifier, total):
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT report FROM acled_runs WHERE id=? AND status='running'", (identifier,)).fetchone()
            if not row:
                raise Conflict("ACLED acquisition is not running")
            report = json.loads(row[0]) | {"expectedRows": total, "consistencyVerified": True}
            self._validate(conn, identifier, report)
            report |= {"transportComplete": True, "completedAt": utc_now(),
                       "countries": [{"name": r[0], "count": r[1]} for r in conn.execute("SELECT country,count(*) FROM acled_rows WHERE run_id=? GROUP BY country ORDER BY country", (identifier,))],
                       "eventTypes": [r[0] for r in conn.execute("SELECT DISTINCT event_type FROM acled_rows WHERE run_id=? ORDER BY event_type", (identifier,))]}
            conn.execute("UPDATE acled_runs SET status='staged',report=? WHERE id=?", (json.dumps(report), identifier))
            conn.execute("UPDATE provider_pulls SET status='staged',finished_at=?,report=? WHERE id=?", (utc_now(), '{"errors":[]}', identifier))
            _audit(conn, "acled_staged", acledRunId=identifier, rows=total)
            _health(conn, "provider:acled", "ok", acledRunId=identifier)

    def fail(self, identifier, reason):
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT report FROM acled_runs WHERE id=? AND status='running'", (identifier,)).fetchone()
            if not row:
                raise Conflict("ACLED acquisition is not running")
            report = json.loads(row[0]) | {"errors": [reason], "transportComplete": False, "consistencyVerified": False}
            conn.execute("UPDATE acled_runs SET status='interrupted',report=? WHERE id=?", (json.dumps(report), identifier))
            conn.execute("UPDATE provider_pulls SET status='interrupted',finished_at=?,report=? WHERE id=?",
                         (utc_now(), json.dumps({"errors": [reason]}), identifier))
            _audit(conn, "acled_interrupted", acledRunId=identifier)
            _health(conn, "provider:acled", "error", acledRunId=identifier)

    def activate(self, identifier):
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT * FROM acled_runs WHERE id=?", (identifier,)).fetchone()
            if not row:
                raise NotFound("ACLED snapshot not found")
            report = json.loads(row["report"])
            if row["status"] not in ("staged", "committed") or report.get("transportComplete") is not True:
                raise Conflict("Incomplete ACLED snapshots cannot activate")
            self._validate(conn, identifier, report)
            if row["active"]:
                return
            previous = conn.execute("SELECT id FROM acled_runs WHERE active=1").fetchone()
            conn.execute("UPDATE acled_runs SET active=0 WHERE active=1")
            conn.execute("UPDATE acled_runs SET status='committed',active=1,previous_id=? WHERE id=?", (previous[0] if previous else None, identifier))
            _audit(conn, "acled_activated", acledRunId=identifier)

    def rollback(self, identifier):
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT * FROM acled_runs WHERE id=?", (identifier,)).fetchone()
            if not row:
                raise NotFound("ACLED snapshot not found")
            if row["status"] != "committed":
                raise Conflict("Only committed ACLED snapshots can roll back")
            conn.execute("UPDATE acled_runs SET status='rolled_back',active=0 WHERE id=?", (identifier,))
            previous, seen = row["previous_id"], {identifier}
            while row["active"] and previous and previous not in seen:
                seen.add(previous)
                prior = conn.execute("SELECT * FROM acled_runs WHERE id=?", (previous,)).fetchone()
                if not prior:
                    raise Conflict("ACLED rollback predecessor missing")
                if prior["status"] == "committed":
                    conn.execute("UPDATE acled_runs SET active=1 WHERE id=?", (previous,))
                    break
                previous = prior["previous_id"]
            _audit(conn, "acled_rolled_back", acledRunId=identifier)

    def page(self, identifier, *, country="", event_type="", offset=0, limit=100):
        where, args = "run_id=?", [identifier]
        for field, value in (("country", country), ("event_type", event_type)):
            if value:
                where += f" AND {field}=?"
                args.append(value)
        with self.store.connection() as conn:
            conn.execute("BEGIN")
            if not conn.execute("SELECT 1 FROM acled_runs WHERE id=?", (identifier,)).fetchone():
                raise NotFound("ACLED snapshot not found")
            count = conn.execute(f"SELECT count(*) FROM acled_rows WHERE {where}", args).fetchone()[0]
            rows = conn.execute(f"SELECT payload FROM acled_rows WHERE {where} ORDER BY event_id LIMIT ? OFFSET ?", [*args, limit, offset])
            return {"rows": [json.loads(r[0]) for r in rows], "total": count, "offset": offset, "limit": limit,
                    "country": country, "eventType": event_type, "runId": identifier}

    def original(self, identifier, ordinal):
        with self.store.connection() as conn:
            row = conn.execute("SELECT o.content FROM acled_sources s JOIN originals o ON s.sha256=o.sha256 WHERE s.run_id=? AND s.ordinal=?", (identifier, ordinal)).fetchone()
            if not row:
                raise NotFound("ACLED original not found")
            return row[0]

    def export(self, identifier):
        with self.store.connection() as conn:
            conn.execute("BEGIN")
            yield json.dumps({"type": "manifest", **self._get(conn, identifier)}) + "\n"
            for row in conn.execute("SELECT payload FROM acled_rows WHERE run_id=? ORDER BY event_id", (identifier,)):
                yield '{"type":"event","data":' + row[0] + "}\n"
