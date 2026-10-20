import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid
} from 'recharts';
import { SovereignEntity, LayerOutputs, MacroScenario, CustomScenarioParams } from '../types/riskEngine';
import { runRiskPipeline } from '../math/riskCalculations';
import {
  DEFAULT_CUSTOM_SCENARIO,
  PRESET_CUSTOM_SCENARIOS,
  loadSavedCustomScenarios,
  saveCustomScenariosList
} from '../data/defaultCustomScenarios';

interface CustomMacroScenarioBuilderProps {
  sovereigns: SovereignEntity[];
  baselineOutputs: Record<string, LayerOutputs>;
  activeScenario: MacroScenario;
  setActiveScenario: (scenario: MacroScenario) => void;
  customParams: CustomScenarioParams;
  setCustomParams: (params: CustomScenarioParams) => void;
  onSelectSovereign: (id: string) => void;
  onNavigateToTab: (tab: string) => void;
}

export const CustomMacroScenarioBuilder: React.FC<CustomMacroScenarioBuilderProps> = ({
  sovereigns,
  baselineOutputs,
  activeScenario,
  setActiveScenario,
  customParams,
  setCustomParams,
  onSelectSovereign,
  onNavigateToTab
}) => {
  const [savedScenarios, setSavedScenarios] = useState<CustomScenarioParams[]>(() =>
    loadSavedCustomScenarios()
  );
  const [showSaveModal, setShowSaveModal] = useState<boolean>(false);
  const [saveName, setSaveName] = useState<string>('');
  const [saveDesc, setSaveDesc] = useState<string>('');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [regionFilter, setRegionFilter] = useState<string>('All');

  // Compute live counterfactual outputs for all sovereigns under current custom parameters
  const customOutputs: Record<string, LayerOutputs> = useMemo(() => {
    const outputs: Record<string, LayerOutputs> = {};
    sovereigns.forEach((s) => {
      outputs[s.id] = runRiskPipeline(s, 'custom', true, 0.4, customParams);
    });
    return outputs;
  }, [sovereigns, customParams]);

  // Handle parameter changes
  const updateParam = <K extends keyof CustomScenarioParams>(key: K, value: CustomScenarioParams[K]) => {
    setCustomParams({
      ...customParams,
      [key]: value
    });
  };

  // Handle Preset selection
  const handleSelectPreset = (preset: CustomScenarioParams) => {
    setCustomParams({
      ...preset,
      id: `custom_${Date.now()}`
    });
  };

  // Handle Save Scenario
  const handleSaveScenario = (e: React.FormEvent) => {
    e.preventDefault();
    if (!saveName.trim()) return;
    const newScenario: CustomScenarioParams = {
      ...customParams,
      id: `user_scenario_${Date.now()}`,
      name: saveName.trim(),
      description: saveDesc.trim() || 'User custom macroeconomic scenario'
    };
    const updated = [newScenario, ...savedScenarios];
    setSavedScenarios(updated);
    saveCustomScenariosList(updated);
    setCustomParams(newScenario);
    setShowSaveModal(false);
    setSaveName('');
    setSaveDesc('');
  };

  // Handle Delete Saved Scenario
  const handleDeleteScenario = (id: string) => {
    const updated = savedScenarios.filter((s) => s.id !== id);
    setSavedScenarios(updated);
    saveCustomScenariosList(updated);
  };

  // Export JSON
  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(customParams, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `${customParams.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_scenario.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Import JSON
  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed && typeof parsed.usYieldCurveShiftBps === 'number') {
          setCustomParams({
            ...DEFAULT_CUSTOM_SCENARIO,
            ...parsed,
            id: `imported_${Date.now()}`
          });
        }
      } catch (err) {
        console.error('Failed to parse scenario JSON', err);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Reset to Neutral
  const handleResetToNeutral = () => {
    setCustomParams({
      ...DEFAULT_CUSTOM_SCENARIO,
      id: `custom_${Date.now()}`,
      name: 'Neutral Macro Baseline (Zero Shocks)',
      description: 'Zero macroeconomic shocks applied; baseline market yields and parameters.',
      usYieldCurveShiftBps: 0,
      sovereignSpreadWideningBps: 0,
      curveSteepeningBps: 0,
      commodityPriceShockPercent: 0,
      energyOilShockPercent: 0,
      metalsTermsOfTradeShockPercent: 0,
      fxImpliedVolSkewJump: 0,
      broadUsdAppreciation: 0,
      reserveDrainPercent: 0,
      textStressIndexShockSigma: 0,
      aisChokepointDisruptionPct: 0,
      crossBorderContagionRho: 0
    });
  };

  // Yield Curve Simulation Data (Baseline vs Shocked US Treasury & EM Curve)
  const yieldCurveData = useMemo(() => {
    const tenors = [
      { tenor: '3M', baseUST: 4.85, baseEM: 7.20 },
      { tenor: '2Y', baseUST: 4.25, baseEM: 7.60 },
      { tenor: '5Y', baseUST: 4.18, baseEM: 8.05 },
      { tenor: '10Y', baseUST: 4.28, baseEM: 8.45 },
      { tenor: '30Y', baseUST: 4.52, baseEM: 8.95 }
    ];

    const ustShift = customParams.usYieldCurveShiftBps / 100;
    const emSpreadShift = customParams.sovereignSpreadWideningBps / 100;
    const steepShift = (customParams.curveSteepeningBps / 100) * 0.5;

    return tenors.map((t, idx) => {
      // slope factor: 3M (-0.4), 2Y (-0.2), 5Y (0), 10Y (+0.2), 30Y (+0.4)
      const slopeFactor = (idx - 2) * steepShift;
      const shockedUST = Math.max(0.25, t.baseUST + ustShift + slopeFactor);
      const shockedEM = Math.max(0.50, t.baseEM + ustShift + emSpreadShift + slopeFactor * 1.2);

      return {
        tenor: t.tenor,
        'Base UST 10Y': Number(t.baseUST.toFixed(2)),
        'Stressed UST': Number(shockedUST.toFixed(2)),
        'Base EM Curve': Number(t.baseEM.toFixed(2)),
        'Stressed EM Curve': Number(shockedEM.toFixed(2))
      };
    });
  }, [customParams]);

  // Aggregate Macro Distress Indicators
  const aggregateMetrics = useMemo(() => {
    let totalBaseVaR = 0;
    let totalCustomVaR = 0;
    let crisisCount = 0;
    let stressedCount = 0;
    let worstHit = { sovereign: sovereigns[0], deltaVaR: -999 };

    sovereigns.forEach((s) => {
      const base = baselineOutputs[s.id];
      const custom = customOutputs[s.id];
      if (base && custom) {
        totalBaseVaR += base.var99;
        totalCustomVaR += custom.var99;
        const delta = custom.var99 - base.var99;
        if (delta > worstHit.deltaVaR) {
          worstHit = { sovereign: s, deltaVaR: delta };
        }
        if (custom.regime === 'Crisis') crisisCount++;
        else if (custom.regime === 'Stressed') stressedCount++;
      }
    });

    const avgBaseVaR = totalBaseVaR / sovereigns.length;
    const avgCustomVaR = totalCustomVaR / sovereigns.length;
    const avgDeltaVaR = avgCustomVaR - avgBaseVaR;

    // Macro severity index (0-100)
    const severityIndex = Math.min(
      100,
      Math.max(
        0,
        Math.round(
          (Math.max(0, customParams.sovereignSpreadWideningBps) / 1000) * 35 +
            (Math.max(0, customParams.fxImpliedVolSkewJump) / 45) * 25 +
            (Math.max(0, -customParams.commodityPriceShockPercent) / 60) * 20 +
            (customParams.aisChokepointDisruptionPct / 80) * 20
        )
      )
    );

    return {
      avgBaseVaR,
      avgCustomVaR,
      avgDeltaVaR,
      worstHit,
      crisisCount,
      stressedCount,
      calmCount: sovereigns.length - crisisCount - stressedCount,
      severityIndex
    };
  }, [sovereigns, baselineOutputs, customOutputs, customParams]);

  // Filtered sovereigns for the table
  const filteredSovereigns = useMemo(() => {
    return sovereigns.filter((s) => {
      const matchesSearch =
        s.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
        s.code.toLowerCase().includes(searchFilter.toLowerCase());
      const matchesRegion = regionFilter === 'All' || s.region === regionFilter;
      return matchesSearch && matchesRegion;
    });
  }, [sovereigns, searchFilter, regionFilter]);

  const isCustomActive = activeScenario === 'custom';

  return (
    <div className="space-y-6">
      {/* 1. Header & Scenario State Ribbon */}
      <div className="p-5 bg-[#0e1524] border border-[#1a2438] rounded-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="p-1.5 rounded bg-emerald-950/70 text-emerald-400 border border-emerald-800 text-xs font-mono font-bold">
                WHAT-IF ENGINE
              </span>
              <h2 className="text-lg font-bold text-slate-100">
                Custom Macro Scenario Builder & Counterfactual Sensitivity Lab
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-4xl">
              Construct high-dimensional macro-financial stress scenarios by calibrating sovereign yield curve shifts,
              commodity terms-of-trade shocks, FX volatility skew, and geopolitical choke-points. Recalculates all 6
              quantitative pipeline layers in real-time.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {/* Live Workstation Application Toggle */}
            <button
              onClick={() => setActiveScenario(isCustomActive ? 'baseline' : 'custom')}
              className={`px-3.5 py-1.5 rounded text-xs font-mono font-semibold flex items-center gap-2 transition-all ${
                isCustomActive
                  ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20 ring-1 ring-emerald-400'
                  : 'bg-[#152037] text-slate-200 border border-[#2b3a56] hover:bg-[#1c2c4d]'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isCustomActive ? 'bg-slate-950 animate-pulse' : 'bg-slate-500'
                }`}
              />
              {isCustomActive ? 'Custom Scenario Active on Workstation' : 'Apply Custom Scenario to Workstation'}
            </button>

            <button
              onClick={() => setShowSaveModal(true)}
              className="px-3 py-1.5 bg-[#121b2d] hover:bg-[#1a2742] text-slate-200 text-xs font-mono rounded border border-[#233352] transition-colors"
            >
              💾 Save Scenario
            </button>

            <button
              onClick={handleExportJSON}
              className="px-3 py-1.5 bg-[#121b2d] hover:bg-[#1a2742] text-slate-200 text-xs font-mono rounded border border-[#233352] transition-colors"
              title="Download Scenario as JSON"
            >
              ⤓ Export JSON
            </button>

            <label className="px-3 py-1.5 bg-[#121b2d] hover:bg-[#1a2742] text-slate-200 text-xs font-mono rounded border border-[#233352] transition-colors cursor-pointer">
              ⤒ Import JSON
              <input type="file" accept=".json" onChange={handleImportJSON} className="hidden" />
            </label>

            <button
              onClick={handleResetToNeutral}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs font-mono rounded border border-slate-700 transition-colors"
            >
              ↺ Reset to Neutral
            </button>
          </div>
        </div>

        {/* Active Scenario Title & Description */}
        <div className="mt-4 pt-3 border-t border-[#1a2438] flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-mono">Current Scenario:</span>
            <span className="font-bold text-amber-300 font-mono">{customParams.name}</span>
            <span className="text-slate-500 font-mono text-[11px]">({customParams.description})</span>
          </div>

          <div className="flex items-center gap-3 text-[11px] font-mono">
            <span className="text-slate-400">Distress Level:</span>
            <span
              className={`px-2 py-0.5 rounded font-bold ${
                aggregateMetrics.severityIndex >= 70
                  ? 'bg-rose-950 text-rose-400 border border-rose-800'
                  : aggregateMetrics.severityIndex >= 40
                  ? 'bg-amber-950 text-amber-400 border border-amber-800'
                  : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
              }`}
            >
              Index {aggregateMetrics.severityIndex}/100 ·{' '}
              {aggregateMetrics.severityIndex >= 70
                ? 'Severe Shock'
                : aggregateMetrics.severityIndex >= 40
                ? 'Elevated Stress'
                : 'Controlled'}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Institutional Scenario Presets Bar */}
      <div className="p-3.5 bg-[#0b101c] border border-[#1a2438] rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">
            Institutional Stress Presets & Templates:
          </span>
          <span className="text-[11px] font-mono text-slate-500">
            Click any template to auto-populate levers
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESET_CUSTOM_SCENARIOS.map((preset) => {
            const isSelected = customParams.name === preset.name;
            return (
              <button
                key={preset.id}
                onClick={() => handleSelectPreset(preset)}
                className={`px-3 py-1.5 rounded text-xs font-mono transition-all text-left flex items-center gap-2 border ${
                  isSelected
                    ? 'bg-amber-950/80 text-amber-300 border-amber-600/80 shadow'
                    : 'bg-[#111726] text-slate-300 border-[#1a2438] hover:border-slate-600 hover:bg-[#152037]'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span>{preset.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Parameter Levers: 4 Quantitative Columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Column 1: Sovereign Yield Curves & Spreads */}
        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#1a2438]">
            <span className="text-xs font-bold text-amber-400 font-mono uppercase">
              1. Sovereign Rates & Spreads
            </span>
            <span className="text-[11px] text-slate-500 font-mono">Bps Shocks</span>
          </div>

          {/* Lever 1: US Yield Curve */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="text-slate-300 font-medium">US Treasury Curve Shift</label>
              <span className="font-mono font-bold text-amber-400">
                {customParams.usYieldCurveShiftBps >= 0 ? `+${customParams.usYieldCurveShiftBps}` : customParams.usYieldCurveShiftBps} bps
              </span>
            </div>
            <input
              type="range"
              min="-200"
              max="600"
              step="10"
              value={customParams.usYieldCurveShiftBps}
              onChange={(e) => updateParam('usYieldCurveShiftBps', Number(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-[#1b263b] rounded"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>-200 bps (Dovish)</span>
              <span>+600 bps (Extreme)</span>
            </div>
          </div>

          {/* Lever 2: EM Sovereign Spreads */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="text-slate-300 font-medium">EM Sovereign Spread Widening</label>
              <span className="font-mono font-bold text-rose-400">
                +{customParams.sovereignSpreadWideningBps} bps
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1000"
              step="20"
              value={customParams.sovereignSpreadWideningBps}
              onChange={(e) => updateParam('sovereignSpreadWideningBps', Number(e.target.value))}
              className="w-full accent-rose-500 cursor-pointer h-1.5 bg-[#1b263b] rounded"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>0 bps</span>
              <span>+1,000 bps</span>
            </div>
          </div>

          {/* Lever 3: 2Y-10Y Curve Steepening */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="text-slate-300 font-medium">2Y-10Y Curve Slope / Steepening</label>
              <span className="font-mono font-bold text-cyan-400">
                {customParams.curveSteepeningBps >= 0 ? `+${customParams.curveSteepeningBps}` : customParams.curveSteepeningBps} bps
              </span>
            </div>
            <input
              type="range"
              min="-150"
              max="250"
              step="5"
              value={customParams.curveSteepeningBps}
              onChange={(e) => updateParam('curveSteepeningBps', Number(e.target.value))}
              className="w-full accent-cyan-500 cursor-pointer h-1.5 bg-[#1b263b] rounded"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>-150 bps (Inversion)</span>
              <span>+250 bps (Bear Steepener)</span>
            </div>
          </div>
        </div>

        {/* Column 2: Commodity Price Indices */}
        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#1a2438]">
            <span className="text-xs font-bold text-emerald-400 font-mono uppercase">
              2. Commodity Indices
            </span>
            <span className="text-[11px] text-slate-500 font-mono">% Shocks</span>
          </div>

          {/* Lever 1: Broad Commodities */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="text-slate-300 font-medium">Broad Commodity Basket Shock</label>
              <span className={`font-mono font-bold ${customParams.commodityPriceShockPercent < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {customParams.commodityPriceShockPercent >= 0 ? `+${customParams.commodityPriceShockPercent}%` : `${customParams.commodityPriceShockPercent}%`}
              </span>
            </div>
            <input
              type="range"
              min="-60"
              max="60"
              step="5"
              value={customParams.commodityPriceShockPercent}
              onChange={(e) => updateParam('commodityPriceShockPercent', Number(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-[#1b263b] rounded"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>-60% (Collapse)</span>
              <span>+60% (Super-Spike)</span>
            </div>
          </div>

          {/* Lever 2: Energy & Crude Oil */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="text-slate-300 font-medium">Brent Crude & Energy Shock</label>
              <span className={`font-mono font-bold ${customParams.energyOilShockPercent < 0 ? 'text-rose-400' : 'text-amber-400'}`}>
                {customParams.energyOilShockPercent >= 0 ? `+${customParams.energyOilShockPercent}%` : `${customParams.energyOilShockPercent}%`}
              </span>
            </div>
            <input
              type="range"
              min="-60"
              max="80"
              step="5"
              value={customParams.energyOilShockPercent}
              onChange={(e) => updateParam('energyOilShockPercent', Number(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-[#1b263b] rounded"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>-60%</span>
              <span>+80%</span>
            </div>
          </div>

          {/* Lever 3: Industrial Metals & Copper */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="text-slate-300 font-medium">Metals Terms-of-Trade (Copper)</label>
              <span className={`font-mono font-bold ${customParams.metalsTermsOfTradeShockPercent < 0 ? 'text-rose-400' : 'text-cyan-400'}`}>
                {customParams.metalsTermsOfTradeShockPercent >= 0 ? `+${customParams.metalsTermsOfTradeShockPercent}%` : `${customParams.metalsTermsOfTradeShockPercent}%`}
              </span>
            </div>
            <input
              type="range"
              min="-50"
              max="50"
              step="5"
              value={customParams.metalsTermsOfTradeShockPercent}
              onChange={(e) => updateParam('metalsTermsOfTradeShockPercent', Number(e.target.value))}
              className="w-full accent-cyan-500 cursor-pointer h-1.5 bg-[#1b263b] rounded"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>-50%</span>
              <span>+50%</span>
            </div>
          </div>
        </div>

        {/* Column 3: FX Volatility & Currency Dynamics */}
        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#1a2438]">
            <span className="text-xs font-bold text-cyan-400 font-mono uppercase">
              3. FX Dynamics & Volatility
            </span>
            <span className="text-[11px] text-slate-500 font-mono">Currency Levers</span>
          </div>

          {/* Lever 1: FX Vol Skew */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="text-slate-300 font-medium">FX Implied Vol Skew Jump</label>
              <span className="font-mono font-bold text-cyan-400">
                +{customParams.fxImpliedVolSkewJump}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="45"
              step="1"
              value={customParams.fxImpliedVolSkewJump}
              onChange={(e) => updateParam('fxImpliedVolSkewJump', Number(e.target.value))}
              className="w-full accent-cyan-500 cursor-pointer h-1.5 bg-[#1b263b] rounded"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>0% (Calm)</span>
              <span>+45% (Panic)</span>
            </div>
          </div>

          {/* Lever 2: Broad USD Rally */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="text-slate-300 font-medium">Broad USD DXY Appreciation</label>
              <span className="font-mono font-bold text-emerald-400">
                +{customParams.broadUsdAppreciation}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="30"
              step="1"
              value={customParams.broadUsdAppreciation}
              onChange={(e) => updateParam('broadUsdAppreciation', Number(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-[#1b263b] rounded"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>0%</span>
              <span>+30% (Dollar Squeeze)</span>
            </div>
          </div>

          {/* Lever 3: Reserve Drain */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="text-slate-300 font-medium">Pegged Reserve Depletion</label>
              <span className="font-mono font-bold text-rose-400">
                {customParams.reserveDrainPercent}%
              </span>
            </div>
            <input
              type="range"
              min="-50"
              max="0"
              step="2"
              value={customParams.reserveDrainPercent}
              onChange={(e) => updateParam('reserveDrainPercent', Number(e.target.value))}
              className="w-full accent-rose-500 cursor-pointer h-1.5 bg-[#1b263b] rounded"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>-50% (Reserve Crisis)</span>
              <span>0% (Stable)</span>
            </div>
          </div>
        </div>

        {/* Column 4: Geopolitical, AIS & Banking Nexus */}
        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#1a2438]">
            <span className="text-xs font-bold text-rose-400 font-mono uppercase">
              4. Chokepoint & Nexus
            </span>
            <span className="text-[11px] text-slate-500 font-mono">Contagion</span>
          </div>

          {/* Lever 1: Text Stress Index (TSI) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="text-slate-300 font-medium">Text Stress Index (TSI) Shock</label>
              <span className="font-mono font-bold text-rose-400">
                {customParams.textStressIndexShockSigma >= 0 ? `+${customParams.textStressIndexShockSigma.toFixed(1)}σ` : `${customParams.textStressIndexShockSigma.toFixed(1)}σ`}
              </span>
            </div>
            <input
              type="range"
              min="-2"
              max="6"
              step="0.2"
              value={customParams.textStressIndexShockSigma}
              onChange={(e) => updateParam('textStressIndexShockSigma', Number(e.target.value))}
              className="w-full accent-rose-500 cursor-pointer h-1.5 bg-[#1b263b] rounded"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>-2.0σ</span>
              <span>+6.0σ (War / Conflict)</span>
            </div>
          </div>

          {/* Lever 2: AIS Maritime Contraction */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="text-slate-300 font-medium">AIS Maritime Chokepoint Contraction</label>
              <span className="font-mono font-bold text-amber-400">
                {customParams.aisChokepointDisruptionPct}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="80"
              step="5"
              value={customParams.aisChokepointDisruptionPct}
              onChange={(e) => updateParam('aisChokepointDisruptionPct', Number(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-[#1b263b] rounded"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>0% (Fluid)</span>
              <span>80% (Blockade)</span>
            </div>
          </div>

          {/* Lever 3: Copula Correlation Shift */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="text-slate-300 font-medium">Banking Copula Shift (Δρ)</label>
              <span className="font-mono font-bold text-purple-400">
                +{customParams.crossBorderContagionRho.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="0.50"
              step="0.02"
              value={customParams.crossBorderContagionRho}
              onChange={(e) => updateParam('crossBorderContagionRho', Number(e.target.value))}
              className="w-full accent-purple-500 cursor-pointer h-1.5 bg-[#1b263b] rounded"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>+0.00 (Uncorrelated)</span>
              <span>+0.50 (Systemic Nexus)</span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Shock Visualizer: Yield Curve Shifts & Stress Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Yield Curve Shift Chart */}
        <div className="lg:col-span-2 p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-xs font-bold text-slate-100 font-mono uppercase">
                Simulated Sovereign Yield Curves & Term Structure Shift
              </h3>
              <p className="text-[11px] text-slate-400">
                Baseline vs Counterfactual US Treasury & Aggregate EM Sovereign Curve
              </p>
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              US Shift: <span className="text-amber-400 font-bold">{customParams.usYieldCurveShiftBps} bps</span> · EM Spreads:{' '}
              <span className="text-rose-400 font-bold">+{customParams.sovereignSpreadWideningBps} bps</span>
            </div>
          </div>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={yieldCurveData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a2438" />
                <XAxis dataKey="tenor" stroke="#64748b" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis
                  stroke="#64748b"
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  domain={['auto', 'auto']}
                  unit="%"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0a0f1d',
                    borderColor: '#23314d',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontFamily: 'monospace'
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
                <Line
                  type="monotone"
                  dataKey="Base UST 10Y"
                  stroke="#64748b"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="Stressed UST"
                  stroke="#f59e0b"
                  strokeWidth={2.5}
                  dot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="Base EM Curve"
                  stroke="#38bdf8"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="Stressed EM Curve"
                  stroke="#f43f5e"
                  strokeWidth={2.5}
                  dot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Aggregate Macro Stress Scorecard Card */}
        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col justify-between space-y-4">
          <div>
            <h3 className="text-xs font-bold text-slate-100 font-mono uppercase mb-2">
              Systemic Portfolio Stress KPI Impact
            </h3>
            <p className="text-[11px] text-slate-400 mb-4">
              Cross-sovereign transmission under current user-defined parameters
            </p>

            <div className="space-y-3 font-mono text-xs">
              <div className="p-2.5 bg-[#0a0f1d] border border-[#1a2438] rounded flex justify-between items-center">
                <span className="text-slate-400">Mean 99% VaR:</span>
                <div className="text-right">
                  <span className="text-slate-400 line-through mr-2">
                    {aggregateMetrics.avgBaseVaR.toFixed(1)}%
                  </span>
                  <span className="text-amber-400 font-bold">
                    {aggregateMetrics.avgCustomVaR.toFixed(1)}%
                  </span>
                  <span className="ml-1.5 text-rose-400 text-[10px]">
                    (+{aggregateMetrics.avgDeltaVaR.toFixed(1)}%)
                  </span>
                </div>
              </div>

              <div className="p-2.5 bg-[#0a0f1d] border border-[#1a2438] rounded flex justify-between items-center">
                <span className="text-slate-400">Max VaR Impact Sovereign:</span>
                <span className="text-rose-400 font-bold">
                  {aggregateMetrics.worstHit.sovereign.flag} {aggregateMetrics.worstHit.sovereign.code} (+
                  {aggregateMetrics.worstHit.deltaVaR.toFixed(1)}%)
                </span>
              </div>

              <div className="p-2.5 bg-[#0a0f1d] border border-[#1a2438] rounded space-y-1.5">
                <div className="flex justify-between text-slate-400">
                  <span>Regime Distribution:</span>
                  <span className="text-slate-200">
                    {aggregateMetrics.crisisCount} Crisis · {aggregateMetrics.stressedCount} Stressed ·{' '}
                    {aggregateMetrics.calmCount} Calm
                  </span>
                </div>
                <div className="w-full bg-[#1b263b] h-2 rounded-full overflow-hidden flex">
                  <div
                    style={{
                      width: `${(aggregateMetrics.crisisCount / sovereigns.length) * 100}%`
                    }}
                    className="bg-rose-500 h-full"
                    title="Crisis"
                  />
                  <div
                    style={{
                      width: `${(aggregateMetrics.stressedCount / sovereigns.length) * 100}%`
                    }}
                    className="bg-amber-500 h-full"
                    title="Stressed"
                  />
                  <div
                    style={{
                      width: `${(aggregateMetrics.calmCount / sovereigns.length) * 100}%`
                    }}
                    className="bg-emerald-500 h-full"
                    title="Calm"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-[#1a2438]">
            <button
              onClick={() => setActiveScenario('custom')}
              className="w-full py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono font-bold text-xs rounded transition-colors"
            >
              🚀 Simulate on Workstation Tabs
            </button>
          </div>
        </div>
      </div>

      {/* 5. Cross-Sovereign What-If Impact Table */}
      <div className="p-5 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-100">
              Cross-Sovereign What-If Transmission & Delta Metrics
            </h3>
            <p className="text-xs text-slate-400">
              Direct mathematical output comparing Baseline vs Custom Shock across all 10 sovereigns
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Filter country or code..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="bg-[#111726] border border-[#23314d] text-slate-200 text-xs rounded px-2.5 py-1 font-mono focus:outline-none focus:border-emerald-500"
            />
            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className="bg-[#111726] border border-[#23314d] text-slate-200 text-xs rounded px-2.5 py-1 font-mono focus:outline-none focus:border-emerald-500"
            >
              <option value="All">All Regions</option>
              <option value="Latin America">Latin America</option>
              <option value="Sub-Saharan Africa">Sub-Saharan Africa</option>
              <option value="South Asia">South Asia</option>
              <option value="Middle East / North Africa">MENA</option>
              <option value="Southeast Asia">Southeast Asia</option>
              <option value="Emerging Europe">Emerging Europe</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse font-mono">
            <thead>
              <tr className="border-b border-[#1a2438] bg-[#090d16] text-slate-400 text-[11px] uppercase">
                <th className="py-2.5 px-3">Sovereign Entity</th>
                <th className="py-2.5 px-3">FX Regime</th>
                <th className="py-2.5 px-3">Regime Shift</th>
                <th className="py-2.5 px-3 text-right">Base Hazard</th>
                <th className="py-2.5 px-3 text-right">Custom Hazard</th>
                <th className="py-2.5 px-3 text-right">Base 99% VaR</th>
                <th className="py-2.5 px-3 text-right">Custom 99% VaR</th>
                <th className="py-2.5 px-3 text-right">Δ VaR</th>
                <th className="py-2.5 px-3 text-right">Merton DD</th>
                <th className="py-2.5 px-3 text-center">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a2438]/60 text-[11px]">
              {filteredSovereigns.map((s) => {
                const base = baselineOutputs[s.id];
                const custom = customOutputs[s.id];
                const baseP = base ? base.calibratedPosteriorHazard * 100 : 0;
                const customP = custom ? custom.calibratedPosteriorHazard * 100 : 0;
                const baseVaR = base ? base.var99 : 0;
                const customVaR = custom ? custom.var99 : 0;
                const deltaVaR = customVaR - baseVaR;

                return (
                  <tr key={s.id} className="hover:bg-[#131d33] transition-colors">
                    <td className="py-2.5 px-3 font-sans font-medium text-slate-200">
                      <div className="flex items-center gap-2">
                        <span>{s.flag}</span>
                        <span>{s.name}</span>
                        <span className="text-slate-500 text-[10px]">({s.code})</span>
                      </div>
                    </td>

                    <td className="py-2.5 px-3 text-slate-400">{s.fxRegime}</td>

                    <td className="py-2.5 px-3">
                      <span className="text-slate-500">{base?.regime || 'Calm'}</span>
                      <span className="text-slate-600 mx-1">→</span>
                      <span
                        className={`font-semibold ${
                          custom?.regime === 'Crisis'
                            ? 'text-rose-400'
                            : custom?.regime === 'Stressed'
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {custom?.regime}
                      </span>
                    </td>

                    <td className="py-2.5 px-3 text-right text-slate-400">{baseP.toFixed(1)}%</td>

                    <td className="py-2.5 px-3 text-right font-bold text-slate-100">
                      {customP.toFixed(1)}%
                    </td>

                    <td className="py-2.5 px-3 text-right text-slate-400">{baseVaR.toFixed(1)}%</td>

                    <td className="py-2.5 px-3 text-right font-bold text-amber-300">
                      {customVaR.toFixed(1)}%
                    </td>

                    <td className="py-2.5 px-3 text-right font-bold">
                      <span className={deltaVaR > 0 ? 'text-rose-400' : 'text-emerald-400'}>
                        {deltaVaR > 0 ? `+${deltaVaR.toFixed(1)}%` : `${deltaVaR.toFixed(1)}%`}
                      </span>
                    </td>

                    <td className="py-2.5 px-3 text-right text-slate-300">
                      {custom?.distanceToDistress.toFixed(2)}σ
                    </td>

                    <td className="py-2.5 px-3 text-center font-sans">
                      <button
                        onClick={() => {
                          onSelectSovereign(s.id);
                          onNavigateToTab('pipeline');
                        }}
                        className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
                      >
                        Pipeline →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Save Scenario Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#0e1524] border border-[#23314d] rounded-lg max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-sm font-bold text-slate-100 font-mono uppercase mb-2">
              Save Custom Macro Scenario
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Store current yield curve shifts, commodity shocks, and FX parameters in your institutional scenario
              library.
            </p>

            <form onSubmit={handleSaveScenario} className="space-y-4 text-xs font-mono">
              <div>
                <label className="block text-slate-300 mb-1">Scenario Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 2026 Middle East Oil Squeeze + Fed Hike"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  className="w-full bg-[#111726] border border-[#23314d] text-slate-100 rounded px-3 py-2 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">Description / Macro Hypothesis</label>
                <textarea
                  rows={3}
                  placeholder="Summarize the core macro transmission assumptions..."
                  value={saveDesc}
                  onChange={(e) => setSaveDesc(e.target.value)}
                  className="w-full bg-[#111726] border border-[#23314d] text-slate-100 rounded px-3 py-2 focus:outline-none focus:border-emerald-500 resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSaveModal(false)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded"
                >
                  Save Scenario
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
