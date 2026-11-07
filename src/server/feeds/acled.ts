/**
 * ACLED conflict events per country, with the user's own ACLED account (src/utils/acled.ts).
 * Asked at most once a day per country, in the background: a served snapshot never waits for it.
 * Only the monthly counts are kept on disk (data/live/acled.json); the password and the access
 * token stay in memory and request bodies and headers only.
 */
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config';
import { writeFileAtomic } from '../../utils/atomicWrite';
import { describeNetworkError } from '../../utils/connectionCheck';
import { acledFileReading } from '../../utils/acledFiles';
import { acledFileData } from '../../utils/acledFileStore';
import { ACLED_NO_ACCOUNT, ACLED_NO_API, ACLED_TOKEN_URL, acledNextCursor, acledReadUrl, acledTokenBody, parseAcledPage, summariseAcled, type AcledReading, type AcledRow } from '../../utils/acled';

const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
const MAX_PAGES = 30;

type Store = Record<string, AcledReading>;
let store: Store | null = null;
const triedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();
/** Why the last pull for a country gave nothing, in words for the agent's Missing list. */
const lastProblem = new Map<string, string>();
let token: { value: string; expiresAt: number; account: string } | null = null;

function storeFile(): string {
  return path.join(DATA_DIR, 'live', 'acled.json');
}
function loadStore(): Store {
  if (store) return store;
  try {
    store = JSON.parse(fs.readFileSync(storeFile(), 'utf8')) as Store;
  } catch {
    store = {};
  }
  return store;
}
function saveStore(): void {
  try {
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
    writeFileAtomic(storeFile(), JSON.stringify(store || {}));
  } catch {
    // the memory copy serves until the next pull
  }
}

export function acledAccount(env = process.env): { email: string; password: string } | null {
  const email = (env.ACLED_EMAIL || '').trim();
  const password = env.ACLED_PASSWORD || '';
  return email && password ? { email, password } : null;
}

/** After the account changes: forget the token, the cached counts and the retry clock. */
export function forgetAcled(): void {
  token = null;
  store = {};
  triedAt.clear();
  lastProblem.clear();
  saveStore();
}

export class AcledRefused extends Error {
  constructor(public status: number, public stage: 'token' | 'read') {
    super(`ACLED refused the ${stage} request (HTTP ${status})`);
  }
}

export async function acledToken(acct: { email: string; password: string }, fetchFn: typeof fetch = fetch): Promise<string> {
  if (token && token.account === acct.email && Date.now() < token.expiresAt) return token.value;
  const res = await fetchFn(ACLED_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: acledTokenBody(acct.email, acct.password).toString(),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new AcledRefused(res.status, 'token');
  const j = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
  const value = typeof j.access_token === 'string' ? j.access_token : '';
  if (!value) throw new AcledRefused(res.status, 'token');
  const life = Number(j.expires_in) > 0 ? Number(j.expires_in) * 1000 : DAY_MS;
  token = { value, expiresAt: Date.now() + life - 5 * 60 * 1000, account: acct.email };
  return value;
}

/** Every row for one country over the look-back window, following the cursor. */
export async function pullAcledRows(country: string, bearer: string, fetchFn: typeof fetch = fetch, now = new Date()): Promise<AcledRow[]> {
  const rows: AcledRow[] = [];
  let cursor: string | number = 0;
  for (let i = 0; i < MAX_PAGES; i++) {
    const res = await fetchFn(acledReadUrl(country, now, cursor), { headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new AcledRefused(res.status, 'read');
    const json = await res.json();
    const page = parseAcledPage(json);
    if (!page) throw new AcledRefused(res.status, 'read');
    rows.push(...page);
    const next = acledNextCursor(json);
    if (!next || !page.length) break;
    cursor = next;
  }
  return rows;
}

async function pull(iso3: string, country: string): Promise<void> {
  const acct = acledAccount();
  if (!acct) return;
  triedAt.set(iso3, Date.now());
  try {
    const bearer = await acledToken(acct);
    const rows = await pullAcledRows(country, bearer);
    const reading = summariseAcled(rows, country, new Date().toISOString());
    const s = loadStore();
    if (reading) {
      s[iso3] = reading;
      lastProblem.delete(iso3);
    } else {
      delete s[iso3];
      lastProblem.set(iso3, `Missing: ACLED returned no events for ${country} in the last three years`);
    }
    saveStore();
  } catch (e) {
    if (e instanceof AcledRefused) {
      if (e.status === 401 || e.status === 400) token = null;
      lastProblem.set(iso3, e.stage === 'token' ? 'Missing: ACLED did not accept the email and password saved in Settings' : e.status === 403 ? ACLED_NO_API : `Missing: ACLED refused the request (HTTP ${e.status})`);
      console.warn(`[ACLED] ${country}: ${e.message}`);
    } else {
      lastProblem.set(iso3, 'Missing: ACLED did not answer');
      console.warn(`[ACLED] ${country}: ${describeNetworkError(e, 30000)}`);
    }
  }
}

/** The reading from an aggregated file in data/local/acled/, or null. A broken folder never stops the snapshot. */
function fileReading(countryName: string) {
  try {
    return acledFileReading(acledFileData(DATA_DIR), countryName);
  } catch (err: any) {
    console.warn(`[ACLED] could not read data/local/acled: ${err?.message || err}`);
    return null;
  }
}

/**
 * The saved reading for a country (or the reason it is missing), and a background pull when the
 * reading is a day old or absent. Never waits on the network. The API reading wins; without it
 * (no account, an Open account the API refuses, or a pull still running) an aggregated file you
 * downloaded into data/local/acled/ is used.
 */
export function acledReadingFor(iso3: string, countryName: string): { reading: AcledReading } | { missing: string } {
  const acct = acledAccount();
  if (!acct) {
    const fromFile = fileReading(countryName);
    return fromFile ? { reading: fromFile } : { missing: ACLED_NO_ACCOUNT };
  }
  const code = iso3.toUpperCase();
  const saved = loadStore()[code];
  const fresh = saved && Date.now() - Date.parse(saved.pulledAt) < DAY_MS;
  const recentlyTried = Date.now() - (triedAt.get(code) || 0) < RETRY_MS;
  if (!fresh && !recentlyTried && !inFlight.has(code)) {
    const job = pull(code, countryName).finally(() => inFlight.delete(code));
    inFlight.set(code, job);
  }
  if (saved) return { reading: saved };
  const fromFile = fileReading(countryName);
  if (fromFile) return { reading: fromFile };
  return { missing: lastProblem.get(code) || 'Missing: ACLED pull in progress; it fills in on the next refresh' };
}
