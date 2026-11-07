/**
 * Downloads for research use: CSV files that keep, for every value, its unit, source and dates,
 * and for every missing value the word "Missing" and the reason. Files start with a UTF-8 byte
 * order mark so Excel opens them with accents intact.
 *
 * Browser-safe; the server builds the files and the browser only links to them.
 */
import type { OpenDataSnapshot } from '../types/council';
import { getSnapshotDataStatus } from './dataStatus';
import { pathMissing } from './countryNotes';
import { ARCHIVE_FIGURES, snapshotValue, type Series } from './seriesHistory';
import { licenceLabelForSource } from './licenceLookup';

export const CSV_BOM = '﻿';

type Cell = string | number | null | undefined;

/** One CSV cell: numbers as written, text quoted when it holds a comma, quote or line break. */
export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = String(v);
  // Cells that a spreadsheet would run as a formula are prefixed so they stay text.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return CSV_BOM + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Long format: one row per observation, every row self-describing. */
export const SERIES_HEADER = ['iso3', 'series_id', 'series', 'unit', 'frequency', 'date', 'value', 'source', 'source_that_day', 'pulled_at'];

export function seriesRows(iso3: string, series: Series[]): Cell[][] {
  const rows: Cell[][] = [];
  for (const s of series) {
    for (const p of s.points) {
      rows.push([iso3, s.id, s.label, s.unit, s.freq, p.date, p.value, s.source, p.note ?? '', s.pulledAt ?? '']);
    }
  }
  return rows;
}

/** `licence` is the strictest licence class among the sources the figure names (src/utils/licenceLookup.ts). */
export const FIGURES_HEADER = ['iso3', 'country', 'field', 'figure', 'value', 'unit', 'status', 'period', 'source', 'reason_if_missing', 'snapshot_pulled_at', 'licence'];

/** Figures the country pages show, each with its value or why it is missing. */
export const FIGURE_LIST: Array<{ field: string; label: string; unit: string }> = [
  ...ARCHIVE_FIGURES.map((f) => ({ field: f.field, label: f.label, unit: f.unit })),
  { field: 'market.hcBondSpreadBps', label: 'USD bond spread over US Treasuries (not CDS)', unit: 'bp' },
  { field: 'imf.debtToGdpForecast2027Pct', label: 'Government debt, 2027 forecast', unit: '% of GDP' },
  { field: 'market.policyRatePct', label: 'Policy rate', unit: '%' },
];

function periodFor(snapshot: OpenDataSnapshot, field: string): string {
  if (field === 'market.sovereign10YBondYieldPct') return snapshot.official10YYield?.period ?? '';
  if (field === 'market.cds5YSpreadBps') return snapshot.ownCds5Y?.date ?? '';
  if (field === 'market.hcBondSpreadBps') return snapshot.hcBondSpread?.period ?? '';
  if (field === 'market.policyRatePct') return snapshot.bisPolicyRate?.date ?? '';
  const years = (snapshot.imfIndicators as { years?: Record<string, string> })?.years;
  return years?.[field] ?? '';
}

export function figureRows(snapshot: OpenDataSnapshot): Cell[][] {
  const status = getSnapshotDataStatus(snapshot);
  const live = snapshot.liveFields || {};
  const pulledAt = snapshot.fetchedAt ?? '';
  return FIGURE_LIST.map((f) => {
    const src = live[f.field];
    const v = src ? snapshotValue(snapshot as unknown as Record<string, unknown>, f.field) : undefined;
    if (src && v !== undefined) {
      return [snapshot.iso3, snapshot.countryName, f.field, f.label, v, f.unit, 'Live', periodFor(snapshot, f.field), src, '', pulledAt, licenceLabelForSource(src)];
    }
    const why = pathMissing(status, f.field);
    return [snapshot.iso3, snapshot.countryName, f.field, f.label, null, f.unit, 'Missing', '', '', why.short, pulledAt, ''];
  });
}

/** File name with the country and today's date, e.g. "BRA-series-2026-11-05.csv". */
export function exportFileName(iso3: string, what: string, now = new Date()): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '');
  return `${clean(iso3)}-${clean(what)}-${now.toISOString().slice(0, 10)}.csv`;
}
