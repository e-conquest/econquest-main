/**
 * Reserve adequacy for emerging markets, from figures the app already saves (World Bank WDI/IDS and
 * IMF WEO through the official history download):
 *
 * - Traditional ratios: reserves in months of imports (3 months is the usual floor), reserves over
 *   short-term external debt (Greenspan-Guidotti: 100% or more) and reserves over broad money (20%).
 * - The IMF ARA EM metric (IMF 2011, 2013, 2015): 30% of short-term debt + 15% (floating) or 20%
 *   (fixed) of other portfolio liabilities + 5% (floating) or 10% (fixed) of broad money + 5% or 10%
 *   of exports. Reserves at 100-150% of the metric are read as adequate.
 *
 * Other portfolio liabilities come from the international investment position, which no free source
 * the app can reach publishes across countries. The metric here is therefore built WITHOUT that term
 * and is smaller than the IMF's; reserves over it are an UPPER BOUND of the IMF ratio. That still says
 * something: a ratio under 100% here is under 100% on the full metric too. A ratio above 100% here
 * does not show adequacy. The exchange rate regime is not a free feed either, so both weightings are
 * shown.
 *
 * Browser-safe.
 */
import type { Series } from './seriesHistory';

export const ARA_WEIGHTS = {
  floating: { std: 0.3, otherLiabilities: 0.15, broadMoney: 0.05, exports: 0.05 },
  fixed: { std: 0.3, otherLiabilities: 0.2, broadMoney: 0.1, exports: 0.1 },
} as const;

export interface AraYear {
  year: number;
  reservesUsdBn: number;
  shortTermDebtUsdBn: number;
  broadMoneyUsdBn: number;
  exportsUsdBn: number;
  /** Partial metric (no other liabilities), US$ bn. */
  metricFloating: number;
  metricFixed: number;
  /** Reserves over the partial metric, %: an upper bound of the IMF ARA ratio. */
  ratioFloatingMax: number;
  ratioFixedMax: number;
}

export interface ReserveAdequacy {
  ok: true;
  latest: AraYear;
  years: AraYear[];
  /** Traditional ratios, latest year each has. */
  monthsOfImports?: { year: number; value: number };
  reservesToShortTermDebt?: { year: number; pct: number };
  reservesToBroadMoney?: { year: number; pct: number };
  /** below = under 100% even on the partial metric (so under on the full one); unknown = cannot tell. */
  reading: 'below' | 'unknown';
  method: string;
  sources: string[];
}

export type ReserveAdequacyOutcome = ReserveAdequacy | { ok: false; reason: string };

export const ARA_METHOD =
  'IMF ARA EM metric without the other-portfolio-liabilities term (no free source): 30% short-term external debt + 5% (floating) or 10% (fixed) of broad money + 5% or 10% of exports of goods and services. Reserves over it are an upper bound of the IMF ratio.';

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

function outturns(s?: Series): Map<number, number> {
  const m = new Map<number, number>();
  for (const p of s?.points || []) {
    if (p.note === 'IMF projection') continue;
    const y = Number(String(p.date).slice(0, 4));
    if (Number.isInteger(y) && Number.isFinite(p.value)) m.set(y, p.value);
  }
  return m;
}

const latestOf = (m: Map<number, number>) => {
  const y = Math.max(...m.keys());
  return Number.isFinite(y) ? { year: y, value: m.get(y)! } : undefined;
};

export function reserveAdequacy(input: {
  reservesUsd?: Series;
  shortTermDebtUsd?: Series;
  broadMoneyGdp?: Series;
  exportsUsd?: Series;
  gdpUsd?: Series;
  reservesMonths?: Series;
}): ReserveAdequacyOutcome {
  const res = outturns(input.reservesUsd);
  const std = outturns(input.shortTermDebtUsd);
  const bm = outturns(input.broadMoneyGdp);
  const ex = outturns(input.exportsUsd);
  const gdp = outturns(input.gdpUsd);
  const missing = [
    !res.size && 'total reserves (World Bank)',
    !std.size && 'short-term external debt (World Bank IDS covers low- and middle-income countries only)',
    !bm.size && 'broad money (World Bank)',
    !ex.size && 'exports (World Bank)',
    !gdp.size && 'GDP in US dollars (IMF WEO)',
  ].filter(Boolean);
  if (missing.length) return { ok: false, reason: `Not saved for this country: ${missing.join(', ')}` };

  const years: AraYear[] = [];
  for (const [y, reserves] of [...res.entries()].sort((a, b) => a[0] - b[0])) {
    const s = std.get(y);
    const b = bm.get(y);
    const x = ex.get(y);
    const g = gdp.get(y);
    if (s === undefined || b === undefined || x === undefined || g === undefined || reserves <= 0) continue;
    const broad = (b / 100) * g;
    const fl = ARA_WEIGHTS.floating;
    const fx = ARA_WEIGHTS.fixed;
    const metricFloating = fl.std * s + fl.broadMoney * broad + fl.exports * x;
    const metricFixed = fx.std * s + fx.broadMoney * broad + fx.exports * x;
    if (metricFloating <= 0) continue;
    years.push({
      year: y,
      reservesUsdBn: r2(reserves),
      shortTermDebtUsdBn: r2(s),
      broadMoneyUsdBn: r2(broad),
      exportsUsdBn: r2(x),
      metricFloating: r2(metricFloating),
      metricFixed: r2(metricFixed),
      ratioFloatingMax: r1((reserves / metricFloating) * 100),
      ratioFixedMax: r1((reserves / metricFixed) * 100),
    });
  }
  if (!years.length) return { ok: false, reason: 'No year has reserves, short-term debt, broad money, exports and GDP in dollars together' };
  const latest = years[years.length - 1];

  const out: ReserveAdequacy = {
    ok: true,
    latest,
    years: years.slice(-10),
    // The floating metric is the smaller one, so its ratio is the higher upper bound: under 100% there means under 100% whatever the regime.
    reading: latest.ratioFloatingMax < 100 ? 'below' : 'unknown',
    method: ARA_METHOD,
    sources: [input.reservesUsd?.source, input.shortTermDebtUsd?.source, input.broadMoneyGdp?.source, input.exportsUsd?.source, input.gdpUsd?.source].filter((s): s is string => !!s),
  };
  const months = latestOf(outturns(input.reservesMonths));
  if (months) out.monthsOfImports = { year: months.year, value: r1(months.value) };
  const lastStd = [...years].reverse().find((y) => y.shortTermDebtUsdBn > 0);
  if (lastStd) out.reservesToShortTermDebt = { year: lastStd.year, pct: r1((lastStd.reservesUsdBn / lastStd.shortTermDebtUsdBn) * 100) };
  if (latest.broadMoneyUsdBn > 0) out.reservesToBroadMoney = { year: latest.year, pct: r1((latest.reservesUsdBn / latest.broadMoneyUsdBn) * 100) };
  return out;
}

export function reserveAdequacySentence(r: ReserveAdequacy, name: string): string {
  const l = r.latest;
  if (r.reading === 'below') {
    return `${name}: in ${l.year} reserves were at most ${l.ratioFloatingMax}% of the IMF's reserve adequacy metric, under the 100% floor even before other portfolio liabilities are counted.`;
  }
  return `${name}: in ${l.year} reserves were ${l.ratioFixedMax}-${l.ratioFloatingMax}% of the IMF metric without other portfolio liabilities; the full metric is larger, so this does not show adequacy on its own.`;
}
