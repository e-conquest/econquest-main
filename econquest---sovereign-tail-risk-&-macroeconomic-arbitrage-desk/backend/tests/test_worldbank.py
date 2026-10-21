import hashlib
import json
import shutil
import unittest
import uuid
from contextlib import closing, contextmanager
from pathlib import Path
from threading import Event
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import httpx
import requests
import wbgapi as wb
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.imf import AcquisitionError
from backend.storage import Conflict, Store, connect, verify_backup, restore_backup
from backend.weo_storage import WeoStore
from backend.worldbank import BASE, INDICATORS, Downloader, acquire


def fixture(path):
    if path == "source/2":
        rows = [{"id": "2", "name": "World Development Indicators", "lastupdated": "2026-10-08"}]
    elif path == "country":
        rows = [{"id": f"{chr(65+i//26)}{chr(65+i%26)}X", "iso2Code": f"{chr(65+i//26)}{chr(65+i%26)}",
                 "name": f"Fixture economy {i}", "region": {"id": "LCN", "value": "Fixture region"},
                 "incomeLevel": {}, "lendingType": {}} for i in range(150)]
        rows += [{"id": "HIC", "iso2Code": "XD", "name": "High income", "region": {"id": "NA", "value": "Aggregates"}}]
    elif path == "sources/2/country":
        rows = [{"id": c["id"], "value": c["name"]} for c in fixture("country")[1]]
        return {"page": 1, "pages": 1, "per_page": 20000, "total": len(rows),
                "source": [{"id": "2", "concept": [{"id": "country", "variable": rows}]}]}
    elif path == "indicator":
        rows = [{"id": code, "name": name, "unit": "", "source": {"id": "2"}, "sourceNote": "Synthetic fixture, not empirical.",
                 "sourceOrganization": "Test fixture"} for code, name in INDICATORS.items()]
    else:
        code = path.rsplit("/", 1)[1]
        rows = [{"indicator": {"id": code, "value": INDICATORS[code]}, "country": {"id": "AA", "value": "Fixture economy 0"},
                 "countryiso3code": "AAX", "date": str(year), "value": value, "unit": "", "obs_status": status,
                 "decimal": 1, "footnote": note} for year, value, status, note in
                [(2023, -1.25, "", ""), (2024, None, "", ""), (2025, 2.25, "unmapped", "Methodology changed")]]
        rows += [{**rows[0], "country": {"id": "XD", "value": "High income"}, "countryiso3code": "", "value": 1000}]
    return [{"page": 1, "pages": 1, "per_page": 20000, "total": len(rows),
             **({"sourceid": "2", "lastupdated": "2026-10-08"} if path.startswith("country/all/") else {})}, rows]


class WorldBankParserTests(unittest.TestCase):
    def run_fixture(self, change=None):
        saved = []

        @contextmanager
        def stream(method, url, **options):
            self.assertEqual(options["timeout"], 20)
            self.assertFalse(options["follow_redirects"])
            path = urlsplit(url).path.removeprefix("/v2/en/")
            data = fixture(path)
            if change:
                change(path, data)
            yield httpx.Response(200, content=json.dumps(data).encode())

        downloader = Downloader(Event(), lambda *args: saved.append(args), lambda p: None)
        with patch("backend.worldbank.httpx.stream", stream), patch("requests.get", side_effect=AssertionError("Global requests must not be used")):
            result = acquire(downloader, lambda p: None)
        return result, saved

    def test_all_approved_definitions_membership_native_values_gaps_and_unknown_flags(self):
        before = wb.requests
        result, saved = self.run_fixture()
        self.assertIs(wb.requests, before)
        self.assertIs(wb.requests, requests)
        report = result["report"]
        self.assertEqual(len(report["indicators"]), 17)
        self.assertNotIn("GC.BAL.CASH.GD.ZS", {i["code"] for i in report["indicators"]})
        self.assertEqual(len(report["countries"]), 150)
        self.assertEqual(report["requiredPairs"], 2550)
        self.assertEqual(report["absentPairs"], 2533)
        self.assertEqual(len(result["records"]), 51)
        self.assertEqual([r["value"] for r in result["records"][:3]], [-1.25, None, 2.25])
        self.assertEqual(result["records"][2]["status"], "unmapped")
        self.assertEqual(result["series"][0]["missingYears"], [2024])
        self.assertTrue(result["series"][0]["analysisBlocked"])
        hashes = {hashlib.sha256(content).hexdigest() for _, _, content in saved}
        self.assertTrue(all(r["sourceHash"] in hashes for r in result["records"]))
        self.assertTrue(all(r["classification"] == "reported_unverified" for r in result["records"]))
        self.assertEqual(len(saved), 21)

    def test_wrong_source_definition_membership_identity_duplicates_values_and_years_rejected(self):
        def data_change(key, value):
            def change(path, data):
                if path.startswith("country/all/"):
                    data[1][0][key] = value
            return change

        def duplicate(path, data):
            if path.startswith("country/all/"):
                data[1][1] = data[1][0]

        def definition(path, data):
            if path == "indicator":
                data[1][0]["name"] = "Changed definition"

        def source(path, data):
            if path.startswith("country/all/"):
                data[0]["sourceid"] = "1"

        def vintage(path, data):
            if path.endswith("NY.GDP.MKTP.CD"):
                data[0]["lastupdated"] = "2026-10-09"

        def invalid_date(path, data):
            if path == "source/2":
                data[1][0]["lastupdated"] = "2026-02-31"

        def invalid_page(path, data):
            if path == "indicator":
                data[0]["page"] = True

        for change in (data_change("value", float("nan")), data_change("value", True), data_change("date", "2024M01"),
                       data_change("date", "2099"), data_change("countryiso3code", "ZZZ"),
                       data_change("countryiso3code", ""), data_change("decimal", None), duplicate, definition, source, vintage, invalid_date, invalid_page):
            with self.subTest(change=change), self.assertRaises(AcquisitionError):
                self.run_fixture(change)
            self.assertIs(wb.requests, requests)

    def test_fixed_host_consent_scope_cancel_deadline_and_request_budget_no_network(self):
        d = Downloader(Event(), lambda *a: None, lambda p: None)
        for url in ("https://evil.test/country", BASE + "indicator?format=json&source=9", BASE + "secrets?format=json"):
            with self.assertRaises(AcquisitionError):
                d.get(url)
        with patch("backend.worldbank.httpx.stream") as request:
            d.stop.set()
            with self.assertRaisesRegex(AcquisitionError, "cancelled"):
                d.get(BASE + "country?format=json")
            d.stop.clear(); d.deadline = 0
            with self.assertRaisesRegex(AcquisitionError, "deadline"):
                d.check()
            d.deadline = float("inf"); d.count = 128
            with self.assertRaisesRegex(AcquisitionError, "budget"):
                d.get(BASE + "country?format=json")
        request.assert_not_called()

    def test_error_envelope_pagination_http_budget_and_transport_failures_capture_evidence(self):
        url = BASE + "country?format=json&page=1&per_page=20000"
        bad = [
            (200, json.dumps([{"message": [{"id": "120"}]}]).encode()),
            (200, b"not JSON"),
            (429, b"Rate limited"),
            (200, json.dumps([{"page": 2, "pages": 2, "per_page": 20000, "total": 20001}, [{}]]).encode()),
            (200, json.dumps([{"page": 1, "pages": 1, "per_page": 20000, "total": 2}, [{}]]).encode()),
        ]
        for status, content in bad:
            saved = []
            @contextmanager
            def stream(*a, **kw):
                yield httpx.Response(status, content=content)
            d = Downloader(Event(), lambda *a: saved.append(a), lambda p: None)
            with patch("backend.worldbank.httpx.stream", stream), self.assertRaises(AcquisitionError):
                d.get(url)
            self.assertEqual(saved[0][1:], (status, content))
        with patch("backend.worldbank.httpx.stream", side_effect=httpx.ReadTimeout("fixture")), self.assertRaisesRegex(AcquisitionError, "ReadTimeout"):
            Downloader(Event(), lambda *a: None, lambda p: None).get(url)
        saved = []
        @contextmanager
        def large(*a, **kw):
            yield httpx.Response(200, content=b"x" * 100)
        with patch("backend.worldbank.httpx.stream", large), patch("backend.worldbank.MAX_RESPONSE", 10), self.assertRaisesRegex(AcquisitionError, "byte budget"):
            Downloader(Event(), lambda *a: saved.append(a), lambda p: None).get(url)
        self.assertTrue(saved[0][0].endswith("#incomplete-response"))
        self.assertEqual(len(saved[0][2]), 10)

    def test_wbgapi_pagination_sequence_totals_and_vintages_are_checked(self):
        url = BASE + "country/all/indicator/NY.GDP.MKTP.CD?format=json&per_page=1&page="
        @contextmanager
        def stream(method, requested, **options):
            page = int(parse_qs(urlsplit(requested).query)["page"][0])
            yield httpx.Response(200, json=[{"page": page, "pages": 2, "per_page": 1, "total": 2,
                                           "sourceid": "2", "lastupdated": "2026-10-08"}, [{"id": page}]])
        d = Downloader(Event(), lambda *a: None, lambda p: None)
        with patch("backend.worldbank.httpx.stream", stream):
            d.get(url + "1"); d.get(url + "2")
            with self.assertRaisesRegex(AcquisitionError, "pagination"):
                d.get(url + "2")
        for changed in ({"lastupdated": "2026-10-09"}, {"total": 3, "pages": 3}):
            @contextmanager
            def mixed(method, requested, **options):
                page = int(parse_qs(urlsplit(requested).query)["page"][0])
                header = {"page": page, "pages": 2, "per_page": 1, "total": 2, "sourceid": "2", "lastupdated": "2026-10-08"}
                if page == 2:
                    header.update(changed)
                yield httpx.Response(200, json=[header, [{"id": page}]])
            d = Downloader(Event(), lambda *a: None, lambda p: None)
            with patch("backend.worldbank.httpx.stream", mixed):
                d.get(url + "1")
                with self.assertRaisesRegex(AcquisitionError, "pagination|vintage"):
                    d.get(url + "2")

    def test_cancellation_during_stream_keeps_only_captured_prefix(self):
        stop, saved = Event(), []
        class Stream(httpx.SyncByteStream):
            def __iter__(self):
                yield b"captured"
                stop.set()
                yield b"cancelled"
        @contextmanager
        def stream(*a, **kw):
            yield httpx.Response(200, stream=Stream())
        with patch("backend.worldbank.httpx.stream", stream), self.assertRaisesRegex(AcquisitionError, "cancelled"):
            Downloader(stop, lambda *a: saved.append(a), lambda p: None).get(BASE + "country?format=json")
        self.assertTrue(saved[0][0].endswith("#incomplete-response"))
        self.assertEqual(saved[0][2], b"capturedcancelled")


def storage_fixture():
    report = {"errors": [], "transportComplete": True, "rowCount": 2, "requiredPairs": 2, "absentPairs": 1,
              "firstYear": 2024, "lastYear": 2025, "countries": [{"code": "CAN", "name": "Canada"}],
              "indicators": [{"code": "GDP", "name": "Fixture GDP"}, {"code": "ABSENT", "name": "Fixture absent"}]}
    records = [{"country": "CAN", "indicator": "GDP", "year": y, "value": v, "rawValue": v,
                "classification": "reported_unverified", "status": "", "unit": "", "footnote": "", "decimal": 1,
                "sourceHash": hashlib.sha256(b"fixture").hexdigest()} for y, v in [(2024, 10), (2025, None)]]
    return {"report": report, "records": records, "series": [{"country": "CAN", "indicator": "GDP", "validCount": 1,
             "missingYears": [2025], "analysisBlocked": True}]}


class WorldBankApiTests(unittest.TestCase):
    def setUp(self):
        self.work = Path("backend/.test-work") / str(uuid.uuid4())
        self.work.mkdir(parents=True)
        self.db = self.work / "worldbank.sqlite3"
        self.client = TestClient(create_app(self.db, self.work / "absent"), base_url="http://localhost:8000")
        self.client.__enter__()
        self.store = self.client.app.state.store
        self.wb = WeoStore(self.store, "worldbank")
        self.headers = {"X-Research-Token": self.client.get("/api/session").json()["token"]}

    def tearDown(self):
        self.client.__exit__(None, None, None)
        shutil.rmtree(self.work)

    def stage(self):
        with closing(connect(self.db)) as conn:
            conn.execute("UPDATE provider_pulls SET started_at='2020-01-01T00:00:00Z' WHERE provider_id='worldbank'")
        identifier = self.store.begin_provider_pull("worldbank")
        self.wb.source(identifier, "/fixture-not-empirical.json", 200, b"fixture")
        self.wb.complete(identifier, storage_fixture())
        return identifier

    def test_partial_coverage_explicit_separate_activation_export_originals_and_rollback(self):
        first, second = self.stage(), self.stage()
        manifest = self.client.get(f"/api/worldbank/{first}").json()
        self.assertEqual(manifest["status"], "staged")
        self.assertFalse(manifest["active"])
        coverage = self.client.get(f"/api/worldbank/{first}/coverage").json()
        self.assertEqual(coverage["total"], 2)
        self.assertTrue(coverage["rows"][1]["absent"])
        self.assertEqual(coverage["rows"][1]["missingYears"], [2024, 2025])
        self.assertEqual(self.client.get(f"/api/worldbank/{first}/observations?country=CAN&indicator=ABSENT").json()["rows"], [])
        observations = self.client.get(f"/api/worldbank/{first}/observations?country=CAN&indicator=GDP")
        self.assertIn("no-store", observations.headers["cache-control"])
        self.assertIsNone(observations.json()["rows"][1]["value"])
        self.assertEqual(self.client.post(f"/api/worldbank/{first}/commit", headers=self.headers).status_code, 200)
        state = self.client.get("/api/state").json()
        self.assertEqual(state["datasets"], [])
        self.assertEqual(state["macro"], [])
        self.assertEqual(state["weo"], [])
        self.assertNotIn("countries", state["worldbank"][0]["report"])
        self.assertEqual(self.client.get(f"/api/worldbank/{first}/sources/1").content, b"fixture")
        exported = [json.loads(line) for line in self.client.get(f"/api/worldbank/{first}/export").text.splitlines()]
        self.assertEqual([row["type"] for row in exported], ["manifest", "series", "observation", "observation"])
        self.wb.activate(second); self.wb.rollback(second)
        self.assertTrue(self.wb.get(first)["active"])
        self.assertEqual(self.client.get(f"/api/worldbank/{first}/observations?country=CAN&indicator=bad").status_code, 404)
        self.assertEqual(self.client.get(f"/api/worldbank/{first}/coverage?limit=501").status_code, 422)
        for table in ("worldbank_rows", "worldbank_series", "worldbank_sources"):
            with closing(connect(self.db)) as conn, self.assertRaisesRegex(Exception, "immutable"):
                conn.execute(f"DELETE FROM {table}")

    def test_atomic_staging_rejects_duplicates_and_activation_checks_transport_and_row_count(self):
        identifier = self.store.begin_provider_pull("worldbank")
        invalid = storage_fixture()
        invalid["records"].append(invalid["records"][0])
        with self.assertRaises(Exception):
            self.wb.complete(identifier, invalid)
        with closing(connect(self.db)) as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM worldbank_rows").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT count(*) FROM worldbank_series").fetchone()[0], 0)
        with self.assertRaises(Conflict):
            self.wb.activate(identifier)
        invalid = storage_fixture()
        invalid["report"]["rowCount"] = 3
        self.wb.complete(identifier, invalid)
        with self.assertRaisesRegex(Conflict, "row-count"):
            self.wb.activate(identifier)
        for updates in ({"transportComplete": False}, {"errors": ["fixture contract failure"]}):
            with closing(connect(self.db)) as conn:
                conn.execute("UPDATE provider_pulls SET started_at='2020-01-01T00:00:00Z' WHERE provider_id='worldbank'")
            identifier = self.store.begin_provider_pull("worldbank")
            invalid = storage_fixture(); invalid["report"].update(updates)
            self.wb.complete(identifier, invalid)
            with self.assertRaises(Conflict):
                self.wb.activate(identifier)

    def test_failure_restart_independent_guards_and_backup(self):
        first = self.stage()
        self.wb.activate(first)
        with closing(connect(self.db)) as conn:
            conn.execute("UPDATE provider_pulls SET started_at='2020-01-01T00:00:00Z' WHERE provider_id='worldbank'")
        running = self.store.begin_provider_pull("worldbank")
        with self.assertRaises(Conflict):
            self.store.begin_provider_pull("worldbank")
        self.store.begin_provider_pull("imf-weo")
        self.wb.source(running, "/partial#incomplete-response", 200, b"partial")
        self.store.close(); self.store.open()
        self.assertEqual(self.wb.get(running)["status"], "interrupted")
        self.assertTrue(self.wb.get(first)["active"])
        backup = self.work / "backup.sqlite3"
        backup.write_bytes(self.store.snapshot())
        verify_backup(backup)
        target = self.work / "restored.sqlite3"
        restore_backup(backup, target, offline=True)
        restored = Store(target); restored.open()
        try:
            self.assertEqual(WeoStore(restored, "worldbank").get(first), self.wb.get(first))
        finally:
            restored.close()
        with closing(connect(backup)) as conn:
            for table in ("worldbank_rows", "worldbank_series", "worldbank_sources", "worldbank_runs"):
                conn.execute(f"DROP TABLE {table}")
        with self.assertRaisesRegex(Conflict, "not a research database"):
            verify_backup(backup)

    def test_schema5_migration_preserves_existing_weo_snapshot(self):
        identifier = self.store.begin_provider_pull("imf-weo")
        WeoStore(self.store).complete(identifier, storage_fixture())
        legacy = self.work / "v5.sqlite3"
        legacy.write_bytes(self.store.snapshot())
        with closing(connect(legacy)) as conn:
            for table in ("acled_rows", "acled_chunks", "acled_sources", "acled_runs",
                          "gdelt_rows", "gdelt_chunks", "gdelt_sources", "gdelt_runs",
                          "comtrade_rows", "comtrade_sources", "comtrade_tasks", "comtrade_requests", "comtrade_runs",
                          "ids_rows", "ids_series", "ids_sources", "ids_runs", "bis_rows", "bis_series", "bis_sources", "bis_runs", "fred_rows", "fred_series", "fred_sources", "fred_runs"):
                conn.execute(f"DROP TABLE {table}")
            for table in ("worldbank_rows", "worldbank_series", "worldbank_sources", "worldbank_runs"):
                conn.execute(f"DROP TABLE {table}")
            conn.execute("PRAGMA user_version=5")
        store = Store(legacy); store.open()
        try:
            self.assertEqual(WeoStore(store).get(identifier)["status"], "staged")
            self.assertEqual(store.state().worldbank, [])
            verify_backup(legacy)
        finally:
            store.close()

    def test_manual_worker_consent_auth_size_failure_retention_and_cancel(self):
        for body in ({}, {"researchUse": False}, {"researchUse": True, "url": "https://other"}):
            self.assertEqual(self.client.post("/api/providers/worldbank/pull", headers=self.headers, json=body).status_code, 422)
        self.assertEqual(self.client.post("/api/providers/worldbank/pull", json={"researchUse": True}).status_code, 403)
        self.assertEqual(self.client.post("/api/providers/worldbank/pull", headers=self.headers, content=b"x"*1025).status_code, 413)
        first = self.stage(); self.wb.activate(first)
        with closing(connect(self.db)) as conn:
            conn.execute("UPDATE provider_pulls SET started_at='2020-01-01T00:00:00Z' WHERE provider_id='worldbank'")
        entered, release = Event(), Event()
        def acquisition(downloader, progress):
            entered.set(); release.wait(5)
            downloader.check()
            return storage_fixture()
        with patch("backend.worldbank.acquire", side_effect=acquisition), patch("backend.worldbank.httpx.stream") as request:
            response = self.client.post("/api/providers/worldbank/pull", headers=self.headers, json={"researchUse": True})
            self.assertEqual(response.status_code, 202)
            self.assertTrue(entered.wait(3))
            try:
                self.assertEqual(self.client.post(f"/api/providers/worldbank/{response.json()['id']}/cancel", headers=self.headers).status_code, 200)
            finally:
                release.set()
            self.client.app.state.worldbank_executor.shutdown(wait=True)
        request.assert_not_called()
        self.assertEqual(self.wb.get(response.json()["id"])["status"], "interrupted")
        self.assertTrue(self.wb.get(first)["active"])

    def test_manual_success_and_unexpected_failure_are_durable(self):
        with patch("backend.worldbank.acquire", return_value=storage_fixture()):
            response = self.client.post("/api/providers/worldbank/pull", headers=self.headers, json={"researchUse": True})
            self.client.app.state.worldbank_executor.shutdown(wait=True)
        self.assertEqual(self.wb.get(response.json()["id"])["status"], "staged")
        self.assertFalse(self.wb.get(response.json()["id"])["active"])
        other = self.work / "failure.sqlite3"
        with TestClient(create_app(other, self.work / "absent"), base_url="http://localhost:8000") as client:
            headers = {"X-Research-Token": client.get("/api/session").json()["token"]}
            with patch("backend.worldbank.acquire", side_effect=RuntimeError("private details")):
                failed = client.post("/api/providers/worldbank/pull", headers=headers, json={"researchUse": True})
                client.app.state.worldbank_executor.shutdown(wait=True)
            report = client.get(f"/api/worldbank/{failed.json()['id']}").json()
            self.assertEqual(report["status"], "interrupted")
            self.assertNotIn("private details", str(report["report"]))
