/**
 * Portfolio holdings: what the user actually owns. Imported from CSV or added by hand,
 * saved in this browser only (localStorage). Nothing here is sent to the server.
 */

import type { LiveWatchlistItem } from '../types/council';
import { toLive } from './liveFigures';

export type HoldingAssetClass = 'HC_BOND' | 'LC_BOND' | 'CDS' | 'FX' | 'OTHER';
export type HoldingSide = 'LONG' | 'SHORT';

export interface Holding {
  id: string;
  iso3: string;
  instrument: string;
  assetClass: HoldingAssetClass;
  side: HoldingSide;
  /** Notional (face value) in USD millions, always positive; direction is in `side`. */
  notionalUsdMm: number;
  /** Modified duration in years (bonds) or spread duration (CDS). Optional. */
  durationYears?: number;
}

export const ASSET_CLASS_LABEL: Record<HoldingAssetClass, string> = {
  HC_BOND: 'Hard-currency bond',
  LC_BOND: 'Local-currency bond',
  CDS: 'CDS (protection)',
  FX: 'FX',
  OTHER: 'Other',
};

export const HOLDINGS_TEMPLATE_CSV = [
  'country,instrument,type,side,notional_usd_mm,duration',
  'BRA,BRAZIL 6.125% 2034,hc_bond,long,25,6.8',
  'MEX,MBONO 7.75% 2031,lc_bond,long,15,4.1',
  'TUR,TURKEY 5Y CDS,cds,long,10,4.5',
  'ZAF,USD/ZAR forward,fx,short,8,',
].join('\n');

const STORAGE_KEY = 'econquest.holdings.v1';

export function loadHoldings(): Holding[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isHolding) : [];
  } catch {
    return [];
  }
}

export function saveHoldings(holdings: Holding[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings));
  } catch {
    /* storage blocked: holdings last for this session only */
  }
}

function isHolding(h: unknown): h is Holding {
  const x = h as Holding;
  return !!x && typeof x.iso3 === 'string' && typeof x.notionalUsdMm === 'number' && typeof x.instrument === 'string';
}

export function newHoldingId(): string {
  return `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Split one CSV line, honouring double quotes. */
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === delim && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

const HEADER_ALIASES: Record<string, string[]> = {
  country: ['country', 'iso3', 'iso', 'issuer', 'sovereign', 'country_code'],
  instrument: ['instrument', 'security', 'name', 'description', 'bond', 'isin'],
  type: ['type', 'asset_class', 'assetclass', 'class', 'asset'],
  side: ['side', 'direction', 'long_short', 'position'],
  notional: ['notional_usd_mm', 'notional', 'notional_mm', 'amount', 'face', 'nominal', 'size', 'usd_mm', 'mv_usd_mm'],
  duration: ['duration', 'mod_duration', 'modified_duration', 'dur', 'spread_duration'],
};

function normaliseHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function parseAssetClass(v: string): HoldingAssetClass {
  const s = v.toLowerCase();
  if (!s) return 'HC_BOND';
  if (s.includes('cds') || s.includes('protection')) return 'CDS';
  if (s.includes('fx') || s.includes('forward') || s.includes('currency') && !s.includes('bond')) return 'FX';
  if (s.includes('lc') || s.includes('local')) return 'LC_BOND';
  if (s.includes('hc') || s.includes('hard') || s.includes('usd') || s.includes('euro') || s.includes('bond')) return 'HC_BOND';
  return 'OTHER';
}

/** Parse a number like "25", "25.5", "(10)", "-10", "1,250" (thousands separators). */
function parseNumber(v: string): number | null {
  if (!v) return null;
  let s = v.replace(/[$\s]/g, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/,(?=\d{3}(\D|$))/g, '');
  // A remaining single comma with no dot is a decimal comma, as in European Excel exports ("12,5").
  if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

export interface CountryLookup {
  iso3: string;
  countryName: string;
}

/** Match "BRA", "Brazil", "brazil (fed rep)" etc. to an ISO3 code. Unknown 3-letter codes pass through. */
export function matchCountry(v: string, known: CountryLookup[]): string | null {
  const s = v.trim();
  if (!s) return null;
  const up = s.toUpperCase();
  const byIso = known.find((k) => k.iso3 === up);
  if (byIso) return byIso.iso3;
  const low = s.toLowerCase();
  const byName = known.find((k) => {
    const name = k.countryName.toLowerCase().replace(/\s*\(.*\)$/, '');
    return name === low || low.startsWith(name) || name.startsWith(low);
  });
  if (byName) return byName.iso3;
  return /^[A-Z]{3}$/.test(up) ? up : null;
}

export interface HoldingsParseResult {
  holdings: Holding[];
  errors: string[];
}

export function parseHoldingsCsv(text: string, known: CountryLookup[]): HoldingsParseResult {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (lines.length === 0) return { holdings: [], errors: ['The file is empty.'] };

  const delim = lines[0].includes('\t') ? '\t' : lines[0].split(';').length > lines[0].split(',').length ? ';' : ',';
  const header = splitCsvLine(lines[0], delim).map(normaliseHeader);
  const col: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx >= 0) col[key] = idx;
  }
  const errors: string[] = [];
  if (col.country === undefined) errors.push('No country column found. Name a column "country" (ISO3 code or name).');
  if (col.notional === undefined) errors.push('No notional column found. Name a column "notional_usd_mm" (USD millions).');
  if (errors.length) return { holdings: [], errors };

  const holdings: Holding[] = [];
  lines.slice(1).forEach((line, i) => {
    const row = splitCsvLine(line, delim);
    const rowNo = i + 2;
    const get = (k: string) => (col[k] !== undefined ? row[col[k]] || '' : '');
    const iso3 = matchCountry(get('country'), known);
    if (!iso3) {
      errors.push(`Row ${rowNo}: country "${get('country')}" not recognised. Use an ISO3 code such as BRA.`);
      return;
    }
    const n = parseNumber(get('notional'));
    if (n === null || n === 0) {
      errors.push(`Row ${rowNo}: notional "${get('notional')}" is not a number.`);
      return;
    }
    const sideRaw = get('side').toLowerCase();
    const side: HoldingSide = sideRaw.startsWith('s') || sideRaw === 'sell' || n < 0 ? 'SHORT' : 'LONG';
    const dur = parseNumber(get('duration'));
    holdings.push({
      id: newHoldingId(),
      iso3,
      instrument: get('instrument') || `${iso3} position`,
      assetClass: parseAssetClass(get('type')),
      side,
      notionalUsdMm: Math.abs(n),
      durationYears: dur !== null && dur > 0 ? dur : undefined,
    });
  });
  return { holdings, errors };
}

export function holdingsToCsv(holdings: Holding[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const typeCode: Record<HoldingAssetClass, string> = { HC_BOND: 'hc_bond', LC_BOND: 'lc_bond', CDS: 'cds', FX: 'fx', OTHER: 'other' };
  return [
    'country,instrument,type,side,notional_usd_mm,duration',
    ...holdings.map((h) =>
      [h.iso3, esc(h.instrument), typeCode[h.assetClass], h.side.toLowerCase(), h.notionalUsdMm, h.durationYears ?? ''].join(',')
    ),
  ].join('\n');
}

/**
 * Credit exposure sign: long bonds and sold protection add credit risk; bought protection
 * (CDS "long" = buy protection) and short bonds reduce it. FX positions carry no credit sign.
 */
export function creditSign(h: Holding): number {
  if (h.assetClass === 'FX' || h.assetClass === 'OTHER') return 0;
  if (h.assetClass === 'CDS') return h.side === 'LONG' ? -1 : 1;
  return h.side === 'LONG' ? 1 : -1;
}

export interface BookCountryRow {
  iso3: string;
  countryName: string;
  item?: LiveWatchlistItem;
  grossUsdMm: number;
  netCreditUsdMm: number;
  /** Credit DV01 in USD thousands per bp (net), where durations are given. */
  dv01UsdK: number;
  weight: number;
  positions: number;
}

export interface BookSummary {
  grossUsdMm: number;
  netCreditUsdMm: number;
  dv01UsdK: number;
  missingDuration: number;
  rows: BookCountryRow[];
  uncovered: string[];
}

export function summariseBook(holdings: Holding[], lookup: LiveWatchlistItem[]): BookSummary {
  const byIso = new Map<string, BookCountryRow>();
  let missingDuration = 0;
  for (const h of holdings) {
    const found = lookup.find((w) => w.iso3 === h.iso3);
    // Built-in figures never reach the book, whoever calls this.
    const item = found && toLive(found);
    const row =
      byIso.get(h.iso3) ||
      ({
        iso3: h.iso3,
        countryName: item?.countryName || h.iso3,
        item,
        grossUsdMm: 0,
        netCreditUsdMm: 0,
        dv01UsdK: 0,
        weight: 0,
        positions: 0,
      } as BookCountryRow);
    const sign = creditSign(h);
    row.grossUsdMm += h.notionalUsdMm;
    row.netCreditUsdMm += sign * h.notionalUsdMm;
    if (sign !== 0) {
      if (h.durationYears) row.dv01UsdK += (sign * h.notionalUsdMm * h.durationYears * 100) / 1000;
      else missingDuration++;
    }
    row.positions++;
    byIso.set(h.iso3, row);
  }
  const rows = [...byIso.values()];
  const gross = rows.reduce((a, r) => a + r.grossUsdMm, 0) || 1;
  rows.forEach((r) => (r.weight = r.grossUsdMm / gross));
  rows.sort((a, b) => b.grossUsdMm - a.grossUsdMm);
  return {
    grossUsdMm: rows.reduce((a, r) => a + r.grossUsdMm, 0),
    netCreditUsdMm: rows.reduce((a, r) => a + r.netCreditUsdMm, 0),
    dv01UsdK: rows.reduce((a, r) => a + r.dv01UsdK, 0),
    missingDuration,
    rows,
    uncovered: rows.filter((r) => !r.item).map((r) => r.iso3),
  };
}

/** Gross-notional weights (% summing to 100) per covered country, for the stress lab. */
export function holdingsWeightsPct(holdings: Holding[], coveredIso3: string[]): Record<string, number> {
  const covered = new Set(coveredIso3);
  const gross: Record<string, number> = {};
  for (const h of holdings) {
    if (!covered.has(h.iso3)) continue;
    gross[h.iso3] = (gross[h.iso3] || 0) + h.notionalUsdMm;
  }
  const total = Object.values(gross).reduce((a, b) => a + b, 0);
  if (!total) return {};
  const out: Record<string, number> = {};
  for (const [iso, g] of Object.entries(gross)) out[iso] = (g / total) * 100;
  return out;
}

export type ContagionExpression =
  | 'LOCAL_RATES_RECEIVER'
  | 'USD_EUROBOND_LONG'
  | 'CDS_5Y_PROTECTION'
  | 'CURVE_2S10S_STEEPENER'
  | 'FX_HEDGED_LOCAL_CARRY';

export interface HoldingsContagionBook {
  positions: Array<{
    iso3: string;
    countryName: string;
    currencyCode: string;
    expressionType: ContagionExpression;
    weightNavPct: number;
  }>;
  navUsdMm: number;
  skipped: string[];
}

/**
 * One contagion-desk position per covered country: the largest asset class by notional sets
 * the expression, and the weight is that country's gross notional as % of the book.
 */
export function holdingsToContagionBook(
  holdings: Holding[],
  catalog: Array<{ iso3: string; countryName: string; currencyCode: string }>
): HoldingsContagionBook {
  const byIso = new Map<string, Holding[]>();
  holdings.forEach((h) => byIso.set(h.iso3, [...(byIso.get(h.iso3) || []), h]));
  const gross = holdings.reduce((a, h) => a + h.notionalUsdMm, 0);
  const skipped: string[] = [];
  const positions: HoldingsContagionBook['positions'] = [];
  for (const [iso3, list] of byIso) {
    const cat = catalog.find((c) => c.iso3 === iso3);
    if (!cat) {
      skipped.push(iso3);
      continue;
    }
    const byClass = new Map<string, number>();
    list.forEach((h) => {
      const key = h.assetClass === 'CDS' && h.side === 'LONG' ? 'CDS_PROT' : h.assetClass;
      byClass.set(key, (byClass.get(key) || 0) + h.notionalUsdMm);
    });
    const top = [...byClass.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const expressionType: ContagionExpression =
      top === 'CDS_PROT' ? 'CDS_5Y_PROTECTION' : top === 'LC_BOND' ? 'LOCAL_RATES_RECEIVER' : top === 'FX' ? 'FX_HEDGED_LOCAL_CARRY' : 'USD_EUROBOND_LONG';
    const g = list.reduce((a, h) => a + h.notionalUsdMm, 0);
    positions.push({
      iso3,
      countryName: cat.countryName,
      currencyCode: cat.currencyCode,
      expressionType,
      weightNavPct: Number(((g / (gross || 1)) * 100).toFixed(1)),
    });
  }
  return { positions, navUsdMm: Math.max(1, Math.round(gross)), skipped };
}

/**
 * First-order sensitivities of one holding, in USD per 1 bp (rates, credit) and USD per
 * 1% local-currency depreciation (FX). Sign convention: P&L when the factor rises.
 * Without a duration, rate and credit sensitivities are zero (and the caller says so).
 */
export function holdingGreeks(h: Holding): { dv01: number; cs01: number; fxDeltaPer1Pct: number } {
  const n = h.notionalUsdMm;
  const d = h.durationYears || 0;
  const pv01 = n * d * 100; // USD per bp for n USD mm at duration d
  const s = h.side === 'LONG' ? 1 : -1;
  const g = rawGreeks(h.assetClass, s, pv01, n);
  // "|| 0" turns -0 into 0 so a position with no duration never shows "-0".
  return { dv01: g.dv01 || 0, cs01: g.cs01 || 0, fxDeltaPer1Pct: g.fxDeltaPer1Pct || 0 };
}

function rawGreeks(assetClass: HoldingAssetClass, s: number, pv01: number, n: number) {
  switch (assetClass) {
    case 'HC_BOND':
      return { dv01: -s * pv01, cs01: -s * pv01, fxDeltaPer1Pct: 0 };
    case 'LC_BOND':
      return { dv01: -s * pv01, cs01: 0, fxDeltaPer1Pct: -s * n * 10000 };
    case 'CDS':
      // Long = bought protection: gains when spreads widen.
      return { dv01: 0, cs01: s * pv01, fxDeltaPer1Pct: 0 };
    case 'FX':
      // Long = long the local currency: loses when it depreciates.
      return { dv01: 0, cs01: 0, fxDeltaPer1Pct: -s * n * 10000 };
    default:
      return { dv01: 0, cs01: 0, fxDeltaPer1Pct: 0 };
  }
}
