import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellDate, csvRows, parseGscpiRows, stressIndex, stressWorldSeries } from '../src/utils/stressIndices.ts';
import { PRESETS, FACTORS } from '../src/utils/scenarioEngine.ts';

const months = (n: number) => Array.from({ length: n }, (_, i) => `${1998 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);

test('date cells: Excel serial, ISO, day-month-year, month-year, US slash', () => {
  assert.equal(cellDate('35826'), '1998-01-31');
  assert.equal(cellDate('2026-09-30'), '2026-09-30');
  assert.equal(cellDate('31-Jan-1998'), '1998-01-31');
  assert.equal(cellDate('Jan-1998'), '1998-01-01');
  assert.equal(cellDate('1/31/1998'), '1998-01-31');
  assert.equal(cellDate('GSCPI'), null);
  assert.equal(cellDate('12'), null);
});

test('GSCPI rows: finds the date and index columns past title rows and blank columns', () => {
  const rows: string[][] = [['Global Supply Chain Pressure Index'], [], ['Date', '', 'GSCPI'], ...months(30).map((m, i) => [`${m}-28`, '', String((i - 15) / 10)])];
  const obs = parseGscpiRows(rows);
  assert.equal(obs.length, 30);
  assert.deepEqual(obs[0], { date: '1998-01-01', value: -1.5 });
  assert.equal(obs[29].value, 1.4);
});

test('GSCPI CSV with quoted cells parses; too few rows or wrong numbers give nothing', () => {
  const csv = 'Date,GSCPI\n' + months(26).map((m, i) => `"${m}-28",${(i / 10).toFixed(2)}`).join('\n');
  assert.equal(parseGscpiRows(csvRows(csv)).length, 26);
  assert.deepEqual(parseGscpiRows(csvRows('Date,GSCPI\n1998-01-31,0.5')), []);
  assert.deepEqual(parseGscpiRows(months(30).map((m) => [`${m}-28`, '250000'])), []);
});

test('stress index choice falls back to the St. Louis Fed index', () => {
  assert.equal(stressIndex('nfci').fred, 'NFCI');
  assert.equal(stressIndex('anfci').fred, 'ANFCI');
  assert.equal(stressIndex('nonsense').fred, 'STLFSI4');
  assert.equal(stressIndex(undefined).fred, 'STLFSI4');
});

test('world series: each index or Missing with the reason, never a number', () => {
  const set = stressWorldSeries({ fred: { NFCI: [{ date: '2026-10-30', value: -0.459 }] }, gscpi: { reason: 'The New York Fed GSCPI file is not an .xlsx workbook this app can read' }, fetchedAt: '2026-11-07T17:00:00Z' });
  const nfci = set.find((s) => s.id === 'stress_nfci')!;
  assert.ok('points' in nfci && nfci.points[0].value === -0.459);
  const st = set.find((s) => s.id === 'stress_stlfsi')!;
  assert.ok('reason' in st && /STLFSI4/.test(st.reason));
  const g = set.find((s) => s.id === 'gscpi')!;
  assert.ok('reason' in g && /not an \.xlsx/.test(g.reason));
  assert.ok(stressWorldSeries(null).every((s) => 'reason' in s));
});

test('the scenarios carry a supply chain factor and preset', () => {
  assert.ok(FACTORS.some((f) => f.id === 'supply_chain'));
  assert.deepEqual(PRESETS.find((p) => p.id === 'supply')!.shock, { supply_chain: 1 });
});
