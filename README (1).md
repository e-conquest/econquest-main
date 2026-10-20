# Panoptix engine

A Python program that implements the paper *Panoptix: Sovereign Tail-Risk and Geopolitical Information Asymmetry: A Quantitative VaR Framework for Macroeconomic Arbitrage*, following its six-layer pipeline (section 3) and its software architecture (Appendix B). It runs on a snapshot of the Geopolitical-Macro Risk Desk workbook (18 countries, 83 indicators, 24 positions, 18 prediction-market contracts) and reproduces the workbook's scorecard exactly before layering the paper's probability, severity, dependence and simulation machinery on top.

## Quick start

```bash
cd panoptix
python3 tests/test_panoptix.py            # 13 checks, about 40 seconds (or: python -m pytest tests)
python3 -m panoptix run --stress --backtest   # full run: 100,000 Sobol paths, scenarios A-C, backtests, dashboard
python3 -m panoptix arbitrage             # prediction-market monitor
python3 -m panoptix stress --scenario A   # one scenario with the full comparison
python3 -m panoptix hmm                   # 3-state Gaussian HMM demo (or --series your.csv)
python3 -m panoptix backtest --history data/backtest_history.csv
python3 -m panoptix serve --port 8080     # JSON API + SSE + dashboard at http://127.0.0.1:8080/
```

Dependencies: numpy, pandas, scipy (standard library for the API server). Optional extras in `pyproject.toml`: `fastapi`/`uvicorn`, `lightgbm`, `hmmlearn`, `statsmodels`, `pytest`.

Outputs land in `outputs/`: `dashboard.html` (open in a browser), `country_risk.csv`, `positions.csv`, `contributions.csv`, `arbitrage.csv`, `latent_correlation.csv`, `stress.json`, `backtest.json`, `run_latest.json`, and `store/` (SQLite database plus the archive of every run and its simulation paths).

## How the paper maps to the code

| Paper | Code | What it does here |
|---|---|---|
| Appendix B.3 Ingestion and ETL | `panoptix/ingestion/` | `Source` adapters (CSV snapshot, Google Sheets REST, Polymarket Gamma, Kalshi v2) and `load_universe`, which validates weights, ids and positions before anything runs. Live market adapters fall back to the snapshot offline and record provenance. |
| Appendix A, 7-pillar scorecard | `panoptix/scorecard/scoring.py` | 83 indicators scored by threshold interpolation (level indicators 0-4), the eight stress-path indicators scored on the combined shock and the worse score kept, worst-indicator blend, capped triggers, analyst adjustments, override floors from the flags, small-state weights, composite and grade. Matches the workbook to 0.1 points. |
| 3.1 Layer 1 hazard | `engine/layer1_hazard.py` | Logistic hazard with the paper's six predictors; `fit_firth` is a Firth penalized estimator for when an event panel exists. A monotone challenger (rating-implied PD, standing in for LightGBM) is reconciled in log-odds space. |
| 3.2 Layer 2 Bayesian update, 3.2.1 prediction markets | `engine/layer2_bayesian.py` | logit(p_post) = logit(p_model) + w_s (S - S_bar) + w_cds z_cds + w_fx z_fx + w_tsi z_tsi; precision-weighted blend with the default-contract prior (tau_market scales with open interest); arbitrage scan with fractional Kelly sizing. |
| 3.3 Layer 3 regimes | `engine/layer3_regime.py` | Rule-based regime (spread, depreciation, reserve loss), the 12-month transition matrix, expected PD and LGD multipliers, and a 3-state Gaussian HMM (EM, Viterbi) in numpy. |
| 3.4 Layer 4 severity | `engine/layer4_severity.py` | Beta haircuts (Cruces-Trebesch mean by asset class, regime-scaled), Merton distance-to-distress from a sovereign balance-sheet proxy, GPD tails for expropriation and political-violence losses, sector and location multipliers. |
| 3.5 Layer 5 dependence, 6.3 L-VaR | `engine/layer5_copula.py` | Global, regional and idiosyncratic factor loadings; Student-t copula with nu = 5 (calm) or 4 (stressed global regime); tail dependence (Theorem 6.1); liquidity-adjusted VaR. |
| 3.6 Layer 6 Monte Carlo, 10 FRTB | `engine/layer6_montecarlo.py` | 100,000 scrambled-Sobol paths, latent t variable per country driving market moves and events, VaR/ES at 95 and 99, ES 97.5 (FRTB), L-VaR, position and country contributions. |
| 9 Stress scenarios | `engine/stress.py` | Scenario A (Fed +200 bps), B (30% commodity collapse), C (Strait of Malacca blockade) as parameter and data patches, compared against the base run. |
| 7.3 and B.6 governance | `validation/backtests.py` | Kupiec, Christoffersen independence and conditional coverage, Acerbi-Szekely Z2, Brier score, Basel zone. Same results as the workbook's Backtesting tab on the sample history. |
| Appendix B.4 persistence | `persistence/store.py` | SQLite tables for runs, country and portfolio metrics as time series, position contributions, arbitrage and indicator definitions (the PostgreSQL / TimescaleDB roles); JSON and `.npz` archive of each run and its paths (the S3 role). |
| Appendix B.5 presentation and API | `presentation/` | REST endpoints, Server-Sent Events, the Interactive Pillar Adjustment Workbench (`POST /api/workbench` reruns with analyst adjustments and pushes the summary to subscribers), and a self-contained dashboard page. |
| B.6 CI | `tests/` | Pure-Python tests; wire `python tests/test_panoptix.py` into any CI runner. |

Everything numeric sits in `data/assumptions.json`, exported from the workbook's Assumptions tab so the two share one parameter set. `data/workbook_reference.json` holds the workbook's outputs for the regression tests.

## Results on the October 2026 snapshot

Base run, 100,000 paths, calm global regime (8 of 18 countries not calm, below the 50% switch), Student-t with 5 degrees of freedom:

| Metric | Program | Workbook |
|---|---|---|
| VaR 99% ($mm) | 65.9 | 59.3 |
| ES 99% ($mm) | 85.2 | 76.9 |
| ES 97.5% FRTB ($mm) | 67.7 | n/a |
| Liquidity cost at 99% ($mm) | 5.28 | 5.28 |
| L-VaR 99% ($mm) | 71.1 | 64.6 |

The program's tail is about 10% heavier than the workbook's because severities are stochastic (Beta haircuts and GPD tails instead of fixed percentages) and because Layer 1 replaces the pure rating prior. Default PDs: Venezuela 99%, Zimbabwe 88%, Senegal 18% (the workbook has 34% after a 52% prediction-market prior; the program weights that thin contract at tau 0.09), Pakistan 14%, Argentina 14%.

Stress scenarios (change in ES 99%): A +86% with 5 of 18 countries moving to Crisis and liquidity cost +81%; B +5% with the expected hard-currency haircut up 27 points; C +24% with liquidity cost +68%. The paper quotes +18.4% for A and +24.6% liquidation cost for C; the scenario sizes are parameters in `engine/stress.py`.

Backtests on the 120-month sample history: 4 exceedances against 1.2 expected, Kupiec p = 0.043 (fail), Christoffersen conditional coverage p = 0.112, Z2 = -2.66 (fail), Basel zone Yellow. Identical to the workbook's Backtesting tab.

## Where the program departs from the paper, and why

1. **Layer 1 coefficients.** The paper's table 7.1 coefficients in raw units do not reproduce its own case study (Debt/GDP 84.2%, ST FX debt/reserves 132.5%, reserves 1.8 months give a linear index of about +3.3, a 96% hazard, not 8.4%). The program therefore applies them to standardized predictors, keeping their signs and relative sizes, and fits a location and scale to the rating-implied PDs. `fit_firth` and `panoptix fit-hazard --panel` replace this once a country-year event panel is available.
2. **LightGBM challenger.** Not installed here; the rating-implied PD is the monotone challenger. Dropping in a LightGBM model only changes `RatingChallenger`.
3. **HMM.** Implemented in numpy and fitted on request (`panoptix hmm --series`). The live run uses the rule-based regime because the snapshot holds no monthly history; the transition matrix in `assumptions.json` is the paper's starting point.
4. **High-frequency signals.** The Text Stress Index is read from the Country Profile (zero in the snapshot) and the FX-vol skew is proxied by 3-month depreciation. Both are inputs the ingestion tier can fill.
5. **Reserves in months of imports** uses exports as the import proxy because imports are not in the snapshot.
6. **Stack.** The paper names C++/Rust, Kafka, TimescaleDB, PostgreSQL, Redis, FastAPI and Next.js. This program keeps the tier boundaries (ingestion, compute, persistence, presentation) so each can be swapped, but runs in one Python process with SQLite and the standard-library HTTP server. Layer 6 takes about 4 seconds for 100,000 paths.

## Data

`data/` is a snapshot of the workbook tabs Inputs, Rulebook, Adjustments, Country Profile (with the stress-depreciation helper), Portfolio VaR (book columns), Prediction Markets (contracts), Assumptions and Backtesting (sample history). Prediction-market prices are illustrative placeholders; `--live-markets` fetches Polymarket and Kalshi prices when the contracts carry a `slug` or `ticker` column and the network allows it.
