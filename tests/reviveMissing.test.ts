import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviveMissing, reviveWatchlistGroups } from '../src/utils/reviveMissing.ts';
import { buildBaselineOpenData, SOVEREIGN_CATALOG } from '../src/data/presetsAndBaselines.ts';

test('a snapshot sent as JSON comes back with NaN, not null, for missing figures', () => {
  const s = buildBaselineOpenData('BRA');
  s.imfIndicators.debtToGdpPct = 80;
  const back = reviveMissing(JSON.parse(JSON.stringify(s)), buildBaselineOpenData('BRA'));
  assert.equal(back.imfIndicators.debtToGdpPct, 80);
  assert.ok(Number.isNaN(back.imfIndicators.cpiInflationPct));
  assert.ok(Number.isNaN(back.monetaryAndMarket.cds5YSpreadBps));
  assert.equal(back.imfIndicators.sourceUrl, s.imfIndicators.sourceUrl);
  assert.deepEqual(back.polymarketContracts, []);
});

test('watchlist rows read back from browser storage get NaN for missing figures', () => {
  const groups = [{ id: 'g', name: 'G', items: SOVEREIGN_CATALOG.slice(0, 2) }];
  const back = reviveWatchlistGroups(JSON.parse(JSON.stringify(groups)) as typeof groups);
  assert.ok(Number.isNaN(back[0].items[0].debtToGdpPct));
  assert.equal(back[0].items[0].iso3, 'BRA');
});

test('the country list carries no built-in figures', () => {
  for (const c of SOVEREIGN_CATALOG) {
    for (const k of ['yield10YPct', 'cds5YBps', 'debtToGdpPct', 'fxReservesMonths'] as const) {
      assert.ok(Number.isNaN(c[k]), `${c.iso3} ${k}`);
    }
  }
});
