"""Synthetic fixtures exercise provider mechanics, not empirical event evidence."""

import hashlib
import io
import json
import os
import sqlite3
import subprocess
import tempfile
import time
import unittest
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from threading import Event
from unittest.mock import Mock, patch

import httpx
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.gdelt import BASE, COLUMNS, CONTRACT, Downloader, decode, intervals, latest_day, record, safe_url
from backend.gdelt_storage import GdeltStore
from backend.imf import AcquisitionError
from backend.storage import Conflict, DB_VERSION, Store, verify_backup

DAY = "2026-10-20"


def cells(interval="20261020000000", identifier="123"):
    raw = dict.fromkeys(COLUMNS, "")
    raw.update(GLOBALEVENTID=identifier, SQLDATE="20251020", MonthYear="202510", Year="2025",
               EventCode="010", EventBaseCode="010", EventRootCode="01", QuadClass="1", IsRootEvent="0",
               Actor1CountryCode="USA", Actor1Name='SYNTHETIC "ACTOR"', ActionGeo_CountryCode="RS", ActionGeo_Type="1",
               GoldsteinScale="0", AvgTone="-2.5", NumMentions="0", NumSources="1", NumArticles="2",
               DATEADDED=interval, SOURCEURL="https://example.com/synthetic-not-evidence")
    return [raw[c] for c in COLUMNS]


def archive(rows):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("fixture.export.CSV", "\n".join("\t".join(r) for r in rows))
    return out.getvalue()


class ParserTests(unittest.TestCase):
    def test_exact_day_scope_and_utc_boundary(self):
        values = intervals(DAY)
        self.assertEqual(len(set(values)), 96)
        self.assertEqual((values[0], values[-1]), ("20261020000000", "20261020234500"))
        with patch("backend.gdelt.datetime") as clock:
            clock.now.return_value = datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)
            self.assertEqual(latest_day(), "2025-12-31")

    def test_installed_package_lossless_leading_zero_quotes_empty_and_prior_year(self):
        original = cells()
        self.assertEqual(decode(archive([original])), [original])
        row = record(original, "20261020000000", "a" * 64)
        self.assertEqual(row["eventCode"], "010")
        self.assertEqual(row["eventDate"], "2025-10-20")
        self.assertEqual(row["country"], "RS")
        self.assertIsNone(row["latitude"])
        self.assertIsNone(row["publishedAt"])
        self.assertEqual(row["mentions"], 0)
        self.assertEqual(row["attributes"], dict(zip(COLUMNS, original)))

    def test_bad_archive_schema_and_no_silent_row_drop(self):
        for content in (b"not a ZIP", archive([cells()[:-1]]), archive([cells() + ["extra"]]),
                        archive([["\x00"] * 61]), archive([cells(), cells()[:-1]])):
            with self.subTest(size=len(content)), self.assertRaises(AcquisitionError):
                decode(content)
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as z:
            z.writestr("a", "x")
            z.writestr("b", "y")
        with self.assertRaises(AcquisitionError):
            decode(out.getvalue())
        self.assertEqual(decode(archive([])), [])

    def test_invalid_native_dimensions_domain_and_dates_rejected(self):
        for field, value in [("EventCode", "1"), ("SQLDATE", "20261021"), ("Year", "2026"), ("DATEADDED", "20261020001500"),
                             ("GoldsteinScale", "NaN"), ("AvgTone", "101"), ("ActionGeo_Lat", "91"),
                             ("NumMentions", "-1"), ("QuadClass", "0"), ("Actor1CountryCode", "US"),
                             ("ActionGeo_CountryCode", "USA"), ("EventRootCode", "20")]:
            row = cells()
            row[COLUMNS.index(field)] = value
            with self.subTest(field=field), self.assertRaises(AcquisitionError):
                record(row, "20261020000000", "a" * 64)

    def test_source_urls_are_retained_without_unsafe_links(self):
        for url in ["javascript:alert(1)", "data:text/html,bad", "https://a:b@example.com", "https://example.com/\nfoo", "//example.com"]:
            row = cells()
            row[-1] = url
            result = record(row, "20261020000000", "a" * 64)
            self.assertEqual(result["sourceUrl"], url)
            self.assertFalse(result["sourceUrlSafe"])
        self.assertTrue(safe_url("https://example.com/article"))

    def test_decoder_has_no_provider_keys_and_explicit_failure(self):
        completed = subprocess.CompletedProcess([], 0, stdout=b'{"rows":[]}', stderr=b"")
        with patch.dict(os.environ, {"FRED_API_KEY": "synthetic", "COMTRADE_API_KEY": "synthetic"}), \
             patch("backend.gdelt.subprocess.run", return_value=completed) as runner:
            self.assertEqual(decode(b"fixture"), [])
            env = runner.call_args.kwargs["env"]
            self.assertNotIn("FRED_API_KEY", env)
            self.assertNotIn("COMTRADE_API_KEY", env)
            self.assertEqual(runner.call_args.args[0][-1], "backend.gdelt_worker")
        for stdout, returncode in [(b"bad", 0), (b'{"rows":[]}', 1), (b'{"error":"failed"}', 0)]:
            with patch("backend.gdelt.subprocess.run", return_value=subprocess.CompletedProcess([], returncode, stdout=stdout)), \
                 self.assertRaises(AcquisitionError):
                decode(b"fixture")

    def test_transport_scope_cancel_http_error_original_and_size_limits(self):
        captured = []
        downloader = Downloader(Event(), lambda *a: captured.append(a), Mock())
        transport = httpx.MockTransport(lambda request: httpx.Response(404, stream=httpx.ByteStream(b"missing archive")))
        with httpx.Client(transport=transport) as client, patch("backend.gdelt.httpx.stream", client.stream):
            with self.assertRaisesRegex(AcquisitionError, "HTTP 404"):
                downloader.get("20261020000000")
        self.assertEqual(captured, [(BASE + "20261020000000.export.CSV.zip", 404, b"missing archive")])
        downloader.stop.set()
        with self.assertRaisesRegex(AcquisitionError, "cancelled"):
            downloader.get("20261020001500")
        downloader = Downloader(Event(), lambda *a: captured.append(a), Mock())
        transport = httpx.MockTransport(lambda request: httpx.Response(200, stream=httpx.ByteStream(b"1234567890")))
        with httpx.Client(transport=transport) as client, patch("backend.gdelt.httpx.stream", client.stream), patch("backend.gdelt.MAX_RESPONSE", 5):
            with self.assertRaisesRegex(AcquisitionError, "byte limit"):
                downloader.get("20261020000000")
        self.assertEqual(captured[-1][2], b"12345")
        self.assertTrue(captured[-1][0].endswith("#incomplete-response"))

    def test_transport_deadline_request_cap_truncation_and_timeout_have_no_retry(self):
        downloader = Downloader(Event(), Mock(), Mock())
        downloader.deadline = time.monotonic() - 1
        with self.assertRaisesRegex(AcquisitionError, "deadline"):
            downloader.check()
        downloader = Downloader(Event(), Mock(), Mock())
        downloader.count = 96
        with patch("backend.gdelt.httpx.stream") as stream, self.assertRaisesRegex(AcquisitionError, "request budget"):
            downloader.get("20261020000000")
        stream.assert_not_called()
        downloader = Downloader(Event(), Mock(), Mock())
        with patch("backend.gdelt.httpx.stream", side_effect=httpx.ReadTimeout("synthetic")) as stream, \
             self.assertRaisesRegex(AcquisitionError, "no automatic retry"):
            downloader.get("20261020000000")
        self.assertEqual(stream.call_count, 1)
        downloader = Downloader(Event(), Mock(), Mock())
        transport = httpx.MockTransport(lambda request: httpx.Response(200, headers={"Content-Length": "100"},
                                                                       stream=httpx.ByteStream(b"short")))
        with httpx.Client(transport=transport) as client, patch("backend.gdelt.httpx.stream", client.stream), \
             self.assertRaisesRegex(AcquisitionError, "truncated"):
            downloader.get("20261020000000")
        self.assertEqual(downloader.save.call_args.args[-1], b"short")

    def test_decoder_timeout_expansion_and_crc_limits_are_explicit(self):
        with patch("backend.gdelt.subprocess.run", side_effect=subprocess.TimeoutExpired("synthetic", 20)), \
             self.assertRaisesRegex(AcquisitionError, "20-second"):
            decode(b"fixture")
        from backend.gdelt_worker import decode as strict_decode
        with patch("backend.gdelt_worker.MAX_COMPRESSED", 1), self.assertRaisesRegex(ValueError, "compressed"):
            strict_decode(b"too long")
        content = archive([cells()])
        with patch("backend.gdelt_worker.MAX_EXPANDED", 1), self.assertRaisesRegex(ValueError, "expanded"):
            strict_decode(content)
        corrupt = bytearray(content)
        with zipfile.ZipFile(io.BytesIO(content)) as z:
            member = z.infolist()[0]
            position = 30 + len(member.filename.encode()) + len(member.extra)
        corrupt[position + 5] ^= 1
        with self.assertRaises(AcquisitionError):
            decode(bytes(corrupt))


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="econquest-gdelt-test-")
        self.path = Path(self.temp.name) / "test.sqlite3"
        self.store = Store(self.path)
        self.store.open()
        self.gdelt = GdeltStore(self.store)

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def run_id(self):
        identifier = self.store.begin_provider_pull("gdelt")
        self.gdelt.initialize(identifier, DAY)
        return identifier

    def chunk(self, identifier, index=0):
        interval = intervals(DAY)[index]
        content = archive([cells(interval, str(index + 1))])
        sha = hashlib.sha256(content).hexdigest()
        self.gdelt.source(identifier, BASE + interval + ".export.CSV.zip", 200, content)
        self.gdelt.chunk(identifier, interval, [record(cells(interval, str(index + 1)), interval, sha)])
        return content

    def complete(self):
        identifier = self.run_id()
        for index in range(96):
            self.chunk(identifier, index)
        self.gdelt.finish(identifier)
        return identifier

    def test_95_intervals_cannot_stage_partial_fail_and_original_immutable(self):
        identifier = self.run_id()
        for index in range(95):
            self.chunk(identifier, index)
        with self.assertRaisesRegex(Conflict, "all 96"):
            self.gdelt.finish(identifier)
        with self.assertRaises(Conflict):
            self.gdelt.activate(identifier)
        with self.store.connection() as conn:
            for table in ("gdelt_sources", "gdelt_chunks", "gdelt_rows"):
                with self.assertRaises(sqlite3.IntegrityError):
                    conn.execute(f"DELETE FROM {table} WHERE run_id=?", (identifier,))
        self.gdelt.fail(identifier, "synthetic missing interval")
        run = self.gdelt.get(identifier)
        self.assertEqual(run["report"]["completedIntervals"], 95)
        self.assertEqual(run["status"], "interrupted")
        self.assertEqual(len(self.gdelt.original(identifier, 1)) > 0, True)
        self.assertFalse(run["active"])

    def test_duplicate_ids_and_provenance_fail_transactionally(self):
        identifier = self.run_id()
        self.chunk(identifier)
        with self.assertRaises(Conflict):
            self.chunk(identifier)
        interval = intervals(DAY)[1]
        content = archive([cells(interval)])
        self.gdelt.source(identifier, BASE + interval + ".export.CSV.zip", 200, content)
        row = record(cells(interval), interval, "b" * 64)
        with self.assertRaisesRegex(Conflict, "provenance"):
            self.gdelt.chunk(identifier, interval, [row])
        row["sourceHash"] = hashlib.sha256(content).hexdigest()
        row["eventId"] = "1"
        with self.assertRaisesRegex(Conflict, "duplicate"):
            self.gdelt.chunk(identifier, interval, [row])
        self.assertEqual(self.gdelt.get(identifier)["report"]["rowCount"], 1)

    def test_complete_day_independent_activation_withdrawn_predecessor_and_export(self):
        original_state = self.store.state().model_dump()
        first = self.complete()
        self.assertFalse(self.gdelt.get(first)["active"])
        self.gdelt.activate(first)
        with self.store.connection() as conn, self.store.transaction(conn):
            conn.execute("UPDATE provider_pulls SET started_at='2020-01-01T00:00:00Z' WHERE id=?", (first,))
        second = self.complete()
        self.gdelt.activate(second)
        self.gdelt.rollback(first)
        self.gdelt.rollback(second)
        self.assertFalse(self.gdelt.get(first)["active"])
        self.assertFalse(self.gdelt.get(second)["active"])
        page = self.gdelt.page(first, country="RS", root="01", offset=90, limit=100)
        self.assertEqual((page["total"], len(page["rows"]), page["country"], page["runId"]), (96, 6, "RS", first))
        self.assertEqual(self.gdelt.page(first, country="UNKNOWN")["total"], 0)
        exported = [json.loads(line) for line in self.gdelt.export(first)]
        self.assertEqual(len(exported), 97)
        self.assertEqual(exported[0]["type"], "manifest")
        self.assertEqual(exported[1]["data"]["attributes"]["EventCode"], "010")
        for key in ("datasets", "macro", "weo", "worldbank", "ids", "fred", "bis", "comtrade"):
            self.assertEqual(self.store.state().model_dump()[key], original_state[key])

    def test_restart_preserves_original_and_rows_but_blocks_activation(self):
        identifier = self.run_id()
        original = self.chunk(identifier)
        self.store.close()
        self.store.open()
        run = self.gdelt.get(identifier)
        self.assertEqual(run["status"], "interrupted")
        self.assertEqual(run["report"]["rowCount"], 1)
        self.assertEqual(self.gdelt.original(identifier, 1), original)
        with self.assertRaises(Conflict):
            self.gdelt.activate(identifier)
        verify_backup(self.path)

    def test_export_manifest_and_rows_share_one_read_snapshot_during_new_chunk(self):
        identifier = self.run_id()
        self.chunk(identifier)
        exported = self.gdelt.export(identifier)
        manifest = json.loads(next(exported))
        self.chunk(identifier, 1)
        records = [json.loads(line) for line in exported]
        self.assertEqual(manifest["report"]["rowCount"], 1)
        self.assertEqual(len(manifest["sources"]), 1)
        self.assertEqual(len(records), 1)
        self.assertEqual(self.gdelt.get(identifier)["report"]["rowCount"], 2)

    def test_schema10_upgrade_keeps_existing_providers(self):
        self.store.close()
        with sqlite3.connect(self.path) as conn:
            for table in ("acled_rows", "acled_chunks", "acled_sources", "acled_runs",
                          "gdelt_rows", "gdelt_chunks", "gdelt_sources", "gdelt_runs"):
                conn.execute(f"DROP TABLE {table}")
            conn.execute("PRAGMA user_version=10")
        self.store.open()
        self.assertEqual(len(self.store.state().providers), 10)
        with self.store.connection() as conn:
            self.assertEqual(conn.execute("PRAGMA user_version").fetchone()[0], DB_VERSION)
        self.assertEqual(self.store.state().gdelt, [])


class ApiTests(unittest.TestCase):
    def test_capability_consent_security_worker_failure_filters_and_exports(self):
        with tempfile.TemporaryDirectory(prefix="econquest-gdelt-api-") as folder:
            app = create_app(Path(folder) / "test.sqlite3", Path(folder) / "absent")
            with TestClient(app, base_url="http://localhost:8000") as client:
                headers = {"X-Research-Token": client.get("/api/session").json()["token"]}
                config = client.get("/api/providers/gdelt/config")
                self.assertEqual(config.json()["contractVersion"], CONTRACT)
                self.assertFalse(config.json()["requiresKey"])
                self.assertEqual(config.headers["cache-control"], "no-store")
                self.assertEqual(client.post("/api/providers/gdelt/pull", json={"researchUse": True}).status_code, 403)
                for body in ({}, {"researchUse": False}, {"researchUse": 1}, {"researchUse": True, "country": "US"}):
                    self.assertEqual(client.post("/api/providers/gdelt/pull", headers=headers, json=body).status_code, 422)
                self.assertEqual(client.post("/api/providers/gdelt/pull", headers=headers, content=b"x" * 1025).status_code, 413)
                with patch("backend.gdelt.acquire", side_effect=AcquisitionError("synthetic interval missing")):
                    response = client.post("/api/providers/gdelt/pull", headers=headers, json={"researchUse": True})
                    self.assertEqual(response.status_code, 202)
                    identifier = response.json()["id"]
                    for _ in range(100):
                        run = client.get(f"/api/gdelt/{identifier}").json()
                        if run["status"] != "running":
                            break
                        time.sleep(0.01)
                self.assertEqual(run["status"], "interrupted")
                self.assertEqual(run["report"]["errors"], ["synthetic interval missing"])
                self.assertEqual(client.post(f"/api/gdelt/{identifier}/commit", headers=headers).status_code, 409)
                self.assertEqual(client.post(f"/api/providers/gdelt/{identifier}/cancel", headers=headers).status_code, 409)
                for query in ("country=USA", "country=rs", "root=00", "root=21", "offset=-1", "limit=501"):
                    self.assertEqual(client.get(f"/api/gdelt/{identifier}/events?{query}").status_code, 422)
                page = client.get(f"/api/gdelt/{identifier}/events?country=UNKNOWN").json()
                self.assertEqual((page["country"], page["runId"], page["rows"]), ("UNKNOWN", identifier, []))
                exported = client.get(f"/api/gdelt/{identifier}/export")
                self.assertEqual(json.loads(exported.text)["type"], "manifest")
                self.assertEqual(client.get(f"/api/gdelt/{identifier}/sources/1").status_code, 404)
                self.assertEqual(len(client.get("/api/state").json()["providers"]), 10)
