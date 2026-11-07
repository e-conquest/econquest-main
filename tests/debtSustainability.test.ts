import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debtStabilisingPb, debtSustainability, dsaSentence, nextDebt, nominalGrowthPct } from '../src/utils/debtSustainability';
import type { Series } from '../src/utils/seriesHistory';

const series = (id: string, f: (y: number) => number, from = 2005, to = 2031, projFrom = 2026): Series => ({
  id,
  label: id,
  unit: '%',
  freq: 'annual',
  source: 'test',
  pulledAt: '2026-11-01T00:00:00Z',
  points: Array.from({ length: to - from + 1 }, (_, k) => from + k).map((y) => ({ date: String(y), value: f(y), ...(y >= projFrom ? { note: 'IMF projection' } : {}) })),
});

test('identity: zero interest-growth gap and zero primary balance keep debt flat', () => {
  assert.ok(Math.abs(nextDebt(80, 5, 5, 0) - 80) < 1e-9);
  assert.ok(Math.abs(nominalGrowthPct(2, 3) - 5.06) < 1e-9);
  // The stabilising primary balance makes next year's debt equal this year's.
  const pb = debtStabilisingPb(90, 8, 6);
  assert.ok(Math.abs(nextDebt(90, 8, 6, pb) - 90) < 1e-9);
});

test('missing inputs: Missing with each reason, never a number', () => {
  const r = debtSustainability({ debt: series('d', () => 80) });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /primary balance \(IMF Fiscal Monitor GGXONLB_G01_GDP_PT\)/);
});

test('decomposition adds up: snowball + primary + stock-flow = change in debt', () => {
  const r = debtSustainability({
    debt: series('d', (y) => 60 + (y - 2005) * 1.5),
    primaryBalance: series('pb', (y) => -1 + 0.1 * Math.sin(y)),
    overallBalance: series('ob', (y) => -4 + 0.1 * Math.sin(y)),
    realGrowth: series('g', (y) => 2 + Math.cos(y)),
    inflation: series('pi', () => 4),
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.lastOutturnYear, '2025');
  for (const h of r.history.filter((x) => x.change !== undefined && x.snowball !== undefined)) {
    assert.ok(Math.abs(h.snowball! + h.primary! + h.stockFlow! - h.change!) < 0.02, h.year);
  }
  const ids = r.scenarios.map((s) => s.id);
  assert.deepEqual(ids, ['imf', 'baseline', 'historical', 'growth', 'primary', 'interest', 'combined']);
  const end = Object.fromEntries(r.scenarios.map((s) => [s.id, s.end]));
  // Every shock leaves debt at or above the baseline; the combined one highest of the three.
  assert.ok(end.growth >= end.baseline && end.primary >= end.baseline && end.interest > end.baseline);
  assert.ok(end.combined >= Math.max(end.growth, end.primary, end.interest));
  assert.equal(r.scenarios[0].path[0].year, '2025');
  assert.equal(r.scenarios[1].path.length, 6);
  assert.match(dsaSentence(r), /Debt 90\.0% of GDP in 2025/);
  assert.ok(r.stabilisingPb !== undefined && r.projectedPb !== undefined);
});

test('no overall balance: no interest, so baseline and shocks say why instead of guessing', () => {
  const r = debtSustainability({
    debt: series('d', () => 70),
    primaryBalance: series('pb', () => 0),
    realGrowth: series('g', () => 2),
    inflation: series('pi', () => 3),
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.scenarios.map((s) => s.id), ['imf']);
  assert.ok(r.missing.some((m) => /overall balance/.test(m)));
});
