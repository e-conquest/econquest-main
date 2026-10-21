"""Loopback-only research API with explicit manual Yahoo and IMF connectors."""

import json
import hashlib
import logging
import os
import secrets
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event, Lock
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartParser
from starlette.concurrency import run_in_threadpool

from .models import ImportPreview, Observation, State
from .imf import AcquisitionError
from .storage import Conflict, NotFound, Store
from .validation import MAX_UPLOAD, BatchError, parse_file, utc_now

SESSION_TOKEN = secrets.token_urlsafe(32)
DEV_ORIGINS = [
    f"http://{host}:{port}" for host in ("localhost", "127.0.0.1", "[::1]") for port in (5173, 4179)
]
MAX_BODY = MAX_UPLOAD + 64 * 1024
MultiPartParser.spool_max_size = MAX_BODY
logger = logging.getLogger("research.backend")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
logger.setLevel(logging.INFO)
logger.propagate = False


def log_event(event: str, **details) -> None:
    logger.info(json.dumps({"event": event, **details}, separators=(",", ":")))


def _loopback_authority(authority: str) -> bool:
    try:
        url = urlsplit("//" + authority)
        return (
            url.hostname in {"localhost", "127.0.0.1", "::1"}
            and url.username is None and url.password is None
            and not url.path and not url.query and not url.fragment
            and (url.port is None or 1 <= url.port <= 65535)
        )
    except ValueError:
        return False


class LocalGuard:
    def __init__(self, app, allowed_origins):
        self.app = app
        self.allowed_origins = allowed_origins

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        started = False

        async def guarded_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                if scope["path"].startswith(("/api/macro/", "/api/weo/", "/api/worldbank/", "/api/fred/", "/api/providers/fred", "/api/bis/", "/api/providers/bis", "/api/ids/", "/api/providers/ids", "/api/comtrade/", "/api/providers/comtrade", "/api/gdelt/", "/api/providers/gdelt", "/api/acled/", "/api/providers/acled")):
                    message.setdefault("headers", []).append((b"cache-control", b"no-store"))
                started = True
            await send(message)

        try:
            return await self._handle(scope, receive, guarded_send)
        except Exception as exc:
            # Do not rethrow to uvicorn's traceback/access logger with input details.
            log_event("request_failed", errorType=type(exc).__name__)
            if not started:
                return await JSONResponse(
                    {"detail": "Local operation failed; no partial import was committed"}, status_code=500
                )(scope, receive, send)
            await send({"type": "http.response.body", "body": b"", "more_body": False})

    async def _handle(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = {}
        for key, value in scope["headers"]:
            headers.setdefault(key.lower(), []).append(value.decode("latin-1"))
        host_values = headers.get(b"host", [])
        host = host_values[0] if len(host_values) == 1 else ""
        origin_values = headers.get(b"origin", [])
        origin = origin_values[0] if len(origin_values) == 1 else None

        async def reject(status, detail):
            response = JSONResponse({"detail": detail}, status_code=status)
            await response(scope, receive, send)

        if not _loopback_authority(host):
            return await reject(403, "Only literal loopback hosts are allowed")
        same_origin = f"{scope.get('scheme', 'http')}://{host}"
        if len(origin_values) > 1 or (origin is not None and origin not in [same_origin, *self.allowed_origins]):
            return await reject(403, "Origin is not allowed")
        method = scope["method"]
        if method not in {"GET", "HEAD", "OPTIONS"}:
            supplied = headers.get(b"x-research-token", [])
            if len(supplied) != 1 or not secrets.compare_digest(
                supplied[0].encode("latin-1"), SESSION_TOKEN.encode("ascii")
            ):
                return await reject(403, "A valid X-Research-Token is required")
        if (scope["path"] in {"/api/imports", "/api/providers/yfinance/pull", "/api/providers/imf/pull", "/api/providers/imf-weo/pull", "/api/providers/worldbank/pull", "/api/providers/fred/pull", "/api/providers/bis/pull", "/api/providers/ids/pull", "/api/providers/gdelt/pull", "/api/providers/acled/pull"} or scope["path"].startswith("/api/providers/comtrade/")) and method == "POST":
            body_limit = MAX_BODY if scope["path"] == "/api/imports" else 1024
            lengths = headers.get(b"content-length", [])
            try:
                if lengths and (len(lengths) != 1 or int(lengths[0]) > body_limit or int(lengths[0]) < 0):
                    return await reject(413, "Request exceeds the upload limit")
            except ValueError:
                return await reject(400, "Invalid Content-Length")
            parts = []
            total = 0
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                total += len(message.get("body", b""))
                if total > body_limit:
                    return await reject(413, "Request exceeds the upload limit")
                parts.append(message.get("body", b""))
                if not message.get("more_body", False):
                    break
            body = b"".join(parts)
            sent = False

            async def replay():
                nonlocal sent
                if not sent:
                    sent = True
                    return {"type": "http.request", "body": body, "more_body": False}
                return await receive()

            return await self.app(scope, replay, send)
        return await self.app(scope, receive, send)


def _field(form, name: str, *, required=True, limit=200) -> str | None:
    values = form.getlist(name)
    if not values and not required:
        return None
    if len(values) != 1 or not isinstance(values[0], str):
        raise HTTPException(422, f"{name} must be supplied exactly once")
    value = values[0].strip()
    if not value and not required:
        return None
    if not value or len(value) > limit or any(ord(c) < 32 for c in value):
        raise HTTPException(422, f"{name} is missing or invalid")
    return value


def create_app(db_path: str | Path | None = None, dist_path: str | Path | None = None) -> FastAPI:
    path = db_path or os.environ.get("ECONQUEST_DB_PATH") or Path(__file__).parent.parent / "research-data" / "research.sqlite3"
    store = Store(path)
    from .macro_storage import MacroStore
    macro = MacroStore(store)
    from .weo_storage import WeoStore
    weo = WeoStore(store)
    worldbank = WeoStore(store, "worldbank")
    ids = WeoStore(store, "ids")
    from .fred_storage import FredStore
    fred = FredStore(store)
    from .bis_storage import BisStore
    bis = BisStore(store)
    from .comtrade_storage import ComtradeStore
    comtrade = ComtradeStore(store)
    from .gdelt_storage import GdeltStore
    gdelt = GdeltStore(store)
    from .acled_storage import AcledStore
    acled = AcledStore(store)
    stop_events: dict[str, Event] = {}
    comtrade_events_lock = Lock()
    configured = os.environ.get("ECONQUEST_ALLOWED_ORIGINS")
    allowed_origins = [o.strip() for o in configured.split(",") if o.strip()] if configured else DEV_ORIGINS
    for origin in allowed_origins:
        parsed = urlsplit(origin)
        if parsed.scheme not in {"http", "https"} or not _loopback_authority(parsed.netloc) or parsed.path or parsed.query or parsed.fragment:
            raise ValueError("ECONQUEST_ALLOWED_ORIGINS must contain only explicit loopback origins")

    @asynccontextmanager
    async def lifespan(app):
        await run_in_threadpool(store.open)
        app.state.store = store
        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="imf-manual")
        app.state.imf_executor = executor
        weo_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="weo-manual")
        app.state.weo_executor = weo_executor
        wb_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="worldbank-manual")
        app.state.worldbank_executor = wb_executor
        ids_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ids-manual")
        app.state.ids_executor = ids_executor
        fred_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="fred-manual")
        app.state.fred_executor = fred_executor
        bis_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bis-manual")
        app.state.bis_executor = bis_executor
        comtrade_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="comtrade-manual")
        app.state.comtrade_executor = comtrade_executor
        gdelt_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="gdelt-manual")
        app.state.gdelt_executor = gdelt_executor
        acled_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="acled-manual")
        app.state.acled_executor = acled_executor
        try:
            yield
        finally:
            for stop in list(stop_events.values()):
                stop.set()
            await run_in_threadpool(executor.shutdown, wait=True)
            await run_in_threadpool(weo_executor.shutdown, wait=True)
            await run_in_threadpool(wb_executor.shutdown, wait=True)
            await run_in_threadpool(ids_executor.shutdown, wait=True)
            await run_in_threadpool(fred_executor.shutdown, wait=True)
            await run_in_threadpool(bis_executor.shutdown, wait=True)
            await run_in_threadpool(comtrade_executor.shutdown, wait=True)
            await run_in_threadpool(gdelt_executor.shutdown, wait=True)
            await run_in_threadpool(acled_executor.shutdown, wait=True)
            await run_in_threadpool(store.close)

    app = FastAPI(title="Local research data", version="1", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware, allow_origins=allowed_origins, allow_methods=["GET", "POST"],
        allow_headers=["X-Research-Token", "Content-Type"], allow_credentials=False,
    )
    app.add_middleware(LocalGuard, allowed_origins=allowed_origins)

    @app.exception_handler(Conflict)
    async def conflict(_request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(NotFound)
    async def not_found(_request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=404)

    @app.get("/api/session")
    def session():
        return JSONResponse({"token": SESSION_TOKEN}, headers={"Cache-Control": "no-store"})

    @app.get("/api/state", response_model=State, response_model_exclude_none=True)
    def state():
        return _state(store)

    @app.post("/api/imports", response_model=ImportPreview, response_model_exclude_none=True)
    async def stage(request: Request):
        try:
            form = await request.form(max_files=1, max_fields=6, max_part_size=MAX_BODY)
        except Exception:
            raise HTTPException(400, "Invalid multipart upload") from None
        try:
            if set(form.keys()) - {"file", "kind", "source", "unit", "freshnessDays", "sheet"}:
                raise HTTPException(422, "Unexpected multipart fields")
            files = form.getlist("file")
            if len(files) != 1 or not isinstance(files[0], UploadFile):
                raise HTTPException(422, "A single file is required")
            upload = files[0]
            kind = _field(form, "kind")
            if kind not in {"annual", "market"}:
                raise HTTPException(422, "kind must be annual or market")
            source = _field(form, "source")
            unit = _field(form, "unit", limit=80)
            freshness = _field(form, "freshnessDays", required=False, limit=8)
            if freshness is not None and (not freshness.isascii() or not freshness.isdecimal() or int(freshness) > 36500):
                raise HTTPException(422, "freshnessDays must be an integer between 0 and 36500")
            freshness_days = int(freshness) if freshness is not None else None
            sheet = _field(form, "sheet", required=False, limit=128)
            content = await upload.read(MAX_BODY)
            filename = (upload.filename or "upload").replace("\\", "/").rsplit("/", 1)[-1][:255]
        finally:
            await form.close()
        try:
            observations, sheets = await run_in_threadpool(parse_file, content, filename, kind, unit, sheet)
            errors = []
            row_count = len(observations)
        except BatchError as exc:
            observations, sheets, errors, row_count = [], exc.sheets, exc.errors, exc.row_count
        run, observations, sheets = await run_in_threadpool(
            store.stage, content=content, filename=filename, kind=kind, source=source, unit=unit,
            freshness_days=freshness_days, sheet=sheet, observations=observations,
            sheets=sheets, errors=errors, row_count=row_count,
        )
        log_event("import_staged", runId=run.id, status=run.status, rowCount=run.rowCount)
        return _preview(ImportPreview(run=run, preview=observations, sheets=sheets))

    @app.post("/api/imports/{run_id}/commit", response_model=State, response_model_exclude_none=True)
    def commit(run_id: str):
        try:
            store.commit(run_id)
        except (NotFound, Conflict):
            raise
        except Exception:
            store.record_failure(run_id)
            raise
        log_event("import_committed", runId=run_id)
        store.health()
        return _state(store)

    @app.get("/api/imports/{run_id}/metadata")
    def import_metadata(run_id: str):
        return store.run_metadata(run_id)

    @app.get("/api/imports/{run_id}/preview")
    def import_preview(run_id: str):
        return _preview(store.preview(run_id))

    @app.get("/api/imports/{run_id}/original")
    def import_original(run_id: str):
        return Response(store.original(run_id), media_type="application/octet-stream",
                        headers={"Content-Disposition": 'attachment; filename="research-source-snapshot.bin"', "Cache-Control": "no-store"})

    @app.post("/api/providers/yfinance/pull")
    def yahoo_pull(consent: dict):
        if set(consent) != {"personalUse"} or consent["personalUse"] is not True:
            raise HTTPException(422, "Confirm local personal research use with personalUse: true; no arbitrary URLs/tickers are accepted")
        from . import yahoo

        identifier = store.begin_provider_pull()
        started_at = utc_now()
        try:
            result = yahoo.pull()
            snapshot = result["snapshot"]
            snapshot.setdefault("startedAt", started_at)
            snapshot.setdefault("retrievedAt", utc_now())
            errors = snapshot.get("errors", [])
            observations = [Observation(**row) for row in result["observations"]]
            if not errors and (len(observations) < 4000 or {row.symbol for row in observations} != set(yahoo.SYMBOLS)):
                errors = ["Yahoo returned incomplete five-year coverage; no data activated"]
                snapshot["errors"] = errors
                observations = []
            content = json.dumps(snapshot, allow_nan=False, separators=(",", ":")).encode()
            if len(content) > MAX_UPLOAD:
                raise ValueError("Yahoo snapshot exceeds storage budget")
            report = {key: value for key, value in snapshot.items() if key != "symbols"}
            report["pullId"] = identifier
            report["originalSha256"] = hashlib.sha256(content).hexdigest()
            run, rows, sheets = store.stage(
                content=content, filename="yfinance-library-snapshot.json", kind="market",
                source=yahoo.SOURCE, unit=yahoo.UNIT, freshness_days=None, sheet=None,
                observations=observations if not errors else [], sheets=[], errors=errors,
                row_count=sum(item.get("rows", 0) for item in report.get("summaries", [])),
                provider_pull=(identifier, report),
            )
        except Exception:
            store.finish_provider_pull(identifier, None, {"errors": ["Yahoo acquisition could not be staged; active data unchanged"]})
            raise
        log_event("provider_pull_finished", pullId=identifier, runId=run.id, status=run.status, rowCount=run.rowCount)
        return _preview(ImportPreview(run=run, preview=rows, sheets=sheets, providerReport=report))

    def run_imf(identifier: str, stop: Event) -> None:
        try:
            from .imf import Downloader, acquire
            downloader = Downloader(stop, lambda path, status, content: macro.source(identifier, path, status, content),
                                    lambda progress: macro.progress(identifier, progress))
            result = acquire(downloader.get, lambda progress: macro.progress(identifier, progress))
            downloader.check()
            result["report"]["transportComplete"] = True
            macro.complete(identifier, result)
            log_event("imf_acquisition_finished", macroRunId=identifier, rowCount=len(result["records"]), errorCount=len(result["report"]["errors"]))
        except AcquisitionError as exc:
            log_event("imf_acquisition_failed", macroRunId=identifier, errorType=type(exc).__name__)
            try:
                macro.fail(identifier, str(exc))
            except Exception as failure:
                log_event("imf_failure_persistence_failed", macroRunId=identifier, errorType=type(failure).__name__)
                raise
        except Exception as exc:
            log_event("imf_acquisition_failed", macroRunId=identifier, errorType=type(exc).__name__)
            try:
                macro.fail(identifier, f"IMF processing failed ({type(exc).__name__}); active data unchanged")
            except Exception as failure:
                log_event("imf_failure_persistence_failed", macroRunId=identifier, errorType=type(failure).__name__)
                raise
        finally:
            stop_events.pop(identifier, None)

    @app.get("/api/providers/imf/config")
    def imf_config():
        from .imf import CONTRACT, COVERAGE_POLICY
        return JSONResponse({"contractVersion": CONTRACT, "coveragePolicy": COVERAGE_POLICY},
                            headers={"Cache-Control": "no-store"})

    @app.post("/api/providers/imf/pull", status_code=202)
    def imf_pull(consent: dict):
        if set(consent) != {"researchUse"} or consent["researchUse"] is not True:
            raise HTTPException(422, "Confirm researchUse: true; IMF queries are fixed by the verified contract")
        identifier = store.begin_provider_pull("imf")
        stop = Event()
        stop_events[identifier] = stop
        try:
            app.state.imf_executor.submit(run_imf, identifier, stop)
        except RuntimeError:
            stop_events.pop(identifier, None)
            macro.fail(identifier, "IMF worker unavailable; active data unchanged")
            raise
        return macro.get(identifier)

    @app.post("/api/providers/imf/{run_id}/cancel")
    def cancel_imf(run_id: str):
        run = macro.get(run_id)
        stop = stop_events.get(run_id)
        if run["status"] != "running" or stop is None:
            raise Conflict("IMF acquisition is not running")
        stop.set()
        return {"status": "cancellation_requested", "id": run_id}

    @app.get("/api/macro/{run_id}")
    def macro_run(run_id: str):
        return macro.get(run_id)

    @app.get("/api/macro/{run_id}/coverage")
    def macro_coverage(run_id: str, country: str = "", indicator: str = "",
                       offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=500)):
        return macro.page(run_id, coverage=True, country=country, indicator=indicator, offset=offset, limit=limit)

    @app.get("/api/macro/{run_id}/observations")
    def macro_observations(run_id: str, country: str, indicator: str,
                           offset: int = Query(0, ge=0), limit: int = Query(240, ge=1, le=500)):
        return macro.page(run_id, coverage=False, country=country, indicator=indicator, offset=offset, limit=limit)

    @app.get("/api/macro/{run_id}/sources/{ordinal}")
    def macro_original(run_id: str, ordinal: int):
        return Response(macro.original(run_id, ordinal), media_type="application/octet-stream",
                        headers={"Content-Disposition": 'attachment; filename="imf-source-response.bin"', "Cache-Control": "no-store"})

    @app.get("/api/macro/{run_id}/export")
    def macro_export(run_id: str):
        macro.get(run_id)
        return StreamingResponse(macro.export(run_id), media_type="application/x-ndjson",
                                 headers={"Content-Disposition": 'attachment; filename="imf-native-history.ndjson"', "Cache-Control": "no-store"})

    @app.post("/api/macro/{run_id}/commit")
    def macro_commit(run_id: str):
        macro.activate(run_id)
        return _state(store)

    @app.post("/api/macro/{run_id}/rollback")
    def macro_rollback(run_id: str):
        macro.rollback(run_id)
        return _state(store)

    def run_weo(identifier: str, stop: Event) -> None:
        try:
            from .imf import Downloader
            from .weo import acquire
            downloader = Downloader(stop, lambda path, status, content: weo.source(identifier, path, status, content),
                                    lambda details: weo.progress(identifier, details))
            result = acquire(downloader.get, lambda details: weo.progress(identifier, details))
            downloader.check()
            weo.complete(identifier, result)
            log_event("weo_acquisition_finished", weoRunId=identifier, rowCount=result["report"]["rowCount"], absentPairs=result["report"]["absentPairs"])
        except Exception as exc:
            log_event("weo_acquisition_failed", weoRunId=identifier, errorType=type(exc).__name__)
            try:
                weo.fail(identifier, str(exc) if isinstance(exc, AcquisitionError) else
                         f"WEO processing failed ({type(exc).__name__}); active release unchanged")
            except Exception as failure:
                log_event("weo_failure_persistence_failed", weoRunId=identifier, errorType=type(failure).__name__)
                raise
        finally:
            stop_events.pop(identifier, None)

    @app.post("/api/providers/imf-weo/pull", status_code=202)
    def weo_pull(consent: dict):
        if set(consent) != {"researchUse"} or consent["researchUse"] is not True:
            raise HTTPException(422, "Confirm researchUse: true; fixed latest-release WEO query only")
        identifier = store.begin_provider_pull("imf-weo")
        stop = Event()
        stop_events[identifier] = stop
        try:
            app.state.weo_executor.submit(run_weo, identifier, stop)
        except RuntimeError:
            stop_events.pop(identifier, None)
            weo.fail(identifier, "WEO worker unavailable; active release unchanged")
            raise
        return weo.get(identifier)

    @app.post("/api/providers/imf-weo/{run_id}/cancel")
    def weo_cancel(run_id: str):
        run = weo.get(run_id)
        stop = stop_events.get(run_id)
        if run["status"] != "running" or stop is None:
            raise Conflict("WEO acquisition is not running")
        stop.set()
        return {"status": "cancellation_requested", "id": run_id}

    @app.get("/api/weo/{run_id}")
    def weo_manifest(run_id: str):
        return weo.get(run_id)

    @app.get("/api/weo/{run_id}/coverage")
    def weo_coverage(run_id: str, country: str = "", indicator: str = "",
                     offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=500)):
        return weo.page(run_id, coverage=True, country=country, indicator=indicator, offset=offset, limit=limit)

    @app.get("/api/weo/{run_id}/observations")
    def weo_observations(run_id: str, country: str, indicator: str,
                         offset: int = Query(0, ge=0), limit: int = Query(400, ge=1, le=500)):
        return weo.page(run_id, coverage=False, country=country, indicator=indicator, offset=offset, limit=limit)

    @app.get("/api/weo/{run_id}/sources/{ordinal}")
    def weo_original(run_id: str, ordinal: int):
        return Response(weo.original(run_id, ordinal), media_type="application/octet-stream",
                        headers={"Content-Disposition": 'attachment; filename="weo-source-response.bin"', "Cache-Control": "no-store"})

    @app.get("/api/weo/{run_id}/export")
    def weo_export(run_id: str):
        weo.get(run_id)
        return StreamingResponse(weo.export(run_id), media_type="application/x-ndjson",
                                 headers={"Content-Disposition": 'attachment; filename="weo-native-release.ndjson"', "Cache-Control": "no-store"})

    @app.post("/api/weo/{run_id}/commit")
    def weo_commit(run_id: str):
        weo.activate(run_id)
        return _state(store)

    @app.post("/api/weo/{run_id}/rollback")
    def weo_rollback(run_id: str):
        weo.rollback(run_id)
        return _state(store)

    def run_worldbank(identifier: str, stop: Event) -> None:
        try:
            from .worldbank import Downloader, acquire
            downloader = Downloader(stop, lambda path, status, content: worldbank.source(identifier, path, status, content),
                                    lambda details: worldbank.progress(identifier, details))
            result = acquire(downloader, lambda details: worldbank.progress(identifier, details))
            downloader.check()
            worldbank.complete(identifier, result)
            log_event("worldbank_acquisition_finished", annualRunId=identifier, rowCount=result["report"]["rowCount"], absentPairs=result["report"]["absentPairs"])
        except Exception as exc:
            log_event("worldbank_acquisition_failed", annualRunId=identifier, errorType=type(exc).__name__)
            try:
                worldbank.fail(identifier, str(exc) if isinstance(exc, AcquisitionError) else
                               f"World Bank processing failed ({type(exc).__name__}); active snapshot unchanged")
            except Exception as failure:
                log_event("worldbank_failure_persistence_failed", annualRunId=identifier, errorType=type(failure).__name__)
                raise
        finally:
            stop_events.pop(identifier, None)

    @app.post("/api/providers/worldbank/pull", status_code=202)
    def worldbank_pull(consent: dict):
        if set(consent) != {"researchUse"} or consent["researchUse"] is not True:
            raise HTTPException(422, "Confirm researchUse: true; fixed reviewed World Bank WDI basket only")
        identifier = store.begin_provider_pull("worldbank")
        stop = Event()
        stop_events[identifier] = stop
        try:
            app.state.worldbank_executor.submit(run_worldbank, identifier, stop)
        except RuntimeError:
            stop_events.pop(identifier, None)
            worldbank.fail(identifier, "World Bank worker unavailable; active snapshot unchanged")
            raise
        return worldbank.get(identifier)

    @app.post("/api/providers/worldbank/{run_id}/cancel")
    def worldbank_cancel(run_id: str):
        run = worldbank.get(run_id)
        stop = stop_events.get(run_id)
        if run["status"] != "running" or stop is None:
            raise Conflict("World Bank acquisition is not running")
        stop.set()
        return {"status": "cancellation_requested", "id": run_id}

    @app.get("/api/worldbank/{run_id}")
    def worldbank_manifest(run_id: str):
        return worldbank.get(run_id)

    @app.get("/api/worldbank/{run_id}/coverage")
    def worldbank_coverage(run_id: str, country: str = "", indicator: str = "",
                           offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=500)):
        return worldbank.page(run_id, coverage=True, country=country, indicator=indicator, offset=offset, limit=limit)

    @app.get("/api/worldbank/{run_id}/observations")
    def worldbank_observations(run_id: str, country: str, indicator: str,
                               offset: int = Query(0, ge=0), limit: int = Query(400, ge=1, le=500)):
        return worldbank.page(run_id, coverage=False, country=country, indicator=indicator, offset=offset, limit=limit)

    @app.get("/api/worldbank/{run_id}/sources/{ordinal}")
    def worldbank_original(run_id: str, ordinal: int):
        return Response(worldbank.original(run_id, ordinal), media_type="application/json",
                        headers={"Content-Disposition": 'attachment; filename="worldbank-source-response.json"', "Cache-Control": "no-store"})

    @app.get("/api/worldbank/{run_id}/export")
    def worldbank_export(run_id: str):
        worldbank.get(run_id)
        return StreamingResponse(worldbank.export(run_id), media_type="application/x-ndjson",
                                 headers={"Content-Disposition": 'attachment; filename="worldbank-native-history.ndjson"', "Cache-Control": "no-store"})

    @app.post("/api/worldbank/{run_id}/commit")
    def worldbank_commit(run_id: str):
        worldbank.activate(run_id)
        return _state(store)

    @app.post("/api/worldbank/{run_id}/rollback")
    def worldbank_rollback(run_id: str):
        worldbank.rollback(run_id)
        return _state(store)

    def run_ids(identifier: str, stop: Event) -> None:
        try:
            from .worldbank import Downloader
            from .ids import acquire
            downloader = Downloader(stop, lambda path, status, content: ids.source(identifier, path, status, content),
                                    lambda details: ids.progress(identifier, details), source_id=6)
            result = acquire(downloader, lambda details: ids.progress(identifier, details))
            downloader.check()
            ids.complete(identifier, result)
            log_event("ids_acquisition_finished", annualRunId=identifier, rowCount=result["report"]["rowCount"], absentPairs=result["report"]["absentPairs"])
        except Exception as exc:
            log_event("ids_acquisition_failed", annualRunId=identifier, errorType=type(exc).__name__)
            try:
                ids.fail(identifier, str(exc) if isinstance(exc, AcquisitionError) else
                         f"IDS processing failed ({type(exc).__name__}); active snapshot unchanged")
            except Exception as failure:
                log_event("ids_failure_persistence_failed", annualRunId=identifier, errorType=type(failure).__name__)
                raise
        finally:
            stop_events.pop(identifier, None)

    @app.post("/api/providers/ids/pull", status_code=202)
    def ids_pull(consent: dict):
        if set(consent) != {"researchUse"} or consent["researchUse"] is not True:
            raise HTTPException(422, "Confirm researchUse: true; fixed source-6 IDS WLD basket only")
        identifier = store.begin_provider_pull("ids")
        stop = Event()
        stop_events[identifier] = stop
        try:
            app.state.ids_executor.submit(run_ids, identifier, stop)
        except RuntimeError:
            stop_events.pop(identifier, None)
            ids.fail(identifier, "IDS worker unavailable; active snapshot unchanged")
            raise
        return ids.get(identifier)

    @app.post("/api/providers/ids/{run_id}/cancel")
    def ids_cancel(run_id: str):
        run, stop = ids.get(run_id), stop_events.get(run_id)
        if run["status"] != "running" or stop is None:
            raise Conflict("IDS acquisition is not running")
        stop.set()
        return {"status": "cancellation_requested", "id": run_id}

    @app.get("/api/ids/{run_id}")
    def ids_manifest(run_id: str):
        return ids.get(run_id)

    @app.get("/api/ids/{run_id}/coverage")
    def ids_coverage(run_id: str, country: str = "", indicator: str = "",
                     offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=500)):
        return ids.page(run_id, coverage=True, country=country, indicator=indicator, offset=offset, limit=limit)

    @app.get("/api/ids/{run_id}/observations")
    def ids_observations(run_id: str, country: str, indicator: str,
                         offset: int = Query(0, ge=0), limit: int = Query(400, ge=1, le=500)):
        return ids.page(run_id, coverage=False, country=country, indicator=indicator, offset=offset, limit=limit)

    @app.get("/api/ids/{run_id}/sources/{ordinal}")
    def ids_original(run_id: str, ordinal: int):
        return Response(ids.original(run_id, ordinal), media_type="application/json",
                        headers={"Content-Disposition": 'attachment; filename="ids-source-response.json"'})

    @app.get("/api/ids/{run_id}/export")
    def ids_export(run_id: str):
        ids.get(run_id)
        return StreamingResponse(ids.export(run_id), media_type="application/x-ndjson",
                                 headers={"Content-Disposition": 'attachment; filename="ids-native-history.ndjson"'})

    @app.post("/api/ids/{run_id}/commit")
    def ids_commit(run_id: str):
        ids.activate(run_id)
        return _state(store)

    @app.post("/api/ids/{run_id}/rollback")
    def ids_rollback(run_id: str):
        ids.rollback(run_id)
        return _state(store)

    def run_acled(identifier: str, stop: Event, start: str, end: str) -> None:
        try:
            from .acled import Downloader, acquire
            downloader = Downloader(stop, lambda path, status, content: acled.source(identifier, path, status, content),
                                    lambda details: acled.progress(identifier, details), start, end)
            acquire(downloader, acled, identifier)
            log_event("acled_acquisition_finished", acledRunId=identifier)
        except Exception as exc:
            log_event("acled_acquisition_failed", acledRunId=identifier, errorType=type(exc).__name__)
            try:
                # Third-party exceptions can include provider bodies; persist only controlled messages.
                acled.fail(identifier, str(exc) if isinstance(exc, (AcquisitionError, Conflict)) else
                           f"ACLED processing failed ({type(exc).__name__}); incomplete snapshot cannot activate")
            except Exception as failure:
                log_event("acled_failure_persistence_failed", acledRunId=identifier, errorType=type(failure).__name__)
                raise
        finally:
            stop_events.pop(identifier, None)

    @app.get("/api/providers/acled/config")
    def acled_config():
        from .acled import CONTRACT, configured, window
        start, end = window()
        return {"contractVersion": CONTRACT, "library": "acled==1.0.2", "configured": configured(),
                "auth": "oauth", "scope": "global-account-accessible", "days": 30, "startDate": start, "endDate": end}

    @app.post("/api/providers/acled/pull", status_code=202)
    def acled_pull(consent: dict):
        from .acled import credentials, window
        if set(consent) != {"researchUse"} or consent["researchUse"] is not True:
            raise HTTPException(422, "Confirm researchUse: true; global account-accessible core events, latest 30 completed UTC days")
        try:
            credentials()
        except AcquisitionError as exc:
            raise HTTPException(503, str(exc)) from None
        start, end = window()
        identifier = store.begin_provider_pull("acled")
        try:
            acled.initialize(identifier, start, end)
            stop = Event()
            stop_events[identifier] = stop
            app.state.acled_executor.submit(run_acled, identifier, stop, start, end)
        except Exception:
            stop_events.pop(identifier, None)
            acled.fail(identifier, "ACLED initialization/worker unavailable; existing snapshots unchanged")
            raise
        return acled.get(identifier)

    @app.post("/api/providers/acled/{run_id}/cancel")
    def acled_cancel(run_id: str):
        run, stop = acled.get(run_id), stop_events.get(run_id)
        if run["status"] != "running" or stop is None:
            raise Conflict("ACLED acquisition is not running")
        stop.set()
        return {"status": "cancellation_requested", "id": run_id}

    @app.get("/api/acled/{run_id}")
    def acled_manifest(run_id: str):
        return acled.get(run_id)

    @app.get("/api/acled/{run_id}/events")
    def acled_events(run_id: str, country: str = Query("", max_length=200),
                     event_type: str = Query("", max_length=200), offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500)):
        if any(ord(c) < 32 or ord(c) == 127 for c in country + event_type):
            raise HTTPException(422, "Invalid ACLED native filter")
        return acled.page(run_id, country=country, event_type=event_type, offset=offset, limit=limit)

    @app.get("/api/acled/{run_id}/sources/{ordinal}")
    def acled_original(run_id: str, ordinal: int):
        return Response(acled.original(run_id, ordinal), media_type="application/octet-stream",
                        headers={"Content-Disposition": 'attachment; filename="acled-original-response.bin"',
                                 "X-Content-Type-Options": "nosniff"})

    @app.get("/api/acled/{run_id}/export")
    def acled_export(run_id: str):
        acled.get(run_id)
        return StreamingResponse(acled.export(run_id), media_type="application/x-ndjson",
                                 headers={"Content-Disposition": 'attachment; filename="acled-private-native-events.ndjson"'})

    @app.post("/api/acled/{run_id}/commit")
    def acled_commit(run_id: str):
        acled.activate(run_id)
        return _state(store)

    @app.post("/api/acled/{run_id}/rollback")
    def acled_rollback(run_id: str):
        acled.rollback(run_id)
        return _state(store)

    def run_gdelt(identifier: str, stop: Event, day: str) -> None:
        try:
            from .gdelt import Downloader, acquire
            downloader = Downloader(stop, lambda path, status, content: gdelt.source(identifier, path, status, content),
                                    lambda details: gdelt.progress(identifier, details))
            acquire(downloader, gdelt, identifier, day)
            log_event("gdelt_acquisition_finished", gdeltRunId=identifier)
        except Exception as exc:
            log_event("gdelt_acquisition_failed", gdeltRunId=identifier, errorType=type(exc).__name__)
            try:
                gdelt.fail(identifier, str(exc) if isinstance(exc, (AcquisitionError, Conflict)) else
                           f"GDELT processing failed ({type(exc).__name__}); incomplete day cannot activate")
            except Exception as failure:
                log_event("gdelt_failure_persistence_failed", gdeltRunId=identifier, errorType=type(failure).__name__)
                raise
        finally:
            stop_events.pop(identifier, None)

    @app.get("/api/providers/gdelt/config")
    def gdelt_config():
        from .gdelt import CONTRACT, latest_day
        return {"contractVersion": CONTRACT, "library": "gdelt==0.1.14", "requiresKey": False,
                "table": "events", "latestCompletedDay": latest_day(), "intervalCount": 96, "scope": "global"}

    @app.post("/api/providers/gdelt/pull", status_code=202)
    def gdelt_pull(consent: dict):
        from .gdelt import latest_day
        if set(consent) != {"researchUse"} or consent["researchUse"] is not True:
            raise HTTPException(422, "Confirm researchUse: true; latest completed UTC day, all 96 global event intervals")
        identifier = store.begin_provider_pull("gdelt")
        day = latest_day()
        gdelt.initialize(identifier, day)
        stop = Event()
        stop_events[identifier] = stop
        try:
            app.state.gdelt_executor.submit(run_gdelt, identifier, stop, day)
        except RuntimeError:
            stop_events.pop(identifier, None)
            gdelt.fail(identifier, "GDELT worker unavailable; active snapshot unchanged")
            raise
        return gdelt.get(identifier)

    @app.post("/api/providers/gdelt/{run_id}/cancel")
    def gdelt_cancel(run_id: str):
        run, stop = gdelt.get(run_id), stop_events.get(run_id)
        if run["status"] != "running" or stop is None:
            raise Conflict("GDELT acquisition is not running")
        stop.set()
        return {"status": "cancellation_requested", "id": run_id}

    @app.get("/api/gdelt/{run_id}")
    def gdelt_manifest(run_id: str):
        return gdelt.get(run_id)

    @app.get("/api/gdelt/{run_id}/events")
    def gdelt_events(run_id: str, country: str = Query("", pattern=r"^(|UNKNOWN|[A-Z0-9]{2})$"),
                     root: str = Query("", pattern=r"^(|0[1-9]|1[0-9]|20)$"),
                     offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500)):
        return gdelt.page(run_id, country=country, root=root, offset=offset, limit=limit)

    @app.get("/api/gdelt/{run_id}/sources/{ordinal}")
    def gdelt_original(run_id: str, ordinal: int):
        return Response(gdelt.original(run_id, ordinal), media_type="application/octet-stream",
                        headers={"Content-Disposition": 'attachment; filename="gdelt-original-response.bin"',
                                 "X-Content-Type-Options": "nosniff"})

    @app.get("/api/gdelt/{run_id}/export")
    def gdelt_export(run_id: str):
        gdelt.get(run_id)
        return StreamingResponse(gdelt.export(run_id), media_type="application/x-ndjson",
                                 headers={"Content-Disposition": 'attachment; filename="gdelt-native-events.ndjson"'})

    @app.post("/api/gdelt/{run_id}/commit")
    def gdelt_commit(run_id: str):
        gdelt.activate(run_id)
        return _state(store)

    @app.post("/api/gdelt/{run_id}/rollback")
    def gdelt_rollback(run_id: str):
        gdelt.rollback(run_id)
        return _state(store)

    def run_comtrade(identifier: str, stop: Event) -> None:
        from .comtrade import Downloader, Paused, run_pass
        try:
            downloader = Downloader(stop, lambda path, status, content: comtrade.source(identifier, path, status, content),
                                    lambda: comtrade.reserve(identifier), lambda details: comtrade.progress(identifier, details))
            run_pass(downloader, comtrade, identifier)
            log_event("comtrade_pass_finished", comtradeRunId=identifier)
        except Paused as exc:
            comtrade.pause(identifier, str(exc), not_before=exc.not_before)
            log_event("comtrade_pass_paused", comtradeRunId=identifier)
        except Exception as exc:
            log_event("comtrade_pass_failed", comtradeRunId=identifier, errorType=type(exc).__name__)
            try:
                comtrade.pause(identifier, str(exc) if isinstance(exc, (AcquisitionError, Conflict)) else
                               f"Comtrade processing failed ({type(exc).__name__}); completed chunks retained", failed=True)
            except Exception as failure:
                log_event("comtrade_failure_persistence_failed", comtradeRunId=identifier, errorType=type(failure).__name__)
                raise
        finally:
            with comtrade_events_lock:
                if stop_events.get(identifier) is stop:
                    stop_events.pop(identifier, None)

    @app.get("/api/providers/comtrade/config")
    def comtrade_config():
        from .comtrade import CONTRACT, DAILY_REQUESTS, FIRST_YEAR, PASS_REQUESTS, PASS_SECONDS, configured
        return {"contractVersion": CONTRACT, "configured": configured(), "dailyRequestBudget": DAILY_REQUESTS,
                "passRequests": PASS_REQUESTS, "passSeconds": PASS_SECONDS, "firstYear": FIRST_YEAR, "manualResume": True}

    def submit_comtrade(identifier):
        stop = Event()
        with comtrade_events_lock:
            stop_events[identifier] = stop
        try:
            app.state.comtrade_executor.submit(run_comtrade, identifier, stop)
        except RuntimeError:
            with comtrade_events_lock:
                stop_events.pop(identifier, None)
            comtrade.pause(identifier, "Comtrade worker unavailable; completed chunks retained", failed=True)
            raise
        return comtrade.get(identifier)

    def comtrade_consent(consent):
        from .comtrade import api_key
        if consent != {"researchUse": True} or consent.get("researchUse") is not True:
            raise HTTPException(422, "Confirm researchUse: true; fixed global annual TOTAL M/X merchandise scope")
        try:
            api_key()
        except AcquisitionError as exc:
            raise HTTPException(422, str(exc)) from None

    @app.post("/api/providers/comtrade/pull", status_code=202)
    def comtrade_pull(consent: dict):
        comtrade_consent(consent)
        return submit_comtrade(store.begin_provider_pull("comtrade"))

    @app.post("/api/providers/comtrade/{run_id}/resume", status_code=202)
    def comtrade_resume(run_id: str, consent: dict):
        comtrade_consent(consent)
        comtrade.resume(run_id)
        return submit_comtrade(run_id)

    @app.post("/api/providers/comtrade/{run_id}/cancel")
    def comtrade_cancel(run_id: str):
        run = comtrade.get(run_id)
        with comtrade_events_lock:
            stop = stop_events.get(run_id)
        if run["status"] != "running" or stop is None:
            raise Conflict("Comtrade pass is not running")
        stop.set()
        return {"status": "cancellation_requested", "id": run_id}

    @app.get("/api/comtrade/{run_id}")
    def comtrade_manifest(run_id: str):
        return comtrade.get(run_id)

    @app.get("/api/comtrade/{run_id}/tasks")
    def comtrade_tasks(run_id: str, offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500)):
        return comtrade.page(run_id, tasks=True, offset=offset, limit=limit)

    @app.get("/api/comtrade/{run_id}/observations")
    def comtrade_rows(run_id: str, reporter: int = Query(ge=0), partner: int = Query(ge=0), flow: str = Query(pattern="^(M|X)$"),
                      offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500)):
        return comtrade.page(run_id, reporter=reporter, partner=partner, flow=flow, offset=offset, limit=limit)

    @app.get("/api/comtrade/{run_id}/sources/{ordinal}")
    def comtrade_original(run_id: str, ordinal: int):
        return Response(comtrade.original(run_id, ordinal), media_type="application/json",
                        headers={"Content-Disposition": 'attachment; filename="comtrade-original-response.json"'})

    @app.get("/api/comtrade/{run_id}/export")
    def comtrade_export(run_id: str):
        comtrade.get(run_id)
        return StreamingResponse(comtrade.export(run_id), media_type="application/x-ndjson",
                                 headers={"Content-Disposition": 'attachment; filename="comtrade-native-history.ndjson"'})

    @app.post("/api/comtrade/{run_id}/commit")
    def comtrade_commit(run_id: str):
        comtrade.activate(run_id)
        return _state(store)

    @app.post("/api/comtrade/{run_id}/rollback")
    def comtrade_rollback(run_id: str):
        comtrade.rollback(run_id)
        return _state(store)

    def run_bis(identifier: str, stop: Event) -> None:
        try:
            from .bis import Downloader, acquire
            downloader = Downloader(stop, lambda path, status, content: bis.source(identifier, path, status, content),
                                    lambda details: bis.progress(identifier, details))
            result = acquire(downloader.get, lambda details: bis.progress(identifier, details))
            downloader.check()
            bis.complete(identifier, result)
            log_event("bis_acquisition_finished", bisRunId=identifier, rowCount=result["report"]["rowCount"])
        except Exception as exc:
            log_event("bis_acquisition_failed", bisRunId=identifier, errorType=type(exc).__name__)
            try:
                bis.fail(identifier, str(exc) if isinstance(exc, AcquisitionError) else
                         f"BIS processing failed ({type(exc).__name__}); active snapshot unchanged")
            except Exception as failure:
                log_event("bis_failure_persistence_failed", bisRunId=identifier, errorType=type(failure).__name__)
                raise
        finally:
            stop_events.pop(identifier, None)

    @app.post("/api/providers/bis/pull", status_code=202)
    def bis_pull(consent: dict):
        if set(consent) != {"researchUse"} or consent["researchUse"] is not True:
            raise HTTPException(422, "Confirm researchUse: true; fixed reviewed BIS basket only")
        identifier = store.begin_provider_pull("bis")
        stop = Event()
        stop_events[identifier] = stop
        try:
            app.state.bis_executor.submit(run_bis, identifier, stop)
        except RuntimeError:
            stop_events.pop(identifier, None)
            bis.fail(identifier, "BIS worker unavailable; active snapshot unchanged")
            raise
        return bis.get(identifier)

    @app.post("/api/providers/bis/{run_id}/cancel")
    def bis_cancel(run_id: str):
        run, stop = bis.get(run_id), stop_events.get(run_id)
        if run["status"] != "running" or stop is None:
            raise Conflict("BIS acquisition is not running")
        stop.set()
        return {"status": "cancellation_requested", "id": run_id}

    @app.get("/api/bis/{run_id}")
    def bis_manifest(run_id: str):
        return bis.get(run_id)

    @app.get("/api/bis/{run_id}/coverage")
    def bis_coverage(run_id: str, country: str = "", indicator: str = "",
                     offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=500)):
        return bis.page(run_id, coverage=True, country=country, indicator=indicator, offset=offset, limit=limit)

    @app.get("/api/bis/{run_id}/observations")
    def bis_observations(run_id: str, country: str, indicator: str,
                         offset: int = Query(0, ge=0), limit: int = Query(1000, ge=1, le=1000)):
        return bis.page(run_id, coverage=False, country=country, indicator=indicator, offset=offset, limit=limit)

    @app.get("/api/bis/{run_id}/sources/{ordinal}")
    def bis_original(run_id: str, ordinal: int):
        return Response(bis.original(run_id, ordinal), media_type="application/xml",
                        headers={"Content-Disposition": 'attachment; filename="bis-source-response.xml"'})

    @app.get("/api/bis/{run_id}/export")
    def bis_export(run_id: str):
        bis.get(run_id)
        return StreamingResponse(bis.export(run_id), media_type="application/x-ndjson",
                                 headers={"Content-Disposition": 'attachment; filename="bis-quarterly-history.ndjson"'})

    @app.post("/api/bis/{run_id}/commit")
    def bis_commit(run_id: str):
        bis.activate(run_id)
        return _state(store)

    @app.post("/api/bis/{run_id}/rollback")
    def bis_rollback(run_id: str):
        bis.rollback(run_id)
        return _state(store)

    def run_fred(identifier: str, stop: Event, mode: str, as_of: str) -> None:
        try:
            from .fred import Downloader, acquire
            downloader = Downloader(stop, lambda path, status, content: fred.source(identifier, path, status, content),
                                    lambda details: fred.progress(identifier, details))
            result = acquire(downloader, mode, as_of, lambda details: fred.progress(identifier, details))
            downloader.check()
            fred.complete(identifier, result)
            log_event("fred_acquisition_finished", fredRunId=identifier, mode=mode, asOf=as_of, rowCount=result["report"]["rowCount"])
        except Exception as exc:
            log_event("fred_acquisition_failed", fredRunId=identifier, errorType=type(exc).__name__)
            try:
                fred.fail(identifier, str(exc) if isinstance(exc, AcquisitionError) else
                          f"FRED processing failed ({type(exc).__name__}); active snapshots unchanged")
            except Exception as failure:
                log_event("fred_failure_persistence_failed", fredRunId=identifier, errorType=type(failure).__name__)
                raise
        finally:
            stop_events.pop(identifier, None)

    @app.get("/api/providers/fred/config")
    def fred_config():
        from .fred import MIN_DATE, SERIES, configured, today
        return {"configured": configured(), "today": today(), "earliestDate": MIN_DATE,
                "series": [{"id": code, **definition} for code, definition in SERIES.items()]}

    @app.post("/api/providers/fred/pull", status_code=202)
    def fred_pull(consent: dict):
        from .fred import MIN_DATE, api_key, today, valid_date
        mode = consent.get("mode")
        if (mode not in ("current", "historical") or consent.get("researchUse") is not True or
            set(consent) != ({"mode", "researchUse"} if mode == "current" else {"mode", "researchUse", "asOf"})):
            raise HTTPException(422, "Use exactly researchUse: true, mode: current; or mode: historical with asOf: YYYY-MM-DD")
        try:
            as_of = today() if mode == "current" else valid_date(consent["asOf"])
            if not MIN_DATE <= as_of <= today():
                raise AcquisitionError("Historical as-of date must be between 1776-07-04 and today (US Central)")
        except AcquisitionError as exc:
            raise HTTPException(422, str(exc)) from None
        try:
            api_key()
        except AcquisitionError as exc:
            raise HTTPException(503, str(exc)) from None
        identifier = store.begin_provider_pull("fred", fred_request={"mode": mode, "asOf": as_of})
        stop = Event()
        stop_events[identifier] = stop
        try:
            app.state.fred_executor.submit(run_fred, identifier, stop, mode, as_of)
        except RuntimeError:
            stop_events.pop(identifier, None)
            fred.fail(identifier, "FRED worker unavailable; active snapshots unchanged")
            raise
        return fred.get(identifier)

    @app.post("/api/providers/fred/{run_id}/cancel")
    def fred_cancel(run_id: str):
        run = fred.get(run_id)
        stop = stop_events.get(run_id)
        if run["status"] != "running" or stop is None:
            raise Conflict("FRED acquisition is not running")
        stop.set()
        return {"status": "cancellation_requested", "id": run_id}

    @app.get("/api/fred/{run_id}")
    def fred_manifest(run_id: str):
        return fred.get(run_id)

    @app.get("/api/fred/{run_id}/series")
    def fred_catalog(run_id: str):
        return fred.catalog(run_id)

    @app.get("/api/fred/{run_id}/observations")
    def fred_observations(run_id: str, series_id: str, offset: int = Query(0, ge=0),
                          limit: int = Query(5000, ge=1, le=5000)):
        return fred.page(run_id, series_id, offset, limit)

    @app.get("/api/fred/{run_id}/sources/{ordinal}")
    def fred_original(run_id: str, ordinal: int):
        return Response(fred.original(run_id, ordinal), media_type="application/json",
                        headers={"Content-Disposition": 'attachment; filename="fred-source-response.json"', "Cache-Control": "no-store"})

    @app.get("/api/fred/{run_id}/export")
    def fred_export(run_id: str):
        fred.get(run_id)
        return StreamingResponse(fred.export(run_id), media_type="application/x-ndjson",
                                 headers={"Content-Disposition": 'attachment; filename="fred-alfred-native-history.ndjson"', "Cache-Control": "no-store"})

    @app.post("/api/fred/{run_id}/commit")
    def fred_commit(run_id: str):
        fred.activate(run_id)
        return _state(store)

    @app.post("/api/fred/{run_id}/rollback")
    def fred_rollback(run_id: str):
        fred.rollback(run_id)
        return _state(store)

    @app.post("/api/datasets/{dataset_id}/activate", response_model=State, response_model_exclude_none=True)
    def activate(dataset_id: str):
        store.activate(dataset_id)
        store.health()
        log_event("dataset_activated", datasetId=dataset_id)
        return _state(store)

    @app.post("/api/datasets/{dataset_id}/rollback", response_model=State, response_model_exclude_none=True)
    def rollback(dataset_id: str):
        store.rollback(dataset_id)
        store.health()
        log_event("dataset_rolled_back", datasetId=dataset_id)
        return _state(store)

    @app.get("/api/datasets/{dataset_id}/metadata")
    def metadata(dataset_id: str):
        return store.metadata(dataset_id)

    @app.get("/api/health")
    def health():
        return store.health()

    @app.get("/api/audit")
    def audit():
        return {"events": store.audit()}

    @app.get("/api/events")
    def events():
        return {"events": [event for event in store.audit() if event["event"] != "service_started"]}

    @app.get("/api/backup")
    def backup():
        return Response(
            store.snapshot(), media_type="application/vnd.sqlite3",
            headers={"Content-Disposition": 'attachment; filename="research-backup.sqlite3"', "Cache-Control": "no-store"},
        )

    dist = Path(dist_path) if dist_path is not None else Path(__file__).resolve().parent.parent / "dist"
    if (dist / "index.html").is_file():
        root = dist.resolve()

        @app.get("/{path:path}")
        def static(path: str):
            if path == "api" or path.startswith("api/"):
                raise HTTPException(404, "API route not found")
            candidate = (root / path).resolve()
            if not candidate.is_relative_to(root):
                raise HTTPException(404, "File not found")
            if candidate.is_file():
                return FileResponse(candidate)
            if Path(path).suffix:
                raise HTTPException(404, "Asset not found")
            return FileResponse(root / "index.html")

    return app


def _observation(observation) -> dict:
    return observation.model_dump(exclude_none=True) | {"publishedAt": observation.publishedAt}


def _state(store: Store) -> JSONResponse:
    state = store.state()
    result = state.model_dump()
    for dataset, model in zip(result["datasets"], state.datasets):
        dataset["observations"] = [_observation(o) for o in model.observations]
    # Explicit nulls are meaningful for freshness, publication, and pending dataset IDs.
    return JSONResponse(result, headers={"Cache-Control": "no-store"})


def _preview(preview: ImportPreview) -> JSONResponse:
    result = preview.model_dump()
    result["preview"] = [_observation(o) for o in preview.preview]
    return JSONResponse(result, headers={"Cache-Control": "no-store"})


app = create_app()
