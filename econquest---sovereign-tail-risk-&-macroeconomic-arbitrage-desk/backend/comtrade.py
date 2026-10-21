"""Quota-bounded original-classification merchandise trade via comtradeapicall."""

import hashlib
import http.client
import json
import math
import os
import re
import time
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from threading import Event, Lock
from urllib.parse import urlencode, urlsplit

import comtradeapicall as api
import urllib3

from .imf import AcquisitionError

CONTRACT = "comtrade-original-annual-total-v1"
HOST = "comtradeapi.un.org"
FIRST_YEAR = 1962
PASS_REQUESTS = 40
PASS_SECONDS = 300
DAILY_REQUESTS = 450
MAX_RECORDS = 100000
MAX_RESPONSE = 32 * 1024 * 1024
MAX_TOTAL = 128 * 1024 * 1024
AUTH_SENTINEL = "econquest-header-auth"
REFERENCES = {"Reporters.json", "partnerAreas.json"}
LOCK = Lock()


class Paused(Exception):
    def __init__(self, message, not_before=None):
        super().__init__(message)
        self.not_before = not_before


def configured():
    return bool(re.fullmatch(r"[A-Za-z0-9_-]{16,128}", os.environ.get("COMTRADE_API_KEY", "")))


def api_key():
    if not configured():
        raise AcquisitionError("Configure COMTRADE_API_KEY in the backend only; never paste it into chat or browser fields")
    return os.environ["COMTRADE_API_KEY"]


def cutoff_year():
    return datetime.now(timezone.utc).year - 1


class Downloader:
    def __init__(self, stop: Event, save, reserve, progress):
        self._key = api_key()
        self.stop, self.save, self.reserve, self.progress = stop, save, reserve, progress
        self.count = self.total = 0
        self.deadline, self.next_request = time.monotonic() + PASS_SECONDS, 0.0
        self.last_data, self.last_hash = {}, ""

    def check(self, *, completing=False):
        if self.stop.is_set():
            raise Paused("Pass cancelled; completed chunks retained for explicit resume")
        if time.monotonic() >= self.deadline or (not completing and self.count >= PASS_REQUESTS):
            raise Paused("Bounded pass finished; explicitly resume the remaining chunks")

    def request(self, method, url, fields=None, **options):
        self.check()
        parsed = urlsplit(url)
        params = dict(fields or {})
        credential = params.pop("subscription-key", None)
        reference = parsed.path.startswith("/files/v1/app/reference/") and parsed.path.rsplit("/", 1)[-1] in REFERENCES
        data_path = re.fullmatch(r"/data/v1/(?:get|getDa)/C/A/(?:HS|SS|S[1-4])", parsed.path)
        allowed = {"reportercode", "flowcode", "period", "cmdcode", "partnercode", "partner2code", "motcode",
                   "customscode", "maxrecords", "format", "aggregateby", "breakdownmode", "countonly", "includedesc"}
        if (method != "GET" or parsed.scheme != "https" or parsed.netloc != HOST or parsed.query or parsed.fragment or
            not (reference or data_path) or (reference and params) or
            (data_path and credential != AUTH_SENTINEL) or any(k.lower() not in allowed for k in params)):
            raise AcquisitionError("Comtrade request outside reviewed credential-safe scope")
        wait = max(0.0, self.next_request - time.monotonic())
        if self.stop.wait(wait):
            self.check()
        self.check()
        self.reserve()
        self.count += 1
        self.next_request = time.monotonic() + 1.1
        query = urlencode({k: str(v).lower() if isinstance(v, bool) else v for k, v in params.items()})
        safe_path = parsed.path + ("?" + query if query else "")
        headers = {"Accept": "application/json", "Accept-Encoding": "identity"}
        if data_path:
            headers["Ocp-Apim-Subscription-Key"] = self._key
        content, status, saved = bytearray(), 0, False
        try:
            with closing(http.client.HTTPSConnection(HOST, timeout=20)) as connection:
                connection.request("GET", safe_path, headers=headers)
                with closing(connection.getresponse()) as response:
                    status = response.status
                    length = response.getheader("Content-Length")
                    if length is not None and not re.fullmatch(r"\d+", length):
                        raise AcquisitionError("Comtrade invalid HTTP content length")
                    while True:
                        chunk = response.read(65536)
                        if not chunk:
                            break
                        remaining = min(MAX_RESPONSE - len(content), MAX_TOTAL - self.total)
                        content.extend(chunk[:max(0, remaining)])
                        self.total += len(chunk)
                        if len(chunk) > remaining:
                            raise AcquisitionError("Comtrade response/pass byte budget exceeded")
                        if self.stop.is_set() or time.monotonic() >= self.deadline:
                            raise Paused("Pass interrupted during response; partial prefix is not a completed chunk")
                    if length is not None and len(content) != int(length):
                        raise AcquisitionError("Comtrade truncated HTTP response")
                    if self._key.encode() in content:
                        raise AcquisitionError("Comtrade response contained a credential; capture omitted")
                    self.save(safe_path, status, bytes(content))
                    saved = True
                    if status == 429:
                        raise Paused("Comtrade rate/quota limit reached; no automatic retry", time.time() + 86400)
                    if status != 200:
                        raise AcquisitionError(f"Comtrade HTTP {status}; no retry, preview fallback or substituted data")
                    if response.getheader("Content-Encoding", "identity") not in ("identity", ""):
                        raise AcquisitionError("Comtrade unexpected content encoding")
                    try:
                        data = json.loads(content.decode("utf-8-sig"))
                    except (ValueError, UnicodeError):
                        raise AcquisitionError("Comtrade invalid JSON") from None
                    if not isinstance(data, dict):
                        raise AcquisitionError("Comtrade invalid response envelope")
                    if reference:
                        if not isinstance(data.get("results"), list):
                            raise AcquisitionError("Comtrade reference metadata missing")
                    else:
                        count = data.get("count")
                        count_only = str(params.get("countOnly", "")).lower() == "true"
                        if (data.get("error") not in (None, "") or isinstance(count, bool) or not isinstance(count, int) or count < 0 or
                            not isinstance(data.get("data"), (dict, list) if count_only else list)):
                            raise AcquisitionError("Comtrade API error/count/data envelope invalid")
                        if not count_only and (count != len(data["data"]) or count >= MAX_RECORDS):
                            raise AcquisitionError("Comtrade response truncated or at an ambiguous record limit")
                    self.last_data, self.last_hash = data, hashlib.sha256(content).hexdigest()
                    self.progress({"passRequests": self.count, "passBytes": self.total, "lastHttpStatus": status})
                    return urllib3.response.HTTPResponse(body=bytes(content), status=200)
        except (OSError, http.client.HTTPException, AcquisitionError, Paused) as exc:
            if content and not saved and self._key.encode() not in content:
                self.save(safe_path + "#incomplete-response", status, bytes(content))
            if isinstance(exc, (AcquisitionError, Paused)):
                raise
            raise AcquisitionError(f"Comtrade transport failed ({type(exc).__name__}); completed chunks retained") from None


@contextmanager
def client(downloader):
    if not LOCK.acquire(blocking=False):
        raise AcquisitionError("Comtrade library acquisition already running")
    modules = (api.PreviewGet, api.DataAvailability)
    originals = [module.urllib3 for module in modules]

    class ScopedTransport:
        exceptions = urllib3.exceptions

        @staticmethod
        def PoolManager():
            return downloader

    try:
        for module in modules:
            module.urllib3 = ScopedTransport
        yield
    finally:
        for module, original in zip(modules, originals):
            module.urllib3 = original
        LOCK.release()


SPECIAL_PARTNERS = {129, 221, 471, 472, 492, 697, 711, 837, 838, 899}


def partner_kind(row, reporters):
    if row["code"] == 0:
        return "world"
    if row["isGroup"]:
        return "aggregate"
    if row["code"] in SPECIAL_PARTNERS:
        return "special"
    reporter = reporters.get(row["code"])
    if reporter and not reporter["isGroup"] and reporter["name"] == row["name"]:
        return "individual"
    return "unreviewed"


def catalog(rows, *, partner=False, reporters=None):
    prefix = "Partner" if partner else "reporter"
    result = []
    for row in rows:
        code, name = row.get(prefix + "Code"), row.get(prefix + "Desc")
        if (isinstance(code, bool) or not isinstance(code, int) or code < 0 or not isinstance(name, str) or
            not name.strip() or not isinstance(row.get("isGroup"), bool)):
            raise AcquisitionError("Comtrade area metadata invalid")
        result.append({"code": code, "name": name, "iso3": row.get(prefix + "CodeIsoAlpha3"),
                       "isGroup": row["isGroup"], "effective": row.get("entryEffectiveDate"), "expired": row.get("entryExpiredDate")})
        if partner:
            result[-1]["kind"] = partner_kind(result[-1], reporters or {})
    if len({r["code"] for r in result}) != len(result):
        raise AcquisitionError("Comtrade duplicate area metadata")
    if partner and not any(r["code"] == 0 and r["name"] == "World" for r in result):
        raise AcquisitionError("Comtrade World partner definition changed")
    return result


def availability(rows, year, reporters):
    selected = {}
    for row in rows:
        if (row.get("typeCode") != "C" or row.get("freqCode") != "A" or row.get("period") != year or
            row.get("reporterCode") not in reporters or not isinstance(row.get("isOriginalClassification"), bool)):
            raise AcquisitionError("Comtrade availability identity changed")
        if not row["isOriginalClassification"] or reporters[row["reporterCode"]]["isGroup"]:
            continue
        code = row["reporterCode"]
        if code in selected:
            raise AcquisitionError("Multiple original classifications for a reporter/year; explicit review required")
        classification, search = row.get("classificationCode"), row.get("classificationSearchCode")
        if (not isinstance(classification, str) or not re.fullmatch(r"H[0-6]|S[1-4]", classification) or
            search != ("HS" if classification.startswith("H") else classification) or
            not isinstance(row.get("datasetCode"), int) or isinstance(row.get("datasetCode"), bool) or
            not isinstance(row.get("datasetChecksum"), int) or not isinstance(row.get("lastReleased"), str)):
            raise AcquisitionError("Comtrade original dataset definition/identity incomplete")
        selected[code] = row | {"datasetCode": str(row["datasetCode"])}
    return list(selected.values())


def parameters(spec):
    return dict(typeCode="C", freqCode="A", clCode=spec["search"], period=",".join(map(str, spec["years"])),
                reporterCode=str(spec["reporter"]), cmdCode="TOTAL", flowCode="M,X", partnerCode=None,
                partner2Code=0, customsCode="C00", motCode=0, breakdownMode="classic")


def observations(rows, spec, partners, source_hash):
    expected = {d["period"]: d for d in spec["datasets"]}
    result, seen = [], set()
    for raw in rows:
        year = raw.get("refYear")
        identity = (raw.get("partnerCode"), raw.get("flowCode"), year)
        dataset = expected.get(year)
        if (dataset is None or raw.get("period") != str(year) or raw.get("typeCode") != "C" or raw.get("freqCode") != "A" or
            raw.get("reporterCode") != spec["reporter"] or raw.get("flowCode") not in ("M", "X") or
            raw.get("partnerCode") not in partners or raw.get("partner2Code") != 0 or raw.get("motCode") != 0 or
            raw.get("customsCode") != "C00" or raw.get("cmdCode") != "TOTAL" or raw.get("aggrLevel") != 0 or
            raw.get("classificationCode") != dataset["classificationCode"] or raw.get("isOriginalClassification") is not True or
            raw.get("classificationSearchCode") != dataset["classificationSearchCode"] or identity in seen):
            raise AcquisitionError("Comtrade mixed/duplicate/non-original trade dimensions")
        seen.add(identity)
        value = raw.get("primaryValue")
        if ("primaryValue" not in raw or (value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or
            not math.isfinite(value) or value < 0)) or not isinstance(raw.get("isReported"), bool)):
            raise AcquisitionError("Comtrade invalid native trade value/reporting flag")
        partner = partners[raw["partnerCode"]]
        result.append({"reporter": spec["reporter"], "partner": partner["code"], "year": year, "flow": raw["flowCode"],
                       "partnerKind": partner["kind"], "value": value, "rawValue": value,
                       "exclusionReason": "Value not supplied" if value is None else None,
                       "unit": "Current US dollars", "sourceHash": source_hash, "datasetCode": dataset["datasetCode"],
                       "classification": raw["classificationCode"], "attributes": raw})
    return result


def run_pass(downloader, store, run_id):
    with client(downloader):
        manifest = store.get(run_id, include_sources=False)
        if not manifest["report"].get("reporters"):
            downloader.request("GET", f"https://{HOST}/files/v1/app/reference/Reporters.json")
            reporters = catalog(downloader.last_data["results"])
            downloader.request("GET", f"https://{HOST}/files/v1/app/reference/partnerAreas.json")
            partners = catalog(downloader.last_data["results"], partner=True, reporters={r["code"]: r for r in reporters})
            if len(reporters) < 200 or len(partners) < 200:
                raise AcquisitionError("Comtrade global area metadata unexpectedly incomplete")
            store.initialize(run_id, reporters, partners)
        while True:
            task = store.next_task(run_id)
            if task is None:
                if store.plan_data(run_id):
                    continue
                downloader.check(completing=True)
                store.finish(run_id)
                return
            spec = task["spec"]
            downloader.check()
            report = store.get(run_id, include_sources=False)["report"]
            reporters = {r["code"]: r for r in report["reporters"]}
            partners = {r["code"]: r for r in report["partners"]}
            if task["kind"] == "discovery":
                codes = ",".join(str(code) for code, area in reporters.items() if not area["isGroup"])
                api.getFinalDataAvailability(AUTH_SENTINEL, "C", "A", "SS", str(spec["year"]), codes)
                datasets = availability(downloader.last_data["data"], spec["year"], reporters)
                downloader.check(completing=True)
                store.complete_task(run_id, task["key"], datasets=datasets)
                continue
            def refresh():
                api.getFinalDataAvailability(AUTH_SENTINEL, "C", "A", "SS", ",".join(map(str, spec["years"])), str(spec["reporter"]))
                result = []
                for year in spec["years"]:
                    result.extend(availability([r for r in downloader.last_data["data"] if r.get("period") == year], year, reporters))
                return result
            current = refresh()
            definition = lambda entries: sorted((d["period"], d["reporterCode"], d["classificationCode"], d["classificationSearchCode"]) for d in entries)
            if definition(current) != definition(spec["datasets"]):
                raise AcquisitionError("Comtrade original dataset definition changed since discovery; start a new acquisition")
            current_spec = spec | {"datasets": current}
            args = parameters(spec)
            api.getCountFinalData(AUTH_SENTINEL, **args)
            count = downloader.last_data["count"]
            if count >= MAX_RECORDS:
                raise AcquisitionError("Comtrade chunk reaches Basic record cap; explicit subdivision required")
            api.getFinalData(AUTH_SENTINEL, **args, maxRecords=MAX_RECORDS, format_output="JSON", includeDesc=True)
            if downloader.last_data["count"] != count:
                raise AcquisitionError("Comtrade count changed/truncated between count and data queries")
            rows = observations(downloader.last_data["data"], current_spec, partners, downloader.last_hash)
            refreshed = refresh()
            stable = lambda entries: sorted([(d["datasetCode"], d["datasetChecksum"], d["lastReleased"]) for d in entries])
            if stable(refreshed) != stable(current):
                raise AcquisitionError("Comtrade dataset changed during this chunk; incomplete chunk retained for explicit retry")
            downloader.check(completing=True)
            store.complete_task(run_id, task["key"], rows=rows, acquired=current,
                                revised=stable(current) != stable(spec["datasets"]))
