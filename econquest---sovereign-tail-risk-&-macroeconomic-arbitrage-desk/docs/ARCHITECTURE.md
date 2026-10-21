# Architecture & Quantitative Specification (`docs/ARCHITECTURE.md`)

This document provides a technical and mathematical deep-dive into the internal architecture of **EconQuest — Sovereign Tail-Risk & Macroeconomic Arbitrage Desk**.

> Current implementation: [fitted annual model guide](../README.md#fitted-annual-models-training-data-and-limitations).
> Offline Python training in `quant/` exports versioned coefficients, LightGBM trees, Gaussian HMM parameters and observed
> country histories to `src/data/fittedAnnualModels.json`. TypeScript performs deterministic inference, not fitting.
> Runtime Layer 1 uses six observed WDI macro predictors; runtime Layer 3 is a learned annual HMM with causal filtering.
> The old coefficients, six demo predictor definitions and threshold regime descriptions below are legacy specifications,
> not the fitted implementation. The fitted snapshot is research-only and fails to beat a constant-rate holdout baseline.
> Other risk layers and monthly chart generators remain illustrative.
>
> Historical evaluation in [`src/math/backtesting.ts`](../src/math/backtesting.ts) runs the fitted classifiers on
> [`historicalEvaluation.json`](../src/data/historicalEvaluation.json), exported from the observed, embargoed test split.
> Brier, log loss, ROC AUC and average precision are calculated from these rows, not display constants.
> Kupiec/Christoffersen statistics require a separately imported, validated forecast/loss archive; without it they are
> unavailable. ES reports a statistic only, without an uncalibrated p-value or pass claim.
> See [historical loss imports](../README.md#historical-loss-import) for the schema and limitations.

---

## Local research service

The default [app shell](../src/App.tsx) renders [ResearchDashboard](../src/components/ResearchDashboard.tsx).
The old full pipeline lives in the lazy-loaded [experimental sandbox](../src/ExperimentalApp.tsx); it is not
an input to observed monitoring, research alerts or research exports.

The [data API client](../src/services/dataApi.ts) validates backend contracts and reports failures explicitly.
The opt-in [macro desk](../src/components/MacroDesk.tsx) uses
[typed evidence contracts](../src/services/analysisApi.ts) and the
[analysis store](../backend/analysis.py). Schema 13 adds immutable reviewed WEO
bundles above, not inside, the native provider stores. An explicit preview/save
workflow freezes source IDs/checksums, country mappings, formulas, native rows,
classifications and review metadata. Only comparable consecutive actual annual
values produce percentage-point changes. Provider activation and fitted models
are untouched. All bundles are local/private with publication blocked pending
rights review; this is not a public API or multi-user authentication implementation.
See [the contract](../backend/README.md#reviewed-macro-evidence-bundles).

The [ACLED adapter](../backend/acled.py) and [schema-12 store](../backend/acled_storage.py)
provide independent private core-event snapshots: global account-accessible records for
30 completed UTC event-date days, with OAuth secrets held only in the backend. The installed
`acled==1.0.2` core client uses an instance-local bounded transport and native parser, without
automatic retries, cookie fallback or token persistence. Exact pagination totals and matching
native-event fingerprints across two complete reads precede staging; immutable originals are
rechecked before activation. Account entitlements, reporting lag, revisions/deletions, approximate
dates/locations and reported fatality uncertainty are explicit. There is no GDELT merge,
deduplication claim, CAST forecast, risk conversion or fitted-model input. See
[the backend contract](../backend/README.md#acled-core-events-contract).

The [GDELT adapter](../backend/gdelt.py) and [separate store](../backend/gdelt_storage.py)
add schema-11 daily global Events research snapshots: all 96 quarter-hour exports of the
latest completed UTC day, immutable ZIP originals and lossless 61-field native records.
The pinned gdeltPyR archive worker runs in a key-free isolated subprocess with strict
ZIP/TSV validation and no network fallback. Complete-day transport/count gates precede
manual staging/activation; interruption never promotes partial data. Filters retain native
GDELT geography/CAMEO identities, not guessed ISO mappings. Machine-coded media records,
event ingestion time and coded event date are not verified incidents, publication times,
headlines, unique incident counts or sovereign-risk predictions. Models and other provider
selections are unchanged. See [the contract](../backend/README.md#gdelt-daily-events-contract).

The local [Python service](../backend/) owns SQLite migrations, raw uploaded files, validated immutable revisions,
staged/quarantined runs, active-version selection and backups. Development requests proxy through Vite;
built assets can be served by the backend on the same loopback origin.

[Research calculations](../src/math/researchMonitoring.ts) use only fitted annual inference or comparable
timestamped observed values. Annual imports overlay the bundled history explicitly, not prior user imports.
Training and holdout artifacts remain unchanged. Market changes are descriptive absolute changes, not portfolio returns.

File publication time may be unknown; upload time is not historical release time.
File freshness uses source observation age and an explicit user-supplied maximum age, independent of import age.
The [Yahoo adapter](../backend/yahoo.py) manually retrieves five years of daily EMB/PCY/ECH/TUR ETF Close
history through an isolated yfinance worker. It validates fund identity, USD units, OHLCV/actions and complete
US ETF session coverage using exchange_calendars/XNYS, with a 30-minute post-close buffer. Every batch is
staged for review before activation; invalid/partial histories quarantine the entire batch. SQLite schema 3
persists provider job state, reports and captured library-response snapshots (not raw HTTP), including
source hashes and settings. It recovers interrupted jobs and preserves prior active data on failure.
Session-close UTC times are distinct from daily local-midnight source labels and unknown publication times.
Calendar freshness requires the latest eligible session for every ETF, with local UI expiry at the next
eligible close. No provider scheduler, connection latency or live event is simulated. No Yahoo key is needed;
future privileged source credentials must remain server-side. See [the backend contract](../backend/README.md#yahoo-data-contract)
for usage restrictions, timeouts and limitations. Market observations never feed the annual models.

The [IMF adapter](../backend/imf.py) queries version-checked CPI/ER/IL/MFS_IR monthly data,
using all-items CPI (`_T`, not food category `CP01`) and an explicit current-economy/territory
mapping. [MacroStore](../backend/macro_storage.py) owns separate schema-4 revisions, raw HTTP
response manifests, source hashes, coverage matrices, retrieved-vintage comparisons and activation.
UN Comtrade is independent research storage at schema 10: immutable per-request originals,
bilateral annual rows, completed task chunks and an append-only quota ledger. Only explicit
bounded passes run; manual resume continues a frozen global availability/data plan after
pause or restart. No partial acquisition can activate. Original HS/SITC classifications,
native values and flags are retained; historical and unreviewed area identities are not
guessed or mapped to successors. Per-chunk source metadata checks do not establish one
global point-in-time vintage. It never supplies fitted-model inputs or automated spillover
analytics. See [the Comtrade contract](../backend/README.md#un-comtrade-contract).

The **Monthly IMF** v2 contract permits disclosed absent pairs without dropping the global
coverage universe. Unknown-status observations are individually excluded with raw values,
flags and exclusion reasons preserved; unrelated valid rows in a response are no longer lost.
Parse/transport/definition failures and entirely unusable baskets still block activation.
Versioned activation validates stored counts and retains the strict gate for legacy v1 snapshots;
reprocessing creates a new immutable revision, not a status rewrite. A supervised cancellable
thread performs only user-triggered acquisition; last valid data remains selected after failure.
The [IMF client](../src/services/imfApi.ts), [macro workspace](../src/components/MacroMonitoring.tsx)
and [native monthly helpers](../src/math/macroMonitoring.ts) do not touch annual or Yahoo observations.
Bounded pages keep the global panel out of the main state payload. Charts break at missing months
and definition/base discontinuities. Native values and `SCALE` are retained without unverified
rescaling. Monetary conversion, cross-country policy/CPI-level comparability, release-lag freshness
and historical publication availability are not asserted. See the
[IMF contract](../backend/README.md#imf-monthly-contract).

The [WEO adapter](../backend/weo.py) is a separate IMF.RES annual-release path. It retrieves
every indicator in the verified WEO catalog for individual economies, retaining all available
years and group-inherited units, methodology and `LATEST_ACTUAL_ANNUAL_DATA` metadata.
The [WEO store](../backend/weo_storage.py) uses schema-5 independent runs/active selection,
immutable series/rows and raw-response manifests. Series metadata is stored once, not repeated
across every annual row; paginated queries keep the global panel out of `/api/state`.
Missing coverage is explicitly allowed for WEO and separately for the versioned Monthly IMF v2 contract.
Consistent release publication/update metadata is required across chunks; failures never activate.

The [WEO workspace](../src/components/WeoMonitoring.tsx) and [annual chart helper](../src/math/weoMonitoring.ts)
separate source-classified actuals (revisable), IMF estimates/projections and unknown boundaries.
Unmapped fiscal cutoffs are not guessed from today's year. Missing years/classification breaks
disconnect chart segments. No unit rescaling, cross-country level comparability, current
freshness or historical publication availability is asserted. This path does not enter the
annual fitted-model overlay or mutate training/holdout artifacts. See the
[WEO contract](../backend/README.md#weo-annual-contract).

The [IDS adapter](../backend/ids.py) reuses the bounded, library-locked World Bank
transport but fixes source 6 and the four-dimensional advanced `WLD` creditor-total
route. Eighteen external-debt indicators and source-specific individual economy metadata
are verified separately from WDI. Schema-9 IDS runs/series/rows/source manifests and
activation remain independent. [The shared World Bank workspace](../src/components/WorldBankMonitoring.tsx)
and [client](../src/services/worldbankApi.ts) use an explicit provider namespace and reject
WDI-shaped IDS observations, mixed sources, invented flags and truncated series.
Native numeric/null values and all supplied source attributes are preserved; absent
actual/estimate/status/precision metadata remains unknown. Future-dated numeric/null
cells are counted and kept only in originals, but retained nonfuture dates are not
asserted actuals. Three overlapping WDI indicators are shared-source evidence, not
independent corroboration. No filling, component aggregation, model inputs or historical
availability claims. See [the IDS contract](../backend/README.md#world-bank-ids-contract).

The [World Bank adapter](../backend/worldbank.py) uses pinned `wbgapi.fetch` for the
reviewed 17-indicator WDI source-2 basket and complete annual history. The public
low-level fetch preserves flags/footnotes discarded by the high-level data helper.
A library-scoped, locked transport reference supplies HTTP timeouts, byte/request/deadline
budgets, source capture and strict pagination/error-envelope validation. It does not
patch shared `requests.get`, mutate installed dependencies or use wbgapi metadata caches.
WDI-specific economy membership is intersected with explicit country aggregate metadata;
blank ISO3 aggregate aliases are accepted only with a matching captured code/name/classification.

Schema 6 uses the same immutable annual-provider table definitions and
[namespace-whitelisted persistence](../backend/weo_storage.py) as WEO, but separate tables,
jobs, revision history, activation and rollback. WDI native records do not use WEO actual-data
boundaries or forecast classifications. [The workspace](../src/components/WorldBankMonitoring.tsx)
and [chart helper](../src/math/worldbankMonitoring.ts) show native values/definitions, missing pairs/years,
flags and footnotes with no interpolation. Failed selections retain explicitly identified
previous reviews, never relabeled as newly requested data. Source-level update/retrieval dates
do not imply publication-time availability or current freshness. No WDI provider snapshot
enters the fitted-model overlay. See [the World Bank contract](../backend/README.md#world-bank-wdi-contract).

The [FRED/ALFRED adapter](../backend/fred.py) uses the same official API for current
and explicitly dated historical snapshots, not an SDK or a full revision-archive download.
Its fixed 18-series basket retains native frequency/units/seasonal adjustment, exact
numeric text, missing dots and query-clipped real-time bounds. Full vintage-date lists
gate historical archive availability: absent earlier vintages do not get current values.
Native metadata is fetched for available historical snapshots; current reference metadata
on an unavailable historical series is explicitly labeled.

Backend-only `FRED_API_KEY` is absent from stored request URLs and browser state. The
bounded standard-library HTTPS transport avoids URL-logging clients, redirects and retries;
responses echoing the credential are deliberately not persisted. A hidden terminal prompt
and [VS Code task](../.vscode/tasks.json) allow entry without a tracked file or shell-history
literal. Provider errors, pagination/count/identity failures, changes in current metadata,
cancellation and deadlines preserve prior active selections.

Schema 7 and [FredStore](../backend/fred_storage.py) use immutable native-dated rows and
**separate current/historical** active selections and rollback chains, reusing only
whitelisted common manifest/source/progress primitives from annual-provider persistence.
The [FRED workspace](../src/components/FredMonitoring.tsx) validates all observation pages
before replacing a chart and labels retained reviews with their original snapshot/date.
Charts do not interpolate nulls or nonconsecutive native periods. Date-level real-time
bounds do not establish intraday or original per-observation release availability.
No new model overlay, cross-series transactional source guarantee, freshness policy,
curve fitting or vintage-aware backtest is claimed.

The [BIS adapter](../backend/bis.py) captures public SDMX XML from fixed LBS v1.0
and total-credit v2.0 contracts. It checks source identities, dimension order and
code definitions, inherits dataset/group/series/observation attributes, validates
native units and free/public classification, and retains exact numeric text,
break/status flags, pre-break values and source hashes. Six fixed quarterly
indicators cover all current individual ISO economies in the union of flow
metadata; each query uses its own flow's membership. Unavailable pairs are
explicit catalog entries, not synthetic observations. No package changes:
`bis-fetcher` extracts speech PDFs and is not a statistics adapter.

Schema 8 and [BisStore](../backend/bis_storage.py) add independent immutable quarterly
rows, series and original manifests, using shared manifest/source/progress primitives
but separate staging, period-aware pages, revision comparison and rollback.
The [BIS workspace](../src/components/BisMonitoring.tsx) assembles full selected histories,
retains failed reviews with their snapshot identity and disconnects chart lines at
missing quarters/nulls, flagged observations and unit changes. Native USD-millions
values are not multiplied again. No derived analytics are claimed.
LBS all-reporting-location totals are residence-based, not consolidated, bilateral
or sovereign-only exposures. Credit sectors overlap. Retrieval dates and current
revised snapshots are not historical publication vintages or point-in-time backtest
inputs. Models, contagion calculations and other provider selections are unchanged.
See [the BIS API contract](../backend/README.md#bis-quarterly-contract).

The mathematical specifications below describe the experimental desks, not the production research path.

---

## 1. Architectural Design Principles

1. **Deterministic Pure Mathematical Core (`src/math/`)**:
   - All econometric models, probability distributions, and scorecard aggregations are implemented as pure, deterministic TypeScript functions with zero React or DOM dependencies.
   - Given identical `SovereignEntity` inputs and `MacroScenario` parameters, `runRiskPipeline()` and `computeScorecard()` are guaranteed to return identical floating-point outputs.
2. **Real-Time Scenario Reactivity**:
   - Changing a macroeconomic shock scenario (or scrubbing the 12-month historical slider) recalculates the entire sovereign universe in `< 2ms` using memoized React pipelines (`useMemo`).
3. **Spherical Topology Safety (`WorldRiskMap.tsx`)**:
   - D3's spherical projection engine (`d3.geoNaturalEarth1`) requires counter-clockwise exterior ring winding (`d3.geoArea <= 2π`). The map renderer includes an automatic spherical area normalizer so custom GeoJSON polygons never invert onto the global canvas.

---

## 2. Core Domain Interfaces (`src/types/riskEngine.ts`)

### `SovereignEntity`
Represents the complete fundamental, structural, and market telemetry state of a sovereign issuer:

```ts
export interface SovereignEntity {
  id: string;
  name: string;
  code: string; // ISO 3166-1 alpha-3 code (links to WORLD_COUNTRIES_GEO)
  flag: string;
  region: string;
  isIslandState: boolean; // Triggers Pillar 7 15% SIDS weight rule
  fxRegime: 'Floating' | 'Pegged' | 'Managed Float';

  // Layer 1: EWS Fundamentals
  publicDebtToGdp: number;
  shortTermFxDebtToReserves: number;
  netReservesToImportsMonths: number;
  primaryDeficitGap: number;
  politicalInstabilityPitf: number;
  commodityExportShock: number;

  // Layer 2: High-Frequency Market Signals & Prediction Market
  cdsSpread5yBps: number;
  fxImpliedVolSkew: number;
  textStressIndex: number;
  predictionMarket: PredictionMarketContract;

  // Layer 3: Structural Merton Parameters
  sovereignAssetValueVA: number;
  distressThresholdDB: number;
  assetVolatilitySigmaA: number;

  // Layer 6: Legal & Recovery Parameters
  imfProgramInvolved: boolean;
  stateAssetsAbroadEligibleBillion: number;
  maritimeChokepointExposure: 'Low' | 'Moderate' | 'Critical';

  // 7-Pillar Base Scores (0-100)
  pillarScores: SovereignPillarScores;
}
```

### `LayerOutputs`
Returned by `runRiskPipeline(sovereign, scenario, customParams)`:

```ts
export interface LayerOutputs {
  ewsPriorProb: number;              // Layer 1: Logistic EWS Prior Hazard [0, 1]
  bayesianPosteriorProb: number;     // Layer 2: Market-Updated Posterior [0, 1]
  mertonDefaultProb: number;         // Layer 3: Structural Merton Default Prob [0, 1]
  distanceToDistress: number;        // Layer 3: Standard deviations to distress barrier
  calibratedPosteriorHazard: number; // Combined isotonic/calibrated 12M default hazard [0, 1]
  regime: 'Calm' | 'Stressed' | 'Crisis'; // Layer 4: Gaussian HMM Regime
  regimeProbabilities: {
    calm: number;
    stressed: number;
    crisis: number;
  };
  var99: number;                     // Layer 5: 99.0% POT/GPD Value-at-Risk (% loss)
  es975: number;                     // Layer 5: 97.5% POT/GPD Expected Shortfall (% loss)
  adjustedLgd: number;               // Layer 6: Legal & IMF-adjusted Loss Given Default [0, 1]
  expectedTailLoss: number;          // Combined Expected Tail Loss
  arbitrageDivergence: number;       // Alpha-Spread = Calibrated Hazard (%) - PM Implied (%)
  arbitrageSignal: 'BUY PROTECTION (Long Risk)' | 'SELL PROTECTION (Short Risk)' | 'NEUTRAL';
}
```

---

## 3. Layer-by-Layer Mathematical Calibration

### Layer 1: Logistic EWS & Macro Scenario Shock Transmission
When an active stress scenario is applied:
- **`scenarioA_fedTightening` (+200 bps US Rates)**:
  - Increases `shortTermFxDebtToReserves` by $\times 1.22$ (refinancing wall amplification).
  - Widens 5Y CDS spreads by $+145\text{ bps}$ (scaled by external fragility).
- **`scenarioB_commodityCollapse` (-30% Global Commodities)**:
  - Applies a $-3.2\sigma$ shock to `commodityExportShock` and drains import cover by $-1.4\text{ months}$.
- **`scenarioC_malaccaBlockade` (Maritime Corridor Closure)**:
  - Multiplies `textStressIndex` and penalizes sovereigns with `'Critical'` or `'Moderate'` `maritimeChokepointExposure`.

### Layer 2: Bayesian Log-Odds & Prediction Market Liquidity Weighting ($\tau$)
Given prior probability $P_0$, prior log-odds are $\eta_0 = \ln\left(\frac{P_0}{1 - P_0}\right)$.
Prediction market implied probability $P_{\text{PM}}$ is converted into a shrinkage-weighted update governed by liquidity parameter $\tau \in [0.1, 3.0]$:
- Deep, liquid order books with tight bid-ask spreads ($\tau > 1.5$) exert stronger Bayesian pull.
- Thin order books with wide spreads ($\tau < 0.6$) are heavily discounted toward the fundamental/CDS posterior, allowing the desk to identify mispriced prediction market contracts (`arbitrageDivergence`).

### Layer 3: Merton Contingent Claims Sovereign Solvency
Computes Distance-to-Distress ($DD$) over horizon $T = 1.0\text{ year}$:
$$DD = \frac{\ln(V_A / D_B) - 0.5 \sigma_A^2}{\sigma_A}$$
Under macro stress scenarios, $V_A$ experiences haircut shocks while $\sigma_A$ scales upward with FX volatility skew.

### Layer 5: Peaks-Over-Threshold (POT) Generalized Pareto Distribution
Tail losses exceeding the $90\text{th}$ percentile threshold $u$ follow a GPD with shape parameter $\xi \in [0.15, 0.42]$ (reflecting heavy fat-tailed sovereign credit jump risk).
Because $\xi > 0$, $\text{ES}_{97.5}$ captures the severity of sovereign restructuring cliffs that standard Gaussian VaR systematically underestimates.

---

## 4. Forensic Accounting Rules (`src/math/scorecardCalculations.ts`)

The 7-Pillar Vulnerability Scorecard implements four automated forensic overrides:
1. **Forensic Rule 1 (Shadow Reserve Haircut)**: Discounts gross central bank reserves by encumbered gold swaps, bilateral central bank swap lines, and state-bank forward liabilities.
2. **Forensic Rule 2 (Pegged FX Depletion Multiplier)**: Sovereigns with `fxRegime === 'Pegged'` or `'Managed Float'` and $< 3.5\text{ months}$ import cover receive a $+15\%$ non-linear penalty on Pillar 2 (External Fragility) to model sudden-stop devaluation cliffs.
3. **Forensic Rule 3 (Intercompany FDI Debt Exclusion)**: Filters out parent-to-subsidiary commodity FDI loans from short-term external debt ratios.
4. **Forensic Rule 4 (SIDS 15% Climate Tail-Risk Rule)**: If `isIslandState === true`, Pillar 7 (Climate & Natural Catastrophe) weight automatically increases from $5\%$ to $15\%$, proportionally re-normalizing Pillars 1–6 so total weights sum to $100\%$.

---

## 5. Choropleth Color Scale & Risk Tiers (`src/data/worldGeoData.ts`)

The `WorldRiskMap` uses a high-contrast 5-tier traffic-light ramp for `totalModel` 12-month calibrated default hazard:

| Tier | Range | Fill Hex | Border Hex | Institutional Interpretation |
| :--- | :---: | :---: | :---: | :--- |
| **Low** | `< 5%` | `#10b981` | `#34d399` | Nominal solvency, ample reserves & low debt burden |
| **Moderate** | `5% – 12%` | `#84cc16` | `#a3e635` | Manageable external debt with minor rollover risks |
| **Stressed** | `12% – 20%` | `#eab308` | `#facc15` | Elevated macro fragility, spread widening & FX drain |
| **Acute** | `20% – 30%` | `#f97316` | `#fb923c` | Critical refinancing cliff, high Merton default probability |
| **Crisis** | `> 30%` | `#f43f5e` | `#fb7185` | Imminent debt moratorium, IMF distress or restructuring |

---

## 6. Institutional Macroeconomic & Market Risk Desks (`src/math/institutionalMacroAnalytics.ts`)

### 6.1 Sovereign Yield Curve Term Structure & Maturity Walls (`YieldCurveMaturityDesk.tsx`)

#### 1. Parametric Nelson-Siegel Term Structure ($1\text{Y}$ to $30\text{Y}$ Tenors)
For each sovereign $i$ and tenor $\tau \in \{1, 2, 3, 5, 7, 10, 20, 30\}$ years, USD Eurobond yields $y_{\text{USD}}(\tau)$ and Local Currency yields $y_{\text{LCY}}(\tau)$ are parameterized via Nelson & Siegel (1987):

$$y(\tau) = \beta_0 + \beta_1 \left(\frac{1 - e^{-\lambda \tau}}{\lambda \tau}\right) + \beta_2 \left(\frac{1 - e^{-\lambda \tau}}{\lambda \tau} - e^{-\lambda \tau}\right) + \Delta y_{\text{scenario}}(\tau)$$

where:
- $\beta_0$: Asymptotic long-run yield level anchored to inflation expectations and long-term fiscal solvency.
- $\beta_1$: Short-end to long-end slope factor. In acute sovereign distress ($\text{CDS}_{5\text{Y}} > 800\text{ bps}$ or $P_{\text{post}} > 20\%$), $\beta_1$ becomes strongly positive as front-end jump-to-default risk pushes $1\text{Y}\text{–}2\text{Y}$ yields above $10\text{Y}\text{–}30\text{Y}$ yields (where prices trade near uniform recovery value $1 - \text{LGD}$).
- $\beta_2$: Medium-term curvature/hump factor governed by decay parameter $\lambda = 0.60$.

#### 2. 2s10s Slope, 5Y CDS-Bond Basis & Gross Financing Need ($\text{GFN}$)
- **2s10s Term Slope**:
  $$S_{2\text{s}10\text{s}} = \left(y_{\text{USD}}(10) - y_{\text{USD}}(2)\right) \times 100 \quad (\text{in bps})$$
- **5Y CDS-Bond Basis**:
  $$\text{Basis}_{5\text{Y}} = \text{CDS}_{5\text{Y}} - \left(y_{\text{USD}}(5) - y_{\text{UST}}(5)\right) \times 100 \quad (\text{in bps})$$
  A negative basis ($\text{Basis}_{5\text{Y}} < -35\text{ bps}$) indicates cash Eurobonds are trading cheaper than synthetic CDS protection, signaling a negative-basis arbitrage opportunity.
- **2026–2032 Debt Maturity Wall & FX Reserve Adequacy**:
  Annual debt service across Eurobonds ($D_t^{\text{Euro}}$), IMF/Multilateral ($D_t^{\text{Multi}}$), Bilateral ($D_t^{\text{Bilat}}$), and Domestic Local Debt ($D_t^{\text{Dom}}$) is compared against net liquid FX reserves $R_{\text{net}}$:
  $$\text{Rollover Ratio}_t = \frac{D_t^{\text{Euro}} + D_t^{\text{Multi}} + D_t^{\text{Bilat}}}{R_{\text{net}}}, \qquad \text{Status}_t = \begin{cases} \text{Covered} & \text{if Rollover Ratio}_t \le 0.45 \\ \text{Tight} & \text{if } 0.45 < \text{Rollover Ratio}_t \le 0.85 \\ \text{Refinancing Wall Breach} & \text{if Rollover Ratio}_t > 0.85 \end{cases}$$

---

### 6.2 Cross-Border Systemic Contagion & DebtRank Simulator (`ContagionCascadeDesk.tsx`)

#### 1. Multi-Channel Bilateral Transmission Matrix ($\mathbf{W}$)
Models bilateral spillover intensity $W_{ij} \in [0, 1]$ from origin sovereign $i$ to destination sovereign $j$ across three structural channels:

$$W_{ij} = \omega_{\text{trade}} W_{ij}^{\text{trade}} + \omega_{\text{bank}} W_{ij}^{\text{BIS}} + \omega_{\text{port}} W_{ij}^{\text{EMBI}}, \qquad \omega_{\text{trade}} + \omega_{\text{bank}} + \omega_{\text{port}} = 1$$

- **Trade Channel ($W_{ij}^{\text{trade}}$)**: Bilateral trade share and commodity supply-chain substitution elasticity.
- **Banking Claims Channel ($W_{ij}^{\text{BIS}}$)**: Cross-border bank holdings of sovereign $i$ debt held by financial institutions in $j$ (calibrated to BIS Locational Banking Statistics).
- **Portfolio Contagion Channel ($W_{ij}^{\text{EMBI}}$)**: Common institutional investor cross-hedging and EMBI Global Diversified index rebalancing correlation.

#### 2. 3-Round DebtRank Distress Propagation
Given an initial default or restructuring shock $\Delta h_s(0) \in (0, 1]$ at origin sovereign $s$, node distress $h_i(t) \in [0, 1]$ evolves over discrete cascade rounds $t \in \{1, 2, 3\}$:

$$h_i(t) = \min\left(1, \; h_i(t-1) + \gamma_{\text{regime}} \cdot \lambda_{\text{decay}}^{t-1} \sum_{j \in \mathcal{A}(t-1)} W_{ji} \cdot \Delta h_j(t-1) \cdot (1 - b_i)\right)$$

where:
- $\mathcal{A}(t-1) = \{j : \Delta h_j(t-1) > 0.01\}$ is the active shock wavefront (each node transmits its marginal distress impulse once per cycle to prevent cyclic explosion).
- $b_i = \min\left(0.65, \; \frac{\text{Import Cover}_i}{18.0}\right)$ is the sovereign FX reserve & IMF precautionary buffer factor.
- $\lambda_{\text{decay}} = 0.68$ is the inter-round temporal attenuation coefficient.
- Induced sovereign CDS widening in round $t$ is $\Delta \text{CDS}_i(t) = \kappa_{\text{CDS}} \cdot \Delta h_i(t) \cdot \text{LGD}_i$.

---

### 6.3 Central Bank Policy Tracker & Taylor Rule Monitor (`CentralBankPolicyDesk.tsx`)

#### 1. Open-Economy Exchange-Rate Augmented Taylor Rule
For each sovereign central bank, the prescriptive nominal benchmark rate $i_t^{\text{Taylor}}$ incorporates inflation gap, output gap, and real effective exchange rate ($\text{REER}$) pass-through:

$$i_t^{\text{Taylor}} = r_i^* + \pi_t + \phi_{\pi}(\pi_t - \pi_i^*) + \phi_y(y_t - y_i^*) + \gamma_{\text{FX}} \cdot \text{PassThrough}_t$$

where:
- $r_i^*$: Neutral real interest rate adjusted for sovereign credit spread risk.
- $\pi_t - \pi_i^*$: Headline CPI overshoot above the central bank target ($\phi_{\pi} = 0.50$).
- $y_t - y_i^*$: Real GDP output gap ($\phi_y = 0.50$).
- $\gamma_{\text{FX}} \cdot \text{PassThrough}_t$: Exchange-rate depreciation pass-through adjustment required to stabilize capital outflows under pegged or managed-float regimes.

#### 2. Policy Rate Gap ($\Delta i_t$) & Real Rate Buffer ($r_t^{\text{real}}$)
$$\Delta i_t = i_t^{\text{actual}} - i_t^{\text{Taylor}}, \qquad r_t^{\text{real}} = i_t^{\text{actual}} - \pi_t$$

Sovereigns with $\Delta i_t < -1.50\%$ are flagged as **`Behind the Curve`** (elevated FX devaluation and inflation de-anchoring risk), whereas $\Delta i_t \ge +0.50\%$ indicates an **`Orthodox / Ahead of the Curve`** monetary stance.

---

### 6.4 Multi-Sovereign Portfolio VaR & CDS Hedge Optimizer (`PortfolioVarOptimizerDesk.tsx`)

#### 1. Student-$t$ Copula ($\nu = 4$) Stress Correlation & Portfolio Tail Risk
Let $\mathbf{w} = (w_1, \dots, w_N)^\top$ denote portfolio weights across $N$ sovereign bond positions with total notional $M_{\text{book}}$ (in USD millions), and let $v_i = \text{VaR}_{99, i}$ denote each sovereign's Layer-5 GPD 99.0% tail loss percentage. Under a **Student-$t$ Copula ($\nu = 4$)**, crisis tail dependence compresses pairwise correlations toward unity:

$$\rho_{ij}^{\text{stress}} = \min\left(0.95, \; \rho_{ij}^{\text{base}} + \theta_{\text{regime}} (1 - \rho_{ij}^{\text{base}})\right), \qquad \Sigma_{ij} = \rho_{ij}^{\text{stress}} \, v_i \, v_j$$

$$\text{VaR}_{99}(P) = \kappa_{t(\nu=4)} \sqrt{\mathbf{w}^\top \boldsymbol{\Sigma} \mathbf{w}}, \qquad \text{ES}_{97.5}(P) = \text{VaR}_{99}(P) \cdot \frac{\sum_{i=1}^N w_i \, \text{ES}_{97.5, i}}{\sum_{i=1}^N w_i \, \text{VaR}_{99, i}}$$

#### 2. Euler Homogeneous Risk Allocation (Marginal & Component VaR)
Because $\text{VaR}_{99}(P)$ is homogeneous of degree 1 in $\mathbf{w}$, Euler's theorem yields an exact additive decomposition:

$$\text{MVaR}_i = \frac{\partial \text{VaR}_{99}(P)}{\partial w_i} = \kappa_{t(\nu=4)} \frac{(\boldsymbol{\Sigma} \mathbf{w})_i}{\sqrt{\mathbf{w}^\top \boldsymbol{\Sigma} \mathbf{w}}}, \qquad \text{CVaR}_i = w_i \cdot \text{MVaR}_i, \qquad \sum_{i=1}^{N} \text{CVaR}_i = \text{VaR}_{99}(P)$$

#### 3. Automated 5Y CDS Protection Hedge Optimizer
For a sovereign position $i$ hedged with 5Y CDS protection ratio $h_i \in [0, 1]$, net effective exposure scales to $w_i^{\text{eff}} = w_i (1 - \beta_{\text{basis}, i} h_i)$, where $\beta_{\text{basis}, i} \in [0.80, 0.96]$ captures CDS-to-cash basis tracking efficiency. The annual carry cost in USD is:

$$\text{CarryCost}_{\text{USD}} = M_{\text{book}} \sum_{i=1}^N w_i \, h_i \left(\frac{\text{CDS}_{5\text{Y}, i}}{10{,}000}\right)$$

The optimizer prioritizes hedging sovereigns with the highest **Marginal Tail-VaR Reduction per bps of CDS Carry**:

$$\text{EfficiencyScore}_i = \frac{\text{MVaR}_i}{\text{CDS}_{5\text{Y}, i} / 100}$$

---

## 7. Related Institutional Roadmap, Governance & Architecture Specifications

- [**`ROADMAP.md`**](../ROADMAP.md) — 2026–2027 Product & Quantitative Engineering Roadmap.
- [**`CHANGELOG.md`**](../CHANGELOG.md) — Full Semantic Version Release History (`v1.0.0` – `v2.4.0`).
- [**`CITATION.cff`**](../CITATION.cff) — Academic & Institutional Citation File Format (CFF 1.2.0) metadata.
- [**`SECURITY.md`**](../SECURITY.md) — Deterministic Client-Side Execution Guarantees & Vulnerability Disclosure Policy.
- [**`docs/DATA_API_ARCHITECTURE.md`**](./DATA_API_ARCHITECTURE.md) — Multi-Tier Live Data Ingestion (FRED, IMF SDMX 3.0, BIS, Bloomberg B-PIPE, Markit CDS, Polymarket CLOB, GDELT/ACLED, AIS Maritime, and Point-in-Time TimescaleDB store).
- [**`docs/AI_AGENT_ARCHITECTURE.md`**](./AI_AGENT_ARCHITECTURE.md) — Deterministic Function-Calling Quantitative Risk Agent schemas, Automated IMF Article IV / Central Bank NLP Parser, and Multi-Agent IC Debate Simulator.
- [**`docs/MOBILE_AND_ENTERPRISE_SPECS.md`**](./MOBILE_AND_ENTERPRISE_SPECS.md) — Offline-First PWA, Native iOS/Android Push Companion, Rust/WASM Monte Carlo acceleration, and Federal Reserve **SR 11-7** Model Risk Governance.
