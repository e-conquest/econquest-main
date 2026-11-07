/**
 * ACLED aggregated files you download yourself from myACLED (Aggregated data, one file per region:
 * Africa, Asia-Pacific, Europe and Central Asia, Latin America & the Caribbean, Middle East,
 * United States & Canada). They need only a registered myACLED account, unlike the API, which needs
 * the Research level. Put the file, as downloaded (.xlsx or .csv, zipped or not), in
 * data/local/acled/. Nothing is fetched. Parsing only (safe in the browser); the folder is read by
 * utils/acledFileStore.ts.
 *
 * Layout (acleddata.com/use-access/how-use-acleds-aggregated-data, read 2026-11-06): one row per
 * week, Admin 1 area and event type, with columns week, region, country, admin1, disorder_type,
 * event_type, sub_event_type, events, fatalities, population_best, centroid_longitude,
 * centroid_latitude. `week` is the Saturday that starts a Saturday-to-Friday week. Headers are
 * matched without regard to case, spaces or underscores ("admin 1" = "ADMIN1"). The app needs only
 * week, country, event_type, events and fatalities; a file without them is listed as not read.
 *
 * The app adds the Admin 1 rows into country-month counts: a week counts in the month it starts in
 * (so a week that straddles two months counts in the first), and only months the file covers to
 * their last day are used. population_best is never added up (ACLED says not to).
 */
import { unzipSync, strFromU8 } from 'fflate';
import { parseCsv } from './ucdpConflict';
import { parseSharedStrings, parseSheetRows } from './xlsxRead';
import { addMonths, acledReadingFromMonths, type AcledMonth, type AcledReading } from './acled';

export const ACLED_FOLDER = 'data/local/acled/';
export const ACLED_AGGREGATED_PAGE = 'https://acleddata.com/conflict-data/download-data-files/aggregated-data';
export const ACLED_FILE_COLUMNS = ['week', 'country', 'event_type', 'events', 'fatalities'] as const;

interface CountryCounts {
  /** Country as the file spells it. */
  name: string;
  file: string;
  byMonth: Map<string, AcledMonth>;
  /** Newest week start in the file for this country (YYYY-MM-DD). */
  lastWeek: string;
}

export interface AcledFileData {
  /** Keyed by lower-case country name. When two files hold a country, the one reaching later wins. */
  countries: Map<string, CountryCounts>;
  files: Array<{ file: string; rows: number; countries: number; firstWeek: string; lastWeek: string; modified: string }>;
  skipped: Array<{ file: string; reason: string }>;
}

const norm = (h: string) => h.toLowerCase().replace(/[\s_]+/g, '');

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (y: number, m: number, d: number): string | null => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
};
const isSaturday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 6;

/**
 * A week cell as YYYY-MM-DD, or null. Accepts 2025-10-25 (with or without a time), an Excel date
 * serial (a spreadsheet date cell), 25 October 2025 / 25-Oct-2025, and 10/25/2025 or 25/10/2025
 * (read whichever way gives a Saturday, as every ACLED week starts on one).
 */
export function parseAcledWeek(cell: string): string | null {
  const s = String(cell ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  if (/^\d{5}(\.0+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,})[\s-]+(\d{4})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return mi < 0 ? null : iso(+m[3], mi + 1, +m[1]);
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const us = iso(+m[3], +m[1], +m[2]);
    const eu = iso(+m[3], +m[2], +m[1]);
    if (us && isSaturday(us)) return us;
    if (eu && isSaturday(eu)) return eu;
    return us || eu;
  }
  return null;
}

const plusDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Adds one table (header row first) to `data`. Returns false (and records why) when it is not an ACLED aggregated table. */
export function addAcledTable(data: AcledFileData, file: string, table: Iterable<string[]>, modified: string): boolean {
  // The header is the first row naming all the needed columns (a sheet may start with a title row).
  const it = table[Symbol.iterator]();
  let header: string[] | null = null;
  for (let i = 0; i < 10 && !header; i++) {
    const nx = it.next();
    if (nx.done) break;
    if (ACLED_FILE_COLUMNS.every((c) => nx.value.some((h) => norm(h) === norm(c)))) header = nx.value;
  }
  if (!header) {
    data.skipped.push({ file, reason: `not an ACLED aggregated file: needs the columns ${ACLED_FILE_COLUMNS.join(', ')}` });
    return false;
  }
  const head = header.map(norm);
  const col = (c: string) => head.indexOf(norm(c));
  const [cw, cc, ct, ce, cf] = ACLED_FILE_COLUMNS.map(col);
  const local = new Map<string, CountryCounts>();
  let n = 0;
  let bad = 0;
  let first = '';
  let last = '';
  for (let nx = it.next(); !nx.done; nx = it.next()) {
    const r = nx.value;
    if (!r.length || r.every((x) => !String(x ?? '').trim())) continue;
    const week = parseAcledWeek(r[cw]);
    const country = String(r[cc] ?? '').trim();
    const events = Number(String(r[ce] ?? '').replace(/,/g, ''));
    const fat = Number(String(r[cf] ?? '').replace(/,/g, '') || 0);
    if (!week || !country || !Number.isFinite(events) || events < 0) {
      bad++;
      continue;
    }
    n++;
    if (!first || week < first) first = week;
    if (week > last) last = week;
    const key = country.toLowerCase();
    const cty = local.get(key) || { name: country, file, byMonth: new Map(), lastWeek: '' };
    if (week > cty.lastWeek) cty.lastWeek = week;
    const ym = week.slice(0, 7);
    const mo = cty.byMonth.get(ym) || { month: ym, events: 0, fatalities: 0, byType: {} };
    const type = String(r[ct] ?? '').trim() || 'Other';
    mo.events += events;
    mo.fatalities += Number.isFinite(fat) && fat > 0 ? fat : 0;
    mo.byType[type] = (mo.byType[type] || 0) + events;
    cty.byMonth.set(ym, mo);
    local.set(key, cty);
  }
  if (!n) {
    data.skipped.push({ file, reason: bad ? `no rows with a readable week date (${bad} rows not read)` : 'no data rows' });
    return false;
  }
  for (const [key, cty] of local) {
    const had = data.countries.get(key);
    if (!had || cty.lastWeek > had.lastWeek) data.countries.set(key, cty);
  }
  data.files.push({ file, rows: n, countries: local.size, firstWeek: first, lastWeek: last, modified });
  return true;
}

/**
 * Text of a large file in pieces that each end at `sep`, so a regional file of hundreds of MB is
 * never held as one string (V8 strings stop at about 512 MB).
 */
function* textPieces(buf: Uint8Array, sep: string, size = 16 * 1024 * 1024): Generator<string> {
  const dec = new TextDecoder();
  const sepBytes = new TextEncoder().encode(sep);
  let at = 0;
  while (at < buf.length) {
    let end = Math.min(buf.length, at + size);
    if (end < buf.length) {
      // back up to just after the last separator in this piece
      let k = end - sepBytes.length;
      for (; k > at; k--) {
        let hit = true;
        for (let j = 0; j < sepBytes.length; j++) if (buf[k + j] !== sepBytes[j]) { hit = false; break; }
        if (hit) break;
      }
      if (k > at) end = k + sepBytes.length;
    }
    yield dec.decode(buf.subarray(at, end));
    at = end;
  }
}

/** CSV rows, piece by piece. Assumes no line break inside a quoted cell (true of ACLED's files). */
export function* csvRows(buf: Uint8Array): Generator<string[]> {
  for (const piece of textPieces(buf, '\n')) yield* parseCsv(piece);
}

/** Worksheet rows, piece by piece. Row numbers are dropped (empty rows do not matter here). */
function* sheetRows(sheet: Uint8Array, shared: string[]): Generator<string[]> {
  for (const piece of textPieces(sheet, '</row>')) yield* parseSheetRows(piece.replace(/<row\b[^>]*>/g, '<row>'), shared);
}

/** First worksheet of an .xlsx (already unzipped) as rows of text. */
function firstSheetRows(entries: Record<string, Uint8Array>): Iterable<string[]> | null {
  const text = (name: string) => (entries[name] ? strFromU8(entries[name]) : null);
  const workbook = text('xl/workbook.xml');
  const rels = text('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) return null;
  const rid = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.match(/\bId="([^"]+)"/)?.[1] === rid);
  const target = rel?.match(/\bTarget="([^"]+)"/)?.[1];
  if (!target) return null;
  const sheet = entries[target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`];
  if (!sheet) return null;
  const shared = text('xl/sharedStrings.xml');
  return sheetRows(sheet, shared ? parseSharedStrings(shared) : []);
}

export function xlsxRows(buf: Uint8Array): Iterable<string[]> | null {
  return firstSheetRows(unzipSync(buf, { filter: (f) => f.name.startsWith('xl/') }));
}

export function emptyAcledFileData(): AcledFileData {
  return { countries: new Map(), files: [], skipped: [] };
}

/**
 * Twelve whole months for a country from the files, or null when no file holds it. The newest
 * month used is the last one the file covers to its final day (newest week start + 6 days), and
 * never the current calendar month.
 */
export function acledFileReading(data: AcledFileData | null | undefined, country: string, now = new Date()): AcledReading | null {
  const cty = data?.countries.get(country.trim().toLowerCase());
  if (!cty) return null;
  const coveredTo = plusDays(cty.lastWeek, 6);
  const lastFull = addMonths(plusDays(coveredTo, 1).slice(0, 7), -1);
  const cap = addMonths(now.toISOString().slice(0, 7), -1);
  const end = lastFull < cap ? lastFull : cap;
  const info = data!.files.find((f) => f.file === cty.file);
  return acledReadingFromMonths(cty.byMonth, cty.name, info?.modified || now.toISOString(), coveredTo, end, { file: cty.file });
}
