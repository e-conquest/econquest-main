/**
 * Explain mode for Council chat (Sam, 2026-11-05): "what does this number mean, why does the
 * pattern look like this, and what does it mean for policy, the economy, households and firms,
 * trade, conflict and politics, markets?"
 *
 * - A question is an explanation when it asks why, what something means, what drives it, or how it
 *   feeds through (isExplainQuestion). Follow-ups such as "what does this mean for households?"
 *   count too.
 * - Each lens is answered by the desk agents that hold its figures (LENSES). A question that names
 *   lenses gets those; one that names none gets every lens the agents can speak to.
 * - A figure, chart or panel the user points at ("Explain" on it) travels with the question as the
 *   focus: its exact value, source and as-of date go into the prompt, and its numbers may be quoted.
 * - The synthesis writes facts (data: what the figures are) apart from reasons, lens readings and
 *   what to watch (interpretation). Every sentence is checked like any summary sentence: a number
 *   that does not trace to an agent's figure (or the focus figure) removes it, and so does a
 *   sentence that contradicts an agent's call.
 * - A lens whose agents brought no figures is never written by the model: it shows "Missing" and why.
 *
 * Browser-safe.
 */
import { CDS_HIDDEN } from './cdsHidden';
import { COUNCIL_AGENTS, AGENT_ORDER, isDocFinding, sentenceCheck, type AgentAnswer, type CoreAgentId, type CouncilBrief, type CouncilPlan } from './askCouncil';
import type { Contradiction } from './stanceCheck';
import { isCitable, References, type Reference } from './citations';

export type LensId = 'monetary' | 'fiscal' | 'micro' | 'trade' | 'politics' | 'markets';

export const LENS_ORDER: LensId[] = ['monetary', 'fiscal', 'micro', 'trade', 'politics', 'markets'];

export const LENSES: Record<LensId, { label: string; agents: CoreAgentId[]; words: RegExp; asks: string }> = {
  monetary: {
    label: 'Monetary policy',
    agents: ['cb'],
    words: /monetar|central bank|policy rate|interest rate|inflation|real rate|\bhikes?\b|\bcuts?\b|easing|tightening/i,
    asks: 'what it means for the central bank: inflation against target, how tight policy is, room to move',
  },
  fiscal: {
    label: 'Public finances',
    agents: ['fiscal'],
    words: /fiscal|budget|\bdebt\b|deficit|\btax(?:es)?\b|spending|public finances?|government borrowing|sustainab/i,
    asks: 'what it means for the government: debt path, interest costs, refinancing, room in the budget',
  },
  micro: {
    label: 'Households and firms',
    agents: ['cb', 'fx'],
    words: /household|consumer|famil(?:y|ies)|\bwages?\b|\bjobs?\b|employment|unemploy|\bfirms?\b|compan(?:y|ies)|business|\bmicro|cost of living|living costs?|purchasing power|borrowers?|mortgage|savers?|import prices|real incomes?|\bpeople\b/i,
    asks: 'what it means for households and firms: borrowing costs, prices and real incomes, imported costs, savers versus borrowers. Reason from the figures; there are no household or firm surveys in the app',
  },
  trade: {
    label: 'Trade and external',
    agents: ['spill', 'fx'],
    words: /\btrade\b|export|import(?!ance)|current account|external|commodit|\boil\b|energy|supply chain|balance of payments|competitive/i,
    asks: 'what it means for trade and the external position: exports, imports, the currency, exposure to shocks',
  },
  politics: {
    label: 'Conflict and politics',
    agents: ['politics'],
    words: /politic|conflict|\bwar\b|election|protest|unrest|sanction|geopolit|stability|government|coup|violence|news/i,
    asks: 'what it means for politics and conflict: news tone, protests and violence, stability, election and sanction risk',
  },
  markets: {
    label: 'Markets',
    agents: ['rv', 'fx', 'timing'],
    words: /market|investor|\bbonds?\b|yields?|spreads?|\bcds\b|currenc|\bfx\b|capital flows?|portfolio|positioning|priced|pricing/i,
    asks: 'what it means for markets: bond yields and spreads, the currency, positioning, what could move them. The USD bond spread is a bond spread over US Treasuries, not CDS: call it a bond spread',
  },
};

/** Words that make a question a request for an explanation, not a ranking or a list. */
const EXPLAIN_RE = new RegExp(
  [
    '\\bwhy\\b',
    '\\bexplain',
    '\\bexplanation',
    '\\bwhat (?:does|do|did|would|will) .{0,100}?\\bmean\\b',
    '\\bmeaning of\\b',
    "\\bwhat(?:'s| is| are) (?:behind|driving)\\b",
    '\\bdrivers? of\\b',
    '\\bwhat drives\\b',
    '\\bhow (?:does|do|did|would|will|could|might) .{0,100}?\\b(?:affect|translate|feed|matter|hit|impact|pass through)',
    '\\bimplications?\\b',
    '\\binterpret',
    '\\bso what\\b',
    '\\bwhy (?:does|do) (?:it|this|that) matter\\b',
    '\\bwhat (?:does|would) (?:it|this|that) mean for\\b',
  ].join('|'),
  'i'
);

export function isExplainQuestion(question: string, focus?: ExplainFocus | null): boolean {
  return Boolean(focus) || EXPLAIN_RE.test(question);
}

/** Lenses the question names ("for households", "for the budget"); empty means every lens. */
export function lensesInQuestion(question: string): LensId[] {
  // Only the part after "for"/"on"/"to" names a lens when the question also names the figure,
  // so "why is the policy rate so high for households?" asks about households, not monetary policy.
  const tail = /\b(?:for|on|to|into|through to)\b(.+)$/i.exec(question)?.[1];
  const scan = (text: string) => LENS_ORDER.filter((l) => LENSES[l].words.test(text));
  const fromTail = tail ? scan(tail) : [];
  if (fromTail.length) return fromTail;
  // "What does it mean for policy?" names policy in general: monetary and public finances.
  if (tail && /\bpolic(?:y|ies)\b/i.test(tail)) return ['monetary', 'fiscal'];
  return [];
}

/** The figure, chart or panel the user pressed Explain on. Values are as the screen showed them. */
export interface ExplainFocus {
  kind: 'figure' | 'chart' | 'panel' | 'document';
  /** What it is, e.g. "Real policy rate" or "Phillips curve, Brazil". */
  label: string;
  value?: string;
  source?: string;
  /** Period or date the value is for, as the screen showed it. */
  asOf?: string;
  iso3?: string;
  countryName?: string;
  /** Further lines shown with it (test results, other figures in the panel), at most a few. */
  detail?: string[];
}

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/** Light clean-up of a focus sent from the browser. */
export function cleanFocus(v: unknown): ExplainFocus | undefined {
  const f = v as ExplainFocus;
  if (!f || typeof f !== 'object' || !['figure', 'chart', 'panel', 'document'].includes(f.kind)) return undefined;
  const label = clip(f.label, 160);
  if (!label) return undefined;
  const out: ExplainFocus = { kind: f.kind, label };
  for (const k of ['value', 'source', 'asOf', 'countryName'] as const) {
    const s = clip(f[k], k === 'source' ? 200 : 120);
    if (s) out[k] = s;
  }
  if (typeof f.iso3 === 'string' && /^[A-Z]{3}$/.test(f.iso3)) out.iso3 = f.iso3;
  const detail = Array.isArray(f.detail) ? f.detail.map((d) => clip(d, 240)).filter(Boolean).slice(0, 8) : [];
  if (detail.length) out.detail = detail;
  return out;
}

/** The question put in the chat box when Explain is pressed (the user can edit it before sending). */
export function focusQuestion(f: ExplainFocus): string {
  const who = f.countryName && !f.label.startsWith(f.countryName) ? `${f.countryName}: ` : '';
  const what = f.value ? `${f.label} of ${f.value}` : f.label;
  if (f.kind === 'chart') return `Explain this chart (${who}${f.label}): what the pattern shows, why it looks like this, and what it means.`;
  // No lens is named here, so every lens the agents can speak to is asked for; a follow-up can narrow it.
  return `Explain ${who}${what}: what it means and why it is where it is.`;
}

/** The focus in words, for the prompt and the number check. */
export function focusAsText(f: ExplainFocus | undefined): string {
  if (!f) return '';
  const lines = [
    `The user pressed Explain on this ${f.kind} (shown on screen, quoted exactly):`,
    `- ${f.countryName ? `${f.countryName}, ` : ''}${f.label}${f.value ? `: ${f.value}` : ''}${f.source ? ` [${f.source}${f.asOf ? `, ${f.asOf}` : ''}]` : f.asOf ? ` [${f.asOf}]` : ''}`,
    ...(f.detail || []).map((d) => `- ${d}`),
    '',
  ];
  return lines.join('\n');
}

export interface ExplainPlan {
  lenses: LensId[];
  /** True when the question named the lenses; false when every lens was asked for. */
  named: boolean;
  focus?: ExplainFocus;
}

const MAX_AGENTS = 6;

/**
 * Adds the agents each lens needs to a plan (word-matched or AI-chosen), keeping its own picks and
 * reasons first. A plan that is not an explanation comes back unchanged.
 */
export function withExplainAgents(plan: CouncilPlan, question: string, focus?: ExplainFocus | null): CouncilPlan {
  if (!isExplainQuestion(question, focus)) return plan;
  const named = lensesInQuestion(question);
  const lenses = named.length ? named : LENS_ORDER;
  // "No topic, so every agent answers" gives way to the agents the lenses need.
  const agents = plan.agents.filter((a) => !/^no specific topic/.test(a.why));
  const have = new Set(agents.map((a) => a.id));
  // Named lenses bring all their agents; with every lens asked, the first agent of each is enough.
  for (const l of lenses) {
    for (const id of named.length ? LENSES[l].agents : LENSES[l].agents.slice(0, 1)) {
      if (have.has(id) || agents.length >= MAX_AGENTS) continue;
      have.add(id);
      agents.push({ id, why: `to explain what it means for ${LENSES[l].label.toLowerCase()}` });
    }
  }
  agents.sort((x, y) => AGENT_ORDER.indexOf(x.id) - AGENT_ORDER.indexOf(y.id));
  const scoped = focus?.iso3 ? plan.countries.filter((c) => c.iso3 === focus.iso3) : [];
  return {
    ...plan,
    agents,
    ...(scoped.length && scoped.length < plan.countries.length ? { countries: scoped, scopeNote: `${scoped[0].countryName}, from the ${focus!.kind} you asked about` } : {}),
    explain: { lenses, named: named.length > 0, ...(focus ? { focus } : {}) },
  };
}

/** For each lens: the agents that came back with figures, or why it cannot be answered. */
export function lensCoverage(lenses: LensId[], answers: AgentAnswer[]): Array<{ lens: LensId; agents: string[]; missing?: string }> {
  return lenses.map((lens) => {
    const ids = LENSES[lens].agents;
    const withFigures = answers.filter((a) => (ids as string[]).includes(a.id) && a.findings.some((f) => !isDocFinding(f)));
    if (withFigures.length) return { lens, agents: withFigures.map((a) => a.name) };
    const asked = answers.filter((a) => (ids as string[]).includes(a.id));
    const why = asked.flatMap((a) => a.missing).slice(0, 2).join('; ');
    const names = ids.map((id) => `${COUNCIL_AGENTS[id].name} Agent`).join(' or ');
    return { lens, agents: [], missing: asked.length ? `${names} had no figures${why ? ` (${why})` : ''}` : `${names} was not asked` };
  });
}

export const EXPLAIN_INSTRUCTION = [
  'You are the synthesis agent of a sovereign research council: a senior economist explaining a number or a pattern to a policy reader who is not a specialist.',
  'You receive one standard document per agent (findings with the agent\'s call, each figure with its tag and source, missing data, coverage), and sometimes the exact figure or chart the user pressed Explain on.',
  'Explain; do not rank or list. Say what the number is, why it is where it is, and what it means through each lens you are given.',
  'Keep data apart from interpretation. Facts state what the figures are, quoting them as written with what they measure and the period. Reasons, lens readings and what to watch are your interpretation: connect the figures with standard economics (for example a high real rate means tight policy, which slows credit and supports the currency; a weak currency raises import prices for households and firms).',
  'Use ONLY the figures in the documents and the figure the user pressed Explain on. Every number you write must appear there, written as it appears. Describe sizes in words (well above, far below); never calculate new numbers, forecast, or add outside facts, dates or events.',
  'For households and firms there are no surveys in the app: reason from inflation, rates and the currency, and say it is a reading of those figures.',
  'Write a lens only from the agents named for it. If a lens has no figures, leave it out; the app says it is missing.',
  'Each finding states the agent\'s stance in fixed words (policy tight, neutral or loose; ' + (CDS_HIDDEN ? 'cheap, in line or rich against peers' : 'CDS cheap, in line or rich') + '; real exchange rate strong, near average or weak). Use those words; never describe a stance differently.',
  'Passages from the Policy Document Agent are quotes from the user\'s documents: name the document, and do not treat its forecasts as data.',
  'Plain English, full sentences, short. No advice to buy or sell.',
].join(' ');

/** Goes after the documents: the lenses, the shape of the answer, and the question last. */
export function explainTask(question: string, coverage: ReturnType<typeof lensCoverage>): string {
  const can = coverage.filter((c) => c.agents.length);
  return [
    '',
    'Lenses to explain through (use only the agents named for each):',
    ...(can.length ? can.map((c) => `- ${c.lens}: ${LENSES[c.lens].label}, from ${c.agents.join(', ')}. Say ${LENSES[c.lens].asks}.`) : ['- none have figures: write facts and reasons only']),
    '',
    'Write a JSON object with:',
    '- headline: one sentence that directly answers the question in plain words.',
    '- facts: 1 to 3 sentences of data only: what the figures are, quoted as written, with what they measure.',
    '- reasons: 2 to 4 sentences: why the figure or pattern is where it is, connecting findings across agents.',
    '- lenses: one entry per lens above, each {"lens": id, "text": one or two sentences on what it means through that lens}.',
    '- watch: 1 to 3 sentences on what in the figures would change this reading.',
    '- gaps: what the agents could not answer and how that limits the explanation.',
    '',
    `Question to explain: ${question}`,
  ].join('\n');
}

export interface ExplainLens {
  lens: LensId;
  label: string;
  /** The model's reading through this lens (interpretation); empty when missing. */
  sentences: string[];
  /** Why the lens has no reading: its agents had no figures, or nothing written survived the checks. */
  missing?: string;
}

export interface ExplainBrief {
  /** Data: what the figures are. */
  facts: string[];
  /** Interpretation: why it is where it is. */
  reasons: string[];
  lenses: ExplainLens[];
  /** Interpretation: what in the figures would change the reading. */
  watch: string[];
  focus?: ExplainFocus;
}

/** The raw shape the model is asked for. */
export interface RawExplain {
  headline?: unknown;
  facts?: unknown;
  reasons?: unknown;
  lenses?: unknown;
  watch?: unknown;
  gaps?: unknown;
}

export const EXPLAIN_SCHEMA_KEYS = ['headline', 'facts', 'reasons', 'lenses', 'watch', 'gaps'] as const;

/**
 * Checks the model's explanation sentence by sentence (sentenceCheck, with the focus figure's numbers
 * allowed), puts each lens in order, and fills lenses with no evidence with "Missing" and the reason.
 * The flat brief (headline, points, gaps) is kept for exports, saved documents and the audit log.
 */
export function checkExplain(
  raw: RawExplain,
  question: string,
  answers: AgentAnswer[],
  plan: ExplainPlan
): { brief: CouncilBrief & { explain: ExplainBrief }; removed: string[]; contradicted: Contradiction[] } {
  const { ok, removed, contradicted } = sentenceCheck(`${question}\n${focusAsText(plan.focus)}`, answers);
  const list = (xs: unknown, n: number): string[] =>
    (Array.isArray(xs) ? xs : [])
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim().slice(0, 600))
      .filter(ok)
      .slice(0, n);
  const headline = typeof raw.headline === 'string' ? raw.headline.trim().slice(0, 300) : '';
  const facts = list(raw.facts, 4);
  const reasons = list(raw.reasons, 5);
  const watch = list(raw.watch, 3);
  const gaps = list(raw.gaps, 6);
  const written = new Map<LensId, string[]>();
  for (const e of Array.isArray(raw.lenses) ? raw.lenses : []) {
    const id = String((e as { lens?: unknown })?.lens || '').trim().toLowerCase() as LensId;
    if (!LENS_ORDER.includes(id) || written.has(id)) continue;
    const text = (e as { text?: unknown }).text;
    written.set(id, list(Array.isArray(text) ? text : [text], 2));
  }
  const lenses: ExplainLens[] = lensCoverage(plan.lenses, answers).map((c) => {
    const label = LENSES[c.lens].label;
    if (!c.agents.length) return { lens: c.lens, label, sentences: [], missing: c.missing };
    const s = written.get(c.lens) || [];
    // Every lens asked for by name shows; with all lenses asked, ones the model passed over stay out.
    return s.length ? { lens: c.lens, label, sentences: s } : { lens: c.lens, label, sentences: [], missing: written.has(c.lens) ? 'what the model wrote did not pass the number check' : 'the summary did not cover it' };
  }).filter((l) => l.sentences.length || plan.named || !l.missing?.startsWith('the summary'));
  const explain: ExplainBrief = { facts, reasons, lenses, watch, ...(plan.focus ? { focus: plan.focus } : {}) };
  const points = [...facts, ...reasons, ...lenses.flatMap((l) => l.sentences.map((s) => `${l.label}: ${s}`)), ...watch.map((w) => `What would change it: ${w}`)];
  return {
    brief: { headline: headline && ok(headline) ? headline : '', points, disagreements: [], gaps, explain },
    removed,
    contradicted,
  };
}

/* ------------------------------------------------------------------------------------------
 * Numbered references for an explanation. A sentence cites a source when it quotes one of that
 * source's figures exactly as written (same digits); a stated-rule reading is not a reference.
 * Numbers follow reading order: facts, reasons, lenses, what to watch.
 * ------------------------------------------------------------------------------------------ */

export interface CitedSentence {
  text: string;
  refs: number[];
}

export interface CitedExplain {
  facts: CitedSentence[];
  reasons: CitedSentence[];
  lenses: Array<Omit<ExplainLens, 'sentences'> & { sentences: CitedSentence[] }>;
  watch: CitedSentence[];
  references: Reference[];
}

const TOKEN = /\d+(?:\.\d+)?/g;

export function citedExplain(e: ExplainBrief, answers: AgentAnswer[]): CitedExplain {
  const refs = new References();
  const figs = answers.flatMap((a) =>
    a.findings.flatMap((f) => f.figures.filter((g) => isCitable(g.source, g.tag)).map((g) => ({ tokens: new Set(g.value.match(TOKEN) || []), source: g.source })))
  );
  const f = e.focus;
  if (f?.value && f.source && isCitable(f.source)) figs.push({ tokens: new Set(f.value.match(TOKEN) || []), source: `${f.source}${f.asOf ? `, ${f.asOf}` : ''}` });
  const cite = (text: string): CitedSentence => {
    const ns: number[] = [];
    for (const t of text.match(TOKEN) || []) {
      // Years and dates are not figures: "2026" in a sentence cites nothing.
      if (/^(19|20)\d\d$/.test(t)) continue;
      const hit = figs.find((g) => g.tokens.has(t));
      if (hit) {
        const n = refs.cite(hit.source);
        if (!ns.includes(n)) ns.push(n);
      }
    }
    return { text, refs: ns };
  };
  return {
    facts: e.facts.map(cite),
    reasons: e.reasons.map(cite),
    lenses: e.lenses.map((l) => ({ ...l, sentences: l.sentences.map(cite) })),
    watch: e.watch.map(cite),
    references: refs.list,
  };
}
