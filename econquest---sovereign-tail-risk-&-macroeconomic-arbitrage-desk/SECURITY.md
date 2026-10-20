# Security Policy

## 1. Architectural Security Guarantees

**EconQuest — Sovereign Tail-Risk & Macroeconomic Arbitrage Desk** is architected with institutional security and data isolation by default:

1. **Deterministic Client-Side Execution**:
   - All quantitative calculations—including the 6-Layer Sovereign VaR Engine, 7-Pillar Vulnerability Scorecard, Nelson-Siegel Yield Curve solver, 3-Round DebtRank Contagion Simulator, Augmented Taylor Rule monitor, and Student-$t$ Copula Euler VaR Optimizer—execute **100% locally in the browser** via pure TypeScript modules (`src/math/`).
2. **Zero External Telemetry & Portfolio Privacy**:
   - Custom macro stress vectors (`ScenarioBuilderModal`), proprietary sovereign bond book allocations (`PortfolioVarOptimizerDesk`), and Investment Committee (IC) Tear-Sheet exports (`IcTearSheetModal`) never leave the analyst's client session.
3. **Zero Client-Side Secret Storage**:
   - The core platform requires zero API keys. When deploying enterprise data connectors (as specified in `docs/DATA_API_ARCHITECTURE.md`), all third-party credentials (FRED, IMF SDMX, Bloomberg B-PIPE, S&P Markit) must be terminated strictly within server-side proxy routes (`/api/*`) and never exposed in `VITE_*` client bundle variables.

---

## 2. Supported Versions

| Version | Supported | Quantitative Engine Status |
| :--- | :---: | :--- |
| **`2.4.x` (Current)** | ✅ Yes | 6-Layer Pipeline + 4 Institutional Macro Desks + IC Tear-Sheet Exporter |
| **`2.2.x – 2.3.x`** | ✅ Yes | Institutional Macro Desks & Architecture Blueprints |
| **`2.0.x`** | ⚠️ Security Fixes Only | Global Choropleth Map & 7-Pillar Forensic Scorecard |
| **`< 2.0.0`** | ❌ End of Life | Legacy 6-Layer Prototype |

---

## 3. Reporting a Vulnerability

We take both **software security vulnerabilities** (XSS, prototype pollution, dependency CVEs, export sanitization) and **critical quantitative model integrity defects** (numerical instability in GPD tail estimators, non-positive-definite copula covariance matrices, or spherical polygon inversion) seriously.

### Disclosure Procedure
1. **Do Not Open a Public GitHub Issue** for exploitable security vulnerabilities.
2. **Submit a Private Security Advisory**:
   - Use the GitHub **Report a Vulnerability** tab under the repository's `Security` advisories section, or email the maintainers with the subject line `[SECURITY] EconQuest Vulnerability Report`.
3. **Include Reproducibility Details**:
   - Affected component or mathematical module (`src/math/*`, `src/utils/exportUtils.ts`, etc.).
   - Exact input payload (`SovereignEntity` parameters or `MacroScenario` vector) that triggers the vulnerability.
   - Impact assessment and suggested remediation.

### Response SLA
- **Acknowledgment**: Within **48 hours** of submission.
- **Triage & Patch Timeline**: Critical security or numerical overflow fixes are targeted for release within **7 business days**.

---

## 4. Export & File Sanitization Standards (`src/utils/exportUtils.ts`)

When contributing to the CSV, JSON, or XLSX export utilities:
- **CSV Formula Injection Prevention**: Ensure string fields exported to `.csv` or `.xlsx` never begin with unescaped spreadsheet execution prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`).
- **Strict Schema Validation**: Imported or serialized scenario JSON payloads must be validated against numeric bounds before passing into `runRiskPipeline()`.
