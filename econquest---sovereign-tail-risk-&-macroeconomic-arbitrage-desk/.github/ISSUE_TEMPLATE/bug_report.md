---
name: 🐛 Bug Report
about: Report a mathematical discrepancy, UI rendering defect, or GeoJSON projection issue
title: "[BUG] "
labels: ["bug"]
assignees: ""
---

## Bug Description
<!-- A clear and concise description of what the bug is. -->

## Affected Desk / Component
- [ ] Global Risk Map (`WorldRiskMap.tsx`) / D3 GeoJSON Projection / 12M Scrubber
- [ ] Sovereign Cockpit & 6-Layer Pipeline (`SovereignCockpit.tsx` / `riskCalculations.ts`)
- [ ] Yield Curve Term Structure & Debt Maturity Wall (`YieldCurveMaturityDesk.tsx`)
- [ ] Systemic Contagion Network & DebtRank Simulator (`ContagionCascadeDesk.tsx`)
- [ ] Central Bank Policy & Taylor Rule Monitor (`CentralBankPolicyDesk.tsx`)
- [ ] Multi-Sovereign Portfolio VaR & CDS Hedge Optimizer (`PortfolioVarOptimizerDesk.tsx`)
- [ ] 7-Pillar Vulnerability Scorecard & Forensic Audit (`SovereignScorecardView.tsx`)
- [ ] Multi-Sovereign Radar & Comparison Matrix (`SovereignComparison.tsx`)
- [ ] Investment Committee (IC) Tear-Sheet & CSV/JSON/XLSX Export (`IcTearSheetModal.tsx` / `exportUtils.ts`)
- [ ] Custom Scenario Stress Builder (`ScenarioBuilderModal.tsx`)
- [ ] Methodology White Paper & Architecture Explorer (`WhitePaperViewer.tsx`)

## Steps to Reproduce
1. Select sovereign: `...`
2. Select active macro stress scenario: `...`
3. Navigate to desk tab: `...`
4. Observe output: `...`

## Expected Quantitative / Visual Behavior
<!-- What should the model formula or UI component produce? -->

## Environment
- Browser & Version:
- Node.js Version:
- Commit / Release Version (see `CHANGELOG.md`):
