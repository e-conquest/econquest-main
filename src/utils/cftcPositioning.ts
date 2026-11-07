/**
 * CFTC Commitments of Traders: who is long or short each currency future (Sam, 2026-11-05:
 * "CFTC and TIC positioning. Free weekly positioning data as another live source").
 *
 * Source: the CFTC's public reporting site, Traders in Financial Futures report, futures only
 * (dataset gpe5-46if on publicreporting.cftc.gov, free, no key). Positions are as of Tuesday and
 * published on Friday afternoon (US Eastern), so the newest figure is usually 3 to 10 days old;
 * every figure carries its report date.
 *
 * CME currency futures are quoted in US dollars per unit of the foreign currency, so a net long
 * position is long that currency against the dollar.
 *
 * What the app reads, per currency:
 * - Leveraged funds (hedge funds, CTAs) net position as a share of open interest: the fast money.
 * - Where that share sits in its own last three years (percentile). At or above the 90th =
 *   crowded long, at or below the 10th = crowded short: a stated rule, tagged model.
 * - Asset managers net share of open interest, and the leveraged-fund change over the week.
 *
 * Only currencies with a CME future reported by the CFTC are covered. The others (Turkish lira,
 * Egyptian pound, Indonesian rupiah, Polish zloty, Chilean peso) have none, and read so.
 */

export const CFTC_LABEL = 'CFTC Commitments of Traders (Traders in Financial Futures)';
export const CFTC_HOST = 'publicreporting.cftc.gov';
export const CFTC_DATASET = 'gpe5-46if';

/** CFTC contract market codes for the CME currency futures, by the country the app files them under. */
export const CFTC_CURRENCY_CODES: Record<string, { code: string; ccy: string; market: string }> = {
  MEX: { code: '095741', ccy: 'MXN', market: 'Mexican peso (CME)' },
  BRA: { code: '102741', ccy: 'BRL', market: 'Brazilian real (CME)' },
  ZAF: { code: '122741', ccy: 'ZAR', market: 'South African rand (CME)' },
  JPN: { code: '097741', ccy: 'JPY', market: 'Japanese yen (CME)' },
  GBR: { code: '096742', ccy: 'GBP', market: 'British pound (CME)' },
  EUU: { code: '099741', ccy: 'EUR', market: 'Euro FX (CME)' },
};

/** Weeks of history used for the percentile: about three years. */
export const CFTC_HISTORY_WEEKS = 156;
/** Fewer weeks than this and no percentile is called. */
export const CFTC_MIN_WEEKS = 52;

/** One request for every covered currency, about three years of weekly rows, only the columns read. */
export function cftcUrl(now = new Date(), codes = Object.values(CFTC_CURRENCY_CODES).map((c) => c.code), opts: { since?: string; limit?: number } = {}): string {
  const since = opts.since || new Date(now.getTime() - (CFTC_HISTORY_WEEKS + 2) * 7 * 86400000).toISOString().slice(0, 10);
  const params: Record<string, string> = {
    $select: [
      'report_date_as_yyyy_mm_dd',
      'cftc_contract_market_code',
      'open_interest_all',
      'asset_mgr_positions_long',
      'asset_mgr_positions_short',
      'lev_money_positions_long',
      'lev_money_positions_short',
    ].join(','),
    $where: `cftc_contract_market_code in(${codes.map((c) => `'${c}'`).join(',')}) AND report_date_as_yyyy_mm_dd >= '${since}'`,
    $order: 'report_date_as_yyyy_mm_dd ASC',
    $limit: String(opts.limit || 5000),
  };
  // Spaces as %20 (not +), as in the CFTC's own examples.
  const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `https://${CFTC_HOST}/resource/${CFTC_DATASET}.json?${query}`;
}

export interface CftcWeek {
  /** YYYY-MM-DD, the Tuesday the positions are as of. */
  date: string;
  openInterest: number;
  levNet: number;
  assetMgrNet: number;
}

export interface CftcPositioning {
  iso3: string;
  ccy: string;
  market: string;
  /** YYYY-MM-DD of the latest report. */
  reportDate: string;
  openInterest: number;
  /** Leveraged funds long minus short, contracts. */
  levNetContracts: number;
  /** Leveraged funds net as a share of open interest, percent (positive = long the currency). */
  levNetPctOi: number;
  /** Change in leveraged funds net over the latest week, contracts. */
  levNetWeekChange?: number;
  /** Asset managers net as a share of open interest, percent. */
  assetMgrNetPctOi: number;
  /** Where levNetPctOi sits in its own history, 0 to 100. Absent with under a year of weeks. */
  percentile?: number;
  /** Change in levNetPctOi over the latest 4 reports, percentage points of open interest. */
  levNetPctOiChange4w?: number;
  weeks: number;
}

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
};

/** Socrata rows -> weeks per contract code, oldest first. Rows with missing numbers are dropped. */
export function parseCftcRows(json: unknown): Map<string, CftcWeek[]> {
  const out = new Map<string, CftcWeek[]>();
  if (!Array.isArray(json)) return out;
  for (const r of json as Array<Record<string, unknown>>) {
    const code = String(r?.cftc_contract_market_code ?? '').trim();
    const date = String(r?.report_date_as_yyyy_mm_dd ?? '').slice(0, 10);
    const oi = n(r?.open_interest_all);
    const ll = n(r?.lev_money_positions_long);
    const ls = n(r?.lev_money_positions_short);
    const al = n(r?.asset_mgr_positions_long);
    const as = n(r?.asset_mgr_positions_short);
    if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(date) || ![oi, ll, ls, al, as].every(Number.isFinite) || oi <= 0) continue;
    const list = out.get(code) || [];
    list.push({ date, openInterest: oi, levNet: ll - ls, assetMgrNet: al - as });
    out.set(code, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    // One row per date (keep the last if the source repeats one).
    for (let i = list.length - 1; i > 0; i--) if (list[i - 1].date === list[i].date) list.splice(i - 1, 1);
  }
  return out;
}

/** Share of past values at or below the latest, 0 to 100. */
function percentileOf(values: number[], latest: number): number {
  const below = values.filter((v) => v <= latest).length;
  return Math.round((below / values.length) * 100);
}

/** The reading for one country, or null when the source has no rows for its future. */
export function positioningFor(iso3: string, weeksByCode: Map<string, CftcWeek[]>): CftcPositioning | null {
  const def = CFTC_CURRENCY_CODES[iso3];
  if (!def) return null;
  const all = weeksByCode.get(def.code);
  if (!all?.length) return null;
  const weeks = all.slice(-CFTC_HISTORY_WEEKS);
  const last = weeks[weeks.length - 1];
  const prev = weeks.length > 1 ? weeks[weeks.length - 2] : undefined;
  const share = weeks.map((w) => (w.levNet / w.openInterest) * 100);
  const levNetPctOi = share[share.length - 1];
  return {
    iso3,
    ccy: def.ccy,
    market: def.market,
    reportDate: last.date,
    openInterest: last.openInterest,
    levNetContracts: last.levNet,
    levNetPctOi: Number(levNetPctOi.toFixed(1)),
    ...(prev ? { levNetWeekChange: last.levNet - prev.levNet } : {}),
    assetMgrNetPctOi: Number(((last.assetMgrNet / last.openInterest) * 100).toFixed(1)),
    ...(weeks.length >= CFTC_MIN_WEEKS ? { percentile: percentileOf(share, levNetPctOi) } : {}),
    ...(share.length > 4 ? { levNetPctOiChange4w: Number((levNetPctOi - share[share.length - 5]).toFixed(1)) } : {}),
    weeks: weeks.length,
  };
}

export type PositioningLabel = 'crowded long' | 'crowded short' | 'not stretched';

/** Stated rule: 90th percentile or above = crowded long; 10th or below = crowded short. */
export function positioningLabel(percentile: number): PositioningLabel {
  return percentile >= 90 ? 'crowded long' : percentile <= 10 ? 'crowded short' : 'not stretched';
}

/** Why a country has no CFTC figure: no future exists, or the feed did not answer. */
export function cftcMissing(iso3: string): { short: string; help: string } {
  return CFTC_CURRENCY_CODES[iso3]
    ? { short: 'CFTC did not answer', help: 'The free CFTC feed did not answer, or has no recent report for this future. Positions come out on Friday for the Tuesday before.' }
    : { short: 'No CFTC-reported future', help: 'The CFTC reports no futures market for this currency, so there is no free weekly positioning figure.' };
}

const signed = (v: number, dp = 1) => `${v > 0 ? '+' : ''}${v.toFixed(dp)}`;

/** One line for a reading: "Leveraged funds net long MXN, 18.2% of open interest (93rd percentile of 3 years): crowded long." */
export function positioningSentence(p: CftcPositioning): string {
  const side = p.levNetContracts >= 0 ? 'long' : 'short';
  const base = `Leveraged funds are net ${side} ${p.ccy} futures, ${signed(p.levNetPctOi)}% of open interest (CFTC, ${p.reportDate})`;
  if (p.percentile === undefined) return `${base}.`;
  const label = positioningLabel(p.percentile);
  return label === 'not stretched'
    ? `${base}, at the ${ordinal(p.percentile)} percentile of three years: not stretched.`
    : `${base}, at the ${ordinal(p.percentile)} percentile of three years: ${label}, open to a sharp unwind.`;
}

export function ordinal(k: number): string {
  const s = k % 100 >= 11 && k % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[k % 10] || 'th';
  return `${k}${s}`;
}
