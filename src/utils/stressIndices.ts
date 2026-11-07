/**
 * Stress and pressure indices a user can pick for the global shock scenarios and chart or test
 * like any other world series (Chart Agent, econometrics lab).
 *
 *   Financial stress / conditions, weekly, from FRED (all labelled "Copyrighted: Citation Required"):
 *     STLFSI4  St. Louis Fed Financial Stress Index (zero = average stress)             default
 *     NFCI     Chicago Fed National Financial Conditions Index (zero = average; positive = tighter)
 *     ANFCI    Chicago Fed Adjusted NFCI (the part uncorrelated with economic conditions)
 *   Supply chains, monthly, from the New York Fed:
 *     GSCPI    Global Supply Chain Pressure Index (standard deviations from its average)
 *
 * FRED series pages checked 2026-11-07 (titles, weekly ending Friday, units index). The GSCPI file
 * is an Excel 97 workbook (.xls, OLE2), even at its .csv address: Sam's check:data run of
 * 2026-11-07 showed the OLE2 signature. It is read with src/utils/xlsRead.ts; an .xlsx or a real CSV
 * is read too, should the NY Fed change the file. The parser looks for a date column and a number
 * column on any sheet, and the app shows Missing with the reason when it finds none.
 *
 * Browser-safe, pure.
 */
import type { Series, SeriesMissing, SeriesPoint } from './seriesHistory';
import { describeXls, isOleFile, readXlsSheets } from './xlsRead';
import { readXlsxSheet, xlsxSheetNames } from './xlsxRead';

export type IdxObs = { date: string; value: number };

export type StressKey = 'stlfsi' | 'nfci' | 'anfci';

export const STRESS_INDICES: Array<{ key: StressKey; fred: string; label: string; short: string; about: string }> = [
  { key: 'stlfsi', fred: 'STLFSI4', label: 'St. Louis Fed Financial Stress Index', short: 'St. Louis Fed index', about: 'Weekly, built from financial market series. Zero = average stress; above zero = more stress than average.' },
  { key: 'nfci', fred: 'NFCI', label: 'Chicago Fed National Financial Conditions Index', short: 'Chicago Fed NFCI', about: 'Weekly, built from measures of risk, credit and leverage. Zero = average conditions; positive = tighter than average.' },
  { key: 'anfci', fred: 'ANFCI', label: 'Chicago Fed Adjusted National Financial Conditions Index', short: 'Chicago Fed adjusted NFCI', about: 'Weekly. The NFCI with the part explained by economic conditions taken out, so it isolates financial conditions uncorrelated with the economy. Positive = tighter than average.' },
];

export const DEFAULT_STRESS: StressKey = 'stlfsi';

export function stressIndex(key: unknown) {
  return STRESS_INDICES.find((s) => s.key === key) || STRESS_INDICES.find((s) => s.key === DEFAULT_STRESS)!;
}

export const GSCPI_URLS = {
  csv: 'https://www.newyorkfed.org/medialibrary/research/interactives/gscpi/downloads/gscpi_data.csv',
  xlsx: 'https://www.newyorkfed.org/medialibrary/research/interactives/gscpi/downloads/gscpi_data.xlsx',
};
export const GSCPI_SOURCE = 'Federal Reserve Bank of New York, Global Supply Chain Pressure Index (GSCPI)';

const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, '0');

/** A date cell as YYYY-MM-DD: Excel serial day, ISO, "31-Jan-1998", "Jan-1998", "1/31/1998". Null otherwise. */
export function cellDate(cell: string): string | null {
  const s = String(cell ?? '').trim();
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial < 20000 || serial > 80000) return null; // 1954 .. 2119
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    return d.toISOString().slice(0, 10);
  }
  let m = s.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (m) return `${m[1]}-${m[2]}-${m[3] || '01'}`;
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{2,4})$/);
  if (m && MON[m[2].toLowerCase()]) {
    const y = m[3].length === 2 ? 1900 + Number(m[3]) + (Number(m[3]) < 50 ? 100 : 0) : Number(m[3]);
    return `${y}-${pad(MON[m[2].toLowerCase()])}-${pad(Number(m[1]))}`;
  }
  m = s.match(/^([A-Za-z]{3})[A-Za-z]*[-\s](\d{4})$/);
  if (m && MON[m[1].toLowerCase()]) return `${m[2]}-${pad(MON[m[1].toLowerCase()])}-01`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`;
  return null;
}

/**
 * GSCPI rows (from a sheet or a CSV): the first column that holds dates and the first number column
 * after it whose values look like an index in standard deviations (|v| < 10). One value per month.
 */
export function parseGscpiRows(rows: string[][]): IdxObs[] {
  let best: IdxObs[] = [];
  const width = Math.max(0, ...rows.map((r) => r.length));
  for (let dc = 0; dc < Math.min(width, 12); dc++) {
    for (let vc = dc + 1; vc < Math.min(width, dc + 12); vc++) {
      const byMonth = new Map<string, number>();
      let bad = 0;
      for (const r of rows) {
        const d = cellDate(r[dc] ?? '');
        if (!d) continue;
        const raw = String(r[vc] ?? '').trim();
        if (raw === '' || raw === '.' || /^#N\/A$/i.test(raw)) continue;
        const v = Number(raw);
        if (!Number.isFinite(v) || Math.abs(v) >= 10) {
          bad++;
          continue;
        }
        byMonth.set(d.slice(0, 7), v);
      }
      if (bad > byMonth.size / 10) continue;
      const obs = [...byMonth.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([ym, value]) => ({ date: `${ym}-01`, value }));
      if (obs.length > best.length) best = obs;
    }
  }
  return best.length >= 24 ? best : [];
}

/** Splits CSV text into rows (quoted fields allowed). */
export function csvRows(text: string): string[][] {
  return text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      const out: string[] = [];
      let cur = '';
      let q = false;
      for (let i = 0; i < l.length; i++) {
        const c = l[i];
        if (c === '"') {
          if (q && l[i + 1] === '"') {
            cur += '"';
            i++;
          } else q = !q;
        } else if (c === ',' && !q) {
          out.push(cur);
          cur = '';
        } else cur += c;
      }
      out.push(cur);
      return out.map((s) => s.trim());
    });
}

export interface StressPulls {
  /** FRED series id -> weekly observations, oldest first. */
  fred: Record<string, IdxObs[]>;
  gscpi: { obs: IdxObs[]; fetchedAt: string } | { reason: string } | null;
  fetchedAt: string;
}

const toPoints = (obs: IdxObs[]): SeriesPoint[] => obs.map((o) => ({ date: o.date, value: o.value }));

/** The indices as world series (chartable, testable); a missing one carries its reason. */
export function stressWorldSeries(p: StressPulls | null | undefined): Array<Series | SeriesMissing> {
  const out: Array<Series | SeriesMissing> = STRESS_INDICES.map((s) => {
    const id = `stress_${s.key}`;
    const obs = p?.fred[s.fred];
    if (!obs?.length) return { id, label: s.label, reason: p ? `FRED gave no observations for ${s.fred}` : 'FRED has not answered yet' };
    return { id, label: s.label, unit: 'index', freq: 'weekly' as const, source: `${s.label} (${s.fred}), retrieved from FRED, Federal Reserve Bank of St. Louis`, pulledAt: p!.fetchedAt, points: toPoints(obs), about: s.about };
  });
  const g = p?.gscpi;
  if (g && 'obs' in g) {
    out.push({ id: 'gscpi', label: 'NY Fed Global Supply Chain Pressure Index', unit: 'std dev', freq: 'monthly', source: GSCPI_SOURCE, pulledAt: g.fetchedAt, points: toPoints(g.obs).map((x) => ({ ...x, date: x.date.slice(0, 7) })), about: 'Monthly, from data on the transportation and manufacturing sectors (NY Fed). Zero = average pressure; values are standard deviations from the average.' });
  } else out.push({ id: 'gscpi', label: 'NY Fed Global Supply Chain Pressure Index', reason: g && 'reason' in g ? g.reason : 'The New York Fed file has not answered yet' });
  return out;
}

/** The GSCPI from the downloaded bytes: .xls (OLE2), .xlsx (zip) or CSV text, whichever it is. */
export async function gscpiFromBytes(buf: Uint8Array, now = new Date()): Promise<{ obs: IdxObs[]; fetchedAt: string } | { reason: string }> {
  const best = (sheets: string[][][]) => sheets.map(parseGscpiRows).reduce((a, b) => (b.length > a.length ? b : a), [] as IdxObs[]);
  let obs: IdxObs[] = [];
  let kind = 'CSV';
  try {
    if (isOleFile(buf)) {
      kind = '.xls workbook';
      obs = best(readXlsSheets(buf) || []);
    } else if (buf[0] === 0x50 && buf[1] === 0x4b) {
      kind = '.xlsx workbook';
      const sheets: string[][][] = [];
      for (const name of await xlsxSheetNames(buf)) {
        const rows = await readXlsxSheet(buf, name);
        if (rows) sheets.push(rows);
      }
      obs = best(sheets);
    } else obs = parseGscpiRows(csvRows(new TextDecoder().decode(buf)));
  } catch {
    return { reason: `The New York Fed GSCPI file (${kind}) could not be read` };
  }
  if (obs.length) return { obs, fetchedAt: now.toISOString() };
  const layout = isOleFile(buf) ? ` (layout: ${describeXls(buf).slice(0, 400)})` : '';
  return { reason: `The New York Fed GSCPI file (${kind}) had no sheet with a date column and index values${layout}` };
}
