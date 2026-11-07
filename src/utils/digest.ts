/**
 * Weekly digest: what moved on the watchlist since your last visit, in one list. Built only from
 * live figures and their own dates: policy rate moves (BIS), new monthly inflation prints, turns
 * in the OECD leading indicator's phase, 10Y yield moves of 25 bp or more, and watch alerts that
 * started firing. The figures at each visit are kept in this browser to compare against.
 *
 * Browser-safe (storage helpers guard against blocked storage).
 */
import type { LiveWatchlistItem } from '../types/council';

export const DIGEST_KEY = 'econquest.digest.lastVisit.v1';
/** A 10Y move at least this large (percentage points) is listed. */
export const YIELD_MOVE_PTS = 0.25;
/** On a first visit, policy moves this many days back are listed. */
export const FIRST_VISIT_DAYS = 30;

export interface VisitFacts {
  policyRatePct?: number;
  cpiMonth?: string;
  cpiPct?: number;
  cliPhase?: string;
  cliMonth?: string;
  yield10YPct?: number;
}

export interface DigestVisit {
  savedAt: string;
  rows: Record<string, VisitFacts>;
  /** Watch alerts firing at that visit, as "ruleId|iso3". */
  alerts?: string[];
}

export type DigestKind = 'policy' | 'inflation' | 'cycle' | 'yield' | 'alert';

export interface DigestItem {
  kind: DigestKind;
  iso3: string;
  countryName: string;
  text: string;
  /** The date or month the change is dated by. */
  when: string;
  source: string;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** What is recorded for a row at a visit: live figures only. */
export function factsFor(it: LiveWatchlistItem): VisitFacts {
  return {
    ...(it.policyRateSource === 'bis' && num(it.policyRatePct) !== undefined ? { policyRatePct: it.policyRatePct } : {}),
    ...(it.oecdCpi ? { cpiMonth: it.oecdCpi.month, cpiPct: it.oecdCpi.yoyPct } : {}),
    ...(it.oecdCli?.phase ? { cliPhase: it.oecdCli.phase, cliMonth: it.oecdCli.month } : {}),
    ...(it.yield10YSource === 'official' && num(it.yield10YPct) !== undefined ? { yield10YPct: it.yield10YPct } : {}),
  };
}

const p2 = (v: number) => `${v.toFixed(2)}%`;
const p1 = (v: number) => `${v.toFixed(1)}%`;

/** The digest against the last visit (or, on a first visit, recent policy moves only). */
export function buildDigest(
  items: LiveWatchlistItem[],
  last: DigestVisit | null,
  alertsNow: Array<{ key: string; iso3: string; countryName: string; text: string }> = [],
  now = new Date()
): DigestItem[] {
  const out: DigestItem[] = [];
  const since = last ? last.savedAt.slice(0, 10) : new Date(now.getTime() - FIRST_VISIT_DAYS * 864e5).toISOString().slice(0, 10);
  for (const it of items) {
    const prev = last?.rows[it.iso3];
    const cur = factsFor(it);
    // Policy moves dated after the last visit (the BIS history carries each move's month or day).
    // A rate unchanged since the last visit lists no move, even if one fell earlier the same month.
    const unchanged = prev?.policyRatePct !== undefined && prev.policyRatePct === cur.policyRatePct;
    const moves = (it.policyRateSource === 'bis' && !unchanged ? it.policyRateMoves || (it.policyRateLastMove ? [it.policyRateLastMove] : []) : []).filter(
      (m) => m.period >= since.slice(0, m.period.length)
    );
    for (const m of moves) {
      out.push({
        kind: 'policy',
        iso3: it.iso3,
        countryName: it.countryName,
        text: `${it.countryName} ${m.toPct > m.fromPct ? 'raised' : 'cut'} its policy rate from ${p2(m.fromPct)} to ${p2(m.toPct)}`,
        when: m.period,
        source: `BIS${it.policyRateBank ? ` (${it.policyRateBank})` : ''}`,
      });
    }
    if (!moves.length && prev?.policyRatePct !== undefined && cur.policyRatePct !== undefined && prev.policyRatePct !== cur.policyRatePct) {
      out.push({
        kind: 'policy',
        iso3: it.iso3,
        countryName: it.countryName,
        text: `${it.countryName}'s policy rate moved from ${p2(prev.policyRatePct)} to ${p2(cur.policyRatePct)}`,
        when: it.policyRateDate || '',
        source: 'BIS',
      });
    }
    if (prev && cur.cpiMonth && cur.cpiPct !== undefined && (!prev.cpiMonth || cur.cpiMonth > prev.cpiMonth)) {
      out.push({
        kind: 'inflation',
        iso3: it.iso3,
        countryName: it.countryName,
        text: prev.cpiPct !== undefined ? `${it.countryName} inflation ${p1(prev.cpiPct)} to ${p1(cur.cpiPct)} (new print for ${cur.cpiMonth})` : `${it.countryName} inflation ${p1(cur.cpiPct)} (new print for ${cur.cpiMonth})`,
        when: cur.cpiMonth,
        source: it.oecdCpi?.long || it.oecdCpi?.short || 'monthly inflation',
      });
    }
    if (prev?.cliPhase && cur.cliPhase && prev.cliPhase !== cur.cliPhase) {
      out.push({
        kind: 'cycle',
        iso3: it.iso3,
        countryName: it.countryName,
        text: `${it.countryName}'s leading indicator moved from ${prev.cliPhase} to ${cur.cliPhase}`,
        when: cur.cliMonth || '',
        source: 'OECD via DBnomics',
      });
    }
    if (prev?.yield10YPct !== undefined && cur.yield10YPct !== undefined && Math.abs(cur.yield10YPct - prev.yield10YPct) >= YIELD_MOVE_PTS) {
      const d = cur.yield10YPct - prev.yield10YPct;
      out.push({
        kind: 'yield',
        iso3: it.iso3,
        countryName: it.countryName,
        text: `${it.countryName} 10Y yield ${d > 0 ? 'up' : 'down'} ${Math.round(Math.abs(d) * 100)} bp to ${p2(cur.yield10YPct)}`,
        when: it.yield10YPeriod || '',
        source: 'official 10Y yield',
      });
    }
  }
  const before = new Set(last?.alerts || []);
  for (const a of alertsNow) {
    if (last && before.has(a.key)) continue;
    out.push({ kind: 'alert', iso3: a.iso3, countryName: a.countryName, text: `Watch alert: ${a.text}`, when: now.toISOString().slice(0, 10), source: 'your watch rule' });
  }
  const order: DigestKind[] = ['policy', 'inflation', 'cycle', 'yield', 'alert'];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));
}

export function visitFrom(items: LiveWatchlistItem[], alertKeys: string[], now = new Date()): DigestVisit {
  return { savedAt: now.toISOString(), rows: Object.fromEntries(items.map((it) => [it.iso3, factsFor(it)])), alerts: alertKeys };
}

export function loadDigestVisit(): DigestVisit | null {
  try {
    const raw = window.localStorage.getItem(DIGEST_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v.savedAt === 'string' && v.rows ? (v as DigestVisit) : null;
  } catch {
    return null;
  }
}

export function saveDigestVisit(v: DigestVisit): void {
  try {
    window.localStorage.setItem(DIGEST_KEY, JSON.stringify(v));
  } catch {
    // Blocked storage: the digest just starts again next time.
  }
}

/**
 * What an empty digest says. "Nothing moved" is only true when some feed answered; with no live
 * figures nothing could be compared, so it reads Missing with the reason.
 */
export function digestEmptyNote(items: Pick<LiveWatchlistItem, 'dataMode'>[], sinceLastVisit: boolean): string {
  if (!items.length) return 'Missing: the watchlist has no countries.';
  const live = items.filter((i) => i.dataMode === 'live' || i.dataMode === 'partial').length;
  if (!live) return 'Missing: no data feed has answered yet for these countries, so there is nothing to compare.';
  const part = live < items.length ? ` (live figures for ${live} of ${items.length} countries)` : '';
  return `Nothing moved${sinceLastVisit ? ' since then' : ''} in the live figures${part}.`;
}
