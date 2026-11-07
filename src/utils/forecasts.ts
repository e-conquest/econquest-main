/**
 * Forecasts with fan charts (Sam, 2026-11-06): GDP growth, inflation, the policy rate and government
 * debt, one to eight quarters ahead, from a simple fitted model, beside the IMF's own projection
 * where the IMF makes one (labelled as the IMF's, with its vintage).
 *
 * Models (fixed rules, the same ones the pre-registered evaluation tests; never tuned per country):
 * - GDP: AR on quarterly real GDP growth (q/q, OECD quarterly national accounts), lag 0-4 by BIC.
 * - Inflation: AR on monthly y/y inflation, lag 0-13 by BIC (13 lets it read the base effect).
 * - Policy rate: AR on the monthly change in the BIS end-of-month policy rate, lag 0-3 by BIC, no
 *   drift (a past trend in rates is not carried on for ever). Fitted on the last 10 years.
 * - Government debt: AR on the yearly change in IMF debt-to-GDP outturns (IMF projections left
 *   out of the fit), lag 0-2 by BIC, with drift, two years ahead.
 *
 * Bands are 50/70/90% from each model's forecast error (normal, parameter uncertainty left out, so
 * somewhat narrow; the evaluation reports how often they held). A band on the policy rate is not a
 * probability that the bank moves: rates move in steps.
 *
 * Pure, browser-safe.
 */
import { addMonthsTo, bandsFor, fitAr, forecastAr, type Band, type DatedPoint } from './forecastModels';

export const FORECAST_LABEL = 'App forecast, not validated advice';

export type ForecastId = 'gdp_qoq' | 'cpi_yoy' | 'policy_rate' | 'debt_gdp';

export const FORECAST_MODELS: Record<ForecastId, { maxLag: number; d: 0 | 1; intercept: boolean; window: number; steps: number; minObs: number }> = {
  gdp_qoq: { maxLag: 4, d: 0, intercept: true, window: 0, steps: 8, minObs: 40 },
  cpi_yoy: { maxLag: 13, d: 0, intercept: true, window: 120, steps: 24, minObs: 60 },
  policy_rate: { maxLag: 3, d: 1, intercept: false, window: 120, steps: 24, minObs: 60 },
  debt_gdp: { maxLag: 2, d: 1, intercept: false, window: 0, steps: 2, minObs: 20 },
};

export interface FanPoint {
  period: string;
  mean: number;
  sd: number;
  bands: Band[];
}

export interface ImfComparison {
  label: string;
  /** IMF projections for the years the app forecast covers. */
  points: Array<{ period: string; value: number }>;
  /** The app's figure on the same basis, where it can be worked out. */
  app: Array<{ period: string; value: number; basis: string }>;
  vintage?: string;
  note: string;
}

export interface ForecastOk {
  ok: true;
  id: ForecastId;
  label: string;
  unit: string;
  freq: 'quarterly' | 'monthly' | 'annual';
  lastObserved: { period: string; value: number };
  /** Recent history for the chart (real observations). */
  history: DatedPoint[];
  path: FanPoint[];
  method: string;
  fit: { from: string; to: string; n: number; p: number; d: 0 | 1; sigma: number };
  inputs: Array<{ label: string; source: string; newest: string; pulledAt?: string }>;
  imf?: ImfComparison;
  caveats: string[];
}

export type ForecastOutcome = ForecastOk | { ok: false; id: ForecastId; reason: string };

const r2 = (v: number) => Number(v.toFixed(2));

const nextPeriod = (d: string): string => {
  if (/^\d{4}$/.test(d)) return String(Number(d) + 1);
  const q = /^(\d{4})-Q([1-4])$/.exec(d);
  if (q) return q[2] === '4' ? `${Number(q[1]) + 1}-Q1` : `${q[1]}-Q${Number(q[2]) + 1}`;
  return addMonthsTo(d, 1);
};

/** The unbroken run of periods that ends at the newest point (a gap ends it: nothing is read across). */
export function unbrokenRun(points: DatedPoint[]): DatedPoint[] {
  const pts = points.filter((p) => Number.isFinite(p.value)).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  let i = pts.length - 1;
  while (i > 0 && nextPeriod(pts[i - 1].date) === pts[i].date) i--;
  return pts.slice(i);
}

interface Series {
  points: DatedPoint[];
  source: string;
  label: string;
  pulledAt?: string;
}

const LABELS: Record<ForecastId, { label: string; unit: string; freq: ForecastOk['freq']; what: string }> = {
  gdp_qoq: { label: 'Real GDP growth forecast (q/q)', unit: '%', freq: 'quarterly', what: 'quarterly real GDP growth (q/q, seasonally adjusted)' },
  cpi_yoy: { label: 'Inflation forecast (y/y)', unit: '%', freq: 'monthly', what: 'monthly y/y inflation' },
  policy_rate: { label: 'Policy rate forecast', unit: '%', freq: 'monthly', what: 'the monthly change in the end-of-month policy rate' },
  debt_gdp: { label: 'Government debt forecast', unit: '% of GDP', freq: 'annual', what: 'the yearly change in government debt to GDP (IMF outturns)' },
};

/** Fits the registered model for `id` on the series and projects it. */
export function forecastSeries(id: ForecastId, s: Series | null | undefined): ForecastOutcome {
  const m = FORECAST_MODELS[id];
  const L = LABELS[id];
  if (!s?.points?.length) return { ok: false, id, reason: `No ${L.what} series for this country.` };
  let run = unbrokenRun(s.points);
  if (m.window > 0 && run.length > m.window) run = run.slice(-m.window);
  if (run.length < m.minObs) return { ok: false, id, reason: `Only ${run.length} unbroken ${L.freq === 'annual' ? 'years' : L.freq === 'quarterly' ? 'quarters' : 'months'} of data; the model needs ${m.minObs}.` };
  const values = run.map((p) => p.value);
  const fit = fitAr(values, { maxLag: m.maxLag, d: m.d, intercept: m.intercept });
  if ('error' in fit) return { ok: false, id, reason: fit.error };
  const f = forecastAr(fit, values, m.steps);
  const last = run[run.length - 1];
  const path: FanPoint[] = [];
  let period = last.date;
  for (const p of f) {
    period = nextPeriod(period);
    path.push({ period, mean: r2(p.mean), sd: r2(p.sd!), bands: bandsFor(p).map((b) => ({ ...b, lo: r2(b.lo), hi: r2(b.hi) })) });
  }
  const offset = m.maxLag + m.d;
  return {
    ok: true,
    id,
    label: L.label,
    unit: L.unit,
    freq: L.freq,
    lastObserved: { period: last.date, value: last.value },
    history: run.slice(-(L.freq === 'monthly' ? 60 : L.freq === 'quarterly' ? 24 : 15)),
    path,
    method: `AR(${fit.p}) on ${L.what}, lag order 0-${m.maxLag} chosen by BIC${m.d && !m.intercept ? ', no drift' : m.d ? ', with drift' : ''}, least squares on ${m.window ? `the last ${m.window} months` : 'the unbroken run'}. Bands: 50/70/90% from the model's forecast error (normal).`,
    fit: { from: run[Math.min(run.length - 1, offset)].date, to: last.date, n: fit.n, p: fit.p, d: fit.d, sigma: r2(fit.sigma) },
    inputs: [{ label: s.label, source: s.source, newest: last.date, pulledAt: s.pulledAt }],
    caveats: [
      ...(id === 'policy_rate' ? ['Rates move in steps at meetings; the band shows how far the rate has tended to drift, not the chance of a move.'] : []),
      ...(id === 'debt_gdp' ? ['Yearly figures: the next two years are four to eight quarters ahead. IMF projections are kept out of the fit.'] : []),
      'Not validated until its pre-registered out-of-sample evaluation passes.',
    ],
  };
}

/** Calendar-year growth of the average level, from q/q growth (history then forecast). Only complete years. */
export function annualFromQuarterly(points: Array<{ period: string; value: number }>): Array<{ period: string; value: number }> {
  let level = 100;
  const byYear = new Map<string, number[]>();
  for (const p of points) {
    level *= 1 + p.value / 100;
    const y = p.period.slice(0, 4);
    byYear.set(y, [...(byYear.get(y) || []), level]);
  }
  const years = [...byYear.keys()].sort();
  const out: Array<{ period: string; value: number }> = [];
  for (let i = 1; i < years.length; i++) {
    const a = byYear.get(years[i - 1])!;
    const b = byYear.get(years[i])!;
    if (a.length !== 4 || b.length !== 4) continue;
    const avg = (x: number[]) => x.reduce((s, v) => s + v, 0) / 4;
    out.push({ period: years[i], value: r2((avg(b) / avg(a) - 1) * 100) });
  }
  return out;
}

/** Calendar-year average of monthly y/y inflation (history then forecast). Only complete years. */
export function annualAverageMonthly(points: Array<{ period: string; value: number }>): Array<{ period: string; value: number }> {
  const byYear = new Map<string, number[]>();
  for (const p of points) byYear.set(p.period.slice(0, 4), [...(byYear.get(p.period.slice(0, 4)) || []), p.value]);
  return [...byYear.entries()].filter(([, v]) => v.length === 12).map(([period, v]) => ({ period, value: r2(v.reduce((s, x) => s + x, 0) / 12) })).sort((a, b) => (a.period < b.period ? -1 : 1));
}

/** IMF points marked as projections, for the years the forecast reaches. */
function imfYears(imf: Array<{ date: string; value: number; note?: string }> | undefined, years: string[]) {
  return (imf || []).filter((p) => p.note === 'IMF projection' && years.includes(p.date)).map((p) => ({ period: p.date, value: p.value }));
}

/**
 * Adds the IMF WEO comparison to a forecast: the IMF's projections for the years covered, and the
 * app's figure on the same yearly basis where it can be worked out from history plus forecast.
 */
export function withImf(r: ForecastOutcome, imf: { points: Array<{ date: string; value: number; note?: string }>; source: string; pulledAt?: string } | null | undefined): ForecastOutcome {
  if (!r.ok || !imf?.points?.length) return r;
  const all = [...r.history.map((p) => ({ period: p.date, value: p.value })), ...r.path.map((p) => ({ period: p.period, value: p.mean }))];
  let app: ImfComparison['app'] = [];
  let basis = '';
  if (r.id === 'gdp_qoq') {
    basis = 'calendar-year growth of the average quarterly level, from history plus the app path';
    app = annualFromQuarterly(all).map((p) => ({ ...p, basis }));
  } else if (r.id === 'cpi_yoy') {
    basis = 'average of the twelve monthly y/y rates, close to but not the same as the IMF annual-average rate';
    app = annualAverageMonthly(all).map((p) => ({ ...p, basis }));
  } else if (r.id === 'debt_gdp') {
    basis = 'app path';
    app = r.path.map((p) => ({ period: p.period, value: p.mean, basis }));
  } else return r;
  const years = [...new Set([...r.path.map((p) => p.period.slice(0, 4))])];
  const points = imfYears(imf.points, years);
  app = app.filter((p) => years.includes(p.period));
  if (!points.length) return r;
  return {
    ...r,
    imf: {
      label: `${imf.source}, projection`,
      points,
      app,
      vintage: imf.pulledAt,
      note: "The IMF's own projection, shown for comparison; it is the IMF's forecast, not the app's. The app has not been tested against past IMF vintages yet.",
    },
  };
}

/** "App forecast, not validated advice: real GDP growth 0.5% q/q in Q4 2026 (70% band ...)." */
export function forecastSentence(r: ForecastOk, step = Math.min(4, r.path.length)): string {
  const p = r.path[step - 1];
  const b = p.bands.find((x) => x.level === 70);
  return `${FORECAST_LABEL}: ${r.label.replace(/ forecast.*$/, '').toLowerCase()} ${p.mean.toFixed(1)}${r.unit === '%' ? '%' : ` ${r.unit}`} in ${p.period}${b ? ` (70% band ${b.lo.toFixed(1)} to ${b.hi.toFixed(1)})` : ''}, from ${r.lastObserved.value.toFixed(1)} in ${r.lastObserved.period}.`;
}
