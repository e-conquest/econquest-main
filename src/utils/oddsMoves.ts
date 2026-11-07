/**
 * Prediction-market odds moves (Sam, 2026-11-05). Polymarket's Gamma API reports, on each market,
 * how much its price moved over a day, a week and a month (oneDayPriceChange, oneWeekPriceChange,
 * oneMonthPriceChange; checked on the live API 2026-11-05: numbers on the 0-1 price scale, and
 * sometimes absent). The app shows them in percentage points, as market prices moving, not as a
 * forecast by the app.
 */

export interface OddsMoves {
  change1dPts?: number;
  change1wPts?: number;
  change1mPts?: number;
}

/** A week's move at least this large (points) counts as odds moving fast. */
export const ODDS_FAST_PTS = 10;

const pts = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  // On the 0-1 price scale a change can't exceed 1 either way; anything else is not this field.
  return Number.isFinite(n) && Math.abs(n) <= 1 ? Number((n * 100).toFixed(1)) : undefined;
};

/** The moves on one Gamma market object; only the fields that are there and plausible. */
export function polymarketMoves(market: unknown): OddsMoves {
  const m = (market || {}) as Record<string, unknown>;
  const d = pts(m.oneDayPriceChange);
  const w = pts(m.oneWeekPriceChange);
  const mo = pts(m.oneMonthPriceChange);
  return { ...(d !== undefined ? { change1dPts: d } : {}), ...(w !== undefined ? { change1wPts: w } : {}), ...(mo !== undefined ? { change1mPts: mo } : {}) };
}

const sg = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;

/** "1 week +12.0 pts, 1 month +8.5 pts", or '' when Polymarket reported no move. */
export function oddsMoveText(m: OddsMoves): string {
  return [
    m.change1dPts !== undefined ? `1 day ${sg(m.change1dPts)} pts` : '',
    m.change1wPts !== undefined ? `1 week ${sg(m.change1wPts)} pts` : '',
    m.change1mPts !== undefined ? `1 month ${sg(m.change1mPts)} pts` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

/** The market whose odds moved most over a week, when that move is at least ODDS_FAST_PTS. */
export function fastestOddsMove<T extends OddsMoves & { question: string }>(markets: T[] | undefined): T | undefined {
  return (markets || [])
    .filter((m) => m.change1wPts !== undefined && Math.abs(m.change1wPts) >= ODDS_FAST_PTS)
    .sort((a, b) => Math.abs(b.change1wPts!) - Math.abs(a.change1wPts!))[0];
}
