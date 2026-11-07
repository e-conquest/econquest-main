import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FRED_10Y_SERIES,
  fredApiUrl,
  fredCsvUrl,
  formatPeriod,
  parseFredApiLatest,
  parseFredCsvLatest,
} from '../src/utils/officialYields.ts';

test('CSV: latest numeric row, skipping "." gaps, both header styles', () => {
  const csv = 'observation_date,S\n2026-07-01,9.42\n2026-08-01,9.28\n2026-09-01,.\n';
  assert.deepEqual(parseFredCsvLatest(csv, 'S'), {
    valuePct: 9.28,
    period: '2026-08',
    source: 'OECD via FRED',
    seriesId: 'S',
    url: 'https://fred.stlouisfed.org/series/S',
  });
  assert.equal(parseFredCsvLatest('DATE,S\r\n2026-09-01,8.94714\r\n', 'S')?.valuePct, 8.95);
});

test('CSV: block pages and implausible values are rejected', () => {
  assert.equal(parseFredCsvLatest('<html>Access denied</html>', 'S'), null);
  assert.equal(parseFredCsvLatest('observation_date,S\n2026-09-01,999\n', 'S'), null);
  assert.equal(parseFredCsvLatest('observation_date,S\n', 'S'), null);
});

test('API: newest numeric observation, whatever the order', () => {
  const r = parseFredApiLatest(
    { observations: [{ date: '2026-07-01', value: '9.42' }, { date: '2026-09-01', value: '.' }, { date: '2026-08-01', value: '9.28' }] },
    'S'
  );
  assert.equal(r?.valuePct, 9.28);
  assert.equal(r?.period, '2026-08');
  assert.equal(r?.source, 'OECD via FRED API');
});

test('API: error replies are rejected', () => {
  assert.equal(parseFredApiLatest({ error_code: 400, error_message: 'Bad Request' }, 'S'), null);
  assert.equal(parseFredApiLatest(null, 'S'), null);
  assert.equal(parseFredApiLatest({ observations: [{ date: '2026-09-01', value: '-50' }] }, 'S'), null);
});

test('URLs and labels', () => {
  assert.equal(fredCsvUrl('S', new Date(2026, 10, 4)), 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=S&cosd=2024-11-01');
  const api = new URL(fredApiUrl('S', 'k&y'));
  assert.equal(api.searchParams.get('api_key'), 'k&y');
  assert.equal(api.searchParams.get('file_type'), 'json');
  assert.equal(formatPeriod('2026-09'), 'Sep 2026');
});

test('series map covers only verified OECD members', () => {
  assert.deepEqual(Object.keys(FRED_10Y_SERIES).sort(), ['AUS', 'AUT', 'BEL', 'CAN', 'CHE', 'CHL', 'CZE', 'DEU', 'DNK', 'ESP', 'FIN', 'FRA', 'GBR', 'GRC', 'HUN', 'IND', 'IRL', 'ISR', 'ITA', 'JPN', 'KOR', 'MEX', 'NLD', 'NOR', 'NZL', 'POL', 'PRT', 'SVK', 'SWE', 'ZAF']);
  for (const [iso3, id] of Object.entries(FRED_10Y_SERIES)) assert.match(id, iso3 === 'IND' ? /^INDIRLTLT01STM$/ : /^IRLTLT01[A-Z]{2}M156N$/);
  assert.equal(FRED_10Y_SERIES.COL, undefined); // FRED page gave no data on 2026-11-07
});

import { parseTesouroDiretoLatest, describeOfficialYield } from '../src/utils/officialYields.ts';

// Rows in the real file's layout (checked 2026-11-04), plus decoys.
const TESOURO_CSV = [
  'Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha;PU Base Manha',
  'Tesouro Prefixado com Juros Semestrais;01/01/2037;29/10/2026;15,00;15,12;812,10;805,22;805,01',
  'Tesouro Prefixado com Juros Semestrais;01/01/2037;30/10/2026;15,23;15,35;800,10;795,22;795,01',
  'Tesouro Prefixado com Juros Semestrais;01/01/2035;30/10/2026;14,90;15,02;850,10;845,22;845,01',
  'Tesouro Prefixado com Juros Semestrais;01/01/2029;30/10/2026;14,10;14,22;950,10;945,22;945,01',
  'Tesouro Prefixado;01/01/2032;30/10/2026;14,50;14,62;500,10;495,22;495,01',
  'Tesouro IPCA+;15/05/2035;30/10/2026;7,10;7,22;2500,10;2495,22;2495,01',
].join('\r\n');

test('Tesouro Direto: NTN-F closest to 10 years on the latest date, mid of buy and sell', () => {
  const r = parseTesouroDiretoLatest(TESOURO_CSV);
  assert.ok(r);
  assert.equal(r.valuePct, 15.29);
  assert.equal(r.period, '2026-10-30');
  assert.equal(r.frequency, 'daily');
  assert.equal(r.seriesId, 'NTN-F 2037');
  assert.equal(describeOfficialYield(r).when, '30 Oct 2026');
  assert.match(describeOfficialYield(r).long, /Brazil Treasury, Tesouro Direto, NTN-F 2037/);
});

test('Tesouro Direto: ignores inflation-linked and short bonds, rejects junk', () => {
  const onlyShort = TESOURO_CSV.split('\r\n').filter((l) => !/203[57]/.test(l) || /IPCA/.test(l)).join('\n');
  assert.equal(parseTesouroDiretoLatest(onlyShort), null);
  assert.equal(parseTesouroDiretoLatest('<html>Service unavailable</html>'), null);
  assert.equal(parseTesouroDiretoLatest(''), null);
});

test('monthly observations keep the "avg" label', () => {
  const r = parseFredCsvLatest('observation_date,S\n2026-09-01,9.35\n', 'S')!;
  assert.equal(describeOfficialYield(r).when, 'Sep 2026 avg');
});
