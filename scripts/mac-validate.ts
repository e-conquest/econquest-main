/**
 * `npm run mac:validate`: runs the checks that only work on your Mac, one after the other, and
 * writes one report to send back:
 *
 *   data/local/validation/mac-validate-<time>.md
 *
 * Steps: data sources, pre-registered backtests, saved WEO editions, forecast evaluations,
 * currency signal tests, and the council regression on the real model (only when the app is
 * running). Each step still saves its own results as before. Keys never reach the report.
 *
 *   npm run mac:validate                      every step
 *   npm run mac:validate -- --skip council    leave steps out (data, backtest, weo, forecast, signals, council)
 *   npm run mac:validate -- --only data,signals
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { codeHash } from '../src/utils/codeHash';
import { parseValidateArgs, redact, renderReport, secretValues, stripAnsi, VALIDATE_STEPS, type StepResult, type ValidateEnv } from '../src/utils/macValidate';
import { loadSettings, settingsFilePath } from '../src/utils/userSettings';

dotenv.config();
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');

const opts = parseValidateArgs(process.argv.slice(2));
if (opts.unknown.length) {
  console.error(`Unknown step(s): ${opts.unknown.join(', ')}. Steps: ${VALIDATE_STEPS.map((s) => s.id).join(', ')}.`);
  process.exit(2);
}

// Keys saved in the app (Settings > API keys) and in .env are hidden from the report.
const savedKeys: string[] = [];
try {
  for (const v of Object.values(loadSettings(settingsFilePath(dataDir)).apiKeys || {})) if (typeof v === 'string') savedKeys.push(v);
} catch {
  /* no saved settings */
}
const secrets = secretValues(process.env, savedKeys);
const clean = (t: string) => redact(stripAnsi(t), secrets);

const git = (args: string[]): string => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).replace(/\s+$/, '');
  } catch {
    return '';
  }
};

async function findApp(): Promise<ValidateEnv['app']> {
  const local = codeHash(root);
  const urls = process.env.APP_URL ? [process.env.APP_URL] : ['http://127.0.0.1:3737', 'http://127.0.0.1:3000'];
  for (const url of urls) {
    try {
      const r = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(3000) });
      const j = (await r.json().catch(() => ({}))) as { code?: string };
      return { url, sameCode: local ? j.code === local : null };
    } catch {
      /* try the next */
    }
  }
  return null;
}

async function ollamaInfo(): Promise<ValidateEnv['ollama']> {
  const base = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
  try {
    const v = (await (await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(3000) })).json()) as { version?: string };
    const t = (await (await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) })).json()) as { models?: Array<{ name: string }> };
    return { version: v.version, models: (t.models || []).map((m) => m.name) };
  } catch (e) {
    return { models: [], error: `not reachable (${(e as Error).message}). Start the Ollama app (open -a Ollama); a Docker Ollama on 11434 is CPU-only.` };
  }
}

function runStep(npmArgs: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', npmArgs, { cwd: root, env: process.env });
    let output = '';
    const take = (b: Buffer) => {
      const s = b.toString();
      output += s;
      process.stdout.write(s);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (e) => {
      output += `\n${e.message}\n`;
      resolve({ code: -1, output });
    });
    child.on('close', (code) => resolve({ code, output }));
  });
}

const started = new Date();
const [app, ollama] = await Promise.all([findApp(), ollamaInfo()]);
const env: ValidateEnv = {
  ranAt: started.toISOString(),
  commit: git(['rev-parse', '--short', 'HEAD']).trim() || 'unknown',
  dirty: git(['status', '--porcelain']).split('\n').filter(Boolean).map((l) => l.slice(3)),
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  app,
  ollama,
};
if (app?.sameCode === false) console.log(`WARNING: the app at ${app.url} runs older or different code than this folder. Run npm run update first for a council result that tests this code.\n`);

const results: StepResult[] = [];
for (const step of VALIDATE_STEPS) {
  if (!opts.steps.includes(step)) {
    results.push({ id: step.id, title: step.title, status: 'skipped', ms: 0, reason: 'left out on the command line', output: '' });
    continue;
  }
  if (step.needsApp && !app) {
    results.push({ id: step.id, title: step.title, status: 'skipped', ms: 0, reason: 'the app is not running; start it with start-mac.command or npm run dev', output: '' });
    continue;
  }
  console.log(`\n=== ${step.title} ===\n`);
  const t0 = Date.now();
  const { code, output } = await runStep(step.npm);
  results.push({ id: step.id, title: step.title, status: code === 0 ? 'ok' : 'failed', code, ms: Date.now() - t0, output: clean(output), hint: step.hint });
}

const outDir = path.join(dataDir, 'local', 'validation');
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `mac-validate-${started.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.md`);
fs.writeFileSync(file, renderReport(env, results));
console.log('');
for (const r of results) console.log(`${r.status === 'ok' ? 'ok     ' : r.status === 'failed' ? 'FAILED ' : 'skipped'}  ${r.title}${r.reason ? ` (${r.reason})` : ''}`);
console.log(`\nReport: ${path.relative(root, file)}\nSend that file in the project thread.`);
process.exitCode = results.some((r) => r.status === 'failed') ? 1 : 0;
