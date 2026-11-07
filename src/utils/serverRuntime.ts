/**
 * Settings the server reads from its environment when it runs as a service (Docker on a home
 * server, or later a cluster). Config comes only from environment variables; state lives only
 * under DATA_DIR.
 */
import fs from 'fs';
import path from 'path';

export interface RuntimeEnv {
  OLLAMA_BASE_URL?: string;
  SELF_HOSTED_DOCKER?: string;
}

/**
 * Where Ollama is, by URL. OLLAMA_BASE_URL wins. Without it, the app started on a computer
 * (`npm run dev`) looks on that computer; inside Docker it looks at the Docker host, since the
 * container's own localhost never runs Ollama.
 */
export function ollamaBaseUrlDefault(env: RuntimeEnv): string {
  const set = String(env.OLLAMA_BASE_URL || '').trim();
  if (set) return set.replace(/\/+$/, '');
  return env.SELF_HOSTED_DOCKER === 'true' ? 'http://host.docker.internal:11434' : 'http://localhost:11434';
}

function canWrite(dir: string): string | null {
  const probe = path.join(dir, `.write-check-${process.pid}`);
  try {
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return null;
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code || 'error';
  }
}

/**
 * Null when the server can keep its state in dataDir, otherwise a sentence saying what to fix.
 * Writes and removes a small file in dataDir/local (settings and logs) and in every other folder
 * already there (live, history, archive), so data left by an older version that ran as root is
 * caught at start, not on the first save.
 */
export function dataDirProblem(dataDir: string): string | null {
  const local = path.join(dataDir, 'local');
  let failed: { dir: string; code: string } | null = null;
  try {
    fs.mkdirSync(local, { recursive: true });
    const dirs = [local];
    for (const e of fs.readdirSync(dataDir, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== 'local') dirs.push(path.join(dataDir, e.name));
    }
    for (const dir of dirs) {
      const code = canWrite(dir);
      if (code) {
        failed = { dir, code };
        break;
      }
    }
  } catch (e) {
    failed = { dir: dataDir, code: (e as NodeJS.ErrnoException)?.code || 'error' };
  }
  if (!failed) return null;
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  return (
    `Cannot write to the data folder ${failed.dir} (${failed.code}). ` +
    (uid !== null
      ? `The app runs as user id ${uid}; give that user the folder. With docker compose: ` +
        `docker compose run --rm --no-deps --user root --entrypoint chown econquest -R ${uid}:${uid} /app/data`
      : 'Check that the folder exists and can be written.')
  );
}

/**
 * LOG_FORMAT=json turns every console line into one JSON object on stdout or stderr
 * ({"time","level","msg"}), for `docker logs`, journald or a log collector. Without it the
 * console stays as it is for `npm run dev`. Only the text the code already logs is written.
 */
export function installJsonConsole(
  env: { LOG_FORMAT?: string },
  out: { write: (s: string) => unknown } = process.stdout,
  err: { write: (s: string) => unknown } = process.stderr,
  now: () => Date = () => new Date()
): boolean {
  if (String(env.LOG_FORMAT || '').trim().toLowerCase() !== 'json') return false;
  const text = (args: unknown[]) =>
    args
      .map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : safeJson(a)))
      .join(' ');
  const line = (level: string, args: unknown[]) => JSON.stringify({ time: now().toISOString(), level, msg: text(args) }) + '\n';
  console.log = (...a: unknown[]) => void out.write(line('info', a));
  console.info = (...a: unknown[]) => void out.write(line('info', a));
  console.debug = (...a: unknown[]) => void out.write(line('debug', a));
  console.warn = (...a: unknown[]) => void err.write(line('warn', a));
  console.error = (...a: unknown[]) => void err.write(line('error', a));
  return true;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

export interface ReadyState {
  listening: boolean;
  shuttingDown: boolean;
  dataProblem: string | null;
}

/** Readiness: 200 only while the server listens, is not stopping and can write its data folder. */
export function readiness(s: ReadyState): { status: number; body: { ready: boolean; reason?: string } } {
  if (s.shuttingDown) return { status: 503, body: { ready: false, reason: 'Shutting down.' } };
  if (!s.listening) return { status: 503, body: { ready: false, reason: 'Starting.' } };
  if (s.dataProblem) return { status: 503, body: { ready: false, reason: s.dataProblem } };
  return { status: 200, body: { ready: true } };
}

/**
 * Milliseconds to wait for open requests on a stop signal before exiting anyway.
 * SHUTDOWN_TIMEOUT_MS, default 8000 (Docker sends SIGKILL 10 s after SIGTERM).
 */
export function shutdownTimeoutMs(env: { SHUTDOWN_TIMEOUT_MS?: string }): number {
  const n = Number(env.SHUTDOWN_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 120_000) : 8000;
}
