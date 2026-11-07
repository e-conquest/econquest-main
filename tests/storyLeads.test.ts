import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordLead, revisionLeads, storyLeads, type LeadSeries } from '../src/utils/storyLeads.ts';

const NOW = new Date('2026-11-06T00:00:00Z');
const years = (from: number, vals: number[]) => vals.map((value, i) => ({ date: String(from + i), value }));
const S = (id: string, unit: string, points: LeadSeries['points'], revisions: LeadSeries['revisions'] = []): LeadSeries => ({ id, label: id, unit, source: 'IMF WEO', points, revisions });

test('a record on file or a high since a decade back is a lead; a short or stale one is not', () => {
  const debt = S('debt_gdp', '% of GDP', years(2000, [40, 42, 45, 50, 48, 47, 46, 45, 44, 43, 42, 41, 40, 50, 52, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 70]));
  const r = recordLead('TUR', 'Turkey', debt, NOW)!;
  assert.equal(r.kind, 'record');
  assert.match(r.text, /70% of GDP in 2025, the highest on record \(since 2000\)/);
  // Highest since 2003 (22 years back) but not on record.
  const since = S('x', '%', years(2000, [40, 42, 45, 90, 48, 47, 46, 45, 44, 43, 42, 41, 40, 50, 52, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 70]));
  assert.match(recordLead('TUR', 'Turkey', since, NOW)!.text, /highest since 2003/);
  // Highest since only 5 years back: not a lead.
  const recent = S('x', '%', years(2000, [...Array(20).fill(50), 75, 60, 61, 62, 63, 70]));
  assert.equal(recordLead('TUR', 'Turkey', recent, NOW), null);
  // Too few observations, or the latest year too old.
  assert.equal(recordLead('TUR', 'Turkey', S('x', '%', years(2020, [1, 2, 3, 4, 5, 9])), NOW), null);
  assert.equal(recordLead('TUR', 'Turkey', S('x', '%', years(1990, [...Array(20).fill(1), 9])), NOW), null);
  // IMF projections do not make a record.
  const proj = S('x', '%', [...years(2000, Array(26).fill(10)), { date: '2026', value: 99, note: 'IMF projection' }]);
  assert.equal(recordLead('TUR', 'Turkey', proj, NOW), null);
});

test('recent large revisions are leads; small, old and projected ones are not', () => {
  const rev = (date: string, from: number, to: number, seenAt: string, projection = false) => ({ date, from, to, seenAt, prevPulledAt: '2026-01-01', ...(projection ? { projection } : {}) });
  const s = S('gdp_growth', '%', years(2020, [1, 2, 3]), [
    rev('2024', 3.1, 2.2, '2026-10-20T00:00:00Z'),
    rev('2023', 3.0, 3.2, '2026-10-20T00:00:00Z'),
    rev('2022', 3.0, 5.0, '2026-08-01T00:00:00Z'),
    rev('2026', 3.0, 1.0, '2026-10-20T00:00:00Z', true),
  ]);
  const l = revisionLeads('BRA', 'Brazil', s, NOW);
  assert.equal(l.length, 1);
  assert.match(l[0].text, /2024 was revised from 3\.1% to 2\.2% \(-0\.9 points\)/);
  const lvl = S('reserves', 'US$ bn', years(2020, [1, 2, 3]), [rev('2024', 100, 106, '2026-10-30T00:00:00Z'), rev('2023', 100, 103, '2026-10-30T00:00:00Z')]);
  assert.deepEqual(revisionLeads('BRA', 'Brazil', lvl, NOW).map((x) => x.text), ['reserves for 2024 was revised from 100 US$ bn to 106 US$ bn (+6%).']);
});

test('leads for many countries are ordered records on record first', () => {
  const onRecord = S('a', '%', years(2000, [...Array(25).fill(1), 5]));
  const since = S('b', '%', years(2000, [9, ...Array(24).fill(1), 5]));
  const out = storyLeads([{ iso3: 'TUR', countryName: 'Turkey', series: [since] }, { iso3: 'BRA', countryName: 'Brazil', series: [onRecord] }], NOW);
  assert.deepEqual(out.map((l) => l.iso3), ['BRA', 'TUR']);
});
