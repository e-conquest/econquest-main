/**
 * US inflation expectations (gap analysis D10), free from FRED:
 *
 *   Market-implied, daily, computed by the St. Louis Fed from Treasury nominal and TIPS yields
 *   (FRED labels them "Copyrighted: Citation Required"):
 *     T5YIE   5-year breakeven inflation rate
 *     T10YIE  10-year breakeven inflation rate
 *     T5YIFR  5-year, 5-year forward inflation expectation rate
 *   Model-based, monthly, Federal Reserve Bank of Cleveland (FRED: "Public Domain: Citation Requested"):
 *     EXPINF1YR   1-year expected inflation
 *     EXPINF10YR  10-year expected inflation
 *
 * Checked on the FRED series pages on 2026-11-07 (titles, units: percent, not seasonally adjusted).
 * Left out: University of Michigan consumer expectations (MICH), which FRED carries "reprinted with
 * permission" with the latest month held back by agreement; the ECB Survey of Professional
 * Forecasters and the Banco Central do Brasil Focus survey, whose APIs could not be read from this
 * project's cloud session, so their series names and field layout are not verified yet.
 *
 * Daily series are shown at month-end (the last trading day of each month); the latest day is named
 * in the about text. Breakevens include an inflation risk premium and a TIPS liquidity premium, so
 * they are not a pure forecast; they track CPI, while the Fed's 2% goal is for PCE inflation.
 *
 * Browser-safe, pure.
 */
import type { Series, SeriesMissing, SeriesPoint } from './seriesHistory';

export type ExpObs = { date: string; value: number };

export interface InflationExpectations {
  fetchedAt: string;
  /** FRED series id -> observations, oldest first. A series FRED did not answer is absent. */
  series: Record<string, ExpObs[]>;
}

interface Def {
  id: string;
  fred: string;
  label: string;
  daily: boolean;
  source: string;
  about: string;
}

const RISK_NOTE = 'Includes an inflation risk premium and a TIPS liquidity premium, so it is not a pure forecast. It tracks CPI; the Fed\'s 2% goal is for PCE inflation.';

export const US_INFLATION_EXPECTATIONS: Def[] = [
  { id: 'us_breakeven_5y', fred: 'T5YIE', label: 'US 5-year breakeven inflation', daily: true, source: 'FRED T5YIE (St. Louis Fed, from US Treasury yields)', about: `5-year Treasury yield minus the 5-year TIPS yield. ${RISK_NOTE}` },
  { id: 'us_breakeven_10y', fred: 'T10YIE', label: 'US 10-year breakeven inflation', daily: true, source: 'FRED T10YIE (St. Louis Fed, from US Treasury yields)', about: `10-year Treasury yield minus the 10-year TIPS yield. ${RISK_NOTE}` },
  { id: 'us_5y5y_forward', fred: 'T5YIFR', label: 'US 5y5y forward inflation expectation', daily: true, source: 'FRED T5YIFR (St. Louis Fed, from US Treasury yields)', about: `Expected average inflation over the five years that start five years from now, from the 5- and 10-year breakevens. Watched as a gauge of long-run anchoring. ${RISK_NOTE}` },
  { id: 'us_expinf_1y', fred: 'EXPINF1YR', label: 'US 1-year expected inflation (Cleveland Fed model)', daily: false, source: 'FRED EXPINF1YR (Federal Reserve Bank of Cleveland)', about: 'Cleveland Fed model estimate of expected inflation over the next year; the model estimates expected inflation together with the inflation risk premium, the real risk premium and the real interest rate. Monthly.' },
  { id: 'us_expinf_10y', fred: 'EXPINF10YR', label: 'US 10-year expected inflation (Cleveland Fed model)', daily: false, source: 'FRED EXPINF10YR (Federal Reserve Bank of Cleveland)', about: 'Cleveland Fed model estimate of expected average inflation over the next ten years; the model estimates expected inflation together with the inflation risk premium, the real risk premium and the real interest rate. Monthly.' },
];

export const US_INFLATION_EXPECTATION_IDS = US_INFLATION_EXPECTATIONS.map((d) => d.fred);

/** Last observation of each month, as monthly points dated YYYY-MM. */
export function monthEndPoints(obs: ExpObs[]): SeriesPoint[] {
  const m = new Map<string, number>();
  for (const o of [...obs].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (Number.isFinite(o.value) && /^\d{4}-\d{2}/.test(o.date)) m.set(o.date.slice(0, 7), o.value);
  }
  return [...m.entries()].map(([date, value]) => ({ date, value }));
}

/** Official FRED API observations (JSON) into dated values; "." and non-numbers are skipped. */
export function parseFredApiObservations(json: unknown): ExpObs[] {
  const obs = (json as { observations?: Array<{ date?: unknown; value?: unknown }> })?.observations;
  if (!Array.isArray(obs)) return [];
  const out: ExpObs[] = [];
  for (const o of obs) {
    const date = String(o.date ?? '').trim();
    const raw = String(o.value ?? '').trim();
    const value = Number(raw);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || raw === '' || raw === '.' || !Number.isFinite(value)) continue;
    out.push({ date, value });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const fmt = (v: number) => `${v.toFixed(2)}%`;

/** US only: other countries get nothing (no clutter), the US gets each series or Missing with a reason. */
export function inflationExpectationSeries(iso3: string, d: InflationExpectations | null | undefined): Array<Series | SeriesMissing> {
  if (String(iso3 || '').toUpperCase() !== 'USA') return [];
  return US_INFLATION_EXPECTATIONS.map((def) => {
    if (!d) return { id: def.id, label: def.label, reason: 'FRED has not answered yet' };
    const obs = d.series[def.fred];
    if (!obs?.length) return { id: def.id, label: def.label, reason: `FRED gave no observations for ${def.fred}` };
    const last = obs[obs.length - 1];
    const points = def.daily ? monthEndPoints(obs) : obs.map((o) => ({ date: o.date.slice(0, 7), value: o.value }));
    const about = def.daily ? `${def.about} Shown at month-end; latest day ${last.date}: ${fmt(last.value)}.` : `${def.about} Latest: ${last.date.slice(0, 7)}, ${fmt(last.value)}.`;
    return { id: def.id, label: def.label, unit: '%', freq: 'monthly' as const, source: def.source, pulledAt: d.fetchedAt, points, about };
  });
}
