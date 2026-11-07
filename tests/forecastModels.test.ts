import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededRandom } from '../src/utils/backtest';
import { bandsFor, fitAr, fitBridge, forecastAr, monthsOf, periodEnd, predictBridge, psiWeights, publishedBy, quarterlyFromMonthly, quarterOf } from '../src/utils/forecastModels';
import { arForecastCases, dieboldMariano, judgeForecast, scoreHorizon, unbrokenTail, type ForecastCase, type ForecastSpec } from '../src/utils/forecastEval';

function normal(rand: () => number) {
  const u = Math.max(1e-9, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Simulated AR(1): y_t = c + phi y_{t-1} + e_t. */
function ar1(n: number, c: number, phi: number, sigma: number, seed = 7): number[] {
  const rand = seededRandom(seed);
  const y = [c / (1 - phi)];
  for (let t = 1; t < n; t++) y.push(c + phi * y[t - 1] + sigma * normal(rand));
  return y;
}

test('AR fit recovers the coefficient of a simulated AR(1) and picks lag 1', () => {
  const y = ar1(600, 1, 0.6, 0.5);
  const f = fitAr(y, { maxLag: 4 });
  assert.ok(!('error' in f));
  assert.equal(f.p, 1);
  assert.ok(Math.abs(f.coef[1] - 0.6) < 0.08, `phi ${f.coef[1]}`);
  assert.ok(Math.abs(f.sigma - 0.5) < 0.05, `sigma ${f.sigma}`);
});

test('psi weights and forecast spread of an AR(1)', () => {
  assert.deepEqual(psiWeights([0.5], 4), [1, 0.5, 0.25, 0.125]);
  const fit = { p: 1, d: 0 as const, coef: [1, 0.5], sigma: 2, n: 100, bic: 0 };
  const f = forecastAr(fit, [4], 3);
  assert.equal(f[0].mean, 3);
  assert.equal(f[1].mean, 2.5);
  assert.ok(Math.abs(f[0].sd! - 2) < 1e-12);
  assert.ok(Math.abs(f[1].sd! - 2 * Math.sqrt(1.25)) < 1e-12);
  // Bands are symmetric around the mean and nest.
  const b = bandsFor(f[1]);
  assert.equal(b.length, 3);
  assert.ok(b[0].hi - b[0].lo < b[2].hi - b[2].lo);
});

test('on the change (d = 1) the level forecast adds up the changes and the band keeps widening', () => {
  const fit = { p: 0, d: 1 as const, coef: [0.25], sigma: 1, n: 100, bic: 0 };
  const f = forecastAr(fit, [10, 10.5, 11], 4);
  assert.deepEqual(f.map((p) => p.mean), [11.25, 11.5, 11.75, 12]);
  assert.deepEqual(f.map((p) => Number(p.sd!.toFixed(6))), [1, Math.SQRT2, Math.sqrt(3), 2].map((v) => Number(v.toFixed(6))));
});

test('a short or broken series says why instead of fitting', () => {
  const short = fitAr([1, 2, 3, 4, 5], { maxLag: 2 });
  assert.ok('error' in short && /usable observations/.test(short.error));
  const gap = fitAr([...ar1(40, 0, 0.5, 1), NaN, 1], { maxLag: 2 });
  assert.ok('error' in gap && /gap/.test(gap.error));
});

test('bridge equation recovers the indicator coefficient and skips rows with a missing value', () => {
  const rand = seededRandom(3);
  const x: number[] = [];
  const y: Array<number | null> = [];
  for (let t = 0; t < 120; t++) {
    x.push(normal(rand));
    const prev = (y[t - 1] as number) ?? 0;
    y.push(0.5 + 0.8 * x[t] + 0.3 * prev + 0.1 * normal(rand));
  }
  const X = x.map((v, t) => [t === 50 ? null : v]);
  const fit = fitBridge(y, X, { indicators: ['cli'], targetLags: 1 });
  assert.ok(!('error' in fit));
  assert.equal(fit.n, 118); // first row has no lag, row 50 has a missing indicator
  assert.ok(Math.abs(fit.coef[1] - 0.8) < 0.05);
  assert.ok(Math.abs(fit.coef[2] - 0.3) < 0.05);
  const p = predictBridge(fit, [1], [2]);
  assert.ok(!('error' in p));
  assert.ok(Math.abs(p.mean - (fit.coef[0] + fit.coef[1] + 2 * fit.coef[2])) < 1e-12);
  assert.ok('error' in predictBridge(fit, [NaN], [2]));
});

test('periods, quarters and the published-by rule', () => {
  assert.equal(periodEnd('2026-02'), '2026-02-28');
  assert.equal(periodEnd('2026-Q3'), '2026-09-30');
  assert.equal(periodEnd('2025'), '2025-12-31');
  assert.equal(quarterOf('2026-05'), '2026-Q2');
  assert.deepEqual(monthsOf('2026-Q4'), ['2026-10', '2026-11', '2026-12']);
  const pts = [{ date: '2026-Q1', value: 1 }, { date: '2026-Q2', value: 2 }, { date: '2026-Q3', value: 3 }];
  // Q2 ends 30 June; with a 60-day lag it is out on 29 August.
  assert.deepEqual(publishedBy(pts, '2026-08-28', 60).map((p) => p.date), ['2026-Q1']);
  assert.deepEqual(publishedBy(pts, '2026-08-29', 60).map((p) => p.date), ['2026-Q1', '2026-Q2']);
});

test('quarterly averages: full quarters averaged, the ragged edge filled by a forecast and said so', () => {
  const months: { date: string; value: number }[] = [];
  const y = ar1(61, 0.2, 0.7, 0.3, 11);
  for (let i = 0; i < 61; i++) {
    const d = new Date(Date.UTC(2021, i, 1)).toISOString().slice(0, 7);
    months.push({ date: d, value: y[i] });
  }
  // 2021-01 .. 2026-01: 2026-Q1 has one month out.
  const none = quarterlyFromMonthly(months);
  assert.equal(none[none.length - 1].quarter, '2025-Q4');
  const q = quarterlyFromMonthly(months, { fill: 'ar' });
  const last = q[q.length - 1];
  assert.equal(last.quarter, '2026-Q1');
  assert.equal(last.monthsPublished, 1);
  assert.equal(last.monthsForecast, 2);
  const q4 = q.find((r) => r.quarter === '2025-Q4')!;
  assert.ok(Math.abs(q4.value - (y[57] + y[58] + y[59]) / 3) < 1e-12);
  assert.equal(q4.monthsForecast, 0);
  // A hole inside the history leaves that quarter out, never filled.
  const holed = months.filter((m) => m.date !== '2023-05');
  assert.ok(!quarterlyFromMonthly(holed, { fill: 'ar' }).some((r) => r.quarter === '2023-Q2'));
});

const spec = (over: Partial<ForecastSpec> = {}): ForecastSpec => ({
  id: 't',
  version: 1,
  registeredOn: '2026-11-06',
  registeredBy: 'test',
  hypothesis: 'h',
  target: 'gdp_growth_q',
  params: { maxLag: 4, minTrain: 40 },
  benchmark: 'naive',
  horizons: [1, 4],
  sample: { from: '0000' },
  passMark: { maxRelRmse: 0.95, maxPValue: 0.1, minSeriesShare: 0.5, minCasesPerHorizon: 50, minYears: 8 },
  knownLimits: [],
  ...over,
});

function quarterlySeries(where: string, values: number[]) {
  const dates = values.map((_, i) => `${1980 + Math.floor(i / 4)}-Q${(i % 4) + 1}`);
  return { where, dates, values };
}

test('rolling origin: a mean-reverting series beats the naive benchmark and passes', () => {
  const series = [quarterlySeries('AAA', ar1(200, 1, 0.3, 1, 1)), quarterlySeries('BBB', ar1(200, 0.5, 0.2, 1, 2))];
  const cases = arForecastCases(series, spec());
  // Origins use only data up to themselves: every target is after its origin.
  assert.ok(cases.every((c) => c.target > c.origin));
  const r = judgeForecast(spec(), 'hash', cases, 'simulated');
  assert.equal(r.status, 'passed', r.verdict);
  assert.ok(r.horizons[0].relRmse < 0.95);
  // Bands roughly hold on data drawn from the model's own family.
  assert.ok(r.horizons[0].coverage90! > 0.8 && r.horizons[0].coverage90! <= 1);
});

test('rolling origin: on a random walk the AR does not beat the naive benchmark, and fails', () => {
  const rand = seededRandom(5);
  const rw = (n: number) => {
    const y = [0];
    for (let t = 1; t < n; t++) y.push(y[t - 1] + normal(rand));
    return y;
  };
  const series = [quarterlySeries('AAA', rw(200)), quarterlySeries('BBB', rw(200))];
  const r = judgeForecast(spec(), 'hash', arForecastCases(series, spec()), 'simulated');
  assert.equal(r.status, 'failed', r.verdict);
  assert.match(r.verdict, /Pass mark/);
});

test('too few cases says so instead of judging', () => {
  const series = [quarterlySeries('AAA', ar1(60, 1, 0.3, 1, 1))];
  const r = judgeForecast(spec(), 'hash', arForecastCases(series, spec()), 'simulated');
  assert.equal(r.status, 'too_few_cases');
});

test('the year-block bootstrap gives the same answer every run', () => {
  const series = [quarterlySeries('AAA', ar1(200, 1, 0.3, 1, 1))];
  const cases = arForecastCases(series, spec());
  assert.deepEqual(scoreHorizon(cases, 1), scoreHorizon(cases, 1));
});

test('Diebold-Mariano: negative and significant when the model is clearly better', () => {
  const rand = seededRandom(9);
  const cases: ForecastCase[] = Array.from({ length: 80 }, (_, i) => {
    const actual = normal(rand);
    return { where: 'A', origin: String(2000 + i), target: String(2001 + i), h: 1, actual, model: { mean: actual + 0.1 * normal(rand) }, bench: { mean: actual + normal(rand) } };
  });
  const dm = dieboldMariano(cases, 1)!;
  assert.ok(dm.dm < 0 && dm.pValue < 0.01);
});

test('unbroken tail keeps only the run of periods that ends at the newest point', () => {
  const next = (d: string) => String(Number(d) + 1);
  const s = unbrokenTail({ where: 'A', dates: ['2000', '2001', '2003', '2004', '2005'], values: [1, 2, 3, 4, 5] }, next);
  assert.deepEqual(s.dates, ['2003', '2004', '2005']);
});

test('without an intercept the AR on changes has no drift', () => {
  const rand = seededRandom(12);
  const y = [10];
  for (let t = 1; t < 200; t++) y.push(y[t - 1] - 0.05 + 0.3 * (y[t - 1] - (y[t - 2] ?? y[t - 1])) + 0.2 * normal(rand));
  const withDrift = fitAr(y, { maxLag: 2, d: 1 });
  const noDrift = fitAr(y, { maxLag: 2, d: 1, intercept: false });
  assert.ok(!('error' in withDrift) && !('error' in noDrift));
  assert.equal(noDrift.coef[0], 0);
  const f = forecastAr(noDrift, y, 60);
  // Without drift the path settles instead of trending down for ever.
  assert.ok(Math.abs(f[59].mean - f[30].mean) < 0.05);
});
