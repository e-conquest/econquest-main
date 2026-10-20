import React from 'react';
import { getNavItemById, getClusterByItemId } from '../data/navigationStructure';
import { SovereignEntity, MacroScenario, GuiLayoutTemplate } from '../types/riskEngine';

interface DeskContextBarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  sovereigns: SovereignEntity[];
  selectedSovereignId: string;
  onSelectSovereign: (id: string) => void;
  activeScenario: MacroScenario;
  activeLayout: GuiLayoutTemplate;
  onSelectLayout: (layout: GuiLayoutTemplate) => void;
  onOpenTearSheetModal?: () => void;
}

export const DeskContextBar: React.FC<DeskContextBarProps> = ({
  activeTab,
  setActiveTab,
  sovereigns,
  selectedSovereignId,
  onSelectSovereign,
  activeScenario,
  activeLayout,
  onSelectLayout,
  onOpenTearSheetModal
}) => {
  const currentItem = getNavItemById(activeTab);
  const currentCluster = getClusterByItemId(activeTab);

  return (
    <div className="mb-5 pb-3 border-b border-[#1a2438] flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
      {/* Left: Breadcrumbs & Desk Subtitle */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-slate-500 font-mono">{currentCluster.name}</span>
        <span className="text-slate-600">/</span>
        <div className="flex items-center gap-2">
          <span className="text-base">{currentItem.icon}</span>
          <span className="font-bold text-slate-100 font-sans text-sm">{currentItem.name}</span>
        </div>
        <span className="text-slate-600">·</span>
        <span className="text-slate-400 font-mono text-[11px] hidden sm:inline">
          {currentItem.subtitle}
        </span>
      </div>

      {/* Right: Active Sovereign Context, IC Tear-Sheet Export & GUI Template Quick Toggle */}
      <div className="flex flex-wrap items-center gap-2.5 font-mono text-xs">
        {onOpenTearSheetModal && (
          <button
            onClick={onOpenTearSheetModal}
            className="px-2.5 py-1 bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-700/60 text-emerald-300 rounded text-[11px] font-sans font-semibold transition-colors whitespace-nowrap shrink-0"
            title="Open Investment Committee Risk Tear-Sheet & JSON/CSV Snapshot Exporter"
          >
            📄 IC Tear-Sheet Export
          </button>
        )}

        {/* Active Sovereign Selector */}
        <div className="flex items-center gap-1.5 bg-[#0e1626] border border-[#1e2e4a] rounded px-2.5 py-1">
          <span className="text-slate-500 text-[10px]">SOVEREIGN:</span>
          <select
            value={selectedSovereignId}
            onChange={(e) => onSelectSovereign(e.target.value)}
            className="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer font-bold"
          >
            {sovereigns.map((s) => (
              <option key={s.id} value={s.id} className="bg-[#0e1526] text-slate-100">
                {s.flag} {s.code} · {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* GUI Layout Segmented Buttons */}
        <div className="flex items-center gap-0.5 bg-[#0e1626] border border-[#1e2e4a] rounded p-0.5">
          <button
            onClick={() => onSelectLayout('topbar')}
            className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
              activeLayout === 'topbar'
                ? 'bg-[#1b2842] text-cyan-400 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Institutional Topbar Layout"
          >
            Topbar
          </button>
          <button
            onClick={() => onSelectLayout('sidebar')}
            className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
              activeLayout === 'sidebar'
                ? 'bg-[#1b2842] text-cyan-400 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Executive Left Rail Sidebar Layout"
          >
            Sidebar
          </button>
          <button
            onClick={() => onSelectLayout('dual_pane')}
            className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
              activeLayout === 'dual_pane'
                ? 'bg-[#1b2842] text-cyan-400 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Dual-Desk Split Workspace View"
          >
            Dual View
          </button>
        </div>
      </div>
    </div>
  );
};
