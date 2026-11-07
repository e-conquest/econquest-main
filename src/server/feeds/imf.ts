/**
 * IMF external sector: reserves, balance of payments and COFER currency shares (api.imf.org),
 * kept in data/live/ and pulled again when stale.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config';
import { SOVEREIGN_CATALOG } from '../../data/presetsAndBaselines.ts';
import { describeNetworkError } from '../../utils/connectionCheck';
import { type CoferReading, pullCofer } from '../../utils/imfCofer';
import { type ImfExternal, type ImfStructure, pullImfExternal } from '../../utils/imfReserves';
import { writeFileAtomic } from '../../utils/atomicWrite';

/**
 * IMF reserves and balance of payments (src/utils/imfReserves.ts): monthly official reserves (IL)
 * and quarterly current account and imports (BOP) for each catalog country, from api.imf.org.
 * Saved to data/live/imf_external.json with its pull date and pulled again after a day; the
 * datasets' structures (dimensions, indicator names) are kept a week. A failed pull keeps the
 * last good figures per country and is retried after an hour.
 */
type ImfPull = { pulledAt: string; structuresAt?: string; structures?: Record<string, ImfStructure>; countries: Record<string, ImfExternal> };
let imfMemory: { pull: ImfPull | null; triedAt: number } | null = null;
let imfInFlight: Promise<ImfPull | null> | null = null;
function imfFile(): string {
  return path.join(DATA_DIR, 'live', 'imf_external.json');
}
export async function fetchImfPull(): Promise<ImfPull | null> {
  if (!imfMemory) {
    try {
      const saved = JSON.parse(fs.readFileSync(imfFile(), 'utf8')) as ImfPull;
      if (saved?.pulledAt && saved.countries && typeof saved.countries === 'object') imfMemory = { pull: saved, triedAt: Date.parse(saved.pulledAt) };
    } catch {
      // never pulled
    }
  }
  const prev = imfMemory?.pull ?? null;
  if (prev && Date.now() - Date.parse(prev.pulledAt) < 24 * 60 * 60 * 1000) return prev;
  if (imfMemory && Date.now() - imfMemory.triedAt < 60 * 60 * 1000) return prev;
  if (imfInFlight) return imfInFlight;
  imfInFlight = (async () => {
    const weekOld = !prev?.structuresAt || Date.now() - Date.parse(prev.structuresAt) > 7 * 24 * 60 * 60 * 1000;
    let structures: Record<string, ImfStructure> = weekOld ? {} : { ...(prev?.structures || {}) };
    const countries: Record<string, ImfExternal> = {};
    let any = false;
    for (const c of SOVEREIGN_CATALOG) {
      try {
        const r = await pullImfExternal({ fetchFn: (u, i) => fetch(u, i), env: process.env, timeoutMs: 30000, structures }, c.iso3);
        structures = r.structures;
        const got = r.external.reserves || r.external.currentAccount;
        if (got) any = true;
        // Keep the last good figures when this pull got nothing for the country.
        countries[c.iso3] = got || !prev?.countries[c.iso3] ? r.external : prev.countries[c.iso3];
        const bad = r.steps.filter((s) => !s.ok);
        if (bad.length) console.warn(`[IMF] ${c.iso3}: ${bad.map((s) => `${s.measure}: ${s.note}`).join(' | ')}`);
      } catch (e) {
        console.warn(`[IMF] ${c.iso3}: ${describeNetworkError(e, 30000)}`);
        if (prev?.countries[c.iso3]) countries[c.iso3] = prev.countries[c.iso3];
      }
    }
    if (!any) {
      imfMemory = { pull: prev, triedAt: Date.now() };
      return prev;
    }
    const fresh: ImfPull = {
      pulledAt: new Date().toISOString(),
      structuresAt: weekOld ? new Date().toISOString() : prev?.structuresAt,
      structures,
      countries,
    };
    imfMemory = { pull: fresh, triedAt: Date.now() };
    try {
      fs.mkdirSync(path.dirname(imfFile()), { recursive: true });
      writeFileAtomic(imfFile(), JSON.stringify(fresh));
    } catch {
      // keep the memory copy
    }
    return fresh;
  })().finally(() => {
    imfInFlight = null;
  });
  return imfInFlight;
}

/**
 * IMF COFER (src/utils/imfCofer.ts): world currency shares of official FX reserves, quarterly.
 * One small request. Saved to data/live/imf_cofer.json with its pull date, pulled again after a
 * day; a failed pull keeps the last good one and is retried after an hour.
 */
type CoferPull = { pulledAt: string; cofer: CoferReading; structures?: Record<string, ImfStructure> };
let coferMemory: { pull: CoferPull | null; triedAt: number } | null = null;
let coferInFlight: Promise<CoferPull | null> | null = null;
function coferFile(): string {
  return path.join(DATA_DIR, 'live', 'imf_cofer.json');
}
export async function fetchCoferPull(): Promise<CoferPull | null> {
  if (!coferMemory) {
    try {
      const saved = JSON.parse(fs.readFileSync(coferFile(), 'utf8')) as CoferPull;
      if (saved?.pulledAt && saved.cofer?.shares) coferMemory = { pull: saved, triedAt: Date.parse(saved.pulledAt) };
    } catch {
      // never pulled
    }
  }
  const prev = coferMemory?.pull ?? null;
  if (prev && Date.now() - Date.parse(prev.pulledAt) < 24 * 60 * 60 * 1000) return prev;
  if (coferMemory && Date.now() - coferMemory.triedAt < 60 * 60 * 1000) return prev;
  if (coferInFlight) return coferInFlight;
  coferInFlight = (async () => {
    let fresh: CoferPull | null = null;
    try {
      const r = await pullCofer({ fetchFn: (u, i) => fetch(u, i), env: process.env, timeoutMs: 30000, structures: prev?.structures });
      if (r.cofer) fresh = { pulledAt: new Date().toISOString(), cofer: r.cofer, structures: r.structures };
      else console.warn(`[IMF] COFER: ${r.note}`);
    } catch (e) {
      console.warn(`[IMF] COFER: ${describeNetworkError(e, 30000)}`);
    }
    if (!fresh) {
      coferMemory = { pull: prev, triedAt: Date.now() };
      return prev;
    }
    coferMemory = { pull: fresh, triedAt: Date.now() };
    try {
      fs.mkdirSync(path.dirname(coferFile()), { recursive: true });
      writeFileAtomic(coferFile(), JSON.stringify(fresh));
    } catch {
      // keep the memory copy
    }
    return fresh;
  })().finally(() => {
    coferInFlight = null;
  });
  return coferInFlight;
}
