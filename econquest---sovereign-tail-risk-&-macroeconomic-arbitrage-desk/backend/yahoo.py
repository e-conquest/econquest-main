"""Fixed-scope Yahoo ETF history; no prices are inferred, filled or repaired."""

import json
import math
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import exchange_calendars as calendars
from exchange_calendars.exchange_calendar import ExchangeCalendar
import pandas as pd

from .models import Observation

SYMBOLS = {
    "EMB": "iShares J.P. Morgan USD Emerging Markets Bond ETF",
    "PCY": "Invesco Emerging Markets Sovereign Debt ETF",
    "ECH": "iShares MSCI Chile ETF",
    "TUR": "iShares MSCI Turkey ETF",
}
SOURCE = "Yahoo Finance via yfinance: five-year daily ETF Close"
UNIT = "USD per ETF share (Yahoo Close; auto_adjust=False)"
VERSION = "yahoo-etf-close-v1"
SETTINGS = {
    "interval": "1d", "auto_adjust": False, "back_adjust": False,
    "repair": False, "actions": True, "keepna": True, "rounding": False,
    "prepost": False, "timeout": 10,
}
EXCHANGES = {"NGM", "NMS", "NCM", "PCX", "BTS", "NYQ", "ASE"}
PUBLIC_METADATA = (
    "symbol", "instrumentType", "currency", "exchangeName", "exchangeTimezoneName",
    "longName", "shortName", "dataGranularity",
)


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def session_window(now: datetime) -> tuple[pd.DatetimeIndex, ExchangeCalendar]:
    if now.tzinfo is None:
        raise ValueError("Acquisition clock requires timezone")
    local = now.astimezone(ZoneInfo("America/New_York"))
    start = pd.Timestamp(local.date()) - pd.DateOffset(years=5)
    calendar = calendars.get_calendar("XNYS", start=start - pd.Timedelta(days=7), end=pd.Timestamp(local.date()) + pd.Timedelta(days=7))
    candidates = calendar.sessions_in_range(start, local.date())
    # Wait 30 minutes after the actual session close, including early-close days.
    completed = pd.DatetimeIndex([day for day in candidates if calendar.session_close(day).to_pydatetime() + timedelta(minutes=30) <= now])
    if len(completed) < 1000:
        raise ValueError("Five-year session calendar is incomplete")
    return completed, calendar


def session_policy(now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    local_date = now.astimezone(ZoneInfo("America/New_York")).date()
    start = pd.Timestamp(local_date) - pd.Timedelta(days=14)
    end = pd.Timestamp(local_date) + pd.Timedelta(days=14)
    calendar = calendars.get_calendar("XNYS", start=start - pd.Timedelta(days=7), end=end + pd.Timedelta(days=7))
    closes = [calendar.session_close(day).to_pydatetime() for day in calendar.sessions_in_range(start, end)]
    complete = [close for close in closes if close + timedelta(minutes=30) <= now]
    upcoming = [close + timedelta(minutes=30) for close in closes if close + timedelta(minutes=30) > now]
    if not complete or not upcoming:
        raise ValueError("Cannot determine completed US ETF session")
    return {"expectedCloseAt": iso(complete[-1]), "nextCheckAt": iso(upcoming[0]), "checkedAt": iso(now)}


def validate_history(symbol: str, frame: pd.DataFrame, metadata: dict, sessions: pd.DatetimeIndex, calendar: ExchangeCalendar) -> tuple[list[Observation], dict]:
    if (
        metadata.get("symbol") != symbol or metadata.get("instrumentType") != "ETF"
        or metadata.get("currency") != "USD"
        or metadata.get("exchangeTimezoneName") != "America/New_York"
        or metadata.get("exchangeName") not in EXCHANGES
        or metadata.get("longName") != SYMBOLS[symbol]
        or metadata.get("dataGranularity") != "1d"
    ):
        raise ValueError(f"{symbol}: ticker, ETF identity, USD currency, exchange, timezone or daily granularity mismatch")
    required = ["Open", "High", "Low", "Close", "Adj Close", "Volume", "Dividends", "Stock Splits"]
    if frame.empty or any(column not in frame for column in required):
        raise ValueError(f"{symbol}: missing daily OHLCV/adjustment/action columns")
    if not isinstance(frame.index, pd.DatetimeIndex) or str(frame.index.tz) != "America/New_York":
        raise ValueError(f"{symbol}: daily index must use America/New_York")
    if any(day.hour or day.minute or day.second or day.microsecond for day in frame.index):
        raise ValueError(f"{symbol}: daily bar labels must be local midnight, not intraday timestamps")
    if not frame.index.is_monotonic_increasing or frame.index.has_duplicates:
        raise ValueError(f"{symbol}: unordered or duplicate daily bars")
    dates = [day.tz_convert("America/New_York").date() for day in frame.index]
    expected = [day.date() for day in sessions]
    if dates != expected:
        missing = sorted(set(expected) - set(dates))
        extra = sorted(set(dates) - set(expected))
        raise ValueError(f"{symbol}: session coverage mismatch ({len(missing)} missing, {len(extra)} unexpected); entire batch rejected")
    observations = []
    actions = []
    warnings = []
    for day, (_, row) in zip(sessions, frame.iterrows()):
        if any(not math.isfinite(float(row[column])) for column in required):
            raise ValueError(f"{symbol}: non-finite price, volume or action")
        opening, high, low, close = (float(row[column]) for column in ["Open", "High", "Low", "Close"])
        if min(opening, high, low, close, float(row["Adj Close"])) <= 0 or not low <= min(opening, close) <= max(opening, close) <= high:
            raise ValueError(f"{symbol}: inconsistent positive daily OHLC prices")
        volume = float(row["Volume"])
        dividends, splits = float(row["Dividends"]), float(row["Stock Splits"])
        capital_gains = float(row.get("Capital Gains", 0))
        if volume < 0 or not volume.is_integer() or min(dividends, splits, capital_gains) < 0 or not math.isfinite(capital_gains):
            raise ValueError(f"{symbol}: invalid volume or corporate action")
        if volume == 0:
            warnings.append(f"{day.date()}: zero reported volume")
        if dividends or splits or capital_gains:
            actions.append({"session": str(day.date()), "dividend": dividends, "splitRatio": splits, "capitalGains": capital_gains})
        # yfinance indexes daily rows at local midnight, NOT at the closing instant.
        observations.append(Observation(
            symbol=symbol, observedAt=iso(calendar.session_close(day).to_pydatetime()), value=close, publishedAt=None,
        ))
    return observations, {
        "symbol": symbol, "name": metadata["longName"], "currency": "USD", "exchange": metadata["exchangeName"],
        "timezone": metadata["exchangeTimezoneName"], "rows": len(observations),
        "firstSession": str(sessions[0].date()), "lastSession": str(sessions[-1].date()),
        "lastClose": observations[-1].value, "lastCloseAt": observations[-1].observedAt,
        "missingSessions": 0, "actions": actions, "warnings": warnings,
    }


def acquire(now: datetime | None = None, ticker_factory=None) -> dict:
    import yfinance as yf

    yf.config.debug.hide_exceptions = False
    now = now or datetime.now(timezone.utc)
    sessions, calendar = session_window(now)
    start = str(sessions[0].date())
    end = str((sessions[-1] + pd.Timedelta(days=1)).date())
    snapshot = {
        "adapterVersion": VERSION, "library": f"yfinance {yf.__version__}",
        "startedAt": iso(now), "settings": {**SETTINGS, "start": start, "endExclusive": end},
        "calendar": f"exchange_calendars {calendars.__version__}: XNYS common US ETF sessions; 30-minute finalization buffer",
        "semantics": "Yahoo daily Close with no yfinance auto/back adjustment or repair. Yahoo may restate historical closes for splits. Not total returns.",
        "timestampConvention": "Exchange session close converted to UTC; source daily bar label retained in library snapshot. Publication time unknown.",
        "symbols": {}, "summaries": [], "errors": [],
    }
    observations = []
    factory = ticker_factory or yf.Ticker
    for symbol in SYMBOLS:
        try:
            ticker = factory(symbol)
            frame = ticker.history(start=start, end=end, **SETTINGS)
            metadata = dict(ticker.history_metadata)
            snapshot["symbols"][symbol] = {
                "metadata": {key: metadata.get(key) for key in PUBLIC_METADATA},
                "history": json.loads(frame.to_json(orient="table", date_format="iso", double_precision=15)),
            }
            rows, summary = validate_history(symbol, frame, metadata, sessions, calendar)
            observations.extend(rows)
            snapshot["summaries"].append(summary)
        except (ValueError, TypeError, KeyError, OverflowError) as exc:
            # Validation messages contain fixed symbols/counts, never provider response text.
            message = str(exc) if isinstance(exc, ValueError) and str(exc).startswith(f"{symbol}:") else f"{symbol}: invalid provider response ({type(exc).__name__})"
            snapshot["errors"].append(message)
        except Exception as exc:
            snapshot["errors"].append(f"{symbol}: acquisition failed ({type(exc).__name__}); no replacement values generated")
            # Stop on transport errors/rate limits instead of repeatedly hitting the provider.
            break
    snapshot["retrievedAt"] = iso(datetime.now(timezone.utc))
    if snapshot["errors"]:
        observations = []
    return {
        "snapshot": snapshot,
        "observations": [row.model_dump(exclude_none=True) | {"publishedAt": None} for row in observations],
    }


def pull() -> dict:
    """Bound the whole operation and isolate third-party global config/cache."""
    try:
        result = subprocess.run(
            [sys.executable, "-m", "backend.yahoo_worker"], capture_output=True, timeout=90, check=False,
            cwd=Path(__file__).resolve().parent.parent, stdin=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired:
        return {"snapshot": {"adapterVersion": VERSION, "errors": ["Yahoo acquisition exceeded 90 seconds; no data activated"]}, "observations": []}
    if result.returncode != 0:
        return {"snapshot": {"adapterVersion": VERSION, "errors": ["Yahoo worker failed; no data activated"]}, "observations": []}
    try:
        payload = json.loads(result.stdout)
    except (ValueError, UnicodeError):
        return {"snapshot": {"adapterVersion": VERSION, "errors": ["Yahoo worker returned an invalid snapshot"]}, "observations": []}
    if not isinstance(payload, dict) or not isinstance(payload.get("snapshot"), dict) or not isinstance(payload.get("observations"), list):
        raise ValueError("Invalid Yahoo acquisition contract")
    return payload
