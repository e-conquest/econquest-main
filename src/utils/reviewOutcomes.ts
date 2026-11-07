/**
 * Policy review, step 6 "Track outcomes": the same standard indicators from the latest saved pull,
 * beside the figures the review started from, with the goal indicator marked as moved the right
 * way, the wrong way, or not at all. It says when it is checked before the review date.
 *
 * What moved after a recommendation is not what the recommendation caused, and whether the
 * recommendation was followed is not known to the app: the step says so. Browser-safe.
 */
import type { ReviewFrame } from './policyReview';
import type { Diagnosis, DiagnosisFigure } from './reviewDiagnosis';
import type { MemoStep } from './reviewMemo';

export const OUTCOMES_TEMPLATE_VERSION = 'review-outcomes-v1';

export interface OutcomeRow {
  ref: number;
  label: string;
  unit: string;
  then: { value: number | null; period: string; source: string; reason: string };
  now: { value: number | null; period: string; source: string; reason: string };
  change: number | null;
  /** True when the memo named it to watch, or it is the goal indicator. */
  watched: boolean;
}

export type GoalMove = 'right_way' | 'wrong_way' | 'unchanged' | 'missing' | 'no_match';

export const GOAL_MOVE_LABEL: Record<GoalMove, string> = {
  right_way: 'Moved the way the goal wants',
  wrong_way: 'Moved against the goal',
  unchanged: 'No change',
  missing: 'Missing on one side, so no comparison',
  no_match: 'The goal indicator is not one of the standard indicators, so the app cannot track it',
};

export interface OutcomesStep {
  templateVersion: string;
  checkedOn: string;
  pullDate: string;
  reviewDate: string;
  early: boolean;
  rows: OutcomeRow[];
  goal: { ref?: number; label: string; move: GoalMove; targetText?: string };
  caveats: string[];
}

const side = (x: DiagnosisFigure | undefined) => ({ value: x?.value ?? null, period: x?.period ?? '', source: x?.source ?? '', reason: x ? x.reason : 'not in this pull' });

/** The diagnosis figure the goal names, if any (label match, either way round). */
export function goalFigure(frame: ReviewFrame, d: Diagnosis): DiagnosisFigure | undefined {
  const g = frame.goal.indicator.toLowerCase();
  return d.figures.find((x) => {
    const l = x.label.toLowerCase().replace(/ \(.*\)$/, '');
    return l.includes(g) || g.includes(l);
  });
}

export function buildOutcomes(frame: ReviewFrame, then: Diagnosis, now: Diagnosis, memo: MemoStep, checkedOn: string): OutcomesStep {
  const watchedRefs = new Set(memo.inputs.watch.flatMap((w) => (w.indicator.match(/\[(\d+)\]/g) || []).map((m) => Number(m.slice(1, -1)))));
  const goal = goalFigure(frame, then);
  if (goal) watchedRefs.add(goal.ref);
  const rows: OutcomeRow[] = then.figures.map((t) => {
    const n = now.figures.find((x) => x.field === t.field);
    const change = t.value !== null && n?.value != null ? Math.round((n.value - t.value) * 100) / 100 : null;
    return { ref: t.ref, label: t.label, unit: t.unit, then: side(t), now: side(n), change, watched: watchedRefs.has(t.ref) };
  });
  let move: GoalMove = 'no_match';
  if (goal) {
    const row = rows.find((r) => r.ref === goal.ref)!;
    if (row.change === null) move = 'missing';
    else if (frame.goal.direction === 'stable') move = Math.abs(row.change) < 1e-9 ? 'unchanged' : 'wrong_way';
    else if (row.change === 0) move = 'unchanged';
    else move = (row.change < 0) === (frame.goal.direction === 'lower') ? 'right_way' : 'wrong_way';
  }
  const early = checkedOn < memo.inputs.reviewDate;
  return {
    templateVersion: OUTCOMES_TEMPLATE_VERSION,
    checkedOn,
    pullDate: now.pullDate,
    reviewDate: memo.inputs.reviewDate,
    early,
    rows,
    goal: { ...(goal ? { ref: goal.ref } : {}), label: goal?.label ?? frame.goal.indicator, move, ...(frame.goal.target ? { targetText: frame.goal.target } : {}) },
    caveats: [
      ...(early ? [`Checked before the review date (${memo.inputs.reviewDate}): figures may not have had time to move.`] : []),
      ...(now.pullDate === then.pullDate ? ['The latest saved pull is the same one the review started from, so nothing can have changed yet.'] : []),
      'The app does not know whether the recommendation was followed, and what moved afterwards is not what the recommendation caused.',
      'Annual IMF and World Bank figures may be revised between pulls; a change can be a revision, not a move.',
    ],
  };
}
