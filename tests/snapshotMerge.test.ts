import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeLastGood, keptLabel } from '../src/utils/snapshotMerge.ts';
import { getSnapshotDataStatus } from '../src/utils/dataStatus.ts';
import { buildBaselineOpenData } from '../src/data/presetsAndBaselines.ts';
import type { OpenDataSnapshot } from '../src/types/council.ts';

const PREV_AT = Date.parse('2026-11-01T08:00:00Z');

function snap(sources: string[], liveFields: Record<string, string>, edit: (s: OpenDataSnapshot) => void = () => {}): OpenDataSnapshot {
  const s = buildBaselineOpenData('BRA');
  s.liveFields = liveFields;
  s.dataStatus = { verifiedLiveSources: sources, checkedAt: '2026-11-05T06:00:00Z' };
  s.liveApiSourcesActive = sources;
  edit(s);
  return s;
}

const good = () =>
  snap(
    ['IMF World Economic Outlook', 'World Bank Open Data', 'GDELT news tone (pulled 2026-10-30)', 'Own CDS data (file, 5Y CDS)'],
    {
      'imf.debtToGdpPct': 'IMF WEO, 2025',
      'wb.fxReservesMonthsImport': 'World Bank, 2024',
      'gdelt.averageTone': 'GDELT, pulled 2026-10-30',
      'market.cds5YSpreadBps': 'Your data, file',
    },
    (s) => {
      s.imfIndicators.debtToGdpPct = 77.7;
      s.imfIndicators.years = { 'imf.debtToGdpPct': '2025' };
      s.worldBankIndicators.fxReservesMonthsImport = 11.1;
      s.gdeltMetrics.averageTone = -2.5;
      s.gdeltPull = { pulledAt: '2026-10-30T00:00:00Z', tone: [] } as any;
      s.monetaryAndMarket.cds5YSpreadBps = 190;
      s.ownCds5Y = { bps: 190, date: '2026-10-31', source: 'file' };
    }
  );

test('a pull where nothing answered keeps every good figure, labelled with the old date', () => {
  const failed = snap([], {}, (s) => { s.imfIndicators.debtToGdpPct = 1; delete s.gdeltPull; });
  const r = mergeLastGood(failed, good(), PREV_AT);
  assert.equal(r.incomplete, true);
  assert.equal(r.snapshot.imfIndicators.debtToGdpPct, 77.7);
  assert.equal(r.snapshot.imfIndicators.years?.['imf.debtToGdpPct'], '2025');
  assert.equal(r.snapshot.worldBankIndicators.fxReservesMonthsImport, 11.1);
  assert.equal(r.snapshot.gdeltMetrics.averageTone, -2.5);
  assert.ok(r.snapshot.gdeltPull);
  assert.equal(r.snapshot.liveFields?.['imf.debtToGdpPct'], 'IMF WEO, 2025 · kept from the 2026-11-01 pull');
  const st = getSnapshotDataStatus(r.snapshot);
  assert.equal(st.live('imf.debtToGdpPct'), 77.7);
  assert.ok(st.isFeedLive('imf'));
  assert.ok(r.snapshot.dataStatus!.verifiedLiveSources.every((s) => s.includes('kept from the 2026-11-01 pull')));
});

test('the CDS is never carried: it follows the own-data switch', () => {
  const failed = snap([], {}, (s) => { delete s.ownCds5Y; });
  const r = mergeLastGood(failed, good(), PREV_AT);
  assert.equal(r.snapshot.liveFields?.['market.cds5YSpreadBps'], undefined);
  assert.equal(r.snapshot.ownCds5Y, undefined);
  assert.ok(!r.snapshot.dataStatus!.verifiedLiveSources.some((s) => /Own CDS/.test(s)));
  assert.equal(getSnapshotDataStatus(r.snapshot).isLive('market.cds5YSpreadBps'), false);
});

test('a figure the new pull has wins over the saved one', () => {
  const partial = snap(['IMF World Economic Outlook'], { 'imf.debtToGdpPct': 'IMF WEO, 2026' }, (s) => { s.imfIndicators.debtToGdpPct = 80.1; });
  const r = mergeLastGood(partial, good(), PREV_AT);
  assert.equal(r.snapshot.imfIndicators.debtToGdpPct, 80.1);
  assert.equal(r.snapshot.liveFields?.['imf.debtToGdpPct'], 'IMF WEO, 2026');
  assert.equal(r.snapshot.worldBankIndicators.fxReservesMonthsImport, 11.1, 'World Bank failed, kept');
  assert.deepEqual(r.carried.sort(), ['gdelt.averageTone', 'wb.fxReservesMonthsImport']);
  assert.equal(r.incomplete, true);
});

test('a full pull is not marked for retry and carries nothing', () => {
  const full = good();
  const r = mergeLastGood(full, good(), PREV_AT);
  assert.deepEqual(r.carried, []);
  assert.equal(r.incomplete, false);
});

test('built-in values in the saved copy are never carried', () => {
  const prev = snap([], {}); // saved copy with nothing live
  const failed = snap([], {}, (s) => { s.imfIndicators.debtToGdpPct = 1; });
  const r = mergeLastGood(failed, prev, PREV_AT);
  assert.deepEqual(r.carried, []);
  assert.equal(r.snapshot.imfIndicators.debtToGdpPct, 1);
  assert.equal(r.incomplete, true, 'nothing answered: retry soon');
});

test('first pull with nothing live and no saved copy is retried soon', () => {
  const r = mergeLastGood(snap([], {}), null, 0);
  assert.equal(r.incomplete, true);
});

test('a figure carried twice keeps its first date', () => {
  const once = keptLabel('World Bank, 2024', PREV_AT);
  assert.equal(keptLabel(once, Date.parse('2026-11-04T00:00:00Z')), once);
});

test('saved debt falling due is kept when the new pull has none', () => {
  const prev = good();
  (prev as any).debtSchedule = { qeds: { quarters: [] } };
  prev.dataStatus!.verifiedLiveSources.push('QEDS quarterly external debt statistics (government external debt due by quarter)');
  const full = good();
  const r = mergeLastGood(full, prev, PREV_AT);
  assert.ok(r.snapshot.debtSchedule);
  assert.ok(r.snapshot.dataStatus!.verifiedLiveSources.some((s) => s.startsWith('QEDS') && s.includes('kept from')));
  assert.equal(r.incomplete, true);
});
