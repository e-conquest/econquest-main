# Contributing to EconQuest

Thank you for your interest in contributing to **EconQuest — Sovereign Tail-Risk & Macroeconomic Arbitrage Desk**! We welcome contributions from quantitative researchers, macroeconomists, central bank policy analysts, sovereign credit strategists, and software engineers.

---

## 1. Ways to Contribute

1. **New Sovereign Profiles & Empirical Case Studies**:
   - Add emerging, frontier, or G10 sovereign profiles to `src/data/sovereignData.ts` along with their ISO-3166-1 alpha-3 geographic boundary polygons in `src/data/worldGeoData.ts`.
   - Contribute historical crisis trajectory calibrations in `src/data/historicalScorecardData.ts` and `src/data/historicalMapData.ts`.
2. **6-Layer Core Sovereign Risk Pipeline (`src/math/riskCalculations.ts`)**:
   - Refine Logistic EWS weights, Bayesian log-likelihood ratios ($LLR$), Merton structural asset volatility adjustments, Gaussian HMM transition matrices, or POT/GPD tail shape ($\xi$) calibrations.
   - Propose additional forensic accounting adjustments in `src/math/scorecardCalculations.ts`.
3. **Institutional Macro & Market Risk Desks (`src/math/institutionalMacroAnalytics.ts`)**:
   - **Yield Curve & Debt Maturity Walls (`YieldCurveMaturityDesk.tsx`)**: Calibrate Nelson-Siegel ($\beta_0, \beta_1, \beta_2, \lambda$) level/slope/curvature parameters, 5Y CDS-bond basis adjustments, and 2026–2032 creditor amortization schedules.
   - **Systemic Contagion & DebtRank Simulator (`ContagionCascadeDesk.tsx`)**: Contribute bilateral trade, BIS cross-border banking claim, and portfolio rebalancing exposure weights ($W_{ij}$).
   - **Central Bank & Taylor Rule Monitor (`CentralBankPolicyDesk.tsx`)**: Update neutral real rate ($r^*$) estimates, inflation targets ($\pi^*$), output gaps, and FX pass-through elasticities ($\gamma_{\text{FX}}$).
   - **Multi-Sovereign Portfolio VaR & CDS Hedge Optimizer (`PortfolioVarOptimizerDesk.tsx`)**: Enhance Student-$t$ Copula ($\nu = 4$) tail dependence matrices and 5Y CDS carry-efficiency optimization routines.
4. **Visualization, IC Tear-Sheets & Documentation**:
   - Enhance D3.js choropleth overlays (`WorldRiskMap.tsx`), bilateral contagion network graphs, Investment Committee export schemas (`IcTearSheetModal.tsx`), or technical architecture blueprints in `docs/`.

---

## 2. Repository Architecture Overview

```text
src/
├── components/
│   ├── WorldRiskMap.tsx              # D3 Natural Earth Choropleth & 12M Replay Scrubber
│   ├── SovereignCockpit.tsx          # Executive 6-Layer synthesis & institutional quick-jump widgets
│   ├── YieldCurveMaturityDesk.tsx    # Nelson-Siegel curves, 2s10s slope & 2026-2032 Maturity Walls
│   ├── ContagionCascadeDesk.tsx      # Bilateral network graph & 3-round DebtRank cascade simulator
│   ├── CentralBankPolicyDesk.tsx     # Augmented Taylor Rule monitor, real rates & REER misalignment
│   ├── PortfolioVarOptimizerDesk.tsx # Student-t Copula Euler VaR & automated CDS hedge optimizer
│   ├── IcTearSheetModal.tsx          # Interactive Investment Committee Tear-Sheet & snapshot exporter
│   ├── SovereignScorecardView.tsx    # 7-Pillar Vulnerability Scorecard & Forensic Audit
│   ├── SovereignComparison.tsx       # Multi-sovereign radar & cross-country matrix
│   ├── ScenarioBuilderModal.tsx      # Custom macro stress vector builder
│   └── WhitePaperViewer.tsx          # In-app White Paper, Roadmap & Open-Source Architecture Explorer
├── math/
│   ├── riskCalculations.ts           # 6-Layer Risk Pipeline, Merton, Bayesian & POT/GPD math
│   ├── scorecardCalculations.ts      # 7-Pillar Scorecard & Forensic Accounting rules
│   └── institutionalMacroAnalytics.ts# Nelson-Siegel, DebtRank, Taylor Rule & Copula VaR engine
├── data/                             # Calibrated sovereign profiles, GeoJSON polygons & 12M series
├── types/riskEngine.ts               # Strict TypeScript interfaces for all quantitative modules
└── utils/exportUtils.ts              # Deterministic CSV, JSON & multi-sheet XLSX export utilities
```

---

## 3. Development Workflow

### 1. Fork & Clone
```bash
git clone https://github.com/<your-username>/econquest-sovereign-risk-desk.git
cd econquest-sovereign-risk-desk
npm ci
```

Use Node 22 from `.nvmrc`. See the [local research quickstart](./README.md#4-quickstart--local-development)
for the separate Python backend environment and persistent SQLite service. Research monitoring must not consume
experimental pipeline outputs or synthetic quote fallbacks. Provider selection and activation are separate acceptance gates.

### 2. Create a Descriptive Feature Branch
- `feat/sovereign-egypt-profile`
- `quant/nelson-siegel-curvature-calibration`
- `quant/debtrank-bilateral-matrix`
- `fix/map-tooltip-positioning`
- `docs/architecture-formulas`

### 3. Architectural & Coding Standards
- **Strict TypeScript**: Avoid `any` types. Ensure all domain structures and mathematical outputs are explicitly typed in `src/types/riskEngine.ts` or `src/math/institutionalMacroAnalytics.ts`.
- **Pure Mathematical Functions**: All functions inside `src/math/` must remain pure, deterministic, and completely decoupled from React/DOM state.
- **Euler Additivity & Numerical Stability**: Any changes to `PortfolioVarOptimizerDesk` or `institutionalMacroAnalytics.ts` must preserve Euler homogeneous additivity ($\sum_{i=1}^N \text{CVaR}_i = \text{VaR}_{99}(P)$) and ensure correlation matrices remain positive semi-definite under crisis stress regimes.
- **Spherical Winding Order for Map Polygons**: When adding or editing coordinates in `src/data/worldGeoData.ts`, ensure exterior rings are wound counter-clockwise (`d3.geoArea <= 2π`), or verify that `WorldRiskMap.tsx`'s spherical ring normalizer renders them cleanly.
- **No Secrets in Code**: Never commit API keys or `.env` files. Document any optional environment variables in `.env.example`.

### 4. Verification Before Submitting a PR
Run the verification suite locally and ensure zero TypeScript or Vite bundling errors:
```bash
npm run verify
.backend-venv/bin/python -m unittest discover -s backend -p 'test_*.py' -v
.venv/bin/python -m unittest discover -s quant -p 'test_*.py' -v
npm run test:e2e
```

Install dependencies for each Python environment and `npx playwright install chromium` before running those suites.
Browser tests own temporary local services/databases; do not run them against user data. External provider checks,
when implemented, must remain separate from deterministic CI tests.

---

## 4. Pull Request Process

1. Fill out `.github/PULL_REQUEST_TEMPLATE.md` completely, noting any changes to mathematical formulas, copula parameters, or sovereign benchmark weights.
2. If modifying quantitative calibration parameters in `src/math/`, include a before/after comparison table for the benchmark sovereigns (`Chile`, `Belize`, `Sri Lanka`, `Ghana`, `Section 8 Case Study`).
3. Update `README.md`, `docs/ARCHITECTURE.md`, and `CHANGELOG.md` if your PR introduces new formulas or desk capabilities.
4. Ensure the GitHub Actions CI workflow (`.github/workflows/ci.yml`) passes all checks.
