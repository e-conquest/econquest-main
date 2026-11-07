/**
 * Spread-implied default probability (seven-groups plan, group 1; gap analysis A3), from the USD
 * bond spread over Treasuries (BCRP EMBI Global, src/utils/hardCurrencySpread.ts).
 *
 * The "credit triangle": with a constant default intensity h and recovery R (share of face value
 * recovered), a spread s pays for expected loss, so h = s / (1 - R) and the chance of default
 * within T years is 1 - exp(-h T). R = 40% is the market convention for senior sovereign debt in
 * CDS pricing (ISDA standard model); it is a stated assumption, not an estimate for the country.
 *
 * This is a risk-neutral probability: the spread also pays for liquidity and for bearing default
 * risk, so it overstates the real-world chance of default. A description, not a tested signal; no
 * default history is on file to score it against (gap analysis D7). Browser-safe, pure.
 */
import type { Series, SeriesMissing, SeriesPoint } from './seriesHistory';

export const IMPLIED_PD_RECOVERY = 0.4;
export const IMPLIED_PD_YEARS = 5;

/** Chance of default within `years`, %, from a spread in basis points. Undefined for a negative or unreadable spread. */
export function impliedDefaultPct(spreadBps: number, recovery = IMPLIED_PD_RECOVERY, years = IMPLIED_PD_YEARS): number | undefined {
  if (!Number.isFinite(spreadBps) || spreadBps < 0 || !(recovery >= 0 && recovery < 1) || !(years > 0)) return undefined;
  const h = spreadBps / 10000 / (1 - recovery);
  return Number(((1 - Math.exp(-h * years)) * 100).toFixed(1));
}

export const IMPLIED_PD_LABEL = 'Spread-implied 5-year default probability (risk-neutral)';

export const IMPLIED_PD_ABOUT =
  'From the USD bond spread over Treasuries: default intensity = spread / (1 - recovery), with recovery set at 40% (the market convention for sovereign CDS), and the chance of default within 5 years = 1 - exp(-5 x intensity). Risk-neutral: the spread also pays for liquidity and risk, so this overstates the real-world chance. A description, not a tested signal.';

/** The implied probability, month by month, from the spread series; Missing when the spread is. */
export function impliedDefaultSeries(spread: Series | SeriesMissing): Series | SeriesMissing {
  if (!('points' in spread)) return { id: 'implied_pd_5y', label: IMPLIED_PD_LABEL, reason: `Needs the USD bond spread: ${spread.reason}` };
  const points: SeriesPoint[] = spread.points
    .map((p) => ({ date: p.date, value: impliedDefaultPct(p.value) }))
    .filter((p): p is SeriesPoint => p.value !== undefined);
  if (!points.length) return { id: 'implied_pd_5y', label: IMPLIED_PD_LABEL, reason: 'No readable spread to work from' };
  return { id: 'implied_pd_5y', label: IMPLIED_PD_LABEL, unit: '%', freq: spread.freq, source: `${spread.source}; app calculation`, pulledAt: spread.pulledAt, points, about: IMPLIED_PD_ABOUT };
}
