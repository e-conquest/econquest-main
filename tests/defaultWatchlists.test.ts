import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addNewDefaultWatchlists, DEFAULT_WATCHLISTS, SOVEREIGN_CATALOG } from '../src/data/presetsAndBaselines.ts';
import { FRED_10Y_SERIES } from '../src/utils/officialYields.ts';

const OLD = DEFAULT_WATCHLISTS.filter((g) => g.id !== 'wl_official_yields');

test('Poland and Chile are in the catalog and have a FRED 10Y series', () => {
  for (const iso3 of ['POL', 'CHL']) {
    assert.ok(SOVEREIGN_CATALOG.some((c) => c.iso3 === iso3), iso3);
    assert.ok(FRED_10Y_SERIES[iso3], iso3);
  }
});

test('the official yields group holds only countries with a free official feed', () => {
  const g = DEFAULT_WATCHLISTS.find((w) => w.id === 'wl_official_yields')!;
  const isos = g.items.map((i) => i.iso3);
  assert.deepEqual(isos, ['BRA', 'MEX', 'ZAF', 'POL', 'CHL', 'GBR', 'JPN']);
  for (const iso of isos) assert.ok(iso === 'BRA' || FRED_10Y_SERIES[iso], iso);
});

test('an existing user gets the new group once, appended after their own', () => {
  const custom = { id: 'mine', name: 'Mine', description: '', isCustom: true, items: [] };
  const first = addNewDefaultWatchlists([...OLD, custom], null);
  assert.deepEqual(first.groups.map((g) => g.id).slice(-2), ['mine', 'wl_official_yields']);
  // They delete it: it does not come back.
  const kept = first.groups.filter((g) => g.id !== 'wl_official_yields');
  const second = addNewDefaultWatchlists(kept, first.seen);
  assert.equal(second.groups.some((g) => g.id === 'wl_official_yields'), false);
});

test('a user who removed an original default group does not get it back', () => {
  const r = addNewDefaultWatchlists(OLD.slice(1), null);
  assert.equal(r.groups.some((g) => g.id === OLD[0].id), false);
});
