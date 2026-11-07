import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededRandom } from '../src/utils/backtest';
import { addMonthsTo } from '../src/utils/forecastModels';
import { annualAverageMonthly, annualFromQuarterly, forecastSentence, forecastSeries, unbrokenRun, withImf } from '../src/utils/forecasts';

function normal(rand: () => number) {
  const u = Math.max(1e-9, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
const quarters = (n: number, start = 2000) => Array.from({ length: n }, (_, i) => `${start + Math.floor(i / 4)}-Q${(i % 4) + 1}`);

test('GDP forecast: eight quarters with widening bands, method and fit stated', () => {
  const rand = seededRandom(2);
  let v = 0.5;
  const pts = quarters(100).map((date) => ((v = 0.3 + 0.4 * v + 0.5 * normal(rand)), { date, value: v }));
  const r = forecastSeries('gdp_qoq', { points: pts, source: 'test', label: 'GDP q/q' });
  assert.ok(r.ok, !r.ok ? r.reason : '');
  if (!r.ok) return;
  assert.equal(r.path.length, 8);
  assert.equal(r.path[0].period, '2025-Q1');
  assert.ok(r.path[7].sd >= r.path[0].sd);
  assert.match(r.method, /^AR\(\d\) on quarterly real GDP growth/);
  assert.match(forecastSentence(r), /^App forecast, not validated advice: real gdp growth/);
});

test('a short series or a gap says why, never a number', () => {
  const r = forecastSeries('gdp_qoq', { points: quarters(20).map((date) => ({ date, value: 1 })), source: 't', label: 'g' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /Only 20 unbroken quarters/);
  assert.equal(forecastSeries('debt_gdp', null).ok, false);
  const run = unbrokenRun([{ date: '2001', value: 1 }, { date: '2003', value: 2 }, { date: '2004', value: 3 }]);
  assert.deepEqual(run.map((p) => p.date), ['2003', '2004']);
});

test('policy rate: no drift, fitted on the last 10 years, with the step caveat', () => {
  const rand = seededRandom(3);
  let rate = 20;
  const pts = Array.from({ length: 300 }, (_, i) => {
    rate = Math.max(0, rate - 0.04 + 0.2 * normal(rand));
    return { date: addMonthsTo('2001-01', i), value: rate };
  });
  const r = forecastSeries('policy_rate', { points: pts, source: 'BIS', label: 'Policy rate' });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.fit.d, 1);
  assert.equal(r.fit.to, pts[299].date);
  assert.ok(r.fit.n <= 120);
  assert.match(r.caveats[0], /steps/);
});

test('yearly bases for the IMF comparison', () => {
  // Flat level then 1% a quarter: year 2 averages 2.5% above year 1 roughly.
  const pts = [...quarters(4).map((period) => ({ period, value: 0 })), ...quarters(4, 2001).map((period) => ({ period, value: 1 }))];
  const a = annualFromQuarterly(pts);
  assert.equal(a.length, 1);
  assert.equal(a[0].period, '2001');
  assert.ok(Math.abs(a[0].value - 2.53) < 0.01, String(a[0].value));
  const m = annualAverageMonthly(Array.from({ length: 12 }, (_, i) => ({ period: addMonthsTo('2026-01', i), value: i < 6 ? 4 : 6 })));
  assert.deepEqual(m, [{ period: '2026', value: 5 }]);
});

test('IMF comparison: only IMF projections for the years the forecast reaches, labelled as the IMF\'s', () => {
  const pts = Array.from({ length: 30 }, (_, i) => ({ date: String(1996 + i), value: 50 + i }));
  const r = forecastSeries('debt_gdp', { points: pts, source: 'IMF WEO', label: 'Debt' });
  assert.ok(r.ok);
  const imf = { source: 'IMF World Economic Outlook (GGXWDG_NGDP)', points: [{ date: '2025', value: 79 }, { date: '2026', value: 80, note: 'IMF projection' }, { date: '2027', value: 81, note: 'IMF projection' }, { date: '2030', value: 90, note: 'IMF projection' }] };
  const w = withImf(r, imf);
  assert.ok(w.ok && w.imf);
  if (!w.ok || !w.imf) return;
  assert.deepEqual(w.imf.points.map((p) => p.period), ['2026', '2027']);
  assert.match(w.imf.note, /IMF's forecast, not the app's/);
});
