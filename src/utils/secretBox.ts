/**
 * Keys encrypted at rest (Sam, 2026-11-06). The data and AI keys saved under Menu > Settings are
 * written to data/local/settings.json encrypted with AES-256-GCM when a master key is set. The
 * master key never lives in the data folder, so a copy of the data volume (or a backup of it) does
 * not reveal the keys. It comes from, in order:
 *   1. ECONQUEST_SECRET_KEY (any text of 32 or more characters; e.g. `openssl rand -base64 32`)
 *   2. the file named by ECONQUEST_SECRET_KEY_FILE
 *   3. /run/secrets/econquest_secret_key (a Docker or compose secret)
 * Without one the keys stay as before: plain text in a mode-600 file, and Settings says so.
 *
 * Server-only (node:crypto).
 */
import fs from 'fs';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

export const ENC_PREFIX = 'enc:v1:';
export const DEFAULT_SECRET_FILE = '/run/secrets/econquest_secret_key';
export const MIN_SECRET_LENGTH = 32;

export interface SecretBox {
  /** Where the master key came from, for Settings and the start-up log (never the key itself). */
  source: string;
  encrypt(plain: string): string;
  /** The plain text, or null when the value cannot be opened with this key. */
  decrypt(value: string): string | null;
}

export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

export function makeSecretBox(secret: string, source: string): SecretBox {
  // A fixed, labelled hash turns any long passphrase into a 256-bit key.
  const key = createHash('sha256').update(`econquest-settings-v1:${secret}`).digest();
  return {
    source,
    encrypt(plain: string): string {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return `${ENC_PREFIX}${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
    },
    decrypt(value: string): string | null {
      if (!isEncrypted(value)) return null;
      const [iv, tag, ct] = value.slice(ENC_PREFIX.length).split(':');
      try {
        const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
        d.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
      } catch {
        return null;
      }
    },
  };
}

export type SecretKeyResult = { box: SecretBox | null; problem: string | null };

/** Finds the master key. A key that is set but too short is a problem, not silently ignored. */
export function secretBoxFromEnv(env: Record<string, string | undefined>, readFile: (p: string) => string | null = safeRead): SecretKeyResult {
  const candidates: Array<{ value: string | null; source: string }> = [];
  if (env.ECONQUEST_SECRET_KEY !== undefined && env.ECONQUEST_SECRET_KEY.trim() !== '') {
    candidates.push({ value: env.ECONQUEST_SECRET_KEY, source: 'ECONQUEST_SECRET_KEY' });
  } else if (env.ECONQUEST_SECRET_KEY_FILE && env.ECONQUEST_SECRET_KEY_FILE.trim()) {
    const f = env.ECONQUEST_SECRET_KEY_FILE.trim();
    const v = readFile(f);
    if (v === null) return { box: null, problem: `ECONQUEST_SECRET_KEY_FILE names ${f}, which cannot be read.` };
    candidates.push({ value: v, source: f });
  } else {
    const v = readFile(DEFAULT_SECRET_FILE);
    if (v !== null) candidates.push({ value: v, source: DEFAULT_SECRET_FILE });
  }
  const hit = candidates[0];
  if (!hit) return { box: null, problem: null };
  const secret = String(hit.value || '').trim();
  if (secret.length < MIN_SECRET_LENGTH) {
    return { box: null, problem: `The master key from ${hit.source} is shorter than ${MIN_SECRET_LENGTH} characters, so keys were not encrypted. Make one with: openssl rand -base64 32` };
  }
  return { box: makeSecretBox(secret, hit.source), problem: null };
}

function safeRead(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}
