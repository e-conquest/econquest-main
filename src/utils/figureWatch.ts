/**
 * Data health, part 2: a watch on every figure the watchlist shows (Sam, 2026-11-06: "make the
 * data feeds reliable"). Each time the watchlist is rebuilt, each figure is compared with the last
 * reading the app saw, and an alert is kept when:
 *
 * - Missing: a figure the app had is gone, and still gone at least 30 minutes later (a slow feed
 *   on a cold start fills in within minutes and is not an alert).
 * - Back: a Missing figure is filled again.
 * - Stale: the figure became older than its source normally runs (the rules in freshness.ts).
 * - Jump: a new period moved further from the last one than that kind of figure plausibly moves
 *   in one step (the thresholds below). A real shock can trip it: the alert says check, not wrong.
 * - Out of range: the value is outside what that kind of figure can plausibly be (a units slip).
 * - Revised: the source changed the value for a period the app had already read.
 *
 * Stated thresholds, not a model. Only figures from real sources are watched (the row after
 * toLive); nothing is filled in, and an alert never changes a figure.
 *
 * Browser-safe (no fs). The ledger and alerts are kept by src/utils/figureWatchStore.ts.
 */
import type { LiveWatchlistItem } from '../types/council';
import { freshnessChecks } from './freshness';

export type FigureEventKind = 'missing' | 'back' | 'stale' | 'jump' | 'out_of_range' | 'revised';

export const EVENT_LABEL: Record<FigureEventKind, string> = {
  missing: 'Went missing',
  back: 'Back',
  stale: 'Older than usual',
  jump: 'Unusual jump',
  out_of_range: 'Out of range',
  revised: 'Revised',
};

/** Minutes a figure must stay missing before it is an alert. */
export const MISSING_AFTER_MIN = 30;

export interface WatchedFigure {
  id: string;
  label: string;
  unit: string;
  /** Plausible range for this kind of figure. */
  min: number;
  max: number;
  /** Largest plausible move from one period to the next: in points, or as a share of the last value. */
  jumpPts?: number;
  jumpRel?: number;
  /** freshness.ts check id, when the figure has a usual age. */
  freshId?: string;
  read: (row: LiveWatchlistItem) => { value: number; period?: string } | null;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pick = (value: unknown, period?: string) => (num(value) ? { value, ...(period ? { period } : {}) } : null);

export const WATCHED_FIGURES: WatchedFigure[] = [
  { id: 'yield', label: '10Y yield', unit: '%', min: -2, max: 80, jumpPts: 2.5, freshId: 'yield', read: (r) => pick(r.yield10YPct, r.yield10YPeriod) },
  { id: 'policy', label: 'Policy rate', unit: '%', min: -1, max: 150, jumpPts: 5, freshId: 'policy', read: (r) => pick(r.policyRatePct, r.policyRateDate) },
  // Inflation can run in the hundreds (Argentina, Turkey, Venezuela): a move counts as a jump past 5 points and half the last rate.
  { id: 'cpi', label: 'Inflation', unit: '%', min: -15, max: 1000, jumpPts: 5, jumpRel: 0.5, freshId: 'cpi', read: (r) => pick(r.cpiInflationPct, r.cpiMonth || (r.oecdCpi ? r.oecdCpi.month : undefined)) },
  { id: 'debt', label: 'Debt/GDP', unit: '% of GDP', min: 0, max: 300, jumpPts: 20, read: (r) => pick(r.debtToGdpPct, r.fiscal?.debtPctGdp?.year) },
  { id: 'reserves_months', label: 'Reserves (months of imports)', unit: 'months', min: 0, max: 40, jumpRel: 0.5, read: (r) => pick(r.fxReservesMonths) },
  { id: 'imf_reserves', label: 'Reserves (IMF, USD bn)', unit: 'USD bn', min: 0, max: 5000, jumpRel: 0.25, freshId: 'reserves', read: (r) => pick(r.imf?.reserves?.usdBn, r.imf?.reserves?.period) },
  { id: 'current_account', label: 'Current account (4 quarters)', unit: '% of GDP', min: -40, max: 40, jumpPts: 8, freshId: 'current_account', read: (r) => pick(r.imf?.currentAccount4q?.pctGdp, r.imf?.currentAccount4q?.through) },
  { id: 'reer_gap', label: 'Real exchange rate vs 10y average', unit: '%', min: -70, max: 70, jumpPts: 15, freshId: 'reer', read: (r) => pick(r.reerGapPct, r.reerPeriod) },
  { id: 'fx_vol', label: 'FX volatility (3 months)', unit: '%', min: 0, max: 150, jumpPts: 20, read: (r) => pick(r.fxVol3mPct, r.fxVolTo) },
  { id: 'cli', label: 'Leading indicator (OECD)', unit: 'index', min: 85, max: 115, jumpPts: 3, freshId: 'cli', read: (r) => pick(r.oecdCli?.level, r.oecdCli?.month) },
  { id: 'tic', label: 'US Treasury holdings (TIC)', unit: 'USD bn', min: 0, max: 2000, jumpRel: 0.3, freshId: 'tic', read: (r) => pick(r.tic?.holdingsUsdBn, r.tic?.month) },
  { id: 'output_gap', label: 'Output gap', unit: '% of potential', min: -25, max: 25, jumpPts: 8, read: (r) => pick(r.outputGap?.pct, r.outputGap?.year) },
];

export interface LedgerEntry {
  value: number;
  period?: string;
  /** When this value was last seen. */
  seenAt: string;
  /** First time the figure was seen missing in the current gap (not yet an alert under 30 minutes). */
  missingSeenAt?: string;
  /** Set once the gap became a Missing alert. */
  missingSince?: string;
  staleSince?: string;
}

export interface FigureLedger {
  updatedAt?: string;
  /** "BRA:yield" -> last reading. */
  figures: Record<string, LedgerEntry>;
}

export interface FigureEvent {
  at: string;
  iso3: string;
  country: string;
  figure: string;
  label: string;
  kind: FigureEventKind;
  detail: string;
  from?: number;
  to?: number;
  period?: string;
  prevPeriod?: string;
}

const round = (v: number) => Number(v.toFixed(Math.abs(v) >= 100 ? 1 : 3));
const show = (v: number, unit: string) => `${round(v).toLocaleString('en-US')}${unit === '%' ? '%' : ` ${unit}`}`;

/** Whether a move from a to b is more than this kind of figure plausibly moves in one step. */
export function isJump(fig: WatchedFigure, from: number, to: number): boolean {
  const d = Math.abs(to - from);
  const overPts = fig.jumpPts !== undefined ? d > fig.jumpPts : true;
  const overRel = fig.jumpRel !== undefined ? (from === 0 ? d > 0 : d / Math.abs(from) > fig.jumpRel) : true;
  if (fig.jumpPts === undefined && fig.jumpRel === undefined) return false;
  return overPts && overRel;
}

/** A value change counts as a revision past this (published figures carry a few decimals). */
const REVISION_TOL = 0.001;

/**
 * Compares the rows with the last readings. Returns the new ledger and the alerts. Rows are the
 * watchlist after toLive (real figures only).
 */
export function watchFigures(prev: FigureLedger | null | undefined, rows: LiveWatchlistItem[], now = new Date()): { ledger: FigureLedger; events: FigureEvent[] } {
  const at = now.toISOString();
  const figures: Record<string, LedgerEntry> = { ...(prev?.figures || {}) };
  const events: FigureEvent[] = [];

  for (const row of rows) {
    if (!row?.iso3) continue;
    const stale = new Map(freshnessChecks(row, now).map((c) => [c.id, c]));
    for (const fig of WATCHED_FIGURES) {
      const key = `${row.iso3}:${fig.id}`;
      const was = figures[key];
      const cur = fig.read(row);
      const base = { at, iso3: row.iso3, country: row.countryName || row.iso3, figure: fig.id, label: fig.label };

      if (!cur) {
        if (!was || was.missingSince) continue;
        const since = was.missingSeenAt || at;
        if (now.getTime() - Date.parse(since) >= MISSING_AFTER_MIN * 60_000) {
          events.push({ ...base, kind: 'missing', from: was.value, ...(was.period ? { prevPeriod: was.period } : {}), detail: `Last seen ${show(was.value, fig.unit)}${was.period ? ` for ${was.period}` : ''} on ${was.seenAt.slice(0, 10)}; missing since ${since.slice(0, 16).replace('T', ' ')} UTC.` });
          figures[key] = { ...was, missingSeenAt: since, missingSince: since };
        } else figures[key] = { ...was, missingSeenAt: since };
        continue;
      }

      const next: LedgerEntry = { value: cur.value, ...(cur.period ? { period: cur.period } : {}), seenAt: at, ...(was?.staleSince ? { staleSince: was.staleSince } : {}) };
      const changed = !was || was.value !== cur.value || was.period !== cur.period;
      const pp = cur.period ? ` for ${cur.period}` : '';

      if (was?.missingSince) events.push({ ...base, kind: 'back', to: cur.value, ...(cur.period ? { period: cur.period } : {}), detail: `Filled again: ${show(cur.value, fig.unit)}${pp}, after missing since ${was.missingSince.slice(0, 10)}.` });

      if (changed && (cur.value < fig.min || cur.value > fig.max)) {
        events.push({ ...base, kind: 'out_of_range', to: cur.value, ...(cur.period ? { period: cur.period } : {}), detail: `${show(cur.value, fig.unit)}${pp} is outside the plausible range ${fig.min} to ${fig.max} for this figure. Check the source's units.` });
      } else if (was && changed) {
        if (cur.period && was.period === cur.period && Math.abs(cur.value - was.value) > REVISION_TOL) {
          events.push({ ...base, kind: 'revised', from: was.value, to: cur.value, period: cur.period, prevPeriod: was.period, detail: `${cur.period} revised from ${show(was.value, fig.unit)} to ${show(cur.value, fig.unit)} (first read ${was.seenAt.slice(0, 10)}).` });
        } else if (was.period !== cur.period || !cur.period) {
          if (isJump(fig, was.value, cur.value)) {
            events.push({ ...base, kind: 'jump', from: was.value, to: cur.value, ...(cur.period ? { period: cur.period } : {}), ...(was.period ? { prevPeriod: was.period } : {}), detail: `${show(was.value, fig.unit)}${was.period ? ` (${was.period})` : ''} to ${show(cur.value, fig.unit)}${cur.period ? ` (${cur.period})` : ''}: a bigger move than this figure usually makes in one step. Check against the source before relying on it.` });
          }
        }
      }

      const fresh = fig.freshId ? stale.get(fig.freshId) : undefined;
      if (fresh?.stale) {
        if (!was?.staleSince) {
          next.staleSince = at;
          events.push({ ...base, kind: 'stale', to: cur.value, period: fresh.period, detail: `${fresh.period} is ${fresh.age} ${fresh.unit} old (usually ${fresh.usualMax} at most).${fresh.why ? ` ${fresh.why}` : ''}` });
        }
      } else delete next.staleSince;

      figures[key] = next;
    }
  }
  return { ledger: { updatedAt: at, figures }, events };
}

export interface OpenIssue {
  iso3: string;
  figure: string;
  label: string;
  kind: 'missing' | 'stale';
  since: string;
  lastValue: number;
  period?: string;
}

/** What is wrong right now, from the ledger: figures missing or older than usual. */
export function openIssues(ledger: FigureLedger | null | undefined): OpenIssue[] {
  const labels = new Map(WATCHED_FIGURES.map((f) => [f.id, f.label]));
  const out: OpenIssue[] = [];
  for (const [key, e] of Object.entries(ledger?.figures || {})) {
    const [iso3, figure] = key.split(':');
    const label = labels.get(figure) || figure;
    const common = { iso3, figure, label, lastValue: e.value, ...(e.period ? { period: e.period } : {}) };
    if (e.missingSince) out.push({ ...common, kind: 'missing', since: e.missingSince });
    else if (e.staleSince) out.push({ ...common, kind: 'stale', since: e.staleSince });
  }
  return out.sort((a, b) => (a.since < b.since ? 1 : -1));
}
