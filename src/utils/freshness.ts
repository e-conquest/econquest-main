/**
 * Freshness: is a figure older than its source normally runs?
 *
 * Each dated figure has a usual age: how often it comes out plus the normal publication lag (a
 * monthly CPI for September is out by mid-October, so in November it is one to two months old).
 * A figure older than that is flagged "older than usual", with the reason and, where one exists,
 * the fresher source that would replace it. Figures with no date (IMF WEO annual, World Bank
 * annual) are not judged here; their year is shown beside them.
 *
 * Stated rules, not a model. Ages count whole calendar months (monthly and quarterly figures) or
 * days (daily and weekly figures) up to today.
 */
import type { WatchlistItem } from '../types/council';
import { EUROSTAT_GEO } from './nationalCpi';

export type Cadence = 'daily' | 'weekly' | 'monthly' | 'quarterly';

export interface FreshnessCheck {
  /** Figure id, e.g. 'cpi'. */
  id: string;
  label: string;
  /** The period the figure is for, as the source gives it (YYYY-MM-DD, YYYY-MM or YYYY-Qn). */
  period: string;
  cadence: Cadence;
  /** Age up to today: days for daily/weekly, months for monthly/quarterly. */
  age: number;
  /** Usual age at most, same unit. */
  usualMax: number;
  unit: 'days' | 'months';
  stale: boolean;
  /** Why it runs behind, when known. */
  why?: string;
  /** What would give a fresher figure. */
  fresher?: string;
}

/** Usual age at most, by figure: release frequency plus normal publication lag. */
export const USUAL_MAX: Record<string, { cadence: Cadence; max: number }> = {
  yield_daily: { cadence: 'daily', max: 7 },
  yield_monthly: { cadence: 'monthly', max: 2 },
  policy_daily: { cadence: 'daily', max: 14 },
  policy_monthly: { cadence: 'monthly', max: 2 },
  cpi: { cadence: 'monthly', max: 2 },
  reer: { cadence: 'monthly', max: 3 },
  cli: { cadence: 'monthly', max: 3 },
  reserves: { cadence: 'monthly', max: 3 },
  current_account: { cadence: 'quarterly', max: 7 },
  tic: { cadence: 'monthly', max: 3 },
  cftc: { cadence: 'weekly', max: 14 },
};

/** The dated fields read here (a watchlist row, live or not). */
export type DatedItem = Pick<WatchlistItem, 'iso3' | 'yield10YPeriod' | 'yield10YFrequency' | 'policyRateDate' | 'cpiMonth' | 'cpiSource' | 'oecdCpi' | 'reerPeriod' | 'oecdCli' | 'imf' | 'tic' | 'cftc'>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole calendar months from a period to today's month: '2026-09' in November 2026 is 2. */
export function monthsOld(period: string, now: Date): number | null {
  let y: number;
  let m: number;
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  const ym = /^(\d{4})-(\d{2})/.exec(period);
  if (q) {
    y = Number(q[1]);
    m = Number(q[2]) * 3; // quarter's last month
  } else if (ym) {
    y = Number(ym[1]);
    m = Number(ym[2]);
  } else return null;
  if (m < 1 || m > 12) return null;
  return (now.getUTCFullYear() - y) * 12 + (now.getUTCMonth() + 1 - m);
}

export function daysOld(date: string, now: Date): number | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  const t = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - t) / DAY_MS);
}

/** Where a fresher monthly inflation figure would come from for this country. */
export function fresherCpi(iso3: string): string | undefined {
  if (iso3 === 'BRA') return 'Brazil central bank IPCA (connected; it fills in when the feed answers)';
  if (EUROSTAT_GEO[iso3]) return 'Eurostat HICP (connected; it fills in when the feed answers)';
  if (iso3 === 'MEX') return 'Banxico (free token: add it under Menu > Settings > Data API keys; once added it fills in when the feed answers)';
  if (iso3 === 'CHL') return 'Central Bank of Chile (free registration, not yet added)';
  if (iso3 === 'TUR') return 'Central Bank of Turkey EVDS (free key: add it under Menu > Settings > Data API keys; once added it fills in when the feed answers)';
  return undefined;
}

function check(id: string, label: string, period: string | undefined, rule: keyof typeof USUAL_MAX, now: Date, extra: Pick<FreshnessCheck, 'why' | 'fresher'> = {}): FreshnessCheck | null {
  if (!period) return null;
  const { cadence, max } = USUAL_MAX[rule];
  const byDays = cadence === 'daily' || cadence === 'weekly';
  const age = byDays ? daysOld(period, now) : monthsOld(period, now);
  if (age === null || age < 0) return null;
  const stale = age > max;
  return { id, label, period, cadence, age, usualMax: max, unit: byDays ? 'days' : 'months', stale, ...(stale ? extra : {}) };
}

/** Freshness of every dated figure for one watchlist row, newest rules first. Missing figures are skipped. */
export function freshnessChecks(item: DatedItem, now = new Date()): FreshnessCheck[] {
  const out: Array<FreshnessCheck | null> = [];
  const iso3 = item.iso3;

  if (item.yield10YPeriod) {
    const daily = item.yield10YFrequency === 'daily' || /^\d{4}-\d{2}-\d{2}$/.test(item.yield10YPeriod);
    out.push(check('yield', '10Y yield', item.yield10YPeriod, daily ? 'yield_daily' : 'yield_monthly', now, { why: daily ? 'The official daily series has not updated.' : 'The official monthly series has not updated.' }));
  }
  if (item.policyRateDate) {
    const daily = /^\d{4}-\d{2}-\d{2}$/.test(item.policyRateDate);
    out.push(check('policy', 'Policy rate', item.policyRateDate, daily ? 'policy_daily' : 'policy_monthly', now, { why: 'The BIS has not published a newer reading for this bank.' }));
  }
  if (item.cpiMonth) {
    const viaDbnomics = item.cpiSource === 'oecd' && item.oecdCpi?.basis !== 'national';
    out.push(
      check('cpi', 'Inflation', item.cpiMonth, 'cpi', now, {
        why: viaDbnomics ? 'Read from the OECD through DBnomics, whose copy runs several months behind (the OECD site blocks the app).' : 'The source has not published a newer month.',
        fresher: fresherCpi(iso3),
      })
    );
  }
  if (item.reerPeriod) out.push(check('reer', 'Real exchange rate (BIS)', item.reerPeriod, 'reer', now, { why: 'The BIS real exchange rate index has not updated.' }));
  if (item.oecdCli?.month) out.push(check('cli', 'Leading indicator (OECD)', item.oecdCli.month, 'cli', now, { why: 'Read through DBnomics, whose OECD copy runs several months behind.' }));
  if (item.imf?.reserves?.period) out.push(check('reserves', 'Reserves (IMF)', item.imf.reserves.period, 'reserves', now, { why: 'This country reports reserves to the IMF late.' }));
  if (item.imf?.currentAccount?.period) out.push(check('current_account', 'Current account (IMF)', item.imf.currentAccount.period, 'current_account', now, { why: 'This country reports its balance of payments to the IMF late.' }));
  if (item.tic?.month) out.push(check('tic', 'US Treasury holdings (TIC)', item.tic.month, 'tic', now, { why: 'The US Treasury has not published a newer month.' }));
  if (item.cftc?.reportDate) out.push(check('cftc', 'CFTC positioning', item.cftc.reportDate, 'cftc', now, { why: 'No newer weekly CFTC report was read; it is pulled again within the day.' }));

  return out.filter((c): c is FreshnessCheck => c !== null);
}

/** "5 months old (usually 2 at most)" */
export function describeAge(c: FreshnessCheck): string {
  const u = (n: number) => (c.unit === 'days' ? (n === 1 ? 'day' : 'days') : n === 1 ? 'month' : 'months');
  return `${c.age} ${u(c.age)} old (usually ${c.usualMax} at most)`;
}

/** Only the figures older than usual. */
export function staleFigures(item: DatedItem | undefined, now = new Date()): FreshnessCheck[] {
  return item ? freshnessChecks(item, now).filter((c) => c.stale) : [];
}
