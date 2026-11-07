/**
 * Records the council regression set on the real referee model, so CI can hold every later change
 * to it.
 *
 *   npm run council:record                      (Ollama at http://localhost:11434, your referee model)
 *   npm run council:record -- --model qwen2.5:32b
 *
 * Run on the Mac with Ollama open. It starts a private copy of the server on a spare port with an
 * empty data folder (your app, data and settings are not touched), runs every case in
 * docs/validation/council-regression/cases.json on the referee model at temperature 0 and seed 42,
 * and saves each model reply plus the report in tests/fixtures/council-recorded/. CI replays those
 * replies (tests/councilRecorded.test.ts): a change to a prompt, template or input that would alter
 * what the model is asked, or a change that alters the checked answers, fails the build until the
 * set is recorded again.
 *
 * This is how a new baseline is accepted: run it, read the answers it prints, and if they are right
 * send data/local/council-recording.zip in the project thread (or commit tests/fixtures/council-recorded/).
 *
 * The referee must be a large model: a model of 8B or less is refused. No feed is asked and no key
 * is used; the cases carry frozen inputs. Takes a few minutes on a 32B model.
 */
import { spawn, execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import type { RegressionBaseline, RegressionReport } from '../src/utils/councilRegression.ts';
import { DEFAULT_REFEREE_MODEL, isSmallModel, refereeModelOrDefault } from '../src/utils/refereeModel.ts';
import { loadWorkspace, workspaceFilePath } from '../src/utils/workspaceStore.ts';

const root = process.cwd();
const argModel = (() => {
  const i = process.argv.indexOf('--model');
  return i > 0 ? process.argv[i + 1] : undefined;
})();
const ollamaUrl = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '');

/** The referee model: --model, else the one saved under Settings > AI model, else the default. */
function savedReferee(): string | undefined {
  try {
    const raw = loadWorkspace(workspaceFilePath(process.env.DATA_DIR || path.join(root, 'data'))).values['econquest_ai_runtime_config_v1'];
    return raw ? refereeModelOrDefault(JSON.parse(raw)?.ollamaDeepModel) : undefined;
  } catch {
    return undefined;
  }
}
const model = argModel || savedReferee() || DEFAULT_REFEREE_MODEL;
if (isSmallModel(model)) {
  console.error(`${model} is a small model (8B or less). The regression baseline must come from the referee model; run with --model qwen2.5:32b.`);
  process.exit(1);
}

const work = mkdtempSync(path.join(tmpdir(), 'econquest-council-record-'));
const recordDir = path.join(work, 'rec');
const dataDir = path.join(work, 'data');
mkdirSync(dataDir, { recursive: true });
const port = 4900 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
Object.assign(env, {
  // RECORD_PRELOAD: a module loaded first (the self-check in CI records a stand-in model this way).
  NODE_OPTIONS: `${process.env.RECORD_PRELOAD ? `--import ${process.env.RECORD_PRELOAD} ` : ''}--import ${path.join(root, 'tests/helpers/model-record-fetch.mjs')}`,
  MODEL_RECORD_DIR: recordDir,
  DATA_DIR: dataDir,
  PORT: String(port),
  HOST: '127.0.0.1',
  NODE_ENV: 'production',
  CDS_FEED: 'off',
  GEMINI_API_KEY: '',
});
const runtimeConfig = { providerMode: 'ollama', ollamaBaseUrl: ollamaUrl, ollamaDeepModel: model };

console.log(`Recording the council regression set on ${model} (Ollama at ${ollamaUrl}; private server on port ${port})…`);
const server = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'server.ts')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout?.on('data', (d) => (log += d));
server.stderr?.on('data', (d) => (log += d));

let exitCode = 0;
try {
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (server.exitCode !== null) throw new Error(`The server stopped:\n${log.slice(-2000)}`);
    try {
      if ((await fetch(`${base}/api/ai/runtime-defaults`)).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error('The server did not start within 90 s.');
    await new Promise((r) => setTimeout(r, 500));
  }

  const status = await (await fetch(`${base}/api/ai/ollama-status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ollamaBaseUrl: ollamaUrl }) })).json();
  if (!status?.connected) throw new Error(`Ollama does not answer at ${ollamaUrl}. Open the Ollama app (or set OLLAMA_URL) and run this again.`);
  const pulled: string[] = status.models || [];
  if (!pulled.some((m) => m === model || m === `${model}:latest`)) throw new Error(`${model} is not downloaded. Run "ollama pull ${model}" and run this again.`);

  const r = await fetch(`${base}/api/council/regression`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runtimeConfig }) });
  const report = (await r.json().catch(() => ({}))) as RegressionReport & { error?: string };
  if (!r.ok) throw new Error(report?.error || `The app answered HTTP ${r.status}.`);
  if (report.results.some((x) => !x.model)) throw new Error(`No model answered for ${report.results.filter((x) => !x.model).map((x) => x.id).join(', ')}; nothing saved. ${report.results.find((x) => !x.model)?.failures[0] || ''}`);
  // The recorder saves each reply as its stream ends: wait until every answered case has one.
  const answered = report.results.filter((x) => x.model).length;
  const callCount = () => (existsSync(path.join(recordDir, 'calls')) ? readdirSync(path.join(recordDir, 'calls')).length : 0);
  for (const until = Date.now() + 30_000; callCount() < answered && Date.now() < until; ) await new Promise((r) => setTimeout(r, 250));
  await new Promise((r) => setTimeout(r, 500));

  let ollamaVersion: string | null = null;
  try {
    ollamaVersion = (await (await fetch(`${ollamaUrl}/api/version`, { signal: AbortSignal.timeout(3000) })).json())?.version ?? null;
  } catch {
    // not reachable from here, or an old Ollama
  }
  let commit: string | null = null;
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    // not a git checkout
  }
  const baseline: RegressionBaseline = { recordedAt: new Date().toISOString(), model, ollamaVersion, commit, report };

  // Into the repo copy (replacing any earlier recording).
  const out = process.env.COUNCIL_RECORD_OUT || path.join(root, 'tests', 'fixtures', 'council-recorded');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(path.join(out, 'calls'), { recursive: true });
  const calls = existsSync(path.join(recordDir, 'calls')) ? readdirSync(path.join(recordDir, 'calls')) : [];
  for (const f of calls) cpSync(path.join(recordDir, 'calls', f), path.join(out, 'calls', f));
  writeFileSync(path.join(out, 'index.json'), JSON.stringify({ recordedAt: baseline.recordedAt, model, ollamaVersion, commit, calls: calls.length }, null, 1));
  writeFileSync(path.join(out, 'baseline.json'), JSON.stringify(baseline, null, 1));

  const files: Record<string, Uint8Array> = {
    'council-recorded/index.json': readFileSync(path.join(out, 'index.json')),
    'council-recorded/baseline.json': readFileSync(path.join(out, 'baseline.json')),
  };
  for (const f of calls) files[`council-recorded/calls/${f}`] = readFileSync(path.join(out, 'calls', f));
  const zipPath = process.env.COUNCIL_RECORD_ZIP || path.join(process.env.DATA_DIR || path.join(root, 'data'), 'local', 'council-recording.zip');
  mkdirSync(path.dirname(zipPath), { recursive: true });
  writeFileSync(zipPath, zipSync(files, { level: 9 }));

  console.log('');
  for (const x of report.results) {
    console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.id} (${x.model})`);
    for (const line of x.answer ?? []) console.log(`      ${line}`);
    for (const f of x.failures) console.log(`      ! ${f}`);
  }
  console.log('');
  console.log(`${report.passed} of ${report.total} passed on ${model}${ollamaVersion ? ` (Ollama ${ollamaVersion})` : ''}. ${calls.length} model replies recorded.`);
  if (report.passed < report.total) console.log('Failing cases are kept in the baseline as known failures: CI reports them, and fails only if a case that passed starts failing.');
  console.log(`Saved in ${path.relative(root, out) || out}/ and ${zipPath}.`);
  console.log('If these answers are right, send that zip in the project thread to make them the new baseline.');
} catch (error: any) {
  console.error(error?.message || error);
  exitCode = 1;
} finally {
  server.kill();
  rmSync(work, { recursive: true, force: true });
}
process.exit(exitCode);
