import { SettingsText } from './SettingsText';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Copy, Download, FileText, NotebookPen, X } from 'lucide-react';
import { startPolicyReview } from '../utils/reviewHandoff';
import { openIdeaJournal } from '../utils/ideaHandoff';
import { councilBriefMarkdown, downloadCouncilBrief } from '../utils/briefExport';
import type { CouncilAssessmentRun, CROOverrideState, LiveWatchlistItem, WatchlistItem } from '../types/council';
import { CouncilApprovalCard } from './CouncilApprovalCard';
import { PolicyDocsPicker } from './PolicyDocsPicker';
import { FigureCheckNote } from './FigureCheckNote';
import { SavedDocsRow, SavedResearchList, useResearchLibrary } from './SavedResearch';
import { MAX_DOCS } from '../utils/policyDocs';
import { toLive } from '../utils/liveFigures';
import { briefId } from '../utils/researchLibrary';
import { changeLines, pickPrevious, whatChanged, type ChangeReport } from '../utils/whatChanged';
import type { PolicyDoc } from '../utils/policyDocs';
import { findChallenges, type DebateResult } from '../utils/agentDebate';
import { AgentNetwork, useCouncilProgress } from './AgentNetwork';
import { ExplainAnswer } from './ExplainAnswer';
import { DocumentCards, DocumentViewer, SaveToReportsButton } from './CouncilDocuments';
import { toAgentDocuments, toSynthesisDocument, type CouncilDocument } from '../utils/agentDocument';
import { askCouncilColumns, fullCouncilColumns, type FullCouncilPhase } from '../utils/councilNetwork';
import {
  planCouncil,
  planFollowUp,
  applyAgentChoice,
  type AgentChoiceResult,
  suggestFollowUps,
  type EarlierTurn,
  runCouncil,
  chartAnswer,
  answersForModel,
  saveCouncilBrief,
  type AgentAnswer,
  type CouncilPlan,
  type SavedCouncilBrief,
  type SynthesisResult,
} from '../utils/askCouncil';

import { smallRefereeNote } from '../utils/refereeModel';
import { AnswerSnapshotDetails } from './AnswerSnapshot';
import { CouncilTimingNote } from './CouncilTimingNote';
import type { CouncilTiming } from '../utils/councilTiming';
import { focusQuestion, withExplainAgents, type ExplainFocus } from '../utils/explain';
import { EXPLAIN_EVENT } from '../utils/explainHandoff';
import { PRESETS, computeChart, fetchChartSeries } from '../utils/councilChart';
import { asksForecast, forecastAnswer, type CountryModels } from '../utils/forecastAgent';
import { lazyNamed } from './LazyDesk';
import { chatSuggestions, SUGGESTION_KIND_LABEL } from '../utils/chatSuggestions';
import { loadHoldings } from '../utils/holdings';
// The chart card (recharts) loads only when an answer has a chart.
const CouncilChartCard = lazyNamed(() => import('./CouncilChart'), 'CouncilChartCard');

const AI_RUNTIME_STORAGE_KEY = 'econquest_ai_runtime_config_v1';
function runtimeConfig(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(AI_RUNTIME_STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}


/** The full nine-agent council on the country open now, run from the conversation. */
/** The app's nowcast and forecast for each country (src/utils/forecastAgent.ts); a failed call reads Missing. */
async function fetchCountryModels(countries: Array<{ iso3: string; countryName: string }>): Promise<CountryModels[]> {
  const get = (u: string) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return Promise.all(countries.map(async (c) => ({ iso3: c.iso3, countryName: c.countryName, nowcast: await get(`/api/nowcast/${encodeURIComponent(c.iso3)}`), forecast: await get(`/api/forecast/${encodeURIComponent(c.iso3)}`) })));
}

export interface FullCouncilStep {
  countryName: string;
  stage: CouncilAssessmentRun['stage'];
  isRunning: boolean;
  isApproving: boolean;
  deskState: CROOverrideState;
  draft: CROOverrideState;
  /** Set only for a report written in this session, never for the built-in example run. */
  result?: { reportId: string; verdict: string; summary: string; figureCheck?: CouncilAssessmentRun['figureCheck']; timing?: CouncilTiming };
  /** The run's id for live step progress; null until a run starts in this session. */
  progressId: string | null;
  onRun: () => void;
  onApprove: () => void;
  onChangeDraft: (next: CROOverrideState) => void;
  onOpenFullReview?: () => void;
}

const VERDICT: Record<string, string> = {
  EXECUTE_TRADES: 'Act on the trade ideas',
  DEFENSIVE_HEDGE: 'Hedge the exposure',
  HOLD_AND_MONITOR: 'Hold and keep watching',
};

const EXAMPLES = [
  'Which central banks look behind the curve?',
  'Who is most exposed to a Hormuz closure?',
  'Whose government debt is on a rising path?',
  'What is coming up in the next month?',
];

const toMarkdown = councilBriefMarkdown;

type Asked = { question: string; plan: CouncilPlan; answers: AgentAnswer[]; askedAt: string; startedAt: string };
/** One exchange in the chat: the question and everything the council answered with. */
type Turn = { asked: Asked; synthesis: SynthesisResult | null; debate: DebateResult | null; changes: ChangeReport | null; earlier: EarlierTurn[] };

function toSaved(t: Turn, debateSettled = true): SavedCouncilBrief {
  return {
    question: t.asked.question,
    askedAt: t.asked.askedAt,
    scopeNote: t.asked.plan.scopeNote,
    answers: t.asked.answers,
    synthesis: t.synthesis,
    ...(t.earlier.length ? { earlier: t.earlier.map((e) => ({ question: e.question, headline: e.headline })) } : {}),
    ...(t.asked.plan.chooserNote ? { chooserNote: t.asked.plan.chooserNote } : {}),
    ...(t.debate && debateSettled ? { debate: t.debate } : {}),
    startedAt: t.asked.startedAt,
    ...(t.changes ? { changes: t.changes } : {}),
  };
}

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * Today > Council chat. A question goes to the desk agents that cover it (stated keyword
 * rules), each answers from the app's own figures, then the synthesis agent may summarise.
 */
/** The conversation itself, shared by every place the chat is shown (see CouncilChatProvider). */
function useCouncilChatState(items: LiveWatchlistItem[]) {
  const [question, setQuestion] = useState('');
  const [scope, setScope] = useState('');
  const [asked, setAsked] = useState<Asked | null>(null);
  // Earlier exchanges of this conversation, in full, oldest first; shown above the latest one.
  const [past, setPast] = useState<Turn[]>([]);
  const lib = useResearchLibrary();
  const [changes, setChanges] = useState<ChangeReport | null>(null);
  const [synthesis, setSynthesis] = useState<SynthesisResult | null>(null);
  const [writing, setWriting] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  // Earlier questions of this conversation, oldest first, as sent to the AI steps.
  const [earlier, setEarlier] = useState<EarlierTurn[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [docs, setDocs] = useState<PolicyDoc[]>([]);
  const [debate, setDebate] = useState<DebateResult | null>(null);
  const [debating, setDebating] = useState(false);
  // Countries off the watchlist added for questions in this session (pulled on request, not saved to the list).
  const [extra, setExtra] = useState<LiveWatchlistItem[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  // Pinned: the conversation keeps the figures it had when pinned, even when the feeds refresh.
  const [pinned, setPinned] = useState<{ at: string; items: LiveWatchlistItem[] } | null>(null);
  const pool = useMemo(() => {
    const base = pinned ? pinned.items : items;
    return [...base, ...extra.filter((e) => !base.some((i) => i.iso3 === e.iso3))];
  }, [items, extra, pinned]);
  const pinData = (on: boolean) => setPinned(on ? { at: new Date().toISOString(), items: pool } : null);

  const runDebate = async () => {
    if (!asked) return;
    // Show the rule-based challenges at once; the AI replies replace them when they come.
    setDebate({ challenges: findChallenges(asked.answers), replies: null });
    setDebating(true);
    try {
      const r = await fetch('/api/council/debate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: asked.question, answers: answersForModel(asked.answers), runtimeConfig: runtimeConfig() }),
      });
      if (r.ok) setDebate((await r.json()) as DebateResult);
      else setDebate((d) => d && { ...d, reason: `the debate step did not answer (HTTP ${r.status})` });
    } catch {
      setDebate((d) => d && { ...d, reason: 'the app server did not answer' });
    } finally {
      setDebating(false);
    }
  };

  /** Ask the AI model which agents should answer; null when it cannot be reached in time. */
  const chooseAgents = async (question: string, history: EarlierTurn[]): Promise<AgentChoiceResult | null> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch('/api/council/choose-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, earlier: history.map((t) => ({ question: t.question })), runtimeConfig: runtimeConfig() }),
        signal: ctl.signal,
      });
      return r.ok ? ((await r.json()) as AgentChoiceResult) : { agents: null, reason: `the AI step did not answer (HTTP ${r.status})` };
    } catch {
      return { agents: null, reason: ctl.signal.aborted ? 'the AI model took too long' : 'the app server did not answer' };
    } finally {
      clearTimeout(timer);
    }
  };

  /**
   * new: starts a conversation. followup: keeps this one's countries and agents unless others are
   * named. replace: asks the latest question again (after adding a country) without a new message.
   */
  const ask = async (q: string, mode: 'new' | 'followup' | 'replace' = 'new', poolOverride?: LiveWatchlistItem[], focus?: ExplainFocus) => {
    const text = q.trim();
    const items = poolOverride ?? pool;
    if (!text || !items.length) return;
    const asFollowUp = mode === 'followup' && Boolean(asked);
    const history = asFollowUp && asked ? [...earlier, { question: asked.question, headline: synthesis?.brief?.headline || undefined }] : mode === 'replace' ? earlier : [];
    if (asFollowUp && asked) setPast((p) => [...p, { asked, synthesis, debate, changes, earlier }]);
    else if (mode === 'new') setPast([]);
    setEarlier(history);
    setQuestion('');
    const wordPlan = asFollowUp && asked ? planFollowUp(text, asked.plan, items) : planCouncil(text, items, scope || undefined);
    setChoosing(true);
    // Explain questions ("why…", "what does it mean for…") also bring the agents for each lens.
    const plan = withExplainAgents(applyAgentChoice(wordPlan, await chooseAgents(text, history)), text, focus);
    setChoosing(false);
    const desk = runCouncil(text, plan, items, new Date(), docs);
    // The Chart Agent: fetch the series the question names from the app's own history, draw, test.
    const charted = plan.chart ? [chartAnswer(plan.chart, computeChart(plan.chart, await fetchChartSeries(plan.chart))), ...desk] : desk;
    // Nowcast & Forecast: the app's own estimates join when the question asks about the path ahead.
    const answers = asksForecast(text) && plan.countries.length ? [...charted, forecastAnswer(await fetchCountryModels(plan.countries.slice(0, 4)))] : charted;
    const askedAt = new Date().toISOString();
    setAsked({ question: text, plan, answers, askedAt, startedAt: (asFollowUp || mode === 'replace') && asked ? asked.startedAt : askedAt });
    setSynthesis(null);
    setDebate(null);
    setCopied(null);
    if (!answers.some((a) => a.findings.length)) {
      setSynthesis({ brief: null, removed: [], reason: 'The agents found no figures to answer with, so there is nothing to summarise.' });
      return;
    }
    setWriting(true);
    try {
      const r = await fetch('/api/council/synthesise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, askedAt, ...(pinned ? { dataPinnedAt: pinned.at } : {}), answers: answersForModel(answers), scope: plan.scopeNote, countries: plan.countries.length, earlier: history.map((t) => ({ question: t.question, headline: t.headline })), ...(plan.explain ? { explain: plan.explain } : {}), runtimeConfig: runtimeConfig() }),
      });
      setSynthesis(r.ok ? ((await r.json()) as SynthesisResult) : { brief: null, removed: [], reason: `The summary step did not answer (HTTP ${r.status}).` });
    } catch {
      setSynthesis({ brief: null, removed: [], reason: 'The app server did not answer.' });
    } finally {
      setWriting(false);
    }
  };

  // "Explain" pressed on a figure, chart or panel: ask about it, with the exact figure, in this conversation.
  const askRef = useRef(ask);
  askRef.current = ask;
  const askedRef = useRef(asked);
  askedRef.current = asked;
  useEffect(() => {
    const onExplain = (e: Event) => {
      const f = (e as CustomEvent<ExplainFocus>).detail;
      if (f?.label) void askRef.current(focusQuestion(f), askedRef.current ? 'followup' : 'new', undefined, f);
    };
    window.addEventListener(EXPLAIN_EVENT, onExplain);
    return () => window.removeEventListener(EXPLAIN_EVENT, onExplain);
  }, []);

  /** Pulls live figures for countries the question named that are off the watchlist, then asks again. */
  const addForQuestion = async () => {
    const codes = asked?.plan.offWatchlistIso3;
    if (!asked || !codes?.length) return;
    setAdding(null);
    try {
      const r = await fetch(`/api/data/watchlist-live?iso3=${encodeURIComponent(codes.join(','))}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const rows = ((await r.json())?.items || []) as WatchlistItem[];
      const fresh = rows.filter((row) => !pool.some((p: LiveWatchlistItem) => p.iso3 === row.iso3)).map((row) => toLive(row as unknown as WatchlistItem));
      if (!fresh.length) {
        setAdding('The app could not pull figures for that country.');
        return;
      }
      const next = [...pool, ...fresh];
      setExtra((e) => [...e, ...fresh]);
      await ask(asked.question, 'replace', next);
    } catch (e) {
      setAdding(`The app server did not answer (${(e as Error).message}).`);
    }
  };

  const current: Turn | null = asked ? { asked, synthesis, debate, changes, earlier } : null;
  const saved: SavedCouncilBrief | null = current ? toSaved(current, !debating) : null;
  const newConversation = () => {
    setAsked(null);
    setPast([]);
    setEarlier([]);
    setSynthesis(null);
    setDebate(null);
    setChanges(null);
    setQuestion('');
    setPinned(null);
  };
  // Compare with the latest saved conversation on the same countries, once per question.
  useEffect(() => {
    setChanges(null);
    if (!asked) return;
    const prev = pickPrevious(lib.briefs, briefId(asked.startedAt), asked.answers);
    if (!prev) return;
    let live = true;
    void lib.loadBrief(prev.id).then((b) => {
      if (live && b) setChanges(whatChanged(b, asked.answers));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked?.askedAt]);
  // Keep each conversation on this computer once its answer is in (and again after a debate or follow-up).
  const settled = Boolean(saved) && !writing && !debating && !choosing;
  useEffect(() => {
    if (settled && saved) void lib.saveBrief(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, asked?.askedAt, synthesis, debate]);
  const changeDocs = (next: PolicyDoc[]) => {
    const known = new Set(lib.docs.map((d) => d.id));
    for (const d of next) if (!known.has(d.id)) void lib.saveDoc(d);
    setDocs(next);
  };
  const copy = async (b: SavedCouncilBrief | null) => {
    if (!b) return;
    try {
      await navigator.clipboard.writeText(toMarkdown(b));
      setCopied(b.askedAt);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return {
    items, question, setQuestion, scope, setScope, asked, past, lib, synthesis, writing, copied, earlier, choosing, docs, setDocs,
    debate, debating, extra, adding, runDebate, ask, addForQuestion, current, saved, newConversation, changeDocs, copy, pinned, pinData,
  };
}

function fullCouncilPhase(fc: FullCouncilStep | undefined): FullCouncilPhase {
  if (!fc) return 'idle';
  if (fc.isRunning) return 'debating';
  if (fc.stage === 'AWAITING_CRO_APPROVAL') return 'awaiting_review';
  if (fc.isApproving) return 'writing_report';
  return fc.result ? 'done' : 'idle';
}

type CouncilChat = ReturnType<typeof useCouncilChatState>;
const CouncilChatContext = React.createContext<CouncilChat | null>(null);

/**
 * Holds the council conversation above the pages, so the same chat carries on whether it is open
 * on Workspace or in the side panel on Research and Reports, and a question keeps running while you move.
 */
export const CouncilChatProvider: React.FC<{ items: LiveWatchlistItem[]; children: React.ReactNode }> = ({ items, children }) => {
  const chat = useCouncilChatState(items);
  return <CouncilChatContext.Provider value={chat}>{children}</CouncilChatContext.Provider>;
};

function useCouncilChat(): CouncilChat {
  const chat = React.useContext(CouncilChatContext);
  if (!chat) throw new Error('Council chat needs a CouncilChatProvider above it.');
  return chat;
}

/** True once a question is asked or being planned in this conversation (the Agents panel then has something to show). */
export function useCouncilHasQuestion(): boolean {
  const { asked, choosing } = useCouncilChat();
  return Boolean(asked || choosing);
}

export const AskCouncilPanel: React.FC<{
  onOpenCountry: (item: LiveWatchlistItem) => void;
  onSendToReports: () => void;
  fullCouncil?: FullCouncilStep;
  /** "Uses:" line linking back to Workspace > Your inputs. */
  uses?: React.ReactNode;
  /** Shown in the side panel on other pages: no height cap, a Close button in the header. */
  onClose?: () => void;
  /** Workspace: the chat fills the page like an AI chat app, with the input box pinned at the bottom. */
  page?: boolean;
  /** Extra buttons for the chat's top bar (Workspace puts Briefing there). */
  toolbar?: React.ReactNode;
}> = ({ onOpenCountry, onSendToReports, fullCouncil, uses, onClose, page, toolbar }) => {
  const {
    items, question, setQuestion, scope, setScope, asked, past, lib, synthesis, writing, copied, choosing, docs, setDocs,
    debate, debating, extra, adding, runDebate, ask, addForQuestion, current, newConversation, changeDocs, copy, pinned, pinData,
  } = useCouncilChat();
  // Welcome suggestions from your holdings, watchlist moves and your last saved question (src/utils/chatSuggestions.ts).
  const suggestions = React.useMemo(
    () => chatSuggestions({ holdings: loadHoldings(), items, recent: lib.briefs, examples: EXAMPLES }),
    [items, lib.briefs],
  );
  /** Save to Reports: the answer becomes the council brief there, and each document is kept. Stays in the chat. */
  const saveAnswer = (b: SavedCouncilBrief | null, docs: CouncilDocument[]) => {
    if (!b) return;
    saveCouncilBrief(b);
    void lib.saveCouncilDocs(docs);
  };

  const fc = fullCouncil;
  const phase = fullCouncilPhase(fc);
  // On Workspace the agents sit in their own side panel (CouncilAgentsPanel), which does the polling.
  const steps = useCouncilProgress(page ? null : fc?.progressId ?? null, Boolean(!page && fc && (fc.isRunning || fc.isApproving)));
  const fullCouncilInChat = Boolean(fc && (phase !== 'idle' || fc.result));
  const busy = writing || choosing;
  // The council document open over the page, if any (a card in the chat opens it).
  const [openDoc, setOpenDoc] = useState<CouncilDocument | null>(null);
  const closeDoc = React.useCallback(() => setOpenDoc(null), []);
  const savedDocIds = useMemo(() => new Set(lib.councilDocs.map((d) => d.id)), [lib.councilDocs]);

  // Keep the newest message in view as the conversation grows.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [asked?.askedAt, past.length, choosing, writing, synthesis, debate, debating, phase]);

  const submit = () => void ask(question, asked ? 'followup' : 'new');

  const userMessage = (text: string, when?: string, key?: string) => (
    <div className="flex justify-end" key={key} data-chat-user="true">
      <div className="max-w-[85%] bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900 px-3 py-2">
        <p className="text-sm text-slate-900 dark:text-white whitespace-pre-wrap">{text}</p>
        {when && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 text-right">{time(when)}</p>}
      </div>
    </div>
  );

  /** Who wrote the AI text, and the sentences the checks removed. */
  const removedNotes = (t: Turn) => (
    <>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                AI {t.synthesis?.brief?.explain ? 'explanation' : 'summary'} by {t.synthesis?.provider || 'the configured model'}, from the agents’ figures only.
                {t.synthesis && t.synthesis.removed.length > 0 && ` ${t.synthesis.removed.length} sentence(s) removed because a number in them did not match any agent figure.`}
                {t.synthesis && (t.synthesis.contradicted?.length ?? 0) > 0 && ` ${t.synthesis.contradicted!.length} sentence(s) removed because they contradicted an agent's call.`}
              </p>
              {smallRefereeNote(t.synthesis?.provider) && (
                <p className="text-xs text-amber-800 dark:text-amber-300" data-council-small-referee="true">
                  <SettingsText text={smallRefereeNote(t.synthesis?.provider)!} />
                </p>
              )}
              {t.synthesis && (t.synthesis.contradicted?.length ?? 0) > 0 && (
                <details className="text-xs text-amber-800 dark:text-amber-300" data-council-contradicted="true">
                  <summary className="cursor-pointer">Show sentences that contradicted an agent</summary>
                  <ul className="list-disc pl-5 mt-1 space-y-1">
                    {t.synthesis.contradicted!.map((c) => (
                      <li key={c.sentence}>
                        “{c.sentence}” <span className="text-slate-600 dark:text-slate-400">{c.reason}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {t.synthesis && t.synthesis.removed.length > 0 && (
                <details className="text-xs text-slate-500 dark:text-slate-400">
                  <summary className="cursor-pointer">Show removed sentences</summary>
                  <ul className="list-disc pl-5 mt-1 space-y-0.5">
                    {t.synthesis.removed.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </details>
              )}
              {t.synthesis?.snapshot && <AnswerSnapshotDetails snapshot={t.synthesis.snapshot} runtimeConfig={runtimeConfig} />}
    </>
  );

  /** The council's answer to one question: summary first, then the agents, debate and downloads. */
  const councilReply = (t: Turn, live: boolean) => {
    const b = t.synthesis?.brief;
    const writingNow = live && writing;
    const debatingNow = live && debating;
    const savedT = toSaved(t, !debatingNow);
    const withFindings = t.asked.answers.filter((a) => a.findings.length).length;
    const docCtx = { question: t.asked.question, askedAt: t.asked.askedAt, scope: t.asked.plan.scopeNote, countriesAsked: t.asked.plan.countries.length };
    const agentDocs = toAgentDocuments(t.asked.answers, docCtx);
    const synthDoc = toSynthesisDocument(agentDocs, t.synthesis, docCtx);
    const allDocsSaved = !writingNow && [synthDoc, ...agentDocs].every((d) => savedDocIds.has(d.id));
    return (
      <div className="border-l-2 border-slate-300 dark:border-slate-600 pl-3 space-y-3" data-council-result={live ? 'true' : 'earlier'}>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          <span className="font-medium text-slate-700 dark:text-slate-200">Council</span> · about {t.asked.plan.scopeNote} · {time(t.asked.askedAt)}
        </p>

        {t.changes && (
          <div className="border border-slate-200 dark:border-slate-700 p-3 space-y-1" data-council-changes={t.changes.changes.length + t.changes.stanceChanges.length}>
            <div className="ui-label">
              What changed since your saved question of {t.changes.sinceAskedAt.slice(0, 16).replace('T', ' ')} UTC (“{t.changes.sinceQuestion}”)
            </div>
            <ul className="text-sm text-slate-800 dark:text-slate-200 space-y-0.5">
              {changeLines(t.changes).map((l, i) => (
                <li key={i} className={l.startsWith('- ') ? 'pl-3' : 'text-xs text-slate-500 dark:text-slate-400'}>
                  {l.replace(/^- /, '• ')}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-2" data-council-summary="true">
          {writingNow ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">The synthesis agent is writing the brief from the agents’ answers…</p>
          ) : b?.explain ? (
            <>
              <ExplainAnswer headline={b.headline} explain={b.explain} answers={t.asked.answers} />
              {removedNotes(t)}
            </>
          ) : b ? (
            <>
              {b.headline && <p className="text-sm font-medium text-slate-900 dark:text-white">{b.headline}</p>}
              {b.points.length > 0 && (
                <ul className="list-disc pl-5 text-sm text-slate-800 dark:text-slate-200 space-y-1">
                  {b.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              {b.disagreements.length > 0 && (
                <div>
                  <div className="ui-label mt-1">Where the agents disagree</div>
                  <ul className="list-disc pl-5 text-sm text-slate-800 dark:text-slate-200 space-y-1">
                    {b.disagreements.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}
              {removedNotes(t)}
            </>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-300" data-council-no-summary="true">
              No AI summary. <SettingsText text={t.synthesis?.reason || ''} /> Each agent’s document below stands on its own.
            </p>
          )}
        </div>

        {/* The Chart Agent's chart and test results, when the question asked for one. */}
        {t.asked.answers
          .filter((a) => a.chart)
          .map((a) => (
            <React.Suspense key={`chart-${t.asked.askedAt}`} fallback={<p className="text-xs text-slate-500 dark:text-slate-400">Drawing the chart…</p>}>
              <CouncilChartCard result={a.chart!} />
            </React.Suspense>
          ))}

        {/* Each agent's standard document, and the synthesis document, as cards that open the document. */}
        <DocumentCards
          agents={agentDocs}
          synthesis={writingNow ? null : synthDoc}
          writing={writingNow}
          onOpen={setOpenDoc}
          savedIds={savedDocIds}
          note={
            <span data-council-agents="true">
              {withFindings} of {t.asked.answers.length} {t.asked.answers.length === 1 ? 'agent' : 'agents'} answered with figures
            </span>
          }
        />
        {!page && (
          <details className="group">
            <summary className="cursor-pointer text-xs text-blue-700 dark:text-blue-300">Show the agent layout</summary>
            <div className="mt-2 space-y-2">
              <AgentNetwork title={`Agents on this question, about ${t.asked.plan.scopeNote}`} columns={askCouncilColumns(t.asked.answers, writingNow, t.synthesis, t.asked.plan.chosenBy)} />
              {t.asked.plan.chooserNote && (
                <p className="text-xs text-slate-500 dark:text-slate-400" data-council-chooser={t.asked.plan.chosenBy}>
                  {t.asked.plan.chooserNote}
                </p>
              )}
            </div>
          </details>
        )}

        {live && t.asked.plan.offWatchlistIso3 && t.asked.plan.offWatchlistIso3.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" data-council-off-watchlist="true">
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => void addForQuestion()}>
              Add {t.asked.plan.offWatchlist?.join(', ')} for this question
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400">Pulls its live figures and asks again; your watchlist stays as it is.</span>
            {adding && <span className="text-xs text-amber-700 dark:text-amber-400">{adding}</span>}
          </div>
        )}

        {(t.debate || (live && t.asked.answers.filter((a) => a.id !== 'doc' && a.findings.length).length >= 2)) && (
          <div className="border border-slate-200 dark:border-slate-700 p-3 space-y-2" data-council-debate="true">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="ui-label">Agent debate</div>
              {live && !t.debate && (
                <button type="button" className="ui-btn" onClick={() => void runDebate()} disabled={busy}>
                  Let the agents debate
                </button>
              )}
            </div>
            {!t.debate ? (
              <p className="text-sm text-slate-600 dark:text-slate-300">The agents challenge each other where their readings on a country pull different ways.</p>
            ) : t.debate.challenges.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-300">The agents do not pull different ways on these countries, so there is nothing to debate.</p>
            ) : (
              <>
                <ol className="space-y-3">
                  {t.debate.challenges.map((c, i) => {
                    const r = t.debate!.replies?.find((x) => x.index === i);
                    return (
                      <li key={`${c.iso3}-${c.from}-${c.to}`} className="text-sm space-y-1" data-debate-challenge={`${c.from}>${c.to}`}>
                        <div className="font-medium text-slate-900 dark:text-white">
                          {c.countryName}: the {c.fromName} Agent challenges the {c.toName} Agent
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{c.toName} Agent said: {c.claim}.</p>
                        <p className="text-slate-800 dark:text-slate-200">{c.challenge}</p>
                        <p className="text-xs text-slate-600 dark:text-slate-400">What would settle it: {c.settle}</p>
                        {r && (
                          <p className="border-l-2 border-blue-300 dark:border-blue-700 pl-2 text-slate-800 dark:text-slate-200" data-debate-reply="true">
                            <span className="text-slate-500 dark:text-slate-400">{c.toName} Agent replies: </span>
                            {r.reply}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
                {debatingNow ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">Asking the AI model for each agent’s reply…</p>
                ) : t.debate.replies ? (
                  <>
                    {t.debate.verdict && (
                      <p className="text-sm text-slate-900 dark:text-white">
                        <span className="text-slate-500 dark:text-slate-400">Where it lands: </span>
                        {t.debate.verdict}
                      </p>
                    )}
                    {!!t.debate.open?.length && (
                      <ul className="list-disc pl-5 text-sm text-slate-700 dark:text-slate-300">
                        {t.debate.open.map((o) => (
                          <li key={o}>{o}</li>
                        ))}
                      </ul>
                    )}
                    {!!t.debate.removed?.length && (
                      <details className="text-xs text-amber-700 dark:text-amber-400">
                        <summary className="cursor-pointer">{t.debate.removed.length} AI sentence(s) removed by the number or stance check</summary>
                        <ul className="list-disc pl-5 mt-1">
                          {t.debate.removed.map((x) => (
                            <li key={x}>{x}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Challenges from stated rules on the agents’ figures; replies written by the AI model{t.debate.provider ? ` (${t.debate.provider})` : ''} from those figures only.
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    No AI replies ({t.debate.reason || 'no AI model answered'}). The challenges come from stated rules on the agents’ figures.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* One row of actions for the whole answer: save it (brief + every document), copy, download. */}
        <div className="flex flex-wrap items-center gap-1.5" data-council-answer-actions="true">
          {allDocsSaved ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400" data-council-saved="true">
              <FileText className="w-3.5 h-3.5" /> Saved to Reports
              <button type="button" className="text-blue-700 dark:text-blue-300 hover:underline" onClick={onSendToReports}>
                Open Reports
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="ui-btn"
              disabled={writingNow || !savedT}
              onClick={() => saveAnswer(savedT, [synthDoc, ...agentDocs])}
              title="Keeps this answer and each document in Reports (data/local/research.json)"
              data-council-save="true"
            >
              <FileText className="w-3.5 h-3.5" /> Save to Reports
            </button>
          )}
          <button
            type="button"
            className="ui-btn ui-btn-ghost"
            disabled={writingNow}
            title="Turn this question into a step-by-step policy review in Reports"
            data-council-start-review="true"
            onClick={() => startPolicyReview({ iso3: t.asked.plan.countries.length === 1 ? t.asked.plan.countries[0].iso3 : undefined, problem: t.asked.question })}
          >
            <ClipboardList className="w-3.5 h-3.5" /> Start a policy review
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-ghost"
            disabled={writingNow}
            title="Log a trade idea from this answer in the idea journal; it is hashed and scored at the horizon"
            data-council-log-idea="true"
            onClick={() => openIdeaJournal({ iso3: t.asked.plan.countries.length === 1 ? t.asked.plan.countries[0].iso3 : undefined, thesis: [t.asked.question, t.synthesis?.brief?.headline].filter(Boolean).join('\n') })}
          >
            <NotebookPen className="w-3.5 h-3.5" /> Log idea
          </button>
          <button type="button" className="ui-btn ui-btn-ghost" onClick={() => void copy(savedT)} disabled={writingNow}>
            <Copy className="w-3.5 h-3.5" /> {copied === t.asked.askedAt ? 'Copied' : 'Copy'}
          </button>
          <details className="relative" data-council-download="true">
            <summary className={`ui-btn ui-btn-ghost list-none cursor-pointer ${writingNow ? 'pointer-events-none opacity-50' : ''}`}>
              <Download className="w-3.5 h-3.5" /> Download
            </summary>
            <div className="absolute z-20 mt-1 left-0 min-w-[10rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm py-1">
              <button type="button" className="block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800" onClick={(e) => { (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; void downloadCouncilBrief(savedT, 'md'); }}>
                Markdown (.md)
              </button>
              <button type="button" className="block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800" onClick={(e) => { (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; void downloadCouncilBrief(savedT, 'pdf'); }}>
                PDF
              </button>
            </div>
          </details>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">Open a document for every figure and its source. Research, not validated advice.</p>
      </div>
    );
  };

  return (
    <section
      className={`flex flex-col ${page ? 'h-full' : 'ui-panel'} ${onClose ? 'h-full' : ''}`}
      data-ask-council="true"
      data-council-layout={page ? 'page' : onClose ? 'dock' : 'card'}
      data-no-provenance-overlay="true"
      data-no-stat-ref="true"
    >
      <header className={`flex items-center justify-between gap-2 ${page ? 'pb-2' : 'ui-panel-header'}`}>
        <div className="min-w-0">
          <h3 className="ui-section-title whitespace-nowrap">Council chat</h3>
          {uses}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {(asked || fullCouncilInChat) && (
            <button type="button" className="ui-btn ui-btn-ghost" onClick={newConversation} disabled={busy} data-council-new="true" aria-label="New conversation">
              <span className="sm:hidden">New</span><span className="hidden sm:inline">New conversation</span>
            </button>
          )}
          {toolbar}
          {onClose && (
            <button type="button" className="ui-btn ui-btn-ghost" onClick={onClose} aria-label="Close Council chat" data-council-close="true">
              <X className="w-3.5 h-3.5" /> Close
            </button>
          )}
        </div>
      </header>

      <div ref={scrollRef} className={`overflow-y-auto ${page || onClose ? 'flex-1 min-h-0' : 'max-h-[70vh] min-h-[16rem]'}`} data-council-chat="true" aria-live="polite">
        <div className={`space-y-4 py-3 ${page ? 'max-w-3xl mx-auto px-1 sm:px-4' : 'px-4'}`}>
        {!asked && !choosing && !fullCouncilInChat && (
          <div className={page ? 'pt-[12vh] text-center space-y-4' : 'border-l-2 border-slate-300 dark:border-slate-600 pl-3 space-y-2'} data-council-welcome="true">
            <p className={page ? 'text-xl font-semibold text-slate-900 dark:text-white' : 'text-sm text-slate-800 dark:text-slate-200'}>
              What do you want to know about the Economy?
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Agents answer from the app’s own figures, each with its source; with an AI model, a summary agent writes a short brief from their answers only.
            </p>
            <div className={`flex flex-wrap gap-1.5 ${page ? 'justify-center' : ''}`}>
              {suggestions.map((sug) => (
                <button
                  key={sug.text}
                  type="button"
                  className="ui-pill"
                  disabled={busy}
                  onClick={() => void ask(sug.text, 'new')}
                  title={sug.why || undefined}
                  data-council-suggestion={sug.kind}
                >
                  {SUGGESTION_KIND_LABEL[sug.kind] && <span className="text-slate-500 dark:text-slate-400">{SUGGESTION_KIND_LABEL[sug.kind]} · </span>}
                  {sug.text}
                </button>
              ))}
            </div>
            <details className={`text-xs ${page ? 'mx-auto max-w-xl' : ''}`} data-council-chart-menu="true">
              <summary className="cursor-pointer text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">Charts and statistical tests</summary>
              <div className="mt-2 text-left space-y-1.5">
                <p className="text-slate-500 dark:text-slate-400">
                  Ask for a chart in words, such as “chart Brazil’s policy rate against inflation and test which moves first”. The Chart Agent draws the series the app holds and can run correlation, regression, lead/lag, Granger, stationarity (ADF) and trend (HP filter) tests. To compare countries, ask for a scatter, such as “scatter government debt against bond yields across countries”. Or start from one of these:
                </p>
                <ul className="space-y-1">
                  {PRESETS.map((p) => (
                    <li key={p.id}>
                      <button type="button" className="text-left hover:underline disabled:opacity-50" disabled={busy} onClick={() => void ask(`Chart the ${p.name}`, 'new')} data-council-preset={p.id}>
                        <span className="font-medium text-slate-800 dark:text-slate-200">{p.name}</span>
                        <span className="text-slate-500 dark:text-slate-400">: {p.about}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          </div>
        )}

        {past.map((t) => (
          <React.Fragment key={t.asked.askedAt}>
            {userMessage(t.asked.question, t.asked.askedAt)}
            {councilReply(t, false)}
          </React.Fragment>
        ))}

        {asked && current && (
          <>
            {userMessage(asked.question, asked.askedAt, 'q-live')}
            {extra.length > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400">Added for questions in this session, not on your watchlist: {extra.map((e) => e.countryName).join(', ')}.</p>
            )}
            {councilReply(current, true)}
          </>
        )}

        {choosing && (
          <p className="text-sm text-slate-500 dark:text-slate-400" data-council-choosing="true">
            Asking the AI model which agents should answer…
          </p>
        )}

        {fc && fullCouncilInChat && (
          <>
            {userMessage(`Run the full council on ${fc.countryName}`)}
            <div className="border-l-2 border-slate-300 dark:border-slate-600 pl-3 space-y-3" data-full-council={fc.stage}>
              <p className="text-xs text-slate-500 dark:text-slate-400"><span className="font-medium text-slate-700 dark:text-slate-200">Full council</span> · {fc.countryName}</p>
              {!page && fc.progressId && phase !== 'idle' && (
                <AgentNetwork
                  title={`Full council on ${fc.countryName}`}
                  columns={fullCouncilColumns(steps, phase)}
                  footnote="Each desk’s three analysts and its devil’s advocate debate run as one model call, so they finish together."
                />
              )}
              {fc.stage === 'AWAITING_CRO_APPROVAL' ? (
                <CouncilApprovalCard
                  countryName={fc.countryName}
                  deskState={fc.deskState}
                  draft={fc.draft}
                  isApproving={fc.isApproving}
                  onApprove={fc.onApprove}
                  onChangeDraft={fc.onChangeDraft}
                  onOpenFullReview={fc.onOpenFullReview}
                />
              ) : fc.isRunning ? (
                <p className="text-sm text-slate-700 dark:text-slate-300">The desks are working. The council will pause here for your approval before the final report.</p>
              ) : fc.isApproving ? (
                <p className="text-sm text-slate-700 dark:text-slate-300">Assumptions approved. The supreme council is writing the final {fc.countryName} report.</p>
              ) : fc.result ? (
                <div className="space-y-1" data-full-council-result="true">
                  <div className="ui-label">Final report {fc.result.reportId}</div>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {fc.countryName}: {VERDICT[fc.result.verdict] || fc.result.verdict}
                  </p>
                  <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{fc.result.summary}</p>
                  <FigureCheckNote check={fc.result.figureCheck?.desks} what="desk debates" />
                  <FigureCheckNote check={fc.result.figureCheck?.report} what="final report" />
                  {fc.result.timing && <CouncilTimingNote timing={fc.result.timing} />}
                  {fc.onOpenFullReview && (
                    <button type="button" className="ui-btn" onClick={fc.onOpenFullReview}>
                      Open the full report
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          </>
        )}
        </div>
      </div>

      <form
        className={page ? 'w-full max-w-3xl mx-auto pt-2 pb-1 space-y-2' : 'px-4 py-3 border-t border-slate-100 dark:border-slate-800 space-y-2'}
        data-council-composer="true"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {asked && !busy && (
          <div className="flex flex-wrap gap-1.5" data-council-followup="true">
            {suggestFollowUps(asked.plan, asked.answers).map((sug) => (
              <button key={sug} type="button" className="ui-pill" onClick={() => void ask(sug, 'followup')}>
                {sug}
              </button>
            ))}
          </div>
        )}
        <label htmlFor="council-question" className="sr-only">
          {asked ? 'Follow-up question' : 'Question'}
        </label>
        <div className={`flex gap-2 items-end ${page ? 'p-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm' : ''}`}>
          <textarea
            id="council-question"
            rows={2}
            maxLength={500}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={asked ? 'Ask a follow-up, for example: and the currency? or what about Egypt?' : "For example: Is Turkey's central bank behind the curve, and what would a Hormuz closure do?"}
            className={`flex-1 min-w-0 px-2 py-1.5 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white ${page ? 'border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none' : 'border border-slate-200 dark:border-slate-700'}`}
          />
          <button type="submit" className="ui-btn ui-btn-primary" disabled={!question.trim() || busy}>
            Send
          </button>
        </div>
        {pinned && (
          <p className="text-xs text-slate-500 dark:text-slate-400" data-council-pinned="true">
            Figures pinned at {new Date(pinned.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}: answers in this conversation use them even if the feeds refresh.{' '}
            <button type="button" className="underline hover:text-slate-800 dark:hover:text-slate-200" onClick={() => pinData(false)}>
              Use the latest figures
            </button>
          </p>
        )}
        <details className="group" data-council-options="true">
          <summary className="cursor-pointer select-none text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">
            Options: countries, policy documents, full council{lib.briefs.length ? ', saved research' : ''}
            {docs.length ? ` · ${docs.length} document${docs.length === 1 ? '' : 's'} in use` : ''}
          </summary>
          <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {!asked && (
            <label className="ui-label flex items-center gap-1.5">
              <span>Countries</span>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="px-1.5 py-1 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white max-w-[14rem]"
              >
                <option value="">As named, else all</option>
                {items.map((i) => (
                  <option key={i.iso3} value={i.iso3}>
                    {i.countryName}
                  </option>
                ))}
              </select>
            </label>
          )}
          {fc && !fc.isRunning && !fc.isApproving && fc.stage !== 'AWAITING_CRO_APPROVAL' && (
            <button type="button" className="ui-btn" onClick={fc.onRun} title={`Nine desk agents debate ${fc.countryName} (the country open now); it pauses in this chat for your approval before the final report.`}>
              {fc.result ? `Run the full council on ${fc.countryName} again` : `Run the full council on ${fc.countryName}`}
            </button>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={Boolean(pinned)} onChange={(e) => pinData(e.target.checked)} disabled={busy} data-council-pin="true" />
          Pin this conversation to the figures held now (each answer records it in its snapshot)
        </label>
        <PolicyDocsPicker docs={docs} onChange={changeDocs} disabled={busy} />
        <SavedDocsRow lib={lib} activeIds={docs.map((d) => d.id)} canAdd={docs.length < MAX_DOCS && !busy} onUse={(d) => setDocs((cur) => (cur.some((x) => x.id === d.id) || cur.length >= MAX_DOCS ? cur : [...cur, d]))} />
            <SavedResearchList lib={lib} toMarkdown={toMarkdown} onSendToReports={onSendToReports} />
          </div>
        </details>
      </form>
      {openDoc && <DocumentViewer doc={openDoc} items={items} onOpenCountry={(it) => { setOpenDoc(null); onOpenCountry(it); }} onClose={closeDoc} actions={<SaveToReportsButton saved={savedDocIds.has(openDoc.id)} onSave={() => void lib.saveCouncilDocs([openDoc])} />} />}
    </section>
  );
};

/**
 * Workspace > Agents: the agents on the latest question (and the full council, when one runs),
 * each with its live status, beside the chat instead of inside it. Statuses are the same ones
 * the chat used to show: from the browser for Council chat, from the server for the full council.
 */
export const CouncilAgentsPanel: React.FC<{ fullCouncil?: FullCouncilStep }> = ({ fullCouncil: fc }) => {
  const { asked, synthesis, writing, choosing } = useCouncilChat();
  const phase = fullCouncilPhase(fc);
  const steps = useCouncilProgress(fc?.progressId ?? null, Boolean(fc && (fc.isRunning || fc.isApproving)));
  const showFull = Boolean(fc?.progressId && phase !== 'idle');
  return (
    <div className="space-y-4" data-council-agents-panel="true">
      {choosing && (
        <p className="text-sm text-slate-500 dark:text-slate-400" data-agents-choosing="true">
          Asking the AI model which agents should answer…
        </p>
      )}
      {asked && !choosing && (
        <div className="space-y-2" data-agents-question="true">
          <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2" title={asked.question}>
            “{asked.question}”
          </p>
          <AgentNetwork
            stacked
            title={`About ${asked.plan.scopeNote}`}
            columns={askCouncilColumns(asked.answers, writing, synthesis, asked.plan.chosenBy)}
          />
          {asked.plan.chooserNote && (
            <p className="text-xs text-slate-500 dark:text-slate-400" data-council-chooser={asked.plan.chosenBy}>
              {asked.plan.chooserNote}
            </p>
          )}
        </div>
      )}
      {fc && showFull && (
        <AgentNetwork
          stacked
          title={`Full council on ${fc.countryName}`}
          columns={fullCouncilColumns(steps, phase)}
          footnote="Each desk’s three analysts and its devil’s advocate debate run as one model call, so they finish together."
        />
      )}
      {!asked && !choosing && !showFull && (
        <p className="text-sm text-slate-500 dark:text-slate-400" data-agents-empty="true">
          No question yet. When you ask one, the agents that answer show here, each with its live status.
        </p>
      )}
    </div>
  );
};
