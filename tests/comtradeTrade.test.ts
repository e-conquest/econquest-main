/**
 * UN Comtrade: request addresses for the preview and keyed routes, the reply reader (totals only,
 * no duplicates), the country profile (scenario partner shares, top partners, export mix), and
 * Missing with a reason on the Country tab.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProfile, comtradeMissing, comtradeUrl, comtradeYears, parseComtrade, partnerSentence } from '../src/utils/comtradeTrade.ts';
import { comtradeRows } from '../src/utils/marketsMacro.ts';
import type { LiveWatchlistItem } from '../src/types/council.ts';

const row = (flowCode: string, partnerCode: number, value: number, extra: Record<string, unknown> = {}) => ({
  period: '2024',
  reporterCode: 360,
  flowCode,
  partnerCode,
  cmdCode: 'TOTAL',
  partner2Code: 0,
  customsCode: 'C00',
  motCode: 0,
  primaryValue: value,
  ...extra,
});

// Indonesia-like: exports 260bn (China 62, US 26, India 21, Japan 19, Taiwan 6, Russia 1),
// imports 220bn (China 72, Singapore 18, Saudi 6, UAE 3, Russia 2).
const PARTNERS = {
  data: [
    row('X', 0, 260e9, { partnerDesc: 'World' }),
    row('X', 156, 62e9, { partnerDesc: 'China' }),
    row('X', 842, 26e9, { partnerDesc: 'USA' }),
    row('X', 699, 21e9, { partnerDesc: 'India' }),
    row('X', 392, 19e9, { partnerDesc: 'Japan' }),
    row('X', 490, 6e9, { partnerDesc: 'Other Asia, nes' }),
    row('X', 643, 1e9, { partnerDesc: 'Russian Federation' }),
    row('X', 899, 30e9, { partnerDesc: 'Areas, nes' }),
    row('M', 0, 220e9, { partnerDesc: 'World' }),
    row('M', 156, 72e9, { partnerDesc: 'China' }),
    row('M', 702, 18e9, { partnerDesc: 'Singapore' }),
    row('M', 682, 6e9, { partnerDesc: 'Saudi Arabia' }),
    row('M', 784, 3e9),
    row('M', 643, 2e9, { partnerDesc: 'Russian Federation' }),
    // A breakdown row (by customs procedure) and a duplicate must be ignored.
    row('X', 156, 1e9, { customsCode: 'C01' }),
    row('X', 156, 62e9, { partnerDesc: 'China' }),
  ],
};

const PRODUCTS = {
  data: [
    row('X', 0, 260e9, { cmdCode: 'TOTAL' }),
    row('X', 0, 52e9, { cmdCode: '27' }),
    row('X', 0, 31e9, { cmdCode: '15' }),
    row('X', 0, 12e9, { cmdCode: '72' }),
    row('X', 0, 1e9, { cmdCode: '09' }),
    row('M', 0, 220e9, { cmdCode: 'TOTAL' }),
    row('M', 0, 33e9, { cmdCode: '27' }),
  ],
};

test('addresses: preview without a key, data route with one; totals pinned; the key never in the address', () => {
  const pre = comtradeUrl(360, 2024, 'partners', false);
  assert.match(pre, /^https:\/\/comtradeapi\.un\.org\/public\/v1\/preview\/C\/A\/HS\?reporterCode=360&period=2024&flowCode=X,M&cmdCode=TOTAL&partner2Code=0&customsCode=C00&motCode=0/);
  assert.doesNotMatch(pre, /partnerCode=/, 'every partner');
  const keyed = comtradeUrl(360, 2024, 'products', true);
  assert.match(keyed, /\/data\/v1\/get\/C\/A\/HS\?/);
  assert.match(keyed, /cmdCode=TOTAL,10,12,15,17,18,26,27,71,72,74,75,76,09&partnerCode=0/);
  assert.deepEqual(comtradeYears(new Date('2026-11-05T00:00:00Z')), [2024, 2023]);
});

test('reader: keeps totals, drops breakdowns, duplicates and junk', () => {
  const rows = parseComtrade(PARTNERS);
  assert.equal(rows.length, 14);
  assert.equal(rows.filter((r) => r.partnerCode === 156 && r.flowCode === 'X').length, 1);
  assert.deepEqual(parseComtrade({ error: 'x' }), []);
  assert.deepEqual(parseComtrade({ data: [{ flowCode: 'X', partnerCode: 0, period: '2024', cmdCode: 'TOTAL', primaryValue: 'n/a' }] }), []);
});

test('profile: scenario partner shares, top partners (countries only), export mix and fuel imports', () => {
  const p = buildProfile('IDN', parseComtrade(PARTNERS), parseComtrade(PRODUCTS))!;
  assert.equal(p.year, '2024');
  assert.equal(p.exportsUsdBn, 260);
  assert.equal(p.exportSharePct.china, 23.8);
  assert.equal(p.exportSharePct.taiwan, 2.3);
  assert.equal(p.exportSharePct.russia, 0.4);
  assert.equal(p.exportSharePct.gulf, 0);
  assert.equal(p.importSharePct.gulf, 4.1);
  assert.equal(p.importSharePct.russia, 0.9);
  assert.deepEqual(p.topExportPartners.map((x) => x.name), ['China', 'USA', 'India', 'Japan', 'Taiwan'], '"Areas, nes" is not a country; Taiwan is named');
  assert.equal(p.topImportPartners[3].name, 'UAE', 'a partner with no description takes the app name');
  assert.equal(p.exportMixPct!['27'], 20);
  assert.equal(p.exportMixPct!['15'], 11.9);
  assert.equal(p.exportMixPct!['74'], undefined, 'a chapter not in the reply is not invented');
  assert.equal(p.fuelImportSharePct, 15);
  assert.equal(partnerSentence(p), 'Exports $260.0bn: China 23.8%, Taiwan 2.3%, Russia 0.4%, Gulf 0.0% of the total (UN Comtrade 2024).');
});

test('profile: no World total means no profile', () => {
  assert.equal(buildProfile('IDN', parseComtrade({ data: [row('X', 156, 1e9)] })), null);
  assert.equal(buildProfile('IDN', []), null);
});

test('Country tab: rows carry year and pull date; missing says why', () => {
  const p = buildProfile('IDN', parseComtrade(PARTNERS), parseComtrade(PRODUCTS))!;
  const rows = comtradeRows({ iso3: 'IDN', comtrade: { ...p, pulledAt: '2026-11-05T03:00:00Z' } } as LiveWatchlistItem, 'IDN');
  const by = (l: string) => rows.find((r) => r.label === l)!;
  assert.equal(by('Trade with China').value, '23.8% of exports, 32.7% of imports');
  assert.equal(by('Trade with China').source, 'official, UN Comtrade 2024 (pulled 2026-11-05)');
  assert.match(by('Commodity share of exports').value, /^Mineral fuels \(oil, gas, coal\) 20%, Animal and vegetable oils \(palm oil\) 12%, Iron and steel 5%/);
  assert.equal(by('Fuels share of imports').value, '15.0%');
  const none = comtradeRows(undefined, 'IDN');
  assert.equal(none[0].value, 'Missing');
  assert.match(none[0].help!, /preview/);
  assert.equal(comtradeMissing('XXX', false).short, 'Not in the app’s Comtrade list');
});
