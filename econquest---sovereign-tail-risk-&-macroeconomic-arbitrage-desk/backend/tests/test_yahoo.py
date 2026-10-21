import hashlib
import json
import shutil
import subprocess
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pandas as pd
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.storage import Conflict, Store, connect
from backend.yahoo import SETTINGS, SYMBOLS, acquire, pull, session_policy, session_window, validate_history

NOW = datetime(2025, 7, 7, 18, tzinfo=timezone.utc)


def metadata(symbol="EMB"):
    return {
        "symbol": symbol, "instrumentType": "ETF", "currency": "USD",
        "exchangeName": "NGM", "exchangeTimezoneName": "America/New_York",
        "longName": SYMBOLS[symbol], "dataGranularity": "1d",
    }


def history(sessions):
    index = pd.DatetimeIndex([day.date() for day in sessions], tz="America/New_York")
    frame = pd.DataFrame({
        "Open": 100., "High": 102., "Low": 99., "Close": 101., "Adj Close": 80.,
        "Volume": 1000, "Dividends": 0., "Stock Splits": 0., "Capital Gains": 0.,
    }, index=index)
    frame.index.name = "Date"
    return frame


class YahooValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sessions, cls.calendar = session_window(NOW)
        cls.frame = history(cls.sessions)

    def validate(self, frame=None, meta=None):
        return validate_history("EMB", self.frame if frame is None else frame, meta or metadata(), self.sessions, self.calendar)

    def test_close_not_adjusted_close_and_action_lineage(self):
        frame = self.frame.copy()
        frame.loc[frame.index[-1], "Dividends"] = .25
        frame.loc[frame.index[0], "Stock Splits"] = 2
        rows, summary = self.validate(frame)
        self.assertEqual(len(rows), len(self.sessions))
        self.assertEqual(rows[-1].value, 101)
        self.assertNotEqual(rows[-1].value, frame.iloc[-1]["Adj Close"])
        self.assertIsNone(rows[-1].publishedAt)
        self.assertEqual(rows[-1].observedAt, "2025-07-03T17:00:00Z")
        self.assertEqual(summary["actions"][0]["splitRatio"], 2)
        self.assertEqual(summary["actions"][-1]["dividend"], .25)
        self.assertEqual(summary["missingSessions"], 0)

    def test_wrong_symbol_currency_identity_type_exchange_timezone_frequency(self):
        for key, value in [
            ("symbol", "OTHER"), ("currency", "GBp"), ("instrumentType", "EQUITY"),
            ("exchangeName", "LSE"), ("exchangeTimezoneName", "UTC"),
            ("longName", "Another Fund"), ("dataGranularity", "1h"),
        ]:
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "mismatch"):
                self.validate(meta=metadata() | {key: value})

    def test_calendar_holidays_early_close_buffer_and_dst(self):
        self.assertEqual(str(self.sessions[-1].date()), "2025-07-03")  # July 4 holiday; July 7 still trading.
        self.assertEqual(session_policy(datetime(2025, 7, 3, 17, 29, tzinfo=timezone.utc))["expectedCloseAt"], "2025-07-02T20:00:00Z")
        policy = session_policy(datetime(2025, 7, 3, 17, 30, tzinfo=timezone.utc))
        self.assertEqual(policy["expectedCloseAt"], "2025-07-03T17:00:00Z")
        self.assertEqual(policy["nextCheckAt"], "2025-07-07T20:30:00Z")
        self.assertEqual(session_policy(datetime(2025, 3, 10, 21, tzinfo=timezone.utc))["expectedCloseAt"], "2025-03-10T20:00:00Z")
        self.assertEqual(session_policy(datetime(2025, 3, 7, 22, tzinfo=timezone.utc))["expectedCloseAt"], "2025-03-07T21:00:00Z")
        leap, _ = session_window(datetime(2024, 2, 29, 22, tzinfo=timezone.utc))
        self.assertEqual(str(leap[0].date()), "2019-02-28")
        with self.assertRaisesRegex(ValueError, "timezone"):
            session_window(datetime(2025, 7, 7))

    def test_missing_unexpected_duplicate_unordered_and_intraday_rows(self):
        for frame in [self.frame.iloc[1:], self.frame.iloc[:-1], self.frame.iloc[::-1],
                      pd.concat([self.frame, self.frame.iloc[-1:]]),
                      pd.concat([self.frame, history(pd.DatetimeIndex(["2025-07-07"]))]),
                      self.frame.set_axis(self.frame.index.tz_convert("UTC")),
                      self.frame.set_axis(self.frame.index + pd.Timedelta(hours=1))]:
            with self.subTest(rows=len(frame)), self.assertRaises(ValueError):
                self.validate(frame)

    def test_nonfinite_negative_ohlc_volume_actions_and_missing_columns(self):
        for column, value in [
            ("Close", float("nan")), ("Close", float("inf")), ("Close", -1),
            ("Adj Close", 0), ("Open", 105), ("High", 98), ("Low", 103),
            ("Volume", -1), ("Volume", 1.5), ("Dividends", -1), ("Stock Splits", -1),
            ("Capital Gains", float("inf")),
        ]:
            frame = self.frame.copy()
            frame[column] = frame[column].astype(float)
            frame.loc[frame.index[-1], column] = value
            with self.subTest(column=column, value=value), self.assertRaises(ValueError):
                self.validate(frame)
        for frame in [self.frame.iloc[:0], self.frame.drop(columns="Adj Close")]:
            with self.assertRaises(ValueError):
                self.validate(frame)
        frame = self.frame.copy()
        frame.loc[frame.index[-1], "Volume"] = 0
        self.assertIn("zero reported volume", self.validate(frame)[1]["warnings"][0])

    def test_all_four_exact_query_settings_and_library_snapshot(self):
        tickers = {}
        for symbol in SYMBOLS:
            tickers[symbol] = SimpleNamespace(history=Mock(return_value=self.frame), history_metadata=metadata(symbol))
        result = acquire(NOW, tickers.__getitem__)
        self.assertEqual(result["snapshot"]["errors"], [])
        self.assertEqual(len(result["observations"]), 4 * len(self.sessions))
        self.assertEqual(set(result["snapshot"]["symbols"]), set(SYMBOLS))
        for ticker in tickers.values():
            ticker.history.assert_called_once_with(start=str(self.sessions[0].date()), end="2025-07-04", **SETTINGS)
        source_row = result["snapshot"]["symbols"]["EMB"]["history"]["data"][-1]
        self.assertEqual(source_row["Close"], 101)
        self.assertEqual(source_row["Adj Close"], 80)
        json.dumps(result, allow_nan=False)

    def test_partial_failure_quarantines_every_symbol_and_retains_partial_snapshot(self):
        def factory(symbol):
            return SimpleNamespace(history=lambda **_: self.frame, history_metadata=metadata(symbol) | ({"currency": "EUR"} if symbol == "PCY" else {}))
        result = acquire(NOW, factory)
        self.assertEqual(result["observations"], [])
        self.assertEqual(len(result["snapshot"]["errors"]), 1)
        self.assertIn("PCY:", result["snapshot"]["errors"][0])
        self.assertEqual(set(result["snapshot"]["symbols"]), set(SYMBOLS))

    def test_transport_rate_limit_stops_without_retry_or_raw_exception_leak(self):
        factory = Mock(side_effect=RuntimeError("private URL or provider response"))
        result = acquire(NOW, factory)
        factory.assert_called_once_with("EMB")
        self.assertEqual(result["observations"], [])
        self.assertIn("acquisition failed (RuntimeError)", result["snapshot"]["errors"][0])
        self.assertNotIn("private", json.dumps(result))

    def test_worker_timeout_exit_and_invalid_json_are_explicit(self):
        for outcome in [
            subprocess.TimeoutExpired("worker", 90),
            SimpleNamespace(returncode=1, stdout=b"secret response"),
            SimpleNamespace(returncode=0, stdout=b"invalid"),
        ]:
            mock = {"side_effect": outcome} if isinstance(outcome, Exception) else {"return_value": outcome}
            with patch("backend.yahoo.subprocess.run", **mock) as run:
                result = pull()
                self.assertEqual(result["observations"], [])
                self.assertTrue(result["snapshot"]["errors"])
                self.assertEqual(run.call_args.kwargs["timeout"], 90)
                self.assertNotIn("secret", json.dumps(result))


class YahooApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sessions, _ = session_window(NOW)
        frame = history(sessions)
        cls.payload = acquire(NOW, lambda symbol: SimpleNamespace(history=lambda **_: frame, history_metadata=metadata(symbol)))

    def setUp(self):
        self.directory = Path("backend/.test-work") / str(uuid.uuid4())
        self.directory.mkdir(parents=True)
        self.database = self.directory / "yahoo.sqlite3"
        self.app = create_app(self.database, self.directory / "absent")
        self.client = TestClient(self.app, base_url="http://localhost:8000", raise_server_exceptions=False)
        self.client.__enter__()
        self.headers = {"X-Research-Token": self.client.get("/api/session").json()["token"]}

    def tearDown(self):
        self.client.__exit__(None, None, None)
        shutil.rmtree(self.directory)

    def post(self, payload=None):
        with patch("backend.yahoo.pull", return_value=self.payload if payload is None else payload):
            return self.client.post("/api/providers/yfinance/pull", headers=self.headers, json={"personalUse": True})

    def test_manual_stage_review_checksum_commit_policy_export_lineage_and_original(self):
        response = self.post()
        self.assertEqual(response.status_code, 200, response.text)
        staged = response.json()
        self.assertEqual(staged["run"]["status"], "staged")
        self.assertEqual(self.client.get("/api/state").json()["datasets"], [])
        identifier = staged["run"]["id"]
        original = self.client.get(f"/api/imports/{identifier}/original").content
        self.assertEqual(hashlib.sha256(original).hexdigest(), staged["providerReport"]["originalSha256"])
        snapshot = json.loads(original)
        self.assertEqual(snapshot["symbols"]["EMB"]["history"]["data"][-1]["Close"], staged["preview"][len(staged["preview"]) // 4 - 1]["value"])
        stored = self.client.get(f"/api/imports/{identifier}/preview").json()
        self.assertEqual(stored, staged)
        state = self.client.post(f"/api/imports/{identifier}/commit", headers=self.headers).json()
        self.assertEqual(len(state["datasets"]), 1)
        dataset = state["datasets"][0]
        self.assertTrue(dataset["active"])
        self.assertEqual(dataset["providerReport"], staged["providerReport"])
        self.assertIn("expectedCloseAt", dataset["sessionPolicy"])
        self.assertEqual({row["symbol"] for row in dataset["observations"]}, set(SYMBOLS))
        self.assertTrue(all(row["publishedAt"] is None for row in dataset["observations"]))
        meta = self.client.get(f"/api/datasets/{dataset['id']}/metadata").json()
        self.assertEqual(meta["originalSha256"], staged["providerReport"]["originalSha256"])
        self.assertEqual(meta["providerReport"], staged["providerReport"])
        self.assertEqual(self.client.get("/api/state").json()["providers"][0]["status"], "staged")
        with patch("backend.yahoo.session_policy", return_value={"expectedCloseAt": "2025-07-03T17:00:00Z", "nextCheckAt": "2025-07-07T20:30:00Z", "checkedAt": "2025-07-07T18:00:00Z"}):
            rows = self.client.get("/api/health").json()["observations"]
            self.assertEqual(next(r for r in rows if r["id"] == f"dataset:{dataset['id']}")["status"], "fresh")
        rows = self.client.get("/api/health").json()["observations"]
        self.assertEqual(next(r for r in rows if r["id"] == f"dataset:{dataset['id']}")["status"], "stale")

    def test_failure_preserves_active_history_and_blocks_commit(self):
        staged = self.client.post("/api/imports", headers=self.headers, data={"kind": "market", "source": "fixture", "unit": "USD"},
                                  files={"file": ("test.csv", b"symbol,observed_at,value\nOLD,2024-01-01T00:00:00Z,100\n")}).json()
        before = self.client.post(f"/api/imports/{staged['run']['id']}/commit", headers=self.headers).json()["datasets"]
        payload = {"snapshot": {"adapterVersion": "test", "errors": ["Transport rate limited; no data activated"]}, "observations": []}
        failed = self.post(payload).json()
        self.assertEqual(failed["run"]["status"], "quarantined")
        self.assertEqual(failed["preview"], [])
        self.assertEqual(self.client.get("/api/state").json()["datasets"], before)
        self.assertEqual(self.client.post(f"/api/imports/{failed['run']['id']}/commit", headers=self.headers).status_code, 409)
        state = self.client.get("/api/state").json()
        self.assertEqual(state["providers"][0]["status"], "quarantined")
        self.assertTrue(state["providers"][0]["errors"])
        self.assertIsNone(state["providers"][0]["lastValidatedAt"])

    def test_consent_body_limit_and_mutation_token(self):
        with patch("backend.yahoo.pull") as provider:
            for body in [{}, {"personalUse": False}, {"personalUse": 1}, {"personalUse": True, "symbols": ["SPY"]}]:
                self.assertEqual(self.client.post("/api/providers/yfinance/pull", headers=self.headers, json=body).status_code, 422)
            self.assertEqual(self.client.post("/api/providers/yfinance/pull", json={"personalUse": True}).status_code, 403)
            self.assertEqual(self.client.post("/api/providers/yfinance/pull", headers=self.headers, content=b"x" * 1025).status_code, 413)
            provider.assert_not_called()

    def test_running_guard_cooldown_and_restart_recovery(self):
        store = self.app.state.store
        identifier = store.begin_provider_pull()
        with self.assertRaises(Conflict):
            store.begin_provider_pull()
        state = self.client.get("/api/state").json()
        self.assertEqual(state["providers"][0]["status"], "running")
        store.close()
        store.open()
        state = store.state()
        self.assertEqual(state.providers[0]["status"], "interrupted")
        self.assertTrue(state.providers[0]["errors"])
        self.assertTrue(any(event["event"] == "provider_interrupted" for event in store.audit()))
        with self.assertRaises(Conflict):
            store.begin_provider_pull()
        with closing(connect(self.database)) as conn:
            conn.execute("UPDATE provider_pulls SET started_at='2020-01-01T00:00:00Z' WHERE id=?", (identifier,))
        self.assertNotEqual(store.begin_provider_pull(), identifier)

    def test_concurrent_pull_attempts_allow_only_one_worker(self):
        def start(_):
            try:
                return self.app.state.store.begin_provider_pull()
            except Conflict:
                return None
        with ThreadPoolExecutor(max_workers=3) as executor:
            self.assertEqual(sum(result is not None for result in executor.map(start, range(3))), 1)

    def test_unexpected_internal_error_records_failure_not_stuck_running(self):
        with patch("backend.yahoo.pull", side_effect=RuntimeError("private error")):
            response = self.client.post("/api/providers/yfinance/pull", headers=self.headers, json={"personalUse": True})
        self.assertEqual(response.status_code, 500)
        self.assertNotIn("private", response.text)
        state = self.client.get("/api/state").json()
        self.assertEqual(state["providers"][0]["status"], "interrupted")
        self.assertTrue(state["providers"][0]["errors"])

    def test_source_staging_and_job_completion_are_atomic_on_failure(self):
        store = self.app.state.store
        original = store._finish_provider_pull

        def fail_valid_stage(conn, identifier, report, run):
            if run is not None:
                raise RuntimeError("Injected write failure after source staging")
            original(conn, identifier, report, run)

        with patch.object(store, "_finish_provider_pull", side_effect=fail_valid_stage):
            self.assertEqual(self.post().status_code, 500)
        state = self.client.get("/api/state").json()
        self.assertEqual(state["runs"], [])
        self.assertEqual(state["datasets"], [])
        self.assertEqual(state["providers"][0]["status"], "interrupted")
        with closing(connect(self.database)) as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM originals").fetchone()[0], 0)

    def test_staged_report_survives_restart_backup_and_offline_restore(self):
        from backend.storage import restore_backup

        staged = self.post().json()
        store = self.app.state.store
        store.close()
        store.open()
        self.assertEqual(self.client.get(f"/api/imports/{staged['run']['id']}/preview").json(), staged)
        backup = self.directory / "backup.sqlite3"
        backup.write_bytes(self.client.get("/api/backup").content)
        restored_path = self.directory / "restored.sqlite3"
        restore_backup(backup, restored_path, offline=True)
        restored = Store(restored_path)
        restored.open()
        try:
            self.assertEqual(restored.preview(staged["run"]["id"]).model_dump()["providerReport"], staged["providerReport"])
            self.assertEqual(restored.original(staged["run"]["id"]), store.original(staged["run"]["id"]))
            restored.commit(staged["run"]["id"])
            self.assertEqual(restored.state().datasets[0].providerReport, staged["providerReport"])
        finally:
            restored.close()


if __name__ == "__main__":
    unittest.main()
