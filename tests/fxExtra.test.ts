import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extraFxDailySeries, extraFxNeedsPull, extraFxUrl, extraFxWindows, parseBcraQuotes, parseBcrpDaily, parseTrm, readFxExtraFile, type FxExtraFile } from '../src/utils/fxExtra.ts';
import { fxDailySeries } from '../src/utils/fxHistory.ts';

// Reply shapes as each source answered on 2026-11-07.
const BCRP = { config: { title: 'x' }, periods: [{ name: '01.Set.26', values: ['3.36585714285714'] }, { name: '08.Oct.26', values: ['n.d.'] }, { name: '30.Oct.26', values: ['3.46392857142857'] }] };
const TRM = [
  { valor: '3213.97', unidad: 'COP', vigenciadesde: '2026-09-01T00:00:00.000', vigenciahasta: '2026-09-01T00:00:00.000' },
  { valor: '3126.08', unidad: 'COP', vigenciadesde: '2026-09-05T00:00:00.000', vigenciahasta: '2026-09-08T00:00:00.000' },
];
const BCRA = { status: 200, metadata: { resultset: { count: 2 } }, results: [{ fecha: '2026-09-10', detalle: [{ codigoMoneda: 'USD', descripcion: 'DOLAR E.E.U.U.', tipoPase: 1, tipoCotizacion: 1513.0 }] }, { fecha: '2026-09-01', detalle: [{ codigoMoneda: 'USD', tipoCotizacion: 1513 }] }] };

test('parsers: BCRP Spanish dates and n.d., TRM once per validity period, BCRA USD quote', () => {
  assert.deepEqual(parseBcrpDaily(BCRP), { '2026-09-01': 3.365857, '2026-10-30': 3.463929 });
  assert.deepEqual(parseTrm(TRM), { '2026-09-01': 3213.97, '2026-09-05': 3126.08 });
  assert.deepEqual(parseBcraQuotes(BCRA), { '2026-09-10': 1513, '2026-09-01': 1513 });
  assert.equal(parseBcrpDaily({ periods: [{ name: '01.Set.26', values: ['n.d.'] }] }), null);
  assert.equal(parseTrm({ error: true }), null);
  assert.equal(parseBcraQuotes({ results: [] }), null);
});

test('windows: full history first (ARS by year), then only the last 45 days', () => {
  const now = new Date('2026-11-07T00:00:00Z');
  const ars = extraFxWindows('ARS', undefined, now);
  assert.equal(ars[0][0], '2003-01-01');
  assert.equal(ars[ars.length - 1][1], '2026-11-07');
  assert.ok(ars.length >= 23);
  assert.equal(extraFxWindows('COP', undefined, now).length, 1);
  const later = extraFxWindows('PEN', { pulledAt: '2026-11-06T00:00:00Z', through: '2026-11-06', rates: {} }, now);
  assert.deepEqual(later, [['2026-09-22', '2026-11-07']]);
  assert.equal(extraFxNeedsPull({ pulledAt: '2026-11-06T20:00:00Z', through: '2026-11-06', rates: {} }, now), false);
  assert.equal(extraFxNeedsPull(undefined, now), true);
  assert.match(extraFxUrl('PEN', '2026-09-01', '2026-10-31'), /PD04638PD\/json\/2026-09-01\/2026-10-31$/);
  assert.match(extraFxUrl('ARS', '2026-09-01', '2026-09-10'), /Cotizaciones\/USD\?fechadesde=2026-09-01&fechahasta=2026-09-10/);
});

test('daily series: the ECB wins where it publishes; PEN, COP and ARS come from their own central bank otherwise', () => {
  const extra: FxExtraFile = readFxExtraFile({ version: 1, currencies: { PEN: { pulledAt: '2026-11-07T00:00:00Z', through: '2026-11-07', rates: { '2026-10-30': 3.46, '2026-09-01': 3.37 } } } });
  const ecb = { version: 1 as const, chunks: { '2026-Q3': { pulledAt: '2026-10-08T00:00:00Z', rates: { '2026-09-01': { BRL: 5.4 } } } } };
  const pen = fxDailySeries(ecb, 'PEN', extra);
  assert.ok('points' in pen);
  assert.equal(pen.points[0].date, '2026-09-01');
  assert.match(pen.source || '', /Banco Central de Reserva del Perú/);
  assert.equal(extraFxDailySeries(extra, 'BRL'), null);
  // Not downloaded yet: the reason names the source to come.
  const cop = fxDailySeries(ecb, 'COP', extra);
  assert.ok('reason' in cop);
  assert.match(cop.reason, /ECB publishes no reference rate for COP, and the TRM \(Superintendencia Financiera de Colombia\) daily rate has not been downloaded yet/);
  const egp = fxDailySeries(ecb, 'EGP', extra);
  assert.ok('reason' in egp && egp.reason === 'The ECB publishes no reference rate for EGP');
});
