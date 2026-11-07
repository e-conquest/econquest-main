/**
 * Pre-registered backtests (Sam, 2026-11-05). A rule in the model register is marked passed or
 * failed only here, by a test whose rule, sample, outcome window and pass mark were written down and
 * hashed (validation/preregistered/*.json, hashes in manifest.json) before it ran. Changing any of
 * them is a new version of the test, visible in the manifest and in git history.
 *
 * Each test compares how often the signal was followed by what it points to (hit rate) with how
 * often the same outcome happened after any month or week in the same sample (base rate). It passes
 * only with enough cases, a lift of at least the stated points, and a one-sided binomial p-value
 * at or below the stated level. Fewer cases than the minimum = "too few cases to test".
 *
 * Method 2 (the stricter check, 2026-11-05): cases close in time are not independent. Turns and
 * policy moves cluster in global cycles, and CFTC entries in several USD crosses land in the same
 * weeks. So method 2 resamples whole calendar years of cases together (a block bootstrap, fixed
 * seed so every run gives the same answer), reports a 90% range for the lift, and asks that the
 * lift is positive in at least half the series with five or more cases. A test registered as
 * method 1 keeps its verdict; the method 2 reading is shown beside it. A test registered as
 * framework 2 is judged by method 2.
 *
 * The data are read as the app pulls them: BIS monthly policy rates, the OECD leading indicator via
 * DBnomics (today's vintage), CFTC weekly positioning. Pure functions: the runner fetches.
 */
import { cliTurns } from './oecdCli';
import { targetIn } from '../data/inflationTargetHistory';
import { ruleFamily } from './ruleFamily';
import type { CftcWeek } from './cftcPositioning';
import type { ValidationStatus } from '../data/modelRegister';

export type BacktestMethod = 'cli_turn_policy' | 'cftc_crowding' | 'taylor_gap' | 'regime_quadrant' | 'cycle_clock' | 'timing_unwind' | 'rule_family' | 'unrest_onset';

export interface BacktestSpec {
  id: string;
  version: number;
  registeredOn: string;
  registeredBy: string;
  hypothesis: string;
  method: BacktestMethod;
  params: Record<string, number>;
  sample: { from: string; to?: string };
  passMark: { minCases: number; minLiftPts: number; maxPValue: number; minSeriesShare?: number; minYears?: number };
  knownLimits: string[];
  /** Which method judges the verdict: 1 (cases independent, binomial p) unless set to 2. */
  framework?: 1 | 2;
  /** Set when this version re-tests a rule whose earlier version failed: what changed and why. */
  retestOf?: { version: number; verdict: string; change: string };
}

export interface SeriesLift {
  where: string;
  cases: number;
  hits: number;
  hitRatePct: number;
  baseRatePct: number;
  liftPts: number;
}

/** The stricter reading (method 2). */
export interface Robustness {
  method: 2;
  status: 'passed' | 'failed' | 'too_few_cases';
  verdict: string;
  /** Calendar years with at least one case: the units resampled. */
  years: number;
  resamples: number;
  /** One-sided p-value from resampling whole years. */
  pValue: number;
  /** 90% range of the lift, in points. */
  liftRangePts: [number, number];
  bySeries: SeriesLift[];
  /** Series with five or more cases, and how many of them show a positive lift. */
  seriesTested: number;
  seriesPositive: number;
  /** The lowest lift left when any one series is dropped. */
  worstWithoutOne: { without: string; liftPts: number } | null;
}

export interface BacktestCase {
  where: string;
  when: string;
  what: string;
  hit: boolean;
  /** Chance of the same outcome after any period in this series (base rate), 0 to 1. */
  base: number;
}

/**
 * A call the rule has made whose window has not run out yet (rule 7 of the signal standard: the
 * forward record). `due` = the last month or day of the window.
 */
export interface OpenCall {
  where: string;
  when: string;
  what: string;
  due: string;
}

const addDaysIso = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export interface BacktestResult {
  id: string;
  specVersion: number;
  specHash: string;
  ranAt: string;
  status: Extract<ValidationStatus, 'passed' | 'failed' | 'too_few_cases'>;
  /** Plain-English verdict. */
  verdict: string;
  cases: number;
  hits: number;
  hitRatePct: number;
  baseRatePct: number;
  liftPts: number;
  pValue: number;
  span: { from: string; to: string };
  series: string[];
  data: string;
  sample: BacktestCase[];
  /** Method that gave status and verdict (absent on results saved before method 2 = 1). */
  framework?: 1 | 2;
  /** The method 2 reading, on every result run since 2026-11-05. */
  robustness?: Robustness;
}

/* ------------------------------------------------------------------ statistics */

function logChoose(n: number, k: number): number {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/** One-sided binomial tail P(X >= k) for X ~ Bin(n, p). */
export function binomialUpperTail(n: number, k: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let total = 0;
  for (let i = k; i <= n; i++) total += Math.exp(logChoose(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  return Math.min(1, total);
}

/** Deterministic random numbers (mulberry32): the same cases always give the same p-value. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (x: number) => Number(x.toFixed(1));

function liftOf(cases: BacktestCase[]): SeriesLift & { lift: number } {
  const n = cases.length;
  const hits = cases.filter((c) => c.hit).length;
  const base = n ? cases.reduce((s, c) => s + c.base, 0) / n : 0;
  const rate = n ? hits / n : 0;
  return { where: '', cases: n, hits, hitRatePct: r1(rate * 100), baseRatePct: r1(base * 100), liftPts: r1((rate - base) * 100), lift: rate - base };
}

export const RESAMPLES = 4000;
const SERIES_MIN_CASES = 5;

/**
 * Method 2: block bootstrap by calendar year. Each resample draws as many years as there are,
 * with replacement, and takes every case in each drawn year, so cases in the same year (any
 * country) stay together. p = share of resampled lifts at or below zero (how often the edge
 * vanishes when the years are redrawn), with the usual +1 correction. When a lift comes from a
 * few unusual years, many redraws leave those years out and p rises.
 */
export function robustness(spec: BacktestSpec, cases: BacktestCase[], resamples = RESAMPLES): Robustness {
  const byYear = new Map<string, { hits: number; base: number; n: number }>();
  for (const c of cases) {
    const y = c.when.slice(0, 4);
    const b = byYear.get(y) || { hits: 0, base: 0, n: 0 };
    b.n++;
    b.base += c.base;
    if (c.hit) b.hits++;
    byYear.set(y, b);
  }
  const blocks = [...byYear.values()];
  const all = liftOf(cases);
  const rand = seededRandom(20261105);
  const draws: number[] = [];
  if (blocks.length) {
    for (let b = 0; b < resamples; b++) {
      let h = 0;
      let base = 0;
      let n = 0;
      for (let k = 0; k < blocks.length; k++) {
        const x = blocks[Math.floor(rand() * blocks.length)];
        h += x.hits;
        base += x.base;
        n += x.n;
      }
      draws.push(n ? (h - base) / n : 0);
    }
  }
  draws.sort((a, b) => a - b);
  const q = (p: number) => (draws.length ? draws[Math.min(draws.length - 1, Math.max(0, Math.floor(p * draws.length)))] : 0);
  const beyond = draws.filter((d) => d <= 0).length;
  const pValue = draws.length ? Number(((beyond + 1) / (draws.length + 1)).toPrecision(3)) : 1;
  const groups = new Map<string, BacktestCase[]>();
  for (const c of cases) groups.set(c.where, [...(groups.get(c.where) || []), c]);
  const bySeries = [...groups.entries()].map(([where, cs]) => {
    const { lift: _l, ...rest } = liftOf(cs);
    return { ...rest, where };
  }).sort((a, b) => b.cases - a.cases || a.where.localeCompare(b.where));
  const tested = bySeries.filter((s) => s.cases >= SERIES_MIN_CASES);
  const positive = tested.filter((s) => s.liftPts > 0).length;
  let worst: Robustness['worstWithoutOne'] = null;
  if (groups.size > 1) {
    for (const where of groups.keys()) {
      const l = liftOf(cases.filter((c) => c.where !== where)).liftPts;
      if (!worst || l < worst.liftPts) worst = { without: where, liftPts: l };
    }
  }
  const m = spec.passMark;
  const share = m.minSeriesShare ?? 0.5;
  const minYears = m.minYears ?? 8;
  const out = { method: 2 as const, years: blocks.length, resamples: draws.length, pValue, liftRangePts: [r1(q(0.05) * 100), r1(q(0.95) * 100)] as [number, number], bySeries, seriesTested: tested.length, seriesPositive: positive, worstWithoutOne: worst };
  const spread = tested.length ? `Positive in ${positive} of ${tested.length} series with ${SERIES_MIN_CASES} or more cases` : `No series has ${SERIES_MIN_CASES} or more cases`;
  const drop = worst ? `; dropping ${worst.without} leaves a lift of ${worst.liftPts} points` : '';
  const reading = `Lift ${all.liftPts} points, 90% range ${out.liftRangePts[0]} to ${out.liftRangePts[1]}, p = ${pValue} with whole years resampled together (${blocks.length} years). ${spread}${drop}.`;
  if (cases.length < m.minCases || blocks.length < minYears)
    return { ...out, status: 'too_few_cases', verdict: `Too few cases for the stricter check: ${cases.length} cases in ${blocks.length} years; it needs ${m.minCases} cases in ${minYears} years.` };
  const why: string[] = [];
  if (all.liftPts < m.minLiftPts) why.push(`the lift is below ${m.minLiftPts} points`);
  if (pValue > m.maxPValue) why.push(`p is above ${m.maxPValue} once cases in the same year are not counted as independent`);
  if (!tested.length || positive < Math.ceil(share * tested.length)) why.push(`it holds in fewer than ${Math.round(share * 100)}% of the series`);
  return why.length
    ? { ...out, status: 'failed', verdict: `Fails the stricter check: ${why.join('; ')}. ${reading}` }
    : { ...out, status: 'passed', verdict: `Passes the stricter check. ${reading}` };
}

/** Verdict from the cases and the pass mark fixed in the spec (method 1: cases independent). */
export function judge(spec: BacktestSpec, cases: BacktestCase[]): Pick<BacktestResult, 'status' | 'verdict' | 'cases' | 'hits' | 'hitRatePct' | 'baseRatePct' | 'liftPts' | 'pValue'> {
  const n = cases.length;
  const hits = cases.filter((c) => c.hit).length;
  const base = n ? cases.reduce((s, c) => s + c.base, 0) / n : 0;
  const rate = n ? hits / n : 0;
  const pValue = n ? binomialUpperTail(n, hits, base) : 1;
  const out = { cases: n, hits, hitRatePct: r1(rate * 100), baseRatePct: r1(base * 100), liftPts: r1((rate - base) * 100), pValue: Number(pValue.toPrecision(3)) };
  const m = spec.passMark;
  if (n < m.minCases) return { ...out, status: 'too_few_cases', verdict: `Too few cases to test: ${n} found, the test needs ${m.minCases}.` };
  const pass = out.liftPts >= m.minLiftPts && pValue <= m.maxPValue;
  const reading = `Followed ${hits} of ${n} times (${out.hitRatePct}%) against ${out.baseRatePct}% after any period: a lift of ${out.liftPts} points, p = ${out.pValue}.`;
  return pass
    ? { ...out, status: 'passed', verdict: `Passed. ${reading} The pass mark was a lift of ${m.minLiftPts} points or more with p at or below ${m.maxPValue}.` }
    : { ...out, status: 'failed', verdict: `Failed. ${reading} The pass mark was a lift of ${m.minLiftPts} points or more with p at or below ${m.maxPValue}.` };
}

/**
 * The full verdict: method 1 or method 2 as the spec was registered, plus the method 2 reading.
 * A framework 2 test passes only when method 2 passes.
 */
export function judgeWithRobustness(spec: BacktestSpec, cases: BacktestCase[]): ReturnType<typeof judge> & { framework: 1 | 2; robustness: Robustness } {
  const v1 = judge(spec, cases);
  const rob = robustness(spec, cases);
  const framework = spec.framework === 2 ? 2 : 1;
  if (framework === 1) return { ...v1, framework, robustness: rob };
  const verdict = rob.verdict.replace(/the stricter check/g, 'method 2 (the method this test was registered under)');
  return { ...v1, status: rob.status, verdict, pValue: rob.pValue, framework, robustness: rob };
}

/* ------------------------------------------------------------------ month helpers */

export const addMonths = (p: string, n: number): string => {
  const [y, m] = p.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

/** Splits a monthly series into unbroken runs of calendar months. */
export function monthlyRuns<T extends { period: string }>(pts: T[]): T[][] {
  const runs: T[][] = [];
  for (const p of pts) {
    const run = runs[runs.length - 1];
    if (run && addMonths(run[run.length - 1].period, 1) === p.period) run.push(p);
    else runs.push([p]);
  }
  return runs;
}

/* ------------------------------------------------------------------ CLI turn -> policy move */

/**
 * After each leading-indicator turn, dated when it could first be known (the turn month plus the
 * months that confirm it plus the publication lag), did the policy rate move the matching way
 * (peak -> cut, trough -> hike) within the window? Base rate: the share of all months in the same
 * span after which a move that way came within the window.
 */
export function cliTurnPolicyCases(
  spec: BacktestSpec,
  where: string,
  cli: { period: string; value: number }[],
  policy: { period: string; pct: number }[],
  open?: OpenCall[]
): BacktestCase[] {
  const { confirmMonths = 2, publicationLagMonths = 1, windowMonths = 6 } = spec.params;
  if (!cli.length || policy.length < 2) return [];
  const pct = new Map(policy.map((p) => [p.period, p.pct]));
  const first = policy[0].period;
  const last = policy[policy.length - 1].period;
  const moveIn = (m: string): number => {
    const a = pct.get(addMonths(m, -1));
    const b = pct.get(m);
    return a === undefined || b === undefined ? 0 : Math.sign(Number((b - a).toFixed(4)));
  };
  /** True / false when a move `dir` came in (from, from+window]; null when the window runs past the data. */
  const moved = (from: string, dir: number): boolean | null => {
    if (addMonths(from, windowMonths) > last || from < first) return null;
    for (let k = 1; k <= windowMonths; k++) if (moveIn(addMonths(from, k)) === dir) return true;
    return false;
  };
  const lo = spec.sample.from;
  const hi = spec.sample.to || '9999-12';
  const cliMonths = new Set(cli.map((p) => p.period));
  const baseFor = (dir: number) => {
    let n = 0;
    let yes = 0;
    for (const p of policy) {
      if (p.period < lo || p.period > hi || !cliMonths.has(p.period)) continue;
      const m = moved(p.period, dir);
      if (m === null) continue;
      n++;
      if (m) yes++;
    }
    return n ? yes / n : 0;
  };
  const base = { [-1]: baseFor(-1), [1]: baseFor(1) } as Record<number, number>;
  const out: BacktestCase[] = [];
  for (const run of monthlyRuns(cli)) {
    for (const t of cliTurns(run)) {
      const known = addMonths(t.month, confirmMonths + publicationLagMonths);
      if (known < lo || known > hi) continue;
      const dir = t.kind === 'peak' ? -1 : 1;
      const hit = moved(known, dir);
      const what = `${t.kind} in ${t.month}, known ${known}: ${dir < 0 ? 'cut' : 'hike'} within ${windowMonths} months?`;
      if (hit === null) {
        if (known >= first && addMonths(known, windowMonths) > last) open?.push({ where, when: known, what, due: addMonths(known, windowMonths) });
        continue;
      }
      out.push({ where, when: known, what, hit, base: base[dir] });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ Taylor gap -> policy move */

/**
 * Each month: rule rate = rStar + inflation + inflationWeight x (inflation - target)
 * [+ outputWeight x output gap], with the inflation published by then (publicationLagMonths back)
 * and the target in force that month (src/data/inflationTargetHistory.ts). Version 1 has no output
 * gap. With outputWeight set, the gap is the real-time annual estimate for the latest year whose
 * outturn was out by then (year t from month gapPublishMonth of t+1); months without one are skipped. Policy more than bandPts above the rule = tight, below = loose. A call is the first
 * month of a run of the same reading. Hit: tight -> a cut, loose -> a hike, within windowMonths.
 * Base rate: the share of all months in the same span followed by a cut (hike) within the window.
 */
export function taylorGapCases(
  spec: BacktestSpec,
  iso3: string,
  inflation: { period: string; value: number }[],
  policy: { period: string; pct: number }[],
  /** Real-time output gap by year (% of potential), needed when params.outputWeight > 0. */
  outputGap?: { year: string; gap: number }[],
  open?: OpenCall[]
): BacktestCase[] {
  const { publicationLagMonths = 2, windowMonths = 6, bandPts = 1, rStar = 2, inflationWeight = 0.5, outputWeight = 0, gapPublishMonth = 4 } = spec.params;
  if (!inflation.length || policy.length < 2) return [];
  if (outputWeight && !outputGap?.length) return [];
  /** The gap known in month m: the latest year whose outturn was out by then (year t from gapPublishMonth of t+1). */
  const gaps = [...(outputGap || [])].sort((a, b) => a.year.localeCompare(b.year));
  const gapKnownIn = (m: string): { year: string; gap: number } | undefined => {
    let found: { year: string; gap: number } | undefined;
    for (const g of gaps) if (`${Number(g.year) + 1}-${String(gapPublishMonth).padStart(2, '0')}` <= m) found = g;
    return found;
  };
  const pct = new Map(policy.map((p) => [p.period, p.pct]));
  const cpi = new Map(inflation.map((p) => [p.period, p.value]));
  const last = policy[policy.length - 1].period;
  const moveIn = (m: string): number => {
    const a = pct.get(addMonths(m, -1));
    const b = pct.get(m);
    return a === undefined || b === undefined ? 0 : Math.sign(Number((b - a).toFixed(4)));
  };
  const moved = (from: string, dir: number): boolean | null => {
    if (addMonths(from, windowMonths) > last) return null;
    for (let k = 1; k <= windowMonths; k++) if (moveIn(addMonths(from, k)) === dir) return true;
    return false;
  };
  const lo = spec.sample.from;
  const hi = spec.sample.to || '9999-12';
  type Row = { month: string; reading: -1 | 0 | 1; gap: number; rule: number; target: number; infl: number; rate: number; og?: { year: string; gap: number } };
  const rows: Row[] = [];
  for (const p of policy) {
    if (p.period < lo || p.period > hi) continue;
    const t = targetIn(iso3, p.period);
    const infl = cpi.get(addMonths(p.period, -publicationLagMonths));
    if (!t || infl === undefined) continue;
    const og = outputWeight ? gapKnownIn(p.period) : undefined;
    if (outputWeight && !og) continue;
    const rule = rStar + infl + inflationWeight * (infl - t.pct) + (og ? outputWeight * og.gap : 0);
    const gap = p.pct - rule;
    rows.push({ month: p.period, reading: gap > bandPts ? 1 : gap < -bandPts ? -1 : 0, gap, rule, target: t.pct, infl, rate: p.pct, og });
  }
  const baseFor = (dir: number) => {
    let n = 0;
    let yes = 0;
    for (const r of rows) {
      const m = moved(r.month, dir);
      if (m === null) continue;
      n++;
      if (m) yes++;
    }
    return n ? yes / n : 0;
  };
  const base = { [-1]: baseFor(-1), [1]: baseFor(1) } as Record<number, number>;
  const out: BacktestCase[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.reading) continue;
    // First month of a run: the month before was a different reading, or not a consecutive month.
    const prev = rows[i - 1];
    if (prev && prev.reading === r.reading && addMonths(prev.month, 1) === r.month) continue;
    const want = r.reading === 1 ? -1 : 1;
    const hit = moved(r.month, want);
    const what = `${r.reading === 1 ? 'tight' : 'loose'}: policy ${r.rate.toFixed(2)}% vs rule ${r.rule.toFixed(2)}% (inflation ${r.infl.toFixed(1)}%, target ${r.target}%${r.og ? `, output gap ${r.og.gap.toFixed(1)}% in ${r.og.year}` : ''}): ${want < 0 ? 'cut' : 'hike'} within ${windowMonths} months?`;
    if (hit === null) {
      if (addMonths(r.month, windowMonths) > last) open?.push({ where: iso3, when: r.month, what, due: addMonths(r.month, windowMonths) });
      continue;
    }
    out.push({
      where: iso3,
      when: r.month,
      what,
      hit,
      base: base[want],
    });
  }
  return out;
}

/* ------------------------------------------------------------------ policy rule family -> next move */

/**
 * The Policy rules panel (src/utils/ruleFamily.ts) as it would have read each month: the policy rate
 * against the five rules, with inflation lagged publicationLagMonths, the target in force then, and
 * the real-time output gap (year t from gapPublishMonth of t+1; the year before for the first-
 * difference rule). A month reads above (below) the range when the panel would say so. A case is
 * the first month of such a run; hit: a cut (hike) within windowMonths. Base rate: the same move
 * after any month that could be read. Months without a gap are left out, so every case has all five
 * rules (or four, when the year before has no gap).
 */
export function ruleFamilyCases(
  spec: BacktestSpec,
  iso3: string,
  inflation: { period: string; value: number }[],
  policy: { period: string; pct: number }[],
  outputGap: { year: string; gap: number }[],
  open?: OpenCall[]
): BacktestCase[] {
  const { publicationLagMonths = 2, windowMonths = 6, gapPublishMonth = 4, rStar = 2 } = spec.params;
  if (!inflation.length || policy.length < 2 || !outputGap.length) return [];
  const gaps = [...outputGap].sort((a, b) => a.year.localeCompare(b.year));
  const gapByYear = new Map(gaps.map((g) => [g.year, g.gap]));
  const gapKnownIn = (m: string): { year: string; gap: number } | undefined => {
    let found: { year: string; gap: number } | undefined;
    for (const g of gaps) if (`${Number(g.year) + 1}-${String(gapPublishMonth).padStart(2, '0')}` <= m) found = g;
    return found;
  };
  const pct = new Map(policy.map((p) => [p.period, p.pct]));
  const cpi = new Map(inflation.map((p) => [p.period, p.value]));
  const last = policy[policy.length - 1].period;
  const moveIn = (m: string): number => {
    const a = pct.get(addMonths(m, -1));
    const b = pct.get(m);
    return a === undefined || b === undefined ? 0 : Math.sign(Number((b - a).toFixed(4)));
  };
  const moved = (from: string, dir: number): boolean | null => {
    if (addMonths(from, windowMonths) > last) return null;
    for (let k = 1; k <= windowMonths; k++) if (moveIn(addMonths(from, k)) === dir) return true;
    return false;
  };
  const lo = spec.sample.from;
  const hi = spec.sample.to || '9999-12';
  type Row = { month: string; reading: -1 | 0 | 1; what: string };
  const rows: Row[] = [];
  for (const p of policy) {
    if (p.period < lo || p.period > hi) continue;
    const t = targetIn(iso3, p.period);
    const infl = cpi.get(addMonths(p.period, -publicationLagMonths));
    const og = gapKnownIn(p.period);
    if (!t || infl === undefined || !og) continue;
    const prev = gapByYear.get(String(Number(og.year) - 1));
    const r = ruleFamily({ policyPct: p.pct, inflation: { pct: infl, month: addMonths(p.period, -publicationLagMonths) }, targetPct: t.pct, gap: { pct: og.gap, year: og.year, prevPct: prev, source: 'estimate' }, rStar });
    if (!r.ok) continue;
    const reading = r.position === 'above the range' ? 1 : r.position === 'below the range' ? -1 : 0;
    rows.push({ month: p.period, reading, what: `policy ${p.pct.toFixed(2)}% vs rules ${r.range.lo.toFixed(2)}-${r.range.hi.toFixed(2)}% (inflation ${infl.toFixed(1)}%, target ${t.pct}%, gap ${og.gap.toFixed(1)}% in ${og.year})` });
  }
  const baseFor = (dir: number) => {
    let n = 0;
    let yes = 0;
    for (const r of rows) {
      const m = moved(r.month, dir);
      if (m === null) continue;
      n++;
      if (m) yes++;
    }
    return n ? yes / n : 0;
  };
  const base = { [-1]: baseFor(-1), [1]: baseFor(1) } as Record<number, number>;
  const out: BacktestCase[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.reading) continue;
    const prev = rows[i - 1];
    if (prev && prev.reading === r.reading && addMonths(prev.month, 1) === r.month) continue;
    const want = r.reading === 1 ? -1 : 1;
    const hit = moved(r.month, want);
    const what = `${r.reading === 1 ? 'above' : 'below'} every rule: ${r.what}: ${want < 0 ? 'cut' : 'hike'} within ${windowMonths} months?`;
    if (hit === null) {
      if (addMonths(r.month, windowMonths) > last) open?.push({ where: iso3, when: r.month, what, due: addMonths(r.month, windowMonths) });
      continue;
    }
    out.push({ where: iso3, when: r.month, what, hit, base: base[want] });
  }
  return out;
}

/* ------------------------------------------------------------------ CFTC crowding -> unwind */

/**
 * Leveraged-fund net positioning as a share of open interest. A week is crowded long (short) when
 * it ranks at or above highPct (at or below lowPct) among the lookback weeks before it and itself:
 * only past weeks, no hindsight. An entry counts when the week before was not crowded that way and
 * no entry the same way was counted in the minGapWeeks before. Hit: the share comes back unwindPts
 * within windowWeeks. Base rate: the same move after any week with enough history.
 */
export function cftcCrowdingCases(spec: BacktestSpec, where: string, weeks: CftcWeek[], open?: OpenCall[]): BacktestCase[] {
  const { lookbackWeeks = 156, minLookbackWeeks = 52, highPct = 90, lowPct = 10, windowWeeks = 8, unwindPts = 3, minGapWeeks = 8 } = spec.params;
  const share = weeks.map((w) => (w.levNet / w.openInterest) * 100);
  const rank = (i: number): number | null => {
    if (i < minLookbackWeeks) return null;
    const past = share.slice(Math.max(0, i - lookbackWeeks), i + 1);
    return (past.filter((v) => v <= share[i]).length / past.length) * 100;
  };
  const lo = spec.sample.from;
  const hi = spec.sample.to || '9999-12-31';
  const inSample = (i: number) => weeks[i].date >= lo && weeks[i].date <= hi && i + windowWeeks < share.length && i >= minLookbackWeeks;
  const unwound = (i: number, dir: 1 | -1) => share.slice(i + 1, i + 1 + windowWeeks).some((v) => (dir === 1 ? v <= share[i] - unwindPts : v >= share[i] + unwindPts));
  const baseFor = (dir: 1 | -1) => {
    let n = 0;
    let yes = 0;
    for (let i = 0; i < share.length; i++) {
      if (!inSample(i)) continue;
      n++;
      if (unwound(i, dir)) yes++;
    }
    return n ? yes / n : 0;
  };
  const base = { 1: baseFor(1), [-1]: baseFor(-1) } as Record<number, number>;
  const out: BacktestCase[] = [];
  const lastEntry: Record<number, number> = { 1: -Infinity, [-1]: -Infinity };
  let prevRank = rank(minLookbackWeeks - 1);
  for (let i = minLookbackWeeks; i < share.length; i++) {
    const r = rank(i);
    if (r === null) continue;
    const dir: 1 | -1 | 0 = r >= highPct && (prevRank === null || prevRank < highPct) ? 1 : r <= lowPct && (prevRank === null || prevRank > lowPct) ? -1 : 0;
    prevRank = r;
    if (!dir || i - lastEntry[dir] < minGapWeeks) continue;
    const what = `entered crowded ${dir === 1 ? 'long' : 'short'} (${Math.round(r)}th percentile): back ${unwindPts} pts within ${windowWeeks} weeks?`;
    if (!inSample(i)) {
      // Window still running: an open call (rule 7), not a case.
      if (i + windowWeeks >= share.length && weeks[i].date >= lo && weeks[i].date <= hi) {
        lastEntry[dir] = i;
        open?.push({ where, when: weeks[i].date, what, due: addDaysIso(weeks[i].date, windowWeeks * 7) });
      }
      continue;
    }
    lastEntry[dir] = i;
    out.push({ where, when: weeks[i].date, what, hit: unwound(i, dir), base: base[dir] });
  }
  return out;
}

/* ------------------------------------------------------------------ shared: policy moves */

/** Policy-move helpers on one monthly BIS series: the sign of the move in a month, and whether a move one way came within a window. */
function policyMoves(policy: { period: string; pct: number }[], windowMonths: number) {
  const pct = new Map(policy.map((p) => [p.period, p.pct]));
  const first = policy[0]?.period ?? '';
  const last = policy[policy.length - 1]?.period ?? '';
  const moveIn = (m: string): number => {
    const a = pct.get(addMonths(m, -1));
    const b = pct.get(m);
    return a === undefined || b === undefined ? 0 : Math.sign(Number((b - a).toFixed(4)));
  };
  /** True / false when a move `dir` came in (from, from+window]; null when the window runs past the data. */
  const moved = (from: string, dir: number): boolean | null => {
    if (addMonths(from, windowMonths) > last || from < first) return null;
    for (let k = 1; k <= windowMonths; k++) if (moveIn(addMonths(from, k)) === dir) return true;
    return false;
  };
  return { pct, moveIn, moved };
}

/** Calls from monthly readings: the first month of each run of the same non-zero reading, with the base rate from every row. */
function callsFromReadings(
  where: string,
  rows: { month: string; reading: -1 | 0 | 1; text: string }[],
  /** Direction of the move each reading points to. */
  want: (reading: -1 | 1) => -1 | 1,
  moved: (from: string, dir: number) => boolean | null,
  windowMonths: number,
  open?: OpenCall[],
  last?: string
): BacktestCase[] {
  const baseFor = (dir: number) => {
    let n = 0;
    let yes = 0;
    for (const r of rows) {
      const m = moved(r.month, dir);
      if (m === null) continue;
      n++;
      if (m) yes++;
    }
    return n ? yes / n : 0;
  };
  const base = { [-1]: baseFor(-1), [1]: baseFor(1) } as Record<number, number>;
  const out: BacktestCase[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.reading) continue;
    const prev = rows[i - 1];
    if (prev && prev.reading === r.reading && addMonths(prev.month, 1) === r.month) continue;
    const dir = want(r.reading);
    const hit = moved(r.month, dir);
    const what = `${r.text}: ${dir < 0 ? 'cut' : 'hike'} within ${windowMonths} months?`;
    if (hit === null) {
      if (last && addMonths(r.month, windowMonths) > last) open?.push({ where, when: r.month, what, due: addMonths(r.month, windowMonths) });
      continue;
    }
    out.push({ where, when: r.month, what, hit, base: base[dir] });
  }
  return out;
}

/* ------------------------------------------------------------------ growth and inflation quadrant -> policy move */

/**
 * Each month, with the data published by then: growth = change in the leading indicator over
 * cliChangeMonths (read cliLagMonths back), inflation = change in y/y inflation over
 * cpiChangeMonths (read cpiLagMonths back), each "up" above zero, as the app's quadrant.
 * Both up = a hike call; both down = a cut call; the mixed quadrants make no call. A call is the
 * first month of a run of the same reading. Base rate: the same move after any month in the span.
 */
export function regimeQuadrantCases(
  spec: BacktestSpec,
  where: string,
  cli: { period: string; value: number }[],
  inflation: { period: string; value: number }[],
  policy: { period: string; pct: number }[],
  open?: OpenCall[]
): BacktestCase[] {
  const { cliLagMonths = 1, cpiLagMonths = 2, cliChangeMonths = 6, cpiChangeMonths = 3, windowMonths = 6 } = spec.params;
  if (!cli.length || !inflation.length || policy.length < 2) return [];
  const c = new Map(cli.map((p) => [p.period, p.value]));
  const i = new Map(inflation.map((p) => [p.period, p.value]));
  const { moved } = policyMoves(policy, windowMonths);
  const lo = spec.sample.from;
  const hi = spec.sample.to || '9999-12';
  const rows: { month: string; reading: -1 | 0 | 1; text: string }[] = [];
  for (const p of policy) {
    if (p.period < lo || p.period > hi) continue;
    const cm = addMonths(p.period, -cliLagMonths);
    const im = addMonths(p.period, -cpiLagMonths);
    const c1 = c.get(cm);
    const c0 = c.get(addMonths(cm, -cliChangeMonths));
    const i1 = i.get(im);
    const i0 = i.get(addMonths(im, -cpiChangeMonths));
    if (c1 === undefined || c0 === undefined || i1 === undefined || i0 === undefined) continue;
    const g = c1 - c0;
    const inf = i1 - i0;
    const reading = g > 0 && inf > 0 ? 1 : g <= 0 && inf <= 0 ? -1 : 0;
    rows.push({ month: p.period, reading, text: `growth ${g > 0 ? 'up' : 'down'} (${g >= 0 ? '+' : ''}${g.toFixed(2)} to ${cm}), inflation ${inf > 0 ? 'up' : 'down'} (${inf >= 0 ? '+' : ''}${inf.toFixed(1)} pts to ${im})` });
  }
  return callsFromReadings(where, rows, (r) => r, moved, windowMonths, open, policy[policy.length - 1].period);
}

/* ------------------------------------------------------------------ cycle clock -> next move */

/**
 * The cycle clock's reading each month: hiking when the latest move in the past holdAfterMonths
 * (this month included) was a hike, cutting when it was a cut, on hold otherwise, as the app's
 * clock. A call is the first month of a hiking (cutting) run: the cycle keeps going, so another
 * hike (cut) comes within windowMonths. Base rate: the same move after any month in the span.
 */
export function cycleClockCases(spec: BacktestSpec, where: string, policy: { period: string; pct: number }[], open?: OpenCall[]): BacktestCase[] {
  const { holdAfterMonths = 6, windowMonths = 6 } = spec.params;
  if (policy.length < 2) return [];
  const { pct, moveIn, moved } = policyMoves(policy, windowMonths);
  const lo = spec.sample.from;
  const hi = spec.sample.to || '9999-12';
  const rows: { month: string; reading: -1 | 0 | 1; text: string }[] = [];
  for (const p of policy) {
    if (p.period < lo || p.period > hi) continue;
    let reading: -1 | 0 | 1 = 0;
    for (let k = 0; k < holdAfterMonths; k++) {
      const m = addMonths(p.period, -k);
      if (!pct.has(m)) break;
      const d = moveIn(m);
      if (d) {
        reading = d > 0 ? 1 : -1;
        break;
      }
    }
    rows.push({ month: p.period, reading, text: `${reading > 0 ? 'hiking' : reading < 0 ? 'cutting' : 'on hold'} from ${p.period} (policy ${p.pct.toFixed(2)}%)` });
  }
  return callsFromReadings(where, rows, (r) => r, moved, windowMonths, open, policy[policy.length - 1].period);
}

/* ------------------------------------------------------------------ Timing Agent unwind setup */

/**
 * The Timing Agent's one call: positioning crowded (at or above highPct, or at or below lowPct,
 * of the lookback weeks, past weeks only) AND already turning (its share of open interest moved
 * turnPts or more against the crowd over turnWeeks) = "the setup in which a crowded position
 * unwinds". Hit: the share moves a further unwindPts the same way within windowWeeks. A setup
 * counts when the week before was not a setup that way and none was counted in the minGapWeeks
 * before. Base rate: the same further move after any week with enough history.
 */
export function timingUnwindCases(spec: BacktestSpec, where: string, weeks: CftcWeek[], open?: OpenCall[]): BacktestCase[] {
  const { lookbackWeeks = 156, minLookbackWeeks = 52, highPct = 90, lowPct = 10, turnWeeks = 4, turnPts = 3, windowWeeks = 8, unwindPts = 3, minGapWeeks = 8 } = spec.params;
  const share = weeks.map((w) => (w.levNet / w.openInterest) * 100);
  const rank = (i: number): number | null => {
    if (i < minLookbackWeeks) return null;
    const past = share.slice(Math.max(0, i - lookbackWeeks), i + 1);
    return (past.filter((v) => v <= share[i]).length / past.length) * 100;
  };
  const lo = spec.sample.from;
  const hi = spec.sample.to || '9999-12-31';
  const inSample = (i: number) => weeks[i].date >= lo && weeks[i].date <= hi && i + windowWeeks < share.length && i >= Math.max(minLookbackWeeks, turnWeeks);
  // dir 1 = crowded long, unwinding means the share falls.
  const further = (i: number, dir: 1 | -1) => share.slice(i + 1, i + 1 + windowWeeks).some((v) => (dir === 1 ? v <= share[i] - unwindPts : v >= share[i] + unwindPts));
  const baseFor = (dir: 1 | -1) => {
    let n = 0;
    let yes = 0;
    for (let i = 0; i < share.length; i++) {
      if (!inSample(i)) continue;
      n++;
      if (further(i, dir)) yes++;
    }
    return n ? yes / n : 0;
  };
  const base = { 1: baseFor(1), [-1]: baseFor(-1) } as Record<number, number>;
  const setupAt = (i: number): 1 | -1 | 0 => {
    const r = rank(i);
    if (r === null || i < turnWeeks) return 0;
    const chg = share[i] - share[i - turnWeeks];
    if (r >= highPct && chg <= -turnPts) return 1;
    if (r <= lowPct && chg >= turnPts) return -1;
    return 0;
  };
  const out: BacktestCase[] = [];
  const lastEntry: Record<number, number> = { 1: -Infinity, [-1]: -Infinity };
  for (let i = Math.max(minLookbackWeeks, turnWeeks); i < share.length; i++) {
    const dir = setupAt(i);
    if (!dir || setupAt(i - 1) === dir || i - lastEntry[dir] < minGapWeeks) continue;
    const chg = share[i] - share[i - turnWeeks];
    const what = `crowded ${dir === 1 ? 'long' : 'short'} and turning (${chg >= 0 ? '+' : ''}${chg.toFixed(1)} pts in ${turnWeeks} weeks): a further ${unwindPts} pts within ${windowWeeks} weeks?`;
    if (!inSample(i)) {
      if (i + windowWeeks >= share.length && weeks[i].date >= lo && weeks[i].date <= hi) {
        lastEntry[dir] = i;
        open?.push({ where, when: weeks[i].date, what, due: addDaysIso(weeks[i].date, windowWeeks * 7) });
      }
      continue;
    }
    lastEntry[dir] = i;
    out.push({ where, when: weeks[i].date, what, hit: further(i, dir), base: base[dir] });
  }
  return out;
}

/* ------------------------------------------------------------------ unrest spike -> conflict onset */

/** One country-year for the unrest onset test. */
export interface OnsetYear {
  where: string;
  year: number;
  /** Complete GDELT months in the year with a full baseline. */
  months: number;
  /** Spike episodes in the year (protests or violence), as "YYYY-MM protests". */
  episodes: string[];
  /** No state-based armed conflict located in the country this year (UCDP/PRIO). */
  quiet: boolean;
  /** Conflict located in the country next year; null when UCDP does not cover next year yet. */
  next: boolean | null;
}

/**
 * Unrest spike -> conflict onset: among quiet country-years (no state-based armed conflict located
 * in the country, UCDP/PRIO) with at least minMonthsInYear complete GDELT months, those with a
 * spike episode are calls that a conflict starts the next calendar year. Base rate: the share of
 * every quiet country-year in the sample followed by a conflict, pooled (onsets are too rare for a
 * per-country rate). Quiet spike years whose next year UCDP does not cover yet are open calls.
 */
export function unrestOnsetCases(spec: BacktestSpec, years: OnsetYear[], open?: OpenCall[]): BacktestCase[] {
  const { minMonthsInYear = 10 } = spec.params;
  const lo = Number(spec.sample.from);
  const hi = spec.sample.to ? Number(spec.sample.to) : 9999;
  const usable = years.filter((y) => y.quiet && y.months >= minMonthsInYear && y.year >= lo && y.year <= hi);
  const known = usable.filter((y) => y.next !== null);
  const base = known.length ? known.filter((y) => y.next).length / known.length : 0;
  const out: BacktestCase[] = [];
  for (const y of usable) {
    if (!y.episodes.length) continue;
    const what = `spike episodes in ${y.year} (${y.episodes.slice(0, 3).join(', ')}${y.episodes.length > 3 ? ', ...' : ''}) with no armed conflict: conflict in ${y.year + 1}?`;
    if (y.next === null) {
      open?.push({ where: y.where, when: String(y.year), what, due: String(y.year + 1) });
      continue;
    }
    out.push({ where: y.where, when: String(y.year), what, hit: y.next, base });
  }
  return out;
}

/** Keeps the result file small: an even spread of the cases, oldest first. */
export function sampleCases(cases: BacktestCase[], max = 300): BacktestCase[] {
  const sorted = [...cases].sort((a, b) => a.when.localeCompare(b.when));
  if (sorted.length <= max) return sorted;
  const step = sorted.length / max;
  return Array.from({ length: max }, (_, i) => sorted[Math.floor(i * step)]);
}

export function spanOf(cases: BacktestCase[]): { from: string; to: string } {
  const w = cases.map((c) => c.when).sort();
  return { from: w[0] ?? '', to: w[w.length - 1] ?? '' };
}
