"""Opt-in source-extraction acceptance, never part of offline CI traffic."""

import json
import math
import os
import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from curl_cffi import requests

from backend.yahoo import SYMBOLS, pull


@unittest.skipUnless(os.environ.get("ECONQUEST_LIVE_YAHOO") == "1", "Opt-in Yahoo network acceptance only")
class YahooLiveAcceptance(unittest.TestCase):
    def test_every_ohlcv_bar_and_action_against_direct_yahoo_chart(self):
        result = pull()
        snapshot = result["snapshot"]
        self.assertEqual(snapshot["errors"], [])
        self.assertEqual(set(snapshot["symbols"]), set(SYMBOLS))
        settings = snapshot["settings"]
        ny = ZoneInfo("America/New_York")
        periods = {
            key: int(datetime.fromisoformat(settings[value]).replace(tzinfo=ny).timestamp())
            for key, value in [("period1", "start"), ("period2", "endExclusive")]
        }
        for symbol, captured in snapshot["symbols"].items():
            with self.subTest(symbol=symbol):
                response = requests.get(
                    f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
                    params={**periods, "interval": "1d", "events": "div,splits,capitalGains"},
                    impersonate="chrome", timeout=15,
                )
                response.raise_for_status()
                chart = response.json()["chart"]
                self.assertIsNone(chart["error"])
                raw = chart["result"][0]
                self.assertEqual(raw["meta"]["symbol"], symbol)
                self.assertEqual(raw["meta"]["currency"], "USD")
                quotes = raw["indicators"]["quote"][0]
                adjusted = raw["indicators"]["adjclose"][0]["adjclose"]
                keyed = {datetime.fromtimestamp(t, ny).date().isoformat(): i for i, t in enumerate(raw["timestamp"])}
                rows = captured["history"]["data"]
                self.assertEqual(len(rows), len(keyed))
                events = {
                    category: {datetime.fromtimestamp(e["date"], ny).date().isoformat(): e
                               for e in raw.get("events", {}).get(category, {}).values()}
                    for category in ["dividends", "splits", "capitalGains"]
                }
                max_adjusted_difference = 0
                for row in rows:
                    day = datetime.fromisoformat(row["Date"].replace("Z", "+00:00")).astimezone(ny).date().isoformat()
                    i = keyed[day]
                    for source, target in [("open", "Open"), ("high", "High"), ("low", "Low"), ("close", "Close"), ("volume", "Volume")]:
                        self.assertTrue(math.isclose(quotes[source][i], row[target], rel_tol=1e-12, abs_tol=1e-10), (symbol, day, target))
                    max_adjusted_difference = max(max_adjusted_difference, abs(adjusted[i] - row["Adj Close"]))
                    split = events["splits"].get(day)
                    expected = {
                        "Dividends": events["dividends"].get(day, {}).get("amount", 0),
                        "Stock Splits": split["numerator"] / split["denominator"] if split else 0,
                        "Capital Gains": events["capitalGains"].get(day, {}).get("amount", 0),
                    }
                    for field, value in expected.items():
                        self.assertTrue(math.isclose(value, row.get(field, 0), abs_tol=1e-12), (symbol, day, field))
                print(json.dumps({
                    "symbol": symbol, "sessions": len(rows), "ohlcvAndActionsParity": "passed",
                    "maxAdjustedCloseResponseDifferenceUsd": max_adjusted_difference,
                    "limitation": "Same vendor, not independent price verification. Adjusted Close is retained but not analyzed.",
                }))
