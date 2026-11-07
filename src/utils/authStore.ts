/**
 * File storage for accounts and sessions (server only), under DATA_DIR/local/auth/:
 *   accounts.json  every account with its password hash (mode 600)
 *   sessions.json  signed-in sessions by token hash (mode 600), so a restart keeps people signed in
 * Neither file is ever part of a backup (src/utils/backup.ts lists what a backup holds).
 * See src/utils/auth.ts for the rules.
 */
import fs from 'fs';
import path from 'path';
import { writeFileAtomic } from './atomicWrite';
import {
  newSessionToken,
  sessionExpired,
  tokenHash,
  type Account,
  type Session,
  type SessionLimits,
} from './auth';

/** lastSeen is written to disk at most this often per session; in memory it is always current. */
const TOUCH_WRITE_MS = 5 * 60_000;

export class AuthStore {
  readonly dir: string;
  private accounts: Account[];
  private sessions: Map<string, Session>;
  private lastWrittenSeen = new Map<string, number>();
  private accountsMtime = 0;

  constructor(dataDir: string, private readonly limits: SessionLimits) {
    this.dir = path.join(dataDir, 'local', 'auth');
    this.accounts = this.loadAccounts();
    const list = this.readJson<Session[]>('sessions.json', []);
    this.sessions = new Map(list.filter((s) => s && typeof s.tokenHash === 'string').map((s) => [s.tokenHash, s]));
    for (const s of this.sessions.values()) this.lastWrittenSeen.set(s.tokenHash, s.lastSeen);
  }

  private file(name: string): string {
    return path.join(this.dir, name);
  }

  private readJson<T>(name: string, fallback: T): T {
    try {
      const v = JSON.parse(fs.readFileSync(this.file(name), 'utf8'));
      return Array.isArray(fallback) && !Array.isArray(v) ? fallback : (v as T);
    } catch {
      return fallback;
    }
  }

  private mtime(): number {
    try {
      return fs.statSync(this.file('accounts.json')).mtimeMs;
    } catch {
      return 0;
    }
  }

  private loadAccounts(): Account[] {
    this.accountsMtime = this.mtime();
    return this.readJson<Account[]>('accounts.json', []).filter((a) => a && typeof a.id === 'string' && typeof a.username === 'string');
  }

  /** Picks up changes made by `npm run users` while the server runs (a reset password, a disabled account). */
  private fresh(): Account[] {
    if (this.mtime() !== this.accountsMtime) this.accounts = this.loadAccounts();
    return this.accounts;
  }

  private saveAccounts(): void {
    writeFileAtomic(this.file('accounts.json'), JSON.stringify(this.accounts, null, 1), 0o600);
    this.accountsMtime = this.mtime();
  }

  private saveSessions(): void {
    const now = Date.now();
    for (const [k, s] of this.sessions) if (sessionExpired(s, this.limits, now)) this.sessions.delete(k);
    writeFileAtomic(this.file('sessions.json'), JSON.stringify([...this.sessions.values()]), 0o600);
    this.lastWrittenSeen = new Map([...this.sessions.values()].map((s) => [s.tokenHash, s.lastSeen]));
  }

  count(): number {
    return this.fresh().length;
  }

  activeAdminCount(): number {
    return this.fresh().filter((a) => a.role === 'admin' && !a.disabled).length;
  }

  list(): Account[] {
    return [...this.fresh()];
  }

  byId(id: string): Account | undefined {
    return this.fresh().find((a) => a.id === id);
  }

  byUsername(username: string): Account | undefined {
    return this.fresh().find((a) => a.username === username);
  }

  add(account: Account): void {
    if (this.byUsername(account.username)) throw new Error(`The username "${account.username}" is taken.`);
    this.accounts.push(account);
    this.saveAccounts();
  }

  update(id: string, change: (a: Account) => Account): Account {
    const i = this.fresh().findIndex((a) => a.id === id);
    if (i < 0) throw new Error('No such account.');
    this.accounts[i] = change(this.accounts[i]);
    this.saveAccounts();
    return this.accounts[i];
  }

  /** Starts a session and returns the cookie token (shown once, never stored). */
  startSession(accountId: string, now: number = Date.now()): string {
    const token = newSessionToken();
    const s: Session = { tokenHash: tokenHash(token), accountId, createdAt: now, lastSeen: now };
    this.sessions.set(s.tokenHash, s);
    this.saveSessions();
    return token;
  }

  /** The account behind a cookie token, or null (unknown, expired, or the account was disabled). */
  resolve(token: string | null, now: number = Date.now()): { account: Account; session: Session } | null {
    if (!token) return null;
    const key = tokenHash(token);
    const s = this.sessions.get(key);
    if (!s) return null;
    const account = this.byId(s.accountId);
    if (!account || account.disabled || sessionExpired(s, this.limits, now)) {
      this.sessions.delete(key);
      this.saveSessions();
      return null;
    }
    s.lastSeen = now;
    if (now - (this.lastWrittenSeen.get(key) ?? 0) > TOUCH_WRITE_MS) this.saveSessions();
    return { account, session: s };
  }

  endSession(token: string | null): void {
    if (!token) return;
    if (this.sessions.delete(tokenHash(token))) this.saveSessions();
  }

  /** Signs an account out everywhere, except the one session given (after a password change). */
  endSessionsFor(accountId: string, keepTokenHash?: string): number {
    let n = 0;
    for (const [k, s] of this.sessions) {
      if (s.accountId === accountId && k !== keepTokenHash) {
        this.sessions.delete(k);
        n++;
      }
    }
    if (n) this.saveSessions();
    return n;
  }

  sessionCountFor(accountId: string): number {
    return [...this.sessions.values()].filter((s) => s.accountId === accountId).length;
  }
}
