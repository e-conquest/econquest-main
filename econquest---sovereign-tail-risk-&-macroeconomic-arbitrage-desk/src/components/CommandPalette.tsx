import React, { useState, useEffect, useRef } from 'react';
import { ALL_NAV_ITEMS, WORKSPACE_CLUSTERS } from '../data/navigationStructure';
import { SovereignEntity, MacroScenario, GuiLayoutTemplate } from '../types/riskEngine';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToTab: (tab: string) => void;
  sovereigns: SovereignEntity[];
  onSelectSovereign: (id: string) => void;
  onSelectScenario: (scenario: MacroScenario) => void;
  onSelectLayout: (layout: GuiLayoutTemplate) => void;
  activeTab: string;
  activeScenario: MacroScenario;
  activeLayout: GuiLayoutTemplate;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigateToTab,
  sovereigns,
  onSelectSovereign,
  onSelectScenario,
  onSelectLayout,
  activeTab,
  activeScenario,
  activeLayout
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Global shortcut to open/close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
        else {
          // Trigger open
        }
      } else if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Compute matched items
  const filteredNavItems = ALL_NAV_ITEMS.filter(
    (item) =>
      item.name.toLowerCase().includes(query.toLowerCase()) ||
      item.subtitle.toLowerCase().includes(query.toLowerCase()) ||
      item.shortName.toLowerCase().includes(query.toLowerCase())
  );

  const filteredSovereigns = sovereigns.filter(
    (s) =>
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      s.code.toLowerCase().includes(query.toLowerCase()) ||
      s.region.toLowerCase().includes(query.toLowerCase())
  );

  const allScenarios: { id: MacroScenario; name: string; desc: string }[] = [
    { id: 'baseline', name: 'Baseline Market State', desc: 'Calm economic conditions with zero active shocks' },
    { id: 'scenarioA_fedTightening', name: 'Scenario A: +200bps Fed Shock', desc: 'Hawkish tightening & capital flight' },
    { id: 'scenarioB_commodityCollapse', name: 'Scenario B: -30% Commodity Collapse', desc: 'Industrial metals & energy plunge' },
    { id: 'scenarioC_malaccaBlockade', name: 'Scenario C: Malacca Chokepoint Blockade', desc: 'Naval transit disruption & TSI shock' },
    { id: 'custom', name: '⚡ Custom Scenario Builder', desc: 'User-calibrated yield curve, FX vol & what-if levers' }
  ];
  const scenarioOptions = allScenarios.filter(
    (sc) =>
      sc.name.toLowerCase().includes(query.toLowerCase()) ||
      sc.desc.toLowerCase().includes(query.toLowerCase())
  );

  const allLayouts: { id: GuiLayoutTemplate; name: string; desc: string }[] = [
    { id: 'topbar', name: 'GUI Template: Institutional Topbar', desc: 'Clean grouped navigation with top ribbons' },
    { id: 'sidebar', name: 'GUI Template: Executive Left Rail', desc: 'Collapsible left sidebar for wide workspaces' },
    { id: 'dual_pane', name: 'GUI Template: Dual-Desk Split View', desc: 'Side-by-side split screen for multi-desk workflow' }
  ];
  const layoutOptions = allLayouts.filter(
    (l) => l.name.toLowerCase().includes(query.toLowerCase()) || l.desc.toLowerCase().includes(query.toLowerCase())
  );

  const totalResultsCount =
    filteredNavItems.length + filteredSovereigns.length + scenarioOptions.length + layoutOptions.length;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-[#0b101c] border border-[#233352] rounded-xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[75vh]">
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[#1a2742] bg-[#0e1526]">
          <span className="text-slate-400 font-mono text-sm">🔍</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search desks, sovereigns, scenarios, or layouts... (Esc to exit)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent border-none text-slate-100 placeholder-slate-500 text-sm focus:outline-none font-sans"
          />
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#162238] text-slate-400 border border-[#233352]">
            ESC
          </span>
        </div>

        {/* Results List */}
        <div className="overflow-y-auto p-2 space-y-4 text-xs font-mono">
          {totalResultsCount === 0 && (
            <div className="p-8 text-center text-slate-500 font-sans text-xs">
              No matching desks, sovereigns, or actions found for "{query}".
            </div>
          )}

          {/* 1. Desks & Navigation */}
          {filteredNavItems.length > 0 && (
            <div>
              <div className="px-2 py-1 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                Workstation Desks & Analytical Modules
              </div>
              <div className="space-y-1 mt-1">
                {filteredNavItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      onNavigateToTab(item.id);
                      onClose();
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between transition-colors ${
                      activeTab === item.id
                        ? 'bg-emerald-950/70 border border-emerald-800 text-emerald-300'
                        : 'hover:bg-[#131d33] text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-base">{item.icon}</span>
                      <div>
                        <div className="font-sans font-medium text-slate-200">{item.name}</div>
                        <div className="text-[11px] text-slate-500 font-sans">{item.subtitle}</div>
                      </div>
                    </div>
                    {item.badge && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800">
                        {item.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 2. Sovereigns Drilldown */}
          {filteredSovereigns.length > 0 && (
            <div>
              <div className="px-2 py-1 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                Sovereign Entities (1-Click Drilldown)
              </div>
              <div className="grid grid-cols-2 gap-1 mt-1">
                {filteredSovereigns.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      onSelectSovereign(s.id);
                      onNavigateToTab('pipeline');
                      onClose();
                    }}
                    className="text-left px-3 py-2 rounded-lg hover:bg-[#131d33] transition-colors flex items-center justify-between text-slate-300"
                  >
                    <div className="flex items-center gap-2 font-sans font-medium">
                      <span>{s.flag}</span>
                      <span>{s.name}</span>
                      <span className="text-slate-500 font-mono text-[10px]">({s.code})</span>
                    </div>
                    <span className="text-[10px] font-mono text-emerald-400">View 6-Layer →</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 3. Macro Scenarios */}
          {scenarioOptions.length > 0 && (
            <div>
              <div className="px-2 py-1 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                Macro Scenarios & Counterfactual States
              </div>
              <div className="space-y-1 mt-1">
                {scenarioOptions.map((sc) => (
                  <button
                    key={sc.id}
                    onClick={() => {
                      onSelectScenario(sc.id);
                      onClose();
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between transition-colors ${
                      activeScenario === sc.id
                        ? 'bg-amber-950/70 border border-amber-800 text-amber-300'
                        : 'hover:bg-[#131d33] text-slate-300'
                    }`}
                  >
                    <div>
                      <div className="font-sans font-medium text-slate-200">{sc.name}</div>
                      <div className="text-[11px] text-slate-500 font-sans">{sc.desc}</div>
                    </div>
                    {activeScenario === sc.id && (
                      <span className="text-[10px] font-mono text-amber-400 font-bold">ACTIVE</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 4. GUI Layout Templates */}
          {layoutOptions.length > 0 && (
            <div>
              <div className="px-2 py-1 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                GUI Workspace Templates
              </div>
              <div className="space-y-1 mt-1">
                {layoutOptions.map((lo) => (
                  <button
                    key={lo.id}
                    onClick={() => {
                      onSelectLayout(lo.id);
                      onClose();
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between transition-colors ${
                      activeLayout === lo.id
                        ? 'bg-cyan-950/70 border border-cyan-800 text-cyan-300'
                        : 'hover:bg-[#131d33] text-slate-300'
                    }`}
                  >
                    <div>
                      <div className="font-sans font-medium text-slate-200">{lo.name}</div>
                      <div className="text-[11px] text-slate-500 font-sans">{lo.desc}</div>
                    </div>
                    {activeLayout === lo.id && (
                      <span className="text-[10px] font-mono text-cyan-400 font-bold">ACTIVE</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-4 py-2 border-t border-[#1a2742] bg-[#090d17] text-[11px] font-mono text-slate-500 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>Esc Close</span>
          </div>
          <div>EconQuest Quantitative Desk Navigator</div>
        </div>
      </div>
    </div>
  );
};
