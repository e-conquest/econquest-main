import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lsegSnapshotUrl,
  lsegTokenRequest,
  normaliseDate,
  ownCdsSettings,
  parseLsegSnapshot,
  parseOwnCdsCsv,
  parseRicMap,
} from '../src/utils/ownCds.ts';
import { bankerBrief } from '../src/utils/bankerNote.ts';
import { pmBookBrief, bookView } from '../src/utils/bookNote.ts';
import { cdsSourceNote } from '../src/utils/watchlistYield.ts';
import { getSnapshotDataStatus } from '../src/utils/dataStatus.ts';
import { buildBaselineOpenData } from '../src/data/presetsAndBaselines.ts';
import type { CouncilAssessmentRun, WatchlistItem } from '../src/types/council.ts';
import type { Holding } from '../src/utils/holdings.ts';

const NOW = new Date('2026-11-04T12:00:00Z');

test('switch: off unless CDS_FEED is set and complete', () => {
  assert.equal(ownCdsSettings({}), null);
  assert.equal(ownCdsSettings({ CDS_FEED: 'csv' }), null);
  assert.deepEqual(ownCdsSettings({ CDS_FEED: 'csv', CDS_CSV_PATH: '/x/cds.csv' }), { provider: 'csv', csvPath: '/x/cds.csv' });
  assert.equal(ownCdsSettings({ CDS_FEED: 'lseg', LSEG_APP_KEY: 'k', LSEG_USERNAME: 'u', LSEG_PASSWORD: 'p' }), null); // no RICs
  const l = ownCdsSettings({ CDS_FEED: 'LSEG', LSEG_APP_KEY: 'k', LSEG_USERNAME: 'u', LSEG_PASSWORD: 'p', LSEG_CDS_RICS: 'bra=RIC.A, TUR=RIC.B' })!;
  assert.equal(l.provider, 'lseg');
  assert.deepEqual(l.lseg!.rics, { BRA: 'RIC.A', TUR: 'RIC.B' });
  assert.equal(l.lseg!.base, 'https://api.refinitiv.com');
  assert.equal(ownCdsSettings({ CDS_FEED: 'bloomberg' }), null);
});

test('dates in the usual export forms', () => {
  assert.equal(normaliseDate('2026-11-03'), '2026-11-03');
  assert.equal(normaliseDate('2026-11-03T21:00:00Z'), '2026-11-03');
  assert.equal(normaliseDate('20261103'), '2026-11-03');
  assert.equal(normaliseDate('3/11/2026'), '2026-11-03');
  assert.equal(normaliseDate('Nov 3'), null);
});

test('CSV: latest date per country, bad rows skipped, source column optional', () => {
  const csv = [
    'ISO3,Date,CDS5Y_bps,Source',
    'BRA,2026-11-02,171.5,Bloomberg',
    'BRA,2026-11-03,168.2,Bloomberg',
    'BRA,2026-10-30,180,Bloomberg',
    'TUR,2026-11-03,,Bloomberg',
    'MEX,03/11/2026,"1,05",',
    'ZAF,2026-11-03,99999,x',
    'EGY,2026-11-03,612,',
  ].join('\n');
  const q = parseOwnCdsCsv(csv);
  assert.deepEqual(q.get('BRA'), { iso3: 'BRA', bps: 168.2, date: '2026-11-03', source: 'Bloomberg' });
  assert.equal(q.has('TUR'), false); // blank
  assert.equal(q.has('ZAF'), false); // implausible
  assert.equal(q.get('EGY')!.source, 'your file');
  assert.equal(parseOwnCdsCsv('iso3;date;bps\nCHL;2026-11-03;55').get('CHL')!.bps, 55);
  assert.equal(parseOwnCdsCsv('country,price\nBRA,1').size, 0); // columns not recognised
});

test('LSEG: token request carries the app key as client id; snapshot asks only for the mapped RICs', () => {
  const s = ownCdsSettings({ CDS_FEED: 'lseg', LSEG_APP_KEY: 'APPKEY', LSEG_USERNAME: 'me', LSEG_PASSWORD: 'p w', LSEG_CDS_RICS: 'BRA=BR5Y=X,TUR=TR5Y=X' })!.lseg!;
  const t = lsegTokenRequest(s);
  assert.equal(t.url, 'https://api.refinitiv.com/auth/oauth2/v1/token');
  const body = new URLSearchParams(t.body);
  assert.equal(body.get('grant_type'), 'password');
  assert.equal(body.get('client_id'), 'APPKEY');
  assert.equal(body.get('password'), 'p w');
  assert.match(lsegSnapshotUrl(s), /\/data\/pricing\/snapshots\/v1\/\?universe=BR5Y%3DX,TR5Y%3DX&fields=CF_LAST,/);
});

test('LSEG: values from Refresh messages; Status messages and blanks skipped', () => {
  const rics = { BRA: 'BR5Y=X', TUR: 'TR5Y=X', MEX: 'MX5Y=X' };
  const json = [
    { Type: 'Refresh', Key: { Service: 'ELEKTRON_DD', Name: 'BR5Y=X' }, Fields: { CF_LAST: 167.9, VALUE_DT1: '2026-11-03' } },
    { Type: 'Status', Key: { Name: 'TR5Y=X' }, State: { Code: 'NotFound' } },
    { Type: 'Refresh', Key: { Name: 'MX5Y=X' }, Fields: { CF_LAST: null, PRIMACT_1: 118.4 } },
  ];
  const q = parseLsegSnapshot(json, rics, '2026-11-04');
  assert.deepEqual(q.get('BRA'), { iso3: 'BRA', bps: 167.9, date: '2026-11-03', source: 'LSEG' });
  assert.equal(q.has('TUR'), false);
  assert.equal(q.get('MEX')!.bps, 118.4);
  assert.equal(q.get('MEX')!.date, '2026-11-04');
  assert.equal(parseLsegSnapshot({ error: 'x' }, rics, '2026-11-04').size, 0);
});

function run(own: boolean): CouncilAssessmentRun {
  const openData = buildBaselineOpenData('BRA');
  openData.dataStatus = { verifiedLiveSources: own ? ['Own CDS data (LSEG, 5Y CDS)'] : [], checkedAt: NOW.toISOString() };
  if (own) {
    openData.ownCds5Y = { bps: 167.9, date: '2026-11-03', source: 'LSEG' };
    openData.monetaryAndMarket.cds5YSpreadBps = 168;
  }
  return { iso3: 'BRA', countryName: 'Brazil', openData } as unknown as CouncilAssessmentRun;
}

test('brief: own CDS is labelled with provider and date; without the switch it reads Missing and says how to connect it', () => {
  const cds = (r: CouncilAssessmentRun) => bankerBrief(r, [], NOW).groups.find((g) => g.title === 'Market access')!.rows.find((x) => x.label === '5Y CDS')!;
  const own = cds(run(true));
  assert.equal(own.value, '168 bps');
  assert.equal(own.source, 'your LSEG data, 3 Nov 2026');
  assert.equal(own.verified, true);
  const none = cds(run(false));
  assert.equal(none.value, 'Missing');
  assert.match(none.help || '', /Your own paid data/);
  // Own CDS alone does not make the snapshot "live" (that needs IMF and World Bank).
  assert.notEqual(getSnapshotDataStatus(run(true).openData).mode, 'live');
});

test('a stale own-CDS figure without the feed in the live list is not trusted', () => {
  const r = run(true);
  r.openData.dataStatus = { verifiedLiveSources: [], checkedAt: NOW.toISOString() };
  assert.equal(getSnapshotDataStatus(r.openData).ownCds, undefined);
});

test('watchlist and book: own CDS named per country and by weight', () => {
  assert.equal(cdsSourceNote({ cds5YSource: 'own', cds5YProvider: 'LSEG', cds5YDate: '2026-11-03' }), 'Your LSEG, 3 Nov 2026');
  assert.equal(cdsSourceNote({ cds5YSource: 'ai_estimate' }), 'AI estimate');
  assert.equal(cdsSourceNote({}), 'Sample');
  const item = (iso3: string, own: boolean): WatchlistItem =>
    ({
      iso3,
      countryName: iso3,
      currencyCode: 'X',
      geopoliticalRisk: 0.3,
      sovereignRisk: 0.3,
      macroRisk: 0.3,
      compositeRisk: 0.3,
      yield10YPct: 10,
      cds5YBps: 200,
      debtToGdpPct: 60,
      fxReservesMonths: 6,
      alertStatus: 'STABLE',
      ...(own ? { cds5YSource: 'own', cds5YProvider: 'LSEG', cds5YDate: '2026-11-03' } : {}),
    }) as unknown as WatchlistItem;
  const wl = [item('BRA', true), item('MEX', false)];
  const h = (iso3: string, n: number): Holding => ({ id: iso3, iso3, instrument: `${iso3} 2035`, assetClass: 'HC_BOND', side: 'LONG', notionalUsdMm: n, durationYears: 7 });
  const v = bookView([h('BRA', 30), h('MEX', 10)], wl, wl);
  const b = pmBookBrief(v, [], NOW);
  const row = b.groups.flatMap((g) => g.rows).find((r) => r.label === 'Weighted 5Y CDS')!;
  // Only Brazil has your own CDS: the average is Brazil's, and the row says Mexico is missing.
  assert.equal(row.value, '200 bps');
  assert.match(row.source, /^your CDS data, 75% of the book; missing for MEX$/);
});
