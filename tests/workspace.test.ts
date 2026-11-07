import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadWorkspace, setWorkspaceValue, workspaceFilePath, workspaceProblem, WORKSPACE_KEYS } from '../src/utils/workspaceStore';
import { mirrorSavesToDisk, planSync, startWorkspaceSync, SYNCED_KEYS } from '../src/utils/workspaceSync';

test('server and browser keep the same list of keys', () => {
  assert.deepEqual([...SYNCED_KEYS].sort(), Object.keys(WORKSPACE_KEYS).sort());
});

test('workspace file: saves, removes, ignores unknown keys, mode 600', () => {
  const file = workspaceFilePath(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-')));
  assert.deepEqual(loadWorkspace(file).values, {});
  setWorkspaceValue(file, 'econquest.holdings.v1', '[{"iso3":"BRA"}]', new Date('2026-11-05T15:00:00Z'));
  const w = loadWorkspace(file);
  assert.equal(w.values['econquest.holdings.v1'], '[{"iso3":"BRA"}]');
  assert.equal(w.updatedAt['econquest.holdings.v1'], '2026-11-05T15:00:00.000Z');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  setWorkspaceValue(file, 'econquest.holdings.v1', null);
  assert.deepEqual(loadWorkspace(file).values, {});
  fs.writeFileSync(file, JSON.stringify({ values: { other: 'x', sovereign_council_watchlists_v1: '[]' } }));
  assert.deepEqual(loadWorkspace(file).values, { sovereign_council_watchlists_v1: '[]' });
});

test('workspaceProblem refuses unknown keys, non-text, bad JSON and huge values', () => {
  assert.equal(workspaceProblem('econquest.holdings.v1', '[]'), null);
  assert.equal(workspaceProblem('econquest.holdings.v1', null), null);
  assert.match(workspaceProblem('__proto__', '[]') || '', /Unknown/);
  assert.match(workspaceProblem('econquest.holdings.v1', 5) || '', /text/);
  assert.match(workspaceProblem('econquest.holdings.v1', '{bad') || '', /JSON/);
  assert.match(workspaceProblem('econquest.holdings.v1', `"${'x'.repeat(2_000_001)}"`) || '', /large/);
});

test('planSync: disk wins; browser-only data goes to disk once', () => {
  const plan = planSync(
    { 'econquest.holdings.v1': '[1]', sovereign_council_watchlists_v1: '[2]' },
    { 'econquest.holdings.v1': '[old]', sovereign_council_watchlists_v1: '[2]', econquest_ai_runtime_config_v1: '{"a":1}', econquest_custom_sovereigns_v1: null }
  );
  assert.deepEqual(plan.toBrowser, { 'econquest.holdings.v1': '[1]' });
  assert.deepEqual(plan.toDisk, { econquest_ai_runtime_config_v1: '{"a":1}' });
});

function memoryStorage(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    map: m,
  };
}

test('startWorkspaceSync copies disk into the browser and sends browser-only data', async () => {
  const storage = memoryStorage({ econquest_custom_sovereigns_v1: '["PER"]' });
  const sent: Array<{ url: string; body: string }> = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      sent.push({ url, body: String(init.body) });
      return new Response('{}');
    }
    return new Response(JSON.stringify({ values: { 'econquest.holdings.v1': '[1]' } }));
  }) as unknown as typeof fetch;
  await startWorkspaceSync({ storage, fetchFn });
  assert.equal(storage.getItem('econquest.holdings.v1'), '[1]');
  assert.deepEqual(sent, [{ url: '/api/workspace/econquest_custom_sovereigns_v1', body: '{"value":"[\\"PER\\"]"}' }]);
});

test('startWorkspaceSync keeps the browser copy when the server cannot be reached', async () => {
  const storage = memoryStorage({ 'econquest.holdings.v1': '[9]' });
  const fetchFn = (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch;
  await startWorkspaceSync({ storage, fetchFn });
  assert.equal(storage.getItem('econquest.holdings.v1'), '[9]');
});

test('mirrorSavesToDisk sends later saves of synced keys only, once per burst', async () => {
  class FakeStorage {
    data = new Map<string, string>();
    getItem(k: string) {
      return this.data.has(k) ? this.data.get(k)! : null;
    }
    setItem(k: string, v: string) {
      this.data.set(k, v);
    }
    removeItem(k: string) {
      this.data.delete(k);
    }
  }
  const target = new FakeStorage();
  const sent: string[] = [];
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    sent.push(String(init?.body));
    return new Response('{}');
  }) as unknown as typeof fetch;
  mirrorSavesToDisk(FakeStorage.prototype as unknown as Storage, target as unknown as Storage, fetchFn, 10);
  target.setItem('econquest.holdings.v1', '[1]');
  target.setItem('econquest.holdings.v1', '[1,2]');
  target.setItem('theme', 'dark');
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(sent, ['{"value":"[1,2]"}']);
  target.removeItem('econquest.holdings.v1');
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(sent.at(-1), '{"value":null}');
});

test('a different account signing in on this browser starts from its own lists, not the last one', async () => {
  const { forgetOtherAccount, ACCOUNT_KEY } = await import('../src/utils/workspaceSync');
  const store = new Map<string, string>([['sovereign_council_watchlists_v1', '[1]'], ['econquest.holdings.v1', '[2]'], ['other', 'x']]);
  const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  assert.equal(forgetOtherAccount(s, 'acc-1'), true);
  assert.equal(store.has('sovereign_council_watchlists_v1'), false);
  assert.equal(store.get('other'), 'x', 'other storage untouched');
  assert.equal(store.get(ACCOUNT_KEY), 'acc-1');
  store.set('econquest.holdings.v1', '[3]');
  assert.equal(forgetOtherAccount(s, 'acc-1'), false, 'same account keeps its copy');
  assert.equal(store.get('econquest.holdings.v1'), '[3]');
});

test('per-account workspace files; the shared one seeds a new file once', async () => {
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const { seedWorkspace, userWorkspacePath, workspaceFilePath } = await import('../src/utils/workspaceStore');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  assert.throws(() => userWorkspacePath(dir, '../etc'), /Bad account id/);
  const shared = workspaceFilePath(dir);
  const mine = userWorkspacePath(dir, 'acc-1');
  assert.equal(seedWorkspace(shared, mine), false, 'nothing to copy');
  fs.mkdirSync(path.dirname(shared), { recursive: true });
  fs.writeFileSync(shared, '{"version":1,"values":{},"updatedAt":{}}');
  assert.equal(seedWorkspace(shared, mine), true);
  assert.equal(seedWorkspace(shared, mine), false, 'never overwrites');
});
