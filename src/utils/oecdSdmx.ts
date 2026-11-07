/**
 * Shared reader for OECD data, used by the OECD leading indicator (oecdCli.ts) and OECD inflation
 * (oecdInflation.ts) feeds.
 *
 * Route (Sam, 2026-11-05 03:33Z: "Lets use DBnomics"): the OECD's own API (sdmx.oecd.org) sits
 * behind a Cloudflare bot check that refused the app on Sam's Mac, so the app reads the same OECD
 * series from DBnomics (api.db.nomics.world, free, no key), which mirrors the OECD's datasets
 * under the OECD's own codes. The reply is JSON: series.docs[] with dimensions{}, period[] and
 * value[]. The SDMX-CSV reader below stays for the OECD's own format.
 *
 * The app asks for SDMX-CSV (`format=csvfile`): one row per observation with a header naming each
 * column (REF_AREA, TIME_PERIOD, OBS_VALUE and the series' other dimensions). Columns are read by
 * name, never by position, so the OECD adding or reordering a column does not break the reader.
 *
 * The OECD asks users to keep to a modest number of calls an hour; the app makes one call per
 * dataset a day for every country at once and keeps it on disk.
 */

export const OECD_HOST = 'sdmx.oecd.org';
export const DBNOMICS_HOST = 'api.db.nomics.world';
export const DBNOMICS_SOURCE = 'OECD via DBnomics';

/**
 * DBnomics query for one OECD dataset, filtered by dimension name (so the order of the OECD's key
 * does not matter). One page of up to 1000 series with their observations.
 */
export function dbnomicsUrl(dataset: string, dims: Record<string, string[]>): string {
  const d = encodeURIComponent(JSON.stringify(dims));
  return `https://${DBNOMICS_HOST}/v22/series/OECD/${encodeURIComponent(dataset)}?dimensions=${d}&observations=1&format=json&limit=1000`;
}

/**
 * Reads a DBnomics series reply into monthly observations (only the last `keepMonths` months of
 * each series, to keep the disk copy small). Null when it is not a DBnomics series reply; an empty
 * list when DBnomics answered with no series.
 */
export function parseDbnomics(json: unknown, keepMonths = 40): SdmxObs[] | null {
  const docs = (json as any)?.series?.docs;
  if (!Array.isArray(docs)) return null;
  const out: SdmxObs[] = [];
  for (const doc of docs) {
    const dimsRaw = doc?.dimensions && typeof doc.dimensions === 'object' ? doc.dimensions : {};
    const dims: Record<string, string> = {};
    for (const [k, v] of Object.entries(dimsRaw)) dims[k.toUpperCase()] = String(v);
    const area = String(dims.REF_AREA || dims.LOCATION || '').toUpperCase();
    const periods: unknown[] = Array.isArray(doc?.period) ? doc.period : [];
    const values: unknown[] = Array.isArray(doc?.value) ? doc.value : [];
    if (!area || !periods.length) continue;
    delete dims.REF_AREA;
    const pts: SdmxObs[] = [];
    periods.forEach((p, i) => {
      const period = String(p).slice(0, 7);
      const v = values[i];
      const value = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && v !== 'NA' ? Number(v) : NaN;
      if (/^\d{4}-\d{2}$/.test(period) && Number.isFinite(value)) pts.push({ area, period, value, dims });
    });
    out.push(...pts.slice(-keepMonths));
  }
  return out;
}

/** Reads either reply the app may get: DBnomics JSON or the OECD's own SDMX-CSV. */
export function parseOecdReply(text: unknown, keepMonths?: number): SdmxObs[] | null {
  if (typeof text !== 'string') return null;
  const t = text.replace(/^\uFEFF/, '').trimStart();
  if (t.startsWith('{')) {
    try {
      return parseDbnomics(JSON.parse(t), keepMonths);
    } catch {
      return null;
    }
  }
  return parseSdmxCsv(t);
}

/**
 * Headers for every OECD call. The OECD's site sits behind Cloudflare, which answered requests
 * that looked like a bare script (no Accept for CSV, a generic user agent) with a "Just a moment"
 * bot check and HTTP 429 on Sam's Mac (2026-11-05). The app names itself honestly and asks for
 * the SDMX-CSV it reads.
 */
export const OECD_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'User-Agent': 'EconQuest/1.0 (sovereign research terminal; +https://github.com/smcarus/econquest)',
};

/** After a refusal (429 or the bot check), the app leaves the OECD alone this long. */
export const OECD_PAUSE_MS = 60 * 60 * 1000;

/** True when the reply is Cloudflare's bot check page rather than data. */
export function isBotCheck(status: number | undefined, text: string | undefined): boolean {
  const t = (text || '').slice(0, 4000);
  return (status === 403 || status === 429 || status === 503) && /just a moment|cf-chl|challenge-platform|cf_chl_opt|attention required/i.test(t);
}
export const OECD_API = `https://${OECD_HOST}/public/rest/data`;

/** Country codes the OECD uses where they differ from the app's (the EU row is the euro area). */
export const OECD_AREA_FOR: Record<string, string[]> = {
  EUU: ['EA20', 'EA19', 'EA'],
};

/** Splits one CSV line, honouring double quotes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export interface SdmxObs {
  area: string;
  /** YYYY-MM. */
  period: string;
  value: number;
  /** Every other column, by name (MEASURE, ADJUSTMENT, METHODOLOGY ...). */
  dims: Record<string, string>;
}

/** Reads monthly observations from an SDMX-CSV reply. Null when the header is not SDMX-CSV. */
export function parseSdmxCsv(text: unknown): SdmxObs[] | null {
  if (typeof text !== 'string') return null;
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return null;
  const head = splitCsvLine(lines[0]).map((h) => h.split(':')[0].trim().toUpperCase());
  const ai = head.indexOf('REF_AREA');
  const ti = head.indexOf('TIME_PERIOD');
  const vi = head.indexOf('OBS_VALUE');
  if (ai < 0 || ti < 0 || vi < 0) return null;
  const out: SdmxObs[] = [];
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line);
    const period = (c[ti] || '').slice(0, 7);
    const raw = c[vi];
    const value = raw === undefined || raw === '' ? NaN : Number(raw);
    if (!/^\d{4}-\d{2}$/.test(period) || !Number.isFinite(value)) continue;
    const dims: Record<string, string> = {};
    head.forEach((h, i) => {
      if (i !== ai && i !== ti && i !== vi && h) dims[h] = (c[i] || '').split(':')[0].trim();
    });
    out.push({ area: (c[ai] || '').split(':')[0].trim().toUpperCase(), period, value, dims });
  }
  return out;
}

/** Dimension values to prefer when the reply holds more than one series for an area. */
export type SeriesPreference = Record<string, string[]>;

const SKIP_DIMS = new Set(['DATAFLOW', 'STRUCTURE', 'STRUCTURE_ID', 'ACTION', 'OBS_STATUS', 'UNIT_MULT', 'DECIMALS', 'BASE_PER', 'OBS_STATUS_1', 'CONF_STATUS']);

/**
 * One monthly series per area: { area -> [{period, value}] oldest first }. Series whose
 * dimensions do not match `require` are dropped (a dimension the reply does not carry is not
 * checked). Where several series remain for an area, the one that best matches `prefer` is kept;
 * ties go to the series with the newest month.
 */
export function seriesByArea(
  obs: SdmxObs[],
  require: SeriesPreference = {},
  prefer: SeriesPreference = {}
): Record<string, { period: string; value: number }[]> {
  const groups = new Map<string, { area: string; dims: Record<string, string>; points: Map<string, number> }>();
  for (const o of obs) {
    if (Object.entries(require).some(([dim, ok]) => o.dims[dim] !== undefined && !ok.includes(o.dims[dim]))) continue;
    const keyDims = Object.entries(o.dims)
      .filter(([k]) => !SKIP_DIMS.has(k))
      .sort(([a], [b]) => a.localeCompare(b));
    const key = `${o.area}|${keyDims.map(([k, v]) => `${k}=${v}`).join('|')}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { area: o.area, dims: o.dims, points: new Map() }));
    g.points.set(o.period, o.value);
  }
  const score = (dims: Record<string, string>) =>
    Object.entries(prefer).reduce((s, [dim, wanted]) => {
      const i = wanted.indexOf(dims[dim]);
      return s + (i < 0 ? 0 : wanted.length - i);
    }, 0);
  // A preferred series that stopped months ago must not hide a current one: series more than
  // STALE_MONTHS behind the newest series for the same area are only used if nothing fresher exists.
  const lastOf = (g: { points: Map<string, number> }) => [...g.points.keys()].sort().pop() || '';
  const newest = new Map<string, string>();
  for (const g of groups.values()) {
    const l = lastOf(g);
    if (l > (newest.get(g.area) || '')) newest.set(g.area, l);
  }
  const best = new Map<string, { s: number; last: string; points: Map<string, number> }>();
  for (const g of groups.values()) {
    const last = lastOf(g);
    if (monthsBetween(last, newest.get(g.area) || last) > STALE_MONTHS) continue;
    const s = score(g.dims);
    const cur = best.get(g.area);
    if (!cur || s > cur.s || (s === cur.s && last > cur.last)) best.set(g.area, { s, last, points: g.points });
  }
  const out: Record<string, { period: string; value: number }[]> = {};
  for (const [area, b] of best) {
    out[area] = [...b.points.entries()].sort(([a], [z]) => a.localeCompare(z)).map(([period, value]) => ({ period, value }));
  }
  return out;
}

/** A series this many months behind the newest one for its area is not picked. */
export const STALE_MONTHS = 2;

/** Whole months from `a` to `b` (both YYYY-MM). */
export function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/** The OECD's series for an app country: its ISO3 code, or the euro area for the EU row. */
export function areaSeries<T>(iso3: string, byArea: Record<string, T> | null | undefined): T | undefined {
  if (!byArea) return undefined;
  for (const code of OECD_AREA_FOR[iso3] || [iso3]) if (byArea[code]) return byArea[code];
  return undefined;
}

/** First month to ask for, `months` back from `now`, as YYYY-MM. */
export function startPeriod(months: number, now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  return d.toISOString().slice(0, 7);
}

export function formatMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return names[mo - 1] ? `${names[mo - 1]} ${y}` : m;
}
