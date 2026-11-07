/**
 * Manage accounts from the server's own command line, for when nobody can sign in (a lost admin
 * password) or to script a first setup. Changes are picked up by a running app straight away.
 *
 *   npm run users -- list
 *   npm run users -- add-admin <username> "<Name shown>"     prints a new random password once
 *   npm run users -- reset-password <username>               prints a new random password once, signs them out
 *   npm run users -- disable <username>
 *   npm run users -- enable <username>
 *
 * Under Docker: docker compose exec econquest npm run users -- list
 * Uses DATA_DIR like the server (default ./data).
 */
import path from 'path';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { AuthStore } from '../src/utils/authStore';
import { displayNameProblem, hashPassword, newAccount, normaliseUsername, sessionLimits, usernameProblem } from '../src/utils/auth';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const store = new AuthStore(dataDir, sessionLimits(process.env));
const [cmd, rawUser, ...rest] = process.argv.slice(2);
const username = normaliseUsername(rawUser);

/** 20 characters from a 56-letter alphabet without look-alikes: about 116 bits. */
function randomPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(20);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function need(): ReturnType<AuthStore['byUsername']> & object {
  if (!username) fail('Give the username.');
  const a = store.byUsername(username);
  if (!a) fail(`No account "${username}". See: npm run users -- list`);
  return a;
}

switch (cmd) {
  case 'list': {
    const list = store.list();
    if (!list.length) console.log(`No accounts in ${store.dir}. Sign-in is off while the app answers on this computer only.`);
    for (const a of list) console.log(`${a.username.padEnd(24)} ${a.role.padEnd(8)} ${a.disabled ? 'disabled' : 'active  '} ${a.displayName}  (created ${a.createdAt.slice(0, 10)})`);
    break;
  }
  case 'add-admin': {
    const displayName = rest.join(' ').trim() || rawUser || '';
    const problem = usernameProblem(username) || displayNameProblem(displayName);
    if (problem) fail(problem);
    if (store.byUsername(username)) fail(`The username "${username}" is taken.`);
    const password = randomPassword();
    store.add(newAccount({ username, displayName, role: 'admin', password }));
    console.log(`Admin account "${username}" created. Password (shown once; change it under Menu > Account): ${password}`);
    break;
  }
  case 'reset-password': {
    const a = need();
    const password = randomPassword();
    store.update(a.id, (x) => ({ ...x, passwordHash: hashPassword(password), passwordChangedAt: new Date().toISOString() }));
    const n = store.endSessionsFor(a.id);
    console.log(`New password for "${a.username}" (shown once; change it under Menu > Account): ${password}${n ? `\nSigned out ${n} session(s).` : ''}`);
    break;
  }
  case 'disable':
  case 'enable': {
    const a = need();
    if (cmd === 'disable' && a.role === 'admin' && !a.disabled && store.activeAdminCount() <= 1) fail('That is the last active admin. Add another admin first.');
    store.update(a.id, (x) => ({ ...x, disabled: cmd === 'disable' }));
    if (cmd === 'disable') store.endSessionsFor(a.id);
    console.log(`Account "${a.username}" ${cmd}d.`);
    break;
  }
  default:
    console.log('Usage: npm run users -- list | add-admin <username> "<Name>" | reset-password <username> | disable <username> | enable <username>');
    process.exit(cmd ? 1 : 0);
}
