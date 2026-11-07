/**
 * A fingerprint of the app's code: SHA-256 over server.ts and every file under src/, by path and
 * content. The running app reports it at /healthz, and `npm run council:regress` works out the same
 * for the folder it runs in, so a Docker container built before the last `git pull` (or an
 * `npm run dev` that was not restarted) is named instead of showing up as model drift.
 *
 * Server only (node:fs, node:crypto).
 */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

function walk(dir: string, root: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, root, out);
    else if (e.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
  }
}

/** Short fingerprint (16 hex) of server.ts plus src/ under `root`; null when server.ts is not there. */
export function codeHash(root: string): string | null {
  if (!fs.existsSync(path.join(root, 'server.ts'))) return null;
  const files = ['server.ts'];
  walk(path.join(root, 'src'), root, files);
  const h = createHash('sha256');
  for (const f of files.sort()) {
    h.update(f).update('\0');
    try {
      h.update(fs.readFileSync(path.join(root, f)));
    } catch {
      // unreadable: the path alone still counts
    }
    h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}
