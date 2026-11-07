/**
 * Fiscal reaction function (Bohn test): does the government raise its primary balance when debt is
 * higher? A positive, significant response of the primary balance to last year's debt is Bohn
 * (1998)'s sufficient condition for debt to stay sustainable in the sample; none means the record
 * gives no such assurance (it does not prove debt is unsustainable).
 *
 *   primary balance_t = a + rho x debt_{t-1} + gamma x output gap_t + e_t
 *
 * Inputs, all annual and all already saved by the app: IMF Fiscal Monitor primary balance
 * (% of GDP), IMF WEO government debt (% of GDP), and the app's output gap estimate (HP and
 * Hamilton filters on IMF growth, src/utils/outputGap.ts) to take out the cycle. IMF projection
 * years are left out: only years the IMF reports as outturns. Standard errors are Newey-West (HAC,
 * Bartlett kernel, lag floor(4 x (n/100)^(2/9))), as is usual for this regression.
 *
 * Needs 15 years. When the output gap does not cover enough of them, the regression runs without it
 * and says so. A stated estimate on the country's own history, not a forecast and not advice.
 *
 * Browser-safe.
 */
import type { Series } from './seriesHistory';
import { invert, ols, tPValue } from './stats';

export const BOHN_MIN_YEARS = 15;

export const BOHN_REFERENCES = [
  'Bohn, H. (1998), "The Behavior of U.S. Public Debt and Deficits", Quarterly Journal of Economics 113(3), 949-963.',
  'Mendoza, E. G. and Ostry, J. D. (2008), "International evidence on fiscal solvency: Is fiscal policy \'responsible\'?", Journal of Monetary Economics 55(6), 1081-1093.',
  'Newey, W. K. and West, K. D. (1987), "A Simple, Positive Semi-Definite, Heteroskedasticity and Autocorrelation Consistent Covariance Matrix", Econometrica 55(3), 703-708.',
];

export interface BohnInputs {
  primaryBalance?: Pick<Series, 'points' | 'source'>;
  debt?: Pick<Series, 'points' | 'source'>;
  /** The app's output gap by year (outturn years only are used). */
  gap?: Array<{ year: string; central?: number; projection?: boolean }>;
}

export type BohnVerdict = 'responds' | 'weak' | 'no_response';

export interface BohnCoef {
  value: number;
  se: number;
  t: number;
  p: number;
}

export type BohnOutcome =
  | {
      ok: true;
      rho: BohnCoef;
      gamma?: BohnCoef;
      intercept: number;
      n: number;
      from: string;
      to: string;
      withGap: boolean;
      gapNote?: string;
      lags: number;
      r2: number;
      verdict: BohnVerdict;
      method: string;
      /** The rows used, for the table and downloads. */
      rows: Array<{ year: string; primaryBalance: number; debtLag: number; gap?: number }>;
    }
  | { ok: false; reason: string };

const outturns = (s: BohnInputs['primaryBalance']) => new Map((s?.points || []).filter((p) => p.note !== 'IMF projection' && /^\d{4}$/.test(p.date) && Number.isFinite(p.value)).map((p) => [p.date, p.value]));

/** Newey-West lag: floor(4 (n/100)^(2/9)), at least 1. */
export function neweyWestLag(n: number): number {
  return Math.max(1, Math.floor(4 * Math.pow(n / 100, 2 / 9)));
}

/** HAC (Newey-West, Bartlett) standard errors for OLS with an intercept. Null when not solvable. */
export function neweyWestSe(X: number[][], residuals: number[], lags: number): number[] | null {
  const V = neweyWestCov(X, residuals, lags);
  return V ? V.map((r, i) => Math.sqrt(Math.max(0, r[i]))) : null;
}

/** HAC (Newey-West, Bartlett) covariance of the OLS coefficients (intercept first). Null when not solvable. */
export function neweyWestCov(X: number[][], residuals: number[], lags: number): number[][] | null {
  const Z = X.map((r) => [1, ...r]);
  const k = Z[0].length;
  const n = Z.length;
  const ZtZ = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => Z.reduce((s, r) => s + r[i] * r[j], 0)));
  const inv = invert(ZtZ);
  if (!inv) return null;
  const S = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let t = 0; t < n; t++) for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) S[i][j] += residuals[t] ** 2 * Z[t][i] * Z[t][j];
  for (let l = 1; l <= lags; l++) {
    const w = 1 - l / (lags + 1);
    for (let t = l; t < n; t++) {
      const ee = residuals[t] * residuals[t - l];
      for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) S[i][j] += w * ee * (Z[t][i] * Z[t - l][j] + Z[t - l][i] * Z[t][j]);
    }
  }
  const mul = (A: number[][], B: number[][]) => A.map((r) => B[0].map((_, j) => r.reduce((s, v, m) => s + v * B[m][j], 0)));
  return mul(mul(inv, S), inv);
}

export function bohnTest(inputs: BohnInputs): BohnOutcome {
  const pb = outturns(inputs.primaryBalance);
  const debt = outturns(inputs.debt);
  if (!pb.size) return { ok: false, reason: 'No IMF Fiscal Monitor primary balance history saved for this country' };
  if (!debt.size) return { ok: false, reason: 'No IMF government debt history saved for this country' };
  const gap = new Map((inputs.gap || []).filter((g): g is { year: string; central: number } => !g.projection && typeof g.central === "number" && Number.isFinite(g.central)).map((g) => [g.year, g.central]));
  const base = [...pb.keys()]
    .sort()
    .filter((y) => debt.has(String(Number(y) - 1)))
    .map((y) => ({ year: y, primaryBalance: pb.get(y)!, debtLag: debt.get(String(Number(y) - 1))! }));
  if (base.length < BOHN_MIN_YEARS) return { ok: false, reason: `Only ${base.length} years with both the primary balance and the previous year's debt; the test needs ${BOHN_MIN_YEARS}` };
  const withGapRows = base.filter((r) => gap.has(r.year)).map((r) => ({ ...r, gap: gap.get(r.year)! }));
  const withGap = withGapRows.length >= BOHN_MIN_YEARS && withGapRows.length >= 0.8 * base.length;
  const rows: Array<{ year: string; primaryBalance: number; debtLag: number; gap?: number }> = withGap ? withGapRows : base;
  const gapNote = withGap
    ? withGapRows.length < base.length
      ? `${base.length - withGapRows.length} year${base.length - withGapRows.length === 1 ? '' : 's'} without an output gap estimate left out`
      : undefined
    : inputs.gap?.length
      ? 'Run without the output gap: the estimate covers too few of the years'
      : 'Run without the output gap: no estimate for this country';
  const y = rows.map((r) => r.primaryBalance);
  const X = rows.map((r) => (withGap ? [r.debtLag, r.gap!] : [r.debtLag]));
  const fit = ols(y, X);
  if ('error' in fit) return { ok: false, reason: fit.error };
  const lags = neweyWestLag(rows.length);
  const se = neweyWestSe(X, fit.residuals, lags);
  if (!se) return { ok: false, reason: 'The regression could not be solved (debt does not vary)' };
  const df = fit.n - fit.k;
  const coef = (i: number): BohnCoef => {
    const t = se[i] > 0 ? fit.coef[i] / se[i] : NaN;
    return { value: fit.coef[i], se: se[i], t, p: tPValue(t, df) };
  };
  const rho = coef(1);
  const verdict: BohnVerdict = rho.value > 0 && rho.p < 0.05 ? 'responds' : rho.value > 0 && rho.p < 0.1 ? 'weak' : 'no_response';
  return {
    ok: true,
    rho,
    ...(withGap ? { gamma: coef(2) } : {}),
    intercept: fit.coef[0],
    n: rows.length,
    from: rows[0].year,
    to: rows[rows.length - 1].year,
    withGap,
    ...(gapNote ? { gapNote } : {}),
    lags,
    r2: fit.r2,
    verdict,
    method: `OLS of the IMF primary balance on the previous year's IMF government debt${withGap ? ' and the app\'s output gap estimate' : ''}, Newey-West standard errors (lag ${lags}); outturn years only`,
    rows,
  };
}

const f = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');

/** One plain sentence for the panel and the agents. */
export function bohnSentence(r: Extract<BohnOutcome, { ok: true }>, countryName: string): string {
  const est = `rho ${f(r.rho.value)} (Newey-West s.e. ${f(r.rho.se)}, p ${f(r.rho.p, 2)}), ${r.from}-${r.to}, ${r.n} years`;
  if (r.verdict === 'responds') return `${countryName}'s primary balance has risen with debt: each 10 points of GDP more debt went with a primary balance about ${f(r.rho.value * 10, 1)} points of GDP higher the next year (${est}). Bohn's sufficient condition for sustainability holds in this sample.`;
  if (r.verdict === 'weak') return `${countryName}'s primary balance has risen only weakly with debt (${est}); significant at 10% but not 5%, so the record gives limited assurance.`;
  return `No evidence that ${countryName}'s primary balance rises when debt is higher (${est}). The record gives no assurance that fiscal policy has stabilised debt; this does not by itself show debt is unsustainable.`;
}
