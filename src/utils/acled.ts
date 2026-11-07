/**
 * ACLED (Armed Conflict Location & Event Data) for the Politics & Events Agent, with the user's own
 * ACLED account (Menu > Settings > Data API keys: ACLED_EMAIL and ACLED_PASSWORD). Without an
 * account the conflict figures read Missing with that reason; nothing is built in.
 *
 * API contract (read 2026-11-06 from acleddata.com/api-documentation/getting-started and the
 * acledR package): OAuth password grant at https://acleddata.com/oauth/token (form fields
 * username, password, grant_type=password, client_id=acled, scope=authenticated) returns
 * {access_token, refresh_token, expires_in: 86400}. Data: GET https://acleddata.com/api/acled/read
 * with "Authorization: Bearer <token>", filters country=<name>, event_date=<from>|<to> with
 * event_date_where=BETWEEN, fields=a|b|c, limit, cursor (start at 0, follow next_cursor until null).
 * Reply {status: 200, data: [...], next_cursor}. API access needs a myACLED Research level or above:
 * an Open account (any public email such as gmail.com) gets aggregated downloads only, no API.
 *
 * The password and token are used only in request bodies and headers: never in URLs, logs,
 * snapshots, backups or the audit log. The token is kept in memory only.
 *
 * Only monthly counts per country are kept (no raw event rows), and every figure carries the
 * pull date and the window ACLED returned. Free ACLED accounts can lag recent months, so the
 * window shown is what came back, not what was asked for.
 */

export const ACLED_TOKEN_URL = 'https://acleddata.com/oauth/token';
export const ACLED_READ_URL = 'https://acleddata.com/api/acled/read';
export const ACLED_SHORT = 'ACLED conflict events';
export const ACLED_PAGE_ROWS = 5000;
/** Months asked for: three years, so an account whose access lags a year still gets twelve months. */
export const ACLED_LOOKBACK_MONTHS = 36;
export const ACLED_EVENT_TYPES = ['Battles', 'Violence against civilians', 'Explosions/Remote violence', 'Riots', 'Protests', 'Strategic developments'] as const;

/** Country names as ACLED spells them, where the app's name differs. */
const ACLED_NAME: Record<string, string> = {};

export function acledCountryName(iso3: string, appName: string): string {
  return ACLED_NAME[iso3] || appName.replace(/\s*\(.*\)\s*$/, '').trim();
}

/** Form body for the token request. The password goes only here. */
export function acledTokenBody(email: string, password: string): URLSearchParams {
  return new URLSearchParams({ username: email.trim(), password, grant_type: 'password', client_id: 'acled', scope: 'authenticated' });
}

/** First page: cursor 0; then the next_cursor of each reply until it is null (offset paging was retired 2026-10-27). */
export function acledReadUrl(country: string, now = new Date(), cursor: string | number = 0): string {
  const to = now.toISOString().slice(0, 10);
  const fromD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - ACLED_LOOKBACK_MONTHS, 1));
  const q = new URLSearchParams({
    _format: 'json',
    country,
    event_date: `${fromD.toISOString().slice(0, 10)}|${to}`,
    event_date_where: 'BETWEEN',
    fields: 'event_date|event_type|fatalities',
    limit: String(ACLED_PAGE_ROWS),
    cursor: String(cursor),
  });
  return `${ACLED_READ_URL}?${q.toString()}`;
}

export interface AcledRow {
  event_date: string;
  event_type: string;
  fatalities: number;
}

/** The cursor for the next page, or null on the last page. */
export function acledNextCursor(json: unknown): string | null {
  const c = (json as { next_cursor?: unknown })?.next_cursor;
  return c === null || c === undefined || c === '' ? null : String(c);
}

/** Rows from one reply page, or null when the reply is not an ACLED data reply. */
export function parseAcledPage(json: unknown): AcledRow[] | null {
  const j = json as { status?: unknown; data?: unknown };
  if (!j || !Array.isArray(j.data)) return null;
  if (j.status !== undefined && Number(j.status) !== 200) return null;
  const out: AcledRow[] = [];
  for (const r of j.data as Array<Record<string, unknown>>) {
    const d = String(r?.event_date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const f = Number(r?.fatalities ?? 0);
    out.push({ event_date: d, event_type: String(r?.event_type ?? 'Other'), fatalities: Number.isFinite(f) && f > 0 ? f : 0 });
  }
  return out;
}

export interface AcledMonth {
  month: string;
  events: number;
  fatalities: number;
  byType: Record<string, number>;
}

export interface AcledReading {
  pulledAt: string;
  country: string;
  /** Newest event date ACLED returned. */
  latestEventDate: string;
  /** The twelve whole months read, oldest first (the month of the newest event counts only when it is complete). */
  months: AcledMonth[];
  total: { events: number; fatalities: number; byType: Record<string, number>; from: string; to: string };
  /** Monthly average events, last three months against the nine before (both within the twelve). */
  recentAvg: number;
  priorAvg: number;
  /**
   * Set when the counts come from an aggregated file you downloaded from myACLED (data/local/acled/)
   * rather than the API. `pulledAt` is then the file's date on disk and `latestEventDate` the last
   * day of the newest week in the file.
   */
  fromFile?: { file: string };
}

export const addMonths = (ym: string, n: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

/**
 * Twelve whole months ending at the last complete month ACLED returned. A month with no events
 * inside the returned window counts as zero (ACLED lists events, not empty months). Null when no
 * rows came back.
 */
export function summariseAcled(rows: AcledRow[], country: string, pulledAt: string, now = new Date()): AcledReading | null {
  if (!rows.length) return null;
  const latest = rows.reduce((m, r) => (r.event_date > m ? r.event_date : m), rows[0].event_date);
  const thisMonth = now.toISOString().slice(0, 7);
  // The newest month is complete when ACLED has moved past it, or the calendar has.
  const latestMonth = latest.slice(0, 7);
  const end = latestMonth < thisMonth ? latestMonth : addMonths(thisMonth, -1);
  const byMonth = new Map<string, AcledMonth>();
  for (const r of rows) {
    const key = r.event_date.slice(0, 7);
    const m = byMonth.get(key) || { month: key, events: 0, fatalities: 0, byType: {} };
    m.events++;
    m.fatalities += r.fatalities;
    m.byType[r.event_type] = (m.byType[r.event_type] || 0) + 1;
    byMonth.set(key, m);
  }
  return acledReadingFromMonths(byMonth, country, pulledAt, latest, end);
}

/**
 * The reading for the twelve months ending at `end` ("YYYY-MM") from counts already grouped by
 * month. Months absent from `byMonth` count as zero. Null when the twelve months hold no events.
 */
export function acledReadingFromMonths(byMonth: Map<string, AcledMonth>, country: string, pulledAt: string, latestEventDate: string, end: string, fromFile?: AcledReading['fromFile']): AcledReading | null {
  const start = addMonths(end, -11);
  const months: AcledMonth[] = [];
  for (let i = 0; i < 12; i++) {
    const key = addMonths(start, i);
    const m = byMonth.get(key);
    months.push({ month: key, events: m?.events || 0, fatalities: m?.fatalities || 0, byType: { ...(m?.byType || {}) } });
  }
  const byType: Record<string, number> = {};
  for (const m of months) for (const [t, n] of Object.entries(m.byType)) byType[t] = (byType[t] || 0) + n;
  const events = months.reduce((s, m) => s + m.events, 0);
  if (!events) return null;
  const avg = (ms: AcledMonth[]) => Number((ms.reduce((s, m) => s + m.events, 0) / ms.length).toFixed(1));
  return {
    pulledAt,
    country,
    latestEventDate,
    months,
    total: { events, fatalities: months.reduce((s, m) => s + m.fatalities, 0), byType, from: start, to: end },
    recentAvg: avg(months.slice(9)),
    priorAvg: avg(months.slice(0, 9)),
    ...(fromFile ? { fromFile } : {}),
  };
}

/** Stated rule for the "rising" reading (a model reading on top of the counts). */
export const ACLED_RISING_RULE = 'rising when the last three months average at least 1.5 times the nine months before and at least 10 events a month';
export function acledRising(r: AcledReading): boolean {
  return r.recentAvg >= 10 && r.recentAvg >= 1.5 * Math.max(r.priorAvg, 0.1);
}

/** Months between the newest event and today; free accounts can lag. */
export function acledLagMonths(r: AcledReading, now = new Date()): number {
  const a = r.latestEventDate;
  return (now.getUTCFullYear() - Number(a.slice(0, 4))) * 12 + (now.getUTCMonth() + 1 - Number(a.slice(5, 7)));
}

/** "2026-03" -> "Mar 2026". */
export function acledMonthLabel(ym: string): string {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}

/** Reason shown when the conflict figures are missing. */
export const ACLED_NO_ACCOUNT = 'Missing: add your ACLED account (email and password) in Menu > Settings > Data API keys, or put an aggregated file downloaded from myACLED in data/local/acled/';
/** Reason when ACLED refuses the account's API access (Open level). */
export const ACLED_NO_API = 'Missing: ACLED did not allow API access for this account. Open accounts (public email such as gmail.com) get aggregated downloads only; the API needs the Research level, granted by ACLED\'s access team. An aggregated file downloaded from myACLED into data/local/acled/ works instead';
