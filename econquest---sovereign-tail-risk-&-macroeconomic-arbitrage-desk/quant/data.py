"""Acquire observed public data; never use the application's generated history."""

import argparse
import hashlib
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "quant" / "data"
DEFAULT_URL = (
    "https://www.bankofcanada.ca/wp-content/uploads/2025/10/"
    "BoC-BoE-Database-2025.xlsx"
)
FEATURES = {
    "externalDebtGni": "DT.DOD.DECT.GN.ZS",
    "shortTermDebtReserves": "DT.DOD.DSTC.IR.ZS",
    "reservesMonths": "FI.RES.TOTL.MO",
    "gdpGrowth": "NY.GDP.MKTP.KD.ZG",
    "inflation": "FP.CPI.TOTL.ZG",
    "currentAccountGdp": "BN.CAB.XOKA.GD.ZS",
}


def download(url: str, path: Path) -> None:
    """Cache successful responses; propagate failures rather than inventing data."""
    if path.exists():
        return
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "EconQuest/1.0"})
            with urllib.request.urlopen(request, timeout=120) as response:
                content = response.read()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            return
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == 3:
                raise RuntimeError(f"Could not download {url}") from exc
            print(f"Retrying {url}: {exc}", flush=True)
            time.sleep(2 ** attempt)


def assemble() -> None:
    raw = DATA / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    workbook = raw / "defaults-2025.xlsx"
    download(DEFAULT_URL, workbook)
    defaults = pd.read_excel(workbook, sheet_name="Debt_2025", header=64)
    defaults["country"] = defaults["k"].str.rsplit("_", n=1).str[0]
    defaults = defaults.loc[
        defaults["country"].str.fullmatch(r"[A-Z]{3}", na=False),
        ["country", "DEBT_YEAR", "DEBT_TOTAL_2025"],
    ].rename(columns={"DEBT_YEAR": "year", "DEBT_TOTAL_2025": "defaultDebtUsdMillions"})
    if defaults.duplicated(["country", "year"]).any():
        raise ValueError("Duplicate country/year default labels")
    frames = []
    sources = [{"url": DEFAULT_URL, "sha256": hashlib.sha256(workbook.read_bytes()).hexdigest()}]
    for feature, indicator in FEATURES.items():
        path = raw / f"{indicator}.json"
        url = (
            f"https://api.worldbank.org/v2/country/all/indicator/{indicator}"
            "?format=json&date=1980:2024&per_page=20000"
        )
        print(f"Loading {indicator}", flush=True)
        download(url, path)
        result = json.loads(path.read_text())
        if len(result) != 2 or not isinstance(result[0], dict) or not result[1]:
            raise ValueError(f"Invalid World Bank response for {indicator}: {str(result)[:300]}")
        if result[0]["pages"] != 1:
            raise ValueError(f"World Bank pagination incomplete for {indicator}")
        frame = pd.DataFrame(
            {
                "country": item["countryiso3code"],
                "year": int(item["date"]),
                feature: item["value"],
            }
            for item in result[1]
            if item["countryiso3code"]
        )
        if frame.duplicated(["country", "year"]).any():
            raise ValueError(f"Duplicate World Bank observations for {indicator}")
        frames.append(frame.set_index(["country", "year"]))
        sources.append({
            "url": url,
            "indicator": indicator,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "sourceLastUpdated": result[0].get("lastupdated"),
        })
    macro = pd.concat(frames, axis=1).reset_index()
    # Only countries explicitly covered by BoC--BoE: absence is not a non-default label.
    panel = macro.merge(defaults, on=["country", "year"], how="inner", validate="one_to_one")
    invalid_labels = panel["defaultDebtUsdMillions"].isna() | panel["defaultDebtUsdMillions"].lt(0)
    excluded_labels = panel.loc[invalid_labels, ["country", "year"]].to_dict("records")
    panel = panel.loc[~invalid_labels]
    panel = panel.sort_values(["country", "year"]).reset_index(drop=True)
    panel.to_csv(DATA / "observed-panel.csv", index=False, float_format="%.10g")
    manifest = {
        "retrievedAt": datetime.now(timezone.utc).isoformat(),
        "sources": sources,
        "coverage": {"startYear": 1980, "endYear": 2024},
        "features": FEATURES,
        "rows": len(panel),
        "countries": int(panel["country"].nunique()),
        "completeRows": int(panel[list(FEATURES)].notna().all(axis=1).sum()),
        "excludedUnknownOrNegativeDefaultLabels": excluded_labels,
        "panelSha256": hashlib.sha256((DATA / "observed-panel.csv").read_bytes()).hexdigest(),
        "limitations": [
            "Current revised World Bank data, not point-in-time historical vintages.",
            "Annual total debt-in-default stock; not a rating-agency event panel.",
            "No synthetic observations, interpolation, or cross-country sequence concatenation.",
        ],
    }
    (DATA / "sources.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({key: manifest[key] for key in ["rows", "countries", "completeRows"]}))


if __name__ == "__main__":
    argparse.ArgumentParser(description=__doc__).parse_args()
    assemble()
