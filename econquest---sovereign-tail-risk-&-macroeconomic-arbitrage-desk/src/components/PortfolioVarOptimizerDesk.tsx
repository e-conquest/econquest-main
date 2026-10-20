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
  MacroScenario,
  CustomScenarioParams
} from '../types/riskEngine';
import {
  PortfolioPosition,
  PRESET_INSTITUTIONAL_BOOKS,
  computePortfolioRiskAttribution,
  optimizePortfolioCdsHedges
} from '../math/institutionalMacroAnalytics';

interface PortfolioVarOptimizerDeskProps {
  sovereigns: SovereignEntity[];
  pipelineOutputs: Record<string, LayerOutputs>;
  selectedSovereignId: string;
  onSelectSovereign: (id: string) => void;
  activeScenario: MacroScenario;
  customParams?: CustomScenarioParams;
  onOpenTearSheetModal: () => void;
}

export const PortfolioVarOptimizerDesk: React.FC<PortfolioVarOptimizerDeskProps> = ({
  sovereigns,
  pipelineOutputs,
  selectedSovereignId,
  onSelectSovereign,
  activeScenario,
  customParams,
  onOpenTearSheetModal
}) => {
  const [activePresetKey, setActivePresetKey] = useState<string>('em_distressed_alpha');
  const [positions, setPositions] = useState<PortfolioPosition[]>(
    PRESET_INSTITUTIONAL_BOOKS.em_distressed_alpha.positions
  );
  const [hedgeBudgetSharePct, setHedgeBudgetSharePct] = useState<number>(35);

  const handleLoadPreset = (key: string) => {
    setActivePresetKey(key);
    const preset = PRESET_INSTITUTIONAL_BOOKS[key];
    if (preset) {
      setPositions(preset.positions.map((p) => ({ ...p })));
    }
  };

  const handleUpdateNotional = (sovereignId: string, notionalUsdMillions: number) => {
    setPositions((prev) => {
      const exists = prev.some((p) => p.sovereignId === sovereignId);
      if (exists) {
        return prev.map((p) =>
          p.sovereignId === sovereignId ? { ...p, notionalUsdMillions } : p
        );
      }
      return [
        ...prev,
        {
          sovereignId,
          notionalUsdMillions,
          instrument: '5Y USD Eurobond',
          cdsHedgeRatioPct: 20
        }
      ];
    });
  };

  const handleUpdateHedgeRatio = (sovereignId: string, cdsHedgeRatioPct: number) => {
    setPositions((prev) =>
      prev.map((p) =>
        p.sovereignId === sovereignId ? { ...p, cdsHedgeRatioPct } : p
      )
    );
  };

  const handleUpdateInstrument = (
    sovereignId: string,
    instrument: PortfolioPosition['instrument']
  ) => {
    setPositions((prev) =>
      prev.map((p) =>
        p.sovereignId === sovereignId ? { ...p, instrument } : p
      )
    );
  };

  const handleAutoOptimizeHedges = () => {
    const optimized = optimizePortfolioCdsHedges(
      positions,
      sovereigns,
      pipelineOutputs,
      hedgeBudgetSharePct
    );
    setPositions(optimized);
  };

  const handleAddSovereignToBook = (sovereignId: string) => {
    if (positions.some((p) => p.sovereignId === sovereignId && p.notionalUsdMillions > 0)) {
      return;
    }
    handleUpdateNotional(sovereignId, 25);
  };

  const portfolioSummary = useMemo(
    () =>
      computePortfolioRiskAttribution(
        positions,
        sovereigns,
        pipelineOutputs,
        activeScenario,
        customParams
      ),
    [positions, sovereigns, pipelineOutputs, activeScenario, customParams]
  );

  const unallocatedSovereigns = useMemo(
    () =>
      sovereigns.filter(
        (s) => !positions.some((p) => p.sovereignId === s.id && p.notionalUsdMillions > 0)
      ),
    [sovereigns, positions]
  );

  return (
    <div className="space-y-6">
      {/* Header & Institutional Mandate Selector */}
      <div className="p-5 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-3 border-b border-[#1a2438]">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
              <span>Multi-Sovereign Portfolio Risk & Hedging Desk</span>
              <span aria-hidden="true">·</span>
              <span>Euler Homogeneous Component VaR</span>
              <span aria-hidden="true">·</span>
              <span>Student-t Copula Tail Attribution</span>
            </div>
            <h2 className="text-lg font-bold text-slate-100 tracking-tight">
              Multi-Sovereign Bond Book, Component VaR Decomposition & CDS Hedge Optimizer
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleAutoOptimizeHedges}
              className="px-3.5 py-1.5 text-xs font-semibold text-emerald-300 bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-600/60 rounded transition-colors whitespace-nowrap shrink-0"
            >
              ⚡ Optimize CDS Hedge Overlay
            </button>

            <button
              onClick={onOpenTearSheetModal}
              className="px-3.5 py-1.5 text-xs font-semibold text-cyan-300 bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-700/60 rounded transition-colors whitespace-nowrap shrink-0"
            >
              📄 Export IC Risk Tear-Sheet
            </button>
          </div>
        </div>

        {/* Preset Institutional Mandates & Carry Budget Slider */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
          <div className="lg:col-span-8 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400 mr-1">Institutional Mandate:</span>
            {Object.entries(PRESET_INSTITUTIONAL_BOOKS).map(([key, book]) => (
              <button
                key={key}
                onClick={() => handleLoadPreset(key)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 border ${
                  activePresetKey === key
                    ? 'bg-[#16233d] border-emerald-500/60 text-emerald-300'
                    : 'bg-[#090d16] border-[#1e2c46] text-slate-300 hover:text-slate-100'
                }`}
              >
                {book.name}
              </button>
            ))}
          </div>

          <div className="lg:col-span-4 bg-[#090d16] p-3 rounded border border-[#1a2438]">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">Target CDS Hedge Carry Budget</span>
              <span className="font-mono font-bold text-emerald-400 tabular-nums">
                {hedgeBudgetSharePct}% of Gross Carry
              </span>
            </div>
            <input
              type="range"
              min={10}
              max={75}
              step={5}
              value={hedgeBudgetSharePct}
              onChange={(e) => setHedgeBudgetSharePct(Number(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* 4-Column Portfolio VaR & Carry KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">
            Total Sovereign Book Notional
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-slate-100">
              ${portfolioSummary.totalNotionalUsdM}M
            </span>
            <span className="text-xs text-slate-400">
              ({portfolioSummary.attributions.length} active lines)
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
            Diversification Benefit: -${portfolioSummary.diversificationBenefitUsdM}M (-{portfolioSummary.diversificationBenefitPct}%)
          </div>
        </div>

        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">
            Net Post-Hedge 99% L-VaR (1Y)
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-emerald-400">
              ${portfolioSummary.netPostHedgeVarUsdM}M
            </span>
            <span className="text-xs text-slate-400">
              ({portfolioSummary.netPostHedgeVarPct}% of book)
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
            Pre-Hedge Copula VaR: ${portfolioSummary.diversifiedPreHedgeVarUsdM}M
          </div>
        </div>

        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">
            FRTB Expected Shortfall (97.5% ES)
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-rose-400">
              ${portfolioSummary.netPostHedgeEs975UsdM}M
            </span>
            <span className="text-xs text-slate-400">tail conditional loss</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
            Undiversified Standalone Sum: ${portfolioSummary.undiversifiedVarUsdM}M
          </div>
        </div>

        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">
            Net Annual Portfolio Carry (Post-CDS)
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-cyan-400">
              +${portfolioSummary.netAnnualCarryUsdM}M
            </span>
            <span className="text-xs text-slate-400">
              RoVaR: {portfolioSummary.returnOnVarRatio}x
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
            Gross Yield: +${portfolioSummary.grossAnnualCarryUsdM}M · CDS Cost: -${portfolioSummary.totalCdsHedgeCostUsdM}M
          </div>
        </div>
      </div>

      {/* Component VaR Visual Chart + Position Allocation Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left 5 Cols: Pre-Hedge vs Post-Hedge Component VaR Decomposition */}
        <div className="lg:col-span-5 p-5 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col justify-between">
          <div>
            <div className="mb-3 pb-3 border-b border-[#1a2438]">
              <h3 className="text-sm font-bold text-slate-100">
                01. Euler Component VaR Attribution ($M)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Pre-Hedge Component VaR vs. Net Post-CDS Protection VaR by sovereign line
              </p>
            </div>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={portfolioSummary.attributions}
                  margin={{ top: 10, right: 12, left: 0, bottom: 5 }}
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
                    tickFormatter={(v) => `$${v}M`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#090e1a',
                      borderColor: '#233352',
                      fontSize: '12px',
                      fontFamily: 'monospace'
                    }}
                    formatter={(val: any, name: any) => [`$${Number(val).toFixed(2)}M`, String(name)]}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Bar
                    dataKey="componentVarUsdM"
                    name="Pre-Hedge Component VaR ($M)"
                    fill="#f43f5e"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="netPostHedgeVarUsdM"
                    name="Net Post-CDS Hedge VaR ($M)"
                    fill="#10b981"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-[#1a2438] flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span>Add Unallocated Sovereign to Book:</span>
            <div className="flex flex-wrap gap-1.5">
              {unallocatedSovereigns.map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleAddSovereignToBook(s.id)}
                  className="px-2 py-0.5 bg-[#090d16] hover:bg-[#16223a] border border-[#23314d] rounded text-[11px] font-mono text-slate-300"
                >
                  + {s.flag} {s.code}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right 7 Cols: Interactive Position Sizing & CDS Hedge Sliders */}
        <div className="lg:col-span-7 p-5 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col justify-between">
          <div>
            <div className="mb-3 pb-3 border-b border-[#1a2438] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-100">
                  02. Interactive Sovereign Book & CDS Hedge Controls
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Adjust notional allocation ($M), instrument tenor, and 5Y CDS protection overlay (%)
                </p>
              </div>
            </div>

            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {portfolioSummary.attributions.map((attr) => (
                <div
                  key={attr.sovereignId}
                  className="p-3 bg-[#090d16] border border-[#1a2438] rounded-lg grid grid-cols-1 sm:grid-cols-12 gap-3 items-center"
                >
                  <div className="sm:col-span-4">
                    <div className="flex items-center gap-2">
                      <span>{attr.flag}</span>
                      <span className="font-semibold text-xs text-slate-100">
                        {attr.name}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {attr.code}
                      </span>
                    </div>
                    <select
                      value={attr.instrument}
                      onChange={(e) =>
                        handleUpdateInstrument(
                          attr.sovereignId,
                          e.target.value as PortfolioPosition['instrument']
                        )
                      }
                      className="mt-1 bg-[#111726] border border-[#23314d] text-[11px] text-slate-300 rounded px-2 py-0.5 font-mono focus:outline-none"
                    >
                      <option value="5Y USD Eurobond">5Y USD Eurobond</option>
                      <option value="10Y USD Eurobond">10Y USD Eurobond</option>
                      <option value="Local Currency Sovereign">Local Currency Bond</option>
                    </select>
                  </div>

                  <div className="sm:col-span-4">
                    <div className="flex justify-between text-[11px] mb-1 font-mono tabular-nums">
                      <span className="text-slate-400">Notional:</span>
                      <span className="text-slate-100 font-bold">
                        ${attr.notionalUsdMillions}M ({attr.weightPct}%)
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={200}
                      step={5}
                      value={attr.notionalUsdMillions}
                      onChange={(e) =>
                        handleUpdateNotional(attr.sovereignId, Number(e.target.value))
                      }
                      className="w-full accent-cyan-400 cursor-pointer"
                    />
                  </div>

                  <div className="sm:col-span-4">
                    <div className="flex justify-between text-[11px] mb-1 font-mono tabular-nums">
                      <span className="text-slate-400">5Y CDS Hedge:</span>
                      <span className="text-emerald-400 font-bold">
                        {attr.cdsHedgeRatioPct}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={attr.cdsHedgeRatioPct}
                      onChange={(e) =>
                        handleUpdateHedgeRatio(attr.sovereignId, Number(e.target.value))
                      }
                      className="w-full accent-emerald-400 cursor-pointer"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-[#1a2438] flex items-center justify-between text-xs text-slate-400 font-mono tabular-nums">
            <span>Hedge Effectiveness Assumption: 86% (14% CDS-Bond Basis Risk)</span>
            <span className="text-cyan-400">Euler Sum = 100.0% of Net VaR</span>
          </div>
        </div>
      </div>

      {/* Detailed Position Risk Attribution Ledger */}
      <div className="bg-[#0e1524] border border-[#1a2438] rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#1a2438] flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-100">
              03. Position-Level Marginal & Component VaR Attribution Ledger
            </h3>
            <p className="text-xs text-slate-400">
              Full risk budget decomposition across notional weights, standalone L-VaR, Euler Component VaR, and net carry
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#1a2438] bg-[#090d16] text-slate-400 font-mono text-[11px] uppercase">
                <th className="py-2.5 px-4">Sovereign Line</th>
                <th className="py-2.5 px-3">Instrument</th>
                <th className="py-2.5 px-3 text-right">Notional ($M)</th>
                <th className="py-2.5 px-3 text-right">Weight</th>
                <th className="py-2.5 px-3 text-right">CDS Hedge</th>
                <th className="py-2.5 px-3 text-right">Pre-Hedge Comp VaR</th>
                <th className="py-2.5 px-3 text-right">Net Post-Hedge VaR</th>
                <th className="py-2.5 px-3 text-right">Risk Share</th>
                <th className="py-2.5 px-4 text-right">Net Carry ($M/yr)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a2438]/70 font-mono tabular-nums">
              {portfolioSummary.attributions.map((attr) => (
                <tr
                  key={attr.sovereignId}
                  onClick={() => onSelectSovereign(attr.sovereignId)}
                  className={`cursor-pointer transition-colors ${
                    attr.sovereignId === selectedSovereignId
                      ? 'bg-[#15223c]'
                      : 'hover:bg-[#121c31]'
                  }`}
                >
                  <td className="py-2.5 px-4 font-sans">
                    <div className="flex items-center gap-2">
                      <span>{attr.flag}</span>
                      <span className="font-semibold text-slate-100">{attr.name}</span>
                      <span className="text-[11px] font-mono text-slate-400">
                        {attr.code}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-slate-300">{attr.instrument}</td>
                  <td className="py-2.5 px-3 text-right text-slate-100 font-semibold">
                    ${attr.notionalUsdMillions.toFixed(1)}M
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-300">
                    {attr.weightPct.toFixed(1)}%
                  </td>
                  <td className="py-2.5 px-3 text-right text-emerald-400">
                    {attr.cdsHedgeRatioPct}%
                  </td>
                  <td className="py-2.5 px-3 text-right text-rose-400">
                    ${attr.componentVarUsdM.toFixed(2)}M
                  </td>
                  <td className="py-2.5 px-3 text-right font-bold text-emerald-400">
                    ${attr.netPostHedgeVarUsdM.toFixed(2)}M
                  </td>
                  <td className="py-2.5 px-3 text-right text-amber-300">
                    {attr.componentSharePct.toFixed(1)}%
                  </td>
                  <td className="py-2.5 px-4 text-right text-cyan-400 font-semibold">
                    +${attr.netCarryUsdM.toFixed(2)}M
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
