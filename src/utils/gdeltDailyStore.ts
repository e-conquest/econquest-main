/**
 * Downloads the GDELT 1.0 event files (utils/gdeltDaily.ts) and keeps only per-country monthly
 * totals: one small file per month in data/live/gdelt-daily/YYYY-MM.json, listing the files
 * already added, so a stopped pull carries on and a later pull fetches only new daily files.
 *
 * Each zip is streamed: downloaded, unzipped and read line by line as it arrives, then dropped.
 * The large backfiles (a year file unzips to over a gigabyte) are never held in memory whole.
 *
 * Settings (.env): GDELT_DAILY_FROM, the first month to read (default 2016-01; 1979 for all).
 * HTTP 404 = not published (noted, not asked again); 429 or 503 = pause 15 minutes.
 */
import fs from 'fs';
import path from 'path';
import { Unzip, UnzipInflate } from 'fflate';
import { writeFileAtomic } from './atomicWrite.ts';
import {
  GDELT_V1_BASE,
  GDELT_V1_SIZES_URL,
  addToMonth,
  bytesOf,
  emptyMonth,
  filesFrom,
  lineSplitter,
  parseFileSizes,
  v1Reader,
  v1Series,
  type V1File,
  type V1FileTotals,
  type V1Month,
  type V1Series,
} from './gdeltDaily.ts';

export const GDELT_DAILY_PAUSE_MS = 15 * 60 * 1000;

export function gdeltDailyDir(dataDir: string): string {
  return path.join(dataDir, 'live', 'gdelt-daily');
}
const monthFile = (dir: string, month: string) => path.join(dir, `${month}.json`);
const stateFile = (dir: string) => path.join(dir, 'pull.json');

export function loadMonth(dir: string, month: string): V1Month {
  try {
    const m = JSON.parse(fs.readFileSync(monthFile(dir, month), 'utf8')) as V1Month;
    if (m && m.month === month && Array.isArray(m.files) && m.countries) return m;
  } catch {
    // none yet
  }
  return emptyMonth(month);
}
function saveMonth(dir: string, m: V1Month): void {
  writeFileAtomic(monthFile(dir, m.month), JSON.stringify(m));
}

export interface GdeltDailyState {
  pulledAt?: string;
  note?: string;
  pausedUntil?: string;
  /** Files GDELT does not have (HTTP 404). */
  missing?: string[];
  from?: string;
}
export function loadDailyState(dir: string): GdeltDailyState {
  try {
    return JSON.parse(fs.readFileSync(stateFile(dir), 'utf8')) as GdeltDailyState;
  } catch {
    return {};
  }
}

export type StreamFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

/** Files in the look-back not yet in every month they fill. */
export function filesLeft(dir: string, all: V1File[], fromMonth: string, missing: string[] = []): V1File[] {
  const cache = new Map<string, V1Month>();
  const month = (m: string) => {
    if (!cache.has(m)) cache.set(m, loadMonth(dir, m));
    return cache.get(m)!;
  };
  return filesFrom(all, fromMonth).filter((f) => !missing.includes(f.name) && f.months.filter((m) => m >= fromMonth).some((m) => !month(m).files.includes(f.name)));
}

export interface DailyPlan {
  from: string;
  files: V1File[];
  bytes: number;
}

export async function planDailyPull(dir: string, fromMonth: string, fetchImpl: StreamFetch): Promise<DailyPlan> {
  const res = await fetchImpl(GDELT_V1_SIZES_URL, { signal: AbortSignal.timeout(30000) });
  if (res.status === 429 || res.status === 503) throw Object.assign(new Error(`GDELT asked the app to slow down (HTTP ${res.status})`), { pause: true });
  if (!res.ok) throw new Error(`GDELT file list did not answer (HTTP ${res.status})`);
  const all = parseFileSizes(await res.text());
  if (!all.length) throw new Error('GDELT file list had no event files in it');
  const files = filesLeft(dir, all, fromMonth, loadDailyState(dir).missing);
  return { from: fromMonth, files, bytes: bytesOf(files) };
}

/** Streams one zip through the reader. Returns the bytes downloaded. */
export async function streamZipLines(res: Response, onLine: (line: string) => void): Promise<number> {
  let bytes = 0;
  let csvSeen = false;
  let error: unknown = null;
  const unzip = new Unzip((file) => {
    if (csvSeen || !/\.csv$/i.test(file.name)) return;
    csvSeen = true;
    const decoder = new TextDecoder('utf-8');
    const lines = lineSplitter(onLine);
    file.ondata = (err, chunk, final) => {
      if (err) {
        error = err;
        return;
      }
      lines.push(decoder.decode(chunk, { stream: !final }));
      if (final) lines.end();
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      unzip.push(value, false);
      if (error) throw error;
    }
    unzip.push(new Uint8Array(0), true);
  } else {
    const buf = new Uint8Array(await res.arrayBuffer());
    bytes = buf.byteLength;
    unzip.push(buf, true);
  }
  if (error) throw error;
  if (!csvSeen) throw new Error('zip had no .CSV file inside');
  return bytes;
}

export interface DailyPullResult {
  read: number;
  missing: number;
  failed: number;
  bytes: number;
  left: number;
  pausedUntil?: string;
  stopped?: boolean;
  note: string;
}

/** Reads every file left, newest first, a couple at a time. Months are saved as each file finishes. */
export async function pullGdeltDaily(opts: {
  dataDir: string;
  fromMonth: string;
  fetchImpl?: StreamFetch;
  concurrency?: number;
  shouldStop?: () => boolean;
  onProgress?: (p: { done: number; total: number; file: string; bytes: number }) => void;
  now?: () => number;
}): Promise<DailyPullResult> {
  const dir = gdeltDailyDir(opts.dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const fetchImpl = opts.fetchImpl || ((u, i) => fetch(u, i));
  const now = opts.now || Date.now;
  const prev = loadDailyState(dir);
  const result: DailyPullResult = { read: 0, missing: 0, failed: 0, bytes: 0, left: 0, note: '' };
  const missing = new Set(prev.missing || []);
  const finish = (note: string, ok: boolean) => {
    result.note = note;
    const st: GdeltDailyState = { ...prev, note, from: opts.fromMonth, missing: [...missing] };
    if (ok) st.pulledAt = new Date(now()).toISOString();
    if (result.pausedUntil) st.pausedUntil = result.pausedUntil;
    else delete st.pausedUntil;
    try {
      writeFileAtomic(stateFile(dir), JSON.stringify(st));
    } catch {
      // the months are saved; only the note is lost
    }
    return result;
  };
  if (prev.pausedUntil && Date.parse(prev.pausedUntil) > now()) {
    result.pausedUntil = prev.pausedUntil;
    return finish(`GDELT asked the app to slow down; trying again after ${prev.pausedUntil.slice(11, 16)} UTC`, false);
  }
  let plan: DailyPlan;
  try {
    plan = await planDailyPull(dir, opts.fromMonth, fetchImpl);
  } catch (err: any) {
    if (err?.pause) result.pausedUntil = new Date(now() + GDELT_DAILY_PAUSE_MS).toISOString();
    return finish(String(err?.name === 'TimeoutError' ? 'GDELT file list timed out' : err?.message || err), false);
  }
  const jobs = [...plan.files].sort((a, b) => b.period.localeCompare(a.period));
  let next = 0;
  let done = 0;
  let paused = false;
  const worker = async () => {
    while (next < jobs.length && !paused && !opts.shouldStop?.()) {
      const f = jobs[next++];
      try {
        // A year file is up to ~160 MB zipped; allow it time.
        const res = await fetchImpl(`${GDELT_V1_BASE}${f.name}`, { signal: AbortSignal.timeout(f.kind === 'day' ? 120000 : 3600000) });
        if (res.status === 429 || res.status === 503) {
          paused = true;
          result.pausedUntil = new Date(now() + GDELT_DAILY_PAUSE_MS).toISOString();
          break;
        }
        if (res.status === 404) {
          missing.add(f.name);
          result.missing++;
        } else if (!res.ok) {
          result.failed++;
        } else {
          const keep = new Set(f.months.filter((m) => m >= opts.fromMonth));
          const reader = v1Reader(f.kind === 'day' ? { fileMonth: f.months[0] } : { keepMonths: keep });
          result.bytes += await streamZipLines(res, reader.line);
          const totals: V1FileTotals = reader.result();
          for (const m of keep) {
            const month = loadMonth(dir, m);
            if (addToMonth(month, f.name, totals.months[m])) saveMonth(dir, month);
          }
          result.read++;
        }
      } catch (err: any) {
        result.failed++;
        if (result.failed <= 3) console.warn(`[GDELT 1.0] ${f.name}: ${err?.message || err}`);
      }
      done++;
      opts.onProgress?.({ done, total: jobs.length, file: f.name, bytes: result.bytes });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency || 2) }, worker));
  result.stopped = !paused && !!opts.shouldStop?.() && done < jobs.length;
  result.left = jobs.length - result.read - result.missing;
  const parts = [`read ${result.read} of ${jobs.length} files`];
  if (result.missing) parts.push(`${result.missing} not published by GDELT`);
  if (result.failed) parts.push(`${result.failed} did not download (tried again next time)`);
  if (paused) parts.push('GDELT asked the app to slow down; carrying on in 15 minutes');
  if (result.stopped) parts.push('stopped before the end');
  return finish(jobs.length ? parts.join('; ') : 'Up to date', result.read > 0 || jobs.length === 0);
}

/** All saved months, oldest first. */
export function loadAllMonths(dir: string): V1Month[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((n) => /^(\d{4}-\d{2})\.json$/.exec(n)?.[1])
    .filter((m): m is string => !!m)
    .sort()
    .map((m) => loadMonth(dir, m));
}

let cache: { stamp: string; months: V1Month[] } | null = null;

/** Monthly series for one country from what is on disk, or null when nothing has been pulled. */
export function gdeltDailySeries(dataDir: string, iso3: string): V1Series | null {
  const dir = gdeltDailyDir(dataDir);
  const st = loadDailyState(dir);
  if (!st.pulledAt) return null;
  const stamp = `${dir}|${st.pulledAt}`;
  if (cache?.stamp !== stamp) cache = { stamp, months: loadAllMonths(dir) };
  const s = v1Series(iso3, cache.months, st.pulledAt);
  return s.points.length ? s : null;
}
