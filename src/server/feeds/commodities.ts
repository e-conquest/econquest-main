/**
 * Commodity prices: World Bank Pink Sheet (monthly, no key) and EIA (with a key).
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config';
import { buildCommodityReply, type CommodityReply, eiaSpotUrl, findPinkSheetUrl, parseEiaSpot, parsePinkSheet, PINK_SHEET_PAGE, PINK_SHEET_SHEET, type PriceSeries } from '../../utils/commodityPrices';
import { describeNetworkError } from '../../utils/connectionCheck';
import { fetchWithTimeout } from '../http';
import { readXlsxSheet } from '../../utils/xlsxRead';
import { writeFileAtomic } from '../../utils/atomicWrite';

/**
 * Commodity prices (src/utils/commodityPrices.ts): World Bank Pink Sheet (monthly, no key) and EIA
 * daily Brent/WTI (free key EIA_API_KEY, optional). Both are saved to data/live/commodities.json
 * with their pull dates. The Pink Sheet is pulled again after a day, EIA after 12 hours; a failed
 * pull keeps the last good one and is retried after an hour.
 */
type PinkPull = { url: string; pulledAt: string; series: Record<string, PriceSeries> };
type EiaPull = { pulledAt: string; series: Record<string, PriceSeries> };
type CommodityFile = { pink: PinkPull | null; eia: EiaPull | null };
export let commodityMemory: (CommodityFile & { pinkTried: number; eiaTried: number }) | null = null;
let commodityInFlight: Promise<CommodityReply> | null = null;
function commodityFile(): string {
  return path.join(DATA_DIR, 'live', 'commodities.json');
}
async function pullPinkSheet(): Promise<PinkPull | null> {
  try {
    let url = (process.env.PINK_SHEET_URL || '').trim();
    if (!url) {
      const page = await fetchWithTimeout(PINK_SHEET_PAGE, 15000);
      if (!page.ok) {
        console.warn(`[Pink Sheet] commodity markets page refused (HTTP ${page.status})`);
        return null;
      }
      url = findPinkSheetUrl(await page.text()) || '';
      if (!url) {
        console.warn('[Pink Sheet] no "Monthly prices" workbook link on the commodity markets page; set PINK_SHEET_URL');
        return null;
      }
    }
    const res = await fetchWithTimeout(url, 45000);
    if (!res.ok) {
      console.warn(`[Pink Sheet] workbook refused (HTTP ${res.status})`);
      return null;
    }
    const rows = await readXlsxSheet(await res.arrayBuffer(), PINK_SHEET_SHEET);
    const series = rows ? parsePinkSheet(rows) : new Map();
    if (series.size === 0) {
      console.warn('[Pink Sheet] workbook read, but no commodity columns recognised');
      return null;
    }
    return { url, pulledAt: new Date().toISOString(), series: Object.fromEntries(series) };
  } catch (e) {
    console.warn(`[Pink Sheet] ${describeNetworkError(e, 45000)}`);
    return null;
  }
}
async function pullEia(key: string): Promise<EiaPull | null> {
  try {
    const res = await fetchWithTimeout(eiaSpotUrl(key), 20000);
    if (!res.ok) {
      console.warn(`[EIA] spot prices refused (HTTP ${res.status})`);
      return null;
    }
    const series = parseEiaSpot(await res.json());
    return series.size ? { pulledAt: new Date().toISOString(), series: Object.fromEntries(series) } : null;
  } catch (e) {
    console.warn(`[EIA] ${describeNetworkError(e, 20000)}`);
    return null;
  }
}
export async function fetchCommodities(): Promise<CommodityReply> {
  const eiaKey = (process.env.EIA_API_KEY || '').trim();
  if (!commodityMemory) {
    let saved: CommodityFile = { pink: null, eia: null };
    try {
      const f = JSON.parse(fs.readFileSync(commodityFile(), 'utf8')) as CommodityFile;
      saved = { pink: f?.pink?.pulledAt ? f.pink : null, eia: f?.eia?.pulledAt ? f.eia : null };
    } catch {
      // never pulled
    }
    commodityMemory = { ...saved, pinkTried: saved.pink ? Date.parse(saved.pink.pulledAt) : 0, eiaTried: saved.eia ? Date.parse(saved.eia.pulledAt) : 0 };
  }
  const mem = commodityMemory;
  const hour = 60 * 60 * 1000;
  const age = (p: { pulledAt: string } | null) => (p ? Date.now() - Date.parse(p.pulledAt) : Infinity);
  const wantPink = age(mem.pink) > 24 * hour && Date.now() - mem.pinkTried > hour;
  const wantEia = !!eiaKey && age(mem.eia) > 12 * hour && Date.now() - mem.eiaTried > hour;
  if (!wantPink && !wantEia) return buildCommodityReply(mem.pink, mem.eia, !!eiaKey);
  if (commodityInFlight) return commodityInFlight;
  commodityInFlight = (async () => {
    const [pink, eia] = await Promise.all([wantPink ? pullPinkSheet() : Promise.resolve(null), wantEia ? pullEia(eiaKey) : Promise.resolve(null)]);
    if (wantPink) mem.pinkTried = Date.now();
    if (wantEia) mem.eiaTried = Date.now();
    if (pink) mem.pink = pink;
    if (eia) mem.eia = eia;
    if (pink || eia) {
      try {
        fs.mkdirSync(path.dirname(commodityFile()), { recursive: true });
        writeFileAtomic(commodityFile(), JSON.stringify({ pink: mem.pink, eia: mem.eia }));
      } catch {
        // keep the memory copy
      }
    }
    return buildCommodityReply(mem.pink, mem.eia, !!eiaKey);
  })().finally(() => {
    commodityInFlight = null;
  });
  return commodityInFlight;
}

/** Forget the commodity pulls in memory (after the EIA key changes), so the next pull uses the new key. */
export function forgetCommodityPulls(): void {
  commodityMemory = null;
}
