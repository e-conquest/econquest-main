"""Manual native-frequency FRED history and date-bounded ALFRED snapshots."""

import hashlib
import http.client
import json
import math
import os
import re
import time
from contextlib import closing
from datetime import date, datetime
from threading import Event
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from .imf import AcquisitionError, now_iso

HOST = "api.stlouisfed.org"
MIN_DATE = "1776-07-04"
CONTRACT = "fred-alfred-native-asof-v1"
SERIES = {
    **{f"DGS{tenor}": {"name": f"{tenor}-year Treasury constant maturity yield", "frequency": "D"} for tenor in (1, 2, 3, 5, 7, 10, 20, 30)},
    "SOFR": {"name": "Secured Overnight Financing Rate", "frequency": "D"},
    "EFFR": {"name": "Effective Federal Funds Rate", "frequency": "D"},
    "DTWEXBGS": {"name": "Nominal Broad US Dollar Index (not ICE DXY)", "frequency": "D"},
    "VIXCLS": {"name": "CBOE VIX closing index", "frequency": "D"},
    "DCOILBRENTEU": {"name": "Brent crude spot price", "frequency": "D"},
    "PCOPPUSDM": {"name": "Global copper price", "frequency": "M"},
    "PWHEAMTUSDM": {"name": "Global wheat price", "frequency": "M"},
    "GDP": {"name": "Nominal US GDP (not real GDP)", "frequency": "Q"},
    "CPIAUCSL": {"name": "US all-items CPI, seasonally adjusted", "frequency": "M"},
    "UNRATE": {"name": "US unemployment rate", "frequency": "M"},
}
MAX_RESPONSE = 16 * 1024 * 1024
MAX_TOTAL = 128 * 1024 * 1024
MAX_REQUESTS = 200
MAX_ROWS = 1_000_000
DEADLINE = 600


def today():
    return datetime.now(ZoneInfo("America/Chicago")).date().isoformat()


def valid_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise AcquisitionError("FRED date must use YYYY-MM-DD")
    try:
        date.fromisoformat(value)
    except ValueError:
        raise AcquisitionError("FRED invalid calendar date") from None
    return value


def api_key():
    value = os.environ.get("FRED_API_KEY", "")
    if not re.fullmatch(r"[a-z0-9]{32}", value):
        raise AcquisitionError("Set a valid FRED_API_KEY in the backend process environment; never send it through the browser or chat")
    return value


def configured():
    return bool(re.fullmatch(r"[a-z0-9]{32}", os.environ.get("FRED_API_KEY", "")))


class Downloader:
    def __init__(self, stop: Event, save, progress):
        self._key = api_key()
        self.stop, self.save, self.progress = stop, save, progress
        self.deadline = time.monotonic() + DEADLINE
        self.next_request = 0.0
        self.count = self.total = 0
        self.last_hash = ""

    def check(self):
        if self.stop.is_set() or time.monotonic() >= self.deadline:
            raise AcquisitionError("FRED acquisition cancelled or exceeded 600-second deadline")

    def get(self, endpoint, params):
        if endpoint not in ("series", "series/observations", "series/vintagedates") or params.get("series_id") not in SERIES:
            raise AcquisitionError("FRED request outside fixed reviewed basket")
        if set(params) - {"series_id", "realtime_start", "realtime_end", "observation_start", "observation_end",
                          "units", "output_type", "sort_order", "limit", "offset"}:
            raise AcquisitionError("FRED request has unsupported parameters")
        self.check()
        wait = max(0.0, self.next_request - time.monotonic())
        if self.stop.wait(wait):
            self.check()
        self.check()
        self.next_request = time.monotonic() + 0.6
        self.count += 1
        if self.count > MAX_REQUESTS:
            raise AcquisitionError("FRED request budget exceeded; no silent truncation")
        safe_params = {"file_type": "json", **params}
        safe_path = f"/fred/{endpoint}?{urlencode(safe_params)}"
        request_path = f"{safe_path}&api_key={self._key}"
        content, saved, status = bytearray(), False, 0
        try:
            # http.client does not emit request URLs through httpx/urllib loggers.
            with closing(http.client.HTTPSConnection(HOST, timeout=20)) as connection:
                connection.request("GET", request_path, headers={"Accept": "application/json", "Accept-Encoding": "identity"})
                with closing(connection.getresponse()) as response:
                    status = response.status
                    encoding = response.getheader("Content-Encoding", "identity")
                    length = response.getheader("Content-Length")
                    if length is not None and not re.fullmatch(r"\d+", length):
                        raise AcquisitionError("FRED invalid HTTP content length")
                    while True:
                        chunk = response.read(65536)
                        if not chunk:
                            break
                        remaining = min(MAX_RESPONSE - len(content), MAX_TOTAL - self.total)
                        content.extend(chunk[:max(0, remaining)])
                        self.total += len(chunk)
                        if len(chunk) > remaining:
                            raise AcquisitionError("FRED response or total byte budget exceeded")
                        self.check()
                    if length is not None and len(content) != int(length):
                        raise AcquisitionError("FRED truncated HTTP response")
                    if self._key.encode() in content:
                        raise AcquisitionError("FRED response contained a credential; response capture omitted for safety")
                    self.save(safe_path, status, bytes(content))
                    saved = True
                    if status != 200:
                        raise AcquisitionError(f"FRED HTTP {status}; check credentials, permissions or rate limits. No retry or fallback.")
                    if encoding not in ("identity", ""):
                        raise AcquisitionError("FRED unexpected content encoding")
                    try:
                        data = json.loads(content)
                    except (ValueError, UnicodeError):
                        raise AcquisitionError("FRED returned invalid JSON") from None
                    if not isinstance(data, dict) or "error_code" in data or "error_message" in data:
                        raise AcquisitionError("FRED API error envelope or invalid response shape")
                    self.last_hash = hashlib.sha256(content).hexdigest()
                    self.progress({"requests": self.count, "bytes": self.total, "lastHttpStatus": status})
                    return data
        except (OSError, http.client.HTTPException, AcquisitionError) as exc:
            if content and not saved and self._key.encode() not in content:
                self.save(safe_path + "#incomplete-response", status, bytes(content))
            if isinstance(exc, AcquisitionError):
                raise
            raise AcquisitionError(f"FRED transport failed ({type(exc).__name__}); active snapshots unchanged") from None


def _bounds(data, as_of):
    if data.get("realtime_start") != as_of or data.get("realtime_end") != as_of:
        raise AcquisitionError("FRED response real-time bounds do not match the requested as-of date")


def metadata(get, code, as_of):
    result = get("series", {"series_id": code, "realtime_start": as_of, "realtime_end": as_of})
    _bounds(result, as_of)
    entries = result.get("seriess")
    if not isinstance(entries, list) or len(entries) != 1 or not isinstance(entries[0], dict):
        raise AcquisitionError(f"FRED {code}: missing/ambiguous series metadata")
    entry = entries[0]
    _bounds(entry, as_of)
    if entry.get("id") != code or entry.get("frequency_short") != SERIES[code]["frequency"]:
        raise AcquisitionError(f"FRED {code}: identity/native frequency changed; contract review required")
    for key in ("title", "frequency", "units", "units_short", "seasonal_adjustment", "seasonal_adjustment_short", "last_updated"):
        if not isinstance(entry.get(key), str) or not entry[key].strip():
            raise AcquisitionError(f"FRED {code}: missing native definition/units/adjustment metadata")
    if "notes" in entry and not isinstance(entry["notes"], str):
        raise AcquisitionError(f"FRED {code}: invalid source notes")
    valid_date(entry.get("observation_start"))
    valid_date(entry.get("observation_end"))
    if entry["observation_start"] > entry["observation_end"]:
        raise AcquisitionError(f"FRED {code}: inverted observation window")
    return entry


def pages(downloader, endpoint, params, field, limit):
    offset, total, identity = 0, None, None
    while True:
        downloader.check()
        response = downloader.get(endpoint, {**params, "limit": limit, "offset": offset})
        if any(isinstance(response.get(k), bool) or not isinstance(response.get(k), int) or response[k] < 0 for k in ("count", "offset", "limit")):
            raise AcquisitionError("FRED invalid pagination fields")
        if response["offset"] != offset or response["limit"] != limit or response["count"] > MAX_ROWS:
            raise AcquisitionError("FRED inconsistent pagination or row budget exceeded")
        rows = response.get(field)
        if not isinstance(rows, list) or len(rows) != min(limit, max(0, response["count"] - offset)):
            raise AcquisitionError("FRED truncated or invalid page")
        page_identity = {key: response.get(key) for key in ("realtime_start", "realtime_end", "observation_start", "observation_end", "units", "output_type", "order_by", "sort_order")}
        if total is not None and (total != response["count"] or page_identity != identity):
            raise AcquisitionError("FRED pagination definition/count changed during acquisition")
        total, identity = response["count"], page_identity
        yield response, rows, downloader.last_hash
        offset += len(rows)
        if offset >= total:
            return


def acquire(downloader: Downloader, mode, as_of, progress):
    current = today()
    valid_date(as_of)
    if mode not in ("current", "historical") or not MIN_DATE <= as_of <= current or (mode == "current" and as_of != current):
        raise AcquisitionError("FRED invalid mode/as-of date; future dates and silently rolled dates are not allowed")
    records, series = [], []
    for code, definition in SERIES.items():
        downloader.check()
        current_meta = metadata(downloader.get, code, current)
        current_hash = downloader.last_hash
        vintages, vintage_hashes = [], []
        for response, dates, source_hash in pages(downloader, "series/vintagedates",
                {"series_id": code, "realtime_start": MIN_DATE, "realtime_end": current, "sort_order": "asc"}, "vintage_dates", 10000):
            if response.get("realtime_start") != MIN_DATE or response.get("realtime_end") != current or response.get("sort_order") != "asc":
                raise AcquisitionError(f"FRED {code}: invalid vintage-list request echo")
            for vintage in dates:
                valid_date(vintage)
                if not MIN_DATE <= vintage <= current or (vintages and vintage <= vintages[-1]):
                    raise AcquisitionError(f"FRED {code}: duplicate/unsorted/future vintage dates")
                vintages.append(vintage)
            vintage_hashes.append(source_hash)
        eligible = [v for v in vintages if v <= as_of]
        info = {"id": code, "name": definition["name"], "metadata": current_meta, "metadataAsOf": current,
                "metadataSourceHash": current_hash, "vintageSourceHashes": vintage_hashes,
                "vintageDates": vintages, "firstArchivedVintage": vintages[0] if vintages else None,
                "latestEligibleVintage": eligible[-1] if eligible else None,
                "status": "unavailable", "reason": "", "validCount": 0, "missingCount": 0,
                "firstObservation": None, "lastObservation": None, "latestValidObservation": None,
                "analysisBlocked": True}
        if mode == "historical" and not eligible:
            info["reason"] = "No captured ALFRED vintage on or before the requested date; current metadata is reference only, not historical metadata."
            series.append(info)
            progress({"seriesId": code, "seriesProcessed": len(series), "observations": len(records)})
            continue
        if mode == "historical":
            info["metadata"] = metadata(downloader.get, code, as_of)
            info["metadataSourceHash"], info["metadataAsOf"] = downloader.last_hash, as_of
        observations, seen = [], set()
        params = {"series_id": code, "realtime_start": as_of, "realtime_end": as_of, "observation_start": MIN_DATE,
                  "observation_end": as_of, "units": "lin", "output_type": 1, "sort_order": "asc"}
        for response, rows, source_hash in pages(downloader, "series/observations", params, "observations", 10000):
            _bounds(response, as_of)
            if (response.get("units") != "lin" or response.get("output_type") != 1 or response.get("sort_order") != "asc" or
                response.get("observation_start") != MIN_DATE or response.get("observation_end") != as_of):
                raise AcquisitionError(f"FRED {code}: transformed/truncated observation query")
            for row in rows:
                if not isinstance(row, dict):
                    raise AcquisitionError(f"FRED {code}: invalid observation")
                observed = valid_date(row.get("date"))
                if not MIN_DATE <= observed <= as_of or observed in seen or (observations and observed <= observations[-1]["date"]):
                    raise AcquisitionError(f"FRED {code}: duplicate/unsorted/future observation")
                seen.add(observed)
                _bounds(row, as_of)
                raw = row.get("value")
                if raw == ".":
                    value = None
                elif isinstance(raw, str) and re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?", raw):
                    value = float(raw)
                    if not math.isfinite(value):
                        raise AcquisitionError(f"FRED {code}: non-finite native observation")
                else:
                    raise AcquisitionError(f"FRED {code}: unsupported missing/numeric value")
                observations.append({"seriesId": code, "date": observed, "value": value, "rawValue": raw,
                                     "realtimeStart": row["realtime_start"], "realtimeEnd": row["realtime_end"], "sourceHash": source_hash})
                if len(records) + len(observations) > MAX_ROWS:
                    raise AcquisitionError("FRED total observation budget exceeded")
        valid = [r for r in observations if r["value"] is not None]
        info.update({"status": "available" if valid else "unavailable", "validCount": len(valid),
                     "missingCount": len(observations) - len(valid),
                     "firstObservation": observations[0]["date"] if observations else None,
                     "lastObservation": observations[-1]["date"] if observations else None,
                     "latestValidObservation": valid[-1]["date"] if valid else None,
                     "analysisBlocked": not valid or len(valid) != len(observations),
                     "reason": "" if valid else "No numeric values in the requested snapshot; no current-vintage fallback."})
        if mode == "current":
            check = metadata(downloader.get, code, as_of)
            if check != current_meta:
                raise AcquisitionError(f"FRED {code}: metadata changed during acquisition; retry manually")
        records.extend(observations)
        series.append(info)
        progress({"seriesId": code, "seriesProcessed": len(series), "observations": len(records)})
    downloader.check()
    if not any(s["validCount"] for s in series):
        raise AcquisitionError("FRED/ALFRED snapshot has no numeric history; selected vintage unavailable, no fallback")
    return {"records": records, "series": series, "report": {
        "errors": [], "contractVersion": CONTRACT, "mode": mode, "asOf": as_of, "retrievedAt": now_iso(),
        "rowCount": len(records), "seriesCount": len(series), "availableSeries": sum(s["validCount"] > 0 for s in series),
        "numericCount": sum(s["validCount"] for s in series), "missingCount": sum(s["missingCount"] for s in series),
        "unavailableSeries": [s["id"] for s in series if not s["validCount"]], "transportComplete": True,
        "valueConvention": "Native frequency, units and seasonal adjustment. units=lin, output_type=1; no resampling, scaling, currency conversion or derived indicators.",
        "vintagePolicy": "Explicit daily real-time bounds select provider-reported as-of history. Bounds are query-clipped, not per-observation release timestamps or intraday availability. ALFRED coverage is limited to its actual archive.",
        "coveragePolicy": "Explicit missing dots and unavailable vintages disclosed, never filled or replaced by current data. No inferred daily calendar or full-period completeness claim.",
        "limitation": "Monitoring only. No fitted-model, training, default-label or trading-signal changes. Historical snapshots are separate from current selections. Latest metadata does not prove a release schedule or current freshness; archive revision capture is not guaranteed complete.",
    }}
