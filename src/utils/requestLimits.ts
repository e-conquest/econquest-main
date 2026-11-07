/**
 * Request protection once accounts exist (Sam, 2026-11-06):
 *
 * - CSRF token: every change (POST, PUT, DELETE, PATCH) from a signed-in browser must carry the
 *   header X-CSRF-Token, a value derived from that browser's session. A page on another site cannot
 *   read it, so it cannot make a change even if the browser would send the cookie. This sits on top
 *   of the existing Origin / Sec-Fetch-Site check in requestGuard.ts.
 * - Rate limits per account: a burst allowance that refills over a minute, tighter for calls that
 *   run the AI model, so one account (or a stolen session) cannot flood the server or the model.
 * - Security headers on every reply: no framing, no MIME sniffing, no referrer to other sites.
 *
 * Server-only (uses node:crypto).
 */
import { createHash, timingSafeEqual } from 'crypto';

export const CSRF_HEADER = 'x-csrf-token';

export function csrfToken(sessionTokenHash: string): string {
  return createHash('sha256').update(`econquest-csrf:${sessionTokenHash}`).digest('base64url');
}

export function csrfMatches(given: unknown, sessionTokenHash: string): boolean {
  if (typeof given !== 'string' || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(csrfToken(sessionTokenHash));
  return a.length === b.length && timingSafeEqual(a, b);
}

const WRITE = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
export const isWrite = (method: string) => WRITE.has(String(method).toUpperCase());

/** Calls that run the AI model (and so cost minutes of GPU time or paid tokens). */
export function isAiCall(method: string, pathname: string): boolean {
  if (!isWrite(method)) return false;
  return /^\/api\/council\//.test(pathname) || /^\/api\/ai\/(try-model|ollama-test)$/.test(pathname);
}

export interface Bucket {
  /** Requests allowed at once. */
  burst: number;
  /** Requests added back per minute. */
  perMinute: number;
}

export const LIMITS: Record<'api' | 'ai', Bucket> = {
  // The app fires a few dozen reads when a page opens; this leaves plenty of room.
  api: { burst: 600, perMinute: 600 },
  ai: { burst: 20, perMinute: 10 },
};

/** Token buckets by key (account id + class). In memory; a restart refills them. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  /** Seconds to wait, or 0 when the request may go ahead (and is counted). */
  take(key: string, bucket: Bucket, now: number = Date.now()): number {
    const b = this.buckets.get(key) ?? { tokens: bucket.burst, at: now };
    const refill = ((now - b.at) / 60_000) * bucket.perMinute;
    b.tokens = Math.min(bucket.burst, b.tokens + refill);
    b.at = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      this.buckets.set(key, b);
      return 0;
    }
    this.buckets.set(key, b);
    return Math.ceil(((1 - b.tokens) / bucket.perMinute) * 60);
  }
}

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
