/**
 * Statistics for macro charts: lining up series of different frequencies, transforms, and the
 * standard tests an economist reaches for (correlation, regression, lead/lag, ADF, Granger, HP filter).
 * Pure functions, no I/O, browser-safe. Every result carries its sample size so the UI can say when
 * a sample is too short to trust. Nothing here invents a value: a test that cannot run returns
 * { error } with the reason.
 */

export type Freq = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
export interface Point {
  date: string;
  value: number;
}

// ---------------------------------------------------------------------------------------------
// Periods and alignment

const FREQ_RANK: Record<Freq, number> = { daily: 0, weekly: 1, monthly: 2, quarterly: 3, annual: 4 };

/** The frequency a date string carries: "2026" annual, "2026-Q2" quarterly, "2026-05" monthly, a full date daily. */
export function dateFreq(date: string): Freq {
  if (/^\d{4}$/.test(date)) return 'annual';
  if (/^\d{4}-Q[1-4]$/i.test(date)) return 'quarterly';
  if (/^\d{4}-\d{2}$/.test(date)) return 'monthly';
  return 'daily';
}

/** Coarser of two frequencies (the one two series can share). */
export function coarser(a: Freq, b: Freq): Freq {
  return FREQ_RANK[a] >= FREQ_RANK[b] ? a : b;
}

/** The period key of a date at a frequency: "2026", "2026-Q2", "2026-05" or the date itself. Null when the date is coarser than asked. */
export function periodKey(date: string, freq: Freq): string | null {
  const own = dateFreq(date);
  if (FREQ_RANK[own] > FREQ_RANK[freq]) return null;
  const year = date.slice(0, 4);
  if (freq === 'annual') return year;
  if (own === 'quarterly') return `${year}-Q${date.slice(-1)}`;
  const month = Number(date.slice(5, 7));
  if (freq === 'quarterly') return `${year}-Q${Math.ceil(month / 3)}`;
  if (freq === 'monthly') return date.slice(0, 7);
  return date.slice(0, 10);
}

/** Periods per year, for year-on-year changes. */
export function periodsPerYear(freq: Freq): number {
  return { daily: 252, weekly: 52, monthly: 12, quarterly: 4, annual: 1 }[freq];
}

/** Averages a series onto a frequency (monthly yields to quarterly means, and so on). Sorted by period. */
export function toFreq(points: Point[], freq: Freq): Point[] {
  const sums = new Map<string, { s: number; n: number }>();
  for (const p of points) {
    if (!Number.isFinite(p.value)) continue;
    const k = periodKey(p.date, freq);
    if (!k) continue;
    const cur = sums.get(k) || { s: 0, n: 0 };
    cur.s += p.value;
    cur.n += 1;
    sums.set(k, cur);
  }
  return [...sums.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([date, { s, n }]) => ({ date, value: s / n }));
}

/** The coarsest frequency among series (the one they can all be compared at). */
export function commonFreq(series: Point[][]): Freq {
  let f: Freq = 'daily';
  for (const s of series) for (const p of s.slice(0, 3)) f = coarser(f, dateFreq(p.date));
  return f;
}

export interface Pair {
  date: string;
  x: number;
  y: number;
}

/** Two series on their common frequency, kept only where both have a value. */
export function alignPair(x: Point[], y: Point[], freq: Freq = commonFreq([x, y])): { freq: Freq; pairs: Pair[] } {
  const xs = new Map(toFreq(x, freq).map((p) => [p.date, p.value]));
  const pairs: Pair[] = [];
  for (const p of toFreq(y, freq)) {
    const xv = xs.get(p.date);
    if (xv !== undefined) pairs.push({ date: p.date, x: xv, y: p.value });
  }
  return { freq, pairs };
}

// ---------------------------------------------------------------------------------------------
// Transforms

export type Transform = 'level' | 'change' | 'yoy' | 'index100' | 'zscore' | 'hp_trend' | 'hp_cycle';

export const TRANSFORM_LABEL: Record<Transform, string> = {
  level: 'Level',
  change: 'Change on previous period',
  yoy: 'Change on a year earlier, %',
  index100: 'Index, first point = 100',
  zscore: 'Z-score (standard deviations from its mean)',
  hp_trend: 'HP filter trend',
  hp_cycle: 'HP filter cycle (gap from trend)',
};

/** Applies a transform to a series already on one frequency. Points that cannot be computed are dropped. */
export function transform(points: Point[], t: Transform, freq: Freq): Point[] {
  const v = points.map((p) => p.value);
  if (t === 'level') return points;
  if (t === 'change') return points.slice(1).map((p, i) => ({ date: p.date, value: p.value - v[i] }));
  if (t === 'yoy') {
    const k = periodsPerYear(freq);
    const byDate = new Map(points.map((p) => [p.date, p.value]));
    const out: Point[] = [];
    for (const p of points) {
      const prev = byDate.get(shiftPeriod(p.date, -k, freq));
      if (prev !== undefined && prev !== 0) out.push({ date: p.date, value: (p.value / prev - 1) * 100 });
    }
    return out;
  }
  if (t === 'index100') {
    const base = v.find((x) => x !== 0);
    return base === undefined ? [] : points.map((p) => ({ date: p.date, value: (p.value / base) * 100 }));
  }
  if (t === 'zscore') {
    const m = mean(v);
    const s = stdev(v);
    return s > 0 ? points.map((p) => ({ date: p.date, value: (p.value - m) / s })) : [];
  }
  const hp = hpFilter(v, hpLambda(freq));
  if ('error' in hp) return [];
  return points.map((p, i) => ({ date: p.date, value: t === 'hp_trend' ? hp.trend[i] : hp.cycle[i] }));
}

/** A period key moved by n periods (n negative = back in time). */
export function shiftPeriod(key: string, n: number, freq: Freq): string {
  if (freq === 'annual') return String(Number(key.slice(0, 4)) + n);
  if (freq === 'quarterly') {
    const idx = Number(key.slice(0, 4)) * 4 + (Number(key.slice(-1)) - 1) + n;
    return `${Math.floor(idx / 4)}-Q${(((idx % 4) + 4) % 4) + 1}`;
  }
  if (freq === 'monthly') {
    const idx = Number(key.slice(0, 4)) * 12 + (Number(key.slice(5, 7)) - 1) + n;
    return `${Math.floor(idx / 12)}-${String((((idx % 12) + 12) % 12) + 1).padStart(2, '0')}`;
  }
  const d = new Date(`${key.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n * (freq === 'weekly' ? 7 : 1));
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------------
// Basic moments

export function mean(v: number[]): number {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}
export function stdev(v: number[]): number {
  if (v.length < 2) return NaN;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

// ---------------------------------------------------------------------------------------------
// Distributions (regularised incomplete beta, Numerical Recipes 6.4)

function logGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const cj of c) ser += cj / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 300;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a, b). */
export function incBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-sided p-value of a t statistic with df degrees of freedom. */
export function tPValue(t: number, df: number): number {
  if (!Number.isFinite(t) || df <= 0) return NaN;
  return incBeta(df / (df + t * t), df / 2, 0.5);
}

/** Upper-tail p-value of an F statistic. */
export function fPValue(f: number, d1: number, d2: number): number {
  if (!Number.isFinite(f) || f < 0 || d1 <= 0 || d2 <= 0) return NaN;
  return incBeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2);
}

// ---------------------------------------------------------------------------------------------
// Correlation and regression

export interface Failed {
  error: string;
}

/** Fewest pairs a correlation or regression will run on; below this the result says why not. */
export const MIN_PAIRS = 8;

export interface Correlation {
  r: number;
  n: number;
  t: number;
  p: number;
}

export function pearson(x: number[], y: number[], min = MIN_PAIRS): Correlation | Failed {
  const n = Math.min(x.length, y.length);
  if (n < min) return { error: `Only ${n} overlapping points; a correlation needs at least ${min}.` };
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return { error: 'One of the series does not move over the overlap, so a correlation means nothing.' };
  const r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
  const t = Math.abs(r) === 1 ? Infinity : r * Math.sqrt((n - 2) / (1 - r * r));
  return { r, n, t, p: Math.abs(r) === 1 ? 0 : tPValue(t, n - 2) };
}

/** Solves A x = b (small dense systems) by Gaussian elimination with partial pivoting; null when singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function invert(A: number[][]): number[][] | null {
  const n = A.length;
  const cols: number[][] = [];
  for (let j = 0; j < n; j++) {
    const e = Array.from({ length: n }, (_, i) => (i === j ? 1 : 0));
    const col = solve(A, e);
    if (!col) return null;
    cols.push(col);
  }
  return A.map((_, i) => cols.map((c) => c[i]));
}

export interface Regression {
  /** Intercept first, then one per regressor. */
  coef: number[];
  se: number[];
  t: number[];
  p: number[];
  r2: number;
  adjR2: number;
  n: number;
  k: number;
  rss: number;
  residuals: number[];
}

/** Ordinary least squares of y on the columns of X, with an intercept added. */
export function ols(y: number[], X: number[][], min = MIN_PAIRS): Regression | Failed {
  const n = y.length;
  const k = (X[0]?.length ?? 0) + 1;
  if (n < Math.max(min, k + 3)) return { error: `Only ${n} usable points for ${k - 1} explanatory series; too few for a regression.` };
  const Z = X.map((row) => [1, ...row]);
  const ZtZ = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => Z.reduce((s, r) => s + r[i] * r[j], 0)));
  const Zty = Array.from({ length: k }, (_, i) => Z.reduce((s, r, t) => s + r[i] * y[t], 0));
  const inv = invert(ZtZ);
  if (!inv) return { error: 'The explanatory series move together exactly (or do not move), so the regression cannot be solved.' };
  const coef = inv.map((row) => row.reduce((s, v, j) => s + v * Zty[j], 0));
  const residuals = Z.map((r, t) => y[t] - r.reduce((s, v, j) => s + v * coef[j], 0));
  const rss = residuals.reduce((s, e) => s + e * e, 0);
  const my = mean(y);
  const tss = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const df = n - k;
  const s2 = rss / df;
  const se = inv.map((row, i) => Math.sqrt(Math.max(0, s2 * row[i])));
  const t = coef.map((c, i) => (se[i] > 0 ? c / se[i] : NaN));
  const r2 = tss > 0 ? 1 - rss / tss : NaN;
  return { coef, se, t, p: t.map((v) => tPValue(v, df)), r2, adjR2: 1 - (1 - r2) * ((n - 1) / df), n, k, rss, residuals };
}

/** Correlation of x with y at each lag: lag k > 0 means x k periods earlier lines up with y (x leads). */
export function crossCorrelation(pairs: Pair[], maxLag: number): Array<{ lag: number; r: number; n: number; p: number }> {
  const out: Array<{ lag: number; r: number; n: number; p: number }> = [];
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < pairs.length; i++) {
      const j = i - lag;
      if (j < 0 || j >= pairs.length) continue;
      xs.push(pairs[j].x);
      ys.push(pairs[i].y);
    }
    const c = pearson(xs, ys);
    if (!('error' in c)) out.push({ lag, r: c.r, n: c.n, p: c.p });
  }
  return out;
}

/** Correlation over a moving window, dated at the window's last point. */
export function rollingCorrelation(pairs: Pair[], window: number): Point[] {
  const out: Point[] = [];
  for (let i = window - 1; i < pairs.length; i++) {
    const w = pairs.slice(i - window + 1, i + 1);
    const c = pearson(
      w.map((p) => p.x),
      w.map((p) => p.y)
    );
    if (!('error' in c)) out.push({ date: pairs[i].date, value: c.r });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Unit root (Augmented Dickey-Fuller, constant, lag chosen by AIC)

/** MacKinnon (2010) response-surface coefficients, constant, no trend: c(T) = b0 + b1/T + b2/T². */
const ADF_CRIT: Record<'1%' | '5%' | '10%', [number, number, number]> = {
  '1%': [-3.43035, -6.5393, -16.786],
  '5%': [-2.86154, -2.8903, -4.234],
  '10%': [-2.56677, -1.5384, -2.809],
};

export interface AdfResult {
  stat: number;
  lags: number;
  n: number;
  critical: Record<'1%' | '5%' | '10%', number>;
  /** True when the unit root is rejected at 5%: the series looks stationary. */
  stationary: boolean;
}

export function adf(values: number[], maxLag?: number): AdfResult | Failed {
  const N = values.length;
  if (N < 20) return { error: `Only ${N} points; the ADF test needs at least 20.` };
  const top = Math.max(0, Math.min(maxLag ?? Math.floor(12 * (N / 100) ** 0.25), Math.floor(N / 4)));
  const dy = values.slice(1).map((v, i) => v - values[i]);
  let best: { aic: number; reg: Regression; lags: number } | null = null;
  // Same sample for every lag length so the AIC values compare.
  const start = top;
  for (let p = 0; p <= top; p++) {
    const y: number[] = [];
    const X: number[][] = [];
    for (let t = start; t < dy.length; t++) {
      const row = [values[t]];
      for (let j = 1; j <= p; j++) row.push(dy[t - j]);
      X.push(row);
      y.push(dy[t]);
    }
    const reg = ols(y, X);
    if ('error' in reg) continue;
    const aic = reg.n * Math.log(reg.rss / reg.n) + 2 * reg.k;
    if (!best || aic < best.aic) best = { aic, reg, lags: p };
  }
  if (!best) return { error: 'The ADF regression could not be solved for this series.' };
  const T = best.reg.n;
  const crit = Object.fromEntries(Object.entries(ADF_CRIT).map(([k, [b0, b1, b2]]) => [k, b0 + b1 / T + b2 / (T * T)])) as AdfResult['critical'];
  const stat = best.reg.t[1];
  if (!Number.isFinite(stat) || best.reg.rss <= 1e-12) return { error: 'The series follows an exact pattern, so the ADF test has nothing to measure.' };
  return { stat, lags: best.lags, n: T, critical: crit, stationary: stat < crit['5%'] };
}

// ---------------------------------------------------------------------------------------------
// Granger causality (does x's past help predict y beyond y's own past?)

export interface GrangerResult {
  f: number;
  p: number;
  lags: number;
  n: number;
}

export function granger(pairs: Pair[], lags: number): GrangerResult | Failed {
  const n = pairs.length - lags;
  if (lags < 1) return { error: 'Granger needs at least one lag.' };
  if (n < 2 * lags + 10) return { error: `Only ${pairs.length} overlapping points; ${lags} lag(s) needs at least ${3 * lags + 10}.` };
  const y: number[] = [];
  const R: number[][] = [];
  const U: number[][] = [];
  for (let t = lags; t < pairs.length; t++) {
    const own = Array.from({ length: lags }, (_, j) => pairs[t - j - 1].y);
    const other = Array.from({ length: lags }, (_, j) => pairs[t - j - 1].x);
    y.push(pairs[t].y);
    R.push(own);
    U.push([...own, ...other]);
  }
  const r = ols(y, R);
  const u = ols(y, U);
  if ('error' in r) return r;
  if ('error' in u) return u;
  const d2 = u.n - u.k;
  const f = ((r.rss - u.rss) / lags) / (u.rss / d2);
  return { f, p: fPValue(f, lags, d2), lags, n: u.n };
}

// ---------------------------------------------------------------------------------------------
// Hodrick-Prescott filter

/** The usual smoothing parameter for a frequency (Ravn-Uhlig for annual and monthly). */
export function hpLambda(freq: Freq): number {
  return { daily: 129600 * 441, weekly: 129600 * 18.8, monthly: 129600, quarterly: 1600, annual: 6.25 }[freq];
}

/** Trend solves (I + λD'D)τ = y, D the second-difference matrix: a symmetric pentadiagonal system. */
export function hpFilter(y: number[], lambda: number): { trend: number[]; cycle: number[] } | Failed {
  const n = y.length;
  if (n < 6) return { error: `Only ${n} points; the HP filter needs at least 6.` };
  // Diagonals of I + λD'D.
  const d0 = new Array<number>(n).fill(0);
  const d1 = new Array<number>(n - 1).fill(0);
  const d2 = new Array<number>(n - 2).fill(0);
  for (let i = 0; i < n - 2; i++) {
    // Row i of D: [1, -2, 1] at columns i, i+1, i+2.
    const c = [1, -2, 1];
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++) {
        const r = i + a;
        const s = i + b;
        const v = lambda * c[a] * c[b];
        if (r === s) d0[r] += v;
        else if (Math.abs(r - s) === 1 && r < s) d1[r] += v;
        else if (Math.abs(r - s) === 2 && r < s) d2[r] += v;
      }
  }
  for (let i = 0; i < n; i++) d0[i] += 1;
  // Banded Gaussian elimination (bandwidth 2), symmetric so lower = upper.
  const A = Array.from({ length: n }, (_, i) => {
    const row = new Map<number, number>();
    row.set(i, d0[i]);
    if (i + 1 < n) row.set(i + 1, d1[i]);
    if (i + 2 < n) row.set(i + 2, d2[i]);
    if (i - 1 >= 0) row.set(i - 1, d1[i - 1]);
    if (i - 2 >= 0) row.set(i - 2, d2[i - 2]);
    return row;
  });
  const b = [...y];
  for (let k = 0; k < n; k++) {
    const piv = A[k].get(k) as number;
    for (let i = k + 1; i <= Math.min(n - 1, k + 2); i++) {
      const f = (A[i].get(k) || 0) / piv;
      if (!f) continue;
      for (let j = k; j <= Math.min(n - 1, k + 2); j++) A[i].set(j, (A[i].get(j) || 0) - f * (A[k].get(j) || 0));
      b[i] -= f * b[k];
    }
  }
  const trend = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j <= Math.min(n - 1, i + 2); j++) s -= (A[i].get(j) || 0) * trend[j];
    trend[i] = s / (A[i].get(i) as number);
  }
  return { trend, cycle: y.map((v, i) => v - trend[i]) };
}

// ---------------------------------------------------------------------------------------------
// Plain-English readings

/** How strong a correlation is, in words. */
export function strengthWord(r: number): string {
  const a = Math.abs(r);
  return a >= 0.7 ? 'strong' : a >= 0.4 ? 'moderate' : a >= 0.2 ? 'weak' : 'little or no';
}

/** "p = 0.003" or "p < 0.001". */
export function fmtP(p: number): string {
  if (!Number.isFinite(p)) return 'p not available';
  return p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`;
}

/** A sample-size caution for a test, or null when the sample is reasonable. */
export function sampleCaution(n: number, freq: Freq): string | null {
  if (freq === 'annual' && n < 20) return `Only ${n} annual points: treat the result as a rough guide.`;
  if (n < 30) return `Only ${n} points: treat the result as a rough guide.`;
  return null;
}
