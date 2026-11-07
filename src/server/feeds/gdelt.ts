/**
 * GDELT: the DOC API (tone and headlines per country, rate-limited to one call every 5.5 s) and
 * the quarterly pull kept in data/live/gdelt/.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config';
import { OpenDataSnapshot } from '../../types/council.ts';
import { gdeltToneShift, type GdeltToneShift } from '../../utils/gdeltTone.ts';
import { writeFileAtomic } from '../../utils/atomicWrite';

/**
 * GDELT allows one request every 5 seconds and answers HTTP 429 otherwise (seen on Sam's Mac,
 * 2026-11-05). Every GDELT request takes the next free slot, 5.5 seconds apart. A request that
 * would wait more than 30 seconds is not sent; its figures read Missing until the next refresh.
 * After a refusal GDELT holds each further answer about 11 seconds and keeps refusing, so after any
 * 429 the app sends nothing to GDELT for 15 minutes.
 */
const GDELT_GAP_MS = 5500;
const GDELT_MAX_WAIT_MS = 30000;
const GDELT_PAUSE_MS = 15 * 60 * 1000;
let gdeltNextSlot = 0;
export let gdeltPausedUntil = 0;
function gdeltSlot(): Promise<void> {
  const now = Date.now();
  if (now < gdeltPausedUntil) {
    const mins = Math.ceil((gdeltPausedUntil - now) / 60000);
    return Promise.reject(new Error(`GDELT refused too many requests; the app is pausing GDELT for ${mins} more minute${mins === 1 ? '' : 's'}`));
  }
  const slot = Math.max(now, gdeltNextSlot);
  if (slot - now > GDELT_MAX_WAIT_MS) return Promise.reject(new Error('GDELT queue full'));
  gdeltNextSlot = slot + GDELT_GAP_MS;
  return new Promise((resolve) => setTimeout(resolve, slot - now));
}
/** Any GDELT request, from the snapshot or the connection check, goes through here. */
export async function gdeltFetch(url: string, init?: RequestInit): Promise<Response> {
  await gdeltSlot();
  const res = await fetch(url, init);
  if (res.status === 429) {
    gdeltPausedUntil = Date.now() + GDELT_PAUSE_MS;
    console.warn('[GDELT] HTTP 429 (too many requests): pausing GDELT for 15 minutes');
  }
  return res;
}
async function fetchGdelt(url: string, timeoutMs: number): Promise<Response> {
  // 20 s: a refusal arrives after about 11 s, and it must be seen to start the pause.
  return gdeltFetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
}

/**
 * GDELT on its own schedule per country: every GDELT_REFRESH_DAYS days (default 7; Sam asked about
 * quarterly on 2026-11-05, which is GDELT_REFRESH_DAYS=90). A pull is two requests (tone timeline,
 * article list). It is saved to data/live/gdelt/<ISO3>.json and reused until the interval passes;
 * it counts only when the tone came back. A failed pull is retried after an
 * hour (or after the 15-minute pause that follows a refusal). Headlines carry GDELT's own date and
 * the country's average tone: GDELT gives no tone per article, so none is made up.
 */
export const GDELT_REFRESH_DAYS = Math.max(1, Number(process.env.GDELT_REFRESH_DAYS) || 7);
export const GDELT_REFRESH_MS = GDELT_REFRESH_DAYS * 24 * 60 * 60 * 1000;
type GdeltPull = { pulledAt: string; tone: number; headlines: OpenDataSnapshot['gdeltMetrics']['topHeadlines']; toneShift?: GdeltToneShift };
const gdeltMemory = new Map<string, { pull: GdeltPull | null; triedAt: number }>();
const gdeltInFlight = new Map<string, Promise<GdeltPull | null>>();
function gdeltFile(iso3: string): string {
  return path.join(DATA_DIR, 'live', 'gdelt', `${iso3.replace(/[^A-Z0-9]/g, '')}.json`);
}
export async function fetchGdeltQuarterly(iso3: string, countryName: string): Promise<GdeltPull | null> {
  let mem = gdeltMemory.get(iso3);
  if (!mem) {
    try {
      const saved = JSON.parse(fs.readFileSync(gdeltFile(iso3), 'utf8')) as GdeltPull;
      if (saved?.pulledAt && typeof saved.tone === 'number') {
        mem = { pull: saved, triedAt: Date.parse(saved.pulledAt) };
        gdeltMemory.set(iso3, mem);
      }
    } catch {
      // never pulled
    }
  }
  const fresh = mem?.pull && Date.now() - Date.parse(mem.pull.pulledAt) < GDELT_REFRESH_MS;
  if (fresh) return mem!.pull;
  if (mem && Date.now() - mem.triedAt < 60 * 60 * 1000) return mem.pull; // tried within the hour
  const running = gdeltInFlight.get(iso3);
  if (running) return running;
  const job = (async () => {
    const q = encodeURIComponent(`"${countryName}" (economy OR central bank OR debt OR inflation OR sanctions)`);
    let tone: number | null = null;
    let headlines: GdeltPull['headlines'] = [];
    let toneShift: GdeltToneShift | null = null;
    try {
      const res = await fetchGdelt(`https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=timelinetone&format=json`, 20000);
      if (res.ok) {
        const series = ((await res.json()) as any)?.timeline?.[0]?.data;
        if (Array.isArray(series) && series.length) {
          const recent = series.slice(-7);
          const avg = recent.reduce((a: number, pt: any) => a + Number(pt?.value || 0), 0) / recent.length;
          if (Number.isFinite(avg) && avg !== 0) tone = Number(avg.toFixed(2));
          toneShift = gdeltToneShift(series);
        }
      }
    } catch {
      tone = null;
    }
    if (tone !== null) {
      try {
        const res = await fetchGdelt(`https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&format=json&maxrecords=6`, 20000);
        if (res.ok) {
          const arts = ((await res.json()) as any)?.articles;
          if (Array.isArray(arts)) {
            headlines = arts
              .filter((a: any) => a?.title && a?.url)
              .slice(0, 4)
              .map((a: any) => ({
                title: String(a.title),
                sourceDomain: String(a.domain || ''),
                publishedAt: parseGdeltSeenDate(a.seendate),
                toneScore: tone!,
                url: String(a.url),
              }));
          }
        }
      } catch {
        headlines = [];
      }
    }
    const prev = gdeltMemory.get(iso3)?.pull ?? null;
    if (tone === null) {
      // Keep the last good pull (it carries its own date) and retry later.
      gdeltMemory.set(iso3, { pull: prev, triedAt: Date.now() });
      return prev;
    }
    const pull: GdeltPull = { pulledAt: new Date().toISOString(), tone, headlines, ...(toneShift ? { toneShift } : {}) };
    gdeltMemory.set(iso3, { pull, triedAt: Date.now() });
    try {
      fs.mkdirSync(path.dirname(gdeltFile(iso3)), { recursive: true });
      writeFileAtomic(gdeltFile(iso3), JSON.stringify(pull));
    } catch {
      // keep the memory copy
    }
    return pull;
  })().finally(() => gdeltInFlight.delete(iso3));
  gdeltInFlight.set(iso3, job);
  return job;
}

function parseGdeltSeenDate(seenDate?: string): string {
  if (!seenDate || typeof seenDate !== 'string') return new Date().toISOString();
  // GDELT format: YYYYMMDDTHHMMSSZ
  const m = seenDate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (m) {
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
  }
  const d = new Date(seenDate);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
