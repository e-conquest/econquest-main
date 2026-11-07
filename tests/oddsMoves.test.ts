import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fastestOddsMove, oddsMoveText, polymarketMoves } from '../src/utils/oddsMoves.ts';
import { politicsFromSnapshot } from '../src/utils/politicsEvents.ts';
import { timingSignals } from '../src/utils/timingAgent.ts';

test('Gamma market moves: 0-1 scale to points; absent or implausible fields are left out', () => {
  // Shape seen on the live Gamma API, 2026-11-05.
  assert.deepEqual(polymarketMoves({ lastTradePrice: 0.77, oneDayPriceChange: -0.05, oneWeekPriceChange: 0.12, oneMonthPriceChange: 0.085 }), {
    change1dPts: -5,
    change1wPts: 12,
    change1mPts: 8.5,
  });
  assert.deepEqual(polymarketMoves({ oneWeekPriceChange: 7 }), {});
  assert.deepEqual(polymarketMoves(null), {});
  assert.equal(oddsMoveText({ change1wPts: 12, change1mPts: -3 }), '1 week +12.0 pts, 1 month −3.0 pts');
  assert.equal(oddsMoveText({}), '');
});

test('fastest move: only a week of 10 pts or more counts', () => {
  const ms = [
    { question: 'a', change1wPts: 4 },
    { question: 'b', change1wPts: -15 },
    { question: 'c', change1wPts: 11 },
  ];
  assert.equal(fastestOddsMove(ms)!.question, 'b');
  assert.equal(fastestOddsMove([{ question: 'a', change1wPts: 9.9 }]), undefined);
});

test('moves travel from the snapshot to the country and into the Timing Agent', () => {
  const snap = {
    iso3: 'TUR',
    countryName: 'Turkey',
    liveFields: { 'polymarket.contracts': 'Polymarket, pulled 2026-11-05' },
    polymarketContracts: [{ id: '1', question: 'Will Turkey hold early elections in 2027?', probabilityPct: 34, volumeUsd: 1e6, category: 'x', url: 'u', change1wPts: 14, change1mPts: 20 }],
    gdeltMetrics: {},
    worldBankIndicators: {},
  } as never;
  const p = politicsFromSnapshot(snap)!;
  assert.equal(p.markets![0].change1wPts, 14);
  const s = timingSignals({ iso3: 'TUR', countryName: 'Turkey', politics: p } as never, new Date('2026-11-05T00:00:00Z'));
  const odds = s.signals.find((x) => x.key === 'odds')!;
  assert.equal(odds.pressure, true);
  assert.match(odds.text, /34% yes, 1 week \+14\.0 pts, 1 month \+20\.0 pts .*not a forecast/);
});
