import React, { useState, useMemo, useEffect } from 'react';
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
  Tooltip
} from 'recharts';
import { SovereignEntity, LayerOutputs, MacroScenario, CustomScenarioParams } from '../types/riskEngine';
import { computeScorecard } from '../math/riskCalculations';

interface PeerComparisonOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  sovereigns: SovereignEntity[];
  pipelineOutputs: Record<string, LayerOutputs>;
  initialSelectedId: string;
  activeScenario: MacroScenario;
  customParams?: CustomScenarioParams;
  onSelectSovereign: (id: string) => void;
  onNavigateToTab: (tab: string) => void;
}

const PEER_COLORS = [
  '#06b6d4', // Cyan
  '#f43f5e', // Rose
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#a855f7', // Purple
  '#3b82f6', // Blue
  '#ec4899', // Pink
  '#14b8a6', // Teal
  '#84cc16', // Lime
  '#eab308'  // Yellow
];

interface PillarDataPoint {
  pillarKey: string;
  pillarShort: string;
  pillarFull: string;
  fullMark: number;
  [sovereignId: string]: string | number;
}

interface TailRiskDataPoint {
  metricKey: string;
  metricLabel: string;
  description: string;
  fullMark: number;
  [sovereignId: string]: string | number;
}

export const PeerComparisonOverlay: React.FC<PeerComparisonOverlayProps> = ({
  isOpen,
  onClose,
  sovereigns,
  pipelineOutputs,
  initialSelectedId,
  activeScenario,
  customParams,
  onSelectSovereign,
  onNavigateToTab
}) => {
  // Initialize with the current selected sovereign plus a natural high-beta counterpart
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    const list = [initialSelectedId];
    // Find a second sovereign that is not the same
    const second = sovereigns.find((s) => s.id !== initialSelectedId);
    if (second) list.push(second.id);
    return list;
  });

  const [activeRadarTab, setActiveRadarTab] = useState<'both' | 'pillars' | 'var'>('both');
  const [showTableDetails, setShowTableDetails] = useState<boolean>(true);
  const [copiedAlert, setCopiedAlert] = useState<boolean>(false);

  // Sync initial selection when opened with a new sovereign
  useEffect(() => {
    if (isOpen) {
      setSelectedIds((prev) => {
        if (!prev.includes(initialSelectedId)) {
          return [initialSelectedId, ...prev].slice(0, 5);
        }
        return prev;
      });
    }
  }, [isOpen, initialSelectedId]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Sovereign entity map
  const sovereignMap = useMemo(() => {
    const map = new Map<string, SovereignEntity>();
    sovereigns.forEach((s) => map.set(s.id, s));
    return map;
  }, [sovereigns]);

  // Selected sovereigns list
  const selectedSovereigns = useMemo(() => {
    return selectedIds
      .map((id) => sovereignMap.get(id))
      .filter((s): s is SovereignEntity => s !== undefined);
  }, [selectedIds, sovereignMap]);

  // Compute scorecard breakdowns for all selected sovereigns under current scenario
  const scorecardBreakdowns = useMemo(() => {
    const map: Record<string, ReturnType<typeof computeScorecard>> = {};
    selectedSovereigns.forEach((s) => {
      map[s.id] = computeScorecard(s, activeScenario, true, customParams);
    });
    return map;
  }, [selectedSovereigns, activeScenario, customParams]);

  // Toggle selection
  const toggleSovereign = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 2) {
          // Keep at least 2 for peer comparison or alert
          return prev;
        }
        return prev.filter((item) => item !== id);
      } else {
        if (prev.length >= 6) {
          return [...prev.slice(1), id]; // Max 6 for radar clarity
        }
        return [...prev, id];
      }
    });
  };

  // Quick preset handlers
  const handleSelectPreset = (preset: 'frontier' | 'latam' | 'islands' | 'topRisk' | 'all') => {
    if (preset === 'frontier') {
      const frontierIds = sovereigns
        .filter((s) => ['argentina', 'egypt', 'pakistan', 'ghana', 'nigeria'].includes(s.id))
        .map((s) => s.id)
        .slice(0, 4);
      if (frontierIds.length >= 2) setSelectedIds(frontierIds);
    } else if (preset === 'latam') {
      const latamIds = sovereigns
        .filter((s) => s.region === 'Latin America')
        .map((s) => s.id)
        .slice(0, 4);
      if (latamIds.length >= 2) setSelectedIds(latamIds);
    } else if (preset === 'islands') {
      const islandIds = sovereigns
        .filter((s) => s.isIslandState)
        .map((s) => s.id);
      if (islandIds.length >= 2) setSelectedIds(islandIds);
      else {
        // Fallback to coastal / island mix
        const mix = sovereigns
          .filter((s) => s.isIslandState || s.region === 'South Asia')
          .map((s) => s.id)
          .slice(0, 3);
        setSelectedIds(mix);
      }
    } else if (preset === 'topRisk') {
      const sortedByRisk = [...sovereigns]
        .sort((a, b) => {
          const outA = pipelineOutputs[a.id]?.calibratedPosteriorHazard || 0;
          const outB = pipelineOutputs[b.id]?.calibratedPosteriorHazard || 0;
          return outB - outA;
        })
        .slice(0, 4)
        .map((s) => s.id);
      setSelectedIds(sortedByRisk);
    }
  };

  // 1. Prepare Radar Data for 7 Pillars
  const pillarRadarData: PillarDataPoint[] = useMemo(() => {
    const pillars = [
      { key: 'p1_fiscalDebt', short: 'P1: Fiscal & Debt', full: 'Pillar 1: Fiscal and Debt Sustainability' },
      { key: 'p2_externalFragility', short: 'P2: External & FX', full: 'Pillar 2: External Fragility & Currency' },
      { key: 'p3_institutionalIntegrity', short: 'P3: Institutional', full: 'Pillar 3: Institutional Integrity' },
      { key: 'p4_politicalDynamics', short: 'P4: Political', full: 'Pillar 4: Political Dynamics & Stability' },
      { key: 'p5_macroFragility', short: 'P5: Macro & Banks', full: 'Pillar 5: Macro & Banking Nexus' },
      { key: 'p6_securityConflict', short: 'P6: Security', full: 'Pillar 6: Conflict & Social Stability' },
      { key: 'p7_climateCatastrophe', short: 'P7: Climate & Logistics', full: 'Pillar 7: Climate & Logistics Fragility' }
    ];

    return pillars.map((p, pIndex) => {
      const row: PillarDataPoint = {
        pillarKey: p.key,
        pillarShort: p.short,
        pillarFull: p.full,
        fullMark: 100
      };

      selectedSovereigns.forEach((s) => {
        const sc = scorecardBreakdowns[s.id];
        if (sc && sc.pillarBreakdowns[pIndex]) {
          row[s.id] = Number(sc.pillarBreakdowns[pIndex].score.toFixed(1));
        } else {
          const fallback = (s.pillarScores as any)[p.key] || 0;
          row[s.id] = Number(fallback.toFixed(1));
        }
      });

      return row;
    });
  }, [selectedSovereigns, scorecardBreakdowns]);

  // 2. Prepare Radar Data for VaR and Tail Risk Metrics (normalized 0-100 scale for comparison)
  const tailRiskRadarData: TailRiskDataPoint[] = useMemo(() => {
    const metrics = [
      {
        key: 'var99',
        label: '99% 1Y VaR (%)',
        desc: 'Basel III Value at Risk at 99.0% confidence level',
        extractor: (s: SovereignEntity) => {
          const val = pipelineOutputs[s.id]?.var99 || 0;
          return Math.min(100, Math.max(0, val));
        }
      },
      {
        key: 'es975',
        label: '97.5% ES (%)',
        desc: 'FRTB Expected Shortfall conditional tail expectation',
        extractor: (s: SovereignEntity) => {
          const val = pipelineOutputs[s.id]?.es975 || 0;
          return Math.min(100, Math.max(0, val));
        }
      },
      {
        key: 'lVar99',
        label: '99% L-VaR (%)',
        desc: 'Liquidity-adjusted VaR factoring exogenous bid-ask spread shock',
        extractor: (s: SovereignEntity) => {
          const val = pipelineOutputs[s.id]?.lVar99 || 0;
          return Math.min(100, Math.max(0, val));
        }
      },
      {
        key: 'hazard',
        label: 'Posterior Hazard (x2)',
        desc: 'Calibrated 12-month default hazard scaled for radar symmetry',
        extractor: (s: SovereignEntity) => {
          const val = (pipelineOutputs[s.id]?.calibratedPosteriorHazard || 0) * 100 * 2;
          return Math.min(100, Math.max(0, val));
        }
      },
      {
        key: 'cds',
        label: '5Y CDS Spread Risk',
        desc: 'CDS spread scaled (1000 bps = 50, 2000 bps = 100)',
        extractor: (s: SovereignEntity) => {
          const val = (s.cdsSpread5yBps / 20);
          return Math.min(100, Math.max(0, val));
        }
      },
      {
        key: 'debtGdp',
        label: 'Public Debt / GDP',
        desc: 'Public debt as percentage of sovereign GDP',
        extractor: (s: SovereignEntity) => {
          return Math.min(100, Math.max(0, s.publicDebtToGdp));
        }
      },
      {
        key: 'fxStress',
        label: 'FX Vol & Skew Stress',
        desc: 'Foreign exchange volatility skew and reserve vulnerability',
        extractor: (s: SovereignEntity) => {
          const skewScore = s.fxImpliedVolSkew * 4;
          return Math.min(100, Math.max(0, skewScore));
        }
      }
    ];

    return metrics.map((m) => {
      const row: TailRiskDataPoint = {
        metricKey: m.key,
        metricLabel: m.label,
        description: m.desc,
        fullMark: 100
      };

      selectedSovereigns.forEach((s) => {
        row[s.id] = Number(m.extractor(s).toFixed(1));
      });

      return row;
    });
  }, [selectedSovereigns, pipelineOutputs]);

  // Quantitative differential synthesis
  const differentialAnalysis = useMemo(() => {
    if (selectedSovereigns.length < 2) return null;

    // Find highest VaR and lowest VaR
    let highestVaRSov = selectedSovereigns[0];
    let lowestVaRSov = selectedSovereigns[0];
    let maxVaR = pipelineOutputs[selectedSovereigns[0].id]?.var99 || 0;
    let minVaR = maxVaR;

    selectedSovereigns.forEach((s) => {
      const v = pipelineOutputs[s.id]?.var99 || 0;
      if (v > maxVaR) {
        maxVaR = v;
        highestVaRSov = s;
      }
      if (v < minVaR) {
        minVaR = v;
        lowestVaRSov = s;
      }
    });

    const varDelta = maxVaR - minVaR;

    // Compare scorecard composites
    let highestScoreSov = selectedSovereigns[0];
    let lowestScoreSov = selectedSovereigns[0];
    let maxScore = scorecardBreakdowns[selectedSovereigns[0].id]?.compositeScore || 0;
    let minScore = maxScore;

    selectedSovereigns.forEach((s) => {
      const score = scorecardBreakdowns[s.id]?.compositeScore || 0;
      if (score > maxScore) {
        maxScore = score;
        highestScoreSov = s;
      }
      if (score < minScore) {
        minScore = score;
        lowestScoreSov = s;
      }
    });

    return {
      highestVaRSov,
      lowestVaRSov,
      maxVaR,
      minVaR,
      varDelta,
      highestScoreSov,
      lowestScoreSov,
      maxScore,
      minScore,
      scoreDelta: maxScore - minScore
    };
  }, [selectedSovereigns, pipelineOutputs, scorecardBreakdowns]);

  // Copy snapshot summary to clipboard
  const handleCopySummary = () => {
    if (selectedSovereigns.length < 2) return;
    const lines = [
      `PANOPTIX SOVEREIGN PEER COMPARISON REPORT [Scenario: ${activeScenario}]`,
      `========================================================================`,
      `Sovereigns Compared (${selectedSovereigns.length}): ${selectedSovereigns.map((s) => `${s.name} (${s.code})`).join(', ')}`,
      '',
      'METRICS SUMMARY TABLE:',
      'Sovereign | 99% VaR | 97.5% ES | L-VaR 99% | Hazard 12m | CDS 5Y | Scorecard',
      '------------------------------------------------------------------------'
    ];

    selectedSovereigns.forEach((s) => {
      const out = pipelineOutputs[s.id];
      const sc = scorecardBreakdowns[s.id];
      lines.push(
        `${s.code.padEnd(9)} | ${(out?.var99.toFixed(1) + '%').padStart(7)} | ${(out?.es975.toFixed(1) + '%').padStart(8)} | ${(out?.lVar99.toFixed(1) + '%').padStart(9)} | ${((out ? out.calibratedPosteriorHazard * 100 : 0).toFixed(1) + '%').padStart(10)} | ${(s.cdsSpread5yBps + ' bps').padStart(6)} | ${(sc?.compositeScore.toFixed(1) + ' / 100').padStart(9)}`
      );
    });

    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedAlert(true);
    setTimeout(() => setCopiedAlert(false), 2500);
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="peer-comparison-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md overflow-y-auto animate-fadeIn"
    >
      <div className="relative w-full max-w-7xl bg-[#090d16] border border-[#1e2a42] rounded-xl shadow-2xl flex flex-col max-h-[94vh] overflow-hidden my-auto">
        {/* Header Bar */}
        <div className="px-6 py-4 bg-[#0c1220] border-b border-[#1a253b] flex flex-wrap items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-cyan-950/80 border border-cyan-700/60 flex items-center justify-center text-cyan-300 text-lg shadow-inner">
              ⚖️
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="peer-comparison-title" className="text-lg font-bold text-slate-100 font-sans tracking-tight">
                  Cross-Sovereign Peer Comparison
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-mono font-semibold uppercase rounded bg-cyan-950/80 border border-cyan-800 text-cyan-300">
                  Dual Radar Engine
                </span>
                {activeScenario !== 'baseline' && (
                  <span className="px-2 py-0.5 text-[10px] font-mono font-semibold uppercase rounded bg-amber-950/80 border border-amber-800 text-amber-300">
                    Shock: {activeScenario}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Simultaneous side-by-side benchmarking of 7-Pillar structural resilience against multi-horizon VaR and FRTB tail risk.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleCopySummary}
              className="px-3 py-1.5 text-xs font-mono font-medium rounded bg-[#131d33] hover:bg-[#1a2744] border border-[#23314d] text-slate-300 hover:text-slate-100 transition-colors flex items-center gap-1.5"
              title="Copy markdown tabular summary"
            >
              <span>{copiedAlert ? '✓ Copied!' : '📋 Copy Report'}</span>
            </button>

            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 transition-colors flex items-center gap-1"
              aria-label="Close peer comparison overlay"
            >
              <span>✕ Close (Esc)</span>
            </button>
          </div>
        </div>

        {/* Peer Selection Toolbar */}
        <div className="px-6 py-3 bg-[#0a101c] border-b border-[#162136] flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          {/* Quick Presets */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400 font-mono text-[11px] font-medium mr-1 uppercase">
              Quick Presets:
            </span>
            <button
              onClick={() => handleSelectPreset('frontier')}
              className="px-2.5 py-1 rounded text-[11px] font-mono font-medium bg-[#131d31] hover:bg-[#1c2a44] text-cyan-300 border border-cyan-800/40 transition-colors"
            >
              High-Beta Frontier
            </button>
            <button
              onClick={() => handleSelectPreset('latam')}
              className="px-2.5 py-1 rounded text-[11px] font-mono font-medium bg-[#131d31] hover:bg-[#1c2a44] text-emerald-300 border border-emerald-800/40 transition-colors"
            >
              Latin America
            </button>
            <button
              onClick={() => handleSelectPreset('islands')}
              className="px-2.5 py-1 rounded text-[11px] font-mono font-medium bg-[#131d31] hover:bg-[#1c2a44] text-amber-300 border border-amber-800/40 transition-colors"
            >
              Island States (P7 15%)
            </button>
            <button
              onClick={() => handleSelectPreset('topRisk')}
              className="px-2.5 py-1 rounded text-[11px] font-mono font-medium bg-[#131d31] hover:bg-[#1c2a44] text-rose-300 border border-rose-800/40 transition-colors"
            >
              Highest Tail Risk
            </button>
          </div>

          {/* View Toggles */}
          <div className="flex items-center gap-1.5 bg-[#0e1627] p-1 rounded-lg border border-[#1e2a42]">
            <button
              onClick={() => setActiveRadarTab('both')}
              className={`px-2.5 py-1 rounded text-[11px] font-mono transition-colors ${
                activeRadarTab === 'both'
                  ? 'bg-cyan-600 text-white font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Dual Radars
            </button>
            <button
              onClick={() => setActiveRadarTab('pillars')}
              className={`px-2.5 py-1 rounded text-[11px] font-mono transition-colors ${
                activeRadarTab === 'pillars'
                  ? 'bg-cyan-600 text-white font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              7 Pillars
            </button>
            <button
              onClick={() => setActiveRadarTab('var')}
              className={`px-2.5 py-1 rounded text-[11px] font-mono transition-colors ${
                activeRadarTab === 'var'
                  ? 'bg-cyan-600 text-white font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              VaR & Solvency
            </button>
          </div>
        </div>

        {/* Multi-Select Sovereign Chips Bar */}
        <div className="px-6 py-2.5 bg-[#090d16] border-b border-[#141e30] flex flex-wrap items-center gap-2 shrink-0">
          <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 mr-1">
            Active Peers ({selectedIds.length}/6):
          </span>
          {sovereigns.map((s) => {
            const isSelected = selectedIds.includes(s.id);
            const colorIndex = selectedIds.indexOf(s.id);
            const color = colorIndex >= 0 ? PEER_COLORS[colorIndex % PEER_COLORS.length] : undefined;

            return (
              <button
                key={s.id}
                onClick={() => toggleSovereign(s.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono transition-all border ${
                  isSelected
                    ? 'font-bold text-slate-100 shadow-sm'
                    : 'bg-[#0f1728] text-slate-400 border-[#1c2942] hover:border-slate-500 hover:text-slate-200'
                }`}
                style={
                  isSelected && color
                    ? {
                        backgroundColor: `${color}18`,
                        borderColor: color,
                        boxShadow: `0 0 10px ${color}33`
                      }
                    : {}
                }
              >
                <span>{s.flag}</span>
                <span>{s.code}</span>
                {isSelected && (
                  <span
                    className="w-2 h-2 rounded-full inline-block ml-0.5"
                    style={{ backgroundColor: color }}
                  />
                )}
              </button>
            );
          })}
          {selectedIds.length < 2 && (
            <span className="text-[11px] font-mono text-amber-400 animate-pulse ml-2">
              ⚠️ Select at least 2 sovereigns to generate comparative radar geometry.
            </span>
          )}
        </div>

        {/* Scrollable Main Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Radar Visualizations Grid */}
          <div
            className={`grid gap-6 ${
              activeRadarTab === 'both' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1 max-w-4xl mx-auto'
            }`}
          >
            {/* Radar 1: 7 Pillars Macro Resilience */}
            {(activeRadarTab === 'both' || activeRadarTab === 'pillars') && (
              <div className="p-4 bg-[#0e1627] border border-[#1b273f] rounded-xl flex flex-col">
                <div className="flex items-center justify-between pb-3 border-b border-[#1b273f] mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-100 font-sans flex items-center gap-2">
                      <span>🏛️ 7-Pillar Structural Vulnerability Radar</span>
                      <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                        0 - 100 Scale
                      </span>
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Higher score = elevated structural fragility & sovereign distress
                    </p>
                  </div>
                </div>

                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={pillarRadarData} margin={{ top: 10, right: 25, bottom: 10, left: 25 }}>
                      <PolarGrid stroke="#22324f" />
                      <PolarAngleAxis
                        dataKey="pillarShort"
                        tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                      />
                      <PolarRadiusAxis
                        angle={90}
                        domain={[0, 100]}
                        stroke="#334155"
                        tick={{ fill: '#64748b', fontSize: 9 }}
                      />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          return (
                            <div className="p-3 bg-[#090d16] border border-[#1e2a42] rounded shadow-xl text-xs font-mono space-y-1.5 z-50 min-w-48">
                              <div className="font-bold text-slate-100 border-b border-[#1e2a42] pb-1">
                                {label}
                              </div>
                              {payload.map((entry, idx) => {
                                const keyStr = String(entry.dataKey ?? idx);
                                const s = sovereignMap.get(keyStr);
                                return (
                                  <div key={keyStr} className="flex items-center justify-between gap-4">
                                    <span className="flex items-center gap-1.5">
                                      <span
                                        className="w-2.5 h-2.5 rounded-full inline-block"
                                        style={{ backgroundColor: entry.color }}
                                      />
                                      <span className="text-slate-300">
                                        {s ? `${s.flag} ${s.code}` : keyStr}:
                                      </span>
                                    </span>
                                    <span className="font-bold text-slate-100">
                                      {Number(entry.value).toFixed(1)} / 100
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        }}
                      />
                      <Legend
                        formatter={(value) => {
                          const s = sovereignMap.get(value);
                          return (
                            <span className="text-xs font-mono text-slate-200">
                              {s ? `${s.flag} ${s.name} (${s.code})` : value}
                            </span>
                          );
                        }}
                      />
                      {selectedSovereigns.map((s, index) => {
                        const color = PEER_COLORS[index % PEER_COLORS.length];
                        return (
                          <Radar
                            key={s.id}
                            name={s.id}
                            dataKey={s.id}
                            stroke={color}
                            fill={color}
                            fillOpacity={0.22}
                            strokeWidth={2}
                          />
                        );
                      })}
                    </RadarChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-2 pt-2 border-t border-[#182338] text-[10px] font-mono text-slate-500 flex items-center justify-between">
                  <span>Pillar weights: Fiscal (25%), External (15%), Inst (15%), Pol (15%), Macro (10%), Conf (10%), Clim (10/15%)</span>
                  <span>Scenario: {activeScenario}</span>
                </div>
              </div>
            )}

            {/* Radar 2: Tail Risk & Regulatory VaR Profile */}
            {(activeRadarTab === 'both' || activeRadarTab === 'var') && (
              <div className="p-4 bg-[#0e1627] border border-[#1b273f] rounded-xl flex flex-col">
                <div className="flex items-center justify-between pb-3 border-b border-[#1b273f] mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-100 font-sans flex items-center gap-2">
                      <span>📉 Multi-Horizon VaR & Solvency Risk Radar</span>
                      <span className="text-[10px] font-mono text-rose-300 bg-rose-950/80 px-1.5 py-0.5 rounded border border-rose-800">
                        FRTB / Basel III
                      </span>
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Tail risk loss quantiles, hazard rate, liquidity haircut & credit spread exposure
                    </p>
                  </div>
                </div>

                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={tailRiskRadarData} margin={{ top: 10, right: 25, bottom: 10, left: 25 }}>
                      <PolarGrid stroke="#22324f" />
                      <PolarAngleAxis
                        dataKey="metricLabel"
                        tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                      />
                      <PolarRadiusAxis
                        angle={90}
                        domain={[0, 100]}
                        stroke="#334155"
                        tick={{ fill: '#64748b', fontSize: 9 }}
                      />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const currentMetric = tailRiskRadarData.find((m) => m.metricLabel === label);
                          return (
                            <div className="p-3 bg-[#090d16] border border-[#1e2a42] rounded shadow-xl text-xs font-mono space-y-1.5 z-50 min-w-52">
                              <div className="font-bold text-slate-100 border-b border-[#1e2a42] pb-1">
                                {label}
                              </div>
                              {currentMetric?.description && (
                                <div className="text-[10px] text-slate-400 font-sans italic">
                                  {currentMetric.description}
                                </div>
                              )}
                              {payload.map((entry, idx) => {
                                const keyStr = String(entry.dataKey ?? idx);
                                const s = sovereignMap.get(keyStr);
                                return (
                                  <div key={keyStr} className="flex items-center justify-between gap-4">
                                    <span className="flex items-center gap-1.5">
                                      <span
                                        className="w-2.5 h-2.5 rounded-full inline-block"
                                        style={{ backgroundColor: entry.color }}
                                      />
                                      <span className="text-slate-300">
                                        {s ? `${s.flag} ${s.code}` : keyStr}:
                                      </span>
                                    </span>
                                    <span className="font-bold text-slate-100">
                                      {Number(entry.value).toFixed(1)} / 100
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        }}
                      />
                      <Legend
                        formatter={(value) => {
                          const s = sovereignMap.get(value);
                          return (
                            <span className="text-xs font-mono text-slate-200">
                              {s ? `${s.flag} ${s.name} (${s.code})` : value}
                            </span>
                          );
                        }}
                      />
                      {selectedSovereigns.map((s, index) => {
                        const color = PEER_COLORS[index % PEER_COLORS.length];
                        return (
                          <Radar
                            key={s.id}
                            name={s.id}
                            dataKey={s.id}
                            stroke={color}
                            fill={color}
                            fillOpacity={0.22}
                            strokeWidth={2}
                          />
                        );
                      })}
                    </RadarChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-2 pt-2 border-t border-[#182338] text-[10px] font-mono text-slate-500 flex items-center justify-between">
                  <span>Normalized metric scales for geometric comparative portfolio risk decomposition</span>
                  <span>Confidence: 99.0% VaR / 97.5% ES</span>
                </div>
              </div>
            )}
          </div>

          {/* Quantitative Differential Synthesis Box */}
          {differentialAnalysis && (
            <div className="p-4 bg-[#0a1120] border border-cyan-900/50 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-2">
                  <span>⚡ Quantitative Risk Divergence Synthesis</span>
                </span>
                <span className="text-[11px] font-mono text-slate-400">
                  {selectedSovereigns.length} Peers Benchmarked
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="p-3 bg-[#0d1627] border border-[#1a253d] rounded-lg">
                  <div className="text-[11px] text-slate-400 font-medium">99% VaR Differential</div>
                  <div className="text-lg font-bold font-mono text-rose-400 mt-1 flex items-baseline gap-1.5">
                    <span>+{differentialAnalysis.varDelta.toFixed(1)}%</span>
                    <span className="text-xs text-slate-400 font-normal">Spread</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Highest: <span className="text-slate-200 font-semibold">{differentialAnalysis.highestVaRSov.flag} {differentialAnalysis.highestVaRSov.code}</span> ({differentialAnalysis.maxVaR.toFixed(1)}%) vs Lowest: <span className="text-slate-200 font-semibold">{differentialAnalysis.lowestVaRSov.flag} {differentialAnalysis.lowestVaRSov.code}</span> ({differentialAnalysis.minVaR.toFixed(1)}%)
                  </div>
                </div>

                <div className="p-3 bg-[#0d1627] border border-[#1a253d] rounded-lg">
                  <div className="text-[11px] text-slate-400 font-medium">Composite Scorecard Spread</div>
                  <div className="text-lg font-bold font-mono text-amber-400 mt-1 flex items-baseline gap-1.5">
                    <span>{differentialAnalysis.scoreDelta.toFixed(1)} pts</span>
                    <span className="text-xs text-slate-400 font-normal">Delta</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Most Vulnerable: <span className="text-slate-200 font-semibold">{differentialAnalysis.highestScoreSov.flag} {differentialAnalysis.highestScoreSov.code}</span> ({differentialAnalysis.maxScore.toFixed(1)}) vs Best: <span className="text-slate-200 font-semibold">{differentialAnalysis.lowestScoreSov.flag} {differentialAnalysis.lowestScoreSov.code}</span> ({differentialAnalysis.minScore.toFixed(1)})
                  </div>
                </div>

                <div className="p-3 bg-[#0d1627] border border-[#1a253d] rounded-lg">
                  <div className="text-[11px] text-slate-400 font-medium">FRTB Capital Requirement Impact</div>
                  <div className="text-lg font-bold font-mono text-cyan-400 mt-1 flex items-baseline gap-1.5">
                    <span>Basel III L-VaR</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Liquidity horizon scaling penalizes peers with FX debt mismatches, elevating capital surcharges up to 2.4x.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Detailed Side-by-Side Comparison Matrix Table */}
          <div className="p-4 bg-[#0e1627] border border-[#1b273f] rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-100 font-sans flex items-center gap-2">
                <span>📋 Comprehensive Side-by-Side Peer Matrix</span>
                <span className="text-xs font-mono text-slate-400 font-normal">
                  (Click any peer to decompose in 6-Layer Pipeline)
                </span>
              </h3>
              <button
                onClick={() => setShowTableDetails(!showTableDetails)}
                className="text-xs text-cyan-400 hover:text-cyan-300 font-mono underline"
              >
                {showTableDetails ? 'Collapse View' : 'Expand All Columns'}
              </button>
            </div>

            {showTableDetails && (
              <div className="overflow-x-auto border border-[#19243a] rounded-lg">
                <table className="w-full text-left text-xs font-mono border-collapse">
                  <thead>
                    <tr className="border-b border-[#19243a] bg-[#090e18] text-slate-400 text-[11px] uppercase tracking-wider">
                      <th className="py-2.5 px-3">Sovereign</th>
                      <th className="py-2.5 px-2 text-center">Color</th>
                      <th className="py-2.5 px-2 text-right">99% VaR</th>
                      <th className="py-2.5 px-2 text-right">97.5% ES</th>
                      <th className="py-2.5 px-2 text-right">L-VaR 99%</th>
                      <th className="py-2.5 px-2 text-right">12m Hazard</th>
                      <th className="py-2.5 px-2 text-right">5Y CDS</th>
                      <th className="py-2.5 px-2 text-right">Scorecard</th>
                      <th className="py-2.5 px-2 text-right">P1 (Fiscal)</th>
                      <th className="py-2.5 px-2 text-right">P2 (Ext)</th>
                      <th className="py-2.5 px-2 text-right">P5 (Macro)</th>
                      <th className="py-2.5 px-2 text-center">Regime</th>
                      <th className="py-2.5 px-3 text-center">Drilldown</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#19243a]/70">
                    {selectedSovereigns.map((s, index) => {
                      const out = pipelineOutputs[s.id];
                      const sc = scorecardBreakdowns[s.id];
                      const color = PEER_COLORS[index % PEER_COLORS.length];
                      const posterior = out ? out.calibratedPosteriorHazard * 100 : 0;

                      return (
                        <tr key={s.id} className="hover:bg-[#121c2e] transition-colors">
                          <td className="py-2.5 px-3 font-sans">
                            <div className="flex items-center gap-2">
                              <span className="text-base">{s.flag}</span>
                              <div>
                                <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                                  <span>{s.name}</span>
                                  <span className="font-mono text-[10px] text-slate-400">({s.code})</span>
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono">
                                  {s.region} · {s.fxRegime}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="py-2.5 px-2 text-center">
                            <span
                              className="w-3.5 h-3.5 rounded-full inline-block border border-white/20 shadow-sm"
                              style={{ backgroundColor: color }}
                              title={`Radar visual marker for ${s.name}`}
                            />
                          </td>

                          <td className="py-2.5 px-2 text-right font-bold text-slate-100">
                            {out ? out.var99.toFixed(1) : '-'}%
                          </td>

                          <td className="py-2.5 px-2 text-right text-rose-400 font-semibold">
                            {out ? out.es975.toFixed(1) : '-'}%
                          </td>

                          <td className="py-2.5 px-2 text-right text-cyan-300">
                            {out ? out.lVar99.toFixed(1) : '-'}%
                          </td>

                          <td className="py-2.5 px-2 text-right">
                            <span
                              className={`font-semibold ${
                                posterior > 20
                                  ? 'text-rose-400'
                                  : posterior > 8
                                  ? 'text-amber-400'
                                  : 'text-emerald-400'
                              }`}
                            >
                              {posterior.toFixed(1)}%
                            </span>
                          </td>

                          <td className="py-2.5 px-2 text-right text-slate-200">
                            {s.cdsSpread5yBps} bps
                          </td>

                          <td className="py-2.5 px-2 text-right font-bold text-slate-100">
                            {sc ? sc.compositeScore.toFixed(1) : '-'}
                          </td>

                          <td className="py-2.5 px-2 text-right text-slate-300">
                            {sc?.pillarBreakdowns[0]?.score.toFixed(1) || '-'}
                          </td>

                          <td className="py-2.5 px-2 text-right text-slate-300">
                            {sc?.pillarBreakdowns[1]?.score.toFixed(1) || '-'}
                          </td>

                          <td className="py-2.5 px-2 text-right text-slate-300">
                            {sc?.pillarBreakdowns[4]?.score.toFixed(1) || '-'}
                          </td>

                          <td className="py-2.5 px-2 text-center">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
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

                          <td className="py-2.5 px-3 text-center">
                            <button
                              onClick={() => {
                                onSelectSovereign(s.id);
                                onClose();
                                onNavigateToTab('pipeline');
                              }}
                              className="px-2 py-0.5 text-[10px] text-emerald-400 hover:text-emerald-300 bg-emerald-950/60 hover:bg-emerald-900 border border-emerald-800/60 rounded font-sans transition-colors"
                            >
                              Decompose →
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer info bar */}
        <div className="px-6 py-3 bg-[#0c1220] border-t border-[#1a253b] flex items-center justify-between text-xs text-slate-400 shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-mono text-cyan-400 text-[11px]">
              PANOPTIX RISK ENGINE V3.4
            </span>
            <span>·</span>
            <span>All indicators calibrated to Basel III / FRTB quantitative liquidity horizon standards</span>
          </div>
          <button
            onClick={onClose}
            className="text-xs text-slate-300 hover:text-white font-mono"
          >
            Press Esc or click Close to return
          </button>
        </div>
      </div>
    </div>
  );
};
