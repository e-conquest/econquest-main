import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyRevisions, mergeRevisions, officialSeries, OFFICIAL_FIGURES, KEEP_REVISIONS, type OfficialHistoryFile } from '../src/utils/officialHistory.ts';

const debt = OFFICIAL_FIGURES.find((f) => f.id === 'debt_gdp')!;
const file = (pulledAt: string, points: Array<[string, number]>, extra: Partial<OfficialHistoryFile> = {}): OfficialHistoryFile => ({
  iso3: 'BRA',
  pulledAt,
  series: { debt_gdp: { points: points.map(([date, value]) => ({ date, value })) } },
  ...extra,
});

test('a changed year is a revision with the old value; new years and rounding are not', () => {
  const prev = file('2026-10-01T00:00:00Z', [['2023', 84.0], ['2024', 87.1], ['2025', 88.0], ['2026', 90.2]]);
  const next = file('2026-11-06T00:00:00Z', [['2023', 84.0001], ['2024', 87.6], ['2025', 88.0], ['2026', 91.0], ['2027', 92.5]]);
  const r = historyRevisions(prev, next).debt_gdp;
  assert.deepEqual(r.map((x) => [x.date, x.from, x.to, Boolean(x.projection)]), [
    ['2024', 87.1, 87.6, false],
    ['2026', 90.2, 91.0, true],
  ]);
  assert.equal(r[0].prevPulledAt, '2026-10-01T00:00:00Z');
  assert.equal(r[0].seenAt, '2026-11-06T00:00:00Z');
});

test('a year the source dropped is kept with its old value; first download has no revisions', () => {
  const prev = file('2026-10-01T00:00:00Z', [['2023', 84], ['2024', 87.1]]);
  const next = file('2026-11-06T00:00:00Z', [['2024', 87.1]]);
  assert.deepEqual(historyRevisions(prev, next).debt_gdp, [{ date: '2023', from: 84, seenAt: '2026-11-06T00:00:00Z', prevPulledAt: '2026-10-01T00:00:00Z' }]);
  assert.deepEqual(historyRevisions(null, next), {});
});

test('revisions add up across downloads, newest kept', () => {
  const many = Array.from({ length: KEEP_REVISIONS + 5 }, (_, i) => ({ date: String(1700 + i), from: 1, to: 2, seenAt: 'x', prevPulledAt: 'y' }));
  const merged = mergeRevisions({ debt_gdp: many.slice(0, 10) }, { debt_gdp: many.slice(10) })!;
  assert.equal(merged.debt_gdp.length, KEEP_REVISIONS);
  assert.equal(merged.debt_gdp.at(-1)!.date, String(1700 + KEEP_REVISIONS + 4));
  assert.equal(mergeRevisions(undefined, {}), undefined);
});

test('the History series says "Revised from X on date" on the revised year', () => {
  const f = file('2026-11-06T00:00:00Z', [['2023', 84], ['2024', 87.6]], {
    revisions: { debt_gdp: [{ date: '2024', from: 87.1, to: 87.4, seenAt: '2026-10-01T00:00:00Z', prevPulledAt: 'a' }, { date: '2024', from: 87.4, to: 87.6, seenAt: '2026-11-06T00:00:00Z', prevPulledAt: 'b' }] },
  });
  const s = officialSeries(f, debt, new Date('2026-11-06T00:00:00Z'));
  assert.ok('points' in s);
  assert.equal(s.points.find((p) => p.date === '2024')!.revised, 'Revised from 87.4 on 2026-11-06');
  assert.equal(s.points.find((p) => p.date === '2023')!.revised, undefined);
  assert.match(s.about || '', /1 year revised by the source/);
});
