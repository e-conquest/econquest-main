import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_GROUP, cutSeries, lastKnownYear, reviewModelFigures } from '../src/utils/reviewModels';
import type { DiagnosisFigure } from '../src/utils/reviewDiagnosis';
import type { Series } from '../src/utils/seriesHistory';

const series = (id: string, f: (y: number) => number, from = 1995, to = 2031, projFrom = 2026): Series => ({
  id, label: id, unit: '%', freq: 'annual', source: 'test',
  points: Array.from({ length: to - from + 1 }, (_, k) => from + k).map((y) => ({ date: String(y), value: f(y), ...(y >= projFrom ? { note: 'IMF projection' } : {}) })),
});
const fig = (ref: number, field: string, value: number | null, period = '2024'): DiagnosisFigure => ({ ref, field, group: 'g', label: field, unit: '%', value, status: value === null ? 'Missing' : 'Live', period, source: 's', reason: value === null ? 'x' : '' });
const twelve = Array.from({ length: 12 }, (_, i) => fig(i + 1, `f${i}`, 1));
twelve[1] = fig(2, 'market.policyRatePct', 10.5);
twelve[3] = fig(4, 'imf.debtToGdpPct', 76.5, '2024');

const inputs = (asOf: string) => ({
  iso3: 'BRA',
  asOf,
  growth: series('g', (y) => 2 + 2 * Math.sin(y / 3)),
  debt: series('d', (y) => 50 + (y - 1995)),
  primaryBalance: series('pb', (y) => 0.5 * Math.cos(y)),
  overallBalance: series('ob', (y) => -5 + 0.5 * Math.cos(y)),
  inflation: series('pi', () => 5),
  figures: twelve,
});

test('As-of cut: April brings last year, earlier in the year only the year before', () => {
  assert.equal(lastKnownYear('2024-06-30'), 2023);
  assert.equal(lastKnownYear('2024-02-01'), 2022);
  const s = cutSeries(series('g', () => 1), 2023)!;
  assert.equal(s.points[s.points.length - 1].date, '2023');
});

test('model readings: numbered after the twelve, all from years up to the cut, never projections', () => {
  const m = reviewModelFigures(inputs('2024-06-30'));
  assert.deepEqual(m.map((x) => x.ref), [13, 14, 15, 16, 17, 18, 19]);
  assert.ok(m.every((x) => x.group === MODEL_GROUP));
  const by = Object.fromEntries(m.map((x) => [x.field, x]));
  assert.equal(by['model.outputGapPct'].period, '2023');
  assert.notEqual(by['model.outputGapPct'].value, null);
  assert.equal(by['model.debtHistoricalPct'].period, '2028');
  assert.ok(by['model.debtCombinedShockPct'].value! > by['model.debtHistoricalPct'].value!);
  assert.equal(by['model.multiplierLow'].value, 0.1);
  assert.match(by['model.outputGapPct'].source, /today's IMF vintage/);
});

test('the same As-of day gives the same readings even after later years arrive', () => {
  const a = reviewModelFigures(inputs('2015-06-30'));
  const later = inputs('2015-06-30');
  later.growth = series('g', (y) => (y > 2014 ? 9 : 2 + 2 * Math.sin(y / 3)));
  const b = reviewModelFigures(later);
  assert.deepEqual(a.find((x) => x.field === 'model.outputGapPct'), b.find((x) => x.field === 'model.outputGapPct'));
});

test('no history saved: Missing with the reason, multiplier range still cited', () => {
  const m = reviewModelFigures({ iso3: 'EGY', asOf: '2024-06-30', figures: twelve });
  const by = Object.fromEntries(m.map((x) => [x.field, x]));
  assert.equal(by['model.outputGapPct'].value, null);
  assert.match(by['model.outputGapPct'].reason, /Offline data/);
  assert.equal(by['model.stabilisingPbPct'].value, null);
  assert.ok(by['model.stabilisingPbPct'].reason.length > 0);
  assert.equal(by['model.multiplierHigh'].value, 0.3);
});
