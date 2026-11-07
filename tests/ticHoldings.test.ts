/**
 * TIC foreign holdings of US Treasuries: read Treasury's table the way the app does, call the
 * 12-month trend only by the stated rule, and say why an unlisted country has no figure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMonth, parseTicTable, ticHoldingFor, ticMissing, ticSentence, ticTrend } from '../src/utils/ticHoldings.ts';
import { planCouncil, runCouncil } from '../src/utils/askCouncil.ts';
import { ticRows } from '../src/utils/marketsMacro.ts';
import { COLUMN_BY_ID } from '../src/utils/watchlistView.ts';
import type { WatchlistItem } from '../src/types/council.ts';

/** The top of slt_table5.txt as Treasury served it for August 2026 (rows trimmed). */
const TABLE = [
  'Table 5: Major Foreign Holders of Treasury Securities\t\t\t\t\t\t\t\t\t\t\t\t\t',
  'Holdings at end of time period\t\t\t\t\t\t\t\t\t\t\t\t\t',
  'Billions of dollars\t\t\t\t\t\t\t\t\t\t\t\t\t',
  '\t\t\t\t\t\t\t\t\t\t\t\t\t',
  'Country\t2026-08\t2026-07\t2026-06\t2026-05\t2026-04\t2026-03\t2026-02\t2026-01\t2025-12\t2025-11\t2025-10\t2025-09\t2025-08',
  'Japan\t1068.3\t1103.9\t1116.7\t1143.1\t1209.9\t1191.6\t1239.3\t1225.3\t1185.5\t1202.7\t1200.0\t1189.3\t1183.9',
  'United Kingdom\t1009.5\t998.3\t939.9\t948.6\t937.5\t927.1\t897.3\t879.8\t863.2\t879.8\t875.4\t862.5\t901.3',
  'China, Mainland\t590.7\t618.0\t633.4\t659.3\t651.1\t653.3\t694.2\t695.3\t684.4\t683.9\t687.7\t699.2\t699.7',
  'Brazil\t168.4\t168.0\t168.4\t168.9\t168.6\t168.0\t170.6\t168.0\t168.7\t168.2\t167.8\t172.8\t184.6',
  'All Other\t1852.3\t1842.7\t1850.8\t1860.2\t1861.5\t1828.5\t1861.7\t1843.9\t1827.1\t1843.5\t1833.2\t1797.9\t1794.3',
  'Grand Total\t9331.7\t9248.4\t9298.5\t9368.5\t9350.1\t9352.4\t9487.3\t9289.1\t9270.5\t9350.4\t9231.3\t9238.2\t9249.1',
  'Of Which: Foreign Official\t3755.6\t3773.1\t3778.1\t3845.9\t3904.5\t3903.0\t4009.6\t3941.8\t3877.7\t3912.3\t3866.4\t3872.6\t3919.8',
  '',
  'Notes:',
  'The data in this table are collected primarily from U.S.-based custodians and broker-dealers.',
].join('\n');

test('reads the TIC table: holdings, month and year changes, share of all foreign holdings', () => {
  const t = parseTicTable(TABLE)!;
  assert.equal(t.months[0], '2026-08');
  assert.equal(t.months.length, 13);
  assert.equal(t.total![0], 9331.7);
  assert.equal(t.official![0], 3755.6);
  const bra = ticHoldingFor('BRA', t)!;
  assert.equal(bra.holdingsUsdBn, 168.4);
  assert.equal(bra.change1mUsdBn, 0.4);
  assert.equal(bra.change12mUsdBn, -16.2);
  assert.equal(bra.change12mPct, -8.8);
  assert.equal(bra.shareOfForeignPct, 1.8);
  assert.equal(ticTrend(bra.change12mPct!), 'steady');
  const chn = ticHoldingFor('CHN', t)!;
  assert.equal(chn.change12mPct, -15.6);
  assert.match(ticSentence(chn), /Holds \$590\.7bn of US Treasuries \(TIC, Aug 2026\), -15\.6% on the year: selling Treasuries\./);
  assert.equal(ticHoldingFor('MEX', t), null);
});

test('also reads the table when the tabs come through as spaces', () => {
  const spaced = TABLE.replace(/\t/g, '    ');
  assert.equal(ticHoldingFor('JPN', parseTicTable(spaced))!.holdingsUsdBn, 1068.3);
});

test('no Country header, no table; the trend rule as stated', () => {
  assert.equal(parseTicTable('<html>Moved</html>'), null);
  assert.equal(parseTicTable(undefined), null);
  assert.equal(ticTrend(-10), 'selling');
  assert.equal(ticTrend(-9.9), 'steady');
  assert.equal(ticTrend(10), 'buying');
  assert.equal(formatMonth('2026-08'), 'Aug 2026');
  assert.equal(ticMissing('MEX').short, 'Not listed by Treasury');
});

const t = parseTicTable(TABLE)!;
const BRA = { iso3: 'BRA', countryName: 'Brazil', tic: { ...ticHoldingFor('BRA', t)!, pulledAt: '2026-11-05T02:00:00Z' } } as WatchlistItem;
const MEX = { iso3: 'MEX', countryName: 'Mexico', reerGapPct: 4 } as WatchlistItem;

test('FX Valuation agent: TIC figures are official with the month, the trend is its own reading', () => {
  const q = 'Who is selling Treasury holdings? Check TIC for Brazil and Mexico';
  const plan = planCouncil(q, [BRA, MEX]);
  assert.ok(plan.agents.some((a) => a.id === 'fx'));
  const fx = runCouncil(q, plan, [BRA, MEX]).find((a) => a.id === 'fx')!;
  const bra = fx.findings.find((f) => f.iso3 === 'BRA')!;
  const h = bra.figures.find((f) => f.label === 'Holdings of US Treasuries')!;
  assert.equal(h.value, '$168.4bn');
  assert.equal(h.tag, 'official');
  assert.match(h.source, /Aug 2026/);
  assert.equal(bra.figures.find((f) => f.label === 'US Treasury holdings trend')!.tag, 'model');
  assert.match(bra.reading, /Holds \$168\.4bn of US Treasuries/);
});

test('Country tab and watchlist: holdings with month and pull date, Missing with the reason otherwise', () => {
  const rows = ticRows(BRA, 'BRA');
  assert.equal(rows[0].value, '$168.4bn');
  assert.match(rows[0].source, /TIC, Aug 2026 \(pulled 2026-11-05\)/);
  assert.equal(rows.find((r) => r.label === 'Change over 12 months')!.value, '-16.2bn (-8.8%)');
  const mex = ticRows(MEX, 'MEX');
  assert.equal(mex[0].value, 'Missing');
  assert.match(mex[0].help!, /All Other/);
  const col = COLUMN_BY_ID.ustHoldings;
  assert.equal(col.text(BRA), '168.4');
  assert.equal(col.note!(BRA), 'TIC, Aug 2026, -8.8% y/y');
  assert.equal(col.text(MEX), '–');
  assert.equal(col.note!(MEX), 'Not listed by Treasury');
});
