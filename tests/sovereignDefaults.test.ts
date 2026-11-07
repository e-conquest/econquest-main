import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bocBoeEditions, bocBoeUrl, defaultSpells, defaultSpellsSentence, parseBocBoeCsv, sovereignDefaultSeries } from '../src/utils/sovereignDefaults.ts';
import { countrySeries } from '../src/utils/seriesHistory.ts';

// Shaped like the Valet CSV of 2026-11-07 (metadata block, then OBSERVATIONS; a subset of the
// columns). World 2025 total, Angola 2003 total and the empty Algeria 2020 row are live values;
// the other Angola years are made up for the spell test.
const CSV = `"TERMS AND CONDITIONS"
"https://www.bankofcanada.ca/terms/"

"NAME"
"Debt data 2026"

"OBSERVATIONS"
"k","DEBT_COUNTRY","DEBT_COUNTRY_GROUP","DEBT_YEAR","DEBT_TOTAL_2026","DEBT_IMF_2026","DEBT_PARIS_CLUB_2026","DEBT_CHINA_2026","DEBT_FC_BANK_LOANS_2026","DEBT_FC_BONDS_2026","DEBT_LC_DEBT_2026","DEBT_GROSS_WORLD_PRODUCT_2026"
"WORLD_2025","World","World","2025","437196.80","","","","","197233.00","474.00","118175.00"
"AGO_2001","Angola","Other developing countries","2001","","","","","","","",""
"AGO_2002","Angola","Other developing countries","2002","2100.00","","1500.00","","600.00","","",""
"AGO_2003","Angola","Other developing countries","2003","1872.24","","1400.00","","472.24","","",""
"AGO_2004","Angola","Other developing countries","2004","","","","","","","",""
"AGO_2006","Angola","Other developing countries","2006","50.00","","50.00","","","","",""
"DZA_2020","Algeria","Other developing countries","2020","","","","","","","",""`;

test('BoC-BoE default database: per-country rows, empty = 0, World rows skipped, US$ m', () => {
  assert.equal(bocBoeUrl(2026), 'https://www.bankofcanada.ca/valet/observations/group/DEBT_2026/csv');
  assert.deepEqual(bocBoeEditions(new Date('2027-11-01T00:00:00Z')), [2027, 2026]);
  const d = parseBocBoeCsv(CSV, 2026, '2026-11-07T16:00:00Z')!;
  assert.deepEqual(Object.keys(d.countries).sort(), ['AGO', 'DZA']);
  assert.deepEqual(d.span, { from: 2001, to: 2020 });
  assert.equal(d.countries.AGO['2003'].TOTAL, 1872.24);
  assert.equal(d.countries.AGO['2001'].TOTAL, 0);
  assert.equal(d.countries.DZA['2020'].FC_BONDS, 0);
  const s = sovereignDefaultSeries('AGO', d);
  const total = s.find((x) => x.id === 'default_total_usd');
  assert.ok(total && 'points' in total && total.unit === 'USD m' && total.freq === 'annual');
  assert.deepEqual(total.points.map((p) => p.value), [0, 2100, 1872.24, 0, 50]);
  assert.match(total.about || '', /In default in 2002-2003, 2006 \(BoC-BoE database, 2026 edition\)/);
  assert.deepEqual(defaultSpells('AGO', d), [{ from: 2002, to: 2003, peakUsdM: 2100 }, { from: 2006, to: 2006, peakUsdM: 50 }]);
  assert.match(defaultSpellsSentence(defaultSpells('DZA', d), 2026), /No default recorded/);
  assert.ok(sovereignDefaultSeries('DEU', d).every((x) => 'reason' in x && /Not in the BoC-BoE/.test(x.reason)));
  assert.ok(sovereignDefaultSeries('AGO', null).every((x) => 'reason' in x && /not answered yet/.test(x.reason)));
  // Wrong edition suffix or no observations block: not understood, not guessed.
  assert.equal(parseBocBoeCsv(CSV, 2027, 'x'), null);
  assert.equal(parseBocBoeCsv('<html>', 2026, 'x'), null);
});

test('country series include the default history', () => {
  const set = countrySeries('AGO', { sovereignDefaults: parseBocBoeCsv(CSV, 2026, '2026-11-07T16:00:00Z') });
  assert.ok(set.series.some((s) => s.id === 'default_total_usd' && /BoC-BoE/.test(s.source)));
});
