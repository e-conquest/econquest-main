/**
 * Cycle clock (Sam, 2026-11-05): where each country sits in its policy and business cycle, and when
 * the next scheduled decision falls. Built only from figures the app already pulls:
 * - Policy cycle: the moves in the BIS monthly policy-rate history (about two years).
 * - Business cycle: the OECD leading indicator's phase, how long it has lasted, and its last turning point.
 * - Next decision: the official calendar.
 * It says where things stand and for how long, never what happens next.
 */
import type { LiveWatchlistItem } from '../types/council';
import { nextOfficialEvent } from '../data/officialCalendar';
import { formatPeriod } from './officialYields';
import { formatMonth } from './oecdSdmx';

export type PolicyCycleState = 'hiking' | 'cutting' | 'on hold';

/** A move older than this many months means the bank is on hold. */
export const HOLD_AFTER_MONTHS = 6;

export interface PolicyCycle {
  state: PolicyCycleState;
  /** Moves in the current run (same direction, none older than HOLD_AFTER_MONTHS apart). 0 when on hold. */
  movesInRun: number;
  /** Total change over the run, points. */
  runPts?: number;
  /** First month of the run (hiking / cutting) or the month of the last move (on hold). */
  since?: string;
  /** When on hold: what the last move was. */
  lastDirection?: 'hike' | 'cut';
  /** Months from the last move to `asOf`. */
  monthsSinceLastMove?: number;
  /** On hold with no move at all in the history read: how far back it looked. */
  noMoveSince?: string;
  asOf: string;
}

const monthDiff = (from: string, to: string) => {
  const [y1, m1] = from.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
};

type Move = { period: string; fromPct: number; toPct: number };

/** The policy cycle from the BIS moves. `asOf` is the month of the latest policy-rate figure. */
export function policyCycle(moves: Move[] | undefined, asOf: string, historyFrom?: string): PolicyCycle | null {
  if (!moves) return null;
  const month = asOf.slice(0, 7);
  if (!moves.length) return { state: 'on hold', movesInRun: 0, asOf: month, ...(historyFrom ? { noMoveSince: historyFrom } : {}) };
  const last = moves[moves.length - 1];
  const dir = (m: Move) => (m.toPct > m.fromPct ? 'hike' : 'cut');
  const since = monthDiff(last.period, month);
  if (since >= HOLD_AFTER_MONTHS)
    return { state: 'on hold', movesInRun: 0, since: last.period, lastDirection: dir(last), monthsSinceLastMove: since, asOf: month };
  let i = moves.length - 1;
  while (i > 0 && dir(moves[i - 1]) === dir(last) && monthDiff(moves[i - 1].period, moves[i].period) < HOLD_AFTER_MONTHS) i--;
  const run = moves.slice(i);
  return {
    state: dir(last) === 'hike' ? 'hiking' : 'cutting',
    movesInRun: run.length,
    runPts: Number((last.toPct - run[0].fromPct).toFixed(2)),
    since: run[0].period,
    monthsSinceLastMove: since,
    asOf: month,
  };
}

const sg = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function policyCycleText(c: PolicyCycle): string {
  if (c.state === 'on hold') {
    if (c.noMoveSince) return `On hold: no move since at least ${formatPeriod(c.noMoveSince)} (start of the BIS history read)`;
    return `On hold for ${plural(c.monthsSinceLastMove ?? 0, 'month')} since the last ${c.lastDirection} in ${formatPeriod(c.since!)}`;
  }
  const verb = c.state === 'hiking' ? 'hike' : 'cut';
  return `${c.state === 'hiking' ? 'Hiking' : 'Cutting'}: ${plural(c.movesInRun, verb)} since ${formatPeriod(c.since!)}, ${sg(c.runPts ?? 0)} pts in all; last move ${c.monthsSinceLastMove === 0 ? 'this month' : `${plural(c.monthsSinceLastMove ?? 0, 'month')} ago`}`;
}

export interface CycleClock {
  iso3: string;
  policy?: PolicyCycle;
  cli?: {
    phase: string;
    since?: string;
    months?: number;
    sinceAtStart?: boolean;
    lastTurn?: { month: string; kind: 'peak' | 'trough'; level: number };
    month: string;
  };
  nextDecision?: { date: string; daysUntil: number; title: string; source: string; primary: boolean };
}

export function cycleClock(it: Pick<LiveWatchlistItem, 'iso3' | 'policyRateMoves' | 'policyRateHistoryFrom' | 'policyRateDate' | 'policyRateSource' | 'oecdCli'>, now = new Date()): CycleClock {
  const out: CycleClock = { iso3: it.iso3 };
  if (it.policyRateSource === 'bis' && it.policyRateDate) {
    const p = policyCycle(it.policyRateMoves, it.policyRateDate, it.policyRateHistoryFrom);
    if (p) out.policy = p;
  }
  const c = it.oecdCli;
  if (c?.phase)
    out.cli = {
      phase: c.phase,
      month: c.month,
      ...(c.phaseSince ? { since: c.phaseSince, months: c.monthsInPhase } : {}),
      ...(c.phaseSinceAtStart ? { sinceAtStart: true } : {}),
      ...(c.lastTurn ? { lastTurn: c.lastTurn } : {}),
    };
  const next = nextOfficialEvent(it.iso3, 'MPC_DECISION', now);
  if (next) out.nextDecision = { date: next.date, daysUntil: next.daysUntil, title: next.title, source: next.sourceName, primary: next.primarySource };
  return out;
}

export function cliCycleText(c: NonNullable<CycleClock['cli']>): string {
  const phase = c.phase.replace(/^./, (x) => x.toUpperCase());
  const span = c.since && c.months ? ` for ${c.sinceAtStart ? 'at least ' : ''}${plural(c.months, 'month')} (since ${formatMonth(c.since)})` : '';
  const turn = c.lastTurn ? `; last turning point a ${c.lastTurn.kind} in ${formatMonth(c.lastTurn.month)} at ${c.lastTurn.level.toFixed(2)}` : '';
  return `${phase}${span}, as of ${formatMonth(c.month)}${turn}`;
}

export function nextDecisionText(n: NonNullable<CycleClock['nextDecision']>): string {
  const when = n.daysUntil === 0 ? 'today' : n.daysUntil === 1 ? 'tomorrow' : `in ${n.daysUntil} days`;
  return `${dayText(n.date)}, ${when}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-12-09" -> "9 Dec 2026", the date style the country brief uses. */
function dayText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
}
