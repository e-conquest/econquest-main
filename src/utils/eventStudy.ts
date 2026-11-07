/**
 * Event study: how a country's currency has moved around policy rate decisions, its own central
 * bank's and the Federal Reserve's, in the days before and after.
 *
 * Events: every day the BIS daily policy rate series changes (the date the new rate takes effect),
 * split into hikes and cuts. A change within `minGapDays` business days of the previous event of
 * the same bank is dropped, so overlapping windows do not count one episode twice.
 *
 * Path: the currency's cumulative move from the last ECB business day before the event (day -1) to
 * each day from -`before` to +`after` (ECB business days), as 100 x ln(S(t) / S(-1)), S = units per
 * US dollar, so up = weaker currency. Shown: the average path for hikes and for cuts, with a 90%
 * band from resampling the events (bootstrap, fixed seed), and the number of events.
 *
 * Description of the past, not a tested signal: rate decisions are often expected, so the move on
 * the day is the surprise part only, and the average mixes very different episodes.
 *
 * Browser-safe, pure.
 */
import { seededRandom } from './backtest';

export const EVENT_BEFORE = 10;
export const EVENT_AFTER = 20;
export const EVENT_MIN_GAP_DAYS = 10;
export const EVENT_MIN_EVENTS = 5;
export const EVENT_RESAMPLES = 2000;
export const EVENT_SEED = 20261106;

export interface RateEvent {
  date: string;
  /** Change in points. */
  change: number;
  from: number;
  to: number;
}

export interface EventPathStep {
  day: number;
  mean: number;
  lo: number;
  hi: number;
}

export interface EventGroup {
  kind: 'hike' | 'cut';
  ok: boolean;
  reason?: string;
  n: number;
  steps: EventPathStep[];
  /** Mean move from day -1 to day +after, and to day 0. */
  dayZero?: number;
  end?: number;
  events: RateEvent[];
}

export interface EventStudy {
  bank: 'own' | 'fed';
  groups: EventGroup[];
  from?: string;
  to?: string;
}

/** Days the daily rate changes, oldest first, with close repeats dropped. */
export function rateEvents(points: Array<{ period: string; pct: number }>, minGapDays = EVENT_MIN_GAP_DAYS): RateEvent[] {
  const pts = [...points].filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.period) && Number.isFinite(p.pct)).sort((a, b) => (a.period < b.period ? -1 : 1));
  const out: RateEvent[] = [];
  let lastIdx = -Infinity;
  for (let i = 1; i < pts.length; i++) {
    const ch = Number((pts[i].pct - pts[i - 1].pct).toFixed(4));
    if (!ch) continue;
    if (i - lastIdx < minGapDays) continue;
    out.push({ date: pts[i].period, change: ch, from: pts[i - 1].pct, to: pts[i].pct });
    lastIdx = i;
  }
  return out;
}

const r2 = (v: number) => Number(v.toFixed(2));

/** Cumulative path of one event, or null when the window is not fully covered by FX days. */
export function eventPath(fxDays: string[], fxVal: Map<string, number>, date: string, before = EVENT_BEFORE, after = EVENT_AFTER): number[] | null {
  // Day 0 = first FX business day on or after the event date; day -1 = the one before.
  let lo = 0;
  let hi = fxDays.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fxDays[mid] < date) lo = mid + 1;
    else hi = mid;
  }
  const i0 = lo;
  if (i0 - before < 0 || i0 - 1 < 0 || i0 + after >= fxDays.length) return null;
  const base = fxVal.get(fxDays[i0 - 1])!;
  const out: number[] = [];
  for (let d = -before; d <= after; d++) out.push(100 * Math.log(fxVal.get(fxDays[i0 + d])! / base));
  return out;
}

export function eventStudy(
  bank: 'own' | 'fed',
  policyDaily: Array<{ period: string; pct: number }>,
  fx: Array<{ date: string; value: number }>,
  opts: { before?: number; after?: number; minEvents?: number; resamples?: number; seed?: number } = {},
): EventStudy {
  const before = opts.before ?? EVENT_BEFORE;
  const after = opts.after ?? EVENT_AFTER;
  const sorted = [...fx].filter((p) => p.value > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  const days = sorted.map((p) => p.date);
  const val = new Map(sorted.map((p) => [p.date, p.value]));
  const events = rateEvents(policyDaily);
  const groups: EventGroup[] = (['hike', 'cut'] as const).map((kind) => {
    const evs = events.filter((e) => (kind === 'hike' ? e.change > 0 : e.change < 0));
    const paths: number[][] = [];
    const used: RateEvent[] = [];
    for (const e of evs) {
      const p = eventPath(days, val, e.date, before, after);
      if (p) {
        paths.push(p);
        used.push(e);
      }
    }
    const min = opts.minEvents ?? EVENT_MIN_EVENTS;
    if (paths.length < min) return { kind, ok: false, reason: `${paths.length} ${kind}${paths.length === 1 ? '' : 's'} with a full window of exchange rate days; needs ${min}`, n: paths.length, steps: [], events: used };
    const L = before + after + 1;
    const mean = Array.from({ length: L }, (_, k) => paths.reduce((a, p) => a + p[k], 0) / paths.length);
    const rand = seededRandom(opts.seed ?? EVENT_SEED);
    const R = opts.resamples ?? EVENT_RESAMPLES;
    const draws: number[][] = Array.from({ length: L }, () => []);
    for (let r = 0; r < R; r++) {
      const acc = new Array(L).fill(0);
      for (let j = 0; j < paths.length; j++) {
        const p = paths[Math.floor(rand() * paths.length)];
        for (let k = 0; k < L; k++) acc[k] += p[k];
      }
      for (let k = 0; k < L; k++) draws[k].push(acc[k] / paths.length);
    }
    const q = (v: number[], p: number) => {
      const s = [...v].sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.floor(p * s.length))];
    };
    const steps = mean.map((m, k) => ({ day: k - before, mean: r2(m), lo: r2(q(draws[k], 0.05)), hi: r2(q(draws[k], 0.95)) }));
    return { kind, ok: true, n: paths.length, steps, dayZero: r2(mean[before]), end: r2(mean[L - 1]), events: used };
  });
  const allUsed = groups.flatMap((g) => g.events).map((e) => e.date).sort();
  return { bank, groups, ...(allUsed.length ? { from: allUsed[0], to: allUsed[allUsed.length - 1] } : {}) };
}

export function eventSentence(name: string, s: EventStudy): string {
  const who = s.bank === 'own' ? "its central bank's" : 'Federal Reserve';
  const parts = s.groups
    .filter((g) => g.ok)
    .map((g) => `after ${g.n} ${g.kind}s the currency was on average ${Math.abs(g.end!).toFixed(1)}% ${g.end! >= 0 ? 'weaker' : 'stronger'} ${EVENT_AFTER} business days later (${g.dayZero! >= 0 ? '+' : ''}${g.dayZero!.toFixed(2)}% on the day)`);
  return parts.length ? `${name}, around ${who} rate changes: ${parts.join('; ')}.` : `${name}: too few ${who} rate changes with exchange rate data for an event study.`;
}

export const EVENT_METHOD = `Events: days the BIS daily policy rate changed (a change within ${EVENT_MIN_GAP_DAYS} daily observations of the last one is dropped). Path: 100 x log change of units per US dollar from the ECB business day before (up = weaker currency), ${EVENT_BEFORE} days before to ${EVENT_AFTER} after; average with a 90% band from resampling the events (fixed seed). Description of the past, not a tested signal.`;
