/**
 * Currency carry, value and momentum, tested as published (Sam's signal standard, 2026-11-06).
 *
 * Signals, each from the literature and used as written there, not fitted here:
 * - Carry (Lustig and Verdelhan 2007; Menkhoff, Sarno, Schmeling and Schrimpf 2012): the short rate
 *   differential against the US. Free data have no interbank rates for most currencies, so each
 *   central bank's policy rate (BIS) stands in, and every reading says so.
 * - Value (Asness, Moskowitz and Pedersen 2013; Menkhoff, Sarno, Schmeling and Schrimpf 2017): the
 *   five-year real depreciation against the US dollar; the more a currency has cheapened in real
 *   terms, the more it is held. Prices are lagged by the registered release lag.
 * - Momentum (Asness, Moskowitz and Pedersen 2013; Menkhoff et al. 2012): the currency's excess
 *   return over the past 12 months, leaving out the latest month (12-1).
 *
 * Portfolio (the same for all three): each month-end, the currencies with a signal are ranked; the
 * top third is held long and the bottom third short against the US dollar, equal weights, so the
 * book is dollar-neutral. Held for the next month. A month needs `minCurrencies` with a signal.
 *
 * Excess return of holding currency c for month t+1, in %:
 *   (policy rate_c(t) - policy rate_US(t)) / 12 - 100 x ln(S_c(t+1) / S_c(t)),  S = units per USD.
 * Cost: a flat `costPctPerSide` on every unit of weight traded (sum of |w(t) - w(t-1)|), the same
 * for every currency and month (no free bid-ask), taken off the gross return.
 *
 * Judged against doing nothing (holding dollars: excess return 0). Months close in time share
 * shocks, so whole calendar years of monthly net returns are resampled together (block bootstrap,
 * fixed seed). p = share of resamples whose mean net return is at or below 0. Pass: enough months
 * and years, p at or below the registered mark, and an annualised mean net return at or above the
 * registered minimum. The p enters the Holm correction across every test on record.
 *
 * Pure, browser-safe.
 */
import { seededRandom } from './backtest';

export type FxFactor = 'carry' | 'value' | 'momentum';

export interface FxUniverseEntry {
  ccy: string;
  /** BIS WS_CBPOL area code. */
  bis: string;
  /** OECD CPI area (ISO3, or the code areaSeries accepts). */
  cpi: string;
}

export interface FxFactorSpec {
  id: string;
  version: number;
  method: 'fx_factor';
  factor: FxFactor;
  universe: FxUniverseEntry[];
  params: {
    costPctPerSide: number;
    minCurrencies: number;
    /** Months of CPI release lag (value only). */
    cpiLagMonths: number;
    /** Value: look-back in months. Momentum: look-back and skip. */
    lookbackMonths: number;
    skipMonths: number;
    resamples: number;
    seed: number;
  };
  sample: { from: string; to?: string };
  passMark: { maxPValue: number; minAnnualNetPct: number; minMonths: number; minYears: number };
}

/** Month (YYYY-MM) to value. */
export type MonthMap = Map<string, number>;

export interface FxPanel {
  /** Units per USD at month-end, by currency. */
  fx: Record<string, MonthMap>;
  /** Policy rate %, month-end, by BIS area (must include 'US'). */
  policy: Record<string, MonthMap>;
  /** CPI y/y %, by CPI area (must include the US area). */
  cpiYoy: Record<string, MonthMap>;
  usCpi: string;
}

export const addMonth = (ym: string, n: number): string => {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

/** Excess return (%) of holding `ccy` over the month after `t`; undefined without data. */
export function excessReturn(p: FxPanel, u: FxUniverseEntry, t: string): number | undefined {
  const s0 = p.fx[u.ccy]?.get(t);
  const s1 = p.fx[u.ccy]?.get(addMonth(t, 1));
  const i = p.policy[u.bis]?.get(t);
  const iUs = p.policy.US?.get(t);
  if (!s0 || !s1 || i === undefined || iUs === undefined) return undefined;
  return (i - iUs) / 12 - 100 * Math.log(s1 / s0);
}

/** Price level change over `years` whole years ending at `m`, from y/y rates: product of (1 + pi). */
function priceChangeLog(yoy: MonthMap | undefined, m: string, years: number): number | undefined {
  if (!yoy) return undefined;
  let s = 0;
  for (let k = 0; k < years; k++) {
    const v = yoy.get(addMonth(m, -12 * k));
    if (v === undefined || v <= -100) return undefined;
    s += Math.log(1 + v / 100);
  }
  return 100 * s;
}

/** The factor's signal for one currency at month-end t (higher = hold long). */
export function signalAt(spec: FxFactorSpec, p: FxPanel, u: FxUniverseEntry, t: string): number | undefined {
  const pr = spec.params;
  if (spec.factor === 'carry') {
    const i = p.policy[u.bis]?.get(t);
    const iUs = p.policy.US?.get(t);
    return i === undefined || iUs === undefined ? undefined : i - iUs;
  }
  if (spec.factor === 'value') {
    const s0 = p.fx[u.ccy]?.get(addMonth(t, -pr.lookbackMonths));
    const s1 = p.fx[u.ccy]?.get(t);
    if (!s0 || !s1) return undefined;
    const known = addMonth(t, -pr.cpiLagMonths);
    const years = Math.round(pr.lookbackMonths / 12);
    const pc = priceChangeLog(p.cpiYoy[u.cpi], known, years);
    const pu = priceChangeLog(p.cpiYoy[p.usCpi], known, years);
    if (pc === undefined || pu === undefined) return undefined;
    // Real depreciation (%): nominal depreciation less the inflation gap. Cheaper = higher.
    return 100 * Math.log(s1 / s0) - (pc - pu);
  }
  // Momentum: sum of monthly excess returns from t-lookback to t-skip (12-1 leaves out the latest).
  let s = 0;
  for (let k = pr.skipMonths; k < pr.lookbackMonths; k++) {
    const r = excessReturn(p, u, addMonth(t, -k - 1));
    if (r === undefined) return undefined;
    s += r;
  }
  return s;
}

export interface FxMonth {
  /** Month-end the positions were set. */
  month: string;
  long: string[];
  short: string[];
  gross: number;
  cost: number;
  net: number;
  turnover: number;
}

/** The monthly long-short returns, net of the flat cost. */
export function fxFactorReturns(spec: FxFactorSpec, p: FxPanel, months: string[]): FxMonth[] {
  const out: FxMonth[] = [];
  let prevW = new Map<string, number>();
  for (const t of months) {
    if (t < spec.sample.from || (spec.sample.to && t > spec.sample.to)) continue;
    const ranked = spec.universe
      .map((u) => ({ u, s: signalAt(spec, p, u, t), r: excessReturn(p, u, t) }))
      .filter((x): x is { u: FxUniverseEntry; s: number; r: number } => x.s !== undefined && x.r !== undefined && Number.isFinite(x.s))
      .sort((a, b) => b.s - a.s || a.u.ccy.localeCompare(b.u.ccy));
    if (ranked.length < spec.params.minCurrencies) {
      prevW = new Map();
      continue;
    }
    const k = Math.floor(ranked.length / 3);
    const long = ranked.slice(0, k);
    const short = ranked.slice(-k);
    const w = new Map<string, number>();
    for (const x of long) w.set(x.u.ccy, 1 / k);
    for (const x of short) w.set(x.u.ccy, -1 / k);
    let turnover = 0;
    for (const c of new Set([...w.keys(), ...prevW.keys()])) turnover += Math.abs((w.get(c) ?? 0) - (prevW.get(c) ?? 0));
    const gross = long.reduce((a, x) => a + x.r, 0) / k - short.reduce((a, x) => a + x.r, 0) / k;
    const cost = spec.params.costPctPerSide * turnover;
    out.push({ month: t, long: long.map((x) => x.u.ccy), short: short.map((x) => x.u.ccy), gross, cost, net: gross - cost, turnover });
    prevW = w;
  }
  return out;
}

/**
 * The book the factor holds from month-end `t` (thirds by signal, as in fxFactorReturns), from the
 * signal and the month-end rate alone: the call made at `t`, before the next month's return exists.
 * Null when fewer than minCurrencies can be ranked.
 */
export function fxFactorBook(spec: FxFactorSpec, p: FxPanel, t: string): { long: string[]; short: string[] } | null {
  const ranked = spec.universe
    .map((u) => ({ u, s: signalAt(spec, p, u, t) }))
    .filter((x): x is { u: FxUniverseEntry; s: number } => x.s !== undefined && Number.isFinite(x.s) && Boolean(p.fx[x.u.ccy]?.get(t)) && p.policy[x.u.bis]?.get(t) !== undefined && p.policy.US?.get(t) !== undefined)
    .sort((a, b) => b.s - a.s || a.u.ccy.localeCompare(b.u.ccy));
  if (ranked.length < spec.params.minCurrencies) return null;
  const k = Math.floor(ranked.length / 3);
  return { long: ranked.slice(0, k).map((x) => x.u.ccy), short: ranked.slice(-k).map((x) => x.u.ccy) };
}

export interface FxFactorResult {
  status: 'passed' | 'failed' | 'too_few_cases';
  verdict: string;
  months: number;
  years: number;
  /** Mean monthly net and gross return, %, and the annualised net (x 12). */
  meanNetPct: number;
  meanGrossPct: number;
  annualNetPct: number;
  /** Annualised Sharpe ratio of the net return. */
  sharpe: number;
  /** 90% range of the annualised mean net return from resampling whole years. */
  annualNetRange: [number, number];
  pValue: number;
  avgTurnover: number;
  span: { from: string; to: string };
  currencies: string[];
  /** Latest months, newest first, so a reader can check them. */
  recent: FxMonth[];
  /** Crash statistics of the net monthly returns: a description, not part of the verdict. */
  crash?: CrashStats;
}

export interface CrashStats {
  /** Largest fall from a peak of the compounded net return, %, with the months it ran between. */
  maxDrawdownPct: number;
  drawdownFrom: string;
  drawdownTo: string;
  worstMonth: { month: string; netPct: number };
  /** Worst three consecutive months, compounded, %. */
  worst3mPct: number;
  worst3mTo: string;
  /** Sample skewness and excess kurtosis of the monthly net returns. */
  skew: number;
  excessKurtosis: number;
  /** Share of months with a negative net return, %. */
  negativeMonthsPct: number;
}

/**
 * Crash statistics (seven-groups plan, group 4; gap analysis A3): how carry loses when it loses.
 * Returns are monthly net %, compounded for the drawdown and the three-month figure. Null under 12 months.
 */
export function crashStats(rows: FxMonth[]): CrashStats | null {
  const n = rows.length;
  if (n < 12) return null;
  const r = rows.map((x) => x.net);
  let level = 1;
  let peak = 1;
  let peakAt = rows[0].month;
  let dd = 0;
  let ddFrom = peakAt;
  let ddTo = peakAt;
  for (const x of rows) {
    level *= 1 + x.net / 100;
    if (level > peak) {
      peak = level;
      peakAt = x.month;
    }
    const fall = level / peak - 1;
    if (fall < dd) {
      dd = fall;
      ddFrom = peakAt;
      ddTo = x.month;
    }
  }
  let worst = 0;
  for (let i = 1; i < n; i++) if (r[i] < r[worst]) worst = i;
  let w3 = Infinity;
  let w3To = rows[2].month;
  for (let i = 2; i < n; i++) {
    const c = ((1 + r[i - 2] / 100) * (1 + r[i - 1] / 100) * (1 + r[i] / 100) - 1) * 100;
    if (c < w3) {
      w3 = c;
      w3To = rows[i].month;
    }
  }
  const m = r.reduce((a, v) => a + v, 0) / n;
  const m2 = r.reduce((a, v) => a + (v - m) ** 2, 0) / n;
  const m3 = r.reduce((a, v) => a + (v - m) ** 3, 0) / n;
  const m4 = r.reduce((a, v) => a + (v - m) ** 4, 0) / n;
  return {
    maxDrawdownPct: r3(dd * 100),
    drawdownFrom: ddFrom,
    drawdownTo: ddTo,
    worstMonth: { month: rows[worst].month, netPct: r3(r[worst]) },
    worst3mPct: r3(w3),
    worst3mTo: w3To,
    skew: m2 > 0 ? r3(m3 / m2 ** 1.5) : 0,
    excessKurtosis: m2 > 0 ? r3(m4 / m2 ** 2 - 3) : 0,
    negativeMonthsPct: r3((r.filter((v) => v < 0).length / n) * 100),
  };
}

/** One sentence for the register: labelled as a description. */
export function crashSentence(c: CrashStats): string {
  return `Crash statistics (description, not part of the test): largest drawdown ${c.maxDrawdownPct}% (${c.drawdownFrom} to ${c.drawdownTo}), worst month ${c.worstMonth.netPct}% (${c.worstMonth.month}), worst three months ${c.worst3mPct}% (to ${c.worst3mTo}), skew ${c.skew}, excess kurtosis ${c.excessKurtosis}, ${c.negativeMonthsPct}% of months negative.`;
}

const r3 = (v: number) => Number(v.toFixed(3));

export function judgeFxFactor(spec: FxFactorSpec, rows: FxMonth[]): FxFactorResult {
  const pm = spec.passMark;
  const n = rows.length;
  const mean = (v: number[]) => (v.length ? v.reduce((a, x) => a + x, 0) / v.length : 0);
  const net = rows.map((r) => r.net);
  const mNet = mean(net);
  const sd = n > 1 ? Math.sqrt(net.reduce((a, x) => a + (x - mNet) ** 2, 0) / (n - 1)) : 0;
  const byYear = new Map<string, number[]>();
  for (const r of rows) byYear.set(r.month.slice(0, 4), [...(byYear.get(r.month.slice(0, 4)) || []), r.net]);
  const years = [...byYear.keys()].sort();
  const rand = seededRandom(spec.params.seed);
  const draws: number[] = [];
  let atOrBelow = 0;
  for (let d = 0; d < spec.params.resamples && years.length; d++) {
    let s = 0;
    let c = 0;
    for (let k = 0; k < years.length; k++) {
      const ys = byYear.get(years[Math.floor(rand() * years.length)])!;
      for (const v of ys) s += v;
      c += ys.length;
    }
    const m = c ? s / c : 0;
    draws.push(m * 12);
    if (m <= 0) atOrBelow++;
  }
  draws.sort((a, b) => a - b);
  const q = (p: number) => (draws.length ? draws[Math.min(draws.length - 1, Math.floor(p * draws.length))] : NaN);
  const pValue = draws.length ? Number(((atOrBelow + 1) / (draws.length + 1)).toPrecision(3)) : 1;
  const annual = mNet * 12;
  let status: FxFactorResult['status'];
  let why: string;
  if (n < pm.minMonths || years.length < pm.minYears) {
    status = 'too_few_cases';
    why = `${n} months over ${years.length} years; needs ${pm.minMonths} months and ${pm.minYears} years`;
  } else if (pValue <= pm.maxPValue && annual >= pm.minAnnualNetPct) {
    status = 'passed';
    why = `net of costs it beat holding dollars`;
  } else {
    status = 'failed';
    why = pValue > pm.maxPValue ? `p ${pValue} is above ${pm.maxPValue} with whole years resampled` : `the annual net return of ${r3(annual)}% is below ${pm.minAnnualNetPct}%`;
  }
  const verdict = `${status === 'passed' ? 'Passed' : status === 'failed' ? 'Failed' : 'Too few cases'}: ${why}. ${spec.factor[0].toUpperCase()}${spec.factor.slice(1)} long-short, ${n} months: ${r3(annual)}% a year net of a ${spec.params.costPctPerSide}% cost per side (gross ${r3(mean(rows.map((r) => r.gross)) * 12)}%), 90% range ${r3(q(0.05))} to ${r3(q(0.95))}%, Sharpe ${sd ? r3((mNet / sd) * Math.sqrt(12)) : 0}, p ${pValue}.`;
  return {
    status,
    verdict,
    months: n,
    years: years.length,
    meanNetPct: r3(mNet),
    meanGrossPct: r3(mean(rows.map((r) => r.gross))),
    annualNetPct: r3(annual),
    sharpe: sd ? r3((mNet / sd) * Math.sqrt(12)) : 0,
    annualNetRange: [r3(q(0.05)), r3(q(0.95))],
    pValue,
    avgTurnover: r3(mean(rows.map((r) => r.turnover))),
    span: { from: rows[0]?.month || '', to: rows[n - 1]?.month || '' },
    currencies: [...new Set(rows.flatMap((r) => [...r.long, ...r.short]))].sort(),
    recent: rows.slice(-12).reverse(),
    ...(crashStats(rows) ? { crash: crashStats(rows)! } : {}),
  };
}

/** Month-end values from dated points (YYYY-MM-DD or YYYY-MM): the last value of each month. */
export function monthEndMap(points: Array<{ date: string; value: number }>): MonthMap {
  const m: MonthMap = new Map();
  for (const p of [...points].sort((a, b) => (a.date < b.date ? -1 : 1))) if (Number.isFinite(p.value) && /^\d{4}-\d{2}/.test(p.date)) m.set(p.date.slice(0, 7), p.value);
  return m;
}
