import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import {
  SovereignEntity,
  LayerOutputs,
  MacroScenario
} from '../types/riskEngine';
import {
  ContagionChannelFilter,
  simulateContagionCascade
} from '../math/institutionalMacroAnalytics';

interface ContagionCascadeDeskProps {
  sovereigns: SovereignEntity[];
  pipelineOutputs: Record<string, LayerOutputs>;
  selectedSovereignId: string;
  onSelectSovereign: (id: string) => void;
  activeScenario: MacroScenario;
  onNavigateToTab: (tab: string) => void;
}

export const ContagionCascadeDesk: React.FC<ContagionCascadeDeskProps> = ({
  sovereigns,
  pipelineOutputs,
  selectedSovereignId,
  onSelectSovereign,
  activeScenario,
  onNavigateToTab
}) => {
  const [shockedIds, setShockedIds] = useState<string[]>(['argentina', 'pakistan']);
  const [shockLgdSeverityPct, setShockLgdSeverityPct] = useState<number>(68);
  const [contagionAmplification, setContagionAmplification] = useState<number>(1.15);
  const [channelFilter, setChannelFilter] = useState<ContagionChannelFilter>('all');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const toggleShockedSovereign = (id: string) => {
    setShockedIds((prev) =>
      prev.includes(id) ? (prev.length > 1 ? prev.filter((item) => item !== id) : prev) : [...prev, id]
    );
  };

  const simulation = useMemo(
    () =>
      simulateContagionCascade(
        sovereigns,
        pipelineOutputs,
        shockedIds,
        shockLgdSeverityPct,
        contagionAmplification,
        channelFilter
      ),
    [
      sovereigns,
      pipelineOutputs,
      shockedIds,
      shockLgdSeverityPct,
      contagionAmplification,
      channelFilter
    ]
  );

  // Compute circular coordinates for the interactive SVG network topology
  const networkGeometry = useMemo(() => {
    const cx = 280;
    const cy = 220;
    const radius = 158;
    const count = simulation.nodes.length;

    const coords: Record<string, { x: number; y: number }> = {};
    simulation.nodes.forEach((node, idx) => {
      const angle = (2 * Math.PI * idx) / count - Math.PI / 2;
      coords[node.sovereignId] = {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle)
      };
    });

    return { cx, cy, coords };
  }, [simulation.nodes]);

  const sortedNodes = useMemo(
    () =>
      [...simulation.nodes].sort(
        (a, b) => b.round3TerminalHazardPct - a.round3TerminalHazardPct
      ),
    [simulation.nodes]
  );

  return (
    <div className="space-y-6">
      {/* Top Header & Simulation Controls */}
      <div className="p-5 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-3 border-b border-[#1a2438]">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
              <span>Cross-Border Systemic Contagion Lab</span>
              <span aria-hidden="true">·</span>
              <span>3-Round DebtRank & BIS Interbank Clearing</span>
              <span aria-hidden="true">·</span>
              <span>Active Macro State: {activeScenario}</span>
            </div>
            <h2 className="text-lg font-bold text-slate-100 tracking-tight">
              Bilateral Sovereign Spillover Network & Multi-Hop Default Cascade Simulator
            </h2>
          </div>

          {/* Channel Segmented Controls */}
          <div className="flex items-center gap-1 bg-[#090d16] p-1 rounded border border-[#1a2438]">
            {(
              [
                { id: 'all', label: 'All Channels' },
                { id: 'trade', label: 'Trade Linkages' },
                { id: 'banking', label: 'BIS Banking Claims' },
                { id: 'financial', label: 'ETF / FX Co-Movement' }
              ] as { id: ContagionChannelFilter; label: string }[]
            ).map((ch) => (
              <button
                key={ch.id}
                onClick={() => setChannelFilter(ch.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  channelFilter === ch.id
                    ? 'bg-[#17233b] text-emerald-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {ch.label}
              </button>
            ))}
          </div>
        </div>

        {/* Interactive Seed Default Triggers & Parameter Sliders */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
          <div className="lg:col-span-7 space-y-1.5">
            <div className="text-xs text-slate-400 font-medium">
              Select Initial Seed Default / Credit Event Triggers (Click to toggle sovereign shock):
            </div>
            <div className="flex flex-wrap gap-1.5">
              {sovereigns.map((s) => {
                const isShocked = shockedIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleShockedSovereign(s.id)}
                    className={`px-2.5 py-1 rounded text-xs font-mono transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 border ${
                      isShocked
                        ? 'bg-rose-950/80 border-rose-500 text-rose-200 font-bold'
                        : 'bg-[#090d16] border-[#1e2c46] text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <span>{s.flag}</span>
                    <span>{s.code}</span>
                    {isShocked && <span className="text-[10px] text-rose-400">⚡ TRIGGER</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#090d16] p-3 rounded border border-[#1a2438]">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-400">Trigger LGD Haircut</span>
                <span className="font-mono font-bold text-rose-400 tabular-nums">
                  {shockLgdSeverityPct}%
                </span>
              </div>
              <input
                type="range"
                min={30}
                max={95}
                step={5}
                value={shockLgdSeverityPct}
                onChange={(e) => setShockLgdSeverityPct(Number(e.target.value))}
                className="w-full accent-rose-500 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-400">Interbank Liquidity Beta</span>
                <span className="font-mono font-bold text-amber-400 tabular-nums">
                  {contagionAmplification.toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={2.0}
                step={0.05}
                value={contagionAmplification}
                onChange={(e) => setContagionAmplification(Number(e.target.value))}
                className="w-full accent-amber-500 cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 4-Column Contagion KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">
            Systemic Amplification Multiplier
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-rose-400">
              {simulation.systemicAmplificationMultiplier.toFixed(2)}x
            </span>
            <span className="text-xs text-slate-400">non-trigger hazard lift</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Round 3 Equilibrium vs. Round 0 Prior
          </div>
        </div>

        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">
            Secondary Cascade Breaches
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-amber-400">
              {simulation.cascadeBreachCount}
            </span>
            <span className="text-xs text-slate-400">
              sovereigns pushed &ge; 25% PD
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Seed Triggers: {shockedIds.length} active
          </div>
        </div>

        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">
            Induced Cross-Border Capital Flight
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-slate-100">
              ${simulation.totalInducedCapitalFlightBln}B
            </span>
            <span className="text-xs text-rose-400">FX reserve drain</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Cumulative Round 1–3 Outflow
          </div>
        </div>

        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">
            Mean Contagion CDS Widening
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-cyan-400">
              +{simulation.avgSpreadContagionBps} bps
            </span>
            <span className="text-xs text-slate-400">5Y par spread shift</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Active Channel: {channelFilter.toUpperCase()}
          </div>
        </div>
      </div>

      {/* 2-Column Network Graph + Multi-Round Cascade Bar Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left 6 Cols: Interactive Bilateral Contagion Network SVG */}
        <div className="lg:col-span-6 p-5 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col justify-between">
          <div className="mb-3 pb-3 border-b border-[#1a2438] flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                01. Bilateral Sovereign Contagion Topology
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Hover over a sovereign node to inspect bilateral transmission weights; click to toggle shock trigger
              </p>
            </div>
          </div>

          <div className="relative flex items-center justify-center bg-[#080c14] border border-[#1a2438] rounded-lg overflow-hidden">
            <svg viewBox="0 0 560 440" className="w-full h-80 select-none">
              <defs>
                <marker
                  id="contagion-arrow"
                  viewBox="0 0 10 10"
                  refX="22"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#475569" />
                </marker>
                <marker
                  id="contagion-arrow-shock"
                  viewBox="0 0 10 10"
                  refX="22"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#f43f5e" />
                </marker>
              </defs>

              {/* Bilateral Directed Edges */}
              {simulation.edges.map((edge, idx) => {
                const src = networkGeometry.coords[edge.sourceId];
                const dst = networkGeometry.coords[edge.targetId];
                if (!src || !dst) return null;

                const isSourceShocked = shockedIds.includes(edge.sourceId);
                const isHighlighted =
                  hoveredNodeId === edge.sourceId || hoveredNodeId === edge.targetId;

                if (!isHighlighted && edge.compositeWeight < 0.25 && !isSourceShocked) {
                  return null;
                }

                return (
                  <line
                    key={`${edge.sourceId}-${edge.targetId}-${idx}`}
                    x1={src.x}
                    y1={src.y}
                    x2={dst.x}
                    y2={dst.y}
                    stroke={
                      isSourceShocked
                        ? '#f43f5e'
                        : isHighlighted
                        ? '#06b6d4'
                        : '#334155'
                    }
                    strokeWidth={Math.max(1, edge.compositeWeight * 4.2)}
                    strokeOpacity={
                      isHighlighted ? 0.9 : isSourceShocked ? 0.65 : 0.28
                    }
                    markerEnd={
                      isSourceShocked
                        ? 'url(#contagion-arrow-shock)'
                        : 'url(#contagion-arrow)'
                    }
                  />
                );
              })}

              {/* Sovereign Nodes */}
              {simulation.nodes.map((node) => {
                const pt = networkGeometry.coords[node.sovereignId];
                if (!pt) return null;

                const fillColor =
                  node.statusAfterCascade === 'Seed Default'
                    ? '#f43f5e'
                    : node.statusAfterCascade === 'Cascade Breach'
                    ? '#f97316'
                    : node.statusAfterCascade === 'Stressed Spillover'
                    ? '#eab308'
                    : '#10b981';

                const radius = Math.min(
                  24,
                  Math.max(15, 13 + node.round3TerminalHazardPct * 0.14)
                );

                return (
                  <g
                    key={node.sovereignId}
                    transform={`translate(${pt.x}, ${pt.y})`}
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredNodeId(node.sovereignId)}
                    onMouseLeave={() => setHoveredNodeId(null)}
                    onClick={() => toggleShockedSovereign(node.sovereignId)}
                  >
                    <circle
                      r={radius + 4}
                      fill={fillColor}
                      fillOpacity={node.isInitialTrigger ? 0.28 : 0.12}
                    />
                    <circle
                      r={radius}
                      fill="#0b111e"
                      stroke={fillColor}
                      strokeWidth={node.isInitialTrigger ? 3 : 2}
                    />
                    <text
                      textAnchor="middle"
                      dy="-1"
                      fill="#f8fafc"
                      fontSize="10"
                      fontWeight="bold"
                      fontFamily="monospace"
                    >
                      {node.code}
                    </text>
                    <text
                      textAnchor="middle"
                      dy="10"
                      fill={fillColor}
                      fontSize="9"
                      fontFamily="monospace"
                    >
                      {node.round3TerminalHazardPct.toFixed(0)}%
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="mt-3 pt-3 border-t border-[#1a2438] flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <div className="flex items-center gap-3">
              <span className="text-rose-400 font-medium">● Seed Default</span>
              <span className="text-orange-400 font-medium">● Cascade Breach</span>
              <span className="text-amber-400 font-medium">● Stressed Spillover</span>
              <span className="text-emerald-400 font-medium">● Resilient</span>
            </div>
            <span className="font-mono text-[11px] tabular-nums">
              {simulation.edges.length} active bilateral channels
            </span>
          </div>
        </div>

        {/* Right 6 Cols: Round-by-Round Hazard Cascade Chart */}
        <div className="lg:col-span-6 p-5 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col justify-between">
          <div>
            <div className="mb-3 pb-3 border-b border-[#1a2438]">
              <h3 className="text-sm font-bold text-slate-100">
                02. Multi-Hop Default Hazard Propagation (Round 0 → Round 3)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Decomposition of Baseline Prior vs. Round 1 Direct Hit, Round 2 Liquidity Spiral, and Round 3 Equilibrium
              </p>
            </div>

            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={sortedNodes}
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
                    dataKey="baselineHazardPct"
                    name="Round 0: Baseline Hazard"
                    fill="#10b981"
                  />
                  <Bar
                    dataKey="round1DirectHazardPct"
                    name="Round 1: Direct Bilateral Hit"
                    fill="#eab308"
                  />
                  <Bar
                    dataKey="round2LiquidityHazardPct"
                    name="Round 2: Interbank Margin Spiral"
                    fill="#f97316"
                  />
                  <Bar
                    dataKey="round3TerminalHazardPct"
                    name="Round 3: Terminal Equilibrium"
                    fill="#f43f5e"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-[#1a2438] flex items-center justify-between text-xs text-slate-400 font-mono tabular-nums">
            <span>Clearing Algorithm: Eisenberg-Noe / DebtRank</span>
            <button
              onClick={() => onNavigateToTab('correlation')}
              className="text-cyan-400 hover:text-cyan-300 font-sans underline"
            >
              Inspect 7-Pillar Indicator Correlations →
            </button>
          </div>
        </div>
      </div>

      {/* Full Contagion Cascade Ledger Table */}
      <div className="bg-[#0e1524] border border-[#1a2438] rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#1a2438] flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-100">
              03. Sovereign Cascade Impact & Spillover Ledger
            </h3>
            <p className="text-xs text-slate-400">
              Complete round-by-round default probability delta, induced 5Y CDS widening, and FX reserve drain
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#1a2438] bg-[#090d16] text-slate-400 font-mono text-[11px] uppercase">
                <th className="py-2.5 px-4">Sovereign</th>
                <th className="py-2.5 px-3">Cascade Status</th>
                <th className="py-2.5 px-3 text-right">R0 Prior PD</th>
                <th className="py-2.5 px-3 text-right">R1 Direct</th>
                <th className="py-2.5 px-3 text-right">R2 Liquidity</th>
                <th className="py-2.5 px-3 text-right">R3 Terminal</th>
                <th className="py-2.5 px-3 text-right">Contagion Δ</th>
                <th className="py-2.5 px-3 text-right">Induced CDS Shift</th>
                <th className="py-2.5 px-4 text-right">FX Flight ($B)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a2438]/70 font-mono tabular-nums">
              {sortedNodes.map((n) => (
                <tr
                  key={n.sovereignId}
                  onClick={() => onSelectSovereign(n.sovereignId)}
                  className={`cursor-pointer transition-colors ${
                    n.sovereignId === selectedSovereignId
                      ? 'bg-[#15223c]'
                      : 'hover:bg-[#121c31]'
                  }`}
                >
                  <td className="py-2.5 px-4 font-sans">
                    <div className="flex items-center gap-2">
                      <span>{n.flag}</span>
                      <span className="font-semibold text-slate-100">{n.name}</span>
                      <span className="text-[11px] font-mono text-slate-400">{n.code}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 font-sans">
                    <span
                      className={
                        n.statusAfterCascade === 'Seed Default'
                          ? 'text-rose-400 font-semibold'
                          : n.statusAfterCascade === 'Cascade Breach'
                          ? 'text-orange-400 font-semibold'
                          : n.statusAfterCascade === 'Stressed Spillover'
                          ? 'text-amber-400 font-medium'
                          : 'text-emerald-400'
                      }
                    >
                      {n.statusAfterCascade}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-300">
                    {n.baselineHazardPct.toFixed(1)}%
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-300">
                    {n.round1DirectHazardPct.toFixed(1)}%
                  </td>
                  <td className="py-2.5 px-3 text-right text-amber-300">
                    {n.round2LiquidityHazardPct.toFixed(1)}%
                  </td>
                  <td className="py-2.5 px-3 text-right font-bold text-slate-100">
                    {n.round3TerminalHazardPct.toFixed(1)}%
                  </td>
                  <td className="py-2.5 px-3 text-right text-rose-400 font-bold">
                    +{n.totalHazardDeltaPct.toFixed(1)}%
                  </td>
                  <td className="py-2.5 px-3 text-right text-cyan-400">
                    +{n.inducedCdsWideningBps} bps
                  </td>
                  <td className="py-2.5 px-4 text-right text-amber-400">
                    ${n.capitalFlightDrainBln.toFixed(2)}B
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
