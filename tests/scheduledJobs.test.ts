import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  backtestSummary,
  closeInterrupted,
  describeSchedule,
  downloadSummary,
  jobDue,
  KEEP_RUNS,
  markFinished,
  markSkipped,
  markStarted,
  testsSummary,
  parseSchedule,
  readJobs,
  writeJobs,
} from '../src/utils/scheduledJobs';

test('parseSchedule reads off, daily and weekly, and refuses anything else', () => {
  assert.deepEqual(parseSchedule(undefined), { kind: 'off' });
  assert.deepEqual(parseSchedule(' off '), { kind: 'off' });
  assert.deepEqual(parseSchedule('2:30'), { kind: 'daily', time: '02:30' });
  assert.deepEqual(parseSchedule('sun 03:30'), { kind: 'weekly', weekday: 0, time: '03:30' });
  assert.deepEqual(parseSchedule('Saturday 23:05'), { kind: 'weekly', weekday: 6, time: '23:05' });
  assert.equal(parseSchedule('24:00').kind, 'invalid');
  assert.equal(parseSchedule('sunnyday 03:30').kind, 'invalid');
  assert.equal(parseSchedule('nightly').kind, 'invalid');
  assert.match(describeSchedule(parseSchedule('nightly'), 'UTC'), /^Off: "nightly" is not a time/);
  assert.equal(describeSchedule(parseSchedule('sun 03:30'), 'UTC'), 'Every Sunday after 03:30 (UTC)');
});

test('a daily job is due once a day, after the set time', () => {
  const s = parseSchedule('02:30');
  assert.equal(jobDue(s, undefined, new Date('2026-11-06T02:29:00Z'), 'UTC'), false);
  assert.equal(jobDue(s, undefined, new Date('2026-11-06T02:30:00Z'), 'UTC'), true);
  assert.equal(jobDue(s, '2026-11-06', new Date('2026-11-06T09:00:00Z'), 'UTC'), false);
  // Asleep at 02:30: runs at the first chance after.
  assert.equal(jobDue(s, '2026-11-05', new Date('2026-11-06T11:00:00Z'), 'UTC'), true);
  // Local time, not UTC: 02:30 in Tokyo is 17:30 UTC the day before.
  assert.equal(jobDue(s, undefined, new Date('2026-11-05T17:31:00Z'), 'Asia/Tokyo'), true);
  assert.equal(jobDue(parseSchedule('off'), undefined, new Date(), 'UTC'), false);
});

test('a weekly job runs on its day, and catches up after seven days when the day was missed', () => {
  const s = parseSchedule('sun 03:30'); // 2026-11-08 is a Sunday
  assert.equal(jobDue(s, undefined, new Date('2026-11-07T12:00:00Z'), 'UTC'), false);
  assert.equal(jobDue(s, undefined, new Date('2026-11-08T03:31:00Z'), 'UTC'), true);
  assert.equal(jobDue(s, '2026-11-08', new Date('2026-11-08T20:00:00Z'), 'UTC'), false);
  assert.equal(jobDue(s, '2026-11-08', new Date('2026-11-12T20:00:00Z'), 'UTC'), false);
  // Off all Sunday the 15th: runs Monday the 16th.
  assert.equal(jobDue(s, '2026-11-08', new Date('2026-11-16T04:00:00Z'), 'UTC'), true);
});

test('runs are kept in order, capped, and a restart closes a run left open', () => {
  let jobs = markStarted({}, 'download_all', '2026-11-06', '2026-11-06T02:30:00Z');
  assert.equal(jobs.download_all!.lastDay, '2026-11-06');
  jobs = markFinished(jobs, 'download_all', '2026-11-06T03:10:00Z', true, '10 steps run, 0 failed.');
  assert.deepEqual(jobs.download_all!.runs, [{ startedAt: '2026-11-06T02:30:00Z', finishedAt: '2026-11-06T03:10:00Z', ok: true, summary: '10 steps run, 0 failed.' }]);
  jobs = markSkipped(jobs, 'backtests', '2026-11-08T03:30:00Z', 'Offline');
  assert.equal(jobs.backtests!.lastSkipped!.reason, 'Offline');
  jobs = markStarted(jobs, 'backtests', '2026-11-08', '2026-11-08T03:31:00Z');
  assert.equal(jobs.backtests!.lastSkipped, undefined);
  jobs = closeInterrupted(jobs, '2026-11-08T03:40:00Z');
  assert.deepEqual(jobs.backtests!.runs.at(-1), { startedAt: '2026-11-08T03:31:00Z', finishedAt: '2026-11-08T03:40:00Z', ok: false, summary: 'Ended by a server restart.' });
  for (let i = 0; i < KEEP_RUNS + 5; i++) jobs = markFinished(jobs, 'download_all', `2026-12-${String(i).padStart(2, '0')}`, true, 'x');
  assert.equal(jobs.download_all!.runs.length, KEEP_RUNS);
});

test('the jobs file round-trips and reads as empty when missing or damaged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-'));
  const file = path.join(dir, 'local', 'scheduled-jobs.json');
  assert.deepEqual(readJobs(file), {});
  const jobs = markStarted({}, 'backtests', '2026-11-08', '2026-11-08T03:31:00Z');
  writeJobs(file, jobs);
  assert.deepEqual(readJobs(file), jobs);
  fs.writeFileSync(file, '{not json');
  assert.deepEqual(readJobs(file), {});
});

test('summaries count only what this run did', () => {
  const steps = {
    a: { outcome: 'done' as const, at: '2026-11-06T02:31:00Z' },
    b: { outcome: 'failed' as const, at: '2026-11-06T02:32:00Z' },
    old: { outcome: 'failed' as const, at: '2026-11-05T02:32:00Z' },
  };
  assert.deepEqual(downloadSummary({ steps }, '2026-11-06T02:30:00Z'), { ok: false, summary: '2 steps run, 1 failed (the last good figures are kept; see Sources).' });
  assert.deepEqual(downloadSummary({ steps }, '2026-11-07T00:00:00Z'), { ok: true, summary: 'Nothing to do: every step was pulled within the last day.' });
  assert.match(downloadSummary({ steps, endedEarly: 'Server restarted' }, '2026-11-06T02:30:00Z').summary, /^Stopped early: Server restarted/);
  const results = {
    x: { status: 'passed', ranAt: '2026-11-08T03:35:00Z' },
    y: { status: 'failed', ranAt: '2026-11-08T03:35:00Z' },
    z: { status: 'passed', ranAt: '2026-10-01T00:00:00Z' },
  };
  assert.deepEqual(backtestSummary({ results, problems: [] }, '2026-11-08T03:31:00Z'), { ok: true, summary: '2 backtests run: 1 passed, 1 failed.' });
  assert.deepEqual(backtestSummary({ results, problems: ['FRED: no answer'] }, '2026-11-09T00:00:00Z'), { ok: false, summary: 'No backtest ran: 1 problem (FRED: no answer).' });
});

test('testsSummary counts each part of the weekly tests job and is not ok when a part fails', () => {
  const at = '2026-11-08T03:30:00Z';
  const bt = { results: { a: { status: 'passed', ranAt: '2026-11-08T03:31:00Z' }, b: { status: 'failed', ranAt: '2026-11-08T03:32:00Z' } }, problems: [] };
  const fc = { results: { g: { status: 'passed', ranAt: '2026-11-08T03:40:00Z' }, old: { status: 'failed', ranAt: '2026-11-01T03:40:00Z' } }, problems: [] };
  assert.deepEqual(
    testsSummary([{ noun: 'Backtests', out: bt }, { noun: 'Forecast evaluations', out: fc }], at),
    { ok: true, summary: 'Backtests: 2 run, 1 passed, 1 failed. Forecast evaluations: 1 run, 1 passed.' }
  );
  assert.deepEqual(
    testsSummary([{ noun: 'Backtests', out: bt }, { noun: 'Signal tests', error: 'BIS: no answer' }], at),
    { ok: false, summary: 'Backtests: 2 run, 1 passed, 1 failed. Signal tests: did not run (BIS: no answer).' }
  );
  assert.deepEqual(
    testsSummary([{ noun: 'Signal tests', out: { results: {}, problems: ['Frankfurter: timeout', 'BIS: 503'] } }], at),
    { ok: false, summary: 'Signal tests: none ran, 2 problems (Frankfurter: timeout, …).' }
  );
});
