"""Synthetic ACLED fixtures test mechanics, never empirical conflict evidence."""

import copy
import hashlib
import io
import json
import os
import sqlite3
import tempfile
import time
import unittest
from contextlib import closing, contextmanager, redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from threading import Event
from unittest.mock import Mock, patch
from urllib.parse import urlencode

import httpx
from fastapi.testclient import TestClient

from backend.acled import (BASE, CONTRACT, TOKEN_URL, Downloader, _BoundedSession, acquire, configured,
                           credentials, event, window)
from backend.acled_storage import AcledStore
from backend.app import create_app
from backend.imf import AcquisitionError
from backend.storage import Conflict, DB_VERSION, Store, verify_backup

START, END = "2026-09-21", "2026-10-20"
ENV = {"ACLED_USERNAME": "synthetic@example.invalid", "ACLED_PASSWORD": "synthetic-password-not-secret"}
TOKEN = "synthetic-access-token"


def native(identifier="FIX1", **changes):
    return {"event_id_cnty": identifier, "event_date": END, "year": "2026", "time_precision": "2",
            "geo_precision": "3", "iso": "268", "country": "Synthetic country", "disorder_type": "Demonstrations",
            "event_type": "Protests", "sub_event_type": "Peaceful protest", "actor1": "Synthetic actor",
            "actor2": "", "location": "Synthetic location", "latitude": "0", "longitude": "0", "fatalities": "0",
            "notes": "<script>synthetic text, never execute</script>", "source": "Synthetic source",
            "source_scale": "National", "timestamp": "1792454400", **changes}


def query(page):
    return {"event_date": START + "|" + END, "event_date_where": "BETWEEN", "limit": "2", "page": str(page),
            "_format": "json", "export_type": "dyadic", "with_total": "true"}


def envelope(rows, total=None):
    return {"success": True, "count": len(rows), "total_count": len(rows) if total is None else total, "data": rows}


class AcledTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, ENV)
        self.env.start()
        self.temp = tempfile.TemporaryDirectory(prefix="econquest-acled-test-")
        self.path = Path(self.temp.name) / "test.sqlite3"
        self.store = Store(self.path)
        self.store.open()
        self.storage = AcledStore(self.store)
        self.page_patches = [patch("backend.acled.PAGE_SIZE", 2), patch("backend.acled_storage.PAGE_SIZE", 2)]
        for item in self.page_patches:
            item.start()

    def tearDown(self):
        for item in self.page_patches:
            item.stop()
        self.store.close()
        self.temp.cleanup()
        self.env.stop()

    def begin(self):
        with self.store.connection() as conn, self.store.transaction(conn):
            conn.execute("UPDATE provider_pulls SET started_at='2020-01-01T00:00:00Z' WHERE provider_id='acled'")
        identifier = self.store.begin_provider_pull("acled")
        self.storage.initialize(identifier, START, END)
        return identifier

    @contextmanager
    def network(self, pages, *, auth_status=200, auth_body=None, data_status=200, transform=None):
        calls = []
        def handle(request):
            calls.append(request)
            if str(request.url) == TOKEN_URL:
                body = auth_body if auth_body is not None else {"token_type": "Bearer", "expires_in": 86400,
                                                               "access_token": TOKEN, "refresh_token": "synthetic-refresh-token"}
                return httpx.Response(auth_status, stream=httpx.ByteStream(json.dumps(body).encode()))
            self.assertEqual(str(request.url).split("?")[0], BASE)
            self.assertEqual(request.headers["Authorization"], "Bearer " + TOKEN)
            page = int(request.url.params["page"])
            data_calls = len(calls) - 1
            body = copy.deepcopy(pages[page - 1])
            if transform:
                body = transform(body, data_calls)
            return httpx.Response(data_status, stream=httpx.ByteStream(json.dumps(body).encode()))
        with httpx.Client(transport=httpx.MockTransport(handle)) as client:
            def stream(method, url, **kwargs):
                self.assertFalse(kwargs.pop("trust_env"))
                return client.stream(method, url, **kwargs)
            with patch("backend.acled.httpx.stream", side_effect=stream):
                yield calls

    def run_acquisition(self, pages, **kwargs):
        identifier = self.begin()
        downloader = Downloader(Event(), lambda *a: self.storage.source(identifier, *a),
                                lambda p: self.storage.progress(identifier, p), START, END)
        with self.network(pages, **kwargs), patch.object(downloader.stop, "wait", return_value=False):
            acquire(downloader, self.storage, identifier)
        return identifier

    def test_utc_window_and_private_configuration(self):
        self.assertTrue(configured())
        with patch("backend.acled.datetime") as clock:
            clock.now.return_value = datetime(2026, 1, 1, tzinfo=timezone.utc)
            self.assertEqual(window(), ("2025-12-02", "2025-12-31"))
        with patch.dict(os.environ, {"ACLED_PASSWORD": ""}):
            self.assertFalse(configured())
            with self.assertRaises(AcquisitionError):
                credentials()

    def test_native_zero_unknown_precision_no_country_guess_and_lossless_types(self):
        raw = native()
        before = copy.deepcopy(raw)
        row = event(raw, START, END, "a" * 64)
        self.assertEqual(row["attributes"], before)
        self.assertEqual(raw, before)
        self.assertEqual(row["fatalities"], 0)
        self.assertEqual(row["latitude"], 0)
        self.assertEqual((row["timePrecision"], row["geoPrecision"]), (2, 3))
        self.assertIsNone(row["publishedAt"])
        self.assertEqual(event(native(fatalities=None, latitude="", longitude=None), START, END, "a" * 64)["fatalities"], None)

    def test_invalid_dates_numbers_precision_and_native_schema_fail(self):
        for changes in [{"event_date": "2026-10-21"}, {"event_date": "2026-02-30"}, {"year": "2025"},
                        {"fatalities": 1.5}, {"fatalities": True}, {"fatalities": "-1"}, {"latitude": "NaN"},
                        {"longitude": 181}, {"time_precision": "4"}, {"geo_precision": ""},
                        {"country": ""}, {"timestamp": "bad"}, {"notes": {"nested": True}}]:
            with self.subTest(changes=changes), self.assertRaises(AcquisitionError):
                event(native(**changes), START, END, "a" * 64)

    def test_actual_package_two_paginated_reads_exact_counts_and_no_credentials_in_storage(self):
        pages = [envelope([native("FIX1"), native("FIX2")], 3), envelope([native("FIX3")], 3)]
        initial = self.store.state().model_dump()
        identifier = self.run_acquisition(pages)
        run = self.storage.get(identifier)
        self.assertEqual((run["status"], run["active"], run["report"]["rowCount"]), ("staged", False, 3))
        self.assertTrue(run["report"]["consistencyVerified"])
        self.assertEqual(len(run["sources"]), 4)
        self.assertEqual(len(run["chunks"]), 2)
        self.assertEqual(self.storage.page(identifier)["rows"][0]["attributes"]["year"], "2026")
        content = self.storage.original(identifier, 1)
        self.assertEqual(hashlib.sha256(content).hexdigest(), run["sources"][0]["sha256"])
        for secret in [*ENV.values(), TOKEN, "synthetic-refresh-token"]:
            self.assertNotIn(secret, json.dumps(run))
            self.assertNotIn(secret.encode(), content)
        self.storage.activate(identifier)
        self.assertTrue(self.storage.get(identifier)["active"])
        self.storage.rollback(identifier)
        self.assertFalse(self.storage.get(identifier)["active"])
        for key in ("datasets", "runs", "macro", "weo", "worldbank", "fred", "bis", "ids", "comtrade", "gdelt"):
            self.assertEqual(self.store.state().model_dump()[key], initial[key])
        exported = [json.loads(line) for line in self.storage.export(identifier)]
        self.assertEqual(len(exported), 4)
        self.assertEqual(exported[0]["type"], "manifest")

    def test_short_pages_count_mismatch_duplicates_and_provider_errors_block_staging(self):
        cases = [
            [envelope([native()], 3)], [envelope([native(), native()], 2)],
            [{**envelope([native()]), "count": 2}], [{**envelope([native()]), "success": False}],
            [envelope([native()], 200001)],
        ]
        for pages in cases:
            identifier = self.begin()
            downloader = Downloader(Event(), lambda *a: self.storage.source(identifier, *a), Mock(), START, END)
            with self.subTest(pages=pages), self.network(pages), patch.object(downloader.stop, "wait", return_value=False), \
                 self.assertRaises(AcquisitionError):
                acquire(downloader, self.storage, identifier)
            self.storage.fail(identifier, "Synthetic invalid page")
            with self.assertRaises(Conflict):
                self.storage.activate(identifier)

    def test_native_revision_or_total_change_between_reads_blocks_snapshot(self):
        for change in ("native", "total"):
            identifier = self.begin()
            downloader = Downloader(Event(), lambda *a: self.storage.source(identifier, *a), Mock(), START, END)
            def transform(body, count):
                if count > 1:
                    if change == "native":
                        body["data"][0]["fatalities"] = "1"
                    else:
                        body["total_count"] = 2
                return body
            with self.network([envelope([native()])], transform=transform), patch.object(downloader.stop, "wait", return_value=False), \
                 self.assertRaisesRegex(AcquisitionError, "changed|revised"):
                acquire(downloader, self.storage, identifier)
            self.storage.fail(identifier, "Synthetic revision")
            self.assertEqual(self.storage.page(identifier)["rows"][0]["fatalities"], 0)
            self.assertFalse(self.storage.get(identifier)["report"]["transportComplete"])

    def test_auth_failure_and_data_401_429_have_no_retry_or_token_persistence(self):
        for auth_status, data_status in ((401, 200), (200, 401), (200, 429)):
            identifier = self.begin()
            downloader = Downloader(Event(), lambda *a: self.storage.source(identifier, *a), Mock(), START, END)
            logs = io.StringIO()
            with self.network([envelope([native()])], auth_status=auth_status, data_status=data_status) as calls, \
                 patch.object(downloader.stop, "wait", return_value=False), redirect_stdout(logs), \
                 self.assertRaisesRegex(AcquisitionError, "HTTP"):
                acquire(downloader, self.storage, identifier)
            self.assertEqual(len(calls), 1 if auth_status != 200 else 2)
            self.assertEqual(len(self.storage.get(identifier)["sources"]), 0 if auth_status != 200 else 1)
            for secret in [*ENV.values(), TOKEN]:
                self.assertNotIn(secret, logs.getvalue())
            self.storage.fail(identifier, "Synthetic denied access")

    def test_credential_echo_suppressed_and_invalid_token_not_retained(self):
        identifier = self.begin()
        downloader = Downloader(Event(), lambda *a: self.storage.source(identifier, *a), Mock(), START, END)
        with self.network([envelope([native(notes=ENV["ACLED_PASSWORD"])])]), patch.object(downloader.stop, "wait", return_value=False), \
             self.assertRaisesRegex(AcquisitionError, "echoed"):
            acquire(downloader, self.storage, identifier)
        self.assertEqual(self.storage.get(identifier)["sources"], [])
        self.storage.fail(identifier, "Synthetic echoed credential")
        identifier = self.begin()
        downloader = Downloader(Event(), Mock(), Mock(), START, END)
        with self.network([], auth_body={"token_type": 123}), self.assertRaisesRegex(AcquisitionError, "token contract"):
            downloader.authenticate()
        downloader.save.assert_not_called()
        self.storage.fail(identifier, "Synthetic token contract")

    def test_cancellation_deadline_response_and_request_budgets(self):
        downloader = Downloader(Event(), Mock(), Mock(), START, END)
        downloader.stop.set()
        with self.assertRaisesRegex(AcquisitionError, "cancelled"):
            downloader.authenticate()
        downloader = Downloader(Event(), Mock(), Mock(), START, END)
        downloader.count = 100
        with patch.object(downloader.stop, "wait", return_value=False), self.assertRaisesRegex(AcquisitionError, "budget"):
            downloader.authenticate()
        downloader = Downloader(Event(), Mock(), Mock(), START, END)
        downloader.deadline = time.monotonic() - 1
        with self.assertRaisesRegex(AcquisitionError, "deadline"):
            downloader.check()
        downloader = Downloader(Event(), Mock(), Mock(), START, END)
        downloader.token, downloader.expires = TOKEN, time.monotonic() + 60
        with self.network([envelope([native()])]), patch("backend.acled.MAX_RESPONSE", 10), \
             self.assertRaisesRegex(AcquisitionError, "byte budget"):
            downloader.page(query(1))
        self.assertTrue(downloader.save.call_args.args[0].endswith("#incomplete-response"))

    def test_library_route_and_query_are_allowlisted(self):
        downloader = Downloader(Event(), Mock(), Mock(), START, END)
        with _BoundedSession(downloader) as session:
            for url, params in [("https://example.com", query(1)), (BASE, {**query(1), "key": "never"}),
                                (BASE, {**query(1), "export_type": "monadic"}), (BASE, {**query(1), "event_date": "1997-01-01"})]:
                with self.assertRaises(AcquisitionError):
                    session.get(url, params=params)
        downloader.save.assert_not_called()

    def test_restart_and_immutability_preserve_partial_and_prevent_activation(self):
        identifier = self.begin()
        body = json.dumps(envelope([native()])).encode()
        self.storage.source(identifier, BASE + "?" + urlencode(query(1)), 200, body)
        self.storage.chunk(identifier, 1, [event(native(), START, END, hashlib.sha256(body).hexdigest())])
        with self.store.connection() as conn:
            for table in ("acled_sources", "acled_rows", "acled_chunks"):
                with self.assertRaises(sqlite3.IntegrityError):
                    conn.execute(f"DELETE FROM {table} WHERE run_id=?", (identifier,))
        self.store.close()
        self.store.open()
        run = self.storage.get(identifier)
        self.assertEqual(run["status"], "interrupted")
        self.assertEqual(run["report"]["rowCount"], 1)
        self.assertEqual(self.storage.original(identifier, 1), body)
        with self.assertRaises(Conflict):
            self.storage.activate(identifier)
        verify_backup(self.path)

    def test_rollback_skips_withdrawn_predecessor_and_consistent_export(self):
        first = self.run_acquisition([envelope([native()])])
        self.storage.activate(first)
        second = self.run_acquisition([envelope([native("FIX2")])])
        self.storage.activate(second)
        self.storage.rollback(first)
        self.storage.rollback(second)
        self.assertFalse(self.storage.get(first)["active"])
        self.assertFalse(self.storage.get(second)["active"])
        exported = self.storage.export(first)
        manifest = json.loads(next(exported))
        self.assertEqual(manifest["report"]["rowCount"], 1)
        self.assertEqual(len(list(exported)), 1)

    def test_schema11_upgrade_and_backup_gate(self):
        self.store.close()
        with closing(sqlite3.connect(self.path)) as conn:
            for table in ("analysis_bundles", "acled_rows", "acled_chunks", "acled_sources", "acled_runs"):
                conn.execute(f"DROP TABLE {table}")
            conn.execute("PRAGMA user_version=11")
            conn.commit()
        self.store.open()
        with self.store.connection() as conn:
            self.assertEqual(conn.execute("PRAGMA user_version").fetchone()[0], DB_VERSION)
        self.assertEqual(len(self.store.state().providers), 10)
        verify_backup(self.path)


class ApiTests(unittest.TestCase):
    def test_capability_private_configuration_consent_worker_failure_and_boundaries(self):
        with tempfile.TemporaryDirectory(prefix="econquest-acled-api-") as folder:
            app = create_app(Path(folder) / "api.sqlite3", Path(folder) / "absent")
            with TestClient(app, base_url="http://localhost:8000", raise_server_exceptions=False) as client:
                headers = {"X-Research-Token": client.get("/api/session").json()["token"]}
                response = client.get("/api/providers/acled/config")
                self.assertEqual(response.json()["contractVersion"], CONTRACT)
                self.assertEqual(response.headers["cache-control"], "no-store")
                self.assertNotIn("password", response.text)
                self.assertEqual(client.post("/api/providers/acled/pull", json={"researchUse": True}).status_code, 403)
                for body in ({}, {"researchUse": False}, {"researchUse": 1}, {"researchUse": True, "country": "x"}):
                    self.assertEqual(client.post("/api/providers/acled/pull", headers=headers, json=body).status_code, 422)
                self.assertEqual(client.post("/api/providers/acled/pull", headers=headers, content=b"x" * 1025).status_code, 413)
                with patch.dict(os.environ, {"ACLED_PASSWORD": ""}):
                    self.assertEqual(client.post("/api/providers/acled/pull", headers=headers, json={"researchUse": True}).status_code, 503)
                    self.assertEqual(client.get("/api/state").json()["acled"], [])
                with patch.dict(os.environ, ENV), patch("backend.acled.acquire", side_effect=AcquisitionError("Synthetic missing page")):
                    response = client.post("/api/providers/acled/pull", headers=headers, json={"researchUse": True})
                    self.assertEqual(response.status_code, 202, response.text)
                    identifier = response.json()["id"]
                    for _ in range(100):
                        run = client.get(f"/api/acled/{identifier}").json()
                        if run["status"] != "running":
                            break
                        time.sleep(0.01)
                self.assertEqual(run["status"], "interrupted")
                self.assertEqual(run["report"]["errors"], ["Synthetic missing page"])
                self.assertEqual(client.post(f"/api/acled/{identifier}/commit", headers=headers).status_code, 409)
                self.assertEqual(client.post(f"/api/providers/acled/{identifier}/cancel", headers=headers).status_code, 409)
                for query_string in ("offset=-1", "limit=501", "country=" + "x" * 201, "event_type=%00"):
                    self.assertEqual(client.get(f"/api/acled/{identifier}/events?{query_string}").status_code, 422)
                self.assertEqual(client.get(f"/api/acled/{identifier}/events?country=Unknown").json()["country"], "Unknown")
                self.assertEqual(json.loads(client.get(f"/api/acled/{identifier}/export").text)["type"], "manifest")
                self.assertEqual(client.get(f"/api/acled/{identifier}/sources/1").status_code, 404)
