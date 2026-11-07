/**
 * "As of" view: the figures the app held for a country on a past day, read from the pull archive
 * (data/archive/), beside today's. Each side keeps its own source and period; a figure missing on
 * either side says Missing and why, and no change is worked out across a missing value.
 *
 * Browser-safe; the server reads the archive and calls asOfRows.
 */
import { FIGURES_HEADER } from './csvExport';

type Cell = string | number | null | undefined;

export interface AsOfSide {
  value: number | null;
  status: 'Live' | 'Missing';
  period: string;
  source: string;
  reason: string;
}

export interface AsOfRow {
  field: string;
  figure: string;
  unit: string;
  then: AsOfSide;
  now: AsOfSide;
  /** Now minus then, in the figure's unit; only when both sides are live. */
  change: number | null;
}

const col = (name: string) => FIGURES_HEADER.indexOf(name);
const C = { field: col('field'), figure: col('figure'), value: col('value'), unit: col('unit'), status: col('status'), period: col('period'), source: col('source'), reason: col('reason_if_missing') };

function side(r: Cell[] | undefined): AsOfSide {
  if (!r) return { value: null, status: 'Missing', period: '', source: '', reason: 'not in this pull' };
  const v = r[C.value];
  const live = r[C.status] === 'Live' && typeof v === 'number' && Number.isFinite(v);
  return {
    value: live ? (v as number) : null,
    status: live ? 'Live' : 'Missing',
    period: String(r[C.period] ?? ''),
    source: String(r[C.source] ?? ''),
    reason: live ? '' : String(r[C.reason] ?? '') || 'not in this pull',
  };
}

/** Pair figure rows (csvExport.figureRows) from a past pull and from today, in today's order. */
export function asOfRows(thenRows: Cell[][], nowRows: Cell[][]): AsOfRow[] {
  const byField = new Map(thenRows.map((r) => [String(r[C.field]), r]));
  return nowRows.map((r) => {
    const then = side(byField.get(String(r[C.field])));
    const now = side(r);
    return {
      field: String(r[C.field]),
      figure: String(r[C.figure]),
      unit: String(r[C.unit]),
      then,
      now,
      change: then.value !== null && now.value !== null ? Number((now.value - then.value).toFixed(4)) : null,
    };
  });
}

/** A YYYY-MM-DD date, or null. */
export function parseAsOfDate(v: unknown): string | null {
  const s = String(v ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}
