import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { addMonths, cycleClockCases, type BacktestSpec, type OpenCall } from '../src/utils/backtest';
import { forwardSentence, forwardStep, forwardSummary, type ForwardBody } from '../src/utils/forwardRecord';
import { appendForward, loadForward } from '../src/utils/forwardRecordStore';

const spec: BacktestSpec = {
  id: 'cycle_clock',
  version: 1,
  registeredOn: '2026-11-05',
  registeredBy: 'test',
  hypothesis: 'h',
  method: 'cycle_clock',
  params: {},
  sample: { from: '2015-01' },
  passMark: { minCases: 5, minLiftPts: 10, maxPValue: 0.05 },
  knownLimits: [],
};

test('a call whose window runs past the data is open, not a case', () => {
  const months = Array.from({ length: 24 }, (_, i) => addMonths('2015-01', i));
  // A hike in the last two months: its 6-month window has not run out.
  const policy = months.map((period) => ({ period, pct: period < '2016-11' ? 4 : 4.25 }));
  const open: OpenCall[] = [];
  const cases = cycleClockCases(spec, 'USA', policy, open);
  assert.equal(cases.filter((c) => c.when === '2016-11').length, 0);
  assert.deepEqual(open.map((o) => [o.when, o.due]), [['2016-11', '2017-05']]);
  assert.match(open[0].what, /hike within 6 months/);
  assert.equal(cycleClockCases(spec, 'USA', policy).length, cases.length, 'cases do not change when open calls are collected');
});

test('forwardStep records open calls only while passing, and scores them later', () => {
  const t = { key: 'cycle_clock v1', specHash: 'abc', passing: true };
  const open: OpenCall[] = [{ where: 'USA', when: '2026-10', what: 'hiking: hike within 6 months?', due: '2027-04' }];
  const s1 = forwardStep([], t, [], open, '2026-11-06T00:00:00Z');
  assert.equal(s1.length, 1);
  assert.equal(s1[0].kind, 'call');
  assert.equal(forwardStep(s1, t, [], open, 'x').length, 0, 'not recorded twice');
  assert.equal(forwardStep([], { ...t, passing: false }, [], open, 'x').length, 0, 'a failing test records no calls');
  // Later the window has run out: the case is scored, even if the test no longer passes.
  const s2 = forwardStep(s1, { ...t, passing: false }, [{ where: 'USA', when: '2026-10', what: '', hit: true, base: 0.3 }], [], '2027-05-01T00:00:00Z');
  assert.deepEqual(s2.map((l) => [l.kind, (l as any).hit]), [['outcome', true]]);
  const sum = forwardSummary([...s1, ...s2])['cycle_clock v1'];
  assert.equal(sum.calls, 1);
  assert.equal(sum.hits, 1);
  assert.equal(sum.baseRatePct, 30);
  assert.equal(sum.small, true);
  assert.match(forwardSentence(sum), /1 call, 1 scored, 1 followed \(100% against a base rate of 30%\)/);
});

test('the file is a hash chain: an edited line breaks it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fwd-'));
  const file = path.join(dir, 'forward.jsonl');
  const body: ForwardBody = { kind: 'call', test: 'a v1', specHash: 'h', where: 'BRL', when: '2026-11-03', what: 'w', due: '2026-12-29', at: 't' };
  appendForward(file, [body]);
  appendForward(file, [{ ...body, when: '2026-11-10' }]);
  const ok = loadForward(file);
  assert.equal(ok.lines.length, 2);
  assert.equal(ok.chainOk, true);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"BRL"', '"MXN"'));
  assert.equal(loadForward(file).chainOk, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('nowcast forward calls: quarters ended but not published, with the benchmark beside them', async () => {
  const { gdpNowcastOpen } = await import('../src/utils/forecastCases');
  const quarters = Array.from({ length: 40 }, (_, k) => `${2016 + Math.floor(k / 4)}-Q${(k % 4) + 1}`);
  const gdpQoq = quarters.slice(0, -1).map((q, k) => ({ date: q, value: 0.5 + 0.1 * Math.sin(k) }));
  const months = Array.from({ length: 120 }, (_, k) => new Date(Date.UTC(2016, k, 1)).toISOString().slice(0, 7));
  const activity = months.map((m, k) => ({ date: m, value: 100 + k * 0.2 }));
  const spec = { id: 'gdp_nowcast', version: 1, registeredOn: '', registeredBy: '', hypothesis: '', target: 'gdp_nowcast_q', params: { gdpLagDays: 60 }, benchmark: 'mean', horizons: [1], sample: { from: '2016-Q1' }, passMark: { maxRelRmse: 1, maxPValue: 1, minSeriesShare: 0, minCasesPerHorizon: 0, minYears: 0 }, knownLimits: [] } as any;
  const open = gdpNowcastOpen(spec, [{ iso3: 'XXX', gdpQoq, activity }], '2026-01-20');
  assert.deepEqual(open.map((o) => [o.where, o.when]), [['XXX', '2025-Q4']]);
  for (const o of open) {
    assert.ok(!gdpQoq.some((g) => g.date === o.when), 'only unpublished quarters');
    assert.ok(Number.isFinite(o.forecast.model) && Number.isFinite(o.forecast.bench));
  }
});
