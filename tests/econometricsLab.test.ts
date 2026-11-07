import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breaksTest, hacRegression, johansenTest, lpTest, varTest } from '../src/utils/econometricsLab.ts';
import { computeChart, testsInQuestion, type ChartRequest } from '../src/utils/councilChart.ts';
import type { Pair } from '../src/utils/stats.ts';

let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
const pairs: Pair[] = [];
{
  let a = 0;
  let b = 0;
  for (let k = 0; k < 200; k++) {
    a += rnd();
    b = 0.5 * b + 0.4 * a + (k > 120 ? 2 : 0) + rnd() * 0.8;
    pairs.push({ date: String(k), x: a, y: b });
  }
}
const close = (x: number, y: number, tol = 1e-9) => assert.ok(Math.abs(x - y) < tol, `${x} vs ${y}`);

// Reference values from statsmodels 0.15 (OLS HAC without small-sample correction, VAR.select_order
// and orth_irfs, coint_johansen det_order 0) and a brute-force search over break dates, on the same data.
test('Newey-West errors match statsmodels', () => {
  const r = hacRegression(pairs);
  if ('error' in r) throw new Error(r.error);
  close(r.seHac, 0.12265147554876812);
  assert.equal(r.lag, 4);
});

test('VAR lag and orthogonalised responses match statsmodels', () => {
  const r = varTest(pairs, 'quarterly', { draws: 40 });
  if ('error' in r) throw new Error(r.error);
  assert.equal(r.lags, 1);
  assert.equal(r.maxLag, 8);
  [0.09245737, 0.10930479, 0.12493081, 0.13940668, 0.15279965].forEach((v, h) => close(r.bToA[h].value, v, 1e-7));
  assert.equal(r.aToB[0].value, 0, 'the second series cannot move the first on impact');
  close(r.aToB[1].value, 0.00207114, 1e-7);
  assert.ok(r.bToA.every((s) => s.lo <= s.hi));
  const again = varTest(pairs, 'quarterly', { draws: 40 });
  if ('error' in again) throw new Error(again.error);
  assert.deepEqual(again.bToA, r.bToA, 'the bootstrap band is the same every time');
});

test('local projections match statsmodels OLS with HAC errors', () => {
  const r = lpTest(pairs, 'quarterly');
  if ('error' in r) throw new Error(r.error);
  assert.deepEqual(r.steps.map((s) => s.h), [0, 1, 2, 4, 6, 8]);
  close(r.steps[0].value, 0.2962854330599681);
  close(r.steps[0].se, 0.08220859621211991);
  close(r.steps[5].value, 0.626852876030498);
  close(r.steps[5].se, 0.1851576961386206);
});

test('Johansen trace statistics match statsmodels', () => {
  const r = johansenTest(pairs, 3);
  if ('error' in r) throw new Error(r.error);
  close(r.trace[0], 7.29887832, 1e-7);
  close(r.trace[1], 0.53756148, 1e-7);
  assert.equal(r.rank, 0);
});

test('Bai-Perron finds the global best break dates and sup-F', () => {
  const r = breaksTest(pairs);
  if ('error' in r) throw new Error(r.error);
  assert.deepEqual(r.breaks, [120, 169]);
  close(r.supF, 2907.4514802969, 1e-6);
  assert.ok(r.significant);
  assert.equal(r.regimes.length, 3);
  // No break in a stable relationship.
  const flat = pairs.map((p, i) => ({ ...p, y: 1 + 0.5 * p.x + Math.sin(i * 1.7) * 0.3 }));
  const f = breaksTest(flat);
  if ('error' in f) throw new Error(f.error);
  assert.equal(f.breaks.length, 0);
});

test('too few points say why instead of guessing', () => {
  const short = pairs.slice(0, 20);
  for (const r of [varTest(short, 'annual'), lpTest(short, 'annual'), johansenTest(short, 2), breaksTest(short)]) assert.ok('error' in r && /\d+/.test(r.error));
});

test('the Chart Agent reads the lab tests from a question and runs them', () => {
  assert.deepEqual(testsInQuestion('run a VAR with impulse responses and test for cointegration'), ['var', 'coint']);
  assert.deepEqual(testsInQuestion('Newey-West regression with a Chow test'), ['regression', 'hac', 'breaks']);
  assert.deepEqual(testsInQuestion('what is the VaR of my book'), []);
  const months = Array.from({ length: 200 }, (_, k) => `${2005 + Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`);
  const req: ChartRequest = { series: [{ iso3: 'BRA', countryName: 'Brazil', id: 'policy_rate', label: 'Policy rate' }, { iso3: 'BRA', countryName: 'Brazil', id: 'cpi_monthly', label: 'Inflation' }], tests: ['hac', 'var', 'lp', 'coint', 'breaks'], transform: 'level', why: 't', notes: [] };
  const r = computeChart(req, [
    { id: 'policy_rate', label: 'Policy rate', unit: '%', freq: 'monthly', source: 'BIS', points: months.map((d, k) => ({ date: d, value: pairs[k].x })) },
    { id: 'cpi_monthly', label: 'Inflation', unit: '%', freq: 'monthly', source: 'IMF', points: months.map((d, k) => ({ date: d, value: pairs[k].y })) },
  ]);
  assert.deepEqual(r.tests.map((t) => t.test), ['hac', 'var', 'lp', 'coint', 'breaks']);
  assert.ok(r.tests.every((t) => !t.reading.startsWith('Not run')), r.tests.map((t) => t.reading).join('\n'));
  assert.equal(r.tests[1].irf?.steps.length, 25);
  assert.match(r.tests[4].reading, /Bai-Perron finds 2 break/);
});
