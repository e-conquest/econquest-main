/**
 * Reads the Caldara-Iacoviello monthly GPR file (utils/gprIndex.ts) from data/local/gpr/: the
 * newest .xlsx or .csv there. Read again only when the file changes. Server-only.
 */
import fs from 'fs';
import path from 'path';
import { parseCsvRows } from './sanctionsLists.ts';
import { xlsxRows } from './acledFiles.ts';
import { parseGprRows, type GprTable } from './gprIndex.ts';

export function gprDir(dataDir: string): string {
  return path.join(dataDir, 'local', 'gpr');
}

export type GprLoad = { ok: true; file: string; modified: string; table: GprTable } | { ok: false; reason: string };

let cache: { key: string; load: GprLoad } | null = null;

export function gprData(dataDir: string): GprLoad {
  const dir = gprDir(dataDir);
  let files: Array<{ name: string; full: string; mtime: number; size: number }> = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((n) => /\.(xlsx|csv)$/i.test(n) && !n.startsWith('~$'))
      .map((name) => {
        const full = path.join(dir, name);
        const s = fs.statSync(full);
        return { name, full, mtime: s.mtimeMs, size: s.size };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    // folder not there
  }
  const has = (() => {
    try {
      return fs.readdirSync(dir).some((n) => /\.xls$/i.test(n));
    } catch {
      return false;
    }
  })();
  if (!files.length)
    return { ok: false, reason: has ? `the GPR .xls in ${dir} cannot be read: open it and save it as .xlsx or .csv in the same folder` : `no GPR file in ${dir} (download the monthly file from matteoiacoviello.com/gpr.htm and save it there as .xlsx or .csv)` };
  const f = files[0];
  const key = `${f.full}:${f.mtime}:${f.size}`;
  if (cache?.key === key) return cache.load;
  let load: GprLoad;
  try {
    const rows = /\.csv$/i.test(f.name) ? parseCsvRows(fs.readFileSync(f.full, 'utf8')) : [...(xlsxRows(new Uint8Array(fs.readFileSync(f.full))) || [])];
    const t = parseGprRows(rows);
    load = 'reason' in t ? { ok: false, reason: `${f.name}: ${t.reason}` } : { ok: true, file: f.name, modified: new Date(f.mtime).toISOString().slice(0, 10), table: t };
  } catch (err: any) {
    load = { ok: false, reason: `${f.name} could not be read (${err?.message || err})` };
  }
  cache = { key, load };
  return load;
}
