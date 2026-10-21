"""Reviewed WDI basket via wbgapi, with bounded captured transport and no model coupling."""

import hashlib
import json
import math
import re
import time
from datetime import date, datetime, timezone
from importlib.metadata import version
from threading import Event, Lock
from urllib.parse import parse_qs, urlsplit

import httpx
import wbgapi as wb

from .imf import AcquisitionError, now_iso

BASE = "https://api.worldbank.org/v2/en/"
CONTRACT = "worldbank-wdi-native-v1"
INDICATORS = {
    "DT.DOD.DECT.GN.ZS": "External debt stocks (% of GNI)",
    "DT.DOD.DSTC.IR.ZS": "Short-term debt (% of total reserves)",
    "FI.RES.TOTL.MO": "Total reserves in months of imports",
    "NY.GDP.MKTP.KD.ZG": "GDP growth (annual %)",
    "FP.CPI.TOTL.ZG": "Inflation, consumer prices (annual %)",
    "BN.CAB.XOKA.GD.ZS": "Current account balance (% of GDP)",
    "NY.GDP.MKTP.CD": "GDP (current US$)",
    "NY.GDP.PCAP.CD": "GDP per capita (current US$)",
    "DT.DOD.DECT.CD": "External debt stocks, total (DOD, current US$)",
    "DT.TDS.DECT.EX.ZS": "Total debt service (% of exports of goods, services and primary income)",
    "FI.RES.TOTL.CD": "Total reserves (includes gold, current US$)",
    "PA.NUS.FCRF": "Official exchange rate (LCU per US$, period average)",
    "NE.EXP.GNFS.ZS": "Exports of goods and services (% of GDP)",
    "NE.IMP.GNFS.ZS": "Imports of goods and services (% of GDP)",
    "BX.KLT.DINV.WD.GD.ZS": "Foreign direct investment, net inflows (% of GDP)",
    "GC.DOD.TOTL.GD.ZS": "Central government debt, total (% of GDP)",
    "GC.REV.XGRT.GD.ZS": "Revenue, excluding grants (% of GDP)",
}
MAX_RESPONSE = 16 * 1024 * 1024
MAX_TOTAL = 128 * 1024 * 1024
MAX_REQUESTS = 128
MAX_ROWS = 500_000
JOB_SECONDS = 600
LIBRARY_LOCK = Lock()


def source_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise AcquisitionError("World Bank source update date missing/invalid")
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise AcquisitionError("World Bank source update date is not a valid calendar date") from exc
    return value


class Downloader:
    """wbgapi's requests-compatible boundary, scoped to this library, not global requests."""

    def __init__(self, stop: Event, save, progress, *, source_id=2):
        if source_id not in (2, 6):
            raise ValueError("Unreviewed World Bank source")
        self.source_id = str(source_id)
        if source_id == 6:
            from .ids import INDICATORS as ids_indicators
            self.indicators = ids_indicators
        else:
            self.indicators = INDICATORS
        self.stop, self.save, self.progress = stop, save, progress
        self.deadline = time.monotonic() + JOB_SECONDS
        self.count = self.total = 0
        self.last_hash = ""
        self.headers = {}

    def check(self):
        if self.stop.is_set() or time.monotonic() >= self.deadline:
            raise AcquisitionError("World Bank acquisition cancelled or exceeded 600-second deadline")

    def get(self, url, **options):
        self.check()
        parsed = urlsplit(url)
        path = parsed.path.removeprefix("/v2/en/")
        params = parse_qs(parsed.query, keep_blank_values=True)
        source_id = self.source_id
        paths = {"country", f"source/{source_id}", f"sources/{source_id}/country", "indicator"}
        if source_id == "2":
            paths.update(f"country/all/indicator/{code}" for code in self.indicators)
        else:
            paths.update({"sources/6/concepts", "sources/6/counterpart-area", "sources/6/time", "sources/6/series"})
            paths.update(f"sources/6/country/all/series/{code}/counterpart-area/WLD/data" for code in self.indicators)
        if (not url.startswith(BASE) or parsed.fragment or path not in paths or
            set(params) - {"page", "per_page", "format", "source", "footnote"} or
            any(len(v) != 1 for v in params.values()) or params.get("format") != ["json"] or
            ("source" in params and params["source"] != [source_id]) or
            ("footnote" in params and params["footnote"] != ["y"])):
            raise AcquisitionError("World Bank request outside fixed reviewed scope")
        self.count += 1
        if self.count > MAX_REQUESTS:
            raise AcquisitionError("World Bank request budget exceeded")
        content, saved, status = bytearray(), False, 0
        try:
            with httpx.stream("GET", url, timeout=20, follow_redirects=False, headers={"Accept": "application/json"}) as response:
                status = response.status_code
                for chunk in response.iter_bytes(chunk_size=65536):
                    remaining = min(MAX_RESPONSE - len(content), MAX_TOTAL - self.total)
                    content.extend(chunk[:max(0, remaining)])
                    self.total += len(chunk)
                    if len(chunk) > remaining:
                        raise AcquisitionError("World Bank response/decompression or total byte budget exceeded")
                    self.check()
                self.save(url, status, bytes(content))
                saved = True
                if status != 200:
                    raise AcquisitionError(f"World Bank HTTP {status}; no retry or fallback")
                try:
                    data = json.loads(content)
                except (ValueError, UnicodeError) as exc:
                    raise AcquisitionError("World Bank returned invalid JSON") from exc
                if path in {f"sources/{source_id}/country", "sources/6/concepts", "sources/6/counterpart-area", "sources/6/time", "sources/6/series"}:
                    try:
                        sources = data["source"]
                        concept = path.rsplit("/", 1)[-1]
                        if len(sources) != 1 or str(sources[0]["id"]) != source_id:
                            raise ValueError("Unexpected source concepts")
                        if concept == "concepts":
                            rows = sources[0]["concept"]
                        else:
                            if (len(sources[0]["concept"]) != 1 or
                                not isinstance(sources[0]["concept"][0]["id"], str) or
                                sources[0]["concept"][0]["id"].lower() != concept):
                                raise ValueError("Unexpected source concept identity")
                            rows = sources[0]["concept"][0]["variable"]
                        header = data
                        if not isinstance(rows, list):
                            raise ValueError("Invalid source country variables")
                    except (KeyError, IndexError, TypeError, ValueError) as exc:
                        raise AcquisitionError("World Bank source economy membership invalid") from exc
                elif source_id == "6" and path.endswith("/data"):
                    if (not isinstance(data, dict) or not isinstance(data.get("source"), dict) or
                        data["source"].get("id") != "6" or data["source"].get("name") != "International Debt Statistics" or
                        not isinstance(data["source"].get("data"), list)):
                        raise AcquisitionError("World Bank IDS data is not source 6 or has an invalid envelope")
                    header, rows = data, data["source"]["data"]
                    source_date(header.get("lastupdated"))
                else:
                    if not isinstance(data, list) or len(data) != 2 or not isinstance(data[0], dict) or not isinstance(data[1], list):
                        raise AcquisitionError("World Bank error envelope or invalid response shape")
                    header, rows = data
                try:
                    if any(isinstance(header[k], bool) or not re.fullmatch(r"\d+", str(header[k])) for k in ("page", "pages", "per_page", "total")):
                        raise ValueError("Pagination fields must be nonnegative integers")
                    page, pages, per_page, total = (int(header[k]) for k in ("page", "pages", "per_page", "total"))
                    requested_page = int(params.get("page", ["1"])[0])
                except (KeyError, TypeError, ValueError) as exc:
                    raise AcquisitionError("World Bank invalid pagination metadata") from exc
                if (page != requested_page or not 1 <= page <= pages <= MAX_REQUESTS or not 1 <= per_page <= 20000 or
                    not 0 <= total <= MAX_ROWS or pages != max(1, math.ceil(total / per_page)) or
                    len(rows) != max(0, min(per_page, total - (page - 1) * per_page))):
                    raise AcquisitionError("World Bank incomplete/inconsistent pagination")
                if path.startswith("country/all/indicator/"):
                    if str(header.get("sourceid")) != "2":
                        raise AcquisitionError("World Bank data is not WDI source 2")
                    source_date(header.get("lastupdated"))
                key = (path, params.get("source", [""])[0])
                previous = self.headers.get(key)
                identity = (pages, per_page, total, header.get("lastupdated"))
                if previous and (previous["identity"] != identity or page != previous["lastPage"] + 1):
                    raise AcquisitionError("World Bank pagination or source vintage changed during pull")
                if not previous and page != 1:
                    raise AcquisitionError("World Bank pagination did not begin at first page")
                self.headers[key] = {"identity": identity, "lastPage": page}
                self.last_hash = hashlib.sha256(content).hexdigest()
                self.progress({"requests": self.count, "bytes": self.total, "lastHttpStatus": status})
                return httpx.Response(200, content=bytes(content))
        except (httpx.HTTPError, AcquisitionError) as exc:
            if content and not saved:
                self.save(url + "#incomplete-response", status, bytes(content))
            if isinstance(exc, AcquisitionError):
                raise
            raise AcquisitionError(f"World Bank transport failed ({type(exc).__name__}); active history unchanged") from exc


def acquire(downloader: Downloader, progress) -> dict:
    if not LIBRARY_LOCK.acquire(blocking=False):
        raise AcquisitionError("wbgapi acquisition already running")
    original_requests = wb.requests
    try:
        if wb.endpoint != "https://api.worldbank.org/v2" or wb.lang != "en":
            raise AcquisitionError("wbgapi endpoint/language changed; fixed English WDI contract required")
        wb.requests = downloader
        return _acquire(downloader, progress)
    finally:
        wb.requests = original_requests
        LIBRARY_LOCK.release()


def _acquire(downloader, progress):
    def fetch(path, **params):
        return wb.fetch(path, params={"per_page": 20000, **params}, lang="en")

    source = list(fetch("source/2"))
    if len(source) != 1 or source[0].get("id") != "2" or source[0].get("name") != "World Development Indicators":
        raise AcquisitionError("World Bank source identity changed")
    update = source_date(source[0].get("lastupdated"))
    membership = list(fetch("sources/2/country"))
    members = {r.get("id") for r in membership}
    if len(members) != len(membership) or not all(isinstance(c, str) for c in members):
        raise AcquisitionError("World Bank invalid source-specific economy membership")
    membership_hash = downloader.last_hash
    countries, excluded, all_countries, country_hashes = [], [], {}, set()
    for row in fetch("country"):
        code = row.get("id")
        if not isinstance(code, str) or not re.fullmatch("[A-Z0-9]{3}", code) or code in all_countries:
            raise AcquisitionError("World Bank invalid/duplicate economy code")
        if not isinstance(row.get("name"), str) or not isinstance(row.get("region"), dict):
            raise AcquisitionError("World Bank country classification metadata missing")
        all_countries[code] = row
        country_hashes.add(downloader.last_hash)
        if row["region"].get("id") == "NA" and row["region"].get("value") == "Aggregates":
            excluded.append({"code": code, "name": row["name"], "reason": "World Bank classifies as aggregate"})
        elif row["region"].get("id") and row["region"].get("id") != "NA" and code in members:
            countries.append({"code": code, "name": row["name"], "iso2": row.get("iso2Code"),
                              "region": row["region"], "incomeLevel": row.get("incomeLevel"), "lendingType": row.get("lendingType")})
        elif row["region"].get("id") and code not in members:
            excluded.append({"code": code, "name": row["name"], "reason": "Not present in captured WDI source 2 economy membership"})
        else:
            raise AcquisitionError("World Bank unclassified economy; no name-based guessing")
    if members - all_countries.keys():
        raise AcquisitionError("WDI source economy absent from captured classification catalog")
    iso2_countries = {r["iso2Code"]: r for r in all_countries.values()}
    if len(iso2_countries) != len(all_countries):
        raise AcquisitionError("World Bank ambiguous two-letter economy identifiers")
    if len(countries) < 150:
        raise AcquisitionError("World Bank individual economy list unexpectedly incomplete")
    indicators, catalog_seen = [], set()
    for row in fetch("indicator", source=2):
        code = row.get("id")
        if code in catalog_seen:
            raise AcquisitionError("World Bank duplicate catalog indicator")
        catalog_seen.add(code)
        if code not in INDICATORS:
            continue
        if row.get("name") != INDICATORS[code] or row.get("source", {}).get("id") != "2":
            raise AcquisitionError(f"World Bank {code}: reviewed definition/source changed")
        if not all(isinstance(row.get(k), str) for k in ("unit", "sourceNote", "sourceOrganization")):
            raise AcquisitionError(f"World Bank {code}: definition metadata missing")
        indicators.append({"code": code, "name": row["name"], "description": row["sourceNote"],
                           "sourceOrganization": row["sourceOrganization"], "sourceHash": downloader.last_hash, "unit": row["unit"]})
    if {i["code"] for i in indicators} != set(INDICATORS):
        raise AcquisitionError("World Bank approved indicator unavailable in WDI catalog")
    codes = {c["code"] for c in countries}
    records, series, seen = [], [], set()
    current_year = datetime.now(timezone.utc).year
    for indicator in indicators:
        code = indicator["code"]
        grouped = {}
        for row in fetch(f"country/all/indicator/{code}", source=2, footnote="y"):
            country = row.get("countryiso3code")
            if not isinstance(row.get("country"), dict):
                raise AcquisitionError("World Bank observation economy missing from captured catalog")
            if country == "":
                alias = iso2_countries.get(row["country"].get("id"))
                if not alias or alias["region"].get("id") != "NA" or alias["name"] != row["country"].get("value"):
                    raise AcquisitionError("World Bank blank ISO3 is not a verified catalog aggregate")
                country = alias["id"]
            if country not in all_countries:
                raise AcquisitionError("World Bank observation economy missing from captured catalog")
            if row.get("country", {}).get("id") != all_countries[country].get("iso2Code"):
                raise AcquisitionError("World Bank economy code mismatch")
            if row.get("indicator", {}).get("id") != code or row["indicator"].get("value") != indicator["name"]:
                raise AcquisitionError("World Bank observation indicator mismatch")
            if country not in codes:
                continue
            year = row.get("date")
            if not isinstance(year, str) or not re.fullmatch(r"(19|20)\d{2}", year) or int(year) > current_year:
                raise AcquisitionError("World Bank invalid/nonhistorical annual period")
            key = (country, code, year)
            if key in seen:
                raise AcquisitionError("World Bank duplicate country/indicator/year")
            seen.add(key)
            value = row.get("value")
            if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)):
                raise AcquisitionError("World Bank non-finite/invalid observation")
            status, unit, footnote, decimal = (row.get(k) for k in ("obs_status", "unit", "footnote", "decimal"))
            if not all(isinstance(v, str) for v in (status, unit, footnote)) or isinstance(decimal, bool) or not isinstance(decimal, int) or not 0 <= decimal <= 20:
                raise AcquisitionError("World Bank flags/unit/footnote/precision metadata invalid")
            record = {"country": country, "indicator": code, "year": int(year), "value": value,
                      "rawValue": value, "status": status, "unit": unit, "footnote": footnote, "decimal": decimal,
                      "classification": "reported_unverified", "sourceHash": downloader.last_hash}
            records.append(record)
            grouped.setdefault(country, []).append(record)
        for country, rows in grouped.items():
            valid = [r["year"] for r in rows if r["value"] is not None]
            series.append({"country": country, "indicator": code, "validCount": len(valid),
                           "firstYear": min(r["year"] for r in rows), "lastYear": max(r["year"] for r in rows),
                           "validYears": sorted(valid), "flaggedCount": sum(bool(r["status"] or r["footnote"]) for r in rows),
                           "analysisBlocked": not valid or any(r["status"] or r["footnote"] for r in rows),
                           "limitation": "Native reported WDI history; blank status does not prove actual/release availability. No derived or cross-source comparison."})
        if len(records) > MAX_ROWS:
            raise AcquisitionError("World Bank observation budget exceeded")
        progress({"indicator": code, "indicatorsProcessed": len({s["indicator"] for s in series}), "observations": len(records)})
    if not records or not any(r["value"] is not None for r in records):
        raise AcquisitionError("World Bank returned no valid annual history")
    if any(h["lastPage"] != h["identity"][0] for h in downloader.headers.values()):
        raise AcquisitionError("World Bank incomplete pagination")
    if any(h["identity"][3] != update for (path, _), h in downloader.headers.items() if path.startswith("country/all/indicator/")):
        raise AcquisitionError("World Bank WDI vintage changed across indicators")
    first, last = min(r["year"] for r in records), max(r["year"] for r in records)
    for s in series:
        s["missingYears"] = [y for y in range(first, last + 1) if y not in s["validYears"]]
        s["missingCount"] = len(s["missingYears"])
        s["analysisBlocked"] = s["analysisBlocked"] or bool(s["missingYears"])
    downloader.check()
    required = len(countries) * len(indicators)
    return {"records": records, "series": series, "report": {
        "errors": [], "contractVersion": CONTRACT, "library": f"wbgapi {version('wbgapi')}",
        "sourceId": "2", "sourceName": source[0]["name"], "sourceLastUpdated": update, "retrievedAt": now_iso(),
        "firstYear": first, "lastYear": last, "countries": sorted(countries, key=lambda c: c["code"]),
        "excludedAreas": excluded, "countrySourceHashes": sorted(country_hashes), "membershipSourceHash": membership_hash, "indicators": indicators,
        "rowCount": len(records), "seriesCount": len(series), "requiredPairs": required,
        "absentPairs": required - sum(s["validCount"] > 0 for s in series),
        "availableEconomies": len({s["country"] for s in series if s["validCount"]}),
        "availableIndicators": len({s["indicator"] for s in series if s["validCount"]}),
        "analysisBlockedSeries": sum(s["analysisBlocked"] for s in series),
        "flaggedRows": sum(bool(r["status"] or r["footnote"]) for r in records),
        "coveragePolicy": "Incomplete coverage allowed and disclosed; no filling or cross-provider replacement.",
        "classificationPolicy": "WDI reported history, not independently verified actuals. Source flags and footnotes preserved. Blank obs_status is not an actual/forecast boundary or publication timestamp.",
        "valueConvention": "Exact API numeric values; no scaling, currency conversion or recalculation. Metadata definitions provide conventions where API unit fields are blank.",
        "limitation": "Separate monitoring only; no fitted-model input/training changes, harmonized WEO comparisons, historical publication claim, derived comparisons or current-freshness assertion. Fiscal series are central-government, not general-government.",
        "transportComplete": True,
    }}
