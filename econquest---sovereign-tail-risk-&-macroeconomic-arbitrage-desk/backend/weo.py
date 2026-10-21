"""Annual WEO vintages, kept separate from observed monthly data and model inputs."""

import hashlib
import math
import re
from datetime import datetime

from .imf import AcquisitionError, NS, english, local, now_iso, universe, xml

FLOW = "WEO"
VERSION = "9.0.0"
CONTRACT = "weo-annual-native-v1"
DIMENSIONS = ("COUNTRY", "INDICATOR", "FREQUENCY")
MAX_ROWS = 1_000_000


def valid_timestamp(text: str) -> bool:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T[\d:.]+Z", text):
        return False
    try:
        datetime.fromisoformat(text)
    except ValueError:
        return False
    return True


def metadata(content: bytes) -> dict:
    root = xml(content)
    flows = root.findall(".//s:Dataflow", NS)
    if not any(e.get("id") == FLOW and e.get("agencyID") == "IMF.RES" and e.get("version") == VERSION for e in flows):
        raise AcquisitionError("WEO flow identity/version changed; contract review required")
    structures = root.findall(".//s:DataStructure", NS)
    if len(structures) != 1 or any(structures[0].get(k) != v for k, v in
                                   {"id": "DSD_WEO", "agencyID": "IMF.RES", "version": VERSION}.items()):
        raise AcquisitionError("WEO data-structure identity/version changed")
    dimensions = [e.get("id") for e in structures[0].findall("s:DataStructureComponents/s:DimensionList/*", NS) if e.get("position") is not None]
    if tuple(dimensions) != DIMENSIONS:
        raise AcquisitionError("WEO dimensions changed")
    lists = {}
    for cl in root.findall(".//s:Codelist", NS):
        identifier = cl.get("id")
        if identifier in lists:
            raise AcquisitionError("WEO ambiguous duplicate codelist")
        lists[identifier] = {e.get("id"): {"name": english(e), "description": english(e, "Description")}
                             for e in cl.findall("s:Code", NS)}
    if not all(lists.get(k) for k in ("CL_WEO_COUNTRY", "CL_WEO_INDICATOR", "CL_UNIT", "CL_UNIT_MULT")):
        raise AcquisitionError("WEO country/indicator/unit metadata missing")
    areas = dict(lists["CL_WEO_COUNTRY"])
    extra = areas.pop("GX123", None)
    if extra and extra["name"] != "Other Advanced Economies (Advanced Economies excluding G7 and Euro Area countries)":
        raise AcquisitionError("WEO reviewed GX123 aggregate label changed")
    countries, excluded = universe(areas)
    if extra:
        excluded.append({"code": "GX123", **extra, "reason": "Reviewed aggregate; not an individual economy"})
    if any("Unreviewed" in e["reason"] for e in excluded):
        raise AcquisitionError("WEO unreviewed reference areas; classification review required")
    indicators = [{"code": code, **info} for code, info in sorted(lists["CL_WEO_INDICATOR"].items())]
    if not indicators or any(not re.fullmatch(r"[A-Z0-9_]+", i["code"]) or not i["name"] for i in indicators):
        raise AcquisitionError("WEO indicator catalog invalid")
    return {"countries": countries, "excludedAreas": excluded, "indicators": indicators, "lists": lists}


def public(attrs: dict) -> None:
    if attrs.get("ACCESS_SHARING_LEVEL") not in (None, "", "PUBLIC_OPEN") or attrs.get("SECURITY_CLASSIFICATION") not in (None, "", "PUB"):
        raise AcquisitionError("WEO non-public classification; response rejected")


def parse(content: bytes, countries: list[str], catalog: dict) -> dict:
    root = xml(content)
    refs = [e for e in root.iter() if local(e) == "Ref" and e.get("id") == FLOW]
    if len(refs) != 1 or refs[0].get("agencyID") != "IMF.RES" or refs[0].get("version") != VERSION:
        raise AcquisitionError("WEO data response identity/version changed")
    datasets = [e for e in root if local(e) == "DataSet"]
    if len(datasets) != 1:
        raise AcquisitionError("WEO expected one dataset")
    dataset = datasets[0]
    publication = dataset.get("PUBLICATION_DATE", "")
    if not valid_timestamp(publication):
        raise AcquisitionError("WEO release publication timestamp missing/invalid")
    update = dataset.get("UPDATE_DATE")
    if update is not None and not valid_timestamp(update):
        raise AcquisitionError("WEO dataset update timestamp invalid")
    public(dataset.attrib)
    groups = []
    for element in dataset:
        if local(element) == "Group":
            keys = {k: v for k, v in element.attrib.items() if k in DIMENSIONS}
            if not keys:
                raise AcquisitionError("WEO group without identifying dimensions")
            groups.append((keys, {k: v for k, v in element.attrib.items() if not k.startswith("{")}))
        elif local(element) != "Series":
            raise AcquisitionError("WEO unexpected dataset element")
    units = catalog["lists"]["CL_UNIT"]
    scales = catalog["lists"]["CL_UNIT_MULT"]
    indicators = {i["code"] for i in catalog["indicators"]}
    sha = hashlib.sha256(content).hexdigest()
    series_result, observations, seen = [], [], set()
    for series in dataset:
        if local(series) != "Series":
            continue
        country, indicator = series.get("COUNTRY"), series.get("INDICATOR")
        if country not in countries or indicator not in indicators or series.get("FREQUENCY") != "A":
            raise AcquisitionError("WEO unexpected economy, indicator or frequency")
        identity = (country, indicator)
        if identity in seen:
            raise AcquisitionError("WEO duplicate annual series")
        seen.add(identity)
        attrs = {k: v for k, v in dataset.attrib.items() if not k.startswith("{")}
        for size in (1, 2, 3):
            level = {}
            for keys, values in groups:
                if len(keys) != size or any(series.get(k) != v for k, v in keys.items()):
                    continue
                if any(k in level and level[k] != v for k, v in values.items()):
                    raise AcquisitionError("WEO conflicting group attributes")
                level.update(values)
            attrs.update(level)
        attrs.update(series.attrib)
        public(attrs)
        if (attrs.get("UNIT") and attrs["UNIT"] not in units) or (attrs.get("SCALE") and attrs["SCALE"] not in scales):
            raise AcquisitionError(f"WEO {country}/{indicator}: unknown source unit/scale")
        cutoff_text = attrs.get("LATEST_ACTUAL_ANNUAL_DATA", "")
        cutoff = int(cutoff_text) if re.fullmatch(r"(19|20|21)\d{2}", cutoff_text) else None
        if cutoff is not None and cutoff > int(publication[:4]):
            raise AcquisitionError("WEO latest-actual boundary lies after release year")
        years, valid, unknown = set(), [], 0
        for obs in series:
            if local(obs) != "Obs":
                raise AcquisitionError("WEO unexpected annual observation element")
            public(attrs | obs.attrib)
            text_year = obs.get("TIME_PERIOD", "")
            if not re.fullmatch(r"(19|20|21)\d{2}", text_year):
                raise AcquisitionError("WEO invalid annual period")
            year = int(text_year)
            if year in years:
                raise AcquisitionError("WEO duplicate annual observation")
            years.add(year)
            if any(k in obs.attrib and obs.get(k) != attrs.get(k) for k in ("UNIT", "SCALE", "LATEST_ACTUAL_ANNUAL_DATA")):
                raise AcquisitionError("WEO observation-level unit/boundary change requires review")
            raw = obs.get("OBS_VALUE")
            try:
                value = None if raw in (None, "") else float(raw)
            except ValueError as exc:
                raise AcquisitionError("WEO invalid numeric observation") from exc
            if value is not None and not math.isfinite(value):
                raise AcquisitionError("WEO non-finite observation")
            status = obs.get("OBS_STATUS") or obs.get("STATUS") or attrs.get("OBS_STATUS") or attrs.get("STATUS")
            if status and status not in catalog["lists"].get("CL_OBS_STATUS", {}):
                if value is not None:
                    raise AcquisitionError(f"WEO unknown numeric observation status {status[:40]!r}")
            classification = "unknown" if cutoff is None else "actual" if year <= cutoff else "estimate_projection"
            if status == "F":
                classification = "estimate_projection"
            if status in ("O", "M", "L", "Q", "H", "J", "K"):
                value = None
            if value is not None:
                valid.append(year)
                unknown += int(classification == "unknown")
            observations.append({"country": country, "indicator": indicator, "year": year, "value": value,
                                 "rawValue": raw, "classification": classification, "status": status,
                                 "attributes": dict(obs.attrib), "sourceHash": sha})
        series_result.append({
            "country": country, "indicator": indicator, "unit": attrs.get("UNIT"), "unitLabel": units.get(attrs.get("UNIT"), {}).get("name", "Unit not supplied; comparisons blocked"),
            "scale": attrs.get("SCALE"), "scaleLabel": scales.get(attrs.get("SCALE"), {}).get("name", "Scale not supplied; comparisons blocked"), "latestActualYear": cutoff,
            "firstYear": min(years) if years else None, "lastYear": max(years) if years else None,
            "validCount": len(valid), "validYears": sorted(valid), "unknownClassificationCount": unknown,
            "attributes": attrs, "sourceHash": sha,
            "analysisBlocked": not attrs.get("UNIT") or not attrs.get("SCALE") or cutoff is None,
            "classificationNote": "Missing/unmapped actual-data boundary (including fiscal years); annual classification unknown" if cutoff is None else None,
        })
    return {"publicationDate": publication, "updateDate": update, "series": series_result, "records": observations}


def acquire(get, progress) -> dict:
    content = get(f"/dataflow/IMF.RES/{FLOW}/{VERSION}?references=all")
    if content is None:
        raise AcquisitionError("WEO metadata unavailable")
    catalog = metadata(content)
    records, series, publication, update = [], [], None, None
    codes = [c["code"] for c in catalog["countries"]]
    for start in range(0, len(codes), 20):
        countries = codes[start:start + 20]
        content = get(f"/data/{FLOW}/{'+'.join(countries)}..A")
        if content is not None:
            result = parse(content, countries, catalog)
            if publication is not None and (publication != result["publicationDate"] or update != result["updateDate"]):
                raise AcquisitionError("WEO release changed during acquisition; mixed vintages rejected")
            publication = result["publicationDate"]
            update = result["updateDate"]
            series.extend(result["series"])
            records.extend(result["records"])
        if len(records) > MAX_ROWS:
            raise AcquisitionError("WEO observation budget exceeded")
        progress({"countriesProcessed": min(start + 20, len(codes)), "observations": len(records), "series": len(series)})
    if not records or not publication or not any(r["value"] is not None for r in records):
        raise AcquisitionError("WEO contains no valid annual observations")
    years = [r["year"] for r in records]
    first, last = min(years), max(years)
    for item in series:
        valid = set(item["validYears"])
        item["missingYears"] = [y for y in range(first, last + 1) if y not in valid]
        item["missingCount"] = len(item["missingYears"])
    valid_pairs = sum(s["validCount"] > 0 for s in series)
    required = len(catalog["countries"]) * len(catalog["indicators"])
    return {"records": records, "series": series, "report": {
        "contractVersion": CONTRACT, "flow": "IMF.RES:WEO", "flowVersion": VERSION,
        "retrievedAt": now_iso(), "publicationDate": publication, "updateDate": update, "firstYear": first, "lastYear": last,
        "countries": catalog["countries"], "excludedAreas": catalog["excludedAreas"], "indicators": catalog["indicators"],
        "rowCount": len(records), "seriesCount": len(series), "requiredPairs": required, "absentPairs": required - valid_pairs,
        "availableEconomies": len({s["country"] for s in series if s["validCount"]}),
        "availableIndicators": len({s["indicator"] for s in series if s["validCount"]}),
        "analysisBlockedSeries": sum(s["analysisBlocked"] for s in series),
        "unknownClassificationRows": sum(r["value"] is not None and r["classification"] == "unknown" for r in records),
        "errors": [], "coveragePolicy": "Incomplete coverage allowed and disclosed; absent pairs/gaps block affected analysis, not whole-release staging.",
        "classificationPolicy": "Actual only through series LATEST_ACTUAL_ANNUAL_DATA; later years are IMF estimates/projections, even if in the past. Missing boundary means unknown, not actual. Actuals may be revised.",
        "valueConvention": "Native API OBS_VALUE retained without SCALE multiplication. Source unit and scale labels retained; no converted monetary or cross-country level comparisons.",
        "limitation": "Separate WEO research only. No annual fitted-model input changes, retraining, historical-vintage backtest, trading signal or current-freshness assertion. Release publication is not per-observation historical availability.",
        "transportComplete": True,
    }}
