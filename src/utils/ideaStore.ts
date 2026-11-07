/**
 * Append-only store for the trade idea journal (src/utils/ideaJournal.ts): one JSON record per line
 * in data/local/ideas.jsonl. Records are never edited or removed by the app; each carries the
 * SHA-256 of its canonical JSON so a changed line shows up as "hash does not match".
 * Server and scripts only.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { canonicalIdea, type Idea } from './ideaJournal';

export function ideaFilePath(dataDir: string): string {
  return path.join(dataDir, 'local', 'ideas.jsonl');
}

export function ideaHash(i: Omit<Idea, 'hash'> | Idea): string {
  return crypto.createHash('sha256').update(canonicalIdea(i)).digest('hex');
}

export interface LoadedIdea {
  idea: Idea;
  /** False when the line was changed after it was logged. */
  hashOk: boolean;
}

export function loadIdeas(file: string): { ideas: LoadedIdea[]; badLines: number } {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { ideas: [], badLines: 0 };
  }
  const ideas: LoadedIdea[] = [];
  let badLines = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const idea = JSON.parse(line) as Idea;
      if (!idea?.id || !idea.hash) throw new Error('not an idea');
      ideas.push({ idea, hashOk: ideaHash(idea) === idea.hash });
    } catch {
      badLines++;
    }
  }
  return { ideas, badLines };
}

/** Hashes the record and appends it. Returns the stored record. */
export function appendIdea(file: string, rec: Omit<Idea, 'hash'>): Idea {
  const idea: Idea = { ...rec, hash: ideaHash(rec) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(idea)}\n`, { mode: 0o600 });
  return idea;
}
