"""Metadata-checked BIS quarterly banking and credit research; no model coupling."""

import hashlib
import math
import re
import time
from datetime import datetime, timezone
from threading import Event

import httpx
import pycountry
from defusedxml import ElementTree

from .imf import AcquisitionError, NS, english, local, now_iso

BASE = "https://stats.bis.org/api/v1"
CONTRACT = "bis-quarterly-native-v1"
FLOWS = {
    "WS_LBS_D_PUB": {
        "version": "1.0", "dsd": "BIS_LBS_DISS", "name": "Locational banking",
        "dimensions": "FREQ L_MEASURE L_POSITION L_INSTR L_DENOM L_CURR_TYPE L_PARENT_CTY L_REP_BANK_TYPE L_REP_CTY L_CP_SECTOR L_CP_COUNTRY L_POS_TYPE TIME_PERIOD".split(),
        "area": "L_CP_COUNTRY", "areaList": "CL_BIS_IF_REF_AREA",
    },
    "WS_TC": {
        "version": "2.0", "dsd": "BIS_TOTAL_CREDIT", "name": "Total credit",
        "dimensions": "FREQ BORROWERS_CTY TC_BORROWERS TC_LENDERS VALUATION UNIT_TYPE TC_ADJUST TIME_PERIOD".split(),
        "area": "BORROWERS_CTY", "areaList": "CL_AREA",
    },
}
DIMENSION_LISTS = {
    "FREQ": "CL_FREQ", "L_MEASURE": "CL_STOCK_FLOW", "L_POSITION": "CL_L_POSITION",
    "L_INSTR": "CL_L_INSTR", "L_DENOM": "CL_CURRENCY_3POS", "L_CURR_TYPE": "CL_L_CURR_TYPE",
    "L_PARENT_CTY": "CL_BIS_IF_REF_AREA", "L_REP_BANK_TYPE": "CL_L_BANK_TYPE",
    "L_REP_CTY": "CL_BIS_IF_REF_AREA", "L_CP_SECTOR": "CL_L_SECTOR", "L_CP_COUNTRY": "CL_BIS_IF_REF_AREA",
    "L_POS_TYPE": "CL_L_POS_TYPE", "BORROWERS_CTY": "CL_AREA", "TC_BORROWERS": "CL_TC_BORROWERS",
    "TC_LENDERS": "CL_TC_LENDERS", "VALUATION": "CL_VALUATION", "UNIT_TYPE": "CL_BIS_UNIT", "TC_ADJUST": "CL_ADJUST",
}
INDICATORS = [
    {"code": "lbs_claims", "name": "Cross-border banking claims, all sectors",
     "flow": "WS_LBS_D_PUB", "template": "Q.S.C.A.TO1.A.5J.A.5A.A.{country}.N", "unit": "Millions of US dollars"},
    {"code": "lbs_liabilities", "name": "Cross-border banking liabilities, all sectors",
     "flow": "WS_LBS_D_PUB", "template": "Q.S.L.A.TO1.A.5J.A.5A.A.{country}.N", "unit": "Millions of US dollars"},
    {"code": "credit_government", "name": "Credit to general government, nominal value",
     "flow": "WS_TC", "template": "Q.{country}.G.A.N.770.A", "unit": "Percentage of GDP"},
    {"code": "credit_private", "name": "Credit to private non-financial sector, market value",
     "flow": "WS_TC", "template": "Q.{country}.P.A.M.770.A", "unit": "Percentage of GDP"},
    {"code": "credit_households", "name": "Credit to households and NPISHs, market value",
     "flow": "WS_TC", "template": "Q.{country}.H.A.M.770.A", "unit": "Percentage of GDP"},
    {"code": "credit_corporations", "name": "Credit to non-financial corporations, market value",
     "flow": "WS_TC", "template": "Q.{country}.N.A.M.770.A", "unit": "Percentage of GDP"},
]
DEFINITIONS = {
    "CL_FREQ": {"Q": "Quarterly"},
    "CL_STOCK_FLOW": {"S": "Amounts outstanding / Stocks"},
    "CL_L_POSITION": {"C": "Total claims", "L": "Total liabilities"},
    "CL_L_INSTR": {"A": "All instruments"},
    "CL_CURRENCY_3POS": {"TO1": "All currencies", "USD": "US dollar"},
    "CL_L_CURR_TYPE": {"A": "All currencies (=D+F+U)"},
    "CL_BIS_IF_REF_AREA": {"5J": "All countries", "5A": "All reporting countries"},
    "CL_L_BANK_TYPE": {"A": "All reporting banks/institutions (domestic, foreign, consortium and unclassified)"},
    "CL_L_SECTOR": {"A": "All sectors"},
    "CL_L_POS_TYPE": {"N": "Cross-border"},
    "CL_TC_BORROWERS": {"G": "General government", "P": "Private non-financial sector", "H": "Households & NPISHs", "N": "Non-financial corporations"},
    "CL_TC_LENDERS": {"A": "All sectors"},
    "CL_VALUATION": {"N": "Nominal value", "M": "Market value"},
    "CL_BIS_UNIT": {"770": "Percentage of GDP", "367": "Per cent"},
    "CL_ADJUST": {"A": "Adjusted for breaks"},
    "CL_UNIT_MULT": {"0": "Units", "6": "Millions"},
    "CL_CONF_STATUS": {"F": "Free"},
    "CL_OBS_STATUS": {"A": "Normal value", "B": "Break"},
}
MAX_RESPONSE = 16 * 1024 * 1024
MAX_TOTAL = 128 * 1024 * 1024
MAX_ROWS = 500_000
MAX_REQUESTS = 100
JOB_SECONDS = 600
CHUNK = 25
NUMERIC = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?")


def xml(content):
    try:
        return ElementTree.fromstring(content)
    except (ElementTree.ParseError, ValueError) as exc:
        raise AcquisitionError("BIS returned invalid SDMX XML") from exc


def structure_path(flow):
    return f"/dataflow/BIS/{flow}/{FLOWS[flow]['version']}?references=all"


def data_path(indicator, countries):
    return f"/data/{indicator['flow']}/{indicator['template'].format(country='+'.join(countries))}"


class Downloader:
    def __init__(self, stop: Event, save, progress):
        self.stop, self.save, self.progress = stop, save, progress
        self.deadline = time.monotonic() + JOB_SECONDS
        self.count = self.total = 0
        self.last_start = 0.0

    def check(self):
        if self.stop.is_set() or time.monotonic() >= self.deadline:
            raise AcquisitionError("BIS acquisition cancelled or exceeded 600-second deadline")

    def get(self, path):
        self.check()
        allowed = path in [structure_path(f) for f in FLOWS]
        for indicator in INDICATORS:
            prefix, suffix = data_path(indicator, ["COUNTRY"]).split("COUNTRY")
            if path.startswith(prefix) and path.endswith(suffix):
                areas = path[len(prefix):len(path) - len(suffix) if suffix else None].split("+")
                allowed |= bool(areas) and len(areas) <= CHUNK and len(set(areas)) == len(areas) and all(
                    re.fullmatch("[A-Z]{2}", a) and pycountry.countries.get(alpha_2=a) for a in areas)
        if not allowed:
            raise AcquisitionError("BIS request outside fixed reviewed scope")
        wait = max(0, 0.6 - (time.monotonic() - self.last_start))
        self.stop.wait(wait)
        self.check()
        self.count += 1
        if self.count > MAX_REQUESTS:
            raise AcquisitionError("BIS request budget exceeded")
        self.last_start = time.monotonic()
        content, saved, status = bytearray(), False, 0
        try:
            with httpx.stream("GET", BASE + path, timeout=20, follow_redirects=False,
                              headers={"Accept": "application/vnd.sdmx.structurespecificdata+xml;version=2.1" if path.startswith("/data/") else "application/vnd.sdmx.structure+xml;version=2.1"}) as response:
                status = response.status_code
                for chunk in response.iter_bytes(chunk_size=65536):
                    remaining = min(MAX_RESPONSE - len(content), MAX_TOTAL - self.total)
                    content.extend(chunk[:max(0, remaining)])
                    self.total += len(chunk)
                    if len(chunk) > remaining:
                        raise AcquisitionError("BIS response/decompression or total byte budget exceeded")
                    self.check()
                self.save(BASE + path, status, bytes(content))
                saved = True
                if status != 200 and not (status == 404 and path.startswith("/data/")):
                    raise AcquisitionError(f"BIS HTTP {status}; no retry or fallback")
                if status == 404 and local(xml(bytes(content))) != "Error":
                    raise AcquisitionError("BIS HTTP 404 is not an SDMX no-data envelope")
                self.progress({"requests": self.count, "bytes": self.total, "lastHttpStatus": status})
                return bytes(content)
        except (httpx.HTTPError, AcquisitionError) as exc:
            if content and not saved:
                self.save(BASE + path + "#incomplete-response", status, bytes(content))
            if isinstance(exc, AcquisitionError):
                raise
            raise AcquisitionError(f"BIS transport failed ({type(exc).__name__}); no retry or fallback") from None


def structure(content, flow):
    root, expected = xml(content), FLOWS[flow]
    matches = root.findall(".//s:Dataflows/s:Dataflow", NS)
    if len(matches) != 1 or (matches[0].get("id"), matches[0].get("agencyID"), matches[0].get("version"), english(matches[0])) != (
        flow, "BIS", expected["version"], expected["name"]):
        raise AcquisitionError("BIS dataflow identity/version/name changed; review required")
    dsds = root.findall(".//s:DataStructures/s:DataStructure", NS)
    if len(dsds) != 1 or (dsds[0].get("id"), dsds[0].get("agencyID"), dsds[0].get("version")) != (expected["dsd"], "BIS", expected["version"]):
        raise AcquisitionError("BIS data structure identity/version changed")
    dimensions = dsds[0].findall("s:DataStructureComponents/s:DimensionList/*", NS)
    if [e.get("id") for e in dimensions] != expected["dimensions"] or [e.get("position") for e in dimensions] != [str(i + 1) for i in range(len(dimensions))]:
        raise AcquisitionError("BIS dimension order changed")
    lists = {c.get("id"): {v.get("id"): {"name": english(v), "description": english(v, "Description")}
                          for v in c.findall("s:Code", NS)} for c in root.findall(".//s:Codelist", NS)}
    dimension_lists = {}
    attribute_lists = {}
    for element in dimensions[:-1] + dsds[0].findall("s:DataStructureComponents/s:AttributeList/s:Attribute", NS):
        refs = element.findall("s:LocalRepresentation/s:Enumeration/Ref", NS)
        if len(refs) > 1 or (refs and (refs[0].get("agencyID") != "BIS" or refs[0].get("id") not in lists)):
            raise AcquisitionError("BIS unresolved dimension/attribute codelist")
        if refs:
            (dimension_lists if element in dimensions else attribute_lists)[element.get("id")] = refs[0].get("id")
    if dimension_lists != {k: DIMENSION_LISTS[k] for k in expected["dimensions"][:-1]}:
        raise AcquisitionError("BIS dimension definitions changed/incomplete")
    required_attributes = {"OBS_STATUS": "CL_OBS_STATUS", "OBS_CONF": "CL_CONF_STATUS", "UNIT_MULT": "CL_UNIT_MULT",
                           "UNIT_MEASURE": "CL_CURRENCY_3POS" if flow == "WS_LBS_D_PUB" else "CL_BIS_UNIT",
                           "DECIMALS": "CL_DECIMALS", "COLLECTION": "CL_COLLECTION"}
    if any(attribute_lists.get(k) != v for k, v in required_attributes.items()):
        raise AcquisitionError("BIS attribute definitions changed/incomplete")
    used_lists = set(dimension_lists.values()) | set(attribute_lists.values())
    for list_id in used_lists & DEFINITIONS.keys():
        if any(lists[list_id].get(code, {}).get("name") != name for code, name in DEFINITIONS[list_id].items()):
            raise AcquisitionError(f"BIS {list_id} definition changed; review required")
    countries, excluded = [], []
    for code, info in sorted(lists[expected["areaList"]].items()):
        country = pycountry.countries.get(alpha_2=code)
        if country:
            countries.append({"code": code, "name": info["name"], "iso3": country.alpha_3})
        else:
            excluded.append({"code": code, "name": info["name"], "reason": "Not a current ISO individual economy; aggregate/historical/unallocated code excluded"})
    if len(countries) < (200 if flow == "WS_LBS_D_PUB" else 50):
        raise AcquisitionError("BIS current individual economy metadata unexpectedly incomplete")
    return {"dimensions": dimension_lists, "attributes": attribute_lists, "lists": lists, "countries": countries,
            "excluded": excluded, "sourceHash": hashlib.sha256(content).hexdigest()}


def attributes(element):
    return {k: v for k, v in element.attrib.items() if not k.startswith("{")}


def quarter_number(period):
    if not isinstance(period, str) or not re.fullmatch(r"(?:18|19|20)\d{2}-Q[1-4]", period):
        raise AcquisitionError("BIS observation is not a supported quarterly period")
    return int(period[:4]) * 4 + int(period[-1]) - 1


def quarter_label(number):
    return f"{number // 4:04d}-Q{number % 4 + 1}"


def parse_data(content, indicator, countries, metadata):
    root, flow = xml(content), indicator["flow"]
    if local(root) == "Error":
        errors = root.findall("s:ErrorMessage", {"s": NS["s"].replace("/structure", "/message")})
        expected = f"No data for data query against the dataflow: urn:sdmx:org.sdmx.infomodel.datastructure.Dataflow=BIS:{flow}({FLOWS[flow]['version']})"
        if len(errors) == 1 and errors[0].get("code") == "100" and [t.text for t in errors[0]] == [expected]:
            return [], {}
        raise AcquisitionError("BIS returned an error envelope, not validated no-data")
    refs = root.findall("./{*}Header/{*}Structure/{*}StructureUsage/Ref")
    sets = root.findall("./{*}DataSet")
    if (local(root) != "StructureSpecificData" or len(refs) != 1 or
        (refs[0].get("agencyID"), refs[0].get("id"), refs[0].get("version")) != ("BIS", flow, FLOWS[flow]["version"]) or
        len(sets) != 1 or root.findall(".//{*}Footer")):
        raise AcquisitionError("BIS response flow identity/version/type or footer invalid")
    dataset = sets[0]
    if dataset.get("{http://www.sdmx.org/resources/sdmxml/schemas/v2_1/data/structurespecific}structureRef") != f"BIS_{flow}_{FLOWS[flow]['version'].replace('.', '_')}":
        raise AcquisitionError("BIS dataset structure reference mismatch")
    dimensions = FLOWS[flow]["dimensions"][:-1]
    area_key = FLOWS[flow]["area"]
    expected = dict(zip(dimensions, indicator["template"].format(country="COUNTRY").split("."), strict=True))
    groups = [attributes(g) for g in dataset if local(g) == "Group"]
    records, series = [], {}
    source_hash = hashlib.sha256(content).hexdigest()
    current = datetime.now(timezone.utc)
    current_quarter = current.year * 4 + (current.month - 1) // 3
    for element in dataset:
        if local(element) not in ("Series", "Group"):
            raise AcquisitionError("BIS unexpected dataset child")
        if local(element) != "Series":
            continue
        key = {k: element.get(k) for k in dimensions}
        country = key[area_key]
        if country not in countries or any(key[k] != v for k, v in expected.items() if k != area_key) or country in series:
            raise AcquisitionError("BIS mixed/unrequested or duplicate series dimensions")
        for k, v in key.items():
            if v not in metadata["lists"][metadata["dimensions"][k]]:
                raise AcquisitionError("BIS unknown dimension code")
        inherited = attributes(dataset)
        group_attributes = {}
        for group in groups:
            group_keys = {k: v for k, v in group.items() if k in dimensions}
            if group_keys and all(key[k] == v for k, v in group_keys.items()):
                for k, v in group.items():
                    if k not in dimensions:
                        if k in group_attributes and group_attributes[k] != v:
                            raise AcquisitionError("BIS ambiguous matching group attributes")
                        group_attributes[k] = v
        inherited.update(group_attributes)
        inherited.update(attributes(element))
        inherited = {k: v for k, v in inherited.items() if k not in dimensions}
        series[country] = {"dimensions": key, "dimensionLabels": {k: metadata["lists"][metadata["dimensions"][k]][v]["name"] for k, v in key.items()},
                           "attributes": inherited, "metadataSourceHash": metadata["sourceHash"]}
        seen = set()
        for observation in element:
            if local(observation) != "Obs":
                raise AcquisitionError("BIS unexpected series child")
            period, raw = observation.get("TIME_PERIOD"), observation.get("OBS_VALUE")
            number = quarter_number(period)
            if number > current_quarter or period in seen:
                raise AcquisitionError("BIS future/duplicate observation period")
            seen.add(period)
            attrs = inherited | {k: v for k, v in attributes(observation).items() if k not in ("TIME_PERIOD", "OBS_VALUE")}
            for k, list_id in metadata["attributes"].items():
                if k in attrs and attrs[k] not in metadata["lists"][list_id]:
                    raise AcquisitionError(f"BIS unknown {k} code; review required")
            if attrs.get("OBS_CONF") != "F" or attrs.get("ORG_VISIBILITY", "E") != "E":
                raise AcquisitionError("BIS observation lacks explicit public/free classification")
            if not attrs.get("OBS_STATUS"):
                raise AcquisitionError("BIS observation status missing")
            expected_unit = ("USD", "6") if flow == "WS_LBS_D_PUB" else ("367", "0")
            if (attrs.get("UNIT_MEASURE"), attrs.get("UNIT_MULT")) != expected_unit or attrs.get("COLLECTION") != "E":
                raise AcquisitionError("BIS native unit/scaling/collection changed")
            if raw in (None, "", "NaN"):
                value = None
            elif NUMERIC.fullmatch(raw):
                value = float(raw)
                if not math.isfinite(value):
                    raise AcquisitionError("BIS nonfinite numeric observation")
                if attrs["OBS_STATUS"] in {"H", "K", "L", "M", "Q"}:
                    raise AcquisitionError("BIS numeric value with missing/suppressed status")
            else:
                raise AcquisitionError("BIS unrecognized numeric text")
            records.append({"country": country, "indicator": indicator["code"], "period": period, "value": value,
                            "rawValue": raw, "attributes": attrs, "sourceHash": source_hash,
                            "flagged": attrs["OBS_STATUS"] != "A" or "OBS_PRE_BREAK" in attrs})
    return records, series


def acquire(fetch, progress):
    metadata = {flow: structure(fetch(structure_path(flow)), flow) for flow in FLOWS}
    country_map = {c["code"]: c for flow in metadata.values() for c in flow["countries"]}
    countries = [country_map[k] for k in sorted(country_map)]
    records, catalog = [], []
    for indicator in INDICATORS:
        flow = indicator["flow"]
        codes = [c["code"] for c in metadata[flow]["countries"]]
        found, rows_by_country = {}, {}
        for offset in range(0, len(codes), CHUNK):
            subset = codes[offset:offset + CHUNK]
            rows, info = parse_data(fetch(data_path(indicator, subset)), indicator, subset, metadata[flow])
            if found.keys() & info.keys():
                raise AcquisitionError("BIS overlapping series across responses")
            found.update(info)
            records.extend(rows)
            if len(records) > MAX_ROWS:
                raise AcquisitionError("BIS observation budget exceeded")
            for row in rows:
                rows_by_country.setdefault(row["country"], []).append(row)
            progress({"phase": indicator["name"], "completedEconomies": min(offset + CHUNK, len(codes)), "requestedEconomies": len(codes), "rows": len(records)})
        for country in countries:
            code = country["code"]
            rows = sorted(rows_by_country.get(code, []), key=lambda r: r["period"])
            valid = [r for r in rows if r["value"] is not None]
            present = {r["period"] for r in rows}
            missing = [quarter_label(q) for q in range(quarter_number(rows[0]["period"]), quarter_number(rows[-1]["period"]) + 1)
                       if quarter_label(q) not in present] if rows else []
            reason = "" if valid else "No numeric observations returned; no values filled." if code in codes else "Economy is not in this dataflow's current individual-economy metadata."
            catalog.append({"country": code, "indicator": indicator["code"], **found.get(code, {}),
                            "validCount": len(valid), "missingCount": len(rows) - len(valid), "missingPeriods": missing,
                            "flaggedCount": sum(r["flagged"] for r in rows), "firstPeriod": rows[0]["period"] if rows else None,
                            "lastPeriod": rows[-1]["period"] if rows else None, "latestValidPeriod": valid[-1]["period"] if valid else None,
                            "analysisBlocked": not valid or bool(missing) or any(r["value"] is None or r["flagged"] for r in rows),
                            "reason": reason, "unit": indicator["unit"]})
    if not any(r["value"] is not None for r in records):
        raise AcquisitionError("BIS basket has no numeric observations")
    for flow in FLOWS:
        if structure(fetch(structure_path(flow)), flow) | {"sourceHash": ""} != metadata[flow] | {"sourceHash": ""}:
            raise AcquisitionError("BIS metadata changed during acquisition")
    return {"records": records, "series": catalog, "report": {
        "adapterVersion": CONTRACT, "errors": [], "transportComplete": True, "retrievedAt": now_iso(),
        "rowCount": len(records), "numericCount": sum(r["value"] is not None for r in records),
        "seriesCount": len(catalog), "requiredPairs": len(catalog), "absentPairs": sum(s["validCount"] == 0 for s in catalog),
        "availableEconomies": len({r["country"] for r in records if r["value"] is not None}),
        "availableIndicators": len({r["indicator"] for r in records if r["value"] is not None}),
        "analysisBlockedSeries": sum(s["analysisBlocked"] for s in catalog),
        "firstPeriod": min(r["period"] for r in records), "lastPeriod": max(r["period"] for r in records),
        "countries": countries, "indicators": INDICATORS, "metadata": metadata,
        "limitation": "Current revised quarterly snapshots, not archived publication vintages. No release calendar/freshness claim, interpolation, transformations or model inputs. LBS: residence-based all-reporting-location totals, not bilateral/consolidated or sovereign-only claims. Stocks are not FX/break-adjusted flows. Credit: all lenders, adjusted for breaks; sector totals overlap and must not be added together.",
    }}
