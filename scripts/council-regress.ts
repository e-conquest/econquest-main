/**
 * `npm run council:regress`: runs the council regression set (docs/validation/council-regression/)
 * through the running app, on the AI model set under Menu > Settings > AI model, and prints each
 * case. The app must be running (Docker: http://127.0.0.1:3737; `npm run dev`: http://127.0.0.1:3000;
 * or set APP_URL). The report is saved in data/local/validation/council-regression.json and each case
 * is an answer snapshot you can open and re-run. Exits 1 when a case fails.
 *
 * When a recorded baseline exists (tests/fixtures/council-recorded/baseline.json, made by
 * `npm run council:record`), each answer is also compared with it, so a model or Ollama update that
 * changes the answers shows up here.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { compareToBaseline, type RegressionBaseline, type RegressionReport } from '../src/utils/councilRegression';
import { codeHash } from '../src/utils/codeHash';

const candidates = process.env.APP_URL ? [process.env.APP_URL] : ['http://127.0.0.1:3737', 'http://127.0.0.1:3000'];
let report: RegressionReport | null = null;
let lastError = '';
// Set when the running app's code differs from this folder's (an old Docker build, or a dev server not restarted after a pull).
let staleApp: string | null = null;
const localCode = codeHash(process.cwd());
for (const base of candidates) {
  let health: { code?: string } = {};
  try {
    health = await (await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(3000) })).json().catch(() => ({}));
  } catch {
    lastError = `no app at ${base}`;
    continue;
  }
  if (localCode && health.code !== localCode) {
    const how = base.endsWith(':3737') ? 'rebuild the Docker app (double-click start-mac.command, or `docker compose up -d --build econquest`)' : 'stop `npm run dev` and start it again';
    staleApp = `The app at ${base} is running ${health.code ? 'different code from' : 'code older than'} this folder, so its answers do not test what you pulled. To fix: ${how}, then run this again.`;
    console.log(`WARNING: ${staleApp}`);
  }
  console.log(`Running the council regression set on the app at ${base} (each case waits for the referee model)...`);
  const r = await fetch(`${base}/api/council/regression`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error(j?.error || `The app answered HTTP ${r.status}.`);
    process.exit(1);
  }
  report = j as RegressionReport;
  break;
}
if (!report) {
  console.error(`Start the app first (${lastError}). Set APP_URL if it runs elsewhere.`);
  process.exit(1);
}
console.log(`Model: ${report.model || 'none answered'} · set v${report.setVersion} (${report.setHash.slice(0, 12)})`);
for (const r of report.results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}: ${r.headline || '(no answer)'}${r.snapshotId ? `  [${r.snapshotId}]` : ''}`);
  for (const f of r.failures) console.log(`      ${f}`);
}
console.log(`${report.passed} of ${report.total} passed. Saved in data/local/validation/council-regression.json.`);
const baselineFile = path.join(process.cwd(), 'tests', 'fixtures', 'council-recorded', 'baseline.json');
if (existsSync(baselineFile)) {
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8')) as RegressionBaseline;
  const cmp = compareToBaseline(report, baseline);
  console.log('');
  if (!cmp.drift.length) console.log(`Same answers as the recorded baseline (${baseline.model}, ${baseline.recordedAt.slice(0, 10)}).`);
  else {
    console.log(`Differs from the recorded baseline (${baseline.model}, ${baseline.recordedAt.slice(0, 10)}):`);
    for (const d of cmp.drift) console.log(`  ${d}`);
    if (!staleApp) console.log('If the new answers are right, run `npm run council:record` and send the zip it makes in the project thread.');
  }
} else {
  console.log('No recorded baseline yet: run `npm run council:record` to make one.');
}
if (staleApp) console.log(`\nWARNING: ${staleApp}`);
process.exit(report.passed === report.total ? 0 : 1);
