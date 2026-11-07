import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSnapshotDataStatus } from '../src/utils/dataStatus.ts';
import { buildBaselineOpenData } from '../src/data/presetsAndBaselines.ts';
import type { OpenDataSnapshot } from '../src/types/council.ts';

const withSources = (sources: string[] | null, extra: Partial<OpenDataSnapshot> = {}): OpenDataSnapshot => {
  const s = { ...buildBaselineOpenData('MEX'), ...extra };
  if (sources === null) delete (s as Partial<OpenDataSnapshot>).dataStatus;
  else s.dataStatus = { verifiedLiveSources: sources, checkedAt: '2026-11-04T12:00:00Z' };
  return s;
};

test('the built-in sample is never called live', () => {
  const s = getSnapshotDataStatus(withSources([]));
  assert.equal(s.mode, 'sample');
  assert.equal(s.marketSource, 'sample');
  assert.equal(s.yieldSource, 'sample');
});

test('a snapshot with no recorded feeds is unverified', () => {
  assert.equal(getSnapshotDataStatus(withSources(null)).mode, 'unverified');
});

test('live needs both IMF and World Bank', () => {
  assert.equal(getSnapshotDataStatus(withSources(['IMF DataMapper WEO', 'World Bank Open Data v2'])).mode, 'live');
  assert.equal(getSnapshotDataStatus(withSources(['IMF DataMapper WEO'])).mode, 'partial');
});

test('yield source: official beats AI estimate only when FRED answered', () => {
  const official = { valuePct: 9.35, period: '2026-09', source: 'OECD via FRED', seriesId: 'S', url: 'u' };
  const both = getSnapshotDataStatus(
    withSources(['Gemini web search', 'FRED / OECD 10Y government yield (monthly average)'], { official10YYield: official })
  );
  assert.equal(both.yieldSource, 'official');
  assert.equal(both.yieldPeriod, '2026-09');
  assert.equal(getSnapshotDataStatus(withSources(['Gemini web search'], { official10YYield: official })).yieldSource, 'ai_estimate');
  assert.equal(getSnapshotDataStatus(withSources(['Gemini web search'])).yieldSource, 'ai_estimate');
});

test('Brazil: a Tesouro Direto daily rate counts as official', () => {
  const obs = { valuePct: 15.29, period: '2026-10-30', source: 'Brazil Treasury, Tesouro Direto', seriesId: 'NTN-F 2037', url: 'u', frequency: 'daily' as const };
  const s = getSnapshotDataStatus(withSources(['Tesouro Direto (Brazil) NTN-F daily rate'], { official10YYield: obs }));
  assert.equal(s.yieldSource, 'official');
  assert.equal(s.officialYield?.frequency, 'daily');
});

test('offline, a snapshot that was live when saved reads Saved data, never Live data', async () => {
  const { dataBadgeText } = await import('../src/utils/dataStatus.ts');
  assert.equal(dataBadgeText('live', false, 'Nov 5, 07:58 PM').label, 'Live data');
  const off = dataBadgeText('live', true, 'Nov 5, 07:58 PM');
  assert.equal(off.label, 'Saved data');
  assert.equal(off.saved, true);
  assert.match(off.help, /cannot be reached.*saved on Nov 5, 07:58 PM/);
  assert.equal(dataBadgeText('partial', true, '').label, 'Saved data');
  // Nothing was live: offline changes nothing, it still says so.
  assert.equal(dataBadgeText('sample', true, '').label, 'No live data');
});
