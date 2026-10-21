"""Complete-day GDELT 2.0 events; native machine-coded records, not verified incidents."""

import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Event
from urllib.parse import urlsplit

import httpx

from .imf import AcquisitionError

CONTRACT = "gdelt2-global-events-day-v1"
BASE = "https://data.gdeltproject.org/gdeltv2/"
MAX_RESPONSE = 8 * 1024 * 1024
MAX_TOTAL = 128 * 1024 * 1024
MAX_ROWS = 500000
JOB_SECONDS = 600
COLUMNS = """GLOBALEVENTID SQLDATE MonthYear Year FractionDate Actor1Code Actor1Name Actor1CountryCode
Actor1KnownGroupCode Actor1EthnicCode Actor1Religion1Code Actor1Religion2Code Actor1Type1Code Actor1Type2Code Actor1Type3Code
Actor2Code Actor2Name Actor2CountryCode Actor2KnownGroupCode Actor2EthnicCode Actor2Religion1Code Actor2Religion2Code
Actor2Type1Code Actor2Type2Code Actor2Type3Code IsRootEvent EventCode EventBaseCode EventRootCode QuadClass GoldsteinScale
NumMentions NumSources NumArticles AvgTone Actor1Geo_Type Actor1Geo_FullName Actor1Geo_CountryCode Actor1Geo_ADM1Code
Actor1Geo_ADM2Code Actor1Geo_Lat Actor1Geo_Long Actor1Geo_FeatureID Actor2Geo_Type Actor2Geo_FullName Actor2Geo_CountryCode
Actor2Geo_ADM1Code Actor2Geo_ADM2Code Actor2Geo_Lat Actor2Geo_Long Actor2Geo_FeatureID ActionGeo_Type ActionGeo_FullName
ActionGeo_CountryCode ActionGeo_ADM1Code ActionGeo_ADM2Code ActionGeo_Lat ActionGeo_Long ActionGeo_FeatureID DATEADDED SOURCEURL""".split()
LIMITATION = ("GDELT machine-coded news events are not independently verified incidents or sovereign-default signals. "
              "Global means all records in the 96 requested export intervals, not exhaustive real-world/media coverage. "
              "Coverage and language/media biases, repeated stories and extraction errors apply; IDs are source identifiers, not unique incidents. "
              "SQLDATE is a coded event date and may predate this export day; DATEADDED is source database ingestion, "
              "not article publication time. Article publication time is unknown. Source links are references, not fetched article text. "
              "ActionGeo country codes are GDELT geography/FIPS-style codes, not ISO2; actor country codes are separate CAMEO codes. "
              "No inferred country mapping, missing-value fill, sentiment-to-risk conversion, country score, scheduler or fitted-model input.")


def latest_day():
    return (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()


def intervals(day):
    start = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return [(start + timedelta(minutes=15 * i)).strftime("%Y%m%d%H%M%S") for i in range(96)]


def safe_url(value):
    try:
        parsed = urlsplit(value)
        return (parsed.scheme in ("http", "https") and bool(parsed.hostname) and parsed.username is None and parsed.password is None and
                not any(ord(c) < 33 or ord(c) == 127 for c in value) and len(value) <= 8192)
    except ValueError:
        return False


def timestamp(value, pattern):
    try:
        parsed = datetime.strptime(value, pattern)
        if parsed.strftime(pattern) != value:
            raise ValueError()
        return parsed
    except (ValueError, TypeError):
        raise AcquisitionError("GDELT invalid source date") from None


def record(cells, interval, source_hash):
    if len(cells) != len(COLUMNS) or not all(isinstance(c, str) for c in cells):
        raise AcquisitionError("GDELT event schema changed")
    raw = dict(zip(COLUMNS, cells))
    if (not re.fullmatch(r"[1-9]\d{0,19}", raw["GLOBALEVENTID"]) or raw["DATEADDED"] != interval or
        not re.fullmatch(r"\d{2,4}", raw["EventCode"]) or not re.fullmatch(r"\d{2,3}", raw["EventBaseCode"]) or
        not re.fullmatch(r"\d{2}", raw["EventRootCode"]) or not raw["EventCode"].startswith(raw["EventBaseCode"]) or
        not raw["EventBaseCode"].startswith(raw["EventRootCode"]) or not 1 <= int(raw["EventRootCode"]) <= 20 or
        raw["QuadClass"] not in ("1", "2", "3", "4") or raw["IsRootEvent"] not in ("0", "1")):
        raise AcquisitionError("GDELT invalid event identity/code/interval")
    day = timestamp(raw["SQLDATE"], "%Y%m%d")
    if day > timestamp(interval[:8], "%Y%m%d") or raw["MonthYear"] != raw["SQLDATE"][:6] or raw["Year"] != raw["SQLDATE"][:4]:
        raise AcquisitionError("GDELT event date dimensions inconsistent")
    for field in ("Actor1CountryCode", "Actor2CountryCode"):
        if raw[field] and not re.fullmatch("[A-Z]{3}", raw[field]):
            raise AcquisitionError("GDELT invalid CAMEO actor country code")
    for field in ("Actor1Geo_CountryCode", "Actor2Geo_CountryCode", "ActionGeo_CountryCode"):
        if raw[field] and not re.fullmatch("[A-Z0-9]{2}", raw[field]):
            raise AcquisitionError("GDELT invalid native geography country code")
    numeric = {}
    for field in ("NumMentions", "NumSources", "NumArticles"):
        if not re.fullmatch(r"\d+", raw[field]):
            raise AcquisitionError("GDELT invalid mention/source/article count")
        numeric[field] = int(raw[field])
    for field, low, high in (("GoldsteinScale", -10, 10), ("AvgTone", -100, 100),
                             ("ActionGeo_Lat", -90, 90), ("ActionGeo_Long", -180, 180)):
        value = raw[field]
        if value == "" and field.startswith("ActionGeo"):
            numeric[field] = None
            continue
        try:
            parsed = float(value)
        except ValueError:
            raise AcquisitionError("GDELT invalid numeric source field") from None
        if not math.isfinite(parsed) or not low <= parsed <= high:
            raise AcquisitionError("GDELT numeric source field outside domain")
        numeric[field] = parsed
    if raw["ActionGeo_Type"] not in ("0", "1", "2", "3", "4", "5"):
        raise AcquisitionError("GDELT invalid action geography type")
    url = raw["SOURCEURL"]
    return {"eventId": raw["GLOBALEVENTID"], "eventDate": day.strftime("%Y-%m-%d"), "interval": interval,
            "dateAdded": timestamp(raw["DATEADDED"], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc).isoformat(),
            "country": raw["ActionGeo_CountryCode"] or None, "actor1Country": raw["Actor1CountryCode"] or None,
            "actor2Country": raw["Actor2CountryCode"] or None, "eventCode": raw["EventCode"],
            "eventRootCode": raw["EventRootCode"], "quadClass": int(raw["QuadClass"]),
            "goldstein": numeric["GoldsteinScale"], "tone": numeric["AvgTone"],
            "mentions": numeric["NumMentions"], "sources": numeric["NumSources"], "articles": numeric["NumArticles"],
            "latitude": numeric["ActionGeo_Lat"], "longitude": numeric["ActionGeo_Long"],
            "sourceUrl": url or None, "sourceUrlSafe": safe_url(url), "publishedAt": None,
            "sourceHash": source_hash, "attributes": raw}


def decode(content):
    allowed = ("PATH", "SYSTEMROOT", "LANG", "LC_ALL", "TMPDIR")
    environment = {key: os.environ[key] for key in allowed if key in os.environ}
    environment["PYTHONNOUSERSITE"] = "1"
    try:
        result = subprocess.run([sys.executable, "-m", "backend.gdelt_worker"], input=content, capture_output=True,
                                timeout=20, cwd=Path(__file__).resolve().parent.parent, env=environment, check=False)
    except subprocess.TimeoutExpired:
        raise AcquisitionError("GDELT package decoding exceeded 20-second subprocess limit") from None
    try:
        data = json.loads(result.stdout)
    except (ValueError, UnicodeError):
        raise AcquisitionError("GDELT package returned invalid decoder output") from None
    if result.returncode != 0 or not isinstance(data, dict) or not isinstance(data.get("rows"), list):
        raise AcquisitionError("GDELT strict package decoding failed; no malformed rows were skipped")
    return data["rows"]


class Downloader:
    def __init__(self, stop: Event, save, progress):
        self.stop, self.save, self.progress = stop, save, progress
        self.deadline, self.total, self.count, self.last_start = time.monotonic() + JOB_SECONDS, 0, 0, 0.0

    def check(self):
        if self.stop.is_set() or time.monotonic() >= self.deadline:
            raise AcquisitionError("GDELT cancelled or exceeded 600-second acquisition deadline; day incomplete")

    def get(self, interval):
        self.check()
        timestamp(interval, "%Y%m%d%H%M%S")
        if interval[10:] not in ("0000", "1500", "3000", "4500"):
            raise AcquisitionError("GDELT request outside quarter-hour export scope")
        path = BASE + interval + ".export.CSV.zip"
        self.stop.wait(max(0.0, 0.4 - (time.monotonic() - self.last_start)))
        self.check()
        self.count += 1
        if self.count > 96:
            raise AcquisitionError("GDELT 96-request budget exceeded")
        self.last_start = time.monotonic()
        content, saved, status = bytearray(), False, 0
        try:
            with httpx.stream("GET", path, timeout=20, follow_redirects=False,
                              headers={"Accept-Encoding": "identity"}) as response:
                status = response.status_code
                length = response.headers.get("Content-Length")
                if length is not None and not re.fullmatch(r"\d+", length):
                    raise AcquisitionError("GDELT invalid HTTP content length")
                for chunk in response.iter_raw(chunk_size=65536):
                    remaining = min(MAX_RESPONSE - len(content), MAX_TOTAL - self.total)
                    content.extend(chunk[:max(0, remaining)])
                    self.total += len(chunk)
                    if len(chunk) > remaining:
                        raise AcquisitionError("GDELT response/day byte limit exceeded")
                    self.check()
                self.save(path, status, bytes(content))
                saved = True
                if status != 200:
                    raise AcquisitionError(f"GDELT HTTP {status}; no retry or fallback; incomplete day cannot activate")
                if length is not None and len(content) != int(length):
                    raise AcquisitionError("GDELT truncated HTTP archive")
                if response.headers.get("Content-Encoding", "identity") not in ("identity", ""):
                    raise AcquisitionError("GDELT unexpected HTTP encoding")
                self.progress({"requests": self.count, "bytes": self.total, "lastInterval": interval})
                return bytes(content)
        except (httpx.HTTPError, AcquisitionError) as exc:
            if content and not saved:
                self.save(path + "#incomplete-response", status, bytes(content))
            if isinstance(exc, AcquisitionError):
                raise
            raise AcquisitionError(f"GDELT transport failed ({type(exc).__name__}); no automatic retry") from None


def acquire(downloader, storage, run_id, day):
    for interval in intervals(day):
        downloader.check()
        content = downloader.get(interval)
        sha = hashlib.sha256(content).hexdigest()
        cells = decode(content)
        rows = [record(row, interval, sha) for row in cells]
        downloader.check()
        storage.chunk(run_id, interval, rows)
    downloader.check()
    storage.finish(run_id)
