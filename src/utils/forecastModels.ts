/**
 * Nowcasting and forecasting models (Sam, 2026-11-06: "I want both nowcasting and forecasting").
 *
 * - A nowcast estimates a period that has ended (or is under way) but whose official figure is not
 *   out yet, from higher-frequency figures already published. Here: a bridge equation, the quarter's
 *   figure regressed on quarterly averages of monthly indicators.
 * - A forecast projects periods that have not happened, with a band for how unsure it is. Here: an
 *   autoregression (AR), on the level or on the change (ARIMA(p,1,0)), lag order picked by BIC.
 *
 * Every function is pure and deterministic, works on real observations only and never fills a
 * value in: a series too short to fit returns { error } with the reason. Bands are the model's own
 * forecast-error spread under normal errors (parameter uncertainty is left out, which makes them
 * somewhat too narrow; the out-of-sample evaluation reports how often they actually held).
 *
 * Browser-safe, no I/O.
 */
import { ols, type Failed } from './stats';

export const MODEL_LABEL = 'App model, not validated advice';

/** Normal quantiles for the bands a fan chart shows: 50%, 70% and 90% central bands. */
export const BAND_Z = { 50: 0.6745, 70: 1.0364, 90: 1.6449 } as const;
export type BandLevel = keyof typeof BAND_Z;

export interface Prediction {
  mean: number;
  /** Standard deviation of the forecast error; absent when the method gives none (a naive benchmark). */
  sd?: number;
}

export interface Band {
  level: BandLevel;
  lo: number;
  hi: number;
}

export function bandsFor(p: Prediction, levels: BandLevel[] = [50, 70, 90]): Band[] {
  if (p.sd === undefined || !Number.isFinite(p.sd)) return [];
  return levels.map((level) => ({ level, lo: p.mean - BAND_Z[level] * p.sd!, hi: p.mean + BAND_Z[level] * p.sd! }));
}

/* ------------------------------------------------------------------ autoregression */

export interface ArFit {
  /** Lag order. */
  p: number;
  /** 0 = on the level, 1 = on the period-to-period change (ARIMA(p,1,0)). */
  d: 0 | 1;
  /** Intercept first, then phi_1 .. phi_p. */
  coef: number[];
  /** Residual standard deviation (degrees-of-freedom corrected). */
  sigma: number;
  /** Observations used in the fit. */
  n: number;
  bic: number;
}

/** Fewest observations (after lags) an AR is fitted on. */
export const MIN_AR_OBS = 16;

const diff = (y: number[]) => y.slice(1).map((v, i) => v - y[i]);

/** Least squares AR(p) on z, using z[start..] as the left-hand side. */
function fitArOn(z: number[], p: number, start: number, intercept = true): (Omit<ArFit, 'd'>) | Failed {
  const Y: number[] = [];
  const X: number[][] = [];
  for (let t = start; t < z.length; t++) {
    Y.push(z[t]);
    X.push(Array.from({ length: p }, (_, i) => z[t - 1 - i]));
  }
  if (Y.length < MIN_AR_OBS) return { error: `Only ${Y.length} usable observations; an AR(${p}) needs at least ${MIN_AR_OBS}.` };
  if (!intercept) {
    // coef[0] stays 0 so forecastAr reads it the same way.
    const n = Y.length;
    if (p === 0) {
      const rss = Y.reduce((s, v) => s + v * v, 0);
      return { p: 0, coef: [0], sigma: Math.sqrt(rss / n), n, bic: n * Math.log(Math.max(rss, 1e-12) / n) };
    }
    const phi = leastSquares(Y, X);
    if (!phi) return { error: 'The lags move together exactly, so the model cannot be solved.' };
    const rss = Y.reduce((s, v, t) => s + (v - X[t].reduce((a, x, i) => a + x * phi[i], 0)) ** 2, 0);
    return { p, coef: [0, ...phi], sigma: Math.sqrt(rss / Math.max(1, n - p)), n, bic: n * Math.log(Math.max(rss, 1e-12) / n) + p * Math.log(n) };
  }
  if (p === 0) {
    const m = Y.reduce((a, b) => a + b, 0) / Y.length;
    const rss = Y.reduce((s, v) => s + (v - m) ** 2, 0);
    const n = Y.length;
    return { p: 0, coef: [m], sigma: Math.sqrt(rss / Math.max(1, n - 1)), n, bic: n * Math.log(Math.max(rss, 1e-12) / n) + Math.log(n) };
  }
  const r = ols(Y, X);
  if ('error' in r) return r;
  const n = r.n;
  return { p, coef: r.coef, sigma: Math.sqrt(r.rss / Math.max(1, n - r.k)), n, bic: n * Math.log(Math.max(r.rss, 1e-12) / n) + r.k * Math.log(n) };
}

/** Least squares without an intercept (normal equations, Gaussian elimination). Null when singular. */
function leastSquares(Y: number[], X: number[][]): number[] | null {
  const k = X[0].length;
  const A = Array.from({ length: k }, (_, i) => [...Array.from({ length: k }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0)), X.reduce((s, r, t) => s + r[i] * Y[t], 0)]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-12) return null;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j];
    }
  }
  return A.map((row, i) => row[k] / row[i]);
}

/**
 * AR with the lag order (0 to maxLag) that has the lowest BIC, every order fitted on the same
 * observations so the BICs compare. d = 1 fits on the changes. intercept = false leaves out the
 * constant (on the changes: no drift, so the forecast does not carry a past trend on for ever).
 */
export function fitAr(y: number[], opts: { maxLag: number; d?: 0 | 1; intercept?: boolean }): ArFit | Failed {
  const d = opts.d ?? 0;
  if (y.some((v) => !Number.isFinite(v))) return { error: 'The series has a gap or a non-number; the model needs an unbroken run.' };
  const z = d === 1 ? diff(y) : y;
  let best: (Omit<ArFit, 'd'>) | null = null;
  let firstError: Failed | null = null;
  for (let p = 0; p <= opts.maxLag; p++) {
    const f = fitArOn(z, p, opts.maxLag, opts.intercept ?? true);
    if ('error' in f) {
      firstError ??= f;
      continue;
    }
    if (!best || f.bic < best.bic - 1e-9) best = f;
  }
  if (!best) return firstError ?? { error: 'The model could not be fitted.' };
  return { ...best, d };
}

/** psi weights of the AR's moving-average form: psi_0 = 1, psi_j = sum phi_i psi_{j-i}. */
export function psiWeights(phi: number[], n: number): number[] {
  const psi = [1];
  for (let j = 1; j < n; j++) {
    let s = 0;
    for (let i = 1; i <= Math.min(j, phi.length); i++) s += phi[i - 1] * psi[j - i];
    psi.push(s);
  }
  return psi;
}

/**
 * Forecasts 1..h periods after the last value of y, with the forecast-error standard deviation of
 * each step. For d = 1 the changes are forecast and added up, and the spread grows accordingly.
 */
export function forecastAr(fit: ArFit, y: number[], h: number): Prediction[] {
  const z = fit.d === 1 ? diff(y) : y.slice();
  const [c, ...phi] = fit.coef;
  const path = z.slice();
  const zf: number[] = [];
  for (let s = 0; s < h; s++) {
    let v = c;
    for (let i = 0; i < phi.length; i++) v += phi[i] * path[path.length - 1 - i];
    path.push(v);
    zf.push(v);
  }
  const psi = psiWeights(phi, h);
  const out: Prediction[] = [];
  if (fit.d === 0) {
    let acc = 0;
    for (let s = 0; s < h; s++) {
      acc += psi[s] ** 2;
      out.push({ mean: zf[s], sd: fit.sigma * Math.sqrt(acc) });
    }
    return out;
  }
  // Level = last level + cumulated changes; its error weights are the running sums of psi.
  let level = y[y.length - 1];
  let cum = 0;
  let acc = 0;
  for (let s = 0; s < h; s++) {
    level += zf[s];
    cum += psi[s];
    acc += cum ** 2;
    out.push({ mean: level, sd: fit.sigma * Math.sqrt(acc) });
  }
  return out;
}

/* ------------------------------------------------------------------ bridge equation (nowcast) */

export interface BridgeFit {
  /** Intercept, one per indicator, then one per lag of the target. */
  coef: number[];
  sigma: number;
  n: number;
  r2: number;
  indicators: string[];
  targetLags: number;
}

/**
 * Bridge equation: y_t = a + sum b_k x_k,t + sum c_j y_{t-j}. Rows with any missing value are left
 * out of the fit (never filled). X[t] holds the indicators for period t, aligned with y.
 */
export function fitBridge(y: Array<number | null>, X: Array<Array<number | null>>, opts: { indicators: string[]; targetLags: number }): BridgeFit | Failed {
  const Y: number[] = [];
  const R: number[][] = [];
  for (let t = opts.targetLags; t < y.length; t++) {
    const lags = Array.from({ length: opts.targetLags }, (_, j) => y[t - 1 - j]);
    const row = [...(X[t] ?? []), ...lags];
    const yt = y[t];
    if (yt === null || !Number.isFinite(yt) || row.length !== opts.indicators.length + opts.targetLags || row.some((v) => v === null || !Number.isFinite(v as number))) continue;
    Y.push(yt);
    R.push(row as number[]);
  }
  if (Y.length < MIN_AR_OBS) return { error: `Only ${Y.length} quarters have the target and every indicator; the bridge equation needs at least ${MIN_AR_OBS}.` };
  const r = ols(Y, R);
  if ('error' in r) return r;
  return { coef: r.coef, sigma: Math.sqrt(r.rss / Math.max(1, r.n - r.k)), n: r.n, r2: r.r2, indicators: opts.indicators, targetLags: opts.targetLags };
}

/** The bridge equation's estimate for one period, from that period's indicators and the target's earlier values (most recent first). */
export function predictBridge(fit: BridgeFit, x: number[], lagsRecentFirst: number[]): Prediction | Failed {
  if (x.length !== fit.indicators.length || lagsRecentFirst.length < fit.targetLags) return { error: 'An indicator or an earlier value of the target is missing for this period.' };
  const row = [...x, ...lagsRecentFirst.slice(0, fit.targetLags)];
  if (row.some((v) => !Number.isFinite(v))) return { error: 'An indicator or an earlier value of the target is missing for this period.' };
  return { mean: fit.coef[0] + row.reduce((s, v, i) => s + v * fit.coef[i + 1], 0), sd: fit.sigma };
}

/* ------------------------------------------------------------------ periods and publication lags */

export interface DatedPoint {
  /** YYYY-MM, YYYY-Qn or YYYY. */
  date: string;
  value: number;
}

/** Last day of a period (YYYY-MM-DD). */
export function periodEnd(date: string): string {
  if (/^\d{4}$/.test(date)) return `${date}-12-31`;
  const q = /^(\d{4})-Q([1-4])$/i.exec(date);
  const [y, m] = q ? [Number(q[1]), Number(q[2]) * 3] : [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Adds days to a YYYY-MM-DD date. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The points a reader could have seen on asOf, when each period comes out lagDays after it ends.
 * This is the published-data-only rule: nothing from after the As-of date is used. Values are
 * today's vintage (later revisions included), which the caller must say.
 */
export function publishedBy<T extends DatedPoint>(points: T[], asOf: string, lagDays: number): T[] {
  return points.filter((p) => addDays(periodEnd(p.date), lagDays) <= asOf);
}

/** Quarter of a monthly date: "2026-05" -> "2026-Q2". */
export const quarterOf = (month: string) => `${month.slice(0, 4)}-Q${Math.ceil(Number(month.slice(5, 7)) / 3)}`;

/** The three months of a quarter. */
export function monthsOf(quarter: string): string[] {
  const y = quarter.slice(0, 4);
  const q = Number(quarter.slice(-1));
  return [1, 2, 3].map((k) => `${y}-${String((q - 1) * 3 + k).padStart(2, '0')}`);
}

export interface QuarterAverage {
  quarter: string;
  value: number;
  /** Months of the quarter that are published. */
  monthsPublished: number;
  /** Months that are a forecast of the monthly indicator (ragged edge), not a published figure. */
  monthsForecast: number;
}

/**
 * Quarterly averages of a monthly indicator. A quarter with all three months published averages
 * them. For the newest quarter(s) with only some months out (the ragged edge), the missing months
 * are an AR forecast of the monthly series when fill = 'ar' (said in monthsForecast), else the
 * quarter is left out. Quarters with a month missing in the middle of the history are left out.
 */
export function quarterlyFromMonthly(points: DatedPoint[], opts: { fill?: 'ar' | 'none'; maxLag?: number; fillUpTo?: string } = {}): QuarterAverage[] {
  const byMonth = new Map(points.map((p) => [p.date, p.value]));
  const months = [...byMonth.keys()].sort();
  if (!months.length) return [];
  const last = months[months.length - 1];
  const quarters = [...new Set(months.map(quarterOf))].sort();
  if (opts.fillUpTo && opts.fillUpTo > quarters[quarters.length - 1]) {
    let q = quarters[quarters.length - 1];
    while (q < opts.fillUpTo) {
      const y = Number(q.slice(0, 4));
      const n = Number(q.slice(-1));
      q = n === 4 ? `${y + 1}-Q1` : `${y}-Q${n + 1}`;
      quarters.push(q);
    }
  }
  // Monthly forecast for the ragged edge, from the unbroken run that ends at the newest month.
  const filled = new Map<string, number>();
  if (opts.fill === 'ar') {
    const run: number[] = [];
    let m = last;
    while (byMonth.has(m)) {
      run.unshift(byMonth.get(m)!);
      const [y, mm] = m.split('-').map(Number);
      m = new Date(Date.UTC(y, mm - 2, 1)).toISOString().slice(0, 7);
    }
    const lastQ = quarters[quarters.length - 1];
    const need = monthsOf(lastQ).filter((x) => x > last);
    const steps = need.length ? monthsBetween(last, need[need.length - 1]) : 0;
    if (steps > 0) {
      const fit = fitAr(run, { maxLag: opts.maxLag ?? 3 });
      if (!('error' in fit)) {
        const f = forecastAr(fit, run, steps);
        for (let s = 1; s <= steps; s++) filled.set(addMonthsTo(last, s), f[s - 1].mean);
      }
    }
  }
  const out: QuarterAverage[] = [];
  for (const q of quarters) {
    const ms = monthsOf(q);
    const vals: number[] = [];
    let pub = 0;
    let fc = 0;
    for (const m of ms) {
      if (byMonth.has(m)) {
        vals.push(byMonth.get(m)!);
        pub++;
      } else if (m > last && filled.has(m)) {
        vals.push(filled.get(m)!);
        fc++;
      }
    }
    if (vals.length === 3 && pub > 0) out.push({ quarter: q, value: vals.reduce((a, b) => a + b, 0) / 3, monthsPublished: pub, monthsForecast: fc });
  }
  return out;
}

export function addMonthsTo(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}
