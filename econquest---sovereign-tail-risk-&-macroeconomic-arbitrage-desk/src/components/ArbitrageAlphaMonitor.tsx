import React, { useState } from 'react';
import { SovereignEntity, LayerOutputs, MacroScenario } from '../types/riskEngine';

interface ArbitrageAlphaMonitorProps {
  sovereigns: SovereignEntity[];
  pipelineOutputs: Record<string, LayerOutputs>;
  onSelectSovereign: (id: string) => void;
  onNavigateToTab: (tab: string) => void;
  activeScenario?: MacroScenario;
}

export interface PlaybookStrategy {
  id: string;
  name: string;
  archetype: string;
  targetHorizon: string;
  payoutProfile: string;
  tradeStructure: {
    longLeg: string;
    shortLeg: string;
    hedgingRatio: string;
  };
  enablingMacroConditions: {
    indicator: string;
    threshold: string;
    metricKey: string;
    rationale: string;
  }[];
  whitePaperBasis: string;
  paperCaseStudy: string;
  riskDiscipline: string;
}

export const PLAYBOOK_STRATEGIES: PlaybookStrategy[] = [
  {
    id: 'strat-prediction-basis',
    name: 'Prediction Market vs. CDS Basis Arbitrage',
    archetype: 'Micro-Structure & Retail Information Asymmetry',
    targetHorizon: '3 to 12 Months',
    payoutProfile: 'Asymmetric Convex (+300% to +700% on credit event)',
    tradeStructure: {
      longLeg: 'Long Polymarket / Kalshi "Yes" Default / Restructuring Contract',
      shortLeg: 'Short Sovereign CDS Basis / Long Cash Eurobonds (if negative basis)',
      hedgingRatio: 'Quarter-Kelly allocation based on logit divergence'
    },
    enablingMacroConditions: [
      {
        indicator: 'Model vs. Market Divergence (Δ Alpha)',
        threshold: '|p_post - p_market| ≥ +5.0%',
        metricKey: 'alphaSpread',
        rationale: 'Structural price lag where retail crowdsourced order books lag institutional CDS curve bootstrapping.'
      },
      {
        indicator: '5Y Sovereign CDS Spread Momentum',
        threshold: 'Widening ≥ +250 bps in 30 days',
        metricKey: 'cdsWidening',
        rationale: 'Institutional dealers price debt distress before retail prediction markets adjust contract probability.'
      },
      {
        indicator: 'Text Stress Index (TSI)',
        threshold: 'TSI ≥ +2.0σ',
        metricKey: 'tsi',
        rationale: 'FinBERT/GeoBERT automated NLP detects sudden surges in news wire policy and debt moratorium discussion.'
      },
      {
        indicator: 'Short-Term FX Debt / Reserves',
        threshold: 'Short-Term FX Debt > 100% of Reserves',
        metricKey: 'fxDebt',
        rationale: 'Creates an acute external rollover cliff rendering default imminent.'
      }
    ],
    whitePaperBasis: 'Section 1.1, Section 3.2.1 & Section 8.1–8.2',
    paperCaseStudy: 'Section 8 Benchmark Sovereign: Model yields 20.0% vs. Polymarket priced at 12.5% (+7.5% Alpha Divergence).',
    riskDiscipline: 'Cap position size at 15% of book capital using fractional Kelly criterion to prevent illiquid exit slippage.'
  },
  {
    id: 'strat-corporate-cascade',
    name: 'Sovereign-to-Corporate Default Cascade Arbitrage',
    archetype: 'Capital Structure & Sovereign-Bank Subordination',
    targetHorizon: '6 to 18 Months',
    payoutProfile: 'Spread Compression (+180 to +350 bps excess carry)',
    tradeStructure: {
      longLeg: 'Long Senior Secured Export SOE / Resource Corporates (External Collateral)',
      shortLeg: 'Short Sovereign Government Benchmark Debt / Buy Corporate CDS Protection',
      hedgingRatio: 'Beta-neutral debt-at-risk contagion matrix'
    },
    enablingMacroConditions: [
      {
        indicator: "Domestic Banks' Claims on Sovereign",
        threshold: '≥ 35% of total bank assets (Pillar 5 Indicator 5.1)',
        metricKey: 'bankClaims',
        rationale: 'Triggers the diabolical loop where government debt write-downs wipe out commercial banking tier-1 capital.'
      },
      {
        indicator: 'Calibrated Sovereign Default Hazard',
        threshold: 'p_post > 15.0%',
        metricKey: 'hazardRate',
        rationale: 'Forces corporate default probabilities to scale dynamically via sector-specific sovereign beta multipliers.'
      },
      {
        indicator: 'Corporate FX Debt Mismatch',
        threshold: 'Corporate FX loans < 25% of corporate revenue',
        metricKey: 'fxMismatch',
        rationale: 'Exporters retain hard-currency dollar revenues despite domestic sovereign liquidity impairment.'
      }
    ],
    whitePaperBasis: 'Section 3.1.1 (Model Calibration via Sovereign CDS and Corporate Default Cascades)',
    paperCaseStudy: 'Emerging Market banking transmission where commercial banks holding 45% government debt trigger domestic credit contraction.',
    riskDiscipline: 'Verify physical asset jurisdiction abroad to guarantee immunity from domestic decree expropriation.'
  },
  {
    id: 'strat-chokepoint-shock',
    name: 'Maritime Chokepoint & Supply Chain Blockade Arbitrage',
    archetype: 'Geopolitical Telemetry & Physical Trade Bottleneck',
    targetHorizon: '1 to 3 Months (Crisis Horizon)',
    payoutProfile: 'Tail Volatility Expansion (+24.6% liquidation surge)',
    tradeStructure: {
      longLeg: 'Long Freight Container Derivatives & Strategic Commodity Benchmark Swaps',
      shortLeg: 'Short Chokepoint Littoral Consumer Currency Forwards (e.g. IDN / MYR)',
      hedgingRatio: 'Spatial Location Multiplier weighted (2.0x active warzone)'
    },
    enablingMacroConditions: [
      {
        indicator: 'AIS Maritime Vessel Throughput Anomaly',
        threshold: '< -15% transit volume drop or Dark-Fleet Spike',
        metricKey: 'aisAnomaly',
        rationale: 'Physical vessel telemetry anomalies at key straits (Strait of Malacca, Bab-el-Mandeb, Panama Canal).'
      },
      {
        indicator: 'Text Stress Index (TSI)',
        threshold: 'TSI > +3.5σ',
        metricKey: 'tsi',
        rationale: 'Exponential surge in global news wire density around naval blockades, drone strikes, or canal disruptions.'
      },
      {
        indicator: 'Export Concentration',
        threshold: '> 50% exports in single commodity channel (Pillar 2 Indicator 2.11)',
        metricKey: 'exportConcentration',
        rationale: 'Mono-exporter issuers suffer immediate current account deficit explosions.'
      },
      {
        indicator: 'Liquidity-Adjusted VaR (L-VaR)',
        threshold: 'Bid-ask spreads double (μ_spread → 2.0·μ_0)',
        metricKey: 'lVarSpread',
        rationale: 'Market depth collapses during maritime transit closure, inflating portfolio liquidation charges.'
      }
    ],
    whitePaperBasis: 'Section 3.3.1, Section 3.5.1 & Section 9.3 (Scenario C: Strait of Malacca Blockade)',
    paperCaseStudy: '21-day naval closure of Strait of Malacca disrupting 25% global trade and 33% crude oil transport; container rates +350%.',
    riskDiscipline: 'Dynamic delta-hedging to capture rapid mean-reversion once naval transit corridors re-open.'
  },
  {
    id: 'strat-exit-yield-compression',
    name: 'Post-Restructuring Exit Yield Compression',
    archetype: 'Distressed Debt Event-Driven Recovery',
    targetHorizon: '12 to 24 Months',
    payoutProfile: 'Substantial Capital Appreciation (+25% to +50% recovery)',
    tradeStructure: {
      longLeg: 'Long Exchanged Sovereign Eurobonds at Distressed Cash Prices (35¢–55¢)',
      shortLeg: 'Short Secondary 12-Month Default Prediction Market Contracts',
      hedgingRatio: 'Recovery-weighted based on Cruces-Trebesch Generalized Beta'
    },
    enablingMacroConditions: [
      {
        indicator: 'Empirical Restructuring Haircuts',
        threshold: '35% to 65% market-value haircut applied',
        metricKey: 'haircutSeverity',
        rationale: 'Cruces & Trebesch (2013) dataset proves exit yields compress rapidly once deep haircuts are executed.'
      },
      {
        indicator: 'IMF Program Commitment',
        threshold: 'Active Extended Fund Facility (EFF) in good standing',
        metricKey: 'imfProgram',
        rationale: 'Provides official dollar backstop and policy anchor, unlocking bilateral multilateral refinancing.'
      },
      {
        indicator: 'Legal Collective Action Clauses (CACs)',
        threshold: 'Modern Single-Limb Aggregated CACs active',
        metricKey: 'cacs',
        rationale: 'Precludes holdout creditor litigation (e.g. NML Capital precedent) and guarantees legal closure.'
      },
      {
        indicator: 'Net Usable Reserves / IMF ARA Metric',
        threshold: 'Recovering above 100% of IMF ARA standard',
        metricKey: 'araReserves',
        rationale: 'Rebuilds external debt servicing capacity, driving sovereign spread contraction.'
      }
    ],
    whitePaperBasis: 'Section 3.4 & Section 4.2 Benchmark Case Studies (Belize & Chile)',
    paperCaseStudy: 'Belize post-restructuring recovery: Small island switch (Pillar 7 15%) maintains Grade 6 while exit yields compress.',
    riskDiscipline: 'Avoid jurisdictions with extensive unattached state assets abroad subject to foreign judicial seizure.'
  },
  {
    id: 'strat-floating-vs-pegged',
    name: 'Floating FX Cushion vs. Pegged Reserve Drain Arbitrage',
    archetype: 'Macroeconomic Exchange Rate Regime Asymmetry',
    targetHorizon: '6 to 12 Months',
    payoutProfile: 'Relative Value Macro Spread (+280 to +420 bps divergence)',
    tradeStructure: {
      longLeg: 'Long Floating Sovereign Debt (e.g. Chile Eurobonds / Local Currency Yields)',
      shortLeg: 'Short Pegged / Dollarized Sovereign Debt (e.g. Belize, Ecuador)',
      hedgingRatio: 'Duration-matched cross-sovereign pair'
    },
    enablingMacroConditions: [
      {
        indicator: 'Global USD Monetary Shock',
        threshold: 'US Fed Funds rate hike ≥ +200 bps (Scenario A)',
        metricKey: 'fedHike',
        rationale: 'Triggers global capital repatriation into dollar assets, forcing high-yield spread widening.'
      },
      {
        indicator: 'FX Debt Service Due in 24 Months',
        threshold: '> 50% of FX reserves for pegged sovereign (Pillar 1 Indicator 1.2)',
        metricKey: 'fxDebtDue',
        rationale: 'Pegged regimes suffer rapid reserve exhaustion defending parity under terms-of-trade shocks.'
      },
      {
        indicator: 'Floating Currency Insulation (Forensic Rule 2)',
        threshold: 'Floating exchange rate regime absorbs shock via FX pass-through',
        metricKey: 'floatingInsulation',
        rationale: 'Chile absorbs external copper shocks through exchange rate depreciation without central bank reserve depletion.'
      },
      {
        indicator: 'REER Overvaluation',
        threshold: '> 15% above 10-year historical average for pegged sovereign',
        metricKey: 'reerOvervalued',
        rationale: 'Overvalued currency triggers destructive current account deficits and parallel market premiums.'
      }
    ],
    whitePaperBasis: 'Section 4.2 Forensic Rule 2 & Section 9.1 (Scenario A: +200 bps Fed Tightening)',
    paperCaseStudy: 'Forensic Diagnostic 2: Copper shock deducted $18.8B from Chile in error; correct rule models floating absorption.',
    riskDiscipline: 'Monitor central bank official swap lines (e.g. PBOC or Fed repo facilities) that may extend pegged runway.'
  }
];

export const ArbitrageAlphaMonitor: React.FC<ArbitrageAlphaMonitorProps> = ({
  sovereigns,
  pipelineOutputs,
  onSelectSovereign,
  onNavigateToTab,
  activeScenario = 'baseline'
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'scanner' | 'playbook'>('scanner');
  const [portfolioCapital, setPortfolioCapital] = useState<number>(1000000); // $1,000,000 default book
  const [minAlphaThreshold, setMinAlphaThreshold] = useState<number>(3.0); // % threshold
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>('strat-prediction-basis');

  // Calculate live arbitrage opportunities
  const opportunities = sovereigns
    .map((s) => {
      const out = pipelineOutputs[s.id];
      const modelProb = out ? out.calibratedPosteriorHazard * 100 : 0;
      const marketProb = s.predictionMarket.impliedProbPercent;
      const spread = modelProb - marketProb;
      const absSpread = Math.abs(spread);

      // Kelly fraction estimate: f* = (p*b - q) / b
      const b = (100 - marketProb) / Math.max(1, marketProb);
      const p = modelProb / 100;
      const q = 1 - p;
      const rawKelly = Math.max(0, (p * b - q) / Math.max(0.1, b));
      const fractionalKelly = Math.min(0.20, rawKelly * 0.25); // Quarter-Kelly risk restraint

      let action: 'LONG PROTECTION (UNDERPRICED RISK)' | 'SHORT PROTECTION (OVERPRICED RISK)' | 'FAIRLY PRICED' =
        'FAIRLY PRICED';
      if (spread >= minAlphaThreshold) {
        action = 'LONG PROTECTION (UNDERPRICED RISK)';
      } else if (spread <= -minAlphaThreshold) {
        action = 'SHORT PROTECTION (OVERPRICED RISK)';
      }

      return {
        sovereign: s,
        output: out,
        modelProb,
        marketProb,
        spread,
        absSpread,
        action,
        recommendedAllocation: portfolioCapital * fractionalKelly
      };
    })
    .sort((a, b) => b.absSpread - a.absSpread);

  const activeAlphaCount = opportunities.filter((o) => o.action !== 'FAIRLY PRICED').length;

  const currentStrategy =
    PLAYBOOK_STRATEGIES.find((st) => st.id === selectedStrategyId) || PLAYBOOK_STRATEGIES[0];

  // Evaluate current macroeconomic condition readiness for selected strategy
  const evaluateStrategyReadiness = (strat: PlaybookStrategy) => {
    if (strat.id === 'strat-prediction-basis') {
      const candidates = opportunities.filter((o) => o.spread >= 5.0);
      return {
        status: candidates.length > 0 ? 'PRIMED FOR EXECUTION' : 'MONITORING STANDBY',
        color: candidates.length > 0 ? 'text-emerald-400 bg-emerald-950 border-emerald-800' : 'text-slate-400 bg-slate-900 border-slate-700',
        activeCount: candidates.length,
        summary: `${candidates.length} sovereign contracts currently exceed the +5.0% mispricing threshold (led by ${candidates[0]?.sovereign.name || 'none'}).`
      };
    } else if (strat.id === 'strat-corporate-cascade') {
      const highHazard = sovereigns.filter((s) => (pipelineOutputs[s.id]?.calibratedPosteriorHazard || 0) > 0.15);
      return {
        status: highHazard.length > 0 ? 'ACTIVE CONTRACTION WINDOW' : 'MODERATE SETUP',
        color: highHazard.length > 0 ? 'text-amber-400 bg-amber-950 border-amber-800' : 'text-slate-400 bg-slate-900 border-slate-700',
        activeCount: highHazard.length,
        summary: `${highHazard.length} sovereigns currently exhibit >15% default hazard with systemic banking-nexus transmission.`
      };
    } else if (strat.id === 'strat-chokepoint-shock') {
      const isShock = activeScenario === 'scenarioC_malaccaBlockade';
      return {
        status: isShock ? 'CRITICAL DISRUPTION TRIGGERED' : 'MONITORING AIS ANOMALIES',
        color: isShock ? 'text-rose-400 bg-rose-950 border-rose-800' : 'text-cyan-400 bg-cyan-950 border-cyan-800',
        activeCount: isShock ? 3 : 1,
        summary: isShock
          ? 'Scenario C active: 21-day naval closure of Strait of Malacca, TSI > +3.5σ, liquidation costs surging +24.6%.'
          : 'AIS maritime stream operating at nominal throughput; monitoring Malacca & Bab-el-Mandeb.'
      };
    } else if (strat.id === 'strat-exit-yield-compression') {
      const restructuring = sovereigns.filter((s) => s.imfProgramInvolved);
      return {
        status: 'SELECTIVE RECOVERY VIABLE',
        color: 'text-emerald-400 bg-emerald-950 border-emerald-800',
        activeCount: restructuring.length,
        summary: `${restructuring.length} sovereigns have active IMF program anchors (Belize, Sri Lanka, Pakistan, Ghana) stabilizing debt trajectories.`
      };
    } else {
      // floating vs pegged
      const isFedTight = activeScenario === 'scenarioA_fedTightening';
      return {
        status: isFedTight ? 'MAXIMUM ASYMMETRY ACTIVE' : 'STEADY REGIME BAND',
        color: isFedTight ? 'text-amber-400 bg-amber-950 border-amber-800' : 'text-slate-400 bg-slate-900 border-slate-700',
        activeCount: 2,
        summary: isFedTight
          ? 'Scenario A (+200 bps Fed shock) active: Pegged regimes suffer rapid reserve drain while floating sovereigns (Chile) insulate reserves.'
          : 'Baseline terms-of-trade environment; duration pairs established.'
      };
    }
  };

  const strategyReadiness = evaluateStrategyReadiness(currentStrategy);

  return (
    <div className="space-y-6">
      {/* Header & Sub-Tab Switcher */}
      <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400"></div>
            <h2 className="text-lg font-bold text-slate-100">
              Arbitrage Alpha Monitor &amp; Quantitative Trade Playbook
            </h2>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
              {activeAlphaCount} Active Mispricings
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Section 1.1, 3.2.1 &amp; Section 8: Synthesizes model posteriors with prediction markets and outlines
            institutional trade execution playbooks with explicit macroeconomic enabling condition checklists.
          </p>
        </div>

        {/* View Switcher: Scanner vs Playbook */}
        <div className="flex items-center gap-1 p-1 bg-[#090d16] border border-[#1a2438] rounded-lg">
          <button
            onClick={() => setActiveSubTab('scanner')}
            className={`px-3 py-1.5 text-xs font-mono rounded transition-colors whitespace-nowrap ${
              activeSubTab === 'scanner'
                ? 'bg-emerald-500 text-slate-950 font-bold shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Live Alpha Scanner ({activeAlphaCount})
          </button>
          <button
            onClick={() => setActiveSubTab('playbook')}
            className={`px-3 py-1.5 text-xs font-mono rounded transition-colors whitespace-nowrap ${
              activeSubTab === 'playbook'
                ? 'bg-emerald-500 text-slate-950 font-bold shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Trade Strategy Playbook (5)
          </button>
        </div>
      </div>

      {/* VIEW 1: LIVE ARBITRAGE SCANNER */}
      {activeSubTab === 'scanner' && (
        <div className="space-y-6">
          {/* Capital Allocator Control Strip */}
          <div className="p-3.5 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs font-mono">
            <div className="flex items-center gap-4">
              <div>
                <label className="text-slate-400 block text-[11px]">Book Capital:</label>
                <select
                  value={portfolioCapital}
                  onChange={(e) => setPortfolioCapital(Number(e.target.value))}
                  className="bg-[#111726] border border-[#23314d] text-slate-200 rounded px-2.5 py-1 text-xs focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value={500000}>$500,000</option>
                  <option value={1000000}>$1,000,000</option>
                  <option value={2500000}>$2,500,000</option>
                  <option value={5000000}>$5,000,000</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block text-[11px]">Min Alpha Filter:</label>
                <select
                  value={minAlphaThreshold}
                  onChange={(e) => setMinAlphaThreshold(Number(e.target.value))}
                  className="bg-[#111726] border border-[#23314d] text-slate-200 rounded px-2.5 py-1 text-xs focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value={2.0}>± 2.0%</option>
                  <option value={3.0}>± 3.0%</option>
                  <option value={5.0}>± 5.0% (Section 8 threshold)</option>
                  <option value={7.0}>± 7.0% (High Conviction)</option>
                </select>
              </div>
            </div>

            <button
              onClick={() => setActiveSubTab('playbook')}
              className="text-xs text-emerald-400 hover:text-emerald-300 underline font-sans"
            >
              Open Trade Strategy Playbook for Execution Details →
            </button>
          </div>

          {/* Mathematical Synthesis Formula Card */}
          <div className="p-4 bg-[#090d16] border border-[#1a2438] rounded-lg font-mono text-xs text-slate-300 space-y-1">
            <div className="text-slate-400 text-[11px]">
              Dynamic Precision-Weighted Bayesian Synthesis (Section 3.2.1):
            </div>
            <div className="text-emerald-300">
              logit(p_final) = [ τ_model · logit(p_model) + τ_market · logit(p_market) ] / [ τ_model + τ_market ]
            </div>
            <div className="text-slate-400 text-[11px] pt-1">
              Where τ_market scales proportionally with order-book depth and trading volume. When structural mispricing
              divergence exceeds the confidence band, quantitative desks exploit the basis arbitrage before secondary
              bond spread adjustment.
            </div>
          </div>

          {/* Arbitrage Opportunities Grid */}
          <div className="space-y-3">
            {opportunities.map((item) => {
              const s = item.sovereign;
              const isFired = item.action !== 'FAIRLY PRICED';

              return (
                <div
                  key={s.id}
                  className={`p-4 bg-[#0e1524] border rounded-lg transition-all ${
                    isFired
                      ? item.spread > 0
                        ? 'border-emerald-500/40 hover:border-emerald-500/70'
                        : 'border-amber-500/40 hover:border-amber-500/70'
                      : 'border-[#1a2438]'
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    {/* Left: Sovereign & Contract Detail */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{s.flag}</span>
                        <span className="font-bold text-slate-100 text-sm">{s.name}</span>
                        <span className="font-mono text-xs text-slate-400">({s.code})</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-[#111726] text-cyan-400 font-mono border border-[#1a2438]">
                          {s.predictionMarket.marketName}
                        </span>
                      </div>
                      <div className="text-xs text-slate-300 font-medium">
                        {s.predictionMarket.contractTitle}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        Order Book: Bid {s.predictionMarket.orderBookBid.toFixed(1)}¢ · Ask{' '}
                        {s.predictionMarket.orderBookAsk.toFixed(1)}¢ · Volume $
                        {(s.predictionMarket.marketVolumeUsd / 1000000).toFixed(2)}M
                      </div>
                    </div>

                    {/* Middle: Quantitative Pricing Comparison */}
                    <div className="flex items-center gap-6 font-mono text-xs">
                      <div className="text-right">
                        <div className="text-[11px] text-slate-400">Model Posterior</div>
                        <div className="text-lg font-bold text-slate-100">{item.modelProb.toFixed(1)}%</div>
                      </div>

                      <div className="text-slate-600 font-bold">vs</div>

                      <div className="text-right">
                        <div className="text-[11px] text-slate-400">Market Price</div>
                        <div className="text-lg font-bold text-cyan-400">{item.marketProb.toFixed(1)}%</div>
                      </div>

                      <div className="text-right pl-3 border-l border-[#1a2438]">
                        <div className="text-[11px] text-slate-400">Alpha Divergence</div>
                        <div
                          className={`text-lg font-bold ${
                            item.spread > 0 ? 'text-emerald-400' : 'text-amber-400'
                          }`}
                        >
                          {item.spread > 0 ? `+${item.spread.toFixed(1)}%` : `${item.spread.toFixed(1)}%`}
                        </div>
                      </div>
                    </div>

                    {/* Right: Desk Conviction & Quarter-Kelly Allocation */}
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right font-mono">
                        <div
                          className={`text-xs font-bold uppercase tracking-tight ${
                            item.spread > 0
                              ? 'text-emerald-400'
                              : item.spread < 0
                              ? 'text-amber-400'
                              : 'text-slate-400'
                          }`}
                        >
                          {item.action}
                        </div>
                        {item.recommendedAllocation > 0 && (
                          <div className="text-[11px] text-slate-400">
                            Suggested Size: ${(item.recommendedAllocation / 1000).toFixed(0)}k
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() => {
                          onSelectSovereign(s.id);
                          onNavigateToTab('pipeline');
                        }}
                        className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-[#152037] hover:bg-[#1a2846] border border-[#223354] rounded transition-colors"
                      >
                        Inspect Layer 2 →
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 2: TRADE STRATEGY PLAYBOOK */}
      {activeSubTab === 'playbook' && (
        <div className="space-y-6">
          {/* Playbook Navigation Selector */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            {PLAYBOOK_STRATEGIES.map((strat, i) => {
              const isSelected = strat.id === selectedStrategyId;
              return (
                <button
                  key={strat.id}
                  onClick={() => setSelectedStrategyId(strat.id)}
                  className={`p-3 text-left rounded-lg border transition-all ${
                    isSelected
                      ? 'bg-[#152037] border-emerald-500 text-slate-100 shadow-sm'
                      : 'bg-[#0e1524] border-[#1a2438] text-slate-400 hover:text-slate-200 hover:bg-[#121b2d]'
                  }`}
                >
                  <div className="text-[10px] font-mono text-emerald-400 font-semibold">
                    Playbook 0{i + 1}
                  </div>
                  <div className="text-xs font-bold text-slate-100 mt-1 line-clamp-2">
                    {strat.name}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1 truncate">{strat.archetype}</div>
                </button>
              );
            })}
          </div>

          {/* Active Strategy Detailed Playbook Card */}
          <div className="p-6 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-6">
            {/* Top Strategy Header & Real-time Suitability Badge */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1a2438] pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                    {currentStrategy.archetype}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    Horizon: {currentStrategy.targetHorizon}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-slate-100 mt-1">{currentStrategy.name}</h3>
                <div className="text-xs text-slate-400 font-mono mt-0.5">
                  Methodology Grounding: <span className="text-slate-200">{currentStrategy.whitePaperBasis}</span>
                </div>
              </div>

              {/* Real-time Suitability Badge */}
              <div className="p-3 bg-[#090d16] border border-[#1a2438] rounded-lg text-right font-mono text-xs">
                <div className="text-[11px] text-slate-400">Current Macro Match Status:</div>
                <div className={`font-bold mt-0.5 inline-block px-2.5 py-0.5 rounded border ${strategyReadiness.color}`}>
                  {strategyReadiness.status}
                </div>
                <div className="text-[10px] text-slate-500 mt-1 max-w-xs text-right">
                  {strategyReadiness.summary}
                </div>
              </div>
            </div>

            {/* Trade Execution Structure Box */}
            <div className="p-4 bg-[#090d16] border border-[#1a2438] rounded-lg space-y-3">
              <div className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
                Trade Structure &amp; Execution Legs
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
                <div className="p-3 bg-[#111726] border border-emerald-500/30 rounded space-y-1">
                  <div className="text-[11px] text-emerald-400 font-semibold">LONG LEG (Asset / Put)</div>
                  <div className="text-slate-100 font-bold">{currentStrategy.tradeStructure.longLeg}</div>
                </div>

                <div className="p-3 bg-[#111726] border border-rose-500/30 rounded space-y-1">
                  <div className="text-[11px] text-rose-400 font-semibold">SHORT / HEDGE LEG</div>
                  <div className="text-slate-100 font-bold">{currentStrategy.tradeStructure.shortLeg}</div>
                </div>

                <div className="p-3 bg-[#111726] border border-cyan-500/30 rounded space-y-1">
                  <div className="text-[11px] text-cyan-400 font-semibold">HEDGING RATIO &amp; SIZING</div>
                  <div className="text-slate-100 font-bold">{currentStrategy.tradeStructure.hedgingRatio}</div>
                </div>
              </div>
            </div>

            {/* Macroeconomic Conditions Enabling Success (The Core Request) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
                  Macroeconomic Conditions Enabling Strategy Success
                </div>
                <span className="text-[11px] font-mono text-emerald-400">
                  {currentStrategy.enablingMacroConditions.length} Critical Threshold Requirements
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {currentStrategy.enablingMacroConditions.map((cond, cIdx) => (
                  <div
                    key={cIdx}
                    className="p-3.5 bg-[#111726] border border-[#1a2438] rounded-lg space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-200">{cond.indicator}</span>
                      <span className="font-mono text-xs font-bold text-amber-300 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/50">
                        {cond.threshold}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed font-sans">
                      {cond.rationale}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Case Study & Risk Management Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 bg-[#090d16] border border-[#1a2438] rounded-lg space-y-1.5">
                <div className="font-bold text-slate-200 font-mono flex items-center gap-2">
                  <span>Empirical White Paper Validation</span>
                </div>
                <p className="text-slate-400 leading-relaxed font-sans">
                  {currentStrategy.paperCaseStudy}
                </p>
              </div>

              <div className="p-4 bg-[#090d16] border border-[#1a2438] rounded-lg space-y-1.5">
                <div className="font-bold text-slate-200 font-mono flex items-center gap-2">
                  <span>Risk Management &amp; Hedging Discipline</span>
                </div>
                <p className="text-slate-400 leading-relaxed font-sans">
                  {currentStrategy.riskDiscipline}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
