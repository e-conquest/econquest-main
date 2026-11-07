import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlayHolding, portfolioOverlay, rowLeaning } from '../src/utils/portfolioOverlay.ts';
import type { Holding } from '../src/utils/holdings.ts';

const now = new Date('2026-11-05T00:00:00Z');
// Brazil-like: BIS 13.75%, inflation 4.4% against a 3% target -> far tighter than the rule; cutting since mid-2026; 10Y down 40 bps.
const bra = {
  iso3: 'BRA',
  countryName: 'Brazil',
  policyRatePct: 13.75,
  policyRateSource: 'bis',
  policyRateDate: '2026-10',
  policyRateMoves: [
    { period: '2026-07', fromPct: 15, toPct: 14.5 },
    { period: '2026-09', fromPct: 14.5, toPct: 13.75 },
  ],
  policyRateHistoryFrom: '2020-01',
  cpiInflationPct: 4.4,
  cpiSource: 'oecd',
  cpiMonth: '2026-09',
  yield10YPct: 12.9,
  yield10YSource: 'official',
  yield10YPeriod: '2026-10',
  yield10YChange3mPts: -0.4,
} as never;
// Egypt-like: reserves falling fast -> a shock alert.
const egy = {
  iso3: 'EGY',
  countryName: 'Egypt',
  imf: { iso3: 'EGY', reserves: { key: 'r', period: '2026-09', usdBn: 20, change12mPct: -12 }, monthsOfImports: 2.5 },
} as never;

const h = (id: string, iso3: string, assetClass: Holding['assetClass'], side: Holding['side'], notionalUsdMm = 10): Holding => ({ id, iso3, instrument: `${iso3} ${assetClass}`, assetClass, side, notionalUsdMm });

test('long local bond: rule pointing to cuts, a cutting cycle and falling yields all lean with it', () => {
  const r = overlayHolding(h('1', 'BRA', 'LC_BOND', 'LONG'), bra, now);
  const by = Object.fromEntries(r.signals.map((s) => [s.kind, s.leaning]));
  assert.equal(by.taylor, 'with');
  assert.equal(by.cycle, 'with');
  assert.equal(by.yield_trend, 'with');
  assert.equal(rowLeaning(r), 'with');
  assert.match(r.signals.find((s) => s.kind === 'taylor')!.reading, /tighter than the rule, which points to cuts/);
});

test('a short local bond sees the same signals against it', () => {
  const r = overlayHolding(h('2', 'BRA', 'LC_BOND', 'SHORT'), bra, now);
  assert.ok(r.signals.filter((s) => s.kind !== 'shock').every((s) => s.leaning === 'against'));
  assert.equal(rowLeaning(r), 'against');
});

test('shock alerts lean against held credit and with bought protection; rate signals skip hard-currency bonds', () => {
  const bond = overlayHolding(h('3', 'EGY', 'HC_BOND', 'LONG'), egy, now);
  assert.deepEqual(bond.signals.map((s) => [s.kind, s.leaning]), [['shock', 'against']]);
  const cds = overlayHolding(h('4', 'EGY', 'CDS', 'LONG'), egy, now);
  assert.equal(cds.signals[0].leaning, 'with');
  const sold = overlayHolding(h('5', 'EGY', 'CDS', 'SHORT'), egy, now);
  assert.equal(sold.signals[0].leaning, 'against');
});

test('missing inputs are listed, built-in figures never count, FX is not marked', () => {
  const sample = overlayHolding(h('6', 'BRA', 'LC_BOND', 'LONG'), { ...(bra as object), policyRateSource: 'sample', yield10YSource: 'sample' } as never, now);
  assert.ok(!sample.signals.some((s) => s.kind === 'taylor' || s.kind === 'yield_trend' || s.kind === 'cycle'));
  assert.ok(sample.missing.some((m) => /Taylor rule check/.test(m)));
  assert.ok(sample.missing.some((m) => /10Y yield trend/.test(m)));
  const fx = overlayHolding(h('7', 'BRA', 'FX', 'SHORT'), bra, now);
  assert.equal(fx.signals.length, 0);
  assert.match(fx.notMarked!, /not marked/);
  const off = overlayHolding(h('8', 'ZAF', 'HC_BOND', 'LONG'), undefined, now);
  assert.match(off.missing[0], /not on your watchlist/);
});

test('book: notional split by leaning, holdings against listed first, uncovered named', () => {
  const o = portfolioOverlay([h('a', 'BRA', 'LC_BOND', 'LONG', 25), h('b', 'EGY', 'HC_BOND', 'LONG', 10), h('c', 'ZAF', 'HC_BOND', 'LONG', 5)], [bra, egy], now);
  assert.equal(o.withUsdMm, 25);
  assert.equal(o.againstUsdMm, 10);
  assert.equal(o.quietUsdMm, 5);
  assert.equal(o.rows[0].holding.id, 'b');
  assert.deepEqual(o.uncovered, ['ZAF']);
});
