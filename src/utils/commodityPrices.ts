/**
 * Commodity prices for the spillover scenarios (Sam, 2026-11-05: "World Bank Pink Sheet and EIA
 * for monthly commodity prices and oil. Feeds the Spillover scenarios with actual export-price
 * moves.").
 *
 * Two free sources:
 * - World Bank Pink Sheet (Commodity Price Data), monthly averages in nominal US dollars, no key.
 *   The workbook's address changes with each monthly release, so the app reads the World Bank's
 *   commodity markets page and follows its "Monthly prices" link (CMO-Historical-Data-Monthly.xlsx).
 *   PINK_SHEET_URL in .env overrides that link if the page ever changes.
 *   Released early each month for the month before.
 * - US EIA open data, daily Brent and WTI spot prices, free key (EIA_API_KEY). Optional: without
 *   it oil comes from the Pink Sheet, monthly.
 *
 * Every figure carries its month or day. A commodity the source does not list reads Missing.
 * Moves are stated as plain percentage changes over 1 and 12 months; nothing is forecast.
 */

export const PINK_SHEET_LABEL = 'World Bank Commodity Price Data (Pink Sheet), monthly';
export const PINK_SHEET_PAGE = 'https://www.worldbank.org/en/research/commodity-markets';
export const PINK_SHEET_SHEET = 'Monthly Prices';
export const EIA_LABEL = 'US EIA spot prices (daily)';
export const EIA_HOST = 'api.eia.gov';

/** Months of history kept per commodity: enough for 12-month moves and a 3-year average. */
export const PINK_HISTORY_MONTHS = 60;

export interface CommodityDef {
  /** The Pink Sheet's own series code (row of codes under the units row). */
  code: string;
  name: string;
  unit: string;
  /** The Pink Sheet's column heading, used when the code row is missing. */
  heading: string;
}

/** The commodities the app reads: the main exports of the countries it covers. */
export const PINK_COMMODITIES: CommodityDef[] = [
  { code: 'CRUDE_BRENT', name: 'Brent crude', unit: '$/bbl', heading: 'Crude oil, Brent' },
  { code: 'CRUDE_WTI', name: 'WTI crude', unit: '$/bbl', heading: 'Crude oil, WTI' },
  { code: 'CRUDE_DUBAI', name: 'Dubai crude', unit: '$/bbl', heading: 'Crude oil, Dubai' },
  { code: 'CRUDE_PETRO', name: 'Crude oil (average)', unit: '$/bbl', heading: 'Crude oil, average' },
  { code: 'NGAS_EUR', name: 'Natural gas, Europe', unit: '$/mmbtu', heading: 'Natural gas, Europe' },
  { code: 'NGAS_US', name: 'Natural gas, US', unit: '$/mmbtu', heading: 'Natural gas, US' },
  { code: 'NGAS_JP', name: 'LNG, Japan', unit: '$/mmbtu', heading: 'Liquefied natural gas, Japan' },
  { code: 'COAL_AUS', name: 'Coal, Australian', unit: '$/mt', heading: 'Coal, Australian' },
  { code: 'COPPER', name: 'Copper', unit: '$/mt', heading: 'Copper' },
  { code: 'IRON_ORE', name: 'Iron ore', unit: '$/dmtu', heading: 'Iron ore, cfr spot' },
  { code: 'ALUMINUM', name: 'Aluminium', unit: '$/mt', heading: 'Aluminum' },
  { code: 'NICKEL', name: 'Nickel', unit: '$/mt', heading: 'Nickel' },
  { code: 'GOLD', name: 'Gold', unit: '$/troy oz', heading: 'Gold' },
  { code: 'PLATINUM', name: 'Platinum', unit: '$/troy oz', heading: 'Platinum' },
  { code: 'SILVER', name: 'Silver', unit: '$/troy oz', heading: 'Silver' },
  { code: 'SOYBEANS', name: 'Soybeans', unit: '$/mt', heading: 'Soybeans' },
  { code: 'MAIZE', name: 'Maize', unit: '$/mt', heading: 'Maize' },
  { code: 'WHEAT_US_HRW', name: 'Wheat (US HRW)', unit: '$/mt', heading: 'Wheat, US HRW' },
  { code: 'PALM_OIL', name: 'Palm oil', unit: '$/mt', heading: 'Palm oil' },
  { code: 'COFFEE_ARABIC', name: 'Coffee (arabica)', unit: '$/kg', heading: 'Coffee, Arabica' },
  { code: 'COCOA', name: 'Cocoa', unit: '$/kg', heading: 'Cocoa' },
  { code: 'SUGAR_WLD', name: 'Sugar (world)', unit: '$/kg', heading: 'Sugar, world' },
];

export interface PricePoint {
  /** YYYY-MM for monthly, YYYY-MM-DD for daily. */
  period: string;
  value: number;
}

export interface PriceSeries {
  code: string;
  name: string;
  unit: string;
  source: 'pink_sheet' | 'eia';
  /** Oldest first. */
  points: PricePoint[];
}

/** The "Monthly prices" workbook link on the World Bank's commodity markets page, made absolute. */
export function findPinkSheetUrl(html: unknown): string | null {
  if (typeof html !== 'string') return null;
  const m = html.match(/href="([^"]*CMO-Historical-Data-Monthly\.xlsx[^"]*)"/i);
  if (!m) return null;
  const href = m[1].replace(/&amp;/g, '&');
  try {
    return new URL(href, PINK_SHEET_PAGE).toString();
  } catch {
    return null;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/\*+/g, '').replace(/\s+/g, ' ').trim();

/**
 * Rows of the "Monthly Prices" sheet -> series by code. The sheet has a few title rows, then a
 * row of headings ("Crude oil, Brent"), a row of units ("($/bbl)"), a row of codes
 * ("CRUDE_BRENT"), then one row per month with the month in the first column ("2025M09").
 * Columns are found by code, or by heading when there is no code row. Cells that are not numbers
 * ("…", blank) are skipped. Empty map when the layout is not recognised.
 */
export function parsePinkSheet(rows: string[][], defs = PINK_COMMODITIES, keepMonths = PINK_HISTORY_MONTHS): Map<string, PriceSeries> {
  const out = new Map<string, PriceSeries>();
  const firstData = rows.findIndex((r) => /^\d{4}M\d{2}$/.test((r[0] || '').trim()));
  if (firstData < 0) return out;
  const header = rows.slice(0, firstData);
  const codeRow = header.find((r) => r.some((c) => c.trim() === 'CRUDE_BRENT' || c.trim() === 'CRUDE_PETRO'));
  const headingRow = header.find((r) => r.some((c) => norm(c).startsWith('crude oil')));
  const colOf = new Map<string, number>();
  for (const d of defs) {
    let col = codeRow ? codeRow.findIndex((c) => c.trim() === d.code) : -1;
    if (col < 0 && headingRow) col = headingRow.findIndex((c) => norm(c) === norm(d.heading));
    if (col > 0) colOf.set(d.code, col);
  }
  if (colOf.size === 0) return out;
  const months: Array<{ period: string; row: string[] }> = [];
  for (const r of rows.slice(firstData)) {
    const m = (r[0] || '').trim().match(/^(\d{4})M(\d{2})$/);
    if (m) months.push({ period: `${m[1]}-${m[2]}`, row: r });
  }
  months.sort((a, b) => a.period.localeCompare(b.period));
  for (const d of defs) {
    const col = colOf.get(d.code);
    if (col === undefined) continue;
    const points: PricePoint[] = [];
    for (const { period, row } of months) {
      const v = Number((row[col] || '').trim());
      if ((row[col] || '').trim() !== '' && Number.isFinite(v) && v > 0) points.push({ period, value: v });
    }
    if (points.length) out.set(d.code, { code: d.code, name: d.name, unit: d.unit, source: 'pink_sheet', points: points.slice(-keepMonths) });
  }
  return out;
}

/** EIA daily spot series the app reads. */
export const EIA_SERIES: Record<string, { name: string; unit: string }> = {
  RBRTE: { name: 'Brent crude (EIA daily)', unit: '$/bbl' },
  RWTC: { name: 'WTI crude (EIA daily)', unit: '$/bbl' },
};

/** Daily Brent and WTI spot, newest first, about 15 months (5,000-row cap is far off). */
export function eiaSpotUrl(key: string, now = new Date(), series = Object.keys(EIA_SERIES)): string {
  const start = new Date(now.getTime() - 460 * 86400000).toISOString().slice(0, 10);
  const params = [
    `api_key=${encodeURIComponent(key)}`,
    'frequency=daily',
    'data[0]=value',
    ...series.map((s) => `facets[series][]=${encodeURIComponent(s)}`),
    `start=${start}`,
    'sort[0][column]=period',
    'sort[0][direction]=desc',
    'length=2000',
  ];
  return `https://${EIA_HOST}/v2/petroleum/pri/spt/data/?${params.join('&')}`;
}

/** EIA v2 reply {response: {data: [{period, series, value}]}} -> series by code, oldest first. Values may come as strings. */
export function parseEiaSpot(json: unknown): Map<string, PriceSeries> {
  const out = new Map<string, PriceSeries>();
  const data = (json as { response?: { data?: unknown } })?.response?.data;
  if (!Array.isArray(data)) return out;
  for (const r of data as Array<Record<string, unknown>>) {
    const code = String(r?.series ?? '').trim();
    const def = EIA_SERIES[code];
    const period = String(r?.period ?? '').slice(0, 10);
    const value = Number(r?.value);
    if (!def || !/^\d{4}-\d{2}-\d{2}$/.test(period) || !Number.isFinite(value) || value <= 0) continue;
    const s = out.get(code) || { code, name: def.name, unit: def.unit, source: 'eia' as const, points: [] };
    s.points.push({ period, value });
    out.set(code, s);
  }
  for (const s of out.values()) {
    s.points.sort((a, b) => a.period.localeCompare(b.period));
    for (let i = s.points.length - 1; i > 0; i--) if (s.points[i - 1].period === s.points[i].period) s.points.splice(i - 1, 1);
  }
  return out;
}

export interface PriceMove {
  code: string;
  name: string;
  unit: string;
  source: 'pink_sheet' | 'eia';
  /** Month (YYYY-MM) or day (YYYY-MM-DD) of the latest price. */
  asOf: string;
  latest: number;
  /** Percent change over about one month. */
  change1mPct?: number;
  /** Percent change over about three months. */
  change3mPct?: number;
  /** Percent change over about twelve months. */
  change12mPct?: number;
  /** Latest against the average of the last 36 months (monthly series only), percent. */
  vs3yAvgPct?: number;
}

const pct = (a: number, b: number) => Number((((a - b) / b) * 100).toFixed(1));

/** The point on or before `period` (string compare works for YYYY-MM and YYYY-MM-DD). */
function onOrBefore(points: PricePoint[], period: string): PricePoint | undefined {
  for (let i = points.length - 1; i >= 0; i--) if (points[i].period <= period) return points[i];
  return undefined;
}

function shiftPeriod(period: string, months: number): string {
  const [y, m, d] = period.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 - months, 1));
  const ym = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
  return d ? `${ym}-${String(d).padStart(2, '0')}` : ym;
}

/** Latest price and its moves. Null for an empty series. */
export function priceMove(s: PriceSeries): PriceMove | null {
  const last = s.points[s.points.length - 1];
  if (!last) return null;
  const m1 = onOrBefore(s.points, shiftPeriod(last.period, 1));
  const m3 = onOrBefore(s.points, shiftPeriod(last.period, 3));
  const m12 = onOrBefore(s.points, shiftPeriod(last.period, 12));
  // A move only counts if the older point is within a few days/one month of the target.
  const near = (p: PricePoint | undefined, months: number) => (p && p.period > shiftPeriod(last.period, months + 1) ? p : undefined);
  const a1 = near(m1, 1);
  const a3 = near(m3, 3);
  const a12 = near(m12, 12);
  const monthly = /^\d{4}-\d{2}$/.test(last.period);
  const last36 = monthly ? s.points.filter((p) => p.period > shiftPeriod(last.period, 36)) : [];
  const avg = last36.length >= 24 ? last36.reduce((x, p) => x + p.value, 0) / last36.length : undefined;
  return {
    code: s.code,
    name: s.name,
    unit: s.unit,
    source: s.source,
    asOf: last.period,
    latest: last.value,
    ...(a1 ? { change1mPct: pct(last.value, a1.value) } : {}),
    ...(a3 ? { change3mPct: pct(last.value, a3.value) } : {}),
    ...(a12 ? { change12mPct: pct(last.value, a12.value) } : {}),
    ...(avg !== undefined ? { vs3yAvgPct: pct(last.value, avg) } : {}),
  };
}

export interface CommodityReply {
  moves: PriceMove[];
  /** Commodities the app reads that have no figure, with the reason. */
  missing: Array<{ code: string; name: string; reason: string }>;
  pinkSheet?: { url: string; pulledAt: string; latestMonth: string };
  eia?: { pulledAt: string; latestDay: string };
  /** Why EIA has no figures: no key, or it did not answer. */
  eiaStatus: 'ok' | 'needs_key' | 'no_answer';
  pinkStatus: 'ok' | 'no_answer';
}

/** Builds the reply the app shows from the saved pulls. */
export function buildCommodityReply(
  pink: { url: string; pulledAt: string; series: Record<string, PriceSeries> } | null,
  eia: { pulledAt: string; series: Record<string, PriceSeries> } | null,
  eiaKeySet: boolean
): CommodityReply {
  const moves: PriceMove[] = [];
  const missing: CommodityReply['missing'] = [];
  for (const d of PINK_COMMODITIES) {
    const s = pink?.series[d.code];
    const mv = s ? priceMove(s) : null;
    if (mv) moves.push(mv);
    else
      missing.push({
        code: d.code,
        name: d.name,
        reason: pink ? 'Not found in the Pink Sheet workbook (the column may have been renamed).' : 'The World Bank Pink Sheet did not answer.',
      });
  }
  for (const [code, def] of Object.entries(EIA_SERIES)) {
    const s = eia?.series[code];
    const mv = s ? priceMove(s) : null;
    if (mv) moves.push(mv);
    else missing.push({ code, name: def.name, reason: eiaKeySet ? 'EIA did not answer.' : 'Needs setup: free EIA key (Menu > Settings, or EIA_API_KEY). Monthly oil comes from the Pink Sheet meanwhile.' });
  }
  const latest = (series: Record<string, PriceSeries> | undefined) =>
    Object.values(series || {}).map((s) => s.points[s.points.length - 1]?.period || '').sort().pop() || '';
  return {
    moves,
    missing,
    ...(pink ? { pinkSheet: { url: pink.url, pulledAt: pink.pulledAt, latestMonth: latest(pink.series) } } : {}),
    ...(eia ? { eia: { pulledAt: eia.pulledAt, latestDay: latest(eia.series) } } : {}),
    eiaStatus: eia && Object.keys(eia.series).length ? 'ok' : eiaKeySet ? 'no_answer' : 'needs_key',
    pinkStatus: pink && Object.keys(pink.series).length ? 'ok' : 'no_answer',
  };
}

const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;

/** "Brent crude $64.20/bbl (2026-10), +3.1% on the month, -12.4% on the year." */
export function moveSentence(m: PriceMove): string {
  const unit = m.unit.startsWith('$/') ? `/${m.unit.slice(2)}` : ` ${m.unit}`;
  const parts = [`${m.name} $${m.latest.toLocaleString('en-US', { maximumFractionDigits: 2 })}${unit} (${m.asOf})`];
  if (m.change1mPct !== undefined) parts.push(`${signed(m.change1mPct)} on the month`);
  if (m.change12mPct !== undefined) parts.push(`${signed(m.change12mPct)} on the year`);
  return `${parts.join(', ')}.`;
}
