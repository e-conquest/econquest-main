"""Isolated manual provider pull; stdout is a bounded library snapshot, not logs."""

import json
import tempfile

import yfinance as yf

from .yahoo import acquire


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="econquest-yahoo-cache-") as cache:
        yf.set_tz_cache_location(cache)
        print(json.dumps(acquire(), allow_nan=False, separators=(",", ":")))
