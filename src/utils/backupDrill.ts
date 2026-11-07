/**
 * Backup and restore drill (npm run backup:drill -- <backup file>).
 *
 * Proves that a Menu > Backup file restores into a fresh install: starts the real server on an
 * empty, throwaway data folder, restores the file through the same route the page uses, downloads
 * a backup from the restored server and checks that it holds exactly what the file held. It also
 * checks that no key, secret or token is in the file or anywhere the restore wrote, and that no
 * settings file (where keys live) was created. Your own data folder is never touched.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { describeBackup, isSecretField, parseBackup, type BackupFile } from './backup';

/** Paths of key, secret or token fields that hold a value, at any depth (JSON strings inside are opened). */
export function secretFieldsIn(value: unknown, at = '$'): string[] {
  if (typeof value === 'string') {
    const t = value.trim();
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try {
        return secretFieldsIn(JSON.parse(t), at);
      } catch {
        return [];
      }
    }
    return [];
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => secretFieldsIn(v, `${at}[${i}]`));
  if (value && typeof value === 'object') {
    const out: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const p = `${at}.${k}`;
      if (isSecretField(k) && v !== '' && v !== null && v !== undefined) out.push(p);
      else out.push(...secretFieldsIn(v, p));
    }
    return out;
  }
  return [];
}

/** JSON with object keys sorted, so two equal values give the same text. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

function byId<T>(list: T[] | undefined): string[] {
  return (list ?? []).map(canonical).sort();
}

/** What differs between what the backup held and what the restored install gives back. Empty = same. */
export function restoredDifferences(expected: BackupFile, actual: BackupFile): string[] {
  const e = expected.contents;
  const a = actual.contents;
  const out: string[] = [];
  for (const part of ['briefs', 'docs', 'councilDocs', 'notebooks', 'episodes'] as const) {
    const x = byId(e.research[part] as unknown[]);
    const y = byId(a.research[part] as unknown[]);
    if (canonical(x) !== canonical(y)) out.push(`saved research (${part}): ${x.length} in the file, ${y.length} restored or different`);
  }
  if (canonical(byId(e.watchRules)) !== canonical(byId(a.watchRules))) out.push(`watch alerts: ${e.watchRules.length} in the file, ${a.watchRules.length} restored or different`);
  for (const key of new Set([...Object.keys(e.workspace), ...Object.keys(a.workspace)])) {
    const x = e.workspace[key];
    const y = a.workspace[key];
    const same = x !== undefined && y !== undefined && canonical(JSON.parse(x)) === canonical(JSON.parse(y));
    if (!same) out.push(`workspace item ${key}: ${x === undefined ? 'not in the file' : y === undefined ? 'not restored' : 'different'}`);
  }
  if (e.reviews && canonical(byId(e.reviews)) !== canonical(byId(a.reviews))) out.push(`policy reviews: ${e.reviews.length} in the file, ${a.reviews?.length ?? 0} restored or different`);
  if (e.snapshots && canonical(byId(e.snapshots)) !== canonical(byId(a.snapshots))) out.push(`answer snapshots: ${e.snapshots.length} in the file, ${a.snapshots?.length ?? 0} restored or different`);
  return out;
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p) : [p];
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

export interface DrillStep {
  ok: boolean;
  text: string;
}

export interface DrillResult {
  ok: boolean;
  steps: DrillStep[];
}

/**
 * Run the drill on a backup file's text. appRoot is the folder holding server.ts. The server is
 * started with `node --import tsx server.ts` on a free port and stopped at the end.
 */
export async function runBackupDrill(backupText: string, appRoot: string, opts: { timeoutMs?: number; keepDir?: boolean } = {}): Promise<DrillResult> {
  const steps: DrillStep[] = [];
  const step = (ok: boolean, text: string) => {
    steps.push({ ok, text });
    return ok;
  };
  const done = () => ({ ok: steps.every((s) => s.ok), steps });

  const parsed = parseBackup(backupText);
  if (!step(parsed.ok, parsed.ok ? 'The file is a backup from this app.' : `The file cannot be restored: ${parsed.error}`) || !parsed.ok) return done();
  let rawSecrets: string[] = [];
  try {
    rawSecrets = secretFieldsIn(JSON.parse(backupText));
  } catch {
    rawSecrets = [];
  }
  step(rawSecrets.length === 0, rawSecrets.length === 0 ? 'No key, secret or token in the file.' : `The file holds key or secret fields: ${rawSecrets.slice(0, 5).join(', ')}`);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'econquest-drill-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: appRoot,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'production',
      DATA_DIR: dataDir,
      PORT: String(port),
      HOST: '127.0.0.1',
      DEFAULT_AI_PROVIDER: 'ollama',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout?.on('data', (d) => (log += d));
  child.stderr?.on('data', (d) => (log += d));
  const stop = () =>
    new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
    });

  try {
    const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
    let ready = false;
    while (!ready && Date.now() < deadline && child.exitCode === null) {
      try {
        ready = (await fetch(`${base}/readyz`)).ok;
      } catch {
        /* not up yet */
      }
      if (!ready) await new Promise((r) => setTimeout(r, 300));
    }
    if (!step(ready, ready ? `A fresh install started on an empty data folder.` : `The fresh install did not start. Its log ends: ${log.slice(-400)}`)) return done();

    const restore = await fetch(`${base}/api/backup/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backup: backupText }) });
    const restoreBody = (await restore.json().catch(() => ({}))) as { error?: string };
    if (!step(restore.ok, restore.ok ? 'Restored through Menu > Backup > Restore (the same route the page uses).' : `Restore refused: ${restoreBody.error || restore.status}`)) return done();

    const down = await fetch(`${base}/api/backup/download`);
    const back = parseBackup(await down.text());
    if (!step(down.ok && back.ok, down.ok && back.ok ? 'Downloaded a new backup from the restored install.' : 'Could not download a backup from the restored install.') || !back.ok) return done();

    const diffs = restoredDifferences(parsed.backup, back.backup);
    step(
      diffs.length === 0,
      diffs.length === 0
        ? `Everything came back: ${describeBackup(parsed.summary)}.`
        : `Not the same after restore: ${diffs.join('; ')}`
    );

    const written = listFiles(dataDir);
    const settingsMade = written.some((f) => path.basename(f) === 'settings.json');
    step(!settingsMade, settingsMade ? 'A settings file (where keys live) was created by the restore.' : 'No settings file was created: keys are never restored, add them again in Menu > Settings.');
    const leaked = written
      .filter((f) => f.endsWith('.json') || f.endsWith('.jsonl'))
      .flatMap((f) => {
        try {
          const text = fs.readFileSync(f, 'utf8');
          const values = f.endsWith('.jsonl') ? text.split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [JSON.parse(text)];
          return secretFieldsIn(values).map((p) => `${path.relative(dataDir, f)} ${p}`);
        } catch {
          return [];
        }
      });
    step(leaked.length === 0, leaked.length === 0 ? 'No key, secret or token anywhere the restore wrote.' : `Key or secret fields written: ${leaked.slice(0, 5).join(', ')}`);
    return done();
  } finally {
    await stop();
    if (!opts.keepDir) fs.rmSync(dataDir, { recursive: true, force: true });
  }
}
