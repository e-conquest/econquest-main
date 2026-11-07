/**
 * Monthly activity indicators for the GDP nowcast (Sam, 2026-11-06). The OECD figures the app reads
 * through DBnomics run about five months behind, too late to say anything about the quarter that
 * just ended; these national and EU series come out four to eight weeks after the month.
 *
 * - Brazil: Banco Central do Brasil IBC-Br, the central bank's monthly activity index, seasonally
 *   adjusted (SGS 24364), free, no key. Read from 2003.
 * - EU members (and Turkey where Eurostat carries it): Eurostat industrial production index,
 *   dataset sts_inpr_m, total industry excluding construction (nace_r2 B-D), volume (indic_bt PRD),
 *   seasonally and calendar adjusted (SCA), 2021 = 100 (I21), free, no key. Read from 2000.
 *
 * Only real observations: a month the source left blank stays out. A country with neither reads
 * Missing with that reason; the nowcast then leans on its other inputs and says so.
 *
 * Browser-safe (no fs).
 */
import { EUROSTAT_GEO, parseBcbSgs, parseEurostatHicp } from './nationalCpi';

export const BCB_IBCBR_SA = 24364;
export const IBCBR_SHORT = 'BCB IBC-Br';
export const IBCBR_LONG = 'Banco Central do Brasil, IBC-Br economic activity index, seasonally adjusted (SGS 24364)';
export const EUROSTAT_IP_SHORT = 'Eurostat industrial production';
export const EUROSTAT_IP_LONG = 'Eurostat industrial production index, industry excl. construction, seasonally and calendar adjusted, 2021 = 100 (sts_inpr_m)';

/** Eurostat geo codes for industrial production: the EU members, plus Turkey (TR) where Eurostat publishes it. */
export const EUROSTAT_IP_GEO: Record<string, string> = { ...EUROSTAT_GEO, TUR: 'TR' };

export interface ActivitySeries {
  /** YYYY-MM, oldest first. */
  points: { period: string; value: number }[];
  short: string;
  long: string;
  unit: string;
}

/** BCB SGS, full history from a start date (dd/mm/yyyy), JSON. */
export function bcbSgsSinceUrl(code: number, since = '01/01/2003'): string {
  return `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados?formato=json&dataInicial=${encodeURIComponent(since)}`;
}

export function eurostatIpUrl(geos: string[], since = '2000-01'): string {
  const g = geos.map((x) => `&geo=${encodeURIComponent(x)}`).join('');
  return `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sts_inpr_m?format=JSON&lang=EN&indic_bt=PRD&nace_r2=B-D&s_adj=SCA&unit=I21${g}&sinceTimePeriod=${since}`;
}

/** IBC-Br reply into the series. Null when the reply has no rows. */
export function parseIbcBr(json: unknown): ActivitySeries | null {
  const points = parseBcbSgs(json);
  return points.length ? { points, short: IBCBR_SHORT, long: IBCBR_LONG, unit: 'index, 2002 = 100' } : null;
}

/** Eurostat reply into one series per ISO3 country asked for. */
export function parseEurostatIp(json: unknown, iso3s: string[]): Record<string, ActivitySeries> {
  const byGeo = parseEurostatHicp(json);
  const out: Record<string, ActivitySeries> = {};
  for (const iso3 of iso3s) {
    const pts = byGeo[EUROSTAT_IP_GEO[iso3]];
    if (pts?.length) out[iso3] = { points: pts, short: EUROSTAT_IP_SHORT, long: EUROSTAT_IP_LONG, unit: 'index, 2021 = 100' };
  }
  return out;
}

/** Which source an app country's activity index would come from, or null. */
export function activitySourceFor(iso3: string): 'bcb' | 'eurostat' | null {
  if (iso3 === 'BRA') return 'bcb';
  if (EUROSTAT_IP_GEO[iso3]) return 'eurostat';
  return null;
}

export function activityMissing(iso3: string, pulled: boolean): string {
  const src = activitySourceFor(iso3);
  if (!src) return 'No free, timely monthly activity index wired in for this country yet (the app reads BCB IBC-Br for Brazil and Eurostat industrial production for EU members).';
  if (!pulled) return `${src === 'bcb' ? 'The Banco Central do Brasil' : 'Eurostat'} has not answered for the monthly activity index yet.`;
  return `${src === 'bcb' ? 'The Banco Central do Brasil' : 'Eurostat'} answered without a monthly activity index for this country.`;
}
