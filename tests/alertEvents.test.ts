import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { backtestRegressionAlert, backtestRegressions, dataCheckAlert, jobFailedAlert } from '../src/utils/alertEvents';
import { notify, readLastAlert } from '../src/server/alerts';
import type { SourceCheckRecord } from '../src/utils/dataHealth';

const rec = (at: string, states: Record<string, string>): SourceCheckRecord => ({
  checkedAt: at,
  trigger: 'nightly',
  rows: Object.entries(states).map(([id, state]) => ({ id, name: id.toUpperCase(), group: 'free', state: state as any, detail: `${id} ${state}` })),
});

test('data check alerts only when a source goes from connected to failing', () => {
  const a = rec('2026-11-05T05:30:00Z', { imf: 'connected', bis: 'no_answer', wb: 'connected', fred: 'needs_setup' });
  const b = rec('2026-11-06T05:30:00Z', { imf: 'no_answer', bis: 'no_answer', wb: 'connected', fred: 'needs_setup' });
  const alert = dataCheckAlert(a, b)!;
  assert.equal(alert.kind, 'data_check');
  assert.equal(alert.title, '1 data source stopped answering');
  assert.match(alert.lines[0], /^IMF: imf no_answer/);
  // Still broken the next night: no second alert.
  assert.equal(dataCheckAlert(b, rec('2026-11-07T05:30:00Z', { imf: 'no_answer', bis: 'no_answer' })), null);
  // First run ever: nothing to compare.
  assert.equal(dataCheckAlert(null, b), null);
});

test('job failure alert carries the run summary', () => {
  const a = jobFailedAlert('Download all', 'Stopped early: offline (3 steps run, 1 failed).');
  assert.equal(a.title, 'Download all did not finish cleanly');
  assert.equal(a.lines[0], 'Stopped early: offline (3 steps run, 1 failed).');
});

test('backtest regression: same id and version, passed before, ran now, does not pass', () => {
  const start = '2026-11-08T03:30:00Z';
  const before = {
    'cftc_crowding v2': { id: 'cftc_crowding', specVersion: 2, status: 'passed', ranAt: '2026-11-01T03:30:00Z' },
    'cycle_clock v1': { id: 'cycle_clock', specVersion: 1, status: 'passed', ranAt: '2026-11-01T03:30:00Z' },
    'taylor_gap v2': { id: 'taylor_gap', specVersion: 2, status: 'failed', ranAt: '2026-11-01T03:30:00Z' },
    'timing_unwind v1': { id: 'timing_unwind', specVersion: 1, status: 'passed', ranAt: '2026-11-01T03:30:00Z' },
  };
  const after = {
    'cftc_crowding v2': { id: 'cftc_crowding', specVersion: 2, status: 'failed', ranAt: '2026-11-08T03:31:00Z', verdict: 'Fails the stricter check.' },
    'cycle_clock v1': { id: 'cycle_clock', specVersion: 1, status: 'passed', ranAt: '2026-11-08T03:31:00Z' },
    'taylor_gap v2': { id: 'taylor_gap', specVersion: 2, status: 'failed', ranAt: '2026-11-08T03:31:00Z' },
    // Did not run this time (its data did not answer): kept from before, not a regression.
    'timing_unwind v1': { id: 'timing_unwind', specVersion: 1, status: 'too_few_cases', ranAt: '2026-11-01T03:30:00Z' },
    // A new version failing is a new test, not a regression.
    'cycle_clock v2': { id: 'cycle_clock', specVersion: 2, status: 'failed', ranAt: '2026-11-08T03:31:00Z' },
  };
  const r = backtestRegressions(before, after, start);
  assert.deepEqual(r.map((x) => `${x.id} v${x.specVersion}`), ['cftc_crowding v2']);
  const alert = backtestRegressionAlert(r)!;
  assert.equal(alert.title, '1 backtest that passed now fails');
  assert.match(alert.lines[0], /cftc_crowding v2: failed \(Fails the stricter check\.\)/);
  assert.equal(backtestRegressionAlert([]), null);
});

test('notify: nothing without a route; with one it sends, scrubs and keeps the last alert', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alerts-'));
  const file = path.join(dir, 'local', 'last-alert.json');
  const fetched: string[] = [];
  const fetchFn = (async (_u: string, init: any) => (fetched.push(init.body), new Response('ok', { status: 200 }))) as any;
  assert.deepEqual(await notify(jobFailedAlert('Backtests', 'x'), file, {}, { fetchFn }), []);
  assert.equal(fetched.length, 0);
  assert.equal(readLastAlert(file), null);

  const env = { ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/SECRETHOOK', FRED_API_KEY: 'abcdef0123456789abcdef0123456789' };
  const res = await notify(jobFailedAlert('Download all', `FRED failed for key ${env.FRED_API_KEY}`), file, env, { fetchFn });
  assert.equal(res[0].ok, true);
  assert.ok(!fetched[0].includes(env.FRED_API_KEY));
  const last = readLastAlert(file)!;
  assert.equal(last.title, 'Download all did not finish cleanly');
  assert.equal(last.results[0].route, 'webhook');
  assert.ok(!fs.readFileSync(file, 'utf8').includes('SECRETHOOK'));

  // A webhook that is down never throws; the failure is kept.
  const down = await notify(jobFailedAlert('Backtests', 'x'), file, env, { fetchFn: (async () => { throw new Error('ECONNREFUSED'); }) as any });
  assert.equal(down[0].ok, false);
  assert.equal(readLastAlert(file)!.results[0].ok, false);
});
