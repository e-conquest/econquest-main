/**
 * Replays the feed replies recorded on a computer that reached the feeds (`npm run record:feeds`,
 * saved in tests/fixtures/recorded/) through the real server, and checks the app still reads from
 * them everything it read when they were recorded: each source connected then is connected now,
 * and each watchlist and country figure filled then is filled now. A source that changed its
 * format shows up here, with the source named, before anyone sees Missing in the app.
 *
 * Skipped (with a note) until a recording exists.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { maskUrl, sharedParams, urlStem } from './helpers/feedRecording.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const recDir = process.env.REPLAY_DIR || path.join(root, 'tests', 'fixtures', 'recorded');
const indexFile = path.join(recDir, 'index.json');
const recorded = existsSync(indexFile);
const skip = recorded ? false : 'no recorded feed replies yet: run `npm run record:feeds` on a computer that reaches the feeds';

test('recording helpers: keys never reach the stored URL, and moved ranges still match', () => {
  assert.equal(maskUrl('https://api.stlouisfed.org/fred/series/observations?series_id=X1&api_key=abc123&file_type=json'), 'https://api.stlouisfed.org/fred/series/observations?series_id=X1&api_key=X&file_type=json');
  assert.equal(maskUrl('https://comtradeapi.un.org/data/v1/get?subscription-key=zzz&reporterCode=76'), 'https://comtradeapi.un.org/data/v1/get?subscription-key=X&reporterCode=76');
  assert.equal(maskUrl('https://user:pw@example.org/a?token=t'), 'https://example.org/a?token=X');
  assert.equal(urlStem('https://stats.bis.org/api/v1/data/WS_CBPOL/M.BR?startPeriod=2023-11'), 'https://stats.bis.org/api/v1/data/WS_CBPOL/M.BR');
  assert.equal(sharedParams('https://x.org/a?f=json&start=2023-11', 'https://x.org/a?f=json&start=2023-12'), 1);
});

let server: ChildProcess | undefined;
let dataDir = '';
let log = '';
const port = 4300 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;
const index = recorded ? JSON.parse(readFileSync(indexFile, 'utf8')) : null;

before(async () => {
  if (!recorded) return;
  dataDir = mkdtempSync(path.join(tmpdir(), 'econquest-replay-'));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  // The same keys as at recording time: real values for settings (series codes), stand-ins for secrets.
  for (const [id, v] of Object.entries(index.keys || {})) env[id] = v === 'present' ? 'replay-key' : String(v);
  Object.assign(env, {
    NODE_OPTIONS: `--import ${path.join(root, 'tests/helpers/replay-fetch.mjs')}`,
    REPLAY_DIR: recDir,
    DATA_DIR: dataDir,
    PORT: String(port),
    NODE_ENV: 'production',
    CDS_FEED: 'off',
    GEMINI_API_KEY: '',
  });
  server = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'server.ts')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout?.on('data', (d) => (log += d));
  server.stderr?.on('data', (d) => (log += d));
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (server.exitCode !== null) throw new Error(`server exited early:\n${log}`);
    try {
      if ((await fetch(`${base}/api/ai/runtime-defaults`)).ok) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`server did not start within 60s:\n${log}`);
    await new Promise((r) => setTimeout(r, 300));
  }
});

after(() => {
  server?.kill();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

const get = async (p: string) => (await fetch(`${base}${p}`, { signal: AbortSignal.timeout(240_000) })).json();
const filled = (o: Record<string, unknown>) => Object.keys(o).filter((k) => o[k] !== null && o[k] !== undefined);
const notRecorded = () => [...new Set(log.split('\n').filter((l) => l.startsWith('[replay-fetch] not recorded')))].slice(0, 40).join('\n');

test('recorded replies: every source connected at recording is still read as connected', { skip, timeout: 300_000 }, async () => {
  const report = await get('/api/data/connections?refresh=1');
  const now = Object.fromEntries((report.results || []).map((r: { id: string; state: string; detail: string }) => [r.id, r]));
  const lost = Object.entries(index.expected.connections as Record<string, string>)
    .filter(([id, state]) => state === 'connected' && now[id]?.state !== 'connected')
    .map(([id]) => `${id}: now ${now[id]?.state || 'absent'} (${now[id]?.detail || ''})`);
  assert.deepEqual(lost, [], `sources no longer read from their recorded replies:\n${lost.join('\n')}\n${notRecorded()}`);
});

test('recorded replies: every country figure live at recording is still live', { skip, timeout: 300_000 }, async () => {
  // Same order as the recording: snapshots first, which the watchlist then reads from the cache.
  await get('/api/data/watchlist-live');
  const lost: string[] = [];
  for (const [iso3, keys] of Object.entries(index.expected.snapshots as Record<string, string[]>)) {
    const s = await get(`/api/data/sovereign-snapshot?iso3=${iso3}&refresh=1`);
    const have = new Set(Object.keys(s?.snapshot?.liveFields || {}));
    const gone = keys.filter((k) => !have.has(k));
    if (gone.length) lost.push(`${iso3}: ${gone.join(', ')}`);
  }
  assert.deepEqual(lost, [], `country figures no longer live from the recorded replies:\n${lost.join('\n')}\n${notRecorded()}`);
});

const RETIRED_WATCHLIST_FIELDS = new Set(['compositeRisk', 'geopoliticalRisk', 'sovereignRisk', 'macroRisk', 'alertStatus', 'riskSource']);

test('recorded replies: every watchlist figure filled at recording is still filled', { skip, timeout: 300_000 }, async () => {
  // Paced background feeds (UN Comtrade, about one request every 2 s) fill the cache in their own
  // time, so ask again until every figure is back or two minutes pass.
  const deadline = Date.now() + 120_000;
  let lost: string[] = [];
  for (;;) {
    const wl = await get('/api/data/watchlist-live?refresh=1');
    const rows = Object.fromEntries((wl.items || []).map((it: { iso3: string }) => [it.iso3, it]));
    lost = [];
    for (const [iso3, keys] of Object.entries(index.expected.watchlist as Record<string, string[]>)) {
      const have = new Set(rows[iso3] ? filled(rows[iso3]) : []);
      // The composite risk score was retired (never registered or tested), so its fields are no longer made.
      const gone = keys.filter((k) => !have.has(k) && !RETIRED_WATCHLIST_FIELDS.has(k));
      if (gone.length) lost.push(`${iso3}: ${gone.join(', ')}`);
    }
    if (!lost.length || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  assert.deepEqual(lost, [], `watchlist figures no longer filled from the recorded replies:\n${lost.join('\n')}\n${notRecorded()}`);
});
