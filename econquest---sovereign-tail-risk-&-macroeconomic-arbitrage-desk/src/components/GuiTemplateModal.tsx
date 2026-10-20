import React from 'react';
import { GuiLayoutTemplate } from '../types/riskEngine';

interface GuiTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTemplate: GuiLayoutTemplate;
  onSelectTemplate: (template: GuiLayoutTemplate) => void;
}

export const GuiTemplateModal: React.FC<GuiTemplateModalProps> = ({
  isOpen,
  onClose,
  currentTemplate,
  onSelectTemplate
}) => {
  if (!isOpen) return null;

  const templates: {
    id: GuiLayoutTemplate;
    title: string;
    subtitle: string;
    badge: string;
    description: string;
    features: string[];
    layoutPreview: React.ReactNode;
  }[] = [
    {
      id: 'topbar',
      title: 'Institutional Clustered Topbar',
      subtitle: 'Default Quantitative Desk',
      badge: 'POPULAR',
      description:
        'Streamlined 4-cluster dropdown navigation with live risk alert marquee ticker, compact top footprint, and maximum vertical canvas.',
      features: [
        'Organized into 4 core desks (Risk Intelligence, Quantitative Models, Markets & Alpha, Data & Ingest)',
        'Continuous real-time Sovereign VaR breach & Arbitrage alert marquee',
        'Universal Command Palette (⌘K) for sub-second keyboard navigation',
        'Optimized for single-monitor deep analytical workflows'
      ],
      layoutPreview: (
        <div className="w-full h-24 bg-[#090d16] border border-[#1a2742] rounded p-2 flex flex-col justify-between">
          <div className="h-4 bg-[#152037] rounded flex items-center justify-between px-2 text-[9px] font-mono text-emerald-400">
            <span>[EconQuest] Desks ▼ Models ▼ Markets ▼ Ingest ▼</span>
            <span className="text-amber-400">⚡ Scenario</span>
          </div>
          <div className="h-2.5 bg-rose-950/60 border border-rose-900/60 rounded px-1.5 flex items-center text-[8px] font-mono text-rose-300">
            • Ticker: Sovereign VaR Breaches & Arbitrage Opportunities
          </div>
          <div className="flex-1 bg-[#101726] border border-[#1a2742] rounded mt-1 p-1 flex items-center justify-center text-[9px] text-slate-500 font-mono">
            Main Quantitative Desk Viewport
          </div>
        </div>
      )
    },
    {
      id: 'sidebar',
      title: 'Executive Left Rail Sidebar',
      subtitle: 'Bloomberg / FactSet Terminal Style',
      badge: 'HIGH-DENSITY',
      description:
        'Collapsible left-hand navigation rail organizing all 12 modules into clear sections, with instant sovereign switcher and status counters.',
      features: [
        'Persistent collapsible sidebar with quick category icons & badges',
        'Permanent quick-selector for active sovereign entity and live indicators',
        'Wider main data viewport ideal for high-density tables and Recharts / D3.js matrices',
        'Zero-clutter topbar focused strictly on active scenario and ticker'
      ],
      layoutPreview: (
        <div className="w-full h-24 bg-[#090d16] border border-[#1a2742] rounded p-2 flex gap-1.5">
          <div className="w-16 bg-[#131d33] border border-[#1e2e4a] rounded p-1 flex flex-col justify-between text-[8px] font-mono text-slate-300">
            <div className="font-bold text-emerald-400">EQ DESK</div>
            <div className="space-y-0.5 text-[7px] text-slate-400">
              <div>• Risk</div>
              <div>• Models</div>
              <div>• Alpha</div>
              <div>• Ingest</div>
            </div>
            <div className="text-[6px] text-slate-500">🇲🇽 MEX</div>
          </div>
          <div className="flex-1 flex flex-col justify-between">
            <div className="h-3.5 bg-[#152037] rounded px-2 flex items-center justify-between text-[8px] font-mono text-slate-400">
              <span>Risk Alert Stream</span>
              <span className="text-amber-400 font-bold">Scenario</span>
            </div>
            <div className="flex-1 bg-[#101726] border border-[#1a2742] rounded mt-1 p-1 flex items-center justify-center text-[9px] text-slate-500 font-mono">
              Wide Analytical Viewport
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'dual_pane',
      title: 'Dual-Desk Split Workspace',
      subtitle: 'Side-by-Side Multi-Pane Workbench',
      badge: 'POWER USER',
      description:
        'Simultaneously run two quantitative modules side-by-side. Inspect systemic risk on the left while adjusting custom macro scenarios or arbitrage on the right.',
      features: [
        'Independent desk selector for Left Pane and Right Pane',
        '1-click swap button to interchange left and right desks',
        'Real-time reactive feedback: edit what-if levers on right, see heatmap update on left',
        'Perfect for ultrawide and multi-monitor trading desk displays'
      ],
      layoutPreview: (
        <div className="w-full h-24 bg-[#090d16] border border-[#1a2742] rounded p-2 flex flex-col justify-between">
          <div className="h-3.5 bg-[#152037] rounded px-2 flex items-center justify-between text-[8px] font-mono text-slate-400">
            <span>Left Pane: Cockpit / Heatmap</span>
            <span className="text-cyan-400">⇌ Swap</span>
            <span>Right Pane: Pipeline / Stress Lab</span>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-1.5 mt-1">
            <div className="bg-[#101726] border border-cyan-800/40 rounded p-1 flex items-center justify-center text-[8px] text-cyan-300 font-mono">
              Desk 1 (Primary)
            </div>
            <div className="bg-[#101726] border border-emerald-800/40 rounded p-1 flex items-center justify-center text-[8px] text-emerald-300 font-mono">
              Desk 2 (Secondary)
            </div>
          </div>
        </div>
      )
    }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-[#0b101c] border border-[#233352] rounded-xl max-w-4xl w-full p-6 shadow-2xl space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800 font-bold">
                WORKSPACE ARCHITECTURE
              </span>
              <h2 className="text-lg font-bold text-slate-100">GUI Workspace Layout Templates</h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Select an institutional workstation layout template suited to your workflow and monitor configuration.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-sm font-mono p-1 rounded hover:bg-slate-800"
          >
            ✕
          </button>
        </div>

        {/* 3 Template Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {templates.map((tpl) => {
            const isSelected = currentTemplate === tpl.id;
            return (
              <div
                key={tpl.id}
                onClick={() => {
                  onSelectTemplate(tpl.id);
                  onClose();
                }}
                className={`p-4 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                  isSelected
                    ? 'bg-[#131d33] border-emerald-500 ring-2 ring-emerald-500/30 shadow-lg'
                    : 'bg-[#0e1526] border-[#1a2742] hover:border-slate-600 hover:bg-[#121c30]'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#162238] text-slate-300 border border-[#233352]">
                      {tpl.badge}
                    </span>
                    {isSelected && (
                      <span className="text-[11px] font-mono text-emerald-400 font-bold flex items-center gap-1">
                        ✓ ACTIVE
                      </span>
                    )}
                  </div>

                  <div>
                    <h3 className="text-sm font-bold text-slate-100">{tpl.title}</h3>
                    <div className="text-[11px] font-mono text-slate-400">{tpl.subtitle}</div>
                  </div>

                  {tpl.layoutPreview}

                  <p className="text-xs text-slate-300 leading-relaxed">{tpl.description}</p>

                  <div className="pt-2 border-t border-[#1a2742] space-y-1.5 text-[11px] text-slate-400">
                    {tpl.features.map((feat, idx) => (
                      <div key={idx} className="flex items-start gap-1.5">
                        <span className="text-emerald-400 text-xs">·</span>
                        <span>{feat}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-[#1a2742]">
                  <button
                    className={`w-full py-1.5 text-xs font-mono font-bold rounded transition-colors ${
                      isSelected
                        ? 'bg-emerald-500 text-slate-950'
                        : 'bg-[#172338] text-slate-200 hover:bg-[#20304d]'
                    }`}
                  >
                    {isSelected ? 'Currently Selected' : 'Switch to this Layout'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="pt-2 flex items-center justify-between text-xs font-mono text-slate-400 border-t border-[#1a2742]">
          <span>Tip: You can quickly toggle templates anytime via ⌘K or the header layout button.</span>
          <button onClick={onClose} className="px-4 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
