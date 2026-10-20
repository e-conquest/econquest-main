import React, { useState, useRef, useEffect } from 'react';
import { MacroScenario, SovereignEntity, LayerOutputs, GuiLayoutTemplate } from '../types/riskEngine';
import { WORKSPACE_CLUSTERS, ALL_NAV_ITEMS, getNavItemById } from '../data/navigationStructure';
import { RiskAlertTicker } from './RiskAlertTicker';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  activeScenario: MacroScenario;
  setActiveScenario: (scenario: MacroScenario) => void;
  arbitrageCount: number;
  sovereigns: SovereignEntity[];
  pipelineOutputs: Record<string, LayerOutputs>;
  onSelectSovereign: (id: string) => void;
  activeLayout: GuiLayoutTemplate;
  onOpenTemplateModal: () => void;
  onOpenCommandPalette: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  activeScenario,
  setActiveScenario,
  arbitrageCount,
  sovereigns,
  pipelineOutputs,
  onSelectSovereign,
  activeLayout,
  onOpenTemplateModal,
  onOpenCommandPalette
}) => {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentItem = getNavItemById(activeTab);

  return (
    <header className="sticky top-0 z-50 bg-[#080c14] border-b border-[#1a2438]">
      {/* Primary Top Nav Strip */}
      <div className="flex items-center justify-between gap-4 px-5 py-2.5">
        {/* Left Zone: Brand Wordmark & Quick Jump */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-7 h-7 bg-emerald-500/10 border border-emerald-500/30 rounded flex items-center justify-center font-mono font-bold text-emerald-400 text-sm">
            EQ
          </div>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('cockpit');
            }}
            className="text-sm font-bold tracking-tight text-slate-100 hover:text-emerald-400 transition-colors whitespace-nowrap"
          >
            EconQuest Sovereign Desk
          </a>

          {/* Quick Command Palette Button */}
          <button
            onClick={onOpenCommandPalette}
            className="ml-2 px-2.5 py-1 bg-[#101726] hover:bg-[#162138] border border-[#1e2e4a] text-slate-400 hover:text-slate-200 rounded text-xs font-mono flex items-center gap-2 transition-colors"
            title="Open Universal Command Palette (⌘K)"
          >
            <span>🔍</span>
            <span className="hidden sm:inline text-[11px] text-slate-400">Quick Jump</span>
            <span className="text-[10px] px-1 rounded bg-[#1b2842] text-slate-400">⌘K</span>
          </button>
        </div>

        {/* Center Zone: Clean Clustered Desks Navigation */}
        <div ref={dropdownRef} className="hidden lg:flex items-center gap-1.5 text-xs font-mono">
          {/* Quick-Access Top Buttons */}
          <button
            onClick={() => {
              setActiveTab('cockpit');
              setOpenDropdown(null);
            }}
            className={`px-2.5 py-1.5 rounded transition-all flex items-center gap-1.5 ${
              activeTab === 'cockpit'
                ? 'bg-[#152037] text-emerald-400 font-bold border border-emerald-500/40'
                : 'text-slate-300 hover:text-slate-100 hover:bg-[#101726]'
            }`}
          >
            <span>📊</span>
            <span>Cockpit</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('worldmap');
              setOpenDropdown(null);
            }}
            className={`px-2.5 py-1.5 rounded transition-all flex items-center gap-1.5 ${
              activeTab === 'worldmap'
                ? 'bg-[#152037] text-cyan-400 font-bold border border-cyan-500/40'
                : 'text-slate-300 hover:text-slate-100 hover:bg-[#101726]'
            }`}
          >
            <span>🌐</span>
            <span>World Map</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('heatmap');
              setOpenDropdown(null);
            }}
            className={`px-2.5 py-1.5 rounded transition-all flex items-center gap-1.5 ${
              activeTab === 'heatmap'
                ? 'bg-[#152037] text-rose-400 font-bold border border-rose-500/40'
                : 'text-slate-300 hover:text-slate-100 hover:bg-[#101726]'
            }`}
          >
            <span>🗺️</span>
            <span>Heatmap</span>
          </button>

          <span className="h-4 w-px bg-[#1e2e4a] mx-1" />

          {/* 4 Clustered Dropdowns */}
          {WORKSPACE_CLUSTERS.map((cluster) => {
            const isOpen = openDropdown === cluster.id;
            const hasActiveChild = cluster.items.some((item) => item.id === activeTab);

            return (
              <div key={cluster.id} className="relative">
                <button
                  onClick={() => setOpenDropdown(isOpen ? null : cluster.id)}
                  className={`px-2.5 py-1.5 rounded transition-all flex items-center gap-1.5 ${
                    hasActiveChild
                      ? 'text-emerald-400 font-bold bg-[#11192b]'
                      : 'text-slate-300 hover:text-slate-100 hover:bg-[#101726]'
                  }`}
                >
                  <span>{cluster.name}</span>
                  <span className="text-[10px] text-slate-500">▼</span>
                </button>

                {isOpen && (
                  <div className="absolute left-0 mt-1.5 w-64 bg-[#0a0f1d] border border-[#233352] rounded-xl shadow-2xl p-2 z-50 animate-in fade-in duration-100 space-y-1">
                    <div className="px-2 py-1 text-[10px] uppercase font-bold text-slate-500 border-b border-[#1a2742]">
                      {cluster.description}
                    </div>

                    {cluster.items.map((item) => {
                      const isItemActive = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            setActiveTab(item.id);
                            setOpenDropdown(null);
                          }}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
                            isItemActive
                              ? 'bg-[#152037] text-emerald-300 font-bold'
                              : 'text-slate-300 hover:bg-[#121c32] hover:text-slate-100'
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span className="text-sm shrink-0">{item.icon}</span>
                            <div className="truncate">
                              <div className="text-xs truncate">{item.name}</div>
                              <div className="text-[10px] text-slate-500 font-sans truncate">
                                {item.subtitle}
                              </div>
                            </div>
                          </div>

                          {item.id === 'arbitrage' && arbitrageCount > 0 && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono">
                              {arbitrageCount}
                            </span>
                          )}

                          {item.badge && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-800 font-mono">
                              {item.badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Right Zone: GUI Layout Template & Macro Shock Scenario */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/* GUI Layout Switcher Button */}
          <button
            onClick={onOpenTemplateModal}
            className="px-2.5 py-1.5 bg-[#101726] hover:bg-[#162138] border border-[#1e2e4a] text-slate-300 text-xs font-mono rounded flex items-center gap-1.5 transition-colors"
            title="Switch GUI Layout Template"
          >
            <span>⚙️</span>
            <span className="hidden md:inline text-[11px] text-slate-400">Layout:</span>
            <span className="text-cyan-400 font-bold uppercase text-[11px]">
              {activeLayout === 'topbar' ? 'Topbar' : activeLayout === 'sidebar' ? 'Sidebar' : 'Split'}
            </span>
          </button>

          {/* Macro Shock Scenario Selector */}
          <select
            value={activeScenario}
            onChange={(e) => setActiveScenario(e.target.value as MacroScenario)}
            className="bg-[#111726] border border-[#23314d] text-slate-200 text-xs rounded px-2.5 py-1.5 font-mono focus:outline-none focus:border-emerald-500 cursor-pointer"
          >
            <option value="baseline">Baseline State</option>
            <option value="scenarioA_fedTightening">Scenario A: +200bps Fed</option>
            <option value="scenarioB_commodityCollapse">Scenario B: -30% Commodity</option>
            <option value="scenarioC_malaccaBlockade">Scenario C: Malacca Blockade</option>
            <option value="custom">⚡ Custom What-If</option>
          </select>
        </div>
      </div>

      {/* Real-time Sovereign VaR Breaches & Arbitrage Alert Ticker */}
      <RiskAlertTicker
        sovereigns={sovereigns}
        pipelineOutputs={pipelineOutputs}
        activeScenario={activeScenario}
        onSelectSovereign={onSelectSovereign}
        onNavigateToTab={setActiveTab}
      />
    </header>
  );
};
