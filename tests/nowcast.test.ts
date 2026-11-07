import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededRandom } from '../src/utils/backtest';
import { addMonthsTo, monthsOf } from '../src/utils/forecastModels';
import { cpiNowcast, gdpNowcast, nowcastSentence, quarterlyIndicator } from '../src/utils/nowcast';

function normal(rand: () => number) {
  const u = Math.max(1e-9, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Monthly activity index from 2005-01 and quarterly GDP growth that tracks it closely. */
function world(seed = 1) {
  const rand = seededRandom(seed);
  const months: { date: string; value: number }[] = [];
  let level = 100;
  for (let i = 0; i < 12 * 21 + 8; i++) {
    level *= 1 + (0.002 + 0.006 * normal(rand));
    months.push({ date: addMonthsTo('2005-01', i), value: level });
  }
  const byMonth = new Map(months.map((m) => [m.date, m.value]));
  const quarters: { date: string; value: number }[] = [];
  let prevAvg: number | null = null;
  for (let y = 2005; y <= 2026; y++) {
    for (let q = 1; q <= 4; q++) {
      const key = `${y}-Q${q}`;
      const ms = monthsOf(key).map((m) => byMonth.get(m));
      if (ms.some((v) => v === undefined)) continue;
      const avg = (ms as number[]).reduce((a, b) => a + b, 0) / 3;
      if (prevAvg !== null) quarters.push({ date: key, value: 0.2 + 0.8 * ((avg / prevAvg - 1) * 100) + 0.1 * normal(rand) });
      prevAvg = avg;
    }
  }
  return { months, quarters };
}

test('quarterly indicator: growth of quarterly averages, the ragged edge flagged', () => {
  const pts = [
    ...['2026-01', '2026-02', '2026-03'].map((d) => ({ date: d, value: 100 })),
    ...['2026-04', '2026-05', '2026-06'].map((d) => ({ date: d, value: 102 })),
  ];
  const s = quarterlyIndicator(pts, 'pct', '2026-Q2');
  assert.ok(Math.abs(s.get('2026-Q2')!.value - 2) < 1e-9);
  assert.equal(s.get('2026-Q2')!.monthsForecast, 0);
});

test('GDP nowcast: bridge on the activity index for the quarters after the newest GDP figure', () => {
  const { months, quarters } = world();
  // GDP published to 2026-Q1; activity out to 2026-08 (two months of Q3).
  const gdp = quarters.filter((q) => q.date <= '2026-Q1');
  const act = months.filter((m) => m.date <= '2026-08');
  const r = gdpNowcast({ iso3: 'BRA', asOf: '2026-09-15', live: true, gdp: { points: gdp, source: 'test GDP' }, activity: { points: act, source: 'test', label: 'Activity index' } });
  assert.ok(r.ok, !r.ok ? r.reason : '');
  if (!r.ok) return;
  assert.deepEqual(r.points.map((p) => p.period), ['2026-Q2', '2026-Q3']);
  const q3 = r.points[1];
  assert.equal(q3.indicators[0].monthsPublished, 2);
  assert.equal(q3.indicators[0].monthsForecast, 1);
  assert.match(q3.how, /2 of 3 months out, 1 forecast/);
  // Q2 is fully published, so it should land close to the true value.
  const truth = quarters.find((q) => q.date === '2026-Q2')!.value;
  assert.ok(Math.abs(r.points[0].mean - truth) < 0.5, `${r.points[0].mean} vs ${truth}`);
  assert.ok(r.fit.r2! > 0.8);
  assert.equal(r.points[0].bands.length, 3);
  assert.match(nowcastSentence(r), /^App nowcast, not validated advice: 2026-Q3 real GDP/);
});

test('GDP nowcast for a past As-of date uses only what was published then, and says so', () => {
  const { months, quarters } = world();
  const r = gdpNowcast({ iso3: 'BRA', asOf: '2020-05-10', live: false, gdp: { points: quarters, source: 'g' }, activity: { points: months, source: 'a', label: 'Activity index' } });
  assert.ok(r.ok);
  if (!r.ok) return;
  // 2020-Q1 ends 31 March; with a 60-day lag it is not out on 10 May, so Q4 2019 is the newest.
  assert.equal(r.lastPublished.period, '2019-Q4');
  assert.deepEqual(r.points.map((p) => p.period), ['2020-Q1', '2020-Q2']);
  // Activity: March is out on 10 May? 31 Mar + 45 days = 15 May: no, so Q1 has 2 months out.
  assert.equal(r.points[0].indicators[0].monthsPublished, 2);
  assert.match(r.caveats[0], /today's vintage/);
});

test('GDP nowcast without any indicator falls back to an AR on GDP growth and says so; no GDP says why', () => {
  const { quarters } = world();
  const r = gdpNowcast({ iso3: 'XXX', asOf: '2026-09-15', live: true, gdp: { points: quarters.filter((q) => q.date <= '2026-Q1'), source: 'g' } });
  assert.ok(r.ok);
  if (r.ok) assert.match(r.points[0].how, /No monthly activity indicator for this country: AR on GDP growth alone/);
  const none = gdpNowcast({ iso3: 'EGY', asOf: '2026-09-15', live: true, gdp: null });
  assert.equal(none.ok, false);
  if (!none.ok) assert.match(none.reason, /No quarterly GDP/);
});

test('inflation nowcast: AR months from the newest figure to the As-of month', () => {
  const rand = seededRandom(4);
  const pts: { date: string; value: number }[] = [];
  let v = 4;
  for (let i = 0; i < 120; i++) {
    v = 1 + 0.75 * v + 0.3 * normal(rand);
    pts.push({ date: addMonthsTo('2016-08', i), value: v });
  }
  // Newest month 2026-07; As-of November: Aug to Nov nowcast.
  const r = cpiNowcast({ iso3: 'BRA', asOf: '2026-11-06', live: true, cpi: { points: pts, source: 'test CPI' } });
  assert.ok(r.ok, !r.ok ? r.reason : '');
  if (!r.ok) return;
  assert.equal(r.lastPublished.period, '2026-07');
  assert.deepEqual(r.points.map((p) => p.period), ['2026-08', '2026-09', '2026-10', '2026-11']);
  assert.ok(r.points[3].sd > r.points[0].sd);
  const short = cpiNowcast({ iso3: 'BRA', asOf: '2026-11-06', live: true, cpi: { points: pts.slice(-20), source: 't' } });
  assert.equal(short.ok, false);
});

test('inflation splice: OECD history, then the national series for the months after it, both named', async () => {
  const { spliceInflation } = await import('../src/utils/modelHistory');
  const s = spliceInflation(
    [{ period: '2026-04', value: 5 }, { period: '2026-05', value: 5.1 }],
    { points: [{ period: '2026-05', value: 9 }, { period: '2026-06', value: 5.3 }], short: 'BCB IPCA' }
  )!;
  assert.deepEqual(s.points.map((p) => p.value), [5, 5.1, 5.3]);
  assert.equal(s.source, 'OECD CPI via DBnomics to 2026-05, then BCB IPCA');
  assert.equal(spliceInflation(undefined, undefined), null);
});

test('nowcast evaluation cases: one per quarter, made before GDP for it was out, only where the bridge ran', async () => {
  const { gdpNowcastCases } = await import('../src/utils/forecastCases');
  const { months, quarters } = world(5);
  const spec = { id: 'g', version: 1, registeredOn: '', registeredBy: '', hypothesis: '', target: 'gdp_nowcast_q' as const, params: { asOfDaysAfterQuarter: 30, gdpLagDays: 60 }, benchmark: 'mean' as const, horizons: [1], sample: { from: '2015-Q1' }, passMark: { maxRelRmse: 0.9, maxPValue: 0.1, minSeriesShare: 0.5, minCasesPerHorizon: 10, minYears: 3 }, knownLimits: [] };
  const { cases, series } = gdpNowcastCases(spec, [{ iso3: 'AAA', gdpQoq: quarters, activity: months }, { iso3: 'NOI', gdpQoq: quarters }]);
  assert.deepEqual(series, ['AAA']);
  assert.ok(cases.length > 30);
  for (const c of cases) assert.ok(c.origin < c.target);
  // The bridge tracks the simulated activity closely, far better than the mean.
  const rm = Math.sqrt(cases.reduce((s, c) => s + (c.actual - c.model.mean) ** 2, 0) / cases.length);
  const rb = Math.sqrt(cases.reduce((s, c) => s + (c.actual - c.bench.mean) ** 2, 0) / cases.length);
  assert.ok(rm < 0.6 * rb, `${rm} vs ${rb}`);
});
