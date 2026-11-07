/**
 * Positioning and policy-rate feeds: CFTC futures positioning, TIC Treasury holdings and BIS
 * central bank policy rates. Each pull is kept in memory and in data/live/, and pulled again
 * when stale; a failed pull keeps the last good one.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config';
import { cbpolDailyUrl, cbpolMonthlyUrl, type CbpolPull, parseCbpolCsv } from '../../utils/bisPolicyRates';
import { cftcUrl, type CftcWeek, parseCftcRows } from '../../utils/cftcPositioning';
import { describeNetworkError } from '../../utils/connectionCheck';
import { fetchWithTimeout } from '../http';
import { parseTicTable, TIC_URL, type TicTable } from '../../utils/ticHoldings';
import { writeFileAtomic } from '../../utils/atomicWrite';

/**
 * CFTC currency futures positioning (src/utils/cftcPositioning.ts). Weekly: positions as of
 * Tuesday, published Friday. One request covers every currency (about three years of weeks). The
 * pull is saved to data/live/cftc.json with its pull date. It is pulled again only when a newer
 * report can exist (the latest is 7 or more days old) and the last pull is over 12 hours old;
 * a failed pull keeps the last good one and is retried after an hour.
 */
type CftcPull = { pulledAt: string; weeks: Record<string, CftcWeek[]> };
let cftcMemory: { pull: CftcPull | null; triedAt: number } | null = null;
let cftcInFlight: Promise<CftcPull | null> | null = null;
function cftcFile(): string {
  return path.join(DATA_DIR, 'live', 'cftc.json');
}
function cftcLatestDate(pull: CftcPull): string {
  return Object.values(pull.weeks).map((w) => w[w.length - 1]?.date || '').sort().pop() || '';
}
export async function fetchCftcPull(): Promise<CftcPull | null> {
  if (!cftcMemory) {
    try {
      const saved = JSON.parse(fs.readFileSync(cftcFile(), 'utf8')) as CftcPull;
      if (saved?.pulledAt && saved.weeks && typeof saved.weeks === 'object') cftcMemory = { pull: saved, triedAt: Date.parse(saved.pulledAt) };
    } catch {
      // never pulled
    }
  }
  const pull = cftcMemory?.pull;
  if (pull) {
    const sincePull = Date.now() - Date.parse(pull.pulledAt);
    const reportAge = Date.now() - Date.parse(cftcLatestDate(pull));
    if (sincePull < 12 * 60 * 60 * 1000 || reportAge < 7 * 24 * 60 * 60 * 1000) return pull;
  }
  if (cftcMemory && Date.now() - cftcMemory.triedAt < 60 * 60 * 1000) return cftcMemory.pull;
  if (cftcInFlight) return cftcInFlight;
  cftcInFlight = (async () => {
    let weeks: Map<string, CftcWeek[]> | null = null;
    try {
      const res = await fetchWithTimeout(cftcUrl(), 20000);
      if (res.ok) weeks = parseCftcRows(await res.json());
      else console.warn(`[CFTC] positioning refused (HTTP ${res.status})`);
    } catch (e) {
      console.warn(`[CFTC] positioning: ${describeNetworkError(e, 20000)}`);
    }
    const prev = cftcMemory?.pull ?? null;
    if (!weeks || weeks.size === 0) {
      cftcMemory = { pull: prev, triedAt: Date.now() };
      return prev;
    }
    const fresh: CftcPull = { pulledAt: new Date().toISOString(), weeks: Object.fromEntries(weeks) };
    cftcMemory = { pull: fresh, triedAt: Date.now() };
    try {
      fs.mkdirSync(path.dirname(cftcFile()), { recursive: true });
      writeFileAtomic(cftcFile(), JSON.stringify(fresh));
    } catch {
      // keep the memory copy
    }
    return fresh;
  })().finally(() => {
    cftcInFlight = null;
  });
  return cftcInFlight;
}

/**
 * TIC foreign holdings of US Treasuries (src/utils/ticHoldings.ts). Monthly, one small text file
 * for every country. Saved to data/live/tic.json with its pull date and pulled again after a day;
 * a failed pull keeps the last good one and is retried after an hour.
 */
type TicPull = { pulledAt: string; table: TicTable };
let ticMemory: { pull: TicPull | null; triedAt: number } | null = null;
let ticInFlight: Promise<TicPull | null> | null = null;
function ticFile(): string {
  return path.join(DATA_DIR, 'live', 'tic.json');
}
export async function fetchTicPull(): Promise<TicPull | null> {
  if (!ticMemory) {
    try {
      const saved = JSON.parse(fs.readFileSync(ticFile(), 'utf8')) as TicPull;
      if (saved?.pulledAt && saved.table?.months) ticMemory = { pull: saved, triedAt: Date.parse(saved.pulledAt) };
    } catch {
      // never pulled
    }
  }
  if (ticMemory?.pull && Date.now() - Date.parse(ticMemory.pull.pulledAt) < 24 * 60 * 60 * 1000) return ticMemory.pull;
  if (ticMemory && Date.now() - ticMemory.triedAt < 60 * 60 * 1000) return ticMemory.pull;
  if (ticInFlight) return ticInFlight;
  ticInFlight = (async () => {
    let table: TicTable | null = null;
    try {
      const res = await fetchWithTimeout(TIC_URL, 15000);
      if (res.ok) table = parseTicTable(await res.text());
      else console.warn(`[TIC] Treasury holdings refused (HTTP ${res.status})`);
    } catch (e) {
      console.warn(`[TIC] Treasury holdings: ${describeNetworkError(e, 15000)}`);
    }
    const prev = ticMemory?.pull ?? null;
    if (!table) {
      ticMemory = { pull: prev, triedAt: Date.now() };
      return prev;
    }
    const fresh: TicPull = { pulledAt: new Date().toISOString(), table };
    ticMemory = { pull: fresh, triedAt: Date.now() };
    try {
      fs.mkdirSync(path.dirname(ticFile()), { recursive: true });
      writeFileAtomic(ticFile(), JSON.stringify(fresh));
    } catch {
      // keep the memory copy
    }
    return fresh;
  })().finally(() => {
    ticInFlight = null;
  });
  return ticInFlight;
}

/**
 * Central bank policy rates from the BIS (src/utils/bisPolicyRates.ts). Two small requests cover
 * every country: the latest daily figure and about 25 months of month-end figures. Saved to
 * data/live/bis-policy-rates.json with its pull date and pulled again after 12 hours; a failed
 * pull keeps the last good one and is retried after an hour.
 */
let cbpolMemory: { pull: CbpolPull | null; triedAt: number } | null = null;
let cbpolInFlight: Promise<CbpolPull | null> | null = null;
function cbpolFile(): string {
  return path.join(DATA_DIR, 'live', 'bis-policy-rates.json');
}
export async function fetchCbpolPull(): Promise<CbpolPull | null> {
  if (!cbpolMemory) {
    try {
      const saved = JSON.parse(fs.readFileSync(cbpolFile(), 'utf8')) as CbpolPull;
      if (saved?.pulledAt && saved.daily && saved.monthly) cbpolMemory = { pull: saved, triedAt: Date.parse(saved.pulledAt) };
    } catch {
      // never pulled
    }
  }
  if (cbpolMemory?.pull && Date.now() - Date.parse(cbpolMemory.pull.pulledAt) < 12 * 60 * 60 * 1000) return cbpolMemory.pull;
  if (cbpolMemory && Date.now() - cbpolMemory.triedAt < 60 * 60 * 1000) return cbpolMemory.pull;
  if (cbpolInFlight) return cbpolInFlight;
  cbpolInFlight = (async () => {
    const get = async (url: string, what: string): Promise<string | null> => {
      try {
        const res = await fetchWithTimeout(url, 20000);
        if (res.ok) return await res.text();
        console.warn(`[BIS] policy rates (${what}) refused (HTTP ${res.status})`);
      } catch (e) {
        console.warn(`[BIS] policy rates (${what}): ${describeNetworkError(e, 20000)}`);
      }
      return null;
    };
    const [dailyCsv, monthlyCsv] = await Promise.all([get(cbpolDailyUrl(), 'daily'), get(cbpolMonthlyUrl(), 'monthly')]);
    const daily = parseCbpolCsv(dailyCsv, 'D');
    const monthly = parseCbpolCsv(monthlyCsv, 'M');
    const prev = cbpolMemory?.pull ?? null;
    if (!Object.keys(daily).length && !Object.keys(monthly).length) {
      cbpolMemory = { pull: prev, triedAt: Date.now() };
      return prev;
    }
    // If only one of the two answered, keep the other from the last good pull.
    const fresh: CbpolPull = {
      pulledAt: new Date().toISOString(),
      daily: Object.keys(daily).length ? daily : prev?.daily || {},
      monthly: Object.keys(monthly).length ? monthly : prev?.monthly || {},
    };
    cbpolMemory = { pull: fresh, triedAt: Date.now() };
    try {
      fs.mkdirSync(path.dirname(cbpolFile()), { recursive: true });
      writeFileAtomic(cbpolFile(), JSON.stringify(fresh));
    } catch {
      // keep the memory copy
    }
    return fresh;
  })().finally(() => {
    cbpolInFlight = null;
  });
  return cbpolInFlight;
}
