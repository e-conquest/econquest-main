import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientSafeStatus, licenceForSource, licenceLabelForSource, licenceRowsForSource } from '../src/utils/licenceLookup.ts';
import { DATA_LICENCES } from '../src/data/dataLicences.ts';
import { figureRows, FIGURES_HEADER } from '../src/utils/csvExport.ts';

const ids = (s: string) => licenceRowsForSource(s).map((r) => r.id);

test('source text maps to the register rows it names', () => {
  assert.deepEqual(ids('IMF WEO, 2025'), ['imf']);
  assert.deepEqual(ids('official, IMF Balance of Payments, 2026 Q2'), ['imf']);
  assert.deepEqual(ids('BIS, 2026-10-27 (Central Bank of Brazil)'), ['bis']);
  assert.deepEqual(ids('official, OECD via FRED, Sep 2026 avg'), ['fred']);
  assert.deepEqual(ids('OECD CLI via DBnomics, Aug 2026'), ['oecd']);
  assert.deepEqual(ids('J.P. Morgan EMBI Global via BCRP, Sep 2026'), ['bcrp']);
  assert.deepEqual(ids('official, ECB reference rates'), ['ecb']);
  assert.deepEqual(ids('Banco Central de Reserva del Perú, interbank rate (sell), PD04638PD'), ['bcrp']);
  assert.deepEqual(ids('US Treasury TIC, Aug 2026'), ['tic']);
  assert.deepEqual(ids('your holdings'), ['own']);
  assert.deepEqual(ids('Your connector: Desk CSV'), ['own']);
  assert.deepEqual(ids('official, UN Comtrade 2024 by HS chapter'), ['comtrade']);
});

test('a figure built from several sources takes the strictest class', () => {
  const lic = licenceForSource('model: IMF reserves over World Bank imports');
  assert.ok(lic);
  assert.equal(lic.status, 'permission');
  assert.deepEqual(lic.rows.map((r) => r.id), ['worldbank', 'imf']);
  assert.equal(licenceForSource('World Bank, 2024')?.status, 'open');
  assert.equal(licenceForSource('CFTC, week to 2026-10-28')?.status, 'open');
});

test('a source the register does not name is reported as such, never guessed', () => {
  assert.equal(licenceForSource('model, from figures above'), null);
  assert.equal(licenceForSource(''), null);
  assert.equal(licenceLabelForSource('estimate'), 'Not in the licence register');
});

test('only open and conditional sources count as client-safe', () => {
  assert.equal(clientSafeStatus('open'), true);
  assert.equal(clientSafeStatus('conditions'), true);
  assert.equal(clientSafeStatus('permission'), false);
  assert.equal(clientSafeStatus('not_verified'), false);
});

test('every register row except the paid-data catch-all is reachable from some source text', () => {
  const samples: Record<string, string> = {
    worldbank: 'World Bank, 2024', pinksheet: 'pink_sheet', imf: 'IMF WEO', comtrade: 'UN Comtrade', wits: 'WITS',
    bis: 'BIS', ecb: 'ECB', erapi: 'ExchangeRate-API', nyfed: 'NY Fed', fred: 'FRED', oecd: 'OECD via DBnomics',
    eurostat: 'Eurostat HICP', cftc: 'CFTC', tic: 'TIC', eia: 'EIA', gdelt: 'GDELT', ucdp: 'UCDP/PRIO Armed Conflict Dataset 26.1', polymarket: 'Polymarket',
    kalshi: 'Kalshi', bcrp: 'BCRP', trm_colombia: 'TRM (Superintendencia Financiera de Colombia), datos.gov.co', bcra: 'Banco Central de la República Argentina, official quote', boc_boe: 'BoC-BoE Sovereign Default Database, 2026 edition', bcb: 'BCB SGS 13522', tesouro: 'Tesouro Direto', evds: 'EVDS', banxico: 'Banxico INPC', acled: 'ACLED conflict events', own: 'your own CDS data', ofac: 'OFAC SDN', gpr: 'Caldara and Iacoviello Geopolitical Risk index', unsc: 'UN Security Council Consolidated List',
  };
  for (const row of DATA_LICENCES) {
    assert.ok(samples[row.id], `no sample for register row ${row.id}`);
    assert.ok(ids(samples[row.id]).includes(row.id), `${row.id} not matched by "${samples[row.id]}"`);
  }
});

test('figure downloads carry a licence column; missing figures leave it empty', () => {
  const rows = figureRows({ iso3: 'BRA', countryName: 'Brazil', liveFields: {}, fetchedAt: '2026-11-06T00:00:00Z' } as never);
  const col = FIGURES_HEADER.indexOf('licence');
  assert.equal(col, FIGURES_HEADER.length - 1);
  for (const r of rows) {
    assert.equal(r.length, FIGURES_HEADER.length);
    assert.equal(r[col], '');
  }
});
