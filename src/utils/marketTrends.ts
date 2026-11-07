/**
 * Which way things are moving, from history the feeds already send (Sam, 2026-11-05).
 *
 * - 10Y yield: change against 3 and 12 calendar months earlier (OECD monthly average via FRED).
 *   Daily rates (Brazil's Tesouro Direto, Turkey's EVDS) carry no change here yet.
 * - Spread over US Treasuries: the country's 3-month change less the US 3-month change, only
 *   when both are monthly averages for the same month, so the two changes cover the same span.
 * - OECD leading indicator: its monthly change and phase.
 * - Policy rate: the latest move in the BIS monthly series.
 *
 * Every figure here is a change in a sourced series, not a forecast.
 */
import type { LiveWatchlistItem } from '../types/council';
import type { OfficialYieldObservation } from './officialYields';
import { formatPeriod } from './officialYields';
import { formatMonth } from './oecdSdmx';

export interface MarketTrend {
  yieldChg3mBps?: number;
  yieldChg12mBps?: number;
  spreadChg3mBps?: number;
  /** OECD leading indicator: level, monthly change, phase and month. */
  cli?: { level: number; change1m?: number; phase?: string; month: string };
  /** Latest policy move (BIS monthly series): change in points and the month. */
  policyMove?: { pts: number; period: string };
  /** Size of the 3-month yield move, for the "moving most" sort. Undefined without one. */
  moveScore?: number;
}

const bps = (pts: number) => Math.round(pts * 100);

type TrendInput = Pick<
  LiveWatchlistItem,
  'yield10YChange3mPts' | 'yield10YChange12mPts' | 'yield10YPeriod' | 'yield10YFrequency' | 'oecdCli' | 'policyRateLastMove'
>;

export function trendFor(it: TrendInput, us?: OfficialYieldObservation | null): MarketTrend {
  const t: MarketTrend = {};
  if (it.yield10YChange3mPts !== undefined) t.yieldChg3mBps = bps(it.yield10YChange3mPts);
  if (it.yield10YChange12mPts !== undefined) t.yieldChg12mBps = bps(it.yield10YChange12mPts);
  if (
    it.yield10YChange3mPts !== undefined &&
    us?.change3mPts !== undefined &&
    it.yield10YFrequency !== 'daily' &&
    us.frequency !== 'daily' &&
    it.yield10YPeriod === us.period
  )
    t.spreadChg3mBps = bps(it.yield10YChange3mPts - us.change3mPts);
  if (it.oecdCli) t.cli = { level: it.oecdCli.level, change1m: it.oecdCli.change1m, phase: it.oecdCli.phase, month: it.oecdCli.month };
  if (it.policyRateLastMove) t.policyMove = { pts: Number((it.policyRateLastMove.toPct - it.policyRateLastMove.fromPct).toFixed(2)), period: it.policyRateLastMove.period };
  if (t.yieldChg3mBps !== undefined) t.moveScore = Math.abs(t.yieldChg3mBps);
  return t;
}

/** Trend for a benchmark row that has only an official yield observation and a CLI reading. */
export function trendForObservation(y: OfficialYieldObservation | undefined, us?: OfficialYieldObservation | null, cli?: MarketTrend['cli'], isUs = false): MarketTrend {
  const t: MarketTrend = {};
  if (y?.change3mPts !== undefined) t.yieldChg3mBps = bps(y.change3mPts);
  if (y?.change12mPts !== undefined) t.yieldChg12mBps = bps(y.change12mPts);
  if (!isUs && y?.change3mPts !== undefined && us?.change3mPts !== undefined && y.period === us.period && y.frequency !== 'daily')
    t.spreadChg3mBps = bps(y.change3mPts - us.change3mPts);
  if (cli) t.cli = cli;
  if (t.yieldChg3mBps !== undefined) t.moveScore = Math.abs(t.yieldChg3mBps);
  return t;
}

export const signedBps = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} bps`;
export const signedPts = (v: number, d = 2) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`;

/** "+0.50 pts, Sep 2026" for the last policy move. */
export function policyMoveText(m: NonNullable<MarketTrend['policyMove']>): string {
  return `${signedPts(m.pts)} pts, ${formatPeriod(m.period)}`;
}

/** "Slowdown, −0.12 (Aug 2026)" for the leading indicator. */
export function cliTrendText(c: NonNullable<MarketTrend['cli']>): string {
  const phase = c.phase ? c.phase.replace(/^./, (x) => x.toUpperCase()) : `Level ${c.level.toFixed(2)}`;
  return `${phase}${c.change1m !== undefined ? `, ${signedPts(c.change1m)}` : ''} (${formatMonth(c.month)})`;
}

/** Rows sorted by the size of their 3-month yield move; rows without one go last, in their old order. */
export function byMovingMost<T>(rows: T[], trend: (r: T) => MarketTrend): T[] {
  return rows
    .map((r, i) => ({ r, i, s: trend(r).moveScore }))
    .sort((a, b) => (b.s ?? -1) - (a.s ?? -1) || a.i - b.i)
    .map((x) => x.r);
}
