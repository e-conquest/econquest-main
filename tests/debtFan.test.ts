import test from 'node:test';
import assert from 'node:assert/strict';
import { debtSustainability } from '../src/utils/debtSustainability.ts';
import { debtFan, debtFanSentence } from '../src/utils/debtFan.ts';

const ser = (id: string, f: (y: number) => number, from: number, to: number, projFrom: number) => ({
  id,
  label: id,
  unit: '%',
  source: 'test',
  freq: 'annual' as const,
  points: Array.from({ length: to - from + 1 }, (_, k) => from + k).map((y) => ({ date: String(y), value: f(y), ...(y >= projFrom ? { note: 'IMF projection' } : {}) })),
});
const wiggle = (y: number) => Math.sin(y * 1.7);
const inputs = {
  debt: ser('d', (y) => 50 + (y - 2000) * 0.5, 2000, 2030, 2026),
  primaryBalance: ser('pb', (y) => -1 + wiggle(y), 2000, 2030, 2026),
  overallBalance: ser('ob', (y) => -3 + wiggle(y), 2000, 2030, 2026),
  realGrowth: ser('g', (y) => 3 + 2 * wiggle(y + 1), 2000, 2030, 2026),
  inflation: ser('pi', (y) => 4 + wiggle(y + 2), 2000, 2030, 2026),
};

test('fan: centred on the baseline, ordered percentiles, same seed same fan', () => {
  const r = debtSustainability(inputs);
  assert.ok(r.ok && r.baselineInputs?.length === 5);
  if (!r.ok) return;
  const f = debtFan(r);
  assert.ok(f.ok);
  if (!f.ok) return;
  assert.equal(f.years.length, 6);
  assert.equal(f.years[0].p50, r.debtNow);
  for (const y of f.years) assert.ok(y.p10 <= y.p25 && y.p25 <= y.p50 && y.p50 <= y.p75 && y.p75 <= y.p90);
  const end = f.years[5];
  assert.ok(end.p90 > end.p10, 'shocks spread the paths');
  const base = r.scenarios.find((s) => s.id === 'baseline')!.end;
  assert.ok(Math.abs(end.p50 - base) < (end.p90 - end.p10), 'median near the baseline');
  assert.deepEqual(debtFan(r), f);
  assert.ok(f.probAboveNow >= 0 && f.probAboveNow <= 1);
  assert.match(debtFanSentence(f), /8 of 10 paths/);
});

test('fan: Missing with a reason when the history is short or the baseline did not run', () => {
  const short = debtSustainability({ ...inputs, debt: ser('d', () => 60, 2020, 2030, 2026) });
  assert.ok(short.ok);
  if (short.ok) {
    const f = debtFan(short);
    assert.equal(f.ok, false);
    if (!f.ok) assert.match(f.reason, /Needs 10 past years/);
  }
  const r = debtSustainability(inputs);
  if (r.ok) {
    const f = debtFan({ ...r, baselineInputs: undefined });
    assert.equal(f.ok, false);
  }
});
