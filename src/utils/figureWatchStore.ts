/**
 * File storage for the figure watch (server only): data/local/data-health/
 *   figures.json         the last reading of each watched figure, per country
 *   figure-events.jsonl  the alerts, oldest first (the newest KEEP_EVENTS are kept)
 * See src/utils/figureWatch.ts.
 */
import fs from 'fs';
import path from 'path';
import { writeFileAtomic } from './atomicWrite';
import type { FigureEvent, FigureLedger } from './figureWatch';

export const KEEP_EVENTS = 3000;

export interface FigureWatchFiles {
  ledger: string;
  events: string;
}

export function figureWatchFiles(dataDir: string): FigureWatchFiles {
  const dir = path.join(dataDir, 'local', 'data-health');
  return { ledger: path.join(dir, 'figures.json'), events: path.join(dir, 'figure-events.jsonl') };
}

export function readLedger(files: FigureWatchFiles): FigureLedger {
  try {
    const l = JSON.parse(fs.readFileSync(files.ledger, 'utf8'));
    if (l && typeof l.figures === 'object' && l.figures) return l;
  } catch {
    // first run, or an unreadable file: start again from the next rebuild
  }
  return { figures: {} };
}

export function readEvents(files: FigureWatchFiles): FigureEvent[] {
  let text = '';
  try {
    text = fs.readFileSync(files.events, 'utf8');
  } catch {
    return [];
  }
  const out: FigureEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (typeof e?.at === 'string' && typeof e?.kind === 'string') out.push(e);
    } catch {
      // a cut-off line
    }
  }
  return out;
}

/** Saves the ledger and appends the alerts. Never throws. */
export function saveWatch(files: FigureWatchFiles, ledger: FigureLedger, events: FigureEvent[], keep = KEEP_EVENTS): boolean {
  try {
    writeFileAtomic(files.ledger, JSON.stringify(ledger));
    if (events.length) {
      fs.appendFileSync(files.events, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
      const all = readEvents(files);
      if (all.length > keep + 200) writeFileAtomic(files.events, all.slice(-keep).map((e) => JSON.stringify(e)).join('\n') + '\n');
    }
    return true;
  } catch {
    return false;
  }
}
