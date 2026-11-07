import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OFFICIAL_FIGURES,
  markImfProjections,
  officialPoints,
  officialSeries,
  parseImfYears,
  parseWorldBankYears,
  stabilityPercentile,
} from '../src/utils/officialHistory.ts';
import { ARCHIVE_FIGURES, countrySeries } from '../src/utils/seriesHistory.ts';

const fig = (id: string) => OFFICIAL_FIGURES.find((f) => f.id === id)!;

test('World Bank years: real values only, oldest first; an odd answer is null', () => {
  const body = [{ page: 1 }, [{ date: '2024', value: 3.9 }, { date: '2023', value: null }, { date: '2022', value: 4.1 }, { date: 'x', value: 1 }]];
  assert.deepEqual(parseWorldBankYears(body), [{ year: '2022', value: 4.1 }, { year: '2024', value: 3.9 }]);
  assert.deepEqual(parseWorldBankYears([{ message: [{ key: 'Invalid value' }] }]), []);
  assert.equal(parseWorldBankYears({ nope: true }), null);
});

test('IMF years: by code and country; a country the IMF does not cover gives no points', () => {
  const body = { values: { PCPIPCH: { BRA: { 2021: 8.3, 2020: 3.2, 2022: null } } } };
  assert.deepEqual(parseImfYears(body, 'PCPIPCH', 'BRA'), [{ year: '2020', value: 3.2 }, { year: '2021', value: 8.3 }]);
  assert.deepEqual(parseImfYears(body, 'PCPIPCH', 'EGY'), []);
  assert.equal(parseImfYears({}, 'PCPIPCH', 'BRA'), null);
});

test('transforms match what the snapshot shows (stability rank, reserves in USD bn)', () => {
  assert.equal(stabilityPercentile(0), 50);
  assert.deepEqual(officialPoints(fig('stability'), [{ year: '2023', value: -0.5 }]), [{ date: '2023', value: 40 }]);
  assert.deepEqual(officialPoints(fig('reserves_usd'), [{ year: '2024', value: 363_100_000_000 }]), [{ date: '2024', value: 363.1 }]);
});

test('IMF years from this one on are marked as projections', () => {
  const pts = markImfProjections([{ date: '2025', value: 1 }, { date: '2026', value: 2 }, { date: '2027', value: 3 }], new Date('2026-11-05T00:00:00Z'));
  assert.deepEqual(pts.map((p) => p.note), [undefined, 'IMF projection', 'IMF projection']);
});

test('series: annual with source code; missing says why', () => {
  const file = { iso3: 'BRA', pulledAt: '2026-11-05T10:00:00Z', series: { debt_gdp: { points: [{ date: '2020', value: 96 }] } }, failed: { gdp_growth: 'IMF did not answer (HTTP 503)' } };
  const s = officialSeries(file, fig('debt_gdp'));
  assert.ok('points' in s && s.freq === 'annual' && /GGXWDG_NGDP/.test(s.source));
  const miss = officialSeries(file, fig('gdp_growth'));
  assert.ok('reason' in miss && miss.reason === 'IMF did not answer (HTTP 503)');
  const none = officialSeries(file, fig('output_gap'));
  assert.ok('reason' in none && /publishes no figures/.test(none.reason));
  const nofile = officialSeries(null, fig('debt_gdp'));
  assert.ok('reason' in nofile && /not downloaded yet/.test(nofile.reason));
});

test('countrySeries prefers the full official run over saved pulls, and lists the extra figures', () => {
  const official = { iso3: 'BRA', pulledAt: '2026-11-05T10:00:00Z', series: { debt_gdp: { points: [{ date: '2019', value: 87.9 }, { date: '2020', value: 96 }] }, reserves_usd: { points: [{ date: '2024', value: 330 }] } } };
  const archive = [{ date: '2026-11-04', pulledAt: Date.parse('2026-11-04T08:00:00Z'), snapshot: { liveFields: { 'imf.debtToGdpPct': 'IMF WEO', 'wb.currentAccountPctGdp': 'World Bank, 2024' }, imfIndicators: { debtToGdpPct: 78 }, worldBankIndicators: { currentAccountPctGdp: -2.3 } } }];
  const set = countrySeries('BRA', { official, archive });
  const debt = set.series.find((s) => s.id === 'debt_gdp')!;
  assert.equal(debt.freq, 'annual');
  assert.equal(debt.points.length, 2);
  // No official run for the current account: the saved pulls still give it a history.
  assert.equal(set.series.find((s) => s.id === 'current_account')!.freq, 'per pull');
  assert.equal(set.series.find((s) => s.id === 'reserves_usd')!.points[0].value, 330);
  const extra = OFFICIAL_FIGURES.filter((o) => !ARCHIVE_FIGURES.some((f) => f.id === o.id)).length;
  assert.equal(set.series.length + set.missing.length, 33 + ARCHIVE_FIGURES.length + extra); // + Focus survey (Brazil only); + 7 BoC-BoE default series; + 11 World Bank IDS creditor series; + spread-implied default probability; // 9 feed series incl. the USD bond spread, quarterly GDP q/q and y/y, monthly activity; + 4 BIS credit cycle
});

test('summary: "latest" is the newest outturn, not an IMF projection', async () => {
  const { seriesSummary } = await import('../src/utils/seriesHistory.ts');
  const file = { iso3: 'BRA', pulledAt: '2026-11-05T10:00:00Z', series: { debt_gdp: { points: [{ date: '2024', value: 87 }, { date: '2025', value: 90 }, { date: '2030', value: 99 }] } } };
  const s = officialSeries(file, fig('debt_gdp'), new Date('2026-11-05T00:00:00Z'));
  assert.ok('points' in s);
  const sum = seriesSummary(s as never);
  assert.equal(sum.latest, 90);
  assert.equal(sum.last, '2025');
  assert.equal(sum.projectedTo, '2030');
  assert.equal(sum.count, 3);
});

test('fiscal balances come from the IMF Fiscal Monitor codes DataMapper serves (the WEO codes answer empty)', async () => {
  const { OFFICIAL_FIGURES: figs, officialSeries: ser } = await import('../src/utils/officialHistory.ts');
  const pb = figs.find((f) => f.id === 'primary_balance')!;
  const ob = figs.find((f) => f.id === 'overall_balance')!;
  assert.equal(pb.code, 'GGXONLB_G01_GDP_PT');
  assert.equal(ob.code, 'GGXCNL_G01_GDP_PT');
  const s = ser({ iso3: 'BRA', pulledAt: '2026-11-05T00:00:00Z', series: { primary_balance: { points: [{ date: '2024', value: -0.4 }] } } }, pb, new Date('2026-11-05'));
  assert.ok('points' in s);
  assert.match((s as { source: string }).source, /IMF Fiscal Monitor \(GGXONLB_G01_GDP_PT\)/);
});

test('capital flows (D4): World Bank BoP codes checked against the indicator list on 2026-11-07', () => {
  const code = (id: string) => OFFICIAL_FIGURES.find((f) => f.id === id)?.code;
  assert.equal(code('fdi_in_gdp'), 'BX.KLT.DINV.WD.GD.ZS');
  assert.equal(code('fdi_out_gdp'), 'BM.KLT.DINV.WD.GD.ZS');
  assert.equal(code('fdi_net_usd'), 'BN.KLT.DINV.CD');
  assert.equal(code('portfolio_net_usd'), 'BN.KLT.PTXL.CD');
  assert.equal(code('financial_account_usd'), 'BN.FIN.TOTL.CD');
  const fin = OFFICIAL_FIGURES.find((f) => f.id === 'financial_account_usd')!;
  assert.equal(fin.transform?.(-61_300_000_000), -61.3);
  assert.match(fin.about || '', /negative number means more came in than went out/);
});
