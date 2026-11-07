/**
 * Reads the sanctions list files you download (utils/sanctionsLists.ts) from data/local/sanctions/.
 * File names as the lists publish them (case does not matter): SDN.CSV + ADD.CSV, CONS_PRIM.CSV +
 * CONS_ADD.CSV, consolidated.xml. `npm run sanctions:pull` saves them there. Read again only when a
 * file changes. Server-only.
 */
import fs from 'fs';
import path from 'path';
import { addOfacCsv, addUnXml, emptySanctionsData, type SanctionsData } from './sanctionsLists.ts';

export function sanctionsDir(dataDir: string): string {
  return path.join(dataDir, 'local', 'sanctions');
}

function files(dir: string): Map<string, string> {
  const m = new Map<string, string>();
  try {
    for (const n of fs.readdirSync(dir)) m.set(n.toLowerCase(), path.join(dir, n));
  } catch {
    // folder not there
  }
  return m;
}

const day = (full: string) => new Date(fs.statSync(full).mtimeMs).toISOString().slice(0, 10);

export function loadSanctionsFolder(dir: string): SanctionsData | null {
  const f = files(dir);
  const data = emptySanctionsData();
  const read = (n: string) => (f.has(n) ? fs.readFileSync(f.get(n)!, 'utf8') : '');
  const ofac = (list: 'ofac_sdn' | 'ofac_cons', prim: string, add: string) => {
    if (!f.has(prim)) return;
    try {
      addOfacCsv(data, list, path.basename(f.get(prim)!), read(prim), read(add), day(f.get(prim)!));
      if (!f.has(add)) data.skipped.push({ file: add.toUpperCase(), reason: 'address file not found, so no entry has a country' });
    } catch (err: any) {
      data.skipped.push({ file: prim, reason: `could not be read (${err?.message || err})` });
    }
  };
  ofac('ofac_sdn', 'sdn.csv', 'add.csv');
  ofac('ofac_cons', 'cons_prim.csv', 'cons_add.csv');
  if (f.has('consolidated.xml')) {
    try {
      addUnXml(data, path.basename(f.get('consolidated.xml')!), read('consolidated.xml'));
    } catch (err: any) {
      data.skipped.push({ file: 'consolidated.xml', reason: `could not be read (${err?.message || err})` });
    }
  }
  return data.files.length || data.skipped.length ? data : null;
}

function stamp(dir: string): string {
  try {
    return fs
      .readdirSync(dir)
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

let cache: { dir: string; stamp: string; data: SanctionsData | null } | null = null;

export function sanctionsData(dataDir: string): SanctionsData | null {
  const dir = sanctionsDir(dataDir);
  const s = stamp(dir);
  if (cache && cache.dir === dir && cache.stamp === s) return cache.data;
  const data = loadSanctionsFolder(dir);
  cache = { dir, stamp: s, data };
  return data;
}
