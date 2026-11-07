import type { WatchlistItem } from '../../src/types/council.ts';

/**
 * Test figures for watchlist rows. The app ships no built-in figures (catalogue numbers are NaN),
 * so tests that need numbers on a row take them from here.
 */
const ROWS: Record<string, Partial<WatchlistItem>> = {
  BRA: { yield10YPct: 12.85, cds5YBps: 168, debtToGdpPct: 86.4, fxReservesMonths: 14.2 },
  TUR: { yield10YPct: 28.4, cds5YBps: 264, debtToGdpPct: 31.8, fxReservesMonths: 4.1 },
  EGY: { yield10YPct: 24.1, cds5YBps: 540, debtToGdpPct: 90.2, fxReservesMonths: 3.4 },
  ZAF: { yield10YPct: 10.45, cds5YBps: 205, debtToGdpPct: 75.8, fxReservesMonths: 5.3 },
  MEX: { yield10YPct: 9.95, cds5YBps: 132, debtToGdpPct: 54.6, fxReservesMonths: 4.6 },
  IDN: { yield10YPct: 6.75, cds5YBps: 74, debtToGdpPct: 39.6, fxReservesMonths: 6.2 },
  JPN: { yield10YPct: 1.18, cds5YBps: 24, debtToGdpPct: 251.2, fxReservesMonths: 15.8 },
  GBR: { yield10YPct: 4.42, cds5YBps: 31, debtToGdpPct: 101.4, fxReservesMonths: 3.1 },
  POL: { yield10YPct: 5.45, cds5YBps: 72, debtToGdpPct: 58.2, fxReservesMonths: 7.4 },
  CHL: { yield10YPct: 5.6, cds5YBps: 64, debtToGdpPct: 42.1, fxReservesMonths: 5.8 },
};

export function withTestFigures(rows: WatchlistItem[]): WatchlistItem[] {
  return rows.map((r) => ({ ...r, ...(ROWS[r.iso3] || {}) }));
}
