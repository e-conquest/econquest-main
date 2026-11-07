import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { addMonth, excessReturn, fxFactorReturns, judgeFxFactor, signalAt, type FxFactorSpec, type FxPanel, type MonthMap } from '../src/utils/fxFactors.ts';
import { loadSpecs } from '../src/utils/backtestRun.ts';
import { panelMonths, runSignalEvaluations } from '../src/utils/fxFactorsRun.ts';

const DIR = path.join(process.cwd(), 'docs', 'validation', 'signals');
const months = Array.from({ length: 180 }, (_, k) => addMonth('2005-01', k));
const ccys = Array.from({ length: 9 }, (_, k) => `C${k}`);
const universe = ccys.map((c, k) => ({ ccy: c, bis: `B${k}`, cpi: `P${k}` }));
const spec = (factor: FxFactorSpec['factor'], over: Partial<FxFactorSpec['params']> = {}): FxFactorSpec => ({
  id: `fx_${factor}`,
  version: 1,
  method: 'fx_factor',
  factor,
  universe,
  params: { costPctPerSide: 0.25, minCurrencies: 9, cpiLagMonths: 2, lookbackMonths: factor === 'value' ? 60 : 12, skipMonths: factor === 'momentum' ? 1 : 0, resamples: 400, seed: 3, ...over },
  sample: { from: '2005-01' },
  passMark: { maxPValue: 0.05, minAnnualNetPct: 0, minMonths: 120, minYears: 10 },
});

/** Currency k pays a policy rate of k% over a 1% US rate; its FX is flat (no depreciation). */
function carryPanel(): FxPanel {
  const flat = (v: number): MonthMap => new Map(months.map((m) => [m, v]));
  const fx: Record<string, MonthMap> = {};
  const policy: Record<string, MonthMap> = { US: flat(1) };
  const cpiYoy: Record<string, MonthMap> = { USA: flat(2) };
  ccys.forEach((c, k) => {
    fx[c] = flat(10 + k);
    policy[`B${k}`] = flat(1 + k);
    cpiYoy[`P${k}`] = flat(2);
  });
  return { fx, policy, cpiYoy, usCpi: 'USA' };
}

test('excess return: rate gap over twelve months less the log depreciation', () => {
  const p = carryPanel();
  p.fx.C3.set('2010-02', 13 * 1.01);
  const r = excessReturn(p, universe[3], '2010-01')!;
  assert.ok(Math.abs(r - (3 / 12 - 100 * Math.log(1.01))) < 1e-9);
});

test('carry: long the high-rate third, short the low-rate third; turnover only when positions change', () => {
  const rows = fxFactorReturns(spec('carry'), carryPanel(), months.slice(0, -1));
  assert.ok(rows.length > 100);
  assert.deepEqual(rows[0].long, ['C8', 'C7', 'C6']);
  assert.deepEqual(rows[0].short, ['C2', 'C1', 'C0']);
  // Gross = (avg 7% - avg 1%) / 12 = 0.5% a month; first month trades 2 units at 0.25%.
  assert.ok(Math.abs(rows[0].gross - 0.5) < 1e-9);
  assert.ok(Math.abs(rows[0].cost - 0.5) < 1e-9);
  assert.equal(rows[1].turnover, 0);
  const j = judgeFxFactor(spec('carry'), rows);
  assert.equal(j.status, 'passed', j.verdict);
  assert.ok(Math.abs(j.annualNetPct - 6) < 0.1);
});

test('value: real depreciation over five years with prices lagged; momentum skips the latest month', () => {
  const p = carryPanel();
  // C0 weakens 20% over five years with no extra inflation: the cheapest currency.
  months.forEach((m, i) => p.fx.C0.set(m, 10 * Math.exp((0.2 * Math.min(i, 60)) / 60)));
  const v = signalAt(spec('value'), p, universe[0], months[60])!;
  assert.ok(Math.abs(v - 20) < 1e-6, String(v));
  // Higher inflation in C1 (5% vs 2% for five years) with flat FX = real appreciation.
  p.cpiYoy.P1 = new Map(months.map((m) => [m, 5]));
  const v1 = signalAt(spec('value'), p, universe[1], months[100])!;
  assert.ok(v1 < 0);
  // Momentum on the plain carry panel: 11 months of a 4-point carry (C4 pays 5% against 1%).
  const mo = signalAt(spec('momentum'), carryPanel(), universe[4], months[50])!;
  assert.ok(Math.abs(mo - (11 * 4) / 12) < 1e-9, String(mo));
});

test('a losing or short record does not pass', () => {
  const p = carryPanel();
  // High-rate currencies lose more to depreciation than they earn.
  ccys.forEach((c, k) => p.fx[c] = new Map(months.map((m, i) => [m, (10 + k) * Math.exp((i * k * 0.002))])));
  const j = judgeFxFactor(spec('carry'), fxFactorReturns(spec('carry'), p, months.slice(0, -1)));
  assert.equal(j.status, 'failed');
  const short = fxFactorReturns(spec('carry'), carryPanel(), months.slice(0, 60));
  assert.equal(judgeFxFactor(spec('carry'), short).status, 'too_few_cases');
  assert.equal(fxFactorReturns(spec('carry', { minCurrencies: 10 }), carryPanel(), months).length, 0, 'too few currencies: no month');
});

test('the three registered specs match their hashes; an offline run passes nothing', async () => {
  const specs = loadSpecs(DIR);
  assert.equal(specs.length, 3);
  for (const s of specs) assert.equal(s.problem, undefined, `${s.file}: ${s.problem}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-'));
  const out = await runSignalEvaluations({ specDir: DIR, resultFile: path.join(dir, 'signals.json'), fetcher: async () => { throw new Error('offline'); }, now: new Date('2000-02-01T00:00:00Z') });
  assert.ok(out.problems.some((p) => /BIS policy rates did not answer/.test(p)));
  for (const r of Object.values(out.results)) assert.notEqual(r.status, 'passed');
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(panelMonths({ fx: { A: new Map([['2000-01', 1], ['2000-02', 1]]) }, policy: {}, cpiYoy: {}, usCpi: 'USA' }), ['2000-01']);
});

test('forward record: the latest book is recorded open, then scored as recorded', async () => {
  const { fxFactorBook } = await import('../src/utils/fxFactors.ts');
  const { recordedOutcomes } = await import('../src/utils/fxFactorsRun.ts');
  const { forwardStep } = await import('../src/utils/forwardRecord.ts');
  const p = carryPanel();
  const last = months[months.length - 1];
  assert.deepEqual(fxFactorBook(spec('carry'), p, last), { long: ['C8', 'C7', 'C6'], short: ['C2', 'C1', 'C0'] });
  const done = months.slice(0, -1);
  const rows = fxFactorReturns(spec('carry'), p, done);
  const key = 'fx_carry v1';
  // Recorded at the second-to-last month while it was still open.
  const t = done[done.length - 1];
  const call = forwardStep([], { key, specHash: 'h', passing: true }, [], [{ where: 'book', when: t, what: 'w', due: last, book: { long: ['C8', 'C7', 'C6'], short: ['C2', 'C1', 'C0'] } }], 'at');
  const cases = recordedOutcomes(spec('carry'), p, done, rows, call, key, 0.5);
  assert.equal(cases.length, 1);
  assert.ok(Math.abs(cases[0].value - 0.5) < 1e-9, 'gross 0.5% a month, no turnover from the month before');
  const outcome = forwardStep(call, { key, specHash: 'h', passing: true }, cases, [], 'later');
  assert.deepEqual(outcome.map((l) => [l.kind, (l as any).hit, (l as any).value]), [['outcome', true, 0.5]]);
});
