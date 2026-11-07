/**
 * Central bank policy rates from the BIS (Sam, 2026-11-05: "Lets start with BIS policy rates").
 *
 * Source: the BIS central bank policy rates dataset (WS_CBPOL on stats.bis.org, free, no key).
 * The key is FREQ.REF_AREA: D (daily) or M (monthly, end of period), and the ISO alpha-2 code of
 * the country (XM = euro area, the ECB rate). Each series says which rate it is (COMPILATION) and
 * which central bank publishes it (SOURCE_REF). Values are percent.
 *
 * The app asks twice, both small:
 * - Daily, last observation only, for the current rate and its date.
 * - Monthly, about 25 months, for the change over 12 months and when the rate last moved.
 *
 * Checked against live answers on 2026-11-05: daily rows to 2026-10-27 (UK 3.75, Mexico 6.5,
 * US 3.875 = mid-point of the Fed target range, euro area 2.5 = ECB deposit rate), monthly rows
 * to 2026-09 (Turkey 37, Indonesia 5.75). Egypt is not in the dataset. The BIS host does not
 * answer from this project's cloud session, so the parser is tested on rows copied from those
 * answers.
 */
import { BIS_API, parseBisCsv } from './bisDebtSecurities';

export const CBPOL_LABEL = 'BIS central bank policy rates';
export const CBPOL_DATASET = 'WS_CBPOL';

/**
 * BIS area codes for the countries the app files: the watchlist catalogue and the MarketEdge
 * benchmarks (EUU = the euro, so the ECB rate).
 */
export const CBPOL_AREA: Record<string, string> = {
  BRA: 'BR',
  TUR: 'TR',
  EGY: 'EG',
  ZAF: 'ZA',
  MEX: 'MX',
  IDN: 'ID',
  JPN: 'JP',
  GBR: 'GB',
  POL: 'PL',
  CHL: 'CL',
  USA: 'US',
  CHN: 'CN',
  RUS: 'RU',
  IND: 'IN',
  EUU: 'XM',
  ARG: 'AR',
  COL: 'CO',
  KOR: 'KR',
  PER: 'PE',
  PHL: 'PH',
  MYS: 'MY',
  THA: 'TH',
  HUN: 'HU',
  ROU: 'RO',
  SAU: 'SA',
  DEU: 'XM',
  FRA: 'XM',
  ITA: 'XM',
};

/** In the list above but with no series in the BIS dataset (checked 2026-11-05). */
export const CBPOL_NOT_COVERED = new Set(['EGY']);

/** A rate older than this many days is shown with its date and flagged as stale. */
export const CBPOL_STALE_DAYS = 45;
/** Months of monthly history asked for. */
export const CBPOL_HISTORY_MONTHS = 25;

function areaList(areas: string[]): string {
  return [...new Set(areas)].sort().join('+');
}

export function cbpolDailyUrl(areas: string[] = Object.values(CBPOL_AREA)): string {
  return `${BIS_API}/${CBPOL_DATASET}/D.${areaList(areas)}/all?lastNObservations=1&format=csv`;
}

export function cbpolMonthlyUrl(areas: string[] = Object.values(CBPOL_AREA), now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - CBPOL_HISTORY_MONTHS, 1));
  const start = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${BIS_API}/${CBPOL_DATASET}/M.${areaList(areas)}/all?startPeriod=${start}&format=csv`;
}

export interface CbpolPoint {
  /** YYYY-MM-DD (daily) or YYYY-MM (monthly). */
  period: string;
  pct: number;
}

export interface CbpolSeries {
  /** The central bank, as the BIS names it (SOURCE_REF). */
  bank?: string;
  /** Which rate it is, today's part of the BIS note (COMPILATION), e.g. "official bank rate". */
  rate?: string;
  points: CbpolPoint[];
}

/** What is kept on disk: parsed points per BIS area code, for each frequency. */
export interface CbpolPull {
  pulledAt: string;
  daily: Record<string, CbpolSeries>;
  monthly: Record<string, CbpolSeries>;
}

/** "From 3 Aug 2006 onwards: official bank rate; from ..." -> "official bank rate". */
export function currentRateName(compilation: string | undefined): string | undefined {
  const c = (compilation || '').trim();
  if (!c) return undefined;
  const first = c.split(/;\s*from\b/i)[0];
  const m = first.match(/onwards:\s*(.+)$/i);
  const name = (m ? m[1] : first).replace(/\.\s*$/, '').trim();
  return name || undefined;
}

/** BIS CSV of WS_CBPOL -> series per area code, oldest first. Rows that are not percent or have no value are dropped. */
export function parseCbpolCsv(text: unknown, freq: 'D' | 'M'): Record<string, CbpolSeries> {
  const out: Record<string, CbpolSeries> = {};
  const periodOk = freq === 'D' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}$/;
  for (const r of parseBisCsv(text)) {
    if (r.FREQ && r.FREQ !== freq) continue;
    // 368 is the BIS code for "per cent per year".
    if (r.UNIT_MEASURE && r.UNIT_MEASURE !== '368') continue;
    const area = (r.REF_AREA || '').trim();
    const v = Number(r.OBS_VALUE);
    if (!area || r.OBS_VALUE === '' || r.OBS_VALUE === 'NaN' || !Number.isFinite(v) || !periodOk.test(r.TIME_PERIOD)) continue;
    const s = (out[area] ||= { points: [] });
    if (!s.bank && r.SOURCE_REF) s.bank = r.SOURCE_REF.trim();
    if (!s.rate) s.rate = currentRateName(r.COMPILATION);
    s.points.push({ period: r.TIME_PERIOD, pct: v });
  }
  for (const s of Object.values(out)) {
    s.points.sort((a, b) => a.period.localeCompare(b.period));
    for (let i = s.points.length - 1; i > 0; i--) if (s.points[i - 1].period === s.points[i].period) s.points.splice(i - 1, 1);
  }
  return out;
}

export interface BisPolicyRate {
  iso3: string;
  area: string;
  ratePct: number;
  /** YYYY-MM-DD for a daily figure, YYYY-MM (end of month) when only the monthly series has one. */
  date: string;
  freq: 'daily' | 'monthly';
  bank?: string;
  rate?: string;
  /** Change against the same month a year earlier, percentage points. */
  change12mPts?: number;
  /** The latest month-end the rate differed from the month before (from the monthly series). */
  lastMove?: { period: string; fromPct: number; toPct: number };
  /** Every move in the history read (month-end to month-end, plus one after the last month-end), oldest first. */
  moves?: { period: string; fromPct: number; toPct: number }[];
  /** First month of the monthly history read, so "no move since" can say how far back it looked. */
  historyFrom?: string;
  /** True when the latest figure is older than CBPOL_STALE_DAYS. */
  stale: boolean;
  pulledAt: string;
}

const round = (v: number, dp = 3) => Number(v.toFixed(dp));

function ageDays(date: string, now: Date): number {
  // A month figure counts from the end of its month.
  const t = /^\d{4}-\d{2}$/.test(date)
    ? Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)
    : Date.parse(`${date}T00:00:00Z`);
  return (now.getTime() - t) / 86400000;
}

/** The policy rate for one country, or null when the pull has no series for it. */
export function policyRateFor(iso3: string, pull: CbpolPull | null | undefined, now = new Date()): BisPolicyRate | null {
  const area = CBPOL_AREA[iso3];
  if (!area || !pull) return null;
  const d = pull.daily?.[area];
  const m = pull.monthly?.[area];
  const lastD = d?.points[d.points.length - 1];
  const months = m?.points || [];
  const lastM = months[months.length - 1];
  // Daily when it is at least as recent as the month-end figure.
  const useDaily = !!lastD && (!lastM || lastD.period.slice(0, 7) >= lastM.period);
  const latest = useDaily ? lastD! : lastM;
  if (!latest) return null;

  let change12mPts: number | undefined;
  if (lastM) {
    const [y, mo] = lastM.period.split('-').map(Number);
    const yearAgo = `${y - 1}-${String(mo).padStart(2, '0')}`;
    const prior = months.find((p) => p.period === yearAgo);
    if (prior) change12mPts = round(latest.pct - prior.pct);
  }

  const moves: NonNullable<BisPolicyRate['moves']> = [];
  for (let i = 1; i < months.length; i++) {
    if (Math.abs(months[i].pct - months[i - 1].pct) > 1e-9) moves.push({ period: months[i].period, fromPct: months[i - 1].pct, toPct: months[i].pct });
  }
  // Moved after the last month-end in the monthly series: in the daily figure's month.
  if (useDaily && lastM && Math.abs(lastD!.pct - lastM.pct) > 1e-9) moves.push({ period: lastD!.period.slice(0, 7), fromPct: lastM.pct, toPct: lastD!.pct });
  const lastMove: BisPolicyRate['lastMove'] = moves[moves.length - 1];

  const src = (useDaily ? d : m) || d || m;
  return {
    iso3,
    area,
    ratePct: latest.pct,
    date: latest.period,
    freq: useDaily ? 'daily' : 'monthly',
    ...(src?.bank || d?.bank || m?.bank ? { bank: src?.bank || d?.bank || m?.bank } : {}),
    ...(src?.rate || d?.rate || m?.rate ? { rate: src?.rate || d?.rate || m?.rate } : {}),
    ...(change12mPts !== undefined ? { change12mPts } : {}),
    ...(lastMove ? { lastMove } : {}),
    ...(months.length ? { moves, historyFrom: months[0].period } : {}),
    stale: ageDays(latest.period, now) > CBPOL_STALE_DAYS,
    pulledAt: pull.pulledAt,
  };
}

/** Why a country has no BIS policy rate: not in the dataset, or the feed did not answer. */
export function cbpolMissing(iso3: string, pulled: boolean): { short: string; help: string } {
  if (!CBPOL_AREA[iso3] || CBPOL_NOT_COVERED.has(iso3)) {
    return { short: 'Not in BIS policy rates', help: 'The BIS central bank policy rates dataset has no series for this country, so there is no free official policy-rate figure.' };
  }
  return pulled
    ? { short: 'No BIS series returned', help: 'The BIS answered but sent no policy-rate rows for this country.' }
    : { short: 'BIS did not answer', help: 'The free BIS policy rates feed (stats.bis.org) did not answer. The app tries again within the hour.' };
}

const fmtPct = (v: number) => `${Number(v.toFixed(3))}%`;

/** "Bank of England official bank rate 3.75% (BIS, 2026-10-27); last moved in 2026-08, from 4% to 3.75%." */
export function policyRateSentence(p: BisPolicyRate): string {
  const who = [p.bank, p.rate].filter(Boolean).join(' ') || 'Policy rate';
  const when = `${p.freq === 'monthly' ? 'end of ' : ''}${p.date}`;
  const move = p.lastMove ? `; last moved in ${p.lastMove.period}, from ${fmtPct(p.lastMove.fromPct)} to ${fmtPct(p.lastMove.toPct)}` : '';
  const stale = p.stale ? ' This is the latest figure the BIS has; it may be out of date.' : '';
  return `${who} ${fmtPct(p.ratePct)} (BIS, ${when})${move}.${stale}`;
}
