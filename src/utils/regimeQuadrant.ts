/**
 * Growth and inflation quadrant: where each country sits on two directions read from live
 * monthly data. A stated rule for discussion, not a forecast.
 *
 *   growth axis    = change in the OECD composite leading indicator over 6 months (points)
 *   inflation axis = change in y/y inflation over 3 months (points), monthly series
 *
 * Each axis is called "up" above zero and "down" at or below it. A country without both figures
 * is not placed; it is listed with what is missing.
 *
 * Browser-safe.
 */
import type { WatchlistItem } from '../types/council';

export type Quadrant = 'growth up, inflation up' | 'growth up, inflation down' | 'growth down, inflation up' | 'growth down, inflation down';

export const QUADRANT_NOTE: Record<Quadrant, string> = {
  'growth up, inflation up': 'Recovery with prices picking up: pressure to tighten builds.',
  'growth up, inflation down': 'Growth improving while inflation eases: room to hold or ease.',
  'growth down, inflation up': 'Slowing growth with rising inflation: the hardest mix for policy.',
  'growth down, inflation down': 'Slowing growth and easing inflation: room to cut.',
};

export interface RegimePoint {
  iso3: string;
  countryName: string;
  growthPts: number;
  inflationPts: number;
  quadrant: Quadrant;
  cliMonth: string;
  cpiMonth: string;
  cpiSource: string;
}

export type RegimeResult = { ok: true; point: RegimePoint } | { ok: false; iso3: string; countryName: string; missing: string[] };

type Row = Pick<WatchlistItem, 'iso3' | 'countryName'> & Partial<Pick<WatchlistItem, 'oecdCli' | 'oecdCpi'>>;

export function quadrantFor(growthPts: number, inflationPts: number): Quadrant {
  const g = growthPts > 0 ? 'up' : 'down';
  const i = inflationPts > 0 ? 'up' : 'down';
  return `growth ${g}, inflation ${i}` as Quadrant;
}

export function regimeFor(row: Row): RegimeResult {
  const missing: string[] = [];
  const g = row.oecdCli?.change6m;
  const i = row.oecdCpi?.change3mPts;
  if (g === undefined || !Number.isFinite(g)) missing.push('a 6-month change in the OECD leading indicator');
  if (i === undefined || !Number.isFinite(i)) missing.push('a 3-month change in monthly inflation');
  if (missing.length) return { ok: false, iso3: row.iso3, countryName: row.countryName, missing };
  return {
    ok: true,
    point: {
      iso3: row.iso3,
      countryName: row.countryName,
      growthPts: g!,
      inflationPts: i!,
      quadrant: quadrantFor(g!, i!),
      cliMonth: row.oecdCli!.month,
      cpiMonth: row.oecdCpi!.month,
      cpiSource: row.oecdCpi!.long || row.oecdCpi!.short || (row.oecdCpi!.basis === 'national' ? 'national statistics' : 'OECD via DBnomics'),
    },
  };
}

export function regimeMap(rows: Row[]): { points: RegimePoint[]; missing: Array<{ iso3: string; countryName: string; missing: string[] }> } {
  const points: RegimePoint[] = [];
  const missing: Array<{ iso3: string; countryName: string; missing: string[] }> = [];
  for (const r of rows) {
    const res = regimeFor(r);
    if (res.ok) points.push(res.point);
    else missing.push({ iso3: res.iso3, countryName: res.countryName, missing: res.missing });
  }
  return { points, missing };
}
