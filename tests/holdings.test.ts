import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOLDINGS_TEMPLATE_CSV,
  parseHoldingsCsv,
  holdingsToCsv,
  summariseBook,
  holdingsWeightsPct,
  holdingGreeks,
  creditSign,
  matchCountry,
  type Holding,
} from '../src/utils/holdings.ts';
import type { WatchlistItem } from '../src/types/council.ts';

const KNOWN = [
  { iso3: 'BRA', countryName: 'Brazil' },
  { iso3: 'MEX', countryName: 'Mexico' },
  { iso3: 'TUR', countryName: 'Turkey' },
  { iso3: 'ZAF', countryName: 'South Africa' },
];

const h = (p: Partial<Holding>): Holding => ({
  id: 'x',
  iso3: 'BRA',
  instrument: 'test',
  assetClass: 'HC_BOND',
  side: 'LONG',
  notionalUsdMm: 10,
  ...p,
});

test('the template CSV parses with no errors', () => {
  const r = parseHoldingsCsv(HOLDINGS_TEMPLATE_CSV, KNOWN);
  assert.deepEqual(r.errors, []);
  assert.equal(r.holdings.length, 4);
  assert.deepEqual(
    r.holdings.map((x) => [x.iso3, x.assetClass, x.side, x.notionalUsdMm, x.durationYears]),
    [
      ['BRA', 'HC_BOND', 'LONG', 25, 6.8],
      ['MEX', 'LC_BOND', 'LONG', 15, 4.1],
      ['TUR', 'CDS', 'LONG', 10, 4.5],
      ['ZAF', 'FX', 'SHORT', 8, undefined],
    ]
  );
});

test('messy input: names, semicolons, negative notional and bad rows', () => {
  const csv = ['Country;Notional_USD_mm;Type', 'brazil;12,5;hc_bond', 'Mexico;-3;lc_bond', 'Atlantis;5;hc_bond', 'BRA;abc;cds'].join('\n');
  const r = parseHoldingsCsv(csv, KNOWN);
  assert.equal(r.holdings.length, 2);
  assert.equal(r.holdings[0].iso3, 'BRA');
  assert.equal(r.holdings[0].notionalUsdMm, 12.5); // decimal comma
  assert.equal(r.holdings[1].side, 'SHORT');
  assert.equal(r.holdings[1].notionalUsdMm, 3);
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0], /Row 4/);
  assert.match(r.errors[1], /Row 5/);
});

test('missing required columns are reported, not guessed', () => {
  const r = parseHoldingsCsv('instrument,side\nfoo,long', KNOWN);
  assert.equal(r.holdings.length, 0);
  assert.equal(r.errors.length, 2);
});

test('CSV export round-trips', () => {
  const r = parseHoldingsCsv(HOLDINGS_TEMPLATE_CSV, KNOWN);
  const again = parseHoldingsCsv(holdingsToCsv(r.holdings), KNOWN);
  assert.deepEqual(
    again.holdings.map(({ id, ...rest }) => rest),
    r.holdings.map(({ id, ...rest }) => rest)
  );
});

test('matchCountry accepts codes and names', () => {
  assert.equal(matchCountry('mex', KNOWN), 'MEX');
  assert.equal(matchCountry('South Africa', KNOWN), 'ZAF');
  assert.equal(matchCountry('EGY', KNOWN), 'EGY');
  assert.equal(matchCountry('Narnia', KNOWN), null);
});

test('credit sign: bought protection and short bonds reduce credit risk', () => {
  assert.equal(creditSign(h({})), 1);
  assert.equal(creditSign(h({ side: 'SHORT' })), -1);
  assert.equal(creditSign(h({ assetClass: 'CDS' })), -1);
  assert.equal(creditSign(h({ assetClass: 'CDS', side: 'SHORT' })), 1);
  assert.equal(creditSign(h({ assetClass: 'FX' })), 0);
});

test('book summary: gross, net credit and DV01 by hand', () => {
  const book = [
    h({ iso3: 'BRA', notionalUsdMm: 25, durationYears: 6.8 }), // +25mm, DV01 +17.0k
    h({ iso3: 'TUR', assetClass: 'CDS', notionalUsdMm: 10, durationYears: 4.5 }), // -10mm, DV01 -4.5k
    h({ iso3: 'ZAF', assetClass: 'FX', side: 'SHORT', notionalUsdMm: 8 }), // no credit
    h({ iso3: 'BRA', notionalUsdMm: 5 }), // no duration
  ];
  const lookup = [
    { iso3: 'BRA', countryName: 'Brazil' },
    { iso3: 'TUR', countryName: 'Turkey' },
  ] as unknown as WatchlistItem[];
  const s = summariseBook(book, lookup);
  assert.equal(s.grossUsdMm, 48);
  assert.equal(s.netCreditUsdMm, 20);
  assert.ok(Math.abs(s.dv01UsdK - 12.5) < 1e-9);
  assert.equal(s.missingDuration, 1);
  assert.deepEqual(s.uncovered, ['ZAF']);
  const bra = s.rows.find((r) => r.iso3 === 'BRA')!;
  assert.ok(Math.abs(bra.weight - 30 / 48) < 1e-9);
  // Largest gross notional first.
  assert.deepEqual(s.rows.map((r) => r.iso3), ['BRA', 'TUR', 'ZAF']);
});

test('holdings weights sum to 100 over covered countries only', () => {
  const w = holdingsWeightsPct(
    [h({ iso3: 'BRA', notionalUsdMm: 30 }), h({ iso3: 'MEX', notionalUsdMm: 10 }), h({ iso3: 'EGY', notionalUsdMm: 60 })],
    ['BRA', 'MEX']
  );
  assert.deepEqual(Object.keys(w).sort(), ['BRA', 'MEX']);
  assert.ok(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 100) < 1e-6);
  assert.ok(Math.abs(w.BRA - 75) < 1e-6);
  assert.deepEqual(holdingsWeightsPct([], ['BRA']), {});
});

test('holding greeks: signs per asset class', () => {
  // 10mm, 5y duration: PV01 = 10 * 5 * 100 = $5,000 per bp
  assert.deepEqual(holdingGreeks(h({ durationYears: 5 })), { dv01: -5000, cs01: -5000, fxDeltaPer1Pct: 0 });
  assert.deepEqual(holdingGreeks(h({ assetClass: 'CDS', durationYears: 5 })), { dv01: 0, cs01: 5000, fxDeltaPer1Pct: 0 });
  const lc = holdingGreeks(h({ assetClass: 'LC_BOND', durationYears: 5 }));
  assert.equal(lc.cs01, 0);
  assert.equal(lc.dv01, -5000);
  assert.ok(lc.fxDeltaPer1Pct !== 0);
  const noDur = holdingGreeks(h({}));
  assert.equal(noDur.dv01, 0);
});

test('number formats: thousands separators, brackets and dollar signs', () => {
  const r = parseHoldingsCsv('country,notional_usd_mm\nBRA,"1,250"\nMEX,(15)\nTUR,$7.5', KNOWN);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.holdings.map((x) => [x.notionalUsdMm, x.side]), [[1250, 'LONG'], [15, 'SHORT'], [7.5, 'LONG']]);
});
