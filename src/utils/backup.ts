/**
 * Backup and restore of what you made in the app (Menu > Settings > Backup).
 *
 * One JSON file holds:
 *  - saved research (council briefs, policy documents, agent documents, notebooks, teaching
 *    episodes): data/local/research.json
 *  - watch alerts: data/local/watch-rules.json
 *  - holdings, watchlists, countries you added and AI model settings: data/local/workspace.json
 *  - policy reviews: data/local/reviews.json (a backup made before reviews existed leaves the
 *    reviews on this computer as they are when restored)
 *
 * It never holds your API keys (data/local/settings.json is left out) and any key, secret or
 * token inside the AI settings is removed before the file is written. On restore those fields are
 * kept from what is on this computer now, so restoring never wipes a working set-up.
 *
 * Shared by the server (writing and restoring) and the page (reading a chosen file to show what
 * it holds before you restore it), so it has no Node imports.
 */
import { parseLibrary, type ResearchLibrary } from './researchLibrary';
import { parseRules, type WatchRule } from './watchRules';
import type { PolicyReview } from './policyReview';
import { isSnapshotId, type AnswerSnapshot } from './answerSnapshot';
import { EXPORT_NOTICE } from './disclaimer';

export const BACKUP_FORMAT = 'econquest-backup';
export const BACKUP_VERSION = 1;

/** Same keys and labels as WORKSPACE_KEYS on the server (workspaceStore.ts). */
export const BACKUP_WORKSPACE_KEYS: Record<string, string> = {
  'econquest.holdings.v1': 'holdings',
  sovereign_council_watchlists_v1: 'watchlists',
  econquest_custom_sovereigns_v1: 'countries you added',
  econquest_ai_runtime_config_v1: 'AI model settings',
};

export interface BackupContents {
  research: ResearchLibrary;
  watchRules: WatchRule[];
  workspace: Record<string, string>;
  /** Left out by backups made before policy reviews existed. */
  reviews?: PolicyReview[];
  /** Council answer snapshots (data/local/snapshots/), newest first; left out by older backups. */
  snapshots?: AnswerSnapshot[];
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  /** The standing research notice, for anyone who opens the file outside the app. Not read back. */
  notice?: string;
  contents: BackupContents;
}

export interface BackupSummary {
  createdAt: string;
  briefs: number;
  docs: number;
  councilDocs: number;
  notebooks: number;
  episodes: number;
  watchRules: number;
  reviews: number;
  snapshots: number;
  /** Labels of the workspace items present, e.g. "holdings". */
  workspace: string[];
}

/** Field names that hold a key, secret or password. Matched on the name, any depth. */
const SECRET_NAME = /(api[-_]?key|secret|token|password|passwd|authorization|bearer|hmac|credential)/i;

export function isSecretField(name: string): boolean {
  return SECRET_NAME.test(name);
}

/** A copy with every key, secret or token field removed, at any depth. */
export function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretField(k)) continue;
      out[k] = stripSecrets(v);
    }
    return out;
  }
  return value;
}

/**
 * Put back the secret fields `current` has and `restored` lacks (restored came from a backup,
 * which never carries them). Objects in lists are matched by `id` when they have one, otherwise by
 * position.
 */
export function keepSecrets(restored: unknown, current: unknown): unknown {
  if (Array.isArray(restored)) {
    const cur = Array.isArray(current) ? current : [];
    return restored.map((item, i) => {
      const id = item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined;
      const match = id !== undefined ? cur.find((c) => c && typeof c === 'object' && (c as { id?: unknown }).id === id) : cur[i];
      return keepSecrets(item, match);
    });
  }
  if (restored && typeof restored === 'object') {
    const out: Record<string, unknown> = {};
    const cur = current && typeof current === 'object' && !Array.isArray(current) ? (current as Record<string, unknown>) : {};
    for (const [k, v] of Object.entries(restored as Record<string, unknown>)) out[k] = keepSecrets(v, cur[k]);
    for (const [k, v] of Object.entries(cur)) {
      if (k in out) continue;
      if (isSecretField(k)) out[k] = v;
      else if (v && typeof v === 'object' && !Array.isArray(v)) {
        // a section the backup lacks: bring back only the secrets inside it
        const inner = keepSecrets({}, v) as Record<string, unknown>;
        if (Object.keys(inner).length) out[k] = inner;
      }
    }
    return out;
  }
  return restored;
}

/** Policy reviews that have the fields the app needs; anything else is dropped. */
export function cleanReviews(v: unknown): PolicyReview[] {
  return (Array.isArray(v) ? v : []).filter((r): r is PolicyReview => Boolean(r && typeof r.id === 'string' && r.id && typeof r.title === 'string' && r.steps && typeof r.steps === 'object' && Array.isArray(r.runs))).slice(0, 100);
}

/** The newest answer snapshots a backup keeps. */
export const MAX_BACKUP_SNAPSHOTS = 300;

/** Answer snapshots with the fields the app needs and a well-formed id; anything else is dropped. */
export function cleanSnapshots(v: unknown): AnswerSnapshot[] {
  return (Array.isArray(v) ? v : [])
    .filter((s): s is AnswerSnapshot => Boolean(s && isSnapshotId(String(s.id).replace(/x+$/, '')) && s.inputs && Array.isArray(s.inputs.answers) && s.settings && s.output && typeof s.inputsHash === 'string' && typeof s.outputHash === 'string'))
    .slice(0, MAX_BACKUP_SNAPSHOTS);
}

function cleanWorkspace(values: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!values || typeof values !== 'object') return out;
  for (const key of Object.keys(BACKUP_WORKSPACE_KEYS)) {
    const v = (values as Record<string, unknown>)[key];
    if (typeof v !== 'string') continue;
    try {
      out[key] = JSON.stringify(stripSecrets(JSON.parse(v)));
    } catch {
      // not valid JSON: leave it out rather than restore something the app cannot read
    }
  }
  return out;
}

export function buildBackup(parts: { research: ResearchLibrary; watchRules: WatchRule[]; workspace: Record<string, string>; reviews?: PolicyReview[]; snapshots?: AnswerSnapshot[] }, now = new Date()): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now.toISOString(),
    notice: EXPORT_NOTICE,
    contents: {
      research: parseLibrary(parts.research),
      watchRules: parseRules({ rules: parts.watchRules }),
      workspace: cleanWorkspace(parts.workspace),
      reviews: cleanReviews(parts.reviews),
      snapshots: cleanSnapshots(parts.snapshots),
    },
  };
}

export function summariseBackup(b: BackupFile): BackupSummary {
  const r = b.contents.research;
  return {
    createdAt: b.createdAt,
    briefs: r.briefs.length,
    docs: r.docs.length,
    councilDocs: r.councilDocs.length,
    notebooks: r.notebooks.length,
    episodes: r.episodes.length,
    watchRules: b.contents.watchRules.length,
    reviews: b.contents.reviews?.length ?? 0,
    snapshots: b.contents.snapshots?.length ?? 0,
    workspace: Object.keys(BACKUP_WORKSPACE_KEYS)
      .filter((k) => k in b.contents.workspace)
      .map((k) => BACKUP_WORKSPACE_KEYS[k]),
  };
}

/** Read a backup file's text or parsed JSON. Anything unreadable inside it is dropped. */
export function parseBackup(raw: unknown): { ok: true; backup: BackupFile; summary: BackupSummary } | { ok: false; error: string } {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return { ok: false, error: 'That file is not a backup from this app (it is not JSON).' };
    }
  }
  const o = v as Partial<BackupFile> | null;
  if (!o || typeof o !== 'object' || o.format !== BACKUP_FORMAT) return { ok: false, error: 'That file is not a backup from this app.' };
  if (typeof o.version !== 'number' || o.version > BACKUP_VERSION) {
    return { ok: false, error: 'That backup was made by a newer version of the app. Update the app, then restore it.' };
  }
  const c = (o.contents || {}) as Partial<BackupContents>;
  const backup: BackupFile = {
    format: BACKUP_FORMAT,
    version: o.version,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt.slice(0, 40) : '',
    ...(typeof o.notice === 'string' ? { notice: EXPORT_NOTICE } : {}),
    contents: {
      research: parseLibrary(c.research),
      watchRules: parseRules({ rules: c.watchRules }),
      workspace: cleanWorkspace(c.workspace),
      ...(Array.isArray(c.reviews) ? { reviews: cleanReviews(c.reviews) } : {}),
      ...(Array.isArray(c.snapshots) ? { snapshots: cleanSnapshots(c.snapshots) } : {}),
    },
  };
  return { ok: true, backup, summary: summariseBackup(backup) };
}

/** e.g. econquest-backup-2026-11-05.json */
export function backupFileName(now = new Date()): string {
  return `econquest-backup-${now.toISOString().slice(0, 10)}.json`;
}

/** One line for the page, e.g. "12 briefs, 3 documents, 2 notebooks, 4 watch alerts, holdings and watchlists". */
export function describeBackup(s: BackupSummary): string {
  const n = (count: number, one: string, many: string) => (count ? [`${count} ${count === 1 ? one : many}`] : []);
  const parts = [
    ...n(s.briefs, 'brief', 'briefs'),
    ...n(s.docs, 'policy document', 'policy documents'),
    ...n(s.councilDocs, 'agent document', 'agent documents'),
    ...n(s.notebooks, 'notebook', 'notebooks'),
    ...n(s.episodes, 'teaching episode', 'teaching episodes'),
    ...n(s.watchRules, 'watch alert', 'watch alerts'),
    ...n(s.reviews ?? 0, 'policy review', 'policy reviews'),
    ...n(s.snapshots ?? 0, 'answer snapshot', 'answer snapshots'),
  ];
  if (s.workspace.length) parts.push(s.workspace.length === 1 ? s.workspace[0] : `${s.workspace.slice(0, -1).join(', ')} and ${s.workspace[s.workspace.length - 1]}`);
  return parts.length ? parts.join(', ') : 'nothing saved yet';
}
