import hashlib
import json
import shutil
import unittest
import uuid
from contextlib import closing
from pathlib import Path
from threading import Event
from unittest.mock import patch
from xml.etree.ElementTree import Element, SubElement, tostring

import pycountry
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.imf import AcquisitionError
from backend.storage import Conflict, MIGRATIONS, Store, connect, restore_backup, verify_backup
from backend.weo import VERSION, acquire, metadata, parse
from backend.weo_storage import WeoStore

S = "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/structure"
C = "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/common"
M = "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message"
LANG = "{http://www.w3.org/XML/1998/namespace}lang"


def structure_fixture():
    root = Element(f"{{{M}}}Structure")
    SubElement(root, f"{{{S}}}Dataflow", id="WEO", agencyID="IMF.RES", version=VERSION)
    dsd = SubElement(root, f"{{{S}}}DataStructure", id="DSD_WEO", agencyID="IMF.RES", version=VERSION)
    dims = SubElement(SubElement(dsd, f"{{{S}}}DataStructureComponents"), f"{{{S}}}DimensionList")
    for i, name in enumerate(("COUNTRY", "INDICATOR", "FREQUENCY")):
        SubElement(dims, f"{{{S}}}Dimension", id=name, position=str(i))
    lists = {
        "CL_WEO_COUNTRY": {c.alpha_3: c.name for c in pycountry.countries},
        "CL_WEO_INDICATOR": {"BCA": "Current account", "NGDP_RPCH": "Real GDP growth", "PCOM": "Global-only commodity fixture"},
        "CL_UNIT": {"USD": "US dollar", "PT": "Percent"},
        "CL_UNIT_MULT": {"0": "Units", "9": "Billions"},
        "CL_OBS_STATUS": {"F": "Forecast", "A": "Normal", "O": "Missing", "P": "Provisional"},
    }
    for name, codes in lists.items():
        cl = SubElement(root, f"{{{S}}}Codelist", id=name)
        for code, label in codes.items():
            entry = SubElement(cl, f"{{{S}}}Code", id=code)
            SubElement(entry, f"{{{C}}}Name", {LANG: "en"}).text = label
            SubElement(entry, f"{{{C}}}Description", {LANG: "en"}).text = "Synthetic fixture, not empirical."
    return tostring(root)


def data_fixture(country="CAN", cutoff="2024", publication="2026-10-13T02:00:00Z", values=("1000000000", None, "1200000000", "1300000000"), **attrs):
    root = Element(f"{{{M}}}StructureSpecificData")
    SubElement(SubElement(root, f"{{{M}}}Header"), "Ref", id="WEO", agencyID="IMF.RES", version=VERSION)
    dataset = SubElement(root, f"{{{M}}}DataSet", PUBLICATION_DATE=publication, ACCESS_SHARING_LEVEL="PUBLIC_OPEN", SECURITY_CLASSIFICATION="PUB")
    SubElement(dataset, "Group", INDICATOR="BCA", UNIT="USD", SERIES_NAME="Fixture current account")
    SubElement(dataset, "Group", COUNTRY=country, INDICATOR="BCA", LATEST_ACTUAL_ANNUAL_DATA=cutoff, METHODOLOGY="fixture")
    series = SubElement(dataset, "Series", COUNTRY=country, INDICATOR="BCA", FREQUENCY="A", SCALE="9", **attrs)
    for year, value in zip(("2023", "2024", "2025", "2026"), values):
        row = {"TIME_PERIOD": year}
        if value is not None:
            row["OBS_VALUE"] = value
        SubElement(series, "Obs", row)
    return tostring(root)


def result_fixture():
    countries = [{"code": "CAN", "name": "Canada", "iso3": "CAN"}]

    def get(path):
        return structure_fixture() if path.startswith("/dataflow/") else data_fixture()

    with patch("backend.weo.universe", return_value=(countries, [])):
        return acquire(get, lambda progress: None)


class WeoParserTests(unittest.TestCase):
    def setUp(self):
        self.catalog = metadata(structure_fixture())

    def test_metadata_uses_annual_res_agency_and_all_indicator_catalog(self):
        self.assertEqual(len(self.catalog["indicators"]), 3)
        for change in [(b'IMF.RES', b'IMF.STA'), (b'9.0.0', b'10.0.0'), (b'FREQUENCY', b'UNEXPECTED')]:
            with self.assertRaises(AcquisitionError):
                metadata(structure_fixture().replace(*change))
        with self.assertRaises(AcquisitionError):
            metadata(b"<html/>")

    def test_native_scale_not_applied_inherited_boundary_and_missing_values(self):
        result = parse(data_fixture(), ["CAN"], self.catalog)
        self.assertEqual(result["publicationDate"], "2026-10-13T02:00:00Z")
        self.assertEqual([r["classification"] for r in result["records"]], ["actual", "actual", "estimate_projection", "estimate_projection"])
        self.assertEqual([r["value"] for r in result["records"]], [1e9, None, 1.2e9, 1.3e9])
        self.assertEqual(result["records"][0]["rawValue"], "1000000000")
        self.assertEqual(result["series"][0]["scale"], "9")
        self.assertEqual(result["series"][0]["latestActualYear"], 2024)
        self.assertEqual(result["series"][0]["unit"], "USD")
        self.assertEqual(result["series"][0]["sourceHash"], hashlib.sha256(data_fixture()).hexdigest())

    def test_historical_estimates_not_mislabeled_actual_and_unknown_fiscal_boundaries(self):
        result = parse(data_fixture(cutoff="2023"), ["CAN"], self.catalog)
        self.assertEqual(result["records"][1]["classification"], "estimate_projection")
        for boundary in ("", "FY2024/25", "Not applicable", "unmapped"):
            result = parse(data_fixture(cutoff=boundary), ["CAN"], self.catalog)
            self.assertTrue(all(r["classification"] == "unknown" for r in result["records"]))
            self.assertTrue(result["series"][0]["analysisBlocked"])
            self.assertEqual(result["series"][0]["attributes"]["LATEST_ACTUAL_ANNUAL_DATA"], boundary)

    def test_missing_units_remain_unverified_not_guessed_from_indicator(self):
        result = parse(data_fixture().replace(b'UNIT="USD"', b''), ["CAN"], self.catalog)
        self.assertIsNone(result["series"][0]["unit"])
        self.assertTrue(result["series"][0]["analysisBlocked"])
        with self.assertRaisesRegex(AcquisitionError, "unknown source unit"):
            parse(data_fixture().replace(b'UNIT="USD"', b'UNIT="NEW_UNIT"'), ["CAN"], self.catalog)

    def test_reject_wrong_dimensions_duplicate_nonfinite_units_security_and_status(self):
        cases = [
            data_fixture().replace(b'COUNTRY="CAN"', b'COUNTRY="USA"'),
            data_fixture().replace(b'FREQUENCY="A"', b'FREQUENCY="M"'),
            data_fixture().replace(b'INDICATOR="BCA"', b'INDICATOR="BOGUS"'),
            data_fixture().replace(b'2026"', b'2025"'),
            data_fixture().replace(b'TIME_PERIOD="2026"', b'TIME_PERIOD="2026-M01"'),
            data_fixture(values=("NaN", None, "1", "2")), data_fixture(values=("inf", None, "1", "2")),
            data_fixture().replace(b'SCALE="9"', b'SCALE="999"'),
            data_fixture().replace(b'PUBLIC_OPEN', b'RESTRICTED'),
            data_fixture().replace(b'TIME_PERIOD="2023"', b'TIME_PERIOD="2023" SECURITY_CLASSIFICATION="SECRET"'),
            data_fixture().replace(b'TIME_PERIOD="2023"', b'TIME_PERIOD="2023" STATUS="T"'),
            data_fixture().replace(b'TIME_PERIOD="2023"', b'TIME_PERIOD="2023" UNIT="PT"'),
        ]
        for content in cases:
            with self.subTest(content=content[-120:]), self.assertRaises(AcquisitionError):
                parse(content, ["CAN"], self.catalog)
        negative = parse(data_fixture(values=("-10", "0", "1", "2")), ["CAN"], self.catalog)
        self.assertEqual(negative["records"][0]["value"], -10)

    def test_forecast_status_overrides_actual_boundary_missing_status_preserved(self):
        result = parse(data_fixture().replace(b'TIME_PERIOD="2023"', b'TIME_PERIOD="2023" STATUS="F"'), ["CAN"], self.catalog)
        self.assertEqual(result["records"][0]["classification"], "estimate_projection")
        result = parse(data_fixture().replace(b'TIME_PERIOD="2024"', b'TIME_PERIOD="2024" STATUS="n.a."'), ["CAN"], self.catalog)
        self.assertIsNone(result["records"][1]["value"])
        self.assertEqual(result["records"][1]["status"], "n.a.")
        result = parse(data_fixture(STATUS="F"), ["CAN"], self.catalog)
        self.assertTrue(all(r["classification"] == "estimate_projection" for r in result["records"]))
        with self.assertRaisesRegex(AcquisitionError, "after release"):
            parse(data_fixture(cutoff="2031"), ["CAN"], self.catalog)
        with self.assertRaisesRegex(AcquisitionError, "publication"):
            parse(data_fixture(publication="2026-99-13T02:00:00Z"), ["CAN"], self.catalog)

    def test_all_catalog_pairs_reported_but_incomplete_coverage_does_not_quarantine(self):
        result = result_fixture()
        self.assertEqual(result["report"]["errors"], [])
        self.assertEqual(result["report"]["requiredPairs"], 3)
        self.assertEqual(result["report"]["absentPairs"], 2)
        self.assertEqual(result["series"][0]["missingYears"], [2024])
        self.assertEqual((result["report"]["firstYear"], result["report"]["lastYear"]), (2023, 2026))

    def test_mixed_release_timestamp_empty_data_budget_and_transport_fail_explicitly(self):
        countries = [{"code": c.alpha_3, "name": c.name, "iso3": c.alpha_3} for c in list(pycountry.countries)[:21]]
        calls = []

        def get(path):
            calls.append(path)
            if path.startswith("/dataflow/"):
                return structure_fixture()
            return data_fixture(country=path.split("/")[3].split("+")[0].split(".")[0],
                                publication="2026-10-13T02:00:00Z" if len(calls) == 2 else "2027-04-13T02:00:00Z")

        with patch("backend.weo.universe", return_value=(countries, [])), self.assertRaisesRegex(AcquisitionError, "mixed vintages"):
            acquire(get, lambda progress: None)
        with patch("backend.weo.universe", return_value=(countries, [])), self.assertRaisesRegex(AcquisitionError, "no valid"):
            acquire(lambda path: structure_fixture() if path.startswith("/dataflow/") else None, lambda progress: None)
        with patch("backend.weo.MAX_ROWS", 1), self.assertRaisesRegex(AcquisitionError, "budget"):
            result_fixture()


class WeoStorageTests(unittest.TestCase):
    def setUp(self):
        self.work = Path("backend/.test-work") / str(uuid.uuid4())
        self.work.mkdir(parents=True)
        self.db = self.work / "weo.sqlite3"
        self.client = TestClient(create_app(self.db, self.work / "absent"), base_url="http://localhost:8000")
        self.client.__enter__()
        self.store = self.client.app.state.store
        self.weo = WeoStore(self.store)
        self.headers = {"X-Research-Token": self.client.get("/api/session").json()["token"]}

    def tearDown(self):
        self.client.__exit__(None, None, None)
        shutil.rmtree(self.work)

    def stage(self):
        with closing(connect(self.db)) as conn:
            conn.execute("UPDATE provider_pulls SET started_at='2020-01-01T00:00:00Z' WHERE provider_id='imf-weo'")
        identifier = self.store.begin_provider_pull("imf-weo")
        self.weo.source(identifier, "/data/WEO/fixture-not-empirical", 200, data_fixture())
        self.weo.complete(identifier, result_fixture())
        return identifier

    def test_incomplete_release_explicit_commit_and_complete_absent_pair_coverage(self):
        identifier = self.stage()
        manifest = self.client.get(f"/api/weo/{identifier}").json()
        self.assertFalse(manifest["active"])
        self.assertEqual(manifest["status"], "staged")
        page = self.client.get(f"/api/weo/{identifier}/coverage?limit=2&offset=1").json()
        self.assertEqual(page["total"], 3)
        self.assertTrue(all(r["absent"] for r in page["rows"]))
        self.assertEqual(page["rows"][0]["missingYears"], [2023, 2024, 2025, 2026])
        absent = self.client.get(f"/api/weo/{identifier}/observations?country=CAN&indicator=PCOM").json()
        self.assertEqual(absent["rows"], [])
        self.assertIsNone(absent["series"])
        values = self.client.get(f"/api/weo/{identifier}/observations?country=CAN&indicator=BCA")
        self.assertIn("no-store", values.headers["cache-control"])
        self.assertEqual(values.json()["rows"][2]["classification"], "estimate_projection")
        self.assertEqual(self.client.post(f"/api/weo/{identifier}/commit", headers=self.headers).status_code, 200)
        self.assertTrue(self.weo.get(identifier)["active"])
        state = self.client.get("/api/state").json()
        self.assertEqual(state["datasets"], [])
        self.assertEqual(state["macro"], [])
        self.assertEqual(len(state["providers"]), 10)
        self.assertNotIn("countries", state["weo"][0]["report"])
        self.assertEqual(self.client.get(f"/api/weo/{identifier}/observations?country=CAN&indicator=invalid").status_code, 404)
        self.assertEqual(self.client.get(f"/api/weo/{identifier}/coverage?limit=501").status_code, 422)

    def test_originals_export_immutable_native_rows_backup_and_rollback(self):
        first, second = self.stage(), self.stage()
        self.weo.activate(first)
        self.weo.activate(second)
        self.assertEqual(self.weo.get(second)["report"]["revisionComparison"]["overlapCount"], 4)
        self.weo.rollback(second)
        self.assertTrue(self.weo.get(first)["active"])
        with self.assertRaises(Conflict):
            self.weo.activate(second)
        self.assertEqual(self.weo.original(first, 1), data_fixture())
        export = [json.loads(line) for line in self.client.get(f"/api/weo/{first}/export").text.splitlines()]
        self.assertEqual(len(export), 6)
        self.assertEqual(export[0]["type"], "manifest")
        self.assertEqual(export[1]["type"], "series")
        self.assertEqual(export[2]["data"]["rawValue"], "1000000000")
        with closing(connect(self.db)) as conn:
            for table in ("weo_rows", "weo_series", "weo_sources"):
                with self.assertRaisesRegex(Exception, "immutable"):
                    conn.execute(f"DELETE FROM {table} WHERE run_id=?", (first,))
        backup = self.work / "backup.sqlite3"
        backup.write_bytes(self.store.snapshot())
        target = self.work / "restored.sqlite3"
        restore_backup(backup, target, offline=True)
        restored = Store(target)
        restored.open()
        try:
            self.assertEqual(WeoStore(restored).get(first), self.weo.get(first))
        finally:
            restored.close()

    def test_independent_guards_and_restart_preserve_active_selection_and_raw_sources(self):
        first = self.stage()
        self.weo.activate(first)
        with closing(connect(self.db)) as conn:
            conn.execute("UPDATE provider_pulls SET started_at='2020-01-01T00:00:00Z' WHERE provider_id='imf-weo'")
        self.store.begin_provider_pull("imf")
        self.store.begin_provider_pull()
        running = self.store.begin_provider_pull("imf-weo")
        with self.assertRaises(Conflict):
            self.store.begin_provider_pull("imf-weo")
        self.weo.source(running, "/data/partial#incomplete-response", 200, b"partial")
        self.store.close()
        self.store.open()
        self.assertEqual(self.weo.get(running)["status"], "interrupted")
        self.assertTrue(self.weo.get(first)["active"])
        self.assertEqual(self.weo.original(running, 1), b"partial")

    def test_completion_atomic_and_cannot_activate_empty_or_bad_rows(self):
        identifier = self.store.begin_provider_pull("imf-weo")
        fixture = result_fixture()
        fixture["records"].append(fixture["records"][0])
        with self.assertRaises(Exception):
            self.weo.complete(identifier, fixture)
        with closing(connect(self.db)) as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM weo_rows").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT count(*) FROM weo_series").fetchone()[0], 0)
        with self.assertRaises(Conflict):
            self.weo.activate(identifier)

    def test_manual202_token_body_validation_failure_and_no_network(self):
        for body in ({}, {"researchUse": False}, {"researchUse": True, "url": "https://other"}):
            self.assertEqual(self.client.post("/api/providers/imf-weo/pull", headers=self.headers, json=body).status_code, 422)
        self.assertEqual(self.client.post("/api/providers/imf-weo/pull", json={"researchUse": True}).status_code, 403)
        self.assertEqual(self.client.post("/api/providers/imf-weo/pull", headers=self.headers, content=b"x"*1025).status_code, 413)
        with patch("backend.weo.acquire", return_value=result_fixture()):
            response = self.client.post("/api/providers/imf-weo/pull", headers=self.headers, json={"researchUse": True})
            self.assertEqual(response.status_code, 202)
            self.client.app.state.weo_executor.shutdown(wait=True)
        self.assertEqual(self.weo.get(response.json()["id"])["status"], "staged")
        self.assertFalse(self.weo.get(response.json()["id"])["active"])

    def test_cancel_and_unexpected_failure_durable(self):
        entered, release = Event(), Event()

        def acquisition(get, progress):
            entered.set()
            release.wait(5)
            get("/data/WEO/must-not-request")

        with patch("backend.weo.acquire", side_effect=acquisition), patch("backend.imf.httpx.stream") as request:
            response = self.client.post("/api/providers/imf-weo/pull", headers=self.headers, json={"researchUse": True})
            self.assertTrue(entered.wait(3))
            try:
                self.assertEqual(self.client.post(f"/api/providers/imf-weo/{response.json()['id']}/cancel", headers=self.headers).status_code, 200)
            finally:
                release.set()
            self.client.app.state.weo_executor.shutdown(wait=True)
        request.assert_not_called()
        self.assertEqual(self.weo.get(response.json()["id"])["status"], "interrupted")

    def test_failed_provider_job_retains_prior_active_release_and_redacts_unexpected_errors(self):
        first = self.stage()
        self.weo.activate(first)
        with closing(connect(self.db)) as conn:
            conn.execute("UPDATE provider_pulls SET started_at='2020-01-01T00:00:00Z' WHERE provider_id='imf-weo'")
        with patch("backend.weo.acquire", side_effect=RuntimeError("private exception detail")):
            response = self.client.post("/api/providers/imf-weo/pull", headers=self.headers, json={"researchUse": True})
            self.client.app.state.weo_executor.shutdown(wait=True)
        failure = self.weo.get(response.json()["id"])
        self.assertEqual(failure["status"], "interrupted")
        self.assertIn("RuntimeError", failure["report"]["errors"][0])
        self.assertNotIn("private exception detail", json.dumps(failure))
        self.assertTrue(self.weo.get(first)["active"])

    def test_migration4_preserves_monthly_provider(self):
        path = self.work / "v4.sqlite3"
        with closing(connect(path)) as conn:
            for number in (1, 2, 3, 4):
                for sql in MIGRATIONS[number]:
                    conn.execute(sql)
            conn.execute("PRAGMA user_version=4")
            conn.execute("INSERT INTO provider_pulls VALUES ('old','2020-01-01T00:00:00Z',NULL,'staged',NULL,'{}','imf')")
            conn.execute("INSERT INTO macro_runs VALUES ('old','2020-01-01T00:00:00Z','quarantined','{}','{}',0,NULL)")
        store = Store(path)
        store.open()
        try:
            state = store.state()
            self.assertEqual(state.macro[0]["id"], "old")
            self.assertEqual(state.weo, [])
            self.assertEqual(state.providers[2]["id"], "imf-weo")
        finally:
            store.close()

    def test_schema5_backup_without_weo_tables_is_rejected_before_restore(self):
        path = self.work / "incomplete.sqlite3"
        with closing(connect(path)) as conn:
            for number in (1, 2, 3, 4):
                for sql in MIGRATIONS[number]:
                    conn.execute(sql)
            conn.execute("PRAGMA user_version=5")
        with self.assertRaisesRegex(Conflict, "not a research database"):
            verify_backup(path)


if __name__ == "__main__":
    unittest.main()
