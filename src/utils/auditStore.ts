/**
 * File storage for the audit log (server only): data/local/audit/audit-log.jsonl, one entry per
 * line, only ever appended to (mode 600). A small head file beside it records the last entry
 * written, so lines removed from the end of the log are noticed too. See src/utils/auditLog.ts.
 */
import fs from 'fs';
import path from 'path';
import { checkLog, nextEntry, type AuditActor, type AuditCheck, type AuditEntry, type AuditInput } from './auditLog';
import { writeFileAtomic } from './atomicWrite';

export interface AuditFiles {
  log: string;
  head: string;
}

export function auditFiles(dataDir: string): AuditFiles {
  const dir = path.join(dataDir, 'local', 'audit');
  return { log: path.join(dir, 'audit-log.jsonl'), head: path.join(dir, 'audit-head.json') };
}

function readHead(files: AuditFiles): { seq: number; hash: string } | null {
  try {
    const h = JSON.parse(fs.readFileSync(files.head, 'utf8'));
    return Number.isInteger(h?.seq) && typeof h?.hash === 'string' ? { seq: h.seq, hash: h.hash } : null;
  } catch {
    return null;
  }
}

function readLines(files: AuditFiles): string[] {
  try {
    return fs.readFileSync(files.log, 'utf8').split('\n');
  } catch {
    return [];
  }
}

/** Last entry of the log as it stands on disk (read once, then kept in memory per file). */
const lastByFile = new Map<string, Pick<AuditEntry, 'seq' | 'hash'> | null>();

function lastEntry(files: AuditFiles): Pick<AuditEntry, 'seq' | 'hash'> | null {
  if (lastByFile.has(files.log)) return lastByFile.get(files.log)!;
  const lines = readLines(files).filter((l) => l.trim());
  let last: Pick<AuditEntry, 'seq' | 'hash'> | null = null;
  for (let i = lines.length - 1; i >= 0 && !last; i--) {
    try {
      const e = JSON.parse(lines[i]);
      if (Number.isInteger(e?.seq) && typeof e?.hash === 'string') last = { seq: e.seq, hash: e.hash };
    } catch {
      // a cut-off last line: the check reports it; carry on from the last whole entry
    }
  }
  lastByFile.set(files.log, last);
  return last;
}

/**
 * Who is acting right now, for entries that do not say: the server sets this to read the signed-in
 * account of the request being handled (AsyncLocalStorage), so every route's entry carries it.
 */
let currentActor: () => AuditActor | undefined = () => undefined;
export function setAuditActor(fn: () => AuditActor | undefined): void {
  currentActor = fn;
}

/** Append one entry. Never throws: a log that cannot be written must not stop the app answering. */
export function appendAudit(files: AuditFiles, input: AuditInput, at: Date = new Date()): AuditEntry | null {
  try {
    const by = input.by ?? currentActor();
    const entry = nextEntry(lastEntry(files), by ? { ...input, by } : input, at);
    fs.mkdirSync(path.dirname(files.log), { recursive: true });
    fs.appendFileSync(files.log, JSON.stringify(entry) + '\n', { mode: 0o600 });
    lastByFile.set(files.log, { seq: entry.seq, hash: entry.hash });
    writeFileAtomic(files.head, JSON.stringify({ seq: entry.seq, hash: entry.hash, at: entry.at }), 0o600);
    return entry;
  } catch (error) {
    console.error('[audit] could not write the audit log:', (error as Error)?.message);
    return null;
  }
}

export function readAudit(files: AuditFiles): { check: AuditCheck; entries: AuditEntry[] } {
  return checkLog(readLines(files), readHead(files));
}

/** The raw file, for the JSON Lines download. */
export function rawAudit(files: AuditFiles): string {
  return readLines(files).join('\n');
}

/** Tests only: forget the cached last entry. */
export function resetAuditCache(): void {
  lastByFile.clear();
}
