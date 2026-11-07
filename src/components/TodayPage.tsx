import React, { useEffect, useMemo, useState } from 'react';
import { DigestPanel } from './DigestPanel';
import { CalendarClock, ExternalLink, PanelLeft, PanelRight, Ticket, X } from 'lucide-react';
import type { CouncilAssessmentRun, LiveWatchlistItem } from '../types/council';
import type { StagedTradeTicketSpec } from '../utils/nssYieldCurveAndCatalystEngine';
import { POLITICAL_FISCAL_CATEGORIES, hasOfficialSchedule, upcomingOfficialEvents } from '../data/officialCalendar';
import { rankDivergences } from '../utils/divergences';
import { formatAsOf } from '../utils/dataStatus';
import { PanelBoundary } from './PanelBoundary';
import { UsesLine, WorkspaceInputs, useServerInputs } from './WorkspaceInputs';
import { workspaceInputs, type InputId, type PanelId } from '../utils/workspaceInputs';
import { useMarketEdgeAnchors } from './MarketEdgeScreen';
import { WatchAlertsPanel } from './WatchAlertsPanel';
import { AskCouncilPanel, CouncilAgentsPanel, useCouncilHasQuestion, type FullCouncilStep } from './AskCouncilPanel';
import { marketEdgePeers } from '../utils/marketEdgeAnchors';
import { MissingSources, WatchlistTable } from './WatchlistTable';
import { POP_OUT_URL, WATCHLIST_VIEW_KEY, loadView, saveView, type WatchlistView } from '../utils/watchlistView';

/**
 * Today: the institutional PM's morning view.
 * What moved since my last visit, which signals fired, what is on the official calendar
 * in the next two weeks, and what is waiting for me. Every row links into the desk that explains it.
 */

// v2: only figures from real sources are recorded (v1 held built-in values, so it is ignored).
const LAST_VISIT_KEY = 'econquest_today_last_visit_v2';
/** Panels that live in the Briefing side panel; a link to one of them opens it. */
const BRIEFING_IDS = ['ws-inputs', 'ws-watchlist', 'tool-digest', 'tool-calendar', 'tool-watch-alerts'];
const BRIEFING_KEY = 'econquest.briefing.v1';
const AGENTS_KEY = 'econquest.agentsPanel.v1';
/** App asks a page to show an anchor before scrolling to it (the Briefing panel opens for its panels). */
export const REVEAL_EVENT = 'econquest:reveal';
/** Elections, budgets and IMF dates listed before "Show all". */
const PF_SHOWN = 3;

type VisitSnapshot = {
  savedAt: string;
  rows: Record<string, { cds5YBps?: number; cdsSource?: string; yield10YPct?: number; yieldSource?: string }>;
};

function loadLastVisit(): VisitSnapshot | null {
  try {
    const raw = window.localStorage.getItem(LAST_VISIT_KEY);
    return raw ? (JSON.parse(raw) as VisitSnapshot) : null;
  } catch {
    return null;
  }
}

function saveVisit(items: LiveWatchlistItem[]) {
  try {
    const rows: VisitSnapshot['rows'] = {};
    items.forEach((it) => {
      rows[it.iso3] = {
        cds5YBps: it.cds5YBps,
        cdsSource: it.cds5YBps !== undefined ? it.cds5YSource : undefined,
        yield10YPct: it.yield10YPct,
        yieldSource: it.yield10YSource || 'sample',
      };
    });
    window.localStorage.setItem(
      LAST_VISIT_KEY,
      JSON.stringify({ savedAt: new Date().toISOString(), rows } satisfies VisitSnapshot)
    );
  } catch {
    // Browser storage unavailable: the page still works, it just can't show changes.
  }
}

const Card: React.FC<{
  title: string;
  icon: React.ReactNode;
  note?: string;
  action?: React.ReactNode;
  uses?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ title, icon, note, action, uses, children, className = '' }) => (
  <section
    className={`ui-panel ${className}`}
  >
    <header className="flex items-start justify-between gap-3 px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
          {icon}
          {title}
        </h2>
        {note && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{note}</p>}
        {uses}
      </div>
      {action}
    </header>
    <div className="p-4">{children}</div>
  </section>
);

export const TodayPage: React.FC<{
  run: CouncilAssessmentRun;
  watchlistName: string;
  /** The list shown, so the pop-out opens on the same one. */
  watchlistId?: string;
  watchlistItems: LiveWatchlistItem[];
  stagedTickets: StagedTradeTicketSpec[];
  onOpenCountry: (item: LiveWatchlistItem, sectionId?: string) => void;
  onStageTicket: (ticket: StagedTradeTicketSpec) => void;
  onOpenTickets: () => void;
  onOpenWatchlistManager: () => void;
  /** Opens Reports on the council brief just saved. */
  onSendCouncilToReports?: () => void;
  /** The full council on the open country, run and approved inside Council chat. */
  fullCouncil?: FullCouncilStep;
  /** Core view: watchlist and calendar only (see utils/simpleMode.ts). */
  coreOnly?: boolean;
  /** Menu > Settings > AI model choice, for Your inputs. */
  aiProvider?: string;
  /** Imported holdings: the count for Your inputs, the countries for the Held mark in the watchlist. */
  holdingsCount?: number;
  heldIso3?: string[];
  /** A Your inputs chip was pressed (saved research is handled here: it scrolls to Council chat). */
  onInputAction?: (id: Exclude<InputId, 'research'>) => void;
}> = ({
  run,
  watchlistName,
  watchlistId,
  watchlistItems,
  stagedTickets,
  onOpenCountry,
  onStageTicket,
  onOpenTickets,
  onOpenWatchlistManager,
  onSendCouncilToReports,
  fullCouncil,
  coreOnly = false,
  aiProvider,
  holdingsCount = 0,
  heldIso3,
  onInputAction,
}) => {
  // Read the previous visit once, then record this one after the figures settle.
  const [lastVisit] = useState<VisitSnapshot | null>(() => loadLastVisit());
  const edgeAnchors = useMarketEdgeAnchors();
  const edgeItems = useMemo(() => marketEdgePeers(watchlistItems, edgeAnchors?.peers || []), [watchlistItems, edgeAnchors]);
  useEffect(() => {
    // Only Workspace counts as a visit; Research > Compare only reads it (ResearchCompare.tsx).
    const t = window.setTimeout(() => saveVisit(watchlistItems), 5000);
    return () => window.clearTimeout(t);
  }, [watchlistItems]);

  // Columns and sort, shared with the pop-out window through this browser's storage.
  const [view, setView] = useState<WatchlistView>(() => loadView());
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === WATCHLIST_VIEW_KEY) setView(loadView());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const changeView = (v: WatchlistView) => {
    setView(v);
    saveView(v);
  };
  const popOut = () => {
    // The pop-out starts on the list shown here.
    changeView({ ...view, watchlistId });
    window.open(POP_OUT_URL, 'econquest-watchlist', 'popup,width=1100,height=720');
  };

  const watchIsos = useMemo(() => watchlistItems.map((w) => w.iso3), [watchlistItems]);
  const upcoming = useMemo(() => upcomingOfficialEvents(watchIsos, 14), [watchIsos]);
  const flaggedIsos = useMemo(() => new Set(rankDivergences(edgeItems, lastVisit?.rows).map((r) => r.iso3)), [edgeItems, lastVisit]);
  const politicalFiscal = useMemo(
    () =>
      upcomingOfficialEvents(watchIsos, 365)
        .filter((e) => POLITICAL_FISCAL_CATEGORIES.includes(e.category))
        .sort((a, b) => Number(flaggedIsos.has(b.iso3)) - Number(flaggedIsos.has(a.iso3)) || a.daysUntil - b.daysUntil),
    [watchIsos, flaggedIsos]
  );
  const [showAllPf, setShowAllPf] = useState(false);
  const noSchedule = useMemo(
    () => watchlistItems.filter((w) => !hasOfficialSchedule(w.iso3)),
    [watchlistItems]
  );

  const liveCount = watchlistItems.filter((w) => w.dataMode === 'live' || w.dataMode === 'partial').length;

  // Your inputs, and the "Uses:" line on each panel that links back to them.
  const server = useServerInputs();
  const chips = workspaceInputs({
    watchlistName,
    watchlistCount: watchlistItems.length,
    countryName: run.countryName,
    holdingsCount,
    liveCount,
    aiProvider,
    ...server,
  });
  const [highlight, setHighlight] = useState<InputId | null>(null);
  // The Briefing side panel: closed by default so the chat fills the page; remembered.
  const [briefing, setBriefingState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(BRIEFING_KEY) === 'open';
    } catch {
      return false;
    }
  });
  const setBriefing = (open: boolean) => {
    setBriefingState(open);
    try {
      localStorage.setItem(BRIEFING_KEY, open ? 'open' : 'closed');
    } catch {
      /* private window */
    }
  };
  // The Agents side panel on the left. Until you open or close it yourself, it opens on a wide
  // screen once a question is asked (before that it would only say "no question yet"); on a phone it
  // stays closed. Your own choice is remembered.
  const hasQuestion = useCouncilHasQuestion();
  const [agentsPref, setAgentsPref] = useState<'open' | 'closed' | null>(() => {
    try {
      const v = localStorage.getItem(AGENTS_KEY);
      if (v === 'open' || v === 'closed') return v;
    } catch {
      /* private window */
    }
    return null;
  });
  const wide = typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches === true;
  const agentsOpen = agentsPref ? agentsPref === 'open' : wide && hasQuestion;
  const setAgentsOpen = (open: boolean) => {
    setAgentsPref(open ? 'open' : 'closed');
    try {
      localStorage.setItem(AGENTS_KEY, open ? 'open' : 'closed');
    } catch {
      /* private window */
    }
  };
  useEffect(() => {
    const onReveal = (e: Event) => {
      if (BRIEFING_IDS.includes(String((e as CustomEvent).detail))) setBriefing(true);
    };
    window.addEventListener(REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(REVEAL_EVENT, onReveal);
  }, []);
  const toFix = chips.filter((c) => c.state === 'setup').length;
  const held = useMemo(() => new Set(heldIso3 || []), [heldIso3]);
  const lit = (panel: PanelId) =>
    highlight && chips.find((c) => c.id === highlight)?.drives.includes(panel) ? 'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-slate-950' : '';
  const inputAction = (id: InputId) => {
    if (id === 'research') document.querySelector<HTMLDetailsElement>('[data-council-options]')?.setAttribute('open', '');
    else onInputAction?.(id);
  };
  const uses = (panel: PanelId) => (onInputAction ? <UsesLine chips={chips} panel={panel} onAction={inputAction} /> : undefined);
  const byIso = new Map(watchlistItems.map((w) => [w.iso3, w]));
  const openIso = (iso3: string, sectionId?: string) => {
    const item = byIso.get(iso3);
    if (item) onOpenCountry(item, sectionId);
  };

  const briefingButton = (
    <button
      type="button"
      className={`ui-btn ${briefing ? 'ui-btn-primary' : 'ui-btn-ghost'}`}
      onClick={() => setBriefing(!briefing)}
      aria-expanded={briefing}
      aria-controls="ws-briefing"
      data-briefing-toggle="true"
      aria-label="Briefing"
      title={`Your inputs, watchlist, what moved, the next two weeks and watch alerts${toFix > 0 ? `. ${toFix} ${toFix === 1 ? 'input needs' : 'inputs need'} setup.` : ''}`}
    >
      <PanelRight className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Briefing</span>
      {toFix > 0 && (
        <span className="ml-0.5 inline-flex items-center gap-1" data-briefing-setup={toFix}>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden />
          <span className={`hidden sm:inline text-xs ${briefing ? 'text-amber-100' : 'text-amber-700 dark:text-amber-400'}`}>{toFix} to set up</span>
          <span className="sr-only sm:hidden">{`${toFix} ${toFix === 1 ? 'input needs' : 'inputs need'} setup`}</span>
        </span>
      )}
    </button>
  );

  const agentsButton = (
    <button
      type="button"
      className={`ui-btn ${agentsOpen ? 'ui-btn-primary' : 'ui-btn-ghost'}`}
      onClick={() => setAgentsOpen(!agentsOpen)}
      aria-expanded={agentsOpen}
      aria-controls="ws-agents"
      data-agents-toggle="true"
      aria-label="Agents"
      title="The agents working on your question, each with its live status"
    >
      <PanelLeft className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Agents</span>
    </button>
  );

  return (
    <div className="space-y-4" data-no-stat-ref="true">
      {/* Workspace is a chat page: the conversation fills the screen, input box at the bottom. Everything else sits in Briefing. */}
      <div className="flex gap-4 h-[calc(100dvh-9.5rem)] lg:h-[calc(100dvh-7.5rem)]">
        {agentsOpen && (
          <aside
            id="ws-agents"
            aria-label="Agents"
            data-agents-panel="true"
            className="fixed inset-0 z-30 overflow-y-auto bg-slate-50 dark:bg-[#0B0F17] p-3 space-y-3 lg:static lg:z-auto lg:p-0 lg:pr-4 lg:bg-transparent lg:w-[20rem] lg:shrink-0 lg:border-r lg:border-slate-200 lg:dark:border-slate-800"
          >
            <div className="flex items-center justify-between">
              <h2 className="ui-section-title">Agents</h2>
              <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setAgentsOpen(false)} aria-label="Close Agents" data-agents-close="true">
                <X className="w-3.5 h-3.5" /> Close
              </button>
            </div>
            <PanelBoundary name="Agents">
              <CouncilAgentsPanel fullCouncil={fullCouncil} />
            </PanelBoundary>
          </aside>
        )}
        <div className={`min-w-0 flex-1 transition-shadow ${lit('council')}`} id="tool-council">
          <PanelBoundary name="Council chat">
            <AskCouncilPanel
              page
              toolbar={<>{agentsButton}{briefingButton}</>}
              onOpenCountry={(item) => onOpenCountry(item, 'macro')}
              onSendToReports={() => onSendCouncilToReports?.()}
              fullCouncil={fullCouncil}
            />
          </PanelBoundary>
        </div>

        {briefing && (
          <aside
            id="ws-briefing"
            aria-label="Briefing"
            data-briefing="true"
            className="fixed inset-0 z-30 overflow-y-auto bg-slate-50 dark:bg-[#0B0F17] p-3 space-y-4 lg:static lg:z-auto lg:p-0 lg:bg-transparent lg:w-[24rem] lg:shrink-0"
          >
            <div className="flex items-center justify-between">
              <h2 className="ui-section-title">Briefing</h2>
              <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setBriefing(false)} aria-label="Close Briefing" data-briefing-close="true">
                <X className="w-3.5 h-3.5" /> Close
              </button>
            </div>
          <div id="ws-inputs" className="scroll-mt-4">
            {onInputAction && (
              <PanelBoundary name="Your inputs">
                <WorkspaceInputs chips={chips} onAction={inputAction} onHighlight={setHighlight} />
              </PanelBoundary>
            )}
          </div>
          <div id="ws-watchlist" className="scroll-mt-4">
          <Card
            title="Watchlist"
            icon={<span className="w-2 h-2 rounded-full bg-blue-600" />}
            note={`${watchlistName}. Press a country to open it; pop out for every column.`}

            uses={uses('watchlist')}
            className={`transition-shadow ${lit('watchlist')}`}
            action={
              <div className="flex flex-col items-end gap-1">
                <button
                  type="button"
                  onClick={popOut}
                  title="Open the full watchlist in its own window, with your choice of columns"
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-300 hover:underline whitespace-nowrap"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Pop out
                </button>
                <button
                  type="button"
                  onClick={onOpenWatchlistManager}
                  className="text-xs font-medium text-blue-700 dark:text-blue-300 hover:underline whitespace-nowrap"
                >
                  Edit
                </button>
              </div>
            }
          >
            <PanelBoundary name="The watchlist">
            <MissingSources items={watchlistItems} compact />
            <WatchlistTable
              compact
              items={watchlistItems}
              view={view}
              onChangeView={changeView}
              lastLook={lastVisit?.rows}
              highlightIso3={run.iso3}
              heldIso3={held}
              onOpen={(it) => onOpenCountry(it)}
            />
            </PanelBoundary>
          </Card>
          </div>
        <div id="tool-digest" className={`scroll-mt-4 transition-shadow ${lit('digest')}`}>
          <PanelBoundary name="Since your last visit">
            <DigestPanel items={edgeItems} onOpenCountry={(item) => onOpenCountry(item, 'macro')} uses={uses('digest')} />
          </PanelBoundary>
        </div>

          <div id="tool-calendar" className="scroll-mt-4">
          <Card
            title="Next two weeks"
            icon={<CalendarClock className="w-4 h-4 text-amber-600 dark:text-amber-400" />}
            note="Official central bank, statistics and election dates. Each row links to its source."
            uses={uses('calendar')}
            className={`transition-shadow ${lit('calendar')}`}
          >
            {upcoming.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No scheduled decisions or releases in the next 14 days.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {upcoming.slice(0, 8).map((ev) => (
                  <li key={`${ev.iso3}-${ev.date}-${ev.title}`} className="py-2.5 flex items-start justify-between gap-3">
                    <div>
                      <button
                        type="button"
                        onClick={() => openIso(ev.iso3, 'quant_macro_catalyst_calendar')}
                        className="text-left text-sm font-medium text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400"
                      >
                        {byIso.get(ev.iso3)?.countryName || ev.iso3}: {ev.title}
                      </button>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        <a
                          href={ev.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline"
                          title={ev.primarySource ? 'Official source' : 'Secondary source quoting the official schedule'}
                        >
                          {ev.sourceName}
                        </a>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-medium text-slate-900 dark:text-white">
                        {ev.daysUntil === 0 ? 'Today' : ev.daysUntil === 1 ? 'Tomorrow' : `In ${ev.daysUntil} days`}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {new Date(`${ev.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {noSchedule.length > 0 && (
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                No official schedule on file for {noSchedule.map((w) => w.countryName).join(', ')}.
              </p>
            )}
            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800" data-political-fiscal="true">
              <h4 className="text-sm font-medium text-slate-900 dark:text-white">Elections, budgets and IMF, next 12 months</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Countries where data and price disagree come first. Budget dates are the latest the constitution allows.
              </p>
              {politicalFiscal.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">None on file for this watchlist.</p>
              ) : (
                <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">
                  {(showAllPf ? politicalFiscal : politicalFiscal.slice(0, PF_SHOWN)).map((ev) => (
                    <li key={`pf-${ev.iso3}-${ev.date}-${ev.title}`} data-pf-event={ev.iso3} className="py-2 flex items-start justify-between gap-3">
                      <div>
                        <button
                          type="button"
                          onClick={() => openIso(ev.iso3)}
                          className="text-left text-sm text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400"
                        >
                          {byIso.get(ev.iso3)?.countryName || ev.iso3}: {ev.title}
                        </button>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {flaggedIsos.has(ev.iso3) && <span className="text-blue-700 dark:text-blue-300">Data and price disagree · </span>}
                          <a
                            href={ev.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                            title={ev.primarySource ? 'Official source' : 'Secondary source'}
                          >
                            {ev.sourceName}
                          </a>
                        </div>
                      </div>
                      <div className="text-right shrink-0 text-xs">
                        <div className="font-medium text-slate-900 dark:text-white">
                          {ev.dateKind === 'legal_deadline' ? 'By ' : ''}
                          {new Date(`${ev.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                        </div>
                        <div className="text-slate-500 dark:text-slate-400">
                          {ev.daysUntil === 0 ? 'Today' : ev.daysUntil === 1 ? 'Tomorrow' : `In ${ev.daysUntil} days`}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {politicalFiscal.length > PF_SHOWN && (
                <button type="button" className="mt-2 text-xs font-medium text-blue-700 dark:text-blue-300 hover:underline" onClick={() => setShowAllPf((v) => !v)} data-pf-toggle="true">
                  {showAllPf ? 'Show fewer' : `Show all ${politicalFiscal.length}`}
                </button>
              )}
            </div>
          </Card>
          </div>


        <div id="tool-watch-alerts" className={`scroll-mt-4 transition-shadow ${lit('alerts')}`}>
          <PanelBoundary name="Watch alerts">
            <WatchAlertsPanel items={edgeItems} onOpenCountry={(item) => onOpenCountry(item, 'macro')} uses={uses('alerts')} />
          </PanelBoundary>
        </div>
          </aside>
        )}
      </div>

      {!coreOnly && (
      <Card
        title="Waiting for you"
        icon={<Ticket className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
        note="Trade tickets staged for the investment committee."
        action={
          stagedTickets.length > 0 ? (
            <button
              type="button"
              onClick={onOpenTickets}
              className="text-xs font-medium text-blue-700 dark:text-blue-300 hover:underline whitespace-nowrap"
            >
              Open IC tickets
            </button>
          ) : undefined
        }
      >
        {stagedTickets.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No staged tickets.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {stagedTickets.slice(0, 5).map((t) => (
              <li key={t.ticketId} className="py-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-white">{t.strategyTitle}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {t.countryName} · conviction {t.convictionScore0To100}/100
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openIso(t.iso3, t.targetSectionId)}
                  className="ui-btn"
                >
                  Open desk
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      )}
    </div>
  );
};
