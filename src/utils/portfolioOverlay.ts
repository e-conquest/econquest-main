/**
 * Portfolio overlay (roadmap E2, Sam 2026-11-05): your imported holdings laid over the signals
 * the app already shows, each marked as leaning with or against that position.
 *
 * Stated rules only, on live figures (toLive removes built-in ones first). No price targets, no
 * odds, no advice: a signal "against" a position says which of the app's readings points the other
 * way, so you can look at it, not what to do.
 *
 * Which signals bear on which holding:
 * - Local-currency bonds: the Taylor rule check, the policy cycle and the 3-month move in the 10Y
 *   yield. Lower rates help a long bond; higher rates hurt it. Reversed for a short.
 * - Hard-currency bonds, local bonds and CDS: shock early warning alerts. An alert leans against
 *   holding the credit (long bond, sold protection) and with bought protection (long CDS).
 * - FX and other: shown, but not marked; the holdings file does not say which leg is long.
 */
import type { LiveWatchlistItem } from '../types/council';
import { toLive } from './liveFigures';
import { ASSET_CLASS_LABEL, creditSign, type Holding } from './holdings';
import { taylorCheck } from './taylorRule';
import { cycleClock } from './cycleClock';
import { SHOCK_CHECKS, shockWatch } from './shockWatch';

/** A 3-month move in the 10Y yield of at least this many basis points counts as a move. */
export const YIELD_MOVE_BPS = 25;

export type Leaning = 'with' | 'against' | 'neutral';

export interface OverlaySignal {
  kind: 'taylor' | 'cycle' | 'yield_trend' | 'shock';
  label: string;
  /** What the signal says, with its figures. */
  reading: string;
  leaning: Leaning;
  source: string;
}

export interface OverlayRow {
  holding: Holding;
  countryName: string;
  signals: OverlaySignal[];
  /** Signals that apply to this holding but could not be read, with why. */
  missing: string[];
  /** True when nothing in the app bears on this kind of holding (FX, other). */
  notMarked?: string;
}

export interface PortfolioOverlay {
  rows: OverlayRow[];
  /** Gross notional (USD mm) of holdings with at least one signal against and none with. */
  againstUsdMm: number;
  withUsdMm: number;
  mixedUsdMm: number;
  quietUsdMm: number;
  uncovered: string[];
}

const p2 = (v: number) => `${v.toFixed(2)}%`;
const bp = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)} bps`;

/** +1 when lower local rates help the holding, -1 when they hurt it, 0 when they do not apply. */
function rateSign(h: Holding): number {
  if (h.assetClass !== 'LC_BOND') return 0;
  return h.side === 'LONG' ? 1 : -1;
}

const lean = (helps: number): Leaning => (helps > 0 ? 'with' : helps < 0 ? 'against' : 'neutral');

export function overlayHolding(h: Holding, raw: LiveWatchlistItem | undefined, now: Date = new Date()): OverlayRow {
  const item = raw && toLive(raw);
  const row: OverlayRow = { holding: h, countryName: item?.countryName || h.iso3, signals: [], missing: [] };
  if (h.assetClass === 'FX' || h.assetClass === 'OTHER') {
    row.notMarked = `${ASSET_CLASS_LABEL[h.assetClass]}: not marked, as the holdings file does not say which leg is long.`;
    return row;
  }
  if (!item) {
    row.missing.push(`${h.iso3} is not on your watchlist, so the app holds no figures for it`);
    return row;
  }

  const rs = rateSign(h);
  if (rs !== 0) {
    // Taylor rule: policy above the rule points to cuts (lower rates), below to raises.
    const t = taylorCheck(item);
    if (t.ok) {
      const r = t.reading;
      const towardCuts = r.stance === 'tighter than the rule' ? 1 : r.stance === 'looser than the rule' ? -1 : 0;
      row.signals.push({
        kind: 'taylor',
        label: 'Taylor rule check',
        reading: `Policy ${p2(r.policyPct)} against a rule rate of ${p2(r.rulePct)}: ${r.stance}${towardCuts > 0 ? ', which points to cuts' : towardCuts < 0 ? ', which points to raises' : ''}.`,
        leaning: lean(towardCuts * rs),
        source: `BIS policy rate; inflation ${r.inflationBasis}; ${r.target.bank} target`,
      });
    } else row.missing.push(`Taylor rule check (needs ${t.missing.join(', ')})`);

    const c = cycleClock(item, now).policy;
    if (c) {
      const towardCuts = c.state === 'cutting' ? 1 : c.state === 'hiking' ? -1 : 0;
      row.signals.push({
        kind: 'cycle',
        label: 'Policy cycle',
        reading:
          c.state === 'on hold'
            ? `On hold${c.monthsSinceLastMove !== undefined ? ` for ${c.monthsSinceLastMove} months` : ''}.`
            : `${c.state === 'cutting' ? 'Cutting' : 'Hiking'} since ${c.since} (${c.movesInRun} move${c.movesInRun === 1 ? '' : 's'}${c.runPts !== undefined ? `, ${c.runPts > 0 ? '+' : ''}${c.runPts.toFixed(2)} pts` : ''}).`,
        leaning: lean(towardCuts * rs),
        source: `BIS policy rates, to ${c.asOf}`,
      });
    } else row.missing.push('Policy cycle (needs the BIS policy rate history)');

    const live10y = item.yield10YSource === 'official' || item.yield10YSource === 'uploaded';
    if (live10y && item.yield10YChange3mPts !== undefined) {
      const bps = item.yield10YChange3mPts * 100;
      const towardLower = bps <= -YIELD_MOVE_BPS ? 1 : bps >= YIELD_MOVE_BPS ? -1 : 0;
      row.signals.push({
        kind: 'yield_trend',
        label: '10Y yield, last 3 months',
        reading: `${bp(bps)}${item.yield10YPeriod ? ` to ${item.yield10YPeriod}` : ''}${towardLower === 0 ? `, within ${YIELD_MOVE_BPS} bps` : ''}.`,
        leaning: lean(towardLower * rs),
        source: item.yield10YSource === 'uploaded' ? 'Your yield file' : 'Official 10Y yield',
      });
    } else row.missing.push('10Y yield trend (needs an official 10Y yield with 3 months of history)');
  }

  // Shock early warning applies to every credit holding.
  const cs = creditSign(h);
  if (cs !== 0) {
    const s = shockWatch(item);
    const alerts = s.warnings.filter((w) => w.level === 'alert');
    const watches = s.warnings.filter((w) => w.level === 'watch');
    if (alerts.length || watches.length || s.notChecked.length < SHOCK_CHECKS) {
      row.signals.push({
        kind: 'shock',
        label: 'Shock early warning',
        reading: alerts.length
          ? `${alerts.length} alert${alerts.length === 1 ? '' : 's'}: ${alerts.map((a) => a.label).join('; ')}.${watches.length ? ` Also watching: ${watches.map((w) => w.label).join('; ')}.` : ''}`
          : watches.length
            ? `No alerts; watching: ${watches.map((w) => w.label).join('; ')}.`
            : `No alerts in the ${SHOCK_CHECKS - s.notChecked.length} checks that could run.`,
        // An alert hurts the credit: against a long bond or sold protection, with bought protection.
        leaning: alerts.length ? lean(-cs) : 'neutral',
        source: 'IMF reserves and BoP, World Bank debt, commodity prices, 10Y yield, GDELT',
      });
    } else row.missing.push('Shock early warning (none of its inputs is live)');
  }
  return row;
}

export function rowLeaning(r: OverlayRow): 'with' | 'against' | 'mixed' | 'quiet' {
  const w = r.signals.some((s) => s.leaning === 'with');
  const a = r.signals.some((s) => s.leaning === 'against');
  return w && a ? 'mixed' : a ? 'against' : w ? 'with' : 'quiet';
}

export function portfolioOverlay(holdings: Holding[], watchlist: LiveWatchlistItem[], now: Date = new Date()): PortfolioOverlay {
  const rows = holdings.map((h) => overlayHolding(h, watchlist.find((w) => w.iso3 === h.iso3), now));
  const sum = (k: ReturnType<typeof rowLeaning>) => rows.filter((r) => rowLeaning(r) === k).reduce((a, r) => a + r.holding.notionalUsdMm, 0);
  // Holdings with something against them first, then mixed, then with, then quiet.
  const order = { against: 0, mixed: 1, with: 2, quiet: 3 } as const;
  rows.sort((a, b) => order[rowLeaning(a)] - order[rowLeaning(b)] || b.holding.notionalUsdMm - a.holding.notionalUsdMm);
  return {
    rows,
    againstUsdMm: sum('against'),
    withUsdMm: sum('with'),
    mixedUsdMm: sum('mixed'),
    quietUsdMm: sum('quiet'),
    uncovered: [...new Set(holdings.filter((h) => !watchlist.some((w) => w.iso3 === h.iso3)).map((h) => h.iso3))],
  };
}
