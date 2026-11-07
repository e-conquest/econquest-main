/**
 * Offline after a pull: the figures the app showed while the feeds answered are still shown, from
 * what it saved, once no feed answers. First the server reads the recorded feed replies
 * (tests/fixtures/recorded/) into a fresh data folder; then a second server on the same folder runs
 * with every feed failing. Every watchlist figure filled online must still be filled offline, with
 * the same value.
 *
 * Skipped (with a note) until a recording exists.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const recDir = path.join(root, 'tests', 'fixtures', 'recorded');
const indexFile = path.join(recDir, 'index.json');
const skip = existsSync(indexFile) ? false : 'no recorded feed replies yet: run `npm run record:feeds`';

/** Figures allowed to be Missing offline, each with its reason. */
const NOT_SAVED = new Set<string>([]);

type Row = Record<string, unknown> & { iso3: string };

async function watchlistFrom(helper: string, dataDir: string, rounds: number): Promise<Row[]> {
  const index = JSON.parse(readFileSync(indexFile, 'utf8'));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const [id, v] of Object.entries(index.keys || {})) env[id] = v === 'present' ? 'replay-key' : String(v);
  const port = 4700 + Math.floor(Math.random() * 200);
  Object.assign(env, { NODE_OPTIONS: `--import ${path.join(root, 'tests/helpers', helper)}`, REPLAY_DIR: recDir, DATA_DIR: dataDir, PORT: String(port), NODE_ENV: 'production', CDS_FEED: 'off', GEMINI_API_KEY: '' });
  const server = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'server.ts')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout?.on('data', (d) => (log += d));
  server.stderr?.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 60_000;
    for (;;) {
      if (server.exitCode !== null) throw new Error(`server exited early:\n${log}`);
      try {
        if ((await fetch(`${base}/api/ai/runtime-defaults`)).ok) break;
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) throw new Error(`server did not start:\n${log}`);
      await new Promise((r) => setTimeout(r, 300));
    }
    let items: Row[] = [];
    for (let i = 0; i < rounds; i++) {
      if (i) await new Promise((r) => setTimeout(r, 8_000)); // slow feeds fill their caches meanwhile
      const wl = await (await fetch(`${base}/api/data/watchlist-live${i ? '?refresh=1' : ''}`, { signal: AbortSignal.timeout(240_000) })).json();
      items = wl.items || [];
    }
    return items;
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 500));
  }
}

test('offline after a pull: every watchlist figure shown online is still shown, from the saved data', { skip, timeout: 400_000 }, async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'econquest-offline-saved-'));
  try {
    const online = await watchlistFrom('replay-fetch.mjs', dataDir, 3);
    const offline = await watchlistFrom('no-feeds-fetch.mjs', dataDir, 1);
    assert.ok(online.length >= 5, 'the recorded replies fill the watchlist');
    const filled = (o: Row) => Object.keys(o).filter((k) => o[k] !== null && o[k] !== undefined && !NOT_SAVED.has(k));
    const lost: string[] = [];
    const changed: string[] = [];
    for (const on of online) {
      const off = offline.find((r) => r.iso3 === on.iso3);
      if (!off) {
        lost.push(`${on.iso3}: whole row`);
        continue;
      }
      const have = new Set(filled(off));
      const gone = filled(on).filter((k) => !have.has(k));
      if (gone.length) lost.push(`${on.iso3}: ${gone.join(', ')}`);
      for (const k of filled(on)) if (typeof on[k] === 'number' && typeof off[k] === 'number' && on[k] !== off[k]) changed.push(`${on.iso3}.${k}: ${on[k]} online, ${off[k]} offline`);
    }
    assert.deepEqual(lost, [], `figures shown online but Missing offline (not saved to disk):\n${lost.join('\n')}`);
    assert.deepEqual(changed, [], `saved figures that changed value offline:\n${changed.join('\n')}`);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
