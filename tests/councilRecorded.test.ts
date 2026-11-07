/**
 * Real-model regression in CI. `npm run council:record` (on Sam's Mac) runs the council regression
 * set on the referee model and records every model reply in tests/fixtures/council-recorded/. Here
 * the real server replays those replies (tests/helpers/model-replay-fetch.mjs) and the build fails when:
 *   - a step asks the model something that was not recorded: a prompt, template, input or setting
 *     changed, so the recorded answers no longer apply (the message names the first changed line);
 *   - the checked answers differ from the recorded baseline (a change to the checks or the parsing);
 *   - a case that passed in the baseline fails;
 *   - a structural check fails: no model named, a small model, not temperature 0 with a seed, or a
 *     number in the answer that no input gave.
 * The fix for the first two is to record again on the Mac and commit the new baseline if it is right.
 *
 * The first test records and replays a stand-in model, so the recorder and replayer are checked
 * even before a real recording exists. The second is skipped (with a note) until one does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { caseInputText, compareToBaseline, parseRegressionSet, structuralProblems, type RegressionBaseline, type RegressionReport } from '../src/utils/councilRegression.ts';
import { isSmallModel } from '../src/utils/refereeModel.ts';
import { callKey, canonical, firstDifference } from './helpers/modelRecording.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const recDir = path.join(root, 'tests', 'fixtures', 'council-recorded');
const recorded = existsSync(path.join(recDir, 'index.json'));
const set = parseRegressionSet(JSON.parse(readFileSync(path.join(root, 'docs', 'validation', 'council-regression', 'cases.json'), 'utf8')));

async function replayServer(replayDir: string) {
  const work = mkdtempSync(path.join(tmpdir(), 'econquest-model-replay-'));
  const missLog = path.join(work, 'replay.jsonl');
  const port = 5300 + Math.floor(Math.random() * 400);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  Object.assign(env, {
    NODE_OPTIONS: `--import ${path.join(root, 'tests/helpers/model-replay-fetch.mjs')}`,
    MODEL_REPLAY_DIR: replayDir,
    MODEL_REPLAY_LOG: missLog,
    DATA_DIR: path.join(work, 'data'),
    PORT: String(port),
    NODE_ENV: 'production',
    CDS_FEED: 'off',
    GEMINI_API_KEY: '',
  });
  const server = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'server.ts')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout?.on('data', (d) => (log += d));
  server.stderr?.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (server.exitCode !== null) throw new Error(`server exited early:\n${log}`);
    try {
      if ((await fetch(`${base}/api/ai/runtime-defaults`)).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`server did not start within 60s:\n${log}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  const replayLog = () => (existsSync(missLog) ? readFileSync(missLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const stop = () => {
    server.kill();
    rmSync(work, { recursive: true, force: true });
  };
  return { base, replayLog, stop };
}

const regression = async (base: string, model: string): Promise<RegressionReport> => {
  const res = await fetch(`${base}/api/council/regression`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runtimeConfig: { providerMode: 'ollama', ollamaBaseUrl: 'http://recorded-ollama.test:11434', ollamaDeepModel: model } }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  return res.json();
};

const missText = (m: { step: string; model: string; diff: { line: number; recorded: string; now: string } | null }) =>
  `${m.step || 'a model step'} (${m.model}): ${m.diff ? (m.diff.line ? `line ${m.diff.line} was "${m.diff.recorded}", now "${m.diff.now}"` : `${m.diff.recorded} -> ${m.diff.now}`) : 'no recording of this step at all'}`;

test('call names: the same request gives the same name; transport settings do not count; any prompt change does', () => {
  const body = { model: 'qwen2.5:32b', stream: true, keep_alive: '30m', format: 'json', options: { temperature: 0, seed: 42, num_ctx: 16384, num_predict: 2048 }, messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }] };
  assert.equal(callKey(body), callKey({ ...body, stream: false, keep_alive: undefined, options: { num_ctx: 16384, seed: 42, temperature: 0 } }));
  assert.notEqual(callKey(body), callKey({ ...body, messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'U2' }] }));
  assert.notEqual(callKey(body), callKey({ ...body, model: 'qwen2.5:7b' }));
  assert.notEqual(callKey(body), callKey({ ...body, options: { ...body.options, temperature: 0.2 } }));
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 0 }] }), '{"a":[2,{"c":0,"d":1}],"b":1}');
  assert.deepEqual(firstDifference('a\nb\nc', 'a\nB\nc'), { line: 2, recorded: 'b', now: 'B' });
});

test('baseline checks: drift, newly failing cases and invented numbers are named', () => {
  const r = { id: 'x', question: 'q', pass: true, failures: [], headline: 'Policy is tight.', removed: 0, model: 'qwen2.5:32b', temperature: 0, seed: 42, promptHash: 'p1', outputHash: 'o1', answer: ['Policy is tight.', 'The rate is 13.75%.'] };
  const report: RegressionReport = { ranAt: '', setVersion: 1, setHash: 'h', model: 'qwen2.5:32b', passed: 1, total: 1, results: [r] };
  const baseline: RegressionBaseline = { recordedAt: '2026-11-06T00:00:00Z', model: 'qwen2.5:32b', report };
  assert.deepEqual(compareToBaseline(report, baseline), { drift: [], newlyFailing: [], knownFailing: [] });
  const changed = { ...report, results: [{ ...r, pass: false, outputHash: 'o2', promptHash: 'p2', headline: 'Policy is loose.' }] };
  const cmp = compareToBaseline(changed, baseline);
  assert.deepEqual(cmp.newlyFailing, ['x']);
  assert.ok(cmp.drift.some((d) => /prompt sent to the model changed/.test(d)));
  assert.ok(cmp.drift.some((d) => /answer changed.*Policy is tight.*Policy is loose/.test(d)));
  // Same headline, a different sentence below it: the sentence is named, not the identical headline twice.
  const body = compareToBaseline({ ...report, results: [{ ...r, outputHash: 'o3', answer: ['Policy is tight.', 'The rate is far above inflation.'] }] }, baseline);
  assert.ok(body.drift.some((d) => /same headline, the rest of the answer changed\. Recorded: "The rate is 13\.75%\." Now: "The rate is far above inflation\."/.test(d)), body.drift.join('|'));
  assert.deepEqual(structuralProblems(r, ['13.75%'], isSmallModel), []);
  assert.match(structuralProblems({ ...r, answer: ['Reserves cover NaN months of imports.'] }, [], isSmallModel)[0], /template text \("NaN"/);
  assert.match(structuralProblems(r, ['4.4%'], isSmallModel)[0], /quotes 13.75, which no input gave/);
  assert.match(structuralProblems({ ...r, model: 'qwen2.5:7b' }, ['13.75%'], isSmallModel)[0], /small model/);
  assert.match(structuralProblems({ ...r, model: null }, [], isSmallModel)[0], /no model answered/);
});

test('record and replay round trip on a stand-in model: same answers, nothing unrecorded; a changed prompt is caught and named', async () => {
  const work = mkdtempSync(path.join(tmpdir(), 'econquest-council-record-test-'));
  const out = path.join(work, 'rec');
  try {
    const rec = spawnSync(process.execPath, ['--import', 'tsx', path.join(root, 'scripts', 'council-record.ts'), '--model', 'qwen2.5:32b'], {
      cwd: root,
      env: { ...process.env, RECORD_PRELOAD: path.join(root, 'tests/helpers/offline-fetch.mjs'), OLLAMA_URL: 'http://fake-ollama.test:11434', COUNCIL_RECORD_OUT: out, COUNCIL_RECORD_ZIP: path.join(work, 'rec.zip'), DATA_DIR: path.join(work, 'data') },
      encoding: 'utf8',
      timeout: 120_000,
    });
    assert.equal(rec.status, 0, rec.stdout + rec.stderr);
    assert.match(rec.stdout, /model replies recorded/);
    assert.ok(existsSync(path.join(work, 'rec.zip')));
    const baseline = JSON.parse(readFileSync(path.join(out, 'baseline.json'), 'utf8')) as RegressionBaseline;
    assert.equal(baseline.model, 'qwen2.5:32b');
    assert.equal(baseline.report.total, set.cases.length);
    assert.equal(readdirSync(path.join(out, 'calls')).length, set.cases.length);

    // The small-model guard.
    const small = spawnSync(process.execPath, ['--import', 'tsx', path.join(root, 'scripts', 'council-record.ts'), '--model', 'qwen2.5:7b'], { cwd: root, env: { ...process.env, DATA_DIR: path.join(work, 'data') }, encoding: 'utf8', timeout: 60_000 });
    assert.equal(small.status, 1);
    assert.match(small.stderr, /small model/);

    const s = await replayServer(out);
    try {
      const report = await regression(s.base, baseline.model);
      assert.deepEqual(s.replayLog().filter((l) => l.miss), []);
      assert.deepEqual(compareToBaseline(report, baseline).drift, []);
      // A question the recording never saw: not answered, and the replay log names the step and the changed line.
      const res = await fetch(`${s.base}/api/council/synthesise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: set.cases[0].question + ' Really?', answers: set.cases[0].answers, runtimeConfig: { providerMode: 'ollama', ollamaBaseUrl: 'http://recorded-ollama.test:11434', ollamaDeepModel: baseline.model } }),
      });
      const j = await res.json();
      assert.equal(j.brief ?? null, null);
      const miss = s.replayLog().find((l) => l.miss);
      assert.ok(miss, 'the unrecorded call is logged');
      assert.match(missText(miss), /Really\?/);
    } finally {
      s.stop();
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test(
  'the recorded real-model run replays exactly: same prompts, same answers, structural checks pass',
  { skip: recorded ? false : 'no real-model recording yet: run `npm run council:record` on the Mac (Ollama, qwen2.5:32b) and commit tests/fixtures/council-recorded/' },
  async (t) => {
    const baseline = JSON.parse(readFileSync(path.join(recDir, 'baseline.json'), 'utf8')) as RegressionBaseline;
    assert.ok(!isSmallModel(baseline.model), `the baseline was recorded on ${baseline.model}, a small model`);
    const s = await replayServer(recDir);
    try {
      const report = await regression(s.base, baseline.model);
      const misses = s.replayLog().filter((l) => l.miss);
      assert.equal(
        misses.length,
        0,
        `These model steps changed since the recording, so the recorded answers no longer apply. If the change is meant, run \`npm run council:record\` on the Mac and commit the new baseline.\n${misses.map(missText).join('\n')}`
      );
      const cmp = compareToBaseline(report, baseline);
      assert.deepEqual(cmp.drift, [], `The answers differ from the baseline recorded ${baseline.recordedAt} on ${baseline.model}.`);
      assert.deepEqual(cmp.newlyFailing, [], 'Cases that passed in the baseline now fail.');
      const byId = new Map(set.cases.map((c) => [c.id, c]));
      const problems = report.results.flatMap((r) => {
        const c = byId.get(r.id);
        return structuralProblems(r, c ? caseInputText(c) : [], isSmallModel);
      });
      assert.deepEqual(problems, []);
      if (cmp.knownFailing.length) t.diagnostic(`Known failing in the baseline (reported, not new): ${cmp.knownFailing.join(', ')}`);
    } finally {
      s.stop();
    }
  }
);
