import React from 'react';

/**
 * A workflow page (Portfolio, Reports): a title, an optional summary panel, then tabs.
 * Each tab is a short list of existing desks; one desk shows at a time.
 */

export interface WorkspaceTab {
  id: string;
  label: string;
  /** One line on what the tab is for. */
  hint: string;
  desks: string[];
}

export const PORTFOLIO_TABS: WorkspaceTab[] = [
  {
    id: 'book',
    label: 'Book',
    hint: 'Pair trades and risk sensitivities. The EMBI book uses your imported holdings as its weights, and the blotter can add your positions in the current country.',
    desks: ['embi_portfolio_pair_book', 'quant_trade_blotter'],
  },
  {
    id: 'risk',
    label: 'Risk & contagion',
    hint: 'How a shock in one country spreads through the book. Contagion uses your imported holdings when you have them.',
    desks: ['portfolio_risk_desk', 'quant_alpha_correlation'],
  },
  {
    id: 'stress',
    label: 'Stress tests',
    hint: 'Scenario shocks applied to the whole book. Uses your imported holdings when you have them.',
    desks: ['quant_portfolio_stress_lab'],
  },
  {
    id: 'ideas',
    label: 'Ideas',
    hint: 'Screens for new trades, and how similar rules did in the past.',
    desks: ['persona_cross_hub_signal_scanner', 'decision_dislocation_screener', 'persona_strategy_backtester_lab'],
  },
];

export const REPORTS_TABS: WorkspaceTab[] = [
  {
    id: 'ic',
    label: 'Memos and notes',
    hint: 'Turn the current view into a document: IC memo, client note or country note. Every figure names its source.',
    desks: ['ic_memo_builder', 'ic_pitchbook_dossier_exporter', 'persona_guided_playbook_cockpit'],
  },
  {
    id: 'signoff',
    label: 'Risk sign-off',
    hint: 'CRO gate, pre-mortem and the record of past calls.',
    desks: ['cro_reports', 'decision_premortem_killswitch', 'decision_ledger_brier'],
  },
  {
    id: 'council',
    label: 'Council debate',
    hint: 'The nine-agent council, including the devil’s advocate.',
    desks: ['council_debates'],
  },
  {
    id: 'research',
    label: 'Research & exports',
    hint: 'Read central bank and IMF documents, and export data for papers.',
    desks: ['policy_doc_lab', 'mpc_imf_document_ai', 'persona_academic_latex_csv_exporter'],
  },
];

export function findTabForDesk(tabs: WorkspaceTab[], deskId: string): WorkspaceTab | undefined {
  return tabs.find((t) => t.desks.includes(deskId));
}

/** Pages that are not desks in the Tools library but live inside a workflow tab. */
export const WORKFLOW_ONLY_DESKS: Record<string, string> = {
  ic_memo_builder: 'Memo builder',
};

export function deskLabel(id: string): string {
  return WORKFLOW_ONLY_DESKS[id] || id;
}

interface WorkspacePageProps {
  title: string;
  subtitle: string;
  tabs: WorkspaceTab[];
  activeTabId: string;
  activeDesk: string;
  onChangeTab: (tabId: string) => void;
  onChangeDesk: (deskId: string) => void;
  renderDesk: (deskId: string) => React.ReactNode;
  actions?: React.ReactNode;
  summary?: React.ReactNode;
  ariaLabel: string;
}

export const WorkspacePage: React.FC<WorkspacePageProps> = ({
  title,
  subtitle,
  tabs,
  activeTabId,
  activeDesk,
  onChangeTab,
  onChangeDesk,
  renderDesk,
  actions,
  summary,
  ariaLabel,
}) => {
  const tab: WorkspaceTab | undefined = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const desk = tab ? (tab.desks.includes(activeDesk) ? activeDesk : tab.desks[0]) : undefined;

  return (
    <div className="space-y-3" data-workspace-page={ariaLabel}>
      <div className="ui-panel px-4 pt-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="ui-title">{title}</h1>
            <p className="ui-label mt-0.5">{subtitle}</p>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
        </div>
        {summary && <div className="mt-3">{summary}</div>}
        {tabs.length > 1 && tab && (
        <nav className="mt-3 flex gap-1 ui-scroll-x border-t border-slate-100 dark:border-slate-800" aria-label={ariaLabel}>
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onChangeTab(t.id)}
              aria-current={t.id === tab.id ? 'page' : undefined}
              className="ui-tab"
            >
              {t.label}
            </button>
          ))}
        </nav>
        )}
        {!(tabs.length > 1) && <div className="pb-3" />}
      </div>

      {tab && desk && (
      <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {tabs.length > 1 && <p className="ui-label">{tab.hint}</p>}
        {tab.desks.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={`${tab.label} tools`}>
            {tab.desks.map((d) => (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={d === desk}
                onClick={() => onChangeDesk(d)}
                className="ui-pill"
              >
                {deskLabel(d)}
              </button>
            ))}
          </div>
        )}
      </div>

      {renderDesk(desk)}
      </>
      )}
    </div>
  );
};
