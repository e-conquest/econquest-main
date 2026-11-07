import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allQuarters,
  fxDailySeries,
  fxQuarterUrl,
  parseFxQuarter,
  quarterBounds,
  quarterNeedsPull,
  quartersToPull,
  readFxHistoryFile,
  type FxHistoryFile,
} from '../src/utils/fxHistory.ts';
import { countrySeries } from '../src/utils/seriesHistory.ts';

const NOW = new Date('2026-11-06T12:00:00Z');

test('quarter bounds and URLs stay inside one quarter and stop at today', () => {
  assert.deepEqual(quarterBounds('2024-Q1'), { from: '2024-01-01', to: '2024-03-31' });
  assert.deepEqual(quarterBounds('2025-Q4'), { from: '2025-10-01', to: '2025-12-31' });
  assert.equal(quarterBounds('2025-Q5'), null);
  assert.equal(fxQuarterUrl('2026-Q2', NOW), 'https://api.frankfurter.dev/v1/2026-04-01..2026-06-30?from=USD');
  assert.equal(fxQuarterUrl('2026-Q4', NOW), 'https://api.frankfurter.dev/v1/2026-10-01..2026-11-06?from=USD');
  assert.equal(fxQuarterUrl('2027-Q1', NOW), null);
});

test('every quarter from 1999 to now, newest first', () => {
  const q = allQuarters(NOW);
  assert.equal(q[0], '2026-Q4');
  assert.equal(q.at(-1), '1999-Q1');
  assert.equal(q.length, 27 * 4 + 4);
});

test('parses the Frankfurter range reply and drops bad values', () => {
  const rates = parseFxQuarter({
    amount: 1,
    base: 'USD',
    rates: { '2026-10-01': { BRL: 5.31, try: 41.2, XX: 3, MXN: 'n/a', ZAR: -1 }, bad: { BRL: 1 }, '2026-10-02': {} },
  });
  assert.deepEqual(rates, { '2026-10-01': { BRL: 5.31, TRY: 41.2 } });
  assert.equal(parseFxQuarter({ rates: {} }), null);
  assert.equal(parseFxQuarter('<html>'), null);
});

test('finished quarters are kept for good; the current one is pulled again after 12 hours', () => {
  const file: FxHistoryFile = {
    version: 1,
    chunks: {
      '2026-Q2': { pulledAt: '2026-07-20T00:00:00Z', rates: {} },
      '2026-Q3': { pulledAt: '2026-10-02T00:00:00Z', rates: {} },
      '2026-Q4': { pulledAt: '2026-11-06T06:00:00Z', rates: {} },
    },
  };
  assert.equal(quarterNeedsPull(file, '2026-Q2', NOW), false, 'pulled a week after it ended');
  assert.equal(quarterNeedsPull(file, '2026-Q3', NOW), true, 'pulled two days after it ended, so once more');
  assert.equal(quarterNeedsPull(file, '2026-Q4', NOW), false, 'pulled 6 hours ago');
  assert.equal(quarterNeedsPull(file, '2026-Q4', new Date('2026-11-06T19:00:00Z')), true);
  assert.equal(quarterNeedsPull(file, '2026-Q1', NOW), true, 'never pulled');
  const todo = quartersToPull(file, NOW);
  assert.equal(todo[0], '2026-Q3');
  assert.ok(!todo.includes('2026-Q2') && !todo.includes('2026-Q4'));
});

test('a damaged file reads as empty and bad chunks are dropped', () => {
  assert.deepEqual(readFxHistoryFile(null), { version: 1, chunks: {} });
  const f = readFxHistoryFile({ chunks: { '2026-Q1': { pulledAt: 'x', rates: {} }, nope: { pulledAt: 'x', rates: {} }, '2026-Q2': { rates: {} } } });
  assert.deepEqual(Object.keys(f.chunks), ['2026-Q1']);
});

const FILE: FxHistoryFile = {
  version: 1,
  chunks: {
    '2026-Q4': { pulledAt: '2026-11-06T06:00:00Z', rates: { '2026-10-02': { BRL: 5.35, TRY: 41.3 }, '2026-10-01': { BRL: 5.31, TRY: 41.2 } } },
    '2026-Q3': { pulledAt: '2026-10-08T00:00:00Z', rates: { '2026-09-30': { BRL: 5.29 } } },
  },
};

test('daily series per currency, oldest first, only published days', () => {
  const s = fxDailySeries(FILE, 'brl');
  assert.ok('points' in s);
  assert.deepEqual(s.points.map((p) => p.date), ['2026-09-30', '2026-10-01', '2026-10-02']);
  assert.equal(s.unit, 'BRL per USD');
  assert.equal(s.freq, 'daily');
  assert.equal(s.pulledAt, '2026-11-06T06:00:00Z');
  const t = fxDailySeries(FILE, 'TRY');
  assert.ok('points' in t && t.points.length === 2, 'no point for a day the reply left out');
});

test('missing reasons are stated, never filled', () => {
  assert.match((fxDailySeries(FILE, 'CLP') as { reason: string }).reason, /publishes no reference rate for CLP/);
  assert.match((fxDailySeries(FILE, 'USD') as { reason: string }).reason, /base currency/);
  assert.match((fxDailySeries(null, 'BRL') as { reason: string }).reason, /not downloaded yet/);
  assert.match((fxDailySeries(FILE, '') as { reason: string }).reason, /No currency/);
});

test('the country history uses the daily run, and keeps the saved pulls for currencies the ECB lacks', () => {
  const archive = [
    { date: '2026-11-01', pulledAt: 1, snapshot: { liveFields: { 'market.exchangeRatePerUsd': 'ExchangeRate-API' }, monetaryAndMarket: { exchangeRatePerUsd: 940 } } },
  ];
  const bra = countrySeries('BRA', { fxHistory: FILE, currency: 'BRL', archive });
  const fx = bra.series.find((s) => s.id === 'fx_per_usd')!;
  assert.equal(fx.freq, 'daily');
  assert.equal(fx.points.length, 3);
  const chl = countrySeries('CHL', { fxHistory: FILE, currency: 'CLP', archive });
  const c = chl.series.find((s) => s.id === 'fx_per_usd')!;
  assert.equal(c.freq, 'per pull');
  assert.match(c.about || '', /no daily history: the ECB publishes no reference rate for CLP/i);
  const none = countrySeries('CHL', { fxHistory: FILE, currency: 'CLP' });
  assert.match(none.missing.find((m) => m.id === 'fx_per_usd')!.reason, /No saved pulls yet.*; no daily history: the ECB publishes no reference rate for CLP/);
});
