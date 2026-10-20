import React, { useState } from 'react';

type DocSubTab = 'whitepaper' | 'roadmap' | 'architecture';

interface MathFormulaSpec {
  id: string;
  module: string;
  badge: string;
  title: string;
  equation: string;
  variables: string;
  implementationFile: string;
}

const MATH_SPECIFICATIONS: MathFormulaSpec[] = [
  {
    id: 'layer1-ews',
    module: 'Layer 1 · Core Pipeline',
    badge: 'Logistic EWS',
    title: 'Logistic Early Warning System (Prior Default Hazard P₀)',
    equation:
      'z₀ = β₀ + β₁(Debt/GDP) + β₂(ST_FX_Debt*/Reserves) - β₃(ImportCover) + β₄(PrimaryGap) + β₅(PITF) - β₆(ΔCmdty)   ⇒   P₀ = 1 / (1 + exp(-z₀))',
    variables:
      'ST_FX_Debt* applies Forensic Rule 3 (excludes non-callable parent-subsidiary commodity FDI loans). Outputs 12M prior default probability P₀ ∈ (0, 1).',
    implementationFile: 'src/math/riskCalculations.ts',
  },
  {
    id: 'layer2-bayesian',
    module: 'Layer 2 · Core Pipeline',
    badge: 'Bayesian Updater',
    title: 'Market Signal & Prediction Market (τ-Weighted) Log-Odds Update',
    equation:
      'ln(P_post / (1 - P_post)) = ln(P₀ / (1 - P₀)) + w_CDS·LLR_CDS + w_FX·LLR_FX + w_TSI·LLR_TSI + (τ / (1 + τ))·LLR_PM',
    variables:
      'Updates prior log-odds with 5Y CDS spread, 25Δ FX risk-reversal skew, NLP Text Stress Index (TSI), and order-book depth shrinkage factor τ ∈ [0.1, 3.0].',
    implementationFile: 'src/math/riskCalculations.ts',
  },
  {
    id: 'layer3-merton',
    module: 'Layer 3 · Core Pipeline',
    badge: 'Structural CCA',
    title: 'Merton Contingent Claims Sovereign Balance Sheet (Distance-to-Distress)',
    equation:
      'DD = [ ln(V_A / D_B) + (μ - 0.5·σ_A²)·T ] / (σ_A·√T),     P_Merton = Φ(-DD)',
    variables:
      'V_A: Effective sovereign fiscal & liquid reserve asset value; D_B: Sovereign distress barrier; σ_A: Sovereign asset return volatility over horizon T = 1.0 yr.',
    implementationFile: 'src/math/riskCalculations.ts',
  },
  {
    id: 'layer5-evt',
    module: 'Layer 5 · Core Pipeline',
    badge: 'EVT / POT-GPD',
    title: 'Extreme Value Theory (Generalized Pareto Distribution) VaR₉₉ & ES₉₇.₅',
    equation:
      'VaR_α = u + (β / ξ)·[ ((n / N_u)·(1 - α))^(-ξ) - 1 ],     ES_α = (VaR_α + β - ξ·u) / (1 - ξ)',
    variables:
      'Models fat-tailed sovereign jump losses beyond threshold u with heavy-tail shape parameter ξ > 0 and scale β under Basel III FRTB standards.',
    implementationFile: 'src/math/riskCalculations.ts',
  },
  {
    id: 'desk-yield-curve',
    module: 'Institutional Desk 1',
    badge: 'Nelson-Siegel & GFN',
    title: 'Parametric Nelson-Siegel Term Structure & Gross Financing Need (GFN)',
    equation:
      'y(τ) = β₀ + β₁·[(1 - e^(-λτ)) / (λτ)] + β₂·[(1 - e^(-λτ)) / (λτ) - e^(-λτ)] + Δy_shock(τ)   |   Basis_5Y = CDS_5Y - (y_USD(5) - y_UST(5))×100',
    variables:
      'Fits 1Y–30Y USD Eurobond & Local Currency curves. Evaluates 2s10s distress inversion (y(10) - y(2) < 0) and 2026–2032 Debt Maturity Wall rollover ratio vs. net FX reserves.',
    implementationFile: 'src/math/institutionalMacroAnalytics.ts',
  },
  {
    id: 'desk-contagion',
    module: 'Institutional Desk 2',
    badge: '3-Round DebtRank',
    title: 'Multi-Channel Bilateral Contagion Matrix & DebtRank Cascade Simulator',
    equation:
      'W_ij = ω_T·W_ij^trade + ω_B·W_ij^BIS + ω_P·W_ij^EMBI   ⇒   h_i(t) = min(1, h_i(t-1) + γ_regime·λ^(t-1) Σ_{j∈A(t-1)} W_ji·Δh_j(t-1)·(1 - b_i))',
    variables:
      'Propagates sovereign moratorium shocks across Trade, BIS Banking Claims, and EM Portfolio channels over t = 1, 2, 3 cascade rounds with reserve buffer absorption b_i.',
    implementationFile: 'src/math/institutionalMacroAnalytics.ts',
  },
  {
    id: 'desk-taylor-rule',
    module: 'Institutional Desk 3',
    badge: 'Augmented Taylor Rule',
    title: 'Open-Economy Exchange-Rate Augmented Taylor Rule & Policy Rate Gap',
    equation:
      'i_t^Taylor = r_i* + π_t + 0.5·(π_t - π_i*) + 0.5·(y_t - y_i*) + γ_FX·Δe_t^REER   |   Δi_t = i_t^actual - i_t^Taylor,   r_t^real = i_t^actual - π_t',
    variables:
      'Quantifies Behind-the-Curve monetary vulnerability (Δi_t < -150 bps) vs. Orthodox monetary cushion (Δi_t ≥ +50 bps) adjusted for FX pass-through.',
    implementationFile: 'src/math/institutionalMacroAnalytics.ts',
  },
  {
    id: 'desk-portfolio-var',
    module: 'Institutional Desk 4',
    badge: 'Student-t Copula & Euler VaR',
    title: 'Student-t Copula (ν = 4) Euler Component VaR & 5Y CDS Hedge Optimizer',
    equation:
      'VaR₉₉(P) = κ_{t(ν=4)} √(w^T Σ_stress w),     MVaR_i = ∂VaR₉₉(P)/∂w_i,     CVaR_i = w_i·MVaR_i,     Σ_i CVaR_i = VaR₉₉(P)',
    variables:
      'Decomposes multi-sovereign portfolio tail risk exactly via Euler homogeneous allocation and ranks 5Y CDS hedges by marginal VaR reduction per bps of annual carry.',
    implementationFile: 'src/math/institutionalMacroAnalytics.ts',
  },
];

const BIBTEX_CITATION = `@manual{econquest2026sovereign,
  title        = {EconQuest: Sovereign Tail-Risk and Geopolitical Information Asymmetry — A Quantitative VaR Framework for Macroeconomic Arbitrage},
  author       = {{EconQuest Quantitative Sovereign Risk Research Group}},
  year         = {2026},
  month        = {10},
  version      = {2.4.0},
  url          = {https://github.com/your-org/econquest-sovereign-risk-desk},
  note         = {Open-Source Quantitative Sovereign Risk & Macroeconomic Market Intelligence Platform}
}`;

const CFF_CITATION = `cff-version: 1.2.0
title: "EconQuest: Sovereign Tail-Risk, Macroeconomic Arbitrage & Institutional Market Risk Intelligence Desk"
type: software
version: 2.4.0
date-released: "2026-10-20"
license: MIT
repository-code: "https://github.com/your-org/econquest-sovereign-risk-desk"`;

export const WhitePaperViewer: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<DocSubTab>('whitepaper');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const pdfUrl =
    '/assets/aistudio/EconQuest__Sovereign_Tail-Risk_and_Geopolitical_Information_Asymmetry__A_Quantitative_VaR_Framework_for_Macroeconomic_Arbitrage.docx_8137bfe9.pdf';

  const handleCopy = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Interactive Sub-Navigation Bar */}
      <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
                Methodology, Architecture &amp; Open-Source Hub
              </span>
              <span className="text-xs font-mono text-emerald-400 bg-emerald-950/50 border border-emerald-800/60 px-2 py-0.5 rounded">
                Release v2.4.0 · MIT Open Source
              </span>
            </div>
            <h2 className="text-lg font-bold text-slate-100 mt-1">
              EconQuest Quantitative White Paper, Mathematical Specifications &amp; Institutional Roadmap
            </h2>
            <p className="text-xs text-slate-400">
              Synchronized repository documentation covering the 6-Layer Sovereign VaR Engine, 4 Institutional Macro Risk Desks,
              Tier 1–4 Data Lakehouse Blueprints, and Open-Source Governance.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-1.5 text-xs font-medium text-white bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded transition-colors whitespace-nowrap"
            >
              Open White Paper PDF ↗
            </a>
          </div>
        </div>

        {/* Sub-Tab Switcher */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#1a2438]">
          <button
            onClick={() => setActiveSubTab('whitepaper')}
            className={`px-3.5 py-1.5 rounded text-xs font-medium transition-colors ${
              activeSubTab === 'whitepaper'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'bg-[#111726] text-slate-400 hover:text-slate-200 border border-[#1a2438]'
            }`}
          >
            📐 1. White Paper PDF &amp; 10-Module Math Reference
          </button>
          <button
            onClick={() => setActiveSubTab('roadmap')}
            className={`px-3.5 py-1.5 rounded text-xs font-medium transition-colors ${
              activeSubTab === 'roadmap'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'bg-[#111726] text-slate-400 hover:text-slate-200 border border-[#1a2438]'
            }`}
          >
            🗺️ 2. Institutional Roadmap (ROADMAP.md) &amp; Changelog (v2.4.0)
          </button>
          <button
            onClick={() => setActiveSubTab('architecture')}
            className={`px-3.5 py-1.5 rounded text-xs font-medium transition-colors ${
              activeSubTab === 'architecture'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'bg-[#111726] text-slate-400 hover:text-slate-200 border border-[#1a2438]'
            }`}
          >
            🏛️ 3. Open-Source Architecture, Citation (CITATION.cff) &amp; Governance
          </button>
        </div>
      </div>

      {/* SUB-VIEW 1: WHITE PAPER & FULL MATHEMATICAL FORMULAS */}
      {activeSubTab === 'whitepaper' && (
        <div className="space-y-6">
          {/* Peer-Reviewable Mathematical Specifications for All Modules */}
          <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#1a2438] pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-100">
                  Synchronized Mathematical Specifications (README.md &amp; docs/ARCHITECTURE.md)
                </h3>
                <p className="text-xs text-slate-400">
                  Formal econometric equations governing the 6-Layer Sovereign Pipeline and the 4 Institutional Macro &amp; Market Risk Desks.
                </p>
              </div>
              <span className="text-[11px] font-mono text-cyan-400 bg-cyan-950/50 border border-cyan-800/60 px-2.5 py-1 rounded self-start sm:self-auto">
                100% Deterministic TypeScript Execution
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {MATH_SPECIFICATIONS.map((spec) => (
                <div
                  key={spec.id}
                  className="p-3.5 bg-[#111726] border border-[#1a2438] rounded-lg flex flex-col justify-between space-y-2.5"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                        {spec.module}
                      </span>
                      <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/50 border border-emerald-800/50 px-2 py-0.5 rounded">
                        {spec.badge}
                      </span>
                    </div>
                    <h4 className="text-xs font-bold text-slate-100">{spec.title}</h4>
                    <div className="p-2.5 rounded bg-[#090d16] border border-[#1a2438] font-mono text-[11px] text-cyan-300 overflow-x-auto">
                      {spec.equation}
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">{spec.variables}</p>
                  </div>
                  <div className="pt-2 border-t border-[#1a2438]/70 flex items-center justify-between text-[10px] font-mono text-slate-400">
                    <span>Source Module:</span>
                    <span className="text-slate-300">{spec.implementationFile}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Embedded PDF Viewer & Theoretical Foundations */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column: Interactive Document Outline & Theoretical Foundations */}
            <div className="lg:col-span-1 space-y-4">
              <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-3">
                <h3 className="text-sm font-bold text-slate-100">Core Academic Foundations</h3>
                <div className="space-y-2.5 text-xs text-slate-300">
                  <div className="p-2.5 bg-[#111726] rounded border border-[#1a2438]">
                    <div className="font-semibold text-emerald-400 font-mono text-[11px]">
                      Eaton &amp; Gersovitz (1981) · Bulow &amp; Rogoff (1989)
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Sovereign debt lacks a bankruptcy court; repayment is governed by strategic willingness-to-pay,
                      trade sanctions, and attachable commercial assets abroad.
                    </p>
                  </div>

                  <div className="p-2.5 bg-[#111726] rounded border border-[#1a2438]">
                    <div className="font-semibold text-emerald-400 font-mono text-[11px]">
                      Gray, Merton &amp; Bodie (2007)
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Contingent Claims Analysis (CCA) modeling sovereign balance sheets as barrier options on national
                      fiscal and FX reserve asset values.
                    </p>
                  </div>

                  <div className="p-2.5 bg-[#111726] rounded border border-[#1a2438]">
                    <div className="font-semibold text-emerald-400 font-mono text-[11px]">
                      Nelson &amp; Siegel (1987) · Cruces &amp; Trebesch (2013)
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Parsimonious yield curve level/slope/curvature parameterization and empirical sovereign
                      restructuring haircut severity databases.
                    </p>
                  </div>

                  <div className="p-2.5 bg-[#111726] rounded border border-[#1a2438]">
                    <div className="font-semibold text-emerald-400 font-mono text-[11px]">
                      Battiston et al. (2012) · Taylor (1993)
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      DebtRank systemic network distress propagation avoiding cyclic echo bias, paired with open-economy
                      exchange-rate augmented monetary reaction rules.
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-2 text-xs">
                <h3 className="text-sm font-bold text-slate-100">White Paper Document Sections</h3>
                <ul className="space-y-1.5 text-slate-300 font-mono text-[11px]">
                  <li>1. Introduction &amp; Market Arbitrage Mission</li>
                  <li>2. Scope of Covered Loss Perils (6 perils)</li>
                  <li>3. 6-Layer Quantitative VaR Pipeline Architecture</li>
                  <li>4. 7-Pillar Country Scorecard Architecture</li>
                  <li>5. Econometric Identification &amp; Endogeneity</li>
                  <li>6. Mathematical Proofs &amp; Formal Derivations</li>
                  <li>7. Empirical Estimation Results &amp; Diagnostics</li>
                  <li>8. Empirical Case Study Walk-Through</li>
                  <li>9. Macro-Financial Reflexivity Stress Scenarios</li>
                  <li>10. Regulatory Compliance &amp; Basel III / FRTB</li>
                  <li>App. A: Complete 83-Indicator Audit Matrix</li>
                  <li>App. B: Technical Software &amp; Info Architecture</li>
                </ul>
              </div>
            </div>

            {/* Right Column: Embedded PDF Viewer */}
            <div className="lg:col-span-2 p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col h-[750px]">
              <div className="flex items-center justify-between pb-3 border-b border-[#1a2438]">
                <span className="text-xs font-semibold text-slate-200">White Paper Attachment Preview</span>
                <span className="text-[11px] font-mono text-slate-400">PDF Render Canvas</span>
              </div>

              <div className="flex-1 w-full mt-3 rounded bg-[#090d16] border border-[#1a2438] overflow-hidden">
                <iframe src={pdfUrl} title="EconQuest White Paper" className="w-full h-full border-0" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-VIEW 2: INSTITUTIONAL ROADMAP & RELEASE CHANGELOG */}
      {activeSubTab === 'roadmap' && (
        <div className="space-y-6">
          {/* 4-Phase Institutional Roadmap */}
          <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#1a2438] pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-100">
                  Institutional Product &amp; Engineering Roadmap (ROADMAP.md · 2026–2027)
                </h3>
                <p className="text-xs text-slate-400">
                  Phased architecture blueprint scaling EconQuest from a deterministic single-browser engine to a multi-tier institutional risk platform.
                </p>
              </div>
              <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/50 border border-emerald-800/60 px-2.5 py-1 rounded">
                4-Tier Data + Agentic AI + Mobile PWA
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-[#111726] border border-[#1a2438] rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-cyan-400">PHASE 1 · Q4 2026</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                    Core Delivered + Live Connectors
                  </span>
                </div>
                <h4 className="text-sm font-bold text-slate-100">
                  Multi-Tier Macro/Market Data Ingestion &amp; Restructuring Simulator
                </h4>
                <ul className="text-xs text-slate-300 space-y-1 list-disc list-inside">
                  <li>
                    <strong>Tier 1 Official Macro APIs</strong>: Automated connectors for FRED, IMF SDMX 3.0 (IFS/WEO), BIS Locational Banking Statistics, and World Bank IDS.
                  </li>
                  <li>
                    <strong>Tier 2 Market Feeds</strong>: S&amp;P Markit 5Y/10Y CDS curves, 25Δ FX risk reversals, and live Polymarket/Kalshi CLOB order-book depth (τ).
                  </li>
                  <li>
                    <strong>Sovereign Debt Restructuring &amp; CAC Simulator</strong>: Bond-by-bond NPV haircut calculator modeling single-limb vs. two-limb Collective Action Clauses and IMF DSA targets.
                  </li>
                </ul>
              </div>

              <div className="p-4 bg-[#111726] border border-[#1a2438] rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-cyan-400">PHASE 2 · Q1 2027</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                    Spec Complete in docs/AI_AGENT_ARCHITECTURE.md
                  </span>
                </div>
                <h4 className="text-sm font-bold text-slate-100">
                  Agentic AI Workflows, Function-Calling VaR Engine &amp; IC Debate Simulator
                </h4>
                <ul className="text-xs text-slate-300 space-y-1 list-disc list-inside">
                  <li>
                    <strong>Deterministic Function-Calling Risk Agent</strong>: Direct tool bindings to <code>compute_sovereign_var_pipeline</code>, <code>run_contagion_cascade</code>, and <code>optimize_cds_hedge_book</code> (zero LLM math hallucination).
                  </li>
                  <li>
                    <strong>Automated IMF Article IV &amp; Central Bank NLP Parser</strong>: RAG ingestion pipeline extracting fiscal slippages, shadow reserve encumbrances, and Text Stress Index (TSI) deltas.
                  </li>
                  <li>
                    <strong>Multi-Agent IC Debate Simulator</strong>: Adversarial Bull vs. Bear Sovereign Credit Strategist agents synthesized by a Chief Risk Officer (CRO) arbiter into a formal Credit Memo.
                  </li>
                </ul>
              </div>

              <div className="p-4 bg-[#111726] border border-[#1a2438] rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-cyan-400">PHASE 3 · Q2 2027</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800">
                    Spec Complete in docs/DATA_API_ARCHITECTURE.md
                  </span>
                </div>
                <h4 className="text-sm font-bold text-slate-100">
                  Geopolitical AIS Telemetry, Capital Controls &amp; Rust/WASM Acceleration
                </h4>
                <ul className="text-xs text-slate-300 space-y-1 list-disc list-inside">
                  <li>
                    <strong>Tier 3 Geopolitical &amp; Maritime Streams</strong>: Live GDELT 2.0, ACLED conflict events, and AIS vessel transit telemetry across Malacca, Hormuz, Bab el-Mandeb, and Suez.
                  </li>
                  <li>
                    <strong>FX Capital Controls &amp; Parallel NDF Spread Monitor</strong>: Onshore vs. offshore NDF implied yield divergence and convertibility freeze hazard indicator.
                  </li>
                  <li>
                    <strong>Rust / WebAssembly Copula Engine</strong>: 100,000-path Student-t Copula Monte Carlo simulation in <code>&lt; 15ms</code> inside a browser WebWorker.
                  </li>
                </ul>
              </div>

              <div className="p-4 bg-[#111726] border border-[#1a2438] rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-cyan-400">PHASE 4 · Q3–Q4 2027</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800">
                    Spec Complete in docs/MOBILE_AND_ENTERPRISE_SPECS.md
                  </span>
                </div>
                <h4 className="text-sm font-bold text-slate-100">
                  Offline-First Mobile Companion, Push Alerts &amp; SR 11-7 Governance
                </h4>
                <ul className="text-xs text-slate-300 space-y-1 list-disc list-inside">
                  <li>
                    <strong>Offline-First PWA &amp; iOS/Android Companion</strong>: IndexedDB encrypted sovereign snapshot cache for air-gapped or in-flight stress testing.
                  </li>
                  <li>
                    <strong>Real-Time Regime &amp; Alpha-Spread Push Alerts</strong>: Low-latency notifications on HMM regime transitions, 2s10s curve inversions, and |α_spread| &gt; 3.5% triggers.
                  </li>
                  <li>
                    <strong>Federal Reserve SR 11-7 Model Risk Management</strong>: Immutable parameter audit logs, RBAC workspaces, and automated nightly Kupiec/Christoffersen backtest reports.
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Release History / CHANGELOG.md */}
          <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-4">
            <h3 className="text-sm font-bold text-slate-100 border-b border-[#1a2438] pb-2.5">
              Semantic Version Release History (CHANGELOG.md)
            </h3>
            <div className="space-y-3">
              {[
                {
                  version: 'v2.4.0',
                  date: '2026-10-20',
                  title: 'Open-Source Governance Suite, Full Mathematical Documentation & In-App Architecture Viewer',
                  highlights: [
                    'Added CITATION.cff, SECURITY.md, and CHANGELOG.md for academic and institutional governance.',
                    'Expanded README.md and docs/ARCHITECTURE.md with full mathematical formulations for all 4 institutional macro risk desks.',
                    'Upgraded WhitePaperViewer with interactive Roadmap, Changelog, and Open-Source Citation explorer.',
                  ],
                },
                {
                  version: 'v2.3.0',
                  date: '2026-10-18',
                  title: 'Enterprise Data API, Agentic AI & Mobile/SR 11-7 Engineering Specifications',
                  highlights: [
                    'Authored ROADMAP.md, docs/DATA_API_ARCHITECTURE.md, docs/AI_AGENT_ARCHITECTURE.md, and docs/MOBILE_AND_ENTERPRISE_SPECS.md.',
                    'Defined deterministic JSON tool schemas for function-calling quantitative risk agents and Multi-Agent IC Debate workflows.',
                  ],
                },
                {
                  version: 'v2.2.0',
                  date: '2026-10-15',
                  title: '4 Institutional Macro Risk Desks & Investment Committee Tear-Sheet Exporter',
                  highlights: [
                    'Launched YieldCurveMaturityDesk (Nelson-Siegel 1Y–30Y curves & 2026–2032 Debt Maturity Walls).',
                    'Launched ContagionCascadeDesk (Bilateral spillover network & 3-Round DebtRank simulator).',
                    'Launched CentralBankPolicyDesk (Open-economy Augmented Taylor Rule & REER misalignment).',
                    'Launched PortfolioVarOptimizerDesk (Student-t Copula Euler VaR & 5Y CDS Hedge Optimizer) and IcTearSheetModal.',
                  ],
                },
                {
                  version: 'v2.0.0',
                  date: '2026-10-10',
                  title: 'D3.js Natural Earth Global Risk Choropleth, 12M Replay & 7-Pillar Forensic Scorecard',
                  highlights: [
                    'Added WorldRiskMap with spherical polygon winding normalization, maritime chokepoints, and 12-month historical replay.',
                    'Implemented 7-Pillar Vulnerability Scorecard with Forensic Rules 1–4 (Chile FDI exclusion & Belize 15% SIDS climate rule).',
                  ],
                },
                {
                  version: 'v1.0.0',
                  date: '2026-10-01',
                  title: 'Foundational 6-Layer Sovereign VaR Engine & Basel III FRTB Backtesting',
                  highlights: [
                    'Initial release of Logistic EWS, Bayesian Log-Odds Updater, Merton Structural CCA, Gaussian HMM, POT/GPD VaR₉₉/ES₉₇.₅, and Kupiec/Christoffersen backtesting.',
                  ],
                },
              ].map((rel) => (
                <div key={rel.version} className="p-3.5 bg-[#111726] border border-[#1a2438] rounded-lg space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-2 py-0.5 rounded">
                        {rel.version}
                      </span>
                      <span className="text-xs font-bold text-slate-100">{rel.title}</span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-400">{rel.date}</span>
                  </div>
                  <ul className="text-xs text-slate-300 space-y-1 list-disc list-inside pt-1">
                    {rel.highlights.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SUB-VIEW 3: OPEN-SOURCE ARCHITECTURE, CITATION & GOVERNANCE */}
      {activeSubTab === 'architecture' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column: Academic Citation (BibTeX & CITATION.cff) & Security */}
          <div className="space-y-6">
            <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-100">
                  Academic &amp; Institutional Citation (CITATION.cff &amp; BibTeX)
                </h3>
                <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-800">
                  CFF 1.2.0 Compliant
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Use the metadata below to cite EconQuest in academic papers, central bank research notes, or quantitative risk documentation.
              </p>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-slate-300">BibTeX Citation Entry</span>
                  <button
                    onClick={() => handleCopy('bibtex', BIBTEX_CITATION)}
                    className="px-2.5 py-1 text-[11px] font-mono rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-600 transition-colors"
                  >
                    {copiedKey === 'bibtex' ? '✓ Copied BibTeX' : 'Copy BibTeX'}
                  </button>
                </div>
                <pre className="p-3 rounded bg-[#090d16] border border-[#1a2438] font-mono text-[11px] text-slate-300 overflow-x-auto leading-relaxed">
                  {BIBTEX_CITATION}
                </pre>
              </div>

              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-slate-300">CITATION.cff Metadata</span>
                  <button
                    onClick={() => handleCopy('cff', CFF_CITATION)}
                    className="px-2.5 py-1 text-[11px] font-mono rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-600 transition-colors"
                  >
                    {copiedKey === 'cff' ? '✓ Copied CITATION.cff' : 'Copy CITATION.cff'}
                  </button>
                </div>
                <pre className="p-3 rounded bg-[#090d16] border border-[#1a2438] font-mono text-[11px] text-slate-300 overflow-x-auto leading-relaxed">
                  {CFF_CITATION}
                </pre>
              </div>
            </div>

            <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-3">
              <h3 className="text-sm font-bold text-slate-100">
                Security Policy &amp; Deterministic Execution Guarantees (SECURITY.md)
              </h3>
              <div className="space-y-2 text-xs text-slate-300">
                <div className="p-3 bg-[#111726] rounded border border-[#1a2438]">
                  <div className="font-semibold text-emerald-400">1. 100% Local Browser Quantitative Execution</div>
                  <p className="text-slate-400 mt-0.5">
                    All 6 risk pipeline layers, 7 scorecard pillars, Nelson-Siegel yield curves, DebtRank cascades, Taylor Rule gaps, and Copula VaR optimizations execute deterministically in TypeScript with zero external telemetry.
                  </p>
                </div>
                <div className="p-3 bg-[#111726] rounded border border-[#1a2438]">
                  <div className="font-semibold text-emerald-400">2. Portfolio &amp; Stress Scenario Privacy</div>
                  <p className="text-slate-400 mt-0.5">
                    Custom sovereign bond weights, CDS hedge allocations, and Investment Committee (IC) Tear-Sheet exports remain strictly in client memory.
                  </p>
                </div>
                <div className="p-3 bg-[#111726] rounded border border-[#1a2438]">
                  <div className="font-semibold text-emerald-400">3. Quantitative Invariant Verification</div>
                  <p className="text-slate-400 mt-0.5">
                    Every pull request is verified against Euler Component VaR additivity, positive semi-definite stress correlation matrices, and counter-clockwise spherical polygon winding (`d3.geoArea &lt;= 2π`).
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Repository Documentation Suite & Architecture Tree */}
          <div className="space-y-6">
            <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-3">
              <h3 className="text-sm font-bold text-slate-100">
                Repository Documentation &amp; Engineering Specification Suite
              </h3>
              <div className="space-y-2.5 text-xs">
                {[
                  {
                    file: 'README.md',
                    role: 'Primary Documentation & 10-Module Mathematical Reference',
                    desc: 'Covers quickstart, Mermaid system architecture, 6-Layer pipeline equations, 4 institutional macro risk desk formulas, and empirical case studies.',
                  },
                  {
                    file: 'docs/ARCHITECTURE.md',
                    role: 'Deep-Dive Quantitative & TypeScript Domain Specification',
                    desc: 'Documents SovereignEntity and LayerOutputs schemas, Forensic Rules 1–4, Nelson-Siegel, 3-Round DebtRank, Augmented Taylor Rule, and Student-t Copula Euler VaR.',
                  },
                  {
                    file: 'docs/DATA_API_ARCHITECTURE.md',
                    role: '4-Tier Institutional Data Lakehouse & API Ingestion Blueprint',
                    desc: 'TypeScript adapters and TimescaleDB bitemporal schemas for FRED, IMF SDMX 3.0, BIS, Bloomberg B-PIPE, Markit CDS, Polymarket CLOB, GDELT/ACLED, and AIS.',
                  },
                  {
                    file: 'docs/AI_AGENT_ARCHITECTURE.md',
                    role: 'Deterministic Function-Calling Agent & Multi-Agent IC Debate Spec',
                    desc: 'Defines tool schemas for the VaR engine, IMF Article IV NLP RAG extraction pipeline, and adversarial Bull/Bear/CRO Investment Committee simulation.',
                  },
                  {
                    file: 'docs/MOBILE_AND_ENTERPRISE_SPECS.md',
                    role: 'Offline-First Mobile Companion, Rust/WASM & SR 11-7 Governance',
                    desc: 'Specifies IndexedDB offline stress testing, push alert payload schemas, WebWorker WASM Monte Carlo, and Federal Reserve SR 11-7 model risk controls.',
                  },
                  {
                    file: 'CONTRIBUTING.md · CHANGELOG.md · CITATION.cff · SECURITY.md',
                    role: 'Open-Source Community Health & Governance Files',
                    desc: 'Contributor calibration standards, PR/Issue templates, semantic release changelog (v1.0.0–v2.4.0), and academic citation metadata.',
                  },
                ].map((doc) => (
                  <div key={doc.file} className="p-3 bg-[#111726] border border-[#1a2438] rounded-lg">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-cyan-400">{doc.file}</span>
                      <span className="text-[10px] font-mono text-slate-400">{doc.role}</span>
                    </div>
                    <p className="text-[11px] text-slate-300 mt-1">{doc.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
