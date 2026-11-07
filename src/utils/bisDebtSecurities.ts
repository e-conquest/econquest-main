/**
 * Government debt securities from the BIS (Bank for International Settlements) SDMX API, free and
 * with no key. Two dataflows, both read as CSV:
 *
 * 1. WS_DEBT_SEC2_PUB, international debt securities (BIS-compiled): bonds and notes the general
 *    government (ISSUER_BUS_IMM 2) has placed in international markets (MARKET C), amounts
 *    outstanding (MEASURE I), all currencies (ISSUE_CUR TO1). The key leaves ISSUE_CUR_GROUP
 *    (A all, D domestic, F foreign currency) and ISSUE_RE_MAT (A all, U up to and including one
 *    year) open, so one call gives the total, the foreign-currency part and what falls due within a
 *    year. US$ millions.
 * 2. WS_NA_SEC_DSS, debt securities statistics: general government (S13) debt securities
 *    liabilities (F3, stocks LE) in all markets, domestic and international, all maturities, all
 *    currencies, in US$ billions. VALUATION is left open: N is nominal (face) value, M market value;
 *    nominal is preferred because that is what has to be repaid.
 *
 * Keys and codes were read from the BIS_DEBT_SEC2 and NA_SEC structures and checked against live
 * answers on 2026-11-04 (for example Brazil 2026-Q2: $65.9 bn international, $1.8 bn due within a
 * year; 2026-Q1: $2,195 bn all markets, nominal). Egypt has no all-markets series. The BIS host
 * does not answer from this project's cloud session, so the parsers are tested on fixtures copied
 * from those answers; when a series is missing the feed returns nothing for it.
 */

import { quarterKey } from './debtSchedule';

export const BIS_API = 'https://stats.bis.org/api/v1/data';
export const BIS_LABEL = 'BIS debt securities statistics';

/** ISO 3166 alpha-2 codes the BIS uses for the countries in the catalogue. */
export const BIS_ISO2: Record<string, string> = {
  BRA: 'BR',
  MEX: 'MX',
  ZAF: 'ZA',
  TUR: 'TR',
  IDN: 'ID',
  EGY: 'EG',
  POL: 'PL',
  CHL: 'CL',
  GBR: 'GB',
  JPN: 'JP',
  ARG: 'AR',
  COL: 'CO',
  IND: 'IN',
  CHN: 'CN',
  USA: 'US',
  DEU: 'DE',
  FRA: 'FR',
  ITA: 'IT',
  KOR: 'KR',
  NGA: 'NG',
  PER: 'PE',
  PHL: 'PH',
  MYS: 'MY',
  THA: 'TH',
  HUN: 'HU',
  ROU: 'RO',
  SAU: 'SA',
};

export interface BisDebtSecurities {
  /** International markets, from WS_DEBT_SEC2_PUB. */
  intl?: {
    asOf: string;
    outstandingUsdBn: number;
    /** Remaining maturity up to and including one year. */
    dueWithin1yUsdBn?: number;
    foreignCcyUsdBn?: number;
  };
  /** All markets, domestic and international, from WS_NA_SEC_DSS. */
  all?: {
    asOf: string;
    outstandingUsdBn: number;
    valuation: 'nominal' | 'market';
  };
}

export function bisIntlUrl(iso2: string): string {
  return `${BIS_API}/WS_DEBT_SEC2_PUB/Q.${iso2}.3P.2.1.C.A..TO1.A..A.A.A.I/all?lastNObservations=1&format=csv`;
}

export function bisAllMarketsUrl(iso2: string): string {
  return `${BIS_API}/WS_NA_SEC_DSS/Q.N.${iso2}.XW.S13.S1.N.L.LE.F3.T._Z.USD._T..V.N._T/all?lastNObservations=1&format=csv`;
}

/** One CSV line; fields may be quoted (the BIS quotes TITLE, which holds commas). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** BIS SDMX CSV -> rows keyed by column name. Header names are the structure's component ids. */
export function parseBisCsv(text: unknown): Array<Record<string, string>> {
  if (typeof text !== 'string') return [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const head = splitCsvLine(lines[0]).map((h) => h.trim());
  if (!head.includes('OBS_VALUE') || !head.includes('TIME_PERIOD')) return [];
  return lines.slice(1).map((l) => {
    const cells = splitCsvLine(l);
    return Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

/** Value in US$ bn, using UNIT_MULT (power of ten). Non-USD or unreadable rows give null. */
function usdBn(r: Record<string, string>): number | null {
  if (r.UNIT_MEASURE && r.UNIT_MEASURE !== 'USD') return null;
  const v = Number(r.OBS_VALUE);
  const mult = r.UNIT_MULT === '' || r.UNIT_MULT === undefined ? 0 : Number(r.UNIT_MULT);
  if (r.OBS_VALUE === '' || !Number.isFinite(v) || !Number.isInteger(mult) || v < 0) return null;
  return (v * 10 ** mult) / 1e9;
}

/** Latest quarter's value for rows matching `pick`; two different values for that quarter -> null. */
function latest(rows: Array<Record<string, string>>, pick: (r: Record<string, string>) => boolean): { asOf: string; usdBn: number } | null {
  let best: { asOf: string; usdBn: number } | null = null;
  for (const r of rows) {
    if (!pick(r)) continue;
    const q = quarterKey(r.TIME_PERIOD);
    const v = usdBn(r);
    if (!q || v === null) continue;
    if (!best || q > best.asOf) best = { asOf: q, usdBn: v };
    else if (q === best.asOf && Math.abs(v - best.usdBn) > 1e-9) return null;
  }
  return best;
}

export function parseBisIntl(text: unknown): BisDebtSecurities['intl'] | null {
  const rows = parseBisCsv(text).filter(
    (r) => r.ISSUER_BUS_IMM === '2' && r.MARKET === 'C' && r.MEASURE === 'I' && r.ISSUE_OR_MAT === 'A'
  );
  const total = latest(rows, (r) => r.ISSUE_CUR_GROUP === 'A' && r.ISSUE_RE_MAT === 'A');
  if (!total) return null;
  const same = (r: Record<string, string>) => quarterKey(r.TIME_PERIOD) === total.asOf;
  const due = latest(rows, (r) => same(r) && r.ISSUE_CUR_GROUP === 'A' && r.ISSUE_RE_MAT === 'U');
  const fx = latest(rows, (r) => same(r) && r.ISSUE_CUR_GROUP === 'F' && r.ISSUE_RE_MAT === 'A');
  return {
    asOf: total.asOf,
    outstandingUsdBn: total.usdBn,
    ...(due ? { dueWithin1yUsdBn: due.usdBn } : {}),
    ...(fx ? { foreignCcyUsdBn: fx.usdBn } : {}),
  };
}

export function parseBisAllMarkets(text: unknown): BisDebtSecurities['all'] | null {
  const rows = parseBisCsv(text).filter((r) => r.REF_SECTOR === 'S13' && r.INSTR_ASSET === 'F3' && r.STO === 'LE');
  const nominal = latest(rows, (r) => r.VALUATION === 'N');
  const market = latest(rows, (r) => r.VALUATION === 'M');
  // Nominal unless market value is for a later quarter.
  if (nominal && (!market || nominal.asOf >= market.asOf)) return { asOf: nominal.asOf, outstandingUsdBn: nominal.usdBn, valuation: 'nominal' };
  if (market) return { asOf: market.asOf, outstandingUsdBn: market.usdBn, valuation: 'market' };
  return null;
}
