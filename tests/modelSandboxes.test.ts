import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debtSandbox, filterSandbox, taylorSandbox } from '../src/utils/modelSandboxes.ts';

test('debt sandbox runs the identity and the stabilising balance', () => {
  // i = n and pb = 0 keeps debt where it is; the stabilising balance is then 0.
  const flat = debtSandbox({ debt: 60, i: 5, g: 2, pi: (1.05 / 1.02 - 1) * 100, pb: 0, years: 3 });
  assert.equal(flat.path.length, 4);
  assert.ok(flat.path.every((d) => Math.abs(d - 60) < 0.01));
  assert.ok(Math.abs(flat.stabilisingPb) < 0.01);
  // i above n raises debt; the stabilising balance is d (i - n) / (1 + n).
  const r = debtSandbox({ debt: 100, i: 8, g: 1, pi: 2, pb: 0, years: 1 });
  const n = (1.01 * 1.02 - 1) * 100;
  assert.equal(r.nominalGrowth, Math.round(n * 100) / 100);
  assert.equal(r.end, Math.round(((100 * 1.08) / (1 + n / 100)) * 100) / 100);
  assert.equal(r.stabilisingPb, Math.round(((100 * (8 - n)) / (100 + n)) * 100) / 100);
  // Holding the stabilising balance keeps debt steady.
  const held = debtSandbox({ debt: 100, i: 8, g: 1, pi: 2, pb: (100 * (8 - n)) / (100 + n), years: 5 });
  assert.ok(Math.abs(held.end - 100) < 0.01);
  // Years are clamped to 1-30.
  assert.equal(debtSandbox({ debt: 50, i: 3, g: 2, pi: 2, pb: 0, years: 99 }).path.length, 31);
});

test('Taylor sandbox adds the four terms', () => {
  const r = taylorSandbox({ rStar: 2, pi: 6, target: 2, gap: -1, aPi: 0.5, aGap: 0.5 });
  assert.equal(r.rate, 2 + 6 + 2 - 0.5);
  assert.deepEqual(
    r.terms.map((t) => t.value),
    [2, 6, 2, -0.5],
  );
  assert.equal(taylorSandbox({ rStar: 1, pi: 3, target: 3, gap: 2, aPi: 1.5, aGap: 0 }).rate, 4);
});

test('filter sandbox needs 15 outturns and leaves projections out', () => {
  const pts = (n: number, from = 2000) => Array.from({ length: n }, (_, k) => ({ date: String(from + k), value: 2 + Math.sin(k) * 2 }));
  const short = filterSandbox(pts(10), 100, 2);
  assert.ok('reason' in short && /only 10/.test(short.reason));
  const withProj = [...pts(20), { date: '2020', value: 3, note: 'IMF projection' }];
  const r = filterSandbox(withProj, 100, 2);
  assert.ok(!('reason' in r));
  if ('reason' in r) return;
  assert.equal(r.outturns, 20);
  assert.equal(r.latest?.year, '2019');
  // HP gaps sum to about zero; Hamilton needs h + 4 years before its first value.
  assert.ok(Math.abs(r.years.reduce((s, y) => s + (y.hp || 0), 0)) < 0.1);
  assert.equal(r.years[0].hamilton, undefined);
  assert.ok(r.years.some((y) => y.hamilton !== undefined));
  // A larger lambda gives a smoother trend, so larger gaps.
  const big = filterSandbox(pts(20), 1600, 2);
  const small = filterSandbox(pts(20), 1, 2);
  if ('reason' in big || 'reason' in small) throw new Error('unexpected');
  const ss = (x: typeof big) => x.years.reduce((s, y) => s + (y.hp || 0) ** 2, 0);
  assert.ok(ss(big) > ss(small));
});
