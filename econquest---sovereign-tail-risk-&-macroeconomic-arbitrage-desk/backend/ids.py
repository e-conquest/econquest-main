"""IDS source-6 WLD creditor totals through wbgapi's unmodified low-level rows."""

import math
import re
from datetime import datetime, timezone
from importlib.metadata import version

import wbgapi as wb

from .imf import AcquisitionError, now_iso
from .worldbank import INDICATORS as WDI_INDICATORS, LIBRARY_LOCK, MAX_ROWS, source_date

CONTRACT = "worldbank-ids-wld-native-v1"
INDICATORS = {
    "DT.DOD.DECT.CD": "External debt stocks, total (DOD, current US$)",
    "DT.DOD.DLXF.CD": "External debt stocks, long-term (DOD, current US$)",
    "DT.DOD.DSTC.CD": "External debt stocks, short-term (DOD, current US$)",
    "DT.DOD.DPPG.CD": "External debt stocks, public and publicly guaranteed (PPG) (DOD, current US$)",
    "DT.DOD.DPNG.CD": "External debt stocks, private nonguaranteed (PNG) (DOD, current US$)",
    "DT.DOD.DIMF.CD": "Use of IMF credit (DOD, current US$)",
    "DT.DOD.MLAT.CD": "PPG, multilateral (DOD, current US$)",
    "DT.DOD.BLAT.CD": "PPG, bilateral (DOD, current US$)",
    "DT.DOD.PRVT.CD": "PPG, private creditors (DOD, current US$)",
    "DT.TDS.DECT.CD": "Debt service on external debt, total (TDS, current US$)",
    "DT.AMT.DLXF.CD": "Principal repayments on external debt, long-term (AMT, current US$)",
    "DT.INT.DECT.CD": "Interest payments on external debt, total (INT, current US$)",
    "DT.DIS.DLXF.CD": "Disbursements on external debt, long-term (DIS, current US$)",
    "DT.NFL.DECT.CD": "Net flows on external debt, total (NFL, current US$)",
    "DT.NTR.DECT.CD": "Net transfers on external debt, total (NTR, current US$)",
    "DT.DOD.DECT.GN.ZS": "External debt stocks (% of GNI)",
    "DT.TDS.DECT.EX.ZS": "Total debt service (% of exports of goods, services and primary income)",
    "DT.DOD.DSTC.ZS": "Short-term debt (% of total external debt)",
}
OVERLAP = sorted(INDICATORS.keys() & WDI_INDICATORS.keys())
SERIES_TITLES = INDICATORS | {"DT.DOD.DIMF.CD": "Use of IMF credit and SDR allocations\u00a0(DOD, current US$)"}


def acquire(downloader, progress):
    if downloader.source_id != "6":
        raise AcquisitionError("IDS requires source-6 transport")
    if not LIBRARY_LOCK.acquire(blocking=False):
        raise AcquisitionError("wbgapi acquisition already running")
    original = wb.requests
    try:
        if wb.endpoint != "https://api.worldbank.org/v2" or wb.lang != "en":
            raise AcquisitionError("IDS fixed wbgapi endpoint/language changed")
        wb.requests = downloader
        return _acquire(downloader, progress)
    finally:
        wb.requests = original
        LIBRARY_LOCK.release()


def _acquire(downloader, progress):
    def fetch(path, *, concepts=False, **params):
        return wb.fetch(path, params={"per_page": 20000, **params}, concepts=concepts, lang="en")

    source = list(fetch("source/6"))
    if len(source) != 1 or source[0].get("id") != "6" or source[0].get("name") != "International Debt Statistics":
        raise AcquisitionError("IDS source identity changed")
    update = source_date(source[0].get("lastupdated"))
    source_hash = downloader.last_hash
    concepts = list(fetch("sources/6/concepts", concepts=True))
    expected = {"country": "Country", "series": "Series", "time": "Time", "counterpart-area": "Counterpart-Area"}
    if (len(concepts) != 4 or not all(isinstance(c.get("id"), str) for c in concepts) or
        {c["id"].lower(): c.get("value") for c in concepts} != expected):
        raise AcquisitionError("IDS source dimensions changed")
    concept_hash = downloader.last_hash
    counterparts = list(fetch("sources/6/counterpart-area"))
    if sum(c.get("id") == "WLD" and c.get("value") == "World" for c in counterparts) != 1:
        raise AcquisitionError("IDS WLD World counterpart definition changed")
    counterpart_hash = downloader.last_hash
    times = list(fetch("sources/6/time"))
    time_map = {}
    for t in times:
        if (not isinstance(t.get("id"), str) or not re.fullmatch(r"YR(?:19|20)\d{2}", t["id"]) or
            t.get("value") != t["id"][2:] or t["id"] in time_map):
            raise AcquisitionError("IDS annual time metadata invalid/duplicate")
        time_map[t["id"]] = t["value"]
    time_hash = downloader.last_hash
    membership = list(fetch("sources/6/country"))
    members = {m.get("id"): m.get("value") for m in membership}
    if len(members) != len(membership) or not all(isinstance(k, str) and isinstance(v, str) for k, v in members.items()):
        raise AcquisitionError("IDS economy membership invalid/duplicate")
    membership_hash = downloader.last_hash
    countries, excluded, all_countries, country_hashes = [], [], {}, set()
    for c in fetch("country"):
        code = c.get("id")
        if (not isinstance(code, str) or not re.fullmatch("[A-Z0-9]{3}", code) or code in all_countries or
            not isinstance(c.get("name"), str) or not isinstance(c.get("region"), dict)):
            raise AcquisitionError("IDS economy classification missing/invalid/duplicate")
        all_countries[code] = c
        country_hashes.add(downloader.last_hash)
        if c["region"].get("id") == "NA" and c["region"].get("value") == "Aggregates":
            excluded.append({"code": code, "name": c["name"], "reason": "World Bank classified aggregate"})
        elif c["region"].get("id") and c["region"]["id"] != "NA" and code in members:
            countries.append({"code": code, "name": c["name"]})
        elif c["region"].get("id") and code not in members:
            excluded.append({"code": code, "name": c["name"], "reason": "Not in source-6 economy membership"})
        else:
            raise AcquisitionError("IDS unclassified economy")
    if members.keys() - all_countries.keys() or len(countries) < 100:
        raise AcquisitionError("IDS source-specific economy membership incomplete/unclassified")
    indicators = []
    seen_catalog = set()
    for i in fetch("indicator", source=6):
        code = i.get("id")
        if code in seen_catalog:
            raise AcquisitionError("IDS duplicate catalog indicator")
        seen_catalog.add(code)
        if code not in INDICATORS:
            continue
        if i.get("name") != INDICATORS[code] or i.get("source", {}).get("id") != "6" or not all(
            isinstance(i.get(k), str) for k in ("unit", "sourceNote", "sourceOrganization")):
            raise AcquisitionError(f"IDS {code}: reviewed definition/source changed")
        indicators.append({"code": code, "name": i["name"], "description": i["sourceNote"], "sourceOrganization": i["sourceOrganization"],
                           "unit": i["unit"], "sourceHash": downloader.last_hash})
    if {i["code"] for i in indicators} != set(INDICATORS):
        raise AcquisitionError("IDS reviewed indicator missing")
    source_series = list(fetch("sources/6/series"))
    titles = {i.get("id"): i.get("value") for i in source_series}
    if len(titles) != len(source_series) or any(titles.get(code) != title for code, title in SERIES_TITLES.items()):
        raise AcquisitionError("IDS source-specific series title changed/missing")
    series_hash = downloader.last_hash
    for i in indicators:
        i["sourceTitle"] = titles[i["code"]]
    codes = {c["code"] for c in countries}
    records, series, seen = [], [], set()
    future_rows = future_numeric = 0
    current_year = datetime.now(timezone.utc).year
    for i in indicators:
        grouped = {}
        path = f"sources/6/country/all/series/{i['code']}/counterpart-area/WLD/data"
        for row in fetch(path):
            variables = row.get("variable")
            if not isinstance(variables, list) or len(variables) != 4 or not all(isinstance(v, dict) for v in variables):
                raise AcquisitionError("IDS observation dimensions missing")
            dims = {v.get("concept"): v for v in variables}
            if set(dims) != set(expected.values()) or len(dims) != len(variables):
                raise AcquisitionError("IDS observation dimensions duplicate/changed")
            country, year = dims["Country"].get("id"), dims["Time"].get("id")
            if country not in members or dims["Country"].get("value") != members[country]:
                raise AcquisitionError("IDS observation economy identity mismatch")
            if (dims["Series"].get("id"), dims["Series"].get("value"), dims["Counterpart-Area"].get("id"), dims["Counterpart-Area"].get("value")) != (
                i["code"], i["sourceTitle"], "WLD", "World"):
                raise AcquisitionError("IDS unrequested series/counterpart identity")
            if year not in time_map or dims["Time"].get("value") != time_map[year]:
                raise AcquisitionError("IDS observation time identity mismatch")
            key = (country, i["code"], year)
            if key in seen:
                raise AcquisitionError("IDS duplicate economy/indicator/year")
            seen.add(key)
            value = row.get("value")
            if "value" not in row or (value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value))):
                raise AcquisitionError("IDS invalid/nonfinite observation value")
            if country not in codes:
                continue
            if int(year[2:]) > current_year:
                future_rows += 1
                future_numeric += value is not None
                continue
            attrs = {k: v for k, v in row.items() if k not in ("variable", "value")}
            if not all(isinstance(k, str) for k in attrs):
                raise AcquisitionError("IDS invalid source attributes")
            record = {"country": country, "indicator": i["code"], "year": int(year[2:]), "value": value, "rawValue": value,
                      "classification": "reported_unverified", "counterpart": "WLD", "sourceId": "6", "attributes": attrs,
                      "sourceHash": downloader.last_hash}
            records.append(record)
            grouped.setdefault(country, []).append(record)
        for country, rows in grouped.items():
            valid = sorted(r["year"] for r in rows if r["value"] is not None)
            series.append({"country": country, "indicator": i["code"], "validCount": len(valid), "validYears": valid,
                           "firstYear": min(r["year"] for r in rows), "lastYear": max(r["year"] for r in rows),
                           "flaggedCount": sum(bool(r["attributes"]) for r in rows),
                           "analysisBlocked": not valid or any(r["attributes"] for r in rows),
                           "limitation": "IDS WLD creditor totals. Source API does not supply WDI status/precision/unit/footnote fields consistently; missing metadata remains unknown, not blank normal/actual. Any supplied attributes retained."})
        if len(records) > MAX_ROWS:
            raise AcquisitionError("IDS observation budget exceeded")
        progress({"indicator": i["code"], "indicatorsProcessed": len({s["indicator"] for s in series}), "observations": len(records)})
    if not records or not any(r["value"] is not None for r in records):
        raise AcquisitionError("IDS returned no numeric annual history")
    if any(h["lastPage"] != h["identity"][0] for h in downloader.headers.values()):
        raise AcquisitionError("IDS incomplete pagination")
    if any(h["identity"][3] != update for (path, _), h in downloader.headers.items() if path.endswith("/data")):
        raise AcquisitionError("IDS source vintage changed across indicators")
    downloader.check()
    first, last = min(r["year"] for r in records), max(r["year"] for r in records)
    for s in series:
        s["missingYears"] = [y for y in range(first, last + 1) if y not in s["validYears"]]
        s["missingCount"] = len(s["missingYears"])
        s["analysisBlocked"] |= bool(s["missingYears"])
    return {"records": records, "series": series, "report": {
        "errors": [], "transportComplete": True, "contractVersion": CONTRACT, "library": f"wbgapi {version('wbgapi')}",
        "sourceId": "6", "sourceName": source[0]["name"], "sourceLastUpdated": update, "retrievedAt": now_iso(),
        "counterpart": "WLD", "counterpartName": "World", "counterpartSourceHash": counterpart_hash,
        "sourceHash": source_hash, "concepts": concepts, "conceptSourceHash": concept_hash,
        "seriesSourceHash": series_hash,
        "timeSourceHash": time_hash, "membershipSourceHash": membership_hash, "countrySourceHashes": sorted(country_hashes),
        "countries": sorted(countries, key=lambda c: c["code"]), "excludedAreas": excluded, "indicators": indicators,
        "rowCount": len(records), "numericCount": sum(r["value"] is not None for r in records), "seriesCount": len(series),
        "requiredPairs": len(countries) * len(indicators), "absentPairs": len(countries) * len(indicators) - sum(s["validCount"] > 0 for s in series),
        "availableEconomies": len({s["country"] for s in series if s["validCount"]}),
        "availableIndicators": len({s["indicator"] for s in series if s["validCount"]}),
        "analysisBlockedSeries": sum(s["analysisBlocked"] for s in series), "firstYear": first, "lastYear": last,
        "historyCutoffYear": current_year, "excludedFutureRows": future_rows, "excludedFutureNumericRows": future_numeric, "wdiOverlapCodes": OVERLAP,
        "coveragePolicy": "All individual source-6 economies, WLD creditor totals and available nonfuture annual rows. Future-dated numeric/projection and null cells excluded from history and counted; retained only in originals. Nonfuture dates do not independently establish actuals. Missing values never filled.",
        "classificationPolicy": "Reported IDS history with unknown actual/estimate/publication classification; absent source attributes remain unknown, not fabricated WDI flags.",
        "valueConvention": "Exact API numeric values, no scaling/conversion/recalculation. See source definitions for current USD and ratio denominators.",
        "limitation": "Separate IDS monitoring only; no model inputs, vintage backtests or freshness claims. PPG includes public and publicly guaranteed long-term external obligations, not sovereign/general-government total debt. Creditor breakdowns apply to PPG, not total external debt. Principal/disbursements are long-term; debt service/interest are broader and cannot be combined as matching components. Three WDI overlaps are shared-source series, not independent corroboration; different revisions may differ. No automatic aggregation, reconciliation or derived analytics.",
    }}
