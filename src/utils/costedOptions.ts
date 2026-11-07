/**
 * Costed fiscal options: what a stated consolidation does to the debt path and to output, on the
 * app's debt sustainability baseline (src/utils/debtSustainability.ts) and the IMF bucket-approach
 * multiplier range (src/utils/fiscalMultipliers.ts).
 *
 * Each option raises the primary balance by a stated amount (points of GDP), phased in evenly over
 * the stated years and kept after that. In a year the primary balance rises by s points, real growth
 * that year is lower by m x s, with m the first-year multiplier (the bucket range's low and high
 * ends); the output level stays lower by the cumulative amount, so later growth is unchanged.
 * Inflation, interest and the rest of the IMF inputs are as in the baseline; lower debt then means
 * lower interest automatically through the identity.
 *
 * Shown per option: debt at the horizon on the low and high multiplier, the change against the
 * baseline, and the output cost (cumulative points of GDP lost by the horizon). With a large
 * multiplier and a short horizon, consolidation can raise debt/GDP in the first years (the
 * denominator effect, Eyraud and Weber 2013); the table shows it when it happens.
 *
 * Stated options on stated assumptions: not a forecast, not a recommendation.
 *
 * Browser-safe.
 */
import { nextDebt, nominalGrowthPct, type DsaResult } from './debtSustainability';

export interface FiscalOption {
  id: string;
  label: string;
  /** Total primary balance improvement, points of GDP. */
  sizePts: number;
  /** Years over which it is phased in evenly. */
  years: number;
}

export const STANDARD_OPTIONS: FiscalOption[] = [
  { id: 'c05', label: 'Tighten 0.5 pt at once', sizePts: 0.5, years: 1 },
  { id: 'c1', label: 'Tighten 1 pt over 2 years', sizePts: 1, years: 2 },
  { id: 'c2', label: 'Tighten 2 pts over 3 years', sizePts: 2, years: 3 },
  { id: 'e1', label: 'Loosen 1 pt at once', sizePts: -1, years: 1 },
];

export interface OptionPath {
  year: string;
  debt: number;
  growth: number;
  pb: number;
}

export interface CostedOption {
  option: FiscalOption;
  /** Debt at the horizon, % of GDP, with the low and high multiplier. */
  endLow: number;
  endHigh: number;
  /** Against the baseline end, points (negative = lower debt). */
  vsBaselineLow: number;
  vsBaselineHigh: number;
  /** Output level lost by the horizon, % (low and high multiplier). */
  outputCostLow: number;
  outputCostHigh: number;
  /** True when debt is higher than the baseline in year 1 on the high multiplier. */
  denominatorEffect: boolean;
  pathHigh: OptionPath[];
}

export interface CostedOptions {
  ok: true;
  baselineEnd: number;
  horizonYear: string;
  multiplier: { low: number; high: number; source: string };
  options: CostedOption[];
  method: string;
}

export type CostedOptionsOutcome = CostedOptions | { ok: false; reason: string };

export const COSTED_METHOD =
  'Primary balance raised by the stated size, phased in evenly and kept; real growth lower by multiplier x the year\'s step (output level loss persists, growth then as baseline); IMF baseline inputs otherwise; debt from the identity, so interest falls with debt.';

const r2 = (v: number) => Number(v.toFixed(2));

function run(r: DsaResult, opt: FiscalOption, m: number): { path: OptionPath[]; outputCost: number } {
  const base = r.baselineInputs!;
  const step = opt.sizePts / Math.max(1, opt.years);
  let d = r.debtNow;
  let cum = 0;
  let lost = 0;
  const path: OptionPath[] = [];
  base.forEach((y, k) => {
    const thisStep = k < opt.years ? step : 0;
    cum += thisStep;
    const g = y.g - m * thisStep;
    lost += m * thisStep;
    const pb = y.pb + cum;
    d = nextDebt(d, y.i, nominalGrowthPct(g, y.pi), pb);
    path.push({ year: y.year, debt: r2(d), growth: r2(g), pb: r2(pb) });
  });
  return { path, outputCost: r2(lost) };
}

export function costedOptions(r: DsaResult, multiplier: { low: number; high: number; source: string }, options: FiscalOption[] = STANDARD_OPTIONS): CostedOptionsOutcome {
  if (!r.baselineInputs?.length) return { ok: false, reason: "The baseline on the IMF's projected inputs did not run, so options cannot be costed against it" };
  // The baseline run through the same code with no option, so options and baseline share every input.
  const basePath = run(r, { id: 'base', label: 'Baseline', sizePts: 0, years: 1 }, 0).path;
  const baseline = { end: basePath[basePath.length - 1].debt };
  const horizonYear = r.baselineInputs[r.baselineInputs.length - 1].year;
  const year1Base = basePath[0]?.debt;
  const out: CostedOption[] = options.map((o) => {
    const lo = run(r, o, multiplier.low);
    const hi = run(r, o, multiplier.high);
    const endLow = lo.path[lo.path.length - 1].debt;
    const endHigh = hi.path[hi.path.length - 1].debt;
    return {
      option: o,
      endLow,
      endHigh,
      vsBaselineLow: r2(endLow - baseline.end),
      vsBaselineHigh: r2(endHigh - baseline.end),
      outputCostLow: lo.outputCost,
      outputCostHigh: hi.outputCost,
      denominatorEffect: o.sizePts > 0 && year1Base !== undefined && hi.path[0].debt > year1Base,
      pathHigh: hi.path,
    };
  });
  return { ok: true, baselineEnd: baseline.end, horizonYear, multiplier, options: out, method: COSTED_METHOD };
}
