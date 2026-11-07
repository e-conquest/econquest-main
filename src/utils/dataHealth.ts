/**
 * Data health, part 1: the history of the data connection check (Sam, 2026-11-06: "make the data
 * feeds reliable"). Every run of the check (the nightly one, Refresh under Tools > Data
 * connections, and `npm run check:data`) is kept, one line per run, so a feed that breaks quietly
 * shows up as "failing since" with the date, and one that flickers shows a low connected rate.
 *
 * Stated rules, no model:
 * - A source counts as failing when the check got no answer, a refusal or an answer the app could
 *   not read. "Needs setup", "off" and "optional, not set" are not failures: nothing was asked.
 * - "Connected rate" counts only runs where the source was asked (connected or failing).
 * - Keys and setup lines are never kept: only the state, the reason in words and the figure the
 *   source returned. Anything in a reason that looks like a key in a web address is blanked.
 *
 * Browser-safe (no fs). File storage is in src/utils/dataHealthStore.ts.
 */
import type { ConnectionGroup, ConnectionReport, ConnectionState } from './connectionCheck';

export type CheckTrigger = 'nightly' | 'manual' | 'terminal';

export const TRIGGER_LABEL: Record<CheckTrigger, string> = {
  nightly: 'Nightly check',
  manual: 'Checked in the app',
  terminal: 'npm run check:data',
};

export interface SourceCheckRow {
  id: string;
  name: string;
  group: ConnectionGroup;
  state: ConnectionState;
  detail: string;
  sample?: string;
  httpStatus?: number;
  latencyMs?: number;
}

export interface SourceCheckRecord {
  checkedAt: string;
  trigger: CheckTrigger;
  rows: SourceCheckRow[];
}

const FAILING: ConnectionState[] = ['no_answer', 'refused', 'bad_reply'];
export const isFailingState = (s: ConnectionState) => FAILING.includes(s);
/** Asked at all: connected or failing (setup, off and optional are not asked). */
export const isAskedState = (s: ConnectionState) => s === 'connected' || isFailingState(s);

/** Blanks anything that looks like a key or token in a reason ("api_key=abc" -> "api_key=…"). */
export function redact(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  return text
    .replace(/((?:api[_-]?key|apikey|key|token|access_token|password|secret|subscription-key)=)[^&\s"']+/gi, '$1…')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/g, '$1…');
}

/** The part of a check report that is kept: no setup lines, no warnings that name files, no keys. */
export function recordFromReport(rep: ConnectionReport, trigger: CheckTrigger): SourceCheckRecord {
  return {
    checkedAt: rep.checkedAt,
    trigger,
    rows: rep.results.map((r) => ({
      id: r.id,
      name: r.name,
      group: r.group,
      state: r.state,
      detail: redact(r.detail)!.slice(0, 300),
      ...(r.sample ? { sample: redact(r.sample)!.slice(0, 200) } : {}),
      ...(r.httpStatus !== undefined ? { httpStatus: r.httpStatus } : {}),
      ...(r.latencyMs !== undefined ? { latencyMs: r.latencyMs } : {}),
    })),
  };
}

export interface SourceHealth {
  id: string;
  name: string;
  group: ConnectionGroup;
  /** State at the latest run that included this source. */
  state: ConnectionState;
  detail: string;
  sample?: string;
  lastCheckedAt: string;
  /** Latest run where it connected. */
  lastConnectedAt?: string;
  /** First run of the current failing streak. */
  failingSince?: string;
  /** Runs in a row it has failed, up to the latest. */
  failuresInRow: number;
  /** Runs (in the window) where it was asked, and how many of those connected. */
  asked: number;
  connected: number;
  /** Latest runs, oldest first, for a row of dots. */
  recent: Array<{ at: string; state: ConnectionState }>;
}

/**
 * Per source, from the saved runs (oldest first): state now, failing since, connected rate over the
 * last `window` runs that included it. Sources come out in the order of the latest run.
 */
export function sourceHealth(records: SourceCheckRecord[], window = 30, dots = 14): SourceHealth[] {
  const byId = new Map<string, Array<{ at: string; row: SourceCheckRow }>>();
  for (const rec of records) {
    for (const row of rec.rows || []) {
      if (!row?.id) continue;
      const list = byId.get(row.id) || [];
      list.push({ at: rec.checkedAt, row });
      byId.set(row.id, list);
    }
  }
  const order: string[] = [];
  for (let i = records.length - 1; i >= 0; i--) for (const r of records[i].rows || []) if (!order.includes(r.id)) order.push(r.id);

  return order.map((id) => {
    const runs = byId.get(id)!;
    const last = runs[runs.length - 1];
    let failuresInRow = 0;
    let failingSince: string | undefined;
    for (let i = runs.length - 1; i >= 0 && isFailingState(runs[i].row.state); i--) {
      failuresInRow++;
      failingSince = runs[i].at;
    }
    let lastConnectedAt: string | undefined;
    for (let i = runs.length - 1; i >= 0; i--) {
      if (runs[i].row.state === 'connected') {
        lastConnectedAt = runs[i].at;
        break;
      }
    }
    const inWindow = runs.slice(-window).filter((r) => isAskedState(r.row.state));
    return {
      id,
      name: last.row.name,
      group: last.row.group,
      state: last.row.state,
      detail: last.row.detail,
      ...(last.row.sample ? { sample: last.row.sample } : {}),
      lastCheckedAt: last.at,
      ...(lastConnectedAt ? { lastConnectedAt } : {}),
      ...(failingSince ? { failingSince } : {}),
      failuresInRow,
      asked: inWindow.length,
      connected: inWindow.filter((r) => r.row.state === 'connected').length,
      recent: runs.slice(-dots).map((r) => ({ at: r.at, state: r.row.state })),
    };
  });
}

export interface CheckChanges {
  /** Connected at the run before, failing now. */
  broke: SourceCheckRow[];
  /** Failing at the run before, connected now. */
  fixed: SourceCheckRow[];
}

/** What changed between two runs. Sources only in one of them are left out. */
export function changesBetween(prev: SourceCheckRecord | null | undefined, cur: SourceCheckRecord): CheckChanges {
  const before = new Map((prev?.rows || []).map((r) => [r.id, r.state]));
  const broke: SourceCheckRow[] = [];
  const fixed: SourceCheckRow[] = [];
  for (const r of cur.rows) {
    const was = before.get(r.id);
    if (was === undefined) continue;
    if (was === 'connected' && isFailingState(r.state)) broke.push(r);
    else if (isFailingState(was) && r.state === 'connected') fixed.push(r);
  }
  return { broke, fixed };
}

/** Two lines for the terminal after `npm run check:data`. */
export function formatChanges(prev: SourceCheckRecord | null | undefined, cur: SourceCheckRecord): string {
  if (!prev) return 'First saved check: the next run will say what changed.';
  const { broke, fixed } = changesBetween(prev, cur);
  const head = `Since the last saved check (${prev.checkedAt.slice(0, 16).replace('T', ' ')} UTC):`;
  if (!broke.length && !fixed.length) return `${head} no source changed between connected and failing.`;
  return [head, ...broke.map((r) => `  BROKE  ${r.name}: ${r.detail}`), ...fixed.map((r) => `  FIXED  ${r.name}`)].join('\n');
}

/** "HH:MM" from a setting, or the default. */
export function checkTime(value: string | undefined, fallback = '05:30'): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? `${String(h).padStart(2, '0')}:${m[2]}` : fallback;
}

/** Local day and time in a time zone (falls back to UTC for an unknown zone). */
export function clockIn(now: Date, timeZone: string): { day: string; time: string } {
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  } catch {
    tz = 'UTC';
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/**
 * The nightly check is due once a day, at the first chance after the set time (a Mac asleep at
 * 05:30 runs it when it wakes).
 */
export function nightlyDue(lastDay: string | undefined, now: Date, time: string, timeZone: string): boolean {
  const c = clockIn(now, timeZone);
  return c.time >= time && lastDay !== c.day;
}
