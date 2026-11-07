/**
 * Nowcast & Forecast in Council chat (Sam, 2026-11-06): when a question asks where growth,
 * inflation, the policy rate or debt is heading (or where it is now, before the official figure),
 * the app's nowcast and forecast for each country join the answer as figures tagged 'model' and
 * labelled "app nowcast/forecast, not validated advice", with the evaluation status beside them.
 * Browser-safe; the panel fetches /api/nowcast and /api/forecast.
 */
import type { AgentAnswer, AgentFigure, AgentFinding } from './askCouncil';
import type { ForecastOutcome } from './forecasts';
import type { NowcastOutcome } from './nowcast';

export const FORECAST_AGENT_NAME = 'Nowcast & Forecast';
export const FORECAST_AGENT_COVERS = "the app's nowcast of GDP growth and inflation for periods not published yet, and its forecasts of GDP growth, inflation, the policy rate and government debt with bands, beside the IMF projection; all labelled app estimates, not validated advice";

/** Questions that ask about the path ahead or the period not published yet. */
export const FORECAST_TOPIC = /\b(nowcast|forecasts?|projections?|outlook|fan chart|next (?:quarter|year|few quarters|12 months)|going forward|heading|expected?|will (?:inflation|growth|gdp|rates?|the policy rate|debt))\b/i;

export function asksForecast(question: string): boolean {
  return FORECAST_TOPIC.test(question);
}

const STATUS_WORDS: Record<string, string> = { passed: 'evaluation passed', failed: 'evaluation FAILED', too_few_cases: 'too few cases to evaluate', not_run: 'not validated, evaluation not run yet' };
const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : 'n/a');

export interface CountryModels {
  iso3: string;
  countryName: string;
  nowcast?: { gdp: NowcastOutcome; cpi: NowcastOutcome } | null;
  forecast?: { forecasts: ForecastOutcome[]; validation?: Record<string, { status: string }> } | null;
}

const EVAL_FOR: Record<string, string> = { gdp_qoq: 'gdp_forecast', cpi_yoy: 'cpi_forecast', policy_rate: 'policy_rate_forecast', debt_gdp: 'debt_forecast' };

/** One finding per country: nowcast and forecast figures with method and status in the source line. */
export function forecastFinding(c: CountryModels): { finding: AgentFinding | null; missing: string[] } {
  const figures: AgentFigure[] = [];
  const missing: string[] = [];
  const failedNames: string[] = [];
  const status = (id: string) => STATUS_WORDS[c.forecast?.validation?.[id]?.status ?? 'not_run'] ?? STATUS_WORDS.not_run;
  for (const [key, evalId] of [['gdp', 'gdp_nowcast'], ['cpi', 'cpi_nowcast']] as const) {
    const n = c.nowcast?.[key];
    if (!n) continue;
    if (!n.ok) {
      missing.push(`${c.countryName}: ${key === 'gdp' ? 'GDP' : 'inflation'} nowcast missing (${n.reason})`);
      continue;
    }
    const p = n.points[n.points.length - 1];
    const b = p.bands.find((x) => x.level === 70);
    const failed = c.forecast?.validation?.[evalId]?.status === 'failed';
    if (failed) failedNames.push(`${key === 'gdp' ? 'GDP' : 'inflation'} nowcast`);
    figures.push({
      label: `App nowcast${failed ? ' (failed its out-of-sample test)' : ''}, ${key === 'gdp' ? 'real GDP growth q/q' : 'inflation y/y'}, ${p.period}`,
      value: `${f1(p.mean)}%${b ? ` (70% band ${f1(b.lo)} to ${f1(b.hi)})` : ''}`,
      source: `app nowcast, not validated advice (${status(evalId)}); ${p.how} Last published ${n.lastPublished.period}: ${f1(n.lastPublished.value)}%`,
      tag: 'model',
    });
  }
  for (const r of c.forecast?.forecasts || []) {
    if (!r.ok) {
      missing.push(`${c.countryName}: ${r.id.replace(/_/g, ' ')} forecast missing (${r.reason})`);
      continue;
    }
    const p = r.path[Math.min(3, r.path.length - 1)];
    const b = p.bands.find((x) => x.level === 70);
    const failed = c.forecast?.validation?.[EVAL_FOR[r.id]]?.status === 'failed';
    if (failed) failedNames.push(r.label.replace(/ forecast.*$/i, '').toLowerCase());
    figures.push({
      label: `App forecast${failed ? ' (failed its out-of-sample test)' : ''}, ${r.label.replace(/ forecast.*$/i, '').toLowerCase()}, ${p.period}`,
      value: `${f1(p.mean)}${r.unit === '%' ? '%' : ` ${r.unit}`}${b ? ` (70% band ${f1(b.lo)} to ${f1(b.hi)})` : ''}`,
      source: `app forecast, not validated advice (${status(EVAL_FOR[r.id])}); ${r.method.split('. Bands')[0]}; from ${f1(r.lastObserved.value)} in ${r.lastObserved.period}`,
      tag: 'model',
    });
    for (const ip of r.imf?.points || []) {
      figures.push({ label: `IMF projection, ${r.label.replace(/ forecast.*$/i, '').toLowerCase()}, ${ip.period}`, value: `${f1(ip.value)}${r.unit === '%' ? '%' : ` ${r.unit}`}`, source: `${r.imf!.label} (the IMF's forecast, not the app's)`, tag: 'official' });
    }
  }
  if (!figures.length) return { finding: null, missing };
  const gdpN = c.nowcast?.gdp;
  const base = gdpN?.ok
    ? `The app's nowcast puts ${gdpN.points[gdpN.points.length - 1].period} real GDP growth at ${f1(gdpN.points[gdpN.points.length - 1].mean)}% q/q; these are app estimates, not validated advice.`
    : `App forecasts for ${c.countryName}, with bands; app estimates, not validated advice.`;
  // A model that failed its pre-registered test is named in the reading, not only in a source line.
  const reading = failedNames.length
    ? `${base} Failed their pre-registered out-of-sample test: ${failedNames.join(', ')}; treat those figures as illustration, not a forecast.`
    : base;
  return { finding: { iso3: c.iso3, countryName: c.countryName, reading, figures, weight: 0.5 }, missing };
}

export function forecastAnswer(countries: CountryModels[], why = 'The question asks about the path ahead or a period not published yet.'): AgentAnswer {
  const findings: AgentFinding[] = [];
  const missing: string[] = [];
  for (const c of countries) {
    const r = forecastFinding(c);
    if (r.finding) findings.push(r.finding);
    missing.push(...r.missing);
  }
  return { id: 'forecast', name: FORECAST_AGENT_NAME, why, findings, missing };
}
