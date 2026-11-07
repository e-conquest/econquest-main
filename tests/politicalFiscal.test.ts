import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OFFICIAL_CALENDAR, POLITICAL_FISCAL_CATEGORIES, dateKindLabel, hasOfficialSchedule, upcomingOfficialEvents } from '../src/data/officialCalendar.ts';
import { rankDivergences } from '../src/utils/divergences.ts';
import type { WatchlistItem } from '../src/types/council.ts';

const pf = OFFICIAL_CALENDAR.filter((e) => POLITICAL_FISCAL_CATEGORIES.includes(e.category));

test('elections, budgets and IMF dates each carry a source; budgets are labelled as legal deadlines', () => {
  assert.ok(pf.length >= 7);
  for (const e of pf) {
    assert.ok(e.sourceUrl.startsWith('https://') && e.sourceName, `${e.iso3} ${e.title}`);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
    if (e.category === 'BUDGET') assert.equal(dateKindLabel(e), 'latest date in law', e.iso3);
  }
  const by = (iso: string, cat: string) => pf.find((e) => e.iso3 === iso && e.category === cat)!;
  assert.equal(by('MEX', 'BUDGET').date, '2027-09-08');
  assert.equal(by('TUR', 'BUDGET').date, '2027-10-18'); // 75 days before 1 Jan 2028
  assert.equal(by('EGY', 'BUDGET').date, '2027-04-02'); // 90 days before 1 Jul 2027
  assert.equal(by('EGY', 'IMF_PROGRAMME').date, '2026-12-15');
  assert.equal(by('EGY', 'IMF_PROGRAMME').primarySource, false); // a newspaper, said so
  assert.equal(pf.some((e) => e.iso3 === 'BRA'), false); // source not read, so not listed
});

test('an election date alone does not count as a central bank schedule', () => {
  assert.equal(hasOfficialSchedule('EGY'), false);
  assert.equal(hasOfficialSchedule('ZAF'), true);
});

test('non-policy gaps point at the next election, budget or IMF date', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  assert.ok(upcomingOfficialEvents(['EGY'], 60, now).some((e) => e.category === 'IMF_PROGRAMME'));
  const it = (iso3: string, o: Partial<WatchlistItem>) => ({ iso3, countryName: iso3, compositeRisk: 0.5, cds5YBps: 150, yield10YPct: 8, ...o }) as WatchlistItem;
  const rows = rankDivergences([it('EGY', { intlBondsUsdBn: 40, intlBondsDue1yUsdBn: 8 })], null, now);
  assert.equal(rows[0].catalyst?.title, 'IMF EFF arrangement ends; final review due before');
});
