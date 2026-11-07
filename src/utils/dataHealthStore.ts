/**
 * File storage for data health (server and terminal only): data/local/data-health/
 *   source-checks.jsonl  one connection check run per line, oldest first
 *   state.json           the day the nightly check last ran
 * See src/utils/dataHealth.ts for what is kept (never keys).
 */
import fs from 'fs';
import path from 'path';
import { writeFileAtomic } from './atomicWrite';
import type { SourceCheckRecord } from './dataHealth';

/** Runs kept: about a year of nightly checks plus the ones run by hand. */
export const KEEP_CHECKS = 500;

export interface DataHealthFiles {
  dir: string;
  checks: string;
  state: string;
}

export function dataHealthFiles(dataDir: string): DataHealthFiles {
  const dir = path.join(dataDir, 'local', 'data-health');
  return { dir, checks: path.join(dir, 'source-checks.jsonl'), state: path.join(dir, 'state.json') };
}

export interface DataHealthState {
  /** Local day (YYYY-MM-DD) the nightly check last ran. */
  lastNightlyDay?: string;
  /** Why the last nightly attempt did not run, with when. */
  lastSkipped?: { at: string; reason: string };
}

/** Saved runs, oldest first. A line that cannot be read is skipped. */
export function readChecks(files: DataHealthFiles): SourceCheckRecord[] {
  let text = '';
  try {
    text = fs.readFileSync(files.checks, 'utf8');
  } catch {
    return [];
  }
  const out: SourceCheckRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (typeof r?.checkedAt === 'string' && Array.isArray(r?.rows)) out.push(r);
    } catch {
      // a cut-off line
    }
  }
  return out;
}

/** Adds one run; trims to the newest KEEP_CHECKS. Never throws (a log that cannot be written must not stop a check). */
export function appendCheck(files: DataHealthFiles, rec: SourceCheckRecord, keep = KEEP_CHECKS): boolean {
  try {
    fs.mkdirSync(files.dir, { recursive: true });
    fs.appendFileSync(files.checks, `${JSON.stringify(rec)}\n`);
    const all = readChecks(files);
    if (all.length > keep + 50) writeFileAtomic(files.checks, all.slice(-keep).map((r) => JSON.stringify(r)).join('\n') + '\n');
    return true;
  } catch {
    return false;
  }
}

export function readState(files: DataHealthFiles): DataHealthState {
  try {
    const s = JSON.parse(fs.readFileSync(files.state, 'utf8'));
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}

export function saveState(files: DataHealthFiles, state: DataHealthState): void {
  try {
    writeFileAtomic(files.state, JSON.stringify(state, null, 2));
  } catch {
    // tried again at the next run
  }
}
