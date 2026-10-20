import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from 'recharts';
import { SovereignEntity, MacroScenario } from '../types/riskEngine';
import { PILLARS_METADATA, INDICATOR_MATRIX } from '../data/indicatorMatrix';
import { computeScorecard } from '../math/riskCalculations';
import {
  generateHistoricalPillarData,
  TimeHorizon,
  HistoricalPillarPoint
} from '../data/historicalScorecardData';

interface ScorecardWorkbenchProps {
  sovereign: SovereignEntity;
  allSovereigns: SovereignEntity[];
  onSelectSovereign: (id: string) => void;
  activeScenario: MacroScenario;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  historicalData: HistoricalPillarPoint[];
}

const CustomChartTooltip: React.FC<CustomTooltipProps> = ({ active, payload, label, historicalData }) => {
  if (!active || !payload || payload.length === 0) return null;

  const currentPoint = historicalData.find((p) => p.date === label);

  return (
    <div className="p-3 bg-[#090d16] border border-[#1a2438] rounded shadow-xl text-xs font-mono space-y-1.5 z-50 min-w-48">
      <div className="font-bold text-slate-100 border-b border-[#1a2438] pb-1 flex items-center justify-between">
        <span>{label}</span>
        {currentPoint?.eventNote && (
          <span className="text-[10px] text-amber-400 font-sans font-medium">Event Highlight</span>
        )}
      </div>

      {currentPoint?.eventNote && (
        <div className="text-[11px] text-amber-300 font-sans italic bg-amber-950/40 p-1.5 rounded border border-amber-800/40">
          {currentPoint.eventNote}
        </div>
      )}

      <div className="space-y-1 pt-0.5">
        {payload.map((item) => (
          <div key={item.name} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: item.color }} />
              <span className="text-slate-300">{item.name}:</span>
            </span>
            <span className="font-bold text-slate-100">{item.value.toFixed(1)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const ScorecardWorkbench: React.FC<ScorecardWorkbenchProps> = ({
  sovereign,
  allSovereigns,
  onSelectSovereign,
  activeScenario
}) => {
  const [useForensicRules, setUseForensicRules] = useState<boolean>(true);
  const [islandOverride, setIslandOverride] = useState<boolean>(sovereign.isIslandState);
  const [selectedPillarId, setSelectedPillarId] = useState<number>(1);
  const [indicatorSearch, setIndicatorSearch] = useState<string>('');
  const [timeHorizon, setTimeHorizon] = useState<TimeHorizon>('10y');

  // Pillar series line visibility toggles
  const [visibleSeries, setVisibleSeries] = useState<Record<string, boolean>>({
    composite: true,
    p1: true,
    p2: true,
    p3: false,
    p4: true,
    p5: true,
    p6: false,
    p7: true
  });

  // Synchronize when sovereign changes
  React.useEffect(() => {
    setIslandOverride(sovereign.isIslandState);
  }, [sovereign.id, sovereign.isIslandState]);

  // Compute scorecard with current toggles
  const sovereignWithOverride = { ...sovereign, isIslandState: islandOverride };
  const scorecardResult = computeScorecard(sovereignWithOverride, activeScenario, useForensicRules);

  // Generate historical data series for Recharts
  const historicalData = useMemo(() => {
    return generateHistoricalPillarData(sovereign, timeHorizon);
  }, [sovereign, timeHorizon]);

  // Indicators for the selected pillar
  const pillarIndicators = INDICATOR_MATRIX.filter((ind) => {
    if (selectedPillarId && ind.pillar !== selectedPillarId) return false;
    if (indicatorSearch) {
      const q = indicatorSearch.toLowerCase();
      return ind.name.toLowerCase().includes(q) || ind.id.includes(q) || ind.primarySource.toLowerCase().includes(q);
    }
    return true;
  });

  const toggleAllPillars = (enable: boolean) => {
    setVisibleSeries({
      composite: true,
      p1: enable,
      p2: enable,
      p3: enable,
      p4: enable,
      p5: enable,
      p6: enable,
      p7: enable
    });
  };

  return (
    <div className="space-y-6">
      {/* Executive Scorecard Header */}
      <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{sovereign.flag}</span>
            <h2 className="text-lg font-bold text-slate-100">{sovereign.name} Scorecard Audit</h2>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-[#1a2438] text-slate-300">
              Grade {scorecardResult.grade} / 10
            </span>
            <span className="text-xs text-slate-400 font-mono">
              Composite Score:{' '}
              <span className="text-emerald-400 font-bold text-sm">
                {scorecardResult.compositeScore.toFixed(1)}
              </span>{' '}
              / 100
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Section 3 empirical 7-pillar model with Section 4.2 forensic refinement rules, small island scaling, and
            Recharts historical longitudinal trajectory.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs text-slate-400 font-mono">Select Sovereign:</label>
          <select
            value={sovereign.id}
            onChange={(e) => onSelectSovereign(e.target.value)}
            className="bg-[#111726] border border-[#23314d] text-slate-200 text-xs rounded px-3 py-1.5 font-mono focus:outline-none focus:border-emerald-500 cursor-pointer"
          >
            {allSovereigns.map((s) => (
              <option key={s.id} value={s.id}>
                {s.flag} {s.name} ({s.code})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Forensic Diagnostics & Methodological Toggles (Section 4.2) */}
      <div className="p-4 bg-[#090d16] border border-[#1a2438] rounded-lg space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
            Forensic Diagnostics &amp; Model Refinement Switches (Section 4.2)
          </span>
          <span className="text-[11px] font-mono text-slate-400">
            {useForensicRules ? 'Calibrated Rules Active' : 'Uncalibrated Draft Rules'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          {/* Toggle 1: Forensic Rule 1 (80/20 worst-indicator dampening) */}
          <div className="p-3 bg-[#111726] border border-[#1a2438] rounded flex items-start gap-3">
            <input
              type="checkbox"
              id="forensic1"
              checked={useForensicRules}
              onChange={(e) => setUseForensicRules(e.target.checked)}
              className="mt-0.5 rounded bg-[#1a2438] border-slate-700 text-emerald-500 focus:ring-0 cursor-pointer"
            />
            <label htmlFor="forensic1" className="cursor-pointer">
              <div className="font-semibold text-slate-200">
                Rule 1: 80% Weighted Average / 20% Max-Indicator Dampening
              </div>
              <p className="text-slate-400 text-[11px] mt-0.5">
                Restricts the worst-indicator term (0.2 max s_j) exclusively to metrics weighted ≥ 10%. Prevents
                secondary low-weighted indicators from inflating Chile to Grade 5 (47.3 → 39.2) and Belize to 52.9.
              </p>
            </label>
          </div>

          {/* Toggle 2: Small Island & Coastal State Switch (Pillar 7 15%) */}
          <div className="p-3 bg-[#111726] border border-[#1a2438] rounded flex items-start gap-3">
            <input
              type="checkbox"
              id="islandSwitch"
              checked={islandOverride}
              onChange={(e) => setIslandOverride(e.target.checked)}
              className="mt-0.5 rounded bg-[#1a2438] border-slate-700 text-cyan-500 focus:ring-0 cursor-pointer"
            />
            <label htmlFor="islandSwitch" className="cursor-pointer">
              <div className="font-semibold text-slate-200">
                Pillar 4 / 7 Small Island &amp; Coastal State Proportional Rescaling
              </div>
              <p className="text-slate-400 text-[11px] mt-0.5">
                Applies when population &lt; 1.5M or 1-in-100y disaster loss &ge; 25% GDP. Pillar 7 expands from 5% to
                15%, and the other 6 pillars scale down by 85/95.
              </p>
            </label>
          </div>
        </div>
      </div>

      {/* 7 Pillars Horizontal Overview */}
      <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
        {scorecardResult.pillarBreakdowns.map((p) => {
          const isSelected = selectedPillarId === p.pillarId;
          return (
            <button
              key={p.pillarId}
              onClick={() => setSelectedPillarId(p.pillarId)}
              className={`p-3 text-left rounded-lg border transition-all ${
                isSelected
                  ? 'bg-[#152037] border-emerald-500 text-slate-100 shadow-sm'
                  : 'bg-[#0e1524] border-[#1a2438] text-slate-400 hover:text-slate-200 hover:bg-[#121b2d]'
              }`}
            >
              <div className="flex items-center justify-between text-[11px] font-mono text-emerald-400">
                <span>Pillar {p.pillarId}</span>
                <span>{(p.weight * 100).toFixed(1)}%</span>
              </div>
              <div className="text-xs font-semibold text-slate-200 truncate mt-0.5">{p.name}</div>
              <div className="text-base font-mono font-bold text-slate-100 mt-1">
                {p.score.toFixed(1)}
              </div>
              <div className="w-full bg-[#111726] h-1.5 rounded-full mt-2 overflow-hidden">
                <div
                  className={`h-full ${
                    p.score > 70 ? 'bg-rose-500' : p.score > 45 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(100, p.score)}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Recharts Historical Visualization for the 7-Pillar Indicators */}
      <div className="p-5 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-4">
        {/* Chart Header & Horizon Controls */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1a2438] pb-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-100">
                Historical Indicator Trajectory &amp; Vulnerability Trends
              </h3>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                Recharts Engine
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Longitudinal tracking of composite risk and constituent pillar indicators across historical crisis
              windows (2016–2026).
            </p>
          </div>

          {/* Time Horizon Segmented Buttons */}
          <div className="flex items-center gap-1 p-1 bg-[#090d16] border border-[#1a2438] rounded-lg">
            {[
              { id: '12m', label: '12 Months' },
              { id: '3y', label: '3 Years' },
              { id: '5y', label: '5 Years' },
              { id: '10y', label: '10 Years (2017–2026)' }
            ].map((h) => (
              <button
                key={h.id}
                onClick={() => setTimeHorizon(h.id as TimeHorizon)}
                className={`px-3 py-1 text-xs font-mono rounded transition-colors whitespace-nowrap ${
                  timeHorizon === h.id
                    ? 'bg-emerald-500 text-slate-950 font-bold shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {h.label}
              </button>
            ))}
          </div>
        </div>

        {/* Series Visibility Legend & Filter Toggles */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <div className="flex flex-wrap items-center gap-3">
            {/* Composite Line */}
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-200">
              <input
                type="checkbox"
                checked={visibleSeries.composite}
                onChange={(e) => setVisibleSeries({ ...visibleSeries, composite: e.target.checked })}
                className="rounded bg-[#1a2438] border-slate-700 text-white focus:ring-0"
              />
              <span className="w-2.5 h-0.5 bg-white inline-block"></span>
              <span>Composite</span>
            </label>

            {/* Pillar 1 */}
            <label className="flex items-center gap-1.5 cursor-pointer text-emerald-300">
              <input
                type="checkbox"
                checked={visibleSeries.p1}
                onChange={(e) => setVisibleSeries({ ...visibleSeries, p1: e.target.checked })}
                className="rounded bg-[#1a2438] border-slate-700 text-emerald-500 focus:ring-0"
              />
              <span className="w-2.5 h-0.5 bg-emerald-400 inline-block"></span>
              <span>P1 Fiscal</span>
            </label>

            {/* Pillar 2 */}
            <label className="flex items-center gap-1.5 cursor-pointer text-amber-300">
              <input
                type="checkbox"
                checked={visibleSeries.p2}
                onChange={(e) => setVisibleSeries({ ...visibleSeries, p2: e.target.checked })}
                className="rounded bg-[#1a2438] border-slate-700 text-amber-500 focus:ring-0"
              />
              <span className="w-2.5 h-0.5 bg-amber-400 inline-block"></span>
              <span>P2 External</span>
            </label>

            {/* Pillar 3 */}
            <label className="flex items-center gap-1.5 cursor-pointer text-cyan-300">
              <input
                type="checkbox"
                checked={visibleSeries.p3}
                onChange={(e) => setVisibleSeries({ ...visibleSeries, p3: e.target.checked })}
                className="rounded bg-[#1a2438] border-slate-700 text-cyan-500 focus:ring-0"
              />
              <span className="w-2.5 h-0.5 bg-cyan-400 inline-block"></span>
              <span>P3 Institutional</span>
            </label>

            {/* Pillar 4 */}
            <label className="flex items-center gap-1.5 cursor-pointer text-rose-300">
              <input
                type="checkbox"
                checked={visibleSeries.p4}
                onChange={(e) => setVisibleSeries({ ...visibleSeries, p4: e.target.checked })}
                className="rounded bg-[#1a2438] border-slate-700 text-rose-500 focus:ring-0"
              />
              <span className="w-2.5 h-0.5 bg-rose-400 inline-block"></span>
              <span>P4 Political</span>
            </label>

            {/* Pillar 5 */}
            <label className="flex items-center gap-1.5 cursor-pointer text-purple-300">
              <input
                type="checkbox"
                checked={visibleSeries.p5}
                onChange={(e) => setVisibleSeries({ ...visibleSeries, p5: e.target.checked })}
                className="rounded bg-[#1a2438] border-slate-700 text-purple-500 focus:ring-0"
              />
              <span className="w-2.5 h-0.5 bg-purple-400 inline-block"></span>
              <span>P5 Macro</span>
            </label>

            {/* Pillar 6 */}
            <label className="flex items-center gap-1.5 cursor-pointer text-orange-300">
              <input
                type="checkbox"
                checked={visibleSeries.p6}
                onChange={(e) => setVisibleSeries({ ...visibleSeries, p6: e.target.checked })}
                className="rounded bg-[#1a2438] border-slate-700 text-orange-500 focus:ring-0"
              />
              <span className="w-2.5 h-0.5 bg-orange-400 inline-block"></span>
              <span>P6 Security</span>
            </label>

            {/* Pillar 7 */}
            <label className="flex items-center gap-1.5 cursor-pointer text-teal-300">
              <input
                type="checkbox"
                checked={visibleSeries.p7}
                onChange={(e) => setVisibleSeries({ ...visibleSeries, p7: e.target.checked })}
                className="rounded bg-[#1a2438] border-slate-700 text-teal-500 focus:ring-0"
              />
              <span className="w-2.5 h-0.5 bg-teal-400 inline-block"></span>
              <span>P7 Climate</span>
            </label>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => toggleAllPillars(true)}
              className="text-[11px] text-slate-400 hover:text-slate-200 underline"
            >
              Select All
            </button>
            <span className="text-slate-600">·</span>
            <button
              onClick={() => toggleAllPillars(false)}
              className="text-[11px] text-slate-400 hover:text-slate-200 underline"
            >
              Reset to Composite
            </button>
          </div>
        </div>

        {/* Recharts LineChart Canvas */}
        <div className="h-72 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={historicalData} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a2438" />
              <XAxis
                dataKey="date"
                stroke="#64748b"
                tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
              />
              <YAxis
                domain={[0, 100]}
                stroke="#64748b"
                tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                tickFormatter={(v) => `${v}`}
              />
              <Tooltip content={<CustomChartTooltip historicalData={historicalData} />} />

              {/* Composite Line */}
              {visibleSeries.composite && (
                <Line
                  type="monotone"
                  dataKey="composite"
                  name="Composite Score"
                  stroke="#ffffff"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#ffffff' }}
                  activeDot={{ r: 5 }}
                />
              )}

              {/* Pillar 1 */}
              {visibleSeries.p1 && (
                <Line
                  type="monotone"
                  dataKey="p1_fiscalDebt"
                  name="P1 Fiscal & Debt"
                  stroke="#10b981"
                  strokeWidth={1.8}
                  dot={false}
                />
              )}

              {/* Pillar 2 */}
              {visibleSeries.p2 && (
                <Line
                  type="monotone"
                  dataKey="p2_externalFragility"
                  name="P2 External Fragility"
                  stroke="#f59e0b"
                  strokeWidth={1.8}
                  dot={false}
                />
              )}

              {/* Pillar 3 */}
              {visibleSeries.p3 && (
                <Line
                  type="monotone"
                  dataKey="p3_institutionalIntegrity"
                  name="P3 Institutional Integrity"
                  stroke="#06b6d4"
                  strokeWidth={1.5}
                  dot={false}
                />
              )}

              {/* Pillar 4 */}
              {visibleSeries.p4 && (
                <Line
                  type="monotone"
                  dataKey="p4_politicalDynamics"
                  name="P4 Political Dynamics"
                  stroke="#f43f5e"
                  strokeWidth={1.8}
                  dot={false}
                />
              )}

              {/* Pillar 5 */}
              {visibleSeries.p5 && (
                <Line
                  type="monotone"
                  dataKey="p5_macroFragility"
                  name="P5 Macro Fragility"
                  stroke="#a855f7"
                  strokeWidth={1.8}
                  dot={false}
                />
              )}

              {/* Pillar 6 */}
              {visibleSeries.p6 && (
                <Line
                  type="monotone"
                  dataKey="p6_securityConflict"
                  name="P6 Security & Conflict"
                  stroke="#fb923c"
                  strokeWidth={1.5}
                  dot={false}
                />
              )}

              {/* Pillar 7 */}
              {visibleSeries.p7 && (
                <Line
                  type="monotone"
                  dataKey="p7_climateCatastrophe"
                  name="P7 Climate Catastrophe"
                  stroke="#14b8a6"
                  strokeWidth={1.8}
                  dot={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Chart Bottom Context Indicators */}
        <div className="flex flex-wrap items-center justify-between text-[11px] font-mono text-slate-500 pt-1 border-t border-[#1a2438]">
          <div className="flex items-center gap-4">
            <span>Score Scale: 0 (Calm) → 100 (Critical Tail Risk)</span>
            <span>·</span>
            <span>Horizon: {timeHorizon === '12m' ? '12 Months Monthly' : timeHorizon === '3y' ? '3 Years Quarterly' : timeHorizon === '5y' ? '5 Years Annual' : '10 Years Annual'}</span>
          </div>
          <div className="text-slate-400">
            Hover over any point to inspect historical event annotations and exact indicator scores
          </div>
        </div>
      </div>

      {/* Selected Pillar Detail & Appendix A Indicator Matrix */}
      <div className="p-6 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[#1a2438] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                Pillar {selectedPillarId}
              </span>
              <h3 className="text-base font-bold text-slate-100">
                {PILLARS_METADATA.find((m) => m.id === selectedPillarId)?.name}
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {PILLARS_METADATA.find((m) => m.id === selectedPillarId)?.description}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Filter 83 indicators..."
              value={indicatorSearch}
              onChange={(e) => setIndicatorSearch(e.target.value)}
              className="bg-[#111726] border border-[#23314d] text-xs text-slate-200 px-3 py-1.5 rounded focus:outline-none focus:border-emerald-500 w-52"
            />
          </div>
        </div>

        {/* Appendix A Indicator Threshold Matrix */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#1a2438] bg-[#090d16] text-slate-400 font-mono text-[11px] uppercase">
                <th className="py-2.5 px-3">ID</th>
                <th className="py-2.5 px-3">Indicator Name</th>
                <th className="py-2.5 px-2">Unit</th>
                <th className="py-2.5 px-2 text-right">Weight</th>
                <th className="py-2.5 px-2 text-right">Score 0</th>
                <th className="py-2.5 px-2 text-right">Score 25</th>
                <th className="py-2.5 px-2 text-right">Score 50</th>
                <th className="py-2.5 px-2 text-right">Score 75</th>
                <th className="py-2.5 px-2 text-right">Score 100</th>
                <th className="py-2.5 px-2 text-center">Dir</th>
                <th className="py-2.5 px-3">Primary Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a2438]/60 font-mono text-[11px]">
              {pillarIndicators.map((ind) => (
                <tr key={ind.id} className="hover:bg-[#131d33] transition-colors">
                  <td className="py-2.5 px-3 font-semibold text-emerald-400">{ind.id}</td>
                  <td className="py-2.5 px-3 font-sans font-medium text-slate-200">{ind.name}</td>
                  <td className="py-2.5 px-2 text-slate-400">{ind.unit}</td>
                  <td className="py-2.5 px-2 text-right font-bold text-slate-300">
                    {(ind.weight * 100).toFixed(0)}%
                  </td>
                  <td className="py-2.5 px-2 text-right text-slate-400">{ind.s0}</td>
                  <td className="py-2.5 px-2 text-right text-slate-400">{ind.s25}</td>
                  <td className="py-2.5 px-2 text-right text-slate-300">{ind.s50}</td>
                  <td className="py-2.5 px-2 text-right text-amber-400">{ind.s75}</td>
                  <td className="py-2.5 px-2 text-right text-rose-400 font-bold">{ind.s100}</td>
                  <td className="py-2.5 px-2 text-center text-slate-400">
                    {ind.direction === 1 ? '+1' : '-1'}
                  </td>
                  <td className="py-2.5 px-3 font-sans text-slate-400 text-[10px]">
                    {ind.primarySource}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
