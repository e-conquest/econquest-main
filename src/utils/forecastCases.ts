/**
 * Out-of-sample cases for each registered nowcast and forecast target (src/utils/forecastEval.ts
 * judges them). Each generator uses only data available at the origin; pure, browser-safe.
 */
import { addDays, periodEnd, type DatedPoint } from './forecastModels';
import { arForecastCases, type ForecastCase, type ForecastSpec, type PlainSeries } from './forecastEval';
import { unbrokenRun } from './forecasts';
import { gdpNowcast } from './nowcast';

export interface CountryData {
  iso3: string;
  gdpQoq?: DatedPoint[];
  activity?: DatedPoint[];
  cli?: DatedPoint[];
  cpi?: DatedPoint[];
  policy?: DatedPoint[];
  /** IMF debt-to-GDP outturns only (projections removed by the caller). */
  debt?: DatedPoint[];
}

const plain = (where: string, pts: DatedPoint[] | undefined): PlainSeries | null => {
  const run = unbrokenRun(pts || []);
  return run.length ? { where, dates: run.map((p) => p.date), values: run.map((p) => p.value) } : null;
};

/** AR forecast targets: the series for each country, then rolling-origin cases. */
export function forecastTargetCases(spec: ForecastSpec, data: CountryData[]): { cases: ForecastCase[]; series: string[] } {
  const pick: Record<string, (c: CountryData) => DatedPoint[] | undefined> = {
    gdp_growth_q: (c) => c.gdpQoq,
    cpi_yoy_m: (c) => c.cpi,
    cpi_nowcast_m: (c) => c.cpi,
    policy_rate_m: (c) => c.policy,
    debt_gdp_a: (c) => c.debt,
  };
  const get = pick[spec.target];
  if (!get) return { cases: [], series: [] };
  const all = data.map((c) => plain(c.iso3, get(c))).filter((s): s is PlainSeries => Boolean(s));
  const cases = arForecastCases(all, spec);
  return { cases, series: [...new Set(cases.map((c) => c.where))].sort() };
}

/**
 * GDP nowcast cases: for each quarter q from the sample start, the nowcast made asOfDaysAfterQuarter
 * days after q ends (GDP for q not out yet under the registered lag), against the published value.
 * Benchmark: historical mean (or naive last quarter) of GDP growth published by then. Countries
 * with no monthly indicator are left out (the bridge has nothing to bridge).
 */
export function gdpNowcastCases(spec: ForecastSpec, data: CountryData[]): { cases: ForecastCase[]; series: string[] } {
  const after = spec.params.asOfDaysAfterQuarter ?? 30;
  const lag = spec.params.gdpLagDays ?? 60;
  const out: ForecastCase[] = [];
  for (const c of data) {
    if (!c.gdpQoq?.length || !(c.activity?.length || c.cli?.length)) continue;
    const gdp = c.gdpQoq.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    for (const g of gdp) {
      if (g.date < spec.sample.from || (spec.sample.to && g.date > spec.sample.to)) continue;
      const asOf = addDays(periodEnd(g.date), after);
      const r = gdpNowcast({
        iso3: c.iso3,
        asOf,
        live: false,
        gdp: { points: gdp, source: '' },
        activity: c.activity?.length ? { points: c.activity, source: '', label: 'activity' } : null,
        cli: c.cli?.length ? { points: c.cli, source: '' } : null,
      });
      if (!r.ok) continue;
      const p = r.points.find((x) => x.period === g.date);
      if (!p || !p.indicators.length) continue; // only quarters the bridge itself estimated
      const known = gdp.filter((x) => addDays(periodEnd(x.date), lag) <= asOf).map((x) => x.value);
      if (!known.length) continue;
      const bench = spec.benchmark === 'mean' ? known.reduce((a, b) => a + b, 0) / known.length : known[known.length - 1];
      out.push({ where: c.iso3, origin: r.lastPublished.period, target: g.date, h: 1, actual: g.value, model: { mean: p.mean, sd: p.sd }, bench: { mean: bench } });
    }
  }
  return { cases: out, series: [...new Set(out.map((x) => x.where))].sort() };
}

/**
 * Rule 7, the live calls of a passing GDP nowcast: for each country, every quarter that has ended
 * by `asOf`, is not published yet and is estimated by the bridge, with the benchmark (mean of the
 * GDP growth published so far) beside it. Recorded before the quarter's GDP is out.
 */
export function gdpNowcastOpen(spec: ForecastSpec, data: CountryData[], asOf: string): Array<{ where: string; when: string; what: string; due: string; forecast: { model: number; bench: number } }> {
  const lag = spec.params.gdpLagDays ?? 60;
  const out: Array<{ where: string; when: string; what: string; due: string; forecast: { model: number; bench: number } }> = [];
  for (const c of data) {
    if (!c.gdpQoq?.length || !(c.activity?.length || c.cli?.length)) continue;
    const gdp = c.gdpQoq.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const r = gdpNowcast({
      iso3: c.iso3,
      asOf,
      live: true,
      gdp: { points: gdp, source: '' },
      activity: c.activity?.length ? { points: c.activity, source: '', label: 'activity' } : null,
      cli: c.cli?.length ? { points: c.cli, source: '' } : null,
    });
    if (!r.ok) continue;
    const published = new Set(gdp.map((g) => g.date));
    const values = gdp.map((g) => g.value);
    if (!values.length) continue;
    const bench = spec.benchmark === 'mean' ? values.reduce((a, b) => a + b, 0) / values.length : values[values.length - 1];
    for (const p of r.points) {
      if (published.has(p.period) || !p.indicators.length || periodEnd(p.period) > asOf) continue;
      out.push({
        where: c.iso3,
        when: p.period,
        what: `nowcast ${p.mean.toFixed(2)}% q/q against the benchmark ${bench.toFixed(2)}%: closer to the first published figure?`,
        due: addDays(periodEnd(p.period), lag),
        forecast: { model: Number(p.mean.toFixed(4)), bench: Number(bench.toFixed(4)) },
      });
    }
  }
  return out;
}

export function casesFor(spec: ForecastSpec, data: CountryData[]): { cases: ForecastCase[]; series: string[] } {
  return spec.target === 'gdp_nowcast_q' ? gdpNowcastCases(spec, data) : forecastTargetCases(spec, data);
}
