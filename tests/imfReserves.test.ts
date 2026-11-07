/**
 * IMF reserves and balance of payments: structure reading, indicator matching by IMF name, data
 * reading (SDMX-JSON), series choice, readings and the whole pull with a fake network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMF_MEASURES,
  buildExternal,
  formatImfPeriod,
  imfMissing,
  imfSentence,
  lastFourQuarters,
  matchIndicators,
  normalizePeriod,
  parseImfData,
  parseImfStructure,
  pickSeries,
  pullImfExternal,
  reserveCover,
  seriesKey,
  seriesScale,
  toUsdBn,
} from '../src/utils/imfReserves.ts';
import { imfStructureJson, imfDataJson, imfFetch } from './helpers/imfFixtures.ts';

test('reads a dataset structure: dimension order, indicator dimension and its names', () => {
  const s = parseImfStructure('BOP', imfStructureJson('BOP'))!;
  assert.deepEqual(s.dims, ['COUNTRY', 'BOP_ACCOUNTING_ENTRY', 'INDICATOR', 'UNIT', 'FREQUENCY']);
  assert.equal(s.indicatorDim, 'INDICATOR');
  assert.equal(s.countryDim, 'COUNTRY');
  assert.equal(s.freqDim, 'FREQUENCY');
  assert.ok(s.indicators.some((c) => c.id === 'CAB' && c.name === 'Current account, Total'));
  assert.equal(parseImfStructure('BOP', { data: { dataStructures: [] } }), null);
  assert.equal(parseImfStructure('BOP', 'nonsense'), null);
});

test('matches indicators by IMF name and leaves look-alikes out', () => {
  const bop = parseImfStructure('BOP', imfStructureJson('BOP'))!;
  assert.deepEqual(matchIndicators(bop, IMF_MEASURES.currentAccount).map((c) => c.id), ['CAB']);
  assert.deepEqual(matchIndicators(bop, IMF_MEASURES.imports).map((c) => c.id), ['GS']);
  const il = parseImfStructure('IL', imfStructureJson('IL'))!;
  assert.deepEqual(matchIndicators(il, IMF_MEASURES.reserves).map((c) => c.id), ['TRA']);
  assert.equal(seriesKey(bop, 'BRA', 'Q', ['CAB']), 'BRA.*.CAB.*.Q');
});

test('reads SDMX-JSON data with names, scale and periods, oldest first', () => {
  const series = parseImfData(imfDataJson('IL', 'BRA'));
  assert.equal(series.length, 2);
  const usd = series.find((s) => s.dims.UNIT.id === 'USD')!;
  assert.equal(usd.scale, 6);
  assert.equal(usd.key, 'BRA.TRA.USD.M');
  assert.equal(usd.obs[0].period, '2024-08');
  assert.equal(usd.obs[usd.obs.length - 1].period, '2025-09');
  assert.equal(normalizePeriod('2025-M09'), '2025-09');
  assert.equal(normalizePeriod('2025Q2'), '2025-Q2');
  assert.deepEqual(parseImfData({}), []);
});

test('picks the US dollar series at the right frequency, never domestic currency', () => {
  const series = parseImfData(imfDataJson('IL', 'BRA'));
  assert.equal(pickSeries(series, IMF_MEASURES.reserves)!.dims.UNIT.id, 'USD');
  const xdcOnly = series.filter((s) => s.dims.UNIT.id !== 'USD');
  assert.equal(pickSeries(xdcOnly, IMF_MEASURES.reserves), null);
});

test('four quarters in a row, else nothing', () => {
  const q = (p: string, v: number) => ({ period: p, value: v });
  assert.deepEqual(lastFourQuarters([q('2024-Q3', 1), q('2024-Q4', 2), q('2025-Q1', 3), q('2025-Q2', 4)]), { sum: 10, through: '2025-Q2' });
  assert.equal(lastFourQuarters([q('2024-Q2', 1), q('2024-Q4', 2), q('2025-Q1', 3), q('2025-Q2', 4)]), null);
});

test('builds reserves, months of imports and current account % of GDP by the stated rules', () => {
  const il = parseImfData(imfDataJson('IL', 'BRA'));
  const bopCa = parseImfData(imfDataJson('BOP', 'BRA', 'CAB'));
  const bopIm = parseImfData(imfDataJson('BOP', 'BRA', 'GS'));
  const e = buildExternal(
    'BRA',
    { reserves: pickSeries(il, IMF_MEASURES.reserves), currentAccount: pickSeries(bopCa, IMF_MEASURES.currentAccount), imports: pickSeries(bopIm, IMF_MEASURES.imports) },
    { '2025': 2400 }
  );
  assert.equal(e.reserves!.usdBn, 345);
  assert.equal(e.reserves!.period, '2025-09');
  assert.equal(e.reserves!.change12mPct, 2.4); // 345000 / 337000 - 1
  assert.equal(e.imports4q!.usdBn, 400);
  assert.equal(e.monthsOfImports, 10.3); // 345 / (400 / 12) = 10.35
  assert.equal(e.currentAccount!.usdBn, -18);
  assert.equal(e.currentAccount4q!.usdBn, -60);
  assert.equal(e.currentAccount4q!.pctGdp, -2.5);
  assert.equal(e.currentAccount4q!.gdpYear, '2025');
  assert.equal(reserveCover(2.5), 'thin');
  assert.equal(reserveCover(4), 'adequate');
  assert.equal(reserveCover(10.3), 'ample');
  assert.match(imfSentence(e), /Official reserves \$345\.0bn \(IMF, Sep 2025\), \+2\.4% on the year, 10\.3 months of imports: ample\. Current account -2\.5% of GDP over the four quarters to Q2 2025/);
});

test('no stated scale means Missing with that reason, not a guessed unit', () => {
  const il = parseImfData(imfDataJson('IL', 'BRA')).map((s) => ({ ...s, scale: undefined }));
  const e = buildExternal('BRA', { reserves: pickSeries(il, IMF_MEASURES.reserves) }, null);
  assert.equal(e.reserves, undefined);
  assert.match(imfMissing(e, 'reserves').help, /did not state the unit/);
  assert.equal(toUsdBn(1500, 6), 1.5);
  assert.equal(toUsdBn(1500, undefined), null);
});

test('the whole pull, through the structures, with a fake IMF', async () => {
  const urls: string[] = [];
  const r = await pullImfExternal({ fetchFn: imfFetch(urls), env: {} }, 'BRA');
  assert.equal(r.external.reserves!.usdBn, 345);
  assert.equal(r.external.currentAccount4q!.pctGdp, -2.5);
  assert.equal(r.steps.filter((s) => s.ok).length, 3);
  assert.ok(urls.some((u) => u.includes('/structure/dataflow/IMF.STA/BOP/')));
  assert.ok(urls.some((u) => u.includes('/data/dataflow/IMF.STA/BOP/+/BRA.*.CAB.*.Q')));
  // Structures are reused on the next country.
  const again: string[] = [];
  await pullImfExternal({ fetchFn: imfFetch(again), env: {}, structures: r.structures }, 'BRA');
  assert.ok(!again.some((u) => u.includes('/structure/')));
});

test('a series key in .env is used as given, without reading the structure', async () => {
  const urls: string[] = [];
  const r = await pullImfExternal({ fetchFn: imfFetch(urls), env: { IMF_RESERVES_KEY: '{ISO3}.TRA.USD.M', IMF_CA_KEY: '{ISO3}.*.CAB.*.Q', IMF_IMPORTS_KEY: '{ISO3}.*.GS.*.Q' } }, 'BRA');
  assert.ok(!urls.some((u) => u.includes('/structure/')));
  assert.ok(urls.some((u) => u.endsWith('/IL/+/BRA.TRA.USD.M?attributes=dsd&measures=all')));
  assert.equal(r.external.reserves!.usdBn, 345);
  assert.match(r.steps[0].note, /series key from IMF_RESERVES_KEY/);
});

test('no IMF answer leaves every figure Missing with the reason', async () => {
  const r = await pullImfExternal(
    {
      fetchFn: async () => {
        throw new TypeError('fetch failed');
      },
      env: {},
    },
    'BRA'
  );
  assert.equal(r.external.reserves, undefined);
  assert.match(imfMissing(r.external, 'reserves').help, /IL structure: fetch failed/);
  assert.equal(imfMissing(undefined, 'reserves').short, 'IMF did not answer');
  assert.equal(formatImfPeriod('2025-Q2'), 'Q2 2025');
});

test('codes without names (as on the live API): CD = credit is never read as imports; DB = debit is', async () => {
  const { labelOf } = await import('../src/utils/imfReserves.ts');
  const strip = (series: ReturnType<typeof parseImfData>) =>
    series.map((s) => ({ ...s, dims: Object.fromEntries(Object.entries(s.dims).map(([k, v]) => [k, { id: v.id, name: '' }])) }));
  const im = strip(parseImfData(imfDataJson('BOP', 'BRA', 'GS')));
  const pick = pickSeries(im, IMF_MEASURES.imports)!;
  assert.equal(pick.dims.BOP_ACCOUNTING_ENTRY.id, 'DB');
  assert.match(labelOf(pick), /debit/);
  const ca = strip(parseImfData(imfDataJson('BOP', 'BRA', 'CAB')));
  assert.equal(pickSeries(ca, IMF_MEASURES.currentAccount)!.dims.BOP_ACCOUNTING_ENTRY.id, 'NETCD');
});

test('looser names still match: "Balance of payments, current account, total" and "Official reserves"', () => {
  const s = { flow: 'X', dims: ['COUNTRY', 'INDICATOR'], indicatorDim: 'INDICATOR', indicators: [{ id: 'BCA', name: 'Balance of payments, current account, total' }, { id: 'ORA', name: 'Official reserves' }, { id: 'ORXG', name: 'Official reserves excluding gold' }] };
  assert.deepEqual(matchIndicators(s, IMF_MEASURES.currentAccount).map((c) => c.id), ['BCA']);
  assert.deepEqual(matchIndicators(s, IMF_MEASURES.reserves).map((c) => c.id), ['ORA']);
});

test('live IMF names (Nov 2026): IL picks total reserves at market value, BOP picks the current account balance', () => {
  const il = {
    flow: 'IL', dims: ['COUNTRY', 'INDICATOR', 'UNIT', 'FREQUENCY'], indicatorDim: 'INDICATOR',
    indicators: [
      { id: 'RXF11ORA_REVS', name: 'Reserves excluding gold, other reserve assets' },
      { id: 'RXF11FX_REVS', name: 'Reserves excluding gold, foreign exchange' },
      { id: 'RXF11_REVS', name: 'Reserves excluding gold' },
      { id: 'RXDR_REVS', name: 'Reserves, Special Drawing Rights (SDRs)' },
      { id: 'TRGMV_REVS', name: 'Total reserves (gold at market value)' },
      { id: 'TRRPIMF_REVS', name: 'Reserves, reserve position in the IMF' },
      { id: 'RGOLDNV_REVS', name: 'Gold reserves at national valuation' },
      { id: 'RGOLDMV_REVS', name: 'Gold reserves at market value' },
      { id: 'TRGNV_REVS', name: 'Total reserves (gold at national valuation)' },
      { id: 'TRG35XDR_REVS', name: 'Total reserves (gold at 35 SDRs per ounce)' },
      { id: 'GOLD35P_REVS', name: 'Gold reserves at 35 SDRs per ounce' },
      { id: 'RXF11_REVS_WIMP', name: 'Reserves excluding gold, In weeks of imports' },
      { id: 'RGV_REVS', name: 'Gold reserves (volume)' },
    ],
  };
  assert.deepEqual(matchIndicators(il, IMF_MEASURES.reserves).map((c) => c.id), ['TRGMV_REVS']);
  const bop = {
    flow: 'BOP', dims: ['COUNTRY', 'BOP_ACCOUNTING_ENTRY', 'INDICATOR', 'UNIT', 'FREQUENCY'], indicatorDim: 'INDICATOR',
    indicators: [
      { id: 'GS', name: 'Goods and services' },
      { id: 'CABXEF', name: 'Current account balance excluding exceptional financing' },
      { id: 'TCDCA', name: 'Total current account credit/revenue' },
      { id: 'TDBCA', name: 'Total current account debit/expenditure' },
      { id: 'CAB', name: 'Current account balance (credit less debit)' },
      { id: 'GSIN1', name: 'Goods, services and primary income' },
    ],
  };
  assert.deepEqual(matchIndicators(bop, IMF_MEASURES.currentAccount).map((c) => c.id), ['CAB']);
  assert.deepEqual(matchIndicators(bop, IMF_MEASURES.imports).map((c) => c.id), ['GS']);
});

test('the indicator name "credit less debit" does not rule out the net current account series', () => {
  const dims = (entry: string, name: string) => ({
    COUNTRY: { id: 'BRA', name: '' },
    BOP_ACCOUNTING_ENTRY: { id: entry, name },
    INDICATOR: { id: 'CAB', name: 'Current account balance (credit less debit)' },
    UNIT: { id: 'USD', name: '' },
    FREQUENCY: { id: 'Q', name: '' },
  });
  const obs = [{ period: '2026-Q3', value: -9e9 }];
  const series = [
    { key: 'BRA.CD_T.CAB.USD.Q', dims: dims('CD_T', ''), scale: 6, obs },
    { key: 'BRA.NETCD_T.CAB.USD.Q', dims: dims('NETCD_T', ''), scale: 6, obs },
  ];
  assert.equal(pickSeries(series, IMF_MEASURES.currentAccount)?.key, 'BRA.NETCD_T.CAB.USD.Q');
});

test('stated scale 6 on whole-dollar values (as on the live API) is read as dollars, not millions', () => {
  const live = { scale: 6, obs: [{ period: '2026-Q3', value: 113520669001.43 }] };
  assert.equal(seriesScale(live), 0);
  assert.equal(Number(toUsdBn(live.obs[0].value, seriesScale(live))!.toFixed(1)), 113.5);
  const millions = { scale: 6, obs: [{ period: '2026-09', value: 352000 }] };
  assert.equal(seriesScale(millions), 6);
  assert.equal(toUsdBn(352000, seriesScale(millions)), 352);
  assert.equal(seriesScale({ obs: [{ period: '2026-09', value: 1 }] }), undefined);
});
