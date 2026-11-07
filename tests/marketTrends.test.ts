import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byMovingMost, cliTrendText, policyMoveText, signedBps, trendFor, trendForObservation } from '../src/utils/marketTrends.ts';
import { parseFredApiLatest, parseFredCsvLatest, monthsBefore } from '../src/utils/officialYields.ts';
import { watchlistYieldFields } from '../src/utils/watchlistYield.ts';

const csv = (rows: [string, string][]) => ['observation_date,X', ...rows.map((r) => r.join(','))].join('\n');

test('FRED CSV: latest yield carries its 3- and 12-month changes by calendar month', () => {
  const rows: [string, string][] = [];
  for (let i = 0; i <= 14; i++) rows.push([`${monthsBefore('2026-09', 14 - i)}-01`, (5 + i * 0.1).toFixed(2)]);
  const o = parseFredCsvLatest(csv(rows), 'X')!;
  assert.equal(o.period, '2026-09');
  assert.equal(o.valuePct, 6.4);
  assert.equal(o.change3mPts, 0.3);
  assert.equal(o.change12mPts, 1.2);
});

test('FRED: a gap in the series gives no change rather than one over a shorter span', () => {
  const o = parseFredCsvLatest(csv([['2026-05-01', '4.00'], ['2026-07-01', '4.20'], ['2026-09-01', '4.50'], ['2026-08-01', '.']]), 'X')!;
  assert.equal(o.valuePct, 4.5);
  assert.equal(o.change3mPts, undefined); // June is missing
  assert.equal(o.change12mPts, undefined);
});

test('FRED API: unsorted observations, newest wins; implausible latest value means a broken feed', () => {
  const o = parseFredApiLatest({ observations: [{ date: '2026-06-01', value: '4.0' }, { date: '2026-09-01', value: '3.5' }] }, 'X')!;
  assert.equal(o.valuePct, 3.5);
  assert.equal(o.change3mPts, -0.5);
  assert.equal(parseFredApiLatest({ observations: [{ date: '2026-09-01', value: '99' }, { date: '2026-08-01', value: '4' }] }, 'X'), null);
});

test('watchlist row keeps the yield changes from an official figure', () => {
  const snap = { dataStatus: { verifiedLiveSources: [], checkedAt: 'x' }, monetaryAndMarket: { sovereign10YBondYieldPct: 9 } } as never;
  const f = watchlistYieldFields(snap, { valuePct: 9, period: '2026-09', source: 's', seriesId: 'x', url: 'u', change3mPts: -0.25, change12mPts: 1 });
  assert.equal(f.yield10YChange3mPts, -0.25);
  assert.equal(f.yield10YChange12mPts, 1);
});

test('trend: yield and spread change in bps; spread only when both are monthly for the same month', () => {
  const us = { valuePct: 4, period: '2026-09', source: 's', seriesId: 'u', url: 'u', change3mPts: -0.1 };
  const t = trendFor({ yield10YChange3mPts: 0.35, yield10YChange12mPts: -1.2, yield10YPeriod: '2026-09', yield10YFrequency: 'monthly' }, us);
  assert.equal(t.yieldChg3mBps, 35);
  assert.equal(t.yieldChg12mBps, -120);
  assert.equal(t.spreadChg3mBps, 45);
  assert.equal(t.moveScore, 35);
  assert.equal(trendFor({ yield10YChange3mPts: 0.35, yield10YPeriod: '2026-08', yield10YFrequency: 'monthly' }, us).spreadChg3mBps, undefined);
  assert.deepEqual(trendFor({}, us), {});
});

test('trend: last policy move and leading indicator in words', () => {
  const t = trendFor({ policyRateLastMove: { period: '2026-09', fromPct: 11.25, toPct: 10.75 }, oecdCli: { iso3: 'X', month: '2026-05', level: 99.6, change1m: -0.12, phase: 'downturn', pulledAt: 'x' } });
  assert.equal(policyMoveText(t.policyMove!), '−0.50 pts, Sep 2026');
  assert.match(cliTrendText(t.cli!), /^Downturn, −0\.12 \(May 2026\)$/);
  assert.equal(signedBps(0), '0 bps');
});

test('benchmark trend: the US row has no spread change; moving-most sort puts rows without a move last', () => {
  const us = { valuePct: 4, period: '2026-09', source: 's', seriesId: 'u', url: 'u', change3mPts: -0.1 };
  assert.equal(trendForObservation(us, us, undefined, true).spreadChg3mBps, undefined);
  assert.equal(trendForObservation({ ...us, change3mPts: 0.2 }, us).spreadChg3mBps, 30);
  const rows = [{ id: 'a', t: {} }, { id: 'b', t: { moveScore: 10 } }, { id: 'c', t: { moveScore: 50 } }];
  assert.deepEqual(byMovingMost(rows, (r) => r.t).map((r) => r.id), ['c', 'b', 'a']);
});
