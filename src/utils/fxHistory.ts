/**
 * Daily exchange rate history: ECB euro reference rates, turned into units of each currency per US
 * dollar by Frankfurter (api.frankfurter.dev/v1, free, no key), from 1999 to today.
 *
 * Until now the Exchange rate history came from the app's own saved pulls: one point per day the
 * app happened to run. This file keeps the published daily run instead, so charts, the Chart
 * Agent's tests and the History tab have every business day the ECB published.
 *
 * Pulled in calendar quarters (each well inside the 100-day range the FX volatility reader already
 * uses, so every reply is daily). A quarter is pulled once more a week after it ends, then kept for
 * good; only the current quarter is pulled again (after 12 hours). Saved by the server to
 * data/live/fx-history.json. Only published rates are kept: a day the ECB did not publish (a
 * weekend, a TARGET holiday) has no point, nothing is filled in or carried forward.
 *
 * The ECB publishes about 30 currencies. Others (for example CLP, EGP, NGN, ARS) have no daily
 * history here and keep the saved-pulls series with the reason stated.
 *
 * Browser-safe (no fs).
 */
import type { Series, SeriesMissing, SeriesPoint } from './seriesHistory';
import { extraFxDailySeries, EXTRA_FX, type FxExtraFile } from './fxExtra';

export const FX_HISTORY_SOURCE = 'ECB euro reference rates (via Frankfurter), per US dollar';
export const FX_HISTORY_FIRST_YEAR = 1999;
/** The current quarter is pulled again after this long. */
export const FX_HISTORY_REFRESH_MS = 12 * 60 * 60 * 1000;
/** A quarter is final once pulled this long after its last day (late ECB corrections). */
const SETTLE_MS = 7 * 24 * 60 * 60 * 1000;

export interface FxHistoryChunk {
  /** When this quarter was pulled (ISO). */
  pulledAt: string;
  /** Date (YYYY-MM-DD) to currency (upper case) to units per US dollar. */
  rates: Record<string, Record<string, number>>;
}

export interface FxHistoryFile {
  version: 1;
  /** Keyed by quarter, YYYY-Qn. */
  chunks: Record<string, FxHistoryChunk>;
}

export const EMPTY_FX_HISTORY: FxHistoryFile = { version: 1, chunks: {} };

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** First and last day of a quarter (YYYY-Qn), as YYYY-MM-DD. */
export function quarterBounds(key: string): { from: string; to: string } | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const q = Number(m[2]);
  const startMonth = (q - 1) * 3 + 1;
  const end = new Date(Date.UTC(year, startMonth + 2, 0));
  return { from: `${year}-${pad(startMonth)}-01`, to: isoDay(end) };
}

export function quarterOf(d: Date): string {
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

/** Every quarter from 1999-Q1 to the one holding `now`, newest first. */
export function allQuarters(now = new Date()): string[] {
  const out: string[] = [];
  const last = quarterOf(now);
  for (let y = now.getUTCFullYear(); y >= FX_HISTORY_FIRST_YEAR; y--) {
    for (let q = 4; q >= 1; q--) {
      const key = `${y}-Q${q}`;
      if (key > last) continue;
      out.push(key);
    }
  }
  return out;
}

/** Frankfurter range request for one quarter, cut at today for the current one. */
export function fxQuarterUrl(key: string, now = new Date()): string | null {
  const b = quarterBounds(key);
  if (!b) return null;
  const today = isoDay(now);
  if (b.from > today) return null;
  const to = b.to < today ? b.to : today;
  return `https://api.frankfurter.dev/v1/${b.from}..${to}?from=USD`;
}

/**
 * Frankfurter time series reply ({ rates: { 'YYYY-MM-DD': { CCY: n } } }) to the chunk's rates.
 * Null when the reply holds no usable rate.
 */
export function parseFxQuarter(json: unknown): FxHistoryChunk['rates'] | null {
  const rates = (json as { rates?: unknown })?.rates;
  if (!rates || typeof rates !== 'object') return null;
  const out: FxHistoryChunk['rates'] = {};
  let n = 0;
  for (const [day, row] of Object.entries(rates as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !row || typeof row !== 'object') continue;
    const clean: Record<string, number> = {};
    for (const [ccy, v] of Object.entries(row as Record<string, unknown>)) {
      if (!/^[A-Za-z]{3}$/.test(ccy)) continue;
      const num = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(num) && num > 0) {
        clean[ccy.toUpperCase()] = num;
        n++;
      }
    }
    if (Object.keys(clean).length) out[day] = clean;
  }
  return n ? out : null;
}

/** True when a saved quarter needs pulling (never pulled, not yet final, or the current one gone stale). */
export function quarterNeedsPull(file: FxHistoryFile | null | undefined, key: string, now = new Date()): boolean {
  const chunk = file?.chunks?.[key];
  if (!chunk) return true;
  const b = quarterBounds(key);
  if (!b) return false;
  const pulled = Date.parse(chunk.pulledAt);
  if (!Number.isFinite(pulled)) return true;
  const endMs = Date.parse(`${b.to}T23:59:59Z`);
  if (pulled >= endMs + SETTLE_MS) return false;
  return now.getTime() - pulled >= FX_HISTORY_REFRESH_MS;
}

/** Quarters to pull now, newest first. */
export function quartersToPull(file: FxHistoryFile | null | undefined, now = new Date()): string[] {
  return allQuarters(now).filter((k) => quarterNeedsPull(file, k, now));
}

/** Shape check for a file read from disk; anything else reads as empty. */
export function readFxHistoryFile(raw: unknown): FxHistoryFile {
  const chunks = (raw as { chunks?: unknown })?.chunks;
  if (!chunks || typeof chunks !== 'object') return { version: 1, chunks: {} };
  const out: FxHistoryFile = { version: 1, chunks: {} };
  for (const [k, c] of Object.entries(chunks as Record<string, unknown>)) {
    const ch = c as Partial<FxHistoryChunk>;
    if (!quarterBounds(k) || typeof ch?.pulledAt !== 'string' || !ch.rates || typeof ch.rates !== 'object') continue;
    out.chunks[k] = { pulledAt: ch.pulledAt, rates: ch.rates as FxHistoryChunk['rates'] };
  }
  return out;
}

/** Newest pull time across the saved quarters (ISO), or undefined. */
export function fxHistoryPulledAt(file: FxHistoryFile | null | undefined): string | undefined {
  return Object.values(file?.chunks || {})
    .map((c) => c.pulledAt)
    .sort()
    .pop();
}

/** Currencies with at least one saved rate. */
export function fxHistoryCurrencies(file: FxHistoryFile | null | undefined): string[] {
  const set = new Set<string>();
  for (const c of Object.values(file?.chunks || {})) for (const row of Object.values(c.rates)) for (const ccy of Object.keys(row)) set.add(ccy);
  return [...set].sort();
}

const LABEL = 'Exchange rate';

/**
 * Daily units of `ccy` per US dollar, oldest first. The ECB run when the ECB publishes the
 * currency; for PEN, COP and ARS the central bank's own daily rate (src/utils/fxExtra.ts) when
 * `extra` holds it. Missing with the reason otherwise.
 */
export function fxDailySeries(file: FxHistoryFile | null | undefined, ccy: string | undefined, extra?: FxExtraFile | null): Series | SeriesMissing {
  const code = String(ccy || '').trim().toUpperCase();
  if (!code) return { id: 'fx_per_usd', label: LABEL, reason: 'No currency set for this country' };
  if (code === 'USD') return { id: 'fx_per_usd', label: LABEL, reason: 'The US dollar is the base currency' };
  const chunks = Object.values(file?.chunks || {});
  if (!chunks.length) return extraFxDailySeries(extra, code) ?? { id: 'fx_per_usd', label: LABEL, reason: 'ECB reference rates not downloaded yet' };
  const points: SeriesPoint[] = [];
  for (const c of chunks) {
    for (const [day, row] of Object.entries(c.rates)) {
      const v = row[code];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) points.push({ date: day, value: v });
    }
  }
  if (!points.length) {
    const own = extraFxDailySeries(extra, code);
    if (own) return own;
    const def = EXTRA_FX[code as keyof typeof EXTRA_FX];
    return { id: 'fx_per_usd', label: LABEL, reason: def ? `The ECB publishes no reference rate for ${code}, and the ${def.source.split(',')[0]} daily rate has not been downloaded yet` : `The ECB publishes no reference rate for ${code}` };
  }
  points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    id: 'fx_per_usd',
    label: LABEL,
    unit: `${code} per USD`,
    freq: 'daily',
    source: FX_HISTORY_SOURCE,
    pulledAt: fxHistoryPulledAt(file),
    points,
    about: `Units of ${code} per US dollar on each ECB business day (ECB rate for ${code} divided by the ECB rate for USD, both per euro). A higher number is a weaker ${code}.`,
  };
}
