/**
 * Official 10-year government bond yields from free public sources.
 *
 * Source: OECD "Long-term interest rates" (10-year government bonds, monthly average),
 * republished by the St. Louis Fed on FRED. No API key is needed. The figure is a monthly
 * average and is usually one to two months behind, so it is always shown with its month.
 *
 * Two routes to the same data: the official FRED API when FRED_API_KEY is set (free key from
 * fred.stlouisfed.org), otherwise the website's no-key CSV download.
 *
 * Coverage is OECD members plus India (an OECD partner). Colombia and Slovenia are left out: their
 * FRED pages gave no data when checked on 2026-11-07. Brazil comes from the Treasury's own Tesouro Direto file
 * (see `parseTesouroDiretoLatest`). Countries with no verified free source (for example Turkey,
 * Indonesia, Egypt) keep the AI estimate or sample value, and are labelled as such.
 */

export interface OfficialYieldObservation {
  valuePct: number;
  /** YYYY-MM for a monthly average, YYYY-MM-DD for a daily rate. */
  period: string;
  source: string;
  seriesId: string;
  url: string;
  /** Monthly average (FRED / OECD) or one day's rate (Tesouro Direto). Missing means monthly. */
  frequency?: 'monthly' | 'daily';
  /** The bond behind a daily rate, e.g. "NTN-F 2037". */
  instrument?: string;
  /** Monthly series only: change against the same series 3 and 12 calendar months earlier, percentage points. */
  change3mPts?: number;
  change12mPts?: number;
}

/** YYYY-MM n calendar months before `period` (YYYY-MM). */
export function monthsBefore(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 7);
}

/**
 * Adds the 3- and 12-month changes to the latest monthly observation, from the rest of the series.
 * By calendar month, so a gap in the series never passes for a change over a shorter span.
 */
export function withMonthlyChanges(latest: OfficialYieldObservation, history: Map<string, number>): OfficialYieldObservation {
  const out = { ...latest };
  const chg = (n: number) => {
    const then = history.get(monthsBefore(latest.period, n));
    return then === undefined ? undefined : Number((latest.valuePct - then).toFixed(2));
  };
  const c3 = chg(3);
  const c12 = chg(12);
  if (c3 !== undefined) out.change3mPts = c3;
  if (c12 !== undefined) out.change12mPts = c12;
  return out;
}

/** Short and long descriptions for labels, e.g. "Sep 2026 avg" / "30 Oct 2026". */
export function describeOfficialYield(o: OfficialYieldObservation): { when: string; long: string } {
  if (o.frequency === 'daily') {
    const when = formatPeriod(o.period);
    return {
      when,
      long: `${o.source}${o.instrument ? `, ${o.instrument}` : ''}, rate on ${when}`,
    };
  }
  const when = formatPeriod(o.period);
  return { when: `${when} avg`, long: `${o.source}, ${when} monthly average` };
}

/** FRED series ids, checked on fred.stlouisfed.org on 2026-11-04 (latest Sep 2026). */
export const FRED_10Y_SERIES: Record<string, string> = {
  MEX: 'IRLTLT01MXM156N',
  ZAF: 'IRLTLT01ZAM156N',
  JPN: 'IRLTLT01JPM156N',
  GBR: 'IRLTLT01GBM156N',
  POL: 'IRLTLT01PLM156N',
  CHL: 'IRLTLT01CLM156N',
  // Added 2026-11-07 (gap analysis D2); each series page checked live that day, latest month Jun to Sep 2026.
  DEU: 'IRLTLT01DEM156N',
  FRA: 'IRLTLT01FRM156N',
  ITA: 'IRLTLT01ITM156N',
  ESP: 'IRLTLT01ESM156N',
  NLD: 'IRLTLT01NLM156N',
  BEL: 'IRLTLT01BEM156N',
  AUT: 'IRLTLT01ATM156N',
  PRT: 'IRLTLT01PTM156N',
  IRL: 'IRLTLT01IEM156N',
  GRC: 'IRLTLT01GRM156N',
  FIN: 'IRLTLT01FIM156N',
  CAN: 'IRLTLT01CAM156N',
  AUS: 'IRLTLT01AUM156N',
  NZL: 'IRLTLT01NZM156N',
  CHE: 'IRLTLT01CHM156N',
  SWE: 'IRLTLT01SEM156N',
  NOR: 'IRLTLT01NOM156N',
  DNK: 'IRLTLT01DKM156N',
  CZE: 'IRLTLT01CZM156N',
  HUN: 'IRLTLT01HUM156N',
  ISR: 'IRLTLT01ILM156N',
  KOR: 'IRLTLT01KRM156N',
  SVK: 'IRLTLT01SKM156N',
  // India is an OECD partner; FRED files it under a different id pattern.
  IND: 'INDIRLTLT01STM',
};

/** US 10Y Treasury, OECD monthly average on FRED: the benchmark for spreads over Treasuries. */
export const US_10Y_SERIES = 'IRLTLT01USM156N';

export const OFFICIAL_YIELD_SOURCE_LABEL = 'FRED / OECD 10Y government yield (monthly average)';

export function fredSeriesUrl(seriesId: string): string {
  return `https://fred.stlouisfed.org/series/${seriesId}`;
}

/** No-key CSV download, limited to the last two years. */
export function fredCsvUrl(seriesId: string, now = new Date()): string {
  const start = new Date(now.getFullYear() - 2, now.getMonth(), 1).toISOString().slice(0, 10);
  return `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=${start}`;
}

/** Official FRED API, newest observations first. */
export function fredApiUrl(seriesId: string, apiKey: string): string {
  const q = new URLSearchParams({ series_id: seriesId, api_key: apiKey, file_type: 'json', sort_order: 'desc', limit: '13' });
  return `https://api.stlouisfed.org/fred/series/observations?${q.toString()}`;
}

function toObservation(date: string, raw: string, seriesId: string, via: string): OfficialYieldObservation | null | undefined {
  const value = Number(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim()) || raw.trim() === '.' || raw.trim() === '' || !Number.isFinite(value)) return undefined; // skip row
  if (value <= -5 || value > 70) return null; // not a plausible yield: treat the feed as broken
  return { valuePct: Number(value.toFixed(2)), period: date.trim().slice(0, 7), source: `OECD via ${via}`, seriesId, url: fredSeriesUrl(seriesId) };
}

/** Parses a FRED API observations reply ({ observations: [{ date, value }] }). Returns the latest numeric one, or null. */
export function parseFredApiLatest(json: unknown, seriesId: string): OfficialYieldObservation | null {
  const obs = (json as { observations?: Array<{ date?: unknown; value?: unknown }> })?.observations;
  if (!Array.isArray(obs)) return null;
  return latestWithChanges(obs.map((o) => [String(o.date ?? ''), String(o.value ?? '')]), seriesId, 'FRED API');
}

/**
 * Parses a FRED graph CSV ("observation_date,<ID>" or the older "DATE,<ID>" header).
 * Missing values are "." and are skipped. Returns the latest numeric observation, or null.
 */
export function parseFredCsvLatest(csv: string, seriesId: string): OfficialYieldObservation | null {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2 || !/date/i.test(lines[0])) return null;
  return latestWithChanges(lines.slice(1).map((l) => l.split(',') as [string, string]), seriesId, 'FRED');
}

/** The latest usable row, with its 3- and 12-month changes. An implausible latest value means a broken feed (null). */
function latestWithChanges(rows: [string, string | undefined][], seriesId: string, via: string): OfficialYieldObservation | null {
  const sorted = rows.filter(([d, v]) => d && v !== undefined).sort((a, b) => b[0].localeCompare(a[0]));
  let latest: OfficialYieldObservation | null | undefined;
  const history = new Map<string, number>();
  for (const [date, raw] of sorted) {
    const r = toObservation(date, raw as string, seriesId, via);
    if (r === undefined) continue;
    if (latest === undefined) {
      if (r === null) return null;
      latest = r;
    } else if (r && !history.has(r.period)) history.set(r.period, r.valuePct);
  }
  return latest ? withMonthlyChanges(latest, history) : null;
}

/** "Sep 2026" from "2026-09"; "30 Oct 2026" from "2026-10-30". */
export function formatPeriod(period: string): string {
  const [y, m, d] = period.split('-').map(Number);
  if (!y || !m) return period;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (!MONTHS[m - 1]) return period;
  return d ? `${d} ${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} ${y}`;
}

/* ------------------------------------------------------------------------------------------
 * Brazil: Tesouro Direto daily rates (Tesouro Transparente open data, ODbL, no key).
 * Brazil has no OECD 10Y series. The Treasury publishes the daily buy and sell rates of every
 * bond offered on Tesouro Direto. We take the fixed-rate bond with semi-annual coupons
 * (Tesouro Prefixado com Juros Semestrais, NTN-F) whose maturity is closest to 10 years and
 * use the midpoint of its buy and sell rates. It is a retail offer rate, so it is labelled as
 * the Treasury's rate on a named bond, not as a benchmark yield.
 * Checked 2026-11-04: NTN-F 01/01/2037 on 30/10/2026 bought at 15.23%, sold at 15.35%.
 * ------------------------------------------------------------------------------------------ */

export const TESOURO_DIRETO_CSV_URL =
  'https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv';
export const TESOURO_DIRETO_DATASET_URL =
  'https://www.tesourotransparente.gov.br/ckan/dataset/taxas-dos-titulos-ofertados-pelo-tesouro-direto';
export const TESOURO_YIELD_SOURCE_LABEL = 'Tesouro Direto (Brazil) NTN-F daily rate';

const NTNF_TYPE = /prefixado com juros semestrais/i;

/** "30/10/2026" -> "2026-10-30", or null. */
function brDate(v: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** "15,23" -> 15.23, or null. */
function brNumber(v: string): number | null {
  const s = v.trim().replace(/\./g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses the Tesouro Direto CSV (semicolon-separated, Brazilian dates and decimal commas) and returns
 * the NTN-F closest to 10 years on the latest date, as the midpoint of its buy and sell rates.
 */
export function parseTesouroDiretoLatest(csv: string): OfficialYieldObservation | null {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const header = lines[0].split(';').map((h) => h.trim().toLowerCase());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const iType = col(/^tipo titulo/);
  const iMat = col(/^data vencimento/);
  const iBase = col(/^data base/);
  const iBuy = col(/^taxa compra/);
  const iSell = col(/^taxa venda/);
  if ([iType, iMat, iBase, iBuy, iSell].some((i) => i < 0)) return null;

  type Row = { base: string; maturity: string; buy: number | null; sell: number | null };
  const rows: Row[] = [];
  let latest = '';
  for (const line of lines.slice(1)) {
    const c = line.split(';');
    if (!NTNF_TYPE.test(c[iType] || '')) continue;
    const base = brDate(c[iBase] || '');
    const maturity = brDate(c[iMat] || '');
    if (!base || !maturity) continue;
    const r = { base, maturity, buy: brNumber(c[iBuy] || ''), sell: brNumber(c[iSell] || '') };
    if (r.buy === null && r.sell === null) continue;
    rows.push(r);
    if (base > latest) latest = base;
  }
  const yearsTo = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / (365.25 * 86400000);
  const candidates = rows.filter((r) => r.base === latest && yearsTo(r.base, r.maturity) > 5);
  if (!candidates.length) return null;
  candidates.sort((a, b) => Math.abs(yearsTo(a.base, a.maturity) - 10) - Math.abs(yearsTo(b.base, b.maturity) - 10));
  const best = candidates[0];
  const rates = [best.buy, best.sell].filter((x): x is number => x !== null && x > 0);
  if (!rates.length) return null;
  const mid = rates.reduce((a, b) => a + b, 0) / rates.length;
  if (mid <= 0 || mid > 70) return null;
  return {
    valuePct: Number(mid.toFixed(2)),
    period: best.base,
    source: 'Brazil Treasury, Tesouro Direto',
    seriesId: `NTN-F ${best.maturity.slice(0, 4)}`,
    url: TESOURO_DIRETO_DATASET_URL,
    frequency: 'daily',
    instrument: `NTN-F ${best.maturity.slice(0, 4)}, midpoint of buy and sell rates`,
  };
}

/* ------------------------------------------------------------------------------------------
 * Turkey: the central bank's EVDS data service (free, needs a personal key).
 * EVDS3 contract (checked 2026-11-04 against open-source clients that moved to it in late 2025):
 * base https://evds3.tcmb.gov.tr/igmevdsms-dis/, parameters appended to the path (no "?"),
 * dates DD-MM-YYYY, the key sent only in a "key" HTTP header, and a JSON reply of
 * { items: [{ Tarih, TP_X_Y: "12.34" | null, ... }] } where dots in the series code become
 * underscores. The bond series code is set by the user (EVDS_TR10Y_SERIES), because we could not
 * confirm one from public pages; nothing is shown for Turkey until both settings are present
 * and the service answers.
 * ------------------------------------------------------------------------------------------ */

export const EVDS_BASE_URL = 'https://evds3.tcmb.gov.tr/igmevdsms-dis/';
export const EVDS_YIELD_SOURCE_LABEL = 'CBRT EVDS (Turkey) 10Y government bond yield';

function ddmmyyyy(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

/** EVDS series codes are letters, digits, dots and underscores (e.g. TP.DK.USD.A.YTL). */
export function isValidEvdsSeriesCode(code: string): boolean {
  return /^TP\.[A-Z0-9_.]+$/i.test(code.trim());
}

/** Request URL for the last 90 days of a series. The key is NOT part of the URL. */
export function evdsSeriesUrl(seriesCode: string, now = new Date(), days = 90): string {
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return `${EVDS_BASE_URL}series=${seriesCode.trim()}&startDate=${ddmmyyyy(start)}&endDate=${ddmmyyyy(now)}&type=json`;
}

/** "30-10-2026" -> "2026-10-30"; "2026-9" or "2026-09" -> "2026-09". Anything else -> null. */
function evdsPeriod(tarih: string): { period: string; daily: boolean } | null {
  const t = tarih.trim();
  let m = t.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return { period: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, daily: true };
  m = t.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return { period: `${m[1]}-${m[2].padStart(2, '0')}`, daily: false };
  return null;
}

/** Latest numeric observation of one series in an EVDS JSON reply, or null. */
export function parseEvdsLatest(json: unknown, seriesCode: string): OfficialYieldObservation | null {
  const items = (json as { items?: Array<Record<string, unknown>> })?.items;
  if (!Array.isArray(items)) return null;
  const column = seriesCode.trim().replace(/\./g, '_');
  let best: { period: string; daily: boolean; value: number } | null = null;
  for (const row of items) {
    const raw = row?.[column];
    if (raw === null || raw === undefined || String(raw).trim() === '') continue;
    const value = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(value)) continue;
    const p = evdsPeriod(String(row.Tarih ?? ''));
    if (!p) continue;
    if (!best || p.period > best.period) best = { ...p, value };
  }
  if (!best) return null;
  if (best.value <= -5 || best.value > 70) return null;
  return {
    valuePct: Number(best.value.toFixed(2)),
    period: best.period,
    source: 'Central Bank of Turkey, EVDS',
    seriesId: seriesCode.trim(),
    url: 'https://evds3.tcmb.gov.tr/',
    frequency: best.daily ? 'daily' : 'monthly',
  };
}

/** The data-source label recorded on a snapshot when this observation was used. */
export function officialYieldFeedLabel(o: OfficialYieldObservation): string {
  if (/EVDS/.test(o.source)) return EVDS_YIELD_SOURCE_LABEL;
  if (/Brazil|Tesouro/.test(o.source)) return TESOURO_YIELD_SOURCE_LABEL;
  return OFFICIAL_YIELD_SOURCE_LABEL;
}
