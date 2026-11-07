/**
 * Sovereign default history (gap analysis D7) from the Bank of Canada and Bank of England Sovereign
 * Default Database (BoC-BoE), free, no key, read from the Bank of Canada Valet API as CSV.
 *
 * Group DEBT_<edition> (2026 edition: 1960 to 2025, released October 2026). One row per country
 * and year, keyed "<ISO3>_<year>" (World rows "WORLD_<year>"), with the stock of government
 * obligations in default by creditor: IMF, IBRD, IDA, IADB, Paris Club, China, other official
 * creditors, foreign-currency bank loans, foreign-currency bonds, other private creditors, local
 * currency debt. A year with no default has a row with empty values, which the app reads as zero
 * (not in default) inside the years the edition covers.
 *
 * Units: US$ millions. The file states no unit; it was pinned on 2026-11-07 from the World rows
 * against the 2026 paper (Staff Analytical Paper 2026-48): WORLD_2025 total 437196.80 = "US$437
 * billion in 2025", WORLD_2024 507347.14 = "US$507 billion in 2024", foreign-currency bonds
 * 197233.00 = "US$197.2 billion", local currency debt 474.00 = "US$474 million".
 *
 * Terms: Bank of Canada Terms of Use (free use with attribution and a note of changes; the Bank
 * gives no permission for third-party content inside it unless it says so). The database draws on
 * published sources, so the licence row carries that open question. The Valet host does not answer
 * from this project's cloud session; the parser is tested on rows copied from the live file.
 *
 * Browser-safe, pure.
 */
import { splitCsvLine } from './bisDebtSecurities';
import type { Series, SeriesMissing, SeriesPoint } from './seriesHistory';

export const BOC_BOE_FIRST_EDITION = 2026;

export function bocBoeUrl(edition: number): string {
  return `https://www.bankofcanada.ca/valet/observations/group/DEBT_${edition}/csv`;
}

/** Editions to try, newest first: this year's (released each October) back to the 2026 edition. */
export function bocBoeEditions(now = new Date()): number[] {
  const out: number[] = [];
  for (let y = now.getUTCFullYear(); y >= BOC_BOE_FIRST_EDITION; y--) out.push(y);
  return out;
}

/** Creditor columns the app reads, by series name without the edition suffix. */
export const DEFAULT_COLUMNS = ['TOTAL', 'IMF', 'PARIS_CLUB', 'CHINA', 'FC_BANK_LOANS', 'FC_BONDS', 'LC_DEBT'] as const;
type Col = (typeof DEFAULT_COLUMNS)[number];

export interface SovereignDefaults {
  fetchedAt: string;
  edition: number;
  /** First and last year in the edition. */
  span: { from: number; to: number };
  /** ISO3 -> year -> column -> US$ m (0 when the row is empty). */
  countries: Record<string, Record<string, Partial<Record<Col, number>>>>;
}

/** Valet CSV -> the table, or null when the observations block is not found. */
export function parseBocBoeCsv(text: unknown, edition: number, fetchedAt: string): SovereignDefaults | null {
  if (typeof text !== 'string') return null;
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const at = lines.findIndex((l) => /^"?k"?,/.test(l.trim()));
  if (at < 0) return null;
  const head = splitCsvLine(lines[at]).map((h) => h.trim());
  const idx = (name: string) => head.indexOf(name);
  const iYear = idx('DEBT_YEAR');
  const cols = DEFAULT_COLUMNS.map((c) => [c, idx(`DEBT_${c}_${edition}`)] as const);
  if (iYear < 0 || cols.find(([c]) => c === 'TOTAL')![1] < 0) return null;
  const countries: SovereignDefaults['countries'] = {};
  let from = Infinity;
  let to = -Infinity;
  for (const l of lines.slice(at + 1)) {
    if (!l.trim()) continue;
    const cells = splitCsvLine(l);
    const m = String(cells[0] ?? '').match(/^([A-Z]{3})_(\d{4})$/);
    if (!m) continue; // World and group rows, or anything unreadable
    const year = Number(m[2]);
    if (String(cells[iYear]) !== m[2]) continue;
    from = Math.min(from, year);
    to = Math.max(to, year);
    const row: Partial<Record<Col, number>> = {};
    for (const [c, i] of cols) {
      if (i < 0) continue;
      const raw = String(cells[i] ?? '').trim();
      const v = raw === '' ? 0 : Number(raw);
      if (Number.isFinite(v) && v >= 0) row[c] = Number(v.toFixed(2));
    }
    (countries[m[1]] ||= {})[m[2]] = row;
  }
  if (!Number.isFinite(from)) return null;
  return { fetchedAt, edition, span: { from, to }, countries };
}

const SRC = 'BoC-BoE Sovereign Default Database';
const ABOUT = (what: string) =>
  `Bank of Canada and Bank of England Sovereign Default Database: government obligations in default at year end, ${what}, US$ millions at the time. Zero means the database records no default that year. Covers defaults on official and private debt, including arrears and restructured debt still being settled.`;

const DEFS: Array<{ id: string; col: Col; label: string; about: string }> = [
  { id: 'default_total_usd', col: 'TOTAL', label: 'Government debt in default', about: ABOUT('all creditors') },
  { id: 'default_fc_bonds_usd', col: 'FC_BONDS', label: 'In default: foreign-currency bonds', about: ABOUT('owed to holders of foreign-currency bonds') },
  { id: 'default_fc_banks_usd', col: 'FC_BANK_LOANS', label: 'In default: foreign-currency bank loans', about: ABOUT('owed to commercial banks in foreign currency') },
  { id: 'default_paris_club_usd', col: 'PARIS_CLUB', label: 'In default: Paris Club governments', about: ABOUT('owed to Paris Club creditor governments') },
  { id: 'default_china_usd', col: 'CHINA', label: 'In default: China', about: ABOUT('owed to Chinese official lenders') },
  { id: 'default_imf_usd', col: 'IMF', label: 'In default: IMF', about: ABOUT('owed to the IMF (arrears)') },
  { id: 'default_lc_usd', col: 'LC_DEBT', label: 'In default: local-currency debt', about: ABOUT('on local-currency debt') },
];

/** Default amounts by creditor, yearly; Missing with the reason when the database has not answered or lacks the country. */
export function sovereignDefaultSeries(iso3: string, d: SovereignDefaults | null | undefined): Array<Series | SeriesMissing> {
  const rows = d?.countries[String(iso3 || '').toUpperCase()];
  return DEFS.map((def) => {
    if (!d) return { id: def.id, label: def.label, reason: 'The Bank of Canada default database has not answered yet' };
    if (!rows) return { id: def.id, label: def.label, reason: `Not in the BoC-BoE Sovereign Default Database (${d.edition} edition)` };
    const points: SeriesPoint[] = Object.entries(rows)
      .filter(([, r]) => r[def.col] !== undefined)
      .map(([date, r]) => ({ date, value: r[def.col]! }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!points.length) return { id: def.id, label: def.label, reason: `The ${d.edition} edition has no ${def.label.toLowerCase()} column` };
    const about = def.col === 'TOTAL' ? `${def.about} ${defaultSpellsSentence(defaultSpells(iso3, d), d.edition)}` : def.about;
    return { id: def.id, label: def.label, unit: 'USD m', freq: 'annual' as const, source: `${SRC}, ${d.edition} edition`, pulledAt: d.fetchedAt, points, about };
  });
}

/** Default spells: runs of years with any amount in default. For outcome scoring (D7) and the history line. */
export function defaultSpells(iso3: string, d: SovereignDefaults | null | undefined): Array<{ from: number; to: number; peakUsdM: number }> {
  const rows = d?.countries[String(iso3 || '').toUpperCase()];
  if (!rows) return [];
  const years = Object.keys(rows).map(Number).sort((a, b) => a - b);
  const out: Array<{ from: number; to: number; peakUsdM: number }> = [];
  for (const y of years) {
    const v = rows[String(y)].TOTAL ?? 0;
    if (v <= 0) continue;
    const last = out[out.length - 1];
    if (last && last.to === y - 1) {
      last.to = y;
      last.peakUsdM = Math.max(last.peakUsdM, v);
    } else out.push({ from: y, to: y, peakUsdM: v });
  }
  return out;
}

export function defaultSpellsSentence(spells: ReturnType<typeof defaultSpells>, edition?: number): string {
  if (!spells.length) return `No default recorded in the BoC-BoE database${edition ? ` (${edition} edition, from 1960)` : ''}.`;
  return `In default in ${spells.map((s) => (s.from === s.to ? `${s.from}` : `${s.from}-${s.to}`)).join(', ')} (BoC-BoE database${edition ? `, ${edition} edition` : ''}).`;
}
