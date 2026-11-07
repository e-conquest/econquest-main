/**
 * Scenario engine: how a country's markets have moved with global drivers, and what a stated global
 * shock would mean for them on that record.
 *
 * For each country response (its currency against the US dollar, its policy rate), the engine fits
 * one OLS on monthly changes over the last 15 years (at least 60 months):
 *
 *   response change(t) = a + b_us x US policy rate change(t) + b_usd x dollar change(t)
 *                        + b_fs x financial stress change(t) + b_sc x supply chain pressure change(t) + e(t)
 *
 * - Currency: 100 x log change of units per US dollar, month-end (ECB reference rates); up = weaker.
 * - Policy rate: change in the BIS month-end rate, points.
 * - US policy rate: the Fed funds target as the BIS publishes it (month-end), change in points.
 * - Dollar: 100 x log change of euros per US dollar (ECB), the broadest daily dollar rate the app
 *   holds free from 1999; up = stronger dollar. Not a trade-weighted index, and stated so.
 * - Financial stress (gap analysis D12): the index the user picks (src/utils/stressIndices.ts),
 *   default the St. Louis Fed Financial Stress Index (STLFSI4); or the Chicago Fed NFCI or adjusted
 *   NFCI. All weekly from FRED, zero = average; last reading of the month, change in index points;
 *   up = more stress / tighter conditions. One index at a time: two near-identical indices would
 *   only split the coefficient between them.
 * - Supply chain pressure: the NY Fed Global Supply Chain Pressure Index (monthly, standard
 *   deviations from average), change in points; up = more pressure.
 *   A factor with no history saved is left out of the fit and named under Missing factors.
 *
 * A scenario is a set of stated factor moves. The implied response is b'x shock (the intercept, a
 * monthly drift, is left out), with a 90% band from the Newey-West covariance of the coefficients.
 * The band covers estimation error only; the monthly residual spread is shown beside it.
 *
 * Co-movement in the sample, linear in the shock: not a causal model, and shocks larger than any
 * month in the sample are extrapolation (the panel shows the largest monthly move of each factor).
 * Oil has only five years of saved monthly prices (Pink Sheet), too short for this fit, so it is not
 * a factor yet.
 *
 * Browser-safe.
 */
import { ols } from './stats';
import { neweyWestCov, neweyWestLag } from './bohnTest';
import type { SeriesPoint } from './seriesHistory';

export const SCENARIO_WINDOW_MONTHS = 180;
export const SCENARIO_MIN_MONTHS = 60;
export const Z90 = 1.645;

export type FactorId = 'us_rate' | 'dollar' | 'fin_stress' | 'supply_chain';
export type ResponseId = 'fx' | 'policy';

export const FACTORS: Array<{ id: FactorId; label: string; unit: string }> = [
  { id: 'us_rate', label: 'US policy rate', unit: 'pts' },
  { id: 'dollar', label: 'US dollar against the euro', unit: '%' },
  { id: 'fin_stress', label: 'US financial stress (St. Louis Fed index)', unit: 'index pts' },
  { id: 'supply_chain', label: 'Global supply chain pressure (NY Fed GSCPI)', unit: 'std dev' },
];

export const RESPONSES: Record<ResponseId, { label: string; unit: string; note: string }> = {
  fx: { label: 'Currency against the US dollar', unit: '%', note: 'positive = weaker currency' },
  policy: { label: 'Policy rate', unit: 'pts', note: 'change in the central bank rate' },
};

export interface ScenarioModel {
  response: ResponseId;
  ok: true;
  /** Factor order as in `factors`. */
  factors: FactorId[];
  beta: number[];
  se: number[];
  /** Newey-West covariance of the factor coefficients (intercept dropped). */
  cov: number[][];
  r2: number;
  n: number;
  from: string;
  to: string;
  /** Standard deviation of the monthly residual. */
  residualSd: number;
  /** Largest absolute monthly move of each factor in the sample. */
  maxMove: number[];
}

export type ScenarioModelOutcome = ScenarioModel | { response: ResponseId; ok: false; reason: string };

export const PRESETS: Array<{ id: string; label: string; shock: Partial<Record<FactorId, number>> }> = [
  { id: 'fed100', label: 'Fed raises 1 point', shock: { us_rate: 1 } },
  { id: 'usd5', label: 'Dollar 5% stronger', shock: { dollar: 5 } },
  { id: 'tight', label: 'Fed +1 point and dollar +5%', shock: { us_rate: 1, dollar: 5 } },
  { id: 'ease', label: 'Fed cuts 1 point, dollar 5% weaker', shock: { us_rate: -1, dollar: -5 } },
  { id: 'stress', label: 'Financial stress up 1 point', shock: { fin_stress: 1 } },
  { id: 'riskoff', label: 'Stress up 1 point, dollar 5% stronger', shock: { fin_stress: 1, dollar: 5 } },
  { id: 'supply', label: 'Supply chain pressure up 1 point', shock: { supply_chain: 1 } },
];

export const SCENARIO_METHOD = `OLS on monthly changes, last ${SCENARIO_WINDOW_MONTHS / 12} years (at least ${SCENARIO_MIN_MONTHS} months): response on the US policy rate change (BIS), the dollar's log change against the euro (ECB) the change in the financial stress index you pick (St. Louis Fed STLFSI4 by default, or the Chicago Fed NFCI or adjusted NFCI; FRED, month's last weekly reading) and the change in the NY Fed Global Supply Chain Pressure Index (monthly). Implied move = coefficients x stated shock; 90% band from Newey-West coefficient errors. Co-movement, linear; not causal.`;

const r3 = (v: number) => Number(v.toFixed(3));

/** Month (YYYY-MM) to the last value of that month. */
export function monthEnd(points: SeriesPoint[] | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of [...(points || [])].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (Number.isFinite(p.value) && /^\d{4}-\d{2}/.test(p.date)) m.set(p.date.slice(0, 7), p.value);
  }
  return m;
}

const prevMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

/** Monthly changes: log (x100) for levels, differences for rates. */
export function monthlyChanges(m: Map<string, number>, kind: 'log' | 'diff'): Map<string, number> {
  const out = new Map<string, number>();
  for (const [ym, v] of m) {
    const p = m.get(prevMonth(ym));
    if (p === undefined) continue;
    if (kind === 'log') {
      if (v > 0 && p > 0) out.set(ym, 100 * Math.log(v / p));
    } else out.set(ym, v - p);
  }
  return out;
}

export function fitScenarioModel(
  response: ResponseId,
  y: Map<string, number>,
  factors: Partial<Record<FactorId, Map<string, number>>>,
  opts: { window?: number; min?: number } = {},
): ScenarioModelOutcome {
  const ids = FACTORS.map((f) => f.id).filter((id) => factors[id]?.size);
  if (!ids.length) return { response, ok: false, reason: 'No global factor history saved' };
  const months = [...y.keys()].filter((m) => ids.every((id) => factors[id]!.has(m))).sort().slice(-(opts.window ?? SCENARIO_WINDOW_MONTHS));
  const min = opts.min ?? SCENARIO_MIN_MONTHS;
  if (months.length < min) return { response, ok: false, reason: `Only ${months.length} months with the response and every factor; the fit needs ${min}` };
  const ys = months.map((m) => y.get(m)!);
  const X = months.map((m) => ids.map((id) => factors[id]!.get(m)!));
  // A factor that never moves in the window (or moves exactly with the response) cannot be fitted.
  const keep = ids.map((_, k) => X.some((r) => Math.abs(r[k]) > 1e-9));
  const use = ids.filter((_, k) => keep[k]);
  if (!use.length) return { response, ok: false, reason: 'The global factors did not move in the sample' };
  const Xu = X.map((r) => r.filter((_, k) => keep[k]));
  const reg = ols(ys, Xu);
  if ('error' in reg) return { response, ok: false, reason: reg.error };
  if (reg.r2 > 0.999) return { response, ok: false, reason: 'The response moves exactly with a factor (for example a currency pegged to the euro), so there is nothing to estimate' };
  const V = neweyWestCov(Xu, reg.residuals, neweyWestLag(ys.length));
  if (!V) return { response, ok: false, reason: 'The covariance could not be solved' };
  const cov = V.slice(1).map((r) => r.slice(1));
  const sd = Math.sqrt(reg.rss / Math.max(1, reg.n - reg.k));
  return {
    response,
    ok: true,
    factors: use,
    beta: reg.coef.slice(1).map(r3),
    se: cov.map((r, i) => r3(Math.sqrt(Math.max(0, r[i])))),
    cov,
    r2: r3(reg.r2),
    n: reg.n,
    from: months[0],
    to: months[months.length - 1],
    residualSd: r3(sd),
    maxMove: use.map((id) => r3(Math.max(...months.map((m) => Math.abs(factors[id]!.get(m)!))))),
  };
}

export interface ScenarioResult {
  response: ResponseId;
  value: number;
  lo: number;
  hi: number;
  /** Factors in the shock larger than the largest monthly move in the sample. */
  beyondSample: FactorId[];
}

/** The implied move for a stated shock (factors the model lacks count as zero). */
export function applyScenario(m: ScenarioModel, shock: Partial<Record<FactorId, number>>): ScenarioResult {
  const s = m.factors.map((id) => shock[id] ?? 0);
  const value = s.reduce((acc, v, k) => acc + v * m.beta[k], 0);
  const variance = s.reduce((acc, vi, i) => acc + s.reduce((a2, vj, j) => a2 + vi * m.cov[i][j] * vj, 0), 0);
  const half = Z90 * Math.sqrt(Math.max(0, variance));
  return {
    response: m.response,
    value: r3(value),
    lo: r3(value - half),
    hi: r3(value + half),
    beyondSample: m.factors.filter((id, k) => Math.abs(shock[id] ?? 0) > m.maxMove[k]),
  };
}

export function scenarioSentence(name: string, presetLabel: string, results: ScenarioResult[]): string {
  const parts = results.map((r) => {
    const u = RESPONSES[r.response].unit;
    const what = r.response === 'fx' ? `the currency ${r.value >= 0 ? 'weaker' : 'stronger'} by ${Math.abs(r.value).toFixed(1)}%` : `the policy rate ${r.value >= 0 ? 'up' : 'down'} ${Math.abs(r.value).toFixed(2)} points`;
    return `${what} (90% band ${r.lo.toFixed(r.response === 'fx' ? 1 : 2)} to ${r.hi.toFixed(r.response === 'fx' ? 1 : 2)} ${u})`;
  });
  return `${name}, "${presetLabel}": on the past 15 years' monthly co-movement, ${parts.join('; ')}.`;
}
