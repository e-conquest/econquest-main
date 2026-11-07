/**
 * Model sandboxes (seven-groups plan, Phase 5, teaching): sliders on the app's own formulas, so a
 * student can see what each term does. Starting values are the country's latest figures, or
 * Missing when the app has none; nothing is filled in.
 *
 *   Debt dynamics  d(t) = d(t-1) (1 + i) / (1 + n) - pb, n = (1 + g)(1 + pi) - 1   (utils/debtSustainability.ts)
 *   Taylor rule    r* + pi + a (pi - target) + b gap                                 (Taylor 1993: a = b = 0.5)
 *   Output gap     HP filter with any lambda against the Hamilton (2018) regression with any horizon h,
 *                  on log real GDP chained from IMF WEO growth                         (utils/outputGap.ts)
 *
 * Illustration of the formulas, not a forecast. Browser-safe, pure.
 */
import type { SeriesPoint } from './seriesHistory';
import { debtStabilisingPb, nextDebt, nominalGrowthPct } from './debtSustainability';
import { hamiltonCycle, hpTrend, logLevelFromGrowth } from './outputGap';

const r2 = (v: number) => Math.round(v * 100) / 100;

export interface DebtInputs {
  debt: number;
  /** Effective nominal interest rate, %. */
  i: number;
  /** Real growth, %. */
  g: number;
  /** Inflation (GDP deflator stand-in: consumer prices), %. */
  pi: number;
  /** Primary balance, % of GDP (surplus positive). */
  pb: number;
  years: number;
}

export interface DebtSandbox {
  path: number[];
  nominalGrowth: number;
  /** i - n, points. */
  iMinusN: number;
  stabilisingPb: number;
  end: number;
}

export function debtSandbox(x: DebtInputs): DebtSandbox {
  const n = nominalGrowthPct(x.g, x.pi);
  const path = [r2(x.debt)];
  let d = x.debt;
  for (let k = 0; k < Math.max(1, Math.min(30, Math.round(x.years))); k++) {
    d = nextDebt(d, x.i, n, x.pb);
    path.push(r2(d));
  }
  return { path, nominalGrowth: r2(n), iMinusN: r2(x.i - n), stabilisingPb: r2(debtStabilisingPb(x.debt, x.i, n)), end: path[path.length - 1] };
}

export interface TaylorInputs {
  rStar: number;
  pi: number;
  target: number;
  gap: number;
  aPi: number;
  aGap: number;
}

export function taylorSandbox(x: TaylorInputs): { rate: number; terms: Array<{ label: string; value: number }> } {
  const terms = [
    { label: 'Neutral real rate', value: x.rStar },
    { label: 'Inflation', value: x.pi },
    { label: `${x.aPi} x (inflation - target)`, value: x.aPi * (x.pi - x.target) },
    { label: `${x.aGap} x output gap`, value: x.aGap * x.gap },
  ];
  return { rate: r2(terms.reduce((s, t) => s + t.value, 0)), terms: terms.map((t) => ({ ...t, value: r2(t.value) })) };
}

export interface FilterSandbox {
  years: Array<{ year: string; hp?: number; hamilton?: number }>;
  latest?: { year: string; hp: number; hamilton?: number };
  outturns: number;
}

/** HP (lambda) against Hamilton (h) on outturns of IMF real growth; the gaps in % of trend. */
export function filterSandbox(growth: SeriesPoint[], lambda: number, h: number): FilterSandbox | { reason: string } {
  const lv = logLevelFromGrowth(growth).filter((p) => !p.projection);
  if (lv.length < 15) return { reason: `only ${lv.length} unbroken years of IMF real GDP growth; the filters need at least 15` };
  const y = lv.map((p) => p.y);
  const trend = hpTrend(y, Math.max(0.1, lambda));
  const ham = hamiltonCycle(y, Math.max(1, Math.min(8, Math.round(h))));
  const years = lv.map((p, k) => ({ year: p.year, hp: r2(y[k] - trend[k]), ...(ham[k] === undefined ? {} : { hamilton: r2(ham[k]!) }) }));
  const last = years[years.length - 1];
  return { years, latest: { year: last.year, hp: last.hp!, ...(last.hamilton === undefined ? {} : { hamilton: last.hamilton }) }, outturns: lv.length };
}

export const SANDBOX_METHOD =
  'Debt: d(t) = d(t-1) x (1 + i) / (1 + n) - pb, with n = (1 + g)(1 + inflation) - 1 and the debt-stabilising primary balance d x (i - n) / (1 + n), as in Debt sustainability. Taylor: neutral real rate + inflation + a x (inflation - target) + b x output gap (Taylor 1993 uses 2, 0.5 and 0.5). Output gap: log real GDP chained from IMF WEO growth outturns, less an HP trend with the chosen lambda (100 is the usual yearly choice, 6.25 the Ravn-Uhlig one), against the residual of a regression of GDP on its value h years earlier (Hamilton 2018, h = 2 for yearly data). Starting values are the latest figures on file; a missing one is Missing, not filled in. Illustration of the formulas, not a forecast.';
