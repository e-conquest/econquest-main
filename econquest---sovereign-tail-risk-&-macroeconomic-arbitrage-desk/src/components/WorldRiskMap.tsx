import React, { useState, useMemo, useRef, useEffect } from 'react';
import * as d3 from 'd3';
import {
  SovereignEntity,
  LayerOutputs,
  MacroScenario,
  CustomScenarioParams
} from '../types/riskEngine';
import {
  WORLD_COUNTRIES_GEO,
  MARITIME_CHOKEPOINTS,
  MapRiskMetric,
  MAP_RISK_SCALES,
  getMapColor,
  GeoCountryFeature,
  MaritimeChokepoint
} from '../data/worldGeoData';
import {
  MONTH_DEFINITIONS,
  generate12MonthMapProgression,
  SovereignMonthlySnapshot
} from '../data/historicalMapData';
import { computeScorecard } from '../math/riskCalculations';

interface WorldRiskMapProps {
  sovereigns: SovereignEntity[];
  pipelineOutputs: Record<string, LayerOutputs>;
  selectedSovereignId: string;
  onSelectSovereign: (id: string) => void;
  onNavigateToTab: (tab: string) => void;
  activeScenario: MacroScenario;
  customParams?: CustomScenarioParams;
}

interface HoverState {
  feature: GeoCountryFeature;
  sovereign?: SovereignEntity;
  output?: LayerOutputs;
  snapshot?: SovereignMonthlySnapshot;
  colorInfo?: {
    color: string;
    borderColor: string;
    textColor: string;
    bgBadge: string;
    label: string;
    tierIndex: number;
  } | null;
  x: number;
  y: number;
}

interface ChokepointHoverState {
  chokepoint: MaritimeChokepoint;
  x: number;
  y: number;
}

export const WorldRiskMap: React.FC<WorldRiskMapProps> = ({
  sovereigns,
  pipelineOutputs,
  selectedSovereignId,
  onSelectSovereign,
  onNavigateToTab,
  activeScenario,
  customParams
}) => {
  const [activeMetric, setActiveMetric] = useState<MapRiskMetric>('totalModel');
  const [showChokepoints, setShowChokepoints] = useState<boolean>(true);
  const [hoveredCountry, setHoveredCountry] = useState<HoverState | null>(null);
  const [hoveredChokepoint, setHoveredChokepoint] = useState<ChokepointHoverState | null>(null);
  const [inspectingSovereignId, setInspectingSovereignId] = useState<string>(selectedSovereignId);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // 12-Month Historical Time-Series Replay State
  // Default to Month 11 (Live / Oct 2026)
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number>(11);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0); // 0.5x, 1x, 2x
  const [isLooping, setIsLooping] = useState<boolean>(true);

  // Zoom and pan state
  const [transform, setTransform] = useState<{ k: number; x: number; y: number }>({ k: 1, x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const mapWidth = 980;
  const mapHeight = 520;

  // D3 Geo Projection
  const { projection, pathGenerator } = useMemo(() => {
    const proj = d3.geoNaturalEarth1()
      .scale(168)
      .translate([mapWidth / 2, mapHeight / 2 + 15]);
    const path = d3.geoPath().projection(proj);
    return { projection: proj, pathGenerator: path };
  }, [mapWidth, mapHeight]);

  // Sovereign entity map by ID and by ISO code
  const { sovereignById, sovereignByCode } = useMemo(() => {
    const byId = new Map<string, SovereignEntity>();
    const byCode = new Map<string, SovereignEntity>();
    sovereigns.forEach((s) => {
      byId.set(s.id, s);
      byCode.set(s.code.toUpperCase(), s);
    });
    return { sovereignById: byId, sovereignByCode: byCode };
  }, [sovereigns]);

  // Build the 12-Month historical progression dataset across all sovereigns
  const historicalMonthlySnapshots = useMemo(() => {
    return generate12MonthMapProgression(sovereigns, pipelineOutputs);
  }, [sovereigns, pipelineOutputs]);

  // Current active month snapshot
  const currentMonthSnapshot = useMemo(() => {
    return historicalMonthlySnapshots[selectedMonthIndex] || historicalMonthlySnapshots[11];
  }, [historicalMonthlySnapshots, selectedMonthIndex]);

  // Auto-replay interval timer
  useEffect(() => {
    if (!isPlaying) return;

    const intervalMs = Math.round(1300 / playbackSpeed);
    const timer = setInterval(() => {
      setSelectedMonthIndex((prev) => {
        if (prev >= 11) {
          if (isLooping) {
            return 0;
          } else {
            setIsPlaying(false);
            return 11;
          }
        }
        return prev + 1;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isPlaying, playbackSpeed, isLooping]);

  // Selected sovereign object
  const inspectingSovereign = useMemo(() => {
    return sovereignById.get(inspectingSovereignId) || sovereigns[0];
  }, [inspectingSovereignId, sovereignById, sovereigns]);

  const inspectingOutput = inspectingSovereign ? pipelineOutputs[inspectingSovereign.id] : undefined;
  const inspectingSnapshot = inspectingSovereign
    ? currentMonthSnapshot.sovereigns[inspectingSovereign.id]
    : undefined;

  // Compute scorecard breakdown for inspected sovereign
  const inspectingScorecard = useMemo(() => {
    if (!inspectingSovereign) return null;
    return computeScorecard(inspectingSovereign, activeScenario, true, customParams);
  }, [inspectingSovereign, activeScenario, customParams]);

  // Helper to extract sovereign metric value for a specific month
  const getSovereignMetricValue = (sov: SovereignEntity, out?: LayerOutputs, monthIdx: number = selectedMonthIndex): number => {
    const snapshot = historicalMonthlySnapshots[monthIdx]?.sovereigns[sov.id];

    if (!snapshot) {
      if (activeMetric === 'totalModel') return (out ? out.calibratedPosteriorHazard : 0.05) * 100;
      if (activeMetric === 'geopolitical') {
        return (sov.pillarScores.p4_politicalDynamics + sov.pillarScores.p6_securityConflict) / 2;
      }
      if (activeMetric === 'var99') return out ? out.var99 : 5.0;
      if (activeMetric === 'hmmRegime') {
        if (out?.regime === 'Crisis') return 2.5;
        if (out?.regime === 'Stressed') return 1.5;
        return 0.5;
      }
      return 0;
    }

    if (activeMetric === 'totalModel') {
      return snapshot.totalModelRisk;
    } else if (activeMetric === 'geopolitical') {
      return snapshot.geopoliticalFragility;
    } else if (activeMetric === 'var99') {
      return snapshot.var99;
    } else if (activeMetric === 'hmmRegime') {
      if (snapshot.hmmRegime === 'Crisis') return 2.5;
      if (snapshot.hmmRegime === 'Stressed') return 1.5;
      return 0.5;
    }
    return 0;
  };

  // Zoom handlers
  const handleZoomIn = () => {
    setTransform((prev) => ({
      ...prev,
      k: Math.min(prev.k * 1.35, 6.0)
    }));
  };

  const handleZoomOut = () => {
    setTransform((prev) => ({
      ...prev,
      k: Math.max(prev.k / 1.35, 0.75)
    }));
  };

  const handleResetZoom = () => {
    setTransform({ k: 1, x: 0, y: 0 });
  };

  const handleFocusRegion = (region: 'latam' | 'africa' | 'mena' | 'asia' | 'global') => {
    if (region === 'latam') {
      setTransform({ k: 2.2, x: 580, y: 180 });
    } else if (region === 'africa') {
      setTransform({ k: 2.1, x: 0, y: 40 });
    } else if (region === 'mena') {
      setTransform({ k: 2.4, x: -80, y: -60 });
    } else if (region === 'asia') {
      setTransform({ k: 2.0, x: -440, y: -20 });
    } else {
      handleResetZoom();
    }
  };

  // Drag pan handlers
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return; // Only primary click
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDraggingRef.current) return;
    setTransform((prev) => ({
      ...prev,
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y
    }));
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.88;
    setTransform((prev) => ({
      ...prev,
      k: Math.max(0.75, Math.min(prev.k * factor, 6.0))
    }));
  };

  // Pre-calculate paths for all features synced to active month
  const renderedFeatures = useMemo(() => {
    return WORLD_COUNTRIES_GEO.map((country) => {
      const sov = sovereignByCode.get(country.id);
      const out = sov ? pipelineOutputs[sov.id] : undefined;
      const sovSnapshot = sov ? currentMonthSnapshot.sovereigns[sov.id] : undefined;
      const metricVal = sov ? getSovereignMetricValue(sov, out, selectedMonthIndex) : undefined;
      const colorInfo = metricVal !== undefined ? getMapColor(metricVal, activeMetric) : null;

      // Construct GeoJSON feature for d3.geoPath with spherical winding order protection
      const isMulti = country.coordinates.length > 1;
      const normalizeRing = (ring: number[][]): number[][] => {
        const area = d3.geoArea({ type: 'Polygon', coordinates: [ring] });
        return area > 2 * Math.PI ? [...ring].reverse() : ring;
      };

      const geoJsonFeature: any = {
        type: 'Feature',
        geometry: isMulti
          ? {
              type: 'MultiPolygon',
              coordinates: country.coordinates.map((r) => [normalizeRing(r)])
            }
          : {
              type: 'Polygon',
              coordinates: country.coordinates.map((r) => normalizeRing(r))
            },
        properties: { id: country.id, name: country.name }
      };

      const pathString = pathGenerator(geoJsonFeature) || '';

      return {
        country,
        sov,
        out,
        sovSnapshot,
        metricVal,
        colorInfo,
        pathString
      };
    });
  }, [sovereignByCode, pipelineOutputs, currentMonthSnapshot, selectedMonthIndex, activeMetric, pathGenerator]);

  // Filtered sovereigns for search jump
  const filteredSearchSovereigns = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return sovereigns.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q) || s.region.toLowerCase().includes(q)
    );
  }, [searchQuery, sovereigns]);

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Active Stress Vector Notification Banner */}
      {activeScenario !== 'baseline' && (
        <div className="px-4 py-2.5 bg-[#171407] border border-amber-600/40 rounded-lg flex items-center justify-between text-xs text-amber-300">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold uppercase text-amber-400">
              Active Macro Shock:
            </span>
            <span>
              {activeScenario === 'scenarioA_fedTightening' && 'Hawkish Fed +200 bps Shock — FX debt multipliers active, EM yield curves steepened.'}
              {activeScenario === 'scenarioB_commodityCollapse' && 'Global Commodity Price Shock (-30%) — Mono-exporter terms of trade collapse.'}
              {activeScenario === 'scenarioC_malaccaBlockade' && 'Strait of Malacca Naval Closure — Maritime corridor disruption and TSI spikes active.'}
              {activeScenario === 'custom' && `Custom User Scenario: ${customParams?.name || 'Interactive Stress Vectors'}`}
            </span>
          </div>
          <span className="font-mono text-[11px] text-amber-400 font-medium">
            World Map Reflects Real-Time Shocks
          </span>
        </div>
      )}

      {/* 12-Month Historical Time-Series Replay Control Deck */}
      <div className="p-4 bg-[#0d1424] border border-[#1b273e] rounded-xl space-y-3.5 shadow-xl">
        {/* Top Control Bar: Replay Transport Buttons & Global Aggregate Readouts */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Left: Replay Status & Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#131d31] border border-[#223352]">
              <span className="text-[11px] font-mono uppercase font-bold text-cyan-400 flex items-center gap-1.5">
                <span>⏱️</span>
                <span>Time Horizon:</span>
              </span>
              <span className="font-mono font-bold text-slate-100 text-xs tracking-tight">
                {currentMonthSnapshot.monthLabel}
              </span>
              {selectedMonthIndex === 11 ? (
                <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 text-[10px] font-mono font-bold border border-emerald-800 animate-pulse">
                  ● LIVE
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 text-[10px] font-mono font-bold border border-amber-800">
                  T-{11 - selectedMonthIndex}M
                </span>
              )}
            </div>

            {/* Transport Buttons */}
            <div className="flex items-center gap-1 bg-[#101726] p-1 rounded-lg border border-[#1d2a42]">
              {/* Step Back */}
              <button
                onClick={() => setSelectedMonthIndex((prev) => Math.max(0, prev - 1))}
                disabled={selectedMonthIndex === 0}
                className="px-2 py-1 rounded text-xs hover:bg-[#1a253a] text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors font-mono"
                title="Previous Month (-1M)"
              >
                ⏮️
              </button>

              {/* Play / Pause */}
              <button
                onClick={() => setIsPlaying((prev) => !prev)}
                className={`px-3.5 py-1 rounded text-xs font-mono font-bold transition-all flex items-center gap-1.5 ${
                  isPlaying
                    ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-900/40 animate-pulse'
                    : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-md shadow-cyan-900/30'
                }`}
                title={isPlaying ? 'Pause Historical Replay' : 'Play 12-Month Replay'}
              >
                <span>{isPlaying ? '⏸️' : '▶️'}</span>
                <span>{isPlaying ? 'Pause' : 'Replay 12M'}</span>
              </button>

              {/* Step Forward */}
              <button
                onClick={() => setSelectedMonthIndex((prev) => Math.min(11, prev + 1))}
                disabled={selectedMonthIndex === 11}
                className="px-2 py-1 rounded text-xs hover:bg-[#1a253a] text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors font-mono"
                title="Next Month (+1M)"
              >
                ⏭️
              </button>

              {/* Speed Selector */}
              <div className="flex items-center gap-0.5 ml-1 border-l border-[#1d2a42] pl-1.5">
                {([0.5, 1, 2] as const).map((spd) => (
                  <button
                    key={spd}
                    onClick={() => setPlaybackSpeed(spd)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                      playbackSpeed === spd
                        ? 'bg-cyan-950 text-cyan-300 font-bold border border-cyan-800'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>

              {/* Loop toggle */}
              <button
                onClick={() => setIsLooping((prev) => !prev)}
                className={`px-2 py-0.5 ml-1 rounded text-[10px] font-mono transition-colors ${
                  isLooping ? 'text-cyan-400 font-bold bg-cyan-950/60 border border-cyan-800/60' : 'text-slate-500 hover:text-slate-300'
                }`}
                title={isLooping ? 'Auto-looping enabled' : 'Auto-looping disabled'}
              >
                🔁 Loop
              </button>
            </div>

            {/* Snap to Live Button */}
            {selectedMonthIndex !== 11 && (
              <button
                onClick={() => {
                  setSelectedMonthIndex(11);
                  setIsPlaying(false);
                }}
                className="px-3 py-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 text-xs font-mono font-semibold border border-emerald-800/80 transition-all flex items-center gap-1.5 shadow-sm"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span>Snap to Live (Oct 26)</span>
              </button>
            )}
          </div>

          {/* Right: Global Aggregate Total Model Score Readout */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#101726] border border-[#1d2a42] font-mono">
              <span className="text-[10px] text-slate-400 uppercase">Global Avg Total Model:</span>
              <span className="font-bold text-slate-100 text-sm">
                {currentMonthSnapshot.globalAvgTotalModelRisk.toFixed(1)}%
              </span>
              {selectedMonthIndex !== 11 && (
                <span
                  className={`text-[10px] font-bold ${
                    currentMonthSnapshot.globalAvgTotalModelRisk > historicalMonthlySnapshots[11].globalAvgTotalModelRisk
                      ? 'text-rose-400'
                      : 'text-emerald-400'
                  }`}
                >
                  ({currentMonthSnapshot.globalAvgTotalModelRisk >= historicalMonthlySnapshots[11].globalAvgTotalModelRisk ? '+' : ''}
                  {(currentMonthSnapshot.globalAvgTotalModelRisk - historicalMonthlySnapshots[11].globalAvgTotalModelRisk).toFixed(1)}% vs Live)
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 text-[11px] font-mono">
              <span className="text-rose-400 font-bold">🚨 {currentMonthSnapshot.crisisCount} Crisis</span>
              <span className="text-amber-400 font-bold">⚠️ {currentMonthSnapshot.stressedCount} Stressed</span>
              <span className="text-emerald-400 font-bold">🟢 {currentMonthSnapshot.calmCount} Calm</span>
            </div>
          </div>
        </div>

        {/* Range Slider Track & Month Ticks */}
        <div className="space-y-2 pt-1">
          <div className="relative flex items-center">
            <input
              type="range"
              min={0}
              max={11}
              step={1}
              value={selectedMonthIndex}
              onChange={(e) => {
                setSelectedMonthIndex(Number(e.target.value));
                if (isPlaying) setIsPlaying(false);
              }}
              className="w-full h-2.5 bg-[#141f33] rounded-lg appearance-none cursor-pointer accent-cyan-400 hover:accent-cyan-300 transition-all focus:outline-none"
            />
          </div>

          {/* Month Labels Ribbon */}
          <div className="grid grid-cols-12 gap-1 text-center font-mono">
            {MONTH_DEFINITIONS.map((def) => {
              const isCurrent = def.monthIndex === selectedMonthIndex;
              const isLive = def.monthIndex === 11;
              return (
                <button
                  key={def.monthIndex}
                  onClick={() => {
                    setSelectedMonthIndex(def.monthIndex);
                    if (isPlaying) setIsPlaying(false);
                  }}
                  className={`py-1.5 px-0.5 rounded transition-all text-[10px] flex flex-col items-center gap-0.5 ${
                    isCurrent
                      ? 'bg-cyan-600 text-white font-bold shadow-md shadow-cyan-900/40 ring-1 ring-cyan-300'
                      : isLive
                      ? 'bg-[#102026] text-emerald-400 hover:bg-[#152932]'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-[#131c2d]'
                  }`}
                >
                  <span className="truncate w-full">{def.shortLabel}</span>
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isCurrent ? 'bg-white' : isLive ? 'bg-emerald-400' : 'bg-slate-600'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {/* Active Historical Month Economic Context Strip */}
        <div className="p-3 bg-[#090e1a] border border-[#182337] rounded-lg flex items-start gap-2.5 text-xs">
          <span className="text-base leading-none mt-0.5">📜</span>
          <div className="space-y-0.5 font-sans">
            <div className="font-bold text-slate-200 flex items-center gap-2">
              <span>{currentMonthSnapshot.macroHeadline}</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-semibold border border-slate-700">
                {currentMonthSnapshot.monthLabel}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
              {currentMonthSnapshot.macroDescription}
            </p>
          </div>
        </div>
      </div>

      {/* Main Workspace Header & Controls Bar */}
      <div className="p-4 bg-[#0e1627] border border-[#1a253b] rounded-xl flex flex-wrap items-center justify-between gap-4">
        {/* Metric Selector Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-400 mr-1">
            Risk Metric:
          </span>
          <button
            onClick={() => setActiveMetric('totalModel')}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all flex items-center gap-1.5 border ${
              activeMetric === 'totalModel'
                ? 'bg-cyan-600 text-white font-bold border-cyan-400 shadow-md shadow-cyan-900/30'
                : 'bg-[#121c2e] text-slate-300 border-[#1f2d47] hover:border-slate-500 hover:text-white'
            }`}
          >
            <span>🌐</span>
            <span>Total Model Hazard (12M)</span>
          </button>

          <button
            onClick={() => setActiveMetric('geopolitical')}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all flex items-center gap-1.5 border ${
              activeMetric === 'geopolitical'
                ? 'bg-amber-600 text-white font-bold border-amber-400 shadow-md shadow-amber-900/30'
                : 'bg-[#121c2e] text-slate-300 border-[#1f2d47] hover:border-slate-500 hover:text-white'
            }`}
          >
            <span>🛡️</span>
            <span>Geopolitical Fragility (P4 & P6)</span>
          </button>

          <button
            onClick={() => setActiveMetric('var99')}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all flex items-center gap-1.5 border ${
              activeMetric === 'var99'
                ? 'bg-rose-700 text-white font-bold border-rose-400 shadow-md shadow-rose-900/30'
                : 'bg-[#121c2e] text-slate-300 border-[#1f2d47] hover:border-slate-500 hover:text-white'
            }`}
          >
            <span>📉</span>
            <span>99% Basel VaR</span>
          </button>

          <button
            onClick={() => setActiveMetric('hmmRegime')}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all flex items-center gap-1.5 border ${
              activeMetric === 'hmmRegime'
                ? 'bg-purple-600 text-white font-bold border-purple-400 shadow-md shadow-purple-900/30'
                : 'bg-[#121c2e] text-slate-300 border-[#1f2d47] hover:border-slate-500 hover:text-white'
            }`}
          >
            <span>🔄</span>
            <span>HMM Regime State</span>
          </button>
        </div>

        {/* Quick Regional Focus & Layer Toggles */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Chokepoint Toggle */}
          <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#131d31] border border-[#202f4a] text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showChokepoints}
              onChange={(e) => setShowChokepoints(e.target.checked)}
              className="rounded bg-[#1a2438] border-slate-700 text-cyan-500 focus:ring-0"
            />
            <span className="text-[11px] font-mono">⚓ Maritime Chokepoints</span>
          </label>

          {/* Regional Quick Focus Buttons */}
          <div className="flex items-center gap-1 bg-[#101726] p-1 rounded-lg border border-[#1b263d]">
            <span className="text-[10px] font-mono uppercase text-slate-500 px-1">Region:</span>
            <button
              onClick={() => handleFocusRegion('global')}
              className="px-2 py-0.5 rounded text-[11px] font-mono text-slate-300 hover:text-white hover:bg-slate-700/50"
            >
              Global
            </button>
            <button
              onClick={() => handleFocusRegion('latam')}
              className="px-2 py-0.5 rounded text-[11px] font-mono text-slate-300 hover:text-white hover:bg-slate-700/50"
            >
              LatAm
            </button>
            <button
              onClick={() => handleFocusRegion('africa')}
              className="px-2 py-0.5 rounded text-[11px] font-mono text-slate-300 hover:text-white hover:bg-slate-700/50"
            >
              Africa
            </button>
            <button
              onClick={() => handleFocusRegion('mena')}
              className="px-2 py-0.5 rounded text-[11px] font-mono text-slate-300 hover:text-white hover:bg-slate-700/50"
            >
              MENA
            </button>
            <button
              onClick={() => handleFocusRegion('asia')}
              className="px-2 py-0.5 rounded text-[11px] font-mono text-slate-300 hover:text-white hover:bg-slate-700/50"
            >
              Asia-Pac
            </button>
          </div>

          {/* Sovereign Quick Jump Search */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search country..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-[#101726] border border-[#223352] text-xs text-slate-200 px-2.5 py-1 rounded-lg focus:outline-none focus:border-cyan-500 w-36 font-mono"
            />
            {filteredSearchSovereigns.length > 0 && searchQuery && (
              <div className="absolute right-0 mt-1 w-52 bg-[#0c1322] border border-[#223352] rounded-lg shadow-2xl p-1 z-50 space-y-1">
                {filteredSearchSovereigns.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setInspectingSovereignId(s.id);
                      onSelectSovereign(s.id);
                      setSearchQuery('');
                    }}
                    className="w-full text-left px-2 py-1 text-xs font-mono rounded hover:bg-[#152037] flex items-center justify-between text-slate-200"
                  >
                    <span>{s.flag} {s.name}</span>
                    <span className="text-[10px] text-slate-400 font-sans">{s.code}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Grid: Interactive Map Stage (Left/Center) + Sovereign Inspector Drawer (Right) */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* Map Canvas Card (3 cols on XL) */}
        <div className="xl:col-span-3 bg-[#0a0f1c] border border-[#1a253b] rounded-xl overflow-hidden relative flex flex-col min-h-[560px] shadow-2xl">
          {/* Top Stage Header / Sub-legend */}
          <div className="px-4 py-2.5 bg-[#0d1424] border-b border-[#182338] flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-100 font-sans flex items-center gap-1.5">
                <span>D3 Sovereign Risk Vector Choropleth</span>
                <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/80 px-1.5 py-0.5 rounded border border-cyan-800">
                  Natural Earth Projection
                </span>
              </span>
              <span className="text-slate-500 hidden sm:inline">·</span>
              <span className="text-[11px] text-slate-400 hidden sm:inline">
                Click any sovereign to inspect; drag to pan; scroll to zoom
              </span>
            </div>

            {/* Active Metric Description & Time Status */}
            <div className="text-[11px] font-mono text-slate-400 flex items-center gap-2">
              <span>
                Metric: <strong className="text-slate-200">
                  {activeMetric === 'totalModel' && 'Total Model Hazard'}
                  {activeMetric === 'geopolitical' && 'Geopolitical Fragility (P4 + P6)'}
                  {activeMetric === 'var99' && '99.0% Basel VaR'}
                  {activeMetric === 'hmmRegime' && 'Gaussian HMM Regime'}
                </strong>
              </span>
              <span className="text-slate-600">|</span>
              <span className="text-cyan-300 font-semibold">
                {currentMonthSnapshot.shortLabel}
              </span>
            </div>
          </div>

          {/* SVG Map Viewport */}
          <div className="relative flex-1 bg-[#060a14] overflow-hidden cursor-grab active:cursor-grabbing select-none">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${mapWidth} ${mapHeight}`}
              className="w-full h-full min-h-[500px]"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onWheel={handleWheel}
            >
              {/* Ocean Background & Coordinate Graticule */}
              <defs>
                <radialGradient id="oceanGlow" cx="50%" cy="50%" r="70%">
                  <stop offset="0%" stopColor="#081022" />
                  <stop offset="100%" stopColor="#040710" />
                </radialGradient>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <filter id="sovereignGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="1.5" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              <rect width={mapWidth} height={mapHeight} fill="url(#oceanGlow)" />

              {/* Equator & Prime Meridian subtle guide lines */}
              <g opacity="0.15" stroke="#334155" strokeDasharray="3,3">
                <line x1="0" y1={mapHeight / 2 + 15} x2={mapWidth} y2={mapHeight / 2 + 15} strokeWidth="1" />
                <line x1={mapWidth / 2} y1="0" x2={mapWidth / 2} y2={mapHeight} strokeWidth="1" />
              </g>

              {/* Zoom & Pan Group Container */}
              <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
                {/* 1. Country Polygons */}
                {renderedFeatures.map(({ country, sov, out, sovSnapshot, colorInfo, pathString }) => {
                  const isSelected = sov && sov.id === inspectingSovereignId;
                  const isMonitored = Boolean(sov);

                  // Fill color & stroke determination with high-contrast legibility
                  let fillColor = '#0f172a'; // Crisp dark slate (slate-900) for non-monitored continents
                  let strokeColor = '#1e293b'; // Slate-800 border
                  let strokeWidth = 0.7;
                  let fillOpacity = 0.65;

                  if (isMonitored && colorInfo) {
                    fillColor = colorInfo.color;
                    fillOpacity = isSelected ? 0.95 : 0.88;
                    strokeColor = isSelected ? '#ffffff' : colorInfo.borderColor;
                    strokeWidth = isSelected ? 2.5 : 1.5;
                  }

                  return (
                    <path
                      key={country.id}
                      d={pathString}
                      fill={fillColor}
                      fillOpacity={fillOpacity}
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      className={`transition-colors duration-200 ${
                        isMonitored ? 'cursor-pointer hover:fill-opacity-100 hover:brightness-110 drop-shadow-md' : 'cursor-default'
                      }`}
                      filter={isSelected ? 'url(#glow)' : isMonitored ? 'url(#sovereignGlow)' : undefined}
                      onClick={() => {
                        if (sov) {
                          setInspectingSovereignId(sov.id);
                          onSelectSovereign(sov.id);
                        }
                      }}
                      onMouseEnter={(e) => {
                        const rect = svgRef.current?.getBoundingClientRect();
                        setHoveredCountry({
                          feature: country,
                          sovereign: sov,
                          output: out,
                          snapshot: sovSnapshot,
                          colorInfo: colorInfo,
                          x: e.clientX - (rect?.left || 0),
                          y: e.clientY - (rect?.top || 0)
                        });
                      }}
                      onMouseLeave={() => setHoveredCountry(null)}
                    />
                  );
                })}

                {/* 2. Country Pinpoints & Flags for Monitored Sovereigns */}
                {sovereigns.map((s) => {
                  const out = pipelineOutputs[s.id];
                  const sovSnapshot = currentMonthSnapshot.sovereigns[s.id];
                  const feature = WORLD_COUNTRIES_GEO.find((f) => f.id === s.code.toUpperCase());
                  if (!feature) return null;

                  // Find centroid of coordinates
                  const ring = feature.coordinates[0];
                  if (!ring || ring.length === 0) return null;
                  const avgLon = ring.reduce((sum, pt) => sum + pt[0], 0) / ring.length;
                  const avgLat = ring.reduce((sum, pt) => sum + pt[1], 0) / ring.length;
                  const projected = projection([avgLon, avgLat]);
                  if (!projected) return null;

                  const [px, py] = projected;
                  const isSelected = s.id === inspectingSovereignId;
                  const currentHazard = sovSnapshot ? sovSnapshot.totalModelRisk : (out ? out.calibratedPosteriorHazard * 100 : 0);

                  return (
                    <g
                      key={`pin-${s.id}`}
                      transform={`translate(${px}, ${py})`}
                      className="cursor-pointer"
                      onClick={() => {
                        setInspectingSovereignId(s.id);
                        onSelectSovereign(s.id);
                      }}
                    >
                      {/* Pulse Circle for High Risk Sovereigns in Current Replayed Month */}
                      {currentHazard > 20 && (
                        <circle
                          r="11"
                          fill="none"
                          stroke="#f43f5e"
                          strokeWidth="1.8"
                          opacity="0.85"
                          className="animate-ping"
                        />
                      )}

                      {/* Sovereign Marker Base */}
                      <circle
                        r={isSelected ? '6.5' : '4.5'}
                        fill={isSelected ? '#ffffff' : '#080e1b'}
                        stroke={isSelected ? '#38bdf8' : '#38bdf8'}
                        strokeWidth={isSelected ? '2.8' : '1.8'}
                      />

                      {/* Sovereign Code Label with High-Contrast Halo */}
                      <text
                        y="-8.5"
                        textAnchor="middle"
                        fill="#ffffff"
                        stroke="#020617"
                        strokeWidth="2.5"
                        paintOrder="stroke"
                        fontSize={isSelected ? '10' : '8.5'}
                        fontWeight="bold"
                        fontFamily="monospace"
                        className="pointer-events-none drop-shadow-md tracking-wider"
                      >
                        {s.code}
                      </text>
                    </g>
                  );
                })}

                {/* 3. Strategic Maritime Chokepoints Overlay */}
                {showChokepoints &&
                  MARITIME_CHOKEPOINTS.map((cp) => {
                    const projected = projection([cp.lon, cp.lat]);
                    if (!projected) return null;
                    const [cx, cy] = projected;

                    const isDisrupted = cp.status === 'Disrupted';
                    const isElevated = cp.status === 'Elevated';
                    const cpColor = isDisrupted ? '#ef4444' : isElevated ? '#f59e0b' : '#06b6d4';

                    return (
                      <g
                        key={cp.id}
                        transform={`translate(${cx}, ${cy})`}
                        className="cursor-pointer"
                        onMouseEnter={(e) => {
                          const rect = svgRef.current?.getBoundingClientRect();
                          setHoveredChokepoint({
                            chokepoint: cp,
                            x: e.clientX - (rect?.left || 0),
                            y: e.clientY - (rect?.top || 0)
                          });
                        }}
                        onMouseLeave={() => setHoveredChokepoint(null)}
                      >
                        {/* Ping beacon for disrupted corridor */}
                        {(isDisrupted || isElevated) && (
                          <circle
                            r="8"
                            fill="none"
                            stroke={cpColor}
                            strokeWidth="1.2"
                            className="animate-ping"
                          />
                        )}

                        {/* Anchor / Corridors Symbol */}
                        <polygon
                          points="0,-5 4,4 -4,4"
                          fill={cpColor}
                          stroke="#080e1b"
                          strokeWidth="1"
                        />
                        <circle r="2" fill="#ffffff" />
                      </g>
                    );
                  })}
              </g>
            </svg>

            {/* Floating Zoom Controls & Compass */}
            <div className="absolute bottom-4 left-4 flex flex-col gap-1.5 bg-[#0b1220]/90 backdrop-blur-md p-1.5 rounded-xl border border-[#1f2d48] shadow-2xl">
              <button
                onClick={handleZoomIn}
                className="w-8 h-8 rounded-lg bg-[#141f36] hover:bg-[#1e2f50] text-slate-200 font-bold text-sm flex items-center justify-center transition-colors"
                title="Zoom In"
              >
                +
              </button>
              <button
                onClick={handleZoomOut}
                className="w-8 h-8 rounded-lg bg-[#141f36] hover:bg-[#1e2f50] text-slate-200 font-bold text-sm flex items-center justify-center transition-colors"
                title="Zoom Out"
              >
                −
              </button>
              <button
                onClick={handleResetZoom}
                className="w-8 h-8 rounded-lg bg-[#141f36] hover:bg-[#1e2f50] text-cyan-400 font-mono text-[10px] flex items-center justify-center transition-colors"
                title="Reset View"
              >
                1x
              </button>
            </div>

            {/* Floating HUD Tooltip for Country Hover */}
            {hoveredCountry && (
              <div
                className="absolute z-40 pointer-events-none p-3 bg-[#0a0f1d]/95 backdrop-blur-md border border-[#233554] rounded-xl shadow-2xl text-xs font-mono space-y-1.5 min-w-60 transition-all"
                style={{
                  left: Math.min(hoveredCountry.x + 15, mapWidth - 270),
                  top: Math.max(hoveredCountry.y - 80, 15)
                }}
              >
                <div className="flex items-center justify-between pb-1.5 border-b border-[#1c2c47]">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{hoveredCountry.sovereign?.flag || '🌐'}</span>
                    <span className="font-bold text-slate-100 font-sans">{hoveredCountry.feature.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 font-mono">
                      {hoveredCountry.feature.id}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 text-[9px] font-bold border border-cyan-800 font-mono">
                      {currentMonthSnapshot.shortLabel}
                    </span>
                  </div>
                </div>

                {/* Risk Classification Tier Pill */}
                {hoveredCountry.colorInfo && (
                  <div
                    className="flex items-center justify-between py-1 px-2 rounded-md border my-1 shadow-sm"
                    style={{
                      backgroundColor: hoveredCountry.colorInfo.bgBadge,
                      borderColor: `${hoveredCountry.colorInfo.borderColor}90`
                    }}
                  >
                    <span className="text-[10px] uppercase font-mono font-bold text-white/80">Classification:</span>
                    <span
                      className="text-[11px] font-mono font-bold"
                      style={{ color: hoveredCountry.colorInfo.textColor }}
                    >
                      {hoveredCountry.colorInfo.label}
                    </span>
                  </div>
                )}

                {hoveredCountry.snapshot ? (
                  <div className="space-y-1 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Total Model Risk:</span>
                      <span
                        className={`font-bold ${
                          hoveredCountry.snapshot.totalModelRisk > 20
                            ? 'text-rose-400'
                            : hoveredCountry.snapshot.totalModelRisk > 8
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {hoveredCountry.snapshot.totalModelRisk.toFixed(1)}%
                      </span>
                    </div>

                    {selectedMonthIndex !== 11 && (
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500">Delta vs Live (Oct 26):</span>
                        <span
                          className={`font-semibold ${
                            hoveredCountry.snapshot.deltaFromLive > 0 ? 'text-rose-400' : 'text-emerald-400'
                          }`}
                        >
                          {hoveredCountry.snapshot.deltaFromLive > 0 ? '+' : ''}
                          {hoveredCountry.snapshot.deltaFromLive.toFixed(1)}%
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">99% Basel VaR:</span>
                      <span className="font-bold text-slate-200">
                        {hoveredCountry.snapshot.var99.toFixed(1)}%
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">5Y CDS Spread:</span>
                      <span className="text-slate-200">
                        {hoveredCountry.snapshot.cdsSpreadBps} bps
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">HMM Regime:</span>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                          hoveredCountry.snapshot.hmmRegime === 'Crisis'
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : hoveredCountry.snapshot.hmmRegime === 'Stressed'
                            ? 'bg-amber-950 text-amber-300 border border-amber-800'
                            : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        }`}
                      >
                        {hoveredCountry.snapshot.hmmRegime}
                      </span>
                    </div>

                    {hoveredCountry.snapshot.eventNote && (
                      <div className="text-[10px] text-amber-300 font-sans pt-1 border-t border-[#18263e]">
                        📍 {hoveredCountry.snapshot.eventNote}
                      </div>
                    )}

                    <div className="text-[10px] text-cyan-400 font-sans pt-1 border-t border-[#18263e]">
                      Click to inspect full sovereign profile →
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400 font-sans">
                    <div>Region: {hoveredCountry.feature.region}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      Global macroeconomic reference benchmark
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Floating HUD Tooltip for Maritime Chokepoint Hover */}
            {hoveredChokepoint && (
              <div
                className="absolute z-40 pointer-events-none p-3 bg-[#0a0f1d]/95 backdrop-blur-md border border-cyan-800/60 rounded-xl shadow-2xl text-xs font-mono space-y-1.5 min-w-64"
                style={{
                  left: Math.min(hoveredChokepoint.x + 15, mapWidth - 280),
                  top: Math.max(hoveredChokepoint.y - 70, 15)
                }}
              >
                <div className="flex items-center justify-between pb-1 border-b border-[#1c2c47]">
                  <span className="font-bold text-slate-100 flex items-center gap-1.5">
                    <span>⚓</span>
                    <span>{hoveredChokepoint.chokepoint.name}</span>
                  </span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                      hoveredChokepoint.chokepoint.status === 'Disrupted'
                        ? 'bg-rose-950 text-rose-300 border border-rose-800'
                        : hoveredChokepoint.chokepoint.status === 'Elevated'
                        ? 'bg-amber-950 text-amber-300 border border-amber-800'
                        : 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                    }`}
                  >
                    {hoveredChokepoint.chokepoint.status}
                  </span>
                </div>

                <div className="space-y-1 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Daily Oil Transit:</span>
                    <span className="font-bold text-slate-200">
                      {hoveredChokepoint.chokepoint.oilVolumeMbd} Mbd
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Global Trade Share:</span>
                    <span className="font-bold text-cyan-400">
                      {hoveredChokepoint.chokepoint.globalTradeSharePercent}%
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-300 font-sans italic pt-1 border-t border-[#18263e]">
                    {hoveredChokepoint.chokepoint.primaryRisk}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Choropleth Dynamic Legend Ribbon with 5 Discrete Tiers & Counters */}
          <div className="px-4 py-3 bg-[#0d1424] border-t border-[#182338] flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-[11px] uppercase font-bold text-slate-300 mr-0.5 flex items-center gap-1.5">
                <span>🎨</span>
                <span>Risk Tiers:</span>
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {MAP_RISK_SCALES[activeMetric].map((tier) => {
                  const countInTier = sovereigns.filter((s) => {
                    const val = getSovereignMetricValue(s, pipelineOutputs[s.id], selectedMonthIndex);
                    return val >= tier.min && (val < tier.max || tier.max === 100 || tier.max === 3);
                  }).length;

                  return (
                    <div
                      key={tier.label}
                      className="flex items-center gap-2 px-2.5 py-1 rounded-lg border shadow-sm transition-all hover:scale-105"
                      style={{
                        backgroundColor: tier.bgBadge,
                        borderColor: `${tier.borderColor}90`
                      }}
                      title={tier.description}
                    >
                      <span
                        className="w-3 h-3 rounded-full inline-block shadow-sm ring-1 ring-black/50"
                        style={{ backgroundColor: tier.color }}
                      />
                      <span className="font-mono text-[11px] font-bold" style={{ color: tier.textColor }}>
                        {tier.label}
                      </span>
                      <span
                        className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-black/40 border border-white/10"
                        style={{ color: tier.textColor }}
                      >
                        {countInTier}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-4 text-[11px] font-mono text-slate-300">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 border border-white/60 shadow-sm" />
                <span>Monitored Sovereign</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse border border-white/60 shadow-sm" />
                <span>Critical Chokepoint</span>
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Sovereign Risk Inspector Drawer */}
        <div className="bg-[#0e1627] border border-[#1a253b] rounded-xl p-5 flex flex-col justify-between space-y-4 shadow-xl">
          {inspectingSovereign ? (
            <div className="space-y-4">
              {/* Sovereign Header */}
              <div className="pb-3 border-b border-[#1c2c47]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="text-3xl">{inspectingSovereign.flag}</span>
                    <div>
                      <h3 className="text-base font-bold text-slate-100 font-sans tracking-tight">
                        {inspectingSovereign.name}
                      </h3>
                      <div className="text-xs text-slate-400 font-mono">
                        {inspectingSovereign.code} · {inspectingSovereign.region}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                        inspectingSnapshot?.hmmRegime === 'Crisis'
                          ? 'bg-rose-950 text-rose-300 border border-rose-800'
                          : inspectingSnapshot?.hmmRegime === 'Stressed'
                          ? 'bg-amber-950 text-amber-300 border border-amber-800'
                          : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      }`}
                    >
                      {inspectingSnapshot?.hmmRegime || inspectingOutput?.regime || 'Calm'}
                    </span>

                    {/* Prominent Risk Tier Pill */}
                    {(() => {
                      const metricVal = inspectingSovereign ? getSovereignMetricValue(inspectingSovereign, inspectingOutput, selectedMonthIndex) : 0;
                      const tierInfo = getMapColor(metricVal, activeMetric);
                      return (
                        <div
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-bold border shadow-sm"
                          style={{
                            backgroundColor: tierInfo.bgBadge,
                            color: tierInfo.textColor,
                            borderColor: tierInfo.borderColor
                          }}
                        >
                          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: tierInfo.color }} />
                          <span>{tierInfo.label}</span>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Historical Replay Callout (shown if not in live month) */}
              {selectedMonthIndex !== 11 && inspectingSnapshot && (
                <div className="p-2.5 bg-amber-950/40 border border-amber-600/40 rounded-lg text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-amber-400 font-bold text-[10px] uppercase flex items-center gap-1">
                      <span>⏱️</span>
                      <span>Snapshot: {currentMonthSnapshot.monthLabel}</span>
                    </span>
                    <button
                      onClick={() => setSelectedMonthIndex(11)}
                      className="text-[10px] font-mono text-cyan-300 hover:underline"
                    >
                      Snap to Live →
                    </button>
                  </div>
                  <div className="text-[11px] text-slate-300 font-sans leading-relaxed">
                    Total model hazard was <strong className="text-white font-mono">{inspectingSnapshot.totalModelRisk.toFixed(1)}%</strong> ({inspectingSnapshot.deltaFromLive >= 0 ? '+' : ''}{inspectingSnapshot.deltaFromLive.toFixed(1)}% vs Oct 2026 Live).
                  </div>
                </div>
              )}

              {/* Primary Risk KPIs Strip */}
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2.5 bg-[#121c2e] border border-[#1f2d48] rounded-lg">
                  <div className="text-[10px] text-slate-400 uppercase">
                    Total Model Hazard ({currentMonthSnapshot.shortLabel})
                  </div>
                  <div
                    className={`text-lg font-bold ${
                      (inspectingSnapshot?.totalModelRisk || 0) > 20
                        ? 'text-rose-400'
                        : (inspectingSnapshot?.totalModelRisk || 0) > 8
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {(inspectingSnapshot?.totalModelRisk || 0).toFixed(1)}%
                  </div>
                  <div className="text-[9px] text-slate-500">
                    {selectedMonthIndex === 11 ? 'Live Posterior' : `T-${11 - selectedMonthIndex}M Point`}
                  </div>
                </div>

                <div className="p-2.5 bg-[#121c2e] border border-[#1f2d48] rounded-lg">
                  <div className="text-[10px] text-slate-400 uppercase">99% 1Y VaR</div>
                  <div className="text-lg font-bold text-slate-100">
                    {(inspectingSnapshot?.var99 || inspectingOutput?.var99 || 5.0).toFixed(1)}%
                  </div>
                  <div className="text-[9px] text-rose-400">
                    ES: {inspectingOutput?.es975.toFixed(1)}%
                  </div>
                </div>

                <div className="p-2.5 bg-[#121c2e] border border-[#1f2d48] rounded-lg">
                  <div className="text-[10px] text-slate-400 uppercase">5Y CDS Spread</div>
                  <div className="text-base font-bold text-slate-100">
                    {inspectingSnapshot?.cdsSpreadBps || inspectingSovereign.cdsSpread5yBps} bps
                  </div>
                  <div className="text-[9px] text-slate-500">Market Benchmark</div>
                </div>

                <div className="p-2.5 bg-[#121c2e] border border-[#1f2d48] rounded-lg">
                  <div className="text-[10px] text-slate-400 uppercase">Scorecard Score</div>
                  <div className="text-base font-bold text-amber-300">
                    {inspectingScorecard?.compositeScore.toFixed(1)}
                  </div>
                  <div className="text-[9px] text-slate-500">Grade: {inspectingScorecard?.grade}</div>
                </div>
              </div>

              {/* 12-Month Historical Trajectory Sparkline Mini-Chart */}
              <div className="space-y-1.5 pt-2 border-t border-[#1c2c47]">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-300 font-sans flex items-center gap-1.5">
                    <span>📈</span>
                    <span>12-Month Risk Trajectory:</span>
                  </span>
                  <span className="text-[10px] font-mono text-cyan-400">
                    Click node to scrub
                  </span>
                </div>

                {/* Sparkline Canvas */}
                <div className="p-2 bg-[#0a0f1d] border border-[#1e2e4b] rounded-lg space-y-1.5">
                  <svg viewBox="0 0 280 62" className="w-full h-16 overflow-visible">
                    <defs>
                      <linearGradient id={`sparkGrad-${inspectingSovereign.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>

                    {/* Horizontal gridlines */}
                    <line x1="0" y1="12" x2="280" y2="12" stroke="#1c2c47" strokeDasharray="2,2" strokeWidth="0.8" />
                    <line x1="0" y1="32" x2="280" y2="32" stroke="#1c2c47" strokeDasharray="2,2" strokeWidth="0.8" />
                    <line x1="0" y1="52" x2="280" y2="52" stroke="#1c2c47" strokeDasharray="2,2" strokeWidth="0.8" />

                    {/* Compute SVG coordinates */}
                    {(() => {
                      const history = historicalMonthlySnapshots.map((snap) => ({
                        m: snap.monthIndex,
                        label: snap.shortLabel,
                        val: snap.sovereigns[inspectingSovereign.id]?.totalModelRisk ?? 10
                      }));
                      const minVal = Math.min(...history.map((h) => h.val));
                      const maxVal = Math.max(...history.map((h) => h.val));
                      const range = Math.max(1.5, maxVal - minVal);

                      const getX = (idx: number) => 15 + (idx / 11) * 250;
                      const getY = (val: number) => 50 - ((val - minVal) / range) * 38;

                      const pointsStr = history.map((h) => `${getX(h.m).toFixed(1)},${getY(h.val).toFixed(1)}`).join(' ');
                      const areaStr = `${pointsStr} ${getX(11).toFixed(1)},58 ${getX(0).toFixed(1)},58`;

                      const activePt = history[selectedMonthIndex] || history[11];
                      const activeX = getX(activePt.m);
                      const activeY = getY(activePt.val);

                      return (
                        <g>
                          {/* Fill area */}
                          <polygon points={areaStr} fill={`url(#sparkGrad-${inspectingSovereign.id})`} />

                          {/* Line path */}
                          <polyline
                            points={pointsStr}
                            fill="none"
                            stroke="#38bdf8"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />

                          {/* Active month vertical cursor */}
                          <line
                            x1={activeX}
                            y1="4"
                            x2={activeX}
                            y2="58"
                            stroke="#f59e0b"
                            strokeWidth="1.2"
                            strokeDasharray="2,2"
                          />

                          {/* Individual month clickable dots */}
                          {history.map((h) => {
                            const cx = getX(h.m);
                            const cy = getY(h.val);
                            const isSelected = h.m === selectedMonthIndex;
                            return (
                              <g
                                key={h.m}
                                className="cursor-pointer"
                                onClick={() => {
                                  setSelectedMonthIndex(h.m);
                                  if (isPlaying) setIsPlaying(false);
                                }}
                              >
                                {isSelected && (
                                  <circle
                                    cx={cx}
                                    cy={cy}
                                    r="6"
                                    fill="none"
                                    stroke="#f59e0b"
                                    strokeWidth="1.5"
                                    className="animate-ping"
                                  />
                                )}
                                <circle
                                  cx={cx}
                                  cy={cy}
                                  r={isSelected ? 4 : 2.5}
                                  fill={isSelected ? '#f59e0b' : '#38bdf8'}
                                  stroke="#080e1a"
                                  strokeWidth="1"
                                />
                              </g>
                            );
                          })}
                        </g>
                      );
                    })()}
                  </svg>

                  {/* Trajectory Range Readout */}
                  {(() => {
                    const history = historicalMonthlySnapshots.map((snap) => snap.sovereigns[inspectingSovereign.id]?.totalModelRisk ?? 10);
                    const minVal = Math.min(...history);
                    const maxVal = Math.max(...history);
                    return (
                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-1 border-t border-[#16233b]">
                        <span>12M Low: <strong className="text-emerald-400">{minVal.toFixed(1)}%</strong></span>
                        <span>Replay: <strong className="text-amber-300">{(inspectingSnapshot?.totalModelRisk ?? 0).toFixed(1)}%</strong></span>
                        <span>12M High: <strong className="text-rose-400">{maxVal.toFixed(1)}%</strong></span>
                      </div>
                    );
                  })()}
                </div>

                {/* Event note for inspected sovereign */}
                {inspectingSnapshot?.eventNote && (
                  <div className="p-2 bg-[#121c2e] border border-amber-600/30 rounded text-[11px] text-amber-300 font-sans flex items-start gap-1.5">
                    <span>📌</span>
                    <span>{inspectingSnapshot.eventNote}</span>
                  </div>
                )}
              </div>

              {/* 7-Pillar Fragility Breakdown Bars */}
              <div className="space-y-2 pt-2 border-t border-[#1c2c47]">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-300 font-sans">7-Pillar Vulnerabilities:</span>
                  <span className="text-[10px] font-mono text-slate-500">0 - 100 Scale</span>
                </div>

                <div className="space-y-1.5 text-[11px] font-mono">
                  {inspectingScorecard?.pillarBreakdowns.map((p) => {
                    const score = p.score;
                    const barColor = score > 70 ? 'bg-rose-500' : score > 50 ? 'bg-amber-500' : 'bg-emerald-500';
                    return (
                      <div key={p.pillarId} className="space-y-0.5">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-slate-400 truncate max-w-[170px]">{p.name}</span>
                          <span className="font-bold text-slate-200">{score.toFixed(1)}</span>
                        </div>
                        <div className="w-full bg-[#152037] h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${barColor}`}
                            style={{ width: `${Math.min(100, Math.max(5, score))}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Arbitrage / Market Divergence Status */}
              {inspectingOutput && (
                <div className="p-2.5 bg-[#0a0f1d] border border-[#1e2e4b] rounded-lg text-xs space-y-1 font-mono">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Prediction Market:</span>
                    <span className="text-slate-200">
                      {inspectingSovereign.predictionMarket.impliedProbPercent.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Alpha Divergence:</span>
                    <span
                      className={`font-bold ${
                        inspectingOutput.isArbitrageAlert ? 'text-emerald-400' : 'text-slate-400'
                      }`}
                    >
                      {inspectingOutput.arbitrageDivergence > 0
                        ? `+${inspectingOutput.arbitrageDivergence.toFixed(1)}%`
                        : `${inspectingOutput.arbitrageDivergence.toFixed(1)}%`}
                    </span>
                  </div>
                  {inspectingOutput.isArbitrageAlert && (
                    <div className="text-[10px] text-emerald-400 font-sans font-medium uppercase tracking-tight">
                      ⚡ Active Relative Value Alpha Opportunity
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-slate-400 text-xs">
              Select any sovereign to view its detailed quantitative profile.
            </div>
          )}

          {/* Action Drilldowns */}
          {inspectingSovereign && (
            <div className="space-y-2 pt-3 border-t border-[#1c2c47]">
              <button
                onClick={() => {
                  onSelectSovereign(inspectingSovereign.id);
                  onNavigateToTab('pipeline');
                }}
                className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 shadow-md"
              >
                <span>🔬 Decompose in 6-Layer Pipeline →</span>
              </button>

              <button
                onClick={() => {
                  onSelectSovereign(inspectingSovereign.id);
                  onNavigateToTab('cockpit');
                }}
                className="w-full py-2 px-3 rounded-lg bg-[#141f36] hover:bg-[#1b2a4a] text-cyan-300 font-mono text-xs font-medium border border-[#233554] transition-colors flex items-center justify-center gap-1.5"
              >
                <span>📊 Open in Sovereign Cockpit</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
