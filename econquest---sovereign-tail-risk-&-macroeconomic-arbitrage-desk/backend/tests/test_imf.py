import hashlib
import json
import shutil
import unittest
import uuid
from contextlib import closing, nullcontext
from datetime import datetime, timezone
from pathlib import Path
from threading import Event
from unittest.mock import patch
from xml.etree.ElementTree import Element, SubElement, tostring

import httpx
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.imf import (
    AcquisitionError, CONTRACT, COVERAGE_POLICY, Downloader, DSD_VERSIONS, FLOW_DIMENSIONS, FLOW_VERSIONS, INDICATORS, acquire, coverage,
    month_window, parse_data, structures, universe,
)
from backend.macro_storage import MacroStore
from backend.storage import Conflict, MIGRATIONS, Store, connect, restore_backup

S = "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/structure"
C = "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/common"
M = "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message"
LANG = "{http://www.w3.org/XML/1998/namespace}lang"
MONTHS = ["2025-01", "2025-02", "2025-03"]


def structure_fixture(flow):
    root = Element(f"{{{M}}}Structure")
    SubElement(root, f"{{{S}}}Dataflow", id=flow, agencyID="IMF.STA", version=FLOW_VERSIONS[flow])
    dsd = SubElement(root, f"{{{S}}}DataStructure", id=DSD_VERSIONS[flow][0], version=DSD_VERSIONS[flow][1], agencyID="IMF.STA")
    dims = SubElement(SubElement(dsd, f"{{{S}}}DataStructureComponents"), f"{{{S}}}DimensionList")
    for i, name in enumerate(FLOW_DIMENSIONS[flow]):
        SubElement(dims, f"{{{S}}}Dimension", id=name, position=str(i))
    lists = {
        "CL_COUNTRY": {"CAN": "Canada", "USA": "United States"},
        "CL_UNIT_MULT": {"0": "Units", "6": "Millions"},
        "CL_OBS_STATUS": {"A": "Normal value", "F": "Forecast value", "E": "Estimated value", "P": "Provisional value", "O": "Missing value"},
    }
    for indicator in INDICATORS:
        if indicator["flow"] == flow:
            for name, (code, label) in indicator["codes"].items():
                lists.setdefault(name, {})[code] = label
    for name, codes in lists.items():
        cl = SubElement(root, f"{{{S}}}Codelist", id=name)
        for code, label in codes.items():
            entry = SubElement(cl, f"{{{S}}}Code", id=code)
            SubElement(entry, f"{{{C}}}Name", {LANG: "en"}).text = label
    return tostring(root)


def data_fixture(indicator=None, country="CAN", values=("100", "101", "102"), **attrs):
    indicator = indicator or INDICATORS[0]
    flow = indicator["flow"]
    root = Element(f"{{{M}}}StructureSpecificData")
    SubElement(SubElement(root, f"{{{M}}}Header"), "Ref", id=flow, agencyID="IMF.STA", version=FLOW_VERSIONS[flow])
    dataset = SubElement(root, f"{{{M}}}DataSet", PUBLICATION_DATE="2025-04-10T00:00:00Z")
    SubElement(dataset, "Group", INDEX_TYPE="CPI", KEYWORDS="fixture")
    dims = dict(zip(FLOW_DIMENSIONS[flow], [country, *indicator["key"].split(".")]))
    series = SubElement(dataset, "Series", dims | {"SCALE": "0", "IFS_FLAG": "true", "ACCESS_SHARING_LEVEL": "PUBLIC_OPEN", "SECURITY_CLASSIFICATION": "PUB"} | attrs)
    for month, value in zip(MONTHS, values):
        row = {"TIME_PERIOD": month.replace("-", "-M"), "REFERENCE_PERIOD": "2010A"}
        if value is not None:
            row["OBS_VALUE"] = value
        SubElement(series, "Obs", row)
    return tostring(root)


def result_fixture(missing=False):
    countries = [{"code": "CAN", "name": "Canada", "iso3": "CAN"}]
    records = []
    for ind in INDICATORS:
        if missing and ind["id"] == "rate":
            continue
        parsed, _ = parse_data(data_fixture(ind), ind, ["CAN"], MONTHS, structures(structure_fixture(ind["flow"]), ind["flow"]))
        records.extend(parsed)
    matrix = coverage(countries, records, MONTHS)
    return {"records": records, "coverage": matrix, "report": {
        "errors": ["1 required pair absent"] if missing else [], "countries": countries,
        "indicators": [{k: v for k, v in i.items() if k != "codes"} for i in INDICATORS],
        "contractVersion": "fixture-not-empirical", "rowCount": len(records), "requiredPairs": 5,
        "absentPairs": int(missing), "startPeriod": MONTHS[0], "endPeriod": MONTHS[-1],
        "valueConvention": "Native fixture values, no scaling conversion", "transportComplete": True,
    }}


class ImfParserTests(unittest.TestCase):
    def parse(self, content, indicator=None):
        ind = indicator or INDICATORS[0]
        return parse_data(content, ind, ["CAN"], MONTHS, structures(structure_fixture(ind["flow"]), ind["flow"]))

    def test_months_are_120_completed_periods_across_leap_and_year_boundaries(self):
        months = month_window(datetime(2024, 3, 1, tzinfo=timezone.utc))
        self.assertEqual(len(months), 120)
        self.assertEqual(months[0], "2014-03")
        self.assertEqual(months[-1], "2024-02")

    def test_verified_dimension_order_and_names_not_legacy_codes(self):
        for flow in FLOW_VERSIONS:
            self.assertEqual(structures(structure_fixture(flow), flow)["dimensions"], FLOW_DIMENSIONS[flow])
        content = structure_fixture("CPI").replace(b"All Items", b"Food")
        with self.assertRaisesRegex(AcquisitionError, "definition changed"):
            structures(content, "CPI")
        with self.assertRaisesRegex(AcquisitionError, "version"):
            structures(structure_fixture("CPI").replace(b'5.0.0', b'6.0.0'), "CPI")

    def test_native_values_missing_scale_and_group_attribute_inheritance(self):
        rows, warnings = self.parse(data_fixture(values=("100", None, "102")))
        self.assertEqual([r["value"] for r in rows], [100, None, 102])
        self.assertEqual(rows[0]["attributes"]["KEYWORDS"], "fixture")
        self.assertEqual(rows[0]["attributes"]["PUBLICATION_DATE"], "2025-04-10T00:00:00Z")
        self.assertEqual(warnings, [])
        rows, _ = self.parse(data_fixture(SCALE="6", values=("125165368431.7875", None, "102")))
        self.assertEqual(rows[0]["value"], 125165368431.7875)
        self.assertEqual(rows[0]["scale"], "6")
        self.assertEqual(rows[0]["rawValue"], "125165368431.7875")

    def test_forecasts_and_nonifs_excluded_provisional_preserved(self):
        for attrs in [{"STATUS": "F"}, {"IFS_FLAG": "false"}, {"STATUS": "O"}]:
            rows, _ = self.parse(data_fixture(**attrs))
            self.assertTrue(all(r["value"] is None for r in rows))
        for status in ["P", "E"]:
            rows, _ = self.parse(data_fixture(STATUS=status))
            self.assertEqual(rows[0]["value"], 100)
            self.assertEqual(rows[0]["status"], status)
        rows, warnings = self.parse(data_fixture(values=(None, None, None), STATUS="n.a."))
        self.assertTrue(all(r["value"] is None and r["status"] == "n.a." for r in rows))
        self.assertEqual(len(warnings), 3)
        rows, warnings = self.parse(data_fixture(STATUS="T"))
        self.assertTrue(all(r["value"] is None and r["rawValue"] is not None and r["status"] == "T" for r in rows))
        self.assertTrue(all(r["exclusionReason"] == "Unknown source observation status" for r in rows))
        self.assertEqual(len(warnings), 3)
        for bad in ("NaN", "inf", "-1"):
            with self.assertRaises(AcquisitionError):
                self.parse(data_fixture(STATUS="T", values=(bad, "101", "102")))

    def test_reject_wrong_dimensions_confidential_nan_scale_status_period_and_duplicates(self):
        cases = [
            data_fixture().replace(b'COICOP_1999="_T"', b'COICOP_1999="CP01"'),
            data_fixture().replace(b'FREQUENCY="M"', b'FREQUENCY="Q"'),
            data_fixture().replace(b'COUNTRY="CAN"', b'COUNTRY="USA"'),
            data_fixture(ACCESS_SHARING_LEVEL="PRIVATE"),
            data_fixture(SECURITY_CLASSIFICATION="CONFIDENTIAL"),
            data_fixture(SCALE="99"),
            data_fixture(values=("NaN", "100", "100")), data_fixture(values=("inf", "100", "100")),
            data_fixture(values=("-1", "100", "100")),
            data_fixture().replace(b"2025-M03", b"2025-M04"),
            data_fixture().replace(b"2025-M03", b"2025-M02"),
        ]
        for content in cases:
            with self.subTest(content=content[-100:]), self.assertRaises((AcquisitionError, ValueError)):
                self.parse(content)
        with self.assertRaises(AcquisitionError):
            self.parse(b"<html>not data</html>")

    def test_negative_inflation_rates_valid_and_reserves_domain(self):
        for identifier in ["inflation", "rate"]:
            ind = next(i for i in INDICATORS if i["id"] == identifier)
            rows, _ = self.parse(data_fixture(ind, values=("-1", "0", "1")), ind)
            self.assertEqual(rows[0]["value"], -1)
        ind = next(i for i in INDICATORS if i["id"] == "reserves")
        with self.assertRaises(AcquisitionError):
            self.parse(data_fixture(ind, values=("-1", "0", "1")), ind)

    def test_internal_gaps_disclosed_but_entirely_absent_pair_blocks(self):
        fixture = result_fixture()
        self.assertEqual(sum(r["absent"] for r in fixture["coverage"]), 0)
        self.assertEqual(sum(r["absent"] for r in result_fixture(True)["coverage"]), 1)
        records = [r for r in fixture["records"] if r["period"] != "2025-02"]
        matrix = coverage(fixture["report"]["countries"], records, MONTHS)
        self.assertTrue(all(not r["absent"] and r["missingPeriods"] == ["2025-02"] for r in matrix))

    def test_area_mapping_includes_reviewed_exceptions_and_reports_unknown(self):
        import pycountry
        areas = {c.alpha_3: {"name": c.name, "description": ""} for c in pycountry.countries if c.alpha_3 != "PSE"}
        areas.update({
            "KOS": {"name": "Kosovo, Republic of", "description": ""},
            "WBG": {"name": "West Bank and Gaza", "description": ""},
            "G001": {"name": "World", "description": ""},
            "SUN": {"name": "USSR", "description": ""},
            "NEW": {"name": "Unknown area", "description": ""},
        })
        countries, excluded = universe(areas)
        self.assertTrue(any(c["code"] == "KOS" and c["iso3"] is None for c in countries))
        self.assertTrue(any(c["code"] == "WBG" and c["iso3"] == "PSE" for c in countries))
        self.assertEqual({r["code"] for r in excluded}, {"G001", "SUN", "NEW"})
        self.assertIn("activation blocked", next(r for r in excluded if r["code"] == "NEW")["reason"])

    def test_downloader_public_route_budget_http_and_cancel_explicit(self):
        saved, progress = [], []
        stop = Event()
        downloader = Downloader(stop, lambda *args: saved.append(args), progress.append)
        with patch("backend.imf.httpx.stream", return_value=nullcontext(httpx.Response(204))):
            self.assertIsNone(downloader.get("/data/CPI/fixture"))
        self.assertEqual(saved[0][1:], (204, b""))
        for status in [401, 403, 429, 500]:
            with patch("backend.imf.httpx.stream", return_value=nullcontext(httpx.Response(status, content=b"error"))):
                with self.assertRaisesRegex(AcquisitionError, str(status)):
                    downloader.get("/data/CPI/fixture")
        stop.set()
        with patch("backend.imf.httpx.stream") as request, self.assertRaisesRegex(AcquisitionError, "cancelled"):
            downloader.get("/data/CPI/fixture")
        request.assert_not_called()

    def test_unknown_status_excludes_only_affected_rows_and_allows_disclosed_missing_pairs(self):
        def get(path):
            if path.startswith("/dataflow/"):
                return structure_fixture(path.split("/")[3])
            flow = path.split("/")[2]
            indicator = next(i for i in INDICATORS if i["flow"] == flow and i["key"] in path)
            return data_fixture(indicator, STATUS="T") if indicator["id"] == "fx" else data_fixture(indicator)
        with patch("backend.imf.universe", return_value=([{"code": "CAN", "name": "Canada", "iso3": "CAN"}], [])), patch("backend.imf.month_window", return_value=MONTHS):
            result = acquire(get, lambda progress: None)
        self.assertEqual(len(result["coverage"]), 5)
        self.assertEqual(len(result["records"]), 15)
        self.assertEqual(result["report"]["absentPairs"], 1)
        self.assertEqual(result["report"]["errors"], [])
        self.assertEqual(result["report"]["unknownStatusRows"], 3)
        self.assertEqual(result["report"]["numericCount"], 12)
        self.assertEqual(result["report"]["coveragePolicy"], COVERAGE_POLICY)
        self.assertTrue(all(row["value"] is None and row["rawValue"] is not None for row in result["records"] if row["indicator"] == "fx"))

    def test_invalid_response_still_quarantines_and_all_missing_has_no_numeric_error(self):
        def get(path):
            if path.startswith("/dataflow/"):
                return structure_fixture(path.split("/")[3])
            flow = path.split("/")[2]
            ind = next(i for i in INDICATORS if i["flow"] == flow and i["key"] in path)
            return data_fixture(ind, SCALE="99") if ind["id"] == "fx" else data_fixture(ind)
        scope = [{"code": "CAN", "name": "Canada", "iso3": "CAN"}]
        with patch("backend.imf.universe", return_value=(scope, [])), patch("backend.imf.month_window", return_value=MONTHS):
            r = acquire(get, lambda p: None)
            self.assertTrue(any("Rejected fx response" in error for error in r["report"]["errors"]))
            self.assertEqual(len(r["records"]), 12)
            r = acquire(lambda path: structure_fixture(path.split("/")[3]) if path.startswith("/dataflow/") else None, lambda p: None)
            self.assertEqual(r["report"]["numericCount"], 0)
            self.assertIn("No usable numeric monthly observations", r["report"]["errors"])

    def test_downloader_budgets_timeouts_and_partial_capture(self):
        saved = []
        downloader = Downloader(Event(), lambda *args: saved.append(args), lambda progress: None)
        with patch("backend.imf.MAX_RESPONSE", 8), patch("backend.imf.httpx.stream", return_value=nullcontext(httpx.Response(200, content=b"123456789"))):
            with self.assertRaisesRegex(AcquisitionError, "byte budget"):
                downloader.get("/data/CPI/fixture")
        self.assertEqual(saved, [("/data/CPI/fixture#incomplete-response", 200, b"12345678")])
        for exception in [httpx.ReadTimeout("timeout"), httpx.ConnectError("failure")]:
            with patch("backend.imf.httpx.stream", side_effect=exception), self.assertRaisesRegex(AcquisitionError, "transport failed"):
                downloader.get("/data/CPI/fixture")
        downloader.count = 128
        with self.assertRaisesRegex(AcquisitionError, "request budget"):
            downloader.get("/data/CPI/fixture")
        downloader.deadline = 0
        with self.assertRaisesRegex(AcquisitionError, "deadline"):
            downloader.get("/data/CPI/fixture")


class ImfStorageApiTests(unittest.TestCase):
    def setUp(self):
        self.work = Path("backend/.test-work") / str(uuid.uuid4())
        self.work.mkdir(parents=True)
        self.db = self.work / "imf.sqlite3"
        self.app = create_app(self.db, self.work / "absent")
        self.client = TestClient(self.app, base_url="http://localhost:8000", raise_server_exceptions=False)
        self.client.__enter__()
        self.store = self.app.state.store
        self.macro = MacroStore(self.store)
        self.headers = {"X-Research-Token": self.client.get("/api/session").json()["token"]}

    def tearDown(self):
        self.client.__exit__(None, None, None)
        shutil.rmtree(self.work)

    def stage(self, missing=False, available=False):
        with closing(connect(self.db)) as conn:
            conn.execute("UPDATE provider_pulls SET started_at='2020-01-01T00:00:00Z' WHERE provider_id='imf'")
        identifier = self.store.begin_provider_pull("imf")
        self.macro.source(identifier, "/data/fixture-not-empirical", 200, b"source fixture")
        result = result_fixture(missing)
        if available:
            result["report"].update(contractVersion=CONTRACT, coveragePolicy=COVERAGE_POLICY,
                                    errors=[], numericCount=sum(r["value"] is not None for r in result["records"]))
        self.macro.complete(identifier, result)
        return identifier

    def test_independent_provider_guard_and_imf_summary_not_full_rows(self):
        yahoo = self.store.begin_provider_pull()
        imf = self.store.begin_provider_pull("imf")
        self.assertNotEqual(yahoo, imf)
        with self.assertRaises(Conflict):
            self.store.begin_provider_pull("imf")
        self.macro.complete(imf, result_fixture())
        state = self.client.get("/api/state").json()
        self.assertEqual(len(state["providers"]), 10)
        self.assertEqual(state["providers"][0]["status"], "running")
        self.assertEqual(state["providers"][1]["status"], "staged")
        self.assertEqual(state["datasets"], [])
        self.assertNotIn("records", state["macro"][0])
        self.assertNotIn("countries", state["macro"][0]["report"])

    def test_monthly_contract_capability_is_explicit_and_not_cached(self):
        response = self.client.get("/api/providers/imf/config")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.json(), {"contractVersion": CONTRACT, "coveragePolicy": COVERAGE_POLICY})

    def test_explicit_commit_native_pagination_manifest_export_and_quarantine(self):
        identifier = self.stage()
        self.assertFalse(self.macro.get(identifier)["active"])
        page = self.client.get(f"/api/macro/{identifier}/coverage?limit=2&offset=1").json()
        self.assertEqual(page["total"], 5)
        self.assertEqual(len(page["rows"]), 2)
        self.assertEqual(self.client.get(f"/api/macro/{identifier}/coverage?limit=501").status_code, 422)
        response = self.client.get(f"/api/macro/{identifier}/observations?country=CAN&indicator=cpi").json()
        self.assertEqual(len(response["rows"]), 3)
        manifest = self.client.get(f"/api/macro/{identifier}").json()
        self.assertEqual(manifest["sources"][0]["sha256"], hashlib.sha256(b"source fixture").hexdigest())
        self.assertEqual(self.client.get(f"/api/macro/{identifier}/sources/1").content, b"source fixture")
        export = self.client.get(f"/api/macro/{identifier}/export").text.splitlines()
        self.assertEqual(json.loads(export[0])["type"], "manifest")
        self.assertEqual(len(export), 1 + 15 + 5)
        self.assertEqual(self.client.post(f"/api/macro/{identifier}/commit", headers=self.headers).status_code, 200)
        self.assertTrue(self.macro.get(identifier)["active"])
        failed = self.stage(missing=True)
        self.assertEqual(self.client.post(f"/api/macro/{failed}/commit", headers=self.headers).status_code, 409)
        self.assertTrue(self.macro.get(identifier)["active"])
        self.assertEqual(self.client.get(f"/api/macro/{failed}/coverage").json()["total"], 5)

    def test_v2_incomplete_coverage_activates_separately_but_legacy_remains_strict(self):
        prior = self.store.state()
        identifier = self.stage(missing=True, available=True)
        self.assertEqual(self.macro.get(identifier)["status"], "staged")
        self.macro.activate(identifier)
        self.assertTrue(self.macro.get(identifier)["active"])
        legacy = self.stage(missing=True)
        with self.assertRaises(Conflict):
            self.macro.activate(legacy)
        for key in ("datasets", "runs", "weo", "worldbank", "fred", "bis", "ids"):
            self.assertEqual(getattr(prior, key), getattr(self.store.state(), key))
        with closing(connect(self.db)) as conn:
            original = conn.execute("SELECT report FROM macro_runs WHERE id=?", (identifier,)).fetchone()[0]
        for delta in ({"transportComplete": False}, {"numericCount": 0}, {"rowCount": 99},
                      {"absentPairs": 0}, {"requiredPairs": 4}, {"coveragePolicy": "invented"},
                      {"contractVersion": "imf-monthly-native-v1"}, {"errors": ["Invalid response"]}):
            report = json.loads(original) | delta
            with closing(connect(self.db)) as conn:
                conn.execute("UPDATE macro_runs SET report=? WHERE id=?", (json.dumps(report), identifier))
            with self.subTest(delta=delta), self.assertRaises(Conflict):
                self.macro.activate(identifier)
        with closing(connect(self.db)) as conn:
            conn.execute("UPDATE macro_runs SET report=? WHERE id=?", (original, identifier))
        self.assertTrue(self.macro.get(identifier)["active"])

    def test_rollback_restores_only_macro_and_restart_backup_restore(self):
        first, second = self.stage(), self.stage()
        self.macro.activate(first)
        self.macro.activate(second)
        self.macro.rollback(second)
        self.assertTrue(self.macro.get(first)["active"])
        with self.assertRaises(Conflict):
            self.macro.activate(second)
        self.store.close()
        self.store.open()
        self.assertTrue(self.macro.get(first)["active"])
        backup = self.work / "backup.sqlite3"
        backup.write_bytes(self.store.snapshot())
        target = self.work / "restored.sqlite3"
        restore_backup(backup, target, offline=True)
        restored = Store(target)
        restored.open()
        try:
            self.assertEqual(MacroStore(restored).get(first), self.macro.get(first))
            self.assertEqual(MacroStore(restored).original(first, 1), b"source fixture")
        finally:
            restored.close()

    def test_running_restart_and_transport_failure_retain_sources(self):
        identifier = self.store.begin_provider_pull("imf")
        self.macro.source(identifier, "/data/partial#incomplete-response", 200, b"partial bytes")
        self.store.close()
        self.store.open()
        run = self.macro.get(identifier)
        self.assertEqual(run["status"], "interrupted")
        self.assertTrue(run["report"]["errors"])
        self.assertEqual(self.macro.original(identifier, 1), b"partial bytes")

    def test_atomic_completion_failure_cannot_activate(self):
        identifier = self.store.begin_provider_pull("imf")
        fixture = result_fixture()
        fixture["records"].append(fixture["records"][0])
        with self.assertRaises(Exception):
            self.macro.complete(identifier, fixture)
        self.assertEqual(self.macro.page(identifier, coverage=False)["total"], 0)
        with self.assertRaises(Conflict):
            self.macro.activate(identifier)

    def test_observations_sources_immutable_and_revision_changes_persist(self):
        first = self.stage()
        with closing(connect(self.db)) as conn:
            for table in ["macro_rows", "macro_sources"]:
                with self.assertRaisesRegex(Exception, "immutable"):
                    conn.execute(f"DELETE FROM {table} WHERE run_id=?", (first,))
        with closing(connect(self.db)) as conn:
            conn.execute("UPDATE provider_pulls SET started_at='2020-01-01T00:00:00Z' WHERE provider_id='imf'")
        second = self.store.begin_provider_pull("imf")
        fixture = result_fixture()
        fixture["records"][0]["value"] = 105
        fixture["records"][0]["rawValue"] = "105"
        self.macro.complete(second, fixture)
        comparison = self.macro.get(second)["report"]["revisionComparison"]
        self.assertEqual(comparison["againstRunId"], first)
        self.assertEqual(comparison["overlapCount"], 15)
        self.assertEqual(comparison["changedCount"], 1)
        self.assertEqual(comparison["samples"][0]["newValue"], 105)
        self.assertEqual(comparison["samples"][0]["oldValue"], 100)
        rejected = self.stage(True)
        with closing(connect(self.db)) as conn:
            conn.execute("UPDATE macro_runs SET status='staged',report=? WHERE id=?", (json.dumps({"errors": [], "requiredPairs": 5}), rejected))
        with self.assertRaisesRegex(Conflict, "coverage/validation"):
            self.macro.activate(rejected)

    def test_manual_job_route_and_no_external_ci_requests(self):
        with patch("backend.imf.acquire", return_value=result_fixture()):
            response = self.client.post("/api/providers/imf/pull", headers=self.headers, json={"researchUse": True})
            self.assertEqual(response.status_code, 202, response.text)
            self.app.state.imf_executor.shutdown(wait=True)
        run = self.macro.get(response.json()["id"])
        self.assertEqual(run["status"], "staged")
        self.assertFalse(run["active"])
        self.assertEqual(run["report"]["rowCount"], 15)

    def test_cancellation_is_durable_and_does_not_make_network_request(self):
        entered, release = Event(), Event()

        def acquisition(get, progress):
            progress({"fixture": "waiting-for-cancel"})
            entered.set()
            release.wait(5)
            get("/data/CPI/fixture-must-not-be-requested")
            raise AssertionError("Cancellation was not honored")

        with patch("backend.imf.acquire", side_effect=acquisition), patch("backend.imf.httpx.stream") as request:
            response = self.client.post("/api/providers/imf/pull", headers=self.headers, json={"researchUse": True})
            self.assertTrue(entered.wait(3))
            identifier = response.json()["id"]
            self.assertEqual(self.macro.get(identifier)["progress"]["fixture"], "waiting-for-cancel")
            try:
                self.assertEqual(self.client.post(f"/api/providers/imf/{identifier}/cancel", headers=self.headers).status_code, 200)
            finally:
                release.set()
            self.app.state.imf_executor.shutdown(wait=True)
        request.assert_not_called()
        self.assertEqual(self.macro.get(identifier)["status"], "interrupted")
        self.assertIn("cancelled", self.macro.get(identifier)["report"]["errors"][0])
        self.assertEqual(self.client.post(f"/api/providers/imf/{identifier}/cancel", headers=self.headers).status_code, 409)

    def test_unexpected_worker_failure_is_reported_and_previous_selection_unchanged(self):
        first = self.stage()
        self.macro.activate(first)
        with closing(connect(self.db)) as conn:
            conn.execute("UPDATE provider_pulls SET started_at='2020-01-01T00:00:00Z' WHERE provider_id='imf'")
        with patch("backend.imf.acquire", side_effect=RuntimeError("do not log private exception details")):
            response = self.client.post("/api/providers/imf/pull", headers=self.headers, json={"researchUse": True})
            self.app.state.imf_executor.shutdown(wait=True)
        run = self.macro.get(response.json()["id"])
        self.assertEqual(run["status"], "interrupted")
        self.assertIn("RuntimeError", run["report"]["errors"][0])
        self.assertNotIn("private exception details", json.dumps(run))
        self.assertTrue(self.macro.get(first)["active"])

    def test_mutation_token_consent_arbitrary_query_rejected(self):
        for consent in [{}, {"researchUse": False}, {"researchUse": 1}, {"researchUse": True, "url": "https://other"}]:
            self.assertEqual(self.client.post("/api/providers/imf/pull", headers=self.headers, json=consent).status_code, 422)
        self.assertEqual(self.client.post("/api/providers/imf/pull", json={"researchUse": True}).status_code, 403)
        self.assertEqual(self.client.post("/api/providers/imf/pull", headers=self.headers, content=b"x" * 1025).status_code, 413)
        self.assertEqual(self.client.get("/api/macro/nonexistent").status_code, 404)

    def test_migration_from_schema3_preserves_yahoo_jobs(self):
        legacy = self.work / "schema3.sqlite3"
        with closing(connect(legacy)) as conn:
            for number in (1, 2, 3):
                for statement in MIGRATIONS[number]:
                    conn.execute(statement)
            conn.execute("PRAGMA user_version=3")
            conn.execute("INSERT INTO provider_pulls VALUES ('old','2020-01-01T00:00:00Z',NULL,'running',NULL,'{}')")
        store = Store(legacy)
        store.open()
        try:
            self.assertEqual(store.state().providers[0]["status"], "interrupted")
            self.assertEqual(store.state().providers[1]["status"], "available")
            with closing(connect(legacy)) as conn:
                self.assertEqual(conn.execute("SELECT provider_id FROM provider_pulls WHERE id='old'").fetchone()[0], "yfinance")
        finally:
            store.close()


if __name__ == "__main__":
    unittest.main()
