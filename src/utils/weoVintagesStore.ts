/**
 * Reads the past WEO editions you saved in data/local/weo-vintages/ (src/utils/weoVintages.ts).
 * Node only. Read once per process and kept; call with `fresh` after adding files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildWeoStore, type WeoVintageStore } from './weoVintages';

export const WEO_VINTAGE_DIR_NAME = path.join('local', 'weo-vintages');

export function weoVintageDir(dataDir: string): string {
  return path.join(dataDir, WEO_VINTAGE_DIR_NAME);
}

let cached: { dir: string; store: WeoVintageStore } | null = null;

export function loadWeoVintages(dataDir: string, opts: { fresh?: boolean } = {}): WeoVintageStore {
  const dir = weoVintageDir(dataDir);
  if (!opts.fresh && cached?.dir === dir) return cached.store;
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => !n.startsWith('.'));
  } catch {
    names = [];
  }
  const files = names
    .filter((n) => fs.statSync(path.join(dir, n)).isFile())
    .map((name) => ({ name, bytes: new Uint8Array(fs.readFileSync(path.join(dir, name))) }));
  const store = buildWeoStore(files);
  cached = { dir, store };
  return store;
}
