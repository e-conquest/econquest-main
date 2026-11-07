/**
 * Policy review, step 3 "Options": the council proposes and ranks policy options for the review's
 * goal, reading only the frozen diagnosis (step 2) and the frame. Four council lenses each give a
 * one-sentence view on every option: Central Bank Watcher, Fiscal & Debt, Politics & Events and
 * External (FX and spillover). Options the principal adds are assessed the same way.
 *
 * Reproducible: the prompt is built only from saved steps and is hashed; the model is called with
 * temperature 0 and its name is recorded. Every number the model writes must trace to a figure in
 * the diagnosis or the frame, or the sentence is removed (and listed). When no model answers, the
 * step can still be saved with the principal's own options, marked as not assessed.
 *
 * Browser-safe; the server calls the model.
 */
import type { ReviewFrame } from './policyReview';
import type { Diagnosis } from './reviewDiagnosis';
import { traces } from './askCouncil';

export const OPTIONS_TEMPLATE_VERSION = 'review-options-v2';
export const MAX_OPTIONS = 6;
export const MAX_USER_OPTIONS = 4;

export const LEVERS = ['monetary', 'fiscal', 'structural', 'external', 'communication', 'other'] as const;
export type Lever = (typeof LEVERS)[number];
export const LEVER_LABEL: Record<Lever, string> = {
  monetary: 'Monetary',
  fiscal: 'Fiscal',
  structural: 'Structural',
  external: 'External and FX',
  communication: 'Communication',
  other: 'Other',
};

export const LENSES = ['cb', 'fiscal', 'politics', 'external'] as const;
export type Lens = (typeof LENSES)[number];
export const LENS_LABEL: Record<Lens, string> = {
  cb: 'Central Bank Watcher',
  fiscal: 'Fiscal & Debt',
  politics: 'Politics & Events',
  external: 'External (FX and spillover)',
};

export interface UserOption {
  title: string;
  how: string;
}

export interface PolicyOption {
  rank: number;
  title: string;
  lever: Lever;
  /** How it would work, in plain words. */
  how: string;
  /** What it should do to the goal indicator, in words. */
  effect: string;
  /** "months", "a year or two"... in words. */
  timeToEffect: string;
  tradeoffs: string;
  whoBears: string;
  /** What would have to be true for it to work. */
  mustBeTrue: string;
  risks: string;
  /** Diagnosis references it rests on. */
  refs: number[];
  views: Partial<Record<Lens, string>>;
  /** True when the principal proposed it. */
  fromUser: boolean;
}

export interface OptionsStep {
  templateVersion: string;
  /** The AI model that wrote it, or null when none answered. */
  model: string | null;
  temperature: number;
  /** SHA-256 of the system instruction and prompt (set by the server). */
  promptHash: string;
  options: PolicyOption[];
  /** Why the council ranked them in this order. */
  ranking: string;
  gaps: string[];
  userOptions: UserOption[];
  /** Sentences removed because a number did not trace to the diagnosis or frame. */
  removed: string[];
  /** When no model answered: why. */
  reason?: string;
}

export const OPTIONS_INSTRUCTION = [
  'You are a sovereign research council advising a principal (an economist, central banker, minister or legislator) on how to improve one country\'s policy and macroeconomic conditions.',
  'Four lenses sit on the council: Central Bank Watcher (monetary policy and inflation), Fiscal & Debt (budget, debt, financing), Politics & Events (feasibility, elections, institutions) and External (exchange rate, reserves, current account, spillovers).',
  'You receive the frame (the problem, the goal, the constraints) and a diagnosis table where every figure has a reference number like [3], or says Missing with the reason.',
  'Propose and rank realistic policy options that move the goal indicator the right way while respecting the constraints. Cover more than one lever where the evidence allows. Assess every option the principal added, even if you rank it low.',
  'For each option say how it works, what it should do to the goal, how long it takes, the trade-offs, who bears the cost, what would have to be true for it to work, and the main risks. Each lens gives one sentence on the option from its own angle.',
  'Use ONLY the figures in the diagnosis and the frame and cite them by reference number, e.g. [2]. Every number you write must appear there. Describe sizes in words; do not calculate new numbers, forecast numbers or add outside facts.',
  'Figures in the "Model readings" group are the app\'s own estimates (output gap, debt dynamics) or a published reference range (fiscal multiplier), worked out only from data known on the As of day: use them to judge cyclical position, debt room and how much a fiscal change moves output, and say an option rests on an estimate when it does.',
  'Where a figure the option depends on is Missing, say so in mustBeTrue or risks and rank it with less confidence. List under gaps what the missing figures stop you from judging.',
  'This is research, not validated advice: do not claim certainty, and never give advice to buy or sell securities.',
  'Plain English, full sentences.',
].join(' ');

const unitText = (unit: string) => (unit === '%' ? '%' : ` ${unit}`);

/** The prompt: frame, diagnosis table, the principal's options, then the task (last, for local models). */
export function optionsPrompt(frame: ReviewFrame, d: Diagnosis, userOptions: UserOption[]): string {
  const lines = [
    `Country: ${frame.iso3}`,
    `Problem: ${frame.problem}`,
    `Goal: ${frame.goal.indicator}, ${frame.goal.direction}${frame.goal.target ? `, to ${frame.goal.target}` : ''}${frame.goal.by ? `, by ${frame.goal.by}` : ''}`,
    `Constraints: ${frame.constraints.length ? frame.constraints.join('; ') : 'none stated'}`,
    ...(frame.audience ? [`For: ${frame.audience}`] : []),
    `Data as of: ${d.asOf} (saved pull of ${d.pullDate})`,
    '',
    'Diagnosis:',
    ...d.figures.map((x) => (x.value === null ? `[${x.ref}] ${x.label}: Missing (${x.reason})` : `[${x.ref}] ${x.label}: ${x.value}${unitText(x.unit)} (${x.source}${x.period ? `, ${x.period}` : ''})`)),
    ...d.readings.map((r) => (r.value === null ? `${r.label}: ${r.reason}` : `${r.label}: ${r.value} percentage points (${r.method}${r.caveat ? ` ${r.caveat}` : ''})`)),
    '',
  ];
  if (userOptions.length) {
    lines.push('Options the principal wants assessed:');
    userOptions.forEach((o, i) => lines.push(`${i + 1}. ${o.title}${o.how ? `: ${o.how}` : ''}`));
    lines.push('');
  }
  lines.push(
    'Write a JSON object with:',
    `- options: 3 to ${MAX_OPTIONS} options, best first. Each has title, lever (one of ${LEVERS.join(', ')}), how, effect, timeToEffect, tradeoffs, whoBears, mustBeTrue, risks, refs (list of reference numbers used), fromUser (true if the principal proposed it), and views with one sentence each for cb, fiscal, politics and external.`,
    '- ranking: two or three sentences on why the options are in this order.',
    '- gaps: what the missing figures stop the council from judging.',
    '',
    `Task: rank the options most likely to move ${frame.goal.indicator} ${frame.goal.direction === 'stable' ? 'to stability' : frame.goal.direction} in ${frame.iso3} within the constraints.`
  );
  return lines.join('\n');
}

export const OPTIONS_SCHEMA_KEYS = ['options', 'ranking', 'gaps'];

const NUM = /\d+(?:\.\d+)?/g;

/** Numbers the model may write: every figure, reading and reference in the diagnosis, and every number in the frame. */
export function allowedReviewNumbers(frame: ReviewFrame, d: Diagnosis, userOptions: UserOption[]): number[] {
  const set = new Set<number>();
  const add = (s: string) => (s.match(NUM) || []).forEach((n) => set.add(Number(n)));
  add(optionsPrompt(frame, d, userOptions));
  d.figures.forEach((x) => (set.add(x.ref), x.value !== null && set.add(x.value)));
  d.readings.forEach((r) => r.value !== null && set.add(r.value));
  for (let i = 1; i <= MAX_OPTIONS + MAX_USER_OPTIONS; i++) set.add(i);
  return [...set];
}

/** Checks and tidies the model's answer: untraceable sentences removed, refs kept only if they exist. */
export function checkOptions(raw: unknown, frame: ReviewFrame, d: Diagnosis, userOptions: UserOption[]): Pick<OptionsStep, 'options' | 'ranking' | 'gaps' | 'removed'> {
  const allowed = allowedReviewNumbers(frame, d, userOptions);
  const removed: string[] = [];
  const clean = (v: unknown, max = 600): string => {
    if (typeof v !== 'string') return '';
    const sentences = v.trim().slice(0, max * 2).split(/(?<=[.!?])\s+/);
    const kept = sentences.filter((s) => {
      const ok = !(s.match(NUM) || []).some((n) => !traces(n, allowed));
      if (!ok && s.trim()) removed.push(s.trim());
      return ok;
    });
    return kept.join(' ').trim().slice(0, max);
  };
  const r = (raw ?? {}) as Record<string, unknown>;
  const refsOk = new Set(d.figures.map((x) => x.ref));
  const options: PolicyOption[] = (Array.isArray(r.options) ? r.options : [])
    .slice(0, MAX_OPTIONS + MAX_USER_OPTIONS)
    .map((o: any) => {
      const views: Partial<Record<Lens, string>> = {};
      for (const l of LENSES) {
        const v = clean(o?.views?.[l], 300);
        if (v) views[l] = v;
      }
      const title = clean(o?.title, 120);
      return {
        rank: 0,
        title,
        lever: (LEVERS as readonly string[]).includes(o?.lever) ? (o.lever as Lever) : 'other',
        how: clean(o?.how),
        effect: clean(o?.effect),
        timeToEffect: clean(o?.timeToEffect, 120),
        tradeoffs: clean(o?.tradeoffs),
        whoBears: clean(o?.whoBears, 300),
        mustBeTrue: clean(o?.mustBeTrue),
        risks: clean(o?.risks),
        refs: [...new Set((Array.isArray(o?.refs) ? o.refs : []).map((n: unknown) => Math.round(Number(n))).filter((n: number) => refsOk.has(n)))] as number[],
        views,
        fromUser: Boolean(o?.fromUser) || userOptions.some((u) => u.title.toLowerCase() === title.toLowerCase()),
      };
    })
    .filter((o) => o.title && o.how)
    .map((o, i) => ({ ...o, rank: i + 1 }));
  return {
    options,
    ranking: clean(r.ranking, 800),
    // A model may write the gaps as one sentence instead of a list: keep it as a one-item list.
    gaps: (Array.isArray(r.gaps) ? r.gaps : typeof r.gaps === 'string' ? [r.gaps] : []).map((g) => clean(g, 300)).filter(Boolean).slice(0, 8),
    removed,
  };
}

/** The principal's own options, tidied. */
export function parseUserOptions(v: unknown): UserOption[] {
  return (Array.isArray(v) ? v : [])
    .map((o: any) => ({ title: typeof o?.title === 'string' ? o.title.trim().slice(0, 120) : '', how: typeof o?.how === 'string' ? o.how.trim().slice(0, 400) : '' }))
    .filter((o) => o.title)
    .slice(0, MAX_USER_OPTIONS);
}

/** When no model answers: the principal's options stand, not assessed. */
export function unassessedOptions(userOptions: UserOption[]): PolicyOption[] {
  return userOptions.map((u, i) => ({ rank: i + 1, title: u.title, lever: 'other', how: u.how || 'Not described.', effect: '', timeToEffect: '', tradeoffs: '', whoBears: '', mustBeTrue: '', risks: '', refs: [], views: {}, fromUser: true }));
}
