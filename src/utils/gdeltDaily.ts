/**
 * GDELT 1.0 event files (Sam, 2026-11-06): the files listed at data.gdeltproject.org/events/,
 * read alongside the GDELT 2.0 15-minute files (utils/gdeltRaw.ts) to give each country a long
 * monthly history of events, back to 1979 if wanted.
 *
 * Three kinds of file, all zipped, tab-separated, no header (GDELT Data Format Codebook 1.03):
 * - YYYY.zip, 1979 to 2005, and YYYYMM.zip, January 2006 to March 2013: the historical backfile,
 *   stored by the date the event took place, 57 columns;
 * - YYYYMMDD.export.CSV.zip, from 1 April 2013: the events GDELT found that day, 58 columns
 *   (SOURCEURL added).
 * The list with each file's size is data.gdeltproject.org/events/filesizes.
 *
 * Counted per country per month, the same way as the 2.0 files: an event counts for a country
 * when it took place there (ActionGeo) or the country is either actor. Backfile events count in
 * the month they took place; daily-file events count in the month of the file (the day GDELT
 * found them), since a daily file also carries some events dated earlier.
 *
 * GDELT's volume grew many times over the decades as more news went online, so raw counts are
 * not comparable across years. Every month also keeps the world total, and the readings use shares
 * (protests as a share of the country's events, the country's share of all events), not counts.
 *
 * This file is the parsing and adding up (no fs). utils/gdeltDailyStore.ts downloads, streams each
 * zip through, and keeps one small file per month.
 */
import { CAMEO_ROOTS, FIPS_TO_ISO3, ISO3_TO_FIPS, addEventAgg, emptyEventAgg, type EventAgg } from './gdeltRaw';

export const GDELT_V1_BASE = 'https://data.gdeltproject.org/events/';
export const GDELT_V1_SIZES_URL = `${GDELT_V1_BASE}filesizes`;
export const GDELT_V1_SHORT = 'GDELT 1.0 event files';

export type V1Kind = 'year' | 'month' | 'day';

export interface V1File {
  name: string;
  kind: V1Kind;
  /** "1990", "2006-01" or "2013-04-01". */
  period: string;
  /** Months the file can fill, YYYY-MM. */
  months: string[];
  bytes: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** One file name to its kind and period, or null for files the app does not read. */
export function v1FileFromName(name: string, bytes = 0): V1File | null {
  let m = /^(\d{4})\.zip$/.exec(name);
  if (m) {
    const y = Number(m[1]);
    return { name, kind: 'year', period: m[1], months: Array.from({ length: 12 }, (_, i) => `${y}-${pad(i + 1)}`), bytes };
  }
  m = /^(\d{4})(\d{2})\.zip$/.exec(name);
  if (m) return { name, kind: 'month', period: `${m[1]}-${m[2]}`, months: [`${m[1]}-${m[2]}`], bytes };
  m = /^(\d{4})(\d{2})(\d{2})\.export\.CSV\.zip$/i.exec(name);
  if (m) return { name, kind: 'day', period: `${m[1]}-${m[2]}-${m[3]}`, months: [`${m[1]}-${m[2]}`], bytes };
  return null;
}

/** The "<bytes> <name>" list. Files the app does not read (the master file) are left out. */
export function parseFileSizes(text: string): V1File[] {
  const out: V1File[] = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\S+)\s*$/.exec(line);
    if (!m) continue;
    const f = v1FileFromName(m[2], Number(m[1]));
    if (f) out.push(f);
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
}

export const GDELT_V1_DEFAULT_FROM = '2016-01';

/** GDELT_DAILY_FROM: "1979", "2006-01" or "2016-01-01"; the first month to read (default 2016-01). */
export function v1FromMonth(env: Record<string, string | undefined>): string {
  const v = String(env.GDELT_DAILY_FROM || '').trim();
  const m = /^(\d{4})(?:-(\d{2}))?/.exec(v);
  if (!m) return GDELT_V1_DEFAULT_FROM;
  const y = Math.max(1979, Math.min(2100, Number(m[1])));
  const mo = m[2] ? Math.max(1, Math.min(12, Number(m[2]))) : 1;
  return `${y}-${pad(mo)}`;
}

/** Files that cover a month at or after `fromMonth`. */
export function filesFrom(files: V1File[], fromMonth: string): V1File[] {
  return files.filter((f) => f.months[f.months.length - 1] >= fromMonth);
}

/* ------------------------------------------------------------------------------------------
 * Rows.
 * ------------------------------------------------------------------------------------------ */

/** ActionGeo_CountryCode column in GDELT 1.0 (no ADM2 columns, unlike 2.0 where it is 53). */
export const V1_ACTIONGEO_COUNTRY = 51;
export const V1_MIN_COLUMNS = 57;

/** One file's totals: month -> country -> events, and month -> world total. */
export interface V1FileTotals {
  rows: number;
  skipped: number;
  months: Record<string, { world: number; countries: Record<string, EventAgg> }>;
}

/**
 * Adds up a file as its lines arrive. `fileMonth` is set for daily files (events count in the
 * file's month); for backfiles each event counts in the month it took place (SQLDATE), and only
 * months in `keepMonths` are kept.
 */
export function v1Reader(opts: { fileMonth?: string; keepMonths?: Set<string> }): { line: (line: string) => void; result: () => V1FileTotals } {
  const out: V1FileTotals = { rows: 0, skipped: 0, months: {} };
  const line = (l: string) => {
    if (!l) return;
    const c = l.split('\t');
    if (c.length < V1_MIN_COLUMNS) {
      out.skipped++;
      return;
    }
    let month = opts.fileMonth;
    if (!month) {
      const d = c[1] || '';
      if (!/^\d{8}$/.test(d)) {
        out.skipped++;
        return;
      }
      month = `${d.slice(0, 4)}-${d.slice(4, 6)}`;
    }
    if (opts.keepMonths && !opts.keepMonths.has(month)) return;
    out.rows++;
    const m = (out.months[month] ||= { world: 0, countries: {} });
    m.world++;
    const who = new Set<string>();
    const place = FIPS_TO_ISO3[c[V1_ACTIONGEO_COUNTRY]];
    if (place) who.add(place);
    for (const a of [c[7], c[17]]) if (a && ISO3_TO_FIPS[a]) who.add(a);
    if (!who.size) return;
    const root = (c[28] || '').padStart(2, '0').slice(0, 2);
    const quad = Number(c[29]);
    const gold = Number(c[30]);
    const arts = Number(c[33]);
    const tone = Number(c[34]);
    const code = c[26] || '';
    for (const iso of who) {
      const a = (m.countries[iso] ||= emptyEventAgg());
      a.n++;
      if (quad >= 1 && quad <= 4) a.quad[quad - 1]++;
      if (CAMEO_ROOTS[root]) a.root[root] = (a.root[root] || 0) + 1;
      if (root === '14') a.protests++;
      if (code.startsWith('163')) a.sanctions++;
      if (root === '18' || root === '19' || root === '20') a.violence++;
      if (Number.isFinite(gold)) a.goldsteinSum += gold;
      if (Number.isFinite(tone)) a.toneSum += tone;
      if (Number.isFinite(arts)) a.articles += arts;
    }
  };
  return { line, result: () => out };
}

/** Splits streamed text into lines, carrying the partial last line to the next chunk. */
export function lineSplitter(onLine: (line: string) => void): { push: (text: string) => void; end: () => void } {
  let rest = '';
  return {
    push(text: string) {
      const s = rest + text;
      let start = 0;
      for (;;) {
        const i = s.indexOf('\n', start);
        if (i === -1) break;
        const lineEnd = i > start && s.charCodeAt(i - 1) === 13 ? i - 1 : i;
        onLine(s.slice(start, lineEnd));
        start = i + 1;
      }
      rest = s.slice(start);
    },
    end() {
      if (rest) onLine(rest.endsWith('\r') ? rest.slice(0, -1) : rest);
      rest = '';
    },
  };
}

/* ------------------------------------------------------------------------------------------
 * Month files on disk and the series.
 * ------------------------------------------------------------------------------------------ */

export interface V1Month {
  month: string;
  /** Files already added to this month (so a file is never counted twice). */
  files: string[];
  world: number;
  countries: Record<string, EventAgg>;
}
export const emptyMonth = (month: string): V1Month => ({ month, files: [], world: 0, countries: {} });

/** Adds one file's totals for `month` unless that file is already in it. True when added. */
export function addToMonth(m: V1Month, file: string, t: V1FileTotals['months'][string] | undefined): boolean {
  if (m.files.includes(file)) return false;
  m.files.push(file);
  if (!t) return true;
  m.world += t.world;
  for (const [iso, agg] of Object.entries(t.countries)) m.countries[iso] = addEventAgg(m.countries[iso] || emptyEventAgg(), agg);
  return true;
}

export interface V1MonthPoint {
  month: string;
  events: number;
  /** The country's share of all events GDELT coded that month, %. */
  sharePct: number;
  protests: number;
  sanctions: number;
  violence: number;
  /** As % of the country's events. */
  protestPct: number;
  violencePct: number;
  goldsteinMean: number;
  toneMean: number;
  /** Daily files read for the month (daily months only), against the days in the month. */
  dailyFiles?: number;
  daysInMonth?: number;
}

export interface V1Series {
  iso3: string;
  points: V1MonthPoint[];
  pulledAt?: string;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const daysIn = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

/** Monthly points for one country, oldest first, from the saved months. */
export function v1Series(iso3: string, months: V1Month[], pulledAt?: string): V1Series {
  const iso = iso3.toUpperCase();
  const points: V1MonthPoint[] = [];
  for (const m of [...months].sort((a, b) => a.month.localeCompare(b.month))) {
    if (!m.world) continue;
    const a = m.countries[iso] || emptyEventAgg();
    const daily = m.files.filter((f) => /\.export\.CSV\.zip$/i.test(f)).length;
    points.push({
      month: m.month,
      events: a.n,
      sharePct: r2((100 * a.n) / m.world),
      protests: a.protests,
      sanctions: a.sanctions,
      violence: a.violence,
      protestPct: a.n ? r2((100 * a.protests) / a.n) : 0,
      violencePct: a.n ? r2((100 * a.violence) / a.n) : 0,
      goldsteinMean: a.n ? r2(a.goldsteinSum / a.n) : 0,
      toneMean: a.n ? r2(a.toneSum / a.n) : 0,
      ...(daily ? { dailyFiles: daily, daysInMonth: daysIn(m.month) } : {}),
    });
  }
  return { iso3: iso, points, ...(pulledAt ? { pulledAt } : {}) };
}

/** Where `value` sits among `history`, as the % of months at or below it (0-100). */
export function percentileOf(value: number, history: number[]): number | null {
  if (!history.length) return null;
  return Math.round((100 * history.filter((h) => h <= value).length) / history.length);
}

export interface V1Reading {
  month: string;
  /** Months of history behind the percentiles. */
  months: number;
  from: string;
  protestPct: number;
  violencePct: number;
  goldsteinMean: number;
  /** Percentile of this month among all months on disk. */
  protestPctile: number | null;
  violencePctile: number | null;
  /** Low Goldstein = more conflictual; percentile of the month's mean. */
  goldsteinPctile: number | null;
  pulledAt?: string;
}

/** Latest complete month against the whole history on disk (needs 24 months). */
export function v1Reading(s: V1Series | null | undefined): V1Reading | null {
  if (!s) return null;
  const complete = s.points.filter((p) => p.events > 0 && (p.dailyFiles === undefined || p.dailyFiles >= (p.daysInMonth || 31) - 2));
  if (complete.length < 24) return null;
  const last = complete[complete.length - 1];
  const hist = complete.slice(0, -1);
  return {
    month: last.month,
    months: hist.length,
    from: hist[0].month,
    protestPct: last.protestPct,
    violencePct: last.violencePct,
    goldsteinMean: last.goldsteinMean,
    protestPctile: percentileOf(last.protestPct, hist.map((p) => p.protestPct)),
    violencePctile: percentileOf(last.violencePct, hist.map((p) => p.violencePct)),
    goldsteinPctile: percentileOf(last.goldsteinMean, hist.map((p) => p.goldsteinMean)),
    ...(s.pulledAt ? { pulledAt: s.pulledAt } : {}),
  };
}

/** Rough download size in bytes for the files left. */
export function bytesOf(files: V1File[]): number {
  return files.reduce((a, f) => a + f.bytes, 0);
}

/* ------------------------------------------------------------------------------------------
 * Words.
 * ------------------------------------------------------------------------------------------ */

export const V1_PERCENTILE_RULE = 'percentile = share of earlier months on disk at or below this month; 90th or above = unusually high, 10th or below = unusually low';

const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;

/** Figures and sentences for the Politics & Events Agent. Shares are what the files hold; the bands are a stated rule. */
export function v1Figures(r: V1Reading): { figures: Array<{ label: string; value: string; source: string; tag: 'live' | 'model' }>; sentences: string[]; weight: number } {
  const src = `${GDELT_V1_SHORT}, pulled ${r.pulledAt?.slice(0, 10) || 'date unknown'}; ${r.months} months from ${r.from}`;
  const p = (v: number | null) => (v === null ? '' : ` (${ord(v)} percentile)`);
  const figures = [
    { label: `Protests as a share of events, ${r.month}`, value: `${r.protestPct}%${p(r.protestPctile)}`, source: `${src}; ${V1_PERCENTILE_RULE}`, tag: 'live' as const },
    { label: `Violence as a share of events, ${r.month}`, value: `${r.violencePct}%${p(r.violencePctile)}`, source: `${src}; CAMEO roots 18-20`, tag: 'live' as const },
    { label: `Event intensity (Goldstein), ${r.month}`, value: `${r.goldsteinMean >= 0 ? '+' : ''}${r.goldsteinMean}${p(r.goldsteinPctile)}`, source: `${src}; -10 most conflictual, +10 most cooperative`, tag: 'live' as const },
  ];
  const sentences: string[] = [];
  let weight = 0;
  if ((r.protestPctile ?? 0) >= 90) {
    sentences.push(`Protests made up ${r.protestPct}% of reported events in ${r.month}, higher than in ${r.protestPctile}% of months since ${r.from}.`);
    weight = 0.5;
  }
  if ((r.violencePctile ?? 0) >= 90) {
    sentences.push(`Violence made up ${r.violencePct}% of reported events in ${r.month}, among the highest shares since ${r.from}.`);
    weight = Math.max(weight, 0.5);
  }
  if (r.goldsteinPctile !== null && r.goldsteinPctile <= 10) {
    sentences.push(`Events in ${r.month} were among the most conflictual since ${r.from} on the Goldstein scale.`);
    weight = Math.max(weight, 0.4);
  }
  return { figures, sentences, weight };
}

/** Why there is no long-run reading. */
export function v1Missing(pulled: boolean): { short: string; help: string } {
  return pulled
    ? { short: 'fewer than 24 complete months of GDELT 1.0 files on disk', help: 'Pull further back with npm run gdelt:daily -- --from 2016.' }
    : { short: 'GDELT 1.0 files not pulled yet', help: 'Pull them with npm run gdelt:daily (about 25 GB from 2016; -- --estimate shows the size first).' };
}
