import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVDS_YIELD_SOURCE_LABEL,
  evdsSeriesUrl,
  isValidEvdsSeriesCode,
  officialYieldFeedLabel,
  parseEvdsLatest,
} from '../src/utils/officialYields.ts';
import { getSnapshotDataStatus } from '../src/utils/dataStatus.ts';
import { buildBaselineOpenData } from '../src/data/presetsAndBaselines.ts';

test('request URL uses path parameters, DD-MM-YYYY dates and never carries the key', () => {
  const url = evdsSeriesUrl('TP.X.Y10', new Date('2026-11-04T12:00:00Z'));
  assert.equal(url, 'https://evds3.tcmb.gov.tr/igmevdsms-dis/series=TP.X.Y10&startDate=06-08-2026&endDate=04-11-2026&type=json');
  assert.ok(!/key/i.test(url));
});

test('series codes must look like EVDS codes', () => {
  assert.ok(isValidEvdsSeriesCode('TP.DK.USD.A.YTL'));
  assert.ok(!isValidEvdsSeriesCode(''));
  assert.ok(!isValidEvdsSeriesCode('TP.X&key=abc'));
});

test('takes the latest non-empty daily value from the underscored column', () => {
  const json = {
    totalCount: 3,
    items: [
      { Tarih: '29-10-2026', TP_X_Y10: '31.85' },
      { Tarih: '30-10-2026', TP_X_Y10: '31.92' },
      { Tarih: '31-10-2026', TP_X_Y10: null },
    ],
  };
  const o = parseEvdsLatest(json, 'TP.X.Y10');
  assert.equal(o?.valuePct, 31.92);
  assert.equal(o?.period, '2026-10-30');
  assert.equal(o?.frequency, 'daily');
  assert.equal(officialYieldFeedLabel(o!), EVDS_YIELD_SOURCE_LABEL);
});

test('monthly dates and decimal commas are understood', () => {
  const o = parseEvdsLatest({ items: [{ Tarih: '2026-8', TP_X_Y10: '30,5' }, { Tarih: '2026-9', TP_X_Y10: '31,1' }] }, 'TP.X.Y10');
  assert.equal(o?.period, '2026-09');
  assert.equal(o?.valuePct, 31.1);
  assert.equal(o?.frequency, 'monthly');
});

test('no plausible value means no official figure', () => {
  assert.equal(parseEvdsLatest({ items: [] }, 'TP.X'), null);
  assert.equal(parseEvdsLatest({ error: 'forbidden' }, 'TP.X'), null);
  assert.equal(parseEvdsLatest({ items: [{ Tarih: '30-10-2026', TP_X: '3192' }] }, 'TP.X'), null);
  assert.equal(parseEvdsLatest({ items: [{ Tarih: '30-10-2026', OTHER: '31.9' }] }, 'TP.X'), null);
});

test('a snapshot that used EVDS counts the yield as official', () => {
  const obs = parseEvdsLatest({ items: [{ Tarih: '30-10-2026', TP_X: '31.92' }] }, 'TP.X')!;
  const s = { ...buildBaselineOpenData('TUR'), official10YYield: obs, dataStatus: { verifiedLiveSources: [EVDS_YIELD_SOURCE_LABEL], checkedAt: '2026-11-04T12:00:00Z' } };
  assert.equal(getSnapshotDataStatus(s).yieldSource, 'official');
});
