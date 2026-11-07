/**
 * Your holdings, watchlists, added countries and AI model settings, kept on disk in
 * data/local/workspace.json (mode 600) instead of only in the browser.
 *
 * Why: the browser keeps its storage per address, so the app under Docker (localhost:3737) and
 * under `npm run dev` (localhost:3000) saw different holdings, and clearing browser data lost them.
 * The browser still keeps a copy for speed; this file is the one both addresses share.
 */
import fs from 'fs';
import path from 'path';
import { writeFileAtomic } from './atomicWrite';

/** The browser storage keys kept on disk, with what each holds. */
export const WORKSPACE_KEYS: Record<string, string> = {
  'econquest.holdings.v1': 'holdings',
  sovereign_council_watchlists_v1: 'watchlists',
  econquest_custom_sovereigns_v1: 'countries you added',
  econquest_ai_runtime_config_v1: 'AI model settings',
  'econquest.shareMode.v1': 'sharing mode',
};

/** Largest value kept for one key (a long holdings list is well under this). */
export const MAX_WORKSPACE_VALUE = 2_000_000;

export interface WorkspaceFile {
  version: 1;
  values: Record<string, string>;
  updatedAt: Record<string, string>;
}

export function workspaceFilePath(dataDir: string): string {
  return path.join(dataDir, 'local', 'workspace.json');
}

/**
 * Once accounts exist (src/utils/auth.ts) each account keeps its own workspace here. The shared
 * file above stays as the one used while sign-in is off; the first admin account starts from a
 * copy of it, since it holds what the single user had saved.
 */
export function userWorkspacePath(dataDir: string, accountId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(accountId)) throw new Error('Bad account id.');
  return path.join(dataDir, 'local', 'users', accountId, 'workspace.json');
}

/** Copies the shared workspace to a new account's file if that file does not exist yet. */
export function seedWorkspace(shared: string, target: string): boolean {
  if (fs.existsSync(target) || !fs.existsSync(shared)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(shared, target);
  fs.chmodSync(target, 0o600);
  return true;
}

function empty(): WorkspaceFile {
  return { version: 1, values: {}, updatedAt: {} };
}

export function loadWorkspace(file: string): WorkspaceFile {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const out = empty();
    for (const key of Object.keys(WORKSPACE_KEYS)) {
      if (typeof raw?.values?.[key] === 'string') {
        out.values[key] = raw.values[key];
        if (typeof raw?.updatedAt?.[key] === 'string') out.updatedAt[key] = raw.updatedAt[key];
      }
    }
    return out;
  } catch {
    return empty();
  }
}

/** Problem with a key or value, or null when it can be saved. `null` value removes the key. */
export function workspaceProblem(key: string, value: unknown): string | null {
  if (!Object.prototype.hasOwnProperty.call(WORKSPACE_KEYS, key)) return `Unknown item "${String(key).slice(0, 60)}".`;
  if (value === null) return null;
  if (typeof value !== 'string') return 'The value must be text.';
  if (value.length > MAX_WORKSPACE_VALUE) return 'That is too large to keep.';
  try {
    JSON.parse(value);
  } catch {
    return 'The value is not valid JSON.';
  }
  return null;
}

export function setWorkspaceValue(file: string, key: string, value: string | null, now = new Date()): WorkspaceFile {
  const next = loadWorkspace(file);
  if (value === null) {
    delete next.values[key];
    delete next.updatedAt[key];
  } else {
    next.values[key] = value;
    next.updatedAt[key] = now.toISOString();
  }
  writeFileAtomic(file, JSON.stringify(next), 0o600);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // not supported on this file system (Windows)
  }
  return next;
}

/** Replace every workspace item at once (used by restore). Items that fail workspaceProblem are skipped. */
export function saveWorkspaceValues(file: string, values: Record<string, string>, now = new Date()): WorkspaceFile {
  const next = empty();
  for (const [key, value] of Object.entries(values)) {
    if (workspaceProblem(key, value)) continue;
    next.values[key] = value;
    next.updatedAt[key] = now.toISOString();
  }
  writeFileAtomic(file, JSON.stringify(next), 0o600);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // not supported on this file system (Windows)
  }
  return next;
}
