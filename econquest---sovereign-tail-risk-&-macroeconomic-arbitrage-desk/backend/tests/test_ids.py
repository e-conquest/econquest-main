"""Synthetic IDS source-6 fixtures, not empirical financial evidence."""

import copy
import hashlib
import json
import shutil
import time
import unittest
import uuid
from contextlib import closing, contextmanager
from pathlib import Path
from threading import Event
from unittest.mock import patch
from urllib.parse import urlsplit

import httpx
import requests
import wbgapi as wb
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.ids import INDICATORS, OVERLAP, SERIES_TITLES, acquire
from backend.imf import AcquisitionError
from backend.storage import Conflict, Store, connect, restore_backup, verify_backup
from backend.tests.test_worldbank import fixture as wdi_fixture
from backend.weo_storage import WeoStore
from backend.worldbank import BASE, LIBRARY_LOCK, Downloader


def fixture(path):
    def page(rows, **extra):
        return [{"page": 1, "pages": 1, "per_page": 20000, "total": len(rows), **extra}, rows]
    def concept(name, rows):
        return {"page": 1, "pages": 1, "per_page": 20000, "total": len(rows),
                "source": [{"id": "6", "concept": [{"id": name, "variable": rows}]}]}
    if path == "source/6":
        return page([{"id": "6", "name": "International Debt Statistics", "lastupdated": "2026-10-08"}])
    if path == "country":
        return wdi_fixture("country")
    if path == "sources/6/concepts":
        return {"page": 1, "pages": 1, "per_page": 20000, "total": 4,
                "source": [{"id": "6", "concept": [{"id": c, "value": c} for c in ("Country", "Series", "Time", "Counterpart-Area")]}]}
    if path == "sources/6/country":
        rows = [{"id": c["id"], "value": c["name"]} for c in wdi_fixture("country")[1][:100]]
        rows += [{"id": "HIC", "value": "High income"}]
        return concept("Country", rows)
    if path == "sources/6/counterpart-area":
        return concept("Counterpart-Area", [{"id": "WLD", "value": "World"}, {"id": "001", "value": "Austria"}])
    if path == "sources/6/time":
        return concept("Time", [{"id": f"YR{y}", "value": str(y)} for y in (2023, 2024, 2025, 2090)])
    if path == "sources/6/series":
        return concept("Series", [{"id": code, "value": title} for code, title in SERIES_TITLES.items()])
    if path == "indicator":
        return page([{"id": code, "name": name, "unit": "", "sourceNote": "Synthetic IDS source definition",
                      "sourceOrganization": "Test fixture", "source": {"id": "6"}} for code, name in INDICATORS.items()])
    code = path.split("/series/")[1].split("/")[0]
    assert path == f"sources/6/country/all/series/{code}/counterpart-area/WLD/data"
    rows = []
    for year, value in [(2023, -1.25), (2024, None), (2025, 2.25), (2090, 3.25)]:
        rows.append({"variable": [{"concept": "Country", "id": "AAX", "value": "Fixture economy 0"},
                                 {"concept": "Time", "id": f"YR{year}", "value": str(year)},
                                 {"concept": "Series", "id": code, "value": SERIES_TITLES[code]},
                                 {"concept": "Counterpart-Area", "id": "WLD", "value": "World"}],
                     "value": value, **({"footnote": "Fixture estimate", "obs_status": "unknown"} if year == 2025 else {})})
    rows += [{**rows[0], "variable": [{**v, "id": "HIC", "value": "High income"} if v["concept"] == "Country" else v for v in rows[0]["variable"]]}]
    return {"page": 1, "pages": 1, "per_page": 20000, "total": len(rows), "lastupdated": "2026-10-08",
            "source": {"id": "6", "name": "International Debt Statistics", "data": rows}}


def run_fixture(change=None):
    saved = []
    @contextmanager
    def stream(method, url, **kwargs):
        path = urlsplit(url).path.removeprefix("/v2/en/")
        data = fixture(path)
        if change:
            change(path, data)
        yield httpx.Response(200, content=json.dumps(data).encode())
    downloader = Downloader(Event(), lambda *a: saved.append(a), lambda p: None, source_id=6)
    with patch("backend.worldbank.httpx.stream", stream):
        result = acquire(downloader, lambda p: None)
    return result, saved


class IdsParserTests(unittest.TestCase):
    def test_all_definitions_source_membership_wld_native_unknown_attributes_and_overlap(self):
        old_db = wb.db
        r, saved = run_fixture()
        self.assertEqual(wb.db, old_db)
        self.assertIs(wb.requests, requests)
        self.assertEqual(r["report"]["sourceId"], "6")
        self.assertEqual(r["report"]["counterpart"], "WLD")
        self.assertEqual(r["report"]["requiredPairs"], 1800)
        self.assertEqual(r["report"]["absentPairs"], 1782)
        self.assertEqual(r["report"]["excludedFutureRows"], 18)
        self.assertEqual(r["report"]["excludedFutureNumericRows"], 18)
        self.assertEqual(r["report"]["wdiOverlapCodes"], OVERLAP)
        self.assertEqual(len(OVERLAP), 3)
        self.assertNotIn("DT.DOD.DSTC.IR.ZS", INDICATORS)
        self.assertEqual(len(r["records"]), 54)
        self.assertEqual(r["report"]["numericCount"], 36)
        self.assertEqual(r["records"][0]["value"], -1.25)
        self.assertEqual(r["records"][0]["attributes"], {})
        for k in ("status", "footnote", "decimal", "unit"):
            self.assertNotIn(k, r["records"][0])
        self.assertEqual(r["records"][2]["attributes"], {"footnote": "Fixture estimate", "obs_status": "unknown"})
        self.assertTrue(r["series"][0]["analysisBlocked"])
        self.assertEqual(r["series"][0]["missingYears"], [2024])
        hashes = {hashlib.sha256(content).hexdigest() for _, _, content in saved}
        self.assertTrue(all(row["sourceHash"] in hashes for row in r["records"]))
        self.assertTrue(all(c["code"] != "HIC" for c in r["report"]["countries"]))
        self.assertEqual(len(saved), 26)

    def test_identity_counterpart_dimension_duplicates_values_metadata_and_vintage_changes_rejected(self):
        def mutate_data(callback):
            def change(path, data):
                if path.endswith("/data"):
                    callback(data)
            return change
        def mutate_meta(path, data):
            if path == "sources/6/series":
                data["source"][0]["concept"][0]["variable"][0]["value"] = "Changed definition"
        changes = [
            mutate_data(lambda d: d["source"].update(id="2")),
            mutate_data(lambda d: d.update(lastupdated="2026-10-09")),
            mutate_data(lambda d: d["source"]["data"][0].update(value=float("nan"))),
            mutate_data(lambda d: d["source"]["data"][0].update(value=True)),
            mutate_data(lambda d: d["source"]["data"][0]["variable"][3].update(id="001", value="Austria")),
            mutate_data(lambda d: d["source"]["data"][0]["variable"][0].update(id="ZZZ")),
            mutate_data(lambda d: d["source"]["data"][0]["variable"][1].update(id="YR2024", value="2023")),
            mutate_data(lambda d: d["source"]["data"][0]["variable"].append(copy.deepcopy(d["source"]["data"][0]["variable"][0]))),
            mutate_data(lambda d: d["source"]["data"].__setitem__(1, copy.deepcopy(d["source"]["data"][0]))),
            mutate_meta,
            lambda p, d: d["source"][0]["concept"][0].update(id=None) if p == "sources/6/concepts" else None,
        ]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(AcquisitionError):
                run_fixture(change)
            self.assertIs(wb.requests, requests)

    def test_source_scope_lock_endpoint_no_data_error_and_truncated_pages_fail(self):
        d = Downloader(Event(), lambda *a: None, lambda p: None, source_id=6)
        for url in (BASE + "source/2?format=json", BASE + "country/all/indicator/DT.DOD.DECT.CD?format=json",
                    BASE + "sources/6/country/all/series/DT.DOD.DECT.CD/counterpart-area/001/data?format=json"):
            with self.assertRaises(AcquisitionError):
                d.get(url)
        with self.assertRaises(AcquisitionError):
            acquire(Downloader(Event(), lambda *a: None, lambda p: None), lambda p: None)
        LIBRARY_LOCK.acquire()
        try:
            with self.assertRaisesRegex(AcquisitionError, "already running"):
                acquire(d, lambda p: None)
        finally:
            LIBRARY_LOCK.release()
        with patch.object(wb, "endpoint", "https://evil.test"), self.assertRaisesRegex(AcquisitionError, "endpoint"):
            acquire(d, lambda p: None)
        def truncated(path, data):
            if path.endswith("/data"):
                data["total"] += 1
        with self.assertRaisesRegex(AcquisitionError, "pagination"):
            run_fixture(truncated)
        def error(path, data):
            if path.endswith("/data"):
                data.clear(); data["message"] = [{"id": "175", "value": "Invalid indicator"}]
        with self.assertRaises(AcquisitionError):
            run_fixture(error)
        def no_values(path, data):
            if path.endswith("/data"):
                for row in data["source"]["data"]:
                    row["value"] = None
        with self.assertRaisesRegex(AcquisitionError, "no numeric"):
            run_fixture(no_values)

    def test_transport_budgets_deadline_cancellation_and_partial_prefix_capture(self):
        saved = []
        @contextmanager
        def stream(method, url, **kwargs):
            self.assertEqual(kwargs["timeout"], 20)
            self.assertFalse(kwargs["follow_redirects"])
            yield httpx.Response(200, content=json.dumps(fixture("source/6")).encode())
        def fresh():
            return Downloader(Event(), lambda *a: saved.append(a), lambda p: None, source_id=6)
        url = BASE + "source/6?per_page=20000&page=1&format=json"
        with patch("backend.worldbank.httpx.stream", stream):
            d = fresh();d.count = 128
            with self.assertRaisesRegex(AcquisitionError, "request budget"):
                d.get(url)
            d = fresh();d.stop.set()
            with self.assertRaisesRegex(AcquisitionError, "cancelled"):
                d.get(url)
            d = fresh();d.deadline = 0
            with self.assertRaisesRegex(AcquisitionError, "deadline"):
                d.get(url)
            for limit in ("MAX_RESPONSE", "MAX_TOTAL"):
                d = fresh()
                with patch(f"backend.worldbank.{limit}", 32), self.assertRaisesRegex(AcquisitionError, "byte budget"):
                    d.get(url)
                self.assertTrue(saved[-1][0].endswith("#incomplete-response"))
                self.assertEqual(len(saved[-1][2]), 32)


class IdsApiTests(unittest.TestCase):
    def setUp(self):
        self.work = Path("backend/.test-work") / str(uuid.uuid4())
        self.work.mkdir(parents=True)
        self.db = self.work / "ids.sqlite3"
        self.client = TestClient(create_app(self.db, self.work / "absent"), base_url="http://localhost:8000")
        self.client.__enter__()
        self.store = self.client.app.state.store
        self.ids = WeoStore(self.store, "ids")
        self.headers = {"X-Research-Token": self.client.get("/api/session").json()["token"]}

    def tearDown(self):
        self.client.__exit__(None, None, None)
        shutil.rmtree(self.work)

    def cooldown(self):
        with closing(connect(self.db)) as c:
            c.execute("UPDATE provider_pulls SET started_at='2000-01-01T00:00:00Z' WHERE provider_id='ids'")

    def stage(self):
        self.cooldown()
        identifier = self.store.begin_provider_pull("ids")
        result, saved = run_fixture()
        for args in saved:
            self.ids.source(identifier, *args)
        self.ids.complete(identifier, result)
        return identifier

    def test_independent_pages_catalog_export_activation_rollback_and_model_isolation(self):
        before = self.store.state()
        a, b = self.stage(), self.stage()
        self.assertFalse(self.ids.get(a)["active"])
        p = self.client.get(f"/api/ids/{a}/observations?country=AAX&indicator=DT.DOD.DECT.CD")
        self.assertEqual(p.status_code, 200)
        self.assertIn("no-store", p.headers["cache-control"])
        self.assertEqual(p.json()["rows"][0]["counterpart"], "WLD")
        self.assertEqual(self.client.get(f"/api/ids/{a}/coverage").json()["total"], 1800)
        exported = [json.loads(l) for l in self.client.get(f"/api/ids/{a}/export").text.splitlines()]
        self.assertEqual(len(exported), 1 + 18 + 54)
        self.assertEqual(self.client.get(f"/api/ids/{a}/sources/1").status_code, 200)
        self.assertEqual(self.client.get(f"/api/worldbank/{a}").status_code, 404)
        self.assertNotIn("countries", self.store.state().ids[0]["report"])
        self.assertEqual(self.store.state().ids[0]["report"]["sourceId"], "6")
        self.assertEqual(self.client.post(f"/api/ids/{a}/commit", headers=self.headers).status_code, 200)
        self.ids.activate(b); self.ids.rollback(b)
        self.assertTrue(self.ids.get(a)["active"])
        after = self.store.state()
        for key in ("datasets", "runs", "macro", "weo", "worldbank", "fred", "bis"):
            self.assertEqual(getattr(before, key), getattr(after, key))

    def test_consent_token_query_limits_and_activation_identity_count_gates(self):
        for body in ({}, {"researchUse": False}, {"researchUse": True, "db": 2}):
            self.assertEqual(self.client.post("/api/providers/ids/pull", json=body, headers=self.headers).status_code, 422)
        self.assertEqual(self.client.post("/api/providers/ids/pull", json={"researchUse": True}).status_code, 403)
        self.assertEqual(self.client.post("/api/providers/ids/pull", content=b"x" * 1025, headers=self.headers).status_code, 413)
        a = self.stage()
        self.assertEqual(self.client.get(f"/api/ids/{a}/coverage?limit=501").status_code, 422)
        self.assertEqual(self.client.get(f"/api/ids/{a}/observations?country=ZZZ&indicator=DT.DOD.DECT.CD").status_code, 404)
        for key, value in (("rowCount", 999), ("sourceId", "2"), ("counterpart", "001"), ("numericCount", 0), ("transportComplete", False)):
            with closing(connect(self.db)) as c:
                original = c.execute("SELECT report FROM ids_runs WHERE id=?", (a,)).fetchone()[0]
                report = json.loads(original);report[key] = value
                c.execute("UPDATE ids_runs SET report=? WHERE id=?", (json.dumps(report), a))
            with self.assertRaises(Conflict):
                self.ids.activate(a)
            with closing(connect(self.db)) as c:
                c.execute("UPDATE ids_runs SET report=? WHERE id=?", (original, a))

    def test_restart_backup_restore_migration_and_immutability(self):
        a = self.stage(); self.ids.activate(a); self.cooldown()
        running = self.store.begin_provider_pull("ids")
        with self.assertRaises(Conflict):
            self.store.begin_provider_pull("ids")
        self.ids.source(running, "fixture#incomplete-response", 200, b"partial")
        self.store.close(); self.store.open()
        self.assertEqual(self.ids.get(running)["status"], "interrupted")
        self.assertTrue(self.ids.get(a)["active"])
        with closing(connect(self.db)) as c:
            for table in ("ids_rows", "ids_series", "ids_sources"):
                with self.assertRaisesRegex(Exception, "immutable"):
                    c.execute(f"DELETE FROM {table}")
        backup = self.work / "backup.sqlite3"; backup.write_bytes(self.store.snapshot()); verify_backup(backup)
        restored = self.work / "restored.sqlite3"; restore_backup(backup, restored, offline=True)
        other = Store(restored); other.open()
        try:
            self.assertEqual(WeoStore(other, "ids").get(a), self.ids.get(a))
        finally:
            other.close()
        with closing(connect(backup)) as c:
            for table in ("acled_rows", "acled_chunks", "acled_sources", "acled_runs",
                          "gdelt_rows", "gdelt_chunks", "gdelt_sources", "gdelt_runs",
                          "comtrade_rows", "comtrade_sources", "comtrade_tasks", "comtrade_requests", "comtrade_runs",
                          "ids_rows", "ids_series", "ids_sources", "ids_runs"):
                c.execute(f"DROP TABLE {table}")
        with self.assertRaises(Conflict):
            verify_backup(backup)
        with closing(connect(backup)) as c:
            c.execute("PRAGMA user_version=8")
        other = Store(backup); other.open()
        try:
            self.assertEqual(other.state().ids, [])
            self.assertEqual(len(other.state().providers), 10)
            verify_backup(backup)
        finally:
            other.close()

    def test_rollback_skips_withdrawn_predecessors(self):
        a, b, c = self.stage(), self.stage(), self.stage()
        for identifier in (a, b, c):
            self.ids.activate(identifier)
        self.ids.rollback(b)
        self.assertTrue(self.ids.get(c)["active"])
        self.ids.rollback(c)
        self.assertTrue(self.ids.get(a)["active"])
        self.assertFalse(self.ids.get(b)["active"])
        self.ids.rollback(a)
        self.assertFalse(any(s["active"] for s in self.store.state().ids))

    def test_worker_success_cancel_failure_persist_and_do_not_replace_active_data(self):
        a = self.stage(); self.ids.activate(a); self.cooldown()
        with patch("backend.ids.acquire", return_value=run_fixture()[0]):
            r = self.client.post("/api/providers/ids/pull", json={"researchUse": True}, headers=self.headers)
            self.assertEqual(r.status_code, 202)
            b = r.json()["id"]
            for _ in range(100):
                if self.ids.get(b)["status"] != "running":
                    break
                time.sleep(0.01)
            self.assertEqual(self.ids.get(b)["status"], "staged")
        self.cooldown(); entered = Event()
        def wait(downloader, progress):
            entered.set()
            while True:
                downloader.check()
                time.sleep(0.01)
        with patch("backend.ids.acquire", side_effect=wait):
            r = self.client.post("/api/providers/ids/pull", json={"researchUse": True}, headers=self.headers)
            b = r.json()["id"];self.assertTrue(entered.wait(2))
            self.assertEqual(self.client.post(f"/api/providers/ids/{b}/cancel", headers=self.headers).status_code, 200)
            for _ in range(100):
                if self.ids.get(b)["status"] != "running":
                    break
                time.sleep(0.01)
            self.assertEqual(self.ids.get(b)["status"], "interrupted")
        self.assertTrue(self.ids.get(a)["active"])
        self.cooldown()
        with patch("backend.ids.acquire", side_effect=AcquisitionError("Synthetic source failure")):
            r = self.client.post("/api/providers/ids/pull", json={"researchUse": True}, headers=self.headers)
            b = r.json()["id"]
            for _ in range(100):
                if self.ids.get(b)["status"] != "running":
                    break
                time.sleep(0.01)
            self.assertEqual(self.ids.get(b)["status"], "interrupted")
            self.assertIn("Synthetic source failure", self.ids.get(b)["report"]["errors"][0])
        self.assertTrue(self.ids.get(a)["active"])
