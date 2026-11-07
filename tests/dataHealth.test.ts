import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { changesBetween, checkTime, formatChanges, nightlyDue, recordFromReport, redact, sourceHealth, type SourceCheckRecord } from '../src/utils/dataHealth.ts';
import { appendCheck, dataHealthFiles, readChecks, readState, saveState } from '../src/utils/dataHealthStore.ts';
import type { ConnectionReport, ConnectionState } from '../src/utils/connectionCheck.ts';

const run = (at: string, states: Record<string, ConnectionState>): SourceCheckRecord => ({
  checkedAt: at,
  trigger: 'nightly',
  rows: Object.entries(states).map(([id, state]) => ({ id, name: id.toUpperCase(), group: 'free', state, detail: state === 'connected' ? 'ok' : 'No answer within 20 s.' })),
});

test('keys and setup lines never reach the saved run', () => {
  const rep: ConnectionReport = {
    checkedAt: '2026-11-06T05:30:00Z',
    counts: {} as ConnectionReport['counts'],
    results: [
      {
        id: 'fred',
        name: 'FRED',
        group: 'free_key',
        feeds: 'US 10Y',
        state: 'refused',
        detail: 'Refused (HTTP 400) at https://api.stlouisfed.org/fred/series?api_key=abc123secret&series_id=X',
        setup: 'FRED_API_KEY=abc123secret',
        warning: 'file /Users/sam/cds.csv is old',
        host: 'api.stlouisfed.org',
        httpStatus: 400,
      },
    ],
  };
  const rec = recordFromReport(rep, 'manual');
  const text = JSON.stringify(rec);
  assert.doesNotMatch(text, /abc123secret/);
  assert.doesNotMatch(text, /setup|warning/);
  assert.match(rec.rows[0].detail, /api_key=…&series_id=X/);
  assert.equal(redact('Authorization: Bearer eyJhbGciOi.xyz'), 'Authorization: Bearer …');
});

test('failing since, failures in a row and connected rate come from the saved runs', () => {
  const runs = [
    run('2026-11-01T05:30:00Z', { bis: 'connected', imf: 'connected', fred: 'needs_setup' }),
    run('2026-11-02T05:30:00Z', { bis: 'connected', imf: 'no_answer', fred: 'needs_setup' }),
    run('2026-11-03T05:30:00Z', { bis: 'connected', imf: 'refused', fred: 'needs_setup' }),
    run('2026-11-04T05:30:00Z', { bis: 'no_answer', imf: 'bad_reply', fred: 'needs_setup' }),
    run('2026-11-05T05:30:00Z', { bis: 'connected', imf: 'no_answer', fred: 'needs_setup' }),
  ];
  const h = Object.fromEntries(sourceHealth(runs).map((s) => [s.id, s]));
  assert.equal(h.imf.failingSince, '2026-11-02T05:30:00Z');
  assert.equal(h.imf.failuresInRow, 4);
  assert.equal(h.imf.lastConnectedAt, '2026-11-01T05:30:00Z');
  assert.deepEqual([h.imf.connected, h.imf.asked], [1, 5]);
  assert.equal(h.bis.failingSince, undefined, 'back to connected ends the streak');
  assert.deepEqual([h.bis.connected, h.bis.asked], [4, 5]);
  assert.equal(h.fred.asked, 0, 'needs setup is not a failure and not asked');
  assert.equal(h.fred.failuresInRow, 0);
  assert.equal(h.imf.recent.length, 5);
});

test('what broke and what came back between two runs', () => {
  const a = run('2026-11-04T05:30:00Z', { bis: 'connected', imf: 'no_answer', wb: 'connected' });
  const b = run('2026-11-05T05:30:00Z', { bis: 'refused', imf: 'connected', wb: 'connected', new: 'no_answer' });
  const c = changesBetween(a, b);
  assert.deepEqual(c.broke.map((r) => r.id), ['bis']);
  assert.deepEqual(c.fixed.map((r) => r.id), ['imf']);
  assert.match(formatChanges(a, b), /BROKE  BIS[\s\S]*FIXED  IMF/);
  assert.match(formatChanges(null, b), /First saved check/);
  assert.match(formatChanges(b, b), /no source changed/);
});

test('the nightly check runs once a day, at the first chance after the set time', () => {
  const at = (iso: string) => new Date(iso);
  assert.equal(nightlyDue(undefined, at('2026-11-06T05:00:00Z'), '05:30', 'UTC'), false, 'before the time');
  assert.equal(nightlyDue(undefined, at('2026-11-06T05:31:00Z'), '05:30', 'UTC'), true);
  assert.equal(nightlyDue('2026-11-06', at('2026-11-06T14:00:00Z'), '05:30', 'UTC'), false, 'already ran today');
  assert.equal(nightlyDue('2026-11-05', at('2026-11-06T14:00:00Z'), '05:30', 'UTC'), true, 'asleep at 05:30, runs on waking');
  // 10:31 UTC is 05:31 in New York (EST in November)
  assert.equal(nightlyDue(undefined, at('2026-11-06T10:31:00Z'), '05:30', 'America/New_York'), true);
  assert.equal(nightlyDue(undefined, at('2026-11-06T10:29:00Z'), '05:30', 'America/New_York'), false);
  assert.equal(nightlyDue(undefined, at('2026-11-06T05:31:00Z'), '05:30', 'Not/AZone'), true, 'unknown zone falls back to UTC');
  assert.equal(checkTime('6:05'), '06:05');
  assert.equal(checkTime('25:00'), '05:30');
  assert.equal(checkTime(undefined), '05:30');
});

test('runs are appended to one file and trimmed to the newest', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'econquest-health-'));
  try {
    const files = dataHealthFiles(dir);
    assert.deepEqual(readChecks(files), []);
    for (let i = 0; i < 12; i++) assert.ok(appendCheck(files, run(`2026-11-${String(i + 1).padStart(2, '0')}T05:30:00Z`, { bis: 'connected' }), 5));
    // trimmed only past keep + 50, so all 12 stay at keep 5
    assert.equal(readChecks(files).length, 12);
    for (let i = 0; i < 50; i++) appendCheck(files, run(`2026-12-01T05:${String(i).padStart(2, '0')}:00Z`, { bis: 'connected' }), 5);
    const kept = readChecks(files);
    // 62 runs: trimmed to 5 when the 56th came in, then 6 more
    assert.equal(kept.length, 11);
    assert.equal(kept[0].checkedAt, '2026-12-01T05:39:00Z');
    assert.equal(kept.at(-1)!.checkedAt, '2026-12-01T05:49:00Z');
    assert.match(readFileSync(files.checks, 'utf8'), /\n$/);
    saveState(files, { lastNightlyDay: '2026-11-06' });
    assert.equal(readState(files).lastNightlyDay, '2026-11-06');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
