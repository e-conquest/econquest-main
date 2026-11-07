import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CSV_BOM, csvCell, exportFileName, figureRows, FIGURES_HEADER, seriesRows, SERIES_HEADER, toCsv } from '../src/utils/csvExport.ts';
import { buildBaselineOpenData } from '../src/data/presetsAndBaselines.ts';

test('cells: numbers plain, text quoted when needed, missing values empty, formulas kept as text', () => {
  assert.equal(csvCell(4.58), '4.58');
  assert.equal(csvCell(-2.3), '-2.3');
  assert.equal(csvCell(Number.NaN), '');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell('World Bank, 2024'), '"World Bank, 2024"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('2026-09'), '2026-09');
});

test('a file starts with the byte order mark and uses CRLF rows', () => {
  const csv = toCsv(['a', 'b'], [[1, 'x']]);
  assert.ok(csv.startsWith(CSV_BOM));
  assert.equal(csv, `${CSV_BOM}a,b\r\n1,x\r\n`);
});

test('series rows are long format with unit, source and the source that day', () => {
  const rows = seriesRows('BRA', [
    { id: 'debt_gdp', label: 'Government debt', unit: '% of GDP', freq: 'per pull', source: 'Saved pulls', points: [{ date: '2026-11-05', value: 78.1, note: 'IMF WEO' }] },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].length, SERIES_HEADER.length);
  assert.deepEqual(rows[0], ['BRA', 'debt_gdp', 'Government debt', '% of GDP', 'per pull', '2026-11-05', 78.1, 'Saved pulls', 'IMF WEO', '']);
});

test('figures: live values with source and period; everything else Missing with a reason and no number', () => {
  const s = buildBaselineOpenData('MEX');
  s.liveFields = { 'market.sovereign10YBondYieldPct': 'Official' };
  s.monetaryAndMarket.sovereign10YBondYieldPct = 9.35;
  s.official10YYield = { valuePct: 9.35, period: '2026-09' } as any;
  const rows = figureRows(s);
  for (const r of rows) assert.equal(r.length, FIGURES_HEADER.length);
  const y = rows.find((r) => r[2] === 'market.sovereign10YBondYieldPct')!;
  assert.deepEqual([y[4], y[6], y[7], y[8]], [9.35, 'Live', '2026-09', 'Official']);
  const others = rows.filter((r) => r !== y);
  assert.ok(others.length > 5);
  for (const r of others) {
    assert.equal(r[4], null, String(r[2]));
    assert.equal(r[6], 'Missing');
    assert.ok(String(r[9]).length > 0, String(r[2]));
  }
});

test('file names carry the country, what it is and the date', () => {
  assert.equal(exportFileName('BRA', 'series', new Date('2026-11-05T12:00:00Z')), 'BRA-series-2026-11-05.csv');
  assert.equal(exportFileName('../x', 'a b', new Date('2026-11-05T12:00:00Z')), 'x-ab-2026-11-05.csv');
});
