/**
 * Caldara-Iacoviello GPR file reading (utils/gprIndex.ts) and the scorecard pillar. Synthetic
 * values in the file's column layout; not the published figures.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gprForCountry, gprMonth, parseGprRows } from '../src/utils/gprIndex.ts';
import { countryRiskScorecard } from '../src/utils/countryRiskScorecard.ts';

test('month cells in the forms the file may carry', () => {
  assert.equal(gprMonth('1985-01-01'), '1985-01');
  assert.equal(gprMonth('2026-09'), '2026-09');
  assert.equal(gprMonth('2026m9'), '2026-09');
  assert.equal(gprMonth('9/1/2026'), '2026-09');
  assert.equal(gprMonth('31048'), '1985-01'); // Excel serial for 1985-01-01
  assert.equal(gprMonth('GPR'), null);
});

const rows = [
  ['month', 'GPR', 'GPRT', 'GPRC_TUR', 'GPRC_ARG', 'var_name'],
  ['2026-06-01', '100', '90', '0.5', '0.1', ''],
  ['2026-07-01', '120', '95', '0.7', '', ''],
  ['2026-08-01', '80', '70', '1.5', '', ''],
  ['2026-09-01', '', '', '', '', ''],
];

test('reads the monthly table by column name; latest non-blank month; percentile among months', () => {
  const t = parseGprRows(rows);
  assert.ok(!('reason' in t));
  if ('reason' in t) return;
  assert.deepEqual(t.months, ['2026-06', '2026-07', '2026-08', '2026-09']);
  assert.ok(!('GPRT' in t.series));
  const tur = gprForCountry(t, 'tur');
  assert.deepEqual(tur.country, { label: 'Geopolitical risk index, country', month: '2026-08', value: 1.5, percentile: 100, mean12: 0.9, meanAll: 0.9 });
  assert.equal(tur.world?.month, '2026-08');
  assert.equal(tur.world?.percentile, 33);
  assert.equal(gprForCountry(t, 'ARG').country?.month, '2026-06');
  assert.match(gprForCountry(t, 'KEN').countryMissing!, /no country index/);
  assert.match((parseGprRows([['a', 'b']]) as { reason: string }).reason, /no header row/);
});

test('scorecard: GPR pillar rows, or the reason it is missing', () => {
  const t = parseGprRows(rows);
  if ('reason' in t) throw new Error(t.reason);
  const sc = countryRiskScorecard({ official: {}, gpr: gprForCountry(t, 'TUR') });
  const g = sc.pillars.find((p) => p.id === 'geopolitical')!;
  assert.equal(g.rows.length, 2);
  assert.match(g.rows[0].context!, /at or above 100% of months on file/);
  const none = countryRiskScorecard({ official: {}, gprMissing: 'no GPR file' }).pillars.find((p) => p.id === 'geopolitical')!;
  assert.deepEqual(none.missing, ['GPR index: no GPR file']);
});
