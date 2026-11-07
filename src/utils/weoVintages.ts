/**
 * Real-time IMF World Economic Outlook: each figure as a given WEO edition published it.
 *
 * The app's IMF figures come from today's DataMapper, which holds only the latest edition, so a
 * question like "what did the IMF expect for Turkey's 2019 growth in October 2018?" or a fair
 * out-of-sample comparison against the IMF had no data. The IMF publishes every past edition of
 * the WEO database as a download (one tab-delimited file per edition, April and October; September
 * in some early years). You drop those files into data/local/weo-vintages/ and this file reads
 * them. Nothing is fetched: the files are yours, read as they are.
 *
 * File layout read: a header row with "ISO", "WEO Subject Code", "Units", "Scale", one column per
 * year (1980 ...) and "Estimates Start After"; one row per country and indicator. Missing cells
 * ("n/a", "--", blank) stay missing. Older editions are Windows-1252 text, newer ones UTF-16 with a
 * byte-order mark; both are decoded. The edition comes from the file name (WEOOct2019all.xls,
 * WEOApr2024all.xls ...).
 *
 * Publication date: an edition counts as published on the last day of its month. The IMF releases
 * it earlier in the month, so this never lets a backtest see an edition before it was out; it can
 * only make one look a few weeks later than it was.
 *
 * Browser-safe (no fs).
 */

/** The indicators kept from each edition (the rest of the file is skipped). */
export const WEO_VINTAGE_CODES = ['NGDP_RPCH', 'PCPIPCH', 'GGXWDG_NGDP', 'BCA_NGDPD', 'GGXCNL_NGDP', 'GGXONLB_NGDP', 'NGAP_NPGDP', 'LUR'] as const;

export const WEO_VINTAGE_SOURCE = 'IMF World Economic Outlook database, past editions (your downloaded files)';

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

export interface WeoRow {
  units?: string;
  scale?: string;
  /** Last year with actual data in this edition; later years are estimates or projections. */
  estimatesAfter?: number;
  /** Year (YYYY) to value. */
  years: Record<string, number>;
}

export interface WeoEdition {
  /** YYYY-MM of the edition (2019-10 = October 2019). */
  vintage: string;
  /** Last day of the edition's month (YYYY-MM-DD): the date it counts as published. */
  publishedBy: string;
  file: string;
  /** ISO3 to indicator code to its row. */
  rows: Record<string, Record<string, WeoRow>>;
}

export interface WeoVintageStore {
  editions: WeoEdition[];
  /** Files that could not be read, with the reason. */
  skipped: Array<{ file: string; reason: string }>;
}

/** Edition from a file name: WEOOct2019all.xls -> 2019-10. Null when the name holds no month and year. */
export function vintageFromFileName(name: string): string | null {
  const m = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[ _-]?((?:19|20)\d{2})/i.exec(name);
  if (!m) return null;
  return `${m[2]}-${MONTHS[m[1].toLowerCase()]}`;
}

export function publishedBy(vintage: string): string {
  const [y, m] = vintage.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Bytes of a WEO file to text: UTF-16 (with or without a byte-order mark) or Windows-1252. */
export function decodeWeoBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  // UTF-16 without a mark: every other byte of plain text is zero.
  const probe = bytes.subarray(0, Math.min(bytes.length, 400));
  let zeros = 0;
  for (let i = 1; i < probe.length; i += 2) if (probe[i] === 0) zeros++;
  if (probe.length > 10 && zeros > probe.length / 4) return new TextDecoder('utf-16le').decode(bytes);
  return new TextDecoder('windows-1252').decode(bytes);
}

function num(cell: string | undefined): number | undefined {
  const t = String(cell ?? '').replace(/"/g, '').replace(/,/g, '').trim();
  if (!t || t === 'n/a' || t === '--' || t === '.' || t.toLowerCase() === 'na') return undefined;
  const v = Number(t);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * One edition's table. Keeps only `codes`. Null with a reason when the header is not the WEO layout
 * or no row is kept.
 */
export function parseWeoTable(text: string, codes: readonly string[] = WEO_VINTAGE_CODES): { rows: WeoEdition['rows'] } | { reason: string } {
  const lines = String(text || '').split(/\r?\n/);
  const headerAt = lines.findIndex((l) => /WEO Subject Code/i.test(l) && /\bISO\b/.test(l));
  if (headerAt < 0) return { reason: 'No WEO header row (ISO, WEO Subject Code) found' };
  const header = lines[headerAt].split('\t').map((h) => h.replace(/"/g, '').trim());
  const col = (name: RegExp) => header.findIndex((h) => name.test(h));
  const iIso = col(/^ISO$/i);
  const iCode = col(/^WEO Subject Code$/i);
  const iUnits = col(/^Units$/i);
  const iScale = col(/^Scale$/i);
  const iEst = col(/^Estimates Start After$/i);
  const yearCols = header.map((h, i) => (/^(19|20)\d{2}$/.test(h) ? i : -1)).filter((i) => i >= 0);
  if (iIso < 0 || iCode < 0 || !yearCols.length) return { reason: 'The header lacks ISO, WEO Subject Code or year columns' };
  const keep = new Set(codes);
  const rows: WeoEdition['rows'] = {};
  let kept = 0;
  for (const line of lines.slice(headerAt + 1)) {
    if (!line.trim()) continue;
    const c = line.split('\t');
    const code = (c[iCode] || '').replace(/"/g, '').trim();
    const iso = (c[iIso] || '').replace(/"/g, '').trim().toUpperCase();
    if (!keep.has(code) || !/^[A-Z]{3}$/.test(iso)) continue;
    const years: Record<string, number> = {};
    for (const i of yearCols) {
      const v = num(c[i]);
      if (v !== undefined) years[header[i]] = v;
    }
    if (!Object.keys(years).length) continue;
    const est = iEst >= 0 ? num(c[iEst]) : undefined;
    (rows[iso] ??= {})[code] = {
      ...(iUnits >= 0 && c[iUnits]?.trim() ? { units: c[iUnits].replace(/"/g, '').trim() } : {}),
      ...(iScale >= 0 && c[iScale]?.trim() ? { scale: c[iScale].replace(/"/g, '').trim() } : {}),
      ...(est !== undefined && Number.isInteger(est) ? { estimatesAfter: est } : {}),
      years,
    };
    kept++;
  }
  return kept ? { rows } : { reason: `No rows for ${codes.join(', ')}` };
}

/** Reads every file into a store, newest edition last. Files without an edition in the name are skipped. */
export function buildWeoStore(files: Array<{ name: string; bytes: Uint8Array }>, codes: readonly string[] = WEO_VINTAGE_CODES): WeoVintageStore {
  const editions: WeoEdition[] = [];
  const skipped: WeoVintageStore['skipped'] = [];
  for (const f of files) {
    const vintage = vintageFromFileName(f.name);
    if (!vintage) {
      skipped.push({ file: f.name, reason: 'No edition (month and year, e.g. Oct2019) in the file name' });
      continue;
    }
    const parsed = parseWeoTable(decodeWeoBytes(f.bytes), codes);
    if ('reason' in parsed) {
      skipped.push({ file: f.name, reason: parsed.reason });
      continue;
    }
    const dup = editions.findIndex((e) => e.vintage === vintage);
    const edition = { vintage, publishedBy: publishedBy(vintage), file: f.name, rows: parsed.rows };
    if (dup >= 0) {
      skipped.push({ file: f.name, reason: `Same edition as ${editions[dup].file}; the first one is kept` });
      continue;
    }
    editions.push(edition);
  }
  editions.sort((a, b) => a.vintage.localeCompare(b.vintage));
  return { editions, skipped };
}

export type WeoValueKind = 'actual' | 'estimate' | 'projection';

/** Whether a year's figure in an edition is data, an IMF estimate or a projection. */
export function weoValueKind(edition: Pick<WeoEdition, 'vintage'>, row: WeoRow, year: string): WeoValueKind {
  const y = Number(year);
  if (y >= Number(edition.vintage.slice(0, 4))) return 'projection';
  if (row.estimatesAfter !== undefined && y > row.estimatesAfter) return 'estimate';
  return 'actual';
}

export interface WeoAsOf {
  vintage: string;
  publishedBy: string;
  file: string;
  units?: string;
  estimatesAfter?: number;
  /** Oldest first. */
  values: Array<{ year: string; value: number; kind: WeoValueKind }>;
}

/**
 * The latest edition published on or before `date` (YYYY-MM-DD), with its year values for one
 * country and indicator. Null when no such edition holds the series.
 */
export function weoAsOf(store: WeoVintageStore | null | undefined, iso3: string, code: string, date: string): WeoAsOf | null {
  const iso = String(iso3 || '').toUpperCase();
  const eds = (store?.editions || []).filter((e) => e.publishedBy <= date && e.rows[iso]?.[code]);
  const e = eds[eds.length - 1];
  if (!e) return null;
  const row = e.rows[iso][code];
  const values = Object.keys(row.years)
    .sort()
    .map((year) => ({ year, value: row.years[year], kind: weoValueKind(e, row, year) }));
  return { vintage: e.vintage, publishedBy: e.publishedBy, file: e.file, ...(row.units ? { units: row.units } : {}), ...(row.estimatesAfter !== undefined ? { estimatesAfter: row.estimatesAfter } : {}), values };
}

/** Every edition's figure for one year: how the IMF's number for that year moved, edition by edition. */
export function weoReleasesForYear(store: WeoVintageStore | null | undefined, iso3: string, code: string, year: string): Array<{ vintage: string; value: number; kind: WeoValueKind }> {
  const iso = String(iso3 || '').toUpperCase();
  const out: Array<{ vintage: string; value: number; kind: WeoValueKind }> = [];
  for (const e of store?.editions || []) {
    const row = e.rows[iso]?.[code];
    const v = row?.years[year];
    if (row && typeof v === 'number') out.push({ vintage: e.vintage, value: v, kind: weoValueKind(e, row, year) });
  }
  return out;
}

const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "October 2019" for 2019-10. */
export function vintageLabel(vintage: string): string {
  const [y, m] = vintage.split('-');
  return `${FULL[Number(m) - 1] ?? m} ${y}`;
}

export const WEO_VINTAGE_LABELS: Record<string, string> = {
  NGDP_RPCH: 'Real GDP growth (%)',
  PCPIPCH: 'Inflation, average (%)',
  GGXWDG_NGDP: 'Government debt (% of GDP)',
  BCA_NGDPD: 'Current account (% of GDP)',
  GGXCNL_NGDP: 'Overall fiscal balance (% of GDP)',
  GGXONLB_NGDP: 'Primary balance (% of GDP)',
  NGAP_NPGDP: 'Output gap (% of potential GDP)',
  LUR: 'Unemployment rate (%)',
};

export interface WeoVintageReply {
  iso3: string;
  code: string;
  label: string;
  /** Editions saved (any country). */
  editions: number;
  /** Years any edition gives for this country and indicator, oldest first. */
  years: string[];
  year: string | null;
  releases: Array<{ vintage: string; label: string; value: number; kind: WeoValueKind }>;
  /** One line comparing the first and the latest figure for the year, when there are two or more. */
  sentence?: string;
}

/** What the History & data panel shows: every edition's figure for one year. */
export function weoVintageReply(store: WeoVintageStore | null | undefined, iso3: string, code: string, year?: string): WeoVintageReply {
  const iso = String(iso3 || '').toUpperCase();
  const label = WEO_VINTAGE_LABELS[code] ?? code;
  const years = [...new Set((store?.editions || []).flatMap((e) => Object.keys(e.rows[iso]?.[code]?.years || {})))].sort();
  const thisYear = String(new Date().getUTCFullYear());
  const pick = year && years.includes(year) ? year : years.includes(thisYear) ? thisYear : years[years.length - 1] ?? null;
  const releases = pick ? weoReleasesForYear(store, iso, code, pick).map((r) => ({ ...r, label: vintageLabel(r.vintage) })) : [];
  let sentence: string | undefined;
  if (releases.length >= 2) {
    const a = releases[0];
    const b = releases[releases.length - 1];
    const d = b.value - a.value;
    sentence = `The IMF's ${label.replace(/ \(.*\)$/, '').toLowerCase()} figure for ${pick} went from ${a.value} (${a.label}, ${a.kind}) to ${b.value} (${b.label}, ${b.kind}), ${d === 0 ? 'unchanged' : `${d > 0 ? 'up' : 'down'} ${Math.abs(Number(d.toFixed(2)))}`} across ${releases.length} editions.`;
  }
  return { iso3: iso, code, label, editions: store?.editions.length ?? 0, years, year: pick, releases, ...(sentence ? { sentence } : {}) };
}

/**
 * Where the IMF has put each past edition's "By Countries" file over the years, newest layout first.
 * The IMF has moved these more than once, so each edition gets every known layout tried in turn;
 * an edition none of them finds is downloaded by hand from the WEO database page.
 */
export function weoEditionUrls(vintage: string): string[] {
  const [y, m] = vintage.split('-');
  const mon = m === '04' ? 'Apr' : m === '09' ? 'Sep' : 'Oct';
  const half = m === '04' ? '01' : '02';
  const month = m === '04' ? 'April' : m === '09' ? 'September' : 'October';
  const name = `WEO${mon}${y}all`;
  return [
    `https://www.imf.org/-/media/Files/Publications/WEO/WEO-Database/${y}/${month}/${name}.ashx`,
    `https://www.imf.org/-/media/Files/Publications/WEO/WEO-Database/${y}/${name}.ashx`,
    `https://www.imf.org/external/pubs/ft/weo/${y}/${half}/weodata/${name}.xls`,
  ];
}

/** File name an edition is saved under (read back by vintageFromFileName). */
export function weoEditionFileName(vintage: string): string {
  const [y, m] = vintage.split('-');
  return `WEO${m === '04' ? 'Apr' : m === '09' ? 'Sep' : 'Oct'}${y}all.xls`;
}

