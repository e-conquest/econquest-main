import copy
import hashlib
import json
import shutil
import sqlite3
import unittest
import uuid
from contextlib import closing
from pathlib import Path

from fastapi.testclient import TestClient

from backend.analysis import AnalysisStore, INDICATORS, digest, metric
from backend.app import create_app
from backend.storage import DB_VERSION, Store, connect, restore_backup, verify_backup
from backend.weo_storage import WeoStore


def fixture():
    content = b"Synthetic WEO test evidence; not empirical data"
    sha = hashlib.sha256(content).hexdigest()
    series, rows = [], []
    for i in INDICATORS:
        attributes = {"FREQUENCY": "A", "UNIT": "PT", "SCALE": "0", "LATEST_ACTUAL_ANNUAL_DATA": "2024"}
        series.append({"country": "USA", "indicator": i["code"], "unit": "PT", "unitLabel": "Percent",
                       "scale": "0", "scaleLabel": "Units", "latestActualYear": 2024, "validCount": 4,
                       "missingCount": 0, "missingYears": [], "attributes": attributes, "sourceHash": sha,
                       "analysisBlocked": False})
        for year, value in ((2023, -2), (2024, 0), (2025, 4), (2026, 5)):
            rows.append({"country": "USA", "indicator": i["code"], "year": year, "value": value, "rawValue": str(value),
                         "classification": "actual" if year <= 2024 else "estimate_projection", "status": None,
                         "sourceHash": sha, "attributes": attributes | {"TIME_PERIOD": str(year), "OBS_VALUE": str(value)}})
    report = {"contractVersion": "weo-annual-native-v1", "errors": [], "transportComplete": True,
              "publicationDate": "2026-10-13T02:00:00Z", "rowCount": len(rows), "absentPairs": 4,
              "countries": [{"code": "USA", "name": "United States", "iso3": "USA"},
                            {"code": "CAN", "name": "Canada", "iso3": "CAN"}]}
    return content, {"report": report, "series": series, "records": rows}


class AnalysisTests(unittest.TestCase):
    def setUp(self):
        self.work = Path("backend/.test-work") / str(uuid.uuid4())
        self.work.mkdir(parents=True)
        self.db = self.work / "analysis.sqlite3"
        self.client = TestClient(create_app(self.db, self.work / "absent"), base_url="http://localhost:8000")
        self.client.__enter__()
        self.store = self.client.app.state.store
        self.analysis = AnalysisStore(self.store)
        self.headers = {"X-Research-Token": self.client.get("/api/session").json()["token"]}

    def tearDown(self):
        self.client.__exit__(None, None, None)
        shutil.rmtree(self.work)

    def stage(self, change=None):
        with self.store.connection() as conn:
            conn.execute("UPDATE provider_pulls SET started_at='2020-01-01T00:00:00Z' WHERE provider_id='imf-weo'")
        identifier = self.store.begin_provider_pull("imf-weo")
        content, result = fixture()
        if change:
            change(result)
        weo = WeoStore(self.store)
        weo.source(identifier, "/data/WEO/synthetic-fixture", 200, content)
        weo.complete(identifier, result)
        return identifier

    def test_preview_requires_explicit_source_and_never_activates(self):
        run_id = self.stage()
        before = self.client.get("/api/state").json()
        response = self.client.get(f"/api/analysis/preview/{run_id}")
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response.headers["cache-control"])
        value = response.json()
        self.assertEqual(value["digest"], digest({k: v for k, v in value.items() if k != "digest"}))
        usa = next(c for c in value["countries"] if c["code"] == "USA")
        self.assertTrue(usa["watchlisted"])
        self.assertEqual([m["changePp"] for m in usa["metrics"]], [2] * 4)
        self.assertTrue(all(m["latestActual"]["year"] == 2024 for m in usa["metrics"]))
        self.assertEqual(usa["metrics"][0]["rows"][-1]["classification"], "estimate_projection")
        canada = next(c for c in value["countries"] if c["code"] == "CAN")
        self.assertTrue(all(m["changeBlockedReason"] == "Series absent" for m in canada["metrics"]))
        self.assertFalse(value["publicAllowed"])
        self.assertEqual(self.client.get("/api/state").json(), before)
        self.assertEqual(self.analysis.summaries(), [])

    def test_immutable_bundle_replays_after_source_activation_and_restart_restore(self):
        run_id = self.stage()
        preview = self.analysis.preview(run_id)
        body = {"runId": run_id, "expectedDigest": preview["digest"],
                "researchUse": True, "reviewNote": "Reviewed synthetic fixture; not empirical"}
        response = self.client.post("/api/analysis/bundles", json=body, headers=self.headers)
        self.assertEqual(response.status_code, 201, response.text)
        bundle = response.json()
        self.assertFalse(WeoStore(self.store).get(run_id)["active"])
        WeoStore(self.store).activate(run_id)
        self.assertEqual(self.analysis.get(bundle["id"]), bundle)
        second = self.stage()
        WeoStore(self.store).activate(second)
        self.assertEqual(self.analysis.get(bundle["id"]), bundle)
        self.assertEqual(self.client.get("/api/analysis/bundles").json()[0]["digest"], preview["digest"])
        self.assertEqual(self.client.get("/api/analysis/bundles/" + bundle["id"]).json(), bundle)
        for sql in ("DELETE FROM analysis_bundles", "UPDATE analysis_bundles SET review_note='changed'"):
            with self.store.connection() as conn, self.assertRaisesRegex(sqlite3.IntegrityError, "immutable"):
                conn.execute(sql)
        self.assertTrue(any(e["event"] == "analysis_bundle_reviewed" for e in self.store.audit()))
        backup = self.work / "backup.sqlite3"
        backup.write_bytes(self.store.snapshot())
        verify_backup(backup)
        restored_path = self.work / "restored.sqlite3"
        restore_backup(backup, restored_path, offline=True)
        restored = Store(restored_path)
        restored.open()
        try:
            self.assertEqual(AnalysisStore(restored).get(bundle["id"]), bundle)
        finally:
            restored.close()

    def test_authorization_digest_rights_and_input_gates(self):
        run_id = self.stage()
        body = {"runId": run_id, "expectedDigest": self.analysis.preview(run_id)["digest"],
                "researchUse": True, "reviewNote": "Reviewed"}
        self.assertEqual(self.client.post("/api/analysis/bundles", json=body).status_code, 403)
        self.assertEqual(self.client.post("/api/analysis/bundles", json=body | {"expectedDigest": "0" * 64}, headers=self.headers).status_code, 409)
        for changes in ({"researchUse": False}, {"reviewNote": "  "}, {"publicAllowed": True}, {"reviewNote": "bad\nnote"}):
            response = self.client.post("/api/analysis/bundles", json=body | changes, headers=self.headers)
            self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.client.post("/api/analysis/bundles", content=b"x" * 4097, headers=self.headers).status_code, 413)
        self.assertEqual(self.client.get("/api/analysis/preview/missing").status_code, 404)
        self.assertEqual(self.client.get("/api/analysis/bundles/missing").status_code, 404)
        self.assertEqual(self.analysis.summaries(), [])

    def test_rejects_quarantine_incomplete_unknown_contract_and_broken_evidence(self):
        for changes in ({"errors": ["fixture failure"]}, {"transportComplete": False}, {"contractVersion": "future"}):
            run_id = self.stage(lambda r: r["report"].update(changes))
            self.assertEqual(self.client.get(f"/api/analysis/preview/{run_id}").status_code, 409)
        run_id = self.stage(lambda r: r["series"][0].update(sourceHash="0" * 64))
        self.assertEqual(self.client.get(f"/api/analysis/preview/{run_id}").status_code, 409)
        run_id = self.stage(lambda r: r["report"].update(rowCount=123456))
        self.assertEqual(self.client.get(f"/api/analysis/preview/{run_id}").status_code, 409)

    def test_schema12_migrates_without_changing_source_and_backup_requires_bundle_table(self):
        run_id = self.stage()
        old_manifest = WeoStore(self.store).get(run_id)
        self.client.__exit__(None, None, None)
        with closing(connect(self.db)) as conn:
            conn.execute("DROP TABLE analysis_bundles")
            conn.execute("PRAGMA user_version=12")
        self.client.__enter__()
        self.store = self.client.app.state.store
        self.analysis = AnalysisStore(self.store)
        self.assertEqual(WeoStore(self.store).get(run_id), old_manifest)
        with self.store.connection() as conn:
            self.assertEqual(conn.execute("PRAGMA user_version").fetchone()[0], DB_VERSION)
        backup = self.work / "invalid.sqlite3"
        backup.write_bytes(self.store.snapshot())
        with closing(connect(backup)) as conn:
            conn.execute("DROP TABLE analysis_bundles")
        with self.assertRaisesRegex(ValueError, "research database"):
            verify_backup(backup)

    def test_backup_and_reads_reject_corrupted_bundle_payload(self):
        run_id = self.stage()
        preview = self.analysis.preview(run_id)
        bundle = self.analysis.create(run_id, preview["digest"], "Reviewed synthetic fixture")
        backup = self.work / "corrupted.sqlite3"
        backup.write_bytes(self.store.snapshot())
        with closing(connect(backup)) as conn:
            conn.execute("DROP TRIGGER analysis_bundles_no_update")
            conn.execute("UPDATE analysis_bundles SET payload=json_set(payload,'$.analysis.publicAllowed',json('true'))")
        with self.assertRaisesRegex(ValueError, "integrity check"):
            verify_backup(backup)
        with closing(connect(backup)) as conn:
            conn.execute("UPDATE analysis_bundles SET payload=?", (json.dumps(bundle | {"reviewNote": "tampered"}),))
        with self.assertRaisesRegex(ValueError, "integrity check"):
            AnalysisStore(Store(backup)).get(bundle["id"])


class MacroDifferenceTests(unittest.TestCase):
    def test_year_gaps_breaks_units_unknown_and_definition_changes_block_differences(self):
        _, result = fixture()
        rows, series = result["records"][:4], result["series"][0]
        self.assertEqual(metric(rows, series)["changePp"], 2)
        cases = []
        for key, value in (("unit", "USD"), ("scale", "9"), ("analysisBlocked", True)):
            cases.append((rows, series | {key: value}))
        for classification in ("estimate_projection", "unknown"):
            cases.append(([rows[0] | {"classification": classification}, *rows[1:]], series))
        cases.append((rows[1:], series))
        cases.append(([rows[0] | {"value": None}, *rows[1:]], series))
        for status in ("B", "D", "F"):
            cases.append(([rows[0] | {"status": status}, *rows[1:]], series))
        changed = copy.deepcopy(rows)
        changed[1]["attributes"]["METHODOLOGY"] = "Changed definition"
        cases.append((changed, series))
        for values, metadata in cases:
            with self.subTest(values=values[:2], metadata=metadata):
                output = metric(values, metadata)
                self.assertIsNone(output["changePp"])
                self.assertTrue(output["changeBlockedReason"])
        unknown = [r | {"classification": "unknown"} for r in rows]
        self.assertIsNone(metric(unknown, series)["latestActual"])
        missing = [rows[0], rows[1] | {"value": None}, *rows[2:]]
        output = metric(missing, series)
        self.assertEqual(output["latestActual"]["year"], 2023)
        self.assertEqual(output["missingActualYears"], [2024])
