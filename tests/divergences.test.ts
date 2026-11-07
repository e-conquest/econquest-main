import { test } from 'node:test';
import assert from 'node:assert/strict';
import { policySignal, rankDivergences, realYieldSignals, refinancingSignal } from '../src/utils/divergences.ts';
import type { WatchlistItem } from '../src/types/council.ts';

const it = (iso3: string, o: Partial<WatchlistItem> = {}): WatchlistItem =>
  ({ iso3, countryName: iso3, cds5YBps: 150, yield10YPct: 8, ...o }) as WatchlistItem;

test('policy: tight with inflation near target is room to cut; loose with inflation above is behind the curve', () => {
  const zaf = policySignal(it('ZAF', { policyRatePct: 8, cpiInflationPct: 3.4, cpiSource: 'live', policyRateSource: 'ai_estimate' }))!;
  assert.equal(zaf.label, 'Room to cut');
  assert.equal(zaf.quality, 'estimate'); // the weaker of the two figures
  assert.match(zaf.headline, /Real policy rate 4\.6% with inflation 0\.4 pts above target/);
  const tur = policySignal(it('TUR', { policyRatePct: 30, cpiInflationPct: 34 }))!;
  assert.equal(tur.label, 'Behind the curve');
  assert.equal(tur.quality, 'sample');
  assert.equal(policySignal(it('POL', { policyRatePct: 4, cpiInflationPct: 2.8 })), null); // nothing to flag
  assert.equal(policySignal(it('POL')), null); // no figures, no signal
});

test('real yield: flagged only 2+ pts from the median, and needs 4 countries', () => {
  const xs = [it('A', { yield10YPct: 6, cpiInflationPct: 3 }), it('B', { yield10YPct: 7, cpiInflationPct: 3.5 }), it('C', { yield10YPct: 6.5, cpiInflationPct: 3 }), it('D', { yield10YPct: 15, cpiInflationPct: 4 })];
  const m = realYieldSignals(xs);
  assert.deepEqual([...m.keys()], ['D']);
  assert.equal(m.get('D')!.label, 'High real yield');
  assert.equal(realYieldSignals(xs.slice(0, 3)).size, 0);
});

test('refinancing: 10% or more of international bonds due within a year', () => {
  assert.equal(refinancingSignal(it('IDN', { intlBondsUsdBn: 88, intlBondsDue1yUsdBn: 3.6 })), null);
  const r = refinancingSignal(it('EGY', { intlBondsUsdBn: 40, intlBondsDue1yUsdBn: 8, intlBondsAsOf: '2026-Q2' }))!;
  assert.equal(r.quality, 'live');
  assert.match(r.headline, /\$8\.0bn of \$40\.0bn .* \(20%\)/);
});

test('ranking: sorted by gap times data quality; one line per country with catalyst and change', () => {
  const xs = [
    it('ZAF', { policyRatePct: 8, cpiInflationPct: 3.4, cpiSource: 'live', policyRateSource: 'ai_estimate', yield10YPct: 8.7, yield10YSource: 'official', yield10YPeriod: '2026-09' }),
    it('TUR', { policyRatePct: 30, cpiInflationPct: 33, yield10YPct: 28 }),
    it('MEX', { policyRatePct: 7, cpiInflationPct: 3.8 }),
  ];
  const rows = rankDivergences(xs, { ZAF: { cds5YBps: 140, yield10YPct: 8.6, yieldSource: 'official' } }, new Date('2026-11-04T12:00:00Z'));
  assert.equal(new Set(rows.map((r) => r.iso3)).size, rows.length);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].top.score >= rows[i].top.score);
  const zaf = rows.find((r) => r.iso3 === 'ZAF')!;
  assert.equal(zaf.change, '10Y +10 bps, CDS +10 bps since your last look');
  assert.ok(zaf.catalyst, 'SARB has official dates');
  assert.equal(rows.find((r) => r.iso3 === 'TUR')!.change, undefined);
});

test('ranking: the same gap ranks higher on live data than on sample data', () => {
  const live = it('ZAF', { policyRatePct: 9, cpiInflationPct: 3, cpiSource: 'live', policyRateSource: 'ai_estimate' });
  const sample = it('CHL', { policyRatePct: 9, cpiInflationPct: 3 });
  const rows = rankDivergences([sample, live]);
  assert.deepEqual(rows.map((r) => r.iso3), ['ZAF', 'CHL']);
  assert.equal(rows[0].top.size, rows[1].top.size);
});
