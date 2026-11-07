import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleFamily, ruleFamilySentence } from '../src/utils/ruleFamily.ts';

test('rule family: five rules on the same inputs', () => {
  const r = ruleFamily({ policyPct: 10, inflation: { pct: 6, month: '2026-09' }, targetPct: 4, gap: { pct: -1, prevPct: 1, year: '2026', source: 'imf' } });
  assert.ok(r.ok);
  if (!r.ok) return;
  const by = Object.fromEntries(r.rows.map((x) => [x.id, x.pct]));
  // base = 2 + 6 + 0.5 x 2 = 9
  assert.equal(by.taylor1993, 8.5);
  assert.equal(by.balanced, 8);
  assert.equal(by.inflation_only, 9);
  assert.equal(by.inertial, 9.78); // 0.85 x 10 + 0.15 x 8.5
  assert.equal(by.first_difference, 10); // 10 + 1 + 0.5 x (-2)
  assert.deepEqual(r.range, { lo: 8, hi: 10 });
  assert.equal(r.position, 'inside the range');
  assert.equal(r.rows.find((x) => x.id === 'taylor1993')!.gapPts, 1.5);
  assert.match(ruleFamilySentence(r, 'Testland'), /5 rules prescribing 8.00-10.00%/);
});

test('rule family: gap rules Missing without a gap; nothing without rate, inflation or target', () => {
  const r = ruleFamily({ policyPct: 2, inflation: { pct: 6, month: '2026-09' }, targetPct: 3 });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.rows.filter((x) => x.pct !== undefined).length, 1);
  assert.equal(r.position, 'below the range');
  const none = ruleFamily({ inflation: { pct: 3, month: '2026-09' } });
  assert.equal(none.ok, false);
  if (!none.ok) assert.deepEqual(none.missing, ['the BIS policy rate', "the central bank's inflation target"]);
});
