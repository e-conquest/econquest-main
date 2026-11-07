import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveSeries, ARCHIVE_FIGURES, commoditySeries, countrySeries, seriesSummary, snapshotValue } from '../src/utils/seriesHistory.ts';

const cbpol = {
  pulledAt: '2026-11-05T06:00:00Z',
  daily: { BR: { bank: 'Central Bank of Brazil', points: [{ period: '2026-10-27', pct: 13.75 }, { period: '2026-09-17', pct: 14.25 }] } },
  monthly: { TR: { points: [{ period: '2026-09', pct: 37 }] } },
};

test('feeds that bring history become series, oldest first, with source and pull date', () => {
  const set = countrySeries('BRA', {
    cbpol,
    cli: { pulledAt: '2026-11-04T00:00:00Z', series: { BRA: [{ period: '2026-04', value: 103.6 }, { period: '2026-05', value: 103.82 }] } },
    cpi: { pulledAt: '2026-11-04T00:00:00Z', series: { BRA: { basis: 'national', long: 'Central Bank of Brazil (IPCA, 12 months)', points: [{ period: '2026-09', value: 4.5 }, { period: '2026-08', value: 4.6 }] } } },
    cftc: { pulledAt: '2026-11-01T00:00:00Z', weeks: { '102741': [{ date: '2026-10-28', openInterest: 100000, levNet: 25000, assetMgrNet: 0 }] } },
    tic: { pulledAt: '2026-11-01T00:00:00Z', table: { months: ['2026-08', '2026-07'], rows: { BRA: [230.1, 228.4] } } },
  });
  const rate = set.series.find((s) => s.id === 'policy_rate')!;
  assert.deepEqual(rate.points.map((p) => p.date), ['2026-09-17', '2026-10-27']);
  assert.match(rate.source, /Central Bank of Brazil/);
  assert.equal(rate.pulledAt, '2026-11-05T06:00:00Z');
  assert.deepEqual(set.series.find((s) => s.id === 'cpi_monthly')!.points.map((p) => p.value), [4.6, 4.5]);
  assert.equal(set.series.find((s) => s.id === 'cpi_monthly')!.source, 'Central Bank of Brazil (IPCA, 12 months)');
  assert.equal(set.series.find((s) => s.id === 'cli')!.points.length, 2);
  assert.equal(set.series.find((s) => s.id === 'cftc_lev_net')!.points[0].value, 25);
  assert.deepEqual(set.series.find((s) => s.id === 'tic_holdings')!.points.map((p) => p.date), ['2026-07', '2026-08']);
});

test('with nothing pulled every figure is Missing with a reason, never a number', () => {
  const set = countrySeries('EGY', {});
  assert.equal(set.series.length, 0);
  const why = Object.fromEntries(set.missing.map((m) => [m.id, m.reason]));
  assert.equal(why.policy_rate, 'BIS has not answered yet');
  assert.match(why.cftc_lev_net, /No CFTC currency future/);
  assert.match(why.debt_gdp, /No saved pulls yet/);
  assert.equal(set.missing.length, 32 + ARCHIVE_FIGURES.length + 29); // + 7 BoC-BoE default amounts by creditor; // 9 feed series + spread-implied default probability + 4 BIS credit cycle (credit gap, private credit, debt service ratio, real house prices) + 11 World Bank IDS creditor mix and new-loan terms, incl. USD bond spread, quarterly GDP q/q, y/y, monthly activity; + output gap, overall balance, revenue, expenditure, unemployment, current account in USD, GDP in USD, reserves in USD, short-term debt (% reserves and US$), broad money, exports, terms of trade, GDP per head PPP, six WGI estimates, CPI index, population, exchange rate, PPP factor, FDI in and out (% of GDP), direct, portfolio and financial account net (US$)
});

test('monthly BIS series is used where there is no daily one', () => {
  const set = countrySeries('TUR', { cbpol });
  const rate = set.series.find((s) => s.id === 'policy_rate')!;
  assert.equal(rate.freq, 'monthly');
  assert.equal(rate.points[0].value, 37);
});

test('policy rate: the one-day daily pull does not hide the saved monthly history', () => {
  const pull = {
    pulledAt: '2026-11-05T06:00:00Z',
    daily: { BR: { bank: 'Central Bank of Brazil', points: [{ period: '2026-11-03', pct: 13.75 }] } },
    monthly: { BR: { points: [{ period: '2026-09', pct: 14 }, { period: '2026-08', pct: 14.25 }, { period: '2026-10', pct: 13.75 }] } },
  };
  const rate = countrySeries('BRA', { cbpol: pull }).series.find((s) => s.id === 'policy_rate')!;
  assert.equal(rate.freq, 'monthly');
  assert.deepEqual(rate.points.map((p) => [p.date, p.value]), [['2026-08', 14.25], ['2026-09', 14], ['2026-10', 13.75], ['2026-11-03', 13.75]]);
  assert.equal(rate.points[3].note, 'latest daily figure');
  assert.match(rate.source, /Central Bank of Brazil/);
  // A daily figure inside the last month-end's month adds nothing.
  const same = { ...pull, daily: { BR: { points: [{ period: '2026-10-27', pct: 13.75 }] } } };
  assert.equal(countrySeries('BRA', { cbpol: same }).series.find((s) => s.id === 'policy_rate')!.points.length, 3);
});

test('archive series: one point per pull that had the figure live; unmarked values are skipped', () => {
  const pull = (date: string, debt: number, live: boolean) => ({
    date,
    pulledAt: Date.parse(`${date}T08:00:00Z`),
    snapshot: { liveFields: (live ? { 'imf.debtToGdpPct': 'IMF WEO' } : {}) as Record<string, string>, imfIndicators: { debtToGdpPct: debt } },
  });
  const fig = ARCHIVE_FIGURES.find((f) => f.id === 'debt_gdp')!;
  const s = archiveSeries([pull('2026-11-05', 78.1, true), pull('2026-10-22', 99, false), pull('2026-10-29', 77.7, true)], fig);
  assert.ok('points' in s);
  if ('points' in s) {
    assert.deepEqual(s.points.map((p) => [p.date, p.value]), [['2026-10-29', 77.7], ['2026-11-05', 78.1]]);
    assert.equal(s.points[0].note, 'IMF WEO');
    assert.equal(s.freq, 'per pull');
  }
  const none = archiveSeries([pull('2026-10-22', 99, false)], fig);
  assert.ok('reason' in none && /1 pull checked/.test(none.reason));
});

test('snapshotValue reads numbers only; NaN and missing groups give nothing', () => {
  const snap = { imfIndicators: { debtToGdpPct: Number.NaN }, monetaryAndMarket: { cds5YSpreadBps: 117 } };
  assert.equal(snapshotValue(snap, 'imf.debtToGdpPct'), undefined);
  assert.equal(snapshotValue(snap, 'market.cds5YSpreadBps'), 117);
  assert.equal(snapshotValue(snap, 'wb.fxReservesMonthsImport'), undefined);
});

test('commodity series and summaries', () => {
  const s = commoditySeries(
    [
      { code: 'CRUDE_BRENT', name: 'Brent crude', unit: 'USD/bbl', source: 'pink_sheet', points: [{ period: '2026-09', value: 120 }, { period: '2026-10', value: 125 }] },
      { code: 'EMPTY', name: 'Empty', unit: 'x', source: 'eia', points: [] },
    ],
    { pink_sheet: '2026-11-04T00:00:00Z', eia: undefined }
  );
  assert.equal(s.length, 1);
  assert.equal(s[0].id, 'commodity_pink_sheet_crude_brent');
  const sum = seriesSummary(s[0]);
  assert.deepEqual([sum.count, sum.first, sum.last, sum.latest], [2, '2026-09', '2026-10', 125]);
  assert.equal((sum as Record<string, unknown>).points, undefined);
});

test('gaps are named for monthly and weekly series, never filled', async () => {
  const { seriesGaps } = await import('../src/utils/seriesHistory.ts');
  assert.deepEqual(
    seriesGaps({ freq: 'monthly', points: [{ date: '2025-11', value: 1 }, { date: '2025-12', value: 1 }, { date: '2026-03', value: 1 }] }),
    [{ after: '2025-12', before: '2026-03' }]
  );
  assert.deepEqual(seriesGaps({ freq: 'weekly', points: [{ date: '2026-10-07', value: 1 }, { date: '2026-10-14', value: 1 }, { date: '2026-11-04', value: 1 }] }), [
    { after: '2026-10-14', before: '2026-11-04' },
  ]);
  assert.deepEqual(seriesGaps({ freq: 'daily', points: [{ date: '2026-01-01', value: 1 }, { date: '2026-06-01', value: 1 }] }), []);
});

test('monthly inflation says the OECD has not answered when only a national series came back', () => {
  const set = countrySeries('MEX', { cpiOecdAnswered: false, cpi: { pulledAt: 'x', series: { BRA: { basis: 'national', points: [{ period: '2026-09', value: 4.5 }] } } } });
  assert.equal(set.missing.find((m) => m.id === 'cpi_monthly')?.reason, 'OECD inflation has not answered yet');
});
