/**
 * Quarterly real GDP growth from the OECD's quarterly national accounts (Sam, 2026-11-06: nowcasting
 * and forecasting need a quarterly GDP figure; the IMF and World Bank only publish years).
 *
 * Source: OECD dataflow DSD_NAMAIN1@DF_QNA_EXPENDITURE_GROWTH_OECD ("Quarterly real GDP growth"),
 * read through DBnomics (api.db.nomics.world, free, no key) like the leading indicator and CPI.
 * Series read: GDP (TRANSACTION B1GQ), chain-linked volume (PRICE_BASE L), calendar and seasonally
 * adjusted (ADJUSTMENT Y), quarterly (FREQ Q), as two growth rates: quarter on previous quarter
 * (TRANSFORMATION G1) and on the same quarter a year earlier (GY), in per cent.
 *
 * About 53 areas: OECD members and some partners (Argentina among them). An area the OECD does not
 * cover reads Missing with that reason. DBnomics' copy of the OECD runs some months behind the
 * OECD itself; the check line shows the newest quarter so the delay is visible.
 *
 * Only real observations are kept: a quarter the source left blank stays out.
 * Browser-safe (no fs).
 */
import { OECD_AREA_FOR, dbnomicsUrl } from './oecdSdmx';

export const QNA_DATASET = 'DSD_NAMAIN1@DF_QNA_EXPENDITURE_GROWTH_OECD';
export const QNA_LABEL = 'OECD quarterly national accounts via DBnomics (real GDP, chain-linked volume, seasonally adjusted)';
export const QNA_SOURCE = 'OECD via DBnomics';

export type QnaBasis = 'qoq' | 'yoy';

export interface QnaPoint {
  /** YYYY-Qn. */
  period: string;
  value: number;
}

export interface QnaArea {
  /** Growth on the previous quarter, % (not annualised). */
  qoq: QnaPoint[];
  /** Growth on the same quarter a year earlier, %. */
  yoy: QnaPoint[];
}

export type QnaSeries = Record<string, QnaArea>;

/**
 * DBnomics query: quarterly real GDP growth for every area (or the areas given). `wide` drops every
 * filter but the transaction, in case a dimension code differs; the reader still keeps only the
 * series described above.
 */
export function qnaUrl(opts: { areas?: string[]; wide?: boolean } = {}): string {
  const areas = (opts.areas || []).flatMap((a) => OECD_AREA_FOR[a] || [a]);
  return dbnomicsUrl(QNA_DATASET, {
    ...(areas.length ? { REF_AREA: areas } : {}),
    TRANSACTION: ['B1GQ'],
    ...(opts.wide ? {} : { FREQ: ['Q'], ADJUSTMENT: ['Y'], TRANSFORMATION: ['G1', 'GY'] }),
  });
}

/** "2025-Q3", "2025Q3", "2025-q3" -> "2025-Q3"; anything else null. */
export function quarterKey(p: unknown): string | null {
  const m = /^(\d{4})-?[Qq]([1-4])$/.exec(String(p ?? '').trim());
  return m ? `${m[1]}-Q${m[2]}` : null;
}

const want: Record<string, string[]> = { FREQ: ['Q'], ADJUSTMENT: ['Y'], TRANSACTION: ['B1GQ'], PRICE_BASE: ['L', 'LR'], UNIT_MEASURE: ['PC'] };

/** Reads the DBnomics reply into quarter-on-quarter and year-on-year growth per area. Null when nothing usable. */
export function parseQna(text: unknown): QnaSeries | null {
  let json: any;
  try {
    json = typeof text === 'string' ? JSON.parse(text.replace(/^﻿/, '')) : text;
  } catch {
    return null;
  }
  const docs = json?.series?.docs;
  if (!Array.isArray(docs)) return null;
  const out: QnaSeries = {};
  for (const doc of docs) {
    const dims: Record<string, string> = {};
    for (const [k, v] of Object.entries(doc?.dimensions && typeof doc.dimensions === 'object' ? doc.dimensions : {})) dims[k.toUpperCase()] = String(v);
    const area = String(dims.REF_AREA || '').toUpperCase();
    if (!area) continue;
    // A dimension the reply does not carry is not checked; one it carries must match.
    if (Object.entries(want).some(([d, ok]) => dims[d] !== undefined && !ok.includes(dims[d]))) continue;
    if (dims.SECTOR !== undefined && dims.SECTOR !== 'S1') continue;
    const basis: QnaBasis | null = dims.TRANSFORMATION === 'G1' ? 'qoq' : dims.TRANSFORMATION === 'GY' ? 'yoy' : null;
    if (!basis) continue;
    const periods: unknown[] = Array.isArray(doc?.period) ? doc.period : [];
    const values: unknown[] = Array.isArray(doc?.value) ? doc.value : [];
    const pts: QnaPoint[] = [];
    periods.forEach((p, i) => {
      const period = quarterKey(p);
      const v = values[i];
      const value = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && v !== 'NA' ? Number(v) : NaN;
      if (period && Number.isFinite(value)) pts.push({ period, value });
    });
    if (!pts.length) continue;
    pts.sort((a, b) => (a.period < b.period ? -1 : 1));
    const cur = (out[area] ||= { qoq: [], yoy: [] });
    // Two series for the same area and basis: keep the one that reaches further.
    if (!cur[basis].length || pts[pts.length - 1].period > cur[basis][cur[basis].length - 1].period) cur[basis] = pts;
  }
  for (const [a, s] of Object.entries(out)) if (!s.qoq.length && !s.yoy.length) delete out[a];
  return Object.keys(out).length ? out : null;
}

/** The OECD's series for an app country (its ISO3 code, or the euro area for the EU row). */
export function qnaFor(iso3: string, series: QnaSeries | null | undefined): QnaArea | null {
  if (!series) return null;
  for (const code of OECD_AREA_FOR[iso3] || [iso3]) if (series[code]) return series[code];
  return null;
}

export interface QnaReading {
  iso3: string;
  quarter: string;
  qoqPct?: number;
  yoyPct?: number;
}

/** Newest quarter with its two growth rates. */
export function qnaReading(iso3: string, series: QnaSeries | null | undefined): QnaReading | null {
  const a = qnaFor(iso3, series);
  if (!a) return null;
  const last = [a.qoq.at(-1)?.period, a.yoy.at(-1)?.period].filter(Boolean).sort().pop();
  if (!last) return null;
  const q = a.qoq.find((p) => p.period === last);
  const y = a.yoy.find((p) => p.period === last);
  return { iso3, quarter: last, ...(q ? { qoqPct: q.value } : {}), ...(y ? { yoyPct: y.value } : {}) };
}

/** "Q3 2025" from "2025-Q3". */
export const formatQuarter = (q: string) => `Q${q.slice(-1)} ${q.slice(0, 4)}`;

/** "Real GDP +0.4% q/q, +2.1% y/y (Q2 2026)." */
export function qnaSentence(r: QnaReading): string {
  const sg = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  const parts = [r.qoqPct !== undefined ? `${sg(r.qoqPct)} q/q` : null, r.yoyPct !== undefined ? `${sg(r.yoyPct)} y/y` : null].filter(Boolean);
  return `Real GDP ${parts.join(', ')} (${formatQuarter(r.quarter)}).`;
}

/** Why a country has no quarterly GDP figure. */
export function qnaMissing(pulled: boolean): string {
  return pulled
    ? 'The OECD quarterly national accounts (via DBnomics) answered but carry no quarterly GDP for this country.'
    : 'DBnomics (the free mirror the app reads OECD data from) has not answered for quarterly GDP yet.';
}
