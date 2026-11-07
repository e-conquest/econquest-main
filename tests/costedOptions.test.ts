import test from 'node:test';
import assert from 'node:assert/strict';
import { debtSustainability } from '../src/utils/debtSustainability.ts';
import { costedOptions, STANDARD_OPTIONS } from '../src/utils/costedOptions.ts';

const ser = (id: string, f: (y: number) => number) => ({
  id,
  label: id,
  unit: '%',
  source: 'test',
  freq: 'annual' as const,
  points: Array.from({ length: 31 }, (_, k) => 2000 + k).map((y) => ({ date: String(y), value: f(y), ...(y >= 2026 ? { note: 'IMF projection' } : {}) })),
});
const r = debtSustainability({
  debt: ser('d', (y) => 60 + (y - 2000) * 0.3),
  primaryBalance: ser('pb', () => -1),
  overallBalance: ser('ob', () => -4),
  realGrowth: ser('g', () => 3),
  inflation: ser('pi', () => 4),
});

test('costed options: tightening lowers debt, more with the low multiplier; loosening raises it', () => {
  assert.ok(r.ok);
  if (!r.ok) return;
  const c = costedOptions(r, { low: 0.1, high: 0.3, source: 'test' });
  assert.ok(c.ok);
  if (!c.ok) return;
  assert.equal(c.options.length, STANDARD_OPTIONS.length);
  const t2 = c.options.find((o) => o.option.id === 'c2')!;
  assert.ok(t2.vsBaselineLow < 0 && t2.vsBaselineHigh < 0);
  assert.ok(t2.endLow < t2.endHigh, 'a smaller multiplier costs less growth, so debt falls more');
  assert.equal(t2.outputCostLow, 0.2);
  assert.equal(t2.outputCostHigh, 0.6);
  const e1 = c.options.find((o) => o.option.id === 'e1')!;
  assert.ok(e1.vsBaselineLow > 0);
  assert.equal(t2.denominatorEffect, false);
});

test('costed options: denominator effect flagged with a large multiplier and high debt; Missing without a baseline', () => {
  if (!r.ok) return;
  const big = costedOptions({ ...r, debtNow: 150 }, { low: 1, high: 1.5, source: 'test' });
  assert.ok(big.ok && big.options.find((o) => o.option.id === 'c05')!.denominatorEffect);
  const none = costedOptions({ ...r, baselineInputs: undefined }, { low: 0.1, high: 0.3, source: 'test' });
  assert.equal(none.ok, false);
});
