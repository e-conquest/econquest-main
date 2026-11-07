/**
 * Reads the UCDP CSV downloads (utils/ucdpConflict.ts) from two folders:
 * - datasets/ucdp/ in the repository: the 26.1 release, shipped with the app (CC BY 4.0);
 * - data/local/ucdp/: files you add, e.g. a newer release. A newer release of a dataset wins.
 * Files may be the .zip as downloaded from ucdp.uu.se or the .csv inside it. Nothing is fetched.
 * The result is cached until a file in either folder changes.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { unzipSync, strFromU8 } from 'fflate';
import { addUcdpCsv, emptyUcdpData, type UcdpData } from './ucdpConflict.ts';

export function ucdpDir(dataDir: string): string {
  return path.join(dataDir, 'local', 'ucdp');
}

/** The release shipped in the repository. */
export const UCDP_BUNDLED_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'datasets', 'ucdp');

/** Reads every .csv and .zip in the folders, in order. Null when no folder has a file. */
export function loadUcdpFolder(...dirs: string[]): UcdpData | null {
  const list: Array<{ name: string; full: string }> = [];
  for (const dir of dirs) {
    try {
      for (const n of fs.readdirSync(dir).filter((x) => /\.(csv|zip)$/i.test(x)).sort()) list.push({ name: n, full: path.join(dir, n) });
    } catch {
      // folder not there
    }
  }
  if (!list.length) return null;
  const data = emptyUcdpData();
  for (const { name, full } of list) {
    try {
      if (/\.zip$/i.test(name)) {
        const entries = unzipSync(new Uint8Array(fs.readFileSync(full)), { filter: (f) => /\.csv$/i.test(f.name) && !f.name.startsWith('__MACOSX') });
        const csvs = Object.keys(entries);
        if (!csvs.length) data.skipped.push({ file: name, reason: 'zip has no .csv inside' });
        for (const inner of csvs) addUcdpCsv(data, `${name} > ${inner}`, strFromU8(entries[inner]));
      } else addUcdpCsv(data, name, fs.readFileSync(full, 'utf8'));
    } catch (err: any) {
      data.skipped.push({ file: name, reason: `could not be read (${err?.message || err})` });
    }
  }
  return Object.keys(data.files).length || data.skipped.length || data.candidate ? data : null;
}

/** Stamp of the folders: file names, sizes and times. */
function folderStamp(dirs: string[]): string {
  return dirs.map(oneStamp).join('||');
}
function oneStamp(dir: string): string {
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => /\.(csv|zip)$/i.test(n))
      .sort()
      .map((n) => {
        const s = fs.statSync(path.join(dir, n));
        return `${n}:${s.size}:${s.mtimeMs}`;
      })
      .join('|');
  } catch {
    return '';
  }
}

const cache = new Map<string, { stamp: string; data: UcdpData | null }>();

/**
 * The shipped release plus your own files, read again only when a file changes. `bundledDir` is
 * for tests (null = your folder only).
 */
export function ucdpData(dataDir: string, bundledDir: string | null = UCDP_BUNDLED_DIR): UcdpData | null {
  const dirs = [bundledDir, ucdpDir(dataDir)].filter((d): d is string => !!d);
  const key = dirs.join('|');
  const stamp = folderStamp(dirs);
  const hit = cache.get(key);
  if (hit && hit.stamp === stamp) return hit.data;
  const data = loadUcdpFolder(...dirs);
  cache.set(key, { stamp, data });
  return data;
}
