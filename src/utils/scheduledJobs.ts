/**
 * Scheduled jobs on the server (a home server left on overnight): Download all and the
 * pre-registered tests (backtests, forecast evaluations and currency signal tests), each run at a
 * set local time, with every run kept so Menu > Data
 * health > Scheduled can say what ran, when, and how it ended.
 *
 * Off unless switched on in the environment, so a laptop running `npm run dev` never starts a
 * long download by itself. The home-server compose file switches both on.
 *
 *   SCHEDULE_DOWNLOAD_ALL="02:30"      every day at 02:30
 *   SCHEDULE_BACKTESTS="sun 03:30"     every Sunday at 03:30 (backtests, then forecast and signal tests)
 *   SCHEDULE_TZ="Europe/London"        time zone for both (default: the computer's)
 *   "off" (or nothing) leaves a job off.
 *
 * Nothing here makes a figure: a job only runs the app's own pulls and tests.
 */
import fs from 'fs';
import path from 'path';
import { clockIn } from './dataHealth';

export type JobId = 'download_all' | 'backtests';

export const JOBS: Record<JobId, { label: string; env: string; what: string }> = {
  download_all: {
    label: 'Download all',
    env: 'SCHEDULE_DOWNLOAD_ALL',
    what: 'Pulls every free feed for every country, so pages open with the latest figures (same as Menu > Offline data > Download all).',
  },
  backtests: {
    label: 'Pre-registered tests',
    env: 'SCHEDULE_BACKTESTS',
    what: 'Runs the pre-registered backtests, forecast evaluations and currency signal tests on the latest data, adding to each passing test\'s forward record; verdicts appear in Menu > Models & validation.',
  },
};

export type Schedule =
  | { kind: 'off' }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; weekday: number; time: string }
  | { kind: 'invalid'; raw: string };

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "off", "HH:MM" (daily) or "<day> HH:MM" (weekly, day as mon..sun or a full name). */
export function parseSchedule(value: string | undefined): Schedule {
  const raw = String(value ?? '').trim();
  if (!raw || /^(off|no|false|0)$/i.test(raw)) return { kind: 'off' };
  const m = /^(?:([a-z]+)\s+)?(\d{1,2}):(\d{2})$/i.exec(raw);
  if (!m) return { kind: 'invalid', raw };
  const h = Number(m[2]);
  const min = Number(m[3]);
  if (h > 23 || min > 59) return { kind: 'invalid', raw };
  const time = `${String(h).padStart(2, '0')}:${m[3]}`;
  if (!m[1]) return { kind: 'daily', time };
  const weekday = WEEKDAYS.indexOf(m[1].slice(0, 3).toLowerCase());
  if (weekday < 0 || (m[1].length > 3 && !WEEKDAY_NAMES[weekday].toLowerCase().startsWith(m[1].toLowerCase()))) return { kind: 'invalid', raw };
  return { kind: 'weekly', weekday, time };
}

export function describeSchedule(s: Schedule, timeZone: string): string {
  if (s.kind === 'off') return 'Off';
  if (s.kind === 'invalid') return `Off: "${s.raw}" is not a time (use HH:MM or e.g. "sun 03:30")`;
  if (s.kind === 'daily') return `Every day after ${s.time} (${timeZone})`;
  return `Every ${WEEKDAY_NAMES[s.weekday]} after ${s.time} (${timeZone})`;
}

const dayNumber = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000;

/**
 * Due at the first chance after the set time, once per day (daily) or once per week (weekly). A
 * weekly job whose day was missed (server off) runs at the next chance once seven days have passed.
 */
export function jobDue(s: Schedule, lastDay: string | undefined, now: Date, timeZone: string): boolean {
  if (s.kind !== 'daily' && s.kind !== 'weekly') return false;
  const c = clockIn(now, timeZone);
  if (c.time < s.time || lastDay === c.day) return false;
  if (s.kind === 'daily') return true;
  const weekday = new Date(dayNumber(c.day) * 86_400_000).getUTCDay();
  if (weekday === s.weekday) return true;
  return Boolean(lastDay) && dayNumber(c.day) - dayNumber(lastDay!) >= 7;
}

export interface JobRun {
  startedAt: string;
  finishedAt?: string;
  ok?: boolean;
  /** One line: what the run did, or why it stopped. */
  summary?: string;
}
export interface JobState {
  /** Local day of the last scheduled start; marked first so a crash never repeats the day. */
  lastDay?: string;
  /** Newest last. */
  runs: JobRun[];
  /** Set when the job was due but waited (offline, or already running by hand). */
  lastSkipped?: { at: string; reason: string };
}
export type JobsFile = Partial<Record<JobId, JobState>>;

export const KEEP_RUNS = 30;

export function readJobs(file: string): JobsFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeJobs(file: string, jobs: JobsFile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(jobs, null, 2));
  fs.renameSync(tmp, file);
}

const stateOf = (jobs: JobsFile, id: JobId): JobState => ({ runs: [], ...(jobs[id] || {}) });

export function markStarted(jobs: JobsFile, id: JobId, day: string, at: string): JobsFile {
  const { lastSkipped: _done, ...s } = stateOf(jobs, id);
  return { ...jobs, [id]: { ...s, lastDay: day, runs: [...s.runs, { startedAt: at }].slice(-KEEP_RUNS) } };
}

export function markFinished(jobs: JobsFile, id: JobId, at: string, ok: boolean, summary: string): JobsFile {
  const s = stateOf(jobs, id);
  const runs = [...s.runs];
  const last = runs.at(-1);
  if (last && !last.finishedAt) runs[runs.length - 1] = { ...last, finishedAt: at, ok, summary };
  else runs.push({ startedAt: at, finishedAt: at, ok, summary });
  return { ...jobs, [id]: { ...s, runs: runs.slice(-KEEP_RUNS) } };
}

export function markSkipped(jobs: JobsFile, id: JobId, at: string, reason: string): JobsFile {
  const s = stateOf(jobs, id);
  return { ...jobs, [id]: { ...s, lastSkipped: { at, reason } } };
}

/** A run left open by a restart reads as ended by the restart, not as still running. */
export function closeInterrupted(jobs: JobsFile, at: string): JobsFile {
  let out = jobs;
  for (const id of Object.keys(JOBS) as JobId[]) {
    const last = jobs[id]?.runs.at(-1);
    if (last && !last.finishedAt) out = markFinished(out, id, at, false, 'Ended by a server restart.');
  }
  return out;
}

/** Summary line for a Download all run, from the preload state after it. */
export function downloadSummary(state: { endedEarly?: string; steps: Record<string, { outcome: 'done' | 'failed' | 'skipped'; at: string }> }, startedAt: string): { ok: boolean; summary: string } {
  const thisRun = Object.values(state.steps).filter((s) => s.at >= startedAt);
  const failed = thisRun.filter((s) => s.outcome === 'failed').length;
  const skipped = thisRun.filter((s) => s.outcome === 'skipped').length;
  const counts = `${thisRun.length} step${thisRun.length === 1 ? '' : 's'} run, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`;
  if (state.endedEarly) return { ok: false, summary: `Stopped early: ${state.endedEarly} (${counts}).` };
  if (!thisRun.length) return { ok: true, summary: 'Nothing to do: every step was pulled within the last day.' };
  return { ok: failed === 0, summary: `${counts}${failed ? ' (the last good figures are kept; see Sources)' : ''}.` };
}

/** Summary line for a backtest run: how many passed and failed, and any problem pulling the data. */
export function backtestSummary(out: { results: Record<string, { status: string; ranAt: string }>; problems: string[] }, startedAt: string): { ok: boolean; summary: string } {
  const ran = Object.values(out.results).filter((r) => r.ranAt >= startedAt);
  const counts = new Map<string, number>();
  for (const r of ran) counts.set(r.status, (counts.get(r.status) || 0) + 1);
  const parts = [...counts].map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`);
  const n = out.problems.length;
  const problems = n ? `${n} problem${n === 1 ? '' : 's'} (${out.problems[0]}${n > 1 ? ', …' : ''})` : '';
  if (!ran.length) return { ok: false, summary: `No backtest ran${problems ? `: ${problems}` : ''}.` };
  return { ok: n === 0, summary: `${ran.length} backtest${ran.length === 1 ? '' : 's'} run: ${parts.join(', ')}${problems ? `; ${problems}` : ''}.` };
}

/** One part of the weekly tests job: its name, and the run's results (or why it could not run). */
export interface TestsPart {
  noun: string;
  out?: { results: Record<string, { status: string; ranAt: string }>; problems: string[] };
  error?: string;
}

/**
 * Summary line for the weekly tests job: each part (backtests, forecast evaluations, signal tests)
 * counted as backtestSummary does. Not ok when any part did not run or had a problem.
 */
export function testsSummary(parts: TestsPart[], startedAt: string): { ok: boolean; summary: string } {
  let ok = true;
  const lines = parts.map((p) => {
    if (p.error || !p.out) {
      ok = false;
      return `${p.noun}: did not run (${p.error || 'no result'})`;
    }
    const ran = Object.values(p.out.results).filter((r) => r.ranAt >= startedAt);
    const counts = new Map<string, number>();
    for (const r of ran) counts.set(r.status, (counts.get(r.status) || 0) + 1);
    const n = p.out.problems.length;
    if (n || !ran.length) ok = false;
    const problems = n ? `${n} problem${n === 1 ? '' : 's'} (${p.out.problems[0]}${n > 1 ? ', …' : ''})` : '';
    if (!ran.length) return `${p.noun}: none ran${problems ? `, ${problems}` : ''}`;
    return `${p.noun}: ${ran.length} run, ${[...counts].map(([k, c]) => `${c} ${k.replace(/_/g, ' ')}`).join(', ')}${problems ? `; ${problems}` : ''}`;
  });
  return { ok, summary: `${lines.join('. ')}.` };
}
