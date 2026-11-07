/**
 * Accounts and sign-in (Sam, 2026-11-06): local accounts with a password, so the app can be opened
 * to more than one person and a name in it belongs to a verified account, not to typed text.
 *
 * - Passwords are stored only as scrypt hashes (node:crypto, salted, compared in constant time).
 * - A session is a random token in an HttpOnly cookie; the server keeps only the token's SHA-256,
 *   so a copy of the sessions file cannot be used to sign in.
 * - Each account records its provider ("local" for now), so a Google or Microsoft sign-in can be
 *   added later without changing how accounts are stored.
 *
 * When sign-in applies (authMode):
 *   - 'off': no accounts yet and the app answers on this computer only. Everything works as before
 *     and the first admin account can be created from Menu > Account.
 *   - 'setup': no accounts yet, but the app is open to a network (HOST set to a network address, or
 *     ALLOWED_HOSTS listed) or AUTH=on. Nothing works until the first admin account is made, and
 *     making it needs the one-time setup code printed in the server log, so nobody else on the
 *     network can claim the app first.
 *   - 'required': at least one account exists. Every page and API call needs a signed-in account.
 *
 * Server-only (uses node:crypto). The browser imports types only.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

export type Role = 'admin' | 'analyst' | 'viewer';
export const ROLES: Role[] = ['admin', 'analyst', 'viewer'];

export interface Account {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  /** 'local' = password kept here. Room for 'oidc' accounts later. */
  provider: 'local';
  passwordHash: string;
  createdAt: string;
  passwordChangedAt: string;
  disabled?: boolean;
}

/** What the browser may see about an account: never the hash. */
export interface PublicAccount {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  provider: 'local';
  createdAt: string;
  disabled: boolean;
}

export interface Session {
  /** SHA-256 of the cookie token, hex. The token itself is never stored. */
  tokenHash: string;
  accountId: string;
  createdAt: number;
  lastSeen: number;
}

export type AuthMode = 'off' | 'setup' | 'required';

export const SESSION_COOKIE = 'eq_session';
/** A session ends after this long without use (SESSION_IDLE_HOURS, default 12). */
export const DEFAULT_IDLE_HOURS = 12;
/** And in any case this long after sign-in (SESSION_MAX_DAYS, default 7). */
export const DEFAULT_MAX_DAYS = 7;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 200;

const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 32 };

export function hashPassword(password: string, salt: Buffer = randomBytes(16)): string {
  const key = scryptSync(password.normalize('NFKC'), salt, SCRYPT.keyLen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const want = Buffer.from(keyB64, 'base64');
  const N = Number(n);
  if (!want.length || !Number.isInteger(N) || N < 1024 || N > 1 << 20) return false;
  try {
    const got = scryptSync(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64'), want.length, {
      N,
      r: Number(r),
      p: Number(p),
      maxmem: 256 * N * Number(r) + 1024 * 1024,
    });
    return got.length === want.length && timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

/** A hash to compare against when the username is unknown, so a wrong name takes as long as a wrong password. */
export const DUMMY_HASH = hashPassword('not-a-real-password-' + randomBytes(8).toString('hex'));

export function passwordProblem(password: unknown, username?: string): string | null {
  const p = typeof password === 'string' ? password : '';
  if (p.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters (a short sentence is easiest to remember).`;
  if (p.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (username && p.toLowerCase().includes(username.toLowerCase())) return 'The password may not contain the username.';
  if (new Set(p).size < 5) return 'That password repeats too few characters.';
  return null;
}

export function normaliseUsername(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

export function usernameProblem(username: string): string | null {
  if (!/^[a-z0-9][a-z0-9._-]{1,39}$/.test(username)) return 'Use 2 to 40 letters, digits, dots, dashes or underscores, starting with a letter or digit.';
  return null;
}

export function displayNameProblem(name: string): string | null {
  if (!name.trim()) return 'Enter the name to show on sign-offs and in the audit log.';
  if (name.trim().length > 80) return 'Use at most 80 characters for the name.';
  if (/[\u0000-\u001f<>]/.test(name)) return 'The name may not contain < > or control characters.';
  return null;
}

export function publicAccount(a: Account): PublicAccount {
  return { id: a.id, username: a.username, displayName: a.displayName, role: a.role, provider: a.provider, createdAt: a.createdAt, disabled: Boolean(a.disabled) };
}

export function newAccount(input: { username: string; displayName: string; role: Role; password: string }, now: Date = new Date()): Account {
  const at = now.toISOString();
  return {
    id: randomBytes(9).toString('base64url'),
    username: input.username,
    displayName: input.displayName.trim(),
    role: input.role,
    provider: 'local',
    passwordHash: hashPassword(input.password),
    createdAt: at,
    passwordChangedAt: at,
  };
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(String(token)).digest('hex');
}

export interface SessionLimits {
  idleMs: number;
  maxMs: number;
}

export function sessionLimits(env: Record<string, string | undefined>): SessionLimits {
  const idleH = Number(env.SESSION_IDLE_HOURS);
  const maxD = Number(env.SESSION_MAX_DAYS);
  return {
    idleMs: (Number.isFinite(idleH) && idleH > 0 ? Math.min(idleH, 24 * 30) : DEFAULT_IDLE_HOURS) * 3600_000,
    maxMs: (Number.isFinite(maxD) && maxD > 0 ? Math.min(maxD, 90) : DEFAULT_MAX_DAYS) * 86400_000,
  };
}

export function sessionExpired(s: Session, limits: SessionLimits, now: number = Date.now()): boolean {
  return now - s.lastSeen > limits.idleMs || now - s.createdAt > limits.maxMs;
}

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\])$/i;

/** Whether the server was opened to a network on purpose (HOST set to a non-local address, or ALLOWED_HOSTS listed). */
export function openToNetwork(env: Record<string, string | undefined>): boolean {
  const host = String(env.HOST || '').trim();
  if (host && !LOOPBACK.test(host)) return true;
  return String(env.ALLOWED_HOSTS || '').trim() !== '';
}

export function authMode(accountCount: number, env: Record<string, string | undefined>): AuthMode {
  if (accountCount > 0) return 'required';
  const forced = String(env.AUTH || '').trim().toLowerCase() === 'on';
  return forced || openToNetwork(env) ? 'setup' : 'off';
}

/**
 * Whether a request may go ahead without a signed-in account while sign-in applies. The web pages
 * themselves load (they show the sign-in form), as do the sign-in calls and the health check.
 * Everything else under /api needs an account.
 */
export function openPath(method: string, pathname: string): boolean {
  const p = pathname.split('?')[0];
  if (p === '/healthz' || p === '/readyz') return true;
  if (p.startsWith('/api/auth/')) return true;
  if (!p.startsWith('/api/') && p !== '/api') return method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD';
  return false;
}

/** One-time setup code, e.g. "7KQM-4XDP-WN2C": 60 bits, no look-alike letters. */
export function newSetupCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += alphabet[bytes[i] % alphabet.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

export function setupCodeMatches(given: unknown, code: string | null): boolean {
  if (!code) return false;
  const norm = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const a = Buffer.from(norm(typeof given === 'string' ? given : ''));
  const b = Buffer.from(norm(code));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Reads one cookie from a Cookie header. */
export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function sessionCookie(token: string, opts: { secure: boolean; maxAgeMs: number }): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(opts.maxAgeMs / 1000)}`,
    ...(opts.secure ? ['Secure'] : []),
  ].join('; ');
}

export function clearedSessionCookie(secure: boolean): string {
  return [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', ...(secure ? ['Secure'] : [])].join('; ');
}

/**
 * Sign-in attempt limiter: after 5 wrong passwords for one username, or 20 from one address, within
 * 15 minutes, further attempts are refused until the window passes. Kept in memory (a restart
 * clears it, which is fine for a home or office server).
 */
export class SignInLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly perUser = 5,
    private readonly perAddress = 20,
    private readonly windowMs = 15 * 60_000
  ) {}

  private recent(key: string, now: number): number[] {
    const list = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  /** Seconds to wait, or 0 when an attempt may be made. */
  waitSeconds(username: string, address: string, now: number = Date.now()): number {
    const u = this.recent(`u:${username}`, now);
    const a = this.recent(`a:${address}`, now);
    const blocked = [u.length >= this.perUser ? u[0] : null, a.length >= this.perAddress ? a[0] : null].filter((t): t is number => t !== null);
    if (!blocked.length) return 0;
    return Math.ceil((Math.max(...blocked) + this.windowMs - now) / 1000);
  }

  failed(username: string, address: string, now: number = Date.now()): void {
    for (const key of [`u:${username}`, `a:${address}`]) this.hits.set(key, [...this.recent(key, now), now]);
  }

  succeeded(username: string): void {
    this.hits.delete(`u:${username}`);
  }
}
