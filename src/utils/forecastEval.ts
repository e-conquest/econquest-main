/**
 * Out-of-sample evaluation of the nowcast and forecast models (Sam, 2026-11-06). A model is marked
 * passed or failed only by an evaluation whose model, sample, horizons, benchmark and pass mark were
 * written down and hashed (docs/validation/forecasts/*.json, hashes in manifest.json) before it ran.
 * A failed model shows as failed and is never tuned afterwards; a changed rule is a new version.
 *
 * Method: rolling origin. At each origin the model is fitted only on what came before (expanding
 * window, or the last `window` periods), forecasts each horizon, and the error is recorded against
 * the value that came out. The benchmark is fitted the same way. The score is the relative RMSE
 * (model RMSE / benchmark RMSE, all series pooled): below 1 means the model beat the benchmark.
 *
 * Errors close in time are not independent (one recession moves every series), so, as with method 2
 * of the signal backtests, whole calendar years of cases are resampled together (block bootstrap,
 * fixed seed: every run gives the same answer). That gives a 90% range for the relative RMSE and a
 * one-sided p-value (share of resamples where the model did not beat the benchmark). The model must
 * also beat the benchmark in at least the stated share of series. The Diebold-Mariano test (with the
 * Harvey-Leybourne-Newbold small-sample correction) is reported per series, for reference.
 *
 * Also reported: how often the model's 70% and 90% bands held the outcome (coverage).
 *
 * Pure functions, browser-safe.
 */
import { seededRandom } from './backtest';
import { tPValue } from './stats';
import { BAND_Z, fitAr, forecastAr, type Prediction } from './forecastModels';

export type ForecastTarget = 'gdp_growth_q' | 'cpi_yoy_m' | 'policy_rate_m' | 'debt_gdp_a' | 'gdp_nowcast_q' | 'cpi_nowcast_m';
export type BenchmarkKind = 'naive' | 'mean';

export interface ForecastSpec {
  id: string;
  version: number;
  registeredOn: string;
  registeredBy: string;
  hypothesis: string;
  target: ForecastTarget;
  /** Model settings, fixed before the run (maxLag, d, window, release lags...). */
  params: Record<string, number>;
  benchmark: BenchmarkKind;
  /** Steps ahead judged (periods of the target's own frequency). */
  horizons: number[];
  /** First and last origin (period keys). */
  sample: { from: string; to?: string };
  passMark: { maxRelRmse: number; maxPValue: number; minSeriesShare: number; minCasesPerHorizon: number; minYears: number };
  knownLimits: string[];
  retestOf?: { version: number; verdict: string; change: string };
}

export interface ForecastCase {
  where: string;
  /** Last period known at the origin. */
  origin: string;
  /** Period forecast. */
  target: string;
  h: number;
  actual: number;
  model: Prediction;
  bench: Prediction;
}

export interface HorizonScore {
  h: number;
  cases: number;
  years: number;
  rmseModel: number;
  rmseBench: number;
  relRmse: number;
  /** 90% range of the relative RMSE from resampling whole years. */
  relRmseRange: [number, number];
  /** Share of resamples with relative RMSE at or above 1 (model no better than the benchmark). */
  pValue: number;
  seriesTested: number;
  seriesBeat: number;
  /** Share of outcomes inside the model's 70% and 90% bands. */
  coverage70: number | null;
  coverage90: number | null;
  bySeries: Array<{ where: string; cases: number; relRmse: number; dm: number | null; dmPValue: number | null }>;
}

export interface ForecastResult {
  id: string;
  specVersion: number;
  specHash: string;
  ranAt: string;
  status: 'passed' | 'failed' | 'too_few_cases';
  verdict: string;
  horizons: HorizonScore[];
  span: { from: string; to: string };
  series: string[];
  data: string;
  /** A few cases, newest first, so a reader can check them. */
  sample: ForecastCase[];
  /** The test's own p where it is not a horizon's relative-RMSE p (the fan coverage test). */
  pValue?: number;
  /** Fan coverage test only (src/utils/fanCoverage.ts): coverage by horizon, editions used, sample cases. */
  coverage?: import('./fanCoverage').FanCoverageHorizon[];
  origins?: string[];
  fanSample?: import('./fanCoverage').FanCase[];
}

/* ------------------------------------------------------------------ case generators */

export interface PlainSeries {
  where: string;
  /** Period keys, oldest first, unbroken (no missing periods). */
  dates: string[];
  values: number[];
}

/** Longest unbroken run of periods (each date the next period after the one before) that ends at the last point. */
export function unbrokenTail(s: PlainSeries, next: (d: string) => string): PlainSeries {
  let i = s.dates.length - 1;
  while (i > 0 && next(s.dates[i - 1]) === s.dates[i]) i--;
  return { where: s.where, dates: s.dates.slice(i), values: s.values.slice(i) };
}

/**
 * Rolling-origin cases for the AR forecast against a benchmark. At each origin from sample.from
 * (and with at least minTrain periods before it) the AR is refitted on data up to the origin only.
 */
export function arForecastCases(series: PlainSeries[], spec: Pick<ForecastSpec, 'params' | 'benchmark' | 'horizons' | 'sample'>): ForecastCase[] {
  const maxLag = spec.params.maxLag ?? 4;
  const d = (spec.params.d ?? 0) as 0 | 1;
  const intercept = (spec.params.intercept ?? 1) !== 0;
  const window = spec.params.window ?? 0;
  const minTrain = spec.params.minTrain ?? 40;
  const maxH = Math.max(...spec.horizons);
  const out: ForecastCase[] = [];
  for (const s of series) {
    for (let i = 0; i < s.dates.length; i++) {
      const origin = s.dates[i];
      if (origin < spec.sample.from || (spec.sample.to && origin > spec.sample.to)) continue;
      if (i + 1 < minTrain) continue;
      const train = window > 0 ? s.values.slice(Math.max(0, i + 1 - window), i + 1) : s.values.slice(0, i + 1);
      const fit = fitAr(train, { maxLag, d, intercept });
      if ('error' in fit) continue;
      const f = forecastAr(fit, train, maxH);
      for (const h of spec.horizons) {
        if (i + h >= s.values.length) continue;
        out.push({ where: s.where, origin, target: s.dates[i + h], h, actual: s.values[i + h], model: f[h - 1], bench: benchmark(spec.benchmark, train) });
      }
    }
  }
  return out;
}

/** Naive = the last value carries on (random walk); mean = the average of everything known so far. */
export function benchmark(kind: BenchmarkKind, train: number[]): Prediction {
  if (kind === 'mean') return { mean: train.reduce((a, b) => a + b, 0) / train.length };
  return { mean: train[train.length - 1] };
}

/* ------------------------------------------------------------------ statistics */

const sq = (x: number) => x * x;
const r3 = (x: number) => Number(x.toFixed(3));
const yearOf = (c: ForecastCase) => c.target.slice(0, 4);

function relRmse(cases: ForecastCase[]): { rm: number; rb: number; rel: number } {
  let sm = 0;
  let sb = 0;
  for (const c of cases) {
    sm += sq(c.actual - c.model.mean);
    sb += sq(c.actual - c.bench.mean);
  }
  const rm = Math.sqrt(sm / cases.length);
  const rb = Math.sqrt(sb / cases.length);
  return { rm, rb, rel: rb > 0 ? rm / rb : rm > 0 ? Infinity : 1 };
}

/**
 * Diebold-Mariano statistic on squared-error differences (model minus benchmark), with the
 * Harvey-Leybourne-Newbold correction for horizon h; one-sided p-value that the model is better.
 * Cases must be one series and one horizon, in time order.
 */
export function dieboldMariano(cases: ForecastCase[], h: number): { dm: number; pValue: number } | null {
  const d = cases.map((c) => sq(c.actual - c.model.mean) - sq(c.actual - c.bench.mean));
  const n = d.length;
  if (n < 8) return null;
  const mean = d.reduce((a, b) => a + b, 0) / n;
  const gamma = (k: number) => {
    let s = 0;
    for (let t = k; t < n; t++) s += (d[t] - mean) * (d[t - k] - mean);
    return s / n;
  };
  let v = gamma(0);
  for (let k = 1; k < h; k++) v += 2 * gamma(k);
  if (!(v > 0)) return null;
  const hln = Math.sqrt((n + 1 - 2 * h + (h * (h - 1)) / n) / n);
  const dm = (mean / Math.sqrt(v / n)) * hln;
  const p2 = tPValue(dm, n - 1);
  return { dm: r3(dm), pValue: r3(dm < 0 ? p2 / 2 : 1 - p2 / 2) };
}

export const EVAL_RESAMPLES = 2000;
export const EVAL_SEED = 20261106;

/** Scores one horizon: pooled relative RMSE, year-block bootstrap range and p-value, per-series reading, band coverage. */
export function scoreHorizon(cases: ForecastCase[], h: number, minSeriesCases = 8): HorizonScore {
  const hc = cases.filter((c) => c.h === h);
  const years = [...new Set(hc.map(yearOf))].sort();
  const byYear = new Map<string, ForecastCase[]>();
  for (const c of hc) byYear.set(yearOf(c), [...(byYear.get(yearOf(c)) || []), c]);
  const base = hc.length ? relRmse(hc) : { rm: NaN, rb: NaN, rel: NaN };
  const rand = seededRandom(EVAL_SEED + h);
  const rels: number[] = [];
  if (years.length) {
    for (let b = 0; b < EVAL_RESAMPLES; b++) {
      const draw: ForecastCase[] = [];
      for (let k = 0; k < years.length; k++) draw.push(...byYear.get(years[Math.floor(rand() * years.length)])!);
      rels.push(relRmse(draw).rel);
    }
  }
  rels.sort((a, b) => a - b);
  const pick = (q: number) => (rels.length ? rels[Math.min(rels.length - 1, Math.floor(q * rels.length))] : NaN);
  const wheres = [...new Set(hc.map((c) => c.where))].sort();
  const bySeries = wheres.map((where) => {
    const sc = hc.filter((c) => c.where === where).sort((a, b) => (a.origin < b.origin ? -1 : 1));
    const dm = dieboldMariano(sc, h);
    return { where, cases: sc.length, relRmse: r3(relRmse(sc).rel), dm: dm?.dm ?? null, dmPValue: dm?.pValue ?? null };
  });
  const tested = bySeries.filter((s) => s.cases >= minSeriesCases);
  const withSd = hc.filter((c) => c.model.sd !== undefined && Number.isFinite(c.model.sd));
  const cover = (z: number) => (withSd.length ? r3(withSd.filter((c) => Math.abs(c.actual - c.model.mean) <= z * c.model.sd!).length / withSd.length) : null);
  return {
    h,
    cases: hc.length,
    years: years.length,
    rmseModel: r3(base.rm),
    rmseBench: r3(base.rb),
    relRmse: r3(base.rel),
    relRmseRange: [r3(pick(0.05)), r3(pick(0.95))],
    pValue: rels.length ? r3(rels.filter((r) => r >= 1).length / rels.length) : 1,
    seriesTested: tested.length,
    seriesBeat: tested.filter((s) => s.relRmse < 1).length,
    coverage70: cover(BAND_Z[70]),
    coverage90: cover(BAND_Z[90]),
    bySeries,
  };
}

/** Verdict from the cases under the registered pass mark. Every registered horizon must pass. */
export function judgeForecast(spec: ForecastSpec, specHash: string, cases: ForecastCase[], data: string, ranAt = new Date().toISOString()): ForecastResult {
  const horizons = spec.horizons.map((h) => scoreHorizon(cases, h));
  const pm = spec.passMark;
  const bench = spec.benchmark === 'naive' ? 'the naive benchmark (last value carried on)' : 'the historical-mean benchmark';
  const tooFew = horizons.filter((s) => s.cases < pm.minCasesPerHorizon || s.years < pm.minYears);
  const failing = horizons.filter((s) => !(s.relRmse <= pm.maxRelRmse && s.pValue <= pm.maxPValue && s.seriesTested > 0 && s.seriesBeat / s.seriesTested >= pm.minSeriesShare));
  const desc = (s: HorizonScore) => `${s.h} ahead: relative RMSE ${s.relRmse} (90% range ${s.relRmseRange[0]} to ${s.relRmseRange[1]}, p ${s.pValue}), beat ${bench.split(' (')[0]} in ${s.seriesBeat} of ${s.seriesTested} series`;
  let status: ForecastResult['status'];
  let verdict: string;
  if (tooFew.length) {
    status = 'too_few_cases';
    verdict = `Too few cases to judge: ${tooFew.map((s) => `${s.h} ahead has ${s.cases} cases over ${s.years} years`).join('; ')} (needs ${pm.minCasesPerHorizon} cases over ${pm.minYears} years).`;
  } else if (failing.length) {
    status = 'failed';
    verdict = `Failed against ${bench}. ${horizons.map(desc).join('; ')}. Pass mark: relative RMSE at most ${pm.maxRelRmse}, p at most ${pm.maxPValue}, better in at least ${Math.round(pm.minSeriesShare * 100)}% of series.`;
  } else {
    status = 'passed';
    verdict = `Passed against ${bench}. ${horizons.map(desc).join('; ')}.`;
  }
  const dates = cases.map((c) => c.origin).sort();
  return {
    id: spec.id,
    specVersion: spec.version,
    specHash,
    ranAt,
    status,
    verdict,
    horizons,
    span: { from: dates[0] ?? '', to: dates[dates.length - 1] ?? '' },
    series: [...new Set(cases.map((c) => c.where))].sort(),
    data,
    sample: cases.slice().sort((a, b) => (a.origin < b.origin ? 1 : -1)).slice(0, 12),
  };
}
