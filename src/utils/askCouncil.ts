/**
 * Council chat: a question goes to the desk agents that cover it, each answers only from the
 * figures the app already holds, and a synthesis agent may then write a short brief from those
 * answers alone.
 *
 * - The AI model picks the agents when one is set up (applyAgentChoice); otherwise stated keyword
 *   rules do. Either way the reason each agent was asked is shown.
 * - Agents are deterministic: every figure keeps its source and its tag (Live data, Official,
 *   Your document, or the agent's own model reading). A figure that is not from a live feed, an
 *   official series or your own file never reaches the council: its finding is left out and the
 *   gap says why (keepSourcedFindings).
 * - The synthesis (server side, Gemini or Ollama) is checked here: any sentence with a number
 *   that does not trace back to an agent's figures is removed and listed.
 */
import { hcSpreadMissing, hcSpreadWhen } from './hardCurrencySpread';
import { CDS_HIDDEN } from './cdsHidden';
import { isCitable, References } from './citations';
import { taylorCheck, taylorMethod, taylorSentence } from './taylorRule';
import { TIMING_AGENT_NAME, timingAgent } from './timingAgent';
import { oddsMoveText } from './oddsMoves';
import type { LiveWatchlistItem } from '../types/council';
import { upcomingOfficialEvents, dateKindLabel } from '../data/officialCalendar';
import { INFLATION_TARGETS, policyStance, realYield, targetSource } from './marketsMacro';
import { missingReason } from './liveFigures';
import { carrySignal, cdsTag, cpiTag, fxValueSignal, policySignal, policyTag, yieldTag, type Quality } from './divergences';
import { carryToVol, effrSourceText, reerLabel } from './fxValuation';
import { TIC_LABEL, formatMonth, ticSentence, ticTrend } from './ticHoldings';
import { CLI_LABEL, cliMissing, cliSentence } from './oecdCli';
import { IMF_BOP_LABEL, IMF_RESERVES_LABEL, formatImfPeriod, imfSentence, reserveCover } from './imfReserves';
import { cpiSentence } from './oecdInflation';
import { describeAge, staleFigures } from './freshness';
import { COFER_CCY_BY_ISO3, ccyName } from './imfCofer';
import { CFTC_LABEL, cftcMissing, ordinal, positioningLabel, positioningSentence } from './cftcPositioning';
import { SCENARIOS, scenarioImpact, type ScenarioId } from './scenarioExposure';
import { formatPeriod } from './officialYields';
import { contradiction, DIM_LABEL, policyCall, type Contradiction, type Stance } from './stanceCheck';
import { searchDocs, type PolicyDoc } from './policyDocs';
import { MEASURE_LABEL, TOLERANCE, compareClaims, extractClaims, fmtMeasure } from './docFigureCheck';
import { claimAnswer } from './claimCheck';
import { ucdpFigures, ucdpMissing } from './ucdpConflict';
import { v1Figures, v1Missing } from './gdeltDaily';
import { GDELT_SHORT, POLYMARKET_SHORT, STABILITY_RULE, TONE_RULE, WGI_SHORT, formatUsd, rawGdeltFigures, acledFigures, stabilityBand, toneBand } from './politicsEvents';
import { BIS_SECURITIES_SHORT, IDS_SHORT, QEDS_SHORT, WEO_LABEL, coverLabel, debtPath, formatQuarter, stabilisingPrimaryBalance } from './fiscalDebt';
import { TNM_CITATION, multiplierView } from './fiscalMultipliers';
import { ISO_NUMERIC_TO_ISO3 } from '../data/worldCountries';
import type { DebateResult } from './agentDebate';
import { changeLines } from './whatChanged';
import { carryChart, chartFinding, chartFollowUps, chartRequest, seriesInQuestion, testsInQuestion, type ChartRequest, type ChartResult } from './councilChart';

/** Desk agents the planner (or the AI model) can pick. */
export type CoreAgentId = 'cb' | 'fiscal' | 'politics' | 'rv' | 'fx' | 'spill' | 'calendar' | 'timing';
/** 'doc' = the Policy Document Agent, asked whenever you have added documents; 'chart' = the Chart Agent, when a chart or test is asked for; 'forecast' = the app's nowcasts and forecasts (src/utils/forecastAgent.ts). */
export type AgentId = CoreAgentId | 'doc' | 'chart' | 'forecast' | 'claim';
export type FigureTag = Quality | 'official' | 'model' | 'document';

export interface AgentFigure {
  label: string;
  value: string;
  source: string;
  tag: FigureTag;
}

export interface AgentFinding {
  iso3: string;
  countryName: string;
  /** One or two sentences, built from the figures below by stated rules. */
  reading: string;
  figures: AgentFigure[];
  /** How notable the reading is, 0 to 1, used to keep the strongest when many countries answer. */
  weight: number;
  /** The agent's call in fixed words (tight / neutral / loose, cheap / rich, strong / weak); the summary may not contradict it. */
  stance?: Stance[];
}

export interface AgentAnswer {
  id: AgentId;
  name: string;
  /** Why the planner asked this agent. */
  why: string;
  findings: AgentFinding[];
  /** What the agent could not answer, in words. */
  missing: string[];
  /** The Chart Agent's chart and test results (src/utils/councilChart.ts). */
  chart?: ChartResult;
}

export const COUNCIL_AGENTS: Record<CoreAgentId, { name: string; covers: string; topic: RegExp }> = {
  cb: {
    name: 'Central Bank Watcher',
    covers: 'inflation against target (OECD monthly where published), policy rate, real rates, official reserves and import cover, current account (IMF)',
    topic: /central bank|monetary|reserves?\b|import cover|balance of payments|\bbop\b|current account|external (?:position|balance|financing)|policy rate|interest rate|(?<!exchange )\brates?\b|inflation|\bcpi\b|hike|\bcuts?\b|easing|tightening|behind the curve|real rate|real yield|target/i,
  },
  fiscal: {
    name: 'Fiscal & Debt',
    covers: 'government debt and the IMF projection of it, primary balance and the balance that would hold debt steady, external debt falling due in the next year and how far reserves cover it (IMF WEO, World Bank QEDS and IDS, BIS)',
    topic: /\bdebt|fiscal|deficit|primary (?:balance|surplus)|sustainab|solvenc|amorti[sz]|refinanc|roll-?over|maturit|eurobond|debt service|borrowing|austerity|consolidation|imf program/i,
  },
  politics: {
    name: 'Politics & Events',
    covers: 'news tone and the latest headlines (GDELT, weekly), weekly event counts (protests, sanctions, violence) and economic themes in the news (GDELT raw files), political stability rank (World Bank governance indicators), prediction-market odds on contracts that name the country (Polymarket)',
    topic: /politic|election|\bvot(?:e|es|ing|ers?)\b|protest|unrest|\briots?\b|\bstrikes?\b|\bcoup|cabinet|parliament|congress|president|prime minister|\bministers?\b|populis|governance|instability|\bnews\b|headline|sentiment|\btone\b|polymarket|prediction market|\bodds\b|betting|violence/i,
  },
  rv: {
    name: 'Relative Value',
    covers: CDS_HIDDEN ? 'USD bond spread over Treasuries, real 10Y yield against risk peers, carry over the US rate' : 'CDS against risk peers, carry over the US rate',
    topic: /\bcds\b|spread|cheap|rich|\bvalue\b|valuation|bonds?|yields?|carry|priced|pricing|relative|default|credit/i,
  },
  fx: {
    name: 'FX Valuation',
    covers: 'real exchange rate against its 10-year average, FX volatility, CFTC futures positioning, US Treasury holdings (TIC), the currency\'s share of world reserves (IMF COFER)',
    topic: /\bfx\b|currenc|exchange rate|\breer\b|positioning|\bcftc\b|crowded|speculat|hedge funds?|\btic\b|\bcofer\b|reserve currenc|de-?dollari|treasur(?:y|ies) holdings|holdings of (?:us )?treasur|reserve manag|lira|rand|peso|rupiah|zloty|pound|sterling|\byen\b|devalu|deprecia|apprecia|volatil/i,
  },
  spill: {
    name: 'Global Spillover',
    covers: 'Hormuz, Taiwan Strait and Russia shocks through trade; growth cycle from the OECD leading indicator',
    topic: /hormuz|taiwan|china|russia|ukrain|\boil\b|energy|gulf|iran|shock|spillover|scenario|trade|\bwar\b|sanction|conflict|geopolit|leading indicator|\bcli\b|\boecd\b|growth|cycle|slowdown|recession|downturn|recovery|momentum/i,
  },
  calendar: {
    name: 'Calendar',
    covers: 'rate decisions, CPI releases, elections, budget deadlines, IMF dates',
    topic: /\bwhen\b|\bnext\b|calendar|election|budget|\bimf\b|\bdates?\b|upcoming|meeting|decision|catalyst|deadline|this (?:week|month|year)|coming/i,
  },
  timing: {
    name: TIMING_AGENT_NAME,
    covers: 'when a trend or shock could play out: dated catalysts, policy and business cycle turns, crowded positioning starting to unwind (CFTC), news tone shifts (GDELT), Treasury flows (TIC), 3-month yield moves',
    topic: /timing|how soon|\bwhen (?:could|will|would|might|does|do|is)\b|turning point|\bturn(?:s|ed|ing)?\b|shocks?\b|trigger|unwind|crowded|momentum|\btrend|\bcycle|what could (?:change|move)|catalyst/i,
  },
};

export const AGENT_ORDER: CoreAgentId[] = ['cb', 'fiscal', 'politics', 'rv', 'fx', 'spill', 'calendar', 'timing'];
export const TAG_LABEL: Record<Exclude<FigureTag, 'model'>, string> = {
  live: 'Live data',
  official: 'Official',
  estimate: 'AI estimate',
  sample: 'Sample data',
  document: 'Your document',
};
export const tagLabel = (tag: FigureTag, agent: string) => (tag === 'model' ? `${agent} Agent` : TAG_LABEL[tag]);

/** Other names people use for countries, matched in any letter case. */
const ALIASES: Record<string, string[]> = {
  TUR: ['turkiye', 'türkiye', 'turkey'],
  GBR: ['britain', 'united kingdom', 'great britain'],
  ZAF: ['south africa'],
  USA: ['united states', 'america'],
  KOR: ['korea'],
  CIV: ["cote d'ivoire", 'côte d’ivoire', 'ivory coast'],
  CZE: ['czech republic'],
  ARE: ['uae'],
  COD: ['democratic republic of the congo', 'drc'],
};
/** Short forms matched only in capitals, so "tell us" or "sa" in a sentence do not name a country. */
const CAPS_ALIASES: Record<string, string[]> = {
  GBR: ['UK'],
  USA: ['US', 'USA'],
  ZAF: ['SA'],
};

const namePattern = (n: string) => new RegExp(`(^|[^\\p{L}])${escapeRe(n)}($|[^\\p{L}])`, 'iu');
const capsPattern = (n: string) => new RegExp(`(^|[^\\p{L}])${escapeRe(n)}($|[^\\p{L}])`, 'u');

function namesCountry(question: string, iso3: string, name: string, byCode = true): boolean {
  const names = [baseName(name), ...(ALIASES[iso3] || [])];
  if (names.some((n) => namePattern(n).test(question))) return true;
  if ((CAPS_ALIASES[iso3] || []).some((n) => capsPattern(n).test(question))) return true;
  return byCode && new RegExp(`\\b${iso3}\\b`).test(question);
}

const baseName = (n: string) => n.replace(/\s*\(.*\)\s*$/, '').trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface CouncilPlan {
  countries: LiveWatchlistItem[];
  /** How the countries were picked, in words. */
  scopeNote: string;
  agents: Array<{ id: CoreAgentId; why: string }>;
  /** Who picked the agents: the AI model, or word matching in the question (the default). */
  chosenBy?: 'ai' | 'words';
  /** Why word matching was used when the AI was asked, or which model picked. */
  chooserNote?: string;
  /** Countries the question named that are not on the watchlist (no figures, so not asked about). */
  offWatchlist?: string[];
  /** Their ISO3 codes, so the app can offer to add them for this question. */
  offWatchlistIso3?: string[];
  /** A chart and statistical tests asked for in the question (the Chart Agent answers it). */
  chart?: ChartRequest;
  /** Explain mode (src/utils/explain.ts): the lenses to explain through, and the figure pointed at. */
  explain?: import('./explain').ExplainPlan;
}

/** Countries named in the question (by name, ISO code or a common alias). */
export function countriesInQuestion(question: string, items: LiveWatchlistItem[]): LiveWatchlistItem[] {
  return items.filter((it) => namesCountry(question, it.iso3, it.countryName));
}

/** Countries named in the question that are not on the watchlist, with their codes. */
export function offWatchlistCodes(question: string, items: LiveWatchlistItem[]): Array<{ iso3: string; name: string }> {
  const on = new Set(items.map((i) => i.iso3));
  const out: Array<{ iso3: string; name: string }> = [];
  const seen = new Set<string>();
  for (const { iso3, name } of Object.values(ISO_NUMERIC_TO_ISO3)) {
    if (on.has(iso3) || seen.has(iso3)) continue;
    // Codes are not matched here: "ARE" or "CAN" in a capitalised question is not a country.
    if (namesCountry(question, iso3, name, false)) {
      seen.add(iso3);
      out.push({ iso3, name });
    }
  }
  // "Papua New Guinea" also contains "Guinea": keep the longer name only.
  const all = [...out.map((o) => o.name), ...items.filter((i) => namesCountry(question, i.iso3, i.countryName)).map((i) => baseName(i.countryName))];
  return out.filter((o) => !all.some((m) => m !== o.name && m.toLowerCase().includes(o.name.toLowerCase())));
}

/** Countries named in the question that are not on the watchlist, so the agents hold no figures for them. */
export function offWatchlistCountries(question: string, items: LiveWatchlistItem[]): string[] {
  return offWatchlistCodes(question, items).map((o) => o.name);
}

const listNames = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** The words shown for countries left out because they are not on the watchlist. */
export function offWatchlistNote(names: string[]): string {
  const verb = names.length === 1 ? 'is' : 'are';
  return `${listNames(names)} ${verb} not on the watchlist, so the agents hold no figures for ${names.length === 1 ? 'it' : 'them'} yet. Use "Add for this question" to pull ${names.length === 1 ? 'its' : 'their'} figures and ask again`;
}

/** "the whole watchlist (5 countries) and 1 benchmark market": benchmarks are counted apart, so the number matches the watchlist. */
export function wholeListNote(items: Array<{ isBenchmark?: boolean }>): string {
  const bench = items.filter((i) => i.isBenchmark).length;
  const own = items.length - bench;
  const base = `the whole watchlist (${own} ${own === 1 ? 'country' : 'countries'})`;
  return bench ? `${base} and ${bench} benchmark ${bench === 1 ? 'market' : 'markets'}` : base;
}

/** Which agents answer and for which countries. `scopeIso3` = a country picked in the box, overriding the question. */
export function planCouncil(question: string, items: LiveWatchlistItem[], scopeIso3?: string): CouncilPlan {
  const picked = scopeIso3 ? items.filter((i) => i.iso3 === scopeIso3) : [];
  const named = picked.length ? [] : countriesInQuestion(question, items);
  const offCodes = picked.length ? [] : offWatchlistCodes(question, items);
  const off = offCodes.map((o) => o.name);
  // A question about countries off the watchlist only gets no countries, never the whole watchlist.
  const countries = picked.length ? picked : named.length ? named : off.length ? [] : items;
  const baseNote = picked.length
    ? `${picked[0].countryName}, picked in the box`
    : named.length
      ? `${named.map((n) => baseName(n.countryName)).join(', ')}, named in the question`
      : off.length
        ? 'no country on the watchlist'
        : `${wholeListNote(items)}, as no country was named`;
  const scopeNote = off.length ? `${baseNote}. ${offWatchlistNote(off)}` : baseNote;

  const agents: CouncilPlan['agents'] = [];
  for (const id of AGENT_ORDER) {
    const m = question.match(COUNCIL_AGENTS[id].topic);
    if (m) agents.push({ id, why: `the question mentions "${m[0].trim()}"` });
  }
  const chart = chartRequest(question, countries, picked.length > 0 || named.length > 0) ?? undefined;
  // A chart question with no desk topic is answered by the Chart Agent alone, not by every agent.
  if (!agents.length && !chart) {
    for (const id of AGENT_ORDER) agents.push({ id, why: 'no specific topic in the question, so every agent answers' });
  }
  return { countries, scopeNote, agents, ...(chart ? { chart } : {}), ...(off.length ? { offWatchlist: off, offWatchlistIso3: offCodes.map((o) => o.iso3) } : {}) };
}

/* ------------------------------------------------------------------------------------------
 * Follow-up questions (Sam, 2026-11-05). A follow-up keeps the last question's countries when it
 * names none, and the last question's agents when it names no topic, so "and the currency?" or
 * "what about Egypt?" mean what they would in conversation.
 * ------------------------------------------------------------------------------------------ */

export const CARRIED = 'carried over from your last question';

export function planFollowUp(question: string, prev: CouncilPlan, items: LiveWatchlistItem[], scopeIso3?: string): CouncilPlan {
  const plan = planCouncil(question, items, scopeIso3);
  const named = Boolean(scopeIso3) || countriesInQuestion(question, items).length > 0 || Boolean(plan.offWatchlist?.length);
  const namesTopic = AGENT_ORDER.some((id) => COUNCIL_AGENTS[id].topic.test(question));
  // Charts: a follow-up that names its own series makes a new chart; otherwise one about the last
  // chart ("is it stable?", "what about Mexico?") keeps its series and adds the tests it asks for.
  const ownChart = plan.chart && (seriesInQuestion(question).length || plan.chart.preset) ? plan.chart : undefined;
  // "What does this mean for policy?" names a desk topic but is still about the chart: keep it beside the desk agents.
  const refersBack = /\b(this|that|it|these|those|the chart|the results?|the gap)\b/i.test(question);
  const aboutChart = Boolean(prev.chart) && (testsInQuestion(question).length > 0 || !namesTopic || refersBack);
  const chart = ownChart ?? (aboutChart && prev.chart ? carryChart(question, prev.chart, named ? plan.countries : undefined) : plan.chart);
  const chartOnly = Boolean(chart) && !namesTopic && aboutChart;
  return {
    countries: named ? plan.countries : prev.countries,
    scopeNote: named ? plan.scopeNote : `${prev.scopeNote}, ${CARRIED}`,
    agents: namesTopic ? plan.agents : chartOnly && !prev.agents.length ? [] : prev.agents.map((a) => ({ id: a.id, why: `${CARRIED} (${a.why})` })),
    ...(chart ? { chart } : {}),
    ...(named && plan.offWatchlist ? { offWatchlist: plan.offWatchlist, ...(plan.offWatchlistIso3 ? { offWatchlistIso3: plan.offWatchlistIso3 } : {}) } : {}),
  };
}

/** Questions for the agents not yet asked, about the same countries. */
const FOLLOW_UP: Record<CoreAgentId, string> = {
  cb: 'How does inflation compare with the policy rate?',
  fiscal: 'Is the debt on a rising path, and what falls due next year?',
  politics: 'What is the news tone, and what do prediction markets say?',
  rv: CDS_HIDDEN ? 'Are its bonds cheap or rich against peers?' : 'Is CDS cheap or rich against peers?',
  fx: 'Is the currency strong or weak for its history?',
  spill: 'How exposed are they to a Hormuz closure?',
  calendar: 'What dates are coming up?',
  timing: 'What could change soon, and when?',
};

export function suggestFollowUps(plan: CouncilPlan, answers: AgentAnswer[]): string[] {
  const asked = new Set(plan.agents.map((a) => a.id));
  // After a chart, the next tests to run come first.
  if (plan.chart) return chartFollowUps(plan.chart).slice(0, 3);
  const out = AGENT_ORDER.filter((id) => !asked.has(id)).map((id) => FOLLOW_UP[id]);
  // When one country stands out, offer to look at it alone.
  const top = answers.flatMap((a) => a.findings).filter((f) => !isDocFinding(f)).sort((x, y) => y.weight - x.weight)[0];
  if (top && plan.countries.length > 1 && top.weight > 0) out.unshift(`What about ${baseName(top.countryName)} on its own?`);
  return out.slice(0, 3);
}

/** Earlier turns, for the synthesis prompt: the question and the summary's headline only. */
export interface EarlierTurn {
  question: string;
  headline?: string;
}

export function earlierAsText(earlier: EarlierTurn[]): string {
  if (!earlier.length) return '';
  return [
    'Earlier in this conversation (context only; every number you write must still come from the findings below):',
    ...earlier.slice(-4).map((t) => `- Q: ${t.question.slice(0, 300)}${t.headline ? ` A: ${t.headline.slice(0, 300)}` : ''}`),
    '',
  ].join('\n');
}

/* ------------------------------------------------------------------------------------------
 * AI-chosen agents (Sam, 2026-11-05). The AI model reads the question and picks which agents
 * answer, with a reason for each. It only picks agents: countries still come from the question
 * or the box, and the agents still answer from app data. If no model answers, or it names no
 * valid agent, word matching decides as before and the panel says so.
 * ------------------------------------------------------------------------------------------ */

export const AGENT_CHOICE_INSTRUCTION = [
  'You route a policy research question to the agents best placed to answer it.',
  'Pick only from the agents listed, by id. Pick the fewest that cover the question, usually one to three.',
  'Give each a short reason in plain words (under 20 words) that names what in the question it answers.',
  'Do not answer the question and do not write any numbers.',
].join(' ');

export function agentChoicePrompt(question: string, earlier: EarlierTurn[] = []): string {
  return [
    'Agents:',
    ...AGENT_ORDER.map((id) => `- ${id}: ${COUNCIL_AGENTS[id].name} Agent, covers ${COUNCIL_AGENTS[id].covers}`),
    '',
    ...(earlier.length ? ['Earlier questions in this conversation:', ...earlier.slice(-4).map((t) => `- ${t.question.slice(0, 300)}`), ''] : []),
    `Question: ${question.slice(0, 500)}`,
  ].join('\n');
}

export interface AgentChoiceResult {
  /** The model's picks, unchecked; null when no model answered. */
  agents: Array<{ id: string; why: string }> | null;
  provider?: string;
  reason?: string;
}

/** Use the model's picks when at least one names a real agent; otherwise keep the word-matched plan. */
export function applyAgentChoice(plan: CouncilPlan, choice: AgentChoiceResult | null): CouncilPlan {
  const seen = new Set<CoreAgentId>();
  const picked: CouncilPlan['agents'] = [];
  for (const a of choice?.agents || []) {
    const id = String(a?.id || '').trim().toLowerCase() as CoreAgentId;
    if (!AGENT_ORDER.includes(id) || seen.has(id)) continue;
    seen.add(id);
    const why = String(a?.why || '').replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim().slice(0, 200);
    picked.push({ id, why: why ? `the AI model judged: ${why}` : 'the AI model picked it' });
  }
  if (picked.length) {
    picked.sort((x, y) => AGENT_ORDER.indexOf(x.id) - AGENT_ORDER.indexOf(y.id));
    return { ...plan, agents: picked, chosenBy: 'ai', chooserNote: `Agents picked by the AI model${choice?.provider ? ` (${choice.provider})` : ''}.` };
  }
  const why = choice?.agents ? 'the AI model named no agent on the list' : choice?.reason || 'no AI model answered';
  return { ...plan, chosenBy: 'words', chooserNote: `Agents picked by matching words in the question, as ${why}.` };
}

/* ------------------------------------------------------------------------------------------ */

const p1 = (v: number) => `${v.toFixed(1)}%`;
const p2 = (v: number) => `${v.toFixed(2)}%`;
const sgn = (v: number, d = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;
const MAX_FINDINGS = 6;

/** IMF reserves and balance-of-payments figures for the council, each with its series and period. */
export function imfFigures(it: LiveWatchlistItem): { figures: AgentFigure[]; reading: string; weight: number } {
  const e = it.imf;
  if (!e || (!e.reserves && !e.currentAccount)) return { figures: [], reading: '', weight: 0 };
  const figures: AgentFigure[] = [];
  let weight = 0;
  if (e.reserves) {
    figures.push({ label: 'Official reserves', value: `$${e.reserves.usdBn.toFixed(1)}bn`, source: `${IMF_RESERVES_LABEL}, ${formatImfPeriod(e.reserves.period)}`, tag: 'official' });
    if (e.reserves.change12mPct !== undefined) {
      figures.push({ label: 'Reserves, change over 12 months', value: `${sgn(e.reserves.change12mPct)}%`, source: `IMF IL, to ${formatImfPeriod(e.reserves.period)}`, tag: 'official' });
    }
  }
  if (e.monthsOfImports !== undefined && e.imports4q) {
    figures.push({
      label: 'Reserves in months of imports',
      value: `${e.monthsOfImports.toFixed(1)} months (${reserveCover(e.monthsOfImports)})`,
      source: `IMF reserves over IMF BOP imports, four quarters to ${formatImfPeriod(e.imports4q.through)}; under 3 = thin, 3 to 6 = adequate, over 6 = ample`,
      tag: 'model',
    });
    if (e.monthsOfImports < 3) weight = Math.max(weight, Math.min(1, (3 - e.monthsOfImports) / 3 + 0.4));
  }
  if (e.currentAccount4q?.pctGdp !== undefined) {
    figures.push({
      label: 'Current account, last four quarters',
      value: `${sgn(e.currentAccount4q.pctGdp)}% of GDP`,
      source: `${IMF_BOP_LABEL} to ${formatImfPeriod(e.currentAccount4q.through)}, over IMF WEO GDP ${e.currentAccount4q.gdpYear}`,
      tag: 'model',
    });
    if (e.currentAccount4q.pctGdp < -3) weight = Math.max(weight, Math.min(1, Math.abs(e.currentAccount4q.pctGdp) / 8));
  } else if (e.currentAccount) {
    figures.push({ label: 'Current account, latest quarter', value: `${sgn(e.currentAccount.usdBn)}bn USD`, source: `${IMF_BOP_LABEL}, ${formatImfPeriod(e.currentAccount.period)}`, tag: 'official' });
  }
  return { figures, reading: imfSentence(e), weight };
}

function cbAgent(countries: LiveWatchlistItem[]): Omit<AgentAnswer, 'why'> {
  const findings: AgentFinding[] = [];
  const missing: string[] = [];
  for (const it of countries) {
    if (it.cpiInflationPct === undefined || it.policyRatePct === undefined) {
      const why = [
        it.cpiInflationPct === undefined ? `inflation (${missingReason('cpi', it.iso3).short})` : '',
        it.policyRatePct === undefined ? `policy rate (${missingReason('policy', it.iso3).short})` : '',
      ].filter(Boolean);
      missing.push(`${it.countryName}: missing ${why.join(' and ')}`);
      // Reserves and the balance of payments still answer without inflation or a policy rate.
      const ext = imfFigures(it);
      if (ext.figures.length) {
        findings.push({ iso3: it.iso3, countryName: it.countryName, reading: ext.reading, figures: ext.figures, weight: ext.weight });
      }
      continue;
    }
    const c = cpiTag(it);
    const pr = policyTag(it);
    const t = INFLATION_TARGETS[it.iso3];
    if (!t) missing.push(`${it.countryName}: inflation target not on file (central bank page not reachable), so the gap to target is left out`);
    const gap = t ? it.cpiInflationPct - t.pct : undefined;
    const real = it.policyRatePct - it.cpiInflationPct;
    const real10 = it.yield10YPct !== undefined ? it.yield10YPct - it.cpiInflationPct : undefined;
    const sig = policySignal(it);
    const y = yieldTag(it);
    const figures: AgentFigure[] = [
      { label: 'CPI inflation', value: p1(it.cpiInflationPct), source: c.src, tag: c.q },
      ...(t ? [{ label: 'Inflation target', value: `${p1(t.pct)}${t.bandPts ? ` ± ${t.bandPts}` : ''}`, source: targetSource(t), tag: 'official' as const }] : []),
      { label: 'Policy rate', value: p2(it.policyRatePct), source: pr.src, tag: it.policyRateSource === 'bis' ? 'official' : pr.q },
      ...(it.policyRateSource === 'bis' && it.policyRateChange12mPts !== undefined
        ? [{ label: 'Policy rate change over 12 months', value: `${sgn(it.policyRateChange12mPts, 2)} pts`, source: 'BIS, month-end figures', tag: 'official' as const }]
        : []),
      ...(it.policyRateSource === 'bis' && it.policyRateLastMove
        ? [
            {
              label: 'Last policy rate move',
              value: `${p2(it.policyRateLastMove.fromPct)} to ${p2(it.policyRateLastMove.toPct)} in ${it.policyRateLastMove.period}`,
              source: 'BIS',
              tag: 'official' as const,
            },
          ]
        : []),
      { label: 'Real policy rate', value: p1(real), source: 'policy rate minus inflation', tag: 'model' },
      ...(real10 !== undefined && it.yield10YPct !== undefined
        ? [{ label: 'Real 10Y yield', value: p1(real10), source: `10Y yield ${p2(it.yield10YPct)} (${y.src}) minus inflation`, tag: 'model' as const }]
        : []),
    ];
    if (it.oecdCpi?.change3mPts !== undefined && it.oecdCpi.trend) {
      figures.push(
        { label: 'Change in inflation over 3 months', value: `${sgn(it.oecdCpi.change3mPts)} pts`, source: c.src, tag: 'official' },
        { label: 'Inflation trend', value: it.oecdCpi.trend, source: '3-month change: +0.5 pts or more = rising, -0.5 pts or more down = easing', tag: 'model' }
      );
    }
    // Policy rule check (src/utils/taylorRule.ts): only with the BIS rate, live inflation and the bank's target.
    const taylor = taylorCheck(it);
    if (taylor.ok) {
      figures.push(
        { label: 'Taylor rule rate', value: `${p2(taylor.reading.rulePct)}${taylor.reading.withoutOutputGap ? ' (no output gap)' : ''}`, source: taylorMethod(taylor.reading), tag: 'model' },
        { label: 'Policy rate against the rule', value: `${sgn(taylor.reading.gapToRulePts, 2)} pts (${taylor.reading.stance})`, source: 'BIS policy rate minus the rule rate; within 1 pt = close to the rule', tag: 'model' }
      );
    }
    if (it.outputGap) {
      const og = it.outputGap;
      figures.push(
        og.source === 'estimate'
          ? { label: `Output gap ${og.year}`, value: `${sgn(og.pct)}% of potential GDP${og.low !== undefined && og.high !== undefined ? ` (band ${sgn(og.low)} to ${sgn(og.high)})` : ''}`, source: 'app estimate: middle of HP (lambda 100 and 6.25) and Hamilton filters on IMF WEO real GDP growth; not an official figure', tag: 'model' }
          : { label: `Output gap ${og.year}`, value: `${sgn(og.pct)}% of potential GDP`, source: 'IMF WEO', tag: 'official' },
      );
    }
    const stanceText = policyStance(real, gap);
    const ext = imfFigures(it);
    findings.push({
      iso3: it.iso3,
      countryName: it.countryName,
      reading: `${it.oecdCpi ? `${cpiSentence(it.oecdCpi)} ` : ''}Policy looks ${stanceText}.${taylor.ok ? ` ${taylorSentence(taylor.reading)}` : ''}${sig ? ` ${sig.label}: ${sig.soWhat}` : ''}${ext.reading ? ` ${ext.reading}` : ''}`,
      figures: [...figures, ...ext.figures],
      weight: Math.max(sig?.score ?? 0, ext.weight),
      stance: [{ dim: 'policy', call: policyCall(stanceText) }],
    });
  }
  return { id: 'cb', name: COUNCIL_AGENTS.cb.name, findings, missing };
}

/** Fiscal & Debt Agent: debt level and path, primary balance against the debt-stabilising one, and external debt falling due. */
function fiscalAgent(countries: LiveWatchlistItem[]): Omit<AgentAnswer, 'why'> {
  const findings: AgentFinding[] = [];
  const missing: string[] = [];
  const bn = (v: number) => `$${v >= 100 ? v.toFixed(0) : v.toFixed(1)}bn`;
  for (const it of countries) {
    const f = it.fiscal;
    if (!f) {
      missing.push(`${it.countryName}: no debt or fiscal figures (IMF WEO, World Bank QEDS/IDS and BIS did not answer)`);
      continue;
    }
    const figures: AgentFigure[] = [];
    const parts: string[] = [];
    let weight = 0;
    if (f.debtPctGdp) {
      figures.push({ label: 'Government debt', value: `${p1(f.debtPctGdp.value)} of GDP`, source: `${WEO_LABEL}, ${f.debtPctGdp.year}`, tag: 'official' });
      weight = Math.max(weight, Math.min(1, Math.max(0, (f.debtPctGdp.value - 60) / 80)));
    } else missing.push(`${it.countryName}: government debt missing (IMF WEO did not answer)`);
    const path = debtPath(f);
    if (path && f.debtProjectionPctGdp && f.debtPctGdp) {
      figures.push(
        { label: `Government debt, IMF projection for ${f.debtProjectionPctGdp.year}`, value: `${p1(f.debtProjectionPctGdp.value)} of GDP`, source: `${WEO_LABEL} projection`, tag: 'official' },
        { label: 'Debt path', value: `${path.path} (${sgn(path.changePts)} pts)`, source: `IMF projection less the ${f.debtPctGdp.year} figure; 2 pts or more up = rising, 2 or more down = falling`, tag: 'model' }
      );
      parts.push(`Government debt is ${p1(f.debtPctGdp.value)} of GDP and the IMF projects it ${path.path === 'stable' ? 'roughly flat' : path.path} to ${f.debtProjectionPctGdp.year}.`);
      if (path.path === 'rising') weight = Math.max(weight, Math.min(1, path.changePts / 10 + 0.3));
    } else if (f.debtPctGdp) {
      parts.push(`Government debt is ${p1(f.debtPctGdp.value)} of GDP.`);
    }
    if (f.primaryBalancePctGdp) {
      figures.push({ label: 'Primary balance', value: `${sgn(f.primaryBalancePctGdp.value)}% of GDP`, source: `IMF Fiscal Monitor, ${f.primaryBalancePctGdp.year}`, tag: 'official' });
      const realRate = it.yield10YPct !== undefined && it.cpiInflationPct !== undefined ? it.yield10YPct - it.cpiInflationPct : undefined;
      if (f.debtPctGdp && f.realGrowthPct && realRate !== undefined) {
        const star = stabilisingPrimaryBalance(f.debtPctGdp.value, realRate, f.realGrowthPct.value);
        const gap = f.primaryBalancePctGdp.value - star;
        figures.push(
          { label: 'Real GDP growth', value: p1(f.realGrowthPct.value), source: `${WEO_LABEL}, ${f.realGrowthPct.year}`, tag: 'official' },
          { label: 'Real borrowing cost', value: p1(realRate), source: '10Y yield minus inflation (the cost of new borrowing; older debt usually costs less)', tag: 'model' },
          { label: 'Primary balance that holds debt steady', value: `${sgn(star)}% of GDP`, source: 'debt × (real rate − real growth) / (1 + real growth)', tag: 'model' },
          { label: 'Primary balance against that', value: `${sgn(gap)} pts`, source: 'primary balance minus the debt-stabilising one; below zero = debt drifts up on these rates', tag: 'model' }
        );
        parts.push(
          gap < -0.5
            ? `The primary balance is short of the level that would hold debt steady at today's borrowing cost and growth.`
            : gap > 0.5
              ? `The primary balance is above the level that would hold debt steady at today's borrowing cost and growth.`
              : `The primary balance is close to the level that would hold debt steady at today's borrowing cost and growth.`
        );
        if (gap < -0.5) weight = Math.max(weight, Math.min(1, -gap / 4 + 0.2));
      } else {
        const need = [!f.realGrowthPct ? 'real growth (IMF WEO)' : '', realRate === undefined ? 'a 10Y yield and inflation' : ''].filter(Boolean);
        missing.push(`${it.countryName}: no debt-stabilising primary balance, as ${need.join(' and ')} ${need.length > 1 ? 'are' : 'is'} missing`);
      }
    }
    if (f.extDue12m) {
      figures.push({ label: 'Government external principal due in the next 12 months', value: bn(f.extDue12m.usdBn), source: `${QEDS_SHORT}, from ${formatQuarter(f.extDue12m.asOf)}`, tag: 'official' });
      const res = it.imf?.reserves?.usdBn;
      if (res !== undefined && f.extDue12m.usdBn > 0) {
        const times = res / f.extDue12m.usdBn;
        figures.push({
          label: 'Reserves over that',
          value: `${times.toFixed(1)} times (${coverLabel(times)})`,
          source: 'IMF official reserves over QEDS principal due; under 1 = thin, 1 to 3 = adequate, over 3 = ample. Government only: private external debt is not counted',
          tag: 'model',
        });
        parts.push(`Official reserves cover the government's external principal due in the next year ${times.toFixed(1)} times (${coverLabel(times)}).`);
        if (times < 1) weight = Math.max(weight, 0.8);
      }
    }
    if (f.idsNext?.debtServiceUsdBn !== undefined) {
      figures.push({ label: `Public external debt service, ${f.idsNext.year}`, value: bn(f.idsNext.debtServiceUsdBn), source: IDS_SHORT, tag: 'official' });
    }
    if (f.intlBonds) {
      figures.push({ label: 'Government bonds in international markets', value: bn(f.intlBonds.usdBn), source: `${BIS_SECURITIES_SHORT}, ${formatQuarter(f.intlBonds.asOf)}`, tag: 'official' });
      if (f.intlBonds.due1yUsdBn !== undefined) {
        figures.push({ label: 'Of which due within a year', value: bn(f.intlBonds.due1yUsdBn), source: `${BIS_SECURITIES_SHORT}, ${formatQuarter(f.intlBonds.asOf)}`, tag: 'official' });
      }
    }
    // Debt sustainability (src/utils/debtSustainability.ts): the identity on IMF inputs and stated shocks.
    const dsa = it.debtSustainability;
    if (dsa) {
      if (dsa.base) figures.push({ label: `Debt in ${dsa.base.year}, ${dsa.base.label.toLowerCase()}`, value: `${p1(dsa.base.end)} of GDP`, source: `debt dynamics on IMF WEO and Fiscal Monitor figures: ${dsa.method}`, tag: 'model' });
      if (dsa.worst) figures.push({ label: `Debt in ${dsa.base?.year ?? 'five years'}, worst stress case (${dsa.worst.label.toLowerCase()})`, value: `${p1(dsa.worst.end)} of GDP`, source: 'stress scenarios shaped on the IMF market-access DSA tests; sizes stated by the app', tag: 'model' });
      if (dsa.rMinusG !== undefined) figures.push({ label: 'Interest rate less growth (r - g), 10-year average', value: `${sgn(dsa.rMinusG)} pts`, source: 'effective real interest rate (IMF net interest over debt, less CPI inflation) minus IMF real growth', tag: 'model' });
      if (dsa.stabilisingPb !== undefined) {
        figures.push({ label: 'Debt-stabilising primary balance (IMF inputs)', value: `${sgn(dsa.stabilisingPb)}% of GDP`, source: 'debt x (i - n) / (1 + n) on the IMF projection averages', tag: 'model' });
        if (dsa.projectedPb !== undefined) {
          parts.push(`On the IMF's own projections the primary balance averages ${sgn(dsa.projectedPb)}% of GDP against ${sgn(dsa.stabilisingPb)}% needed to hold debt steady${dsa.worst ? `; the worst stress case takes debt to ${p1(dsa.worst.end)} of GDP` : ''}.`);
          if (dsa.projectedPb < dsa.stabilisingPb - 0.5) weight = Math.max(weight, Math.min(1, (dsa.stabilisingPb - dsa.projectedPb) / 4 + 0.3));
        }
      }
    } else if (f.debtPctGdp) {
      missing.push(`${it.countryName}: no debt sustainability view (needs the saved IMF history with Fiscal Monitor balances; see Research > History & data)`);
    }
    // Fiscal multiplier: a cited reference range (src/utils/fiscalMultipliers.ts), never an estimate.
    if (f.debtPctGdp) {
      const mv = multiplierView({ iso3: it.iso3, debtPctGdp: f.debtPctGdp, outputGap: it.outputGap, ...(it.policyRateSource === 'bis' && it.policyRatePct !== undefined ? { policyRatePct: it.policyRatePct } : {}) });
      figures.push({
        label: 'Fiscal multiplier, first year (reference range)',
        value: `${mv.guide.low}-${mv.guide.high} (${mv.guide.bucket} bucket, normal times)`,
        source: `${TNM_CITATION} ${mv.guide.why} Trough of the cycle ${mv.cycle.trough.low}-${mv.cycle.trough.high}, peak ${mv.cycle.peak.low}-${mv.cycle.peak.high}. Not an estimate for this country`,
        tag: 'model',
      });
    }
    if (!f.extDue12m && !f.intlBonds && !f.idsNext) missing.push(`${it.countryName}: no external debt falling due (World Bank QEDS, IDS and BIS did not answer or have no series)`);
    if (!figures.length) continue;
    findings.push({
      iso3: it.iso3,
      countryName: it.countryName,
      reading: parts.join(' ') || 'Debt figures on hand, but not enough for a reading.',
      figures,
      weight,
    });
  }
  return { id: 'fiscal', name: COUNCIL_AGENTS.fiscal.name, findings, missing };
}

/** Politics & Events Agent: news tone and headlines, political stability rank, prediction-market odds. */
function politicsAgent(countries: LiveWatchlistItem[]): Omit<AgentAnswer, 'why'> {
  const findings: AgentFinding[] = [];
  const missing: string[] = [];
  for (const it of countries) {
    const p = it.politics;
    if (!p) {
      missing.push(`${it.countryName}: no news tone, stability rank or prediction-market odds (GDELT, World Bank and Polymarket did not answer)`);
      continue;
    }
    const figures: AgentFigure[] = [];
    const parts: string[] = [];
    let weight = 0;
    if (p.tone) {
      const band = toneBand(p.tone.value);
      figures.push(
        { label: 'News tone', value: sgn(p.tone.value, 2), source: `${GDELT_SHORT}, pulled ${p.tone.pulledAt}`, tag: 'live' },
        { label: 'News tone reading', value: band, source: `GDELT tone bands: ${TONE_RULE}`, tag: 'model' }
      );
      parts.push(`News coverage is ${band} in tone.`);
      if (band === 'very negative') weight = Math.max(weight, 0.7);
      else if (band === 'negative') weight = Math.max(weight, 0.4);
    } else missing.push(`${it.countryName}: news tone missing (GDELT did not answer or is in its pause)`);
    if (p.stability) {
      const band = stabilityBand(p.stability.percentile);
      figures.push(
        { label: 'Political stability rank', value: `${p.stability.percentile.toFixed(0)}th percentile (${band})`, source: `${WGI_SHORT}${p.stability.year ? `, ${p.stability.year}` : ''}; ${STABILITY_RULE}`, tag: 'official' }
      );
      parts.push(`Political stability ranks ${band} among countries.`);
      if (band === 'low') weight = Math.max(weight, 0.6);
    } else missing.push(`${it.countryName}: political stability rank missing (World Bank did not answer)`);
    for (const m of p.markets || []) {
      figures.push({
        label: `Prediction market: ${m.question}`,
        value: `${m.probabilityPct}% yes${m.volumeUsd ? ` (${formatUsd(m.volumeUsd)} traded)` : ''}${oddsMoveText(m) ? `; ${oddsMoveText(m)}` : ''}`,
        source: `${POLYMARKET_SHORT}, pulled ${p.marketsPulledAt || 'today'}; market odds, not a forecast by the app`,
        tag: 'live',
      });
    }
    if (p.markets?.length) parts.push(`Prediction markets price ${p.markets.length === 1 ? 'one contract that names' : `${p.markets.length} contracts that name`} the country.`);
    if (p.raw) {
      const raw = rawGdeltFigures(p.raw);
      figures.push(...raw.figures);
      parts.push(...raw.sentences);
      if (raw.surge) weight = Math.max(weight, 0.5);
    } else missing.push(`${it.countryName}: weekly event counts and economic news themes missing (GDELT raw files not pulled yet: Menu > Offline data, or npm run gdelt:pull)`);
    if (p.conflict) {
      const u = ucdpFigures(p.conflict);
      figures.push(...u.figures);
      parts.push(...u.sentences);
      weight = Math.max(weight, u.weight);
      for (const m of u.missing) missing.push(`${it.countryName}: ${m}`);
    } else missing.push(`${it.countryName}: armed conflict and conflict deaths missing (${ucdpMissing(null, it.iso3).short}: ${ucdpMissing(null, it.iso3).help})`);
    if (p.history) {
      const h = v1Figures(p.history);
      figures.push(...h.figures);
      parts.push(...h.sentences);
      weight = Math.max(weight, h.weight);
    } else missing.push(`${it.countryName}: long-run event history missing (${v1Missing(false).short}: ${v1Missing(false).help})`);
    if (p.acledEvents) {
      const c = acledFigures(p.acledEvents);
      figures.push(...c.figures);
      parts.push(...c.sentences);
      if (c.rising) weight = Math.max(weight, 0.5);
    } else if (p.acledMissing) missing.push(`${it.countryName}: ACLED conflict events ${p.acledMissing.replace(/^Missing: /, 'missing: ')}`);
    for (const h of p.headlines || []) {
      figures.push({ label: 'Headline', value: h.title, source: `${h.source}${h.publishedAt ? `, ${h.publishedAt.slice(0, 10)}` : ''} (GDELT, pulled ${p.headlinesPulledAt || ''})`, tag: 'live' });
    }
    if (!figures.length) continue;
    findings.push({ iso3: it.iso3, countryName: it.countryName, reading: parts.join(' ') || 'Headlines on hand, but no tone or stability reading.', figures, weight });
  }
  return { id: 'politics', name: COUNCIL_AGENTS.politics.name, findings, missing };
}

function rvAgent(countries: LiveWatchlistItem[], all: LiveWatchlistItem[]): Omit<AgentAnswer, 'why'> {
  const findings: AgentFinding[] = [];
  const missing: string[] = [];
  for (const it of countries) {
    const c = cdsTag(it);
    const y = yieldTag(it);
    const figures: AgentFigure[] = [];
    if (it.yield10YPct !== undefined) figures.push({ label: '10Y government yield', value: p2(it.yield10YPct), source: y.src, tag: y.q });
    else missing.push(`${it.countryName}: 10Y yield missing (${missingReason('yield', it.iso3).short})`);
    // USD bond spread over Treasuries: the free stand-in for CDS, always named a bond spread.
    if (it.hcSpreadBps !== undefined && it.hcSpreadPeriod) {
      figures.push({ label: 'USD bond spread over US Treasuries (a bond spread, not CDS)', value: `${Math.round(it.hcSpreadBps)} bps`, source: `J.P. Morgan EMBI Global via BCRP, ${hcSpreadWhen(it.hcSpreadPeriod)}`, tag: 'live' });
      if (it.hcSpreadChange12mBps !== undefined)
        figures.push({ label: 'USD bond spread, change on a year earlier', value: `${it.hcSpreadChange12mBps >= 0 ? '+' : ''}${it.hcSpreadChange12mBps} bps`, source: `J.P. Morgan EMBI Global via BCRP, ${hcSpreadWhen(it.hcSpreadPeriod)}`, tag: 'live' });
    } else missing.push(`${it.countryName}: USD bond spread missing (${hcSpreadMissing(it.iso3).short})`);
    if (it.cds5YBps !== undefined) figures.push({ label: '5Y CDS', value: `${Math.round(it.cds5YBps)} bps`, source: c.src, tag: c.q });
    else if (!CDS_HIDDEN) missing.push(`${it.countryName}: 5Y CDS missing (${missingReason('cds', it.iso3).short})`);
    const parts: string[] = [];
    const stance: Stance[] = [];
    const cv =
      it.policyRatePct !== undefined && it.usFedFundsPct !== undefined && it.fxVol3mPct !== undefined
        ? carryToVol(it.policyRatePct, it.usFedFundsPct, it.fxVol3mPct)
        : null;
    if (cv && it.usFedFundsPct !== undefined) {
      figures.push(
        { label: 'US fed funds rate', value: p2(it.usFedFundsPct), source: effrSourceText({ source: it.usFedFundsSource, date: it.usFedFundsDate }), tag: 'live' },
        { label: 'Carry over US per unit of FX volatility', value: cv.ratio.toFixed(2), source: `policy rate ${cv.carryPts.toFixed(1)} pts over fed funds, over 3-month volatility`, tag: 'model' }
      );
      parts.push(cv.ratio >= 0.5 ? 'Carry over the US pays well for the currency’s recent swings.' : 'Carry over the US is small next to the currency’s recent swings.');
    }
    if (!parts.length) {
      missing.push(`${it.countryName}: no carry reading`);
      continue;
    }
    findings.push({
      iso3: it.iso3,
      countryName: it.countryName,
      reading: parts.join(' '),
      figures,
      weight: carrySignal(it)?.score ?? 0,
      ...(stance.length ? { stance } : {}),
    });
  }
  return { id: 'rv', name: COUNCIL_AGENTS.rv.name, findings, missing };
}

function fxAgent(countries: LiveWatchlistItem[]): Omit<AgentAnswer, 'why'> {
  const findings: AgentFinding[] = [];
  const missing: string[] = [];
  for (const it of countries) {
    const figures: AgentFigure[] = [];
    const parts: string[] = [];
    const stance: Stance[] = [];
    if (it.reerGapPct !== undefined) {
      const l = reerLabel(it.reerGapPct);
      stance.push({ dim: 'fx', call: l });
      figures.push({
        label: 'Real exchange rate vs 10-year average',
        value: `${sgn(it.reerGapPct)}% (${l})`,
        source: `BIS real broad effective exchange rate${it.reerPeriod ? `, ${formatPeriod(it.reerPeriod)}` : ''}`,
        tag: 'official',
      });
      parts.push(
        l === 'near average'
          ? 'The real exchange rate is near its 10-year average.'
          : `The real exchange rate is ${l} for its history: ${Math.abs(it.reerGapPct).toFixed(0)}% ${it.reerGapPct > 0 ? 'above' : 'below'} its 10-year average.`
      );
    }
    if (it.fxVol3mPct !== undefined) {
      figures.push({ label: 'FX volatility against USD, 3 months', value: p1(it.fxVol3mPct), source: `ECB reference rates${it.fxVolTo ? ` to ${it.fxVolTo}` : ''}`, tag: 'live' });
      parts.push(`Three-month volatility against the dollar is ${p1(it.fxVol3mPct)} a year.`);
    }
    let crowd = 0;
    if (it.cftc) {
      const c = it.cftc;
      figures.push({
        label: `Leveraged funds net ${c.ccy} futures, share of open interest`,
        value: `${sgn(c.levNetPctOi)}%`,
        source: `${CFTC_LABEL}, ${c.market}, positions as of ${c.reportDate}`,
        tag: 'official',
      });
      figures.push({ label: `Asset managers net ${c.ccy} futures, share of open interest`, value: `${sgn(c.assetMgrNetPctOi)}%`, source: `CFTC, as of ${c.reportDate}`, tag: 'official' });
      if (c.percentile !== undefined) {
        figures.push({
          label: 'Leveraged funds positioning against its last 3 years',
          value: `${ordinal(c.percentile)} percentile (${positioningLabel(c.percentile)})`,
          source: `${c.weeks} weekly CFTC reports; 90th or above = crowded long, 10th or below = crowded short`,
          tag: 'model',
        });
        if (positioningLabel(c.percentile) !== 'not stretched') crowd = Math.abs(c.percentile - 50) / 50;
      }
      parts.push(positioningSentence(c));
    } else {
      missing.push(`${it.countryName}: futures positioning missing (${cftcMissing(it.iso3).short})`);
    }
    let tic = 0;
    if (it.tic) {
      const t = it.tic;
      figures.push({ label: 'Holdings of US Treasuries', value: `$${t.holdingsUsdBn.toFixed(1)}bn`, source: `${TIC_LABEL}, ${formatMonth(t.month)}`, tag: 'official' });
      if (t.change12mUsdBn !== undefined && t.change12mPct !== undefined) {
        figures.push({ label: 'Change in US Treasury holdings, 12 months', value: `${sgn(t.change12mUsdBn)}bn (${sgn(t.change12mPct)}%)`, source: `TIC, to ${formatMonth(t.month)}`, tag: 'official' });
        figures.push({ label: 'US Treasury holdings trend', value: ticTrend(t.change12mPct), source: '12-month change: -10% or less = selling, +10% or more = buying', tag: 'model' });
        if (ticTrend(t.change12mPct) !== 'steady') tic = Math.min(1, Math.abs(t.change12mPct) / 30);
      }
      parts.push(ticSentence(t));
    }
    // COFER: the currency's share of world FX reserves, when COFER names it.
    const ownCcy = COFER_CCY_BY_ISO3[it.iso3];
    const share = ownCcy ? it.cofer?.shares.find((x) => x.ccy === ownCcy) : undefined;
    if (share && it.cofer) {
      figures.push({
        label: `${ccyName(ownCcy)} share of world FX reserves`,
        value: `${share.pct.toFixed(1)}%${share.change4qPts !== undefined ? ` (${sgn(share.change4qPts)} pts on the year)` : ''}`,
        source: `IMF COFER, world, ${formatImfPeriod(it.cofer.period)}`,
        tag: 'official',
      });
      parts.push(`Central banks hold ${share.pct.toFixed(1)}% of world allocated FX reserves in the ${ccyName(ownCcy)} (IMF COFER, ${formatImfPeriod(it.cofer.period)}).`);
    }
    if (!parts.length) {
      missing.push(`${it.countryName}: no BIS real exchange rate, ECB rate, CFTC positioning or TIC holdings`);
      continue;
    }
    findings.push({ iso3: it.iso3, countryName: it.countryName, reading: parts.join(' '), figures, weight: Math.max(fxValueSignal(it)?.score ?? 0, crowd, tic), ...(stance.length ? { stance } : {}) });
  }
  return { id: 'fx', name: COUNCIL_AGENTS.fx.name, findings, missing };
}

/** Scenarios the question points to; all three when it names none. */
export function scenariosInQuestion(question: string): ScenarioId[] {
  const out: ScenarioId[] = [];
  if (/hormuz|\boil\b|gulf|iran|energy/i.test(question)) out.push('hormuz');
  if (/taiwan|china/i.test(question)) out.push('taiwan');
  if (/russia|ukrain|sanction/i.test(question)) out.push('russia');
  if (/commodit|terms of trade|export price|copper|soy|gold|iron ore|palm oil|coffee|cocoa/i.test(question)) out.push('prices');
  return out.length ? out : SCENARIOS.map((s) => s.id);
}

const SCENARIO_PHRASE: Record<ScenarioId, string> = {
  hormuz: 'a Strait of Hormuz closure',
  taiwan: 'a Taiwan Strait crisis',
  russia: 'a Russia escalation',
  prices: 'the commodity price moves of the last 12 months',
};

function spillAgent(countries: LiveWatchlistItem[], question: string): Omit<AgentAnswer, 'why'> {
  const ids = scenariosInQuestion(question);
  const scs = SCENARIOS.filter((s) => ids.includes(s.id));
  const findings: AgentFinding[] = [];
  const missing: string[] = [];
  for (const it of countries) {
    const rows = scs
      .map((sc) => ({ sc, imp: it.trade ? scenarioImpact(sc.id, it.trade) : null }))
      .filter((r): r is { sc: (typeof SCENARIOS)[number]; imp: NonNullable<ReturnType<typeof scenarioImpact>> } => r.imp !== null);
    const cli = it.oecdCli;
    if (!rows.length) missing.push(`${it.countryName}: World Bank, WITS or UN Comtrade trade figures not loaded`);
    if (!cli) missing.push(`${it.countryName}: OECD leading indicator missing (${cliMissing(!!it.oecdCliPulledAt).short})`);
    if (!rows.length && !cli) continue;
    const parts: string[] = [];
    const figures: AgentFigure[] = [];
    if (rows.length) {
      const worst = [...rows].sort((a, b) => a.imp.pctGdp - b.imp.pctGdp)[0];
      parts.push(
        worst.imp.pctGdp < 0
          ? `Most exposed to ${SCENARIO_PHRASE[worst.sc.id]}: about ${Math.abs(worst.imp.pctGdp).toFixed(1)}% of GDP off the current account in the first round.`
          : `Gains in the first round from ${SCENARIO_PHRASE[worst.sc.id]} (${sgn(worst.imp.pctGdp)}% of GDP).`
      );
      figures.push(
        ...rows.map((r) => ({
          label: r.sc.name,
          value: `${sgn(r.imp.pctGdp)}% of GDP`,
          source: `${r.sc.shock} Basis: ${r.imp.basis}`,
          tag: 'model' as const,
        }))
      );
      // Where the current account starts from, so the shock can be read against it.
      if (it.imf?.currentAccount4q?.pctGdp !== undefined) {
        figures.push({
          label: 'Current account now, last four quarters',
          value: `${sgn(it.imf.currentAccount4q.pctGdp)}% of GDP`,
          source: `${IMF_BOP_LABEL} to ${formatImfPeriod(it.imf.currentAccount4q.through)}, over IMF WEO GDP ${it.imf.currentAccount4q.gdpYear}`,
          tag: 'model',
        });
      }
    }
    let cycle = 0;
    if (cli) {
      figures.push({ label: 'OECD leading indicator', value: cli.level.toFixed(2), source: `${CLI_LABEL}, ${formatMonth(cli.month)}`, tag: 'official' });
      if (cli.change1m !== undefined) figures.push({ label: 'Leading indicator, change on the month', value: sgn(cli.change1m, 2), source: `OECD CLI, ${formatMonth(cli.month)}`, tag: 'official' });
      if (cli.phase) {
        figures.push({
          label: 'Growth cycle phase',
          value: cli.phase,
          source: 'OECD rule: above 100 and rising = expansion, above and falling = downturn, below and falling = slowdown, below and rising = recovery',
          tag: 'model',
        });
        if (cli.phase === 'slowdown' || cli.phase === 'downturn') cycle = Math.min(1, Math.abs(cli.level - 100) / 2);
      }
      parts.push(cliSentence(cli));
    }
    findings.push({
      iso3: it.iso3,
      countryName: it.countryName,
      reading: parts.join(' '),
      figures,
      weight: Math.max(rows.length ? Math.min(1, Math.max(...rows.map((r) => Math.abs(r.imp.pctGdp))) / 5) : 0, cycle),
    });
  }
  return { id: 'spill', name: COUNCIL_AGENTS.spill.name, findings, missing };
}

export const CALENDAR_HORIZON_DAYS = 120;

function calendarAgent(countries: LiveWatchlistItem[], now: Date): Omit<AgentAnswer, 'why'> {
  const events = upcomingOfficialEvents(countries.map((c) => c.iso3), CALENDAR_HORIZON_DAYS, now);
  const findings: AgentFinding[] = [];
  const none: string[] = [];
  for (const it of countries) {
    const mine = events.filter((e) => e.iso3 === it.iso3).slice(0, 4);
    if (!mine.length) {
      none.push(it.countryName);
      continue;
    }
    const first = mine[0];
    const when = first.daysUntil === 0 ? 'today' : first.daysUntil === 1 ? 'tomorrow' : `in ${first.daysUntil} days`;
    findings.push({
      iso3: it.iso3,
      countryName: it.countryName,
      reading: `Next: ${first.title} on ${first.date} (${when}${first.dateKind ? ', latest date in law' : ''}).`,
      figures: mine.map((e) => ({
        label: e.title,
        value: `${e.date}${dateKindLabel(e) ? ` (${dateKindLabel(e)})` : ''}`,
        source: `${e.sourceName}${e.primarySource ? '' : ', secondary source'}`,
        tag: 'official' as const,
      })),
      weight: 1 / (1 + first.daysUntil / 30),
    });
  }
  return {
    id: 'calendar',
    name: COUNCIL_AGENTS.calendar.name,
    findings,
    missing: none.length ? [`No dated events on file in the next ${CALENDAR_HORIZON_DAYS} days for ${none.join(', ')}`] : [],
  };
}

/** Run the planned agents. `all` is the whole watchlist, for peer comparisons. */
/* ------------------------------------------------------------------------------------------
 * Policy Document Agent: quotes the passages of your documents that best match the question.
 * ------------------------------------------------------------------------------------------ */

export const DOC_AGENT_NAME = 'Policy Document';
const DOC_PREFIX = 'doc:';
export const isDocFinding = (f: Pick<AgentFinding, 'iso3'>) => f.iso3.startsWith(DOC_PREFIX);

/**
 * Which watchlist country a document is about: one named in its title, else the one its text names
 * most (at least twice), else the question's country when the question is about one country.
 */
export function docCountry(doc: PolicyDoc, items: LiveWatchlistItem[], asked: LiveWatchlistItem[]): LiveWatchlistItem | undefined {
  const inTitle = countriesInQuestion(doc.title, items);
  if (inTitle.length === 1) return inTitle[0];
  const body = doc.text.slice(0, 50_000);
  let best: { it: LiveWatchlistItem; n: number } | undefined;
  for (const it of items) {
    const names = [baseName(it.countryName), ...(ALIASES[it.iso3] || [])];
    const n = names.reduce((sum, nm) => sum + (body.match(new RegExp(`(^|[^\\p{L}])${escapeRe(nm)}($|[^\\p{L}])`, 'giu')) || []).length, 0);
    if (n >= 2 && (!best || n > best.n)) best = { it, n };
  }
  if (best) return best.it;
  return asked.length === 1 ? asked[0] : undefined;
}

/** Each figure a document states, next to the app's figure for the same country, by stated rules. */
export function docChecks(docs: PolicyDoc[], items: LiveWatchlistItem[], asked: LiveWatchlistItem[]): { findings: AgentFinding[]; missing: string[] } {
  const findings: AgentFinding[] = [];
  const missing: string[] = [];
  if (!items.length) return { findings, missing };
  for (const d of docs) {
    const claims = extractClaims(d.text);
    if (!claims.length) continue;
    const it = docCountry(d, items, asked);
    if (!it) {
      missing.push(`${d.title}: states figures, but names no single watchlist country, so they were not checked against the app`);
      continue;
    }
    // Only check documents about a country this question covers.
    if (asked.length && !asked.some((a) => a.iso3 === it.iso3)) continue;
    const figures: AgentFigure[] = [];
    const notes: string[] = [];
    for (const c of compareClaims(claims, it)) {
      const label = MEASURE_LABEL[c.claim.measure];
      figures.push({ label: `${label}, in the document`, value: fmtMeasure(c.claim.measure, c.claim.value), source: `${d.title}: “${c.claim.quote}”`, tag: 'document' });
      if (!c.app || c.gap === undefined) {
        notes.push(`${label}: the app has no figure for ${baseName(it.countryName)} to check it against.`);
        continue;
      }
      const tol = TOLERANCE[c.claim.measure];
      const gapText = `${sgn(c.gap, tol.unit === '%' ? 0 : 2)} ${tol.unit}`;
      figures.push(
        { label: `${label}, in the app`, value: fmtMeasure(c.claim.measure, c.app.value), source: c.app.source, tag: c.app.tag },
        {
          label: `${label}: document against the app`,
          value: c.matches ? 'matches' : `differs by ${gapText}`,
          source: `document less app; within ${tol.value} ${tol.unit} counts as matching`,
          tag: 'model',
        }
      );
      if (!c.matches) notes.push(`${label} differs: the document says ${fmtMeasure(c.claim.measure, c.claim.value)}, the app's figure is ${fmtMeasure(c.claim.measure, c.app.value)} (${c.app.source}).`);
    }
    const differs = notes.filter((n) => n.includes(' differs:')).length;
    findings.push({
      iso3: `${DOC_PREFIX}${d.id}:check`,
      countryName: `${d.title}, checked against the app's ${baseName(it.countryName)} figures`,
      reading: differs
        ? `${notes.join(' ')} The document may be older than the app's figure, or measure something else (core against headline inflation, a monthly against an annual figure).`
        : notes.length
          ? `Every figure the app also holds matches the document. ${notes.join(' ')}`
          : 'Every figure the document states matches the app.',
      figures,
      weight: differs ? 0.6 : 0.2,
    });
  }
  return { findings, missing };
}

export function docAgent(question: string, docs: PolicyDoc[], items: LiveWatchlistItem[] = [], asked: LiveWatchlistItem[] = []): AgentAnswer {
  const hits = searchDocs(question, docs);
  const checks = docChecks(docs, items, asked);
  return {
    id: 'doc',
    name: DOC_AGENT_NAME,
    why: `you added ${docs.length === 1 ? 'a document' : `${docs.length} documents`}`,
    findings: [
      ...checks.findings,
      ...hits.map((h) => ({
        iso3: `${DOC_PREFIX}${h.docId}:${h.part}`,
        countryName: h.title,
        reading: `“${h.text}”`,
        figures: [{ label: 'Passage', value: `${h.part} of ${h.parts}`, source: `${h.title}, a document you added. Matched on: ${h.matched.join(', ')}`, tag: 'document' as const }],
        weight: h.score,
      })),
    ],
    missing: [...checks.missing, ...(hits.length ? [] : ['no passage in your documents shares enough words with the question'])],
  };
}

export function runCouncil(question: string, plan: CouncilPlan, all: LiveWatchlistItem[], now: Date = new Date(), docs: PolicyDoc[] = []): AgentAnswer[] {
  const desk = plan.agents.map(({ id, why }) => {
    const a =
      id === 'cb'
        ? cbAgent(plan.countries)
        : id === 'fiscal'
          ? fiscalAgent(plan.countries)
          : id === 'politics'
            ? politicsAgent(plan.countries)
            : id === 'rv'
          ? rvAgent(plan.countries, all)
          : id === 'fx'
            ? fxAgent(plan.countries)
            : id === 'spill'
              ? spillAgent(plan.countries, question)
              : id === 'timing'
                ? timingAgent(plan.countries, now)
                : calendarAgent(plan.countries, now);
    const sourced = keepSourcedFindings(a.findings);
    const sorted = [...sourced.findings].sort((x, y) => y.weight - x.weight);
    const kept = sorted.slice(0, MAX_FINDINGS);
    const missing = [...a.missing, ...sourced.missing, ...datedNotes(id, kept, plan.countries, now)];
    if (sorted.length > kept.length) missing.push(`${sorted.length - kept.length} more countries with smaller readings left out`);
    return { ...a, why, findings: kept, missing };
  });
  if (plan.offWatchlist?.length && desk.length) desk[0].missing.unshift(offWatchlistNote(plan.offWatchlist));
  // Claim Check (src/utils/claimCheck.ts): a figure or ranking stated in the question, checked against the app.
  const named = countriesInQuestion(question, all);
  const claim = claimAnswer(question, named.length ? named : plan.countries.length === 1 ? plan.countries : [], all);
  const withClaim = claim ? [claim, ...desk] : desk;
  return docs.length ? [...withClaim, docAgent(question, docs, all, plan.countries)] : withClaim;
}

export const CHART_AGENT_NAME = 'Chart';

/** The Chart Agent's answer: the chart to draw, and its test results as a finding the summary can use. */
export function chartAnswer(req: ChartRequest, result: ChartResult): AgentAnswer {
  const f = chartFinding(req, result);
  return {
    id: 'chart',
    name: CHART_AGENT_NAME,
    why: req.why,
    findings: f ? [f] : [],
    missing: [...result.missing, ...result.tests.filter((t) => !t.figures.length).map((t) => `${t.title}: ${t.reading.replace(/^Not run:\s*/, '')}`)],
    chart: result,
  };
}

/** Answers as sent to the AI steps: the chart's points stay on this computer, its test results go. */
export function answersForModel(answers: AgentAnswer[]): AgentAnswer[] {
  return answers.map(({ chart: _chart, ...a }) => a);
}

/** Which dated figures each agent leans on (src/utils/freshness.ts ids). */
const AGENT_DATED: Partial<Record<AgentId, string[]>> = {
  cb: ['cpi', 'policy', 'reserves', 'current_account'],
  fiscal: ['yield', 'reserves'],
  rv: ['yield'],
  fx: ['reer', 'cpi'],
  timing: ['policy', 'cli', 'cftc', 'tic', 'yield'],
};

/** For each country an agent answered on, the figures it used that are older than their source usually runs. */
export function datedNotes(id: AgentId, findings: AgentFinding[], countries: LiveWatchlistItem[], now: Date): string[] {
  const ids = AGENT_DATED[id];
  if (!ids) return [];
  const notes: string[] = [];
  for (const iso3 of new Set(findings.map((f) => f.iso3))) {
    const it = countries.find((c) => c.iso3 === iso3);
    const stale = staleFigures(it, now).filter((c) => ids.includes(c.id));
    if (it && stale.length) notes.push(`${it.countryName}: older than usual, so read with its date: ${stale.map((c) => `${c.label.toLowerCase()} for ${c.period}, ${describeAge(c)}`).join('; ')}`);
  }
  return notes;
}

/** Tags that are not a live feed, an official series, your own file or a stated rule on those. */
const UNSOURCED: ReadonlySet<FigureTag> = new Set<FigureTag>(['estimate', 'sample']);

/**
 * Sam's rule: no built-in or sample figures, and no AI estimates. The watchlist already leaves
 * those out; this is the council's own guard. A finding that leans on such a figure is dropped
 * whole (its reading was built from it) and the gap names the figure.
 */
export function keepSourcedFindings(findings: AgentFinding[]): { findings: AgentFinding[]; missing: string[] } {
  const kept: AgentFinding[] = [];
  const missing: string[] = [];
  for (const f of findings) {
    const bad = f.figures.filter((g) => UNSOURCED.has(g.tag));
    if (!bad.length) kept.push(f);
    else missing.push(`${f.countryName}: left out, as ${listNames(bad.map((g) => g.label.toLowerCase()))} ${bad.length === 1 ? 'is' : 'are'} not from a live feed, an official series or your own file`);
  }
  return { findings: kept, missing };
}

/* ------------------------------------------------------------------------------------------
 * The synthesis: what it is asked, and how its answer is checked.
 * ------------------------------------------------------------------------------------------ */

export interface CouncilBrief {
  headline: string;
  points: string[];
  disagreements: string[];
  gaps: string[];
  /** An explanation (src/utils/explain.ts): facts apart from interpretation, by lens. `points` holds the same sentences, flat. */
  explain?: import('./explain').ExplainBrief;
}

export interface SynthesisResult {
  /** Null when no model answered: the agents' answers stand alone. */
  brief: CouncilBrief | null;
  provider?: string;
  /** Sentences removed because a number in them did not trace back to an agent's figures. */
  removed: string[];
  /** Sentences removed because they described an agent's call in an opposing word. */
  contradicted?: Contradiction[];
  reason?: string;
  /** What the answer was pinned to: inputs, model, temperature, seed and hashes (src/utils/answerSnapshot.ts). */
  snapshot?: import('./answerSnapshot').SnapshotSummary;
}

export const SYNTHESIS_INSTRUCTION = [
  'You are the synthesis agent of a sovereign research council: a senior economist who turns the agents\' documents into an answer for a policy reader.',
  'You receive one standard document per agent, each in the same template: why it was asked, what it covers, findings (each with the agent\'s call and every figure with its tag and source), missing data, and coverage.',
  'Your job is to interpret, not to list. The headline answers the question directly: yes or no, which countries, or what is most likely, with the main reason in a few words.',
  'The points explain what the evidence means for the question: connect findings across agents (for example a policy rate well above inflation alongside a weak currency), compare and rank countries when several are covered, say which way the risks lean and what would change the answer.',
  'Never repeat a finding without saying what it means for the question.',
  'Use ONLY the findings in the documents. Every number you write must appear in them, written as it appears there. Describe sizes and comparisons in words (higher, well above, the largest of the three); do not calculate new numbers, forecast, or add outside facts.',
  'Passages from the Policy Document Agent are quotes from documents the user added: name the document when you use one, and do not treat its forecasts as data.',
  'Each finding states the agent\'s stance in fixed words (policy tight, neutral or loose; ' + (CDS_HIDDEN ? 'cheap, in line or rich against peers' : 'CDS cheap, in line or rich') + '; real exchange rate strong, near average or weak). Use those words; never describe a stance differently.',
  'Where agents point different ways, say so under disagreements; do not smooth it over.',
  'List under gaps what the agents could not answer (their Missing data sections), and say less confidently what rests on a document whose coverage is partial or none.',
  'Plain English, full sentences, no advice to buy or sell.',
].join(' ');

/**
 * Goes after the agents' documents, so the question is the last thing the model reads and the
 * shape of the answer is in the prompt itself (a local model does not see the schema's notes).
 */
export function synthesisTask(question: string): string {
  return [
    '',
    'Write a JSON object with:',
    '- headline: one sentence that directly answers the question below.',
    '- points: 3 to 6 sentences. Each one interprets the evidence for the question (what it shows, why it matters, how it fits with the other agents) and names the figures it rests on.',
    '- disagreements: sentences on where agents point different ways (empty list if none).',
    '- gaps: what the agents could not answer and how that limits the answer.',
    '',
    `Question to answer: ${question}`,
  ].join('\n');
}

/** The agents' answers as plain text for the synthesis prompt. */
export function answersAsText(question: string, answers: AgentAnswer[]): string {
  const lines = [`Question: ${question}`, ''];
  for (const a of answers) {
    lines.push(`## ${a.name} Agent (asked because ${a.why})`);
    for (const f of a.findings) {
      lines.push(`- ${f.countryName}: ${f.reading}`);
      for (const s of f.stance || []) lines.push(`  - Stance on ${DIM_LABEL[s.dim]}: ${s.call}`);
      for (const g of f.figures) lines.push(`  - ${g.label}: ${g.value} [${tagLabel(g.tag, a.name)}; ${g.source}]`);
    }
    for (const m of a.missing) lines.push(`- Not available: ${m}`);
    lines.push('');
  }
  return lines.join('\n');
}

const NUM = /\d+(?:\.\d+)?/g;

/** Every number the agents (and the question) put on the table. */
export function allowedNumbers(question: string, answers: AgentAnswer[]): number[] {
  const text = answersAsText(question, answers);
  const set = new Set<number>((text.match(NUM) || []).map(Number));
  // Counts the brief may state: how many agents and countries answered.
  set.add(answers.length);
  set.add(new Set(answers.flatMap((a) => a.findings.filter((f) => !isDocFinding(f)).map((f) => f.iso3))).size);
  return [...set];
}

/** A number traces back when an agent's figure, rounded to the digits written, gives it. */
export function traces(written: string, allowed: number[]): boolean {
  const v = Number(written);
  const d = written.includes('.') ? written.split('.')[1].length : 0;
  const f = 10 ** d;
  return allowed.some((a) => Math.round(a * f) === Math.round(v * f));
}

/**
 * Drop any sentence with an untraceable number, and any sentence that describes an agent's call in
 * an opposing word (policy called loose when the Central Bank Watcher Agent reads it as tight; see
 * stanceCheck.ts). Both kinds are returned so the screen can show what was removed and why.
 */
/** A checker for AI-written sentences: false (and the sentence recorded) when a number does not trace or a call is contradicted. */
export function sentenceCheck(question: string, answers: AgentAnswer[]) {
  const allowed = allowedNumbers(question, answers);
  const removed: string[] = [];
  const contradicted: Contradiction[] = [];
  const stanced = answers.flatMap((a) =>
    a.findings.filter((f) => f.stance?.length).map((f) => ({ iso3: f.iso3, countryName: f.countryName, agent: a.name, stance: f.stance! }))
  );
  const ok = (s: string) => {
    const bad = (s.match(NUM) || []).some((n) => !traces(n, allowed));
    if (bad) {
      removed.push(s);
      return false;
    }
    const c = contradiction(s, stanced);
    if (c) contradicted.push(c);
    return !c;
  };
  return { ok, removed, contradicted };
}

export function checkBrief(
  brief: CouncilBrief,
  question: string,
  answers: AgentAnswer[]
): { brief: CouncilBrief; removed: string[]; contradicted: Contradiction[] } {
  const { ok, removed, contradicted } = sentenceCheck(question, answers);
  const clean = (xs: unknown): string[] =>
    (Array.isArray(xs) ? xs : typeof xs === 'string' ? [xs] : [])
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim().slice(0, 600))
      .filter(ok)
      .slice(0, 8);
  const headline = typeof brief.headline === 'string' ? brief.headline.trim().slice(0, 300) : '';
  return {
    brief: { headline: headline && ok(headline) ? headline : '', points: clean(brief.points), disagreements: clean(brief.disagreements), gaps: clean(brief.gaps) },
    removed,
    contradicted,
  };
}

/* ------------------------------------------------------------------------------------------
 * Saved brief, for Reports.
 * ------------------------------------------------------------------------------------------ */

export interface SavedCouncilBrief {
  question: string;
  askedAt: string;
  scopeNote: string;
  answers: AgentAnswer[];
  synthesis: SynthesisResult | null;
  /** Earlier questions in the same conversation, oldest first. */
  earlier?: EarlierTurn[];
  /** How the agents were picked (AI model or word matching). */
  chooserNote?: string;
  debate?: DebateResult;
  /** When the conversation's first question was asked; follow-ups keep it, so the saved copy is one entry. */
  startedAt?: string;
  /** What moved since the latest saved conversation on the same countries (utils/whatChanged.ts). */
  changes?: import('./whatChanged').ChangeReport;
}

const STORE_KEY = 'econquest.councilBrief.v1';

export function saveCouncilBrief(b: SavedCouncilBrief): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(b));
  } catch {
    /* storage blocked */
  }
}

export function loadCouncilBrief(): SavedCouncilBrief | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const b = raw ? (JSON.parse(raw) as SavedCouncilBrief) : null;
    return b && typeof b.question === 'string' && Array.isArray(b.answers) ? b : null;
  } catch {
    return null;
  }
}

export const COUNCIL_SECTIONS: Record<string, string> = {
  question: 'Question',
  summary: 'Summary',
  disagreements: 'Where the agents disagree',
  changes: 'What changed since last time',
  debate: 'Agent debate',
  agents: 'What each agent found',
  gaps: 'Gaps',
  method: 'Method',
  references: 'References',
};

/** One line naming the snapshot an answer is pinned to (src/utils/answerSnapshot.ts), for saved and downloaded briefs. */
export function snapshotLine(x: import('./answerSnapshot').SnapshotSummary): string {
  const data = x.asOf ? `figures as of ${x.asOf}` : x.dataPinnedAt ? `figures pinned at ${x.dataPinnedAt.slice(0, 16).replace('T', ' ')} UTC` : 'the latest figures held when asked';
  return `Snapshot ${x.id}: ${data}; AI model ${x.model || 'none answered'} at temperature ${x.temperature}, seed ${x.seed}; inputs hash ${x.inputsHash.slice(0, 12)}, answer hash ${x.outputHash.slice(0, 12)}, prompt hash ${x.promptHash.slice(0, 12)}. It can be re-run from the answer in Council chat.`;
}

export function councilBriefSections(b: SavedCouncilBrief | null, on: (id: string) => boolean): Array<{ heading: string; lines: string[] }> {
  if (!b) return [{ heading: 'No council brief yet', lines: ['Ask a question in Council chat on Workspace, then choose "Save to Reports" under the answer.'] }];
  const out: Array<{ heading: string; lines: string[] }> = [];
  const s = b.synthesis?.brief;
  if (on('question'))
    out.push({
      heading: COUNCIL_SECTIONS.question,
      lines: [
        b.question,
        `Asked ${b.askedAt.slice(0, 16).replace('T', ' ')} UTC about ${b.scopeNote}.`,
        ...(b.earlier?.length
          ? ['Earlier in the conversation:', ...b.earlier.map((t) => `- ${t.question}${t.headline ? ` (${t.headline})` : ''}`)]
          : []),
      ],
    });
  if (on('summary')) {
    out.push({
      heading: COUNCIL_SECTIONS.summary,
      lines: s
        ? [
            ...(s.headline ? [`**${s.headline}**`] : []),
            ...s.points.map((p) => `- ${p}`),
            `Written by the synthesis agent (${b.synthesis?.provider || 'AI model'}) from the agents' figures only.${
              b.synthesis?.removed.length ? ` ${b.synthesis.removed.length} sentence(s) removed because a number did not trace back to an agent.` : ''
            }`,
          ]
        : [`No AI summary. ${b.synthesis?.reason || 'No AI model answered.'} The agents' answers below stand on their own.`],
    });
  }
  if (on('disagreements') && s?.disagreements.length) out.push({ heading: COUNCIL_SECTIONS.disagreements, lines: s.disagreements.map((d) => `- ${d}`) });
  if (on('changes') && b.changes) {
    out.push({
      heading: COUNCIL_SECTIONS.changes,
      lines: [`Compared with your saved question of ${b.changes.sinceAskedAt.slice(0, 16).replace('T', ' ')} UTC: “${b.changes.sinceQuestion}”.`, ...changeLines(b.changes)],
    });
  }
  if (on('debate') && b.debate?.challenges.length) {
    const d = b.debate;
    const lines: string[] = [];
    d.challenges.forEach((c, i) => {
      lines.push(`- **${c.countryName}: ${c.fromName} Agent challenges ${c.toName} Agent.** ${c.challenge} What would settle it: ${c.settle}`);
      const r = d.replies?.find((x) => x.index === i);
      if (r) lines.push(`  - ${c.toName} Agent replies: ${r.reply}`);
    });
    if (d.verdict) lines.push('', `Where it lands: ${d.verdict}`);
    if (d.open?.length) lines.push('', 'Still open:', ...d.open.map((o) => `- ${o}`));
    if (!d.replies) lines.push('', `No AI replies (${d.reason || 'no AI model answered'}); the challenges come from stated rules on the agents' figures.`);
    out.push({ heading: COUNCIL_SECTIONS.debate, lines });
  }
  const refs = new References();
  if (on('agents')) {
    const lines: string[] = [];
    for (const a of b.answers) {
      if (lines.length) lines.push('');
      lines.push(`**${a.name} Agent**, asked because ${a.why}.`);
      for (const f of a.findings) {
        // Sourced figures carry a reference number; rule readings keep their method beside them.
        const fig = (g: AgentFigure) =>
          isCitable(g.source, g.tag) ? `${g.label} ${g.value} (${tagLabel(g.tag, a.name)}) [${refs.cite(g.source)}]` : `${g.label} ${g.value} (${tagLabel(g.tag, a.name)}, ${g.source})`;
        lines.push(`- ${f.countryName}: ${f.reading} ${f.figures.map(fig).join('; ')}.`);
      }
      if (!a.findings.length) lines.push('- No reading from the figures on hand.');
    }
    out.push({ heading: COUNCIL_SECTIONS.agents, lines });
  }
  if (on('gaps')) {
    const gaps = [...b.answers.flatMap((a) => a.missing.map((m) => `${a.name} Agent: ${m}`)), ...(s?.gaps || [])];
    if (gaps.length) out.push({ heading: COUNCIL_SECTIONS.gaps, lines: gaps.map((g) => `- ${g}`) });
  }
  if (on('method')) {
    out.push({
      heading: COUNCIL_SECTIONS.method,
      lines: [
        `${b.chooserNote || 'A rule-based planner picked the agents from words in the question.'} Each agent answered only from figures the app holds, each tagged Live data, Official, Your document, or as that agent’s model reading (a stated rule on the figures, not a forecast). Built-in figures and AI estimates are never used; where a figure was missing, the gap says why.`,
        ...(b.synthesis?.snapshot ? [snapshotLine(b.synthesis.snapshot)] : []),
        'For discussion. Not investment advice.',
      ],
    });
  }
  if (on('references') && refs.list.length) out.push({ heading: COUNCIL_SECTIONS.references, lines: refs.lines(b.askedAt) });
  return out;
}
