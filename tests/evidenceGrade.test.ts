import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binomialLower, binomialUpper, evidenceGrade, GRADE_POLICY } from '../src/utils/evidenceGrade.ts';
import type { ForwardSummary } from '../src/utils/forwardRecord.ts';
import type { HolmReading } from '../src/utils/multipleTesting.ts';

const now = new Date('2026-11-07T00:00:00Z');
const holm = (holds: boolean, adjusted = holds ? 0.01 : 0.3): HolmReading => ({ key: 'x v1', p: 0.0257, adjusted, alpha: 0.05, holds, tested: 24 });
const fwd = (o: Partial<ForwardSummary>): ForwardSummary => ({ test: 'x v1', since: '2026-01-01', calls: 30, scored: 20, hits: 10, hitRatePct: 50, baseRatePct: 50, pending: 0, meanValue: null, small: false, recent: [], ...o });

test('binomial tails', () => {
  assert.ok(Math.abs(binomialUpper(15, 20, 0.5) - 0.0207) < 1e-3);
  assert.ok(Math.abs(binomialLower(5, 20, 0.5) - 0.0207) < 1e-3);
  assert.equal(binomialUpper(0, 10, 0.3), 1);
  assert.equal(binomialLower(10, 10, 0.3), 1);
});

test('only a pass gets a grade; failed, too few and untested keep their own labels', () => {
  for (const status of ['failed', 'too_few_cases', 'not_validated', 'descriptive'] as const) assert.equal(evidenceGrade({ status, holm: holm(true), now }), null);
});

test('validated after the Holm correction; provisional when it only passes alone', () => {
  const v = evidenceGrade({ status: 'passed', ranAt: '2026-11-06T00:00Z', holm: holm(true), now })!;
  assert.equal(v.grade, 'validated');
  assert.equal(v.tone, 'positive');
  assert.match(v.why, /holds after correcting for the 24 tests on record .*hypothetical\.$/);
  const p = evidenceGrade({ status: 'passed', ranAt: '2026-11-06T00:00Z', holm: holm(false), netOfCosts: true, now })!;
  assert.equal(p.grade, 'provisional');
  assert.equal(p.tone, 'warning');
  assert.match(p.why, /raw p 0\.0257.*Holm-adjusted p 0\.3.*24 months of forward record.*hypothetical, net of the registered costs\./);
});

test('24 months of forward record that beats the base rate promotes a provisional pass; fewer months do not', () => {
  const good = fwd({ since: '2024-10-01', scored: 40, hits: 28, hitRatePct: 70, baseRatePct: 50 });
  assert.equal(evidenceGrade({ status: 'passed', ranAt: '2026-11-06T00:00Z', holm: holm(false), forward: good, now })!.grade, 'validated');
  assert.equal(evidenceGrade({ status: 'passed', ranAt: '2026-11-06T00:00Z', holm: holm(false), forward: { ...good, since: '2026-01-01' }, now })!.grade, 'provisional');
});

test('traffic light: below the base rate is under review, significantly below is withdrawn, whatever the in-sample pass', () => {
  const below = evidenceGrade({ status: 'passed', ranAt: '2026-11-06T00:00Z', holm: holm(true), forward: fwd({ hits: 8, hitRatePct: 40 }), now })!;
  assert.equal(below.grade, 'under_review');
  const far = evidenceGrade({ status: 'passed', ranAt: '2026-11-06T00:00Z', holm: holm(true), forward: fwd({ hits: 4, hitRatePct: 20 }), now })!;
  assert.equal(far.grade, 'withdrawn');
  assert.equal(far.tone, 'negative');
  assert.ok(far.forwardP!.below <= GRADE_POLICY.alpha);
  // Too few scored calls: the record is not read yet.
  assert.equal(evidenceGrade({ status: 'passed', ranAt: '2026-11-06T00:00Z', holm: holm(true), forward: fwd({ scored: 5, hits: 0, hitRatePct: 0 }), now })!.grade, 'validated');
});

test('a pass whose test last ran more than 12 months ago reads Review due', () => {
  assert.equal(evidenceGrade({ status: 'passed', ranAt: '2025-09-01T00:00Z', holm: holm(true), now })!.grade, 'review_due');
});
