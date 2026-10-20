import React, { useState } from 'react';
import { SovereignEntity, LayerOutputs, MacroScenario, CustomScenarioParams } from '../types/riskEngine';
import { runRiskPipeline } from '../math/riskCalculations';
import { CustomMacroScenarioBuilder } from './CustomMacroScenarioBuilder';

interface StressTestingLabProps {
  sovereigns: SovereignEntity[];
  baselineOutputs: Record<string, LayerOutputs>;
  activeScenario: MacroScenario;
  setActiveScenario: (scenario: MacroScenario) => void;
  customParams: CustomScenarioParams;
  setCustomParams: (params: CustomScenarioParams) => void;
  onSelectSovereign: (id: string) => void;
  onNavigateToTab: (tab: string) => void;
}

export const StressTestingLab: React.FC<StressTestingLabProps> = ({
  sovereigns,
  baselineOutputs,
  activeScenario,
  setActiveScenario,
  customParams,
  setCustomParams,
  onSelectSovereign,
  onNavigateToTab
}) => {
  const [subTab, setSubTab] = useState<'custom' | 'presets'>(
    activeScenario === 'custom' ? 'custom' : 'custom'
  );

  // Compute comparison under active scenario
  const scenarioOutputs: Record<string, LayerOutputs> = {};
  sovereigns.forEach((s) => {
    scenarioOutputs[s.id] = runRiskPipeline(s, activeScenario, true, 0.4, customParams);
  });

  return (
    <div className="space-y-6">
      {/* Top Mode Navigation Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1a2438] pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSubTab('custom')}
            className={`px-4 py-2 text-xs font-mono font-semibold rounded-t border-b-2 flex items-center gap-2 transition-all ${
              subTab === 'custom'
                ? 'text-emerald-400 border-emerald-400 bg-[#0e1524]'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            <span>⚡ Custom Macro Scenario Builder</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
              Interactive What-If
            </span>
          </button>

          <button
            onClick={() => setSubTab('presets')}
            className={`px-4 py-2 text-xs font-mono font-semibold rounded-t border-b-2 flex items-center gap-2 transition-all ${
              subTab === 'presets'
                ? 'text-amber-400 border-amber-400 bg-[#0e1524]'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            <span>Pre-Set Benchmark Scenarios</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800">
              Scenarios A / B / C
            </span>
          </button>
        </div>

        {/* Global Active Scenario Badge */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-slate-500">Active Workstation State:</span>
          <span
            className={`px-2.5 py-1 rounded font-bold border ${
              activeScenario === 'custom'
                ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                : activeScenario === 'baseline'
                ? 'bg-slate-900 text-slate-300 border-slate-700'
                : 'bg-amber-950 text-amber-300 border-amber-700'
            }`}
          >
            {activeScenario === 'custom'
              ? `⚡ Custom: ${customParams.name}`
              : activeScenario === 'scenarioA_fedTightening'
              ? 'Scenario A (+200bps Fed)'
              : activeScenario === 'scenarioB_commodityCollapse'
              ? 'Scenario B (-30% Commodity)'
              : activeScenario === 'scenarioC_malaccaBlockade'
              ? 'Scenario C (Malacca Blockade)'
              : 'Baseline (Calm)'}
          </span>
        </div>
      </div>

      {/* Render Custom Macro Scenario Builder */}
      {subTab === 'custom' && (
        <CustomMacroScenarioBuilder
          sovereigns={sovereigns}
          baselineOutputs={baselineOutputs}
          activeScenario={activeScenario}
          setActiveScenario={setActiveScenario}
          customParams={customParams}
          setCustomParams={setCustomParams}
          onSelectSovereign={onSelectSovereign}
          onNavigateToTab={onNavigateToTab}
        />
      )}

      {/* Render Preset Benchmark Scenarios */}
      {subTab === 'presets' && (
        <div className="space-y-6">
          {/* Executive Stress Lab Header */}
          <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
            <h2 className="text-lg font-bold text-slate-100">
              Macro-Financial Reflexivity & Counterfactual Stress-Testing Lab
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Section 9: Simulates endogenous reflexivity feedback loops where credit spread widening, capital flight,
              and systemic banking nexus distress amplify sovereign tail risk under severe global macro shocks.
            </p>
          </div>

          {/* 4 Scenario Cards (3 Presets + Custom Builder Card) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Scenario A */}
            <div
              onClick={() => setActiveScenario('scenarioA_fedTightening')}
              className={`p-4 rounded-lg border cursor-pointer transition-all ${
                activeScenario === 'scenarioA_fedTightening'
                  ? 'bg-[#152037] border-amber-500 shadow-md ring-1 ring-amber-500/30'
                  : 'bg-[#0e1524] border-[#1a2438] hover:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800">
                  Scenario A
                </span>
                {activeScenario === 'scenarioA_fedTightening' && (
                  <span className="text-[11px] font-mono text-amber-400 font-semibold">ACTIVE</span>
                )}
              </div>
              <h3 className="text-sm font-bold text-slate-100 mt-2">
                +200 bps Hawkish Federal Reserve Tightening Shock
              </h3>
              <p className="text-xs text-slate-400 mt-2 line-clamp-3">
                Abrupt 200 bps upward shift in US Fed Funds rate triggers emerging market capital flight. High-yield
                spreads widen +280 bps, FX currencies depreciate 12–18%.
              </p>
              <div className="mt-3 pt-3 border-t border-[#1a2438] text-[11px] font-mono text-amber-300 space-y-1">
                <div>• Layer 1: FX debt weights × 1.4</div>
                <div>• Layer 3: 32% shift to Crisis state</div>
                <div>• Layer 5: Banking correlation Δρ = +0.25</div>
              </div>
            </div>

            {/* Scenario B */}
            <div
              onClick={() => setActiveScenario('scenarioB_commodityCollapse')}
              className={`p-4 rounded-lg border cursor-pointer transition-all ${
                activeScenario === 'scenarioB_commodityCollapse'
                  ? 'bg-[#152037] border-rose-500 shadow-md ring-1 ring-rose-500/30'
                  : 'bg-[#0e1524] border-[#1a2438] hover:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800">
                  Scenario B
                </span>
                {activeScenario === 'scenarioB_commodityCollapse' && (
                  <span className="text-[11px] font-mono text-rose-400 font-semibold">ACTIVE</span>
                )}
              </div>
              <h3 className="text-sm font-bold text-slate-100 mt-2">
                -30% Global Commodity & Industrial Metals Collapse
              </h3>
              <p className="text-xs text-slate-400 mt-2 line-clamp-3">
                30% plunge in energy and metal benchmarks impairs export receipts. Fiscal deficits widen 3.5–5.0% of GDP,
                eroding central bank reserves.
              </p>
              <div className="mt-3 pt-3 border-t border-[#1a2438] text-[11px] font-mono text-rose-300 space-y-1">
                <div>• Pillars 2 & 5: +18 pts for mono-exporters</div>
                <div>• Layer 4: Merton DD shrinks 1.8σ</div>
                <div>• Merton LGD rises from 40% to 58%</div>
              </div>
            </div>

            {/* Scenario C */}
            <div
              onClick={() => setActiveScenario('scenarioC_malaccaBlockade')}
              className={`p-4 rounded-lg border cursor-pointer transition-all ${
                activeScenario === 'scenarioC_malaccaBlockade'
                  ? 'bg-[#152037] border-cyan-500 shadow-md ring-1 ring-cyan-500/30'
                  : 'bg-[#0e1524] border-[#1a2438] hover:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
                  Scenario C
                </span>
                {activeScenario === 'scenarioC_malaccaBlockade' && (
                  <span className="text-[11px] font-mono text-cyan-400 font-semibold">ACTIVE</span>
                )}
              </div>
              <h3 className="text-sm font-bold text-slate-100 mt-2">
                Strait of Malacca Naval Geopolitical Blockade
              </h3>
              <p className="text-xs text-slate-400 mt-2 line-clamp-3">
                21-day naval closure disrupting 25% of global maritime trade and 33% of crude oil transport. Global
                freight rates surge +350%.
              </p>
              <div className="mt-3 pt-3 border-t border-[#1a2438] text-[11px] font-mono text-cyan-300 space-y-1">
                <div>• Spatial Violence Multiplier: 2.0x</div>
                <div>• Text Stress Index (TSI) &gt; +3.5σ</div>
                <div>• L-VaR liquidation costs +24.6%</div>
              </div>
            </div>

            {/* Card 4: Custom Scenario Builder Direct Trigger */}
            <div
              onClick={() => {
                setActiveScenario('custom');
                setSubTab('custom');
              }}
              className={`p-4 rounded-lg border cursor-pointer transition-all ${
                activeScenario === 'custom'
                  ? 'bg-[#152037] border-emerald-500 shadow-md ring-1 ring-emerald-500/30'
                  : 'bg-[#0e1524] border-[#1a2438] hover:border-emerald-600/60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                  Custom What-If
                </span>
                {activeScenario === 'custom' && (
                  <span className="text-[11px] font-mono text-emerald-400 font-semibold">ACTIVE</span>
                )}
              </div>
              <h3 className="text-sm font-bold text-slate-100 mt-2">
                ⚡ Custom Macro Scenario Builder
              </h3>
              <p className="text-xs text-slate-400 mt-2 line-clamp-3">
                User-calibrated multidimensional what-if shocks: calibrate yield curves, commodity baskets, FX vol,
                and chokepoints with live slider feedback.
              </p>
              <div className="mt-3 pt-3 border-t border-[#1a2438] text-[11px] font-mono text-emerald-300 space-y-1">
                <div>• Yield Curve Shift: {customParams.usYieldCurveShiftBps} bps</div>
                <div>• Spreads: +{customParams.sovereignSpreadWideningBps} bps</div>
                <div className="text-emerald-400 font-bold">Open Scenario Builder →</div>
              </div>
            </div>
          </div>

          {/* Reset to Baseline Button */}
          {activeScenario !== 'baseline' && (
            <div className="flex justify-end">
              <button
                onClick={() => setActiveScenario('baseline')}
                className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-[#111726] hover:bg-[#152037] border border-[#23314d] rounded transition-colors"
              >
                ← Reset to Baseline Market State
              </button>
            </div>
          )}

          {/* Counterfactual Shock Impact Grid */}
          <div className="p-5 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-100">
                Cross-Sovereign Tail Shock Impact Analysis (Baseline vs Active Scenario)
              </h3>
              <span className="text-xs font-mono text-slate-400">
                {activeScenario === 'baseline' ? 'Viewing Baseline' : `Simulating: ${activeScenario}`}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse font-mono">
                <thead>
                  <tr className="border-b border-[#1a2438] bg-[#090d16] text-slate-400 text-[11px] uppercase">
                    <th className="py-2.5 px-3">Sovereign Entity</th>
                    <th className="py-2.5 px-3">Regime Shift</th>
                    <th className="py-2.5 px-3 text-right">Baseline Hazard</th>
                    <th className="py-2.5 px-3 text-right">Shocked Hazard</th>
                    <th className="py-2.5 px-3 text-right">Δ Hazard</th>
                    <th className="py-2.5 px-3 text-right">Shocked 99% VaR</th>
                    <th className="py-2.5 px-3 text-right">Shocked FRTB ES</th>
                    <th className="py-2.5 px-3 text-center">Inspect</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1a2438]/60 text-[11px]">
                  {sovereigns.map((s) => {
                    const base = baselineOutputs[s.id];
                    const shocked = scenarioOutputs[s.id];
                    const baseP = base ? base.calibratedPosteriorHazard * 100 : 0;
                    const shockP = shocked ? shocked.calibratedPosteriorHazard * 100 : 0;
                    const deltaP = shockP - baseP;

                    return (
                      <tr key={s.id} className="hover:bg-[#131d33] transition-colors">
                        <td className="py-2.5 px-3 font-sans font-medium text-slate-200">
                          <div className="flex items-center gap-2">
                            <span>{s.flag}</span>
                            <span>{s.name}</span>
                            <span className="text-slate-500 text-[10px]">({s.code})</span>
                          </div>
                        </td>

                        <td className="py-2.5 px-3">
                          <span className="text-slate-400">{base?.regime || 'Calm'}</span>
                          <span className="text-slate-600 mx-1">→</span>
                          <span
                            className={`font-semibold ${
                              shocked?.regime === 'Crisis'
                                ? 'text-rose-400'
                                : shocked?.regime === 'Stressed'
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                            }`}
                          >
                            {shocked?.regime}
                          </span>
                        </td>

                        <td className="py-2.5 px-3 text-right text-slate-400">{baseP.toFixed(1)}%</td>

                        <td className="py-2.5 px-3 text-right font-bold text-slate-100">
                          {shockP.toFixed(1)}%
                        </td>

                        <td className="py-2.5 px-3 text-right font-bold">
                          <span className={deltaP > 0 ? 'text-rose-400' : 'text-slate-400'}>
                            {deltaP > 0 ? `+${deltaP.toFixed(1)}%` : `${deltaP.toFixed(1)}%`}
                          </span>
                        </td>

                        <td className="py-2.5 px-3 text-right text-amber-400">
                          {shocked?.var99.toFixed(1)}%
                        </td>

                        <td className="py-2.5 px-3 text-right text-rose-400 font-bold">
                          {shocked?.es975.toFixed(1)}%
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
        </div>
      )}
    </div>
  );
};
