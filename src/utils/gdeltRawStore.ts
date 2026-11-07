/**
 * Downloads GDELT 2.0 raw files and keeps only what the app uses (Sam, 2026-11-05).
 *
 * Each 15-minute events file (and one GKG file every few hours) is downloaded into memory,
 * unzipped, added up per country (utils/gdeltRaw.ts) and thrown away. What is kept is one small
 * file per day, data/live/gdelt-raw/YYYY-MM-DD.json, which lists the files already read, so a
 * stopped pull carries on where it left off and a weekly pull only fetches the new files.
 *
 * Settings (.env):
 *   GDELT_RAW_WEEKS        look-back in weeks (default 8, at most 104)
 *   GDELT_GKG_EVERY_HOURS  read one GKG file every this many hours (default 3; 0.25 = every file)
 *
 * A file GDELT does not have (HTTP 404; it has gaps) is noted as missing and not asked for again.
 * Any other failure is tried again on the next pull. HTTP 429 or 503 stops the pull and the app
 * waits 15 minutes before asking again.
 */
import fs from 'fs';
import path from 'path';
import { unzipSync } from 'fflate';
import { writeFileAtomic } from './atomicWrite.ts';
import {
  GDELT_LAST_UPDATE_URL,
  addEventAgg,
  addGkgAgg,
  aggregateEvents,
  aggregateGkg,
  buildSeries,
  emptyDay,
  emptyEventAgg,
  emptyGkgAgg,
  estimatePullBytes,
  parseFileList,
  slotDay,
  slotMs,
  slotUrl,
  slotsBetween,
  type GdeltRawDay,
  type GdeltRawSeries,
  type GdeltRawTable,
} from './gdeltRaw.ts';

export const GDELT_RAW_PAUSE_MS = 15 * 60 * 1000;
export const GDELT_RAW_DEFAULT_WEEKS = 8;
export const GDELT_GKG_DEFAULT_EVERY_HOURS = 3;

export interface GdeltRawConfig {
  weeks: number;
  gkgEveryMinutes: number;
}
export function gdeltRawConfig(env: Record<string, string | undefined>): GdeltRawConfig {
  const w = Number(env.GDELT_RAW_WEEKS);
  const h = Number(env.GDELT_GKG_EVERY_HOURS);
  return {
    weeks: Number.isFinite(w) && w > 0 ? Math.min(104, Math.round(w)) : GDELT_RAW_DEFAULT_WEEKS,
    gkgEveryMinutes: Number.isFinite(h) && h > 0 ? Math.max(15, Math.round((h * 60) / 15) * 15) : GDELT_GKG_DEFAULT_EVERY_HOURS * 60,
  };
}

export function gdeltRawDir(dataDir: string): string {
  return path.join(dataDir, 'live', 'gdelt-raw');
}
const dayFile = (dir: string, day: string) => path.join(dir, `${day}.json`);
const stateFile = (dir: string) => path.join(dir, 'pull.json');

export function loadDay(dir: string, day: string): GdeltRawDay {
  try {
    const d = JSON.parse(fs.readFileSync(dayFile(dir, day), 'utf8')) as GdeltRawDay;
    if (d && d.day === day && d.events && d.gkg && d.countries) return d;
  } catch {
    // none yet
  }
  return emptyDay(day);
}
function saveDay(dir: string, d: GdeltRawDay): void {
  writeFileAtomic(dayFile(dir, d.day), JSON.stringify(d));
}

/** The last pull, for the pull date and the Offline window. */
export interface GdeltRawPullState {
  pulledAt?: string;
  /** Newest 15-minute file GDELT had when the pull ran. */
  latestSlot?: string;
  /** Last result in words. */
  note?: string;
  pausedUntil?: string;
}
export function loadPullState(dir: string): GdeltRawPullState {
  try {
    return JSON.parse(fs.readFileSync(stateFile(dir), 'utf8')) as GdeltRawPullState;
  } catch {
    return {};
  }
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }>;

export interface PullPlan {
  latestSlot: string;
  events: string[];
  gkg: string[];
  /** Rough download size for what is left, from the newest file sizes; null when unknown. */
  estimateBytes: number | null;
}

/** Newest slot and file sizes from lastupdate.txt. */
async function lastUpdate(fetchImpl: FetchLike): Promise<{ slot: string; sizes: { events?: number; gkg?: number } }> {
  const res = await fetchImpl(GDELT_LAST_UPDATE_URL, { signal: AbortSignal.timeout(20000) });
  if (res.status === 429 || res.status === 503) throw Object.assign(new Error(`GDELT asked the app to slow down (HTTP ${res.status})`), { pause: true });
  if (!res.ok) throw new Error(`GDELT file list did not answer (HTTP ${res.status})`);
  const list = parseFileList(await res.text());
  const ev = list.find((f) => f.table === 'events');
  const gkg = list.find((f) => f.table === 'gkg');
  const slot = ev?.slot || gkg?.slot;
  if (!slot) throw new Error('GDELT file list had no files in it');
  return { slot, sizes: { events: ev?.size, gkg: gkg?.size } };
}

/** Files in the look-back not yet read or known missing. */
export function filesLeft(dir: string, latestSlot: string, cfg: GdeltRawConfig): { events: string[]; gkg: string[] } {
  const from = slotMs(latestSlot) - cfg.weeks * 7 * 86400000;
  const cache = new Map<string, GdeltRawDay>();
  const day = (slot: string) => {
    const d = slotDay(slot);
    if (!cache.has(d)) cache.set(d, loadDay(dir, d));
    return cache.get(d)!;
  };
  const left = (table: GdeltRawTable, every: number) =>
    slotsBetween(from, latestSlot, every).filter((s) => {
      const d = day(s)[table];
      const hm = s.slice(8, 12);
      return !d.done.includes(hm) && !d.missing.includes(hm);
    });
  return { events: left('events', 15), gkg: left('gkg', cfg.gkgEveryMinutes) };
}

export async function planPull(dir: string, cfg: GdeltRawConfig, fetchImpl: FetchLike): Promise<PullPlan> {
  const { slot, sizes } = await lastUpdate(fetchImpl);
  const left = filesLeft(dir, slot, cfg);
  return { latestSlot: slot, ...left, estimateBytes: estimatePullBytes({ events: left.events.length, gkg: left.gkg.length }, sizes) };
}

export interface PullResult {
  latestSlot?: string;
  read: { events: number; gkg: number };
  missing: { events: number; gkg: number };
  failed: { events: number; gkg: number };
  bytes: number;
  /** Set when GDELT asked to slow down. */
  pausedUntil?: string;
  stopped?: boolean;
  /** Files still to read after this pull. */
  left: { events: number; gkg: number };
  note: string;
}

/**
 * Reads every file left in the look-back, a few at a time. Day files are saved as they fill, so a
 * stop at any point loses at most the files in flight. Days older than the look-back are deleted.
 */
export async function pullGdeltRaw(opts: {
  dataDir: string;
  cfg: GdeltRawConfig;
  fetchImpl?: FetchLike;
  concurrency?: number;
  shouldStop?: () => boolean;
  onProgress?: (p: { done: number; total: number; table: GdeltRawTable; slot: string }) => void;
  now?: () => number;
}): Promise<PullResult> {
  const dir = gdeltRawDir(opts.dataDir);
  const fetchImpl = opts.fetchImpl || ((url, init) => fetch(url, init));
  const now = opts.now || Date.now;
  const prev = loadPullState(dir);
  const result: PullResult = { read: { events: 0, gkg: 0 }, missing: { events: 0, gkg: 0 }, failed: { events: 0, gkg: 0 }, bytes: 0, left: { events: 0, gkg: 0 }, note: '' };
  const finish = (note: string, extra: Partial<GdeltRawPullState> = {}) => {
    result.note = note;
    const st: GdeltRawPullState = { ...prev, note, ...extra };
    if (result.pausedUntil) st.pausedUntil = result.pausedUntil;
    else delete st.pausedUntil;
    try {
      writeFileAtomic(stateFile(dir), JSON.stringify(st));
    } catch {
      // the figures are saved; only the note is lost
    }
    return result;
  };
  if (prev.pausedUntil && Date.parse(prev.pausedUntil) > now()) {
    result.pausedUntil = prev.pausedUntil;
    const mins = Math.ceil((Date.parse(prev.pausedUntil) - now()) / 60000);
    return finish(`GDELT asked the app to slow down; trying again in ${mins} minute${mins === 1 ? '' : 's'}`);
  }

  let plan: PullPlan;
  try {
    plan = await planPull(dir, opts.cfg, fetchImpl);
  } catch (err: any) {
    if (err?.pause) result.pausedUntil = new Date(now() + GDELT_RAW_PAUSE_MS).toISOString();
    return finish(String(err?.name === 'TimeoutError' ? 'GDELT file list timed out' : err?.message || err));
  }
  result.latestSlot = plan.latestSlot;
  const jobs: Array<{ table: GdeltRawTable; slot: string }> = [
    // Newest first, so a short pull still gives the latest weeks.
    ...plan.events.map((slot) => ({ table: 'events' as const, slot })),
    ...plan.gkg.map((slot) => ({ table: 'gkg' as const, slot })),
  ].sort((a, b) => b.slot.localeCompare(a.slot) || a.table.localeCompare(b.table));

  const days = new Map<string, GdeltRawDay>();
  const dirty = new Set<string>();
  const getDay = (d: string) => {
    if (!days.has(d)) days.set(d, loadDay(dir, d));
    return days.get(d)!;
  };
  const flush = () => {
    for (const d of dirty) saveDay(dir, days.get(d)!);
    dirty.clear();
  };

  let next = 0;
  let done = 0;
  let paused = false;
  const worker = async () => {
    while (next < jobs.length && !paused && !opts.shouldStop?.()) {
      const job = jobs[next++];
      const hm = job.slot.slice(8, 12);
      try {
        const res = await fetchImpl(slotUrl(job.slot, job.table), { signal: AbortSignal.timeout(job.table === 'gkg' ? 120000 : 60000) });
        if (res.status === 429 || res.status === 503) {
          paused = true;
          result.pausedUntil = new Date(now() + GDELT_RAW_PAUSE_MS).toISOString();
          break;
        }
        const day = getDay(slotDay(job.slot));
        if (res.status === 404) {
          if (!day[job.table].missing.includes(hm)) day[job.table].missing.push(hm);
          result.missing[job.table]++;
          dirty.add(day.day);
        } else if (!res.ok) {
          result.failed[job.table]++;
        } else {
          const buf = new Uint8Array(await res.arrayBuffer());
          result.bytes += buf.byteLength;
          const files = unzipSync(buf);
          const name = Object.keys(files)[0];
          if (!name) throw new Error('empty zip');
          const text = new TextDecoder('utf-8').decode(files[name]);
          if (job.table === 'events') {
            const { byCountry } = aggregateEvents(text);
            for (const [iso, agg] of Object.entries(byCountry)) {
              const c = (day.countries[iso] ||= {});
              c.ev = addEventAgg(c.ev || emptyEventAgg(), agg);
            }
          } else {
            const { byCountry } = aggregateGkg(text);
            for (const [iso, agg] of Object.entries(byCountry)) {
              const c = (day.countries[iso] ||= {});
              c.gkg = addGkgAgg(c.gkg || emptyGkgAgg(), agg);
            }
          }
          day[job.table].done.push(hm);
          result.read[job.table]++;
          dirty.add(day.day);
        }
      } catch (err: any) {
        result.failed[job.table]++;
        if (result.failed.events + result.failed.gkg <= 3) console.warn(`[GDELT raw] ${job.slot} ${job.table}: ${err?.message || err}`);
      }
      done++;
      opts.onProgress?.({ done, total: jobs.length, table: job.table, slot: job.slot });
      // Save every 20 files, so a crash loses little.
      if (done % 20 === 0) flush();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency || 4) }, worker));
  flush();
  result.stopped = !paused && !!opts.shouldStop?.() && done < jobs.length;
  pruneDays(dir, slotMs(plan.latestSlot) - (opts.cfg.weeks + 1) * 7 * 86400000);
  const left = filesLeft(dir, plan.latestSlot, opts.cfg);
  result.left = { events: left.events.length, gkg: left.gkg.length };

  const parts = [`read ${result.read.events} events and ${result.read.gkg} GKG files`];
  const missingN = result.missing.events + result.missing.gkg;
  const failedN = result.failed.events + result.failed.gkg;
  if (missingN) parts.push(`${missingN} not published by GDELT`);
  if (failedN) parts.push(`${failedN} did not download (tried again next time)`);
  if (paused) parts.push('GDELT asked the app to slow down; carrying on in 15 minutes');
  if (result.stopped) parts.push('stopped before the end');
  const anyRead = result.read.events + result.read.gkg > 0;
  const nothingToDo = jobs.length === 0;
  return finish(nothingToDo ? 'Up to date' : parts.join('; '), anyRead || nothingToDo ? { pulledAt: new Date(now()).toISOString(), latestSlot: plan.latestSlot } : {});
}

/** Deletes day files older than the cut-off. */
function pruneDays(dir: string, beforeMs: number): void {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names) {
    const m = n.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (m && Date.parse(`${m[1]}T23:59:59Z`) < beforeMs) {
      try {
        fs.rmSync(path.join(dir, n), { force: true });
      } catch {
        // left for the next pull
      }
    }
  }
}

/** All saved days, oldest first. */
export function loadAllDays(dir: string): GdeltRawDay[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((n) => n.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
    .filter((d): d is string => !!d)
    .sort()
    .map((d) => loadDay(dir, d));
}

/** Weekly figures for one country from what is on disk, or null when nothing has been pulled. */
export function readCountrySeries(dataDir: string, iso3: string): GdeltRawSeries | null {
  const dir = gdeltRawDir(dataDir);
  const days = loadAllDays(dir);
  if (!days.length) return null;
  const st = loadPullState(dir);
  const s = buildSeries(iso3.toUpperCase(), days, { pulledAt: st.pulledAt });
  return s.weeks.length ? s : null;
}
