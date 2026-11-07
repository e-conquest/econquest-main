/**
 * Coverage test of the debt fan chart (src/utils/debtFan.ts) on past IMF WEO editions (Sam chose
 * this design on 2026-11-06, under his signal standard).
 *
 * The fan is a forecast distribution, so the forward claim to test is its coverage: about 80% of
 * later outturns should fall inside its 10th-90th percentile band. To test it without hindsight,
 * the fan is rebuilt at each past origin exactly as the panel builds it today, but on the WEO
 * edition published then (data/local/weo-vintages/, src/utils/weoVintages.ts):
 *
 * - Origin: one edition a year (the stated month, October; September where that was the autumn
 *   edition). History = that edition's actual years; baseline = that edition's projections.
 *   Years the edition marks as estimates count as projections, as in the live panel.
 * - Fan: debtSustainability() then debtFan() with the panel's fixed seed and draws.
 * - Outcome: government debt for the target year as an actual in the latest edition saved.
 * - Case: one country, origin and horizon h (1 to 5 years after the origin's last actual year);
 *   hit when the outcome is inside [p10, p90].
 *
 * Judged per horizon: coverage = hits / cases. Cases sharing a target year share its shocks, so a
 * block bootstrap resamples whole target years (fixed seed). Pass: at every horizon, coverage within
 * the registered range, enough cases and target years, and p (the share of resamples in which some
 * horizon falls outside the range) at or below the pass mark. p is what enters the Holm correction.
 *
 * Pure, browser-safe.
 */
import { seededRandom } from './backtest';
import { debtSustainability, type DsaInputs } from './debtSustainability';
import { debtFan } from './debtFan';
import type { Series } from './seriesHistory';
import { weoValueKind, type WeoEdition, type WeoVintageStore } from './weoVintages';

export interface FanCoverageSpec {
  id: string;
  version: number;
  target: 'debt_fan_coverage';
  params: { originMonth: number; fallbackMonth?: number; horizons: number; resamples: number; seed: number };
  sample: { from: string; to?: string };
  passMark: { minCoverage: number; maxCoverage: number; maxPValue: number; minCasesPerHorizon: number; minYears: number };
}

export interface FanCase {
  where: string;
  /** Edition (YYYY-MM) the fan was built on. */
  origin: string;
  h: number;
  year: string;
  actual: number;
  p10: number;
  p90: number;
  inside: boolean;
}

export interface FanCoverageHorizon {
  h: number;
  cases: number;
  years: number;
  coverage: number;
  /** 90% range of the coverage from resampling whole target years. */
  coverageRange: [number, number];
  /** Share of outcomes below p10 and above p90. */
  below: number;
  above: number;
}

export interface FanCoverageResult {
  status: 'passed' | 'failed' | 'too_few_cases';
  verdict: string;
  coverage: FanCoverageHorizon[];
  pValue: number;
  origins: string[];
  series: string[];
  span: { from: string; to: string };
  sample: FanCase[];
}

const CODES = { debt: 'GGXWDG_NGDP', pb: 'GGXONLB_NGDP', ob: 'GGXCNL_NGDP', g: 'NGDP_RPCH', pi: 'PCPIPCH' } as const;
const r3 = (v: number) => Number(v.toFixed(3));

function seriesFrom(e: WeoEdition, iso3: string, code: string): Series | undefined {
  const row = e.rows[iso3]?.[code];
  if (!row) return undefined;
  const points = Object.keys(row.years)
    .sort()
    .map((year) => ({ date: year, value: row.years[year], ...(weoValueKind(e, row, year) !== 'actual' ? { note: 'IMF projection' } : {}) }));
  return { id: code, label: code, unit: '%', freq: 'annual', source: `IMF WEO ${e.vintage}`, points };
}

/** The DSA inputs as one edition published them. */
export function dsaInputsFromEdition(e: WeoEdition, iso3: string): DsaInputs {
  return {
    debt: seriesFrom(e, iso3, CODES.debt),
    primaryBalance: seriesFrom(e, iso3, CODES.pb),
    overallBalance: seriesFrom(e, iso3, CODES.ob),
    realGrowth: seriesFrom(e, iso3, CODES.g),
    inflation: seriesFrom(e, iso3, CODES.pi),
  };
}

/** One edition a year: the origin month, else the fallback month, within the sample. */
export function originEditions(store: WeoVintageStore, spec: FanCoverageSpec): WeoEdition[] {
  const byYear = new Map<string, WeoEdition>();
  const mm = (n: number) => String(n).padStart(2, '0');
  for (const e of store.editions) {
    const [y, m] = e.vintage.split('-');
    if (y < spec.sample.from || (spec.sample.to && y > spec.sample.to)) continue;
    if (m === mm(spec.params.originMonth)) byYear.set(y, e);
    else if (spec.params.fallbackMonth && m === mm(spec.params.fallbackMonth) && !byYear.has(y)) byYear.set(y, e);
  }
  return [...byYear.keys()].sort().map((y) => byYear.get(y)!);
}

/** Debt outturns from the latest edition saved: year -> value, actual years only. */
export function latestOutturns(store: WeoVintageStore, iso3: string): Map<string, number> {
  const out = new Map<string, number>();
  const e = [...store.editions].reverse().find((x) => x.rows[iso3]?.[CODES.debt]);
  const row = e?.rows[iso3]?.[CODES.debt];
  if (!e || !row) return out;
  for (const [year, v] of Object.entries(row.years)) if (weoValueKind(e, row, year) === 'actual') out.set(year, v);
  return out;
}

export function fanCoverageCases(store: WeoVintageStore, spec: FanCoverageSpec): { cases: FanCase[]; origins: string[] } {
  const origins = originEditions(store, spec);
  const cases: FanCase[] = [];
  const outturns = new Map<string, Map<string, number>>();
  for (const e of origins) {
    for (const iso3 of Object.keys(e.rows).sort()) {
      const dsa = debtSustainability(dsaInputsFromEdition(e, iso3));
      if (!dsa.ok) continue;
      const fan = debtFan(dsa);
      if (!fan.ok) continue;
      if (!outturns.has(iso3)) outturns.set(iso3, latestOutturns(store, iso3));
      const real = outturns.get(iso3)!;
      for (let h = 1; h <= spec.params.horizons && h < fan.years.length; h++) {
        const y = fan.years[h];
        const actual = real.get(y.year);
        if (actual === undefined) continue;
        cases.push({ where: iso3, origin: e.vintage, h, year: y.year, actual, p10: y.p10, p90: y.p90, inside: actual >= y.p10 && actual <= y.p90 });
      }
    }
  }
  return { cases, origins: origins.map((e) => e.vintage) };
}

export function judgeFanCoverage(spec: FanCoverageSpec, cases: FanCase[], origins: string[]): FanCoverageResult {
  const pm = spec.passMark;
  const H = Array.from({ length: spec.params.horizons }, (_, k) => k + 1);
  const years = [...new Set(cases.map((c) => c.year))].sort();
  const byYear = new Map(years.map((y) => [y, cases.filter((c) => c.year === y)]));
  const cov = (cs: FanCase[], h: number) => {
    const x = cs.filter((c) => c.h === h);
    return x.length ? x.filter((c) => c.inside).length / x.length : NaN;
  };
  const rand = seededRandom(spec.params.seed);
  const draws: number[][] = [];
  let outside = 0;
  for (let d = 0; d < spec.params.resamples && years.length; d++) {
    const pick: FanCase[] = [];
    for (let k = 0; k < years.length; k++) pick.push(...byYear.get(years[Math.floor(rand() * years.length)])!);
    const c = H.map((h) => cov(pick, h));
    draws.push(c);
    if (c.some((v) => !Number.isFinite(v) || v < pm.minCoverage || v > pm.maxCoverage)) outside++;
  }
  const pValue = draws.length ? Number(((outside + 1) / (draws.length + 1)).toPrecision(3)) : 1;
  const q = (vals: number[], p: number) => {
    const s = vals.filter(Number.isFinite).sort((a, b) => a - b);
    return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
  };
  const coverage: FanCoverageHorizon[] = H.map((h, k) => {
    const x = cases.filter((c) => c.h === h);
    return {
      h,
      cases: x.length,
      years: new Set(x.map((c) => c.year)).size,
      coverage: r3(cov(cases, h)),
      coverageRange: [r3(q(draws.map((d) => d[k]), 0.05)), r3(q(draws.map((d) => d[k]), 0.95))],
      below: x.length ? r3(x.filter((c) => c.actual < c.p10).length / x.length) : NaN,
      above: x.length ? r3(x.filter((c) => c.actual > c.p90).length / x.length) : NaN,
    };
  });
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const desc = coverage.map((c) => `${c.h}y ${Number.isFinite(c.coverage) ? pct(c.coverage) : 'no cases'} (${c.cases} cases, ${pct(c.below)} below, ${pct(c.above)} above)`).join('; ');
  const short = coverage.filter((c) => c.cases < pm.minCasesPerHorizon || c.years < pm.minYears);
  let status: FanCoverageResult['status'];
  let why = '';
  if (short.length) {
    status = 'too_few_cases';
    why = `too few cases at ${short.map((c) => `${c.h}y`).join(', ')} (needs ${pm.minCasesPerHorizon} cases over ${pm.minYears} target years each; ${origins.length} editions saved)`;
  } else {
    const bad = coverage.filter((c) => c.coverage < pm.minCoverage || c.coverage > pm.maxCoverage);
    status = !bad.length && pValue <= pm.maxPValue ? 'passed' : 'failed';
    why = bad.length ? `coverage outside ${pct(pm.minCoverage)}-${pct(pm.maxCoverage)} at ${bad.map((c) => `${c.h}y`).join(', ')}` : pValue > pm.maxPValue ? `p ${pValue} above ${pm.maxPValue} with whole target years resampled` : 'every horizon inside the range';
  }
  const verdict = `${status === 'passed' ? 'Passed' : status === 'failed' ? 'Failed' : 'Too few cases'}: ${why}. Share of outturns inside the 10-90 band (80% if calibrated): ${desc}; p ${pValue}.`;
  return {
    status,
    verdict,
    coverage,
    pValue,
    origins,
    series: [...new Set(cases.map((c) => c.where))].sort(),
    span: { from: years[0] || '', to: years[years.length - 1] || '' },
    sample: [...cases].sort((a, b) => b.year.localeCompare(a.year) || a.where.localeCompare(b.where)).slice(0, 30),
  };
}
