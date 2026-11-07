/**
 * Gross financing need of the government, by year, from figures the app already saves:
 *
 *   GFN = overall deficit + amortisation of debt falling due, both % of GDP.
 *
 * - Overall deficit: minus the IMF Fiscal Monitor overall balance (GGXCNL_G01_GDP_PT). Interest paid
 *   is shown as primary balance minus overall balance (GGXONLB_G01_GDP_PT minus GGXCNL_G01_GDP_PT).
 * - Amortisation: only EXTERNAL public debt has a free source. World Bank IDS projects principal on
 *   public and publicly guaranteed external debt by calendar year (low- and middle-income countries);
 *   QEDS gives general government external principal due in the next 12 months. Both are divided by
 *   IMF WEO GDP in US dollars (NGDPD) for the same year.
 * - Domestic amortisation (local bonds and bills held by residents) is not published in any free
 *   cross-country source, so the total here is a LOWER BOUND and is labelled so on every row.
 *
 * Nothing is filled in: a year missing either the balance or GDP in dollars has no GFN, only the
 * parts that exist. IMF projection years and IDS projections say so.
 *
 * Browser-safe.
 */
import type { Series } from './seriesHistory';
import type { DebtSchedule } from './debtSchedule';

/** IMF MAC DSA (2013) benchmark for total GFN in emerging markets, % of GDP. */
export const GFN_EM_BENCHMARK = 15;

export interface GfnYear {
  year: number;
  /** Overall deficit, % GDP (positive = deficit). */
  deficit?: number;
  /** Interest paid, % GDP (primary minus overall balance). */
  interest?: number;
  /** IDS projected public external principal, US$ bn. */
  extPrincipalUsdBn?: number;
  /** The same as % of GDP. */
  extAmortisation?: number;
  gdpUsdBn?: number;
  /** Deficit plus external amortisation: a lower bound for the total. */
  gfnLowerBound?: number;
  /** True when the IMF figures for this year are projections. */
  projection: boolean;
}

export interface GfnResult {
  ok: true;
  years: GfnYear[];
  /** QEDS next-12-month external principal, US$ bn and % of this year's GDP. */
  next12m?: { asOf: string; usdBn: number; pctGdp?: number };
  /** Highest lower bound across the years shown. */
  peak?: { year: number; value: number };
  aboveBenchmark: boolean;
  sources: string[];
  method: string;
}

export type GfnOutcome = GfnResult | { ok: false; reason: string };

export const GFN_METHOD =
  'GFN = overall deficit (minus IMF Fiscal Monitor overall balance) + IDS projected public external principal / IMF WEO GDP in US$. Domestic amortisation has no free source, so the total is a lower bound.';

const r2 = (v: number) => Math.round(v * 100) / 100;

function byYear(s?: Series): Map<number, { value: number; projection: boolean }> {
  const m = new Map<number, { value: number; projection: boolean }>();
  for (const p of s?.points || []) {
    const y = Number(String(p.date).slice(0, 4));
    if (Number.isInteger(y) && Number.isFinite(p.value)) m.set(y, { value: p.value, projection: p.note === 'IMF projection' });
  }
  return m;
}

export function grossFinancingNeed(input: {
  primaryBalance?: Series;
  overallBalance?: Series;
  gdpUsd?: Series;
  schedule?: DebtSchedule | null;
  now?: Date;
  /** Years shown, from last year on. */
  span?: number;
}): GfnOutcome {
  const now = input.now ?? new Date();
  const first = now.getUTCFullYear() - 1;
  const last = first + (input.span ?? 6) - 1;
  const ob = byYear(input.overallBalance);
  const pb = byYear(input.primaryBalance);
  const gdp = byYear(input.gdpUsd);
  const ids = new Map((input.schedule?.ids?.years || []).filter((y) => Number.isFinite(y.principalUsdBn)).map((y) => [y.year, y.principalUsdBn!]));
  if (!ob.size && !ids.size) return { ok: false, reason: 'Neither the IMF overall balance nor World Bank IDS external debt projections are saved for this country' };

  const years: GfnYear[] = [];
  for (let y = first; y <= last; y++) {
    const o = ob.get(y);
    const p = pb.get(y);
    const g = gdp.get(y);
    const pr = ids.get(y);
    if (!o && pr === undefined) continue;
    const row: GfnYear = { year: y, projection: !!(o?.projection || g?.projection) };
    if (o) row.deficit = r2(-o.value);
    if (o && p) row.interest = r2(p.value - o.value);
    if (g && g.value > 0) row.gdpUsdBn = r2(g.value);
    if (pr !== undefined) {
      row.extPrincipalUsdBn = r2(pr);
      if (row.gdpUsdBn) row.extAmortisation = r2((pr / row.gdpUsdBn) * 100);
    }
    if (row.deficit !== undefined && row.extAmortisation !== undefined) row.gfnLowerBound = r2(row.deficit + row.extAmortisation);
    years.push(row);
  }
  if (!years.length) return { ok: false, reason: `No overall balance or IDS projection for ${first}-${last}` };

  const out: GfnResult = { ok: true, years, aboveBenchmark: false, sources: [], method: GFN_METHOD };
  const q = input.schedule?.qeds;
  if (q && Number.isFinite(q.next12mUsdBn)) {
    const g = gdp.get(now.getUTCFullYear());
    out.next12m = { asOf: q.asOf, usdBn: r2(q.next12mUsdBn), ...(g && g.value > 0 ? { pctGdp: r2((q.next12mUsdBn / g.value) * 100) } : {}) };
  }
  const withGfn = years.filter((y) => y.gfnLowerBound !== undefined);
  if (withGfn.length) {
    const top = withGfn.reduce((a, b) => (b.gfnLowerBound! > a.gfnLowerBound! ? b : a));
    out.peak = { year: top.year, value: top.gfnLowerBound! };
    out.aboveBenchmark = top.gfnLowerBound! >= GFN_EM_BENCHMARK;
  }
  if (input.overallBalance) out.sources.push(input.overallBalance.source || 'IMF Fiscal Monitor');
  if (ids.size) out.sources.push('World Bank IDS (DT.AMT.DPPG.CD), projections');
  if (input.gdpUsd) out.sources.push(input.gdpUsd.source || 'IMF WEO (NGDPD)');
  if (q) out.sources.push('World Bank QEDS');
  return out;
}

/** One plain sentence for the panel and the Explain hand-off. */
export function gfnSentence(r: GfnResult, name: string): string {
  if (!r.peak) {
    return `${name}: the gross financing need cannot be totalled; ${r.years.some((y) => y.deficit !== undefined) ? 'external amortisation or GDP in dollars is missing' : 'the overall balance is missing'}, so only the parts are shown.`;
  }
  const bench = r.aboveBenchmark
    ? `already at or above the IMF's ${GFN_EM_BENCHMARK}% of GDP flag for emerging markets before domestic debt is counted`
    : `below the IMF's ${GFN_EM_BENCHMARK}% of GDP flag for emerging markets, but domestic amortisation is not counted`;
  return `${name}: deficit plus external amortisation peaks at ${r.peak.value}% of GDP in ${r.peak.year}, ${bench}.`;
}
