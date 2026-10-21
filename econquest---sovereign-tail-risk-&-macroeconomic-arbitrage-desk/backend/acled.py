"""Account-accessible ACLED core-event snapshots, separate from GDELT and models."""

import copy
import hashlib
import json
import logging
import math
import os
import re
import time
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
import requests
from acled.auth import AuthMethod
from acled.clients.acled_data_client import AcledDataClient
from acled.exceptions import ApiError

from .imf import AcquisitionError

CONTRACT = "acled-global-core-30d-v1"
BASE = "https://acleddata.com/api/acled/read"
TOKEN_URL = "https://acleddata.com/oauth/token"
PAGE_SIZE = 5000
MAX_REQUESTS = 100
MAX_ROWS = 200000
MAX_RESPONSE = 16 * 1024 * 1024
MAX_TOTAL = 128 * 1024 * 1024
SECONDS = 600
LIMITATION = (
    "ACLED researcher-coded political violence, demonstrations and strategic developments; not verified exhaustive incidents "
    "or sovereign-risk probabilities. Global is the requested scope, restricted to this account's entitlements and source coverage. "
    "Latest completed UTC days are event-date filters, not a promise that recent events have been reported; publication lags, "
    "backfills, revisions and deletions apply. Two matching reads check pagination consistency but are not a transactional vintage "
    "or independent corroboration. Native fatalities are reported estimates, including uncertain zeros, not audited deaths. "
    "Time/geography precision codes are retained; coordinates can be approximate. Native timestamp is a source update time, "
    "not article publication or historical availability. Snapshots are immutable full replacements, not incremental merges; "
    "deleted-event and CAST endpoints are not acquired. No GDELT deduplication, country-code guessing, risk scoring, alerts or model input. "
    "Private local use subject to ACLED account/EULA/content/attribution terms; no public redistribution implied."
)


def window():
    end = datetime.now(timezone.utc).date() - timedelta(days=1)
    return (end - timedelta(days=29)).isoformat(), end.isoformat()


def credentials():
    username, password = os.environ.get("ACLED_USERNAME", ""), os.environ.get("ACLED_PASSWORD", "")
    if (not username or len(username) > 320 or "@" not in username or any(c.isspace() for c in username) or
        not password or len(password) > 4096 or any(ord(c) < 32 or ord(c) == 127 for c in username + password)):
        raise AcquisitionError("Configure myACLED email/password privately in the backend; never enter credentials in chat or browser fields")
    return username, password


def configured():
    try:
        credentials()
        return True
    except AcquisitionError:
        return False


def integer(value, field, low=0, high=9007199254740991):
    if isinstance(value, bool) or not isinstance(value, (int, str)) or not re.fullmatch(r"\d+", str(value)):
        raise AcquisitionError(f"ACLED invalid {field}")
    result = int(value)
    if not low <= result <= high:
        raise AcquisitionError(f"ACLED {field} outside supported domain")
    return result


def event(raw, start, end, sha):
    if not isinstance(raw, dict) or not all(isinstance(k, str) and (v is None or type(v) in (str, int, float, bool)) for k, v in raw.items()):
        raise AcquisitionError("ACLED native event schema changed")
    for key in ("event_id_cnty", "event_date", "country", "event_type", "sub_event_type", "disorder_type", "source", "source_scale"):
        if not isinstance(raw.get(key), str) or not raw[key].strip():
            raise AcquisitionError(f"ACLED missing native {key}")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", raw["event_id_cnty"]):
        raise AcquisitionError("ACLED invalid event identifier")
    try:
        day = date.fromisoformat(raw["event_date"])
    except ValueError:
        raise AcquisitionError("ACLED invalid event date") from None
    if day.isoformat() != raw["event_date"] or not start <= day.isoformat() <= end or integer(raw.get("year"), "year") != day.year:
        raise AcquisitionError("ACLED event outside frozen date scope or inconsistent year")
    numeric = {}
    for key, low, high in (("time_precision", 1, 3), ("geo_precision", 1, 3), ("iso", 0, 999), ("fatalities", 0, 9007199254740991)):
        numeric[key] = None if raw.get(key) is None or raw.get(key) == "" else integer(raw[key], key, low, high)
    # Precision is required; silently treating missing precision as exact would misrepresent records.
    if numeric["time_precision"] is None or numeric["geo_precision"] is None:
        raise AcquisitionError("ACLED missing time/geography precision")
    for key, low, high in (("latitude", -90, 90), ("longitude", -180, 180)):
        value = raw.get(key)
        if value is None or value == "":
            numeric[key] = None
        else:
            if isinstance(value, bool) or not isinstance(value, (int, float, str)):
                raise AcquisitionError("ACLED invalid coordinates")
            try:
                number = float(value)
            except ValueError:
                raise AcquisitionError("ACLED invalid coordinates") from None
            if not math.isfinite(number) or not low <= number <= high:
                raise AcquisitionError("ACLED coordinates outside domain")
            numeric[key] = number
    updated = integer(raw.get("timestamp"), "timestamp", high=253402300799)
    try:
        updated_at = datetime.fromtimestamp(updated, timezone.utc).isoformat()
    except (ValueError, OverflowError, OSError):
        raise AcquisitionError("ACLED invalid update timestamp") from None
    return {"eventId": raw["event_id_cnty"], "eventDate": day.isoformat(), "country": raw["country"],
            "eventType": raw["event_type"], "subEventType": raw["sub_event_type"], "disorderType": raw["disorder_type"],
            "timePrecision": numeric["time_precision"], "geoPrecision": numeric["geo_precision"], "isoNumeric": numeric["iso"],
            "fatalities": numeric["fatalities"], "latitude": numeric["latitude"], "longitude": numeric["longitude"],
            "updatedAt": updated_at, "publishedAt": None, "sourceHash": sha, "attributes": copy.deepcopy(raw)}


def canonical(raw):
    return hashlib.sha256(json.dumps(raw, sort_keys=True, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode()).hexdigest()


class Downloader:
    def __init__(self, stop, save, progress, start, end):
        self.stop, self.save, self.progress = stop, save, progress
        self.start, self.end = start, end
        self.deadline, self.count, self.total, self.last = time.monotonic() + SECONDS, 0, 0, 0.0
        self.secrets = list(credentials())
        self.token = None
        self.expires = 0
        self.last_rows = []
        self.last_total = None
        self.last_hash = None
        self.response_hash = None

    def check(self):
        if self.stop.is_set() or time.monotonic() >= self.deadline:
            raise AcquisitionError("ACLED cancelled or exceeded 600-second deadline; incomplete snapshot cannot activate")

    def request(self, method, url, *, params=None, data=None, token=False):
        self.check()
        self.stop.wait(max(0, 0.5 - (time.monotonic() - self.last)))
        self.check()
        self.count += 1
        if self.count > MAX_REQUESTS:
            raise AcquisitionError("ACLED request budget exceeded")
        self.last = time.monotonic()
        content, status, saved = bytearray(), 0, False
        path = url + ("?" + urlencode(params) if params else "")
        try:
            headers = {"Accept-Encoding": "identity", "Accept": "application/json"}
            if not token:
                if self.token is None or time.monotonic() >= self.expires:
                    raise AcquisitionError("ACLED OAuth token unavailable/expired; no automatic credential retry")
                headers["Authorization"] = "Bearer " + self.token
            with httpx.stream(method, url, params=params, data=data, headers=headers, timeout=30,
                              follow_redirects=False, trust_env=False) as response:
                status = response.status_code
                cap = 65536 if token else MAX_RESPONSE
                for chunk in response.iter_raw(65536):
                    remaining = min(cap - len(content), MAX_TOTAL - self.total)
                    content.extend(chunk[:max(0, remaining)])
                    self.total += len(chunk)
                    if len(chunk) > remaining:
                        raise AcquisitionError("ACLED response/acquisition byte budget exceeded")
                    self.check()
                if token:
                    # Neither successful token bodies nor authentication failure bodies are persisted.
                    if status != 200:
                        raise AcquisitionError(f"ACLED OAuth HTTP {status}; check account/API access; credentials and response not retained")
                else:
                    if any(secret.encode() in content for secret in self.secrets):
                        raise AcquisitionError("ACLED response echoed credential/token; original withheld")
                    self.save(path, status, bytes(content))
                    self.response_hash = hashlib.sha256(content).hexdigest()
                    saved = True
                    if status != 200:
                        raise AcquisitionError(f"ACLED HTTP {status}; no retries/fallback; account access or quota may limit acquisition")
                length = response.headers.get("Content-Length")
                if length is not None and (not re.fullmatch(r"\d+", length) or int(length) != len(content)):
                    raise AcquisitionError("ACLED truncated/invalid response length")
                if response.headers.get("Content-Encoding", "identity") not in ("identity", ""):
                    raise AcquisitionError("ACLED unexpected HTTP encoding")
            try:
                result = json.loads(content, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
            except (ValueError, UnicodeError):
                raise AcquisitionError("ACLED invalid JSON response") from None
            if not isinstance(result, dict):
                raise AcquisitionError("ACLED invalid response envelope")
            self.progress({"requests": self.count, "bytes": self.total})
            return result
        except (httpx.HTTPError, AcquisitionError) as exc:
            if not token and content and not saved and not any(s.encode() in content for s in self.secrets):
                self.save(path + "#incomplete-response", status, bytes(content))
            if isinstance(exc, AcquisitionError):
                raise
            raise AcquisitionError(f"ACLED transport failed ({type(exc).__name__}); no automatic retry") from None

    def authenticate(self):
        username, password = credentials()
        result = self.request("POST", TOKEN_URL, data={"username": username, "password": password, "grant_type": "password",
                                                      "client_id": "acled", "scope": "authenticated"}, token=True)
        token = result.get("access_token")
        if (not isinstance(result.get("token_type"), str) or result["token_type"].lower() != "bearer" or not isinstance(token, str) or
            not re.fullmatch(r"[A-Za-z0-9._~+/-]+=*", token) or len(token) > 16384):
            raise AcquisitionError("ACLED invalid OAuth token contract; nothing persisted")
        duration = integer(result.get("expires_in"), "token expiry", 1)
        self.token, self.expires = token, time.monotonic() + duration - 30
        self.secrets.extend(v for v in (token, result.get("refresh_token")) if isinstance(v, str) and v)

    def page(self, params):
        data = self.request("GET", BASE, params=params)
        rows = data.get("data")
        if data.get("success") is not True or not isinstance(rows, list):
            raise AcquisitionError("ACLED unsuccessful/malformed data response; provider messages are not logged")
        count = integer(data.get("count"), "page count")
        total = integer(data.get("total_count"), "total count", high=MAX_ROWS)
        if count != len(rows) or len(rows) > PAGE_SIZE or count > total:
            raise AcquisitionError("ACLED page count or total exceeds scope/budget")
        # Validate native cells before the package could coerce or truncate values.
        sha = canonical(data)
        for row in rows:
            event(row, self.start, self.end, sha)
        self.last_rows, self.last_total = copy.deepcopy(rows), total
        self.last_hash = self.response_hash
        return data


class _MemoryAuth(AuthMethod):
    def authenticate(self, session, params):
        return params

    def refresh_if_needed(self, session):
        return None

    def force_refresh(self, session):
        raise AcquisitionError("ACLED rejected access; automatic refresh/fallback disabled")

    def is_authenticated(self):
        return True


class _NativeClient(AcledDataClient):
    def _parse_event(self, event_data):
        # Pinned package otherwise converts dates/numbers in place, losing native types.
        return event_data


class _BoundedSession(requests.Session):
    def __init__(self, downloader):
        super().__init__()
        self.downloader = downloader
        self.failure = None

    def get(self, url, **kwargs):
        params = kwargs.get("params")
        if url != BASE or not isinstance(params, dict) or set(params) != {"event_date", "event_date_where", "limit", "page", "_format", "export_type", "with_total"}:
            raise AcquisitionError("ACLED package request outside fixed core-event route/scope")
        page = integer(params["page"], "page", 1, MAX_REQUESTS)
        expected = {"event_date": self.downloader.start + "|" + self.downloader.end, "event_date_where": "BETWEEN",
                    "limit": str(PAGE_SIZE), "page": str(page), "_format": "json", "export_type": "dyadic", "with_total": "true"}
        if params != expected:
            raise AcquisitionError("ACLED library changed the frozen acquisition query")
        try:
            data = self.downloader.page(params)
        except AcquisitionError as exc:
            self.failure = exc
            raise
        response = requests.Response()
        response.status_code = 200
        response._content = json.dumps(data, allow_nan=False).encode()
        return response


def acquire(downloader, storage, run_id):
    downloader.authenticate()
    with _BoundedSession(downloader) as session:
        client = _NativeClient(auth_method=_MemoryAuth(), session=session)
        client.BASE_URL, client.MAX_RETRIES = "https://acleddata.com/api", 0
        client.log = logging.Logger("acled-bounded-library", level=logging.CRITICAL + 1)
        fingerprints = []
        expected_total = None
        for phase in ("capture", "verify"):
            seen = {}
            page = 1
            while True:
                downloader.check()
                try:
                    rows = client.get_data(event_date=downloader.start + "|" + downloader.end, limit=PAGE_SIZE, page=page,
                                           export_type="dyadic", query_params={"event_date_where": "BETWEEN", "with_total": "true"})
                except ApiError:
                    if session.failure is not None:
                        raise session.failure from None
                    raise AcquisitionError("ACLED package rejected response; pinned package contract requires review") from None
                if rows != downloader.last_rows:
                    raise AcquisitionError("ACLED package transformed or omitted native fields")
                total = downloader.last_total
                if expected_total is None:
                    expected_total = total
                if total != expected_total:
                    raise AcquisitionError("ACLED total changed during paginated acquisition; start a new snapshot")
                if len(rows) != min(PAGE_SIZE, max(0, total - len(seen))):
                    raise AcquisitionError("ACLED page boundaries incomplete or ignored by provider")
                for raw in rows:
                    identifier = raw["event_id_cnty"]
                    if identifier in seen:
                        raise AcquisitionError("ACLED duplicate event ID/page drift; no silent deduplication")
                    seen[identifier] = canonical(raw)
                if phase == "capture":
                    storage.chunk(run_id, page, [event(r, downloader.start, downloader.end, downloader.last_hash) for r in rows])
                downloader.progress({"phase": phase, "page": page, "rowsRead": len(seen), "expectedRows": total})
                if len(seen) == total:
                    break
                page += 1
            fingerprints.append(seen)
        if fingerprints[0] != fingerprints[1]:
            raise AcquisitionError("ACLED event records revised between verification reads; snapshot not staged")
        downloader.check()
        storage.finish(run_id, expected_total)
