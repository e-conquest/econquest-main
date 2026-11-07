/**
 * Sign-in against the real server.ts (feeds replaced by fixtures, nothing leaves this machine):
 * AUTH=on with no accounts, so the server starts in set-up mode and prints a one-time code.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 4400 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
let server: ChildProcess;
let dataDir: string;
let log = '';

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'econquest-auth-test-'));
  // What the single user had saved before accounts: the first admin starts from it.
  mkdirSync(path.join(dataDir, 'local'), { recursive: true });
  writeFileSync(path.join(dataDir, 'local', 'workspace.json'), JSON.stringify({ version: 1, values: { 'econquest.holdings.v1': '[{"iso3":"BRA"}]' }, updatedAt: {} }));
  server = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'server.ts')], {
    cwd: root,
    env: {
      ...process.env,
      NODE_OPTIONS: `--import ${path.join(root, 'tests/helpers/offline-fetch.mjs')}`,
      NODE_ENV: 'production',
      PORT: String(port),
      DATA_DIR: dataDir,
      AUTH: 'on',
      TRUST_PROXY: '1',
      ECONQUEST_SECRET_KEY: 'test-master-key-that-is-long-enough-1234',
      GEMINI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (d) => (log += d));
  server.stderr?.on('data', (d) => (log += d));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`server exited early:\n${log}`);
    try {
      if ((await fetch(`${base}/healthz`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server did not start within 60s:\n${log}`);
});

after(() => {
  server?.kill();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

/** The CSRF token for a session, as the page gets it from /api/auth/status. */
const csrfCache = new Map<string, string>();
async function csrfFor(cookie: string): Promise<string> {
  if (!csrfCache.has(cookie)) {
    const s = await (await fetch(`${base}/api/auth/status`, { headers: { Cookie: cookie } })).json();
    csrfCache.set(cookie, s.csrfToken || '');
  }
  return csrfCache.get(cookie)!;
}
const write = async (method: string, p: string, body: unknown, cookie = '', csrf = true) =>
  fetch(`${base}${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(cookie && csrf ? { 'X-CSRF-Token': await csrfFor(cookie) } : {}),
    },
    body: JSON.stringify(body),
  });
const post = (p: string, body: unknown, cookie = '') => write('POST', p, body, cookie);
const cookieOf = (res: Response) => (res.headers.get('set-cookie') || '').split(';')[0];

let adminCookie = '';
const PASSWORD = 'a long and boring sentence';

test('with no accounts, nothing but the setup works, and setup needs the code from the log', async () => {
  const status = await (await fetch(`${base}/api/auth/status`)).json();
  assert.equal(status.mode, 'setup');
  assert.equal(status.setupNeedsCode, true);
  assert.equal((await fetch(`${base}/api/settings/keys`)).status, 401);
  assert.equal((await fetch(`${base}/api/audit`)).status, 401);
  assert.equal((await fetch(`${base}/healthz`)).status, 200);

  const code = log.match(/setup code: ([A-Z0-9-]+)/)?.[1];
  assert.ok(code, 'setup code printed in the server log');
  const wrong = await post('/api/auth/setup', { code: 'AAAA-BBBB-CCCC', username: 'sam', displayName: 'Sam', password: PASSWORD });
  assert.equal(wrong.status, 403);
  const weak = await post('/api/auth/setup', { code, username: 'sam', displayName: 'Sam', password: 'short' });
  assert.equal(weak.status, 400);
  const ok = await post('/api/auth/setup', { code, username: 'sam', displayName: 'Sam', password: PASSWORD });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie') || '', /HttpOnly; SameSite=Lax/);
  adminCookie = cookieOf(ok);
  const again = await post('/api/auth/setup', { code, username: 'eve', displayName: 'Eve', password: PASSWORD });
  assert.equal(again.status, 409, 'only one first account');
});

test('signed in, the API answers; signed out, it refuses', async () => {
  const me = await (await fetch(`${base}/api/auth/status`, { headers: { Cookie: adminCookie } })).json();
  assert.equal(me.mode, 'required');
  assert.equal(me.account.username, 'sam');
  assert.equal(me.account.role, 'admin');
  assert.equal(me.account.passwordHash, undefined);
  assert.equal((await fetch(`${base}/api/audit`, { headers: { Cookie: adminCookie } })).status, 200);
  assert.equal((await fetch(`${base}/api/audit`)).status, 401);
  assert.equal((await fetch(`${base}/api/audit`, { headers: { Cookie: 'eq_session=forged' } })).status, 401);
});

test('wrong passwords are refused, then locked out; the right one signs in', async () => {
  const bad = await post('/api/auth/sign-in', { username: 'sam', password: 'not the password at all' });
  assert.equal(bad.status, 401);
  const good = await post('/api/auth/sign-in', { username: 'sam', password: PASSWORD });
  assert.equal(good.status, 200);
  const c = cookieOf(good);
  assert.equal((await fetch(`${base}/api/audit`, { headers: { Cookie: c } })).status, 200);
  const out = await post('/api/auth/sign-out', {}, c);
  assert.equal(out.status, 200);
  assert.equal((await fetch(`${base}/api/audit`, { headers: { Cookie: c } })).status, 401, 'signed-out session is dead');
  for (let i = 0; i < 5; i++) await post('/api/auth/sign-in', { username: 'nobody', password: 'wrong wrong wrong' });
  assert.equal((await post('/api/auth/sign-in', { username: 'nobody', password: 'wrong wrong wrong' })).status, 429);
});

test('changing the password signs out other sessions and is in the audit log without the password', async () => {
  const other = cookieOf(await post('/api/auth/sign-in', { username: 'sam', password: PASSWORD }));
  const res = await post('/api/auth/password', { current: PASSWORD, next: 'an even longer and more boring sentence' }, adminCookie);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).endedSessions, 1);
  assert.equal((await fetch(`${base}/api/audit`, { headers: { Cookie: other } })).status, 401);
  assert.equal((await fetch(`${base}/api/audit`, { headers: { Cookie: adminCookie } })).status, 200);
  const raw = readFileSync(path.join(dataDir, 'local', 'audit', 'audit-log.jsonl'), 'utf8');
  assert.match(raw, /Created the first admin account: Sam \(sam\)/);
  assert.match(raw, /Failed sign-in for \\"sam\\"/);
  assert.match(raw, /Changed own password: Sam \(sam\)/);
  assert.ok(!raw.includes('boring'), 'no password in the log');
  assert.ok(!raw.includes(adminCookie.split('=')[1]), 'no session token in the log');
});

const put = (p: string, body: unknown, cookie: string) => write('PUT', p, body, cookie);

test('roles: the admin adds accounts; viewers only read, analysts cannot touch keys, users or the audit log', async () => {
  const addA = await post('/api/users', { username: 'ana', displayName: 'Ana', role: 'analyst' }, adminCookie);
  assert.equal(addA.status, 200);
  const a = await addA.json();
  assert.match(a.password, /^[A-Za-z0-9]{20}$/, 'random password shown once');
  const addV = await (await post('/api/users', { username: 'vic', displayName: 'Vic', role: 'viewer' }, adminCookie)).json();
  const ana = cookieOf(await post('/api/auth/sign-in', { username: 'ana', password: a.password }));
  const vic = cookieOf(await post('/api/auth/sign-in', { username: 'vic', password: addV.password }));

  assert.equal((await fetch(`${base}/api/workspace`, { headers: { Cookie: vic } })).status, 200, 'viewer reads');
  const vw = await post('/api/research/docs', { title: 'x' }, vic);
  assert.equal(vw.status, 403);
  assert.match((await vw.json()).error, /Viewer/);
  assert.equal((await post('/api/users', { username: 'x1', displayName: 'X', role: 'admin' }, vic)).status, 403);

  assert.equal((await fetch(`${base}/api/settings/keys`, { headers: { Cookie: ana } })).status, 200, 'analyst sees masked keys');
  const keys = await (await fetch(`${base}/api/settings/keys`, { headers: { Cookie: ana } })).json();
  assert.equal(keys.canEdit, false);
  assert.equal((await put('/api/settings/keys/FRED_API_KEY', { value: 'abcdefabcdefabcdefabcdefabcdefab' }, ana)).status, 403);
  assert.equal((await fetch(`${base}/api/audit`, { headers: { Cookie: ana } })).status, 403);
  assert.equal((await fetch(`${base}/api/users`, { headers: { Cookie: ana } })).status, 403);
  assert.equal((await fetch(`${base}/api/backup/download`, { headers: { Cookie: ana } })).status, 403);
  assert.equal((await fetch(`${base}/api/settings/keys`, { headers: { Cookie: adminCookie } }).then((r) => r.json())).canEdit, true);

  // The last admin cannot be demoted or disabled; disabling signs the person out.
  const users = (await (await fetch(`${base}/api/users`, { headers: { Cookie: adminCookie } })).json()).accounts as Array<{ id: string; username: string }>;
  const samId = users.find((u) => u.username === 'sam')!.id;
  const vicId = users.find((u) => u.username === 'vic')!.id;
  assert.equal((await put(`/api/users/${samId}`, { role: 'analyst' }, adminCookie)).status, 409);
  assert.equal((await put(`/api/users/${vicId}`, { disabled: true }, adminCookie)).status, 200);
  assert.equal((await fetch(`${base}/api/workspace`, { headers: { Cookie: vic } })).status, 401);
  assert.equal((await post('/api/auth/sign-in', { username: 'vic', password: addV.password })).status, 401);

  const raw = readFileSync(path.join(dataDir, 'local', 'audit', 'audit-log.jsonl'), 'utf8');
  assert.match(raw, /Sam \(sam\) added the account Ana \(ana\) as analyst/);
  assert.match(raw, /changed the account vic: disabled/);
  assert.ok(!raw.includes(a.password) && !raw.includes(addV.password), 'new passwords never logged');
});

test('changes need the CSRF token of their own session; replies carry security headers', async () => {
  const c = cookieOf(await post('/api/auth/sign-in', { username: 'sam', password: 'an even longer and more boring sentence' }));
  const none = await write('PUT', '/api/watch-rules', { rules: [] }, c, false);
  assert.equal(none.status, 403);
  assert.equal((await none.json()).csrf, true);
  const wrong = await fetch(`${base}/api/watch-rules`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: c, 'X-CSRF-Token': await csrfFor(adminCookie) }, body: '{"rules":[]}' });
  assert.equal(wrong.status, 403, "another session's token does not work");
  assert.equal((await write('PUT', '/api/watch-rules', { rules: [] }, c)).status, 200);
  const res = await fetch(`${base}/api/auth/status`);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('audit entries name the account that acted, including generic route entries', async () => {
  const c = cookieOf(await post('/api/auth/sign-in', { username: 'sam', password: 'an even longer and more boring sentence' }));
  assert.equal((await write('PUT', '/api/watch-rules', { rules: [] }, c)).status, 200);
  await new Promise((r) => setTimeout(r, 200));
  const lines = readFileSync(path.join(dataDir, 'local', 'audit', 'audit-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const last = lines.filter((e) => e.summary === 'Changed the watch alerts').pop();
  assert.deepEqual(last.by && { username: last.by.username, name: last.by.name }, { username: 'sam', name: 'Sam' });
  const audit = await (await fetch(`${base}/api/audit`, { headers: { Cookie: c } })).json();
  assert.equal(audit.check.ok, true, 'chain still checks with names in it');
});

test('each account has its own workspace; the first admin kept the single user\'s', async () => {
  const sam = cookieOf(await post('/api/auth/sign-in', { username: 'sam', password: 'an even longer and more boring sentence' }));
  const ws = await (await fetch(`${base}/api/workspace`, { headers: { Cookie: sam } })).json();
  assert.equal(ws.values['econquest.holdings.v1'], '[{"iso3":"BRA"}]');
  assert.equal(ws.perAccount, true);
  const added = await (await post('/api/users', { username: 'wes', displayName: 'Wes', role: 'viewer' }, sam)).json();
  const wes = cookieOf(await post('/api/auth/sign-in', { username: 'wes', password: added.password }));
  assert.deepEqual((await (await fetch(`${base}/api/workspace`, { headers: { Cookie: wes } })).json()).values, {}, 'new account starts empty');
  assert.equal((await put('/api/workspace/sovereign_council_watchlists_v1', { value: '[{"id":"w","name":"Mine","items":[]}]' }, wes)).status, 200, 'viewer keeps own lists');
  assert.equal((await (await fetch(`${base}/api/workspace`, { headers: { Cookie: sam } })).json()).values.sovereign_council_watchlists_v1, undefined, "not in Sam's");
  const shared = JSON.parse(readFileSync(path.join(dataDir, 'local', 'workspace.json'), 'utf8'));
  assert.equal(shared.values.sovereign_council_watchlists_v1, undefined, 'shared file untouched');
});

test('a key saved in Settings is encrypted on disk with the master key from the environment', async () => {
  const sam = cookieOf(await post('/api/auth/sign-in', { username: 'sam', password: 'an even longer and more boring sentence' }));
  const res = await put('/api/settings/keys/FRED_API_KEY', { value: 'abcdefabcdefabcdefabcdefabcdefab' }, sam);
  assert.equal(res.status, 200);
  const raw = readFileSync(path.join(dataDir, 'local', 'settings.json'), 'utf8');
  assert.ok(!raw.includes('abcdefabcdef'), 'no plain key on disk');
  assert.match(raw, /enc:v1:/);
  const keys = await (await fetch(`${base}/api/settings/keys`, { headers: { Cookie: sam } })).json();
  assert.equal(keys.encryption.atRest, true);
  assert.equal(keys.encryption.keyFrom, 'ECONQUEST_SECRET_KEY');
  assert.ok(!JSON.stringify(keys).includes('test-master-key'), 'master key never sent');
  assert.equal(keys.keys.find((k: { id: string }) => k.id === 'FRED_API_KEY').source, 'app');
});

test('behind an HTTPS proxy (TRUST_PROXY=1) the cookie is Secure and HSTS is sent', async () => {
  const res = await fetch(`${base}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '203.0.113.9' },
    body: JSON.stringify({ username: 'sam', password: 'an even longer and more boring sentence' }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie') || '', /; Secure/);
  assert.equal(res.headers.get('strict-transport-security'), 'max-age=31536000');
  const plain = await post('/api/auth/sign-in', { username: 'sam', password: 'an even longer and more boring sentence' });
  assert.ok(!(plain.headers.get('set-cookie') || '').includes('Secure'), 'plain HTTP keeps a cookie the browser will send');
  assert.equal(plain.headers.get('strict-transport-security'), null);
});
