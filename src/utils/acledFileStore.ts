/**
 * Reads the ACLED aggregated files you downloaded (utils/acledFiles.ts) from data/local/acled/.
 * Files may be .xlsx or .csv, or a .zip holding them. Nothing is fetched. The result is cached
 * until a file in the folder changes.
 */
import fs from 'fs';
import path from 'path';
import { unzipSync } from 'fflate';
import { addAcledTable, csvRows, emptyAcledFileData, xlsxRows, type AcledFileData } from './acledFiles';

export function acledDir(dataDir: string): string {
  return path.join(dataDir, 'local', 'acled');
}

const FILE_RE = /\.(csv|xlsx|zip)$/i;

/** Reads every .csv, .xlsx and .zip in the folder. Null when the folder has none. */
export function loadAcledFolder(dir: string): AcledFileData | null {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((x) => FILE_RE.test(x) && !x.startsWith('~$')).sort();
  } catch {
    return null;
  }
  if (!names.length) return null;
  const data = emptyAcledFileData();
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      const modified = fs.statSync(full).mtime.toISOString();
      const buf = new Uint8Array(fs.readFileSync(full));
      if (/\.csv$/i.test(name)) addAcledTable(data, name, csvRows(buf), modified);
      else if (/\.xlsx$/i.test(name)) {
        const rows = xlsxRows(buf);
        if (rows) addAcledTable(data, name, rows, modified);
        else data.skipped.push({ file: name, reason: 'no worksheet found in the .xlsx' });
      } else {
        const inner = unzipSync(buf, { filter: (f) => /\.(csv|xlsx)$/i.test(f.name) && !f.name.startsWith('__MACOSX') });
        const list = Object.keys(inner);
        if (!list.length) data.skipped.push({ file: name, reason: 'zip has no .csv or .xlsx inside' });
        for (const f of list) {
          const label = `${name} > ${f}`;
          if (/\.csv$/i.test(f)) addAcledTable(data, label, csvRows(inner[f]), modified);
          else {
            const rows = xlsxRows(inner[f]);
            if (rows) addAcledTable(data, label, rows, modified);
            else data.skipped.push({ file: label, reason: 'no worksheet found in the .xlsx' });
          }
        }
      }
    } catch (err: any) {
      data.skipped.push({ file: name, reason: `could not be read (${err?.message || err})` });
    }
  }
  return data;
}

function folderStamp(dir: string): string {
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => FILE_RE.test(n))
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

const cache = new Map<string, { stamp: string; data: AcledFileData | null }>();

/** The files in data/local/acled/, read again only when a file changes. */
export function acledFileData(dataDir: string): AcledFileData | null {
  const dir = acledDir(dataDir);
  const stamp = folderStamp(dir);
  const hit = cache.get(dir);
  if (hit && hit.stamp === stamp) return hit.data;
  const data = loadAcledFolder(dir);
  cache.set(dir, { stamp, data });
  return data;
}
