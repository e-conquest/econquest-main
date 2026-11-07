/**
 * Nowcasts (Sam, 2026-11-06): the app's estimate of a period that has ended, or is under way, whose
 * official figure is not out yet, from figures that are already published.
 *
 * GDP (quarterly real growth, q/q, seasonally adjusted, OECD quarterly national accounts):
 *   bridge equation y_q = a + b * activity_q + c * cli_q + d * y_{q-1}, fitted on past quarters.
 *   activity_q = growth of the quarter's average monthly activity index on the quarter before
 *   (BCB IBC-Br, Eurostat industrial production); cli_q = change in the quarter's average OECD
 *   leading indicator. Each country uses the indicators it has. Months of a quarter not out yet are
 *   an AR forecast of the monthly series (the ragged edge), and the result says how many.
 *   With no indicator month out for a quarter, an AR on GDP growth alone stands in, and says so.
 *
 * Inflation (monthly, y/y): an AR on the inflation series itself for the months between the last
 *   published month and the As-of month. No timelier price indicator is wired in yet, so this is a
 *   short-range projection and is labelled that way.
 *
 * Published-data-only rule: for a past As-of date, a period counts only once its end plus the
 * stated release lag has passed (PUBLICATION_LAG_DAYS). Values are today's vintage (later
 * revisions included), so a past nowcast is a pseudo real-time one, and the result says that.
 *
 * Pure, browser-safe.
 */
import { addMonthsTo, bandsFor, fitAr, fitBridge, forecastAr, monthsBetween, predictBridge, publishedBy, quarterlyFromMonthly, type Band, type DatedPoint, type Prediction } from './forecastModels';

/** Days from the end of a period to its release, used for past As-of dates and in the evaluation. */
export const PUBLICATION_LAG_DAYS = { gdp: 60, activity: 45, cli: 45, cpi: 30 } as const;

export const NOWCAST_LABEL = 'App nowcast, not validated advice';

export interface IndicatorUse {
  id: 'activity' | 'cli';
  label: string;
  source: string;
  /** Months of the target quarter that are published. */
  monthsPublished: number;
  /** Months of the target quarter filled by a forecast of the monthly series. */
  monthsForecast: number;
  newestMonth: string;
}

export interface NowcastPoint {
  /** YYYY-Qn or YYYY-MM. */
  period: string;
  mean: number;
  sd: number;
  bands: Band[];
  /** How this period was estimated, in a sentence. */
  how: string;
  indicators: IndicatorUse[];
}

export interface NowcastResult {
  ok: true;
  target: 'gdp_qoq' | 'cpi_yoy';
  label: string;
  unit: string;
  asOf: string;
  /** Newest published period of the target. */
  lastPublished: { period: string; value: number };
  points: NowcastPoint[];
  method: string;
  /** Estimation window and fit statistics. */
  fit: { from: string; to: string; n: number; r2?: number; sigma: number };
  inputs: Array<{ label: string; source: string; newest: string; pulledAt?: string }>;
  caveats: string[];
}

export type NowcastOutcome = NowcastResult | { ok: false; target: 'gdp_qoq' | 'cpi_yoy'; reason: string };

export interface NowcastInputs {
  iso3: string;
  /** YYYY-MM-DD. */
  asOf: string;
  /** True when As-of is today: the feeds hold only what is published, so no lag rule is applied. */
  live: boolean;
  gdp?: { points: DatedPoint[]; source: string; pulledAt?: string } | null;
  activity?: { points: DatedPoint[]; source: string; label: string; pulledAt?: string } | null;
  cli?: { points: DatedPoint[]; source: string; pulledAt?: string } | null;
  cpi?: { points: DatedPoint[]; source: string; pulledAt?: string } | null;
}

export const NOWCAST_PARAMS = { targetLags: 1, monthlyMaxLag: 3, minQuarters: 24, cpiMaxLag: 13, cpiWindow: 120, gdpArMaxLag: 4 };

const nextQuarter = (q: string) => {
  const y = Number(q.slice(0, 4));
  const n = Number(q.slice(-1));
  return n === 4 ? `${y + 1}-Q1` : `${y}-Q${n + 1}`;
};
const quarterOfDay = (day: string) => `${day.slice(0, 4)}-Q${Math.ceil(Number(day.slice(5, 7)) / 3)}`;
const r2 = (v: number) => Number(v.toFixed(2));

/** Quarterly indicator readings: growth (pct) or change (diff) of quarterly averages, with ragged-edge flags. */
export function quarterlyIndicator(points: DatedPoint[], kind: 'pct' | 'diff', upTo: string, maxLag = 3): Map<string, { value: number; monthsPublished: number; monthsForecast: number }> {
  const qa = quarterlyFromMonthly(points, { fill: 'ar', maxLag, fillUpTo: upTo });
  const out = new Map<string, { value: number; monthsPublished: number; monthsForecast: number }>();
  for (let i = 1; i < qa.length; i++) {
    const a = qa[i - 1];
    const b = qa[i];
    if (nextQuarter(a.quarter) !== b.quarter) continue;
    const value = kind === 'pct' ? (a.value ? (b.value / a.value - 1) * 100 : NaN) : b.value - a.value;
    if (Number.isFinite(value)) out.set(b.quarter, { value, monthsPublished: b.monthsPublished, monthsForecast: b.monthsForecast });
  }
  return out;
}

/** GDP nowcast for every quarter after the newest published one, up to the quarter As-of falls in. */
export function gdpNowcast(inp: NowcastInputs, params = NOWCAST_PARAMS): NowcastOutcome {
  const target = 'gdp_qoq' as const;
  if (!inp.gdp?.points?.length) return { ok: false, target, reason: 'No quarterly GDP for this country (the OECD quarterly national accounts do not cover it, or have not answered).' };
  const pub = <T extends DatedPoint>(pts: T[], lag: number) => (inp.live ? pts : publishedBy(pts, inp.asOf, lag));
  const gdp = pub(inp.gdp.points, PUBLICATION_LAG_DAYS.gdp).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  if (gdp.length < params.minQuarters) return { ok: false, target, reason: `Only ${gdp.length} quarters of GDP published by ${inp.asOf}; the nowcast needs ${params.minQuarters}.` };
  const last = gdp[gdp.length - 1];
  const nowQ = quarterOfDay(inp.asOf);
  if (last.date >= nowQ) return { ok: false, target, reason: `GDP for ${last.date} is already published; there is no quarter to nowcast.` };
  const targets: string[] = [];
  for (let q = nextQuarter(last.date); q <= nowQ; q = nextQuarter(q)) targets.push(q);

  const ind: Array<{ id: 'activity' | 'cli'; label: string; source: string; series: ReturnType<typeof quarterlyIndicator>; newest: string; pulledAt?: string }> = [];
  if (inp.activity?.points?.length) {
    const pts = pub(inp.activity.points, PUBLICATION_LAG_DAYS.activity);
    if (pts.length) ind.push({ id: 'activity', label: inp.activity.label, source: inp.activity.source, series: quarterlyIndicator(pts, 'pct', nowQ, params.monthlyMaxLag), newest: pts[pts.length - 1].date, pulledAt: inp.activity.pulledAt });
  }
  if (inp.cli?.points?.length) {
    const pts = pub(inp.cli.points, PUBLICATION_LAG_DAYS.cli);
    if (pts.length) ind.push({ id: 'cli', label: 'OECD leading indicator', source: inp.cli.source, series: quarterlyIndicator(pts, 'diff', nowQ, params.monthlyMaxLag), newest: pts[pts.length - 1].date, pulledAt: inp.cli.pulledAt });
  }
  const values = gdp.map((p) => p.value);
  const ar = fitAr(values, { maxLag: params.gdpArMaxLag });
  const inputs: NowcastResult['inputs'] = [
    { label: 'Real GDP growth, q/q', source: inp.gdp.source, newest: last.date, pulledAt: inp.gdp.pulledAt },
    ...ind.map((i) => ({ label: i.label, source: i.source, newest: i.newest, pulledAt: i.pulledAt })),
  ];

  const points: NowcastPoint[] = [];
  let fitInfo: NowcastResult['fit'] | null = null;
  let prev: { mean: number; sd: number } = { mean: last.value, sd: 0 };
  for (let k = 0; k < targets.length; k++) {
    const q = targets[k];
    // Indicators with at least one published month in this quarter.
    const usable = ind.filter((i) => (i.series.get(q)?.monthsPublished ?? 0) > 0);
    let p: Prediction | null = null;
    let how = '';
    if (usable.length) {
      const y = gdp.map((g) => g.value);
      const X = gdp.map((g) => usable.map((i) => i.series.get(g.date)?.value ?? null));
      // Only quarters fully published enter the fit (ragged-edge quarters are the ones being nowcast).
      const Xfit = gdp.map((g, t) => (usable.every((i) => (i.series.get(g.date)?.monthsForecast ?? 1) === 0) ? X[t] : X[t].map(() => null)));
      const fit = fitBridge(y, Xfit, { indicators: usable.map((i) => i.id), targetLags: params.targetLags });
      if (!('error' in fit)) {
        const pr = predictBridge(fit, usable.map((i) => i.series.get(q)!.value), [prev.mean]);
        if (!('error' in pr)) {
          const lagCoef = fit.coef[fit.coef.length - 1];
          p = { mean: pr.mean, sd: Math.sqrt(fit.sigma ** 2 + (lagCoef * prev.sd) ** 2) };
          const parts = usable.map((i) => {
            const s = i.series.get(q)!;
            return `${i.label}: ${s.monthsPublished} of 3 months out${s.monthsForecast ? `, ${s.monthsForecast} forecast` : ''}`;
          });
          how = `Bridge equation on ${parts.join('; ')}.`;
          const firstUsed = gdp.find((g, t) => t >= params.targetLags && Xfit[t].every((v) => v !== null));
          fitInfo ??= { from: firstUsed?.date ?? gdp[0].date, to: last.date, n: fit.n, r2: r2(fit.r2), sigma: r2(fit.sigma) };
        }
      }
    }
    if (!p) {
      if ('error' in ar) return { ok: false, target, reason: `No indicator for ${q} and GDP growth alone could not be modelled: ${ar.error}` };
      const f = forecastAr(ar, values, k + 1)[k];
      p = { mean: f.mean, sd: f.sd! };
      how = ind.length ? 'No indicator month out for this quarter yet: AR on GDP growth alone.' : 'No monthly activity indicator for this country: AR on GDP growth alone.';
      fitInfo ??= { from: gdp[ar.p]?.date ?? gdp[0].date, to: last.date, n: ar.n, sigma: r2(ar.sigma) };
    }
    points.push({
      period: q,
      mean: r2(p.mean),
      sd: r2(p.sd!),
      bands: bandsFor(p).map((b) => ({ ...b, lo: r2(b.lo), hi: r2(b.hi) })),
      how,
      indicators: usable.map((i) => {
        const s = i.series.get(q)!;
        return { id: i.id, label: i.label, source: i.source, monthsPublished: s.monthsPublished, monthsForecast: s.monthsForecast, newestMonth: i.newest };
      }),
    });
    prev = { mean: p.mean, sd: p.sd! };
  }
  return {
    ok: true,
    target,
    label: 'Real GDP growth nowcast (q/q, seasonally adjusted)',
    unit: '%',
    asOf: inp.asOf,
    lastPublished: { period: last.date, value: last.value },
    points,
    method: `Bridge equation: GDP growth on the quarter's ${ind.map((i) => (i.id === 'activity' ? 'activity-index growth' : 'leading-indicator change')).join(' and ') || 'indicators'} and last quarter's growth, least squares on fully published quarters; months not out yet are an AR(<=${params.monthlyMaxLag}) forecast of the monthly series. Bands: 50/70/90% from the fit's error (normal).`,
    fit: fitInfo ?? { from: gdp[0].date, to: last.date, n: 0, sigma: 0 },
    inputs,
    caveats: [
      ...(inp.live ? [] : [`Past As-of date: only periods published by ${inp.asOf} under the stated release lags (GDP ${PUBLICATION_LAG_DAYS.gdp} days, activity ${PUBLICATION_LAG_DAYS.activity}, leading indicator ${PUBLICATION_LAG_DAYS.cli}); values are today's vintage, so later revisions are included.`]),
      'Not validated until its pre-registered out-of-sample evaluation passes.',
    ],
  };
}

/** Inflation nowcast: months from the newest published one to the As-of month, AR on inflation itself. */
export function cpiNowcast(inp: NowcastInputs, params = NOWCAST_PARAMS): NowcastOutcome {
  const target = 'cpi_yoy' as const;
  if (!inp.cpi?.points?.length) return { ok: false, target, reason: 'No monthly inflation series for this country.' };
  const pts = (inp.live ? inp.cpi.points : publishedBy(inp.cpi.points, inp.asOf, PUBLICATION_LAG_DAYS.cpi)).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  // Unbroken run of months ending at the newest.
  let i = pts.length - 1;
  while (i > 0 && addMonthsTo(pts[i - 1].date, 1) === pts[i].date) i--;
  const run = pts.slice(i);
  if (run.length < 60) return { ok: false, target, reason: `Only ${run.length} unbroken months of inflation published by ${inp.asOf}; the nowcast needs 60.` };
  const last = run[run.length - 1];
  const steps = monthsBetween(last.date, inp.asOf.slice(0, 7));
  if (steps <= 0) return { ok: false, target, reason: `Inflation for ${last.date} is already published; there is no month to nowcast.` };
  const fit = fitAr(run.slice(-params.cpiWindow).map((p) => p.value), { maxLag: params.cpiMaxLag });
  if ('error' in fit) return { ok: false, target, reason: fit.error };
  const f = forecastAr(fit, run.map((p) => p.value), steps);
  return {
    ok: true,
    target,
    label: 'Inflation nowcast (y/y)',
    unit: '%',
    asOf: inp.asOf,
    lastPublished: { period: last.date, value: last.value },
    points: f.map((p, k) => ({
      period: addMonthsTo(last.date, k + 1),
      mean: r2(p.mean),
      sd: r2(p.sd!),
      bands: bandsFor(p).map((b) => ({ ...b, lo: r2(b.lo), hi: r2(b.hi) })),
      how: `AR(${fit.p}) on inflation itself, ${k + 1} month${k ? 's' : ''} past the newest figure.`,
      indicators: [],
    })),
    method: `AR on monthly y/y inflation, lag order 0-${params.cpiMaxLag} by BIC, least squares on the last ${params.cpiWindow} months. No timelier price indicator is wired in yet, so this is a short-range projection. Bands: 50/70/90% from the AR's forecast error (normal).`,
    fit: { from: run[params.cpiMaxLag]?.date ?? run[0].date, to: last.date, n: fit.n, sigma: r2(fit.sigma) },
    inputs: [{ label: 'Inflation, monthly y/y', source: inp.cpi.source, newest: last.date, pulledAt: inp.cpi.pulledAt }],
    caveats: [
      ...(inp.live ? [] : [`Past As-of date: only months published by ${inp.asOf} (release lag ${PUBLICATION_LAG_DAYS.cpi} days); values are today's vintage.`]),
      'Not validated until its pre-registered out-of-sample evaluation passes.',
    ],
  };
}

/** One sentence for the council and Explain: "App nowcast, not validated advice: Q3 2026 real GDP +0.4% q/q (70% band -0.1 to 0.9)." */
export function nowcastSentence(r: NowcastResult): string {
  const p = r.points[r.points.length - 1];
  const b = p.bands.find((x) => x.level === 70);
  const what = r.target === 'gdp_qoq' ? `real GDP ${p.mean >= 0 ? '+' : ''}${p.mean.toFixed(1)}% q/q` : `inflation ${p.mean.toFixed(1)}% y/y`;
  return `${NOWCAST_LABEL}: ${p.period} ${what}${b ? ` (70% band ${b.lo.toFixed(1)} to ${b.hi.toFixed(1)})` : ''}; last published ${r.lastPublished.period} ${r.lastPublished.value.toFixed(1)}%.`;
}
