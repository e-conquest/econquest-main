import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUCKETS, LITERATURE, multiplierView } from '../src/utils/fiscalMultipliers';

test('published ranges are the TNM 14/04 Table 6 buckets', () => {
  assert.deepEqual(BUCKETS.map((b) => [b.low, b.high]), [[0.1, 0.3], [0.4, 0.6], [0.7, 1.0]]);
  // Every literature line names a source; no unsourced number.
  for (const l of LITERATURE) assert.match(l.source, /\(20\d\d\)|Working Paper/);
});

test('emerging market: low bucket per the paper; unknown characteristics widen the own score, never guessed', () => {
  const v = multiplierView({ iso3: 'BRA', debtPctGdp: { value: 93.3, year: '2025' } });
  assert.equal(v.group, 'emerging');
  assert.deepEqual([v.guide.low, v.guide.high], [0.1, 0.3]);
  assert.equal(v.characteristics.find((c) => c.id === 'debt')!.point, 0); // above the 40% EME threshold
  assert.equal(v.characteristics.filter((c) => c.point === undefined).length, 5);
  assert.deepEqual(v.score, { min: 0, max: 5 });
  assert.deepEqual([v.normal.low, v.normal.high], [0.1, 1.0]);
  assert.deepEqual([v.cycle.trough.low, v.cycle.trough.high], [0.16, 0.48]);
  assert.deepEqual([v.cycle.peak.low, v.cycle.peak.high], [0.06, 0.18]);
  assert.equal(v.lowerBound, undefined);
  assert.ok(v.literature.some((l) => l.id === 'imv_high_debt'));
  assert.match(v.sentence, /not an estimate/);
});

test('advanced economy near zero rates: medium bucket, lower-bound adjustment, Ramey ZLB line', () => {
  const v = multiplierView({ iso3: 'JPN', debtPctGdp: { value: 230, year: '2025' }, policyRatePct: 0.5, outputGap: { pct: -1.2, year: '2025', source: 'estimate' } });
  assert.equal(v.group, 'advanced');
  assert.deepEqual([v.guide.low, v.guide.high], [0.4, 0.6]);
  assert.deepEqual([v.lowerBound!.low, v.lowerBound!.high], [0.52, 0.78]);
  assert.ok(v.literature.some((l) => l.id === 'ramey'));
  assert.ok(v.literature.some((l) => l.id === 'ag_cycle'));
  assert.match(v.cycle.note, /below potential/);
});

test('no debt figure: the debt characteristic is not known, with the reason', () => {
  const v = multiplierView({ iso3: 'EGY' });
  assert.match(v.characteristics.find((c) => c.id === 'debt')!.why, /Missing/);
  assert.deepEqual(v.score, { min: 0, max: 6 });
});
