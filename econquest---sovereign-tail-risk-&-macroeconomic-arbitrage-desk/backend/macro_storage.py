"""Independent IMF basket revisions; no mutation of annual or ETF selections."""

import hashlib
import json

from .storage import Conflict, NotFound, _audit, _health
from .imf import CONTRACT, COVERAGE_POLICY
from .validation import utc_now


class MacroStore:
    def __init__(self, store):
        self.store = store

    def summaries(self, conn=None) -> list[dict]:
        if conn is None:
            with self.store.connection() as connection:
                return self.summaries(connection)
        result = []
        for row in conn.execute("SELECT * FROM macro_runs ORDER BY created_at"):
            report = json.loads(row["report"])
            result.append({
                "id": row["id"], "createdAt": row["created_at"], "status": row["status"], "active": bool(row["active"]),
                "report": {key: report[key] for key in ("errors", "rowCount", "requiredPairs", "absentPairs", "startPeriod", "endPeriod", "contractVersion", "coveragePolicy", "numericCount", "unknownStatusRows") if key in report},
                "progress": json.loads(row["progress"]),
            })
        return result

    def get(self, run_id: str) -> dict:
        with self.store.connection() as conn:
            row = conn.execute("SELECT * FROM macro_runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                raise NotFound("IMF run not found")
            sources = [{"ordinal": r["ordinal"], "path": r["path"], "httpStatus": r["http_status"],
                        "sha256": r["sha256"], "bytes": r["size"]}
                       for r in conn.execute("SELECT s.*,o.size FROM macro_sources s JOIN originals o ON o.sha256=s.sha256 WHERE run_id=? ORDER BY ordinal", (run_id,))]
            return {**next(r for r in self.summaries(conn) if r["id"] == run_id), "report": json.loads(row["report"]), "sources": sources}

    def progress(self, run_id: str, details: dict) -> None:
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT progress FROM macro_runs WHERE id=? AND status='running'", (run_id,)).fetchone()
            if not row:
                raise Conflict("IMF job is no longer running")
            value = json.loads(row["progress"]) | details | {"updatedAt": utc_now()}
            conn.execute("UPDATE macro_runs SET progress=? WHERE id=?", (json.dumps(value), run_id))

    def source(self, run_id: str, path: str, status: int, content: bytes) -> None:
        sha = hashlib.sha256(content).hexdigest()
        with self.store.connection() as conn, self.store.transaction(conn):
            conn.execute("INSERT OR IGNORE INTO originals VALUES (?,?,?)", (sha, content, len(content)))
            ordinal = conn.execute("SELECT COALESCE(MAX(ordinal),0)+1 FROM macro_sources WHERE run_id=?", (run_id,)).fetchone()[0]
            conn.execute("INSERT INTO macro_sources VALUES (?,?,?,?,?)", (run_id, ordinal, path, status, sha))

    def complete(self, run_id: str, result: dict) -> None:
        report = result["report"]
        status = "quarantined" if report["errors"] else "staged"
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT status FROM macro_runs WHERE id=?", (run_id,)).fetchone()
            if not row or row["status"] != "running":
                raise Conflict("IMF job is no longer running")
            for record in result["records"]:
                conn.execute("INSERT INTO macro_rows VALUES (?,?,?,?,?)",
                             (run_id, record["country"], record["indicator"], record["period"], json.dumps(record, allow_nan=False)))
            for record in result["coverage"]:
                conn.execute("INSERT INTO macro_coverage VALUES (?,?,?,?,?)",
                             (run_id, record["country"], record["indicator"], int(record["absent"]), json.dumps(record)))
            previous = conn.execute("SELECT id FROM macro_runs WHERE id<>? AND status IN ('staged','committed','quarantined') ORDER BY active DESC,created_at DESC LIMIT 1", (run_id,)).fetchone()
            if previous:
                overlap, changed, samples = 0, 0, []
                for pair in conn.execute(
                    "SELECT a.payload,b.payload FROM macro_rows a JOIN macro_rows b "
                    "ON a.country=b.country AND a.indicator=b.indicator AND a.period=b.period "
                    "WHERE a.run_id=? AND b.run_id=?", (run_id, previous["id"])
                ):
                    current, old = json.loads(pair[0]), json.loads(pair[1])
                    overlap += 1
                    if any(current.get(key) != old.get(key) for key in ("value", "rawValue", "scale", "unit", "status")) or any(
                        current["attributes"].get(key) != old["attributes"].get(key)
                        for key in ("REFERENCE_PERIOD", "COMMON_REFERENCE_PERIOD", "CURRENCY", "METHODOLOGY", "IFS_FLAG", "DERIVATION_TYPE")
                    ):
                        changed += 1
                        if len(samples) < 20:
                            samples.append({"country": current["country"], "indicator": current["indicator"], "period": current["period"],
                                            "oldValue": old["value"], "newValue": current["value"], "oldStatus": old["status"], "newStatus": current["status"]})
                old_count = conn.execute("SELECT count(*) FROM macro_rows WHERE run_id=?", (previous["id"],)).fetchone()[0]
                report["revisionComparison"] = {"againstRunId": previous["id"], "overlapCount": overlap, "changedCount": changed,
                                                "addedCount": len(result["records"]) - overlap, "removedCount": old_count - overlap,
                                                "samples": samples, "limitation": "Comparison of retrieved vintages only, not historical publication availability"}
            conn.execute("UPDATE macro_runs SET status=?,report=? WHERE id=?", (status, json.dumps(report, allow_nan=False), run_id))
            conn.execute("UPDATE provider_pulls SET status=?,finished_at=?,report=? WHERE id=? AND provider_id='imf'",
                         (status, utc_now(), json.dumps({"errors": report["errors"], "macroRunId": run_id}), run_id))
            _audit(conn, f"imf_{status}", macroRunId=run_id, rows=len(result["records"]))
            _health(conn, "provider:imf", "error" if report["errors"] else "ok", macroRunId=run_id, errorCount=len(report["errors"]))

    def fail(self, run_id: str, error: str) -> None:
        report = {"errors": [error], "transportComplete": False, "retrievedAt": utc_now()}
        with self.store.connection() as conn, self.store.transaction(conn):
            conn.execute("UPDATE macro_runs SET status='interrupted',report=? WHERE id=? AND status='running'", (json.dumps(report), run_id))
            conn.execute("UPDATE provider_pulls SET status='interrupted',finished_at=?,report=? WHERE id=? AND provider_id='imf'",
                         (utc_now(), json.dumps(report), run_id))
            _audit(conn, "imf_interrupted", macroRunId=run_id, error=error)
            _health(conn, "provider:imf", "error", macroRunId=run_id, errorCount=1)

    def activate(self, run_id: str) -> None:
        with self.store.connection() as conn, self.store.transaction(conn):
            run = conn.execute("SELECT * FROM macro_runs WHERE id=?", (run_id,)).fetchone()
            if not run:
                raise NotFound("IMF run not found")
            if run["status"] not in ("staged", "committed"):
                raise Conflict("Only a fully valid IMF basket can be committed or activated")
            report = json.loads(run["report"])
            pairs = conn.execute("SELECT count(*),COALESCE(sum(absent),0) FROM macro_coverage WHERE run_id=?", (run_id,)).fetchone()
            available = report.get("contractVersion") == CONTRACT and report.get("coveragePolicy") == COVERAGE_POLICY
            if report.get("contractVersion") == CONTRACT and not available:
                raise Conflict("Monthly IMF v2 coverage policy is invalid")
            if (report.get("errors") or report.get("transportComplete") is not True or not pairs[0] or
                (pairs[1] and not available) or pairs[0] != report.get("requiredPairs") or pairs[1] != report.get("absentPairs")):
                raise Conflict("IMF coverage/validation gate is not satisfied")
            counts = conn.execute("SELECT count(*),sum(json_extract(payload,'$.value') IS NOT NULL) FROM macro_rows WHERE run_id=?", (run_id,)).fetchone()
            if not counts[0] or not counts[1] or counts[0] != report.get("rowCount"):
                raise Conflict("IMF nonempty observation/row-count gate is not satisfied")
            if available and counts[1] != report.get("numericCount"):
                raise Conflict("IMF numeric-count gate is not satisfied")
            if available:
                mismatch = conn.execute(
                    "SELECT 1 FROM macro_coverage c LEFT JOIN "
                    "(SELECT country,indicator,sum(json_extract(payload,'$.value') IS NOT NULL) AS n FROM macro_rows WHERE run_id=? GROUP BY country,indicator) r "
                    "ON c.country=r.country AND c.indicator=r.indicator "
                    "WHERE c.run_id=? AND (json_extract(c.payload,'$.validCount')<>COALESCE(r.n,0) OR c.absent<>(COALESCE(r.n,0)=0)) LIMIT 1",
                    (run_id, run_id)).fetchone()
                if mismatch:
                    raise Conflict("Monthly IMF stored pair coverage is inconsistent with observations")
            if run["active"]:
                return
            previous = conn.execute("SELECT id FROM macro_runs WHERE active=1").fetchone()
            conn.execute("UPDATE macro_runs SET active=0 WHERE active=1")
            conn.execute("UPDATE macro_runs SET status='committed',active=1,previous_id=? WHERE id=?",
                         (previous["id"] if previous else None, run_id))
            _audit(conn, "imf_activated", macroRunId=run_id)

    def rollback(self, run_id: str) -> None:
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT * FROM macro_runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                raise NotFound("IMF run not found")
            if row["status"] != "committed":
                raise Conflict("Only a committed IMF revision can be rolled back")
            conn.execute("UPDATE macro_runs SET active=0,status='rolled_back' WHERE id=?", (run_id,))
            if row["active"] and row["previous_id"]:
                previous = conn.execute("SELECT id FROM macro_runs WHERE id=? AND status='committed'", (row["previous_id"],)).fetchone()
                if previous:
                    conn.execute("UPDATE macro_runs SET active=1 WHERE id=?", (previous["id"],))
            _audit(conn, "imf_rolled_back", macroRunId=run_id)

    def page(self, run_id: str, *, coverage: bool, country: str = "", indicator: str = "", offset: int = 0, limit: int = 50) -> dict:
        self.get(run_id)
        table = "macro_coverage" if coverage else "macro_rows"
        where, args = "run_id=?", [run_id]
        if country:
            where += " AND country=?"
            args.append(country)
        if indicator:
            where += " AND indicator=?"
            args.append(indicator)
        with self.store.connection() as conn:
            total = conn.execute(f"SELECT count(*) FROM {table} WHERE {where}", args).fetchone()[0]
            rows = conn.execute(f"SELECT payload FROM {table} WHERE {where} ORDER BY country,indicator{',period' if not coverage else ''} LIMIT ? OFFSET ?",
                                [*args, limit, offset])
            return {"total": total, "offset": offset, "limit": limit, "rows": [json.loads(r[0]) for r in rows]}

    def original(self, run_id: str, ordinal: int) -> bytes:
        with self.store.connection() as conn:
            row = conn.execute("SELECT o.content FROM originals o JOIN macro_sources s ON s.sha256=o.sha256 WHERE s.run_id=? AND s.ordinal=?", (run_id, ordinal)).fetchone()
            if not row:
                raise NotFound("IMF source response not found")
            return row[0]

    def export(self, run_id: str):
        manifest = self.get(run_id)
        yield json.dumps({"type": "manifest", **manifest}) + "\n"
        with self.store.connection() as conn:
            for row in conn.execute("SELECT payload FROM macro_rows WHERE run_id=? ORDER BY country,indicator,period", (run_id,)):
                yield '{"type":"observation","data":' + row[0] + "}\n"
            for row in conn.execute("SELECT payload FROM macro_coverage WHERE run_id=? ORDER BY country,indicator", (run_id,)):
                yield '{"type":"coverage","data":' + row[0] + "}\n"
