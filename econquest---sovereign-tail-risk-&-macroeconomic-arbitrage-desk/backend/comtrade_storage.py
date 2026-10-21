"""Durable resumable Comtrade chunks; incomplete global acquisitions never activate."""

import hashlib
import json
import time
from collections import defaultdict

from .comtrade import CONTRACT, DAILY_REQUESTS, FIRST_YEAR, Paused, cutoff_year
from .storage import Conflict, NotFound, _audit, _health
from .validation import utc_now

SUMMARY = ("errors", "contractVersion", "firstYear", "lastYear", "rowCount", "numericCount", "taskCount",
           "completedTasks", "phase", "pauseReason", "transportComplete", "notBefore", "reporterCount")


class ComtradeStore:
    def __init__(self, store):
        self.store = store

    def summaries(self, conn):
        result = []
        for row in conn.execute("SELECT * FROM comtrade_runs ORDER BY created_at,id"):
            report = json.loads(row["report"])
            result.append({"id": row["id"], "createdAt": row["created_at"], "status": row["status"], "active": bool(row["active"]),
                           "report": {k: report[k] for k in SUMMARY if k in report}, "progress": json.loads(row["progress"])})
        return result

    def get(self, run_id, *, include_sources=True):
        with self.store.connection() as conn:
            conn.execute("BEGIN")
            return self._get(conn, run_id, include_sources=include_sources)

    def _get(self, conn, run_id, *, include_sources=True):
        row = conn.execute("SELECT * FROM comtrade_runs WHERE id=?", (run_id,)).fetchone()
        if not row:
            raise NotFound("Comtrade acquisition not found")
        sources = [dict(r) for r in conn.execute(
            "SELECT s.ordinal,s.path,s.http_status AS httpStatus,s.sha256,s.retrieved_at AS retrievedAt,o.size AS bytes "
            "FROM comtrade_sources s JOIN originals o ON s.sha256=o.sha256 WHERE run_id=? ORDER BY ordinal", (run_id,))] if include_sources else []
        return {"id": run_id, "createdAt": row["created_at"], "status": row["status"], "active": bool(row["active"]),
                "report": json.loads(row["report"]), "progress": json.loads(row["progress"]), "sources": sources}

    def source(self, run_id, path, status, content):
        sha = hashlib.sha256(content).hexdigest()
        with self.store.connection() as conn, self.store.transaction(conn):
            conn.execute("INSERT OR IGNORE INTO originals VALUES (?,?,?)", (sha, content, len(content)))
            ordinal = conn.execute("SELECT COALESCE(max(ordinal),0)+1 FROM comtrade_sources WHERE run_id=?", (run_id,)).fetchone()[0]
            conn.execute("INSERT INTO comtrade_sources VALUES (?,?,?,?,?,?)", (run_id, ordinal, path, status, sha, utc_now()))

    def progress(self, run_id, details):
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT progress FROM comtrade_runs WHERE id=? AND status='running'", (run_id,)).fetchone()
            if not row:
                raise Conflict("Comtrade pass is not running")
            conn.execute("UPDATE comtrade_runs SET progress=? WHERE id=?",
                         (json.dumps(json.loads(row[0]) | details | {"updatedAt": utc_now()}), run_id))

    def reserve(self, run_id):
        with self.store.connection() as conn, self.store.transaction(conn):
            now = time.time()
            rows = conn.execute("SELECT started_at FROM comtrade_requests WHERE started_at>? ORDER BY started_at", (now - 86400,)).fetchall()
            if len(rows) >= DAILY_REQUESTS:
                raise Paused("Local 450-request rolling-24-hour budget exhausted; no automatic resume", rows[0][0] + 86400)
            conn.execute("INSERT INTO comtrade_requests(run_id,started_at) VALUES (?,?)", (run_id, now))

    def initialize(self, run_id, reporters, partners):
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT report FROM comtrade_runs WHERE id=? AND status='running'", (run_id,)).fetchone()
            if not row:
                raise Conflict("Comtrade pass is not running")
            report = json.loads(row[0])
            if report.get("reporters"):
                raise Conflict("Comtrade reference universe already frozen")
            report |= {"contractVersion": CONTRACT, "firstYear": FIRST_YEAR, "lastYear": cutoff_year(),
                       "reporters": reporters, "partners": partners, "reporterCount": sum(not r["isGroup"] for r in reporters),
                       "unreviewedPartners": [p for p in partners if p["kind"] == "unreviewed"],
                       "transportComplete": False, "phase": "discovery", "errors": [], "dataPlanned": False,
                       "flaggedValuePolicy": "Retain native isReported=false values with flags; do not assert direct country reporting or interpret quantity flags as value-estimation flags",
                       "limitation": "Original-classification annual TOTAL merchandise trade only; native current USD and source flags. Historical reporting areas retain source identities. No mirror substitution, product breakdown, sums, trade-balance/concentration inference or model inputs. Missing rows are unknown, not zero. World/group/special/unreviewed partners are separate; unreviewed categories are retained but never treated as individual bilateral partners. Native isReported=false values are retained with flags, not asserted to be directly reported; that flag alone does not establish whether an aggregate was estimated. Import CIF/export FOB conventions differ; inspect source fields. Publication/observation/retrieval times are not interchangeable. A multi-pass acquisition is not a transactional global vintage; pending chunks may capture newer revisions than discovery, recorded in each task result and verified before/after that chunk."}
            conn.executemany("INSERT INTO comtrade_tasks VALUES (?,?,? ,?,'pending','{}')",
                             ((run_id, f"availability:{year}", "discovery", json.dumps({"year": year}))
                              for year in range(FIRST_YEAR, report["lastYear"] + 1)))
            report["taskCount"], report["completedTasks"] = report["lastYear"] - FIRST_YEAR + 1, 0
            conn.execute("UPDATE comtrade_runs SET report=? WHERE id=?", (json.dumps(report), run_id))

    def next_task(self, run_id):
        with self.store.connection() as conn:
            row = conn.execute("SELECT task_key,kind,spec FROM comtrade_tasks WHERE run_id=? AND status='pending' ORDER BY task_key LIMIT 1", (run_id,)).fetchone()
            return {"key": row[0], "kind": row[1], "spec": json.loads(row[2])} if row else None

    def complete_task(self, run_id, key, *, datasets=None, rows=None, acquired=None, revised=False):
        with self.store.connection() as conn, self.store.transaction(conn):
            task = conn.execute("SELECT status,kind FROM comtrade_tasks WHERE run_id=? AND task_key=?", (run_id, key)).fetchone()
            run = conn.execute("SELECT report FROM comtrade_runs WHERE id=? AND status='running'", (run_id,)).fetchone()
            if not task or task["status"] != "pending" or not run:
                raise Conflict("Comtrade task is not pending in a running pass")
            if rows is not None:
                conn.executemany("INSERT INTO comtrade_rows VALUES (?,?,?,?,?,?)",
                                 ((run_id, r["reporter"], r["partner"], r["flow"], r["year"], json.dumps(r, allow_nan=False)) for r in rows))
            conn.execute("UPDATE comtrade_tasks SET status='complete',result=? WHERE run_id=? AND task_key=?",
                         (json.dumps({"datasets": datasets} if datasets is not None else
                                     {"rowCount": len(rows or []), "datasetsAcquired": acquired, "revisedSinceDiscovery": revised}), run_id, key))
            report = json.loads(run[0])
            counts = conn.execute("SELECT count(*),sum(status='complete') FROM comtrade_tasks WHERE run_id=?", (run_id,)).fetchone()
            report["taskCount"], report["completedTasks"] = counts
            report["rowCount"] = conn.execute("SELECT count(*) FROM comtrade_rows WHERE run_id=?", (run_id,)).fetchone()[0]
            conn.execute("UPDATE comtrade_runs SET report=? WHERE id=?", (json.dumps(report), run_id))

    def plan_data(self, run_id):
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT report FROM comtrade_runs WHERE id=? AND status='running'", (run_id,)).fetchone()
            if not row:
                raise Conflict("Comtrade pass is not running")
            report = json.loads(row[0])
            if report.get("dataPlanned"):
                return False
            if conn.execute("SELECT count(*) FROM comtrade_tasks WHERE run_id=? AND status<>'complete'", (run_id,)).fetchone()[0]:
                raise Conflict("Comtrade availability discovery is not complete")
            grouped = defaultdict(list)
            for task in conn.execute("SELECT result FROM comtrade_tasks WHERE run_id=? AND kind='discovery' ORDER BY task_key", (run_id,)):
                for dataset in json.loads(task[0])["datasets"]:
                    grouped[(dataset["reporterCode"], dataset["classificationSearchCode"])].append(dataset)
            specs = []
            for (reporter, search), datasets in sorted(grouped.items()):
                datasets.sort(key=lambda d: d["period"])
                for offset in range(0, len(datasets), 12):
                    batch = datasets[offset:offset + 12]
                    spec = {"reporter": reporter, "search": search, "years": [d["period"] for d in batch], "datasets": batch}
                    specs.append((run_id, f"data:{reporter:04d}:{search}:{batch[0]['period']}", "data", json.dumps(spec)))
            conn.executemany("INSERT INTO comtrade_tasks VALUES (?,?,?,?,'pending','{}')", specs)
            report |= {"dataPlanned": True, "phase": "data", "taskCount": report["taskCount"] + len(specs),
                       "plannedDataChunks": len(specs), "availableReporterYears": sum(len(v) for v in grouped.values())}
            conn.execute("UPDATE comtrade_runs SET report=? WHERE id=?", (json.dumps(report), run_id))
            return bool(specs)

    def finish(self, run_id):
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT report FROM comtrade_runs WHERE id=? AND status='running'", (run_id,)).fetchone()
            if not row:
                raise Conflict("Comtrade pass is not running")
            report = json.loads(row[0])
            tasks = conn.execute("SELECT count(*),sum(status<>'complete'),sum(kind='discovery'),sum(kind='data') FROM comtrade_tasks WHERE run_id=?", (run_id,)).fetchone()
            counts = conn.execute("SELECT count(*),sum(json_extract(payload,'$.value') IS NOT NULL) FROM comtrade_rows WHERE run_id=?", (run_id,)).fetchone()
            if (not report.get("dataPlanned") or not counts[0] or not counts[1] or tasks[1] or not tasks[3] or
                tasks[0] != report.get("taskCount") or tasks[0] != report.get("completedTasks") or
                tasks[2] != report.get("lastYear", 0) - report.get("firstYear", 0) + 1):
                raise Conflict("Comtrade complete global snapshot requires all planned chunks and usable observations")
            report |= {"phase": "complete", "transportComplete": True, "errors": [], "rowCount": counts[0],
                       "numericCount": counts[1], "completedAt": utc_now(), "pauseReason": None, "notBefore": None}
            conn.execute("UPDATE comtrade_runs SET status='staged',report=? WHERE id=?", (json.dumps(report), run_id))
            conn.execute("UPDATE provider_pulls SET status='staged',finished_at=?,report=? WHERE id=?", (utc_now(), json.dumps({"errors": []}), run_id))
            _audit(conn, "comtrade_staged", comtradeRunId=run_id, rows=counts[0])
            _health(conn, "provider:comtrade", "ok", comtradeRunId=run_id)

    def pause(self, run_id, reason, *, not_before=None, failed=False):
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT report FROM comtrade_runs WHERE id=? AND status='running'", (run_id,)).fetchone()
            if not row:
                raise Conflict("Comtrade pass is not running")
            report = json.loads(row[0]) | {"transportComplete": False, "pauseReason": reason, "notBefore": not_before,
                                         "errors": [reason] if failed else []}
            conn.execute("UPDATE comtrade_runs SET status='interrupted',report=? WHERE id=?", (json.dumps(report), run_id))
            conn.execute("UPDATE provider_pulls SET status='interrupted',finished_at=?,report=? WHERE id=?",
                         (utc_now(), json.dumps({"errors": report["errors"]}), run_id))
            _audit(conn, "comtrade_pass_paused", comtradeRunId=run_id, reason=reason)
            _health(conn, "provider:comtrade", "error" if failed else "unknown", comtradeRunId=run_id)

    def resume(self, run_id):
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT * FROM comtrade_runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                raise NotFound("Comtrade acquisition not found")
            report = json.loads(row["report"])
            if row["status"] != "interrupted" or row["active"] or report.get("transportComplete"):
                raise Conflict("Only an incomplete paused Comtrade acquisition can be resumed")
            if report.get("notBefore") and time.time() < report["notBefore"]:
                raise Conflict("Comtrade quota pause has not expired")
            if conn.execute("SELECT 1 FROM provider_pulls WHERE provider_id='comtrade' AND status='running'").fetchone():
                raise Conflict("A Comtrade pass is already running")
            report |= {"pauseReason": None, "notBefore": None, "errors": []}
            conn.execute("UPDATE comtrade_runs SET status='running',report=? WHERE id=?", (json.dumps(report), run_id))
            conn.execute("UPDATE provider_pulls SET status='running',finished_at=NULL WHERE id=?", (run_id,))
            _audit(conn, "comtrade_pass_resumed", comtradeRunId=run_id)

    def activate(self, run_id):
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT * FROM comtrade_runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                raise NotFound("Comtrade acquisition not found")
            report = json.loads(row["report"])
            counts = conn.execute("SELECT count(*),sum(json_extract(payload,'$.value') IS NOT NULL) FROM comtrade_rows WHERE run_id=?", (run_id,)).fetchone()
            tasks = conn.execute("SELECT count(*),sum(status<>'complete'),sum(kind='discovery'),sum(kind='data') FROM comtrade_tasks WHERE run_id=?", (run_id,)).fetchone()
            if (row["status"] not in ("staged", "committed") or report.get("contractVersion") != CONTRACT or
                report.get("transportComplete") is not True or report.get("errors") or not report.get("dataPlanned") or tasks[1] or
                not tasks[3] or tasks[0] != report.get("taskCount") or tasks[0] != report.get("completedTasks") or
                tasks[2] != report.get("lastYear", 0) - report.get("firstYear", 0) + 1 or
                not counts[0] or not counts[1] or counts[0] != report.get("rowCount") or counts[1] != report.get("numericCount")):
                raise Conflict("Incomplete/unvalidated global Comtrade snapshots cannot activate")
            if row["active"]:
                return
            prior = conn.execute("SELECT id FROM comtrade_runs WHERE active=1").fetchone()
            conn.execute("UPDATE comtrade_runs SET active=0 WHERE active=1")
            conn.execute("UPDATE comtrade_runs SET status='committed',active=1,previous_id=? WHERE id=?", (prior[0] if prior else None, run_id))
            _audit(conn, "comtrade_activated", comtradeRunId=run_id)

    def rollback(self, run_id):
        with self.store.connection() as conn, self.store.transaction(conn):
            row = conn.execute("SELECT * FROM comtrade_runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                raise NotFound("Comtrade acquisition not found")
            if row["status"] != "committed":
                raise Conflict("Only committed Comtrade snapshots can roll back")
            conn.execute("UPDATE comtrade_runs SET status='rolled_back',active=0 WHERE id=?", (run_id,))
            previous, visited = row["previous_id"], {run_id}
            while row["active"] and previous and previous not in visited:
                visited.add(previous)
                candidate = conn.execute("SELECT * FROM comtrade_runs WHERE id=?", (previous,)).fetchone()
                if candidate is None:
                    raise Conflict("Comtrade rollback predecessor missing")
                if candidate["status"] == "committed":
                    conn.execute("UPDATE comtrade_runs SET active=1 WHERE id=?", (previous,))
                    break
                previous = candidate["previous_id"]
            _audit(conn, "comtrade_rolled_back", comtradeRunId=run_id)

    def page(self, run_id, *, tasks=False, reporter=None, partner=None, flow=None, offset=0, limit=100):
        self.get(run_id)
        where, args = "run_id=?", [run_id]
        if not tasks:
            for field, value in (("reporter", reporter), ("partner", partner), ("flow", flow)):
                if value is not None:
                    where += f" AND {field}=?"
                    args.append(value)
        table = "comtrade_tasks" if tasks else "comtrade_rows"
        order = "task_key" if tasks else "reporter,partner,flow,year"
        with self.store.connection() as conn:
            conn.execute("BEGIN")
            total = conn.execute(f"SELECT count(*) FROM {table} WHERE {where}", args).fetchone()[0]
            rows = conn.execute(f"SELECT * FROM {table} WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?", [*args, limit, offset])
            result = [{"key": r["task_key"], "kind": r["kind"], "status": r["status"], "spec": json.loads(r["spec"]), "result": json.loads(r["result"])}
                      if tasks else json.loads(r["payload"]) for r in rows]
        return {"rows": result, "total": total, "offset": offset, "limit": limit}

    def original(self, run_id, ordinal):
        with self.store.connection() as conn:
            row = conn.execute("SELECT o.content FROM comtrade_sources s JOIN originals o ON s.sha256=o.sha256 WHERE run_id=? AND ordinal=?", (run_id, ordinal)).fetchone()
            if not row:
                raise NotFound("Comtrade original not found")
            return row[0]

    def export(self, run_id):
        with self.store.connection() as conn:
            conn.execute("BEGIN")
            yield json.dumps({"type": "manifest", **self._get(conn, run_id)}) + "\n"
            for table, kind, field in (("comtrade_tasks", "task", "result"), ("comtrade_rows", "observation", "payload")):
                for row in conn.execute(f"SELECT * FROM {table} WHERE run_id=?", (run_id,)):
                    data = {"key": row["task_key"], "kind": row["kind"], "status": row["status"], "spec": json.loads(row["spec"]), "result": json.loads(row[field])} if kind == "task" else json.loads(row[field])
                    yield json.dumps({"type": kind, "data": data}) + "\n"
