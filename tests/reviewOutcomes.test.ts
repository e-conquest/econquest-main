import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReviewFrame } from '../src/utils/policyReview';
import type { Diagnosis } from '../src/utils/reviewDiagnosis';
import type { MemoStep } from '../src/utils/reviewMemo';
import { buildOutcomes, goalFigure } from '../src/utils/reviewOutcomes';

const frame: ReviewFrame = { iso3: 'BRA', problem: 'Inflation is above target and growth is slowing.', goal: { indicator: 'Inflation', direction: 'lower', target: '3%' }, constraints: [], asOf: '2026-11-01' };
const fig = (ref: number, field: string, label: string, value: number | null) => ({ ref, field, group: 'g', label, unit: '%', value, status: value === null ? ('Missing' as const) : ('Live' as const), period: '2026', source: 'IMF WEO', reason: value === null ? 'IMF did not answer' : '' });
const diag = (pullDate: string, cpi: number | null, growth: number | null): Diagnosis => ({ iso3: 'BRA', asOf: pullDate, pullDate, pulledAt: '', incomplete: false, figures: [fig(1, 'imf.cpiInflationPct', 'Inflation (IMF WEO)', cpi), fig(2, 'imf.realGdpGrowthPct', 'Real GDP growth', growth)], readings: [], coverage: '' });
const memo = { inputs: { recommended: 1, rationale: '', watch: [{ indicator: 'Real GDP growth [2]' }], reviewDate: '2027-05-01' } } as MemoStep;

test('the goal figure is found by its label', () => {
  assert.equal(goalFigure(frame, diag('2026-11-01', 4.4, 2))?.ref, 1);
  assert.equal(goalFigure({ ...frame, goal: { ...frame.goal, indicator: 'Unemployment' } }, diag('2026-11-01', 4.4, 2)), undefined);
});

test('changes beside the start, the goal move, and honest caveats', () => {
  const o = buildOutcomes(frame, diag('2026-11-01', 4.4, 2), diag('2027-05-02', 3.9, null), memo, '2027-05-03');
  assert.equal(o.goal.move, 'right_way');
  assert.equal(o.rows[0].change, -0.5);
  assert.equal(o.rows[1].change, null);
  assert.deepEqual(o.rows.map((r) => r.watched), [true, true]);
  assert.equal(o.early, false);
  assert.ok(o.caveats.some((c) => /not what the recommendation caused/.test(c)));
  const early = buildOutcomes(frame, diag('2026-11-01', 4.4, 2), diag('2026-11-01', 4.4, 2), memo, '2026-11-02');
  assert.equal(early.goal.move, 'unchanged');
  assert.equal(early.early, true);
  assert.ok(early.caveats.some((c) => /same one the review started from/.test(c)));
  assert.equal(buildOutcomes(frame, diag('2026-11-01', 4.4, 2), diag('2027-05-02', 5, 2), memo, '2027-05-03').goal.move, 'wrong_way');
  assert.equal(buildOutcomes(frame, diag('2026-11-01', null, 2), diag('2027-05-02', 5, 2), memo, '2027-05-03').goal.move, 'missing');
});
