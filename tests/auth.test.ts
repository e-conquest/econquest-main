import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  authMode,
  hashPassword,
  newAccount,
  newSetupCode,
  openPath,
  passwordProblem,
  readCookie,
  sessionCookie,
  sessionExpired,
  sessionLimits,
  setupCodeMatches,
  SignInLimiter,
  usernameProblem,
  verifyPassword,
} from '../src/utils/auth';
import { AuthStore } from '../src/utils/authStore';

test('passwords are stored as salted scrypt hashes and checked exactly', () => {
  const h = hashPassword('correct horse battery staple');
  assert.match(h, /^scrypt\$16384\$8\$1\$/);
  assert.ok(!h.includes('horse'));
  assert.notEqual(h, hashPassword('correct horse battery staple'), 'a new salt each time');
  assert.equal(verifyPassword('correct horse battery staple', h), true);
  assert.equal(verifyPassword('correct horse battery stapl', h), false);
  assert.equal(verifyPassword('anything', 'garbage'), false);
  assert.equal(verifyPassword('anything', 'scrypt$999999999$8$1$AA==$AA=='), false, 'absurd cost refused');
});

test('password, username and setup code rules', () => {
  assert.match(passwordProblem('short') || '', /12 characters/);
  assert.match(passwordProblem('aaaaaaaaaaaaaaa') || '', /too few/);
  assert.match(passwordProblem('sam-is-my-password', 'sam') || '', /username/);
  assert.equal(passwordProblem('a long and boring sentence'), null);
  assert.equal(usernameProblem('sam.carus'), null);
  assert.ok(usernameProblem('Sam Carus'));
  assert.ok(usernameProblem('a'));
  const code = newSetupCode();
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(setupCodeMatches(code.toLowerCase().replace(/-/g, ' '), code), true);
  assert.equal(setupCodeMatches('AAAA-AAAA-AAAA', code), code === 'AAAA-AAAA-AAAA');
  assert.equal(setupCodeMatches(code, null), false);
});

test('sign-in is off on this computer with no accounts, set up when open to a network, required once an account exists', () => {
  assert.equal(authMode(0, {}), 'off');
  assert.equal(authMode(0, { HOST: '127.0.0.1' }), 'off');
  assert.equal(authMode(0, { HOST: '0.0.0.0' }), 'setup');
  assert.equal(authMode(0, { ALLOWED_HOSTS: 'my-mac.local' }), 'setup');
  assert.equal(authMode(0, { AUTH: 'on' }), 'setup');
  assert.equal(authMode(1, {}), 'required');
});

test('only the pages, sign-in calls and health checks are open without an account', () => {
  assert.equal(openPath('GET', '/'), true);
  assert.equal(openPath('GET', '/assets/index.js'), true);
  assert.equal(openPath('GET', '/healthz'), true);
  assert.equal(openPath('GET', '/readyz'), true);
  assert.equal(openPath('POST', '/api/auth/sign-in'), true);
  assert.equal(openPath('GET', '/api/settings/keys'), false);
  assert.equal(openPath('GET', '/api/audit'), false);
  assert.equal(openPath('POST', '/'), false);
});

test('session cookie is HttpOnly, SameSite and Secure behind HTTPS; cookies parse', () => {
  const c = sessionCookie('tok', { secure: true, maxAgeMs: 3600_000 });
  assert.match(c, /^eq_session=tok; Path=\/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure$/);
  assert.ok(!sessionCookie('tok', { secure: false, maxAgeMs: 1000 }).includes('Secure'));
  assert.equal(readCookie('a=1; eq_session=abc%2Fd; b=2', 'eq_session'), 'abc/d');
  assert.equal(readCookie('a=1', 'eq_session'), null);
});

test('sessions end after the idle time or the maximum age', () => {
  const limits = sessionLimits({ SESSION_IDLE_HOURS: '1', SESSION_MAX_DAYS: '2' });
  const now = 10 * 86400_000;
  assert.equal(sessionExpired({ tokenHash: 'x', accountId: 'a', createdAt: now - 1000, lastSeen: now - 1000 }, limits, now), false);
  assert.equal(sessionExpired({ tokenHash: 'x', accountId: 'a', createdAt: now - 1000, lastSeen: now - 2 * 3600_000 }, limits, now), true);
  assert.equal(sessionExpired({ tokenHash: 'x', accountId: 'a', createdAt: now - 3 * 86400_000, lastSeen: now }, limits, now), true);
});

test('wrong passwords lock one username after 5 tries for 15 minutes', () => {
  const l = new SignInLimiter();
  const t = 1_000_000;
  for (let i = 0; i < 5; i++) {
    assert.equal(l.waitSeconds('sam', '1.2.3.4', t), 0);
    l.failed('sam', '1.2.3.4', t);
  }
  assert.ok(l.waitSeconds('sam', '1.2.3.4', t) > 0);
  assert.equal(l.waitSeconds('ana', '5.6.7.8', t), 0, 'other users and addresses unaffected');
  assert.equal(l.waitSeconds('sam', '1.2.3.4', t + 15 * 60_000 + 1), 0);
});

test('the store keeps hashes only, survives a restart and ends sessions on request', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-'));
  const limits = sessionLimits({});
  const store = new AuthStore(dir, limits);
  const a = newAccount({ username: 'sam', displayName: 'Sam', role: 'admin', password: 'a long and boring sentence' });
  store.add(a);
  assert.throws(() => store.add({ ...a, id: 'other' }), /taken/);
  const token = store.startSession(a.id);
  const onDisk = fs.readFileSync(path.join(dir, 'local', 'auth', 'sessions.json'), 'utf8');
  assert.ok(!onDisk.includes(token), 'token itself never stored');
  assert.ok(!fs.readFileSync(path.join(dir, 'local', 'auth', 'accounts.json'), 'utf8').includes('boring'));
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'local', 'auth', 'accounts.json')).mode & 0o777, 0o600);

  const again = new AuthStore(dir, limits);
  assert.equal(again.resolve(token)?.account.username, 'sam');
  assert.equal(again.resolve('made-up'), null);

  // A change written by another process (npm run users) is picked up without a restart.
  const other = new AuthStore(dir, limits);
  other.update(a.id, (x) => ({ ...x, disabled: true }));
  const later = Date.now() + 10;
  fs.utimesSync(path.join(dir, 'local', 'auth', 'accounts.json'), later / 1000, later / 1000);
  assert.equal(again.resolve(token), null, 'disabled account signs out');

  const t2 = again.startSession(a.id);
  const t3 = again.startSession(a.id);
  assert.equal(again.endSessionsFor(a.id), 2);
  assert.equal(again.resolve(t2), null);
  assert.equal(again.resolve(t3), null);
});
