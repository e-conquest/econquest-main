/**
 * Econometrics lab (seven-groups plan, Phase 5, shared with groups 2 and 3): tests beyond single
 * equations for two series on the Chart Agent's chart, on the rows where both have a value.
 *
 *   Newey-West   OLS of the second series on the first with HAC (Bartlett) errors, lag floor(4 (n/100)^(2/9))
 *   VAR          two-variable VAR in the chart's units, lag by AIC on one sample, orthogonalised
 *                (Cholesky, first series first) impulse responses, 90% residual-bootstrap band
 *   Local proj.  Jordà (2005): y(t+h) - y(t-1) on dx(t) and lags of dy and dx, Newey-West errors
 *   Johansen     trace test for cointegration rank, constant unrestricted, VECM lags from the VAR's lag
 *   Breaks       Bai-Perron (1998, 2003): up to 3 breaks in the intercept and slope of the regression,
 *                global minimum of the sum of squares, 15% trimming, number of breaks by BIC; sup-F
 *                (the largest Chow statistic over break dates) against Bai-Perron's 5% value
 *
 * Description, not a tested signal: none of these is a forecast or a causal estimate. Browser-safe, pure.
 */
import { neweyWestLag, neweyWestSe } from './bohnTest';
import { invert, ols, periodsPerYear, tPValue, type Freq, type Pair } from './stats';

export interface LabStep {
  h: number;
  value: number;
  lo: number;
  hi: number;
}

type Failed = { error: string };
const Z90 = 1.645;

// ---------------------------------------------------------------------------------------------
// Newey-West regression

export interface HacResult {
  slope: number;
  intercept: number;
  seOls: number;
  seHac: number;
  t: number;
  p: number;
  lag: number;
  n: number;
  r2: number;
}

export function hacRegression(pairs: Pair[]): HacResult | Failed {
  const X = pairs.map((p) => [p.x]);
  const reg = ols(pairs.map((p) => p.y), X);
  if ('error' in reg) return reg;
  const lag = neweyWestLag(reg.n);
  const se = neweyWestSe(X, reg.residuals, lag);
  if (!se || !(se[1] > 0)) return { error: 'The Newey-West errors could not be worked out for this sample.' };
  const t = reg.coef[1] / se[1];
  return { slope: reg.coef[1], intercept: reg.coef[0], seOls: reg.se[1], seHac: se[1], t, p: tPValue(t, reg.n - reg.k), lag, n: reg.n, r2: reg.r2 };
}

// ---------------------------------------------------------------------------------------------
// VAR

/** Largest VAR lag tried, by frequency and sample size. */
export function varMaxLag(freq: Freq, n: number): number {
  const ppy = periodsPerYear(freq);
  const top = ppy >= 12 ? 12 : ppy >= 4 ? 8 : 3;
  return Math.max(1, Math.min(top, Math.floor((n - 20) / 6)));
}

/** Impulse response horizon, in periods. */
export function varHorizon(freq: Freq): number {
  const ppy = periodsPerYear(freq);
  return ppy >= 12 ? 24 : ppy >= 4 ? 12 : 8;
}

interface VarFit {
  /** A[l][i][j]: effect of variable j at lag l+1 on variable i. */
  A: number[][][];
  c: number[];
  resid: number[][];
  sigma: number[][];
  T: number;
}

/** OLS of each equation on a constant and p lags of both variables, rows t = start..n-1. */
function fitVar(data: number[][], p: number, start: number): VarFit | null {
  const K = data[0].length;
  const X: number[][] = [];
  const Y: number[][] = [];
  for (let t = start; t < data.length; t++) {
    const row: number[] = [];
    for (let l = 1; l <= p; l++) row.push(...data[t - l]);
    X.push(row);
    Y.push(data[t]);
  }
  const A: number[][][] = Array.from({ length: p }, () => Array.from({ length: K }, () => new Array(K).fill(0)));
  const c: number[] = [];
  const resid: number[][] = Y.map(() => []);
  for (let i = 0; i < K; i++) {
    const reg = ols(
      Y.map((r) => r[i]),
      X,
      10
    );
    if ('error' in reg) return null;
    c.push(reg.coef[0]);
    for (let l = 0; l < p; l++) for (let j = 0; j < K; j++) A[l][i][j] = reg.coef[1 + l * K + j];
    reg.residuals.forEach((e, t) => (resid[t][i] = e));
  }
  const T = Y.length;
  const dof = T - K * p - 1;
  const sigma = Array.from({ length: K }, (_, i) => Array.from({ length: K }, (_, j) => resid.reduce((s, e) => s + e[i] * e[j], 0) / dof));
  return { A, c, resid, sigma, T };
}

const det2 = (m: number[][]) => m[0][0] * m[1][1] - m[0][1] * m[1][0];

/** Orthogonalised responses: Phi_h P, P the lower Cholesky factor of sigma (first variable first). */
function irf(A: number[][][], sigma: number[][], H: number): number[][][] {
  const K = sigma.length;
  const P = [
    [Math.sqrt(sigma[0][0]), 0],
    [sigma[1][0] / Math.sqrt(sigma[0][0]), Math.sqrt(Math.max(0, sigma[1][1] - sigma[1][0] ** 2 / sigma[0][0]))],
  ];
  const phi: number[][][] = [Array.from({ length: K }, (_, i) => Array.from({ length: K }, (_, j) => (i === j ? 1 : 0)))];
  for (let h = 1; h <= H; h++) {
    const m = Array.from({ length: K }, () => new Array(K).fill(0));
    for (let l = 1; l <= Math.min(h, A.length); l++)
      for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) for (let k = 0; k < K; k++) m[i][j] += phi[h - l][i][k] * A[l - 1][k][j];
    phi.push(m);
  }
  return phi.map((F) => F.map((r) => [0, 1].map((j) => r[0] * P[0][j] + r[1] * P[1][j])));
}

/** Seeded uniform draws (Park-Miller), so the band is the same every time. */
function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export interface VarResult {
  lags: number;
  maxLag: number;
  n: number;
  horizon: number;
  /** Response of the second series to a one-s.d. shock in the first, and the other way round. */
  bToA: LabStep[];
  aToB: LabStep[];
  /** One standard deviation of each series' own shock (residual), in its units. */
  shockA: number;
  shockB: number;
  draws: number;
}

export const VAR_DRAWS = 300;

export function varTest(pairs: Pair[], freq: Freq, opts: { draws?: number; maxLag?: number } = {}): VarResult | Failed {
  const n = pairs.length;
  if (n < 40) return { error: `Only ${n} overlapping points; the VAR needs at least 40.` };
  const data = pairs.map((p) => [p.x, p.y]);
  const pmax = opts.maxLag ?? varMaxLag(freq, n);
  let best: { aic: number; p: number } | null = null;
  for (let p = 1; p <= pmax; p++) {
    const f = fitVar(data, p, pmax);
    if (!f) continue;
    // Maximum-likelihood covariance for the criterion (Lütkepohl 2005): ln|Sigma| + 2 p K^2 / T.
    const ml = f.sigma.map((r) => r.map((v) => (v * (f.T - 2 * p - 1)) / f.T));
    const aic = Math.log(det2(ml)) + (2 * p * 4) / f.T;
    if (!best || aic < best.aic) best = { aic, p };
  }
  if (!best) return { error: 'The VAR could not be solved for this sample.' };
  const p = best.p;
  const fit = fitVar(data, p, pmax);
  if (!fit || !(fit.sigma[0][0] > 0) || !(det2(fit.sigma) > 0)) return { error: 'The VAR could not be solved for this sample.' };
  const H = varHorizon(freq);
  const point = irf(fit.A, fit.sigma, H);
  // Residual bootstrap (recursive design): rebuild the series from resampled residuals, refit, redo the responses.
  // Fewer draws on long daily samples, so the chart stays quick in the browser.
  const draws = opts.draws ?? (n > 1500 ? 100 : VAR_DRAWS);
  const rand = rng(20261107);
  const bA: number[][] = point.map(() => []);
  const aB: number[][] = point.map(() => []);
  for (let d = 0; d < draws; d++) {
    const sim = data.slice(0, pmax).map((r) => r.slice());
    for (let t = pmax; t < n; t++) {
      const e = fit.resid[Math.floor(rand() * fit.resid.length)];
      const row = fit.c.slice();
      for (let l = 1; l <= p; l++) for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) row[i] += fit.A[l - 1][i][j] * sim[t - l][j];
      sim.push([row[0] + e[0], row[1] + e[1]]);
    }
    const f = fitVar(sim, p, pmax);
    if (!f || !(f.sigma[0][0] > 0)) continue;
    irf(f.A, f.sigma, H).forEach((m, h) => {
      bA[h].push(m[1][0]);
      aB[h].push(m[0][1]);
    });
  }
  const q = (v: number[], pr: number) => {
    const s = v.slice().sort((x, y) => x - y);
    return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(pr * (s.length - 1))))] : NaN;
  };
  const steps = (k: 'ba' | 'ab') =>
    point.map((m, h) => {
      const v = k === 'ba' ? m[1][0] : m[0][1];
      const b = k === 'ba' ? bA[h] : aB[h];
      return { h, value: v, lo: q(b, 0.05), hi: q(b, 0.95) };
    });
  return { lags: p, maxLag: pmax, n: fit.T, horizon: H, bToA: steps('ba'), aToB: steps('ab'), shockA: Math.sqrt(fit.sigma[0][0]), shockB: Math.sqrt(fit.sigma[1][1]), draws };
}

// ---------------------------------------------------------------------------------------------
// Local projections

export function lpHorizons(freq: Freq): number[] {
  const ppy = periodsPerYear(freq);
  if (ppy >= 12) return [0, 3, 6, 9, 12, 18, 24].map((h) => Math.round((h * ppy) / 12));
  if (ppy >= 4) return [0, 1, 2, 4, 6, 8];
  return [0, 1, 2, 3, 4];
}

export interface LpLabResult {
  steps: Array<LabStep & { se: number; p: number; n: number }>;
  lags: number;
  n: number;
}

/** Response of the second series h periods after a one-unit change in the first (rows of pairs, in order). */
export function lpTest(pairs: Pair[], freq: Freq): LpLabResult | Failed {
  const ppy = periodsPerYear(freq);
  const L = ppy >= 12 ? 3 : ppy >= 4 ? 2 : 1;
  const x = pairs.map((p) => p.x);
  const y = pairs.map((p) => p.y);
  const steps: LpLabResult['steps'] = [];
  let n0 = 0;
  for (const h of lpHorizons(freq)) {
    const ys: number[] = [];
    const Xs: number[][] = [];
    for (let t = L + 1; t + h < pairs.length; t++) {
      const row = [x[t] - x[t - 1]];
      for (let l = 1; l <= L; l++) row.push(y[t - l] - y[t - l - 1], x[t - l] - x[t - l - 1]);
      ys.push(y[t + h] - y[t - 1]);
      Xs.push(row);
    }
    if (h === 0) {
      n0 = ys.length;
      if (n0 < 30) return { error: `Only ${n0} usable points; local projections need at least 30.` };
    }
    if (ys.length < 20) break;
    const reg = ols(ys, Xs);
    if ('error' in reg) break;
    const se = neweyWestSe(Xs, reg.residuals, Math.max(h + 1, neweyWestLag(ys.length)));
    if (!se) break;
    const b = reg.coef[1];
    steps.push({ h, value: b, lo: b - Z90 * se[1], hi: b + Z90 * se[1], se: se[1], p: tPValue(b / se[1], ys.length - reg.k), n: ys.length });
  }
  if (!steps.length) return { error: 'The regressions could not be solved on this sample.' };
  return { steps, lags: L, n: n0 };
}

// ---------------------------------------------------------------------------------------------
// Johansen trace test (two series)

/** 90/95/99% trace critical values, constant unrestricted (MacKinnon, Haug and Michelis 1999), for r = 0 and r <= 1. */
export const JOHANSEN_CRIT = { r0: [13.4294, 15.4943, 19.9349], r1: [2.7055, 3.8415, 6.6349] } as const;

export interface JohansenResult {
  trace: [number, number];
  eig: [number, number];
  /** Cointegrating rank at 5%: 0, 1 or 2. */
  rank: 0 | 1 | 2;
  lags: number;
  n: number;
  /** The cointegrating vector normalised on the first series (y1 + beta y2), when rank is 1. */
  beta?: number;
}

/** Residuals of each column of Y on a constant and the columns of Z. */
function partial(Y: number[][], Z: number[][]): number[][] | null {
  const out: number[][] = Y.map(() => []);
  for (let j = 0; j < Y[0].length; j++) {
    const col = Y.map((r) => r[j]);
    if (!Z[0].length) {
      const m = col.reduce((s, v) => s + v, 0) / col.length;
      col.forEach((v, t) => (out[t][j] = v - m));
      continue;
    }
    const reg = ols(col, Z, 5);
    if ('error' in reg) return null;
    reg.residuals.forEach((e, t) => (out[t][j] = e));
  }
  return out;
}

/** VECM with lags - 1 lagged differences (lags = the VAR's lag in levels). */
export function johansenTest(pairs: Pair[], lags: number): JohansenResult | Failed {
  const k = Math.max(0, lags - 1);
  const v = pairs.map((p) => [p.x, p.y]);
  const dv = v.slice(1).map((r, t) => [r[0] - v[t][0], r[1] - v[t][1]]);
  const Z0: number[][] = [];
  const Z1: number[][] = [];
  const Z2: number[][] = [];
  for (let t = k; t < dv.length; t++) {
    Z0.push(dv[t]);
    Z1.push(v[t]);
    const row: number[] = [];
    for (let j = 1; j <= k; j++) row.push(...dv[t - j]);
    Z2.push(row);
  }
  const T = Z0.length;
  if (T < 30) return { error: `Only ${T} usable points; the Johansen test needs at least 30.` };
  const R0 = partial(Z0, Z2);
  const R1 = partial(Z1, Z2);
  if (!R0 || !R1) return { error: 'The Johansen regressions could not be solved for this sample.' };
  const S = (A: number[][], B: number[][]) => [0, 1].map((i) => [0, 1].map((j) => A.reduce((s, r, t) => s + r[i] * B[t][j], 0) / T));
  const S00 = S(R0, R0);
  const S01 = S(R0, R1);
  const S10 = S(R1, R0);
  const S11 = S(R1, R1);
  const i00 = invert(S00);
  const i11 = invert(S11);
  if (!i00 || !i11) return { error: 'The series do not move (or move exactly together), so the test has nothing to measure.' };
  const mul = (A: number[][], B: number[][]) => A.map((r) => B[0].map((_, j) => r.reduce((s, x, m) => s + x * B[m][j], 0)));
  const M = mul(mul(mul(i11, S10), i00), S01);
  const tr = M[0][0] + M[1][1];
  const dt = det2(M);
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - dt));
  const l1 = Math.min(0.999999, tr / 2 + disc);
  const l2 = Math.max(0, Math.min(l1, tr / 2 - disc));
  const trace: [number, number] = [-T * (Math.log(1 - l1) + Math.log(1 - l2)), -T * Math.log(1 - l2)];
  const rank = trace[0] < JOHANSEN_CRIT.r0[1] ? 0 : trace[1] < JOHANSEN_CRIT.r1[1] ? 1 : 2;
  const out: JohansenResult = { trace, eig: [l1, l2], rank, lags, n: T };
  if (rank === 1) {
    // Eigenvector of M for l1: (M - l1 I) b = 0.
    const b = Math.abs(M[0][1]) > 1e-12 ? [M[0][1], l1 - M[0][0]] : [l1 - M[1][1], M[1][0]];
    if (Math.abs(b[0]) > 1e-12) out.beta = b[1] / b[0];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Structural breaks (Bai-Perron)

/** Bai and Perron (2003) 5% critical value of sup-F for one break, q = 2 regressors changing, 15% trimming. */
export const SUPF_CRIT_5 = 11.47;
export const BREAK_TRIM = 0.15;
export const MAX_BREAKS = 3;

export interface BreaksResult {
  /** Index of the last row of each regime but the last. */
  breaks: number[];
  dates: string[];
  supF: number;
  supFDate: string;
  significant: boolean;
  /** Intercept and slope in each regime. */
  regimes: Array<{ from: string; to: string; intercept: number; slope: number; n: number }>;
  bic: number[];
  n: number;
  minSize: number;
}

export function breaksTest(pairs: Pair[]): BreaksResult | Failed {
  const n = pairs.length;
  const h = Math.max(5, Math.floor(BREAK_TRIM * n));
  if (n < 2 * h || n < 30) return { error: `Only ${n} overlapping points; the break test needs at least 30.` };
  const cx = [0];
  const cy = [0];
  const cxx = [0];
  const cxy = [0];
  const cyy = [0];
  pairs.forEach((p, i) => {
    cx.push(cx[i] + p.x);
    cy.push(cy[i] + p.y);
    cxx.push(cxx[i] + p.x * p.x);
    cxy.push(cxy[i] + p.x * p.y);
    cyy.push(cyy[i] + p.y * p.y);
  });
  /** Sum of squares and fit of the regression on rows i..j (inclusive). */
  const seg = (i: number, j: number) => {
    const m = j - i + 1;
    const sx = cx[j + 1] - cx[i];
    const sy = cy[j + 1] - cy[i];
    const sxx = cxx[j + 1] - cxx[i] - (sx * sx) / m;
    const sxy = cxy[j + 1] - cxy[i] - (sx * sy) / m;
    const syy = cyy[j + 1] - cyy[i] - (sy * sy) / m;
    const slope = sxx > 1e-12 ? sxy / sxx : 0;
    return { ssr: Math.max(0, syy - slope * sxy), slope, intercept: (sy - slope * sx) / m, m };
  };
  const ssr = (i: number, j: number) => seg(i, j).ssr;
  const maxM = Math.min(MAX_BREAKS, Math.floor(n / h) - 1);
  // best[m][j]: least SSR splitting rows 0..j into m + 1 regimes, each at least h long; arg holds the last break.
  const best: number[][] = [Array.from({ length: n }, (_, j) => (j >= h - 1 ? ssr(0, j) : Infinity))];
  const arg: number[][] = [new Array(n).fill(-1)];
  for (let m = 1; m <= maxM; m++) {
    best.push(new Array(n).fill(Infinity));
    arg.push(new Array(n).fill(-1));
    for (let j = (m + 1) * h - 1; j < n; j++)
      for (let b = m * h - 1; b <= j - h; b++) {
        const v = best[m - 1][b] + ssr(b + 1, j);
        if (v < best[m][j]) {
          best[m][j] = v;
          arg[m][j] = b;
        }
      }
  }
  const q = 2;
  const bic = best.map((row, m) => Math.log(row[n - 1] / n) + (((m + 1) * q + m) * Math.log(n)) / n);
  // sup-F for one break against none.
  const ssr0 = best[0][n - 1];
  let supF = 0;
  let supAt = -1;
  for (let b = h - 1; b <= n - 1 - h; b++) {
    const s1 = ssr(0, b) + ssr(b + 1, n - 1);
    const F = ((ssr0 - s1) / q) / (s1 / (n - 2 * q));
    if (F > supF) {
      supF = F;
      supAt = b;
    }
  }
  const significant = supF > SUPF_CRIT_5;
  // The number of breaks by BIC, but none unless sup-F rejects no break (Bai and Perron's advice).
  let m = 0;
  if (significant) for (let k = 1; k <= maxM; k++) if (bic[k] < bic[m]) m = k;
  const breaks: number[] = [];
  for (let k = m, j = n - 1; k > 0; k--) {
    const b = arg[k][j];
    breaks.unshift(b);
    j = b;
  }
  const edges = [-1, ...breaks, n - 1];
  const regimes = edges.slice(1).map((e, i) => {
    const s = seg(edges[i] + 1, e);
    return { from: pairs[edges[i] + 1].date, to: pairs[e].date, intercept: s.intercept, slope: s.slope, n: s.m };
  });
  return { breaks, dates: breaks.map((b) => pairs[b].date), supF, supFDate: supAt >= 0 ? pairs[supAt].date : '', significant, regimes, bic, n, minSize: h };
}

export const LAB_REFERENCES = [
  'Newey, W. K. and West, K. D. (1987), Econometrica 55(3), 703-708.',
  'Sims, C. A. (1980), "Macroeconomics and Reality", Econometrica 48(1), 1-48; Lütkepohl, H. (2005), New Introduction to Multiple Time Series Analysis, Springer.',
  'Jordà, Ò. (2005), "Estimation and Inference of Impulse Responses by Local Projections", American Economic Review 95(1), 161-182.',
  'Johansen, S. (1991), Econometrica 59(6), 1551-1580; MacKinnon, J. G., Haug, A. A. and Michelis, L. (1999), Journal of Applied Econometrics 14(5), 563-577.',
  'Chow, G. C. (1960), Econometrica 28(3), 591-605; Bai, J. and Perron, P. (1998), Econometrica 66(1), 47-78, and (2003), Journal of Applied Econometrics 18(1), 1-22.',
];
