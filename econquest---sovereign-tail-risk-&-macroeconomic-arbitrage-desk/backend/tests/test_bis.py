"""Synthetic SDMX fixtures; no empirical data or network used."""

import copy
import hashlib
import json
import shutil
import unittest
import uuid
from contextlib import closing, contextmanager
from pathlib import Path
from threading import Event
from unittest.mock import patch
from xml.etree.ElementTree import Element, SubElement, tostring

import httpx
import pycountry
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.bis import (BASE, CHUNK, DEFINITIONS, FLOWS, INDICATORS, Downloader, acquire,
                         data_path, parse_data, structure, structure_path, xml)
from backend.bis_storage import BisStore
from backend.imf import AcquisitionError, NS, local
from backend.storage import Conflict, Store, connect, verify_backup, restore_backup

MESSAGE = NS["s"].replace("/structure", "/message")
SS = "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/data/structurespecific"
DIMENSION_LISTS = {
    "FREQ": "CL_FREQ", "L_MEASURE": "CL_STOCK_FLOW", "L_POSITION": "CL_L_POSITION",
    "L_INSTR": "CL_L_INSTR", "L_DENOM": "CL_CURRENCY_3POS", "L_CURR_TYPE": "CL_L_CURR_TYPE",
    "L_PARENT_CTY": "CL_BIS_IF_REF_AREA", "L_REP_BANK_TYPE": "CL_L_BANK_TYPE",
    "L_REP_CTY": "CL_BIS_IF_REF_AREA", "L_CP_SECTOR": "CL_L_SECTOR", "L_CP_COUNTRY": "CL_BIS_IF_REF_AREA",
    "L_POS_TYPE": "CL_L_POS_TYPE", "BORROWERS_CTY": "CL_AREA", "TC_BORROWERS": "CL_TC_BORROWERS",
    "TC_LENDERS": "CL_TC_LENDERS", "VALUATION": "CL_VALUATION", "UNIT_TYPE": "CL_BIS_UNIT", "TC_ADJUST": "CL_ADJUST",
}


def structure_fixture(flow):
    f = FLOWS[flow]
    s, c = NS["s"], NS["c"]
    root = Element(f"{{{MESSAGE}}}Structure")
    flows = SubElement(root, f"{{{s}}}Dataflows")
    df = SubElement(flows, f"{{{s}}}Dataflow", id=flow, agencyID="BIS", version=f["version"])
    SubElement(df, f"{{{c}}}Name", {"{http://www.w3.org/XML/1998/namespace}lang": "en"}).text = f["name"]
    structures = SubElement(root, f"{{{s}}}DataStructures")
    dsd = SubElement(structures, f"{{{s}}}DataStructure", id=f["dsd"], agencyID="BIS", version=f["version"])
    components = SubElement(dsd, f"{{{s}}}DataStructureComponents")
    dimensions = SubElement(components, f"{{{s}}}DimensionList")
    lists = copy.deepcopy(DEFINITIONS)
    lists["CL_CONF_STATUS"]["C"] = "Confidential statistical information"
    lists["CL_OBS_STATUS"].update({"M": "Missing value; data cannot exist", "E": "Estimated value", "P": "Provisional value"})
    lists["CL_COLLECTION"] = {"E": "End of period"}
    lists["CL_DECIMALS"] = {"3": "Three"}
    lists["CL_ORG_VISIBILITY"] = {"E": "Public"}
    countries = list(pycountry.countries)
    if flow == "WS_TC":
        countries = [pycountry.countries.get(alpha_2="US"), *[v for v in countries if v.alpha_2 != "US"][:86]]
    lists.setdefault(f["areaList"], {}).update({v.alpha_2: v.name for v in countries})
    lists[f["areaList"]]["XM"] = "Euro area"
    for position, dimension in enumerate(f["dimensions"], 1):
        el = SubElement(dimensions, f"{{{s}}}{'TimeDimension' if dimension == 'TIME_PERIOD' else 'Dimension'}",
                        id=dimension, position=str(position))
        if dimension != "TIME_PERIOD":
            enumeration = SubElement(SubElement(el, f"{{{s}}}LocalRepresentation"), f"{{{s}}}Enumeration")
            SubElement(enumeration, "Ref", agencyID="BIS", id=DIMENSION_LISTS[dimension])
    attrs = SubElement(components, f"{{{s}}}AttributeList")
    for name, cid in {"OBS_STATUS": "CL_OBS_STATUS", "OBS_CONF": "CL_CONF_STATUS", "UNIT_MULT": "CL_UNIT_MULT",
                      "UNIT_MEASURE": "CL_CURRENCY_3POS" if flow == "WS_LBS_D_PUB" else "CL_BIS_UNIT",
                      "COLLECTION": "CL_COLLECTION", "DECIMALS": "CL_DECIMALS", "ORG_VISIBILITY": "CL_ORG_VISIBILITY"}.items():
        enumeration = SubElement(SubElement(SubElement(attrs, f"{{{s}}}Attribute", id=name), f"{{{s}}}LocalRepresentation"), f"{{{s}}}Enumeration")
        SubElement(enumeration, "Ref", agencyID="BIS", id=cid)
    cls = SubElement(root, f"{{{s}}}Codelists")
    for cid, codes in lists.items():
        cl = SubElement(cls, f"{{{s}}}Codelist", id=cid, agencyID="BIS", version="1.0")
        for code, name in codes.items():
            ce = SubElement(cl, f"{{{s}}}Code", id=code)
            SubElement(ce, f"{{{c}}}Name", {"{http://www.w3.org/XML/1998/namespace}lang": "en"}).text = name
    return tostring(root)


def no_data(flow):
    r = Element(f"{{{MESSAGE}}}Error")
    el = SubElement(r, f"{{{MESSAGE}}}ErrorMessage", code="100")
    SubElement(el, f"{{{NS['c']}}}Text").text = f"No data for data query against the dataflow: urn:sdmx:org.sdmx.infomodel.datastructure.Dataflow=BIS:{flow}({FLOWS[flow]['version']})"
    return tostring(r)


def data_fixture(indicator, countries):
    flow = indicator["flow"]
    if "US" not in countries:
        return no_data(flow)
    root = Element(f"{{{MESSAGE}}}StructureSpecificData")
    header = SubElement(root, f"{{{MESSAGE}}}Header")
    usage = SubElement(SubElement(header, f"{{{MESSAGE}}}Structure"), f"{{{NS['c']}}}StructureUsage")
    SubElement(usage, "Ref", agencyID="BIS", id=flow, version=FLOWS[flow]["version"])
    unit, mult = ("USD", "6") if flow == "WS_LBS_D_PUB" else ("367", "0")
    dataset = SubElement(root, f"{{{MESSAGE}}}DataSet", {"UNIT_MEASURE": unit, "UNIT_MULT": mult, "COLLECTION": "E",
        f"{{{SS}}}structureRef": f"BIS_{flow}_{FLOWS[flow]['version'].replace('.', '_')}"})
    dims = dict(zip(FLOWS[flow]["dimensions"][:-1], indicator["template"].format(country="US").split("."), strict=True))
    SubElement(dataset, "Group", {k: v for k, v in dims.items() if k != "FREQ"} | {"DECIMALS": "3"})
    series = SubElement(dataset, "Series", dims | {"ORG_VISIBILITY": "E"})
    for period, value, status in (("2023-Q1", "-1.25", "A"), ("2023-Q2", "NaN", "M"), ("2023-Q4", "2.250", "B")):
        SubElement(series, "Obs", TIME_PERIOD=period, OBS_VALUE=value, OBS_STATUS=status, OBS_CONF="F",
                   **({"OBS_PRE_BREAK": "2.0"} if status == "B" else {}))
    return tostring(root)


def fixture(path):
    for f in FLOWS:
        if path == structure_path(f):
            return structure_fixture(f)
    for i in INDICATORS:
        if path.startswith(f"/data/{i['flow']}/"):
            key = path.split("/")[-1].split(".")
            dims = dict(zip(FLOWS[i["flow"]]["dimensions"][:-1], key, strict=True))
            countries = dims[FLOWS[i["flow"]]["area"]].split("+")
            if data_path(i, countries) == path:
                return data_fixture(i, countries)
    raise AssertionError(path)


def result_fixture():
    return acquire(fixture, lambda p: None)


class BisParserTests(unittest.TestCase):
    def test_all_six_indicators_quarterly_values_groups_missing_breaks_and_coverage(self):
        result = result_fixture()
        self.assertEqual(len(result["records"]), 18)
        self.assertEqual(result["report"]["requiredPairs"], 249 * 6)
        self.assertEqual(result["report"]["absentPairs"], 249 * 6 - 6)
        self.assertEqual(result["report"]["numericCount"], 12)
        self.assertEqual(result["report"]["availableIndicators"], 6)
        first = result["records"][0]
        self.assertEqual(first["value"], -1.25)
        self.assertEqual(first["rawValue"], "-1.25")
        self.assertEqual(first["attributes"]["DECIMALS"], "3")
        self.assertEqual(first["attributes"]["UNIT_MULT"], "6")
        us = next(s for s in result["series"] if s["country"] == "US" and s["indicator"] == "lbs_claims")
        self.assertEqual(us["missingPeriods"], ["2023-Q3"])
        self.assertTrue(us["analysisBlocked"])
        self.assertEqual(us["flaggedCount"], 2)
        self.assertNotIn("XM", {c["code"] for c in result["report"]["countries"]})
        self.assertEqual(first["sourceHash"], hashlib.sha256(data_fixture(INDICATORS[0], ["US"])).hexdigest())

    def test_wrong_version_order_definition_unresolved_metadata_and_changes_fail(self):
        content = structure_fixture("WS_TC")
        for old, new in [(b'version="2.0"', b'version="9.0"'), (b'position="1"', b'position="2"'),
                         (b'Percentage of GDP', b'Percent of exports'), (b'id="CL_FREQ"', b'id="UNKNOWN_FREQ"')]:
            with self.subTest(old=old), self.assertRaises(AcquisitionError):
                structure(content.replace(old, new, 1), "WS_TC")
        calls = {}
        def changed(path):
            calls[path] = calls.get(path, 0) + 1
            value = fixture(path)
            if path == structure_path("WS_TC") and calls[path] == 2:
                return value.replace(b"Euro area", b"Changed aggregate")
            return value
        with self.assertRaisesRegex(AcquisitionError, "metadata changed"):
            acquire(changed, lambda p: None)

    def test_unrequested_duplicates_nonfinite_unknown_status_units_confidentiality_and_future_fail(self):
        i = INDICATORS[0]; metadata = structure(structure_fixture(i["flow"]), i["flow"])
        def check(mutate):
            root = xml(data_fixture(i, ["US"]))
            dataset = root.find("./{*}DataSet")
            series = dataset.find("Series")
            mutate(root, dataset, series, series.find("Obs"))
            return parse_data(tostring(root), i, ["US"], metadata)
        changes = [
            lambda r, d, s, o: s.set("L_CP_SECTOR", "G"),
            lambda r, d, s, o: s.set("L_CP_COUNTRY", "CA"),
            lambda r, d, s, o: s.append(copy.deepcopy(o)),
            lambda r, d, s, o: d.append(copy.deepcopy(s)),
            lambda r, d, s, o: o.set("OBS_VALUE", "1e999"),
            lambda r, d, s, o: o.set("OBS_VALUE", "missing"),
            lambda r, d, s, o: o.set("OBS_STATUS", "?"),
            lambda r, d, s, o: o.set("OBS_STATUS", "M"),
            lambda r, d, s, o: o.set("OBS_CONF", "C"),
            lambda r, d, s, o: o.attrib.pop("OBS_CONF"),
            lambda r, d, s, o: o.set("ORG_VISIBILITY", "D"),
            lambda r, d, s, o: o.set("UNIT_MULT", "0"),
            lambda r, d, s, o: o.set("UNIT_MEASURE", "TO1"),
            lambda r, d, s, o: o.set("TIME_PERIOD", "2099-Q1"),
            lambda r, d, s, o: o.set("TIME_PERIOD", "2023-M01"),
            lambda r, d, s, o: SubElement(r, "Footer"),
            lambda r, d, s, o: d.set(f"{{{SS}}}structureRef", "wrong"),
        ]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(AcquisitionError):
                check(change)
        rows, _ = check(lambda r, d, s, o: o.set("OBS_STATUS", "P"))
        self.assertTrue(rows[0]["flagged"])

    def test_no_data_is_explicit_and_bad_error_or_empty_basket_fails(self):
        i = INDICATORS[0]; metadata = structure(structure_fixture(i["flow"]), i["flow"])
        self.assertEqual(parse_data(no_data(i["flow"]), i, ["US"], metadata), ([], {}))
        for content in (b"<html/>", no_data(i["flow"]).replace(b'code="100"', b'code="500"'), no_data("WS_TC")):
            with self.assertRaises(AcquisitionError):
                parse_data(content, i, ["US"], metadata)
        with self.assertRaisesRegex(AcquisitionError, "no numeric"):
            acquire(lambda p: fixture(p) if p.startswith("/dataflow/") else no_data(p.split("/")[2]), lambda p: None)

    def test_bounded_transport_exact_scope_no_redirect_retry_cancel_or_incomplete_success(self):
        saved = []
        d = Downloader(Event(), lambda *a: saved.append(a), lambda p: None)
        for path in ("https://evil.test", "/data/WS_TC/all", data_path(INDICATORS[0], ["US"] * (CHUNK + 1)), "/dataflow/BIS/WS_TC/latest"):
            with self.assertRaises(AcquisitionError):
                d.get(path)
        @contextmanager
        def stream(method, url, **options):
            self.assertEqual(options["timeout"], 20)
            self.assertFalse(options["follow_redirects"])
            yield httpx.Response(200, content=b"x" * 10)
        with patch("backend.bis.httpx.stream", stream), patch("backend.bis.MAX_RESPONSE", 5):
            with self.assertRaises(AcquisitionError):
                d.get(structure_path("WS_TC"))
        self.assertTrue(saved[0][0].endswith("#incomplete-response"))
        d.stop.set()
        with self.assertRaisesRegex(AcquisitionError, "cancelled"):
            d.get(structure_path("WS_TC"))
        d = Downloader(Event(), lambda *a: None, lambda p: None)
        d.count = 100
        with self.assertRaisesRegex(AcquisitionError, "request budget"):
            d.get(structure_path("WS_TC"))


class BisApiTests(unittest.TestCase):
    def setUp(self):
        self.work = Path("backend/.test-work") / str(uuid.uuid4())
        self.work.mkdir(parents=True)
        self.db = self.work / "bis.sqlite3"
        self.client = TestClient(create_app(self.db, self.work / "absent"), base_url="http://localhost:8000")
        self.client.__enter__()
        self.store = self.client.app.state.store
        self.bis = BisStore(self.store)
        self.headers = {"X-Research-Token": self.client.get("/api/session").json()["token"]}

    def tearDown(self):
        self.client.__exit__(None, None, None)
        shutil.rmtree(self.work)

    def cooldown(self):
        with closing(connect(self.db)) as conn:
            conn.execute("UPDATE provider_pulls SET started_at='2000-01-01T00:00:00Z' WHERE provider_id='bis'")

    def stage(self):
        self.cooldown()
        identifier = self.store.begin_provider_pull("bis")
        self.bis.source(identifier, BASE + structure_path("WS_TC"), 200, b"fixture")
        self.bis.complete(identifier, result_fixture())
        return identifier

    def test_native_pages_full_coverage_sources_export_activation_and_rollback_do_not_change_models(self):
        before = self.store.state()
        a, b, c = self.stage(), self.stage(), self.stage()
        self.assertFalse(self.bis.get(a)["active"])
        page = self.client.get(f"/api/bis/{a}/observations?country=US&indicator=lbs_claims&offset=1&limit=1")
        self.assertEqual(page.json()["rows"][0]["rawValue"], "NaN")
        self.assertIn("no-store", page.headers["cache-control"])
        cov = self.client.get(f"/api/bis/{a}/coverage?country=US").json()
        self.assertEqual(cov["total"], 6)
        self.assertEqual(self.client.get(f"/api/bis/{a}/coverage").json()["total"], 1494)
        self.assertEqual(self.client.get(f"/api/bis/{a}/sources/1").content, b"fixture")
        exported = [json.loads(l) for l in self.client.get(f"/api/bis/{a}/export").text.splitlines()]
        self.assertEqual(len(exported), 1 + 1494 + 18)
        self.assertNotIn("metadata", self.store.state().bis[0]["report"])
        for identifier in (a, b, c):
            self.assertEqual(self.client.post(f"/api/bis/{identifier}/commit", headers=self.headers).status_code, 200)
        self.bis.rollback(b)
        self.assertTrue(self.bis.get(c)["active"])
        self.bis.rollback(c)
        self.assertTrue(self.bis.get(a)["active"])
        with self.assertRaises(Conflict):
            self.bis.activate(b)
        after = self.store.state()
        for k in ("datasets", "runs", "macro", "weo", "worldbank", "fred"):
            self.assertEqual(getattr(before, k), getattr(after, k))

    def test_auth_consent_body_query_and_nonempty_activation_gates(self):
        for body in ({}, {"researchUse": False}, {"researchUse": True, "url": "https://evil.test"}):
            self.assertEqual(self.client.post("/api/providers/bis/pull", json=body, headers=self.headers).status_code, 422)
        self.assertEqual(self.client.post("/api/providers/bis/pull", json={"researchUse": True}).status_code, 403)
        self.assertEqual(self.client.post("/api/providers/bis/pull", content=b"x" * 1025, headers=self.headers).status_code, 413)
        identifier = self.stage()
        for query in ("country=US&indicator=lbs_claims&limit=1001", "country=US&indicator=lbs_claims&offset=-1"):
            self.assertEqual(self.client.get(f"/api/bis/{identifier}/observations?{query}").status_code, 422)
        self.assertEqual(self.client.get(f"/api/bis/{identifier}/observations?country=ZZ&indicator=lbs_claims").status_code, 404)
        with closing(connect(self.db)) as conn:
            conn.execute("UPDATE bis_runs SET report=json_set(report,'$.rowCount',999) WHERE id=?", (identifier,))
        self.assertEqual(self.client.post(f"/api/bis/{identifier}/commit", headers=self.headers).status_code, 409)
        self.cooldown()
        running = self.store.begin_provider_pull("bis")
        with self.assertRaises(Conflict):
            self.store.begin_provider_pull("bis")
        with self.assertRaises(Conflict):
            self.bis.activate(running)
        self.bis.fail(running, "Explicit acquisition failure")
        self.assertEqual(self.bis.get(running)["status"], "interrupted")

    def test_restart_immutable_originals_backup_restore_and_schema7_migration(self):
        a = self.stage(); self.bis.activate(a); self.cooldown()
        b = self.store.begin_provider_pull("bis")
        self.bis.source(b, "partial#incomplete-response", 200, b"partial")
        self.store.close(); self.store.open()
        self.assertEqual(self.bis.get(b)["status"], "interrupted")
        self.assertTrue(self.bis.get(a)["active"])
        with closing(connect(self.db)) as conn:
            for table in ("bis_rows", "bis_series", "bis_sources"):
                with self.assertRaisesRegex(Exception, "immutable"):
                    conn.execute(f"DELETE FROM {table}")
        backup = self.work / "backup.sqlite3"; backup.write_bytes(self.store.snapshot())
        verify_backup(backup)
        restored = self.work / "restored.sqlite3"
        restore_backup(backup, restored, offline=True)
        other = Store(restored); other.open()
        try:
            self.assertEqual(BisStore(other).get(a), self.bis.get(a))
        finally:
            other.close()
        legacy = self.work / "v7.sqlite3"; legacy.write_bytes(self.store.snapshot())
        with closing(connect(legacy)) as conn:
            for table in ("analysis_bundles", "acled_rows", "acled_chunks", "acled_sources", "acled_runs",
                          "gdelt_rows", "gdelt_chunks", "gdelt_sources", "gdelt_runs",
                          "comtrade_rows", "comtrade_sources", "comtrade_tasks", "comtrade_requests", "comtrade_runs",
                          "ids_rows", "ids_series", "ids_sources", "ids_runs", "bis_rows", "bis_series", "bis_sources", "bis_runs"):
                conn.execute(f"DROP TABLE {table}")
            conn.execute("PRAGMA user_version=7")
        other = Store(legacy); other.open()
        try:
            self.assertEqual(other.state().bis, [])
            self.assertEqual(len(other.state().providers), 10)
            verify_backup(legacy)
        finally:
            other.close()

    def test_worker_success_failure_and_cancel_retain_active_snapshot(self):
        import time
        a = self.stage(); self.bis.activate(a); self.cooldown()
        with patch("backend.bis.acquire", return_value=result_fixture()):
            response = self.client.post("/api/providers/bis/pull", json={"researchUse": True}, headers=self.headers)
            self.assertEqual(response.status_code, 202)
            identifier = response.json()["id"]
            for _ in range(100):
                if self.bis.get(identifier)["status"] != "running":
                    break
                time.sleep(0.01)
            self.assertEqual(self.bis.get(identifier)["status"], "staged")
        self.cooldown()
        entered = Event()
        def cancelled(fetch, progress):
            entered.set()
            while True:
                fetch.__self__.check()
                time.sleep(0.01)
        with patch("backend.bis.acquire", side_effect=cancelled):
            response = self.client.post("/api/providers/bis/pull", json={"researchUse": True}, headers=self.headers)
            identifier = response.json()["id"]
            self.assertTrue(entered.wait(2))
            self.assertEqual(self.client.post(f"/api/providers/bis/{identifier}/cancel", headers=self.headers).status_code, 200)
            for _ in range(100):
                if self.bis.get(identifier)["status"] != "running":
                    break
                time.sleep(0.01)
            self.assertEqual(self.bis.get(identifier)["status"], "interrupted")
        self.assertTrue(self.bis.get(a)["active"])
