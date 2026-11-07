import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMPTY_PRELOAD_STATE,
  PRELOAD_FRESH_MS,
  WORLD_STEPS,
  LAST_STEPS,
  estimateRemainingBytes,
  formatBytes,
  planPreload,
  progressLine,
  stepsToRun,
  summarisePreload,
  type PreloadState,
} from '../src/utils/preload.ts';

const NOW = Date.parse('2026-11-05T18:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

test('plan: world feeds once, then two steps per country; bad and repeated codes dropped', () => {
  const plan = planPreload([{ iso3: 'BRA', countryName: 'Brazil' }, { iso3: 'bra' }, { iso3: 'TUR' }, { iso3: 'X1' }]);
  assert.equal(plan.length, WORLD_STEPS.length + 4 + LAST_STEPS.length);
  assert.deepEqual(plan.slice(WORLD_STEPS.length, WORLD_STEPS.length + 4).map((s) => s.id), ['country:BRA:snapshot', 'country:BRA:history', 'country:TUR:snapshot', 'country:TUR:history']);
  assert.equal(plan.at(-1)?.id, 'world:gdelt_raw', 'the long GDELT raw-file pull goes last');
  assert.match(plan[WORLD_STEPS.length].label, /^Brazil \(BRA\)/);
});

test('resume: steps done within a day are skipped; failed, skipped and old ones run again; fresh runs all', () => {
  const plan = planPreload([{ iso3: 'BRA' }]);
  const state: PreloadState = {
    running: false,
    steps: {
      'world:bis': { outcome: 'done', at: ago(60_000) },
      'world:cftc': { outcome: 'done', at: ago(PRELOAD_FRESH_MS + 1) },
      'world:tic': { outcome: 'failed', at: ago(60_000), note: 'US Treasury did not answer' },
      'world:comtrade': { outcome: 'skipped', at: ago(60_000), note: 'Needs setup' },
    },
  };
  const todo = stepsToRun(plan, state, { now: NOW }).map((s) => s.id);
  assert.ok(!todo.includes('world:bis'));
  for (const id of ['world:cftc', 'world:tic', 'world:comtrade', 'country:BRA:snapshot']) assert.ok(todo.includes(id), id);
  assert.equal(stepsToRun(plan, state, { now: NOW, fresh: true }).length, plan.length);
});

test('summary: counts, countries ready, problems with reasons; complete only when every step is fresh', () => {
  const plan = planPreload([{ iso3: 'BRA' }, { iso3: 'TUR' }]);
  const steps: PreloadState['steps'] = {};
  for (const s of plan) steps[s.id] = { outcome: 'done', at: ago(3_600_000) };
  steps['world:bis'] = { outcome: 'done', at: ago(7_200_000) };
  const all = summarisePreload(plan, { running: false, steps }, NOW);
  assert.equal(all.done, plan.length);
  assert.equal(all.completeAsOf, ago(7_200_000));
  assert.equal(all.countriesReady, 2);
  steps['country:TUR:history'] = { outcome: 'failed', at: ago(1000), note: 'IMF did not answer' };
  const some = summarisePreload(plan, { running: false, steps }, NOW);
  assert.equal(some.countriesReady, 1);
  assert.equal(some.completeAsOf, null);
  assert.deepEqual(some.problems.map((p) => [p.id, p.note]), [['country:TUR:history', 'IMF did not answer']]);
  const none = summarisePreload(plan, EMPTY_PRELOAD_STATE, NOW);
  assert.equal(none.todo, plan.length);
});

test('size: formatted; the estimate is the per-country average, or null before any country is saved', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(12.4 * 1024 * 1024), '12.4 MB');
  assert.equal(estimateRemainingBytes([1000, 3000, 0], 5), 10000);
  assert.equal(estimateRemainingBytes([0, 0], 5), null);
});

test('progress line says what happened and why', () => {
  const [step] = WORLD_STEPS;
  assert.equal(progressLine(1, 12, step, { outcome: 'failed', at: '', note: 'BIS did not answer' }), `[preload 1/12] FAIL ${step.label} (BIS did not answer)`);
});

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('npm run preload offline: says the feeds cannot be reached and downloads nothing', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'econquest-preload-off-'));
  try {
    const r = spawnSync(process.execPath, ['--import', 'tsx', path.join(rootDir, 'server.ts'), '--preload', '--countries=MEX'], {
      cwd: rootDir,
      env: { ...process.env, NODE_OPTIONS: `--import ${path.join(rootDir, 'tests/helpers/offline-fetch.mjs')}`, DATA_DIR: dataDir, OFFLINE_PROBE: 'down' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /feeds cannot be reached from this computer/);
    assert.ok(!existsSync(path.join(dataDir, 'history', 'MEX.json')));
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('npm run preload: a step that never answers is recorded as not saved and the run moves on', () => {
  // 10 s: the history step makes one request per official figure with a 200 ms gap (28 figures, about 6 s offline).
  const dataDir = mkdtempSync(path.join(tmpdir(), 'econquest-preload-hang-'));
  try {
    const r = spawnSync(process.execPath, ['--import', 'tsx', path.join(rootDir, 'server.ts'), '--preload', '--countries=MEX'], {
      cwd: rootDir,
      env: { ...process.env, NODE_OPTIONS: `--import ${path.join(rootDir, 'tests/helpers/offline-fetch.mjs')}`, DATA_DIR: dataDir, OFFLINE_HANG: 'stats.bis.org/api', PRELOAD_STEP_TIMEOUT_S: '10' },
      encoding: 'utf8',
      timeout: 90_000,
    });
    assert.equal(r.status, 0, r.stderr.slice(-1500));
    assert.match(r.stdout, /FAIL BIS central bank policy rates.*took longer than 10 s; moved on/);
    assert.match(r.stdout, /\[preload\] finished:/);
    const state = JSON.parse(readFileSync(path.join(dataDir, 'local', 'preload.json'), 'utf8'));
    assert.equal(state.steps['world:bis'].outcome, 'failed');
    assert.equal(state.steps['country:MEX:history'].outcome, 'done');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('npm run preload: runs offline against fixtures, saves progress, and a second run carries on', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'econquest-preload-'));
  const run = () =>
    spawnSync(process.execPath, ['--import', 'tsx', path.join(root, 'server.ts'), '--preload', '--countries=MEX'], {
      cwd: root,
      env: { ...process.env, NODE_OPTIONS: `--import ${path.join(root, 'tests/helpers/offline-fetch.mjs')}`, DATA_DIR: dataDir, COMTRADE_API_KEY: '', GEMINI_API_KEY: '' },
      encoding: 'utf8',
      timeout: 90_000,
    });
  try {
    const first = run();
    assert.equal(first.status, 0, first.stderr.slice(-2000));
    assert.match(first.stdout, /\[preload\] finished: \d+ of 18 steps saved/);
    // No key: the free preview route is tried, not skipped (the stand-in feeds refuse it).
    assert.match(first.stdout, /FAIL UN Comtrade trade partners \(UN Comtrade did not answer \(free preview route/);
    assert.ok(existsSync(path.join(dataDir, 'history', 'MEX.json')));
    const state = JSON.parse(readFileSync(path.join(dataDir, 'local', 'preload.json'), 'utf8'));
    assert.equal(state.running, false);
    assert.equal(state.steps['country:MEX:history'].outcome, 'done');
    assert.equal(state.steps['world:oecd_cli'].outcome, 'failed');
    const second = run();
    assert.equal(second.status, 0);
    const already = Number(/\((\d+) already saved within the last day\)/.exec(second.stdout)?.[1]);
    assert.ok(already >= 2, second.stdout);
    assert.ok(!/MEX\): full World Bank and IMF history/.test(second.stdout), 'history not downloaded again');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
