"""Metadata-checked IMF monthly monitoring. Native values, never model inputs."""

import hashlib
import math
import re
import time
from datetime import datetime, timezone
from importlib.metadata import version
from threading import Event
from typing import Callable
from xml.etree.ElementTree import Element

import httpx
import pycountry
from defusedxml import ElementTree

BASE = "https://api.imf.org/external/sdmx/2.1"
CONTRACT = "imf-monthly-native-v2"
COVERAGE_POLICY = "available-monthly-pairs"
NS = {"s": "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/structure",
      "c": "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/common"}
LANG = "{http://www.w3.org/XML/1998/namespace}lang"
FLOW_VERSIONS = {"CPI": "5.0.0", "ER": "4.0.1", "IL": "13.0.1", "MFS_IR": "9.0.0"}
DSD_VERSIONS = {"CPI": ("DSD_CPI", "5.0.0"), "ER": ("DSD_ER_PUB", "4.0.0"),
                "IL": ("DSD_IL", "13.0.0"), "MFS_IR": ("DSD_MFS_IR", "9.0.0")}
FLOW_DIMENSIONS = {
    "CPI": ["COUNTRY", "INDEX_TYPE", "COICOP_1999", "TYPE_OF_TRANSFORMATION", "FREQUENCY"],
    "ER": ["COUNTRY", "INDICATOR", "TYPE_OF_TRANSFORMATION", "FREQUENCY"],
    "IL": ["COUNTRY", "INDICATOR", "UNIT", "FREQUENCY"],
    "MFS_IR": ["COUNTRY", "INDICATOR", "FREQUENCY"],
}
INDICATORS = [
    {"id": "cpi", "name": "National all-items CPI index", "flow": "CPI", "key": "CPI._T.IX.M", "unit": "Native CPI index",
     "codes": {"CL_INDEX_TYPE": ("CPI", "Consumer price index (CPI)"), "CL_COICOP_1999": ("_T", "All Items"), "CL_CPI_TYPE_OF_TRANSFORMATION": ("IX", "Index")}},
    {"id": "inflation", "name": "Published all-items CPI year-on-year inflation", "flow": "CPI", "key": "CPI._T.YOY_PCH_PA_PT.M", "unit": "Native percent, year-on-year",
     "codes": {"CL_CPI_TYPE_OF_TRANSFORMATION": ("YOY_PCH_PA_PT", "Period average, Year-over-year (YOY) percent change")}},
    {"id": "fx", "name": "Domestic currency per USD, period average", "flow": "ER", "key": "XDC_USD.PA_RT.M", "unit": "Native domestic currency per USD",
     "codes": {"CL_ER_INDICATOR_PUB": ("XDC_USD", "Domestic currency per US Dollar"), "CL_ER_TYPE_OF_TRANSFORMATION": ("PA_RT", "Period average")}},
    {"id": "reserves", "name": "Total reserves, gold at market value", "flow": "IL", "key": "TRGMV_REVS.USD.M", "unit": "Native USD value; scaling not converted",
     "codes": {"CL_IL_INDICATOR": ("TRGMV_REVS", "Total reserves (gold at market value)")}},
    {"id": "rate", "name": "Monetary policy-related rate (national definitions)", "flow": "MFS_IR", "key": "MFS166_RT_PT_A_PT.M", "unit": "Native percent per annum",
     "codes": {"CL_MFS_IR_INDICATOR": ("MFS166_RT_PT_A_PT", "Monetary policy-related, Rate, Percent per annum")}},
]
MAX_RESPONSE = 16 * 1024 * 1024
MAX_TOTAL = 96 * 1024 * 1024
MAX_REQUESTS = 128
MAX_OBSERVATIONS = 200000
JOB_SECONDS = 600
CHUNK_COUNTRIES = 20
HISTORICAL_AREAS = frozenset("ANT CSK DDR SCG SUN VDR YAR YMD YUG".split())
AGGREGATE_AREAS = frozenset((
    "AFR APD CWX EUR MCD SDS WHD G001 G080 G083 G084 G087 G089 G092 G110 G119 G120 G1201 G129 "
    "G1515 G1614 G1626 G1627 G163 G200 G201 G202 G205 G209 G216 G309 G400 G401 G402 G406 G450 "
    "G505 G510 G603 G606 G609 G619 G711 G715 G757 G758 G759 G760 G765 G776 G903 G906 G92031 "
    "G940 G995 G998 GASEAN GSAC U002 U005 U009 U011 U013 U014 U015 U017 U018 U019 U029 U030 "
    "U034 U035 U039 U053 U054 U057 U061 U142 U143 U145 U150 U151 U154 U155 U202"
).split())


class AcquisitionError(ValueError):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def month_window(now: datetime | None = None) -> list[str]:
    now = now or datetime.now(timezone.utc)
    current = now.year * 12 + now.month - 1
    return [f"{n // 12:04d}-{n % 12 + 1:02d}" for n in range(current - 120, current)]


def local(element: Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def english(element: Element, tag: str = "Name") -> str:
    return next((e.text or "" for e in element.findall(f"c:{tag}", NS) if e.get(LANG) == "en"), "")


def xml(content: bytes) -> Element:
    try:
        root = ElementTree.fromstring(content)
    except (ElementTree.ParseError, ValueError) as exc:
        raise AcquisitionError("IMF response is not valid SDMX XML") from exc
    if "sdmx" not in root.tag:
        raise AcquisitionError("Unexpected non-SDMX response")
    return root


def structures(content: bytes, flow: str) -> dict:
    root = xml(content)
    dataflows = root.findall(".//s:Dataflow", NS)
    match = next((e for e in dataflows if e.get("id") == flow and e.get("agencyID") == "IMF.STA"), None)
    if match is None or match.get("version") != FLOW_VERSIONS[flow]:
        raise AcquisitionError(f"{flow}: dataflow version changed or missing; contract review required")
    dsds = root.findall(".//s:DataStructure", NS)
    dimensions = [
        e.get("id") for e in dsds[0].findall("s:DataStructureComponents/s:DimensionList/*", NS)
        if e.get("position") is not None
    ] if len(dsds) == 1 else []
    if dimensions != FLOW_DIMENSIONS[flow]:
        raise AcquisitionError(f"{flow}: unexpected structure dimensions")
    if (dsds[0].get("id"), dsds[0].get("version")) != DSD_VERSIONS[flow] or dsds[0].get("agencyID") != "IMF.STA":
        raise AcquisitionError(f"{flow}: data-structure identity/version changed")
    lists = {}
    for codelist in root.findall(".//s:Codelist", NS):
        lists[codelist.get("id")] = {
            code.get("id"): {"name": english(code), "description": english(code, "Description")}
            for code in codelist.findall("s:Code", NS)
        }
    for indicator in [i for i in INDICATORS if i["flow"] == flow]:
        for list_id, (code, expected) in indicator["codes"].items():
            actual = lists.get(list_id, {}).get(code, {}).get("name")
            if actual != expected:
                raise AcquisitionError(f"{flow}: {list_id}/{code} definition changed; contract review required")
    areas = lists.get("CL_COUNTRY")
    if not areas:
        raise AcquisitionError(f"{flow}: reference-area metadata missing")
    return {"dimensions": dimensions, "codelists": lists, "areas": areas, "version": match.get("version")}


def universe(areas: dict) -> tuple[list[dict], list[dict]]:
    countries, excluded = [], []
    for code, info in sorted(areas.items()):
        country = pycountry.countries.get(alpha_3=code)
        if code in ("KOS", "WBG"):
            expected = {"KOS": "Kosovo, Republic of", "WBG": "West Bank and Gaza"}
            if info["name"] != expected[code]:
                raise AcquisitionError(f"{code}: reviewed IMF-specific reference-area name changed")
            countries.append({"code": code, "name": info["name"], "iso3": "PSE" if code == "WBG" else None,
                              "mappingNote": "Reviewed IMF-specific area; source code retained, not replaced with a guessed ISO code"})
        elif country:
            countries.append({"code": code, "name": info["name"], "iso3": country.alpha_3})
        else:
            reason = "Historical/dissolved area" if code in HISTORICAL_AREAS else "Aggregate, union or combined area" if code in AGGREGATE_AREAS else "Unreviewed reference area; activation blocked"
            excluded.append({"code": code, **info, "reason": reason})
    if len(countries) < 150:
        raise AcquisitionError("Current-economy metadata unexpectedly incomplete")
    iso_codes = [c["iso3"] for c in countries if c["iso3"] is not None]
    if len(iso_codes) != len(set(iso_codes)):
        raise AcquisitionError("Multiple IMF areas map to one ISO territory; explicit mapping review required")
    return countries, excluded


def parse_data(content: bytes, indicator: dict, areas: list[str], months: list[str], structure: dict) -> tuple[list[dict], list[str]]:
    root = xml(content)
    flow = indicator["flow"]
    refs = [e for e in root.iter() if local(e) == "Ref" and e.get("id") == flow]
    if not refs or refs[0].get("agencyID") != "IMF.STA" or refs[0].get("version") != FLOW_VERSIONS[flow]:
        raise AcquisitionError(f"{flow}: data response version does not match captured metadata")
    sets = [e for e in root if local(e) == "DataSet"]
    if len(sets) != 1:
        raise AcquisitionError(f"{flow}: expected one dataset")
    dataset = sets[0]
    dimensions = structure["dimensions"]
    wanted = dict(zip(dimensions[1:], indicator["key"].split(".")))
    records, warnings, seen = [], [], set()
    groups = [e for e in dataset if local(e) == "Group"]
    for series in dataset:
        if local(series) == "Group":
            continue
        if local(series) != "Series":
            raise AcquisitionError(f"{flow}: unexpected dataset element")
        if series.get("COUNTRY") not in areas or any(series.get(key) != value for key, value in wanted.items()):
            raise AcquisitionError(f"{flow}: response series does not match requested dimensions")
        group_attrs = {}
        for group in groups:
            group_dimensions = {k: v for k, v in group.attrib.items() if k in dimensions}
            if not group_dimensions or any(series.get(k) != v for k, v in group_dimensions.items()):
                continue
            for key, value in group.attrib.items():
                if key in group_attrs and group_attrs[key] != value:
                    raise AcquisitionError(f"{flow}: conflicting inherited group attributes")
                group_attrs[key] = value
        series_attrs = {**dataset.attrib, **group_attrs, **series.attrib}
        if series_attrs.get("ACCESS_SHARING_LEVEL") not in (None, "", "PUBLIC_OPEN") or series_attrs.get("SECURITY_CLASSIFICATION") not in (None, "", "PUB"):
            raise AcquisitionError(f"{flow}: non-public access classification; data not accepted")
        for obs in series:
            if local(obs) != "Obs":
                raise AcquisitionError(f"{flow}: unexpected observation format")
            attrs = {**series_attrs, **obs.attrib}
            if attrs.get("ACCESS_SHARING_LEVEL") not in (None, "", "PUBLIC_OPEN") or attrs.get("SECURITY_CLASSIFICATION") not in (None, "", "PUB"):
                raise AcquisitionError(f"{flow}: non-public observation; data not accepted")
            period = attrs.get("TIME_PERIOD", "")
            if not re.fullmatch(r"\d{4}-M(0[1-9]|1[0-2])", period):
                raise AcquisitionError(f"{flow}: invalid monthly period")
            period = period.replace("-M", "-")
            if period not in months:
                raise AcquisitionError(f"{flow}: out-of-window or incomplete period")
            identity = (series.get("COUNTRY"), period)
            if identity in seen:
                raise AcquisitionError(f"{flow}: duplicate economy/indicator/month")
            seen.add(identity)
            status = attrs.get("STATUS", "")
            text = attrs.get("OBS_VALUE")
            unknown_status = bool(status and status not in structure["codelists"].get("CL_OBS_STATUS", {}))
            value = None if text in (None, "") else float(text)
            if value is not None and not math.isfinite(value):
                raise AcquisitionError(f"{flow}: non-finite observation")
            if value is not None and ((indicator["id"] in ("cpi", "fx") and value <= 0) or (indicator["id"] == "reserves" and value < 0)):
                raise AcquisitionError(f"{flow}: value violates indicator domain")
            scale = attrs.get("SCALE")
            if scale not in structure["codelists"].get("CL_UNIT_MULT", {}):
                raise AcquisitionError(f"{flow}: unknown/missing source scale")
            exclusion = "Source value missing" if value is None else None
            if unknown_status:
                warnings.append(f"{series.get('COUNTRY')}/{indicator['id']}/{period}: non-codelist status {status!r}; value excluded, original OBS_VALUE/status retained")
                value = None
                exclusion = "Unknown source observation status"
            if attrs.get("IFS_FLAG") != "true":
                warnings.append(f"{series.get('COUNTRY')}/{indicator['id']}/{period}: IFS provenance not true; excluded from required coverage")
                value = None
                exclusion = "IFS provenance not true"
            if status == "F":
                warnings.append(f"{series.get('COUNTRY')}/{indicator['id']}/{period}: forecast excluded")
                value = None
                exclusion = "Forecast excluded"
            if status in ("O", "L", "M", "Q", "H", "J", "K"):
                value = None
                exclusion = "Source status marks missing/unusable value"
            records.append({
                "country": series.get("COUNTRY"), "indicator": indicator["id"], "period": period,
                "value": value, "rawValue": text, "scale": scale,
                "unit": indicator["unit"], "status": status or None,
                "sourceHash": hashlib.sha256(content).hexdigest(),
                "exclusionReason": exclusion,
                "attributes": {k: v for k, v in attrs.items() if not k.startswith("{") and k not in ("OBS_VALUE", "FULL_DESCRIPTION", "FULL_SOURCE_CITATION")},
            })
    return records, warnings


def coverage(countries: list[dict], records: list[dict], months: list[str]) -> list[dict]:
    grouped = {}
    for row in records:
        grouped.setdefault((row["country"], row["indicator"]), []).append(row)
    report = []
    for country in countries:
        for indicator in INDICATORS:
            rows = grouped.get((country["code"], indicator["id"]), [])
            valid = sorted(r["period"] for r in rows if r["value"] is not None)
            missing = [month for month in months if month not in valid]
            report.append({
                "country": country["code"], "name": country["name"], "indicator": indicator["id"],
                "validCount": len(valid), "firstPeriod": valid[0] if valid else None,
                "latestPeriod": valid[-1] if valid else None, "missingPeriods": missing,
                "missingCount": len(missing), "absent": not valid, "freshness": "unknown",
            })
    return report


class Downloader:
    def __init__(self, stop: Event, save: Callable[[str, int, bytes], None], progress: Callable[[dict], None]):
        self.stop, self.save, self.progress = stop, save, progress
        self.deadline = time.monotonic() + JOB_SECONDS
        self.count = self.total = 0

    def check(self) -> None:
        if self.stop.is_set() or time.monotonic() >= self.deadline:
            raise AcquisitionError("IMF acquisition cancelled or exceeded its 600-second deadline")

    def get(self, path: str) -> bytes | None:
        self.check()
        self.count += 1
        if self.count > MAX_REQUESTS:
            raise AcquisitionError("IMF request budget exceeded")
        content = bytearray()
        saved = False
        status = 0
        try:
            with httpx.stream("GET", BASE + path, timeout=20, follow_redirects=False,
                              headers={"Accept": "application/vnd.sdmx.structurespecificdata+xml;version=2.1"}) as response:
                status = response.status_code
                for chunk in response.iter_bytes(chunk_size=65536):
                    remaining = min(MAX_RESPONSE - len(content), MAX_TOTAL - self.total)
                    content.extend(chunk[:max(0, remaining)])
                    self.total += len(chunk)
                    if len(chunk) > remaining:
                        raise AcquisitionError("IMF response/decompression or batch byte budget exceeded")
                    self.check()
                self.save(path, response.status_code, bytes(content))
                saved = True
                self.progress({"requests": self.count, "bytes": self.total, "lastHttpStatus": response.status_code})
                if response.status_code == 204:
                    return None
                if response.status_code != 200:
                    raise AcquisitionError(f"IMF HTTP {response.status_code}; acquisition stopped without retry or fallback")
                if not content:
                    raise AcquisitionError("IMF HTTP 200 with empty body")
                return bytes(content)
        except (AcquisitionError, httpx.HTTPError) as exc:
            if content and not saved:
                self.save(path + "#incomplete-response", status, bytes(content))
            if isinstance(exc, AcquisitionError):
                raise
            raise AcquisitionError(f"IMF transport failed ({type(exc).__name__}); no data substituted") from exc


def acquire(get: Callable[[str], bytes | None], progress: Callable[[dict], None]) -> dict:
    months = month_window()
    metadata = {}
    for flow, flow_version in FLOW_VERSIONS.items():
        content = get(f"/dataflow/IMF.STA/{flow}/{flow_version}?references=all")
        if content is None:
            raise AcquisitionError(f"{flow}: empty structure response")
        metadata[flow] = structures(content, flow)
    countries, excluded = universe(metadata["CPI"]["areas"])
    if any(metadata[flow]["areas"] != metadata["CPI"]["areas"] for flow in metadata):
        raise AcquisitionError("Reference-area codelists differ between topic structures; review required")
    # IMF-specific current areas require explicit review; they are never guessed from labels.
    unmatched = [c for c in excluded if c["code"] not in HISTORICAL_AREAS | AGGREGATE_AREAS]
    records, warnings, validation_errors = [], [], []
    codes = [c["code"] for c in countries]
    for indicator in INDICATORS:
        flow = indicator["flow"]
        for offset in range(0, len(codes), CHUNK_COUNTRIES):
            areas = codes[offset:offset + CHUNK_COUNTRIES]
            path = f"/data/{flow}/{'+'.join(areas)}.{indicator['key']}?startPeriod={months[0]}&endPeriod={months[-1]}"
            content = get(path)
            if content is not None:
                try:
                    rows, notes = parse_data(content, indicator, areas, months, metadata[flow])
                except AcquisitionError as exc:
                    validation_errors.append(f"Rejected {indicator['id']} response for {','.join(areas)}: {exc}")
                except ValueError:
                    validation_errors.append(f"Rejected {indicator['id']} response for {','.join(areas)}: invalid numeric source value")
                else:
                    records.extend(rows)
                    warnings.extend(notes)
            if len(records) > MAX_OBSERVATIONS:
                raise AcquisitionError("IMF parsed-observation budget exceeded")
            progress({"indicator": indicator["id"], "countriesProcessed": min(offset + CHUNK_COUNTRIES, len(codes)), "observations": len(records)})
    matrix = coverage(countries, records, months)
    absent = sum(row["absent"] for row in matrix)
    numeric = sum(r["value"] is not None for r in records)
    errors = validation_errors + (["No usable numeric monthly observations"] if not numeric else [])
    if unmatched:
        errors.append(f"{len(unmatched)} unmatched IMF reference areas require explicit classification review")
    return {
        "records": records, "coverage": matrix,
        "report": {
            "contractVersion": CONTRACT, "retrievedAt": now_iso(), "flows": FLOW_VERSIONS,
            "startPeriod": months[0], "endPeriod": months[-1], "countries": countries,
            "excludedAreas": excluded, "unreviewedAreas": unmatched, "countryMapping": f"pycountry {version('pycountry')}; exact ISO match plus reviewed IMF KOS (no ISO3) and WBG (PSE); frozen reviewed exclusions; unknown areas block activation",
            "unmatchedIsoAreas": [{"code": c.alpha_3, "name": c.name, "reason": "No current IMF reference-area code or reviewed alias; outside the matched IMF universe"}
                                  for c in pycountry.countries if c.alpha_3 not in {a["iso3"] for a in countries}],
            "indicators": [{k: v for k, v in i.items() if k != "codes"} for i in INDICATORS],
            "rowCount": len(records), "numericCount": numeric, "requiredPairs": len(matrix), "absentPairs": absent,
            "coveragePolicy": COVERAGE_POLICY,
            "coverageLimitation": "Missing economy/indicator pairs and internal gaps are disclosed, never filled. Coverage gaps alone do not quarantine this v2 basket; affected histories/changes remain unavailable. Legacy strict snapshots retain their original gate.",
            "unknownStatusRows": sum(r["exclusionReason"] == "Unknown source observation status" for r in records),
            "warnings": warnings[:200], "warningCount": len(warnings), "errors": errors,
            "valueConvention": "Exact native OBS_VALUE, no scaling conversion. SCALE retained, not assumed to be a multiplier of API values. Standardized monetary comparisons blocked until conversion semantics independently verified.",
            "freshness": "unknown; no verified release-lag policy", "forecastPolicy": "Forecasts excluded; estimates/provisional/revised flags preserved",
            "limitation": "Monthly descriptive monitoring only; no harmonized cross-country rate/CPI-level comparison, no forecasts, no annual-model input or point-in-time history claim.",
        },
    }
