import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReviewFrame } from '../src/utils/policyReview';
import type { Diagnosis } from '../src/utils/reviewDiagnosis';
import { checkOptions, optionsPrompt, parseUserOptions, unassessedOptions } from '../src/utils/reviewOptions';

const frame: ReviewFrame = { iso3: 'BRA', problem: 'Inflation is above target and growth is slowing.', goal: { indicator: 'Inflation', direction: 'lower', target: '3%', by: '2027-12' }, constraints: ['Election in October'], asOf: '2026-11-01' };
const fig = (ref: number, label: string, value: number | null, unit = '%') => ({ ref, field: `f${ref}`, group: 'g', label, unit, value, status: value === null ? ('Missing' as const) : ('Live' as const), period: value === null ? '' : '2026', source: value === null ? '' : 'IMF WEO', reason: value === null ? 'IMF did not answer' : '' });
const d: Diagnosis = {
  iso3: 'BRA', asOf: '2026-11-01', pullDate: '2026-10-30', pulledAt: '2026-10-30T08:00:00Z', incomplete: false,
  figures: [fig(1, 'Inflation', 4.4), fig(2, 'Policy rate', 13.75), fig(3, 'Real GDP growth', null)],
  readings: [{ id: 'real_policy_rate', label: 'Real policy rate', unit: 'percentage points', value: 9.35, method: 'Policy rate [2] minus inflation [1].', reason: '', caveat: '', uses: [2, 1] }],
  coverage: '2 of 3 indicators live, 1 missing.',
};

test('the prompt holds the frame, every figure with its reference or Missing reason, and the principal\'s options', () => {
  const p = optionsPrompt(frame, d, [{ title: 'Cut spending', how: 'Freeze hiring' }]);
  for (const s of ['Goal: Inflation, lower, to 3%, by 2027-12', '[1] Inflation: 4.4% (IMF WEO, 2026)', '[3] Real GDP growth: Missing (IMF did not answer)', 'Real policy rate: 9.35', '1. Cut spending: Freeze hiring']) assert.ok(p.includes(s), s);
  assert.ok(p.trim().endsWith('within the constraints.'));
  assert.equal(optionsPrompt(frame, d, []), optionsPrompt(frame, d, []));
});

test('sentences with numbers not in the diagnosis are removed; unknown refs and levers are dropped', () => {
  const out = checkOptions(
    {
      options: [
        { title: 'Hold the policy rate', lever: 'monetary', how: 'Keep it at 13.75% [2]. Inflation would fall to 2.1% next year.', effect: 'Lower inflation.', refs: [2, 9], views: { cb: 'Real rate of 9.35 is tight.', fiscal: 'Debt costs rise by 40bn.' }, tradeoffs: 'Slower growth.', whoBears: 'Borrowers', mustBeTrue: 'Expectations anchored.', risks: 'Recession.' },
        { title: 'Cut spending', lever: 'magic', how: 'Freeze hiring.', refs: [] },
        { title: '', how: 'no title' },
      ],
      ranking: 'Monetary first because inflation is 4.4% [1].',
      gaps: ['Growth is missing [3].'],
    },
    frame,
    d,
    [{ title: 'Cut spending', how: '' }]
  );
  assert.equal(out.options.length, 2);
  assert.equal(out.options[0].how, 'Keep it at 13.75% [2].');
  assert.deepEqual(out.options[0].refs, [2]);
  assert.equal(out.options[0].views.cb, 'Real rate of 9.35 is tight.');
  assert.equal(out.options[0].views.fiscal, undefined);
  assert.equal(out.options[1].lever, 'other');
  assert.equal(out.options[1].fromUser, true);
  assert.deepEqual(out.options.map((o) => o.rank), [1, 2]);
  assert.equal(out.removed.length, 2);
  assert.match(out.ranking, /4\.4% \[1\]/);
});

test('gaps written as one sentence are kept, not dropped', () => {
  const out = checkOptions({ options: [{ title: 'Hold', how: 'Keep the rate [2].' }], ranking: '', gaps: 'Growth and debt are missing.' }, frame, d, []);
  assert.deepEqual(out.gaps, ['Growth and debt are missing.']);
});

test('own options are tidied and, without a model, stand unassessed', () => {
  const u = parseUserOptions([{ title: ' Raise rates ', how: 'x' }, { title: '' }, 'junk']);
  assert.deepEqual(u, [{ title: 'Raise rates', how: 'x' }]);
  assert.equal(unassessedOptions(u)[0].fromUser, true);
});
