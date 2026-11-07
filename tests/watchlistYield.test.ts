import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchlistYieldFields, yieldSourceNote } from '../src/utils/watchlistYield.ts';
import { buildBaselineOpenData } from '../src/data/presetsAndBaselines.ts';
import type { OpenDataSnapshot } from '../src/types/council.ts';

const snap = (sources: string[], extra: Partial<OpenDataSnapshot> = {}): OpenDataSnapshot => ({
  ...buildBaselineOpenData('MEX'),
  ...extra,
  dataStatus: { verifiedLiveSources: sources, checkedAt: '2026-11-04T12:00:00Z' },
});

const fred = { valuePct: 8.91, period: '2026-09', source: 'OECD via FRED', seriesId: 'IRLTLT01MXM156N', url: 'u', frequency: 'monthly' as const };
const brazil = { valuePct: 15.29, period: '2026-10-30', source: 'Brazil Treasury', seriesId: 'NTN-F 2037', url: 'u', frequency: 'daily' as const };

test('a sample snapshot with no official figure stays labelled sample', () => {
  const s = snap([]);
  const f = watchlistYieldFields(s);
  assert.equal(f.yield10YSource, 'sample');
  assert.equal(f.yield10YPct, s.monetaryAndMarket.sovereign10YBondYieldPct);
  assert.equal(yieldSourceNote(f), 'Sample');
});

test('an official figure fetched for the watchlist replaces the sample value', () => {
  const f = watchlistYieldFields(snap([]), fred);
  assert.deepEqual(f, { yield10YPct: 8.91, yield10YSource: 'official', yield10YPeriod: '2026-09', yield10YFrequency: 'monthly' });
  assert.equal(yieldSourceNote(f), 'Official, Sep 2026 avg');
});

test('the official figure on the snapshot counts only if its feed answered', () => {
  const answered = watchlistYieldFields(snap(['FRED / OECD 10Y government yield (monthly average)'], { official10YYield: fred }));
  assert.equal(answered.yield10YSource, 'official');
  const stale = watchlistYieldFields(snap(['Gemini web search'], { official10YYield: fred }));
  assert.equal(stale.yield10YSource, 'ai_estimate');
  assert.equal(yieldSourceNote(stale), 'AI estimate');
});

test('a daily rate is dated by day, not called an average', () => {
  assert.equal(yieldSourceNote(watchlistYieldFields(snap([]), brazil)), 'Official, 30 Oct 2026');
});
