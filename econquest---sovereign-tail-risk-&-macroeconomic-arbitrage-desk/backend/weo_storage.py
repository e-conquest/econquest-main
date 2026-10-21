"""Independent immutable WEO annual releases and coverage-aware pages."""

import hashlib
import json

from .storage import Conflict, NotFound, _audit, _health
from .validation import utc_now


SUMMARY_KEYS = ("errors", "publicationDate", "sourceLastUpdated", "rowCount", "seriesCount", "requiredPairs", "absentPairs", "firstYear", "lastYear", "availableEconomies", "availableIndicators", "analysisBlockedSeries", "unknownClassificationRows", "mode", "asOf", "availableSeries", "numericCount", "missingCount", "unavailableSeries", "firstPeriod", "lastPeriod")


def summary(row):
    report = json.loads(row["report"])
    keys = SUMMARY_KEYS + (("sourceId", "counterpart", "wdiOverlapCodes") if report.get("sourceId") == "6" else ())
    return {"id": row["id"], "createdAt": row["created_at"], "status": row["status"], "active": bool(row["active"]),
            "report": {k: report[k] for k in keys if k in report}, "progress": json.loads(row["progress"])}


class WeoStore:
    """Shared immutable annual-provider persistence; namespaces never share active selections."""
    def __init__(self, store, namespace="weo"):
        if namespace not in ("weo", "worldbank", "fred", "bis", "ids"):
            raise ValueError("Unknown annual research namespace")
        self.store = store
        self.namespace = namespace
        self.provider = {"weo": "imf-weo", "worldbank": "worldbank", "fred": "fred", "bis": "bis", "ids": "ids"}[namespace]
        self.label = {"weo": "WEO", "worldbank": "World Bank", "fred": "FRED/ALFRED", "bis": "BIS", "ids": "World Bank IDS"}[namespace]

    def summaries(self, conn):
        return [summary(row) for row in conn.execute(f"SELECT * FROM {self.namespace}_runs ORDER BY created_at,id")]

    def get(self, run_id):
        with self.store.connection() as conn:
            row = conn.execute(f"SELECT * FROM {self.namespace}_runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                raise NotFound(f"{self.label} run not found")
            sources = [{"ordinal": s["ordinal"], "path": s["path"], "httpStatus": s["http_status"], "sha256": s["sha256"], "bytes": s["size"]}
                       for s in conn.execute(f"SELECT s.*,o.size FROM {self.namespace}_sources s JOIN originals o ON s.sha256=o.sha256 WHERE run_id=? ORDER BY ordinal", (run_id,))]
            return {**summary(row), "report": json.loads(row["report"]), "sources": sources}

    def progress(self, run_id, details):
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute(f"SELECT progress FROM {self.namespace}_runs WHERE id=? AND status='running'", (run_id,)).fetchone()
            if not row:
                raise Conflict(f"{self.label} acquisition is not running")
            conn.execute(f"UPDATE {self.namespace}_runs SET progress=? WHERE id=?", (json.dumps(json.loads(row[0]) | details | {"updatedAt": utc_now()}), run_id))

    def source(self, run_id, path, status, content):
        sha = hashlib.sha256(content).hexdigest()
        with self.store.connection() as conn, self.store.transaction(conn):
            conn.execute("INSERT OR IGNORE INTO originals VALUES (?,?,?)", (sha, content, len(content)))
            ordinal = conn.execute(f"SELECT COALESCE(MAX(ordinal),0)+1 FROM {self.namespace}_sources WHERE run_id=?", (run_id,)).fetchone()[0]
            conn.execute(f"INSERT INTO {self.namespace}_sources VALUES (?,?,?,?,?)", (run_id, ordinal, path, status, sha))

    def complete(self, run_id, result):
        report = result["report"]
        if not result["records"] or not result["series"]:
            raise Conflict(f"Empty {self.label} snapshot cannot be staged")
        status = "quarantined" if report["errors"] else "staged"
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute(f"SELECT status FROM {self.namespace}_runs WHERE id=?", (run_id,)).fetchone()
            if not row or row[0] != "running":
                raise Conflict(f"{self.label} acquisition is not running")
            conn.executemany(f"INSERT INTO {self.namespace}_series VALUES (?,?,?,?)",
                             ((run_id, s["country"], s["indicator"], json.dumps(s, allow_nan=False)) for s in result["series"]))
            conn.executemany(f"INSERT INTO {self.namespace}_rows VALUES (?,?,?,?,?)",
                             ((run_id, r["country"], r["indicator"], r["year"], json.dumps(r, allow_nan=False)) for r in result["records"]))
            previous = conn.execute(f"SELECT id FROM {self.namespace}_runs WHERE id<>? AND status IN ('committed','staged') ORDER BY active DESC,created_at DESC LIMIT 1", (run_id,)).fetchone()
            if previous:
                changed = overlap = 0
                for row in conn.execute(f"SELECT a.payload,b.payload FROM {self.namespace}_rows a JOIN {self.namespace}_rows b ON a.country=b.country AND a.indicator=b.indicator AND a.year=b.year WHERE a.run_id=? AND b.run_id=?", (run_id, previous[0])):
                    a, b = json.loads(row[0]), json.loads(row[1])
                    overlap += 1
                    changed += any(a.get(k) != b.get(k) for k in ("value", "rawValue", "classification", "status", "footnote", "unit", "decimal", "attributes", "counterpart", "sourceId"))
                report["revisionComparison"] = {"againstRunId": previous[0], "overlapCount": overlap, "changedValueOrClassificationCount": changed,
                                                "limitation": "Retrieved snapshot comparison only, not historical publication availability; inspect source units/metadata separately"}
            conn.execute(f"UPDATE {self.namespace}_runs SET status=?,report=? WHERE id=?", (status, json.dumps(report, allow_nan=False), run_id))
            conn.execute("UPDATE provider_pulls SET status=?,finished_at=?,report=? WHERE id=? AND provider_id=?",
                         (status, utc_now(), json.dumps({"errors": report["errors"], f"{self.namespace}RunId": run_id}), run_id, self.provider))
            _audit(conn, f"{self.namespace}_{status}", **{f"{self.namespace}RunId": run_id}, rows=len(result["records"]))
            _health(conn, f"provider:{self.provider}", "error" if report["errors"] else "ok", **{f"{self.namespace}RunId": run_id}, absentPairs=report["absentPairs"])

    def fail(self, run_id, error):
        report = json.dumps({"errors": [error], "transportComplete": False})
        with self.store.connection() as conn, self.store.transaction(conn):
            conn.execute(f"UPDATE {self.namespace}_runs SET status='interrupted',report=? WHERE id=? AND status='running'", (report, run_id))
            conn.execute("UPDATE provider_pulls SET status='interrupted',finished_at=?,report=? WHERE id=? AND status='running' AND provider_id=?", (utc_now(), report, run_id, self.provider))
            _audit(conn, f"{self.namespace}_interrupted", **{f"{self.namespace}RunId": run_id}, error=error)
            _health(conn, f"provider:{self.provider}", "error", **{f"{self.namespace}RunId": run_id})

    def activate(self, run_id):
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute(f"SELECT * FROM {self.namespace}_runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                raise NotFound(f"{self.label} run not found")
            report = json.loads(row["report"])
            if row["status"] not in ("staged", "committed") or report.get("errors") or report.get("transportComplete") is not True:
                raise Conflict(f"Only a validated {self.label} snapshot can be activated; missing coverage alone does not invalidate it")
            if self.namespace == "ids" and (report.get("sourceId") != "6" or report.get("counterpart") != "WLD" or not report.get("numericCount")):
                raise Conflict("IDS source/counterpart/nonempty numeric gate failed")
            count = conn.execute(f"SELECT count(*) FROM {self.namespace}_rows WHERE run_id=?", (run_id,)).fetchone()[0]
            if not count or count != report.get("rowCount"):
                raise Conflict(f"{self.label} row-count gate failed")
            if row["active"]:
                return
            previous = conn.execute(f"SELECT id FROM {self.namespace}_runs WHERE active=1").fetchone()
            conn.execute(f"UPDATE {self.namespace}_runs SET active=0 WHERE active=1")
            conn.execute(f"UPDATE {self.namespace}_runs SET active=1,status='committed',previous_id=? WHERE id=?", (previous[0] if previous else None, run_id))
            _audit(conn, f"{self.namespace}_activated", **{f"{self.namespace}RunId": run_id})

    def rollback(self, run_id):
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute(f"SELECT * FROM {self.namespace}_runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                raise NotFound(f"{self.label} run not found")
            if row["status"] != "committed":
                raise Conflict(f"Only a committed {self.label} snapshot can be rolled back")
            conn.execute(f"UPDATE {self.namespace}_runs SET active=0,status='rolled_back' WHERE id=?", (run_id,))
            if row["active"] and row["previous_id"]:
                previous, visited = row["previous_id"], {run_id}
                while previous and previous not in visited:
                    visited.add(previous)
                    candidate = conn.execute(f"SELECT * FROM {self.namespace}_runs WHERE id=?", (previous,)).fetchone()
                    if candidate is None:
                        raise Conflict(f"{self.label} rollback predecessor missing")
                    if candidate["status"] == "committed":
                        conn.execute(f"UPDATE {self.namespace}_runs SET active=1 WHERE id=?", (previous,))
                        break
                    previous = candidate["previous_id"]
            _audit(conn, f"{self.namespace}_rolled_back", **{f"{self.namespace}RunId": run_id})

    def series(self, run_id, country, indicator):
        with self.store.connection() as conn:
            row = conn.execute(f"SELECT payload FROM {self.namespace}_series WHERE run_id=? AND country=? AND indicator=?", (run_id, country, indicator)).fetchone()
            return json.loads(row[0]) if row else None

    def page(self, run_id, *, coverage, country="", indicator="", offset=0, limit=50):
        manifest = self.get(run_id)
        report = manifest["report"]
        countries = [c for c in report.get("countries", []) if not country or c["code"] == country]
        indicators = [i for i in report.get("indicators", []) if not indicator or i["code"] == indicator]
        if country and not countries or indicator and not indicators:
            raise NotFound(f"{self.label} economy/indicator not in this snapshot catalog")
        if coverage:
            pairs = [(c, i) for c in countries for i in indicators]
            rows = []
            for c, i in pairs[offset:offset + limit]:
                item = self.series(run_id, c["code"], i["code"])
                rows.append({"country": c["code"], "name": c["name"], "indicator": i["code"], "indicatorName": i["name"],
                             "validCount": item["validCount"] if item else 0, "absent": item is None or item["validCount"] == 0,
                             "missingYears": item["missingYears"] if item else list(range(report["firstYear"], report["lastYear"] + 1)),
                             "latestActualYear": item.get("latestActualYear") if item else None,
                             "analysisBlocked": item["analysisBlocked"] if item else True})
            return {"rows": rows, "total": len(pairs), "offset": offset, "limit": limit}
        with self.store.connection() as conn:
            total = conn.execute(f"SELECT count(*) FROM {self.namespace}_rows WHERE run_id=? AND country=? AND indicator=?", (run_id, country, indicator)).fetchone()[0]
            rows = conn.execute(f"SELECT payload FROM {self.namespace}_rows WHERE run_id=? AND country=? AND indicator=? ORDER BY year LIMIT ? OFFSET ?", (run_id, country, indicator, limit, offset))
            return {"rows": [json.loads(r[0]) for r in rows], "total": total, "offset": offset, "limit": limit,
                    "series": self.series(run_id, country, indicator)}

    def original(self, run_id, ordinal):
        with self.store.connection() as conn:
            row = conn.execute(f"SELECT o.content FROM {self.namespace}_sources s JOIN originals o ON s.sha256=o.sha256 WHERE run_id=? AND ordinal=?", (run_id, ordinal)).fetchone()
            if not row:
                raise NotFound(f"{self.label} response not found")
            return row[0]

    def export(self, run_id):
        yield json.dumps({"type": "manifest", **self.get(run_id)}) + "\n"
        with self.store.connection() as conn:
            for table, kind in ((f"{self.namespace}_series", "series"), (f"{self.namespace}_rows", "observation")):
                for row in conn.execute(f"SELECT payload FROM {table} WHERE run_id=? ORDER BY country,indicator", (run_id,)):
                    yield '{"type":"' + kind + '","data":' + row[0] + "}\n"
