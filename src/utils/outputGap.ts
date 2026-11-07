/**
 * Output gap per country, estimated by the app from official real GDP growth (Sam, 2026-11-05).
 *
 * The IMF DataMapper does not publish an output gap series (NGAP_NPGDP comes back empty for every
 * country the app covers), so the app estimates one with three standard, stated filters on the
 * same input and shows all three:
 *
 *   - Hodrick-Prescott, lambda 100: the long-standing default for annual data.
 *   - Hodrick-Prescott, lambda 6.25: Ravn and Uhlig (2002)'s value for annual data.
 *   - Hamilton (2018) regression filter, annual form (h = 2 years, p = 1): the gap in year t is
 *     what log real GDP in t was above or below a regression on its value two years earlier.
 *
 * Input: log real GDP, chained from IMF World Economic Outlook real GDP growth (NGDP_RPCH), from
 * the full history the app saves (data/history/<ISO3>.json). The HP trend is run over the IMF's
 * own projections too, a common way to ease the filter's end-point problem, and the years that
 * are projections say so. Hamilton only uses the past, so it needs no projections.
 *
 * The reading is the middle (median) of the three; the band is the lowest to the highest. Filters
 * on GDP alone are rough: they are revised as new years arrive, and the newest years move most.
 * A stated method on official data, not an official estimate and not a forecast.
 *
 * Browser-safe.
 */
import type { SeriesPoint } from './seriesHistory';

export const OUTPUT_GAP_SOURCE = 'IMF World Economic Outlook real GDP growth (NGDP_RPCH)';
export const HP_LAMBDAS = [100, 6.25] as const;
export const HAMILTON_H = 2;
/** Fewest outturn years before any filter is run. */
export const MIN_YEARS = 15;

export const OUTPUT_GAP_REFERENCES = [
  'Hodrick, R. J. and Prescott, E. C. (1997), "Postwar U.S. Business Cycles: An Empirical Investigation", Journal of Money, Credit and Banking 29(1), 1-16.',
  'Ravn, M. O. and Uhlig, H. (2002), "On Adjusting the Hodrick-Prescott Filter for the Frequency of Observations", Review of Economics and Statistics 84(2), 371-376.',
  'Hamilton, J. D. (2018), "Why You Should Never Use the Hodrick-Prescott Filter", Review of Economics and Statistics 100(5), 831-843.',
];

export interface GapYear {
  year: string;
  hp100?: number;
  hp625?: number;
  hamilton?: number;
  /** Median of the methods that have a value this year. */
  central?: number;
  low?: number;
  high?: number;
  /** True when this year's GDP is an IMF projection, not an outturn. */
  projection: boolean;
}

export interface OutputGapEstimate {
  ok: true;
  /** Oldest first; years where at least one filter has a value. */
  years: GapYear[];
  /** The newest outturn year (not a projection) with a reading. */
  latest: GapYear & { central: number; low: number; high: number };
  method: string;
  source: string;
  /** Saved-history download time (ISO), for "as of". */
  pulledAt?: string;
  firstYear: string;
  lastOutturnYear: string;
}

export type OutputGapResult = OutputGapEstimate | { ok: false; reason: string };

const r2 = (v: number) => Number(v.toFixed(2));

/**
 * HP trend of y for smoothing parameter lambda: solves (I + lambda D'D) tau = y with D the second
 * difference operator. The matrix is symmetric pentadiagonal; solved by banded LDL' elimination.
 */
export function hpTrend(y: number[], lambda: number): number[] {
  const n = y.length;
  if (n < 3) return y.slice();
  // Band of A = I + lambda * D'D: diagonal a, first off-diagonal b, second off-diagonal c.
  const a = new Array<number>(n).fill(0);
  const b = new Array<number>(n).fill(0);
  const c = new Array<number>(n).fill(0);
  for (let i = 0; i < n - 2; i++) {
    // Row i of D is [1, -2, 1] at columns i, i+1, i+2; D'D adds its outer product.
    const idx = [i, i + 1, i + 2];
    const w = [1, -2, 1];
    for (let p = 0; p < 3; p++) {
      for (let q = p; q < 3; q++) {
        const v = lambda * w[p] * w[q];
        const r = idx[p];
        const k = idx[q] - idx[p];
        if (k === 0) a[r] += v;
        else if (k === 1) b[r] += v;
        else c[r] += v;
      }
    }
  }
  for (let i = 0; i < n; i++) a[i] += 1;
  // Full banded Gaussian elimination (no pivoting needed: A is symmetric positive definite).
  const M: number[][] = Array.from({ length: n }, () => new Array<number>(5).fill(0)); // cols: -2,-1,0,+1,+2
  for (let i = 0; i < n; i++) {
    M[i][2] = a[i];
    if (i + 1 < n) M[i][3] = b[i];
    if (i + 2 < n) M[i][4] = c[i];
    if (i - 1 >= 0) M[i][1] = b[i - 1];
    if (i - 2 >= 0) M[i][0] = c[i - 2];
  }
  const rhs = y.slice();
  for (let k = 0; k < n; k++) {
    const piv = M[k][2];
    for (let i = k + 1; i <= Math.min(k + 2, n - 1); i++) {
      const off = k - i + 2; // column index of A[i][k] in row i's band
      const f = M[i][off] / piv;
      if (!f) continue;
      for (let j = k; j <= Math.min(k + 2, n - 1); j++) M[i][j - i + 2] -= f * M[k][j - k + 2];
      rhs[i] -= f * rhs[k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = rhs[i];
    for (let j = i + 1; j <= Math.min(i + 2, n - 1); j++) s -= M[i][j - i + 2] * x[j];
    x[i] = s / M[i][2];
  }
  return x;
}

/**
 * Hamilton (2018) cycle with p = 1: regress y[t] on a constant and y[t-h] by least squares; the
 * cycle is the residual. The first h years have none.
 */
export function hamiltonCycle(y: number[], h = HAMILTON_H): Array<number | undefined> {
  const n = y.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  if (n < h + 3) return out;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let t = h; t < n; t++) {
    xs.push(y[t - h]);
    ys.push(y[t]);
  }
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const beta = sxx ? sxy / sxx : 0;
  const alpha = my - beta * mx;
  for (let t = h; t < n; t++) out[t] = y[t] - (alpha + beta * y[t - h]);
  return out;
}

/** Log real GDP (x100, so differences read as %) chained from yearly growth rates. */
export function logLevelFromGrowth(points: SeriesPoint[]): Array<{ year: string; y: number; projection: boolean }> {
  const out: Array<{ year: string; y: number; projection: boolean }> = [];
  let level = 0;
  let prevYear: number | undefined;
  for (const p of points) {
    const yr = Number(p.date);
    if (!Number.isFinite(p.value) || !Number.isFinite(yr)) continue;
    // A gap in years breaks the chain: start again after it rather than bridge it.
    if (prevYear !== undefined && yr !== prevYear + 1) {
      out.length = 0;
      level = 0;
    }
    level += 100 * Math.log(1 + p.value / 100);
    out.push({ year: String(yr), y: level, projection: p.note === 'IMF projection' });
    prevYear = yr;
  }
  return out;
}

function median(vs: number[]): number {
  const s = vs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * The estimate from yearly real growth points (oldest first; IMF projections carry the note
 * "IMF projection", as src/utils/officialHistory.ts marks them).
 */
export function outputGapFromGrowth(points: SeriesPoint[] | undefined, opts: { pulledAt?: string } = {}): OutputGapResult {
  if (!points?.length) return { ok: false, reason: 'No IMF real GDP growth history saved for this country yet (Menu > Offline data, or open History & data while online)' };
  const lv = logLevelFromGrowth(points);
  const outturns = lv.filter((p) => !p.projection);
  if (outturns.length < MIN_YEARS) return { ok: false, reason: `Only ${outturns.length} unbroken years of IMF real GDP growth; the filters need at least ${MIN_YEARS}` };
  const y = lv.map((p) => p.y);
  const hp = HP_LAMBDAS.map((l) => hpTrend(y, l));
  // Hamilton on outturns only: it looks back, so projections add nothing to past years.
  const ham = hamiltonCycle(outturns.map((p) => p.y));
  const hamByYear = new Map(outturns.map((p, i) => [p.year, ham[i]]));
  const years: GapYear[] = lv.map((p, i) => {
    const hp100 = r2(y[i] - hp[0][i]);
    const hp625 = r2(y[i] - hp[1][i]);
    const h = hamByYear.get(p.year);
    const hamilton = h === undefined ? undefined : r2(h);
    const vals = [hp100, hp625, ...(hamilton === undefined ? [] : [hamilton])];
    return {
      year: p.year,
      hp100,
      hp625,
      ...(hamilton !== undefined ? { hamilton } : {}),
      central: r2(median(vals)),
      low: r2(Math.min(...vals)),
      high: r2(Math.max(...vals)),
      projection: p.projection,
    };
  });
  const latest = [...years].reverse().find((g) => !g.projection && g.hamilton !== undefined) || [...years].reverse().find((g) => !g.projection)!;
  return {
    ok: true,
    years,
    latest: latest as OutputGapEstimate['latest'],
    method: outputGapMethod(),
    source: OUTPUT_GAP_SOURCE,
    ...(opts.pulledAt ? { pulledAt: opts.pulledAt } : {}),
    firstYear: lv[0].year,
    lastOutturnYear: outturns[outturns.length - 1].year,
  };
}

export function outputGapMethod(): string {
  return `Estimated by the app: log real GDP chained from ${OUTPUT_GAP_SOURCE}; middle of three filters (HP lambda 100, HP lambda 6.25, Hamilton h=2 p=1), band = lowest to highest; HP run through IMF projections to ease the end point`;
}

const sg = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;

/** One line for chat, documents and the Taylor check. */
export function outputGapSentence(e: OutputGapEstimate): string {
  const g = e.latest;
  const side = g.central > 0.5 ? 'above potential' : g.central < -0.5 ? 'below potential' : 'close to potential';
  return `Output gap ${g.year}: ${sg(g.central)}% of potential GDP (band ${sg(g.low)} to ${sg(g.high)}), ${side}; estimated by the app from IMF real GDP growth, not an official figure.`;
}

/**
 * The estimate as a History series (id 'output_gap', annual), so the History tab, downloads and the
 * Taylor-gap chart use it where the IMF has no output gap. Projection years keep their note.
 */
export function outputGapSeries(e: OutputGapEstimate): import('./seriesHistory').Series {
  return {
    id: 'output_gap',
    label: 'Output gap (app estimate)',
    unit: '% of potential GDP',
    freq: 'annual',
    source: `App estimate from ${OUTPUT_GAP_SOURCE}`,
    ...(e.pulledAt ? { pulledAt: e.pulledAt } : {}),
    points: e.years.filter((g) => g.central !== undefined).map((g) => ({ date: g.year, value: g.central!, ...(g.projection ? { note: 'IMF projection' } : {}) })),
    about: `${e.method}. Not an official figure; the newest years move most as new data arrive.`,
  };
}

export interface RealTimeGapYear {
  year: string;
  /** End-point HP lambda 100 gap, using only years up to and including this one. */
  hp100: number;
  /** Hamilton gap with its regression fitted only on years up to and including this one. */
  hamilton?: number;
}

/**
 * One-sided ("real-time") output gap for backtests: for each year t, the filters are run on outturns
 * up to t only, and the gap read at t, so no later year leaks in. IMF projections are never used.
 * Caveat: the inputs are today's IMF vintage of past growth, not what was published at the time, so
 * revisions to GDP still leak in; only the filter's look-ahead is removed. Annual, so a monthly
 * backtest should apply year t's value from when that year's outturn was published, not from January.
 */
export function realTimeOutputGap(points: SeriesPoint[] | undefined, minYears = MIN_YEARS): RealTimeGapYear[] {
  if (!points?.length) return [];
  const outturns = logLevelFromGrowth(points).filter((p) => !p.projection);
  const out: RealTimeGapYear[] = [];
  for (let end = minYears; end <= outturns.length; end++) {
    const y = outturns.slice(0, end).map((p) => p.y);
    const hp = hpTrend(y, 100);
    const ham = hamiltonCycle(y);
    const h = ham[end - 1];
    out.push({ year: outturns[end - 1].year, hp100: r2(y[end - 1] - hp[end - 1]), ...(h !== undefined ? { hamilton: r2(h) } : {}) });
  }
  return out;
}
