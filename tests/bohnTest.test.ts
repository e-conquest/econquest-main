import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bohnSentence, bohnTest, neweyWestLag, neweyWestSe } from '../src/utils/bohnTest.ts';

const years = Array.from({ length: 30 }, (_, i) => String(1995 + i));
// Deterministic "noise" with no trend.
const noise = (i: number) => 0.4 * Math.sin(i * 1.7) + 0.25 * Math.cos(i * 0.9);
const debtPath = years.map((_, i) => 40 + 15 * Math.sin(i / 4) + i * 0.8);
const gapPath = years.map((_, i) => 1.5 * Math.sin(i / 2.3));
const series = (vals: number[], extra: Array<{ date: string; value: number; note?: string }> = []) => ({ source: 'test', points: [...years.map((d, i) => ({ date: d, value: vals[i] })), ...extra] });

test('recovers a positive response of the primary balance to last year debt', () => {
  const pb = years.map((_, i) => (i === 0 ? 0 : -2 + 0.06 * debtPath[i - 1] + 0.3 * gapPath[i] + 0.2 * noise(i)));
  const r = bohnTest({ primaryBalance: series(pb), debt: series(debtPath), gap: years.map((y, i) => ({ year: y, central: gapPath[i] })) });
  assert.ok(r.ok);
  assert.equal(r.withGap, true);
  assert.equal(r.n, 29);
  assert.ok(Math.abs(r.rho.value - 0.06) < 0.01, `rho ${r.rho.value}`);
  assert.ok(Math.abs(r.gamma!.value - 0.3) < 0.08, `gamma ${r.gamma!.value}`);
  assert.equal(r.verdict, 'responds');
  assert.equal(r.lags, neweyWestLag(29));
  assert.match(bohnSentence(r, 'Testland'), /primary balance has risen with debt/);
});

test('no response when the primary balance ignores debt; projections left out', () => {
  const pb = years.map((_, i) => noise(i * 3) * 2);
  const r = bohnTest({
    primaryBalance: series(pb, [{ date: '2025', value: 50, note: 'IMF projection' }]),
    debt: series(debtPath, [{ date: '2024', value: 200, note: 'IMF projection' }]),
  });
  assert.ok(r.ok);
  assert.equal(r.to, '2024', 'the 2025 projection is not used');
  assert.equal(r.withGap, false);
  assert.match(r.gapNote!, /no estimate/);
  assert.equal(r.verdict, 'no_response');
  assert.match(bohnSentence(r, 'Testland'), /No evidence/);
});

test('too few years, or a missing input, is stated', () => {
  const short = { source: 't', points: years.slice(0, 10).map((d, i) => ({ date: d, value: i })) };
  assert.match((bohnTest({ primaryBalance: short, debt: short }) as { reason: string }).reason, /needs 15/);
  assert.match((bohnTest({ debt: short }) as { reason: string }).reason, /primary balance/);
});

test('Newey-West with no lags equals the White (HC0) standard error', () => {
  const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const e = [0.5, -0.2, 0.1, -0.4, 0.3, 0.0, -0.1, 0.2, -0.3, 0.1];
  const se = neweyWestSe(x.map((v) => [v]), e, 0)!;
  // Slope HC0 by hand: sum((x - mean)^2 e^2) / (sum((x - mean)^2))^2
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  const sxx = x.reduce((a, v) => a + (v - m) ** 2, 0);
  const hc0 = Math.sqrt(x.reduce((a, v, i) => a + (v - m) ** 2 * e[i] ** 2, 0) / sxx ** 2);
  assert.ok(Math.abs(se[1] - hc0) < 1e-9, `${se[1]} vs ${hc0}`);
});
