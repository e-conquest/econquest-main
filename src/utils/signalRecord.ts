/**
 * Signal track record (Sam, 2026-11-05): how often a timing signal was followed by what it points
 * to, in the history the app already pulls for that country. Small samples are stated as such;
 * a count over two or three years says how the signal behaved here, not how it will behave.
 *
 * - Leading-indicator turn -> policy move: after each OECD CLI turning point, did the central bank
 *   move in the matching direction (peak -> cut, trough -> hike) within 6 months? Only turns with
 *   6 months of BIS history after them count.
 * - Crowded positioning -> unwind: each time CFTC leveraged-fund positioning entered the top or
 *   bottom 10% of its 3-year range, did it come back by 3 points of open interest or more within
 *   8 weeks? The range is the whole 3-year sample, so the test uses hindsight on the bands.
 */
import type { CliTurn } from './oecdCli';
import type { CftcWeek } from './cftcPositioning';

export const TURN_WINDOW_MONTHS = 6;
export const UNWIND_WINDOW_WEEKS = 8;
export const UNWIND_PTS = 3;
/** Fewer tests than this are flagged as too few to lean on. */
export const SMALL_SAMPLE = 5;

export interface RecordCount {
  tested: number;
  followed: number;
  /** First and last month or week of the history the test read. */
  from: string;
  to: string;
  /** The individual cases, oldest first, for the Country tab. */
  cases: Array<{ when: string; what: string; followed: boolean }>;
}

const monthDiff = (from: string, to: string) => {
  const [y1, m1] = from.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
};

type Move = { period: string; fromPct: number; toPct: number };

/** CLI turns followed by a matching policy move within TURN_WINDOW_MONTHS. Null when nothing could be tested. */
export function cliTurnToPolicyRecord(turns: CliTurn[], moves: Move[] | undefined, bisFrom: string | undefined, bisTo: string | undefined): RecordCount | null {
  if (!moves || !bisFrom || !bisTo || !turns.length) return null;
  const testable = turns.filter((t) => t.month >= bisFrom && monthDiff(t.month, bisTo) >= TURN_WINDOW_MONTHS);
  if (!testable.length) return null;
  const cases = testable.map((t) => {
    const want = t.kind === 'peak' ? 'cut' : 'hike';
    const hit = moves.some((m) => {
      const d = monthDiff(t.month, m.period);
      return d > 0 && d <= TURN_WINDOW_MONTHS && (want === 'cut' ? m.toPct < m.fromPct : m.toPct > m.fromPct);
    });
    return { when: t.month, what: `${t.kind} in the leading indicator, then a ${want} within ${TURN_WINDOW_MONTHS} months`, followed: hit };
  });
  return { tested: cases.length, followed: cases.filter((c) => c.followed).length, from: bisFrom, to: bisTo, cases };
}

/** Entries into the crowded bands followed by a pull-back of UNWIND_PTS within UNWIND_WINDOW_WEEKS. */
export function crowdingUnwindRecord(weeks: CftcWeek[] | undefined): RecordCount | null {
  if (!weeks || weeks.length < 52) return null;
  const share = weeks.map((w) => (w.levNet / w.openInterest) * 100);
  const sorted = [...share].sort((a, b) => a - b);
  const hi = sorted[Math.floor(sorted.length * 0.9)];
  const lo = sorted[Math.ceil(sorted.length * 0.1) - 1];
  const cases: RecordCount['cases'] = [];
  for (let i = 1; i < share.length - UNWIND_WINDOW_WEEKS; i++) {
    const enteredHigh = share[i] >= hi && share[i - 1] < hi;
    const enteredLow = share[i] <= lo && share[i - 1] > lo;
    if (!enteredHigh && !enteredLow) continue;
    const ahead = share.slice(i + 1, i + 1 + UNWIND_WINDOW_WEEKS);
    const followed = enteredHigh ? ahead.some((v) => v <= share[i] - UNWIND_PTS) : ahead.some((v) => v >= share[i] + UNWIND_PTS);
    cases.push({ when: weeks[i].date, what: `entered crowded ${enteredHigh ? 'long' : 'short'}, then came back ${UNWIND_PTS} pts within ${UNWIND_WINDOW_WEEKS} weeks`, followed });
  }
  if (!cases.length) return null;
  return { tested: cases.length, followed: cases.filter((c) => c.followed).length, from: weeks[0].date, to: weeks[weeks.length - 1].date, cases };
}

export interface SignalRecord {
  cliTurnToPolicy?: RecordCount;
  crowdingUnwind?: RecordCount;
}

/** "Followed 3 of 4 times (Nov 2024 to Oct 2026); too few cases to lean on." */
export function recordText(r: RecordCount, span: string): string {
  return `Followed ${r.followed} of ${r.tested} time${r.tested === 1 ? '' : 's'} (${span})${r.tested < SMALL_SAMPLE ? '; too few cases to lean on' : ''}.`;
}
