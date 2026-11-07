/**
 * Fresher monthly inflation from national and EU sources (Sam, 2026-11-05: the OECD mirror on
 * DBnomics lags five to six months).
 *
 * - Brazil: Banco Central do Brasil SGS series 13522, IPCA accumulated over 12 months (free, no key).
 *   api.bcb.gov.br answered with September 2026 on 2026-11-05, against May 2026 on DBnomics.
 * - EU members: Eurostat HICP annual rate of change, dataset prc_hicp_minr (ECOICOP ver. 2, all items
 *   = coicop18 TOTAL), free, no key. It replaced prc_hicp_manr, which stopped at December 2025.
 *   Poland answered with August 2026. Turkey is not in this dataset.
 *
 * A national series is used for a country when its newest month is at least as new as the OECD's.
 * Each reading says which source it came from.
 */
import type { CpiBasis, CpiSeries } from './oecdInflation';
import { evdsSeriesUrl } from './officialYields';

export interface NationalCpiSeries {
  points: { period: string; value: number }[];
  /** Short label for tables, e.g. "BCB IPCA". */
  short: string;
  /** Long label with the series, for source lines. */
  long: string;
}

export const BCB_IPCA_12M = 13522;
export const BCB_SHORT = 'BCB IPCA';
export const BCB_LONG = 'Banco Central do Brasil, IPCA 12-month inflation (SGS 13522)';
export const EUROSTAT_SHORT = 'Eurostat HICP';
export const EUROSTAT_LONG = 'Eurostat HICP, annual rate of change (prc_hicp_minr, all items)';

export function bcbSgsUrl(code: number, last = 24): string {
  return `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados/ultimos/${last}?formato=json`;
}

/** BCB SGS reply: [{"data":"01/09/2026","valor":"4.58"}, ...] oldest first. */
export function parseBcbSgs(json: unknown): { period: string; value: number }[] {
  if (!Array.isArray(json)) return [];
  const out: { period: string; value: number }[] = [];
  for (const row of json as Array<{ data?: unknown; valor?: unknown }>) {
    const m = String(row?.data ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const raw = String(row?.valor ?? '').trim().replace(',', '.');
    if (!m || raw === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    out.push({ period: `${m[3]}-${m[2]}`, value });
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
}

/** EU members by ISO3, as Eurostat's geo codes (Greece is EL). */
export const EUROSTAT_GEO: Record<string, string> = {
  AUT: 'AT', BEL: 'BE', BGR: 'BG', HRV: 'HR', CYP: 'CY', CZE: 'CZ', DNK: 'DK', EST: 'EE', FIN: 'FI', FRA: 'FR',
  DEU: 'DE', GRC: 'EL', HUN: 'HU', IRL: 'IE', ITA: 'IT', LVA: 'LV', LTU: 'LT', LUX: 'LU', MLT: 'MT', NLD: 'NL',
  POL: 'PL', PRT: 'PT', ROU: 'RO', SVK: 'SK', SVN: 'SI', ESP: 'ES', SWE: 'SE',
};

export function eurostatHicpUrl(geos: string[], months = 15): string {
  const g = geos.map((x) => `&geo=${encodeURIComponent(x)}`).join('');
  return `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_minr?format=JSON&lang=EN&unit=RCH_A&coicop18=TOTAL${g}&lastTimePeriod=${months}`;
}

/** JSON-stat 2.0 reply into points by Eurostat geo code. Positions with no value are skipped. */
export function parseEurostatHicp(json: unknown): Record<string, { period: string; value: number }[]> {
  const j = json as { id?: string[]; size?: number[]; value?: Record<string, number> | number[]; dimension?: Record<string, { category?: { index?: Record<string, number> } }> };
  const out: Record<string, { period: string; value: number }[]> = {};
  if (!j?.id || !j.size || !j.value || !j.dimension) return out;
  const geoAt = j.id.indexOf('geo');
  const timeAt = j.id.indexOf('time');
  if (geoAt < 0 || timeAt < 0) return out;
  // Every other dimension must be a single category (the URL filters them), or the reading is ambiguous.
  if (j.size.some((n, i) => i !== geoAt && i !== timeAt && n !== 1)) return out;
  const geoIndex = j.dimension.geo?.category?.index || {};
  const timeIndex = j.dimension.time?.category?.index || {};
  const nTime = j.size[timeAt];
  const geoFirst = geoAt < timeAt;
  for (const [geo, gi] of Object.entries(geoIndex)) {
    for (const [period, ti] of Object.entries(timeIndex)) {
      const pos = geoFirst ? gi * nTime + ti : ti * j.size[geoAt] + gi;
      const v = (j.value as Record<string, number>)[String(pos)];
      if (typeof v !== 'number' || !Number.isFinite(v) || !/^\d{4}-\d{2}$/.test(period)) continue;
      (out[geo] ||= []).push({ period, value: v });
    }
  }
  for (const pts of Object.values(out)) pts.sort((a, b) => a.period.localeCompare(b.period));
  return out;
}

export type CpiSeriesWithSource = Record<string, { basis: CpiBasis; points: { period: string; value: number }[]; short?: string; long?: string }>;

/**
 * Puts each national series in place of the OECD one for its country when it is at least as new.
 * Keys are ISO3 (the OECD reply also keys countries by ISO3).
 */
export function mergeNationalCpi(oecd: CpiSeries | null | undefined, national: Record<string, NationalCpiSeries>): CpiSeriesWithSource | null {
  const out: CpiSeriesWithSource = { ...(oecd || {}) };
  for (const [iso3, n] of Object.entries(national)) {
    if (!n.points.length) continue;
    const mine = n.points[n.points.length - 1].period;
    const theirs = out[iso3]?.points?.[out[iso3].points.length - 1]?.period;
    if (!theirs || mine >= theirs) out[iso3] = { basis: 'national', points: n.points, short: n.short, long: n.long };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Mexico: Banco de México SIE API, series SP30578 (INPC, annual change, monthly). Needs the user's
 * own free token (BANXICO_TOKEN, Menu > Settings > Data API keys), sent in the Bmx-Token header,
 * never in the URL. Series code checked 2026-11-06 against open-source SIE clients (banxicolab
 * catalogue: SP30578 "INPC, variación anual", monthly, %). Reply: {"bmx":{"series":[{"idSerie":
 * "SP30578","datos":[{"fecha":"01/09/2026","dato":"3.76"}]}]}}; "N/E" marks a missing value.
 */
export const BANXICO_CPI_SERIES = 'SP30578';
export const BANXICO_SHORT = 'Banxico INPC';
export const BANXICO_LONG = 'Banco de México, INPC annual inflation (SIE SP30578)';
export const BANXICO_BASE_URL = 'https://www.banxico.org.mx/SieAPIRest/service/v1/';

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Observations of the given series between two dates (two years back by default). */
export function banxicoSeriesUrl(ids: string[], now = new Date(), months = 24): string {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  return `${BANXICO_BASE_URL}series/${ids.join(',')}/datos/${isoDay(start)}/${isoDay(now)}`;
}

/** Headers for a Banxico request: the token travels only here. */
export function banxicoHeaders(token: string): Record<string, string> {
  return { 'Bmx-Token': token.trim(), Accept: 'application/json' };
}

/** Monthly points of one series in a Banxico SIE reply, oldest first. Missing ("N/E") values are skipped. */
export function parseBanxicoMonthly(json: unknown, id: string): { period: string; value: number }[] {
  const series = (json as { bmx?: { series?: Array<{ idSerie?: unknown; datos?: unknown }> } })?.bmx?.series;
  if (!Array.isArray(series)) return [];
  const s = series.find((x) => String(x?.idSerie ?? '') === id);
  if (!s || !Array.isArray(s.datos)) return [];
  const byPeriod = new Map<string, number>();
  for (const row of s.datos as Array<{ fecha?: unknown; dato?: unknown }>) {
    const m = String(row?.fecha ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const raw = String(row?.dato ?? '').trim().replace(/,/g, '');
    if (!m || raw === '' || raw === 'N/E') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    byPeriod.set(`${m[3]}-${m[2]}`, value);
  }
  return [...byPeriod.entries()].map(([period, value]) => ({ period, value })).sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Turkey: the central bank's EVDS service, with the user's own key (EVDS_API_KEY, the same key as
 * Turkey's 10Y yield). Reads a monthly CPI index and works out the change over 12 months. Default
 * series TP.FG.J0 (CPI, general index, the code used across open-source EVDS clients); the user can
 * name another index series in EVDS_TR_CPI_SERIES. If the default stops (TurkStat rebased CPI to
 * 2025=100 in 2026), its newest month falls behind the OECD's and the OECD series is kept, so a
 * stale series never wins. The 12-month change is only taken between two months of the same series.
 */
export const EVDS_CPI_DEFAULT_SERIES = 'TP.FG.J0';
export const EVDS_CPI_SHORT = 'CBRT EVDS CPI';
export function evdsCpiLong(series: string): string {
  return `Central Bank of Turkey EVDS, CPI index ${series}, change over 12 months (worked out by the app)`;
}

/** Request URL for about 26 months of a monthly series. The key is NOT part of the URL. */
export function evdsCpiUrl(series: string, now = new Date()): string {
  return evdsSeriesUrl(series, now, 800);
}

/** EVDS reply rows of a monthly index -> 12-month % change per month, oldest first. */
export function parseEvdsCpiYoy(json: unknown, series: string): { period: string; value: number }[] {
  const items = (json as { items?: Array<Record<string, unknown>> })?.items;
  if (!Array.isArray(items)) return [];
  const column = series.trim().replace(/\./g, '_');
  const level = new Map<string, number>();
  for (const row of items) {
    const raw = row?.[column];
    if (raw === null || raw === undefined || String(raw).trim() === '') continue;
    const v = Number(String(raw).replace(',', '.'));
    const m = String(row?.Tarih ?? '').trim().match(/^(\d{4})-(\d{1,2})$/);
    if (!m || !Number.isFinite(v) || v <= 0) continue;
    level.set(`${m[1]}-${m[2].padStart(2, '0')}`, v);
  }
  const out: { period: string; value: number }[] = [];
  for (const [period, v] of level) {
    const y = Number(period.slice(0, 4));
    const prev = level.get(`${y - 1}${period.slice(4)}`);
    if (prev === undefined) continue;
    out.push({ period, value: Number(((v / prev - 1) * 100).toFixed(2)) });
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
}
