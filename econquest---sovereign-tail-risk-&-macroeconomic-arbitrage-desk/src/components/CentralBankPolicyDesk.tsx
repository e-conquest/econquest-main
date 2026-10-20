import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
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
  MacroScenario
} from '../types/riskEngine';
import { computeCentralBankPolicyProfile } from '../math/institutionalMacroAnalytics';

interface CentralBankPolicyDeskProps {
  sovereigns: SovereignEntity[];
  pipelineOutputs: Record<string, LayerOutputs>;
  selectedSovereignId: string;
  onSelectSovereign: (id: string) => void;
  activeScenario: MacroScenario;
  onNavigateToTab: (tab: string) => void;
}

export const CentralBankPolicyDesk: React.FC<CentralBankPolicyDeskProps> = ({
  sovereigns,
  pipelineOutputs,
  selectedSovereignId,
  onSelectSovereign,
  activeScenario,
  onNavigateToTab
}) => {
  const [alphaInflationWeight, setAlphaInflationWeight] = useState<number>(0.5);
  const [alphaOutputGapWeight, setAlphaOutputGapWeight] = useState<number>(0.5);
  const [globalRStarShiftPct, setGlobalRStarShiftPct] = useState<number>(0.0);
  const [stanceFilter, setStanceFilter] = useState<string>('all');

  const profiles = useMemo(() => {
    return sovereigns.map((s) => {
      const out = pipelineOutputs[s.id];
      const cb = computeCentralBankPolicyProfile(
        s,
        out,
        activeScenario,
        alphaInflationWeight,
        alphaOutputGapWeight,
        globalRStarShiftPct
      );
      return { sovereign: s, out, cb };
    });
  }, [
    sovereigns,
    pipelineOutputs,
    activeScenario,
    alphaInflationWeight,
    alphaOutputGapWeight,
    globalRStarShiftPct
  ]);

  const filteredProfiles = useMemo(() => {
    return profiles.filter((p) => {
      if (stanceFilter === 'all') return true;
      return p.cb.monetaryStance === stanceFilter;
    });
  }, [profiles, stanceFilter]);

  const activeProfile = useMemo(
    () =>
      profiles.find((p) => p.sovereign.id === selectedSovereignId) || profiles[0],
    [profiles, selectedSovereignId]
  );

  const behindCurveCount = profiles.filter(
    (p) => p.cb.monetaryStance === 'Behind the Curve'
  ).length;
  const guidottiBreachCount = profiles.filter(
    (p) => p.cb.guidottiGreenspanRatioPct > 100
  ).length;
  const avgRealRate =
    profiles.reduce((s, p) => s + p.cb.realInterestRatePct, 0) /
    Math.max(1, profiles.length);

  const chartData = useMemo(
    () =>
      profiles.map(({ sovereign: s, cb }) => ({
        code: s.code,
        name: s.name,
        policyRate: cb.policyRatePct,
        taylorRate: cb.taylorImpliedRatePct,
        realRate: cb.realInterestRatePct,
        reerMisalignment: cb.reerMisalignmentPct,
        guidottiRatio: cb.guidottiGreenspanRatioPct
      })),
    [profiles]
  );

  return (
    <div className="space-y-6">
      {/* Top Executive Header & Taylor Rule Calibration Levers */}
      <div className="p-5 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-3 border-b border-[#1a2438]">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
              <span>Monetary Policy & External Balance Desk</span>
              <span aria-hidden="true">·</span>
              <span>Augmented Open-Economy Taylor Rule</span>
              <span aria-hidden="true">·</span>
              <span>Guidotti-Greenspan Reserve Adequacy</span>
            </div>
            <h2 className="text-lg font-bold text-slate-100 tracking-tight">
              Global Central Bank Policy Rate Cycle, Taylor Rule Gap & REER Valuation Monitor
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setAlphaInflationWeight(0.5);
                setAlphaOutputGapWeight(0.5);
                setGlobalRStarShiftPct(0.0);
              }}
              className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-[#090d16] hover:bg-[#141e33] border border-[#23314d] rounded transition-colors whitespace-nowrap shrink-0"
            >
              Reset Canonical Taylor (0.5 / 0.5)
            </button>
            <button
              onClick={() => onNavigateToTab('yieldcurve')}
              className="px-3 py-1.5 text-xs font-medium text-cyan-300 bg-cyan-950/60 hover:bg-cyan-900/70 border border-cyan-800/60 rounded transition-colors whitespace-nowrap shrink-0"
            >
              View Yield Curves →
            </button>
          </div>
        </div>

        {/* Interactive Taylor Rule Equation Sliders */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-[#090d16] p-3.5 rounded border border-[#1a2438]">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">
                Inflation Gap Weight (α_π on π − π*)
              </span>
              <span className="font-mono font-bold text-emerald-400 tabular-nums">
                {alphaInflationWeight.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0.25}
              max={1.5}
              step={0.05}
              value={alphaInflationWeight}
              onChange={(e) => setAlphaInflationWeight(Number(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">
                Output Gap Weight (α_y on GDP Gap)
              </span>
              <span className="font-mono font-bold text-cyan-400 tabular-nums">
                {alphaOutputGapWeight.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0.25}
              max={1.25}
              step={0.05}
              value={alphaOutputGapWeight}
              onChange={(e) => setAlphaOutputGapWeight(Number(e.target.value))}
              className="w-full accent-cyan-500 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">
                Global Neutral Real Rate Shift (Δr*)
              </span>
              <span className="font-mono font-bold text-amber-400 tabular-nums">
                {globalRStarShiftPct >= 0
                  ? `+${globalRStarShiftPct.toFixed(2)}%`
                  : `${globalRStarShiftPct.toFixed(2)}%`}
              </span>
            </div>
            <input
              type="range"
              min={-1.0}
              max={2.5}
              step={0.25}
              value={globalRStarShiftPct}
              onChange={(e) => setGlobalRStarShiftPct(Number(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* 4-Column Monetary KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">
            Active Central Bank Policy Gap ({activeProfile.sovereign.code})
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span
              className={`text-2xl font-bold ${
                activeProfile.cb.policyRateGapBps < -100
                  ? 'text-rose-400'
                  : activeProfile.cb.policyRateGapBps > 125
                  ? 'text-emerald-400'
                  : 'text-amber-400'
              }`}
            >
              {activeProfile.cb.policyRateGapBps > 0
                ? `+${activeProfile.cb.policyRateGapBps}`
                : activeProfile.cb.policyRateGapBps}{' '}
              bps
            </span>
            <span className="text-xs text-slate-400">vs. Taylor</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 truncate">
            {activeProfile.cb.centralBankName}
          </div>
        </div>

        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">
            Central Banks Behind the Curve
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-rose-400">
              {behindCurveCount}
            </span>
            <span className="text-xs text-slate-400">
              of {sovereigns.length} sovereigns
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Policy Rate &lt; Taylor Implied by &gt; 100 bps
          </div>
        </div>

        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">
            Mean Real Policy Rate (i − π)
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span
              className={`text-2xl font-bold ${
                avgRealRate < 0 ? 'text-amber-400' : 'text-emerald-400'
              }`}
            >
              {avgRealRate > 0
                ? `+${avgRealRate.toFixed(2)}%`
                : `${avgRealRate.toFixed(2)}%`}
            </span>
            <span className="text-xs text-slate-400">ex-post real carry</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Scenario Inflation Adjustment Applied
          </div>
        </div>

        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">
            Guidotti-Greenspan Breaches (&gt;100%)
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-amber-400">
              {guidottiBreachCount}
            </span>
            <span className="text-xs text-slate-400">reserve inadequacy</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            12M Short-Term FX Debt &gt; 100% Reserves
          </div>
        </div>
      </div>

      {/* 2-Column Charts: Taylor Rule Comparison & REER / Reserve Adequacy */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Left Chart: Actual Policy Rate vs Taylor Rule Implied Rate */}
        <div className="p-5 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col justify-between">
          <div>
            <div className="mb-3 pb-3 border-b border-[#1a2438]">
              <h3 className="text-sm font-bold text-slate-100">
                01. Central Bank Policy Rate vs. Taylor Rule Equilibrium (%)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Bars below the crimson Taylor line indicate monetary policy is behind the inflation/FX curve
              </p>
            </div>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 10, right: 16, left: 0, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a2438" />
                  <XAxis
                    dataKey="code"
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
                  <Bar
                    dataKey="policyRate"
                    name="Current Central Bank Policy Rate (%)"
                    fill="#06b6d4"
                    radius={[3, 3, 0, 0]}
                  />
                  <Line
                    type="monotone"
                    dataKey="taylorRate"
                    name="Taylor Rule Implied Rate (%)"
                    stroke="#f43f5e"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#f43f5e' }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-[#1a2438] text-xs text-slate-400 font-mono tabular-nums flex items-center justify-between">
            <span>Formula: i* = r* + π + α_π(π − π*) + α_y(y) + β_FX</span>
            <span className="text-emerald-400">Live Parameter Calibration</span>
          </div>
        </div>

        {/* Right Chart: REER Overvaluation & Guidotti-Greenspan Reserve Ratio */}
        <div className="p-5 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col justify-between">
          <div>
            <div className="mb-3 pb-3 border-b border-[#1a2438]">
              <h3 className="text-sm font-bold text-slate-100">
                02. Guidotti-Greenspan Ratio & REER Currency Valuation (%)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Short-term FX debt / reserves (&gt;100% threshold) paired with Real Effective Exchange Rate misalignment
              </p>
            </div>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 10, right: 16, left: 0, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a2438" />
                  <XAxis
                    dataKey="code"
                    stroke="#64748b"
                    tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                  />
                  <YAxis
                    yAxisId="left"
                    stroke="#64748b"
                    tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
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
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <ReferenceLine
                    yAxisId="left"
                    y={100}
                    stroke="#f43f5e"
                    strokeDasharray="4 4"
                    label={{
                      value: '100% Guidotti Threshold',
                      position: 'insideTopRight',
                      fill: '#f43f5e',
                      fontSize: 10
                    }}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="guidottiRatio"
                    name="Guidotti-Greenspan ST Debt/Reserves (%)"
                    fill="#eab308"
                    radius={[3, 3, 0, 0]}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="reerMisalignment"
                    name="REER Overvaluation (+%)"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={{ r: 3.5, fill: '#10b981' }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-[#1a2438] text-xs text-slate-400 font-mono tabular-nums flex items-center justify-between">
            <span>REER &gt; +10%: Acute Devaluation Pressure</span>
            <span>Guidotti &gt; 100%: Rollover Vulnerability</span>
          </div>
        </div>
      </div>

      {/* Full Central Bank & Monetary Policy Matrix Table */}
      <div className="bg-[#0e1524] border border-[#1a2438] rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#1a2438] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-100">
              03. Institutional Central Bank & External Equilibrium Scorecard
            </h3>
            <p className="text-xs text-slate-400">
              Filter by monetary stance or click any sovereign row to synchronize across the terminal
            </p>
          </div>

          <div className="flex items-center gap-1 bg-[#090d16] p-1 rounded border border-[#1a2438]">
            {['all', 'Behind the Curve', 'Neutral Equilibrium', 'Restrictive / Hawkish'].map(
              (st) => (
                <button
                  key={st}
                  onClick={() => setStanceFilter(st)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    stanceFilter === st
                      ? 'bg-[#17233b] text-emerald-400'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {st === 'all' ? 'All Central Banks' : st}
                </button>
              )
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#1a2438] bg-[#090d16] text-slate-400 font-mono text-[11px] uppercase">
                <th className="py-2.5 px-4">Sovereign / Central Bank</th>
                <th className="py-2.5 px-3">FX Regime</th>
                <th className="py-2.5 px-3 text-right">Policy Rate</th>
                <th className="py-2.5 px-3 text-right">Headline CPI</th>
                <th className="py-2.5 px-3 text-right">Real Rate</th>
                <th className="py-2.5 px-3 text-right">Taylor Implied</th>
                <th className="py-2.5 px-3 text-right">Policy Gap</th>
                <th className="py-2.5 px-3 text-right">REER Valuation</th>
                <th className="py-2.5 px-4">Monetary Stance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a2438]/70 font-mono tabular-nums">
              {filteredProfiles.map(({ sovereign: s, cb }) => {
                const isSelected = s.id === selectedSovereignId;
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
                        <div>
                          <div className="font-semibold text-slate-100">
                            {s.name} ({cb.currencyCode})
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {cb.centralBankName}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-300">{s.fxRegime}</td>
                    <td className="py-2.5 px-3 text-right font-bold text-cyan-400">
                      {cb.policyRatePct.toFixed(2)}%
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-200">
                      {cb.headlineCpiPct.toFixed(1)}%
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-semibold ${
                        cb.realInterestRatePct < 0 ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {cb.realInterestRatePct > 0
                        ? `+${cb.realInterestRatePct.toFixed(2)}%`
                        : `${cb.realInterestRatePct.toFixed(2)}%`}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-200">
                      {cb.taylorImpliedRatePct.toFixed(2)}%
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-bold ${
                        cb.policyRateGapBps < -100
                          ? 'text-rose-400'
                          : cb.policyRateGapBps > 125
                          ? 'text-emerald-400'
                          : 'text-amber-400'
                      }`}
                    >
                      {cb.policyRateGapBps > 0
                        ? `+${cb.policyRateGapBps}`
                        : cb.policyRateGapBps}{' '}
                      bps
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right ${
                        cb.reerMisalignmentPct > 8 ? 'text-rose-400' : 'text-slate-300'
                      }`}
                    >
                      {cb.reerMisalignmentPct > 0
                        ? `+${cb.reerMisalignmentPct.toFixed(1)}%`
                        : `${cb.reerMisalignmentPct.toFixed(1)}%`}
                    </td>
                    <td className="py-2.5 px-4 font-sans">
                      <span
                        className={
                          cb.monetaryStance === 'Behind the Curve'
                            ? 'text-rose-400 font-semibold'
                            : cb.monetaryStance === 'Restrictive / Hawkish'
                            ? 'text-emerald-400 font-semibold'
                            : 'text-amber-300'
                        }
                      >
                        {cb.monetaryStance}
                      </span>
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
