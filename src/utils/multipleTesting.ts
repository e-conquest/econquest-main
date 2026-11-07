/**
 * Multiple-testing correction across every pre-registered test on record (Sam's signal standard,
 * rule 5, 2026-11-06): each verdict is shown beside a Holm-adjusted p and the number of tests it
 * was one of, so a pass that only stands because many rules were tried is visible.
 *
 * The family is every version of every test that has been run: backtests
 * (docs/validation/preregistered/) and nowcast/forecast evaluations (docs/validation/forecasts/).
 * Earlier versions count, failed ones too: a rule tried twice is two tests.
 *
 * Holm (1979) step-down: sort the m p-values ascending; the adjusted p of the k-th smallest is
 * max over j <= k of min(1, (m - j + 1) x p_(j)). It controls the family-wise error rate at the
 * stated level, without any assumption about how the tests depend on each other.
 *
 * Each test keeps its own registered pass mark (alpha): a verdict "holds after correction" when its
 * adjusted p is at or below that mark. The recorded verdict is never changed by this reading.
 *
 * Browser-safe, pure.
 */

export interface TestOnRecord {
  /** Unique key, e.g. "taylor_gap v2" or "forecast gdp_nowcast v1". */
  key: string;
  /** Register entry or evaluation id. */
  id: string;
  version: number;
  kind: 'backtest' | 'forecast';
  /** The p-value the test was judged on (the more conservative one where two were computed). */
  p: number;
  /** The registered pass mark for p. */
  alpha: number;
  status: 'passed' | 'failed' | 'too_few_cases';
}

export interface HolmReading {
  key: string;
  p: number;
  adjusted: number;
  alpha: number;
  /** Adjusted p at or below the test's own pass mark. */
  holds: boolean;
  /** Number of tests in the family. */
  tested: number;
}

const r3 = (v: number) => Number(v.toPrecision(3));

/** Holm-adjusted p-values, by key. Non-finite p counts as 1. */
export function holm(tests: Array<{ key: string; p: number }>): Map<string, number> {
  const m = tests.length;
  const sorted = tests.map((t) => ({ key: t.key, p: Number.isFinite(t.p) ? Math.min(1, Math.max(0, t.p)) : 1 })).sort((a, b) => a.p - b.p);
  const out = new Map<string, number>();
  let running = 0;
  sorted.forEach((t, i) => {
    running = Math.max(running, Math.min(1, (m - i) * t.p));
    out.set(t.key, running);
  });
  return out;
}

/** The Holm reading for every test on record. */
export function holmReadings(tests: TestOnRecord[]): Map<string, HolmReading> {
  const adj = holm(tests);
  const out = new Map<string, HolmReading>();
  for (const t of tests) {
    const a = adj.get(t.key) ?? 1;
    out.set(t.key, { key: t.key, p: t.p, adjusted: r3(a), alpha: t.alpha, holds: a <= t.alpha, tested: tests.length });
  }
  return out;
}

/** One line for a verdict: "Holm-adjusted p 0.21 across 17 tests: does not hold at 0.05." */
export function holmSentence(h: HolmReading | undefined): string {
  if (!h) return '';
  return `Holm-adjusted p ${h.adjusted} across ${h.tested} tests on record (raw p ${r3(h.p)}): ${h.holds ? 'holds' : 'does not hold'} at its pass mark of ${h.alpha}.`;
}

/** Minimal shapes of the saved results this module reads. */
interface BacktestLike {
  id: string;
  specVersion: number;
  status: 'passed' | 'failed' | 'too_few_cases';
  pValue: number;
  robustness?: { pValue: number };
}

/**
 * The family from the saved backtest versions and forecast tests. A backtest's p is the larger of
 * the case-count p and the whole-year resampled p, so a method 1 test is not credited with the
 * looser of the two.
 */
export function testsOnRecord(
  backtests: Record<string, BacktestLike> | undefined,
  alphaFor: (id: string, version: number) => number | undefined,
  forecasts: Array<{ id: string; version: number; p: number; alpha: number; status: TestOnRecord['status'] }> = [],
): TestOnRecord[] {
  const out: TestOnRecord[] = [];
  const seen = new Set<string>();
  for (const r of Object.values(backtests || {})) {
    if (!r?.id) continue;
    const key = `${r.id} v${r.specVersion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const p = Math.max(r.pValue ?? 1, r.robustness?.pValue ?? 0);
    out.push({ key, id: r.id, version: r.specVersion, kind: 'backtest', p, alpha: alphaFor(r.id, r.specVersion) ?? 0.05, status: r.status });
  }
  for (const f of forecasts) {
    const key = `forecast ${f.id} v${f.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, id: f.id, version: f.version, kind: 'forecast', p: f.p, alpha: f.alpha, status: f.status });
  }
  return out;
}
