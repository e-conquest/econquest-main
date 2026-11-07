import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, readSignal, scoreCall, signalFromGap, trackRecord, trackRecordRows, trackRecordSentence, TRACK_RECORD_HEADER, type ArchivedDay } from '../src/utils/trackRecord.ts';
import type { Series } from '../src/utils/seriesHistory.ts';

const target = { pct: 3, bank: 'Test bank', url: 'https://example.org', checked: true };
const policy = (points: Array<[string, number]>): Series => ({ id: 'policy_rate', label: 'Policy rate', unit: '%', freq: 'daily', source: 'BIS', points: points.map(([date, value]) => ({ date, value })) });
const cpi: Series = { id: 'cpi_monthly', label: 'Inflation', unit: '%', freq: 'monthly', source: 'OECD via DBnomics', points: [{ date: '2026-01', value: 4 }, { date: '2026-02', value: 4 }, { date: '2026-03', value: 9 }] };
const day = (date: string, pct?: number, extra: Partial<ArchivedDay['snapshot']> = {}): ArchivedDay => ({
  date,
  snapshot: { liveFields: pct === undefined ? {} : { 'market.policyRatePct': `BIS, ${date}` }, monetaryAndMarket: pct === undefined ? {} : { policyRatePct: pct }, ...extra },
});

test('signal: above the rule by more than 1 pt points to a cut, below to a raise', () => {
  assert.equal(signalFromGap(1.5), 'cut');
  assert.equal(signalFromGap(-1.5), 'raise');
  assert.equal(signalFromGap(0.9), 'hold');
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
});

test('reading uses only that pull and inflation at least 45 days old', () => {
  // 2026-04-10 minus 45 days = 2026-02-24 -> February is the latest usable month (March's 9% is not).
  const r = readSignal(day('2026-04-10', 12), cpi, target);
  assert.ok(r.reading);
  assert.equal(r.reading!.inflationPct, 4);
  assert.match(r.reading!.inflationBasis, /2026-02/);
  // rule = 2 + 4 + 0.5 x 1 = 6.5; policy 12 -> 5.5 above -> cut
  assert.equal(r.reading!.rulePct, 6.5);
  assert.equal(r.reading!.signal, 'cut');
  assert.equal(r.reading!.outputGapPct, undefined);
});

test('reading: a policy rate not from BIS, or no target, is Missing with the reason', () => {
  const own = readSignal({ date: '2026-04-10', snapshot: { liveFields: { 'market.policyRatePct': 'Sample' }, monetaryAndMarket: { policyRatePct: 10 } } }, cpi, target);
  assert.deepEqual(own.missing, ['the BIS policy rate in that pull']);
  assert.ok(readSignal(day('2026-04-10', 12), cpi, undefined).missing!.includes("the central bank's inflation target"));
  assert.deepEqual(readSignal(day('2026-04-10', 12), undefined, target).missing, ['inflation']);
});

test('reading falls back to the IMF yearly inflation and output gap saved in that pull', () => {
  const r = readSignal(
    day('2026-04-10', 5, { liveFields: { 'market.policyRatePct': 'BIS', 'imf.cpiInflationPct': 'IMF WEO', 'imf.outputGapPct': 'IMF WEO' }, imfIndicators: { cpiInflationPct: 3, outputGapPct: -2, years: { 'imf.cpiInflationPct': '2026' } } }),
    undefined,
    target
  );
  // 2 + 3 + 0 - 1 = 4; policy 5 -> +1 -> hold
  assert.equal(r.reading!.rulePct, 4);
  assert.equal(r.reading!.signal, 'hold');
  assert.match(r.reading!.inflationBasis, /IMF WEO yearly/);
});

test('scoring waits for the horizon and for the BIS series to reach it', () => {
  const p = policy([['2026-01-01', 12], ['2026-05-01', 11], ['2026-08-01', 11]]);
  assert.deepEqual(scoreCall('2026-04-10', 'cut', p, '2026-06-01'), { status: 'pending', due: '2026-07-09' });
  assert.deepEqual(scoreCall('2026-04-10', 'cut', policy([['2026-01-01', 12]]), '2026-09-01'), { status: 'pending', due: '2026-07-09' });
  const s = scoreCall('2026-04-10', 'cut', p, '2026-09-01');
  assert.equal(s.status, 'scored');
  assert.ok(s.status === 'scored' && s.followed && s.action === 'cut' && s.fromPct === 12 && s.toPct === 11);
  const h = scoreCall('2026-04-10', 'hold', p, '2026-09-01');
  assert.ok(h.status === 'scored' && !h.followed);
});

test('log: one call per run of the same signal; summary counts calls only, small sample flagged', () => {
  const p = policy([['2026-01-01', 12], ['2026-05-01', 11], ['2026-10-30', 11]]);
  const flat: Series = { ...cpi, points: cpi.points.slice(0, 2) };
  const t = trackRecord({ iso3: 'TST', days: [day('2026-04-17', 12), day('2026-04-10', 12), day('2026-04-24'), day('2026-05-01', 12)], policy: p, cpi: flat, target, today: '2026-11-01' });
  assert.equal(t.entries.length, 4);
  assert.equal(t.entries[0].day, '2026-05-01', 'newest first');
  // 04-10 call, 04-17 same signal, 04-24 missing, 05-01 a new call after the gap.
  assert.deepEqual(t.entries.map((e) => e.call).reverse(), [true, false, false, true]);
  assert.equal(t.calls, 2);
  assert.equal(t.scored, 2);
  assert.equal(t.followed, 1);
  assert.equal(t.bySignal.cut.scored, 2);
  assert.equal(t.smallSample, true);
  assert.match(trackRecordSentence(t), /followed by the bank in 1 of 2 scored calls\. Too few to lean on/);
  const rows = trackRecordRows(t);
  assert.equal(rows[0].length, TRACK_RECORD_HEADER.length);
  assert.equal(rows[0][1], '2026-04-10', 'download is oldest first');
  assert.equal(rows[2][3], 'Missing');
});

test('empty archive says so', () => {
  const t = trackRecord({ iso3: 'TST', days: [], target });
  assert.equal(t.calls, 0);
  assert.match(trackRecordSentence(t), /No saved pulls yet/);
});
