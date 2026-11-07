/**
 * Behavioural equilibrium exchange rate (BEER, Clark and MacDonald 1998), one country at a time:
 * the real effective exchange rate explained by slow-moving fundamentals, and how far today's rate
 * sits from that fitted level.
 *
 *   ln REER(t) = a + b1 ln ToT(t) + b2 ln relative productivity(t) + b3 NFA proxy(t) + e(t)
 *
 * - REER: BIS real broad effective exchange rate, yearly average of the monthly index (up = stronger).
 * - ToT: World Bank net barter terms of trade (TT.PRI.MRCH.XD.WD). Expected sign +.
 * - Relative productivity: GDP per head at PPP (World Bank NY.GDP.PCAP.PP.KD) against the US, a
 *   stand-in for the Balassa-Samuelson effect (trade-weighted partner productivity is not free).
 *   Expected sign +.
 * - NFA proxy: the current account (% of GDP, World Bank) summed from the first year in the sample.
 *   Net foreign assets themselves (IMF IIP, Lane and Milesi-Ferretti) have no free API; the sum
 *   misses valuation changes and is labelled a proxy. Expected sign +.
 *
 * OLS on the years all four exist (at least 15), Newey-West errors. Fair value for a year = the
 * fitted level; misalignment = 100 x (ln REER - ln fitted). The latest REER month is compared with
 * the fair value of the latest year with fundamentals, and the gap says which year that is.
 *
 * A model of levels on ~20-30 annual points with no cointegration test: a yardstick for
 * discussion, not a forecast. It implies the gap closes over time, which has not been tested here.
 *
 * Browser-safe, pure.
 */
import { ols } from './stats';
import { neweyWestCov, neweyWestLag } from './bohnTest';

export const BEER_MIN_YEARS = 15;

export interface BeerInputs {
  /** Monthly REER index, YYYY-MM. */
  reerMonthly: Array<{ period: string; value: number }>;
  /** Yearly series, YYYY. */
  tot: Array<{ date: string; value: number }>;
  gdpPcPpp: Array<{ date: string; value: number }>;
  usGdpPcPpp: Array<{ date: string; value: number }>;
  currentAccount: Array<{ date: string; value: number }>;
}

export interface BeerYear {
  year: string;
  reer: number;
  fitted: number;
  /** % above (+) or below (-) the fitted level. */
  gapPct: number;
}

export interface BeerResult {
  ok: true;
  coef: Array<{ name: string; beta: number; se: number; expected: '+' ; signOk: boolean }>;
  r2: number;
  n: number;
  from: string;
  to: string;
  years: BeerYear[];
  latest: { month: string; reer: number; fairValueYear: string; fairValue: number; gapPct: number };
  method: string;
}

export type BeerOutcome = BeerResult | { ok: false; reason: string; missing?: string[] };

export const BEER_METHOD = `OLS of the log real effective exchange rate (BIS, yearly average) on log terms of trade, log GDP per head at PPP relative to the US, and the current account summed from the first year (a net foreign assets proxy), at least ${BEER_MIN_YEARS} years, Newey-West errors. Misalignment = 100 x (log REER - log fitted). A yardstick, not a forecast.`;

const r2 = (v: number) => Number(v.toFixed(2));
const r3 = (v: number) => Number(v.toFixed(3));

function yearMap(points: Array<{ date: string; value: number }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of points) if (/^\d{4}/.test(p.date) && Number.isFinite(p.value)) m.set(p.date.slice(0, 4), p.value);
  return m;
}

export function beer(inp: BeerInputs): BeerOutcome {
  const missing: string[] = [];
  if (inp.reerMonthly.length < 24) missing.push('BIS real effective exchange rate history');
  if (!inp.tot.length) missing.push('terms of trade (World Bank TT.PRI.MRCH.XD.WD)');
  if (!inp.gdpPcPpp.length) missing.push('GDP per head at PPP (World Bank NY.GDP.PCAP.PP.KD)');
  if (!inp.usGdpPcPpp.length) missing.push('US GDP per head at PPP (World Bank)');
  if (!inp.currentAccount.length) missing.push('current account (World Bank BN.CAB.XOKA.GD.ZS)');
  if (missing.length) return { ok: false, reason: `Needs ${missing.join(', ')}`, missing };

  // Yearly REER: average of the year's months, only years with all 12.
  const byYear = new Map<string, number[]>();
  for (const p of inp.reerMonthly) if (/^\d{4}-\d{2}$/.test(p.period) && p.value > 0) byYear.set(p.period.slice(0, 4), [...(byYear.get(p.period.slice(0, 4)) || []), p.value]);
  const reer = new Map([...byYear].filter(([, v]) => v.length === 12).map(([y, v]) => [y, v.reduce((a, x) => a + x, 0) / 12]));
  const tot = yearMap(inp.tot);
  const gdp = yearMap(inp.gdpPcPpp);
  const us = yearMap(inp.usGdpPcPpp);
  const ca = yearMap(inp.currentAccount);
  // NFA proxy: running sum of the current account from the first year it exists.
  const caYears = [...ca.keys()].sort();
  const nfa = new Map<string, number>();
  let run = 0;
  for (const y of caYears) {
    run += ca.get(y)!;
    nfa.set(y, run);
  }
  const years = [...reer.keys()].filter((y) => (tot.get(y) ?? 0) > 0 && (gdp.get(y) ?? 0) > 0 && (us.get(y) ?? 0) > 0 && nfa.has(y)).sort();
  if (years.length < BEER_MIN_YEARS) return { ok: false, reason: `Only ${years.length} years have the exchange rate and all three fundamentals; the fit needs ${BEER_MIN_YEARS}` };
  const row = (y: string) => [Math.log(tot.get(y)!), Math.log(gdp.get(y)! / us.get(y)!), nfa.get(y)! / 100];
  const ys = years.map((y) => Math.log(reer.get(y)!));
  const X = years.map(row);
  const reg = ols(ys, X);
  if ('error' in reg) return { ok: false, reason: reg.error };
  const V = neweyWestCov(X, reg.residuals, neweyWestLag(ys.length));
  const names = ['Terms of trade (log)', 'GDP per head vs US (log)', 'Current account summed (NFA proxy, /100)'];
  const coef = names.map((name, k) => {
    const beta = reg.coef[k + 1];
    return { name, beta: r3(beta), se: r3(V ? Math.sqrt(Math.max(0, V[k + 1][k + 1])) : reg.se[k + 1]), expected: '+' as const, signOk: beta > 0 };
  });
  const fit = (y: string) => Math.exp(reg.coef[0] + row(y).reduce((a, v, k) => a + v * reg.coef[k + 1], 0));
  const out: BeerYear[] = years.map((y) => ({ year: y, reer: r2(reer.get(y)!), fitted: r2(fit(y)), gapPct: r2(100 * Math.log(reer.get(y)! / fit(y))) }));
  // Latest month against the fair value of the latest year that has every fundamental (fit years or later).
  const fundYears = [...tot.keys()].filter((y) => gdp.has(y) && us.has(y) && nfa.has(y) && (tot.get(y) ?? 0) > 0).sort();
  const fy = fundYears[fundYears.length - 1];
  const lastM = [...inp.reerMonthly].filter((p) => p.value > 0).sort((a, b) => (a.period < b.period ? -1 : 1)).pop()!;
  const fv = fit(fy);
  return {
    ok: true,
    coef,
    r2: r3(reg.r2),
    n: reg.n,
    from: years[0],
    to: years[years.length - 1],
    years: out,
    latest: { month: lastM.period, reer: r2(lastM.value), fairValueYear: fy, fairValue: r2(fv), gapPct: r2(100 * Math.log(lastM.value / fv)) },
    method: BEER_METHOD,
  };
}

export function beerSentence(name: string, b: BeerResult): string {
  const g = b.latest.gapPct;
  const wrong = b.coef.filter((c) => !c.signOk).map((c) => c.name.split(' (')[0].toLowerCase());
  return `${name}: the real effective exchange rate in ${b.latest.month} is ${Math.abs(g).toFixed(1)}% ${g >= 0 ? 'above' : 'below'} the BEER fair value for ${b.latest.fairValueYear} (${g >= 0 ? 'dear' : 'cheap'} on this yardstick), fitted on ${b.n} years (R² ${b.r2.toFixed(2)})${wrong.length ? `; ${wrong.join(' and ')} came out with the opposite sign to theory, so read with care` : ''}.`;
}
