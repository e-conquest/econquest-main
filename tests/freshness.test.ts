import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysOld, describeAge, freshnessChecks, fresherCpi, monthsOld, staleFigures, type DatedItem } from '../src/utils/freshness.ts';
import { datedNotes } from '../src/utils/askCouncil.ts';
import type { LiveWatchlistItem } from '../src/types/council.ts';

const NOW = new Date('2026-11-05T12:00:00Z');

test('ages count calendar months and days up to today', () => {
  assert.equal(monthsOld('2026-09', NOW), 2);
  assert.equal(monthsOld('2026-09-30', NOW), 2);
  assert.equal(monthsOld('2026-Q2', NOW), 5, 'a quarter counts from its last month');
  assert.equal(monthsOld('2025-12', NOW), 11);
  assert.equal(monthsOld('soon', NOW), null);
  assert.equal(daysOld('2026-11-01', NOW), 4);
  assert.equal(daysOld('2026-11', NOW), null);
});

test('a monthly CPI two months back is normal; five months back via DBnomics is flagged with the fresher source', () => {
  const fine = freshnessChecks({ iso3: 'POL', cpiMonth: '2026-09', cpiSource: 'oecd' } as DatedItem, NOW);
  assert.equal(fine.length, 1);
  assert.equal(fine[0].stale, false);
  assert.equal(fine[0].why, undefined, 'no reason given when nothing is wrong');

  const [old] = freshnessChecks({ iso3: 'POL', cpiMonth: '2026-06', cpiSource: 'oecd', oecdCpi: { iso3: 'POL', month: '2026-06', yoyPct: 3, basis: 'oecd_yoy' } } as DatedItem, NOW);
  assert.equal(old.stale, true);
  assert.equal(old.age, 5);
  assert.match(old.why || '', /DBnomics/);
  assert.match(old.fresher || '', /Eurostat/);
  assert.equal(describeAge(old), '5 months old (usually 2 at most)');
});

test('daily and weekly figures are judged in days', () => {
  const checks = freshnessChecks(
    {
      iso3: 'MEX',
      yield10YPeriod: '2026-10-20',
      yield10YFrequency: 'daily',
      policyRateDate: '2026-11-03',
      cftc: { reportDate: '2026-10-27' },
    } as DatedItem,
    NOW
  );
  const by = Object.fromEntries(checks.map((c) => [c.id, c]));
  assert.equal(by.yield.unit, 'days');
  assert.equal(by.yield.stale, true, '16 days for a daily series');
  assert.equal(by.policy.stale, false);
  assert.equal(by.cftc.stale, false, '9 days for a weekly report');
});

test('figures without a date are not judged, and a missing row gives nothing', () => {
  assert.deepEqual(freshnessChecks({ iso3: 'EGY' } as DatedItem, NOW), []);
  assert.deepEqual(staleFigures(undefined, NOW), []);
});

test('fresher inflation sources are named only where one exists', () => {
  assert.match(fresherCpi('BRA') || '', /IPCA/);
  assert.match(fresherCpi('MEX') || '', /Banxico/);
  assert.equal(fresherCpi('EGY'), undefined);
});

test('the Central Bank Agent says when the inflation it used is older than usual', () => {
  const it = { iso3: 'ZAF', countryName: 'South Africa', cpiMonth: '2026-05', cpiSource: 'oecd' } as unknown as LiveWatchlistItem;
  const notes = datedNotes('cb', [{ iso3: 'ZAF', countryName: 'South Africa', reading: '', figures: [], weight: 0 }], [it], NOW);
  assert.deepEqual(notes, ['South Africa: older than usual, so read with its date: inflation for 2026-05, 6 months old (usually 2 at most)']);
  assert.deepEqual(datedNotes('politics', [{ iso3: 'ZAF', countryName: 'South Africa', reading: '', figures: [], weight: 0 }], [it], NOW), [], 'agents that do not use it stay quiet');
});
