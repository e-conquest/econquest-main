/**
 * Historical context for one series (seven-groups plan, Phase 5, journalists): puts the latest
 * figure in its own history the way a news story would ("highest since 1998"), with where it sits
 * among all observations and the change on a year earlier.
 *
 * Only real observations count: IMF projections are left out, and nothing is filled in. Ties count
 * as "since" the earlier date at the same or a more extreme level.
 *
 * Description, not a tested signal. Browser-safe, pure.
 */
import type { SeriesFreq, SeriesPoint } from './seriesHistory';

export interface HistoricalContext {
  date: string;
  value: number;
  observations: number;
  first: string;
  /** "highest" / "lowest" on record, or since a date, or neither (in the middle). */
  record: { kind: 'highest' | 'lowest'; since: string | null } | null;
  /** % of observations at or below the latest. */
  percentile: number;
  /** Change against the observation a year earlier, when there is one. */
  yearAgo?: { date: string; value: number; change: number };
}

/** The date one year before, in the same form (YYYY, YYYY-Qn, YYYY-MM, YYYY-MM-DD). */
export function yearBefore(date: string): string {
  const y = Number(date.slice(0, 4));
  return `${y - 1}${date.slice(4)}`;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function historicalContext(points: SeriesPoint[], freq: SeriesFreq): HistoricalContext | null {
  const real = points.filter((p) => Number.isFinite(p.value) && p.note !== 'IMF projection').sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (real.length < 2) return null;
  const last = real[real.length - 1];
  const earlier = real.slice(0, -1);
  let record: HistoricalContext['record'] = null;
  const maxPrev = Math.max(...earlier.map((p) => p.value));
  const minPrev = Math.min(...earlier.map((p) => p.value));
  if (last.value > maxPrev) record = { kind: 'highest', since: null };
  else if (last.value < minPrev) record = { kind: 'lowest', since: null };
  else {
    // The most recent earlier point at least as extreme: "highest since <its date>".
    const higher = [...earlier].reverse().find((p) => p.value >= last.value);
    const lower = [...earlier].reverse().find((p) => p.value <= last.value);
    // Pick whichever run is longer (the older "since" date), as a story would.
    if (higher && lower) record = higher.date < lower.date ? { kind: 'highest', since: higher.date } : { kind: 'lowest', since: lower.date };
  }
  // A "since" only a step or two back is not news.
  if (record?.since) {
    const idx = real.findIndex((p) => p.date === record!.since);
    if (real.length - 1 - idx < (freq === 'annual' ? 3 : freq === 'quarterly' ? 4 : freq === 'monthly' ? 12 : freq === 'weekly' ? 26 : freq === 'daily' ? 60 : 3)) record = null;
  }
  const back = yearBefore(last.date);
  const ya = freq === 'per pull' ? undefined : real.find((p) => p.date === back);
  return {
    date: last.date,
    value: last.value,
    observations: real.length,
    first: real[0].date,
    record,
    percentile: Math.round((100 * real.filter((p) => p.value <= last.value).length) / real.length),
    ...(ya ? { yearAgo: { date: ya.date, value: ya.value, change: r2(last.value - ya.value) } } : {}),
  };
}

export function contextSentence(label: string, unit: string | undefined, c: HistoricalContext): string {
  const u = unit?.startsWith('%') ? unit : unit ? ` ${unit}` : '';
  const pts = unit?.startsWith('%') ? ' points' : u;
  const rec = c.record ? (c.record.since ? `the ${c.record.kind} since ${c.record.since}` : `the ${c.record.kind} on record (since ${c.first})`) : null;
  const parts = [`${label} was ${r2(c.value)}${u} in ${c.date}`];
  if (rec) parts.push(rec);
  parts.push(`higher than or equal to ${c.percentile}% of the ${c.observations} observations since ${c.first}`);
  if (c.yearAgo) parts.push(`${c.yearAgo.change >= 0 ? 'up' : 'down'} ${Math.abs(c.yearAgo.change)}${pts} on ${c.yearAgo.date}`);
  return `${parts.join(', ')}.`;
}
