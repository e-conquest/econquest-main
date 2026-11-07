/**
 * Debt sustainability view for one country (Sam, 2026-11-05): standard public debt dynamics on
 * IMF figures, a decomposition of past changes, and a set of stated stress scenarios.
 *
 *   d(t) = d(t-1) x (1 + i(t)) / (1 + n(t)) - pb(t) + sfa(t)
 *
 * d = general government gross debt (% of GDP, IMF WEO GGXWDG_NGDP); pb = primary balance (% of
 * GDP, IMF Fiscal Monitor GGXONLB_G01_GDP_PT); i = effective nominal interest rate = net interest
 * paid (primary minus overall balance, GGXCNL_G01_GDP_PT) over last year's debt; n = nominal GDP
 * growth = (1 + real growth NGDP_RPCH) x (1 + inflation PCPIPCH) - 1. The IMF DataMapper has no GDP
 * deflator, so consumer price inflation stands in for it and every reading says so. sfa = stock-
 * flow adjustment: whatever the identity leaves unexplained in a past year (valuation changes on
 * foreign-currency debt, privatisation receipts, bank support and so on).
 *
 * Scenarios run five years from the last outturn year:
 *   - IMF path: the IMF's own WEO debt projection, as published.
 *   - Baseline: the identity on the IMF's projected growth, inflation, primary balance and interest,
 *     with no stock-flow adjustment. Where it parts from the IMF path, the IMF assumes one.
 *   - Historical: growth, inflation, interest and primary balance at their last ten outturn years'
 *     averages.
 *   - Growth shock: real growth one standard deviation (last ten years) lower in years 1 and 2.
 *   - Primary balance shock: primary balance lower by half its ten-year standard deviation, years 1-2.
 *   - Interest rate shock: effective rate 2 points higher from year 1, phased in as debt rolls over
 *     (a fifth of the stock a year), so year 5 carries the full 2 points.
 *   - Combined: the three shocks together.
 * The shocks follow the shape of the IMF's standardised stress tests for market-access countries
 * (IMF 2013 Staff Guidance Note); the sizes above are the app's stated choices, not the IMF's
 * country-specific calibration. A view on stated assumptions, not a forecast or an IMF DSA.
 *
 * Browser-safe.
 */
import type { Series } from './seriesHistory';
import type { DsaSummary } from '../types/council';

export const DSA_HORIZON = 5;
export const DSA_HISTORY_YEARS = 10;
export const INTEREST_SHOCK_PTS = 2;
export const ROLLOVER_SHARE = 0.2;

export const DSA_REFERENCES = [
  'IMF (2013), "Staff Guidance Note for Public Debt Sustainability Analysis in Market-Access Countries", IMF Policy Paper, May 2013.',
  'IMF World Economic Outlook database (DataMapper): GGXWDG_NGDP, NGDP_RPCH, PCPIPCH. IMF Fiscal Monitor: GGXONLB_G01_GDP_PT, GGXCNL_G01_GDP_PT.',
];

export interface DsaInputs {
  debt?: Series;
  primaryBalance?: Series;
  overallBalance?: Series;
  realGrowth?: Series;
  inflation?: Series;
}

export interface DsaHistoryYear {
  year: string;
  debt: number;
  primaryBalance: number;
  /** Effective nominal interest rate, %. */
  interestPct?: number;
  realGrowthPct: number;
  inflationPct: number;
  /** Change in debt, points of GDP. */
  change?: number;
  /** Contribution of the interest rate-growth differential (snowball), points. */
  snowball?: number;
  /** Contribution of the primary balance (minus pb), points. */
  primary?: number;
  /** What the identity leaves unexplained, points. */
  stockFlow?: number;
}

export type ScenarioId = 'imf' | 'baseline' | 'historical' | 'growth' | 'primary' | 'interest' | 'combined';

export interface DsaScenario {
  id: ScenarioId;
  label: string;
  about: string;
  /** Debt, % of GDP, by year; the first point is the last outturn. */
  path: Array<{ year: string; debt: number }>;
  end: number;
}

export interface DsaResult {
  ok: true;
  lastOutturnYear: string;
  debtNow: number;
  history: DsaHistoryYear[];
  /** r - g on the last ten years' averages, points (real interest rate less real growth). */
  rMinusG?: number;
  /** Primary balance that holds debt steady on the baseline averages, % of GDP. */
  stabilisingPb?: number;
  /** Average projected primary balance in the IMF's numbers, % of GDP. */
  projectedPb?: number;
  scenarios: DsaScenario[];
  /** The IMF projected inputs the baseline ran on (growth, inflation, interest, primary balance), when it ran. */
  baselineInputs?: YearAssump[];
  /** Highest debt at the horizon across the stress scenarios, and which. */
  worst?: { id: ScenarioId; label: string; end: number };
  missing: string[];
  method: string;
  sources: string[];
  pulledAt?: string;
}

export type DsaOutcome = DsaResult | { ok: false; reason: string; missing: string[] };

const r2 = (v: number) => Number(v.toFixed(2));
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const sd = (v: number[]) => {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
};

function byYear(s?: Series): Map<string, { value: number; projection: boolean }> {
  const m = new Map<string, { value: number; projection: boolean }>();
  for (const p of s?.points || []) if (Number.isFinite(p.value)) m.set(p.date, { value: p.value, projection: p.note === 'IMF projection' });
  return m;
}

/** Nominal growth from real growth and inflation, both in %. */
export function nominalGrowthPct(realPct: number, inflationPct: number): number {
  return ((1 + realPct / 100) * (1 + inflationPct / 100) - 1) * 100;
}

/** One year of the identity: next debt from last year's debt, interest, nominal growth and primary balance. */
export function nextDebt(prevDebt: number, interestPct: number, nominalGrowth: number, primaryBalance: number, stockFlow = 0): number {
  return (prevDebt * (1 + interestPct / 100)) / (1 + nominalGrowth / 100) - primaryBalance + stockFlow;
}

/** Primary balance that keeps debt/GDP steady: d x (i - n) / (1 + n). */
export function debtStabilisingPb(debt: number, interestPct: number, nominalGrowth: number): number {
  return (debt * (interestPct - nominalGrowth)) / (100 + nominalGrowth);
}

export interface YearAssump {
  year: string;
  g: number;
  pi: number;
  i: number;
  pb: number;
}

function runPath(start: { year: string; debt: number }, years: YearAssump[]): Array<{ year: string; debt: number }> {
  const out = [{ year: start.year, debt: r2(start.debt) }];
  let d = start.debt;
  for (const y of years) {
    d = nextDebt(d, y.i, nominalGrowthPct(y.g, y.pi), y.pb);
    out.push({ year: y.year, debt: r2(d) });
  }
  return out;
}

export function debtSustainability(inp: DsaInputs): DsaOutcome {
  const D = byYear(inp.debt);
  const PB = byYear(inp.primaryBalance);
  const OB = byYear(inp.overallBalance);
  const G = byYear(inp.realGrowth);
  const PI = byYear(inp.inflation);
  const missing: string[] = [];
  if (!D.size) missing.push('government debt (IMF WEO GGXWDG_NGDP)');
  if (!PB.size) missing.push('primary balance (IMF Fiscal Monitor GGXONLB_G01_GDP_PT)');
  if (!G.size) missing.push('real GDP growth (IMF WEO NGDP_RPCH)');
  if (!PI.size) missing.push('inflation (IMF WEO PCPIPCH)');
  if (missing.length) return { ok: false, reason: `Needs ${missing.join(', ')}`, missing };
  const noInterest = !OB.size;
  if (noInterest) missing.push('overall balance (IMF Fiscal Monitor GGXCNL_G01_GDP_PT), so interest cannot be worked out');

  // History: years with debt, pb, growth and inflation all outturns.
  const years = [...D.keys()].sort();
  const history: DsaHistoryYear[] = [];
  for (const y of years) {
    const d = D.get(y)!;
    const pb = PB.get(y);
    const g = G.get(y);
    const pi = PI.get(y);
    if (d.projection || !pb || pb.projection || !g || !pi) continue;
    const prev = D.get(String(Number(y) - 1));
    const ob = OB.get(y);
    const row: DsaHistoryYear = { year: y, debt: d.value, primaryBalance: pb.value, realGrowthPct: g.value, inflationPct: pi.value };
    if (prev && !prev.projection) {
      const n = nominalGrowthPct(g.value, pi.value);
      row.change = r2(d.value - prev.value);
      if (ob && prev.value > 0) {
        const interestGdp = pb.value - ob.value; // % of GDP
        const i = (interestGdp / prev.value) * 100 * (1 + n / 100); // interest over last year's debt in last year's GDP
        row.interestPct = r2(i);
        row.snowball = r2((prev.value * (i - n)) / (100 + n));
        row.primary = r2(-pb.value);
        row.stockFlow = r2(row.change - row.snowball - row.primary);
      }
    }
    history.push(row);
  }
  if (!history.length) return { ok: false, reason: 'No year has IMF debt, primary balance, growth and inflation outturns together', missing };
  const last = history[history.length - 1];
  const recent = history.slice(-DSA_HISTORY_YEARS);
  const recentI = recent.map((h) => h.interestPct).filter((v): v is number => v !== undefined);

  const avg = {
    g: mean(recent.map((h) => h.realGrowthPct)),
    pi: mean(recent.map((h) => h.inflationPct)),
    pb: mean(recent.map((h) => h.primaryBalance)),
    i: recentI.length ? mean(recentI) : undefined,
  };
  const sdG = sd(recent.map((h) => h.realGrowthPct));
  const sdPb = sd(recent.map((h) => h.primaryBalance));

  // Projection years: the IMF's own projected inputs.
  const horizon = Array.from({ length: DSA_HORIZON }, (_, k) => String(Number(last.year) + k + 1));
  const lastI = last.interestPct ?? avg.i;
  const proj: YearAssump[] = [];
  let projOk = true;
  let prevDebtForI = last.debt;
  for (const y of horizon) {
    const g = G.get(y)?.value;
    const pi = PI.get(y)?.value;
    const pb = PB.get(y)?.value;
    const ob = OB.get(y)?.value;
    const n = g !== undefined && pi !== undefined ? nominalGrowthPct(g, pi) : undefined;
    const i = pb !== undefined && ob !== undefined && n !== undefined && prevDebtForI > 0 ? ((pb - ob) / prevDebtForI) * 100 * (1 + n / 100) : lastI;
    if (g === undefined || pi === undefined || pb === undefined || i === undefined) {
      projOk = false;
      break;
    }
    proj.push({ year: y, g, pi, i, pb });
    prevDebtForI = D.get(y)?.value ?? prevDebtForI;
  }

  const start = { year: last.year, debt: last.debt };
  const scenarios: DsaScenario[] = [];
  const imfPath = [start, ...horizon.map((y) => ({ year: y, debt: D.get(y)?.value })).filter((p): p is { year: string; debt: number } => p.debt !== undefined)];
  if (imfPath.length > 1) {
    scenarios.push({ id: 'imf', label: 'IMF path', about: "The IMF's own WEO debt projection, as published.", path: imfPath.map((p) => ({ year: p.year, debt: r2(p.debt) })), end: r2(imfPath[imfPath.length - 1].debt) });
  }
  const add = (id: ScenarioId, label: string, about: string, ys: YearAssump[]) => {
    const path = runPath(start, ys);
    scenarios.push({ id, label, about, path, end: path[path.length - 1].debt });
  };
  if (projOk && proj.length === DSA_HORIZON) {
    add('baseline', 'Baseline (IMF inputs)', "The debt identity on the IMF's projected growth, inflation, primary balance and interest; no stock-flow adjustment.", proj);
    add('growth', 'Growth shock', `Real growth ${sdG.toFixed(1)} pts lower (one standard deviation of the last ${recent.length} years) in years 1 and 2.`, proj.map((y, k) => (k < 2 ? { ...y, g: y.g - sdG } : y)));
    add('primary', 'Primary balance shock', `Primary balance ${(sdPb / 2).toFixed(1)} pts of GDP lower (half its ${recent.length}-year standard deviation) in years 1 and 2.`, proj.map((y, k) => (k < 2 ? { ...y, pb: y.pb - sdPb / 2 } : y)));
    add('interest', 'Interest rate shock', `Effective interest rate up to ${INTEREST_SHOCK_PTS} pts higher, phased in as a fifth of the debt rolls over each year.`, proj.map((y, k) => ({ ...y, i: y.i + INTEREST_SHOCK_PTS * Math.min(1, ROLLOVER_SHARE * (k + 1)) })));
    add(
      'combined',
      'Combined shock',
      'The growth, primary balance and interest rate shocks together.',
      proj.map((y, k) => ({ ...y, g: k < 2 ? y.g - sdG : y.g, pb: k < 2 ? y.pb - sdPb / 2 : y.pb, i: y.i + INTEREST_SHOCK_PTS * Math.min(1, ROLLOVER_SHARE * (k + 1)) })),
    );
  } else {
    missing.push(`the IMF's projected inputs for ${horizon[0]}-${horizon[horizon.length - 1]}, so the baseline and shocks cannot run`);
  }
  if (avg.i !== undefined) {
    add('historical', 'Historical averages', `Growth ${avg.g.toFixed(1)}%, inflation ${avg.pi.toFixed(1)}%, interest ${avg.i.toFixed(1)}% and primary balance ${avg.pb.toFixed(1)}% of GDP held at their last ${recent.length} years' averages.`, horizon.map((year) => ({ year, g: avg.g, pi: avg.pi, i: avg.i!, pb: avg.pb })));
  }

  // r - g in real terms on the recent averages; pb* on the IMF projection averages where they ran.
  const rMinusG = avg.i !== undefined ? r2((avg.i - avg.pi) - avg.g) : undefined;
  let stabilisingPb: number | undefined;
  let projectedPb: number | undefined;
  if (proj.length === DSA_HORIZON) {
    const i = mean(proj.map((y) => y.i));
    const n = mean(proj.map((y) => nominalGrowthPct(y.g, y.pi)));
    stabilisingPb = r2(debtStabilisingPb(last.debt, i, n));
    projectedPb = r2(mean(proj.map((y) => y.pb)));
  } else if (avg.i !== undefined) {
    stabilisingPb = r2(debtStabilisingPb(last.debt, avg.i, nominalGrowthPct(avg.g, avg.pi)));
  }
  const stress = scenarios.filter((s) => ['growth', 'primary', 'interest', 'combined', 'historical'].includes(s.id));
  const worstS = stress.sort((a, b) => b.end - a.end)[0];
  const pulledAt = [inp.debt, inp.primaryBalance, inp.realGrowth, inp.inflation].map((s) => s?.pulledAt).filter(Boolean).sort()[0];
  return {
    ok: true,
    lastOutturnYear: last.year,
    debtNow: last.debt,
    history,
    ...(rMinusG !== undefined ? { rMinusG } : {}),
    ...(stabilisingPb !== undefined ? { stabilisingPb } : {}),
    ...(projectedPb !== undefined ? { projectedPb } : {}),
    scenarios: scenarios.sort((a, b) => order(a.id) - order(b.id)),
    ...(projOk && proj.length === DSA_HORIZON ? { baselineInputs: proj } : {}),
    ...(worstS ? { worst: { id: worstS.id, label: worstS.label, end: worstS.end } } : {}),
    missing,
    method: dsaMethod(),
    sources: DSA_REFERENCES,
    ...(pulledAt ? { pulledAt } : {}),
  };
}

const ORDER: ScenarioId[] = ['imf', 'baseline', 'historical', 'growth', 'primary', 'interest', 'combined'];
const order = (id: ScenarioId) => ORDER.indexOf(id);

export function dsaMethod(): string {
  return 'd(t) = d(t-1) x (1 + i) / (1 + n) - pb + stock-flow; i = net interest (IMF primary minus overall balance) over last year\'s debt; n = (1 + real growth) x (1 + CPI inflation) - 1, CPI standing in for the GDP deflator; shocks shaped on the IMF market-access DSA stress tests, sizes stated by the app';
}

const p1 = (v: number) => `${v.toFixed(1)}%`;

/** One or two sentences for chat, documents and the Fiscal & Debt Agent. */
export function dsaSentence(r: DsaResult): string {
  const base = r.scenarios.find((s) => s.id === 'baseline') || r.scenarios.find((s) => s.id === 'imf');
  const parts = [`Debt ${p1(r.debtNow)} of GDP in ${r.lastOutturnYear}`];
  if (base) parts.push(`${base.id === 'baseline' ? 'baseline on IMF inputs' : 'IMF path'} ${p1(base.end)} by ${base.path[base.path.length - 1].year}`);
  if (r.worst) parts.push(`worst stress case (${r.worst.label.toLowerCase()}) ${p1(r.worst.end)}`);
  let s = `${parts.join('; ')}.`;
  if (r.stabilisingPb !== undefined) {
    s += ` Holding debt steady needs a primary balance of ${p1(r.stabilisingPb)} of GDP${r.projectedPb !== undefined ? ` against ${p1(r.projectedPb)} in the IMF's projection` : ''}.`;
  }
  return s;
}

/** The scenarios as rows for a download: one row per scenario and year. */
export function dsaRows(r: DsaResult): Array<[string, string, number]> {
  return r.scenarios.flatMap((s) => s.path.map((p) => [s.label, p.year, p.debt] as [string, string, number]));
}


/** The summary the watchlist row and the Fiscal & Debt Agent carry. */
export function dsaSummary(r: DsaResult): DsaSummary {
  const base = r.scenarios.find((s) => s.id === 'baseline') || r.scenarios.find((s) => s.id === 'imf');
  return {
    year: r.lastOutturnYear,
    debtNow: r.debtNow,
    ...(base ? { base: { label: base.label, end: base.end, year: base.path[base.path.length - 1].year } } : {}),
    ...(r.worst ? { worst: { label: r.worst.label, end: r.worst.end } } : {}),
    ...(r.stabilisingPb !== undefined ? { stabilisingPb: r.stabilisingPb } : {}),
    ...(r.projectedPb !== undefined ? { projectedPb: r.projectedPb } : {}),
    ...(r.rMinusG !== undefined ? { rMinusG: r.rMinusG } : {}),
    method: r.method,
  };
}
