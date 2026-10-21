"""Synthetic Comtrade fixtures; not empirical trade evidence."""

import copy
import hashlib
import json
import shutil
import sqlite3
import time
import unittest
import uuid
from contextlib import closing
from pathlib import Path
from threading import Event
from unittest.mock import Mock, patch

import comtradeapicall as api
import urllib3
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.comtrade import (AUTH_SENTINEL, CONTRACT, DAILY_REQUESTS, Downloader, Paused, availability,
                              catalog, client, observations, parameters, run_pass)
from backend.comtrade_storage import ComtradeStore
from backend.imf import AcquisitionError
from backend.storage import Conflict, Store, connect, verify_backup

KEY = "synthetic_fixture_key_not_a_secret"
DATASET = {"typeCode": "C", "freqCode": "A", "period": 2024, "reporterCode": 152,
           "classificationCode": "H6", "classificationSearchCode": "HS", "isOriginalClassification": True,
           "datasetCode": 20152202401052600, "datasetChecksum": 123, "lastReleased": "2026-01-01T00:00:00"}
REPORTERS = [{"code": 152, "name": "Fixture Chile", "isGroup": False, "iso3": "CHL", "effective": None, "expired": None}]
PARTNERS = [{"code": 0, "name": "World", "isGroup": False, "iso3": "W00", "kind": "world", "effective": None, "expired": None},
            {"code": 32, "name": "Fixture Argentina", "isGroup": False, "iso3": "ARG", "kind": "individual", "effective": None, "expired": None}]


def native(**changes):
    return {"typeCode": "C", "freqCode": "A", "refYear": 2024, "period": "2024", "reporterCode": 152,
            "partnerCode": 32, "partner2Code": 0, "flowCode": "M", "cmdCode": "TOTAL", "aggrLevel": 0,
            "customsCode": "C00", "motCode": 0, "classificationCode": "H6", "classificationSearchCode": "HS",
            "isOriginalClassification": True, "primaryValue": 12.5, "isReported": True,
            "isQtyEstimated": True, "cifvalue": 12.5, "fobvalue": None, **changes}


def spec():
    return {"reporter": 152, "search": "HS", "years": [2024], "datasets": [DATASET | {"datasetCode": str(DATASET["datasetCode"])}]}


class ComtradeParserTests(unittest.TestCase):
    def test_original_definitions_and_large_identifiers_are_lossless(self):
        rows = availability([DATASET, DATASET | {"isOriginalClassification": False}], 2024, {152: REPORTERS[0]})
        self.assertEqual(rows[0]["datasetCode"], "20152202401052600")
        self.assertEqual(DATASET["datasetCode"], 20152202401052600)
        for change in [{"period": 2023}, {"reporterCode": 999}, {"classificationSearchCode": "H6"},
                       {"datasetChecksum": None}, {"isOriginalClassification": 1}]:
            with self.subTest(change=change), self.assertRaises(AcquisitionError):
                availability([DATASET | change], 2024, {152: REPORTERS[0]})
        with self.assertRaisesRegex(AcquisitionError, "Multiple"):
            availability([DATASET, DATASET], 2024, {152: REPORTERS[0]})

    def test_native_zero_null_flags_no_mirror_or_valuation_synthesis(self):
        rows = [native(primaryValue=0), native(flowCode="X", primaryValue=20, isReported=False),
                native(partnerCode=0, primaryValue=None)]
        before = copy.deepcopy(rows)
        result = observations(rows, spec(), {p["code"]: p for p in PARTNERS}, "a" * 64)
        self.assertEqual([r["value"] for r in result], [0, 20, None])
        self.assertEqual([r["rawValue"] for r in result], [0, 20, None])
        self.assertEqual(result[0]["attributes"]["isQtyEstimated"], True)
        self.assertEqual(result[-1]["partnerKind"], "world")
        self.assertEqual(rows, before)
        self.assertEqual(result[0]["datasetCode"], str(DATASET["datasetCode"]))

    def test_mixed_dimensions_duplicates_nonoriginal_invalid_values_rejected(self):
        for changes in [{"flowCode": "RX"}, {"refYear": 2023}, {"cmdCode": "01"}, {"partner2Code": 32},
                        {"motCode": 1}, {"customsCode": "C01"}, {"partnerCode": 999}, {"classificationCode": "S3"},
                        {"isOriginalClassification": False}, {"primaryValue": float("nan")},
                        {"primaryValue": True}, {"primaryValue": -1}, {"isReported": None}]:
            with self.subTest(changes=changes), self.assertRaises(AcquisitionError):
                observations([native(**changes)], spec(), {p["code"]: p for p in PARTNERS}, "a" * 64)
        with self.assertRaises(AcquisitionError):
            observations([native(), native()], spec(), {p["code"]: p for p in PARTNERS}, "a" * 64)

    def test_world_historical_special_groups_not_misclassified_from_is_group_or_iso(self):
        rows = [{"PartnerCode": code, "PartnerDesc": name, "PartnerCodeIsoAlpha3": iso, "isGroup": group}
                for code, name, iso, group in [(0, "World", "W00", False), (32, "Argentina", "ARG", False),
                    (492, "Europe EU, nes", "MCO", False), (837, "Bunkers", "X1 ", False), (900, "Group", "GRP", True)]]
        reviewed = {32: {"name": "Argentina", "isGroup": False}, 492: {"name": "Monaco", "isGroup": False}}
        self.assertEqual([r["kind"] for r in catalog(rows, partner=True, reporters=reviewed)], ["world", "individual", "special", "special", "aggregate"])
        unknown = catalog([rows[0], {"PartnerCode": 999, "PartnerDesc": "Unreviewed", "PartnerCodeIsoAlpha3": "USA", "isGroup": False}],
                          partner=True, reporters=reviewed)
        self.assertEqual(unknown[-1]["kind"], "unreviewed")
        old = catalog([{"reporterCode": 459, "reporterDesc": "Peninsula Malaysia (...1963)", "reporterCodeIsoAlpha3": "_PM",
                        "entryExpiredDate": "1963-12-31T00:00:00", "isGroup": False}])[0]
        self.assertEqual(old["code"], 459)
        self.assertEqual(old["expired"], "1963-12-31T00:00:00")


class ComtradeTransportTests(unittest.TestCase):
    def downloader(self):
        self.saved, self.reservations = [], []
        with patch.dict("os.environ", {"COMTRADE_API_KEY": KEY}):
            return Downloader(Event(), lambda *args: self.saved.append(args), lambda: self.reservations.append(True), lambda p: None)

    def response(self, data, status=200):
        raw = json.dumps(data).encode()
        response = Mock()
        response.status = status
        response.getheader.side_effect = lambda key, default=None: str(len(raw)) if key == "Content-Length" else default
        response.read.side_effect = [raw, b""]
        connection = Mock()
        connection.getresponse.return_value = response
        return connection

    def test_installed_package_calls_are_header_authenticated_scoped_no_query_key(self):
        downloader = self.downloader()
        original = api.PreviewGet.urllib3
        for count_only, function in [(True, api.getCountFinalData), (False, api.getFinalData)]:
            data = {"count": 1, "error": "", "data": {} if count_only else [native()]}
            connection = self.response(data)
            with patch("backend.comtrade.http.client.HTTPSConnection", return_value=connection), client(downloader):
                result = function(AUTH_SENTINEL, **parameters(spec()))
                self.assertIsNotNone(result)
            args, kwargs = connection.request.call_args
            self.assertNotIn(KEY, args[1])
            self.assertNotIn("subscription-key", args[1])
            self.assertNotIn(AUTH_SENTINEL, args[1])
            self.assertEqual(kwargs["headers"]["Ocp-Apim-Subscription-Key"], KEY)
            self.assertIs(api.PreviewGet.urllib3, original)
            self.assertIs(api.PreviewGet.urllib3, urllib3)
        connection = self.response({"count": 1, "error": "", "data": [DATASET]})
        with patch("backend.comtrade.http.client.HTTPSConnection", return_value=connection), client(downloader):
            api.getFinalDataAvailability(AUTH_SENTINEL, "C", "A", "SS", "2024", "152")
        self.assertIn("/getDa/", self.saved[-1][0])
        self.assertEqual(len(self.reservations), 3)

    def test_truncation_api_errors_quota_and_credential_echo_are_explicit(self):
        for data, status in [({"count": 2, "data": [native()], "error": ""}, 200),
                             ({"count": 1, "data": [native()], "error": "access denied"}, 200),
                             ({"count": 100000, "data": [], "error": ""}, 200),
                             ({"count": 0, "data": [], "error": KEY}, 200), ({"detail": "denied"}, 401)]:
            downloader = self.downloader()
            with self.subTest(status=status, data=data), patch("backend.comtrade.http.client.HTTPSConnection", return_value=self.response(data, status)), self.assertRaises(AcquisitionError):
                with client(downloader):
                    api.getFinalData(AUTH_SENTINEL, **parameters(spec()))
            self.assertTrue(all(KEY.encode() not in content for _, _, content in self.saved))
        downloader = self.downloader()
        with patch("backend.comtrade.http.client.HTTPSConnection", return_value=self.response({"error": "quota"}, 429)), self.assertRaises(Paused):
            with client(downloader):
                api.getFinalData(AUTH_SENTINEL, **parameters(spec()))
        self.assertEqual(len(self.reservations), 1)
        downloader.stop.set()
        with self.assertRaises(Paused):
            downloader.check()

    def test_redirect_untrusted_host_and_query_credential_rejected(self):
        downloader = self.downloader()
        for url in ["https://evil.invalid/data/v1/get/C/A/HS", "http://comtradeapi.un.org/data/v1/get/C/A/HS",
                    "https://comtradeapi.un.org/data/v1/get/C/A/HS?subscription-key=x"]:
            with self.assertRaises(AcquisitionError):
                downloader.request("GET", url, fields={"subscription-key": AUTH_SENTINEL})
        self.assertEqual(self.reservations, [])


class ComtradeStorageTests(unittest.TestCase):
    def setUp(self):
        self.path = Path(__file__).parents[2] / "research-data" / f"comtrade-test-{uuid.uuid4()}"
        self.path.mkdir(parents=True)
        self.store = Store(self.path / "test.sqlite3")
        self.store.open()
        self.trade = ComtradeStore(self.store)
        self.id = self.store.begin_provider_pull("comtrade")
        with patch("backend.comtrade_storage.FIRST_YEAR", 2024), patch("backend.comtrade_storage.cutoff_year", return_value=2024):
            self.trade.initialize(self.id, REPORTERS, PARTNERS)

    def tearDown(self):
        self.store.close()
        shutil.rmtree(self.path)

    def plan(self):
        self.trade.complete_task(self.id, "availability:2024", datasets=spec()["datasets"])
        self.assertTrue(self.trade.plan_data(self.id))
        return self.trade.next_task(self.id)

    def test_incomplete_activation_gates_restart_resume_completed_chunks_and_immutability(self):
        before = self.store.state().model_dump()
        task = self.plan()
        with self.assertRaises(Conflict):
            self.trade.activate(self.id)
        self.store.close()
        self.store.open()
        self.assertEqual(self.trade.get(self.id)["status"], "interrupted")
        self.assertEqual(self.trade.next_task(self.id)["key"], task["key"])
        self.trade.resume(self.id)
        raw = json.dumps([native()]).encode()
        self.trade.source(self.id, "/fixture-native", 200, raw)
        rows = observations([native()], spec(), {p["code"]: p for p in PARTNERS}, hashlib.sha256(raw).hexdigest())
        self.trade.complete_task(self.id, task["key"], rows=rows, acquired=spec()["datasets"])
        self.assertIsNone(self.trade.next_task(self.id))
        self.trade.finish(self.id)
        run = self.trade.get(self.id)
        self.assertFalse(run["active"])
        self.assertEqual(run["status"], "staged")
        self.assertEqual(run["report"]["numericCount"], 1)
        self.assertEqual(self.trade.original(self.id, 1), raw)
        self.trade.activate(self.id)
        self.assertTrue(self.trade.get(self.id)["active"])
        for key in ["datasets", "macro", "weo", "worldbank", "fred", "bis", "ids"]:
            self.assertEqual(self.store.state().model_dump()[key], before[key])
        exported = [json.loads(line) for line in self.trade.export(self.id)]
        self.assertEqual(sum(row["type"] == "observation" for row in exported), 1)
        self.assertEqual(sum(row["type"] == "task" for row in exported), 2)
        with self.store.connection() as conn:
            for table in ("comtrade_rows", "comtrade_sources", "comtrade_tasks", "comtrade_requests"):
                if table == "comtrade_requests":
                    self.trade.reserve(self.id)
                with self.subTest(table=table), self.assertRaises(sqlite3.IntegrityError):
                    conn.execute(f"DELETE FROM {table}")
        backup = self.path / "backup.sqlite3"
        backup.write_bytes(self.store.snapshot())
        verify_backup(backup)
        self.trade.rollback(self.id)
        self.assertFalse(self.trade.get(self.id)["active"])

    def test_rolling_quota_reserved_before_network_and_durable_cooldown(self):
        with self.store.connection() as conn:
            conn.executemany("INSERT INTO comtrade_requests(run_id,started_at) VALUES (?,?)",
                             [(self.id, time.time())] * DAILY_REQUESTS)
        with self.assertRaises(Paused) as paused:
            self.trade.reserve(self.id)
        self.assertGreater(paused.exception.not_before, time.time())
        self.trade.pause(self.id, str(paused.exception), not_before=paused.exception.not_before)
        self.store.close()
        self.store.open()
        with self.assertRaisesRegex(Conflict, "quota pause"):
            self.trade.resume(self.id)

    def test_full_runner_uses_installed_package_and_rechecks_each_chunk(self):
        self.trade.complete_task(self.id, "availability:2024", datasets=spec()["datasets"])
        calls = []
        raw = json.dumps({"count": 1, "data": [native()], "error": ""}).encode()
        downloader = Mock()
        downloader.last_data = {}
        def request(method, url, fields=None, **kwargs):
            calls.append((url, fields))
            if "/getDa/" in url:
                data = {"count": 1, "data": [DATASET], "error": ""}
            elif fields.get("countOnly"):
                data = {"count": 1, "data": {}, "error": ""}
            else:
                data = json.loads(raw)
                self.trade.source(self.id, "/fixture", 200, raw)
            downloader.last_data, downloader.last_hash = data, hashlib.sha256(raw).hexdigest()
            return urllib3.response.HTTPResponse(body=json.dumps(data).encode(), status=200)
        downloader.request.side_effect = request
        run_pass(downloader, self.trade, self.id)
        self.assertEqual(len(calls), 4)
        self.assertEqual(self.trade.get(self.id)["status"], "staged")

    def test_mid_chunk_revision_leaves_no_rows_and_pending_task_for_explicit_retry(self):
        task = self.plan()
        downloader, calls = Mock(), []
        def request(method, url, fields=None, **kwargs):
            calls.append((url, fields))
            if "/getDa/" in url:
                data = {"count": 1, "data": [DATASET | {"datasetChecksum": 124 if len(calls) == 4 else 123}], "error": ""}
            elif fields.get("countOnly"):
                data = {"count": 1, "data": {}, "error": ""}
            else:
                data = {"count": 1, "data": [native()], "error": ""}
            downloader.last_data, downloader.last_hash = data, "a" * 64
            return urllib3.response.HTTPResponse(body=json.dumps(data).encode(), status=200)
        downloader.request.side_effect = request
        with self.assertRaisesRegex(AcquisitionError, "during this chunk"):
            run_pass(downloader, self.trade, self.id)
        self.assertEqual(self.trade.next_task(self.id)["key"], task["key"])
        self.assertEqual(self.trade.page(self.id)["total"], 0)

    def test_exports_are_consistent_while_new_chunks_finish(self):
        task = self.plan()
        generator = self.trade.export(self.id)
        manifest = json.loads(next(generator))
        self.assertEqual(manifest["report"]["rowCount"], 0)
        rows = observations([native()], spec(), {p["code"]: p for p in PARTNERS}, "a" * 64)
        self.trade.complete_task(self.id, task["key"], rows=rows, acquired=spec()["datasets"])
        remainder = [json.loads(line) for line in generator]
        self.assertEqual(sum(line["type"] == "observation" for line in remainder), 0)
        self.assertEqual(self.trade.page(self.id)["total"], 1)

    def test_migration_from_schema9_keeps_other_providers(self):
        old = self.path / "v9.sqlite3"
        old.write_bytes(self.store.snapshot())
        with self.store.connection() as conn:
            before = conn.execute("SELECT count(*) FROM originals").fetchone()[0]
        with closing(connect(old)) as conn:
            for table in ("analysis_bundles", "acled_rows", "acled_chunks", "acled_sources", "acled_runs",
                          "gdelt_rows", "gdelt_chunks", "gdelt_sources", "gdelt_runs",
                          "comtrade_rows", "comtrade_sources", "comtrade_tasks", "comtrade_requests", "comtrade_runs"):
                conn.execute(f"DROP TABLE {table}")
            conn.execute("DELETE FROM provider_pulls WHERE provider_id='comtrade'")
            conn.execute("PRAGMA user_version=9")
        migrated = Store(old)
        migrated.open()
        try:
            self.assertEqual(len(migrated.state().providers), 10)
            self.assertEqual(migrated.state().comtrade, [])
            with migrated.connection() as conn:
                self.assertEqual(conn.execute("SELECT count(*) FROM originals").fetchone()[0], before)
        finally:
            migrated.close()


class ComtradeApiTests(unittest.TestCase):
    def test_worker_pause_explicit_resume_and_independent_commit(self):
        path = Path(__file__).parents[2] / "research-data" / f"comtrade-api-test-{uuid.uuid4()}"
        path.mkdir(parents=True)
        def fake_pass(downloader, trade, identifier):
            if not trade.get(identifier)["report"].get("reporters"):
                with patch("backend.comtrade_storage.FIRST_YEAR", 2024), patch("backend.comtrade_storage.cutoff_year", return_value=2024):
                    trade.initialize(identifier, REPORTERS, PARTNERS)
                trade.complete_task(identifier, "availability:2024", datasets=spec()["datasets"])
                trade.plan_data(identifier)
                raise Paused("Synthetic pass budget reached; explicit resume required")
            task = trade.next_task(identifier)
            raw = json.dumps(native()).encode()
            trade.source(identifier, "/synthetic-fixture", 200, raw)
            rows = observations([native()], spec(), {p["code"]: p for p in PARTNERS}, hashlib.sha256(raw).hexdigest())
            trade.complete_task(identifier, task["key"], rows=rows, acquired=spec()["datasets"])
            trade.finish(identifier)
        try:
            with patch.dict("os.environ", {"COMTRADE_API_KEY": KEY}), patch("backend.comtrade.run_pass", side_effect=fake_pass), TestClient(create_app(path / "test.sqlite3"), base_url="http://127.0.0.1") as client:
                headers = {"X-Research-Token": client.get("/api/session").json()["token"]}
                before = client.get("/api/state").json()
                first = client.post("/api/providers/comtrade/pull", headers=headers, json={"researchUse": True})
                self.assertEqual(first.status_code, 202)
                identifier = first.json()["id"]
                def wait():
                    for _ in range(100):
                        manifest = client.get(f"/api/comtrade/{identifier}").json()
                        if manifest["status"] != "running":
                            return manifest
                        time.sleep(.01)
                    self.fail("Synthetic Comtrade worker did not finish")
                self.assertEqual(wait()["status"], "interrupted")
                self.assertEqual(client.post(f"/api/comtrade/{identifier}/commit", headers=headers).status_code, 409)
                resumed = client.post(f"/api/providers/comtrade/{identifier}/resume", headers=headers, json={"researchUse": True})
                self.assertEqual(resumed.status_code, 202)
                self.assertEqual(wait()["status"], "staged")
                committed = client.post(f"/api/comtrade/{identifier}/commit", headers=headers)
                self.assertEqual(committed.status_code, 200)
                self.assertTrue(committed.json()["comtrade"][0]["active"])
                self.assertEqual(client.post(f"/api/providers/comtrade/{identifier}/cancel", headers=headers).status_code, 409)
                for key in ("datasets", "macro", "weo", "worldbank", "ids", "fred", "bis"):
                    self.assertEqual(committed.json()[key], before[key])
        finally:
            shutil.rmtree(path)

    def test_configuration_secret_absence_bounds_consent_and_incomplete_commit(self):
        path = Path(__file__).parents[2] / "research-data" / f"comtrade-api-test-{uuid.uuid4()}"
        path.mkdir(parents=True)
        try:
            with patch.dict("os.environ", {"COMTRADE_API_KEY": ""}), TestClient(create_app(path / "test.sqlite3"), base_url="http://127.0.0.1") as client:
                headers = {"X-Research-Token": client.get("/api/session").json()["token"]}
                response = client.get("/api/providers/comtrade/config")
                self.assertEqual(response.headers["cache-control"], "no-store")
                self.assertFalse(response.json()["configured"])
                self.assertEqual(response.json()["contractVersion"], CONTRACT)
                self.assertEqual(client.post("/api/providers/comtrade/pull", headers=headers, json={"researchUse": True}).status_code, 422)
                self.assertEqual(client.post("/api/providers/comtrade/pull", headers=headers, content=b"x" * 1025).status_code, 413)
                self.assertEqual(client.post("/api/providers/comtrade/pull", json={"researchUse": True}).status_code, 403)
                self.assertEqual(client.post("/api/providers/comtrade/pull", headers=headers, json={"researchUse": False}).status_code, 422)
                identifier = client.app.state.store.begin_provider_pull("comtrade")
                self.assertEqual(client.post(f"/api/comtrade/{identifier}/commit", headers=headers).status_code, 409)
                self.assertEqual(client.get(f"/api/comtrade/{identifier}/observations?reporter=152&partner=32&flow=RX").status_code, 422)
                self.assertEqual(client.get(f"/api/comtrade/{identifier}/tasks?limit=501").status_code, 422)
                self.assertEqual(client.get(f"/api/comtrade/{identifier}/sources/1").status_code, 404)
        finally:
            shutil.rmtree(path)


if __name__ == "__main__":
    unittest.main()
