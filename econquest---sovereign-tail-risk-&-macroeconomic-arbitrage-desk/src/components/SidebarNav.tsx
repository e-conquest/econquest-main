import React, { useState } from 'react';
import { WORKSPACE_CLUSTERS, NavDeskItem } from '../data/navigationStructure';
import { SovereignEntity, MacroScenario, GuiLayoutTemplate } from '../types/riskEngine';

interface SidebarNavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  sovereigns: SovereignEntity[];
  selectedSovereignId: string;
  onSelectSovereign: (id: string) => void;
  activeScenario: MacroScenario;
  setActiveScenario: (scenario: MacroScenario) => void;
  arbitrageCount: number;
  activeLayout: GuiLayoutTemplate;
  onOpenTemplateModal: () => void;
  onOpenCommandPalette: () => void;
}

export const SidebarNav: React.FC<SidebarNavProps> = ({
  activeTab,
  setActiveTab,
  sovereigns,
  selectedSovereignId,
  onSelectSovereign,
  activeScenario,
  setActiveScenario,
  arbitrageCount,
  activeLayout,
  onOpenTemplateModal,
  onOpenCommandPalette
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);

  const selectedSovereign = sovereigns.find((s) => s.id === selectedSovereignId) || sovereigns[0];

  return (
    <aside
      className={`shrink-0 bg-[#070b13] border-r border-[#1a2438] flex flex-col justify-between transition-all duration-200 z-30 ${
        isCollapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Top Header */}
      <div>
        {/* Brand & Collapse Button */}
        <div className="p-3.5 border-b border-[#1a2438] flex items-center justify-between">
          {!isCollapsed && (
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 bg-emerald-500/10 border border-emerald-500/30 rounded flex items-center justify-center font-mono font-bold text-emerald-400 text-xs">
                EQ
              </div>
              <span className="font-bold text-slate-100 text-sm tracking-tight">EconQuest Desk</span>
            </div>
          )}
          {isCollapsed && (
            <div className="w-8 h-8 mx-auto bg-emerald-500/10 border border-emerald-500/30 rounded flex items-center justify-center font-mono font-bold text-emerald-400 text-xs">
              EQ
            </div>
          )}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-slate-400 hover:text-slate-200 text-xs font-mono p-1 rounded hover:bg-slate-800 transition-colors"
            title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
            {isCollapsed ? '→' : '←'}
          </button>
        </div>

        {/* Search / Command Palette Trigger */}
        <div className="p-2 border-b border-[#1a2438]">
          <button
            onClick={onOpenCommandPalette}
            className={`w-full py-1.5 px-2 bg-[#0e1526] hover:bg-[#141f36] border border-[#1e2e4a] text-slate-400 hover:text-slate-200 rounded text-xs font-mono flex items-center justify-between transition-colors ${
              isCollapsed ? 'justify-center' : ''
            }`}
            title="Open Command Palette (⌘K)"
          >
            <span className="flex items-center gap-2">
              <span>🔍</span>
              {!isCollapsed && <span className="text-slate-400 text-[11px]">Quick Jump...</span>}
            </span>
            {!isCollapsed && (
              <span className="text-[10px] px-1 rounded bg-[#1b2842] text-slate-400">⌘K</span>
            )}
          </button>
        </div>

        {/* Active Sovereign Selector */}
        {!isCollapsed && (
          <div className="p-3 border-b border-[#1a2438] bg-[#090e18]">
            <div className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-1">
              Active Sovereign
            </div>
            <select
              value={selectedSovereignId}
              onChange={(e) => onSelectSovereign(e.target.value)}
              className="w-full bg-[#111726] border border-[#23314d] text-slate-200 text-xs rounded px-2 py-1 font-mono focus:outline-none focus:border-emerald-500 cursor-pointer"
            >
              {sovereigns.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.flag} {s.code} · {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Clustered Nav Items */}
        <div className="p-2 space-y-4 overflow-y-auto max-h-[calc(100vh-280px)]">
          {WORKSPACE_CLUSTERS.map((cluster) => (
            <div key={cluster.id} className="space-y-1">
              {!isCollapsed && (
                <div className="px-2 pt-1 text-[10px] font-mono uppercase font-bold text-slate-500 tracking-wider">
                  {cluster.name}
                </div>
              )}
              {isCollapsed && <div className="h-2 border-t border-[#1a2438] my-1" />}

              {cluster.items.map((item: NavDeskItem) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`w-full text-left px-2.5 py-1.5 rounded flex items-center transition-all ${
                      isActive
                        ? 'bg-[#152037] text-emerald-400 font-semibold border-l-2 border-emerald-400'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-[#0f172a]'
                    } ${isCollapsed ? 'justify-center' : 'justify-between'}`}
                    title={item.name}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <span className="text-sm shrink-0">{item.icon}</span>
                      {!isCollapsed && <span className="text-xs truncate">{item.name}</span>}
                    </div>

                    {!isCollapsed && item.id === 'arbitrage' && arbitrageCount > 0 && (
                      <span className="text-[10px] font-mono text-emerald-400 font-bold px-1 rounded bg-emerald-950 border border-emerald-800">
                        {arbitrageCount}
                      </span>
                    )}

                    {!isCollapsed && item.badge && (
                      <span className="text-[9px] font-mono text-amber-400 px-1 rounded bg-amber-950 border border-amber-800">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Controls */}
      <div className="p-3 border-t border-[#1a2438] bg-[#090d16] space-y-2">
        {/* Scenario Selector */}
        {!isCollapsed && (
          <div>
            <div className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-1">
              Macro Shock State
            </div>
            <select
              value={activeScenario}
              onChange={(e) => setActiveScenario(e.target.value as MacroScenario)}
              className="w-full bg-[#111726] border border-[#23314d] text-slate-300 text-xs rounded px-2 py-1 font-mono focus:outline-none focus:border-emerald-500 cursor-pointer"
            >
              <option value="baseline">Baseline State</option>
              <option value="scenarioA_fedTightening">Scenario A (+200bps Fed)</option>
              <option value="scenarioB_commodityCollapse">Scenario B (-30% Commodity)</option>
              <option value="scenarioC_malaccaBlockade">Scenario C (Malacca Blockade)</option>
              <option value="custom">⚡ Custom What-If</option>
            </select>
          </div>
        )}

        {/* GUI Template Switcher Button */}
        <button
          onClick={onOpenTemplateModal}
          className={`w-full py-1.5 px-2 bg-[#101726] hover:bg-[#162138] border border-[#1e2e4a] rounded text-slate-300 text-xs font-mono flex items-center justify-between transition-colors ${
            isCollapsed ? 'justify-center' : ''
          }`}
          title="Change GUI Workspace Template"
        >
          <span className="flex items-center gap-1.5">
            <span>⚙️</span>
            {!isCollapsed && <span>GUI Layout</span>}
          </span>
          {!isCollapsed && (
            <span className="text-[10px] text-cyan-400 font-bold uppercase">{activeLayout}</span>
          )}
        </button>
      </div>
    </aside>
  );
};
