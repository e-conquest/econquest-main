/**
 * Browser side of the workspace file (see workspaceStore.ts). Before the app draws:
 *  - what is saved on disk is copied into this browser's storage (disk wins), and
 *  - anything only this browser has (from before this change) is sent to disk once.
 * After that, every save of those keys in this browser is also sent to disk.
 * If the server cannot be reached the app still works from the browser copy.
 */

/** Same list as WORKSPACE_KEYS on the server. */
export const SYNCED_KEYS = [
  'econquest.holdings.v1',
  'sovereign_council_watchlists_v1',
  'econquest_custom_sovereigns_v1',
  'econquest_ai_runtime_config_v1',
  'econquest.shareMode.v1',
] as const;

export const ACCOUNT_KEY = 'econquest.account.v1';

/**
 * Each account has its own workspace on the server, but the browser keeps one copy per address.
 * When a different account signs in on this browser, the previous account's copy is removed first,
 * so it is neither shown to nor sent up as the new account's lists. Returns whether it cleared.
 */
export function forgetOtherAccount(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, accountId: string): boolean {
  const last = storage.getItem(ACCOUNT_KEY);
  if (last === accountId) return false;
  for (const key of SYNCED_KEYS) storage.removeItem(key);
  storage.setItem(ACCOUNT_KEY, accountId);
  return true;
}

const isSynced = (key: string) => (SYNCED_KEYS as readonly string[]).includes(key);

export interface SyncDeps {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  fetchFn: typeof fetch;
}

/** What to do for each key given the disk copy and the browser copy. Exported for tests. */
export function planSync(
  disk: Record<string, string>,
  browser: Record<string, string | null>
): { toBrowser: Record<string, string>; toDisk: Record<string, string> } {
  const toBrowser: Record<string, string> = {};
  const toDisk: Record<string, string> = {};
  for (const key of SYNCED_KEYS) {
    const d = disk[key];
    const b = browser[key];
    if (typeof d === 'string') {
      if (d !== b) toBrowser[key] = d;
    } else if (typeof b === 'string' && b) {
      toDisk[key] = b;
    }
  }
  return { toBrowser, toDisk };
}

function send(fetchFn: typeof fetch, key: string, value: string | null): void {
  void fetchFn(`/api/workspace/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  }).catch(() => {
    // server not reachable: the browser copy stays and is sent next time the app opens
  });
}

/** Load the disk copy into the browser (waiting at most `timeoutMs`), then keep saving to disk. */
export async function startWorkspaceSync(deps: SyncDeps, timeoutMs = 2500): Promise<void> {
  const { storage, fetchFn } = deps;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetchFn('/api/workspace', { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const body = (await res.json()) as { values?: Record<string, string> };
      const browser: Record<string, string | null> = {};
      for (const key of SYNCED_KEYS) browser[key] = storage.getItem(key);
      const plan = planSync(body.values || {}, browser);
      for (const [key, value] of Object.entries(plan.toBrowser)) storage.setItem(key, value);
      for (const [key, value] of Object.entries(plan.toDisk)) send(fetchFn, key, value);
    }
  } catch {
    // server slow or not reachable: start from the browser copy
  }
}

/** Send every later browser save of a synced key to disk too (one request per key, debounced). */
export function mirrorSavesToDisk(storageProto: Storage, target: Storage, fetchFn: typeof fetch, waitMs = 400): void {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const queue = (key: string) => {
    const t = pending.get(key);
    if (t) clearTimeout(t);
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        send(fetchFn, key, target.getItem(key));
      }, waitMs)
    );
  };
  const setItem = storageProto.setItem;
  const removeItem = storageProto.removeItem;
  storageProto.setItem = function (this: Storage, key: string, value: string) {
    setItem.call(this, key, value);
    if (this === target && isSynced(key)) queue(key);
  };
  storageProto.removeItem = function (this: Storage, key: string) {
    removeItem.call(this, key);
    if (this === target && isSynced(key)) queue(key);
  };
}
