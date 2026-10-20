import React, { useState, useMemo } from 'react';
import { SovereignEntity, LayerOutputs, MacroScenario, CustomScenarioParams } from '../types/riskEngine';
import { PeerComparisonOverlay } from './PeerComparisonOverlay';
import {
  computeSovereignYieldCurve,
  computeDebtMaturityWall,
  computeCentralBankPolicyProfile,
  simulateContagionCascade,
  computePortfolioRiskAttribution,
  PRESET_INSTITUTIONAL_BOOKS
} from '../math/institutionalMacroAnalytics';

interface SovereignCockpitProps {
  sovereigns: SovereignEntity[];
  pipelineOutputs: Record<string, LayerOutputs>;
  selectedSovereignId: string;
  onSelectSovereign: (id: string) => void;
  onNavigateToTab: (tab: string) => void;
  activeScenario: MacroScenario;
  customParams?: CustomScenarioParams;
  onOpenTearSheetModal?: () => void;
}

export const SovereignCockpit: React.FC<SovereignCockpitProps> = ({
  sovereigns,
  pipelineOutputs,
  selectedSovereignId,
  onSelectSovereign,
  onNavigateToTab,
  activeScenario,
  customParams,
  onOpenTearSheetModal
}) => {
  const [regionFilter, setRegionFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [onlyArbitrage, setOnlyArbitrage] = useState<boolean>(false);
  const [sortField, setSortField] = useState<'name' | 'posterior' | 'score' | 'cds' | 'arbitrage'>('posterior');
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [isPeerComparisonOpen, setIsPeerComparisonOpen] = useState<boolean>(false);
  const [peerComparisonTargetId, setPeerComparisonTargetId] = useState<string>(selectedSovereignId);

  const activeSovereign = useMemo(
    () => sovereigns.find((s) => s.id === selectedSovereignId) || sovereigns[0],
    [sovereigns, selectedSovereignId]
  );
  const activeOut = pipelineOutputs[activeSovereign.id];

  const activeYieldCurve = useMemo(
    () => computeSovereignYieldCurve(activeSovereign, activeOut, activeScenario, customParams),
    [activeSovereign, activeOut, activeScenario, customParams]
  );
  const activeMaturityWall = useMemo(
    () => computeDebtMaturityWall(activeSovereign, activeOut, activeScenario),
    [activeSovereign, activeOut, activeScenario]
  );
  const activeCbProfile = useMemo(
    () => computeCentralBankPolicyProfile(activeSovereign, activeOut, activeScenario),
    [activeSovereign, activeOut, activeScenario]
  );
  const contagionSnap = useMemo(
    () => simulateContagionCascade(sovereigns, pipelineOutputs, ['argentina', 'pakistan'], 68, 1.15, 'all'),
    [sovereigns, pipelineOutputs]
  );
  const portfolioSnap = useMemo(
    () =>
      computePortfolioRiskAttribution(
        PRESET_INSTITUTIONAL_BOOKS.em_distressed_alpha.positions,
        sovereigns,
        pipelineOutputs,
        activeScenario,
        customParams
      ),
    [sovereigns, pipelineOutputs, activeScenario, customParams]
  );

  // Compute aggregate desktop KPIs
  const totalCount = sovereigns.length;
  const avgPosterior =
    sovereigns.reduce((acc, s) => acc + (pipelineOutputs[s.id]?.calibratedPosteriorHazard || 0), 0) /
    (totalCount || 1);
  const arbitrageCount = sovereigns.filter(
    (s) => pipelineOutputs[s.id]?.isArbitrageAlert
  ).length;
  const crisisCount = sovereigns.filter(
    (s) => pipelineOutputs[s.id]?.regime === 'Crisis'
  ).length;
  const stressedCount = sovereigns.filter(
    (s) => pipelineOutputs[s.id]?.regime === 'Stressed'
  ).length;

  // Filtered & sorted sovereigns
  const filtered = sovereigns
    .filter((s) => {
      if (regionFilter === 'island') return s.isIslandState;
      if (regionFilter !== 'all' && s.region !== regionFilter) return false;
      if (onlyArbitrage && !pipelineOutputs[s.id]?.isArbitrageAlert) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          s.code.toLowerCase().includes(q) ||
          s.region.toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      const outA = pipelineOutputs[a.id];
      const outB = pipelineOutputs[b.id];
      let valA = 0;
      let valB = 0;

      if (sortField === 'name') {
        return sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      } else if (sortField === 'posterior') {
        valA = outA?.calibratedPosteriorHazard || 0;
        valB = outB?.calibratedPosteriorHazard || 0;
      } else if (sortField === 'cds') {
        valA = a.cdsSpread5yBps;
        valB = b.cdsSpread5yBps;
      } else if (sortField === 'arbitrage') {
        valA = Math.abs(outA?.arbitrageDivergence || 0);
        valB = Math.abs(outB?.arbitrageDivergence || 0);
      }
      return sortAsc ? valA - valB : valB - valA;
    });

  return (
    <div className="space-y-6">
      {/* Scenario Notification Banner if active */}
      {activeScenario !== 'baseline' && (
        <div className="px-4 py-3 bg-[#171407] border border-amber-600/40 rounded-lg flex items-center justify-between text-xs text-amber-300">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold uppercase text-amber-400">
              Active Stress Vector:
            </span>
            <span>
              {activeScenario === 'scenarioA_fedTightening' &&
                'Hawkish Fed +200 bps Shock — FX debt multiplier 1.4x, spreads widened +280 bps, cross-border correlation scaled.'}
              {activeScenario === 'scenarioB_commodityCollapse' &&
                'Global Commodity Price Shock (-30%) — Mono-exporter fiscal deficits widened +3.8%, Merton DD reduced 1.8σ.'}
              {activeScenario === 'scenarioC_malaccaBlockade' &&
                'Strait of Malacca Geopolitical Naval Closure — 21-day trade disruption, TSI +3.5σ, liquidation costs +24.6%.'}
            </span>
          </div>
          <span className="font-mono text-[11px] text-amber-400">
            Monte Carlo Iterations: 100,000+
          </span>
        </div>
      )}

      {/* Aggregate KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">
            Avg Sovereign Default Hazard
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-slate-100">
              {(avgPosterior * 100).toFixed(1)}%
            </span>
            <span className="text-xs text-slate-400">12m forward</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Firth Logit + Bayesian Updated
          </div>
        </div>

        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">
            Arbitrage Alpha Opportunities
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-emerald-400">
              {arbitrageCount}
            </span>
            <span className="text-xs text-slate-400">
              of {totalCount} monitored
            </span>
          </div>
          <div className="text-[11px] text-emerald-500 mt-1">
            |Model - Polymarket| ≥ 5.0%
          </div>
        </div>

        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">
            HMM Regime Distribution
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-sm font-semibold text-rose-400">
              {crisisCount} Crisis
            </span>
            <span className="text-slate-500">·</span>
            <span className="text-sm font-semibold text-amber-400">
              {stressedCount} Stressed
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Gaussian 3-State Transition Matrix
          </div>
        </div>

        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col justify-between">
          <div>
            <div className="text-xs text-slate-400 font-medium mb-1">
              Investment Committee Reporting
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-bold font-mono text-cyan-400">
                FRTB / Basel III Audit
              </span>
            </div>
          </div>
          {onOpenTearSheetModal ? (
            <button
              onClick={onOpenTearSheetModal}
              className="mt-2 w-full py-1 px-2.5 bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-700/60 text-emerald-300 rounded text-xs font-semibold transition-colors whitespace-nowrap"
            >
              📄 Export IC Tear-Sheet →
            </button>
          ) : (
            <div className="text-[11px] text-cyan-500 mt-1">
              ES 97.5% + Liquidity-Adjusted L-VaR
            </div>
          )}
        </div>
      </div>

      {/* Institutional Macro & Market Risk Intelligence Quick-Jump Strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          onClick={() => onNavigateToTab('yieldcurve')}
          className="text-left p-4 bg-[#0b111e] hover:bg-[#111b30] border border-[#1e2c47] rounded-lg transition-colors group"
        >
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>📉 Yield Curve & Maturity Wall ({activeSovereign.code})</span>
            <span className="text-cyan-400 group-hover:translate-x-0.5 transition-transform">→</span>
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span
              className={`text-lg font-bold ${
                activeYieldCurve.isInverted ? 'text-rose-400' : 'text-emerald-400'
              }`}
            >
              2s10s: {activeYieldCurve.slope2s10sBps > 0 ? `+${activeYieldCurve.slope2s10sBps}` : activeYieldCurve.slope2s10sBps} bps
            </span>
            <span className="text-xs text-amber-300">
              12M Wall: ${activeMaturityWall.next12mFxDebtServiceBln}B
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
            Reserve Coverage: {activeMaturityWall.reserveCoverageRatioPct}% · 5Y Basis: {activeYieldCurve.points[3].cdsBasisBps}bp
          </div>
        </button>

        <button
          onClick={() => onNavigateToTab('contagion')}
          className="text-left p-4 bg-[#0b111e] hover:bg-[#111b30] border border-[#1e2c47] rounded-lg transition-colors group"
        >
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>🔗 Systemic Contagion Network</span>
            <span className="text-cyan-400 group-hover:translate-x-0.5 transition-transform">→</span>
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-lg font-bold text-rose-400">
              {contagionSnap.systemicAmplificationMultiplier.toFixed(2)}x Lift
            </span>
            <span className="text-xs text-slate-300">
              {contagionSnap.cascadeBreachCount} Cascade Breaches
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
            Bilateral Trade + BIS Claims · Flight: ${contagionSnap.totalInducedCapitalFlightBln}B
          </div>
        </button>

        <button
          onClick={() => onNavigateToTab('centralbank')}
          className="text-left p-4 bg-[#0b111e] hover:bg-[#111b30] border border-[#1e2c47] rounded-lg transition-colors group"
        >
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>🏛️ Central Bank & Taylor Rule ({activeSovereign.code})</span>
            <span className="text-cyan-400 group-hover:translate-x-0.5 transition-transform">→</span>
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span
              className={`text-lg font-bold ${
                activeCbProfile.policyRateGapBps < -100
                  ? 'text-rose-400'
                  : 'text-emerald-400'
              }`}
            >
              Gap: {activeCbProfile.policyRateGapBps > 0 ? `+${activeCbProfile.policyRateGapBps}` : activeCbProfile.policyRateGapBps} bps
            </span>
            <span className="text-xs text-slate-300">
              Policy: {activeCbProfile.policyRatePct}%
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
            Taylor Implied: {activeCbProfile.taylorImpliedRatePct}% · {activeCbProfile.monetaryStance}
          </div>
        </button>

        <button
          onClick={() => onNavigateToTab('portfolio')}
          className="text-left p-4 bg-[#0b111e] hover:bg-[#111b30] border border-[#1e2c47] rounded-lg transition-colors group"
        >
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>💼 Portfolio VaR & Hedge Book</span>
            <span className="text-cyan-400 group-hover:translate-x-0.5 transition-transform">→</span>
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-lg font-bold text-emerald-400">
              Net VaR: ${portfolioSnap.netPostHedgeVarUsdM}M
            </span>
            <span className="text-xs text-cyan-400">
              Carry: +${portfolioSnap.netAnnualCarryUsdM}M
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
            ${portfolioSnap.totalNotionalUsdM}M Book · Div Benefit: -{portfolioSnap.diversificationBenefitPct}%
          </div>
        </button>
      </div>

      {/* yfinance Live Market Telemetry Strip */}
      <div className="p-3 bg-[#080d17] border border-[#19243a] rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs font-mono">
        <div className="flex items-center gap-2 shrink-0">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span className="font-bold text-slate-200 uppercase tracking-wider text-[11px]">
            yfinance Telemetry:
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">^TNX (10Y Yield):</span>
            <span className="font-bold text-slate-200">4.28%</span>
            <span className="text-emerald-400">(+0.04%)</span>
          </div>
          <span className="text-slate-700 hidden sm:inline">|</span>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">EMB (Sov Debt ETF):</span>
            <span className="font-bold text-slate-200">$91.42</span>
            <span className="text-emerald-400">(+0.35%)</span>
          </div>
          <span className="text-slate-700 hidden sm:inline">|</span>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">HG=F (Copper):</span>
            <span className="font-bold text-slate-200">$4.48/lb</span>
            <span className="text-emerald-400">(+1.24%)</span>
          </div>
          <span className="text-slate-700 hidden sm:inline">|</span>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">^VIX (Tail Risk):</span>
            <span className="font-bold text-slate-200">16.45</span>
            <span className="text-rose-400">(+4.11%)</span>
          </div>
          <span className="text-slate-700 hidden sm:inline">|</span>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">DXY (USD Index):</span>
            <span className="font-bold text-slate-200">104.25</span>
            <span className="text-emerald-400">(+0.28%)</span>
          </div>
        </div>

        <button
          onClick={() => onNavigateToTab('yfinance')}
          className="text-[11px] text-cyan-400 hover:text-cyan-300 underline font-sans shrink-0"
        >
          Open yfinance Terminal →
        </button>
      </div>

      {/* Control Toolbar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 p-3 bg-[#0e1524] border border-[#1a2438] rounded-lg">
        {/* Region Segmented Controls */}
        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => setRegionFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              regionFilter === 'all'
                ? 'bg-slate-700 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All Sovereigns
          </button>
          <button
            onClick={() => setRegionFilter('Latin America')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              regionFilter === 'Latin America'
                ? 'bg-slate-700 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Latin America
          </button>
          <button
            onClick={() => setRegionFilter('South Asia')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              regionFilter === 'South Asia'
                ? 'bg-slate-700 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            South Asia
          </button>
          <button
            onClick={() => setRegionFilter('Sub-Saharan Africa')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              regionFilter === 'Sub-Saharan Africa'
                ? 'bg-slate-700 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sub-Saharan Africa
          </button>
          <button
            onClick={() => setRegionFilter('island')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              regionFilter === 'island'
                ? 'bg-slate-700 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Island States (Pillar 7 15%)
          </button>
        </div>

        {/* Search & Arbitrage Filter */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlyArbitrage}
              onChange={(e) => setOnlyArbitrage(e.target.checked)}
              className="rounded bg-[#1a2438] border-slate-700 text-emerald-500 focus:ring-0"
            />
            <span>Only Alpha Alerts</span>
          </label>

          <button
            onClick={() => {
              setPeerComparisonTargetId(selectedSovereignId);
              setIsPeerComparisonOpen(true);
            }}
            className="px-3 py-1.5 text-xs font-semibold text-cyan-300 bg-cyan-950/70 hover:bg-cyan-900 border border-cyan-700/60 rounded transition-colors whitespace-nowrap flex items-center gap-1.5 shadow-sm"
          >
            <span>⚖️ Peer Comparison</span>
            <span className="px-1.5 py-0.2 bg-cyan-800 text-[10px] rounded font-mono text-cyan-200">
              Radar
            </span>
          </button>

          <button
            onClick={() => onNavigateToTab('worldmap')}
            className="px-3 py-1.5 text-xs font-semibold text-cyan-300 bg-cyan-950/60 hover:bg-cyan-950 border border-cyan-800/60 rounded transition-colors whitespace-nowrap flex items-center gap-1"
          >
            <span>🌐 World Map →</span>
          </button>

          <button
            onClick={() => onNavigateToTab('heatmap')}
            className="px-3 py-1.5 text-xs font-semibold text-rose-300 bg-rose-950/60 hover:bg-rose-950 border border-rose-800/60 rounded transition-colors whitespace-nowrap"
          >
            Risk Heatmap →
          </button>

          <input
            type="text"
            placeholder="Search sovereign or code..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-[#111726] border border-[#23314d] text-xs text-slate-200 px-3 py-1.5 rounded focus:outline-none focus:border-emerald-500 w-44"
          />
        </div>
      </div>

      {/* Main Sovereign Grid Table */}
      <div className="overflow-x-auto border border-[#1a2438] rounded-lg bg-[#0e1524]">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-[#1a2438] bg-[#090d16] text-slate-400 font-mono text-[11px] uppercase tracking-wider">
              <th
                className="py-3 px-4 cursor-pointer hover:text-slate-200"
                onClick={() => {
                  setSortField('name');
                  setSortAsc(!sortAsc);
                }}
              >
                Sovereign Entity
              </th>
              <th className="py-3 px-3">FX / State</th>
              <th className="py-3 px-3 text-right">L1 Hazard</th>
              <th
                className="py-3 px-3 text-right cursor-pointer hover:text-slate-200"
                onClick={() => {
                  setSortField('posterior');
                  setSortAsc(!sortAsc);
                }}
              >
                Calibrated Posterior (12m)
              </th>
              <th
                className="py-3 px-3 text-right cursor-pointer hover:text-slate-200"
                onClick={() => {
                  setSortField('cds');
                  setSortAsc(!sortAsc);
                }}
              >
                5Y CDS (bps)
              </th>
              <th className="py-3 px-3 text-right">Market Implied</th>
              <th
                className="py-3 px-3 text-right cursor-pointer hover:text-slate-200"
                onClick={() => {
                  setSortField('arbitrage');
                  setSortAsc(!sortAsc);
                }}
              >
                Alpha Spread
              </th>
              <th className="py-3 px-3">HMM Regime</th>
              <th className="py-3 px-3 text-right">99% VaR / 97.5% ES</th>
              <th className="py-3 px-4 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1a2438]/70">
            {filtered.map((s) => {
              const out = pipelineOutputs[s.id];
              const isSelected = s.id === selectedSovereignId;
              const posterior = out ? out.calibratedPosteriorHazard * 100 : 0;
              const divergence = out ? out.arbitrageDivergence : 0;

              return (
                <tr
                  key={s.id}
                  className={`hover:bg-[#131d33] transition-colors ${
                    isSelected ? 'bg-[#14213d]/50' : ''
                  }`}
                >
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2.5">
                      <span className="text-base">{s.flag}</span>
                      <div>
                        <div className="font-semibold text-slate-100 flex items-center gap-2">
                          <span>{s.name}</span>
                          <span className="font-mono text-[10px] text-slate-400">
                            {s.code}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {s.region}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="py-3.5 px-3">
                    <div className="text-slate-300 font-mono text-[11px]">
                      {s.fxRegime}
                    </div>
                    {s.isIslandState && (
                      <div className="text-[10px] text-cyan-400 font-medium">
                        Island (15% P7)
                      </div>
                    )}
                  </td>

                  <td className="py-3.5 px-3 text-right font-mono text-slate-300">
                    {out ? (out.layer1ReconciledHazard * 100).toFixed(1) : '-'}%
                  </td>

                  <td className="py-3.5 px-3 text-right">
                    <div
                      className={`font-mono font-bold text-sm ${
                        posterior > 20
                          ? 'text-rose-400'
                          : posterior > 8
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {posterior.toFixed(1)}%
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">
                      Logit: {out?.posteriorLogOdds.toFixed(2)}
                    </div>
                  </td>

                  <td className="py-3.5 px-3 text-right font-mono text-slate-200">
                    {s.cdsSpread5yBps}
                  </td>

                  <td className="py-3.5 px-3 text-right font-mono text-slate-300">
                    <div>{s.predictionMarket.impliedProbPercent.toFixed(1)}%</div>
                    <div className="text-[10px] text-slate-500">
                      {s.predictionMarket.marketName}
                    </div>
                  </td>

                  <td className="py-3.5 px-3 text-right font-mono">
                    <span
                      className={`font-semibold ${
                        out?.isArbitrageAlert
                          ? divergence > 0
                            ? 'text-emerald-400'
                            : 'text-amber-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {divergence > 0 ? `+${divergence.toFixed(1)}%` : `${divergence.toFixed(1)}%`}
                    </span>
                    {out?.isArbitrageAlert && (
                      <div className="text-[10px] text-emerald-400 font-sans uppercase tracking-tight">
                        Alpha Signal
                      </div>
                    )}
                  </td>

                  <td className="py-3.5 px-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[11px] font-mono font-medium ${
                        out?.regime === 'Crisis'
                          ? 'bg-rose-950 text-rose-300 border border-rose-800'
                          : out?.regime === 'Stressed'
                          ? 'bg-amber-950 text-amber-300 border border-amber-800'
                          : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      }`}
                    >
                      {out?.regime || 'Calm'}
                    </span>
                  </td>

                  <td className="py-3.5 px-3 text-right font-mono">
                    <div className="text-slate-200">
                      {out?.var99.toFixed(1)}% /{' '}
                      <span className="text-rose-400">{out?.es975.toFixed(1)}%</span>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      L-VaR: {out?.lVar99.toFixed(1)}%
                    </div>
                  </td>

                  <td className="py-3.5 px-4 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => {
                          setPeerComparisonTargetId(s.id);
                          setIsPeerComparisonOpen(true);
                        }}
                        className="px-2 py-1 text-xs font-medium text-cyan-400 hover:text-cyan-300 bg-cyan-950/60 hover:bg-cyan-900/80 border border-cyan-800/60 rounded transition-colors whitespace-nowrap flex items-center gap-1 shadow-sm"
                        title={`Compare ${s.name} side-by-side with peer sovereigns in radar view`}
                      >
                        <span>⚖️ Compare</span>
                      </button>
                      <button
                        onClick={() => {
                          onSelectSovereign(s.id);
                          onNavigateToTab('pipeline');
                        }}
                        className="px-2.5 py-1 text-xs font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded transition-colors whitespace-nowrap"
                      >
                        Decompose →
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Peer Comparison Radar Overlay */}
      <PeerComparisonOverlay
        isOpen={isPeerComparisonOpen}
        onClose={() => setIsPeerComparisonOpen(false)}
        sovereigns={sovereigns}
        pipelineOutputs={pipelineOutputs}
        initialSelectedId={peerComparisonTargetId || selectedSovereignId}
        activeScenario={activeScenario}
        customParams={customParams}
        onSelectSovereign={onSelectSovereign}
        onNavigateToTab={onNavigateToTab}
      />
    </div>
  );
};
