import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cliCycleText, cycleClock, nextDecisionText, policyCycle, policyCycleText } from '../src/utils/cycleClock.ts';
import { cliFor, cliHistory } from '../src/utils/oecdCli.ts';
import { policyRateFor, type CbpolPull } from '../src/utils/bisPolicyRates.ts';
import { cycleClockRows } from '../src/utils/marketsMacro.ts';

const mv = (period: string, fromPct: number, toPct: number) => ({ period, fromPct, toPct });

test('policy cycle: a run of cuts, counted from its first move', () => {
  const c = policyCycle([mv('2025-03', 10, 10.5), mv('2026-02', 10.5, 10.25), mv('2026-05', 10.25, 10), mv('2026-09', 10, 9.5)], '2026-10-27')!;
  assert.equal(c.state, 'cutting');
  assert.equal(c.movesInRun, 3);
  assert.equal(c.runPts, -1);
  assert.equal(c.since, '2026-02');
  assert.equal(c.monthsSinceLastMove, 1);
  assert.match(policyCycleText(c), /^Cutting: 3 cuts since Feb 2026, −1\.00 pts in all; last move 1 month ago$/);
});

test('policy cycle: six months without a move is on hold; no move at all says how far back it looked', () => {
  const hold = policyCycle([mv('2026-03', 5, 5.5)], '2026-10')!;
  assert.equal(hold.state, 'on hold');
  assert.match(policyCycleText(hold), /On hold for 7 months since the last hike in Mar 2026/);
  const none = policyCycle([], '2026-10', '2024-10')!;
  assert.match(policyCycleText(none), /no move since at least Oct 2024/);
  assert.equal(policyCycle(undefined, '2026-10'), null);
});

test('policy cycle: a gap of six months or more between moves starts a new run', () => {
  const c = policyCycle([mv('2025-01', 5, 5.5), mv('2026-08', 5.5, 6)], '2026-09')!;
  assert.equal(c.state, 'hiking');
  assert.equal(c.movesInRun, 1);
});

test('BIS: every month-end move is kept, plus one after the last month-end from the daily figure', () => {
  const pull: CbpolPull = {
    pulledAt: 'x',
    monthly: { MX: { points: [{ period: '2026-06', pct: 7.5 }, { period: '2026-07', pct: 7.25 }, { period: '2026-08', pct: 7.25 }, { period: '2026-09', pct: 7 }] } } as never,
    daily: { MX: { points: [{ period: '2026-10-27', pct: 6.75 }] } } as never,
  };
  const r = policyRateFor('MEX', pull, new Date('2026-11-01'))!;
  assert.deepEqual(r.moves!.map((m) => m.period), ['2026-07', '2026-09', '2026-10']);
  assert.deepEqual(r.lastMove, { period: '2026-10', fromPct: 7, toPct: 6.75 });
  assert.equal(r.historyFrom, '2026-06');
});

const series = (vals: number[], end = '2026-06') => {
  const [y, m] = end.split('-').map(Number);
  return vals.map((value, i) => ({ period: new Date(Date.UTC(y, m - vals.length + i, 1)).toISOString().slice(0, 7), value }));
};

test('CLI: months in phase and a turning point confirmed by two months the other way', () => {
  // Rising to a peak in 2026-02 (100.6), then falling four months: downturn, then slowdown below 100.
  const h = cliHistory(series([100.1, 100.3, 100.5, 100.6, 100.4, 100.2, 99.9, 99.7, 99.5]));
  assert.deepEqual(h.lastTurn, { month: '2026-01', kind: 'peak', level: 100.6 });
  assert.equal(h.phaseSince, '2026-04');
  assert.equal(h.monthsInPhase, 3);
  // A single-month wobble is not a turn.
  const w = cliHistory(series([99, 99.2, 99.4, 99.3, 99.5, 99.7]));
  assert.equal(w.lastTurn, undefined);
});

test('CLI: a gap ends the run, so nothing is read across it', () => {
  const pts = [...series([100, 101], '2025-12'), ...series([99, 98.5, 98], '2026-06')];
  const h = cliHistory(pts);
  assert.equal(h.phaseSince, '2026-05');
  assert.equal(h.phaseSinceAtStart, true);
  const r = cliFor('USA', { USA: series([100.1, 100.3, 100.5, 100.6, 100.4, 100.2, 99.9, 99.7, 99.5]) } as never);
  assert.ok(r?.lastTurn);
});

test('cycle clock: only a BIS rate counts; text and rows say where things stand, not what comes next', () => {
  const now = new Date('2026-11-05T00:00:00Z');
  const it = {
    iso3: 'MEX',
    policyRateSource: 'bis' as const,
    policyRateDate: '2026-10-27',
    policyRateMoves: [mv('2026-08', 7.5, 7.25), mv('2026-10', 7.25, 7)],
    oecdCli: { iso3: 'MEX', month: '2026-05', level: 99.4, change1m: -0.1, phase: 'slowdown' as const, phaseSince: '2026-03', monthsInPhase: 3, lastTurn: { month: '2025-12', kind: 'peak' as const, level: 100.2 }, pulledAt: 'x' },
  };
  const c = cycleClock(it, now);
  assert.equal(c.policy!.state, 'cutting');
  assert.match(cliCycleText(c.cli!), /^Slowdown for 3 months \(since Mar 2026\), as of May 2026; last turning point a peak in Dec 2025 at 100\.20$/);
  assert.equal(cycleClock({ ...it, policyRateSource: 'ai_estimate' }, now).policy, undefined);
  if (c.nextDecision) assert.match(nextDecisionText(c.nextDecision), /^\d{1,2} [A-Z][a-z]{2} \d{4}, (today|tomorrow|in \d+ days)$/);
  const rows = cycleClockRows(it as never, 'MEX', now);
  assert.deepEqual(rows.map((r) => r.label), ['Policy cycle', 'Business cycle (leading indicator)', 'Next rate decision']);
  assert.match(rows[0].source, /^model, from BIS/);
  const empty = cycleClockRows(undefined, 'EGY', now);
  assert.equal(empty[0].value, 'Missing');
  assert.equal(empty[1].value, 'Missing');
});
