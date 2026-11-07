import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bcbSgsUrl, eurostatHicpUrl, mergeNationalCpi, parseBcbSgs, parseEurostatHicp, BCB_LONG, BCB_SHORT } from '../src/utils/nationalCpi.ts';
import { cpiFor, cpiSource } from '../src/utils/oecdInflation.ts';

// Replies as the sources gave them on 2026-11-05.
const BCB = [{ data: '01/07/2026', valor: '4.44' }, { data: '01/08/2026', valor: '4.22' }, { data: '01/09/2026', valor: '4.58' }];
const EUROSTAT = {
  version: '2.0',
  class: 'dataset',
  value: { '0': 3.1, '1': 3.5 },
  id: ['freq', 'unit', 'coicop18', 'geo', 'time'],
  size: [1, 1, 1, 1, 3],
  dimension: {
    freq: { category: { index: { M: 0 } } },
    unit: { category: { index: { RCH_A: 0 } } },
    coicop18: { category: { index: { TOTAL: 0 } } },
    geo: { category: { index: { PL: 0 } } },
    time: { category: { index: { '2026-07': 0, '2026-08': 1, '2026-09': 2 } } },
  },
};

test('BCB SGS rows read into months, oldest first; blanks and bad rows skipped', () => {
  assert.deepEqual(parseBcbSgs(BCB), [
    { period: '2026-07', value: 4.44 },
    { period: '2026-08', value: 4.22 },
    { period: '2026-09', value: 4.58 },
  ]);
  assert.deepEqual(parseBcbSgs([{ data: '01/10/2026', valor: '' }, { data: 'x', valor: '1' }]), []);
  assert.deepEqual(parseBcbSgs({}), []);
  assert.equal(bcbSgsUrl(13522, 3), 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/dados/ultimos/3?formato=json');
});

test('Eurostat JSON-stat: a month with no value is skipped, not read as zero', () => {
  assert.deepEqual(parseEurostatHicp(EUROSTAT), { PL: [{ period: '2026-07', value: 3.1 }, { period: '2026-08', value: 3.5 }] });
  assert.match(eurostatHicpUrl(['PL', 'HU']), /prc_hicp_minr\?.*unit=RCH_A&coicop18=TOTAL&geo=PL&geo=HU/);
});

test('Eurostat with two countries: positions follow geo then time', () => {
  const two = { ...EUROSTAT, size: [1, 1, 1, 2, 2], value: { '0': 1, '1': 2, '2': 3, '3': 4 }, dimension: { ...EUROSTAT.dimension, geo: { category: { index: { PL: 0, HU: 1 } } }, time: { category: { index: { '2026-07': 0, '2026-08': 1 } } } } };
  const r = parseEurostatHicp(two);
  assert.deepEqual(r.PL.map((p) => p.value), [1, 2]);
  assert.deepEqual(r.HU.map((p) => p.value), [3, 4]);
});

test('an ambiguous Eurostat reply (more than one unit) is refused', () => {
  assert.deepEqual(parseEurostatHicp({ ...EUROSTAT, size: [1, 2, 1, 1, 3] }), {});
});

test('a national series replaces the OECD one only when at least as new, and says where it came from', () => {
  const oecd = { BRA: { basis: 'oecd_yoy' as const, points: [{ period: '2026-05', value: 5.0 }] }, MEX: { basis: 'oecd_yoy' as const, points: [{ period: '2026-05', value: 3.9 }] } };
  const merged = mergeNationalCpi(oecd, { BRA: { points: parseBcbSgs(BCB), short: BCB_SHORT, long: BCB_LONG } });
  const bra = cpiFor('BRA', merged)!;
  assert.equal(bra.month, '2026-09');
  assert.equal(bra.yoyPct, 4.58);
  assert.equal(bra.basis, 'national');
  assert.equal(bra.short, 'BCB IPCA');
  assert.match(cpiSource(bra), /^Banco Central do Brasil, IPCA 12-month inflation \(SGS 13522\), Sep 2026$/);
  assert.equal(cpiFor('MEX', merged)!.basis, 'oecd_yoy', 'untouched');
  const older = mergeNationalCpi({ BRA: { basis: 'oecd_yoy', points: [{ period: '2026-10', value: 5 }] } }, { BRA: { points: parseBcbSgs(BCB), short: BCB_SHORT, long: BCB_LONG } });
  assert.equal(cpiFor('BRA', older)!.basis, 'oecd_yoy', 'OECD newer: keep it');
  assert.equal(cpiFor('BRA', mergeNationalCpi(null, { BRA: { points: parseBcbSgs(BCB), short: BCB_SHORT, long: BCB_LONG } }))!.month, '2026-09', 'no OECD reply at all');
});

test('Banxico SIE: monthly INPC annual change read oldest first, N/E and other series skipped', async () => {
  const { parseBanxicoMonthly, banxicoSeriesUrl, banxicoHeaders, BANXICO_CPI_SERIES } = await import('../src/utils/nationalCpi.ts');
  // Reply shape as documented by open-source SIE clients (bmx.series[].idSerie, datos[].fecha dd/mm/yyyy, dato string).
  const reply = {
    bmx: {
      series: [
        { idSerie: 'SF43718', datos: [{ fecha: '01/09/2026', dato: '18.50' }] },
        { idSerie: 'SP30578', datos: [{ fecha: '01/09/2026', dato: '3.76' }, { fecha: '01/07/2026', dato: '3.51' }, { fecha: '01/08/2026', dato: 'N/E' }, { fecha: 'bad', dato: '1' }] },
      ],
    },
  };
  assert.deepEqual(parseBanxicoMonthly(reply, BANXICO_CPI_SERIES), [{ period: '2026-07', value: 3.51 }, { period: '2026-09', value: 3.76 }]);
  assert.deepEqual(parseBanxicoMonthly({ error: 'x' }, BANXICO_CPI_SERIES), []);
  const url = banxicoSeriesUrl([BANXICO_CPI_SERIES], new Date('2026-11-06T00:00:00Z'));
  assert.equal(url, 'https://www.banxico.org.mx/SieAPIRest/service/v1/series/SP30578/datos/2024-11-01/2026-11-06');
  assert.equal(banxicoHeaders(' tok ')['Bmx-Token'], 'tok');
  // A Banxico series takes Mexico's place only when it is at least as new as the OECD one.
  const merged = mergeNationalCpi({ MEX: { basis: 'oecd', points: [{ period: '2026-05', value: 4 }] } } as never, { MEX: { points: parseBanxicoMonthly(reply, BANXICO_CPI_SERIES), short: 'Banxico INPC', long: 'x' } });
  assert.equal(merged?.MEX.short, 'Banxico INPC');
});

test('EVDS CPI: 12-month change worked out from the monthly index; months without a year-earlier value skipped', async () => {
  const { parseEvdsCpiYoy, evdsCpiUrl, EVDS_CPI_DEFAULT_SERIES } = await import('../src/utils/nationalCpi.ts');
  const reply = {
    totalCount: 4,
    items: [
      { Tarih: '2025-8', TP_FG_J0: '2900' },
      { Tarih: '2025-9', TP_FG_J0: '3000' },
      { Tarih: '2026-8', TP_FG_J0: '' },
      { Tarih: '2026-9', TP_FG_J0: '3990' },
      { Tarih: '2026-10', TP_FG_J0: '4100' },
    ],
  };
  assert.deepEqual(parseEvdsCpiYoy(reply, EVDS_CPI_DEFAULT_SERIES), [{ period: '2026-09', value: 33 }]);
  assert.deepEqual(parseEvdsCpiYoy({ nope: 1 }, EVDS_CPI_DEFAULT_SERIES), []);
  const url = evdsCpiUrl(EVDS_CPI_DEFAULT_SERIES, new Date('2026-11-06T00:00:00Z'));
  assert.match(url, /^https:\/\/evds3\.tcmb\.gov\.tr\/igmevdsms-dis\/series=TP\.FG\.J0&startDate=\d{2}-\d{2}-2024&endDate=06-11-2026&type=json$/);
  assert.ok(!/key/i.test(url));
});
