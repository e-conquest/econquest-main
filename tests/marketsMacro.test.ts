import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INFLATION_TARGETS, marketsMacroBrief, peerScreen, policyStance, realYield } from '../src/utils/marketsMacro.ts';
import { buildBaselineOpenData } from '../src/data/presetsAndBaselines.ts';
import type { CouncilAssessmentRun, WatchlistItem } from '../src/types/council.ts';
import { FEED_PATHS, markLive } from './helpers/live.ts';

const NOW = '2026-11-04T12:00:00Z';
const peer = (iso3: string, cds: number, y = 10): WatchlistItem => ({ iso3, countryName: iso3, cds5YBps: cds, yield10YPct: y }) as unknown as WatchlistItem;

test('peer screen: widest spread over US Treasuries first, no cheap or rich call', () => {
  const ps = [peer('A', 100, 10), peer('B', 300, 6), peer('C', 400, 12), peer('D', 500, 8)];
  const { rows } = peerScreen(ps, 4.1);
  assert.deepEqual(rows.map((r) => r.iso3), ['C', 'A', 'D', 'B']);
  assert.equal(rows.find((r) => r.iso3 === 'A')!.spreadBps, 590);
  for (const r of rows) assert.ok(!('rv' in r) && !('risk' in r));
});

test('policy stance rules read as stated', () => {
  assert.match(policyStance(6, 0.5), /room to cut/);
  assert.match(policyStance(6, 4), /still above target/);
  assert.match(policyStance(-1, 2), /loose/);
  assert.match(policyStance(1, 0.2), /neutral/);
  assert.match(policyStance(5, undefined), /high real rate/);
});

test('targets: checked ones name the bank page; Brazil and Mexico say they were not re-checked; Egypt not on file', () => {
  for (const iso of ['ZAF', 'TUR', 'IDN', 'POL', 'CHL', 'GBR', 'JPN']) assert.equal(INFLATION_TARGETS[iso].checked, true, iso);
  assert.equal(INFLATION_TARGETS.BRA.checked, false);
  assert.equal(INFLATION_TARGETS.EGY, undefined);
});

function run(iso3: string, us = true, live = true): CouncilAssessmentRun {
  const openData = buildBaselineOpenData(iso3);
  openData.dataStatus = { verifiedLiveSources: [], checkedAt: NOW };
  openData.imfIndicators.cpiInflationPct = 4.5;
  openData.monetaryAndMarket.policyRatePct = 11.75;
  openData.monetaryAndMarket.sovereign10YBondYieldPct = 13.5;
  openData.monetaryAndMarket.cds5YSpreadBps = 300;
  if (live) {
    // Every figure from a real source: IMF and World Bank feeds, an official yield, your CDS and an official policy rate.
    markLive(openData, [...FEED_PATHS, 'market.policyRatePct']);
    openData.official10YYield = { valuePct: 13.5, period: '2026-10-30', source: 'Tesouro Direto', seriesId: 'x', url: 'u', frequency: 'daily' };
    openData.ownCds5Y = { bps: 300, date: '2026-11-03', source: 'LSEG' };
    openData.dataStatus!.verifiedLiveSources.push('Tesouro Direto', 'Own CDS data (LSEG, 5Y CDS)');
  }
  if (us) openData.us10YYield = { valuePct: 4.1, period: '2026-09', source: 'OECD via FRED', seriesId: 'IRLTLT01USM156N', url: 'x' };
  return { iso3, countryName: iso3 === 'BRA' ? 'Brazil' : iso3, openData } as unknown as CouncilAssessmentRun;
}

test('brief: figures keep their sources, model readings are tagged model, judgements tie to them', () => {
  const peers = [peer('BRA', 163), peer('MEX', 117), peer('ZAF', 205), peer('TUR', 264), peer('EGY', 540)];
  const b = marketsMacroBrief(run('BRA'), peers);
  const rows = Object.fromEntries(b.groups.flatMap((g) => g.rows).map((r) => [r.label, r]));
  assert.equal(rows['Inflation target'].value, '3.0% ± 1.5');
  assert.match(rows['Inflation target'].source, /not re-checked/);
  assert.equal(rows['US 10Y Treasury'].verified, true);
  assert.equal(rows['Spread over US 10Y'].value, '940 bps');
  assert.equal(rows['Real policy rate'].value, '7.3%');
  assert.equal(rows['Real policy rate'].source, 'model, from figures above');
  assert.equal(rows['Real 10Y yield'].value, '9.0%');
  assert.equal(rows['CPI inflation'].source, 'IMF WEO');
  assert.equal(rows['5Y CDS against risk peers'], undefined);
  assert.match(b.judgements[0], /1\.5 pts above the 3\.0% target; with the policy rate at 11\.75%, the real rate is 7\.3%, so policy looks tight/);
  assert.match(b.judgements[1], /940 bps over US Treasuries \(US 10Y 4\.10%, Sep 2026\)/);
  // Readings are grouped under the desk role that owns them.
  assert.deepEqual(b.groups.map((g) => g.title), ['Macro now', 'Reserves and balance of payments (IMF)', 'World reserve currencies (IMF COFER, quarterly)', 'Market pricing', 'Central Bank Watcher Agent', 'Relative Value Agent', 'OECD inflation (monthly)', 'OECD leading indicator (monthly)', 'Cycle clock', 'Shock early warning', 'Signal track record', 'Futures positioning (CFTC, weekly)', 'US Treasury holdings (TIC, monthly)', 'Trade partners (UN Comtrade, annual)', 'FX Valuation Agent', 'Global Spillover Agent']);
  assert.deepEqual(b.groups[5].rows.map((r) => r.label), ['Carry over US per unit of FX volatility']);
});

test('brief: no US yield, no target, too few peers: says so instead of guessing', () => {
  const b = marketsMacroBrief(run('EGY', false), [peer('EGY', 500)]);
  const rows = Object.fromEntries(b.groups.flatMap((g) => g.rows).map((r) => [r.label, r]));
  assert.equal(rows['Inflation target'].value, 'Missing');
  assert.equal(rows['US 10Y Treasury'].value, 'Missing');
  assert.equal(rows['US 10Y Treasury'].source, 'FRED did not answer');
  assert.equal(rows['Spread over US 10Y'], undefined);
  assert.match(b.judgements[0], /no inflation target on file/);
});

test('brief: with no live feeds, nothing is shown from built-in values and readings say what they need', () => {
  const b = marketsMacroBrief(run('BRA', true, false), []);
  const rows = Object.fromEntries(b.groups.flatMap((g) => g.rows).map((r) => [r.label, r]));
  for (const k of ['CPI inflation', 'Policy rate', '10Y government yield', '5Y CDS', 'Debt / GDP', 'FX reserves', 'Real policy rate', 'Real 10Y yield'])
    assert.equal(rows[k].value, 'Missing', k);
  assert.equal(rows['Real policy rate'].source, 'Needs a policy rate');
  assert.match(b.headline, /no live market or macro figures/);
  assert.match(b.sampleWarning || '', /missing/);
});

test('brief: IMF reserves and balance of payments rows carry the IMF series and period; Missing says why', async () => {
  const { imfRows } = await import('../src/utils/marketsMacro.ts');
  const self = {
    iso3: 'BRA',
    imf: {
      iso3: 'BRA',
      pulledAt: '2026-11-05T03:00:00Z',
      reserves: { key: 'BRA.TRA.USD.M', period: '2025-09', usdBn: 345, change12mPct: 2.4 },
      imports4q: { usdBn: 400, through: '2025-Q2', key: 'BRA.DB.GS.USD.Q' },
      monthsOfImports: 10.3,
      currentAccount: { key: 'BRA.NETCD.CAB.USD.Q', period: '2025-Q2', usdBn: -18 },
      currentAccount4q: { usdBn: -60, through: '2025-Q2', pctGdp: -2.5, gdpYear: '2025', gdpUsdBn: 2400 },
    },
  } as never;
  const rows = Object.fromEntries(imfRows(self).map((r) => [r.label, r]));
  assert.equal(rows['Official reserves'].value, '$345.0bn');
  assert.match(rows['Official reserves'].source, /IMF International Liquidity, Sep 2025, series BRA\.TRA\.USD\.M \(pulled 2026-11-05\)/);
  assert.equal(rows['Reserves in months of imports'].value, '10.3 months');
  assert.equal(rows['Current account, last four quarters'].value, '-2.5% of GDP');
  assert.match(rows['Current account, last four quarters'].source, /^model: IMF BOP/);
  const none = imfRows(undefined);
  assert.ok(none.every((r) => r.value === 'Missing'));
  assert.match(none[0].source, /IMF did not answer/);
});

test('brief: COFER rows put the country\'s own currency first and say they are a world reading', async () => {
  const { coferRows } = await import('../src/utils/marketsMacro.ts');
  const cofer = {
    period: '2025-Q2',
    area: { id: 'G001', name: 'World' },
    method: 'imf share',
    pulledAt: '2026-11-05T03:00:00Z',
    shares: [
      { ccy: 'USD', pct: 56.3, change4qPts: -1.9 },
      { ccy: 'EUR', pct: 20.1 },
      { ccy: 'JPY', pct: 5.9, change4qPts: 0.3 },
      { ccy: 'GBP', pct: 4.7 },
      { ccy: 'CNY', pct: 2.1 },
      { ccy: 'CAD', pct: 2.6 },
    ],
  };
  const jp = coferRows({ iso3: 'JPN', cofer } as never, 'JPN');
  assert.equal(jp[0].label, 'Own currency: yen share of world FX reserves');
  assert.equal(jp[0].value, '5.9% (+0.3 pts on the year)');
  assert.match(jp[0].source, /IMF COFER, world \(G001\), Q2 2025 \(pulled 2026-11-05\)/);
  const br = coferRows({ iso3: 'BRA', cofer } as never, 'BRA');
  assert.equal(br.length, 5);
  assert.equal(br[0].label, 'US dollar share of world FX reserves');
  assert.equal(coferRows(undefined, 'BRA')[0].value, 'Missing');
});

test('real yield never fills a missing figure', () => {
  assert.equal(realYield({ yield10YPct: 8 }), undefined);
  assert.equal(peerScreen([] as never, 4.1).rows.length, 0);
});

test('panels with no figure fold away; panels with one figure stay, order kept', async () => {
  const { splitEmptyGroups, emptyGroupReasons } = await import('../src/utils/marketsMacro.ts');
  const miss = (label: string, source: string) => ({ label, value: 'Missing', source, verified: false, missing: true });
  const groups = [
    { title: 'A', rows: [miss('x', 'IMF did not answer'), miss('y', 'IMF did not answer')] },
    { title: 'B', rows: [miss('x', 'BIS did not answer'), { label: 'z', value: '4.6%', source: 'BCB', verified: true }] },
    { title: 'C', rows: [{ label: 'w', value: 'Missing', source: 'No source yet', verified: false }] },
    { title: 'D', rows: [] },
  ];
  const { filled, empty } = splitEmptyGroups(groups);
  assert.deepEqual(filled.map((g) => g.title), ['B', 'D']);
  assert.deepEqual(empty.map((g) => g.title), ['A', 'C']);
  assert.deepEqual(emptyGroupReasons(groups[0]), ['IMF did not answer']);
});
