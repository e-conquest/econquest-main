import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OptionsStep, PolicyOption } from '../src/utils/reviewOptions';
import { cutAt, isResearchOnly, packRequests, pastEpisodes, perOption, runAnalysis, signalsFor } from '../src/utils/reviewEvidence';

const opt = (rank: number, lever: PolicyOption['lever']): PolicyOption => ({ rank, title: `Option ${rank}`, lever, how: 'x', effect: 'y', timeToEffect: '', tradeoffs: '', whoBears: '', mustBeTrue: '', risks: '', refs: [], views: {}, fromUser: false });
const step = (levers: PolicyOption['lever'][], model: string | null = 'Local Ollama'): OptionsStep => ({ templateVersion: 'v', model, temperature: 0, promptHash: 'h', options: levers.map((l, i) => opt(i + 1, l)), ranking: '', gaps: [], userOptions: [], removed: [] });

test('series are cut at the As of day, monthly and daily alike', () => {
  const s = { points: [{ date: '2026-09', value: 1 }, { date: '2026-10-31', value: 2 }, { date: '2026-11-02', value: 3 }, { date: '2026-11', value: 4 }] };
  assert.deepEqual(cutAt(s, '2026-11-01').points.map((p) => p.value), [1, 2, 4]);
});

test('past episodes: moves at least a year back, with inflation the month before and a year later', () => {
  const policy = { points: [{ date: '2023-01-01', value: 10 }, { date: '2023-03-15', value: 11 }, { date: '2024-06-01', value: 10.5 }, { date: '2026-01-10', value: 9 }] };
  const cpi = { points: [{ date: '2023-02', value: 6 }, { date: '2024-03', value: 4.5 }, { date: '2024-05', value: 4 }] };
  const e = pastEpisodes(policy, cpi, '2026-11-01');
  assert.deepEqual(e.map((x) => x.date), ['2024-06-01', '2023-03-15']);
  assert.equal(e[1].action, 'raised');
  assert.equal(e[1].changePts, -1.5);
  assert.equal(e[0].inflationAfter, undefined);
});

test('the pack runs the same tests on the same series; missing series say why', () => {
  const [, , rateInflation] = packRequests({ iso3: 'BRA', countryName: 'Brazil' });
  assert.equal(rateInflation.id, 'rate_inflation');
  const months = Array.from({ length: 48 }, (_, i) => `${2022 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
  const series = (id: string, f: (i: number) => number) => ({ id, label: id, unit: '%', freq: 'monthly', source: 'test', points: months.map((d, i) => ({ date: d, value: Number(f(i).toFixed(3)) })) });
  const fetched = [series('policy_rate', (i) => 10 + Math.sin(i / 5)), series('cpi_monthly', (i) => 5 + Math.sin((i - 3) / 5))];
  const a = runAnalysis(rateInflation.id, rateInflation.informs, rateInflation.req, fetched);
  assert.equal(a.ran, true);
  assert.deepEqual(a.inputs.map((x) => x.n), [48, 48]);
  assert.deepEqual(runAnalysis(rateInflation.id, rateInflation.informs, rateInflation.req, fetched), a);
  const none = runAnalysis(rateInflation.id, rateInflation.informs, rateInflation.req, [{ reason: 'BIS did not answer' }, { reason: 'x' }]);
  assert.equal(none.ran, false);
  assert.match(none.missing.join(' '), /BIS did not answer/);
});

test('signals follow the levers; research only unless every one has passed', () => {
  const s = signalsFor(step(['monetary', 'fiscal']), {});
  assert.ok(s.some((x) => x.id === 'taylor_gap' && x.statusLabel === 'Not validated'));
  assert.ok(s.some((x) => x.id === 'council_summary'));
  assert.equal(isResearchOnly(s), true);
  const passed = signalsFor(step(['communication'], null), { taylor_gap: { status: 'passed', verdict: 'Passed.' } });
  assert.deepEqual(passed.map((x) => x.id), ['taylor_gap']);
  assert.equal(isResearchOnly(passed), false);
  const per = perOption(step(['fiscal']), [], []);
  assert.match(per[0].note, /no statistical test for a fiscal option/);
});
