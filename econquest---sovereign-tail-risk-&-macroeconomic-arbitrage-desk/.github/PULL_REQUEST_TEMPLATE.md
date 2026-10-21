## Summary of Changes

<!-- Provide a concise overview of the quantitative, visual, or architectural changes introduced in this PR. -->

## Affected Modules / Desks

- [ ] **6-Layer Quantitative Risk Pipeline** (`src/math/riskCalculations.ts`)
- [ ] **7-Pillar Vulnerability Scorecard & Forensic Rules** (`src/math/scorecardCalculations.ts`)
- [ ] **Institutional Macro & Market Risk Engine** (`src/math/institutionalMacroAnalytics.ts`)
  - [ ] Yield Curve Term Structure & 2026–2032 Debt Maturity Wall (`YieldCurveMaturityDesk.tsx`)
  - [ ] Systemic Contagion Network & 3-Round DebtRank Simulator (`ContagionCascadeDesk.tsx`)
  - [ ] Central Bank Policy & Augmented Taylor Rule Monitor (`CentralBankPolicyDesk.tsx`)
  - [ ] Multi-Sovereign Portfolio VaR & 5Y CDS Hedge Optimizer (`PortfolioVarOptimizerDesk.tsx`)
- [ ] **D3.js Global Choropleth & 12-Month Historical Replay** (`src/components/WorldRiskMap.tsx`)
- [ ] **Investment Committee (IC) Tear-Sheet & Snapshot Export** (`src/components/IcTearSheetModal.tsx`, `src/utils/exportUtils.ts`)
- [ ] **Sovereign Telemetry & GeoJSON Datasets** (`src/data/*`)
- [ ] **Documentation, Roadmap & Open-Source Governance** (`README.md`, `ROADMAP.md`, `CHANGELOG.md`, `docs/*`)

## Quantitative & Calibration Impact (If Applicable)

<!-- If this PR modifies risk weights, Bayesian LLRs, POT/GPD tail parameters, Nelson-Siegel curves, DebtRank exposure matrices, Taylor Rule parameters, or Copula correlations, summarize the impact on benchmark sovereigns (e.g., Chile, Belize, Sri Lanka, Ghana, Section 8 Case Study): -->

| Sovereign | Metric Affected | Previous Value | New Value | Rationale |
| :--- | :--- | :---: | :---: | :--- |
| e.g., Chile (`CHL`) | Posterior Hazard / 2s10s Slope | `3.1%` | `3.1%` | Unchanged (Forensic Rule 3 preserved) |

## Verification Checklist

- [ ] `npm run lint` passes with zero TypeScript errors (`tsc --noEmit`)
- [ ] `npm run build` succeeds and bundles cleanly via Vite
- [ ] Pure mathematical functions in `src/math/` remain deterministic and free of UI side effects
- [ ] Euler Component VaR additivity ($\sum \text{CVaR}_i = \text{VaR}_{99}(P)$) and positive semi-definite correlation invariants hold under all stress scenarios
- [ ] GeoJSON exterior polygon rings wind counter-clockwise (`d3.geoArea <= 2π`)
- [ ] Documentation (`README.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`) updated if formulas or schemas changed
