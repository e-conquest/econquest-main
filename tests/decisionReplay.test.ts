import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysBefore, decisionsFrom, replayDecision, replaySentence, ruleSignal } from '../src/utils/decisionReplay.ts';

const series = (id: string, points: Array<[string, number]>, source = 'test source') => ({ id, label: id, unit: '%', freq: 'monthly' as const, source, points: points.map(([date, value]) => ({ date, value })) });

const policy = series('policy_rate', [
  ['2026-03-20', 15.0],
  ['2026-05-08', 15.0],
  ['2026-06-19', 14.5],
  ['2026-09-18', 14.0],
]);
const cpi = series('cpi_monthly', [
  ['2026-04', 5.6],
  ['2026-05', 5.3],
  ['2026-06', 5.0],
  ['2026-07', 4.6],
  ['2026-08', 4.4],
  ['2026-09', 4.2],
], 'IBGE IPCA via BCB');
const cli = series('cli', [
  ['2026-02', 99.0],
  ['2026-08', 100.4],
]);
const target = { pct: 3, bandPts: 1.5, bank: 'BCB', url: 'https://www.bcb.gov.br', checked: true };

test('decisions: each change in the series, newest first', () => {
  assert.deepEqual(decisionsFrom(policy as any), [
    { date: '2026-09-18', fromPct: 14.5, toPct: 14.0 },
    { date: '2026-06-19', fromPct: 15.0, toPct: 14.5 },
  ]);
  assert.deepEqual(decisionsFrom(undefined), []);
});

test('replay: rate the week before, inflation from the month before the decision, rule and match', () => {
  const r = replayDecision({ iso3: 'BRA', date: '2026-09-18', policy: policy as any, cpi: cpi as any, cli: cli as any, target });
  assert.ok(!('error' in r));
  if ('error' in r) return;
  assert.equal(r.asOf, '2026-09-11');
  assert.deepEqual([r.action, r.rateBeforePct, r.rateAfterPct], ['cut', 14.5, 14.0]);
  // September's own print is not used for a September decision.
  assert.deepEqual(r.inflation, { month: '2026-08', pct: 4.4, source: 'IBGE IPCA via BCB' });
  assert.deepEqual(r.cli, { month: '2026-08', level: 100.4, change6m: 1.4 });
  // 2 + 4.4 + 0.5 x 1.4 = 7.1; policy 14.5 is 7.4 above: the rule pointed to cutting.
  assert.equal(r.rule?.pct, 7.1);
  assert.equal(r.rule?.gapPts, 7.4);
  assert.equal(r.rule?.signal, 'cut');
  assert.equal(r.matched, true);
  assert.match(replaySentence(r), /pointing to cutting\. The bank cut from 14\.50% to 14\.00%: in line with the rule/);
  assert.equal(r.caveats.length, 2);
});

test('replay of a hold, and missing inputs named rather than filled', () => {
  const held = replayDecision({ iso3: 'BRA', date: '2026-05-08', policy: policy as any, cpi: cpi as any, target });
  assert.ok(!('error' in held) && held.action === 'held');
  const noTarget = replayDecision({ iso3: 'EGY', date: '2026-09-18', policy: policy as any });
  assert.ok(!('error' in noTarget));
  if ('error' in noTarget) return;
  assert.equal(noTarget.rule, undefined);
  assert.deepEqual(noTarget.missing, ['monthly inflation', "the central bank's inflation target"]);
  assert.match(replaySentence(noTarget), /No rule reading: monthly inflation/);
  const tooEarly = replayDecision({ iso3: 'BRA', date: '2026-01-01', policy: policy as any });
  assert.ok('error' in tooEarly);
  assert.ok('error' in replayDecision({ iso3: 'BRA', date: '2026-09-18' }));
});

test('helpers', () => {
  assert.equal(daysBefore('2026-03-05', 7), '2026-02-26');
  assert.equal(daysBefore('2026-03', 7), '2026-02-22');
  assert.deepEqual([ruleSignal(1.5), ruleSignal(-1.5), ruleSignal(0.5)], ['cut', 'raise', 'hold']);
});
