/**
 * The pull archive: every country snapshot the app saves is also kept, by date, in
 * data/archive/<ISO3>/<YYYY-MM-DD>.json.gz. data/live/ holds only the newest pull; the archive is
 * what lets later screens answer "what did the data show on that date?" (the "as of" picker,
 * decision replication, a fair track record).
 *
 * One file per country per day: a retry later the same day replaces that day's file, so a day
 * keeps its last pull. Files are gzipped (a snapshot is mostly repeated keys). Nothing is ever
 * pruned unless ARCHIVE_KEEP_DAYS is set to a positive number of days.
 *
 * Server-only (uses fs and zlib).
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

export type ArchivedPull<T = unknown> = {
  /** The day this file stands for (UTC), YYYY-MM-DD. */
  date: string;
  /** When the pull finished, ms since 1970. */
  pulledAt: number;
  /** True when a feed failed and some figures were carried from an earlier pull. */
  incomplete?: boolean;
  schema?: number;
  snapshot: T;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FILE_RE = /^(\d{4}-\d{2}-\d{2})\.json\.gz$/;

export function archiveRoot(dataDir: string): string {
  return path.join(dataDir, 'archive');
}

function cleanIso3(iso3: string): string {
  return String(iso3 || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** UTC calendar day of a time. */
export function archiveDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function archiveFile(root: string, iso3: string, date: string): string {
  return path.join(root, cleanIso3(iso3), `${date}.json.gz`);
}

/** Saves one pull. Returns the file written, or null when the inputs are not usable. */
export function writeArchivedPull(
  root: string,
  iso3: string,
  entry: { snapshot: unknown; pulledAt: number; incomplete?: boolean; schema?: number }
): string | null {
  const code = cleanIso3(iso3);
  if (!code || !Number.isFinite(entry.pulledAt) || entry.snapshot == null) return null;
  const date = archiveDay(entry.pulledAt);
  const record: ArchivedPull = { date, ...entry };
  const file = archiveFile(root, code, date);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify(record)));
  fs.renameSync(tmp, file);
  return file;
}

/** Days archived for a country, oldest first. */
export function listArchivedDays(root: string, iso3: string): string[] {
  const dir = path.join(root, cleanIso3(iso3));
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((n) => FILE_RE.exec(n)?.[1])
    .filter((d): d is string => Boolean(d))
    .sort();
}

/** Countries with at least one archived day. */
export function listArchivedCountries(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^[A-Z0-9]+$/.test(d.name) && listArchivedDays(root, d.name).length > 0)
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

export function readArchivedPull<T = unknown>(root: string, iso3: string, date: string): ArchivedPull<T> | null {
  if (!DATE_RE.test(date)) return null;
  try {
    const raw = zlib.gunzipSync(fs.readFileSync(archiveFile(root, iso3, date))).toString('utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.pulledAt === 'number' && parsed.snapshot != null) return parsed as ArchivedPull<T>;
  } catch {
    // Missing or unreadable file
  }
  return null;
}

/**
 * The archived pull that stood on a date: the latest day on or before it. Null when the archive
 * starts after that date (the app never guesses what it did not see).
 */
export function archivedDayOnOrBefore(days: string[], date: string): string | null {
  if (!DATE_RE.test(date)) return null;
  let hit: string | null = null;
  for (const d of days) {
    if (d <= date) hit = d;
    else break;
  }
  return hit;
}

/** Days to keep from ARCHIVE_KEEP_DAYS; 0 (the default) keeps everything. */
export function keepDaysFromEnv(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Deletes a country's files older than keepDays (0 keeps all). Returns the days removed. */
export function pruneArchive(root: string, iso3: string, keepDays: number, now = Date.now()): string[] {
  if (!(keepDays > 0)) return [];
  const cutoff = archiveDay(now - keepDays * 24 * 60 * 60 * 1000);
  const removed: string[] = [];
  for (const d of listArchivedDays(root, iso3)) {
    if (d < cutoff) {
      try {
        fs.unlinkSync(archiveFile(root, iso3, d));
        removed.push(d);
      } catch {
        // Leave it; tried again on the next pull
      }
    }
  }
  return removed;
}
