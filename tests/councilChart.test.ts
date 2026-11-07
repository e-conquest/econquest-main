import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carryChart, chartFollowUps, chartRequest, computeChart, PRESETS, presetInQuestion, seriesInQuestion, type FetchedSeries } from '../src/utils/councilChart.ts';
import { chartAnswer, planCouncil, planFollowUp, suggestFollowUps, answersForModel, allowedNumbers, answersAsText } from '../src/utils/askCouncil.ts';
import { shiftPeriod } from '../src/utils/stats.ts';
import type { LiveWatchlistItem } from '../src/types/council.ts';

const it = (iso3: string, countryName: string) => ({ iso3, countryName }) as unknown as LiveWatchlistItem;
const BRA = it('BRA', 'Brazil');
const MEX = it('MEX', 'Mexico');
const items = [BRA, MEX, it('TUR', 'Turkey')];

// Test series made here (a policy rate that follows inflation three months later), never shown in the app.
const months = Array.from({ length: 120 }, (_, i) => shiftPeriod('2016-01', i, 'monthly'));
let seed = 7;
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
const infl = months.map((d, i) => ({ date: d, value: 5 + 3 * Math.sin(i / 9) + 0.6 * noise() }));
const rate = months.map((d, i) => ({ date: d, value: 8 + 3 * Math.sin((i - 3) / 9) + 0.4 * noise() }));
const S = (id: string, label: string, unit: string, points: Array<{ date: string; value: number }>): FetchedSeries => ({ id, label, unit, freq: 'monthly', source: 'test series', points });

test('reading the question: series in order, debt-to-GDP not read as GDP growth', () => {
  assert.deepEqual(seriesInQuestion('chart debt to GDP against the policy rate').map((s) => s.id), ['debt_gdp', 'policy_rate']);
  assert.deepEqual(seriesInQuestion('plot Brent and the exchange rate').map((s) => s.id), ['commodity_pink_sheet_crude_brent', 'fx_per_usd']);
});

test('a chart request needs chart words or a test that can run; ordinary questions are left alone', () => {
  assert.equal(chartRequest('Is Brazil behind the curve on inflation?', [BRA], true), null);
  const r = chartRequest("Chart Brazil's policy rate against inflation and test whether one leads the other", [BRA], true)!;
  assert.deepEqual(r.series.map((s) => s.id), ['policy_rate', 'cpi_monthly']);
  assert.equal(r.series[1].fallback, 'cpi_imf');
  assert.deepEqual(r.tests, ['correlation', 'leadlag']);
  // One series for two countries: both on one chart.
  const two = chartRequest('plot the policy rate for Brazil and Mexico', [BRA, MEX], true)!;
  assert.deepEqual(two.series.map((s) => s.iso3), ['BRA', 'MEX']);
  // A test word alone, with two series named, is enough.
  assert.ok(chartRequest('Is Brazil inflation correlated with the policy rate?', [BRA], true));
});

test('planner: a chart question with no desk topic goes to the Chart Agent alone; follow-ups keep the chart', () => {
  const p = planCouncil('plot Brazil copper and gold', items);
  assert.ok(p.chart);
  assert.equal(p.agents.length, 0);
  const f = planFollowUp('Is that relationship stable over time?', p, items);
  assert.ok(f.chart);
  assert.ok(f.chart!.tests.includes('rolling'));
  assert.deepEqual(f.chart!.series.map((s) => s.id), p.chart!.series.map((s) => s.id));
  const m = planFollowUp('what about Mexico?', planCouncil("chart Brazil's policy rate against inflation", items), items);
  assert.deepEqual(m.chart!.series.map((s) => s.iso3), ['MEX', 'MEX']);
  assert.ok(suggestFollowUps(p, []).length > 0);
});

test('computeChart: lines, tests with readings, and missing series named with the reason', () => {
  const req = chartRequest('chart Brazil policy rate against inflation, run a regression and Granger test, and check stationarity', [BRA], true)!;
  const res = computeChart(req, [S('policy_rate', 'Policy rate', '%', rate), { reason: 'OECD inflation has not answered yet' }]);
  assert.equal(res.lines.length, 1);
  assert.match(res.missing[0], /Inflation: Missing \(OECD inflation has not answered yet\)/);
  assert.match(res.tests.find((t) => t.test === 'regression')!.reading, /Not run: it needs two series/);

  const full = computeChart(req, [S('policy_rate', 'Policy rate', '%', rate), S('cpi_monthly', 'Inflation, monthly', '%', infl)]);
  assert.equal(full.freq, 'monthly');
  assert.equal(full.lines.length, 2);
  const lead = computeChart({ ...req, tests: ['leadlag'] }, [S('cpi_monthly', 'Inflation', '%', infl), S('policy_rate', 'Policy rate', '%', rate)]);
  assert.match(lead.tests[0].reading, /Inflation moves first, by about 3 months/);
  assert.ok(full.scatter && full.scatter.pairs.length === 120);
  assert.ok(full.tests.some((t) => t.test === 'adf'));
  assert.ok(full.tests.some((t) => t.test === 'granger' && t.figures.length));
});

test('the Chart Agent answer: findings the summary may quote, points kept off the AI request', () => {
  const req = chartRequest('chart Brazil policy rate against inflation', [BRA], true)!;
  const res = computeChart(req, [S('policy_rate', 'Policy rate', '%', rate), S('cpi_monthly', 'Inflation', '%', infl)]);
  const a = chartAnswer(req, res);
  assert.equal(a.id, 'chart');
  assert.ok(a.findings[0].figures.some((f) => /Correlation \(r\)/.test(f.label)));
  const r = res.tests[0].figures[0].value;
  assert.ok(allowedNumbers('q', [a]).includes(Number(r)));
  assert.equal('chart' in answersForModel([a])[0], false);
  assert.match(answersAsText('q', [a]), /Chart Agent/);
});

test('carryChart swaps countries for "what about Mexico?" and keeps world series', () => {
  const req = chartRequest('plot Brazil inflation and oil', [BRA], true)!;
  const next = carryChart('and Mexico?', req, [MEX]);
  assert.deepEqual(next.series.map((s) => s.iso3), ['MEX', null]);
});

test('ready-made charts: each is found by its own name, and the welcome menu wording finds it', () => {
  for (const p of PRESETS) assert.equal(presetInQuestion(`Chart the ${p.name}`)?.id, p.id, p.name);
  assert.equal(presetInQuestion("What is Brazil's real interest rate?")?.id, 'real_rate');
  assert.equal(presetInQuestion('show r-g for Turkey')?.id, 'r_minus_g');
  assert.equal(presetInQuestion('chart the yield curve')?.id, 'term_spread');
  assert.equal(presetInQuestion('Is Brazil behind the curve on inflation?'), undefined);
});

test('real policy rate: worked out on shared dates, drawn first, with where it stands', () => {
  const req = chartRequest("Chart Brazil's real policy rate", [BRA], true)!;
  assert.equal(req.preset, 'real_rate');
  assert.deepEqual(req.tests, ['summary']);
  const res = computeChart(req, [S('policy_rate', 'Policy rate', '%', rate), S('cpi_monthly', 'Inflation, monthly', '%', infl.slice(12))]);
  assert.equal(res.title, 'Brazil: Real policy rate');
  assert.equal(res.lines[0].label, 'Real policy rate');
  assert.equal(res.lines[0].points.length, 108);
  const last = res.lines[0].points[res.lines[0].points.length - 1];
  assert.ok(Math.abs(last.value - (rate[119].value - infl[119].value)) < 1e-9);
  const sum = res.tests.find((t) => t.test === 'summary')!;
  assert.match(sum.reading, /Real policy rate is .* % at 2025-12, (above|below) its average/);
  assert.ok(res.notes.some((n) => /policy rate - inflation/.test(n)));
  assert.ok(chartFollowUps(req).includes('Where is it against its trend?'));
  // Without inflation it is Missing, with the reason, and no figure is made up.
  const none = computeChart(req, [S('policy_rate', 'Policy rate', '%', rate), { reason: 'no inflation feed' }]);
  assert.ok(none.missing.some((m) => /^Real policy rate: Missing/.test(m)));
  assert.equal(none.lines.filter((l) => l.key.startsWith('d')).length, 0);
});

test('Taylor rule gap: uses the stated target, leaves out the output gap when the IMF has none, and needs a target', () => {
  const req = chartRequest('chart the Taylor rule gap for Brazil', [BRA], true)!;
  assert.equal(req.derived!.length, 2);
  const res = computeChart(req, [S('policy_rate', 'Policy rate', '%', rate), S('cpi_monthly', 'Inflation, monthly', '%', infl), { reason: 'IMF WEO has no output gap' }]);
  // Brazil target 3%: rule = 2 + 1.5 x inflation - 0.5 x 3.
  const i = 119;
  const gap = res.lines.find((l) => l.label === 'Policy rate minus Taylor rule')!;
  assert.ok(Math.abs(gap.points[gap.points.length - 1].value - (rate[i].value - (2 + 1.5 * infl[i].value - 1.5))) < 1e-9);
  assert.ok(res.notes.some((n) => /output gap term left out/.test(n)));
  const noTarget = chartRequest('chart the Taylor rule for Egypt', [it('EGY', 'Egypt')], true)!;
  assert.equal(noTarget.derived, undefined);
  assert.ok(noTarget.notes.some((n) => /Missing the central bank's inflation target/.test(n)));
});

test('ready-made charts in the chat: Chart Agent alone, follow-ups move it to another country and keep talking about it', () => {
  const p = planCouncil('chart the Phillips curve for Brazil', items);
  assert.equal(p.chart!.preset, 'phillips');
  assert.deepEqual(p.chart!.tests, ['regression', 'correlation']);
  const m = planFollowUp('and for Mexico?', p, items);
  assert.equal(m.chart!.title, 'Mexico: Phillips curve');
  const r = planCouncil("chart Brazil's real policy rate", items);
  const why = planFollowUp('What does this mean for the next policy move?', r, items);
  assert.equal(why.chart!.preset, 'real_rate');
});

test('a saved Chart Agent document keeps its chart and the request behind it, so Reports can draw it again', async () => {
  const { toAgentDocument, isCouncilDocument } = await import('../src/utils/agentDocument.ts');
  const req = chartRequest("Chart Brazil's real policy rate", [BRA], true)!;
  const res = computeChart(req, [S('policy_rate', 'Policy rate', '%', rate), S('cpi_monthly', 'Inflation, monthly', '%', infl)]);
  assert.equal(res.request, req);
  const doc = toAgentDocument(chartAnswer(req, res), { question: 'q', askedAt: '2026-11-05T20:00:00.000Z', scope: 'Brazil', countriesAsked: 1 } as never);
  assert.equal(doc.chart?.title, 'Brazil: Real policy rate');
  assert.ok(isCouncilDocument(JSON.parse(JSON.stringify(doc))));
});

test('across countries: one point per country at its latest figure, the line, and who sits furthest from it', () => {
  const many = ['BRA', 'MEX', 'TUR', 'ZAF', 'IDN', 'POL', 'CHL', 'COL', 'EGY', 'IND'].map((c) => it(c, c));
  const req = chartRequest('scatter government debt against bond yields across countries', many, false)!;
  assert.ok(req.cross);
  assert.equal(req.series.length, 20);
  assert.equal(chartRequest('scatter Brazil debt against bond yields', [BRA], true)?.cross, undefined);
  const fetched = many.flatMap((c, i): Array<FetchedSeries | { reason: string }> => {
    if (c.iso3 === 'EGY') return [{ reason: 'IMF WEO has no figure' }, { reason: 'no yield feed' }];
    const debt = 40 + 5 * i;
    const yld = 2 + 0.1 * debt + (c.iso3 === 'TUR' ? 6 : 0) + 0.3 * Math.sin(i);
    return [S('debt_gdp', 'Government debt', '% of GDP', [{ date: '2025', value: debt }]), S('yield_10y', '10Y yield', '%', [{ date: '2026-10', value: yld }])];
  });
  const res = computeChart(req, fetched);
  assert.equal(res.lines.length, 0);
  assert.equal(res.scatter!.pairs.length, 9);
  assert.match(res.missing[0], /^EGY: Missing Government debt \(IMF WEO has no figure\) and 10Y government bond yield \(no yield feed\)/);
  const reg = res.tests.find((t) => t.test === 'regression')!;
  assert.match(reg.reading, /TUR sits furthest above the line/);
  assert.ok(res.notes.some((n) => /dates run from 2025 to 2026-10/.test(n)));
  const ans = chartAnswer(req, res);
  assert.ok(ans.findings[0].figures.some((f) => f.label.startsWith('TUR: ')));
});
