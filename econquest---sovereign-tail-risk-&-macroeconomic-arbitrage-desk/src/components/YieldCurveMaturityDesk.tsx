import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine
} from 'recharts';
import {
  SovereignEntity,
  LayerOutputs,
  MacroScenario,
  CustomScenarioParams
} from '../types/riskEngine';
import {
  computeSovereignYieldCurve,
  computeDebtMaturityWall
} from '../math/institutionalMacroAnalytics';

interface YieldCurveMaturityDeskProps {
  sovereigns: SovereignEntity[];
  pipelineOutputs: Record<string, LayerOutputs>;
  selectedSovereignId: string;
  onSelectSovereign: (id: string) => void;
  activeScenario: MacroScenario;
  customParams?: CustomScenarioParams;
  onNavigateToTab: (tab: string) => void;
}

export const YieldCurveMaturityDesk: React.FC<YieldCurveMaturityDeskProps> = ({
  sovereigns,
  pipelineOutputs,
  selectedSovereignId,
  onSelectSovereign,
  activeScenario,
  customParams,
  onNavigateToTab
}) => {
  const [curveMode, setCurveMode] = useState<'yield' | 'cds_basis'>('yield');
  const [showBaselineOverlay, setShowBaselineOverlay] = useState<boolean>(true);
  const [maturityViewMode, setMaturityViewMode] = useState<'stacked' | 'fx_vs_reserves'>('stacked');

  const selectedSovereign = useMemo(
    () => sovereigns.find((s) => s.id === selectedSovereignId) || sovereigns[0],
    [sovereigns, selectedSovereignId]
  );

  const currentOutput = pipelineOutputs[selectedSovereign.id];

  const yieldAnalytics = useMemo(
    () =>
      computeSovereignYieldCurve(
        selectedSovereign,
        currentOutput,
        activeScenario,
        customParams
      ),
    [selectedSovereign, currentOutput, activeScenario, customParams]
  );

  const maturityAnalytics = useMemo(
    () =>
      computeDebtMaturityWall(
        selectedSovereign,
        currentOutput,
        activeScenario
      ),
    [selectedSovereign, currentOutput, activeScenario]
  );

  const allSovereignCurves = useMemo(() => {
    return sovereigns.map((s) => {
      const out = pipelineOutputs[s.id];
      const yc = computeSovereignYieldCurve(s, out, activeScenario, customParams);
      const mw = computeDebtMaturityWall(s, out, activeScenario);
      return { sovereign: s, out, yc, mw };
    });
  }, [sovereigns, pipelineOutputs, activeScenario, customParams]);

  return (
    <div className="space-y-6">
      {/* Top Executive Header & Sovereign Selector */}
      <div className="p-5 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <span>Term Structure & Refinancing Desk</span>
            <span aria-hidden="true">·</span>
            <span>Nelson-Siegel-Svensson Parametric Fit</span>
            <span aria-hidden="true">·</span>
            <span>2026–2032 Amortization Schedule</span>
          </div>
          <h2 className="text-lg font-bold text-slate-100 tracking-tight">
            {selectedSovereign.flag} {selectedSovereign.name} ({selectedSovereign.code}) — Sovereign Yield Curve & Debt Maturity Wall
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-[#090e1a] border border-[#23314d] rounded px-3 py-1.5">
            <span className="text-xs text-slate-400">Active Sovereign:</span>
            <select
              value={selectedSovereign.id}
              onChange={(e) => onSelectSovereign(e.target.value)}
              className="bg-transparent text-xs font-mono font-bold text-slate-100 focus:outline-none cursor-pointer"
            >
              {sovereigns.map((s) => (
                <option key={s.id} value={s.id} className="bg-[#0e1524] text-slate-100">
                  {s.flag} {s.code} · {s.name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => onNavigateToTab('portfolio')}
            className="px-3 py-1.5 text-xs font-medium text-emerald-300 bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-800/60 rounded transition-colors whitespace-nowrap shrink-0"
          >
            Send to Portfolio VaR Book →
          </button>
        </div>
      </div>

      {/* 4-Column Quantitative KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">
            2s10s USD Yield Curve Slope
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span
              className={`text-2xl font-bold ${
                yieldAnalytics.isInverted ? 'text-rose-400' : 'text-emerald-400'
              }`}
            >
              {yieldAnalytics.slope2s10sBps > 0
                ? `+${yieldAnalytics.slope2s10sBps}`
                : yieldAnalytics.slope2s10sBps}{' '}
              bps
            </span>
            <span className="text-xs text-slate-400">
              {yieldAnalytics.isInverted ? 'Inverted (Front-End Stress)' : 'Normal Steepness'}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
            2s5s10s Butterfly: {yieldAnalytics.bellyCurvatureBps > 0 ? `+${yieldAnalytics.bellyCurvatureBps}` : yieldAnalytics.bellyCurvatureBps} bps
          </div>
        </div>

        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">
            5Y Sovereign Z-Spread & Duration
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-slate-100">
              {yieldAnalytics.zSpread5yBps} bps
            </span>
            <span className="text-xs text-cyan-400">
              Dur: {yieldAnalytics.effectiveDuration5y}y
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
            10Y Convexity: {yieldAnalytics.convexity10y} · 5Y Breakeven CPI: {yieldAnalytics.breakevenInflation5y}%
          </div>
        </div>

        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">
            Next 12M / 24M External FX Debt Wall
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-amber-400">
              ${maturityAnalytics.next12mFxDebtServiceBln}B
            </span>
            <span className="text-xs text-slate-400">
              / ${maturityAnalytics.next24mFxDebtServiceBln}B (24m)
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
            Peak Rollover Wall: {maturityAnalytics.peakMaturityYear} (${maturityAnalytics.peakMaturityAmountBln}B total)
          </div>
        </div>

        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">
            Usable FX Reserves Coverage (12M)
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span
              className={`text-2xl font-bold ${
                maturityAnalytics.reserveCoverageRatioPct < 100
                  ? 'text-rose-400'
                  : maturityAnalytics.reserveCoverageRatioPct < 140
                  ? 'text-amber-400'
                  : 'text-emerald-400'
              }`}
            >
              {maturityAnalytics.reserveCoverageRatioPct}%
            </span>
            <span className="text-xs text-slate-400">
              (${maturityAnalytics.usableFxReservesBln}B liquid)
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {maturityAnalytics.reserveCoverageRatioPct < 100
              ? 'Rollover Deficit — Requires IMF / Bilateral Bridge'
              : 'Adequate Liquid FX Reserve Buffer'}
          </div>
        </div>
      </div>

      {/* Main 2-Column Analytical Charts Split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Left Panel: Sovereign Yield Curve & CDS Term Structure */}
        <div className="p-5 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-[#1a2438]">
              <div>
                <h3 className="text-sm font-bold text-slate-100">
                  01. Nelson-Siegel Term Structure (1Y–30Y Tenors)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  USD Eurobond curve vs. Local Currency curve & US Treasury benchmark
                </p>
              </div>

              <div className="flex items-center gap-1 bg-[#090d16] p-1 rounded border border-[#1a2438]">
                <button
                  onClick={() => setCurveMode('yield')}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    curveMode === 'yield'
                      ? 'bg-[#17233b] text-emerald-400'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Yield Curves (%)
                </button>
                <button
                  onClick={() => setCurveMode('cds_basis')}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    curveMode === 'cds_basis'
                      ? 'bg-[#17233b] text-cyan-400'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  CDS & Bond Basis (bps)
                </button>
              </div>
            </div>

            {curveMode === 'yield' && (
              <div className="flex items-center justify-between text-xs text-slate-400 mb-3">
                <div className="flex items-center gap-2">
                  <span>Active Scenario:</span>
                  <span className="font-mono text-slate-200">{activeScenario}</span>
                </div>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showBaselineOverlay}
                    onChange={(e) => setShowBaselineOverlay(e.target.checked)}
                    className="rounded bg-[#090d16] border-slate-700 text-emerald-500 focus:ring-0"
                  />
                  <span>Show Baseline Eurobond Overlay</span>
                </label>
              </div>
            )}

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                {curveMode === 'yield' ? (
                  <ComposedChart
                    data={yieldAnalytics.points}
                    margin={{ top: 10, right: 16, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a2438" />
                    <XAxis
                      dataKey="tenor"
                      stroke="#64748b"
                      tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                    />
                    <YAxis
                      stroke="#64748b"
                      tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#090e1a',
                        borderColor: '#233352',
                        fontSize: '12px',
                        fontFamily: 'monospace'
                      }}
                      formatter={(val: any, name: any) => [`${Number(val).toFixed(2)}%`, String(name)]}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Area
                      type="monotone"
                      dataKey="usTreasuryYield"
                      name="US Treasury Benchmark"
                      fill="#06b6d4"
                      fillOpacity={0.08}
                      stroke="#06b6d4"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                    />
                    {showBaselineOverlay && activeScenario !== 'baseline' && (
                      <Line
                        type="monotone"
                        dataKey="baselineEurobondYield"
                        name="Baseline USD Eurobond"
                        stroke="#94a3b8"
                        strokeWidth={1.5}
                        strokeDasharray="3 3"
                        dot={{ r: 2 }}
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey="usdEurobondYield"
                      name="Active USD Eurobond Yield"
                      stroke="#10b981"
                      strokeWidth={2.5}
                      dot={{ r: 3.5, fill: '#10b981' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="localCurrencyYield"
                      name="Local Currency Sovereign Yield"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#f59e0b' }}
                    />
                  </ComposedChart>
                ) : (
                  <ComposedChart
                    data={yieldAnalytics.points}
                    margin={{ top: 10, right: 16, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a2438" />
                    <XAxis
                      dataKey="tenor"
                      stroke="#64748b"
                      tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                    />
                    <YAxis
                      stroke="#64748b"
                      tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                      tickFormatter={(v) => `${v}bp`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#090e1a',
                        borderColor: '#233352',
                        fontSize: '12px',
                        fontFamily: 'monospace'
                      }}
                      formatter={(val: any, name: any) => [`${val} bps`, String(name)]}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <ReferenceLine y={0} stroke="#475569" />
                    <Bar
                      dataKey="cdsBasisBps"
                      name="CDS-Bond Basis (bps)"
                      fill="#06b6d4"
                      radius={[3, 3, 0, 0]}
                    />
                    <Line
                      type="monotone"
                      dataKey="cdsSpreadBps"
                      name="Par CDS Spread (bps)"
                      stroke="#f43f5e"
                      strokeWidth={2.5}
                      dot={{ r: 3.5, fill: '#f43f5e' }}
                    />
                  </ComposedChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#1a2438] flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 font-mono tabular-nums">
            <span>2Y USD: {yieldAnalytics.points[1].usdEurobondYield}%</span>
            <span>·</span>
            <span>5Y USD: {yieldAnalytics.points[3].usdEurobondYield}%</span>
            <span>·</span>
            <span>10Y USD: {yieldAnalytics.points[5].usdEurobondYield}%</span>
            <span>·</span>
            <span>30Y USD: {yieldAnalytics.points[7].usdEurobondYield}%</span>
            <span>·</span>
            <span className="text-cyan-400">
              5Y CDS Basis: {yieldAnalytics.points[3].cdsBasisBps} bps
            </span>
          </div>
        </div>

        {/* Right Panel: Sovereign Debt Maturity & Rollover Wall (2026-2032) */}
        <div className="p-5 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-[#1a2438]">
              <div>
                <h3 className="text-sm font-bold text-slate-100">
                  02. Sovereign Debt Maturity & Rollover Wall (2026–2032)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Annual principal & coupon amortizations ($B) vs. liquid FX reserve buffer
                </p>
              </div>

              <div className="flex items-center gap-1 bg-[#090d16] p-1 rounded border border-[#1a2438]">
                <button
                  onClick={() => setMaturityViewMode('stacked')}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    maturityViewMode === 'stacked'
                      ? 'bg-[#17233b] text-emerald-400'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  By Creditor Class
                </button>
                <button
                  onClick={() => setMaturityViewMode('fx_vs_reserves')}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    maturityViewMode === 'fx_vs_reserves'
                      ? 'bg-[#17233b] text-amber-400'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  FX Wall vs. Reserves
                </button>
              </div>
            </div>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                {maturityViewMode === 'stacked' ? (
                  <BarChart
                    data={maturityAnalytics.buckets}
                    margin={{ top: 10, right: 16, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a2438" />
                    <XAxis
                      dataKey="year"
                      stroke="#64748b"
                      tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                    />
                    <YAxis
                      stroke="#64748b"
                      tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                      tickFormatter={(v) => `$${v}B`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#090e1a',
                        borderColor: '#233352',
                        fontSize: '12px',
                        fontFamily: 'monospace'
                      }}
                      formatter={(val: any, name: any) => [`$${Number(val).toFixed(2)}B`, String(name)]}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <ReferenceLine
                      y={maturityAnalytics.usableFxReservesBln}
                      stroke="#10b981"
                      strokeDasharray="4 4"
                      label={{
                        value: `Usable FX Reserves ($${maturityAnalytics.usableFxReservesBln}B)`,
                        position: 'insideTopRight',
                        fill: '#10b981',
                        fontSize: 10
                      }}
                    />
                    <Bar
                      dataKey="eurobondUsdBln"
                      stackId="a"
                      name="USD/EUR Eurobonds"
                      fill="#f43f5e"
                    />
                    <Bar
                      dataKey="imfMultilateralBln"
                      stackId="a"
                      name="IMF & Multilateral (Preferred Creditor)"
                      fill="#06b6d4"
                    />
                    <Bar
                      dataKey="bilateralOfficialBln"
                      stackId="a"
                      name="Bilateral Official (Paris / Non-Paris Club)"
                      fill="#eab308"
                    />
                    <Bar
                      dataKey="domesticLocalBln"
                      stackId="a"
                      name="Domestic Local Currency Bonds"
                      fill="#475569"
                    />
                  </BarChart>
                ) : (
                  <ComposedChart
                    data={maturityAnalytics.buckets}
                    margin={{ top: 10, right: 16, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a2438" />
                    <XAxis
                      dataKey="year"
                      stroke="#64748b"
                      tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                    />
                    <YAxis
                      stroke="#64748b"
                      tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                      tickFormatter={(v) => `$${v}B`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#090e1a',
                        borderColor: '#233352',
                        fontSize: '12px',
                        fontFamily: 'monospace'
                      }}
                      formatter={(val: any, name: any) => [`$${Number(val).toFixed(2)}B`, String(name)]}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar
                      dataKey="fxMaturityBln"
                      name="Hard-Currency FX Debt Service ($B)"
                      fill="#f97316"
                      radius={[3, 3, 0, 0]}
                    />
                    <Line
                      type="monotone"
                      dataKey="usableFxReservesBln"
                      name="Usable Liquid FX Reserves ($B)"
                      stroke="#10b981"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: '#10b981' }}
                    />
                  </ComposedChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#1a2438] flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 font-mono tabular-nums">
            <span>
              Breach Years:{' '}
              <strong className="text-rose-400">
                {maturityAnalytics.buckets.filter((b) => b.isRolloverBreach).map((b) => b.year).join(', ') || 'None'}
              </strong>
            </span>
            <span>·</span>
            <span>
              IMF Seniority Status:{' '}
              <strong className="text-slate-200">
                {selectedSovereign.imfProgramInvolved ? 'Active EFF/SBA Facility' : 'No IMF Program'}
              </strong>
            </span>
          </div>
        </div>
      </div>

      {/* Cross-Sovereign Term Structure & Maturity Wall Screener */}
      <div className="bg-[#0e1524] border border-[#1a2438] rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#1a2438] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-100">
              03. Cross-Sovereign Yield Curve Slope & Rollover Wall Matrix
            </h3>
            <p className="text-xs text-slate-400">
              Click any sovereign row to inspect its full Nelson-Siegel curve and 2026–2032 amortization profile
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400 tabular-nums">
            Monitored Sovereigns: {sovereigns.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#1a2438] bg-[#090d16] text-slate-400 font-mono text-[11px] uppercase">
                <th className="py-2.5 px-4">Sovereign</th>
                <th className="py-2.5 px-3 text-right">2Y USD Yield</th>
                <th className="py-2.5 px-3 text-right">5Y USD Yield</th>
                <th className="py-2.5 px-3 text-right">10Y USD Yield</th>
                <th className="py-2.5 px-3 text-right">2s10s Slope</th>
                <th className="py-2.5 px-3 text-right">5Y CDS Basis</th>
                <th className="py-2.5 px-3 text-right">12M FX Wall ($B)</th>
                <th className="py-2.5 px-3 text-right">Usable Reserves ($B)</th>
                <th className="py-2.5 px-4 text-right">12M Coverage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a2438]/70 font-mono tabular-nums">
              {allSovereignCurves.map(({ sovereign: s, yc, mw }) => {
                const isSelected = s.id === selectedSovereign.id;
                const y2 = yc.points[1].usdEurobondYield;
                const y5 = yc.points[3].usdEurobondYield;
                const y10 = yc.points[5].usdEurobondYield;
                const basis5 = yc.points[3].cdsBasisBps;

                return (
                  <tr
                    key={s.id}
                    onClick={() => onSelectSovereign(s.id)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-[#15223c]' : 'hover:bg-[#121c31]'
                    }`}
                  >
                    <td className="py-2.5 px-4 font-sans">
                      <div className="flex items-center gap-2">
                        <span>{s.flag}</span>
                        <span className="font-semibold text-slate-100">{s.name}</span>
                        <span className="text-[11px] font-mono text-slate-400">{s.code}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-200">{y2.toFixed(2)}%</td>
                    <td className="py-2.5 px-3 text-right text-slate-200">{y5.toFixed(2)}%</td>
                    <td className="py-2.5 px-3 text-right text-slate-200">{y10.toFixed(2)}%</td>
                    <td
                      className={`py-2.5 px-3 text-right font-bold ${
                        yc.isInverted ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {yc.slope2s10sBps > 0 ? `+${yc.slope2s10sBps}` : yc.slope2s10sBps} bps
                    </td>
                    <td className="py-2.5 px-3 text-right text-cyan-400">{basis5} bps</td>
                    <td className="py-2.5 px-3 text-right text-amber-300">
                      ${mw.next12mFxDebtServiceBln.toFixed(2)}B
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-300">
                      ${mw.usableFxReservesBln.toFixed(2)}B
                    </td>
                    <td
                      className={`py-2.5 px-4 text-right font-bold ${
                        mw.reserveCoverageRatioPct < 100
                          ? 'text-rose-400'
                          : mw.reserveCoverageRatioPct < 140
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {mw.reserveCoverageRatioPct.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
