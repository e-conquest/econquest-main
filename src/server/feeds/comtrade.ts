/**
 * UN Comtrade trade partners and export mix per country, kept in data/live/comtrade.json.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config';
import { SOVEREIGN_CATALOG } from '../../data/presetsAndBaselines.ts';
import { buildProfile, COMTRADE_REPORTERS, type ComtradeProfile, type ComtradeRow, comtradeUrl, comtradeYears, parseComtrade } from '../../utils/comtradeTrade';
import { describeNetworkError } from '../../utils/connectionCheck';
import { writeFileAtomic } from '../../utils/atomicWrite';

/**
 * UN Comtrade partners and export mix (src/utils/comtradeTrade.ts). Annual, so each country is
 * pulled once every 30 days (6 hours after a miss) and saved to data/live/comtrade.json with its
 * pull date. Two requests per country, sent one at a time with a gap, because the free preview
 * allows few requests; COMTRADE_API_KEY (free) switches to the keyed route.
 */
type ComtradeEntry = { pulledAt: string; profile: ComtradeProfile };
export type ComtradeFile = { countries: Record<string, ComtradeEntry> };
export let comtradeMemory: { file: ComtradeFile; triedAt: Record<string, number> } | null = null;
let comtradeInFlight: Promise<ComtradeFile> | null = null;
function comtradeFile(): string {
  return path.join(DATA_DIR, 'live', 'comtrade.json');
}
const COMTRADE_GAP_MS = 1500;
async function comtradeGet(url: string, key: string): Promise<ComtradeRow[] | null> {
  try {
    const res = await fetch(url, { headers: key ? { 'Ocp-Apim-Subscription-Key': key } : {}, signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      console.warn(`[Comtrade] refused (HTTP ${res.status})`);
      return null;
    }
    return parseComtrade(await res.json());
  } catch (e) {
    console.warn(`[Comtrade] ${describeNetworkError(e, 20000)}`);
    return null;
  }
}
async function pullComtradeCountry(iso3: string, key: string): Promise<ComtradeProfile | null> {
  const reporter = COMTRADE_REPORTERS[iso3];
  if (!reporter) return null;
  const pause = () => new Promise((r) => setTimeout(r, COMTRADE_GAP_MS));
  for (const year of comtradeYears()) {
    const partners = await comtradeGet(comtradeUrl(reporter, year, 'partners', !!key), key);
    await pause();
    if (partners === null) return null; // refused or no answer: stop, try again later
    if (!partners.length) continue; // not reported that year yet
    const products = (await comtradeGet(comtradeUrl(reporter, year, 'products', !!key), key)) || [];
    await pause();
    return buildProfile(iso3, partners, products);
  }
  return null;
}
export async function fetchComtrade(): Promise<ComtradeFile> {
  if (!comtradeMemory) {
    let file: ComtradeFile = { countries: {} };
    try {
      const f = JSON.parse(fs.readFileSync(comtradeFile(), 'utf8')) as ComtradeFile;
      if (f?.countries && typeof f.countries === 'object') file = f;
    } catch {
      // never pulled
    }
    comtradeMemory = { file, triedAt: {} };
  }
  const mem = comtradeMemory;
  const day = 24 * 60 * 60 * 1000;
  const due = SOVEREIGN_CATALOG.map((c) => c.iso3).filter((iso) => {
    if (!COMTRADE_REPORTERS[iso]) return false;
    const e = mem.file.countries[iso];
    const fresh = e && Date.now() - Date.parse(e.pulledAt) < 30 * day;
    const triedRecently = Date.now() - (mem.triedAt[iso] || 0) < day / 4;
    return !fresh && !triedRecently;
  });
  if (!due.length) return mem.file;
  if (comtradeInFlight) return comtradeInFlight;
  const key = (process.env.COMTRADE_API_KEY || '').trim();
  comtradeInFlight = (async () => {
    // Saved after each country: the paced pass takes minutes, and a restart or a stopped download
    // part-way must not lose the countries already pulled.
    for (const iso of due) {
      mem.triedAt[iso] = Date.now();
      const profile = await pullComtradeCountry(iso, key);
      if (!profile) continue;
      mem.file.countries[iso] = { pulledAt: new Date().toISOString(), profile };
      try {
        fs.mkdirSync(path.dirname(comtradeFile()), { recursive: true });
        writeFileAtomic(comtradeFile(), JSON.stringify(mem.file));
      } catch {
        // keep the memory copy
      }
    }
    return mem.file;
  })().finally(() => {
    comtradeInFlight = null;
  });
  return comtradeInFlight;
}
