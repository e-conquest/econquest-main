# EconQuest: Macroeconomic Research and Geopolitical Monitoring

EconQuest is a **local, single-user research application** for reviewing macroeconomic,
market and geopolitical datasets with explicit provenance. It combines a React/TypeScript
dashboard, a loopback-only Python/FastAPI service, immutable SQLite snapshots and a
separate offline quantitative research pipeline.

**Documentation status: 21 October 2026.** This guide describes implemented behavior,
not the older institutional trading-desk concept. The default view remains **Annual
research**; the new **Macro trend desk** is an opt-in tab.

> **Research only.** EconQuest does not provide investment recommendations, live
> trading signals, validated portfolio VaR/ES, sovereign bond/CDS pricing or an
> operational current-risk forecast. The bundled annual models use revised history
> through 2024 and do not beat the constant-rate holdout baseline on Brier score or
> log loss. Provider integrations do not automatically become model inputs.
>
> **Not a public hosted service.** There are no user accounts, OIDC roles or tenant
> isolation. Public publication of macro bundles is blocked pending data-rights and
> dependency-license review. Do not expose the backend to the internet.

## Contents

- [What works today](#what-works-today)
- [Quickstart](#quickstart)
- [Credentials and configuration](#credentials-and-configuration)
- [Macro trend desk](#macro-trend-desk)
- [Provider inventory and limitations](#provider-inventory-and-limitations)
- [Review, activation and provenance](#review-activation-and-provenance)
- [File ingestion](#file-ingestion)
- [Fitted annual models: training, data and limitations](#fitted-annual-models-training-data-and-limitations)
- [Historical loss import](#historical-loss-import)
- [Testing and CI](#testing-and-ci)
- [Storage, backups and upgrades](#storage-backups-and-upgrades)
- [Architecture and repository layout](#architecture-and-repository-layout)
- [Roadmap](#roadmap)
- [License and data rights](#license-and-data-rights)

## What works today

| Area | Implemented | Boundary |
|---|---|---|
| Macro trend desk | WEO global table, fixed 12-country watchlist, country dossiers, reviewed immutable evidence bundles | Four annual indicators; not a cross-provider live risk engine |
| Data operations | Ten manual provider adapters, validation reports, stored originals, independent snapshot review/activation/rollback | Account access, source availability and coverage can block acquisition |
| Market monitoring | Yahoo ETF Close history, actual exchange-session timestamps and session-aware freshness checks | Not total returns, sovereign yields or CDS |
| Macro research | Separate monthly IMF, WEO, WDI, IDS, FRED/ALFRED and BIS views | Native units/frequencies and source limitations retained |
| Geopolitical research | Separate GDELT Events and ACLED event-review interfaces | No fused incident truth, headline feed, escalation score or generated alerts |
| File ingestion | Validated CSV/XLSX previews, quarantine, explicit commits and durable revisions | Exact annual/market schemas; no guessed column mappings |
| Quantitative research | Fitted Firth/LightGBM onset models, annual Gaussian HMM, recomputed held-out diagnostics | Historical research, not promoted operational predictions |
| Experimental sandbox | Illustrative scenarios, curves, contagion, portfolio and hedge workbenches | Demonstration outputs, not validated observed analytics |

### Existing local data versus a fresh clone

GitHub contains source, tests, a bundled annual research panel and model artifacts.
It does **not** contain provider snapshot databases, private credentials, downloaded
originals, acceptance databases or backups. A fresh clone starts with no acquired
provider snapshots; seeing the bundled annual research view does not mean a provider
is connected or current.

In the existing development database, the last reviewed rollout state had WEO and
other completed native-provider snapshots staged/inactive, Monthly IMF v1 quarantined,
Comtrade paused with no trade observations, and ACLED interrupted with HTTP 403.
These are deployment-specific observations, not the state of every installation.
The latest local restart was cancelled after backup/build; publishing code did not
start that backend or migrate its schema-12 database.

<a id="4-quickstart--local-development"></a>

## Quickstart

### Requirements

- **Node.js 22.12+ within Node 22**, or Node 24, as specified in
  [package.json](./package.json). [.nvmrc](./.nvmrc) selects Node 22; CI uses Node 22.
- **Python 3.13** is the CI and offline model-reproduction runtime.
- npm and Git. On macOS, LightGBM may also require the OpenMP runtime (`brew install libomp`).

Commands below use macOS/Linux shell syntax. On Windows, virtual-environment executables
are under `Scripts` rather than `bin`; adjust paths and environment-variable syntax.

### Clone and install

The application lives in a subdirectory of the GitHub repository. Quote its name
because it contains `&`.

```sh
git clone https://github.com/e-conquest/econquest-main.git
cd 'econquest-main/econquest---sovereign-tail-risk-&-macroeconomic-arbitrage-desk'

npm ci
python3.13 -m venv .backend-venv
.backend-venv/bin/python -m pip install -r backend/requirements.txt
```

If already working in the application directory, skip the clone and `cd` steps.
[package-lock.json](./package-lock.json) is the canonical frontend lockfile.

### Option A: built application, one local server

```sh
npm run build
.backend-venv/bin/python -m backend serve --port 8768
```

Open **http://127.0.0.1:8768/** and keep the terminal running. Stop with Ctrl+C.
Stored snapshots survive restart. Keys are optional for starting the app; only
providers requiring those credentials are unavailable until configured.

### Option B: frontend development

Terminal 1:

```sh
.backend-venv/bin/python -m backend serve --port 8000
```

Terminal 2, in the same application directory:

```sh
npm run dev
```

Open **http://127.0.0.1:3000/**. Vite proxies `/api` to port 8000 by default.
For an API on port 8768 instead:

```sh
ECONQUEST_BACKEND_URL=http://127.0.0.1:8768 npm run dev
```

`npm run preview` alone does not start the persistent Python API. Browser inference
can display bundled annual research without the API, but acquisition, stored-data
review, ingestion and saved macro bundles require it.

## Credentials and configuration

No Gemini, OpenAI or other LLM key is needed for the implemented research workflow.
Required provider credentials stay in the **backend process**, never in React settings,
`VITE_*` variables, Git, URLs, command arguments or chat.

| Provider | Backend configuration |
|---|---|
| Yahoo, Monthly IMF, WEO, WDI, IDS, BIS, GDELT | No API key required by the implemented routes |
| FRED / ALFRED | `FRED_API_KEY` |
| UN Comtrade | `COMTRADE_API_KEY` |
| ACLED | `ACLED_USERNAME` and `ACLED_PASSWORD`; entitled myACLED account required |

For interactive hidden entry of all configured private providers:

```sh
.backend-venv/bin/python -m backend serve --port 8768 \
  --prompt-fred-key --prompt-comtrade-key --prompt-acled
```

The CLI prompts privately for FRED, Comtrade, myACLED email and myACLED password.
Use only the flags you need. Values stay in process memory/environment; restarting
requires re-entry. The backend does not automatically load `.env` files.

In VS Code, open this application folder, then use **Terminal > Run Task >
EconQuest: backend with hidden FRED, Comtrade and ACLED prompts**. Do not launch a
second backend against the same database. A configured indicator only confirms
configuration shape/presence, not successful provider authorization.

Other settings:

- `ECONQUEST_DB_PATH` or `serve --db PATH`: database location; default
  `research-data/research.sqlite3` under the application directory.
- `ECONQUEST_BACKEND_URL`: Vite development proxy target, not a provider credential.
- `ECONQUEST_ALLOWED_ORIGINS`: optional explicit loopback origins for a custom
  frontend origin. Same-origin requests are accepted. Defaults include ports 5173
  and 4179; Vite normally proxies browser API requests on port 3000.
- `ECONQUEST_TEST_PYTHON`: backend interpreter used by browser tests.

The service accepts literal loopback hosts only. Its process-wide `X-Research-Token`
guards mutations; it is **not user identity or multi-user authorization**.
See [backend configuration and API](./backend/README.md).

## Macro trend desk

Open **Macro trend desk**. This is the first implemented slice of the analysis-desk
roadmap, using explicitly selected, completed stored WEO evidence.

1. Choose a WEO snapshot and select **Preview source evidence**. There is no
   automatic source selection or provider activation.
2. Inspect the global table, focused-watchlist filter and country dossiers.
3. Inspect annual history, actual/estimate-projection classifications, native
   attributes and retained-source checksums.
4. Add a review note, acknowledge authorized local research use and choose
   **Save reviewed local bundle**.
5. Reload that bundle later to reproduce the same frozen evidence and results,
   independent of later provider activation.

| Indicator | Native WEO code | Display convention |
|---|---|---|
| Real GDP growth | `NGDP_RPCH` | Annual percent change |
| Annual-average CPI inflation | `PCPIPCH` | Annual percent change |
| General government gross debt | `GGXWDG_NGDP` | Percent of GDP |
| Current account balance | `BCA_NGDPD` | Percent of GDP |

The fixed initial watchlist is **United States, China, Japan, Germany, United
Kingdom, India, Brazil, Mexico, South Africa, Turkey, Russia and Ukraine**
(`USA CHN JPN DEU GBR IND BRA MEX ZAF TUR RUS UKR`). It is not a saved per-user
preference. Source-native country codes and reviewed ISO3 associations are retained;
unmapped members remain visible.

The global table covers the source's individual-economy catalog, not guaranteed
world coverage or a synchronized world aggregate. Each metric uses its own latest
**available IMF-classified actual**, labeled with its reporting year. Actuals are
revisable and reporting years may be fiscal years.

Changes are **percentage-point differences** between consecutive comparable actual
years, never percentage returns or risk probabilities. Unverified units/scales,
missing actual boundaries, gaps, incompatible definitions or break/forecast statuses
block changes. Native numeric values are not multiplied by SCALE. Missing data,
estimates/projections and unknown classifications are not filled or promoted to actuals.
Freshness remains unverified.

Schema 13 stores immutable bundles with evidence IDs, source hashes, formulas/contract
version, country mappings, rights policy and review metadata. Reads and backups check
bundle integrity. Preview/save do not acquire data, activate providers, retrain models
or alter fitted-model inputs. There is no public publish/export route for these bundles;
`publicAllowed` is always `false`.

See [the analytical contract and rights gate](./backend/README.md#reviewed-macro-evidence-bundles).

## Provider inventory and limitations

All ten adapters are **manual**. UI job-progress polling is not a scheduler, and
refreshing stored data is not a provider acquisition. Data remains source-native
unless a specifically documented calculation is supported.

| Provider / view | Implemented acquisition | Main qualification |
|---|---|---|
| Yahoo / Observed monitoring | Five years of daily EMB, PCY, ECH and TUR ETF history | Close, not total return or bond/CDS quotes |
| Monthly IMF | Latest 120 completed months; five monthly indicator definitions | v2 available-pair policy; no guessed scaling or substitutions |
| IMF WEO | Annual catalog/history and estimates/projections | Per-series actual boundary; gaps allowed and disclosed |
| World Bank WDI | Source 2; 17 annual indicators | Revised snapshots; blank status is not verified actual classification |
| World Bank IDS | Source 6; 18 annual debt indicators; World counterpart | Shared-source overlap with WDI; not independent corroboration |
| FRED / ALFRED | 18 native-frequency series; current or requested historical as-of snapshot | Key and underlying-series terms apply; limited vintage coverage |
| BIS | Quarterly banking claims/liabilities and four credit measures | Not a bilateral sovereign exposure network |
| UN Comtrade | Resumable annual merchandise-trade discovery/acquisition | Requires key and many bounded manual passes |
| GDELT | Complete latest UTC day of GDELT 2.0 Events: 96 archives | Machine-coded media records, not verified incidents |
| ACLED | Account-accessible core events, latest 30 completed UTC days | Entitlement required; local live event access remains blocked by 403 |

### First provider: Yahoo ETF history

The server uses `yfinance` with `auto_adjust=False`, `back_adjust=False`,
`repair=False` and `actions=True`. Yahoo can still restate historical prices.
The stored original is a captured **library-response JSON snapshot**, not raw HTTP.
Expected US trading sessions, exchange identities, positive OHLC values and actions
are validated; missing/invalid coverage quarantines the batch.

Monitoring dates are actual session closes in UTC, not daily-bar midnight labels.
Sessions become eligible 30 minutes after close. Freshness uses the exchange calendar
and expires until rechecked after the next eligible close. These ETFs are not
instrument-level sovereign credit data.
[Contract](./backend/README.md#yahoo-data-contract).

### Monthly IMF

The current monthly-native v2 connector uses verified topic datasets rather than
guessed codes in the discontinued single IFS dataset: CPI index, published YoY CPI
inflation, period-average FX, reserves including gold at market value, and the
published monetary-policy-related rate.

Absent pairs and months are disclosed. Undocumented numeric statuses are excluded
with raw values/reasons retained, not reclassified. Old strict-v1 quarantines are
not silently unquarantined; replay creates a separate revision. Reserve scaling is
unverified and standardized reserve changes remain blocked. National CPI bases and
policy-rate definitions are not harmonized.
[Contract](./backend/README.md#imf-monthly-contract).

### IMF WEO annual research and projections

The verified `IMF.RES:WEO` v9.0.0 annual connector retains catalog definitions,
series attributes, original responses and all available annual years. Missing
economy/indicator pairs are disclosed rather than fabricated.
`LATEST_ACTUAL_ANNUAL_DATA` determines the actual boundary; missing or unmapped
boundaries remain unknown. Later years are combined **IMF estimate/projection**,
including estimates for past years. A release timestamp does not establish
per-observation historical availability.
[Contract](./backend/README.md#weo-annual-contract).

### World Bank WDI research via wbgapi

`wbgapi` source 2 requests 17 indicators covering the six research predictors,
economic size, external debt/service, reserves/FX, trade/FDI and central-government
debt/revenue. Source-specific non-aggregate membership determines the universe.
Nulls, status, footnotes, precision and native definitions remain inspectable.
Central-government fiscal measures must not be equated with WEO general-government
measures. No default labels or historical vintage reconstruction are inferred.
[Contract](./backend/README.md#world-bank-wdi-contract).

### World Bank International Debt Statistics (IDS)

`wbgapi` source 6 requests 18 debt-stock, service, flow and ratio indicators,
with the fixed World (`WLD`) creditor counterpart. The native source defines IMF
credit **and SDR allocations**, original-maturity short-term debt and PPG debt
including guaranteed obligations; these are not interchangeable sovereign-debt totals.

Rows are `reported_unverified`, not verified actuals. Future-dated cells are excluded
from normalized history but retained in originals. WDI/IDS overlapping series are
shared-source evidence, not independent corroboration.
[Contract](./backend/README.md#world-bank-ids-contract).

### FRED and ALFRED: native history and historical snapshots

The basket contains Treasury rates `DGS1/2/3/5/7/10/20/30`, `SOFR`, `EFFR`,
`DTWEXBGS`, `VIXCLS`, `DCOILBRENTEU`, `PCOPPUSDM`, `PWHEAMTUSDM`, `GDP`,
`CPIAUCSL` and `UNRATE`. `GDP` is nominal GDP; the broad dollar index is not ICE DXY.

Current FRED and historical ALFRED as-of snapshots have separate active selections.
Unavailable historical vintages are not replaced with current values. Real-time
bounds are date-level query metadata, not authenticated issuance/release timestamps.
No resampling, inferred trading calendars, spread engine or forecast is added.
[Contract](./backend/README.md#fredalfred-contract).

### BIS quarterly banking and credit

Public SDMX acquisition uses LBS `WS_LBS_D_PUB` v1.0 for cross-border bank claims/
liabilities in millions of USD and `WS_TC` v2.0 for general-government, private
non-financial, household/NPISH and corporate credit as percentages of GDP.

LBS is residence-based, not consolidated, bilateral or sovereign-only. Stock changes
can reflect FX and breaks; sector totals overlap. Native scales are not blindly
reapplied. `bis-fetcher` is a speech extraction package, not the numeric client used
here, and is not installed.
[Contract](./backend/README.md#bis-quarterly-contract).

### UN Comtrade annual merchandise trade

Pinned `comtradeapicall` requests annual goods, imports/exports, TOTAL products and
source partners from 1962 through the last completed year. Original classifications,
reporting identities and source flags are preserved; no mirror substitution or
estimate-complemented Trade Matrix is used.

Each manual pass is bounded to 40 requests, a five-minute budget and 128 MiB.
A durable ledger permits at most 450 requests per rolling 24 hours; provider quotas
can stop earlier. Resume is explicit, reusing completed chunks. Only a fully verified
acquisition can stage/activate. Missing values are not zero, `isReported=false` is
not claimed to be directly reported, and overlapping World/group categories must
not be summed with individual partners.
[Contract](./backend/README.md#un-comtrade-contract).

### GDELT global daily events

Pinned `gdelt==0.1.14` acquires all 96 quarter-hour Events exports for the latest
completed UTC day. Complete-day transport/count checks precede staging. All 61
native cells, ZIP originals and hashes are retained; Mentions, GKG, headline search
and full article text are not acquired.

Event date, ingestion time and unknown article-publication time are distinct.
Action-location codes are **not ISO2**: native `RS` means Russia and `UP` Ukraine;
actor countries use another CAMEO system. Repeated stories, extraction errors and
media bias apply. One retained day is not an escalation trend baseline.
[Contract](./backend/README.md#gdelt-daily-events-contract).

### ACLED conflict and protest research

Pinned `acled==1.0.2` uses myACLED OAuth for core dyadic events, all core event
types and the latest 30 completed UTC event-date days. Two complete reads must
match totals, IDs and native attributes before staging. Tokens/authentication
bodies are never persisted; event-response originals retain lineage.

The requested global window is limited by account entitlements and source coverage.
Location/date precision, uncertain fatality estimates, revisions and deletions matter.
ACLED and GDELT are not automatically merged or scored. The local onboarding
authenticated successfully but the data endpoint returned **HTTP 403 Access denied**;
successful live event acquisition is **not verified**. Resolve account access before
another explicitly authorized attempt.
[Contract](./backend/README.md#acled-core-events-contract).

## Review, activation and provenance

The normal workflow is **manual pull > inspect report/coverage/native records >
explicit commit or activation**. Invalid batches remain quarantined or interrupted;
partial records are not automatically promoted. Provider-specific active selections
are separate from annual/market file datasets and from one another. FRED current and
historical selections are also separate.

Use **Refresh stored data** to reread local state, not to download providers.
Originals, query/definition metadata, run identities, checksums, revisions and audit
events survive restart and backups. A failed operation retains previous data with
an explicit error; retained data is not presented as freshly acquired.

Observation period, release/publication time, retrieval time and data revision are
different concepts. Unknown dates/units/coverage stay unknown. Most provider views
do not have verified operational freshness policies. Repeated latest-data snapshots
are not a point-in-time historical archive.

## File ingestion

Open **File ingestion**, supply source/units, upload CSV or XLSX, inspect the preview,
then explicitly commit. The upload limit is 5 MiB; workbook/row/archive limits also
apply. Legacy XLS, invalid schemas and incompatible histories fail visibly.

Annual header:

```csv
country_code,year,in_default,externalDebtGni,shortTermDebtReserves,reservesMonths,gdpGrowth,inflation,currentAccountGdp,published_at
```

Annual unit is `model-feature-units`; supported codes are
`CHL BLZ LKA ARG TUR GHA IDN PAK ZAF`. At least two consecutive completed years per
included country, explicit default flags and at least four finite predictors are
required. Reserves/growth/inflation must be observed. Full rules are in the
[file schema](./backend/README.md#file-schema-and-validation).

Market header:

```csv
symbol,observed_at,value,published_at
```

Market values share the supplied unit, with unique identities and timezone-aware
observation timestamps. Unknown publication dates remain null.

Each committed dataset **replaces the active dataset of its kind**; imports do not
silently merge with earlier imports. Annual inference explicitly overlays that
selected annual dataset on bundled history, retaining labeled bundled country-years
omitted from the import. Overlays that introduce gaps are rejected.
This does not retrain models or rewrite held-out evidence. Market datasets never
change annual hazard/HMM inputs.

## Fitted annual models: training, data and limitations

The browser loads [versioned fitted parameters and histories](./src/data/fittedAnnualModels.json);
it does not train at startup. The artifact version is `annual-macro-v1-0d69b08d8723`.
Unsupported/malformed inputs fail explicitly rather than falling back to demo coefficients.

The [observed panel](./quant/data/observed-panel.csv) contains 6,478 country-years
across 152 countries, 1980-2024. The [source manifest](./quant/data/sources.json)
records data provenance. WDI supplies six predictors:

| Predictor | Indicator | Unit |
|---|---|---|
| External debt/GNI | `DT.DOD.DECT.GN.ZS` | Percent |
| Short-term debt/reserves | `DT.DOD.DSTC.IR.ZS` | Percent |
| Reserves | `FI.RES.TOTL.MO` | Months of imports |
| Real GDP growth | `NY.GDP.MKTP.KD.ZG` | Annual percent |
| CPI inflation | `FP.CPI.TOTL.ZG` | Annual percent |
| Current account/GDP | `BN.CAB.XOKA.GD.ZS` | Percent |

Default-onset labels come from the
[BoC-BoE 2025 sovereign default database](https://www.bankofcanada.ca/2025/10/staff-analytical-note-2025-24/):
zero debt in default at year `t`, positive at observed `t+1`. This includes broad
creditor categories/arrears, not only market-bond defaults. Unknown/negative labels
are excluded, not converted to non-defaults. Already-defaulted countries are outside
the onset risk set.

Firth penalized logistic regression and regularized monotonic LightGBM are genuinely
fitted. Training uses predictor years through 2012, validation 2014-2017 and test
2019-2023, with one-year label embargoes. The validation-selected blend is all LightGBM
for this artifact. The three-state annual Gaussian HMM trains through 2017 and filters
observed histories without country/gap-crossing transitions; state names are
interpretations, not validated crisis probabilities.

Held-out hazard evaluation: **268 rows, 31 onsets**.

| Model | Brier, lower is better | Log loss, lower is better | ROC AUC |
|---|---:|---:|---:|
| Firth | 0.1048 | 0.3656 | 0.5316 |
| LightGBM / selected blend | 0.1033 | 0.3655 | 0.5558 |
| Constant training event rate | **0.1027** | **0.3601** | 0.5000 |

**Neither fitted classifier beats the constant baseline on Brier/log loss.**
Revised, selection-biased history is not a historical point-in-time test. The
bundled latest observation is 2024, so its next-year target is **2025, not today**.
Source pulls do not update this artifact. HMM state labels, successful fitting and
illustrative downstream layers do not establish predictive or regulatory validation.

**Historical evaluation** recomputes metrics using
[held-out predictors/outcomes](./src/data/historicalEvaluation.json) and browser
inference, rather than fixed pass/fail cards. These diagnostics evaluate the onset
models, not the entire experimental pipeline.

### Reproduce offline fitting

This is separate from running the app. It writes fitted artifacts; do not retrain
just to launch or refresh providers.

```sh
python3.13 -m venv .venv
.venv/bin/python -m pip install -r quant/requirements.txt
.venv/bin/python quant/train.py
.venv/bin/python -m unittest discover -s quant -p 'test_*.py' -v
npm test
```

The checked-in panel supports fitting without downloading source data again.
To deliberately reacquire/rebuild the panel, run `.venv/bin/python quant/data.py`
before training. That command contacts providers, caches originals under ignored
`quant/data/raw/` and may produce revised data/results.

## Historical loss import

Historical evaluation also accepts an external JSON forecast/loss archive.
Required fields are `portfolio`, `modelVersion`, `unit`, `forecastIssuedAt`,
`periodStart`, `periodEnd`, `confidence`, `var` and `loss`; `es` is optional.

Use UTC ISO timestamps, positive losses/negative gains, nonnegative VaR and positive
ES at least as large as VaR. At least two completed non-overlapping equal-duration
periods must share portfolio, model version, unit and confidence. Forecast issuance
must be no later than period start; supply ES for all rows or none. Gaps do not
create transition counts.

The importer cannot authenticate claimed issuance dates. Imports remain in browser
memory, do not retrain models and do not change the annual holdout.
Kupiec/Christoffersen statistics require this separate archive; ES has no uncalibrated
pass/fail claim. See [backtesting implementation](./src/math/backtesting.ts).

## Testing and CI

Run from the application directory:

```sh
# Frontend unit tests, type-check and production build
npm run verify

# Backend tests, using its dedicated environment
.backend-venv/bin/python -m unittest discover -s backend/tests -p 'test_*.py' -v

# Browser workflows; start isolated services and temporary databases
npx playwright install chromium
npm run test:e2e

# Optional separate model-test environment, installed as above
.venv/bin/python -m unittest discover -s quant -p 'test_*.py' -v
```

`npm run typecheck` and the compatibility `npm run lint` both run TypeScript checking;
there is no separate lint-rule suite. Tests use synthetic fixtures explicitly labeled
as such. Default backend tests skip the optional live-Yahoo test and do not require
provider keys or new live pulls.

The root [GitHub Actions workflow](../.github/workflows/ci.yml) uses Node 22 and
Python 3.13, installs locked dependencies, then runs backend, quant, frontend,
type-check/build and Playwright checks.

The macro-desk implementation passed **193 backend tests (one optional skip),
73 frontend tests and 17 browser workflows**, plus types/build. Its separate retained-data
acceptance checked **34,497 observations across 249 WEO catalog economies**, all 12
watchlist members and 698 comparable actual-change pairs against original XML.
Those are verification results for the tested snapshot, not promised future coverage
or a claim that 249 economies all have populated series. Private acceptance data is
not included in the repository.

## Storage, backups and upgrades

Current code expects **SQLite schema 13**. Startup migrates supported older databases
transactionally; newer unknown schemas fail closed. Only one backend may own a database.
Schema 13 adds immutable reviewed macro bundles without changing provider active selections.

Before upgrading/restarting an existing installation, make a consistent backup:

```sh
.backend-venv/bin/python -m backend backup \
  --db research-data/research.sqlite3 --output research-backup.sqlite3
```

The backup command can snapshot an online database; do not manually copy live
SQLite/WAL files. It validates integrity, foreign keys, schema, original checksums
and, where present, bundle integrity. Choose a new backup output filename each time.

Restore only to a **new, offline target**:

```sh
.backend-venv/bin/python -m backend restore \
  --input research-backup.sqlite3 --target research-data/restored.sqlite3 --offline
```

Stop the old backend before serving the restored target:

```sh
.backend-venv/bin/python -m backend serve --db research-data/restored.sqlite3 --port 8768
```

Re-enter private credentials with the prompt flags if needed. Restarting does not
automatically acquire or activate data. An already-running older process does not
load new Python code just because GitHub was updated; build assets and restart after
backup. Staged revisions survive restart; running acquisitions are recovered as
interrupted. There is no deletion/retention-purge API, so protect databases/backups
as sensitive local research material.

## Architecture and repository layout

```text
econquest-main/
  .github/workflows/ci.yml
  README.md                         Repository landing page
  econquest---sovereign-tail-risk-&-macroeconomic-arbitrage-desk/
    src/
      components/                   Research dashboard, provider views, macro desk
      services/                     Runtime-validated API contracts
      math/                         Inference, monitoring, evaluation and unit tests
      data/                         Bundled annual research/model artifacts
    backend/                        Loopback API, provider adapters, stores, migrations
      tests/                        Backend regression tests
    quant/                          Offline acquisition, fitting and model tests
    tests/                          Playwright workflows and synthetic fixtures
    docs/                           Architecture and future-design references
    research-data/                  Ignored local SQLite database, created at runtime
```

React 19, TypeScript, Vite and Tailwind render the interface. FastAPI/Pydantic and
SQLite own local persistence and manual jobs. Provider-native storage stays separate
from analytical bundles and fitted artifacts. No scheduler, external LLM service,
message broker or cloud deployment is required.

Detailed references:

- [Backend operations, API and provider contracts](./backend/README.md)
- [Architecture and quantitative implementation notes](./docs/ARCHITECTURE.md)
- [Data/API blueprint](./docs/DATA_API_ARCHITECTURE.md)
- [AI-agent blueprint](./docs/AI_AGENT_ARCHITECTURE.md)
- [Mobile/enterprise blueprint](./docs/MOBILE_AND_ENTERPRISE_SPECS.md)

The blueprint documents include **unimplemented proposals**. They are not a provider
inventory, product-completeness claim or evidence of empirical validation. Older
PDF/HTML/data files at repository root are legacy/reference material, not the runtime
application or verified current outputs.

## Roadmap

Beyond the implemented local WEO slice:

1. Review source readiness, source-specific rights and the analytical indicator registry.
2. Extend reproducible evidence bundles and dossiers across compatible providers.
3. Add authentication, roles, private watchlists/exposures, shared persistence and
   tested recovery before any multi-user deployment.
4. Build source-aware geopolitical timelines without treating media counts as incidents.
5. Add deterministic evidence-linked briefs and explainable change rules evaluated
   only on manual reviewed refresh, with human approval and correction history.
6. Add assumption-led exposure scenarios; instrument valuation requires suitable
   licensed market data.
7. Research macro trend/regime forecasts and geopolitical escalation separately,
   with defined targets, availability-aware histories, baselines and promotion gates.
8. Publish only approved, rights-cleared payloads after authorization, privacy and
   operational release checks.

These are **not completed features**. No composite current-risk score, automatic
briefing agent, public publication workflow or licensed bond/CDS feed is implied.

## License and data rights

Application-authored code is provided under the [MIT license and research disclaimer](./LICENSE).
That does **not** relicense third-party packages, bundled source datasets, provider
observations or linked articles. In particular, the requested `gdelt` and `acled`
wrappers are GPL-3.0 licensed; distribution obligations require review.

Data use remains subject to provider and underlying-source terms, account
entitlements and attribution/retention/sharing requirements. Public API access,
a successful credential check or a public GitHub repository does not grant blanket
redistribution rights. Review the
[rights matrix](./backend/README.md#rights-and-access-gate) before organizational
sharing or publication. No secrets or acquired provider databases belong in Git.

EconQuest is educational/research software, **not investment advice, a credit rating,
a regulated risk system or a solicitation to trade**.
