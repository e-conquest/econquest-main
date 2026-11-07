/**
 * Policy review (Sam, 2026-11-05): a guided, repeatable case file for a principal, economist or
 * politician who uses the council to look for ways to improve policy and macroeconomic conditions
 * in one country. See docs/POLICY_REVIEW.md.
 *
 * Six steps, in order: Frame > Diagnose > Options > Evidence > Memo > Outcomes. Each saved step
 * keeps its content, when it was saved, the SHA-256 of that content, and the hash of the step
 * before it ("basedOn"). Changing an earlier step therefore marks every later step "Out of date"
 * until it is run again, so a memo can never quietly rest on a frame or figures it was not
 * written from. Every step is also written to the audit log by the server.
 *
 * The frame fixes the "As of" day, so running Diagnose again on the same review gives the same
 * figures from the same archived pull. Only AI wording can differ between runs; each run is kept.
 *
 * Browser-safe: types, step names and states. Hashing, saving steps and the file store
 * (data/local/reviews.json) are in policyReviewStore.ts, which only the server imports.
 */

/** Bumped when the steps or their content change shape, so old reviews say which version made them. */
export const REVIEW_TEMPLATE_VERSION = 'policy-review-v1';
export const MAX_REVIEWS = 100;

export const REVIEW_STEPS = ['frame', 'diagnose', 'options', 'evidence', 'memo', 'outcomes'] as const;
export type ReviewStep = (typeof REVIEW_STEPS)[number];

export const STEP_LABEL: Record<ReviewStep, string> = {
  frame: 'Frame',
  diagnose: 'Diagnose',
  options: 'Options',
  evidence: 'Evidence',
  memo: 'Recommendation memo',
  outcomes: 'Track outcomes',
};

export const STEP_HINT: Record<ReviewStep, string> = {
  frame: 'Country, the problem, the goal, constraints and the "As of" day every later step uses.',
  diagnose: 'Standard indicators for that day, each with source and period, frozen and hashed.',
  options: 'The council proposes and ranks options for the goal, each with trade-offs, who bears the cost and what must be true.',
  evidence: 'Past episodes, statistical tests and validation status for each option.',
  memo: 'Written only from the steps above, citing every figure; signed off Draft > Reviewed > Approved.',
  outcomes: 'On the review date, what happened against the starting point.',
};

export type GoalDirection = 'lower' | 'higher' | 'stable';

export interface ReviewGoal {
  /** The indicator that should improve, in plain words (e.g. "Headline inflation"). */
  indicator: string;
  direction: GoalDirection;
  /** Optional target in the indicator's own unit, e.g. "3%" or "below 60% of GDP". */
  target?: string;
  /** YYYY-MM or YYYY-MM-DD the goal should be met by. */
  by?: string;
}

export interface ReviewFrame {
  iso3: string;
  /** The problem in one or two sentences, in the principal's words. */
  problem: string;
  goal: ReviewGoal;
  /** Things the options must respect: a currency peg, little fiscal room, an election date... */
  constraints: string[];
  /** YYYY-MM-DD: every later step reads the app's data as it stood on this day (archived pull). */
  asOf: string;
  /** Optional: who the review is for (a minister, a board, a committee). */
  audience?: string;
}

/** One saved step. The content's shape depends on the step and is filled in by later steps. */
export interface ReviewStepRecord<T = unknown> {
  content: T;
  savedAt: string;
  /** SHA-256 of the content with the hash of the step before it. */
  hash: string;
  /** Hash of the step before when this one was saved (frame has none). */
  basedOn?: string;
}

export interface ReviewRun {
  step: ReviewStep;
  at: string;
  hash: string;
  note?: string;
}

export interface PolicyReview {
  id: string;
  title: string;
  templateVersion: string;
  createdAt: string;
  updatedAt: string;
  /** The review this one was started from with "Review again", if any. */
  previousId?: string;
  steps: Partial<Record<ReviewStep, ReviewStepRecord>>;
  /** Every save of every step, oldest first (capped), so earlier runs can be compared. */
  runs: ReviewRun[];
}

export type StepState = 'not_started' | 'done' | 'out_of_date';

export const STEP_STATE_LABEL: Record<StepState, string> = {
  not_started: 'Not started',
  done: 'Done',
  out_of_date: 'Out of date',
};

export interface ReviewSummary {
  id: string;
  title: string;
  iso3: string;
  asOf: string;
  updatedAt: string;
  previousId?: string;
  states: Record<ReviewStep, StepState>;
  /** The first step that is not done, or null when all are. */
  next: ReviewStep | null;
}

export interface ReviewFile {
  reviews: PolicyReview[];
}

export const MAX_RUNS = 200;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_OR_DAY = /^\d{4}-\d{2}(-\d{2})?$/;

/** Checks and tidies a frame from the browser. Returns the reasons it cannot be saved, if any. */
export function parseFrame(v: unknown, today: Date = new Date()): { frame: ReviewFrame } | { errors: string[] } {
  const f = (v ?? {}) as Record<string, unknown>;
  const g = (f.goal ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const iso3 = str(f.iso3, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(iso3)) errors.push('Pick a country.');
  const problem = str(f.problem, 600);
  if (problem.length < 10) errors.push('Describe the problem in a sentence or two.');
  const indicator = str(g.indicator, 120);
  if (!indicator) errors.push('Name the indicator that should improve.');
  const direction = g.direction === 'lower' || g.direction === 'higher' || g.direction === 'stable' ? g.direction : null;
  if (!direction) errors.push('Say whether it should go lower, higher or stay stable.');
  const by = str(g.by, 10);
  if (by && !MONTH_OR_DAY.test(by)) errors.push('"By" must be a month (YYYY-MM) or a day (YYYY-MM-DD).');
  const asOf = str(f.asOf, 10);
  if (!DAY.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`))) errors.push('"As of" must be a day (YYYY-MM-DD).');
  else if (asOf > today.toISOString().slice(0, 10)) errors.push('"As of" cannot be in the future.');
  const constraints = (Array.isArray(f.constraints) ? f.constraints : [])
    .map((c) => str(c, 200))
    .filter(Boolean)
    .slice(0, 10);
  if (errors.length) return { errors };
  const target = str(g.target, 60);
  const audience = str(f.audience, 120);
  return {
    frame: {
      iso3,
      problem,
      goal: { indicator, direction: direction!, ...(target ? { target } : {}), ...(by ? { by } : {}) },
      constraints,
      asOf,
      ...(audience ? { audience } : {}),
    },
  };
}

/** A short title from the frame, e.g. "BRA: lower Headline inflation (as of 2026-11-01)". */
export function frameTitle(frame: ReviewFrame): string {
  const verb = { lower: 'lower', higher: 'raise', stable: 'stabilise' }[frame.goal.direction];
  return `${frame.iso3}: ${verb} ${frame.goal.indicator}${frame.goal.target ? ` to ${frame.goal.target}` : ''} (as of ${frame.asOf})`.slice(0, 160);
}

export const prevStep = (step: ReviewStep): ReviewStep | null => {
  const i = REVIEW_STEPS.indexOf(step);
  return i > 0 ? REVIEW_STEPS[i - 1] : null;
};

/** Where each step stands. A step is out of date when the step before changed, or is itself out of date. */
export function stepStates(review: Pick<PolicyReview, 'steps'>): Record<ReviewStep, StepState> {
  const out = {} as Record<ReviewStep, StepState>;
  let chainOk = true;
  for (const step of REVIEW_STEPS) {
    const rec = review.steps[step];
    if (!rec) {
      out[step] = 'not_started';
      chainOk = false;
      continue;
    }
    const prev = prevStep(step);
    const linked: boolean = prev === null ? true : chainOk && review.steps[prev]?.hash === rec.basedOn;
    out[step] = linked ? 'done' : 'out_of_date';
    chainOk = linked;
  }
  return out;
}

/** Steps can only be saved in order: the step before must be done (not missing, not out of date). */
export function canSaveStep(review: PolicyReview, step: ReviewStep): string | null {
  const prev = prevStep(step);
  if (prev === null) return null;
  const states = stepStates(review);
  if (states[prev] === 'done') return null;
  return `${STEP_LABEL[prev]} must be done first${states[prev] === 'out_of_date' ? ' (it is out of date: run it again)' : ''}.`;
}

export function frameOf(review: PolicyReview): ReviewFrame | null {
  return (review.steps.frame?.content as ReviewFrame) ?? null;
}

export function summarise(review: PolicyReview): ReviewSummary {
  const states = stepStates(review);
  const frame = frameOf(review);
  return {
    id: review.id,
    title: review.title,
    iso3: frame?.iso3 ?? '',
    asOf: frame?.asOf ?? '',
    updatedAt: review.updatedAt,
    ...(review.previousId ? { previousId: review.previousId } : {}),
    states,
    next: REVIEW_STEPS.find((s) => states[s] !== 'done') ?? null,
  };
}

