import test from 'node:test';
import assert from 'node:assert/strict';
import { grossFinancingNeed, gfnSentence, GFN_EM_BENCHMARK } from '../src/utils/grossFinancingNeed.ts';

const series = (id: string, pts: Array<[string, number, boolean?]>) => ({
  id,
  label: id,
  unit: '% of GDP',
  freq: 'annual' as const,
  source: `src ${id}`,
  points: pts.map(([date, value, proj]) => ({ date, value, ...(proj ? { note: 'IMF projection' } : {}) })),
});
const now = new Date('2026-11-06T00:00:00Z');

test('GFN: deficit plus IDS external principal over dollar GDP, lower bound', () => {
  const r = grossFinancingNeed({
    overallBalance: series('ob', [['2025', -6], ['2026', -5, true], ['2027', -4, true]]),
    primaryBalance: series('pb', [['2025', -1], ['2026', 0, true], ['2027', 1, true]]),
    gdpUsd: series('gdp', [['2025', 200], ['2026', 210, true], ['2027', 220, true]]),
    schedule: { ids: { years: [{ year: 2026, principalUsdBn: 21 }, { year: 2027, principalUsdBn: 11 }] }, qeds: { asOf: '2026Q2', buckets: [], next12mUsdBn: 10.5 }, fetchedAt: '' },
    now,
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  const y25 = r.years.find((y) => y.year === 2025)!;
  assert.equal(y25.deficit, 6);
  assert.equal(y25.interest, 5);
  assert.equal(y25.gfnLowerBound, undefined); // no IDS principal that year: not totalled
  const y26 = r.years.find((y) => y.year === 2026)!;
  assert.equal(y26.extAmortisation, 10);
  assert.equal(y26.gfnLowerBound, 15);
  assert.equal(y26.projection, true);
  assert.deepEqual(r.peak, { year: 2026, value: 15 });
  assert.equal(r.aboveBenchmark, true);
  assert.equal(r.next12m?.pctGdp, 5);
  assert.match(gfnSentence(r, 'Testland'), new RegExp(`${GFN_EM_BENCHMARK}% of GDP`));
});

test('GFN: Missing with a reason when nothing is saved; parts only without GDP in dollars', () => {
  const none = grossFinancingNeed({ now });
  assert.equal(none.ok, false);
  const parts = grossFinancingNeed({ overallBalance: series('ob', [['2026', -3]]), schedule: { ids: { years: [{ year: 2026, principalUsdBn: 5 }] }, fetchedAt: '' }, now });
  assert.ok(parts.ok);
  if (!parts.ok) return;
  assert.equal(parts.years[0].extAmortisation, undefined);
  assert.equal(parts.peak, undefined);
  assert.match(gfnSentence(parts, 'X'), /cannot be totalled/);
});
