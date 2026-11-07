/**
 * The forward record file (data/local/validation/forward.jsonl) and its hash chain. Server and
 * scripts only; the record itself is described in src/utils/forwardRecord.ts.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { ForwardBody, ForwardLine } from './forwardRecord';

const sortKeys = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])])) : v;

export function forwardHash(prev: string, body: ForwardBody): string {
  return crypto.createHash('sha256').update(prev + JSON.stringify(sortKeys(body))).digest('hex');
}

export function forwardFilePath(dataDir: string): string {
  return path.join(dataDir, 'local', 'validation', 'forward.jsonl');
}

export function loadForward(file: string): { lines: ForwardLine[]; chainOk: boolean; badLines: number } {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { lines: [], chainOk: true, badLines: 0 };
  }
  const lines: ForwardLine[] = [];
  let badLines = 0;
  let prev = '';
  let chainOk = true;
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    try {
      const l = JSON.parse(raw) as ForwardLine;
      const { hash, ...body } = l;
      if (forwardHash(prev, body as ForwardBody) !== hash) chainOk = false;
      prev = hash;
      lines.push(l);
    } catch {
      badLines++;
      chainOk = false;
    }
  }
  return { lines, chainOk, badLines };
}

export function appendForward(file: string, bodies: ForwardBody[]): void {
  if (!bodies.length) return;
  const { lines } = loadForward(file);
  let prev = lines.length ? lines[lines.length - 1].hash : '';
  const text = bodies
    .map((b) => {
      const hash = forwardHash(prev, b);
      prev = hash;
      return JSON.stringify({ ...b, hash });
    })
    .join('\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${text}\n`, { mode: 0o600 });
}
