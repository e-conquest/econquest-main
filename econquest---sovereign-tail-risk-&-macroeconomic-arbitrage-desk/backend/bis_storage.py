"""Independent immutable BIS quarterly snapshots using shared provider primitives."""

import json

from .storage import Conflict, NotFound, _audit, _health
from .validation import utc_now
from .weo_storage import WeoStore


class BisStore(WeoStore):
    def __init__(self, store):
        super().__init__(store, "bis")

    def complete(self, run_id, result):
        report = result["report"]
        if not result["records"] or not report.get("numericCount") or not result["series"]:
            raise Conflict("Empty BIS snapshot cannot be staged")
        status = "quarantined" if report["errors"] else "staged"
        with self.store.connection() as conn, self.store.transaction(conn):
            run = conn.execute("SELECT status FROM bis_runs WHERE id=?", (run_id,)).fetchone()
            if not run or run["status"] != "running":
                raise Conflict("BIS acquisition is not running")
            conn.executemany("INSERT INTO bis_series VALUES (?,?,?,?)",
                             ((run_id, s["country"], s["indicator"], json.dumps(s, allow_nan=False)) for s in result["series"]))
            conn.executemany("INSERT INTO bis_rows VALUES (?,?,?,?,?)",
                             ((run_id, r["country"], r["indicator"], r["period"], json.dumps(r, allow_nan=False)) for r in result["records"]))
            previous = conn.execute("SELECT id FROM bis_runs WHERE id<>? AND status IN ('staged','committed') ORDER BY active DESC,created_at DESC LIMIT 1", (run_id,)).fetchone()
            if previous:
                changed = overlap = 0
                for row in conn.execute("SELECT a.payload,b.payload FROM bis_rows a JOIN bis_rows b ON a.country=b.country AND a.indicator=b.indicator AND a.period=b.period WHERE a.run_id=? AND b.run_id=?", (run_id, previous["id"])):
                    a, b = json.loads(row[0]), json.loads(row[1])
                    overlap += 1
                    changed += any(a[k] != b[k] for k in ("rawValue", "attributes"))
                report["revisionComparison"] = {"againstRunId": previous["id"], "overlapCount": overlap, "changedValueOrAttributeCount": changed,
                                                "limitation": "Retrieved snapshots, not historical publication vintages. Inspect dimensions/metadata separately."}
            conn.execute("UPDATE bis_runs SET status=?,report=? WHERE id=?", (status, json.dumps(report, allow_nan=False), run_id))
            conn.execute("UPDATE provider_pulls SET status=?,finished_at=?,report=? WHERE id=? AND provider_id='bis'",
                         (status, utc_now(), json.dumps({"errors": report["errors"], "bisRunId": run_id}), run_id))
            _audit(conn, f"bis_{status}", bisRunId=run_id, rows=len(result["records"]))
            _health(conn, "provider:bis", "error" if report["errors"] else "ok", bisRunId=run_id, absentPairs=report["absentPairs"])

    def rollback(self, run_id):
        with self.store.connection() as conn, self.store.transaction(conn):
            run = conn.execute("SELECT * FROM bis_runs WHERE id=?", (run_id,)).fetchone()
            if not run:
                raise NotFound("BIS snapshot not found")
            if run["status"] != "committed":
                raise Conflict("Only committed BIS snapshots can be rolled back")
            conn.execute("UPDATE bis_runs SET active=0,status='rolled_back' WHERE id=?", (run_id,))
            previous = run["previous_id"]
            while previous:
                candidate = conn.execute("SELECT * FROM bis_runs WHERE id=?", (previous,)).fetchone()
                if not candidate:
                    raise Conflict("BIS rollback chain is invalid")
                if candidate["status"] == "committed":
                    break
                previous = candidate["previous_id"]
            if run["active"] and previous:
                conn.execute("UPDATE bis_runs SET active=1 WHERE id=?", (previous,))
            _audit(conn, "bis_rolled_back", bisRunId=run_id, restoredId=previous if run["active"] else None)

    def page(self, run_id, *, coverage, country="", indicator="", offset=0, limit=50):
        run = self.get(run_id)
        countries = {c["code"]: c for c in run["report"].get("countries", [])}
        indicators = {i["code"]: i for i in run["report"].get("indicators", [])}
        if (country and country not in countries) or (indicator and indicator not in indicators):
            raise NotFound("BIS economy/indicator not in snapshot catalog")
        filters, params = ["run_id=?"], [run_id]
        for column, value in (("country", country), ("indicator", indicator)):
            if value:
                filters.append(f"{column}=?")
                params.append(value)
        where = " AND ".join(filters)
        table = "bis_series" if coverage else "bis_rows"
        with self.store.connection() as conn:
            total = conn.execute(f"SELECT count(*) FROM {table} WHERE {where}", params).fetchone()[0]
            rows = [json.loads(r[0]) for r in conn.execute(f"SELECT payload FROM {table} WHERE {where} ORDER BY country,indicator" +
                    ("" if coverage else ",period") + " LIMIT ? OFFSET ?", [*params, limit, offset])]
        if coverage:
            rows = [r | {"name": countries[r["country"]]["name"], "indicatorName": indicators[r["indicator"]]["name"], "absent": r["validCount"] == 0} for r in rows]
        return {"rows": rows, "total": total, "offset": offset, "limit": limit,
                **({} if coverage else {"series": self.series(run_id, country, indicator)})}
