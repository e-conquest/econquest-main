/**
 * US data as it was known at the time (gap analysis D9), from ALFRED, the St. Louis Fed's archive of
 * past FRED vintages, read through the FRED API with the user's own key (Menu > Settings > API keys).
 *
 * The app's US figures are today's revised numbers, so an "as of" read or a backtest for the US used
 * data nobody had at the time; the IMF figures already have real-time editions (weoVintages.ts).
 * ALFRED keeps every published value with the period it was current (realtime_start to
 * realtime_end), so each figure can be read as first published, as known on a date, or across all
 * its revisions.
 *
 *   GDPC1     real GDP, quarterly, billions of chained dollars -> growth, % q/q annualised
 *   CPIAUCSL  CPI for all urban consumers, monthly, index        -> inflation, % y/y
 *   UNRATE    unemployment rate, monthly, %                       -> as published
 *
 * Growth and inflation are computed inside one vintage (this period and the earlier one as the same
 * release stood), never across vintages, because a new base year changes the GDP level.
 *
 * Browser-safe, pure.
 */

export interface AlfredRow {
  /** Observation period (YYYY-MM-DD, first day of the month or quarter). */
  date: string;
  value: number;
  /** First and last day this value was the published one (9999-12-31 = still current). */
  from: string;
  to: string;
}

export interface AlfredSeries {
  id: string;
  rows: AlfredRow[];
}

export interface AlfredDef {
  id: string;
  label: string;
  unit: string;
  transform: 'qoq_ann' | 'yoy' | 'level';
  freq: 'quarterly' | 'monthly';
}

export const ALFRED_SERIES: AlfredDef[] = [
  { id: 'GDPC1', label: 'US real GDP growth (% q/q annualised)', unit: '% q/q ann.', transform: 'qoq_ann', freq: 'quarterly' },
  { id: 'CPIAUCSL', label: 'US CPI inflation (% y/y)', unit: '% y/y', transform: 'yoy', freq: 'monthly' },
  { id: 'UNRATE', label: 'US unemployment rate (%)', unit: '%', transform: 'level', freq: 'monthly' },
];

export const ALFRED_SOURCE = 'ALFRED (ArchivaL Federal Reserve Economic Data), Federal Reserve Bank of St. Louis, through the FRED API';

export function alfredUrl(seriesId: string, apiKey: string, observationStart: string): string {
  const q = new URLSearchParams({ series_id: seriesId, api_key: apiKey, file_type: 'json', realtime_start: '1776-07-04', realtime_end: '9999-12-31', observation_start: observationStart });
  return `https://api.stlouisfed.org/fred/series/observations?${q.toString()}`;
}

/** FRED API real-time observations into rows; "." values and bad dates are skipped. */
export function parseAlfred(json: unknown): AlfredRow[] {
  const obs = (json as { observations?: Array<Record<string, unknown>> })?.observations;
  if (!Array.isArray(obs)) return [];
  const ok = (d: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(d ?? ''));
  const out: AlfredRow[] = [];
  for (const o of obs) {
    const raw = String(o.value ?? '').trim();
    const value = Number(raw);
    if (!ok(o.date) || !ok(o.realtime_start) || !ok(o.realtime_end) || raw === '' || raw === '.' || !Number.isFinite(value)) continue;
    out.push({ date: String(o.date), value, from: String(o.realtime_start), to: String(o.realtime_end) });
  }
  return out.sort((a, b) => (a.date === b.date ? (a.from < b.from ? -1 : 1) : a.date < b.date ? -1 : 1));
}

const shift = (date: string, months: number) => {
  const [y, m] = date.split('-').map(Number);
  const t = y * 12 + (m - 1) + months;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`;
};

/** The raw value of a period as published on `day`, or undefined if not yet out (or dropped). */
export function rawOn(rows: AlfredRow[], date: string, day: string): number | undefined {
  return rows.find((r) => r.date === date && r.from <= day && day <= r.to)?.value;
}

/** The figure (after the transform) of a period as published on `day`. */
export function figureOn(def: AlfredDef, rows: AlfredRow[], date: string, day: string): number | undefined {
  const v = rawOn(rows, date, day);
  if (v === undefined) return undefined;
  if (def.transform === 'level') return v;
  const back = def.transform === 'yoy' ? 12 : 3;
  const p = rawOn(rows, shift(date, -back), day);
  if (p === undefined || p === 0) return undefined;
  const r = def.transform === 'yoy' ? (v / p - 1) * 100 : (Math.pow(v / p, 4) - 1) * 100;
  return Number(r.toFixed(2));
}

/** Every release of a period's figure: the days a new value came out and the figure from then. */
export function releasesOf(def: AlfredDef, rows: AlfredRow[], date: string): Array<{ day: string; value: number }> {
  const back = def.transform === 'yoy' ? 12 : def.transform === 'qoq_ann' ? 3 : 0;
  const days = new Set<string>();
  for (const r of rows) if (r.date === date || (back && r.date === shift(date, -back))) days.add(r.from);
  const out: Array<{ day: string; value: number }> = [];
  for (const day of [...days].sort()) {
    const v = figureOn(def, rows, date, day);
    if (v === undefined) continue;
    if (!out.length || out[out.length - 1].value !== v) out.push({ day, value: v });
  }
  return out;
}

/** Periods any vintage holds, oldest first. */
export function periodsOf(rows: AlfredRow[]): string[] {
  return [...new Set(rows.map((r) => r.date))].sort();
}

export const periodLabel = (def: AlfredDef, date: string) => {
  const [y, m] = date.split('-').map(Number);
  return def.freq === 'quarterly' ? `${y} Q${Math.floor((m - 1) / 3) + 1}` : `${y}-${String(m).padStart(2, '0')}`;
};

export interface AlfredReply {
  ok: boolean;
  reason?: string;
  series: string;
  label?: string;
  unit?: string;
  periods?: string[];
  period?: string;
  periodLabel?: string;
  releases?: Array<{ day: string; value: number }>;
  asOf?: { day: string; value: number | null };
  sentence?: string;
  source: string;
}

/** What the panel shows: every release of one period, and its value as known on a chosen day. */
export function alfredReply(def: AlfredDef, s: AlfredSeries | null, period?: string, asOfDay?: string): AlfredReply {
  if (!s || !s.rows.length) return { ok: false, series: def.id, reason: 'No ALFRED vintages for this series yet', source: ALFRED_SOURCE };
  const all = periodsOf(s.rows);
  // Periods with a figure (growth and inflation need the earlier period too).
  const usable = all.filter((d) => releasesOf(def, s.rows, d).length);
  const pick = period && usable.includes(period) ? period : usable[usable.length - 1];
  if (!pick) return { ok: false, series: def.id, reason: 'ALFRED answered, but no period has a figure yet', source: ALFRED_SOURCE };
  const releases = releasesOf(def, s.rows, pick);
  const label = periodLabel(def, pick);
  let sentence: string | undefined;
  if (releases.length >= 2) {
    const a = releases[0];
    const b = releases[releases.length - 1];
    const d = Number((b.value - a.value).toFixed(2));
    sentence = `${def.label.replace(/ \(.*\)$/, '')} for ${label} was first published on ${a.day} at ${a.value}; the latest figure (${b.day}) is ${b.value}, ${d === 0 ? 'unchanged' : `${d > 0 ? 'up' : 'down'} ${Math.abs(d)}`} after ${releases.length - 1} revision${releases.length > 2 ? 's' : ''}.`;
  } else if (releases.length === 1) sentence = `${def.label.replace(/ \(.*\)$/, '')} for ${label}: ${releases[0].value}, published ${releases[0].day}, not revised since.`;
  const day = asOfDay && /^\d{4}-\d{2}-\d{2}$/.test(asOfDay) ? asOfDay : undefined;
  return {
    ok: true,
    series: def.id,
    label: def.label,
    unit: def.unit,
    periods: usable,
    period: pick,
    periodLabel: label,
    releases,
    ...(day ? { asOf: { day, value: figureOn(def, s.rows, pick, day) ?? null } } : {}),
    ...(sentence ? { sentence } : {}),
    source: ALFRED_SOURCE,
  };
}
