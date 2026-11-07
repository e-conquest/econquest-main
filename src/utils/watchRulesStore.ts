/** File storage for watch alerts (server only): data/local/watch-rules.json, mode 600. */
import fs from 'fs';
import path from 'path';
import { parseRules, type WatchRule } from './watchRules';

export function watchRulesFilePath(dataDir: string): string {
  return path.join(dataDir, 'local', 'watch-rules.json');
}

export function loadWatchRules(file: string): WatchRule[] {
  try {
    return parseRules(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return [];
  }
}

export function saveWatchRules(file: string, rules: WatchRule[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ rules }), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // not supported on this file system (Windows)
  }
}
