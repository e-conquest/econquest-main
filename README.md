# EconQuest: Macroeconomic Research and Geopolitical Monitoring

[![Research verification](https://github.com/e-conquest/econquest-main/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/e-conquest/econquest-main/actions/workflows/ci.yml)

**EconQuest is a local, single-user research application**, not a production trading
or public multi-user service. It provides manual data acquisition, immutable source
provenance, macroeconomic monitoring, separate geopolitical event research and
historical model diagnostics.

**Updated 21 October 2026.** The application is in
[`econquest---sovereign-tail-risk-&-macroeconomic-arbitrage-desk/`](./econquest---sovereign-tail-risk-&-macroeconomic-arbitrage-desk/).
Run application commands from that folder, not the repository root.

## Current capabilities

- **Macro trend desk:** WEO global overview, focused 12-country watchlist and country
  dossiers for real GDP growth, CPI inflation, government debt/GDP and current account/GDP.
- **Reviewed evidence bundles:** explicit source preview/review, immutable saved
  analysis, native classifications, source hashes and reproducible calculations.
- **Ten manual data adapters:** Yahoo, Monthly IMF, IMF WEO, World Bank WDI,
  FRED/ALFRED, BIS, World Bank IDS, UN Comtrade, GDELT and ACLED.
- **Data operations:** source validation, coverage reports, explicit activation,
  retained originals, rollback, audit history, CSV/XLSX ingestion and database backups.
- **Research models:** fitted Firth/LightGBM default-onset models, an annual Gaussian
  HMM and recomputed historical evaluation.

An adapter being implemented does not establish complete data coverage or account
authorization. In local onboarding, ACLED's data endpoint returned HTTP 403; successful
live event access remains unverified. Comtrade acquisition is resumable and incomplete
in the development database; Monthly IMF's earlier strict-v1 snapshot remains quarantined.
These private snapshots and their status are not distributed in a fresh clone.

## Run locally

Use Node.js 22.12+ within Node 22 (or supported Node 24) and Python 3.13.
The following uses macOS/Linux shell syntax:

```sh
git clone https://github.com/e-conquest/econquest-main.git
cd 'econquest-main/econquest---sovereign-tail-risk-&-macroeconomic-arbitrage-desk'
npm ci
python3.13 -m venv .backend-venv
.backend-venv/bin/python -m pip install -r backend/requirements.txt
npm run build
.backend-venv/bin/python -m backend serve --port 8768
```

Open **http://127.0.0.1:8768/**. The server binds to loopback only. Provider keys
are optional for startup; FRED/ALFRED, Comtrade and ACLED need their own backend-only
credentials for acquisition. No LLM API key is needed.

See the **[complete application README](./econquest---sovereign-tail-risk-&-macroeconomic-arbitrage-desk/README.md)**
for development mode, hidden credential prompts, the macro-desk workflow, data
definitions, tests, backups/restores, model evidence and limitations.

## Important boundaries

- The default screen is **Annual research**; open **Macro trend desk** explicitly.
- A fresh clone has no acquired provider database or private credentials. Bundled
  annual historical data/model artifacts are included and labeled as research.
- Provider pulls are manual. They do not automatically activate snapshots, update
  fitted models, generate alerts or publish analysis.
- Current code uses **schema 13**. Back up an existing local database before updating/
  restarting. A GitHub push does not restart a running app; the development service's
  last restart was cancelled and its main database was left at schema 12.
- Bundled annual history ends in **2024**, so next-year estimates refer to **2025,
  not today**. Fitted classifiers do **not** beat the constant-rate holdout baseline
  on Brier score/log loss.
- Experimental scenario, portfolio, curve, contagion and hedge workbenches remain
  illustrative. There is no validated portfolio VaR/ES, live bond/CDS pricing,
  trading recommendation or operational current-risk forecast.
- Authentication/roles, multi-user hosting, reviewed public publishing, evidence-linked
  briefings and predictive trend/escalation products remain roadmap work.

## Documentation and verification

- [Application setup and current feature guide](./econquest---sovereign-tail-risk-&-macroeconomic-arbitrage-desk/README.md)
- [Backend API, provider contracts and operations](./econquest---sovereign-tail-risk-&-macroeconomic-arbitrage-desk/backend/README.md)
- [Architecture and research implementation notes](./econquest---sovereign-tail-risk-&-macroeconomic-arbitrage-desk/docs/ARCHITECTURE.md)
- [GitHub Actions verification](https://github.com/e-conquest/econquest-main/actions/workflows/ci.yml)

CI runs backend/model tests, frontend tests, TypeScript checks, build and browser
workflows. It does not validate provider account entitlements, establish data
redistribution rights or certify models for investment use.

The other root PDF, HTML, CSV and JSON files are legacy/reference material, not the
runtime application. Design blueprints are proposals where marked, not implemented
product guarantees.

## License and data rights

Application-authored code carries an
[MIT license and research disclaimer](./econquest---sovereign-tail-risk-&-macroeconomic-arbitrage-desk/LICENSE).
Dependencies and source data retain their own terms; the GPL-3.0 `gdelt` and `acled`
wrappers are not relicensed by the application license.

Credentials, acquired observations, source downloads, local databases and backups are
excluded from publication. Public API access is not blanket permission to redistribute
data. Macro bundles explicitly block public publication pending rights review.

**Research/education only. Not investment advice, a credit rating or a regulated risk system.**
