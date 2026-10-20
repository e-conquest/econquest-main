# Changelog

All notable changes to **EconQuest — Sovereign Tail-Risk & Macroeconomic Arbitrage Desk** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.4.0] - 2026-10-20

### Added
- **Open-Source Governance & Citation Suite**:
  - Added `CITATION.cff` (Citation File Format 1.2.0) and BibTeX metadata for academic, central bank, and sovereign credit research citation.
  - Added `SECURITY.md` detailing deterministic client-side execution guarantees, zero-telemetry privacy architecture, and vulnerability reporting protocols.
  - Added `CHANGELOG.md` tracking full version history from `v1.0.0` to `v2.4.0`.
- **In-App Open-Source Architecture & Roadmap Explorer (`WhitePaperViewer.tsx`)**:
  - Added interactive sub-navigation inside the **Methodology White Paper** tab allowing analysts to switch between:
    1. *White Paper PDF & Full Mathematical Reference* (6-Layer Sovereign Pipeline + 4 Institutional Macro Risk Desks)
    2. *Institutional 2026–2027 Roadmap & Release Changelog* (`ROADMAP.md` & `CHANGELOG.md`)
    3. *Open-Source Architecture, Citation & Governance* (`docs/ARCHITECTURE.md`, `CITATION.cff` / BibTeX 1-click copy, and `CONTRIBUTING.md` verification standards)
- **Full Mathematical Specifications in `README.md` & `docs/ARCHITECTURE.md`**:
  - Added peer-reviewable mathematical formulations for the 4 institutional macro risk desks: Parametric Nelson-Siegel Yield Curve & Gross Financing Need (GFN), 3-Round DebtRank Systemic Contagion Network, Open-Economy Augmented Taylor Rule & Real Rate Monitor, and Student-$t$ Copula ($\nu = 4$) Euler Component VaR & 5Y CDS Hedge Ratio Optimizer.

### Changed
- Updated `CONTRIBUTING.md`, `.github/PULL_REQUEST_TEMPLATE.md`, and `.github/ISSUE_TEMPLATE/*` to cover all 10 interactive desk modules, IC Tear-Sheet export schemas, and `docs/*` architectural blueprints.

---

## [2.3.0] - 2026-10-18

### Added
- **Institutional Product & Engineering Roadmap (`ROADMAP.md`)**:
  - Defined 4-phase engineering execution timeline (`Q4 2026 – Q4 2027`) covering Sovereign Debt Restructuring & CAC Simulator, FX Capital Controls & NDF Monitor, Commodity Chokepoint Elasticity, and Intraday Sovereign Liquidity stress.
- **Technical Architecture Blueprints (`docs/`)**:
  - `docs/DATA_API_ARCHITECTURE.md`: 4-Tier data ingestion specification covering Official Macro (FRED, IMF SDMX 3.0, BIS, World Bank), Institutional Market Feeds (Bloomberg B-PIPE, S&P Markit CDS, LSEG/Refinitiv, Polymarket CLOB), Geopolitical Telemetry (GDELT 2.0, ACLED, AIS Maritime Chokepoints), and Central Bank / Ministry PDF Scraping.
  - `docs/AI_AGENT_ARCHITECTURE.md`: Deterministic Function-Calling Quantitative Risk Agent (`compute_sovereign_var_pipeline`, `run_contagion_cascade`, `optimize_cds_hedge_book`), Automated IMF Article IV NLP Parser, and Multi-Agent Investment Committee (IC) Debate Simulator.
  - `docs/MOBILE_AND_ENTERPRISE_SPECS.md`: Offline-first Service Worker / IndexedDB PWA architecture, iOS/Android Push Alert Companion, Rust/WASM Monte Carlo acceleration, and Federal Reserve **SR 11-7** Model Risk Governance.

---

## [2.2.0] - 2026-10-15

### Added
- **Yield Curve Term Structure & Debt Maturity Wall Desk (`YieldCurveMaturityDesk.tsx`)**:
  - Parametric **Nelson-Siegel** yield curve generator across 1Y–30Y tenors for USD Eurobonds, Local Currency sovereign bonds, and US Treasury benchmarks.
  - Automated 2s10s slope inversion badge, 5Y CDS-bond basis tracker, and **2026–2032 Sovereign Debt Maturity Wall** stacked by creditor class (Eurobonds, IMF/Multilateral, Bilateral Paris/Non-Paris Club, Domestic Local Debt) against net usable FX reserves.
- **Systemic Contagion Network & Cascade Simulator (`ContagionCascadeDesk.tsx`)**:
  - Interactive D3.js force/bilateral exposure graph and **3-Round DebtRank Cascade Simulator** modeling sovereign default spillovers across Trade, BIS Cross-Border Banking Claims, and Global EM Portfolio channels.
- **Central Bank Policy Tracker & Taylor Rule Monitor (`CentralBankPolicyDesk.tsx`)**:
  - Open-economy **Augmented Taylor Rule** calculator quantifying behind-the-curve policy rate gaps ($\Delta i_t$), ex-post real interest rates, FX pass-through sensitivity, and REER valuation misalignment.
- **Multi-Sovereign Portfolio VaR & Hedge Optimizer (`PortfolioVarOptimizerDesk.tsx`)**:
  - Customizable multi-sovereign bond book with **Student-$t$ Copula ($\nu = 4$) Euler Component VaR** decomposition, diversification benefit metrics, and an automated **5Y CDS Hedge Ratio Optimizer**.
- **Interactive Investment Committee (IC) Tear-Sheet Exporter (`IcTearSheetModal.tsx`)**:
  - Executive single-sovereign Credit Memo & Global Macro Risk Pack modal with 1-click deterministic **JSON**, **CSV**, and **XLSX** snapshot exports.

---

## [2.0.0] - 2026-10-10

### Added
- **Interactive D3.js Global Risk Choropleth (`WorldRiskMap.tsx`)**:
  - Natural Earth spherical projection with automatic counter-clockwise ring winding normalization (`d3.geoArea <= 2π`), 5 discrete traffic-light risk tiers, maritime chokepoint overlays, and a **12-Month Historical Time-Series Scrubber** (`Nov 2025 – Oct 2026`).
- **7-Pillar Macroeconomic Vulnerability Scorecard (`SovereignScorecardView.tsx`)**:
  - Automated Forensic Accounting Rules (Shadow Reserve Haircut, Pegged FX Depletion Multiplier, Rule 3 Intercompany FDI Debt Exclusion, and SIDS 15% Climate Weight Reallocation).
- **Multi-Sovereign Radar & Cross-Country Comparison (`SovereignComparison.tsx`)**:
  - Side-by-side radar diagnostics and sortable cross-country arbitrage table across 10 benchmark sovereigns.

---

## [1.0.0] - 2026-10-01

### Added
- Initial release of the **6-Layer Quantitative Sovereign Risk Pipeline (`src/math/riskCalculations.ts`)**:
  - Layer 1: Logistic Early Warning System (EWS) Prior Hazard.
  - Layer 2: Bayesian Market Signal & Prediction Market ($\tau$-weighted) Log-Odds Updater.
  - Layer 3: Structural Merton Sovereign Balance Sheet & Distance-to-Distress ($DD$).
  - Layer 4: 3-State Gaussian Hidden Markov Model (HMM) Regime Switching (`Calm`, `Stressed`, `Crisis`).
  - Layer 5: Extreme Value Theory (POT / Generalized Pareto Distribution) $\text{VaR}_{99}$ & $\text{ES}_{97.5}$.
  - Layer 6: Legal, CAC, & IMF Seniority Loss Given Default ($\text{LGD}$) Haircut.
- **Basel III FRTB Traffic-Light Backtesting**:
  - Kupiec Proportion of Failures ($LR_{\text{POF}}$) and Christoffersen Independence ($LR_{\text{ind}}$) statistical validation over a 250-day rolling window.
