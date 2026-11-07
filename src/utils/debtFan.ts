/**
 * Stochastic debt fan chart, in the shape of the IMF market-access DSA fan (IMF 2013 Staff Guidance
 * Note, Annex VI), on the app's own debt sustainability run (src/utils/debtSustainability.ts).
 *
 * Shocks: each simulated year draws one whole past year (bootstrap with replacement) from the
 * outturn years that have real growth, inflation, effective interest and primary balance together,
 * and adds that year's deviations from their sample means to the IMF baseline inputs. Drawing whole
 * years keeps the four shocks' joint behaviour (a recession year brings low growth, a weak primary
 * balance and often a higher rate together) without assuming a distribution. The interest shock is
 * phased in as a fifth of the debt rolls over each year, like the stated interest rate shock.
 *
 * 2,000 paths, a fixed seed (the same history always gives the same fan), five years. Reported:
 * the 10th, 25th, 50th, 75th and 90th percentiles of debt by year, and the share of paths ending
 * above today's debt. A spread built from past shocks: it says nothing about shocks the sample has
 * not seen, and it is centred on the IMF's inputs, not on a forecast of the app's.
 *
 * Browser-safe.
 */
import { nextDebt, nominalGrowthPct, ROLLOVER_SHARE, type DsaResult } from './debtSustainability';

export const FAN_DRAWS = 2000;
export const FAN_SEED = 20261106;
export const FAN_MIN_YEARS = 10;
/** History used for the shocks: the most recent years, up to this many. */
export const FAN_MAX_YEARS = 25;
export const FAN_PERCENTILES = [10, 25, 50, 75, 90] as const;

export interface DebtFan {
  ok: true;
  /** First point is the last outturn (all percentiles equal). */
  years: Array<{ year: string; p10: number; p25: number; p50: number; p75: number; p90: number }>;
  /** Share of paths (0-1) whose final debt is above the last outturn. */
  probAboveNow: number;
  /** Share of paths ending above the deterministic baseline's end. */
  probAboveBaseline?: number;
  sample: { from: string; to: string; n: number };
  draws: number;
  method: string;
}

export type DebtFanOutcome = DebtFan | { ok: false; reason: string };

export const FAN_METHOD = `Bootstrap of whole past years (${FAN_DRAWS} paths, fixed seed): each year's deviations of real growth, inflation, effective interest and primary balance from their sample means are added to the IMF baseline inputs; interest shocks phased in as a fifth of the debt rolls over each year.`;

/** mulberry32: deterministic uniform numbers in [0, 1). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (v: number) => Number(v.toFixed(2));

function pct(sorted: number[], p: number): number {
  const k = (sorted.length - 1) * (p / 100);
  const lo = Math.floor(k);
  const hi = Math.ceil(k);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (k - lo);
}

export function debtFan(r: DsaResult, opts: { draws?: number; seed?: number } = {}): DebtFanOutcome {
  const base = r.baselineInputs;
  if (!base?.length) return { ok: false, reason: "The baseline on the IMF's projected inputs did not run, so there is nothing to centre the fan on" };
  const hist = r.history.filter((h) => h.interestPct !== undefined).slice(-FAN_MAX_YEARS);
  if (hist.length < FAN_MIN_YEARS) return { ok: false, reason: `Needs ${FAN_MIN_YEARS} past years with growth, inflation, interest and primary balance together; ${hist.length} saved` };
  const mean = (f: (h: (typeof hist)[number]) => number) => hist.reduce((s, h) => s + f(h), 0) / hist.length;
  const m = { g: mean((h) => h.realGrowthPct), pi: mean((h) => h.inflationPct), i: mean((h) => h.interestPct!), pb: mean((h) => h.primaryBalance) };
  const dev = hist.map((h) => ({ g: h.realGrowthPct - m.g, pi: h.inflationPct - m.pi, i: h.interestPct! - m.i, pb: h.primaryBalance - m.pb }));

  const draws = opts.draws ?? FAN_DRAWS;
  const rand = rng(opts.seed ?? FAN_SEED);
  const H = base.length;
  const byYear: number[][] = Array.from({ length: H }, () => []);
  for (let d = 0; d < draws; d++) {
    let debt = r.debtNow;
    for (let k = 0; k < H; k++) {
      const s = dev[Math.floor(rand() * dev.length)];
      const y = base[k];
      const i = y.i + s.i * Math.min(1, ROLLOVER_SHARE * (k + 1));
      debt = nextDebt(debt, i, nominalGrowthPct(y.g + s.g, y.pi + s.pi), y.pb + s.pb);
      byYear[k].push(debt);
    }
  }
  const years: DebtFan['years'] = [{ year: r.lastOutturnYear, p10: r.debtNow, p25: r.debtNow, p50: r.debtNow, p75: r.debtNow, p90: r.debtNow }];
  byYear.forEach((vals, k) => {
    const s = [...vals].sort((a, b) => a - b);
    years.push({ year: base[k].year, p10: r2(pct(s, 10)), p25: r2(pct(s, 25)), p50: r2(pct(s, 50)), p75: r2(pct(s, 75)), p90: r2(pct(s, 90)) });
  });
  const final = byYear[H - 1];
  const baseEnd = r.scenarios.find((s) => s.id === 'baseline')?.end;
  return {
    ok: true,
    years,
    probAboveNow: r2(final.filter((v) => v > r.debtNow).length / final.length),
    ...(baseEnd !== undefined ? { probAboveBaseline: r2(final.filter((v) => v > baseEnd).length / final.length) } : {}),
    sample: { from: hist[0].year, to: hist[hist.length - 1].year, n: hist.length },
    draws,
    method: FAN_METHOD,
  };
}

export function debtFanSentence(f: DebtFan): string {
  const end = f.years[f.years.length - 1];
  return `On past shocks (${f.sample.from}-${f.sample.to}), debt in ${end.year} lies between ${end.p10.toFixed(0)}% and ${end.p90.toFixed(0)}% of GDP in 8 of 10 paths (median ${end.p50.toFixed(0)}%); ${Math.round(f.probAboveNow * 100)}% of paths end above today's level.`;
}
