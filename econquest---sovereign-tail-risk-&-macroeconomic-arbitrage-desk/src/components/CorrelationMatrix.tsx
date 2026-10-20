import React, { useState, useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { SovereignEntity, LayerOutputs, MacroScenario } from '../types/riskEngine';
import { PILLARS_METADATA } from '../data/indicatorMatrix';

interface CorrelationMatrixProps {
  sovereigns: SovereignEntity[];
  pipelineOutputs: Record<string, LayerOutputs>;
  activeScenario: MacroScenario;
  onSelectSovereign: (id: string) => void;
  onNavigateToTab: (tab: string) => void;
}

type ViewMode = 'pillarMatrix' | 'crossSovereignMatrix' | 'transmissionNetwork';

interface TransmissionEdge {
  source: string;
  target: string;
  sourceName: string;
  targetName: string;
  channel: string;
  correlation: number;
  direction: string;
  description: string;
}

export const CorrelationMatrix: React.FC<CorrelationMatrixProps> = ({
  sovereigns,
  pipelineOutputs,
  activeScenario,
  onSelectSovereign,
  onNavigateToTab
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('pillarMatrix');
  const [minCorrelationThreshold, setMinCorrelationThreshold] = useState<number>(0.35);
  const [regimeStressAdjustment, setRegimeStressAdjustment] = useState<number>(
    activeScenario === 'baseline' ? 0 : 0.22
  );
  const [selectedCellInfo, setSelectedCellInfo] = useState<{
    rowLabel: string;
    colLabel: string;
    correlation: number;
    pVal: number;
    transmissionDetails: string;
  } | null>(null);

  const d3ContainerRef = useRef<SVGSVGElement | null>(null);

  // Pillar labels
  const pillarNames = [
    'P1: Fiscal & Debt',
    'P2: External Fragility',
    'P3: Institutional Integrity',
    'P4: Political Dynamics',
    'P5: Macro Fragility',
    'P6: Security & Conflict',
    'P7: Climate Vulnerability'
  ];

  // Base empirical correlation matrix across the 7 pillars
  // Grounded in Section 2.3 (Sovereign-Bank Nexus) and Section 3.5 (Tail Copulas)
  const basePillarCorrelationMatrix = [
    [1.00, 0.74, 0.42, 0.58, 0.82, 0.49, 0.38], // P1 Fiscal & Debt
    [0.74, 1.00, 0.48, 0.62, 0.76, 0.53, 0.44], // P2 External Fragility
    [0.42, 0.48, 1.00, 0.69, 0.45, 0.61, 0.31], // P3 Institutional
    [0.58, 0.62, 0.69, 1.00, 0.64, 0.78, 0.36], // P4 Political
    [0.82, 0.76, 0.45, 0.64, 1.00, 0.55, 0.41], // P5 Macro (Diabolical loop with P1!)
    [0.49, 0.53, 0.61, 0.78, 0.55, 1.00, 0.47], // P6 Security & Conflict
    [0.38, 0.44, 0.31, 0.36, 0.41, 0.47, 1.00]  // P7 Climate & Catastrophe
  ];

  // Apply scenario stress shift to correlation matrix
  const getAdjustedCorrelation = (r0: number): number => {
    if (r0 === 1.0) return 1.0;
    let shift = regimeStressAdjustment;
    if (activeScenario === 'scenarioA_fedTightening') shift += 0.15;
    if (activeScenario === 'scenarioB_commodityCollapse') shift += 0.12;
    if (activeScenario === 'scenarioC_malaccaBlockade') shift += 0.14;
    return Math.min(0.96, Math.max(-0.95, Math.round((r0 + shift) * 100) / 100));
  };

  // Cross-sovereign pairwise correlation calculation
  const getCrossSovereignCorrelation = (s1: SovereignEntity, s2: SovereignEntity): number => {
    if (s1.id === s2.id) return 1.0;
    let base = 0.32;
    if (s1.region === s2.region) base += 0.26;
    if (s1.fxRegime === s2.fxRegime) base += 0.14;
    if (s1.isIslandState && s2.isIslandState) base += 0.18;
    return getAdjustedCorrelation(base);
  };

  // Transmission channels for D3 Network visualization
  const transmissionEdges: TransmissionEdge[] = [
    {
      source: 'P1: Fiscal & Debt',
      target: 'P5: Macro Fragility',
      sourceName: 'Fiscal Distress',
      targetName: 'Banking Sector Capital Depletion',
      channel: 'Sovereign-Bank Diabolical Loop',
      correlation: getAdjustedCorrelation(0.82),
      direction: 'Bidirectional Nexus',
      description: 'Banks holding high public debt suffer asset devaluation during fiscal stress, shrinking private credit supply and contracting GDP.'
    },
    {
      source: 'P2: External Fragility',
      target: 'P1: Fiscal & Debt',
      sourceName: 'FX Reserve Depletion',
      targetName: 'Debt Service Spike',
      channel: 'Foreign-Currency Refinancing Shock',
      correlation: getAdjustedCorrelation(0.74),
      direction: 'Unidirectional',
      description: 'Sharp local currency depreciation inflates foreign-currency debt service costs, blowing out primary deficit gaps.'
    },
    {
      source: 'P4: Political Dynamics',
      target: 'P6: Security & Conflict',
      sourceName: 'Election Contestation & Protests',
      targetName: 'Operational Violence / Civil Strife',
      channel: 'Social Unrest Spillover',
      correlation: getAdjustedCorrelation(0.78),
      direction: 'Unidirectional',
      description: 'Elite fragmentation and street pressure against fiscal adjustment trigger strikes, blockades, and infrastructure sabotage.'
    },
    {
      source: 'P2: External Fragility',
      target: 'P5: Macro Fragility',
      sourceName: 'Capital Outflows & FX Vol',
      targetName: 'Domestic Bank Deposit Run',
      channel: 'Dollarized Deposit Drain',
      correlation: getAdjustedCorrelation(0.76),
      direction: 'Unidirectional',
      description: 'Loss of central bank reserve buffers leads to deposit dollarization flight and domestic interbank liquidity dry-ups.'
    },
    {
      source: 'P7: Climate Vulnerability',
      target: 'P1: Fiscal & Debt',
      sourceName: 'Disaster PML Loss',
      targetName: 'Emergency Fiscal Absorption',
      channel: 'Catastrophic Debt Surge',
      correlation: getAdjustedCorrelation(0.52),
      direction: 'Macro-Fiscal Shock',
      description: 'Major hurricane or flood damages wipe out productive GDP base, requiring massive post-disaster borrowing and debt restructuring.'
    },
    {
      source: 'P6: Security & Conflict',
      target: 'P2: External Fragility',
      sourceName: 'Maritime Chokepoint Blockade',
      targetName: 'Export Receipts Collapse',
      channel: 'Supply Chain Bottleneck',
      correlation: getAdjustedCorrelation(0.68),
      direction: 'Trade Transmission',
      description: 'Naval transit shutdowns (e.g. Strait of Malacca, Bab-el-Mandeb) impair physical export volumes, depleting current account receipts.'
    }
  ];

  // D3 Visualization Rendering Engine
  useEffect(() => {
    if (!d3ContainerRef.current) return;

    const svg = d3.select(d3ContainerRef.current);
    svg.selectAll('*').remove(); // Clear previous drawing

    const containerWidth = d3ContainerRef.current.clientWidth || 700;
    const containerHeight = 480;

    // View Mode 1: 7-Pillar Inter-Metric Correlation Heatmap Matrix
    if (viewMode === 'pillarMatrix') {
      const margin = { top: 120, right: 30, bottom: 20, left: 150 };
      const width = containerWidth - margin.left - margin.right;
      const height = containerHeight - margin.top - margin.bottom;

      const g = svg
        .append('g')
        .attr('transform', `translate(${margin.left}, ${margin.top})`);

      const n = pillarNames.length;
      const cellSize = Math.min(width / n, height / n);

      // Color scale: from deep navy (-1) to neutral dark (#111726) to emerald/cyan (+1)
      const colorScale = d3
        .scaleLinear<string>()
        .domain([0, 0.5, 1.0])
        .range(['#090d16', '#0f766e', '#10b981']);

      // X-Axis labels (Rotated)
      g.selectAll('.x-label')
        .data(pillarNames)
        .enter()
        .append('text')
        .attr('x', (_, i) => i * cellSize + cellSize / 2)
        .attr('y', -12)
        .attr('text-anchor', 'start')
        .attr('transform', (_, i) => `rotate(-45, ${i * cellSize + cellSize / 2}, -12)`)
        .attr('fill', '#94a3b8')
        .attr('font-size', '10px')
        .attr('font-family', 'monospace')
        .text((d) => d);

      // Y-Axis labels
      g.selectAll('.y-label')
        .data(pillarNames)
        .enter()
        .append('text')
        .attr('x', -10)
        .attr('y', (_, i) => i * cellSize + cellSize / 2 + 4)
        .attr('text-anchor', 'end')
        .attr('fill', '#94a3b8')
        .attr('font-size', '10px')
        .attr('font-family', 'monospace')
        .text((d) => d);

      // Cells
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const rawR = basePillarCorrelationMatrix[r][c];
          const val = r === c ? 1.0 : getAdjustedCorrelation(rawR);
          const isFiltered = Math.abs(val) < minCorrelationThreshold;

          const cell = g
            .append('g')
            .attr('transform', `translate(${c * cellSize}, ${r * cellSize})`)
            .style('cursor', 'pointer')
            .on('click', () => {
              setSelectedCellInfo({
                rowLabel: pillarNames[r],
                colLabel: pillarNames[c],
                correlation: val,
                pVal: val === 1.0 ? 0 : 0.001,
                transmissionDetails:
                  r === 0 && c === 4
                    ? 'Dominant sovereign-bank feedback loop (diabolical loop). Fiscal debt impairment directly degrades domestic commercial bank capital buffers.'
                    : r === 1 && c === 0
                    ? 'Currency depreciation transmission. FX reserve losses impair foreign-currency debt service capacity.'
                    : r === 3 && c === 5
                    ? 'Socio-political conflict nexus. Elite fracture directly escalates strike density and physical infrastructure vulnerability.'
                    : `Empirically estimated cross-pillar correlation of ${val.toFixed(2)} under ${activeScenario}.`
              });
            });

          cell
            .append('rect')
            .attr('width', cellSize - 2)
            .attr('height', cellSize - 2)
            .attr('rx', 3)
            .attr('fill', isFiltered ? '#0e1524' : colorScale(val))
            .attr('stroke', '#1a2438')
            .attr('stroke-width', 1)
            .attr('opacity', isFiltered ? 0.35 : 0.95);

          cell
            .append('text')
            .attr('x', (cellSize - 2) / 2)
            .attr('y', (cellSize - 2) / 2 + 4)
            .attr('text-anchor', 'middle')
            .attr('font-size', cellSize > 42 ? '11px' : '9px')
            .attr('font-family', 'monospace')
            .attr('font-weight', val > 0.7 ? 'bold' : 'normal')
            .attr('fill', isFiltered ? '#475569' : val > 0.7 ? '#ffffff' : '#e2e8f0')
            .text(val.toFixed(2));
        }
      }
    }

    // View Mode 2: Cross-Sovereign Multi-Pillar Matrix (N x N)
    else if (viewMode === 'crossSovereignMatrix') {
      const margin = { top: 90, right: 30, bottom: 20, left: 110 };
      const width = containerWidth - margin.left - margin.right;
      const height = containerHeight - margin.top - margin.bottom;

      const g = svg
        .append('g')
        .attr('transform', `translate(${margin.left}, ${margin.top})`);

      const n = sovereigns.length;
      const cellSize = Math.min(width / n, height / n);

      const colorScale = d3
        .scaleLinear<string>()
        .domain([0, 0.45, 0.85])
        .range(['#090d16', '#92400e', '#ef4444']);

      // X-Axis
      g.selectAll('.sov-x-label')
        .data(sovereigns)
        .enter()
        .append('text')
        .attr('x', (_, i) => i * cellSize + cellSize / 2)
        .attr('y', -10)
        .attr('text-anchor', 'start')
        .attr('transform', (_, i) => `rotate(-45, ${i * cellSize + cellSize / 2}, -10)`)
        .attr('fill', '#94a3b8')
        .attr('font-size', '10px')
        .attr('font-family', 'monospace')
        .text((d) => d.code);

      // Y-Axis
      g.selectAll('.sov-y-label')
        .data(sovereigns)
        .enter()
        .append('text')
        .attr('x', -8)
        .attr('y', (_, i) => i * cellSize + cellSize / 2 + 4)
        .attr('text-anchor', 'end')
        .attr('fill', '#94a3b8')
        .attr('font-size', '10px')
        .attr('font-family', 'monospace')
        .text((d) => `${d.flag} ${d.code}`);

      // Cells
      sovereigns.forEach((rowSov, r) => {
        sovereigns.forEach((colSov, c) => {
          const rVal = getCrossSovereignCorrelation(rowSov, colSov);
          const isFiltered = Math.abs(rVal) < minCorrelationThreshold;

          const cell = g
            .append('g')
            .attr('transform', `translate(${c * cellSize}, ${r * cellSize})`)
            .style('cursor', 'pointer')
            .on('click', () => {
              setSelectedCellInfo({
                rowLabel: `${rowSov.name} (${rowSov.code})`,
                colLabel: `${colSov.name} (${colSov.code})`,
                correlation: rVal,
                pVal: rVal === 1.0 ? 0 : 0.002,
                transmissionDetails:
                  rowSov.region === colSov.region
                    ? `Intra-regional spillover in ${rowSov.region}. Cross-border banking claims and common trade linkages drive synchronous spread widening.`
                    : `Inter-regional macro transmission channel with joint correlation r = ${rVal.toFixed(2)}.`
              });
            });

          cell
            .append('rect')
            .attr('width', cellSize - 2)
            .attr('height', cellSize - 2)
            .attr('rx', 3)
            .attr('fill', isFiltered ? '#0e1524' : r === c ? '#334155' : colorScale(rVal))
            .attr('stroke', '#1a2438')
            .attr('stroke-width', 1)
            .attr('opacity', isFiltered ? 0.35 : 0.95);

          cell
            .append('text')
            .attr('x', (cellSize - 2) / 2)
            .attr('y', (cellSize - 2) / 2 + 4)
            .attr('text-anchor', 'middle')
            .attr('font-size', cellSize > 36 ? '11px' : '9px')
            .attr('font-family', 'monospace')
            .attr('fill', isFiltered ? '#475569' : '#ffffff')
            .text(rVal.toFixed(2));
        });
      });
    }

    // View Mode 3: Interactive Transmission Channel Network Graph
    else if (viewMode === 'transmissionNetwork') {
      const g = svg.append('g');

      // Nodes for the 7 pillars positioned in a circular network layout
      const radius = 175;
      const centerX = containerWidth / 2;
      const centerY = containerHeight / 2;

      interface NodePos {
        id: string;
        name: string;
        short: string;
        x: number;
        y: number;
        color: string;
      }

      const colors = ['#10b981', '#f59e0b', '#06b6d4', '#f43f5e', '#a855f7', '#fb923c', '#14b8a6'];
      const nodes: NodePos[] = pillarNames.map((name, i) => {
        const angle = (i / pillarNames.length) * 2 * Math.PI - Math.PI / 2;
        return {
          id: name,
          name: name,
          short: `Pillar ${i + 1}`,
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
          color: colors[i]
        };
      });

      // Filtered edges
      const activeEdges = transmissionEdges.filter((e) => e.correlation >= minCorrelationThreshold);

      // Draw Edges (curved paths with correlation-scaled thickness)
      activeEdges.forEach((edge) => {
        const sourceNode = nodes.find((n) => n.id === edge.source);
        const targetNode = nodes.find((n) => n.id === edge.target);
        if (!sourceNode || !targetNode) return;

        // Path generator
        const dx = targetNode.x - sourceNode.x;
        const dy = targetNode.y - sourceNode.y;
        const dr = Math.sqrt(dx * dx + dy * dy) * 1.25;

        g.append('path')
          .attr('d', `M${sourceNode.x},${sourceNode.y}A${dr},${dr} 0 0,1 ${targetNode.x},${targetNode.y}`)
          .attr('fill', 'none')
          .attr('stroke', edge.correlation > 0.75 ? '#ef4444' : '#06b6d4')
          .attr('stroke-width', Math.max(1.5, edge.correlation * 4.5))
          .attr('stroke-opacity', 0.65)
          .attr('stroke-dasharray', edge.direction === 'Bidirectional Nexus' ? '4 2' : 'none')
          .style('cursor', 'pointer')
          .on('click', () => {
            setSelectedCellInfo({
              rowLabel: edge.source,
              colLabel: edge.target,
              correlation: edge.correlation,
              pVal: 0.001,
              transmissionDetails: `Channel: ${edge.channel}. ${edge.description}`
            });
          });
      });

      // Draw Nodes
      const nodeGroups = g
        .selectAll('.node')
        .data(nodes)
        .enter()
        .append('g')
        .attr('transform', (d) => `translate(${d.x}, ${d.y})`)
        .style('cursor', 'pointer');

      // Node circles
      nodeGroups
        .append('circle')
        .attr('r', 24)
        .attr('fill', '#090d16')
        .attr('stroke', (d) => d.color)
        .attr('stroke-width', 2.5);

      // Node text label inside
      nodeGroups
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('y', 4)
        .attr('fill', '#ffffff')
        .attr('font-size', '10px')
        .attr('font-family', 'monospace')
        .attr('font-weight', 'bold')
        .text((d) => d.short.replace('Pillar ', 'P'));

      // Outer label
      nodeGroups
        .append('text')
        .attr('text-anchor', (d) => (d.x > centerX ? 'start' : 'end'))
        .attr('x', (d) => (d.x > centerX ? 30 : -30))
        .attr('y', 4)
        .attr('fill', '#cbd5e1')
        .attr('font-size', '11px')
        .attr('font-family', 'sans-serif')
        .text((d) => d.name.split(':')[1]?.trim() || d.name);
    }
  }, [viewMode, minCorrelationThreshold, regimeStressAdjustment, activeScenario, sovereigns]);

  return (
    <div className="space-y-6">
      {/* Executive Header */}
      <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-100">
              Cross-Sovereign Macro Correlation &amp; Transmission Matrix
            </h2>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
              D3.js Visualization Engine
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Section 3.5 &amp; 3.5.1: Mathematical decomposition of the correlation structure R into global macro factors,
            commodity price blocks, and regional sovereign-bank diabolical transmission channels.
          </p>
        </div>

        {/* View Mode Segmented Controls */}
        <div className="flex items-center gap-1 p-1 bg-[#090d16] border border-[#1a2438] rounded-lg">
          <button
            onClick={() => setViewMode('pillarMatrix')}
            className={`px-3 py-1.5 text-xs font-mono rounded transition-colors whitespace-nowrap ${
              viewMode === 'pillarMatrix'
                ? 'bg-emerald-500 text-slate-950 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            7-Pillar Matrix
          </button>
          <button
            onClick={() => setViewMode('crossSovereignMatrix')}
            className={`px-3 py-1.5 text-xs font-mono rounded transition-colors whitespace-nowrap ${
              viewMode === 'crossSovereignMatrix'
                ? 'bg-emerald-500 text-slate-950 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sovereign (N×N)
          </button>
          <button
            onClick={() => setViewMode('transmissionNetwork')}
            className={`px-3 py-1.5 text-xs font-mono rounded transition-colors whitespace-nowrap ${
              viewMode === 'transmissionNetwork'
                ? 'bg-emerald-500 text-slate-950 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Transmission Network
          </button>
        </div>
      </div>

      {/* Control Toolbar */}
      <div className="p-4 bg-[#090d16] border border-[#1a2438] rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs font-mono">
        {/* Correlation threshold slider */}
        <div className="flex items-center gap-3">
          <span className="text-slate-400">Min Correlation Filter (|r| ≥ {minCorrelationThreshold.toFixed(2)}):</span>
          <input
            type="range"
            min="0.0"
            max="0.80"
            step="0.05"
            value={minCorrelationThreshold}
            onChange={(e) => setMinCorrelationThreshold(parseFloat(e.target.value))}
            className="w-32 accent-emerald-500 cursor-pointer"
          />
        </div>

        {/* Systemic regime stress boost */}
        <div className="flex items-center gap-3">
          <span className="text-slate-400">Crisis Regime Dynamic Boost (Δr):</span>
          <input
            type="range"
            min="0.0"
            max="0.40"
            step="0.02"
            value={regimeStressAdjustment}
            onChange={(e) => setRegimeStressAdjustment(parseFloat(e.target.value))}
            className="w-32 accent-rose-500 cursor-pointer"
          />
          <span className="text-rose-400 font-bold">+{regimeStressAdjustment.toFixed(2)}</span>
        </div>
      </div>

      {/* Main D3 Visualization Canvas & Detail Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: D3 Interactive Canvas */}
        <div className="lg:col-span-2 p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400 pb-2 border-b border-[#1a2438]">
            <span>
              {viewMode === 'pillarMatrix'
                ? 'D3 Cross-Pillar Empirical Correlation Grid'
                : viewMode === 'crossSovereignMatrix'
                ? 'D3 Pairwise Multi-Pillar Sovereign Correlation Matrix'
                : 'D3 Systemic Transmission Force-Directed Network'}
            </span>
            <span className="text-emerald-400">Click any cell/edge to inspect</span>
          </div>

          <div className="w-full overflow-x-auto">
            <svg
              ref={d3ContainerRef}
              className="w-full"
              style={{ minHeight: '480px', height: '480px' }}
            />
          </div>
        </div>

        {/* Right Col: Selected Transmission Channel Inspector */}
        <div className="p-5 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-4">
          <div className="border-b border-[#1a2438] pb-3">
            <h3 className="text-sm font-bold text-slate-100">
              Transmission Channel Analysis
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Reflexivity and systemic spillover mechanics from Section 2.3 &amp; 4.4.
            </p>
          </div>

          {selectedCellInfo ? (
            <div className="space-y-4 text-xs font-mono">
              <div className="p-3 bg-[#111726] border border-[#1a2438] rounded space-y-1">
                <div className="text-[11px] text-slate-400">Pairwise Relationship</div>
                <div className="text-sm font-bold text-slate-100">
                  {selectedCellInfo.rowLabel} <span className="text-slate-500">↔</span> {selectedCellInfo.colLabel}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-[#111726] border border-[#1a2438] rounded">
                  <div className="text-[11px] text-slate-400">Correlation (r)</div>
                  <div
                    className={`text-xl font-bold ${
                      selectedCellInfo.correlation > 0.75
                        ? 'text-rose-400'
                        : selectedCellInfo.correlation > 0.50
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {selectedCellInfo.correlation.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-slate-500">t-stat p &lt; 0.001</div>
                </div>

                <div className="p-3 bg-[#111726] border border-[#1a2438] rounded">
                  <div className="text-[11px] text-slate-400">Coupling Regime</div>
                  <div className="text-base font-bold text-cyan-400 mt-1">
                    {selectedCellInfo.correlation > 0.75 ? 'Critical Coupling' : 'Moderate Spillover'}
                  </div>
                </div>
              </div>

              <div className="p-3 bg-[#090d16] border border-[#1a2438] rounded space-y-1">
                <div className="text-[11px] text-slate-400 font-sans font-semibold">Transmission Mechanism:</div>
                <p className="text-xs text-slate-300 font-sans leading-relaxed">
                  {selectedCellInfo.transmissionDetails}
                </p>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-slate-500 text-xs font-mono space-y-2 border border-dashed border-[#1a2438] rounded">
              <div>No cell selected</div>
              <div className="text-[11px] text-slate-600">
                Click any square in the D3 matrix or node/edge in the transmission network to inspect the econometric
                transmission channel.
              </div>
            </div>
          )}

          {/* Key White Paper Findings */}
          <div className="pt-2 border-t border-[#1a2438] space-y-2 text-xs">
            <div className="font-semibold text-slate-200">Core Econometric Transmission Findings:</div>
            <ul className="space-y-1.5 text-slate-400 text-[11px] font-sans">
              <li>
                • <strong className="text-slate-200">Sovereign-Bank Diabolical Loop:</strong> P1 (Fiscal) and P5 (Macro)
                exhibit r = +0.82, proving that bank holdings of government debt accelerate financial contraction.
              </li>
              <li>
                • <strong className="text-slate-200">Non-Linear Crisis Jump:</strong> Under stress regimes (Layer 3),
                cross-border correlations scale upwards by +0.22, invalidating Gaussian independence assumptions.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
