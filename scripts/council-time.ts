/**
 * Times a full council report on your own app, step by step, and prints a table to paste.
 *
 *   npm run council:time                       (Brazil, the app at http://127.0.0.1:3000)
 *   npm run council:time -- --country MEX
 *   npm run council:time -- --url http://127.0.0.1:3737 --country TUR   (the Docker app)
 *
 * With sign-in on (an account exists), set ECONQUEST_USER and ECONQUEST_PASSWORD and it signs in first.
 * The default is 127.0.0.1, not localhost: the app listens on IPv4 and Node may try localhost as IPv6 (::1).
 *
 * Start the app first (Docker or `npm run dev`) with Ollama open. It runs exactly what the
 * "Run the full council" button runs, with the AI settings saved in the app: country data, the
 * three desks (nine agents), web search, the cascade, then approves the desk results unchanged and
 * runs the supreme council (the referee). Then it times one Council chat answer (the summary step)
 * on the first regression question, so you can compare the two.
 *
 * Nothing is estimated: every number is measured by the server on this run (src/utils/councilTiming.ts).
 * The run is a real run: it appears in the server log and data/local/council-timing.jsonl, and it
 * replaces the latest council result for that country in the open app. No setting is changed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { formatDuration, isCouncilTiming, slowestStep, timingTable, totalMs, type CouncilTiming } from '../src/utils/councilTiming.ts';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const base = (arg('url') || process.env.APP_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
let cookie = '';

/** "connect ECONNREFUSED ::1:3000" rather than "fetch failed". */
const why = (e: any) => [e?.message, e?.cause?.code, e?.cause?.message].filter(Boolean).join(': ') || String(e);
const iso3 = (arg('country') || 'BRA').toUpperCase();

async function post(route: string, body: unknown): Promise<{ status: number; json: any; ms: number }> {
  const t0 = Date.now();
  const r = await fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json, ms: Date.now() - t0 };
}

function describeConfig(cfg: any): string {
  const mode = cfg.providerMode || 'gemini';
  if (mode === 'gemini') return 'Gemini (gemini-3.8-flash)';
  return `${mode} at ${cfg.ollamaBaseUrl || 'the default address'}; desks on ${cfg.ollamaQuickModel || 'qwen2.5:7b (default)'}, referee ${cfg.ollamaDeepModel || 'qwen2.5:32b (default)'}; timeout ${cfg.timeoutSeconds ? `${cfg.timeoutSeconds}s` : 'default'}`;
}

function printTiming(t: CouncilTiming) {
  console.log(timingTable(t));
  const slow = slowestStep(t);
  if (slow) console.log(`\nSlowest step: ${slow.label}, ${formatDuration(slow.ms)} of ${formatDuration(totalMs(t))}.`);
  const noModel = t.steps.filter((s) => s.outcome === 'no_model');
  if (noModel.length) console.log(`No model answered ${noModel.length} step(s): ${noModel.map((s) => s.label).join(', ')}. Those times are how long the app waited before giving up, not how long the model needs.`);
}

async function main() {
  try {
    const h = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(5000) });
    if (!h.ok) throw new Error(`HTTP ${h.status}`);
  } catch (e) {
    console.error(`The app did not answer at ${base} (${why(e)}). Start it first (Docker or npm run dev), or pass --url (Docker: --url http://127.0.0.1:3737).`);
    process.exit(1);
  }
  let wsRes = await fetch(`${base}/api/workspace`);
  if (wsRes.status === 401) {
    const username = process.env.ECONQUEST_USER;
    const password = process.env.ECONQUEST_PASSWORD;
    if (!username || !password) {
      console.error('Sign-in is on for this app. Run with your account: ECONQUEST_USER=you ECONQUEST_PASSWORD=… npm run council:time');
      process.exit(1);
    }
    const s = await fetch(`${base}/api/auth/sign-in`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (!s.ok) {
      console.error(`Sign-in refused: ${(await s.json().catch(() => ({})))?.error || `HTTP ${s.status}`}`);
      process.exit(1);
    }
    cookie = String(s.headers.get('set-cookie') || '').split(';')[0];
    wsRes = await fetch(`${base}/api/workspace`, { headers: { Cookie: cookie } });
  }
  if (!wsRes.ok) {
    console.error(`The app answered HTTP ${wsRes.status} for its saved settings: ${(await wsRes.json().catch(() => ({})))?.error || ''}`);
    process.exit(1);
  }
  const ws: any = await wsRes.json();
  let runtimeConfig: any = {};
  try {
    runtimeConfig = JSON.parse(ws?.values?.econquest_ai_runtime_config_v1 || '{}');
  } catch {
    // no saved AI settings: the server's defaults apply
  }
  console.log(`econquest council timing · ${new Date().toISOString()}`);
  console.log(`App ${base} · country ${iso3} · AI: ${describeConfig(runtimeConfig)}\n`);

  // 1. Full council, phase 1: data, desks, search, cascade.
  const progressId = `time-${Date.now().toString(36)}`;
  console.log('Running the full council (desks, then the referee). This can take several minutes…');
  const p1 = await post('/api/council/phase1-and-cascade', { iso3, countryName: iso3, progressId, runtimeConfig });
  if (p1.status !== 200 || !p1.json?.run) {
    console.log(`\nThe council stopped after ${formatDuration(p1.ms)}: ${p1.json?.error || `HTTP ${p1.status}`}`);
    if (isCouncilTiming(p1.json?.timing)) printTiming(p1.json.timing);
    process.exitCode = 1;
  } else {
    // 2. Approve the desk results unchanged, then the supreme council (referee).
    const run = p1.json.run;
    const p2 = await post('/api/council/supreme-council', { run, croOverrideState: run.croState, progressId, runtimeConfig });
    console.log('\nFULL COUNCIL REPORT');
    if (isCouncilTiming(p2.json?.run?.timing)) printTiming(p2.json.run.timing);
    else if (isCouncilTiming(run.timing)) {
      console.log(`The final step did not finish (${p2.json?.error || `HTTP ${p2.status}`}, after ${formatDuration(p2.ms)}). Desks only:`);
      printTiming(run.timing);
      process.exitCode = 1;
    } else console.log('This app version does not record timings yet: git pull and restart it.');
    console.log(`Wall clock seen by this script: ${formatDuration(p1.ms + p2.ms)} (approval was instant).`);
  }

  // 3. One Council chat answer: the agents are rule-based, so this is the summary step on the referee.
  const cases = JSON.parse(readFileSync(path.join(process.cwd(), 'docs/validation/council-regression/cases.json'), 'utf8')).cases;
  const c = cases[0];
  const chat = await post('/api/council/synthesise', { question: c.question, answers: c.answers, runtimeConfig });
  console.log('\nCOUNCIL CHAT ANSWER (summary step only)');
  console.log(`"${c.question}": ${formatDuration(chat.ms)} on ${chat.json?.snapshot?.model || chat.json?.provider || 'no model'}${chat.json?.brief ? '' : ` · no summary (${chat.json?.reason || `HTTP ${chat.status}`})`}`);
  console.log('\nPaste everything above into the project thread.');
}

main().catch((e) => {
  console.error(`council:time failed: ${why(e)}`);
  process.exit(1);
});
