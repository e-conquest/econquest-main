/**
 * Records what every free feed really sends, so CI can test the parsers against it.
 *
 *   npm run record:feeds
 *
 * Run on a computer that reaches the feeds (your Mac). It starts a private copy of the server on a
 * spare port with an empty data folder, asks it for the connection check, the watchlist and five
 * country snapshots, and saves every feed reply (gzipped) in tests/fixtures/recorded/, with what
 * the app made of each. Then `npm test` replays them (tests/recorded.test.ts): if a source changes
 * its format, a test fails before you see Missing in the app.
 *
 * - Free keys you saved (FRED, EIA, UN Comtrade, EVDS, Banxico) are used, but never written: keys are taken
 *   out of every URL, and the file lists only which keys were present.
 * - Your own paid data (CDS file, LSEG) and the AI model are switched off for the run, so nothing
 *   licensed to you is recorded.
 * - Takes a few minutes. Also writes data/local/recorded-feeds.zip to send in the project thread.
 */
import dotenv from 'dotenv';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import { API_KEY_FIELDS } from '../src/data/apiKeyFields.ts';
import { applyKeysToEnv, envKeySnapshot, loadSettings, settingsFilePath } from '../src/utils/userSettings.ts';

dotenv.config();
const root = process.cwd();
const COUNTRIES = ['BRA', 'MEX', 'TUR', 'ZAF', 'POL'];
/** Free keys only; paid data and AI stay off. */
const FREE_KEYS = ['FRED_API_KEY', 'EIA_API_KEY', 'COMTRADE_API_KEY', 'EVDS_API_KEY', 'EVDS_TR10Y_SERIES', 'EVDS_TR_CPI_SERIES', 'BANXICO_TOKEN'];

const env: Record<string, string | undefined> = { ...process.env };
applyKeysToEnv(env, envKeySnapshot(process.env), loadSettings(settingsFilePath(process.env.DATA_DIR || path.join(root, 'data'))));
const keys: Record<string, string> = {};
for (const id of FREE_KEYS) {
  const v = env[id];
  if (!v) continue;
  const field = API_KEY_FIELDS.find((f) => f.id === id);
  keys[id] = field && field.secret === false ? v : 'present';
}

const work = mkdtempSync(path.join(tmpdir(), 'econquest-record-'));
const recordDir = path.join(work, 'rec');
const dataDir = path.join(work, 'data');
mkdirSync(dataDir, { recursive: true });
const port = 4600 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;

const childEnv: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) childEnv[k] = v;
for (const f of API_KEY_FIELDS) delete childEnv[f.id];
for (const id of FREE_KEYS) if (env[id]) childEnv[id] = env[id]!;
Object.assign(childEnv, {
  // RECORD_PRELOAD: another module to load first (the self-check runs the recorder over the offline fixtures).
  NODE_OPTIONS: `${process.env.RECORD_PRELOAD ? `--import ${process.env.RECORD_PRELOAD} ` : ''}--import ${path.join(root, 'tests/helpers/record-fetch.mjs')}`,
  RECORD_DIR: recordDir,
  DATA_DIR: dataDir,
  PORT: String(port),
  HOST: '127.0.0.1',
  NODE_ENV: 'production',
  CDS_FEED: 'off',
  DEFAULT_AI_PROVIDER: 'none',
});

console.log(`Recording feed replies (server on port ${port}, keys used: ${Object.keys(keys).join(', ') || 'none'})…`);
const server = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'server.ts')], { cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout?.on('data', (d) => (log += d));
server.stderr?.on('data', (d) => (log += d));

async function get(p: string, timeoutMs = 300_000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${p}`, { signal: ctl.signal });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Fields a watchlist row or snapshot actually filled (missing figures come back as null). */
function filled(o: Record<string, unknown>): string[] {
  return Object.keys(o)
    .filter((k) => o[k] !== null && o[k] !== undefined && !(typeof o[k] === 'number' && !Number.isFinite(o[k] as number)))
    .sort();
}

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

  console.log('1/3 connection check…');
  const report = await get('/api/data/connections?refresh=1');
  const connections: Record<string, string> = {};
  for (const r of report.results || []) if (r.group !== 'ai') connections[r.id] = r.state;

  // Snapshots first, for every watchlist country: the watchlist reads them from the cache, so asking
  // for it before they exist would record a race, not what the feeds sent.
  const warm = await get('/api/data/watchlist-live');
  const countries = [...new Set([...COUNTRIES, ...(warm.items || []).map((it: { iso3: string }) => it.iso3)])];
  console.log(`2/3 country snapshots (${countries.join(', ')})…`);
  const snapshots: Record<string, string[]> = {};
  for (const iso3 of countries) {
    const s = await get(`/api/data/sovereign-snapshot?iso3=${iso3}&refresh=1`);
    snapshots[iso3] = Object.keys(s?.snapshot?.liveFields || {}).sort();
  }

  console.log('3/3 watchlist…');
  const wl = await get('/api/data/watchlist-live?refresh=1');
  const watchlist: Record<string, string[]> = {};
  for (const it of wl.items || []) watchlist[it.iso3] = filled(it);

  // One entry per distinct request (the last reply wins).
  const lines = readFileSync(path.join(recordDir, 'requests.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const requests = [...new Map(lines.map((l) => [`${l.method} ${l.url}`, l])).values()];
  const used = new Set(requests.map((r) => r.body).filter(Boolean));
  const index = { recordedAt: new Date().toISOString(), countries, keys, expected: { connections, watchlist, snapshots }, requests };

  // Into the repo copy: tests/fixtures/recorded/ (replacing any earlier recording).
  const out = path.join(root, 'tests', 'fixtures', 'recorded');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(path.join(out, 'bodies'), { recursive: true });
  for (const name of readdirSync(path.join(recordDir, 'bodies'))) if (used.has(name)) cpSync(path.join(recordDir, 'bodies', name), path.join(out, 'bodies', name));
  writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 1));

  // And one zip to send in the project thread.
  const files: Record<string, Uint8Array> = { 'recorded/index.json': readFileSync(path.join(out, 'index.json')) };
  for (const name of used) files[`recorded/bodies/${name}`] = readFileSync(path.join(out, 'bodies', name));
  const zipPath = path.join(process.env.DATA_DIR || path.join(root, 'data'), 'local', 'recorded-feeds.zip');
  mkdirSync(path.dirname(zipPath), { recursive: true });
  writeFileSync(zipPath, zipSync(files, { level: 0 }));

  const ok = Object.values(connections).filter((s) => s === 'connected').length;
  const bytes = [...used].reduce((n, name) => n + readFileSync(path.join(out, 'bodies', name)).length, 0);
  console.log(`\nRecorded ${requests.length} replies (${(bytes / 1e6).toFixed(1)} MB gzipped); ${ok} of ${Object.keys(connections).length} sources connected.`);
  console.log(`Saved in tests/fixtures/recorded/ and ${path.relative(root, zipPath)}.`);
  console.log('Send the zip in the project thread (or commit the folder); `npm test` then replays it.');
} finally {
  server.kill();
  if (existsSync(work)) rmSync(work, { recursive: true, force: true });
}
