"""SQLite revisions, immutable inputs, audit history, and consistent snapshots."""

import hashlib
import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .models import Dataset, ImportPreview, Observation, Run, State
from .validation import BatchError, utc_now, validate_annual_overlay

DB_VERSION = 12
MIGRATIONS = {
    1: [
        """CREATE TABLE originals (
            sha256 TEXT PRIMARY KEY, content BLOB NOT NULL, size INTEGER NOT NULL CHECK(size >= 0))""",
        """CREATE TABLE runs (
            id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL CHECK(status IN ('staged','quarantined','committed','rolled_back','interrupted')),
            created_at TEXT NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('annual','market')),
            unit TEXT NOT NULL, freshness_days INTEGER CHECK(freshness_days IS NULL OR freshness_days >= 0),
            errors TEXT NOT NULL, dataset_id TEXT, row_count INTEGER NOT NULL CHECK(row_count >= 0),
            original_sha TEXT NOT NULL REFERENCES originals(sha256), filename TEXT NOT NULL,
            sheet TEXT, sheets TEXT NOT NULL, preview TEXT NOT NULL)""",
        """CREATE TABLE datasets (
            id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES runs(id),
            revision INTEGER NOT NULL CHECK(revision > 0),
            kind TEXT NOT NULL CHECK(kind IN ('annual','market')),
            source TEXT NOT NULL, unit TEXT NOT NULL, created_at TEXT NOT NULL,
            freshness_days INTEGER CHECK(freshness_days IS NULL OR freshness_days >= 0),
            active INTEGER NOT NULL CHECK(active IN (0,1)),
            previous_id TEXT REFERENCES datasets(id), UNIQUE(kind, revision))""",
        "CREATE UNIQUE INDEX one_active_kind ON datasets(kind) WHERE active = 1",
        """CREATE TABLE observations (
            dataset_id TEXT NOT NULL REFERENCES datasets(id), ordinal INTEGER NOT NULL,
            observation_key TEXT NOT NULL, payload TEXT NOT NULL,
            PRIMARY KEY(dataset_id, ordinal), UNIQUE(dataset_id, observation_key))""",
        """CREATE TABLE audit (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, created_at TEXT NOT NULL,
            run_id TEXT REFERENCES runs(id), dataset_id TEXT REFERENCES datasets(id), details TEXT NOT NULL)""",
        """CREATE TRIGGER originals_no_update BEFORE UPDATE ON originals
            BEGIN SELECT RAISE(ABORT, 'original bytes are immutable'); END""",
        """CREATE TRIGGER originals_no_delete BEFORE DELETE ON originals
            BEGIN SELECT RAISE(ABORT, 'original bytes are immutable'); END""",
        """CREATE TRIGGER observations_no_update BEFORE UPDATE ON observations
            BEGIN SELECT RAISE(ABORT, 'observations are immutable'); END""",
        """CREATE TRIGGER observations_no_delete BEFORE DELETE ON observations
            BEGIN SELECT RAISE(ABORT, 'observations are immutable'); END""",
        """CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit
            BEGIN SELECT RAISE(ABORT, 'audit is append only'); END""",
        """CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit
            BEGIN SELECT RAISE(ABORT, 'audit is append only'); END""",
    ],
    2: [
        """CREATE TABLE health (
            id TEXT PRIMARY KEY, status TEXT NOT NULL, checked_at TEXT NOT NULL, details TEXT NOT NULL)""",
    ],
    3: [
        """CREATE TABLE provider_pulls (
            id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
            status TEXT NOT NULL CHECK(status IN ('running','staged','quarantined','interrupted')),
            run_id TEXT REFERENCES runs(id), report TEXT NOT NULL)""",
        "CREATE UNIQUE INDEX one_provider_pull ON provider_pulls(status) WHERE status='running'",
    ],
    4: [
        "ALTER TABLE provider_pulls ADD COLUMN provider_id TEXT NOT NULL DEFAULT 'yfinance'",
        "DROP INDEX one_provider_pull",
        "CREATE UNIQUE INDEX one_provider_pull ON provider_pulls(provider_id) WHERE status='running'",
        """CREATE TABLE macro_runs (
            id TEXT PRIMARY KEY REFERENCES provider_pulls(id), created_at TEXT NOT NULL,
            status TEXT NOT NULL, report TEXT NOT NULL, progress TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)), previous_id TEXT REFERENCES macro_runs(id))""",
        "CREATE UNIQUE INDEX one_active_macro ON macro_runs(active) WHERE active=1",
        """CREATE TABLE macro_sources (
            run_id TEXT NOT NULL REFERENCES macro_runs(id), ordinal INTEGER NOT NULL, path TEXT NOT NULL,
            http_status INTEGER NOT NULL, sha256 TEXT NOT NULL REFERENCES originals(sha256),
            PRIMARY KEY(run_id,ordinal))""",
        """CREATE TABLE macro_rows (
            run_id TEXT NOT NULL REFERENCES macro_runs(id), country TEXT NOT NULL, indicator TEXT NOT NULL,
            period TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,country,indicator,period))""",
        """CREATE TABLE macro_coverage (
            run_id TEXT NOT NULL REFERENCES macro_runs(id), country TEXT NOT NULL, indicator TEXT NOT NULL,
            absent INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,country,indicator))""",
        """CREATE TRIGGER macro_rows_no_update BEFORE UPDATE ON macro_rows
            BEGIN SELECT RAISE(ABORT, 'macro observations are immutable'); END""",
        """CREATE TRIGGER macro_rows_no_delete BEFORE DELETE ON macro_rows
            BEGIN SELECT RAISE(ABORT, 'macro observations are immutable'); END""",
        """CREATE TRIGGER macro_sources_no_update BEFORE UPDATE ON macro_sources
            BEGIN SELECT RAISE(ABORT, 'macro sources are immutable'); END""",
        """CREATE TRIGGER macro_sources_no_delete BEFORE DELETE ON macro_sources
            BEGIN SELECT RAISE(ABORT, 'macro sources are immutable'); END""",
    ],
    5: [
        """CREATE TABLE weo_runs (
            id TEXT PRIMARY KEY REFERENCES provider_pulls(id), created_at TEXT NOT NULL,
            status TEXT NOT NULL, report TEXT NOT NULL, progress TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)), previous_id TEXT REFERENCES weo_runs(id))""",
        "CREATE UNIQUE INDEX one_active_weo ON weo_runs(active) WHERE active=1",
        """CREATE TABLE weo_sources (
            run_id TEXT NOT NULL REFERENCES weo_runs(id), ordinal INTEGER NOT NULL,
            path TEXT NOT NULL, http_status INTEGER NOT NULL, sha256 TEXT NOT NULL REFERENCES originals(sha256),
            PRIMARY KEY(run_id,ordinal))""",
        """CREATE TABLE weo_series (
            run_id TEXT NOT NULL REFERENCES weo_runs(id), country TEXT NOT NULL, indicator TEXT NOT NULL,
            payload TEXT NOT NULL, PRIMARY KEY(run_id,country,indicator))""",
        """CREATE TABLE weo_rows (
            run_id TEXT NOT NULL, country TEXT NOT NULL, indicator TEXT NOT NULL, year INTEGER NOT NULL,
            payload TEXT NOT NULL, PRIMARY KEY(run_id,country,indicator,year),
            FOREIGN KEY(run_id,country,indicator) REFERENCES weo_series(run_id,country,indicator))""",
        """CREATE TRIGGER weo_rows_no_update BEFORE UPDATE ON weo_rows
            BEGIN SELECT RAISE(ABORT, 'WEO observations are immutable'); END""",
        """CREATE TRIGGER weo_rows_no_delete BEFORE DELETE ON weo_rows
            BEGIN SELECT RAISE(ABORT, 'WEO observations are immutable'); END""",
        """CREATE TRIGGER weo_series_no_update BEFORE UPDATE ON weo_series
            BEGIN SELECT RAISE(ABORT, 'WEO series are immutable'); END""",
        """CREATE TRIGGER weo_series_no_delete BEFORE DELETE ON weo_series
            BEGIN SELECT RAISE(ABORT, 'WEO series are immutable'); END""",
        """CREATE TRIGGER weo_sources_no_update BEFORE UPDATE ON weo_sources
            BEGIN SELECT RAISE(ABORT, 'WEO sources are immutable'); END""",
        """CREATE TRIGGER weo_sources_no_delete BEFORE DELETE ON weo_sources
            BEGIN SELECT RAISE(ABORT, 'WEO sources are immutable'); END""",
    ],
}
MIGRATIONS[6] = [statement.replace("weo", "worldbank").replace("WEO", "World Bank") for statement in MIGRATIONS[5]]
MIGRATIONS[7] = [
    """CREATE TABLE fred_runs (
        id TEXT PRIMARY KEY REFERENCES provider_pulls(id), created_at TEXT NOT NULL,
        status TEXT NOT NULL, report TEXT NOT NULL, progress TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)), previous_id TEXT REFERENCES fred_runs(id),
        mode TEXT NOT NULL CHECK(mode IN ('current','historical')), as_of TEXT NOT NULL)""",
    "CREATE UNIQUE INDEX one_active_fred_mode ON fred_runs(mode) WHERE active=1",
    """CREATE TABLE fred_sources (
        run_id TEXT NOT NULL REFERENCES fred_runs(id), ordinal INTEGER NOT NULL, path TEXT NOT NULL,
        http_status INTEGER NOT NULL, sha256 TEXT NOT NULL REFERENCES originals(sha256), PRIMARY KEY(run_id,ordinal))""",
    """CREATE TABLE fred_series (
        run_id TEXT NOT NULL REFERENCES fred_runs(id), series_id TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(run_id,series_id))""",
    """CREATE TABLE fred_rows (
        run_id TEXT NOT NULL, series_id TEXT NOT NULL, date TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(run_id,series_id,date), FOREIGN KEY(run_id,series_id) REFERENCES fred_series(run_id,series_id))""",
    *[f"""CREATE TRIGGER {table}_no_{operation.lower()} BEFORE {operation} ON {table}
        BEGIN SELECT RAISE(ABORT, 'FRED source data are immutable'); END"""
      for table in ("fred_sources", "fred_series", "fred_rows") for operation in ("UPDATE", "DELETE")],
]
MIGRATIONS[8] = [statement.replace("weo", "bis").replace("WEO", "BIS").replace(
    "year INTEGER", "period TEXT").replace(",year)", ",period)") for statement in MIGRATIONS[5]]
MIGRATIONS[9] = [statement.replace("weo", "ids").replace("WEO", "IDS") for statement in MIGRATIONS[5]]
MIGRATIONS[10] = [
    """CREATE TABLE comtrade_runs (
        id TEXT PRIMARY KEY REFERENCES provider_pulls(id), created_at TEXT NOT NULL,
        status TEXT NOT NULL, report TEXT NOT NULL, progress TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)), previous_id TEXT REFERENCES comtrade_runs(id))""",
    "CREATE UNIQUE INDEX one_active_comtrade ON comtrade_runs(active) WHERE active=1",
    """CREATE TABLE comtrade_sources (
        run_id TEXT NOT NULL REFERENCES comtrade_runs(id), ordinal INTEGER NOT NULL, path TEXT NOT NULL,
        http_status INTEGER NOT NULL, sha256 TEXT NOT NULL REFERENCES originals(sha256), retrieved_at TEXT NOT NULL,
        PRIMARY KEY(run_id,ordinal))""",
    """CREATE TABLE comtrade_tasks (
        run_id TEXT NOT NULL REFERENCES comtrade_runs(id), task_key TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('discovery','data')), spec TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','complete')), result TEXT NOT NULL,
        PRIMARY KEY(run_id,task_key))""",
    """CREATE TABLE comtrade_rows (
        run_id TEXT NOT NULL REFERENCES comtrade_runs(id), reporter INTEGER NOT NULL,
        partner INTEGER NOT NULL, flow TEXT NOT NULL CHECK(flow IN ('M','X')), year INTEGER NOT NULL,
        payload TEXT NOT NULL, PRIMARY KEY(run_id,reporter,partner,flow,year))""",
    """CREATE TABLE comtrade_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES comtrade_runs(id), started_at REAL NOT NULL)""",
    "CREATE INDEX comtrade_request_times ON comtrade_requests(started_at)",
    *[f"""CREATE TRIGGER {table}_no_{operation.lower()} BEFORE {operation} ON {table}
        BEGIN SELECT RAISE(ABORT, 'Comtrade verified chunks and source data are immutable'); END"""
      for table in ("comtrade_sources", "comtrade_rows", "comtrade_requests") for operation in ("UPDATE", "DELETE")],
    """CREATE TRIGGER comtrade_tasks_verified_no_update BEFORE UPDATE ON comtrade_tasks WHEN OLD.status='complete'
        BEGIN SELECT RAISE(ABORT, 'Comtrade verified tasks are immutable'); END""",
    """CREATE TRIGGER comtrade_tasks_no_delete BEFORE DELETE ON comtrade_tasks
        BEGIN SELECT RAISE(ABORT, 'Comtrade planned tasks are durable'); END""",
]
MIGRATIONS[11] = [
    """CREATE TABLE gdelt_runs (
        id TEXT PRIMARY KEY REFERENCES provider_pulls(id), created_at TEXT NOT NULL,
        status TEXT NOT NULL, report TEXT NOT NULL, progress TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)), previous_id TEXT REFERENCES gdelt_runs(id))""",
    "CREATE UNIQUE INDEX one_active_gdelt ON gdelt_runs(active) WHERE active=1",
    """CREATE TABLE gdelt_sources (
        run_id TEXT NOT NULL REFERENCES gdelt_runs(id), ordinal INTEGER NOT NULL, path TEXT NOT NULL,
        http_status INTEGER NOT NULL, sha256 TEXT NOT NULL REFERENCES originals(sha256), retrieved_at TEXT NOT NULL,
        PRIMARY KEY(run_id,ordinal))""",
    """CREATE TABLE gdelt_chunks (
        run_id TEXT NOT NULL REFERENCES gdelt_runs(id), interval TEXT NOT NULL,
        row_count INTEGER NOT NULL CHECK(row_count>=0), sha256 TEXT NOT NULL REFERENCES originals(sha256),
        PRIMARY KEY(run_id,interval))""",
    """CREATE TABLE gdelt_rows (
        run_id TEXT NOT NULL REFERENCES gdelt_runs(id), event_id TEXT NOT NULL, interval TEXT NOT NULL,
        country TEXT, event_root TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,event_id))""",
    "CREATE INDEX gdelt_country_root ON gdelt_rows(run_id,country,event_root,interval,event_id)",
    "CREATE INDEX gdelt_intervals ON gdelt_rows(run_id,interval,event_id)",
    *[f"""CREATE TRIGGER {table}_no_{operation.lower()} BEFORE {operation} ON {table}
        BEGIN SELECT RAISE(ABORT, 'GDELT event archives, verified chunks and rows are immutable'); END"""
      for table in ("gdelt_sources", "gdelt_chunks", "gdelt_rows") for operation in ("UPDATE", "DELETE")],
]


MIGRATIONS[12] = [
    """CREATE TABLE acled_runs (
        id TEXT PRIMARY KEY REFERENCES provider_pulls(id), created_at TEXT NOT NULL,
        status TEXT NOT NULL, report TEXT NOT NULL, progress TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)), previous_id TEXT REFERENCES acled_runs(id))""",
    "CREATE UNIQUE INDEX one_active_acled ON acled_runs(active) WHERE active=1",
    """CREATE TABLE acled_sources (
        run_id TEXT NOT NULL REFERENCES acled_runs(id), ordinal INTEGER NOT NULL, path TEXT NOT NULL,
        http_status INTEGER NOT NULL, sha256 TEXT NOT NULL REFERENCES originals(sha256), retrieved_at TEXT NOT NULL,
        PRIMARY KEY(run_id,ordinal))""",
    """CREATE TABLE acled_chunks (
        run_id TEXT NOT NULL REFERENCES acled_runs(id), page INTEGER NOT NULL CHECK(page>0),
        row_count INTEGER NOT NULL CHECK(row_count>=0), sha256 TEXT NOT NULL REFERENCES originals(sha256),
        PRIMARY KEY(run_id,page))""",
    """CREATE TABLE acled_rows (
        run_id TEXT NOT NULL REFERENCES acled_runs(id), event_id TEXT NOT NULL, page INTEGER NOT NULL,
        country TEXT NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,event_id))""",
    "CREATE INDEX acled_country_type ON acled_rows(run_id,country,event_type,event_id)",
    "CREATE INDEX acled_pages ON acled_rows(run_id,page)",
    *[f"""CREATE TRIGGER {table}_no_{operation.lower()} BEFORE {operation} ON {table}
        BEGIN SELECT RAISE(ABORT, 'ACLED originals, verified pages and rows are immutable'); END"""
      for table in ("acled_sources", "acled_chunks", "acled_rows") for operation in ("UPDATE", "DELETE")],
]


class Conflict(ValueError):
    pass


class NotFound(ValueError):
    pass


def connect(path: Path, *, readonly: bool = False) -> sqlite3.Connection:
    uri = path.resolve().as_uri() + "?mode=ro" if readonly else str(path)
    conn = sqlite3.connect(uri, uri=readonly, isolation_level=None, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA trusted_schema=OFF")
    conn.execute("PRAGMA busy_timeout=10000")
    return conn


def migrate(conn: sqlite3.Connection) -> None:
    conn.execute("BEGIN EXCLUSIVE")
    try:
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        if version > DB_VERSION:
            raise Conflict("Database schema is newer than this backend")
        for target in range(version + 1, DB_VERSION + 1):
            for statement in MIGRATIONS[target]:
                conn.execute(statement)
            conn.execute(f"PRAGMA user_version={target}")
        conn.commit()
    except BaseException:
        conn.rollback()
        raise


class DatabaseLock:
    """An advisory process lock; SQLite still provides all data transaction locks."""

    def __init__(self, path: Path):
        self.path = Path(str(path) + ".lock")
        self.handle = None

    def acquire(self) -> None:
        self.handle = self.path.open("a+b")
        try:
            if os.name == "nt":
                import msvcrt
                self.handle.seek(0)
                if not self.handle.read(1):
                    self.handle.write(b"\0")
                    self.handle.flush()
                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.handle.close()
            self.handle = None
            raise Conflict("Database is already open by another backend process") from None

    def release(self) -> None:
        if self.handle:
            self.handle.close()
            self.handle = None


def _run(row: sqlite3.Row) -> Run:
    return Run(
        id=row["id"], status=row["status"], createdAt=row["created_at"],
        source=row["source"], kind=row["kind"], errors=json.loads(row["errors"]),
        datasetId=row["dataset_id"], rowCount=row["row_count"],
    )


def _audit(conn: sqlite3.Connection, event: str, run_id=None, dataset_id=None, **details) -> None:
    conn.execute(
        "INSERT INTO audit(event,created_at,run_id,dataset_id,details) VALUES (?,?,?,?,?)",
        (event, utc_now(), run_id, dataset_id, json.dumps(details)),
    )


def _health(conn: sqlite3.Connection, key: str, status: str, **details) -> None:
    previous = conn.execute("SELECT status,details FROM health WHERE id=?", (key,)).fetchone()
    stable = {k: v for k, v in details.items() if k != "ageDays"}
    old_stable = (
        {k: v for k, v in json.loads(previous["details"]).items() if k != "ageDays"}
        if previous else None
    )
    conn.execute(
        """INSERT INTO health(id,status,checked_at,details) VALUES (?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status,checked_at=excluded.checked_at,details=excluded.details""",
        (key, status, utc_now(), json.dumps(details)),
    )
    if previous is None or previous["status"] != status or old_stable != stable:
        _audit(conn, "data_health_changed", healthId=key, status=status, **stable)


class Store:
    def __init__(self, path: str | Path):
        self.path = Path(path).resolve()
        self.lock = DatabaseLock(self.path)

    def open(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock.acquire()
        try:
            with self.connection() as conn:
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("PRAGMA synchronous=FULL")
                migrate(conn)
                # Staged work is durable, not an interrupted in-memory job.
                with self.transaction(conn):
                    _health(conn, "service", "ok", schemaVersion=DB_VERSION, connectorsActive=False)
                    _audit(conn, "service_started")
                    for row in conn.execute("SELECT id,provider_id FROM provider_pulls WHERE status='running'").fetchall():
                        conn.execute(
                            "UPDATE provider_pulls SET status='interrupted',finished_at=?,report=? WHERE id=?",
                            (utc_now(), json.dumps({"errors": ["Acquisition interrupted by service restart; active data unchanged"]}), row["id"]),
                        )
                        _audit(conn, "provider_interrupted", pullId=row["id"])
                        _health(conn, f"provider:{row['provider_id']}", "error", pullId=row["id"], errorCount=1)
                        conn.execute("UPDATE macro_runs SET status='interrupted',report=? WHERE id=?",
                                     (json.dumps({"errors": ["Acquisition interrupted by service restart; active data unchanged"]}), row["id"]))
                        conn.execute("UPDATE weo_runs SET status='interrupted',report=? WHERE id=?",
                                     (json.dumps({"errors": ["Acquisition interrupted by service restart; active data unchanged"]}), row["id"]))
                        conn.execute("UPDATE worldbank_runs SET status='interrupted',report=? WHERE id=?",
                                     (json.dumps({"errors": ["Acquisition interrupted by service restart; active data unchanged"]}), row["id"]))
                        conn.execute("UPDATE fred_runs SET status='interrupted',report=json_set(report,'$.errors',json(?),'$.transportComplete',json('false')) WHERE id=?",
                                     (json.dumps(["Acquisition interrupted by service restart; active snapshots unchanged"]), row["id"]))
                        conn.execute("UPDATE bis_runs SET status='interrupted',report=? WHERE id=?",
                                     (json.dumps({"errors": ["Acquisition interrupted by service restart; active BIS snapshot unchanged"], "transportComplete": False}), row["id"]))
                        conn.execute("UPDATE ids_runs SET status='interrupted',report=? WHERE id=?",
                                     (json.dumps({"errors": ["Acquisition interrupted by service restart; active IDS snapshot unchanged"], "transportComplete": False}), row["id"]))
                        conn.execute("UPDATE comtrade_runs SET status='interrupted',report=json_set(report,'$.pauseReason',?,'$.transportComplete',json('false')) WHERE id=?",
                                     ("Pass interrupted by service restart; completed chunks retained for explicit resume", row["id"]))
                        conn.execute("UPDATE gdelt_runs SET status='interrupted',report=json_set(report,'$.errors',json(?),'$.transportComplete',json('false')) WHERE id=?",
                                     (json.dumps(["GDELT acquisition interrupted by service restart; incomplete day cannot activate"]), row["id"]))
                        conn.execute("UPDATE acled_runs SET status='interrupted',report=json_set(report,'$.errors',json(?),'$.transportComplete',json('false'),'$.consistencyVerified',json('false')) WHERE id=?",
                                     (json.dumps(["ACLED acquisition interrupted by service restart; incomplete snapshot cannot activate"]), row["id"]))
        except BaseException:
            self.lock.release()
            raise

    def close(self) -> None:
        self.lock.release()

    @contextmanager
    def connection(self):
        conn = connect(self.path)
        try:
            yield conn
        finally:
            conn.close()

    @contextmanager
    def transaction(self, conn: sqlite3.Connection, *, write=True):
        conn.execute("BEGIN IMMEDIATE" if write else "BEGIN")
        try:
            yield
            conn.commit()
        except BaseException:
            conn.rollback()
            raise

    def stage(
        self, *, content: bytes, filename: str, kind: str, source: str, unit: str,
        freshness_days: int | None, sheet: str | None, observations: list[Observation],
        sheets: list[str], errors: list[str], row_count: int,
        provider_pull: tuple[str, dict] | None = None,
    ) -> tuple[Run, list[Observation], list[str]]:
        sha = hashlib.sha256(content).hexdigest()
        if not errors and sheet is None and len(sheets) == 1:
            sheet = sheets[0]
        identity = [1, sha, Path(filename).suffix.lower(), kind, source, unit, freshness_days, sheet]
        fingerprint = hashlib.sha256(json.dumps(identity, separators=(",", ":")).encode()).hexdigest()
        payload = json.dumps([o.model_dump(exclude_none=True) | {"publishedAt": o.publishedAt} for o in observations])
        with self.connection() as conn, self.transaction(conn):
            existing = conn.execute("SELECT * FROM runs WHERE fingerprint=?", (fingerprint,)).fetchone()
            if existing:
                if provider_pull:
                    self._finish_provider_pull(conn, *provider_pull, _run(existing))
                return _run(existing), [Observation(**o) for o in json.loads(existing["preview"])], json.loads(existing["sheets"])
            run_id = str(uuid.uuid4())
            conn.execute("INSERT OR IGNORE INTO originals VALUES (?,?,?)", (sha, content, len(content)))
            conn.execute(
                """INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (run_id, fingerprint, "quarantined" if errors else "staged", utc_now(), source, kind,
                 unit, freshness_days, json.dumps(errors), None, row_count, sha, filename, sheet,
                 json.dumps(sheets), payload),
            )
            _audit(conn, "quarantined" if errors else "staged", run_id, originalSha256=sha)
            _health(conn, "last_import", "error" if errors else "ok", runId=run_id, errorCount=len(errors))
            row = conn.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
            if provider_pull:
                self._finish_provider_pull(conn, *provider_pull, _run(row))
            return _run(row), observations, sheets

    def state(self) -> State:
        with self.connection() as conn, self.transaction(conn, write=False):
            datasets = []
            for row in conn.execute("SELECT * FROM datasets ORDER BY kind,revision"):
                observations = [
                    Observation(**json.loads(r["payload"]))
                    for r in conn.execute(
                        "SELECT payload FROM observations WHERE dataset_id=? ORDER BY ordinal", (row["id"],)
                    )
                ]
                provider_pull = conn.execute("SELECT report FROM provider_pulls WHERE run_id=? AND status='staged'", (row["run_id"],)).fetchone()
                policy = None
                if provider_pull:
                    from .yahoo import session_policy
                    policy = session_policy()
                datasets.append(Dataset(
                    id=row["id"], version=str(row["revision"]), kind=row["kind"], source=row["source"],
                    unit=row["unit"], createdAt=row["created_at"], freshnessDays=row["freshness_days"],
                    observations=observations, active=bool(row["active"]), sessionPolicy=policy,
                    providerReport=json.loads(provider_pull["report"]) if provider_pull else None,
                ))
            from .macro_storage import MacroStore
            from .weo_storage import WeoStore
            from .comtrade_storage import ComtradeStore
            from .gdelt_storage import GdeltStore
            from .acled_storage import AcledStore
            return State(
                datasets=datasets,
                runs=[_run(row) for row in conn.execute("SELECT * FROM runs ORDER BY created_at,id")],
                providers=[self._provider_status(conn, provider) for provider in ("yfinance", "imf", "imf-weo", "worldbank", "fred", "bis", "ids", "comtrade", "gdelt", "acled")],
                macro=MacroStore(self).summaries(conn),
                weo=WeoStore(self).summaries(conn),
                worldbank=WeoStore(self, "worldbank").summaries(conn),
                fred=WeoStore(self, "fred").summaries(conn),
                bis=WeoStore(self, "bis").summaries(conn),
                ids=WeoStore(self, "ids").summaries(conn),
                comtrade=ComtradeStore(self).summaries(conn),
                gdelt=GdeltStore(self).summaries(conn),
                acled=AcledStore(self).summaries(conn),
            )

    def _provider_status(self, conn, provider_id: str = "yfinance") -> dict:
        last = conn.execute("SELECT * FROM provider_pulls WHERE provider_id=? ORDER BY started_at DESC LIMIT 1", (provider_id,)).fetchone()
        latest_valid = conn.execute("SELECT finished_at FROM provider_pulls WHERE provider_id=? AND status='staged' ORDER BY started_at DESC LIMIT 1", (provider_id,)).fetchone()
        return {
            "id": provider_id, "name": {"yfinance": "Yahoo Finance via yfinance", "imf": "Monthly IMF", "imf-weo": "IMF WEO annual research and projections", "worldbank": "World Bank WDI via wbgapi", "fred": "FRED and ALFRED native history", "bis": "BIS quarterly banking and credit", "ids": "World Bank IDS via wbgapi", "comtrade": "UN Comtrade via comtradeapicall", "gdelt": "GDELT 2.0 daily events via gdeltPyR", "acled": "ACLED core events via acled"}[provider_id], "mode": "manual",
            "status": last["status"] if last else "available",
            "lastAttemptAt": last["started_at"] if last else None,
            "lastValidatedAt": latest_valid["finished_at"] if latest_valid else None,
            "errors": json.loads(last["report"]).get("errors", []) if last else [],
        }

    def begin_provider_pull(self, provider_id: str = "yfinance", *, fred_request: dict | None = None) -> str:
        if provider_id not in ("yfinance", "imf", "imf-weo", "worldbank", "fred", "bis", "ids", "comtrade", "gdelt", "acled"):
            raise ValueError("Unknown provider")
        if provider_id == "fred":
            from .fred import MIN_DATE, today, valid_date
            if (not fred_request or set(fred_request) != {"mode", "asOf"} or
                fred_request["mode"] not in ("current", "historical") or
                not MIN_DATE <= valid_date(fred_request["asOf"]) <= today() or
                (fred_request["mode"] == "current" and fred_request["asOf"] != today())):
                raise ValueError("Invalid FRED snapshot request")
        with self.connection() as conn, self.transaction(conn):
            last = conn.execute("SELECT * FROM provider_pulls WHERE provider_id=? ORDER BY started_at DESC LIMIT 1", (provider_id,)).fetchone()
            if last:
                elapsed = (datetime.now(timezone.utc) - datetime.fromisoformat(last["started_at"].replace("Z", "+00:00"))).total_seconds()
                if last["status"] == "running" or elapsed < 60:
                    raise Conflict(f"{provider_id} pull already running or in its 60-second cooldown")
            identifier = str(uuid.uuid4())
            conn.execute("INSERT INTO provider_pulls(id,started_at,status,report,provider_id) VALUES (?,?,'running',?,?)", (identifier, utc_now(), "{}", provider_id))
            if provider_id == "imf":
                conn.execute("INSERT INTO macro_runs(id,created_at,status,report,progress) VALUES (?,?,'running','{}','{}')", (identifier, utc_now()))
            elif provider_id == "imf-weo":
                conn.execute("INSERT INTO weo_runs(id,created_at,status,report,progress) VALUES (?,?,'running','{}','{}')", (identifier, utc_now()))
            elif provider_id == "worldbank":
                conn.execute("INSERT INTO worldbank_runs(id,created_at,status,report,progress) VALUES (?,?,'running','{}','{}')", (identifier, utc_now()))
            elif provider_id == "fred":
                conn.execute("INSERT INTO fred_runs(id,created_at,status,report,progress,mode,as_of) VALUES (?,?,'running',?,'{}',?,?)",
                             (identifier, utc_now(), json.dumps(fred_request), fred_request["mode"], fred_request["asOf"]))
            elif provider_id == "bis":
                conn.execute("INSERT INTO bis_runs(id,created_at,status,report,progress) VALUES (?,?,'running','{}','{}')", (identifier, utc_now()))
            elif provider_id == "ids":
                conn.execute("INSERT INTO ids_runs(id,created_at,status,report,progress) VALUES (?,?,'running','{}','{}')", (identifier, utc_now()))
            elif provider_id == "comtrade":
                conn.execute("INSERT INTO comtrade_runs(id,created_at,status,report,progress) VALUES (?,?,'running','{}','{}')", (identifier, utc_now()))
            elif provider_id == "gdelt":
                conn.execute("INSERT INTO gdelt_runs(id,created_at,status,report,progress) VALUES (?,?,'running','{}','{}')", (identifier, utc_now()))
            elif provider_id == "acled":
                conn.execute("INSERT INTO acled_runs(id,created_at,status,report,progress) VALUES (?,?,'running','{}','{}')", (identifier, utc_now()))
            _audit(conn, "provider_started", pullId=identifier, provider=provider_id)
            _health(conn, f"provider:{provider_id}", "unknown", pullId=identifier, phase="running")
            return identifier

    def finish_provider_pull(self, identifier: str, run: Run | None, report: dict) -> None:
        with self.connection() as conn, self.transaction(conn):
            self._finish_provider_pull(conn, identifier, report, run)

    def _finish_provider_pull(self, conn, identifier: str, report: dict, run: Run | None) -> None:
        status = ("quarantined" if run.status == "quarantined" else "staged") if run else "interrupted"
        updated = conn.execute(
            "UPDATE provider_pulls SET status=?,run_id=?,finished_at=?,report=? WHERE id=? AND status='running'",
            (status, run.id if run else None, utc_now(), json.dumps(report, allow_nan=False), identifier),
        )
        if updated.rowcount != 1:
            raise Conflict("Provider job is no longer running")
        _audit(conn, f"provider_{status}", run.id if run else None, pullId=identifier)
        _health(conn, "provider:yfinance", "error" if report.get("errors") else "ok",
                pullId=identifier, errorCount=len(report.get("errors", [])))

    def run_metadata(self, run_id: str) -> dict:
        with self.connection() as conn:
            row = conn.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                raise NotFound("Import run not found")
            provider = conn.execute("SELECT report FROM provider_pulls WHERE run_id=?", (run_id,)).fetchone()
            return {
                "runId": run_id, "originalSha256": row["original_sha"], "filename": row["filename"],
                "retrievedAt": row["created_at"], "providerReport": json.loads(provider["report"]) if provider else None,
            }

    def preview(self, run_id: str) -> ImportPreview:
        with self.connection() as conn:
            row = conn.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                raise NotFound("Import run not found")
            return ImportPreview(
                run=_run(row), preview=[Observation(**o) for o in json.loads(row["preview"])],
                sheets=json.loads(row["sheets"]), providerReport=self.run_metadata(run_id)["providerReport"],
            )

    def original(self, run_id: str) -> bytes:
        with self.connection() as conn:
            row = conn.execute("SELECT o.content FROM originals o JOIN runs r ON r.original_sha=o.sha256 WHERE r.id=?", (run_id,)).fetchone()
            if not row:
                raise NotFound("Import run not found")
            return row["content"]

    def commit(self, run_id: str) -> None:
        self._validate_pending_overlay(run_id)
        with self.connection() as conn, self.transaction(conn):
            run = conn.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
            if not run:
                raise NotFound("Import run not found")
            if run["status"] == "committed":
                return
            if run["status"] != "staged":
                raise Conflict("Only a valid staged batch can be committed")
            observations = json.loads(run["preview"])
            dataset_id = str(uuid.uuid4())
            previous = conn.execute("SELECT id FROM datasets WHERE kind=? AND active=1", (run["kind"],)).fetchone()
            revision = conn.execute(
                "SELECT COALESCE(MAX(revision),0)+1 FROM datasets WHERE kind=?", (run["kind"],)
            ).fetchone()[0]
            conn.execute("UPDATE datasets SET active=0 WHERE kind=? AND active=1", (run["kind"],))
            conn.execute(
                "INSERT INTO datasets VALUES (?,?,?,?,?,?,?,?,?,?)",
                (dataset_id, run_id, revision, run["kind"], run["source"], run["unit"], utc_now(),
                 run["freshness_days"], 1, previous["id"] if previous else None),
            )
            for ordinal, observation in enumerate(observations):
                key = (
                    [observation["country"], observation["year"]] if run["kind"] == "annual"
                    else [observation["symbol"], observation["observedAt"]]
                )
                conn.execute(
                    "INSERT INTO observations VALUES (?,?,?,?)",
                    (dataset_id, ordinal, json.dumps(key), json.dumps(observation)),
                )
            conn.execute("UPDATE runs SET status='committed',dataset_id=? WHERE id=?", (dataset_id, run_id))
            _audit(conn, "committed", run_id, dataset_id, previousDatasetId=previous["id"] if previous else None)
            _health(conn, f"dataset:{dataset_id}", "unknown", rowCount=len(observations))

    def _validate_pending_overlay(self, run_id: str) -> None:
        errors = []
        with self.connection() as conn, self.transaction(conn):
            run = conn.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
            if run and run["status"] == "staged" and run["kind"] == "annual":
                try:
                    validate_annual_overlay([Observation(**o) for o in json.loads(run["preview"])])
                except BatchError as exc:
                    errors = exc.errors
                    conn.execute("UPDATE runs SET status='quarantined',errors=? WHERE id=?", (json.dumps(errors), run_id))
                    _audit(conn, "quarantined", run_id, reason="annual_overlay_changed")
                    _health(conn, "last_import", "error", runId=run_id, errorCount=len(errors))
        if errors:
            raise Conflict("Annual overlay no longer validates against the bundled history; run quarantined")

    def activate(self, dataset_id: str) -> None:
        with self.connection() as conn, self.transaction(conn):
            dataset = conn.execute(
                """SELECT d.*,r.status FROM datasets d JOIN runs r ON r.id=d.run_id WHERE d.id=?""",
                (dataset_id,),
            ).fetchone()
            if not dataset:
                raise NotFound("Dataset not found")
            if dataset["status"] != "committed":
                raise Conflict("A rolled back dataset cannot be activated")
            if dataset["kind"] == "annual":
                observations = [
                    Observation(**json.loads(r[0]))
                    for r in conn.execute("SELECT payload FROM observations WHERE dataset_id=?", (dataset_id,))
                ]
                try:
                    validate_annual_overlay(observations)
                except BatchError:
                    raise Conflict("Annual overlay cannot be activated against the bundled history") from None
            if dataset["active"]:
                return
            conn.execute("UPDATE datasets SET active=0 WHERE kind=? AND active=1", (dataset["kind"],))
            conn.execute("UPDATE datasets SET active=1 WHERE id=?", (dataset_id,))
            _audit(conn, "activated", dataset["run_id"], dataset_id)

    def record_failure(self, run_id: str) -> None:
        with self.connection() as conn, self.transaction(conn):
            row = conn.execute("SELECT status FROM runs WHERE id=?", (run_id,)).fetchone()
            if row and row["status"] == "staged":
                conn.execute(
                    "UPDATE runs SET status='interrupted',errors=? WHERE id=?",
                    (json.dumps(["Commit failed; no dataset changes were applied"]), run_id),
                )
                _audit(conn, "interrupted", run_id)
                _health(conn, "last_import", "error", runId=run_id, errorCount=1)

    def rollback(self, dataset_id: str) -> None:
        with self.connection() as conn, self.transaction(conn):
            dataset = conn.execute(
                "SELECT d.*,r.status FROM datasets d JOIN runs r ON r.id=d.run_id WHERE d.id=?",
                (dataset_id,),
            ).fetchone()
            if not dataset:
                raise NotFound("Dataset not found")
            if dataset["status"] == "rolled_back":
                return
            replacement = dataset["previous_id"]
            while replacement:
                candidate = conn.execute(
                    "SELECT d.previous_id,r.status FROM datasets d JOIN runs r ON r.id=d.run_id WHERE d.id=?",
                    (replacement,),
                ).fetchone()
                if candidate["status"] == "committed":
                    break
                replacement = candidate["previous_id"]
            conn.execute("UPDATE datasets SET active=0 WHERE id=?", (dataset_id,))
            if dataset["active"] and replacement:
                conn.execute("UPDATE datasets SET active=1 WHERE id=?", (replacement,))
            conn.execute("UPDATE runs SET status='rolled_back' WHERE id=?", (dataset["run_id"],))
            _audit(conn, "rolled_back", dataset["run_id"], dataset_id,
                   restoredDatasetId=replacement if dataset["active"] else None)

    def metadata(self, dataset_id: str) -> dict:
        with self.connection() as conn:
            row = conn.execute(
                """SELECT r.* FROM runs r JOIN datasets d ON d.run_id=r.id WHERE d.id=?""", (dataset_id,)
            ).fetchone()
            if not row:
                raise NotFound("Dataset not found")
            publications = [o.get("publishedAt") for o in json.loads(row["preview"])]
            return {
                "datasetId": dataset_id, "retrievedAt": row["created_at"],
                "source": row["source"], "originalSha256": row["original_sha"],
                "filename": row["filename"], "sheet": row["sheet"],
                "vintageAsOf": max((v for v in publications if v), default=None),
                "publicationDatesComplete": all(v is not None for v in publications),
                "providerReport": self.run_metadata(row["id"])["providerReport"],
            }

    def health(self) -> dict:
        with self.connection() as conn, self.transaction(conn):
            for row in conn.execute("SELECT * FROM datasets"):
                payloads = [
                    json.loads(r[0]) for r in conn.execute(
                        "SELECT payload FROM observations WHERE dataset_id=?", (row["id"],)
                    )
                ]
                series_latest: dict[str, str] = {}
                for observation in payloads:
                    if row["kind"] == "market":
                        series = observation["symbol"]
                        observed = observation["observedAt"]
                    else:
                        series = observation["country"]
                        # Observation-period freshness, not an inferred publication date.
                        observed = f"{observation['year']:04d}-12-31T23:59:59Z"
                    series_latest[series] = max(series_latest.get(series, observed), observed)
                latest = max(series_latest.values(), default=None)
                oldest_latest = min(series_latest.values(), default=None)
                age = None
                if oldest_latest:
                    parsed = datetime.fromisoformat(oldest_latest.replace("Z", "+00:00"))
                    age = max(0, (datetime.now(timezone.utc) - parsed).total_seconds() / 86400)
                status = "unknown"
                if row["freshness_days"] is not None and age is not None:
                    status = "stale" if age > row["freshness_days"] else "fresh"
                provider = conn.execute("SELECT id FROM provider_pulls WHERE run_id=? AND status='staged'", (row["run_id"],)).fetchone()
                policy = None
                if provider:
                    from .yahoo import session_policy
                    policy = session_policy()
                    status = "fresh" if all(observed == policy["expectedCloseAt"] for observed in series_latest.values()) else "stale"
                _health(
                    conn, f"dataset:{row['id']}", status, latestObservationAt=latest,
                    oldestLatestObservationAt=oldest_latest, seriesLatestObservationAt=series_latest,
                    ageDays=age, freshnessDays=row["freshness_days"], active=bool(row["active"]),
                    rowCount=len(payloads),
                    sessionPolicy={key: value for key, value in policy.items() if key != "checkedAt"} if policy else None,
                )
            result = [
                {"id": row["id"], "status": row["status"], "checkedAt": row["checked_at"],
                 "details": json.loads(row["details"])}
                for row in conn.execute("SELECT * FROM health ORDER BY id")
            ]
            return {"status": "ok", "connectorsActive": False, "observations": result}

    def audit(self) -> list[dict]:
        with self.connection() as conn:
            return [
                {"sequence": row["sequence"], "event": row["event"], "createdAt": row["created_at"],
                 "runId": row["run_id"], "datasetId": row["dataset_id"], "details": json.loads(row["details"])}
                for row in conn.execute("SELECT * FROM audit ORDER BY sequence")
            ]

    def snapshot(self) -> bytes:
        with self.connection() as source:
            destination = sqlite3.connect(":memory:")
            try:
                source.backup(destination)
                return destination.serialize()
            finally:
                destination.close()


def verify_backup(path: Path) -> None:
    conn = connect(path, readonly=True)
    try:
        if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise Conflict("Backup integrity check failed")
        if conn.execute("PRAGMA foreign_key_check").fetchall():
            raise Conflict("Backup foreign key check failed")
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        if not 1 <= version <= DB_VERSION:
            raise Conflict("Backup schema is not supported")
        required = {"originals", "runs", "datasets", "observations", "audit"}
        if version >= 5:
            required.update({"provider_pulls", "weo_runs", "weo_sources", "weo_series", "weo_rows"})
        if version >= 6:
            required.update({"worldbank_runs", "worldbank_sources", "worldbank_series", "worldbank_rows"})
        if version >= 7:
            required.update({"fred_runs", "fred_sources", "fred_series", "fred_rows"})
        if version >= 8:
            required.update({"bis_runs", "bis_sources", "bis_series", "bis_rows"})
        if version >= 9:
            required.update({"ids_runs", "ids_sources", "ids_series", "ids_rows"})
        if version >= 10:
            required.update({"comtrade_runs", "comtrade_sources", "comtrade_tasks", "comtrade_rows", "comtrade_requests"})
        if version >= 11:
            required.update({"gdelt_runs", "gdelt_sources", "gdelt_chunks", "gdelt_rows"})
        if version >= 12:
            required.update({"acled_runs", "acled_sources", "acled_chunks", "acled_rows"})
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not required.issubset(tables):
            raise Conflict("Backup is not a research database")
        for row in conn.execute("SELECT sha256,content FROM originals"):
            if hashlib.sha256(row["content"]).hexdigest() != row["sha256"]:
                raise Conflict("Original upload checksum mismatch")
    finally:
        conn.close()


def write_snapshot(source: Path, target: Path) -> None:
    if not source.is_file():
        raise NotFound("Source database does not exist")
    with target.open("xb") as output:
        try:
            output.write(Store(source).snapshot())
            output.flush()
            os.fsync(output.fileno())
        except BaseException:
            target.unlink(missing_ok=True)
            raise
    verify_backup(target)


def restore_backup(source: Path, target: Path, *, offline: bool) -> None:
    if not offline:
        raise Conflict("Restore requires explicit --offline acknowledgement")
    if target.exists():
        raise Conflict("Restore never overwrites an existing target")
    verify_backup(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    lock = DatabaseLock(target)
    lock.acquire()
    try:
        # Snapshotting also folds any backup WAL into the new standalone file.
        write_snapshot(source, target)
    finally:
        lock.release()
