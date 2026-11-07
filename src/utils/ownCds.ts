/**
 * 5-year sovereign CDS from the user's own licensed data. CDS quotes are not published free
 * anywhere, so this is off unless the user switches it on in .env:
 *
 *   CDS_FEED=csv    CDS_CSV_PATH=/path/to/cds.csv
 *       A file the user keeps, for example an export from Bloomberg, LSEG or S&P/Markit. Columns
 *       (header row, any order, case-insensitive): iso3, date, cds5y_bps, and optionally source.
 *       "bps", "spread_bps" or "value" are accepted for the spread. The latest date per country wins.
 *
 *   CDS_FEED=lseg   LSEG_APP_KEY, LSEG_USERNAME, LSEG_PASSWORD, LSEG_CDS_RICS=BRA=<ric>,TUR=<ric>,...
 *       LSEG Data Platform: password-grant token, then one pricing snapshot for the listed RICs.
 *       The RIC for each country comes from the user's own LSEG entitlement, so none are built in.
 *       LSEG_API_BASE overrides the host (default https://api.refinitiv.com).
 *
 * Countries the data does not cover keep their sample (or AI-estimated) CDS, labelled as such.
 * The values are the user's licensed data: shown in their own app, and the source line on every
 * figure says whose data it is, so a note sent onward can be checked against the licence.
 */

export type OwnCdsProvider = 'csv' | 'lseg';

export interface OwnCdsQuote {
  iso3: string;
  bps: number;
  /** Date of the quote, YYYY-MM-DD. */
  date: string;
  /** Who supplied it, as shown to the user, e.g. "LSEG" or "Bloomberg (your file)". */
  source: string;
}

export interface OwnCdsSettings {
  provider: OwnCdsProvider;
  csvPath?: string;
  lseg?: { appKey: string; username: string; password: string; rics: Record<string, string>; base: string };
}

/** Label pushed into dataStatus.verifiedLiveSources; dataStatus.ts matches "Own CDS". */
export const OWN_CDS_LABEL = 'Own CDS data';

export function ownCdsSettings(env: Record<string, string | undefined>): OwnCdsSettings | null {
  const feed = (env.CDS_FEED || '').trim().toLowerCase();
  if (feed === 'csv') {
    const csvPath = (env.CDS_CSV_PATH || '').trim();
    return csvPath ? { provider: 'csv', csvPath } : null;
  }
  if (feed === 'lseg') {
    const appKey = (env.LSEG_APP_KEY || '').trim();
    const username = (env.LSEG_USERNAME || '').trim();
    const password = env.LSEG_PASSWORD || '';
    const rics = parseRicMap(env.LSEG_CDS_RICS || '');
    if (!appKey || !username || !password || !Object.keys(rics).length) return null;
    return { provider: 'lseg', lseg: { appKey, username, password, rics, base: (env.LSEG_API_BASE || 'https://api.refinitiv.com').replace(/\/+$/, '') } };
  }
  return null;
}

/** "BRA=ABC,TUR=DEF" -> { BRA: 'ABC', TUR: 'DEF' }. */
export function parseRicMap(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(/[,;\n]/)) {
    const m = part.trim().match(/^([A-Za-z]{3})\s*=\s*(\S+)$/);
    if (m) out[m[1].toUpperCase()] = m[2];
  }
  return out;
}

/** Plausible 5Y sovereign CDS, in bps. Anything else is refused rather than shown. */
export const plausibleBps = (v: number) => Number.isFinite(v) && v > 0 && v < 20000;

/** "2026-11-03", "03/11/2026" (day first), "20261103" or an ISO timestamp -> "2026-11-03", else null. */
export function normaliseDate(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** The user's CSV -> latest quote per country. Rows that cannot be read are skipped. */
export function parseOwnCdsCsv(text: string, defaultSource = 'your file'): Map<string, OwnCdsQuote> {
  const out = new Map<string, OwnCdsQuote>();
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return out;
  const sep = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const head = splitLine(lines[0], sep).map((h) => h.toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const iIso = col('iso3', 'country', 'iso');
  const iDate = col('date', 'as_of', 'asof');
  const iBps = col('cds5y_bps', 'cds_5y_bps', 'bps', 'spread_bps', 'value');
  const iSrc = col('source', 'provider');
  if (iIso < 0 || iDate < 0 || iBps < 0) return out;
  for (const line of lines.slice(1)) {
    const c = splitLine(line, sep);
    const iso3 = (c[iIso] || '').toUpperCase();
    const date = normaliseDate(c[iDate]);
    const bps = Number((c[iBps] || '').replace(/,/g, ''));
    if (!/^[A-Z]{3}$/.test(iso3) || !date || !plausibleBps(bps)) continue;
    const prev = out.get(iso3);
    if (prev && prev.date >= date) continue;
    out.set(iso3, { iso3, bps, date, source: (iSrc >= 0 && c[iSrc]) || defaultSource });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------
 * LSEG Data Platform
 * ------------------------------------------------------------------------------------------ */

export function lsegTokenRequest(s: NonNullable<OwnCdsSettings['lseg']>): { url: string; body: string } {
  const body = new URLSearchParams({
    grant_type: 'password',
    username: s.username,
    password: s.password,
    client_id: s.appKey,
    scope: 'trapi',
    takeExclusiveSignOnControl: 'true',
  }).toString();
  return { url: `${s.base}/auth/oauth2/v1/token`, body };
}

export const LSEG_FIELDS = ['CF_LAST', 'PRIMACT_1', 'MID_SPREAD', 'VALUE_DT1', 'TRADE_DATE', 'CF_DATE'];

export function lsegSnapshotUrl(s: NonNullable<OwnCdsSettings['lseg']>): string {
  const universe = Object.values(s.rics).map(encodeURIComponent).join(',');
  return `${s.base}/data/pricing/snapshots/v1/?universe=${universe}&fields=${LSEG_FIELDS.join(',')}`;
}

/**
 * Pricing snapshot answer (array of { Type, Key: { Name }, Fields }) -> quotes for the mapped
 * countries. A RIC that returns a Status message instead of fields, or no plausible value, is skipped.
 */
export function parseLsegSnapshot(json: unknown, rics: Record<string, string>, today: string): Map<string, OwnCdsQuote> {
  const out = new Map<string, OwnCdsQuote>();
  if (!Array.isArray(json)) return out;
  const isoByRic = new Map(Object.entries(rics).map(([iso, ric]) => [ric, iso]));
  for (const item of json as Array<Record<string, any>>) {
    const ric = item?.Key?.Name;
    const iso3 = isoByRic.get(ric);
    const f = item?.Fields;
    if (!iso3 || !f || (item.Type && item.Type !== 'Refresh')) continue;
    const bps = [f.CF_LAST, f.PRIMACT_1, f.MID_SPREAD].map(Number).find((v) => plausibleBps(v));
    if (bps === undefined) continue;
    const date = normaliseDate(f.VALUE_DT1) || normaliseDate(f.TRADE_DATE) || normaliseDate(f.CF_DATE) || today;
    out.set(iso3, { iso3, bps, date, source: 'LSEG' });
  }
  return out;
}
