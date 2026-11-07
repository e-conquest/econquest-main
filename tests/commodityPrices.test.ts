/**
 * Commodity prices: the Pink Sheet workbook read through the app's own .xlsx reader, EIA daily
 * oil, the moves stated from them, and Missing with a reason for anything not covered.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readXlsxSheet, columnIndex } from '../src/utils/xlsxRead.ts';
import {
  buildCommodityReply,
  eiaSpotUrl,
  findPinkSheetUrl,
  moveSentence,
  parseEiaSpot,
  parsePinkSheet,
  priceMove,
} from '../src/utils/commodityPrices.ts';
import { makeXlsx, pinkSheetRows } from './helpers/makeXlsx.ts';

// 46 months: 2023-01 .. 2026-10. Brent climbs 1 a month from 60; copper flat 9000 with a gap.
const brent = Array.from({ length: 46 }, (_, i) => 60 + i);
const copper = Array.from({ length: 46 }, () => 9000);
const ROWS = pinkSheetRows([
  { code: 'CRUDE_BRENT', heading: 'Crude oil, Brent', unit: '$/bbl', values: brent },
  { code: 'COPPER', heading: 'Copper', unit: '$/mt', values: copper.slice(0, 45) },
]);

test('xlsx reader: finds the named sheet through the workbook links and reads text and numbers', async () => {
  const rows = await readXlsxSheet(makeXlsx('Monthly Prices', ROWS, { otherSheetFirst: true }), 'monthly prices');
  assert.ok(rows);
  assert.equal(rows![6][1], 'CRUDE_BRENT');
  assert.equal(rows![7][0], '2023M01');
  assert.equal(rows![7][1], '60');
  assert.equal(rows![2].length, 0, 'an empty row stays in place');
  assert.equal(await readXlsxSheet(makeXlsx('Monthly Prices', ROWS), 'Annual Prices'), null);
  assert.equal(columnIndex('AB12'), 27);
  await assert.rejects(readXlsxSheet(new TextEncoder().encode('<html>not a workbook</html>'), 'Monthly Prices'));
});

test('Pink Sheet: columns by code, months in order, non-numbers skipped', async () => {
  const rows = await readXlsxSheet(makeXlsx('Monthly Prices', ROWS), 'Monthly Prices');
  const s = parsePinkSheet(rows!);
  assert.equal(s.get('CRUDE_BRENT')!.points.length, 46);
  assert.deepEqual(s.get('CRUDE_BRENT')!.points.at(-1), { period: '2026-10', value: 105 });
  assert.equal(s.get('COPPER')!.points.at(-1)!.period, '2026-09', 'the "…" month is skipped');
  assert.equal(s.has('GOLD'), false);
});

test('Pink Sheet: falls back to headings when there is no code row; unknown layout gives nothing', () => {
  const noCodes = ROWS.filter((_, i) => i !== 6);
  assert.equal(parsePinkSheet(noCodes.map((r) => r.map((c) => (c === null ? '' : String(c))))).get('CRUDE_BRENT')!.points.length, 46);
  assert.equal(parsePinkSheet([['Date', 'Brent'], ['2026-10-01', '64']]).size, 0);
});

test('price moves: 1 month, 12 months, against the 3-year average', async () => {
  const s = parsePinkSheet((await readXlsxSheet(makeXlsx('Monthly Prices', ROWS), 'Monthly Prices'))!);
  const mv = priceMove(s.get('CRUDE_BRENT')!)!;
  assert.equal(mv.asOf, '2026-10');
  assert.equal(mv.latest, 105);
  assert.equal(mv.change1mPct, 1);
  assert.equal(mv.change12mPct, Number(((12 / 93) * 100).toFixed(1)));
  assert.ok(mv.vs3yAvgPct! > 0);
  assert.equal(moveSentence(mv), 'Brent crude $105/bbl (2026-10), +1.0% on the month, +12.9% on the year.');
  // A gap longer than a month gives no 1-month move rather than a stale one.
  const gap = priceMove({ code: 'X', name: 'X', unit: '$/mt', source: 'pink_sheet', points: [{ period: '2026-01', value: 1 }, { period: '2026-10', value: 2 }] })!;
  assert.equal(gap.change1mPct, undefined);
  assert.equal(gap.change12mPct, undefined);
});

test('the workbook link is found on the World Bank page and made absolute', () => {
  const html = '<a href="https://thedocs.worldbank.org/en/doc/74e8-0050012026/related/CMO-Historical-Data-Monthly.xlsx">October 2026 (XLS)</a><a href="/x/CMO-Historical-Data-Annual.xlsx">annual</a>';
  assert.equal(findPinkSheetUrl(html), 'https://thedocs.worldbank.org/en/doc/74e8-0050012026/related/CMO-Historical-Data-Monthly.xlsx');
  assert.equal(findPinkSheetUrl('<a href="/doc/CMO-Historical-Data-Monthly.xlsx">x</a>'), 'https://www.worldbank.org/doc/CMO-Historical-Data-Monthly.xlsx');
  assert.equal(findPinkSheetUrl('<p>nothing</p>'), null);
});

test('EIA: daily Brent and WTI, values as strings, newest-first reply sorted', () => {
  const u = decodeURIComponent(eiaSpotUrl('KEY', new Date('2026-11-05T00:00:00Z')));
  assert.match(u, /^https:\/\/api\.eia\.gov\/v2\/petroleum\/pri\/spt\/data\/\?api_key=KEY&frequency=daily&data\[0\]=value/);
  assert.match(u, /facets\[series\]\[\]=RBRTE&facets\[series\]\[\]=RWTC/);
  const s = parseEiaSpot({
    response: {
      data: [
        { period: '2026-11-03', series: 'RBRTE', value: '64.10', units: '$/BBL' },
        { period: '2026-10-03', series: 'RBRTE', value: '62.00' },
        { period: '2026-11-03', series: 'RWTC', value: 60.2 },
        { period: '2026-11-03', series: 'OTHER', value: '1' },
        { period: 'bad', series: 'RBRTE', value: '1' },
      ],
    },
  });
  assert.deepEqual([...s.keys()].sort(), ['RBRTE', 'RWTC']);
  const mv = priceMove(s.get('RBRTE')!)!;
  assert.equal(mv.asOf, '2026-11-03');
  assert.equal(mv.change1mPct, 3.4);
  assert.equal(parseEiaSpot({ error: 'API_KEY_INVALID' }).size, 0);
});

test('reply: covered commodities have figures; the rest say Missing and why', async () => {
  const series = Object.fromEntries(parsePinkSheet((await readXlsxSheet(makeXlsx('Monthly Prices', ROWS), 'Monthly Prices'))!));
  const r = buildCommodityReply({ url: 'u', pulledAt: '2026-11-05T00:00:00Z', series }, null, false);
  assert.equal(r.pinkStatus, 'ok');
  assert.equal(r.eiaStatus, 'needs_key');
  assert.equal(r.pinkSheet!.latestMonth, '2026-10');
  assert.ok(r.moves.some((m) => m.code === 'CRUDE_BRENT'));
  assert.match(r.missing.find((m) => m.code === 'GOLD')!.reason, /Not found in the Pink Sheet/);
  assert.match(r.missing.find((m) => m.code === 'RBRTE')!.reason, /Needs setup: free EIA key \(Menu > Settings, or EIA_API_KEY\)/);
  const none = buildCommodityReply(null, null, true);
  assert.equal(none.moves.length, 0);
  assert.match(none.missing.find((m) => m.code === 'CRUDE_BRENT')!.reason, /did not answer/);
  assert.match(none.missing.find((m) => m.code === 'RWTC')!.reason, /EIA did not answer/);
});
