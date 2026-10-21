"""FRED native-dated rows; distinct current and historical active selections."""

import json

from .storage import Conflict, NotFound, _audit, _health
from .validation import utc_now
from .weo_storage import WeoStore


class FredStore(WeoStore):
    def __init__(self, store):
        super().__init__(store, "fred")

    def fail(self, run_id, error):
        with self.store.connection() as conn, self.store.transaction(conn):
            conn.execute("UPDATE fred_runs SET status='interrupted',report=json_set(report,'$.errors',json(?),'$.transportComplete',json('false')) WHERE id=? AND status='running'",
                         (json.dumps([error]), run_id))
            conn.execute("UPDATE provider_pulls SET status='interrupted',finished_at=?,report=? WHERE id=? AND status='running' AND provider_id='fred'",
                         (utc_now(), json.dumps({"errors": [error]}), run_id))
            _audit(conn, "fred_interrupted", fredRunId=run_id, error=error)
            _health(conn, "provider:fred", "error", fredRunId=run_id)

    def complete(self, run_id, result):
        report = result["report"]
        if not result["records"] or not result["series"]:
            raise Conflict("Empty FRED/ALFRED snapshot cannot be staged")
        status = "quarantined" if report["errors"] else "staged"
        with self.store.connection() as conn, self.store.transaction(conn):
            run = conn.execute("SELECT * FROM fred_runs WHERE id=?", (run_id,)).fetchone()
            if not run or run["status"] != "running":
                raise Conflict("FRED acquisition is not running")
            if report.get("mode") != run["mode"] or report.get("asOf") != run["as_of"]:
                raise Conflict("FRED requested snapshot identity changed")
            conn.executemany("INSERT INTO fred_series VALUES (?,?,?)",
                             ((run_id, s["id"], json.dumps(s, allow_nan=False)) for s in result["series"]))
            conn.executemany("INSERT INTO fred_rows VALUES (?,?,?,?)",
                             ((run_id, r["seriesId"], r["date"], json.dumps(r, allow_nan=False)) for r in result["records"]))
            prior = conn.execute("SELECT id FROM fred_runs WHERE id<>? AND mode=? AND as_of=? AND status IN ('staged','committed') ORDER BY active DESC,created_at DESC LIMIT 1",
                                 (run_id, run["mode"], run["as_of"])).fetchone()
            if prior:
                overlap = changed = 0
                for row in conn.execute("SELECT a.payload,b.payload FROM fred_rows a JOIN fred_rows b ON a.series_id=b.series_id AND a.date=b.date WHERE a.run_id=? AND b.run_id=?", (run_id, prior["id"])):
                    a, b = json.loads(row[0]), json.loads(row[1])
                    overlap += 1
                    changed += a["rawValue"] != b["rawValue"]
                report["revisionComparison"] = {"againstRunId": prior["id"], "overlapCount": overlap, "changedValueCount": changed,
                                                "limitation": "Same requested date/mode only; not a full metadata audit or reconstructed vintage archive."}
            conn.execute("UPDATE fred_runs SET status=?,report=? WHERE id=?", (status, json.dumps(report, allow_nan=False), run_id))
            conn.execute("UPDATE provider_pulls SET status=?,finished_at=?,report=? WHERE id=? AND provider_id='fred'",
                         (status, utc_now(), json.dumps({"errors": report["errors"], "fredRunId": run_id}), run_id))
            _audit(conn, f"fred_{status}", fredRunId=run_id, rows=len(result["records"]), mode=run["mode"], asOf=run["as_of"])
            _health(conn, "provider:fred", "error" if report["errors"] else "ok", fredRunId=run_id, unavailableSeries=report["unavailableSeries"])

    def activate(self, run_id):
        with self.store.connection() as conn, self.store.transaction(conn):
            run = conn.execute("SELECT * FROM fred_runs WHERE id=?", (run_id,)).fetchone()
            if not run:
                raise NotFound("FRED/ALFRED snapshot not found")
            report = json.loads(run["report"])
            if (run["status"] not in ("staged", "committed") or report.get("errors") or
                report.get("transportComplete") is not True or not report.get("numericCount")):
                raise Conflict("Only validated nonempty FRED/ALFRED snapshots can be activated")
            count = conn.execute("SELECT count(*) FROM fred_rows WHERE run_id=?", (run_id,)).fetchone()[0]
            if not count or count != report.get("rowCount"):
                raise Conflict("FRED row-count gate failed")
            if run["active"]:
                return
            previous = conn.execute("SELECT id FROM fred_runs WHERE mode=? AND active=1", (run["mode"],)).fetchone()
            conn.execute("UPDATE fred_runs SET active=0 WHERE mode=? AND active=1", (run["mode"],))
            conn.execute("UPDATE fred_runs SET active=1,status='committed',previous_id=? WHERE id=?", (previous["id"] if previous else None, run_id))
            _audit(conn, "fred_activated", fredRunId=run_id, mode=run["mode"], asOf=run["as_of"])

    def rollback(self, run_id):
        with self.store.connection() as conn, self.store.transaction(conn):
            run = conn.execute("SELECT * FROM fred_runs WHERE id=?", (run_id,)).fetchone()
            if not run:
                raise NotFound("FRED/ALFRED snapshot not found")
            if run["status"] != "committed":
                raise Conflict("Only committed FRED/ALFRED snapshots can be rolled back")
            conn.execute("UPDATE fred_runs SET active=0,status='rolled_back' WHERE id=?", (run_id,))
            previous = run["previous_id"]
            while previous:
                candidate = conn.execute("SELECT id,status,previous_id FROM fred_runs WHERE id=? AND mode=?", (previous, run["mode"])).fetchone()
                if not candidate:
                    raise Conflict("FRED rollback chain is invalid")
                if candidate["status"] == "committed":
                    break
                previous = candidate["previous_id"]
            if run["active"] and previous:
                conn.execute("UPDATE fred_runs SET active=1 WHERE id=?", (previous,))
            _audit(conn, "fred_rolled_back", fredRunId=run_id, mode=run["mode"], restoredId=previous if run["active"] else None)

    def page(self, run_id, series_id, offset, limit):
        self.get(run_id)
        with self.store.connection() as conn:
            info = conn.execute("SELECT payload FROM fred_series WHERE run_id=? AND series_id=?", (run_id, series_id)).fetchone()
            if not info:
                raise NotFound("Series not present in this FRED snapshot")
            total = conn.execute("SELECT count(*) FROM fred_rows WHERE run_id=? AND series_id=?", (run_id, series_id)).fetchone()[0]
            rows = [json.loads(r[0]) for r in conn.execute("SELECT payload FROM fred_rows WHERE run_id=? AND series_id=? ORDER BY date LIMIT ? OFFSET ?", (run_id, series_id, limit, offset))]
            return {"rows": rows, "total": total, "offset": offset, "limit": limit, "series": json.loads(info[0])}

    def catalog(self, run_id):
        run = self.get(run_id)
        with self.store.connection() as conn:
            return {"runId": run_id, "mode": run["report"].get("mode"), "asOf": run["report"].get("asOf"),
                    "series": [json.loads(r[0]) for r in conn.execute("SELECT payload FROM fred_series WHERE run_id=? ORDER BY series_id", (run_id,))]}

    def export(self, run_id):
        yield json.dumps({"type": "manifest", "data": self.get(run_id)}) + "\n"
        with self.store.connection() as conn:
            for table, kind, ordering in (("fred_series", "series", "series_id"), ("fred_rows", "observation", "series_id,date")):
                for row in conn.execute(f"SELECT payload FROM {table} WHERE run_id=? ORDER BY {ordering}", (run_id,)):
                    yield '{"type":"' + kind + '","data":' + row[0] + "}\n"
