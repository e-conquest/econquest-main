import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idsUrl, parseIds, parseQeds, qedsUrl, quarterKey, QEDS_GG_BUCKETS } from '../src/utils/debtSchedule.ts';
import { bankerBrief, buildBankerSections } from '../src/utils/bankerNote.ts';
import { buildBaselineOpenData } from '../src/data/presetsAndBaselines.ts';
import type { CouncilAssessmentRun } from '../src/types/council.ts';

const NOW = new Date('2026-11-04T12:00:00Z');
const row = (code: string, date: string, value: number | null) => ({ indicator: { id: code }, date, value });
const qedsRows = (date: string, values: Array<number | null>) => QEDS_GG_BUCKETS.map((b, i) => row(b.code, date, values[i]));
const qedsAnswer = (date: string, values: Array<number | null>) => [{ page: 1 }, qedsRows(date, values)];

test('URLs: QEDS asks source 22 for the four buckets, IDS asks source 6 with the World counterpart', () => {
  const q = qedsUrl('BRA');
  assert.match(q, /\/country\/BRA\/indicator\/DT\.AMT\.DECT\.CD\.GG\.03;.*GG\.0912\?source=22/);
  assert.match(idsUrl('TUR'), /\/sources\/6\/country\/TUR\/series\/DT\.AMT\.DPPG\.CD;DT\.TDS\.DPPG\.CD\/counterpart-area\/WLD\/time\/all/);
});

test('quarter keys are read in the forms the API uses, anything else refused', () => {
  assert.equal(quarterKey('2026Q2'), '2026Q2');
  assert.equal(quarterKey('YR2026Q2'), '2026Q2');
  assert.equal(quarterKey('2026-Q2'), '2026Q2');
  assert.equal(quarterKey('2026'), null);
});

test('QEDS: the latest quarter with all four buckets is used, in US$ bn', () => {
  const json = [{ page: 1 }, [...qedsRows('2026Q2', [1e9, 2e9, 3e9, 4e9]), ...qedsRows('2026Q3', [5e9, 0, 0, 0]).slice(0, 2)]];
  const q = parseQeds(json)!;
  assert.equal(q.asOf, '2026Q2'); // Q3 has only two buckets, so it is skipped
  assert.deepEqual(q.buckets.map((b) => b.usdBn), [1, 2, 3, 4]);
  assert.equal(q.next12mUsdBn, 10);
});

test('QEDS: an error answer, blanks or negative values give nothing rather than a guess', () => {
  assert.equal(parseQeds([{ message: [{ id: '120', value: 'Invalid value' }] }]), null);
  assert.equal(parseQeds(qedsAnswer('2026Q2', [1e9, null, 3e9, 4e9])), null);
  assert.equal(parseQeds(qedsAnswer('2026Q2', [1e9, -2e9, 3e9, 4e9])), null);
});

const idsRec = (series: string, year: number, value: number, cp = 'WLD') => ({
  variable: [
    { concept: 'Country', id: 'BRA' },
    { concept: 'Series', id: series },
    { concept: 'Counterpart-Area', id: cp },
    { concept: 'Time', id: `YR${year}` },
  ],
  value,
});

test('IDS: projection years from the current year on, World counterpart only', () => {
  const json = {
    source: {
      data: [
        idsRec('DT.TDS.DPPG.CD', 2024, 30e9),
        idsRec('DT.TDS.DPPG.CD', 2027, 19115681009.9),
        idsRec('DT.AMT.DPPG.CD', 2027, 9819134580.6),
        idsRec('DT.TDS.DPPG.CD', 2027, 1e9, 'USA'),
        idsRec('DT.TDS.DPPG.CD', 2030, 49468239029.8),
      ],
    },
  };
  const ids = parseIds(json, 2026)!;
  assert.deepEqual(ids.years.map((y) => y.year), [2027, 2030]);
  assert.equal(ids.years[0].debtServiceUsdBn!.toFixed(1), '19.1');
  assert.equal(ids.years[0].principalUsdBn!.toFixed(1), '9.8');
});

test('IDS: two World values for one year (per-creditor rows mixed in) are refused', () => {
  const json = { source: { data: [idsRec('DT.TDS.DPPG.CD', 2027, 1e9), idsRec('DT.TDS.DPPG.CD', 2027, 2e9)] } };
  assert.equal(parseIds(json, 2026), null);
});

function run(withSchedule: boolean): CouncilAssessmentRun {
  const openData = buildBaselineOpenData('BRA');
  openData.dataStatus = { verifiedLiveSources: [], checkedAt: NOW.toISOString() };
  if (withSchedule)
    openData.debtSchedule = {
      qeds: { asOf: '2026Q2', buckets: QEDS_GG_BUCKETS.map((b, i) => ({ label: b.label, usdBn: [3, 2, 5, 1][i] })), next12mUsdBn: 11 },
      ids: { years: [{ year: 2027, principalUsdBn: 9.8, debtServiceUsdBn: 19.1 }] },
      fetchedAt: NOW.toISOString(),
    };
  return { iso3: 'BRA', countryName: 'Brazil', openData } as unknown as CouncilAssessmentRun;
}

test('banker brief: with QEDS and IDS the figures are official and named; without, they read Missing', () => {
  const b = bankerBrief(run(true), [], NOW);
  const need = b.groups.find((g) => g.title === 'Financing need')!;
  const due = need.rows.find((r) => r.label === 'Government external debt due, next 12 months')!;
  assert.equal(due.value, '$11.0 bn');
  assert.ok(due.verified && /QEDS \(World Bank\/IMF\), as of end of Q2 2026/.test(due.source));
  assert.ok(need.rows.some((r) => r.label === 'Public external debt service, 2027' && r.verified && /IDS/.test(r.source)));
  assert.ok(need.rows.some((r) => r.label === 'Full maturity profile, incl. domestic debt' && r.value === 'Missing'));
  assert.match(b.headline, /\$11\.0 bn of government external debt due in 12 months/);
  assert.ok(b.judgements.some((j) => /12 months from the end of Q2 2026 is \$11\.0 bn .*heaviest quarter is 6 to 9 months ahead \(\$5\.0 bn\)/.test(j)));

  const plain = bankerBrief(run(false), [], NOW);
  assert.doesNotMatch(plain.headline, /due in 12 months/);
  assert.equal(plain.groups.find((g) => g.title === 'Financing need')!.rows.find((r) => r.label === 'Government external debt due, next 12 months')!.value, 'Missing');
  assert.ok(!plain.groups.find((g) => g.title === 'Financing need')!.rows.some((r) => r.verified));
});

test('issuer note carries the QEDS and IDS lines with their sources', () => {
  const text = JSON.stringify(buildBankerSections(run(true), [], () => true, NOW));
  assert.match(text, /QEDS \(World Bank\/IMF\)/);
  assert.match(text, /World Bank IDS projection/);
});
