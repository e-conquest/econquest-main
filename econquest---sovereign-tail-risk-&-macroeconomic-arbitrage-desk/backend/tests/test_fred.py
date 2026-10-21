import copy
import hashlib
import io
import json
import os
import shutil
import sys
import unittest
import uuid
from contextlib import closing
from pathlib import Path
from threading import Event
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.fred import AcquisitionError, Downloader, MIN_DATE, SERIES, acquire, configured, today
from backend.fred_storage import FredStore
from backend.__main__ import main
from backend.storage import Conflict, Store, connect, restore_backup, verify_backup

KEY = "a1" * 16  # Synthetic fixture, not a credential.
NOW = "2026-10-20"
OLD = "2010-06-01"


def meta(code, as_of):
    frequency = SERIES[code]["frequency"]
    return {"id": code, "title": f"Fixture {code}", "frequency": {"D": "Daily", "M": "Monthly", "Q": "Quarterly"}[frequency],
            "frequency_short": frequency, "units": "Fixture native units", "units_short": "fixture",
            "seasonal_adjustment": "Not Seasonally Adjusted", "seasonal_adjustment_short": "NSA",
            "last_updated": "2026-10-19 10:00:00-05", "realtime_start": as_of, "realtime_end": as_of,
            "observation_start": "2000-01-01", "observation_end": "2026-10-01", "notes": "Synthetic fixture, not empirical."}


def payload(endpoint, params):
    code = params["series_id"]
    if endpoint == "series":
        as_of = params["realtime_start"]
        return {"realtime_start": as_of, "realtime_end": as_of, "seriess": [meta(code, as_of)]}
    if endpoint == "series/vintagedates":
        dates = ["2018-04-03"] if code == "SOFR" else ["2000-02-01", "2010-05-01", "2026-10-19"]
        return {"realtime_start": MIN_DATE, "realtime_end": NOW, "count": len(dates), "offset": 0,
                "limit": 10000, "order_by": "vintage_date", "sort_order": "asc", "vintage_dates": dates}
    as_of = params["realtime_start"]
    period = "2000-01-01" if SERIES[code]["frequency"] != "D" else "2000-01-03"
    rows = [{"date": period, "realtime_start": as_of, "realtime_end": as_of, "value": "-1.2500"},
            {"date": "2000-04-01", "realtime_start": as_of, "realtime_end": as_of, "value": "."}]
    return {"realtime_start": as_of, "realtime_end": as_of, "observation_start": MIN_DATE,
            "observation_end": as_of, "units": "lin", "output_type": 1, "sort_order": "asc",
            "count": 2, "offset": 0, "limit": 10000, "observations": rows}


class FixtureDownloader:
    def __init__(self, change=None):
        self.change = change
        self.calls = []
        self.last_hash = ""

    def check(self):
        pass

    def get(self, endpoint, params):
        self.calls.append((endpoint, params.copy()))
        data = payload(endpoint, params)
        if self.change:
            self.change(endpoint, params, data)
        self.last_hash = hashlib.sha256(json.dumps(data).encode()).hexdigest()
        return data


def result_fixture(mode="current", as_of=NOW):
    with patch("backend.fred.today", return_value=NOW):
        return acquire(FixtureDownloader(), mode, as_of, lambda p: None)


class FredParserTests(unittest.TestCase):
    def test_reviewed_basket_native_values_missing_statuses_and_no_transformations(self):
        result = result_fixture()
        self.assertEqual(len(SERIES), 18)
        self.assertEqual(result["report"]["numericCount"], 18)
        self.assertEqual(result["report"]["rowCount"], 36)
        self.assertEqual(result["records"][0]["value"], -1.25)
        self.assertEqual(result["records"][0]["rawValue"], "-1.2500")
        self.assertIsNone(result["records"][1]["value"])
        self.assertEqual(result["records"][1]["rawValue"], ".")
        self.assertTrue(all(s["analysisBlocked"] for s in result["series"]))
        d = FixtureDownloader()
        with patch("backend.fred.today", return_value=NOW):
            acquire(d, "current", NOW, lambda p: None)
        self.assertTrue(all("frequency" not in p for _, p in d.calls))
        self.assertTrue(all(p["units"] == "lin" for e, p in d.calls if e == "series/observations"))
        self.assertEqual(len(d.calls), 72)

    def test_historical_values_and_metadata_are_date_bounded_no_unavailable_series_fallback(self):
        d = FixtureDownloader()
        with patch("backend.fred.today", return_value=NOW):
            result = acquire(d, "historical", OLD, lambda p: None)
        self.assertEqual(result["report"]["availableSeries"], 17)
        self.assertEqual(result["report"]["unavailableSeries"], ["SOFR"])
        self.assertFalse(any(r["seriesId"] == "SOFR" for r in result["records"]))
        self.assertTrue(all(r["realtimeStart"] == OLD and r["realtimeEnd"] == OLD for r in result["records"]))
        available = [s for s in result["series"] if s["status"] == "available"]
        self.assertTrue(all(s["metadataAsOf"] == OLD for s in available))
        sofr = next(s for s in result["series"] if s["id"] == "SOFR")
        self.assertEqual(sofr["metadataAsOf"], NOW)
        self.assertEqual(sofr["latestEligibleVintage"], None)
        self.assertFalse(any(e == "series/observations" and p["series_id"] == "SOFR" for e, p in d.calls))

    def test_invalid_dates_empty_archive_and_invalid_mode_are_explicit(self):
        for mode, as_of in (("unknown", NOW), ("current", OLD), ("historical", "2099-01-01"), ("historical", "2020-02-31"), ("historical", "1700-01-01")):
            with self.subTest(mode=mode, date=as_of), patch("backend.fred.today", return_value=NOW), self.assertRaises(AcquisitionError):
                acquire(FixtureDownloader(), mode, as_of, lambda p: None)
        with patch("backend.fred.today", return_value=NOW), self.assertRaisesRegex(AcquisitionError, "no numeric"):
            acquire(FixtureDownloader(), "historical", "1900-01-01", lambda p: None)

    def test_identity_units_frequency_bounds_numeric_missing_and_pagination_contract_fail_closed(self):
        def change_observation(key, value):
            def change(e, p, data):
                if e == "series/observations":
                    data["observations"][0][key] = value
            return change
        def frequency(e, p, data):
            if e == "series":
                data["seriess"][0]["frequency_short"] = "W"
        def units(e, p, data):
            if e == "series":
                data["seriess"][0]["units"] = ""
        def identity(e, p, data):
            if e == "series":
                data["seriess"][0]["id"] = "OTHER"
        def bound(e, p, data):
            if e == "series/observations":
                data["realtime_end"] = OLD
        def transformed(e, p, data):
            if e == "series/observations":
                data["units"] = "pch"
        def duplicates(e, p, data):
            if e == "series/observations":
                data["observations"][1] = data["observations"][0]
        def truncated(e, p, data):
            if e == "series/observations":
                data["count"] = 3
        def vintage(e, p, data):
            if e == "series/vintagedates":
                data["vintage_dates"] = ["2000-01-01", "2000-01-01", "2001-01-01"]
        for change in (frequency, units, identity, bound, transformed, duplicates, truncated, vintage,
                       change_observation("value", "NaN"), change_observation("value", ""), change_observation("value", None),
                       change_observation("value", "1e999"), change_observation("date", "2099-01-01"),
                       change_observation("realtime_start", OLD)):
            with self.subTest(change=change), patch("backend.fred.today", return_value=NOW), self.assertRaises(AcquisitionError):
                acquire(FixtureDownloader(change), "current", NOW, lambda p: None)

    def test_metadata_changes_during_current_pull_are_not_silently_accepted(self):
        calls = {}
        def change(e, p, data):
            if e == "series":
                code = p["series_id"]
                calls[code] = calls.get(code, 0) + 1
                if calls[code] == 2:
                    data["seriess"][0]["last_updated"] = "2026-10-20 12:00:00-05"
        with patch("backend.fred.today", return_value=NOW), self.assertRaisesRegex(AcquisitionError, "changed during"):
            acquire(FixtureDownloader(change), "current", NOW, lambda p: None)


class Reply(io.BytesIO):
    def __init__(self, content, status=200, encoding="identity"):
        super().__init__(content)
        self.status = status
        self.encoding = encoding

    def getheader(self, name, default=None):
        return self.encoding if name == "Content-Encoding" else default


class Connection:
    def __init__(self, reply, requests):
        self.reply, self.requests = reply, requests

    def request(self, method, path, headers):
        self.requests.append((method, path, headers))

    def getresponse(self):
        return self.reply

    def close(self):
        pass


class FredTransportTests(unittest.TestCase):
    def downloader(self, saved, stop=None):
        with patch.dict(os.environ, {"FRED_API_KEY": KEY}):
            return Downloader(stop or Event(), lambda *a: saved.append(a), lambda p: None)

    def test_key_only_transmitted_to_fixed_official_host_not_saved_or_logged(self):
        saved, requests = [], []
        body = b'{"test":"fixture"}'
        d = self.downloader(saved)
        connection = Connection(Reply(body), requests)
        with patch("backend.fred.http.client.HTTPSConnection", return_value=connection) as constructor:
            self.assertEqual(d.get("series", {"series_id": "GDP"}), {"test": "fixture"})
        constructor.assert_called_once_with("api.stlouisfed.org", timeout=20)
        self.assertIn("api_key=" + KEY, requests[0][1])
        self.assertNotIn(KEY, str(saved))
        self.assertNotIn("api_key", saved[0][0])
        self.assertEqual(saved[0][2], body)
        self.assertEqual(d.last_hash, hashlib.sha256(body).hexdigest())

    def test_missing_invalid_key_scope_errors_and_cancel_do_not_contact_network(self):
        with patch.dict(os.environ, {"FRED_API_KEY": ""}):
            self.assertFalse(configured())
            with self.assertRaisesRegex(AcquisitionError, "FRED_API_KEY"):
                Downloader(Event(), lambda *a: None, lambda p: None)
        d = self.downloader([])
        with patch("backend.fred.http.client.HTTPSConnection") as request:
            for endpoint, params in (("other", {"series_id": "GDP"}), ("series", {"series_id": "OTHER"}), ("series", {"series_id": "GDP", "api_key": "secret"})):
                with self.assertRaises(AcquisitionError):
                    d.get(endpoint, params)
            d.stop.set()
            with self.assertRaisesRegex(AcquisitionError, "cancelled"):
                d.get("series", {"series_id": "GDP"})
            d.stop.clear(); d.deadline = 0
            with self.assertRaises(AcquisitionError):
                d.check()
            d.deadline = float("inf"); d.count = 200
            with self.assertRaisesRegex(AcquisitionError, "budget"):
                d.get("series", {"series_id": "GDP"})
        request.assert_not_called()

    def test_http_errors_invalid_json_credential_echo_and_timeout_never_leak_key(self):
        for body, status in ((b'{"error_code":400,"error_message":"fixture"}', 400), (b"rate limit", 429),
                             (b"not json", 200), (b'{"error_code":400}', 200), (KEY.encode(), 400)):
            saved, requests = [], []
            d = self.downloader(saved)
            with patch("backend.fred.http.client.HTTPSConnection", return_value=Connection(Reply(body, status), requests)), self.assertRaises(AcquisitionError) as caught:
                d.get("series", {"series_id": "GDP"})
            self.assertNotIn(KEY, str(caught.exception))
            self.assertNotIn(KEY, str(saved))
            if KEY.encode() in body:
                self.assertEqual(saved, [])
        d = self.downloader([])
        with patch("backend.fred.http.client.HTTPSConnection", side_effect=TimeoutError(KEY)), self.assertRaises(AcquisitionError) as caught:
            d.get("series", {"series_id": "GDP"})
        self.assertNotIn(KEY, str(caught.exception))

    def test_prefix_capture_byte_budget_and_cancellation_during_read(self):
        saved, requests = [], []
        d = self.downloader(saved)
        with patch("backend.fred.MAX_RESPONSE", 5), patch("backend.fred.http.client.HTTPSConnection", return_value=Connection(Reply(b"abcdefgh"), requests)), self.assertRaisesRegex(AcquisitionError, "budget"):
            d.get("series", {"series_id": "GDP"})
        self.assertEqual(saved[0][2], b"abcde")
        self.assertTrue(saved[0][0].endswith("#incomplete-response"))
        saved = []
        stop = Event()
        class CancelReply(Reply):
            def read(self, n):
                stop.set()
                return super().read(n)
        d = self.downloader(saved, stop)
        with patch("backend.fred.http.client.HTTPSConnection", return_value=Connection(CancelReply(b"partial"), [])), self.assertRaisesRegex(AcquisitionError, "cancelled"):
            d.get("series", {"series_id": "GDP"})
        self.assertEqual(saved[0][2], b"partial")

    def test_content_length_mismatch_is_rejected(self):
        class TruncatedReply(Reply):
            def getheader(self, name, default=None):
                return "100" if name == "Content-Length" else super().getheader(name, default)
        saved = []
        with patch("backend.fred.http.client.HTTPSConnection", return_value=Connection(TruncatedReply(b"{}"), [])), self.assertRaisesRegex(AcquisitionError, "truncated"):
            self.downloader(saved).get("series", {"series_id": "GDP"})
        self.assertTrue(saved[0][0].endswith("#incomplete-response"))


class FredCliTests(unittest.TestCase):
    def test_hidden_prompt_sets_only_process_environment_and_starts_loopback(self):
        with patch.object(sys, "argv", ["backend", "serve", "--port", "8768", "--prompt-fred-key"]), \
             patch("backend.__main__.sys.stdin.isatty", return_value=True), \
             patch("backend.__main__.getpass.getpass", return_value=KEY), \
             patch.dict(os.environ, {}, clear=False), patch("uvicorn.run") as run:
            main()
            self.assertEqual(os.environ["FRED_API_KEY"], KEY)
            self.assertEqual(run.call_args.kwargs["host"], "127.0.0.1")
            self.assertEqual(run.call_args.kwargs["port"], 8768)
            self.assertFalse(run.call_args.kwargs["access_log"])

    def test_prompt_rejects_no_tty_bad_key_and_echo_fallback_without_starting(self):
        import getpass
        for tty, value, error in ((False, KEY, None), (True, "bad", None), (True, KEY, getpass.GetPassWarning("echo unavailable"))):
            with patch.object(sys, "argv", ["backend", "serve", "--prompt-fred-key"]), \
                 patch("backend.__main__.sys.stdin.isatty", return_value=tty), \
                 patch("backend.__main__.getpass.getpass", return_value=value, side_effect=error), \
                 patch.dict(os.environ, {}, clear=False), patch("uvicorn.run") as run, \
                 patch("sys.stderr", new_callable=io.StringIO) as stderr, self.assertRaises(SystemExit):
                main()
            self.assertNotIn(KEY, stderr.getvalue())
            run.assert_not_called()


class FredApiTests(unittest.TestCase):
    def setUp(self):
        self.work = Path("backend/.test-work") / str(uuid.uuid4())
        self.work.mkdir(parents=True)
        self.db = self.work / "fred.sqlite3"
        self.client = TestClient(create_app(self.db, self.work / "absent"), base_url="http://localhost:8000")
        self.client.__enter__()
        self.store = self.client.app.state.store
        self.fred = FredStore(self.store)
        self.headers = {"X-Research-Token": self.client.get("/api/session").json()["token"]}

    def tearDown(self):
        self.client.__exit__(None, None, None)
        shutil.rmtree(self.work)

    def cooldown(self):
        with closing(connect(self.db)) as conn:
            conn.execute("UPDATE provider_pulls SET started_at='2000-01-01T00:00:00Z' WHERE provider_id='fred'")

    def stage(self, mode="current", as_of=NOW):
        self.cooldown()
        with patch("backend.fred.today", return_value=NOW):
            identifier = self.store.begin_provider_pull("fred", fred_request={"mode": mode, "asOf": as_of})
        self.fred.source(identifier, "/fred/series?series_id=GDP", 200, b"fixture")
        self.fred.complete(identifier, result_fixture(mode, as_of))
        return identifier

    def test_native_pages_catalog_sources_export_and_independent_current_historical_activation(self):
        before = self.store.state()
        current, historical = self.stage(), self.stage("historical", OLD)
        self.assertFalse(self.fred.get(current)["active"])
        self.assertEqual(self.client.post(f"/api/fred/{current}/commit", headers=self.headers).status_code, 200)
        self.assertEqual(self.client.post(f"/api/fred/{historical}/commit", headers=self.headers).status_code, 200)
        self.assertTrue(self.fred.get(current)["active"])
        self.assertTrue(self.fred.get(historical)["active"])
        after = self.store.state()
        for key in ("datasets", "runs", "macro", "weo", "worldbank"):
            self.assertEqual(getattr(before, key), getattr(after, key))
        self.assertNotIn("series", after.fred[0]["report"])
        catalog = self.client.get(f"/api/fred/{historical}/series").json()
        self.assertEqual(catalog["asOf"], OLD)
        self.assertEqual(len(catalog["series"]), 18)
        unavailable = self.client.get(f"/api/fred/{historical}/observations?series_id=SOFR").json()
        self.assertEqual(unavailable["rows"], [])
        self.assertEqual(unavailable["series"]["status"], "unavailable")
        page = self.client.get(f"/api/fred/{current}/observations?series_id=GDP&limit=1&offset=1")
        self.assertEqual(page.json()["rows"][0]["rawValue"], ".")
        self.assertIn("no-store", page.headers["cache-control"])
        self.assertEqual(self.client.get(f"/api/fred/{current}/observations?series_id=OTHER").status_code, 404)
        self.assertEqual(self.client.get(f"/api/fred/{current}/observations?series_id=GDP&limit=5001").status_code, 422)
        self.assertEqual(self.client.get(f"/api/fred/{current}/sources/1").content, b"fixture")
        exported = [json.loads(line) for line in self.client.get(f"/api/fred/{current}/export").text.splitlines()]
        self.assertEqual(len(exported), 1 + 18 + 36)
        self.assertEqual(exported[0]["type"], "manifest")
        self.assertTrue(all(row["data"]["realtimeStart"] == NOW for row in exported if row["type"] == "observation"))

    def test_rollback_skips_rolled_back_predecessors_and_inactive_rollback_does_not_replace_current(self):
        first, second, third = self.stage(), self.stage(), self.stage()
        for identifier in (first, second, third):
            self.fred.activate(identifier)
        self.fred.rollback(second)
        self.assertTrue(self.fred.get(third)["active"])
        self.fred.rollback(third)
        self.assertTrue(self.fred.get(first)["active"])
        with self.assertRaises(Conflict):
            self.fred.activate(second)

    def test_restart_failure_guards_and_backup_keep_vintage_identity(self):
        first = self.stage(); self.fred.activate(first); self.cooldown()
        with patch("backend.fred.today", return_value=NOW):
            running = self.store.begin_provider_pull("fred", fred_request={"mode": "historical", "asOf": OLD})
            with self.assertRaises(Conflict):
                self.store.begin_provider_pull("fred", fred_request={"mode": "current", "asOf": NOW})
        self.fred.source(running, "/fred/series#incomplete-response", 200, b"partial")
        self.store.close(); self.store.open()
        interrupted = self.fred.get(running)
        self.assertEqual(interrupted["status"], "interrupted")
        self.assertEqual(interrupted["report"]["mode"], "historical")
        self.assertEqual(interrupted["report"]["asOf"], OLD)
        self.assertTrue(self.fred.get(first)["active"])
        backup = self.work / "backup.sqlite3"; backup.write_bytes(self.store.snapshot())
        verify_backup(backup)
        restored_path = self.work / "restored.sqlite3"
        restore_backup(backup, restored_path, offline=True)
        restored = Store(restored_path); restored.open()
        try:
            self.assertEqual(FredStore(restored).get(first), self.fred.get(first))
        finally:
            restored.close()
        with closing(connect(self.db)) as conn:
            for table in ("fred_rows", "fred_series", "fred_sources"):
                with self.assertRaisesRegex(Exception, "immutable"):
                    conn.execute(f"DELETE FROM {table}")
        with closing(connect(backup)) as conn:
            for table in ("fred_rows", "fred_series", "fred_sources", "fred_runs"):
                conn.execute(f"DROP TABLE {table}")
        with self.assertRaises(Conflict):
            verify_backup(backup)

    def test_schema6_migration_preserves_other_provider_state(self):
        legacy = self.work / "v6.sqlite3"; legacy.write_bytes(self.store.snapshot())
        with closing(connect(legacy)) as conn:
            for table in ("analysis_bundles", "acled_rows", "acled_chunks", "acled_sources", "acled_runs",
                          "gdelt_rows", "gdelt_chunks", "gdelt_sources", "gdelt_runs",
                          "comtrade_rows", "comtrade_sources", "comtrade_tasks", "comtrade_requests", "comtrade_runs",
                          "ids_rows", "ids_series", "ids_sources", "ids_runs", "bis_rows", "bis_series", "bis_sources", "bis_runs"):
                conn.execute(f"DROP TABLE {table}")
            for table in ("fred_rows", "fred_series", "fred_sources", "fred_runs"):
                conn.execute(f"DROP TABLE {table}")
            conn.execute("PRAGMA user_version=6")
        store = Store(legacy); store.open()
        try:
            self.assertEqual(store.state().fred, [])
            self.assertEqual(len(store.state().providers), 10)
            verify_backup(legacy)
        finally:
            store.close()

    def test_consent_auth_limits_missing_credentials_and_configuration_do_not_expose_secrets(self):
        for body in ({}, {"researchUse": True}, {"researchUse": False, "mode": "current"},
                     {"researchUse": True, "mode": "current", "api_key": KEY},
                     {"researchUse": True, "mode": "current", "asOf": OLD},
                     {"researchUse": True, "mode": "historical", "asOf": "2020-02-31"},
                     {"researchUse": True, "mode": "historical", "asOf": "2099-01-01"}):
            self.assertEqual(self.client.post("/api/providers/fred/pull", headers=self.headers, json=body).status_code, 422)
        self.assertEqual(self.client.post("/api/providers/fred/pull", json={"researchUse": True, "mode": "current"}).status_code, 403)
        self.assertEqual(self.client.post("/api/providers/fred/pull", headers=self.headers, content=b"x"*1025).status_code, 413)
        with patch.dict(os.environ, {"FRED_API_KEY": ""}):
            self.assertEqual(self.client.post("/api/providers/fred/pull", headers=self.headers, json={"researchUse": True, "mode": "current"}).status_code, 503)
            self.assertFalse(self.client.get("/api/providers/fred/config").json()["configured"])
        with patch.dict(os.environ, {"FRED_API_KEY": KEY}):
            response = self.client.get("/api/providers/fred/config")
            self.assertTrue(response.json()["configured"])
            self.assertEqual(len(response.json()["series"]), 18)
            self.assertNotIn(KEY, response.text)
            self.assertIn("no-store", response.headers["cache-control"])
        self.assertEqual(self.store.state().fred, [])

    def test_manual_worker_success_and_failure_redaction_preserve_active_snapshots(self):
        first = self.stage(); self.fred.activate(first); self.cooldown()
        with patch.dict(os.environ, {"FRED_API_KEY": KEY}), patch("backend.fred.today", return_value=NOW), patch("backend.fred.acquire", return_value=result_fixture("historical", OLD)):
            response = self.client.post("/api/providers/fred/pull", headers=self.headers, json={"researchUse": True, "mode": "historical", "asOf": OLD})
            self.assertEqual(response.status_code, 202)
            self.client.app.state.fred_executor.shutdown(wait=True)
        self.assertEqual(self.fred.get(response.json()["id"])["status"], "staged")
        self.assertTrue(self.fred.get(first)["active"])
        with TestClient(create_app(self.work / "failed.sqlite3", self.work / "absent"), base_url="http://localhost:8000") as client:
            headers = {"X-Research-Token": client.get("/api/session").json()["token"]}
            with patch.dict(os.environ, {"FRED_API_KEY": KEY}), patch("backend.fred.today", return_value=NOW), patch("backend.fred.acquire", side_effect=RuntimeError(KEY)):
                response = client.post("/api/providers/fred/pull", headers=headers, json={"researchUse": True, "mode": "current"})
                client.app.state.fred_executor.shutdown(wait=True)
            manifest = client.get(f"/api/fred/{response.json()['id']}")
            self.assertNotIn(KEY, manifest.text)
            self.assertEqual(manifest.json()["report"]["asOf"], NOW)
            self.assertEqual(manifest.json()["status"], "interrupted")

    def test_cancel_during_supervised_work_and_atomic_staging(self):
        entered, release = Event(), Event()
        def acquisition(d, mode, as_of, progress):
            entered.set(); release.wait(5); d.check()
        with patch.dict(os.environ, {"FRED_API_KEY": KEY}), patch("backend.fred.today", return_value=NOW), patch("backend.fred.acquire", side_effect=acquisition):
            response = self.client.post("/api/providers/fred/pull", headers=self.headers, json={"researchUse": True, "mode": "current"})
            self.assertTrue(entered.wait(3))
            try:
                self.assertEqual(self.client.post(f"/api/providers/fred/{response.json()['id']}/cancel", headers=self.headers).status_code, 200)
            finally:
                release.set()
            self.client.app.state.fred_executor.shutdown(wait=True)
        self.assertEqual(self.fred.get(response.json()["id"])["status"], "interrupted")
        self.cooldown()
        with patch("backend.fred.today", return_value=NOW):
            identifier = self.store.begin_provider_pull("fred", fred_request={"mode": "current", "asOf": NOW})
        result = result_fixture()
        result["records"].append(copy.deepcopy(result["records"][0]))
        with self.assertRaises(Exception):
            self.fred.complete(identifier, result)
        with closing(connect(self.db)) as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM fred_rows").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT count(*) FROM fred_series").fetchone()[0], 0)
        with self.assertRaises(Conflict):
            self.fred.activate(identifier)
