/**
 * GDELT news tone over time. The tone timeline GDELT sends (one point per day, by default the last
 * three months) is read into the latest week's average and the average of the days before it, so a
 * change in how a country is being written about can be seen, not only its level.
 * A tone is GDELT's own average for matching articles; no tone per article is made up.
 */

export interface GdeltToneShift {
  /** Average tone of the latest 7 points. */
  recent: number;
  /** Average tone of the earlier points in the same reply. */
  earlier: number;
  /** recent - earlier. Negative = coverage turning more negative. */
  shift: number;
  /** Date span of the earlier window and of the latest week, YYYY-MM-DD. */
  earlierFrom?: string;
  recentTo?: string;
  /** How many earlier points the baseline averages. */
  earlierDays: number;
}

/** Points needed before the latest week for a baseline. */
export const GDELT_MIN_EARLIER_DAYS = 21;
/** A shift at least this large (tone points) is called a turn in coverage. */
export const GDELT_SHIFT_PTS = 1;

/** "20261104T000000Z" or "2026-11-04..." -> "2026-11-04". */
function day(v: unknown): string | undefined {
  const s = String(v ?? '');
  const m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

/** Latest-week tone and the shift against the earlier days of the same timeline. Null when too short. */
export function gdeltToneShift(series: unknown): GdeltToneShift | null {
  if (!Array.isArray(series)) return null;
  const pts = series
    // A point with no value (null or blank) is skipped: Number(null) would read it as a tone of 0.
    .filter((p: any) => p?.value !== null && p?.value !== undefined && String(p.value).trim() !== '')
    .map((p: any) => ({ date: day(p?.date), v: Number(p?.value) }))
    .filter((p) => Number.isFinite(p.v));
  if (pts.length < 7 + GDELT_MIN_EARLIER_DAYS) return null;
  const recent = pts.slice(-7);
  const earlier = pts.slice(0, -7);
  const avg = (a: { v: number }[]) => a.reduce((s, p) => s + p.v, 0) / a.length;
  const r = avg(recent);
  const e = avg(earlier);
  const r2 = (v: number) => Number(v.toFixed(2));
  return {
    recent: r2(r),
    earlier: r2(e),
    shift: r2(r - e),
    ...(earlier[0].date ? { earlierFrom: earlier[0].date } : {}),
    ...(recent[recent.length - 1].date ? { recentTo: recent[recent.length - 1].date } : {}),
    earlierDays: earlier.length,
  };
}

export type ToneTurn = 'turning more negative' | 'turning more positive' | 'steady';

export function toneTurn(shift: number): ToneTurn {
  return shift <= -GDELT_SHIFT_PTS ? 'turning more negative' : shift >= GDELT_SHIFT_PTS ? 'turning more positive' : 'steady';
}
