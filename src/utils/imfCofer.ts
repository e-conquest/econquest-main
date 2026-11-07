/**
 * IMF COFER: currency composition of official foreign exchange reserves (Sam, 2026-11-05: "IMF
 * COFER ... for reserve composition").
 *
 * COFER is published quarterly and only for the world and country groups, never for a single
 * country, so it is a world reading: how much of the world's allocated FX reserves central banks
 * hold in US dollars, euros, renminbi, yen, sterling and the other named currencies. For a
 * country whose currency is one of them (Japan, the UK, the US, China, the euro area), it is also
 * that currency's place in world reserves.
 *
 * Source: api.imf.org SDMX 3.0, dataset COFER (agency IMF.STA), no key. As with IL and BOP
 * (imfReserves.ts), no codes are hard-coded: the app reads the structure, finds the world code by
 * its IMF name, asks for every COFER series for the world at quarterly frequency, and reads the
 * currency from each series' indicator name. Shares are the IMF's own share series when present,
 * otherwise claims in the currency over total allocated reserves (stated). IMF_COFER_KEY in .env
 * sets the series key directly.
 */
import { IMF_SDMX_HOST, getJson, imfDataUrl, loadStructures, parseImfData, seriesScale, toUsdBn, type ImfFetch, type ImfSeries, type ImfStructure } from './imfReserves';

export const COFER_FLOW = 'COFER';
export const COFER_LABEL = 'IMF COFER (currency composition of official FX reserves)';
export { IMF_SDMX_HOST };

export const COFER_CURRENCIES: Array<{ ccy: string; name: string; re: RegExp }> = [
  { ccy: 'USD', name: 'US dollar', re: /\bU\.?S\.? dollars?\b|\bUSD\b/i },
  { ccy: 'EUR', name: 'euro', re: /\beuros?\b|\bEUR\b/i },
  { ccy: 'CNY', name: 'renminbi', re: /renminbi|yuan|\bCNY\b/i },
  { ccy: 'JPY', name: 'yen', re: /\byen\b|\bJPY\b/i },
  { ccy: 'GBP', name: 'pound sterling', re: /pounds? sterling|\bsterling\b|\bGBP\b/i },
  { ccy: 'CAD', name: 'Canadian dollar', re: /canadian dollars?|\bCAD\b/i },
  { ccy: 'AUD', name: 'Australian dollar', re: /australian dollars?|\bAUD\b/i },
  { ccy: 'CHF', name: 'Swiss franc', re: /swiss francs?|\bCHF\b/i },
];

/** The currency COFER names for a country, when it names one. */
export const COFER_CCY_BY_ISO3: Record<string, string> = {
  USA: 'USD',
  JPN: 'JPY',
  GBR: 'GBP',
  CHN: 'CNY',
  CAN: 'CAD',
  AUS: 'AUD',
  CHE: 'CHF',
  EU: 'EUR',
  EMU: 'EUR',
  EUR: 'EUR',
  DEU: 'EUR',
  FRA: 'EUR',
  ITA: 'EUR',
  ESP: 'EUR',
  NLD: 'EUR',
};

export interface CoferShare {
  ccy: string;
  pct: number;
  /** Change in the share over 4 quarters, percentage points. */
  change4qPts?: number;
}

export interface CoferReading {
  /** YYYY-Qn. */
  period: string;
  area: { id: string; name: string };
  shares: CoferShare[];
  totalAllocatedUsdBn?: number;
  /** "imf share" when the IMF's share series were read; "claims over allocated" when worked out. */
  method: 'imf share' | 'claims over allocated';
}

export const WORLD_IDS = ['G001', 'W00', 'G999', 'WLD'];

/** A few series keys with their names, so the check shows what came back. */
export function describeSeries(series: ImfSeries[], n = 6): string {
  return `First series: ${series.slice(0, n).map((x) => `${x.key} (${Object.values(x.dims).map((d) => d.name || d.id).join(' / ')})`).join('; ')}`;
}

const WORLD = /^world$|^all countries|world\b.*total|^total,? world/i;

/** The world code from the structure's country codelist, by name (or a known world code). */
export function findWorldCode(s: ImfStructure): { id: string; name: string } | null {
  const codes = s.countryCodes ?? [];
  return codes.find((c) => WORLD.test(c.name)) ?? codes.find((c) => ['G001', 'W00', 'W0', 'WLD', '001'].includes(c.id)) ?? null;
}

export function coferKey(s: ImfStructure, area: string): string {
  return s.dims.map((d) => (d === s.countryDim ? area : d === s.freqDim ? 'Q' : '*')).join('.');
}

/** Where the currency is named: a currency dimension (FXR_CURRENCY on the live API), else the indicator. */
const CCY_DIMS = /CURRENCY/;
const indName = (x: ImfSeries, s?: ImfStructure) => {
  const ccyDim = Object.keys(x.dims).find((d) => CCY_DIMS.test(d));
  const parts = [ccyDim ? `${x.dims[ccyDim].name} ${x.dims[ccyDim].id}` : '', x.dims[s?.indicatorDim ?? 'INDICATOR']?.name || x.dims[s?.indicatorDim ?? 'INDICATOR']?.id || ''];
  return parts.filter(Boolean).join(' | ') || Object.values(x.dims).map((d) => d.name || d.id).join(' | ');
};
/** Live codes join words with underscores (CI_AUD = claims in Australian dollars), so they are split first. */
const ccyOf = (name: string) => COFER_CURRENCIES.find((c) => c.re.test(name.replace(/_/g, ' ').replace(/\bin U\.?S\.? dollars? terms\b/i, '')))?.ccy;
/** A share series: "share" or "percent" in a name, or a percent code (…_PT, SHR…) on the transformation or unit. */
const isShare = (x: ImfSeries) =>
  /share|percent|% of/i.test(Object.values(x.dims).map((d) => d.name).join(' | ')) ||
  Object.entries(x.dims).some(([dim, d]) => /TRANSFORMATION|UNIT/.test(dim) && /(^|_)PT$|^PT|SHR|^SH_/i.test(d.id));
const quarterly = (x: ImfSeries) => x.obs.filter((o) => /^\d{4}-Q[1-4]$/.test(o.period));

function yearBefore(q: string): string {
  const [y, n] = q.split('-Q');
  return `${Number(y) - 1}-Q${n}`;
}

/** Reads the world's currency shares from COFER series. Null when no currency could be read. */
export function readCofer(series: ImfSeries[], area: { id: string; name: string }, s?: ImfStructure): CoferReading | null {
  const q = series.map((x) => ({ x, obs: quarterly(x), name: indName(x, s) })).filter((r) => r.obs.length);
  if (!q.length) return null;
  const shareRows = q.filter((r) => isShare(r.x) && ccyOf(r.name) && !/unallocated/i.test(r.name));
  const latestOf = (rows: typeof q) => rows.map((r) => r.obs[r.obs.length - 1].period).sort().pop();
  if (shareRows.length) {
    const period = latestOf(shareRows)!;
    const shares: CoferShare[] = [];
    for (const r of shareRows) {
      const ccy = ccyOf(r.name)!;
      if (shares.some((x) => x.ccy === ccy)) continue;
      const now = r.obs.find((o) => o.period === period);
      if (!now) continue;
      const ago = r.obs.find((o) => o.period === yearBefore(period));
      shares.push({ ccy, pct: round(now.value, 2), ...(ago ? { change4qPts: round(now.value - ago.value, 2) } : {}) });
    }
    if (!shares.length) return null;
    return { period, area, shares: order(shares), method: 'imf share' };
  }
  // No share series: claims in each currency over total allocated reserves.
  const valueRows = q.filter((r) => !isShare(r.x));
  const total = valueRows.find((r) => /allocated/i.test(r.name) && !/unallocated|claims in/i.test(r.name) && !ccyOf(r.name));
  if (!total) return null;
  const period = total.obs[total.obs.length - 1].period;
  const tNow = total.obs.find((o) => o.period === period)!.value;
  const tAgo = total.obs.find((o) => o.period === yearBefore(period))?.value;
  const shares: CoferShare[] = [];
  for (const r of valueRows) {
    const ccy = ccyOf(r.name);
    if (!ccy || r === total || shares.some((x) => x.ccy === ccy) || /unallocated/i.test(r.name)) continue;
    const now = r.obs.find((o) => o.period === period);
    if (!now || !(tNow > 0)) continue;
    const ago = r.obs.find((o) => o.period === yearBefore(period));
    const pct = (now.value / tNow) * 100;
    shares.push({ ccy, pct: round(pct, 2), ...(ago && tAgo ? { change4qPts: round(pct - (ago.value / tAgo) * 100, 2) } : {}) });
  }
  if (!shares.length) return null;
  const bn = toUsdBn(tNow, seriesScale(total.x));
  return { period, area, shares: order(shares), ...(bn !== null ? { totalAllocatedUsdBn: round(bn, 0) } : {}), method: 'claims over allocated' };
}

const round = (v: number, dp: number) => Number(v.toFixed(dp));
const order = (xs: CoferShare[]) => [...xs].sort((a, b) => b.pct - a.pct);

export interface CoferPullOptions {
  fetchFn: ImfFetch;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  structures?: Record<string, ImfStructure>;
}

/** Pulls COFER for the world. Returns the reading, or a reason in words. */
export async function pullCofer(opts: CoferPullOptions): Promise<{ cofer: CoferReading | null; note: string; structures: Record<string, ImfStructure>; httpStatus?: number }> {
  const override = opts.env?.IMF_COFER_KEY?.trim();
  let structures = { ...(opts.structures || {}) };
  let key: string;
  let area: { id: string; name: string };
  let how: string;
  let s: ImfStructure | undefined;
  if (override) {
    key = override;
    area = { id: key.split('.').find((p) => p && p !== '*' && p !== 'Q') ?? 'world', name: 'World' };
    how = 'series key from IMF_COFER_KEY';
  } else {
    const loaded = await loadStructures({ fetchFn: opts.fetchFn, timeoutMs: opts.timeoutMs, structures }, [COFER_FLOW]);
    structures = loaded.structures;
    s = structures[COFER_FLOW];
    if (!s) return { cofer: null, note: loaded.errors[COFER_FLOW] ?? 'IMF COFER structure not read.', structures };
    const named = findWorldCode(s);
    if (named) {
      area = named;
      key = coferKey(s, named.id);
      how = `IMF COFER for ${named.id} ("${named.name}")`;
    } else {
      // The structure did not carry the country list: try the IMF's world codes in turn.
      for (const id of WORLD_IDS) {
        const tryKey = coferKey(s, id);
        const t = await getJson(opts.fetchFn, imfDataUrl(COFER_FLOW, tryKey), opts.timeoutMs ?? 30000);
        const series = t.json ? parseImfData(t.json) : [];
        if (series.length) {
          const cofer = readCofer(series, { id, name: 'World' }, s);
          if (cofer) return { cofer, note: `IMF COFER for ${id} (world code tried in turn; the structure had no country list)`, structures, httpStatus: t.status };
          return { cofer: null, note: `IMF COFER for ${id}: ${series.length} series came back, but no currency share could be read. ${describeSeries(series)}`, structures, httpStatus: t.status };
        }
      }
      return { cofer: null, note: `No world code found: the COFER country list was not in the structure and ${WORLD_IDS.join(', ')} returned no series. Set IMF_COFER_KEY in .env (dimension order: ${s.dims.join('.')}).`, structures };
    }
  }
  const r = await getJson(opts.fetchFn, imfDataUrl(COFER_FLOW, key), opts.timeoutMs ?? 30000);
  if (!r.json) return { cofer: null, note: `${how}: ${r.error}`, structures, ...(r.status ? { httpStatus: r.status } : {}) };
  const all = parseImfData(r.json);
  const cofer = readCofer(all, area, s);
  if (!cofer) return { cofer: null, note: `${how}: ${all.length} series came back, but no currency share could be read from their names. ${describeSeries(all)}`, structures, httpStatus: r.status };
  return { cofer, note: `${how}; ${cofer.method === 'imf share' ? "the IMF's share series" : 'claims in each currency over total allocated reserves'}`, structures, httpStatus: r.status };
}

export const ccyName = (ccy: string) => COFER_CURRENCIES.find((c) => c.ccy === ccy)?.name ?? ccy;

/** "US dollar 56.3%, euro 20.1%, ..." for the first n currencies. */
export function coferLine(c: CoferReading, n = 5): string {
  return c.shares
    .slice(0, n)
    .map((x) => `${ccyName(x.ccy)} ${x.pct.toFixed(1)}%`)
    .join(', ');
}
