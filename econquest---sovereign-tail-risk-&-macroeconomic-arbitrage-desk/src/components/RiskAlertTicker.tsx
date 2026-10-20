import React, { useState, useMemo } from 'react';
import { SovereignEntity, LayerOutputs, MacroScenario } from '../types/riskEngine';

export interface RiskAlert {
  id: string;
  type: 'var_breach' | 'arbitrage_alpha' | 'lvar_spike' | 'regime_shift' | 'distress_cliff' | 'macro_shock';
  severity: 'critical' | 'high' | 'warning' | 'alpha';
  sovereignId?: string;
  countryName?: string;
  flag?: string;
  code?: string;
  badge: string;
  headline: string;
  metricLabel: string;
  metricValue: string;
  actionSnippet: string;
  targetTab: 'pipeline' | 'arbitrage' | 'heatmap' | 'cockpit' | 'stress';
  timestamp: string;
}

interface RiskAlertTickerProps {
  sovereigns: SovereignEntity[];
  pipelineOutputs: Record<string, LayerOutputs>;
  activeScenario: MacroScenario;
  onSelectSovereign: (id: string) => void;
  onNavigateToTab: (tab: string) => void;
}

export const RiskAlertTicker: React.FC<RiskAlertTickerProps> = ({
  sovereigns,
  pipelineOutputs,
  activeScenario,
  onSelectSovereign,
  onNavigateToTab
}) => {
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [filterMode, setFilterMode] = useState<'all' | 'var' | 'arbitrage'>('all');
  const [showAllAlertsModal, setShowAllAlertsModal] = useState<boolean>(false);
  const [activeAlertIndex, setActiveAlertIndex] = useState<number>(0);

  // Generate dynamic institutional risk alerts
  const allAlerts: RiskAlert[] = useMemo(() => {
    const list: RiskAlert[] = [];
    const now = '06:12:45 UTC';

    // 1. Scenario alert if active
    if (activeScenario === 'scenarioA_fedTightening') {
      list.push({
        id: 'scenario-fed',
        type: 'macro_shock',
        severity: 'critical',
        badge: 'SCENARIO SHOCK: +200bps FED',
        headline: 'Global USD Monetary Contraction active across all sovereign books',
        metricLabel: 'Spread Widening',
        metricValue: '+280 bps EM Avg',
        actionSnippet: 'Hedging recommended on pegged FX reserves',
        targetTab: 'stress',
        timestamp: now
      });
    } else if (activeScenario === 'scenarioB_commodityCollapse') {
      list.push({
        id: 'scenario-commodity',
        type: 'macro_shock',
        severity: 'high',
        badge: 'SCENARIO SHOCK: -30% COMMODITIES',
        headline: 'Terms-of-Trade collapse penalizing mono-commodity exporters',
        metricLabel: 'Current Account Compression',
        metricValue: '-4.8% GDP',
        actionSnippet: 'Review resource-dependent sovereigns',
        targetTab: 'stress',
        timestamp: now
      });
    } else if (activeScenario === 'scenarioC_malaccaBlockade') {
      list.push({
        id: 'scenario-malacca',
        type: 'macro_shock',
        severity: 'critical',
        badge: 'SCENARIO SHOCK: MALACCA CHOKEPOINT',
        headline: 'Naval transit closure disrupting 25% global maritime commerce',
        metricLabel: 'L-VaR Liquidity Multiplier',
        metricValue: '2.0x Spread Spike',
        actionSnippet: 'Execute maritime bottleneck arbitrage',
        targetTab: 'arbitrage',
        timestamp: now
      });
    }

    // 2. Scan sovereigns for VaR breaches and Arbitrage opportunities
    sovereigns.forEach((s) => {
      const out = pipelineOutputs[s.id];
      if (!out) return;

      const modelProb = out.calibratedPosteriorHazard * 100;
      const marketProb = s.predictionMarket.impliedProbPercent;
      const alphaSpread = modelProb - marketProb;

      // Arbitrage Alert (Threshold: |spread| >= 3.0%)
      if (Math.abs(alphaSpread) >= 3.0) {
        const isLong = alphaSpread > 0;
        list.push({
          id: `arb-${s.id}`,
          type: 'arbitrage_alpha',
          severity: Math.abs(alphaSpread) >= 5.0 ? 'alpha' : 'high',
          sovereignId: s.id,
          countryName: s.name,
          flag: s.flag,
          code: s.code,
          badge: `ARBITRAGE: ${isLong ? '+' : ''}${alphaSpread.toFixed(1)}% Δ`,
          headline: `${s.name} ${s.predictionMarket.marketName} mispricing identified`,
          metricLabel: 'Model vs Market',
          metricValue: `${modelProb.toFixed(1)}% vs ${marketProb.toFixed(1)}%`,
          actionSnippet: isLong
            ? 'LONG DEFAULT PROTECTION (Underpriced Tail-Risk)'
            : 'SHORT PROTECTION / LONG SOVEREIGN BASIS',
          targetTab: 'arbitrage',
          timestamp: now
        });
      }

      // 99% VaR Breaches (Threshold: VaR >= 22.0% or extreme >= 35.0%)
      if (out.var99 >= 22.0) {
        list.push({
          id: `var-${s.id}`,
          type: 'var_breach',
          severity: out.var99 >= 35.0 ? 'critical' : 'high',
          sovereignId: s.id,
          countryName: s.name,
          flag: s.flag,
          code: s.code,
          badge: `VaR 99% BREACH: ${out.var99.toFixed(1)}%`,
          headline: `${s.name} 1-year tail loss threshold exceeded (Limit: 20.0%)`,
          metricLabel: '1Y 99% VaR',
          metricValue: `${out.var99.toFixed(1)}% of debt`,
          actionSnippet: `FRTB Expected Shortfall: ${out.es975.toFixed(1)}%`,
          targetTab: 'pipeline',
          timestamp: now
        });
      }

      // Liquidity-Adjusted VaR (L-VaR) Penalty Spikes
      const lvarPenalty = out.lVar99 - out.var99;
      if (lvarPenalty >= 3.0) {
        list.push({
          id: `lvar-${s.id}`,
          type: 'lvar_spike',
          severity: 'warning',
          sovereignId: s.id,
          countryName: s.name,
          flag: s.flag,
          code: s.code,
          badge: `L-VaR PENALTY: +${lvarPenalty.toFixed(1)}%`,
          headline: `${s.name} bid-ask illiquidity inflating liquidation risk`,
          metricLabel: 'L-VaR Total',
          metricValue: `${out.lVar99.toFixed(1)}%`,
          actionSnippet: 'Stressed market depth penalty applied',
          targetTab: 'heatmap',
          timestamp: now
        });
      }

      // Structural Balance-Sheet Solvency Cliff (Distance to Distress < 1.1σ)
      if (out.distanceToDistress < 1.1) {
        list.push({
          id: `distress-${s.id}`,
          type: 'distress_cliff',
          severity: out.distanceToDistress < 0.8 ? 'critical' : 'high',
          sovereignId: s.id,
          countryName: s.name,
          flag: s.flag,
          code: s.code,
          badge: `CCA CLIFF: DD ${out.distanceToDistress.toFixed(2)}σ`,
          headline: `${s.name} structural default threshold breach under CCA model`,
          metricLabel: 'Merton LGD',
          metricValue: `${out.mertonLgd.toFixed(1)}%`,
          actionSnippet: 'Critical solvency vulnerability',
          targetTab: 'pipeline',
          timestamp: now
        });
      }

      // HMM Crisis State Transition
      if (out.regime === 'Crisis') {
        list.push({
          id: `regime-${s.id}`,
          type: 'regime_shift',
          severity: 'critical',
          sovereignId: s.id,
          countryName: s.name,
          flag: s.flag,
          code: s.code,
          badge: 'HMM CRISIS REGIME',
          headline: `${s.name} Markov-switching model transition into Crisis state`,
          metricLabel: 'Crisis Prob',
          metricValue: `${(out.regimeProbabilities.crisis * 100).toFixed(0)}%`,
          actionSnippet: 'Extreme volatility skew expansion',
          targetTab: 'pipeline',
          timestamp: now
        });
      }
    });

    return list;
  }, [sovereigns, pipelineOutputs, activeScenario]);

  // Filtered alerts based on selected mode
  const filteredAlerts = useMemo(() => {
    if (filterMode === 'var') {
      return allAlerts.filter((a) => a.type === 'var_breach' || a.type === 'lvar_spike' || a.type === 'distress_cliff');
    }
    if (filterMode === 'arbitrage') {
      return allAlerts.filter((a) => a.type === 'arbitrage_alpha');
    }
    return allAlerts;
  }, [allAlerts, filterMode]);

  // Handle clicking on an individual alert
  const handleAlertClick = (alert: RiskAlert) => {
    if (alert.sovereignId) {
      onSelectSovereign(alert.sovereignId);
    }
    onNavigateToTab(alert.targetTab);
  };

  const criticalCount = allAlerts.filter((a) => a.severity === 'critical').length;
  const alphaCount = allAlerts.filter((a) => a.type === 'arbitrage_alpha').length;
  const varCount = allAlerts.filter((a) => a.type === 'var_breach').length;

  return (
    <>
      {/* Institutional Ticker Ribbon */}
      <div className="bg-[#060910] border-b border-[#141d2e] px-4 py-1.5 flex items-center justify-between gap-4 text-xs font-mono select-none overflow-hidden relative">
        {/* Left Indicator & Filter Controls */}
        <div className="flex items-center gap-3 shrink-0 z-10 bg-[#060910] pr-3 shadow-[10px_0_12px_#060910]">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
            </span>
            <span className="text-[11px] font-bold tracking-wider uppercase text-rose-400 flex items-center gap-1">
              <span>Risk Desk Alerts</span>
              <span className="px-1.5 py-0.2 rounded bg-rose-950/80 border border-rose-800/60 text-[10px] text-rose-300">
                {allAlerts.length}
              </span>
            </span>
          </div>

          {/* Quick Filter Buttons */}
          <div className="hidden lg:flex items-center gap-1 bg-[#0b101c] p-0.5 rounded border border-[#1a2538] text-[10px]">
            <button
              onClick={() => setFilterMode('all')}
              className={`px-2 py-0.5 rounded transition-colors ${
                filterMode === 'all' ? 'bg-[#1b2842] text-slate-100 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({allAlerts.length})
            </button>
            <button
              onClick={() => setFilterMode('var')}
              className={`px-2 py-0.5 rounded transition-colors ${
                filterMode === 'var' ? 'bg-rose-950 text-rose-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              VaR Breaches ({varCount})
            </button>
            <button
              onClick={() => setFilterMode('arbitrage')}
              className={`px-2 py-0.5 rounded transition-colors ${
                filterMode === 'arbitrage' ? 'bg-emerald-950 text-emerald-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Arbitrage ({alphaCount})
            </button>
          </div>
        </div>

        {/* Center Marquee Tape */}
        <div
          className="flex-1 overflow-hidden relative group cursor-pointer"
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
        >
          <div
            className={`flex items-center gap-8 whitespace-nowrap animate-ticker ${
              isPaused ? 'ticker-paused' : ''
            }`}
          >
            {/* Render 2 identical passes for seamless continuous marquee loop */}
            {[...filteredAlerts, ...filteredAlerts].map((alert, idx) => {
              const isCrit = alert.severity === 'critical';
              const isAlpha = alert.type === 'arbitrage_alpha';

              return (
                <div
                  key={`${alert.id}-${idx}`}
                  onClick={() => handleAlertClick(alert)}
                  className={`inline-flex items-center gap-2.5 px-3 py-1 rounded border transition-all shrink-0 hover:scale-[1.02] ${
                    isCrit
                      ? 'bg-rose-950/40 border-rose-800/60 text-rose-200 hover:bg-rose-900/50'
                      : isAlpha
                      ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200 hover:bg-emerald-900/50'
                      : 'bg-[#0f172a]/60 border-[#1e293b] text-slate-300 hover:bg-[#1e293b]/70'
                  }`}
                  title="Click to view sovereign in quantitative desk"
                >
                  {alert.flag && <span className="text-sm">{alert.flag}</span>}
                  {alert.code && (
                    <span className="font-bold text-slate-100 bg-[#162138] px-1.5 py-0.5 rounded text-[10px]">
                      {alert.code}
                    </span>
                  )}

                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                      isCrit
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        : isAlpha
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    }`}
                  >
                    {alert.badge}
                  </span>

                  <span className="text-xs font-medium text-slate-200">{alert.headline}</span>

                  <span className="text-[11px] text-slate-400">
                    <span className="text-slate-500">{alert.metricLabel}:</span>{' '}
                    <span className="text-slate-200 font-bold">{alert.metricValue}</span>
                  </span>

                  <span className="text-[10px] text-emerald-400 underline font-sans">Inspect →</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Desk Controls */}
        <div className="flex items-center gap-2 shrink-0 z-10 bg-[#060910] pl-3 shadow-[-10px_0_12px_#060910]">
          {/* Pause / Play Toggle */}
          <button
            onClick={() => setIsPaused(!isPaused)}
            className="p-1 rounded bg-[#0e1626] border border-[#1a2538] text-slate-400 hover:text-slate-200 text-[10px] flex items-center gap-1 transition-colors"
            title={isPaused ? 'Resume live ticker scroll' : 'Pause ticker scroll'}
          >
            {isPaused ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span>Play</span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                <span>Pause</span>
              </>
            )}
          </button>

          {/* View All Modal Trigger */}
          <button
            onClick={() => setShowAllAlertsModal(true)}
            className="px-2 py-1 rounded bg-[#131d30] hover:bg-[#1a2842] border border-[#23314d] text-slate-200 text-[10px] font-semibold transition-colors flex items-center gap-1.5"
          >
            <span>Log ({allAlerts.length})</span>
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
          </button>
        </div>
      </div>

      {/* Institutional All-Alerts Modal Drawer */}
      {showAllAlertsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="bg-[#0b101d] border border-[#1a2438] rounded-xl max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden font-mono">
            {/* Modal Header */}
            <div className="p-4 border-b border-[#1a2438] flex items-center justify-between bg-[#0e1526]">
              <div className="flex items-center gap-2.5">
                <div className="w-3 h-3 rounded-full bg-rose-500 animate-pulse"></div>
                <h3 className="text-sm font-bold text-slate-100 font-sans">
                  Active Sovereign Risk Breaches &amp; Arbitrage Alerts Log
                </h3>
                <span className="text-xs px-2 py-0.5 rounded bg-[#1a2438] text-slate-300 font-mono">
                  {allAlerts.length} Active Events
                </span>
              </div>

              <button
                onClick={() => setShowAllAlertsModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm px-2 py-1 rounded bg-[#141e33] border border-[#1f2d4a]"
              >
                ✕ Close
              </button>
            </div>

            {/* Filter Sub-Bar */}
            <div className="px-4 py-2.5 border-b border-[#1a2438] bg-[#090d18] flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Filter View:</span>
                <button
                  onClick={() => setFilterMode('all')}
                  className={`px-2.5 py-1 rounded text-xs transition-colors ${
                    filterMode === 'all' ? 'bg-emerald-500 text-slate-950 font-bold' : 'bg-[#121a2d] text-slate-300'
                  }`}
                >
                  All ({allAlerts.length})
                </button>
                <button
                  onClick={() => setFilterMode('var')}
                  className={`px-2.5 py-1 rounded text-xs transition-colors ${
                    filterMode === 'var' ? 'bg-rose-500 text-slate-950 font-bold' : 'bg-[#121a2d] text-slate-300'
                  }`}
                >
                  VaR &amp; Solvency ({varCount})
                </button>
                <button
                  onClick={() => setFilterMode('arbitrage')}
                  className={`px-2.5 py-1 rounded text-xs transition-colors ${
                    filterMode === 'arbitrage' ? 'bg-cyan-500 text-slate-950 font-bold' : 'bg-[#121a2d] text-slate-300'
                  }`}
                >
                  Arbitrage Alpha ({alphaCount})
                </button>
              </div>

              <div className="text-slate-500 text-[11px]">
                Showing {filteredAlerts.length} actionable alerts
              </div>
            </div>

            {/* Modal Body / Alerts Table */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {filteredAlerts.map((alert) => {
                const isCrit = alert.severity === 'critical';
                const isAlpha = alert.type === 'arbitrage_alpha';

                return (
                  <div
                    key={alert.id}
                    onClick={() => {
                      handleAlertClick(alert);
                      setShowAllAlertsModal(false);
                    }}
                    className={`p-3.5 rounded-lg border transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                      isCrit
                        ? 'bg-rose-950/20 border-rose-800/40 hover:bg-rose-950/40'
                        : isAlpha
                        ? 'bg-emerald-950/20 border-emerald-800/40 hover:bg-emerald-950/40'
                        : 'bg-[#101728] border-[#1c273e] hover:bg-[#151f35]'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-xl mt-0.5">{alert.flag || '⚠️'}</span>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                              isCrit
                                ? 'bg-rose-900/60 text-rose-300 border border-rose-700/60'
                                : isAlpha
                                ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/60'
                                : 'bg-amber-900/60 text-amber-300 border border-amber-700/60'
                            }`}
                          >
                            {alert.badge}
                          </span>

                          <span className="text-sm font-bold text-slate-100 font-sans">
                            {alert.countryName ? `${alert.countryName} (${alert.code})` : alert.headline}
                          </span>

                          <span className="text-[10px] text-slate-500">{alert.timestamp}</span>
                        </div>

                        <p className="text-xs text-slate-300 mt-1 font-sans">{alert.headline}</p>

                        <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-400">
                          <span>
                            {alert.metricLabel}:{' '}
                            <strong className="text-slate-200">{alert.metricValue}</strong>
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="text-emerald-400 font-sans">{alert.actionSnippet}</span>
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center justify-end">
                      <span className="px-3 py-1.5 rounded bg-[#18233c] hover:bg-emerald-500 hover:text-slate-950 text-slate-200 text-xs font-sans font-medium transition-colors">
                        Launch Desk View →
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-[#0a0e19] border-t border-[#1a2438] flex items-center justify-between text-xs text-slate-500">
              <span>EconQuest Sovereign Tail-Risk Engine · Real-Time Breach Telemetry</span>
              <button
                onClick={() => setShowAllAlertsModal(false)}
                className="text-slate-400 hover:text-slate-200 font-sans"
              >
                Close Log
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
