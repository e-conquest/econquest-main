/**
 * Shared by the recorder (record-fetch.mjs, run on a computer that reaches the feeds) and the
 * replayer (replay-fetch.mjs, used in CI): where recordings live, and how a URL is matched with
 * keys and tokens taken out so no secret is ever written to the repo.
 */
import { createHash } from 'node:crypto';

/** Query parameters that carry a key or token: their values are replaced by "X". */
const SECRET_PARAM = /(key|token|secret|password|auth|subscription)/i;

/** The URL with every key or token value replaced, so it can be stored and matched. */
export function maskUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return String(raw);
  }
  for (const name of [...u.searchParams.keys()]) {
    if (SECRET_PARAM.test(name)) u.searchParams.set(name, 'X');
  }
  u.username = '';
  u.password = '';
  return u.toString();
}

/** Short stable file name for a recorded body. */
export function bodyName(method, maskedUrl) {
  return `${createHash('sha1').update(`${method} ${maskedUrl}`).digest('hex').slice(0, 16)}.gz`;
}

/** Origin plus path, the fallback match when query values (dates, ranges) moved. */
export function urlStem(maskedUrl) {
  try {
    const u = new URL(maskedUrl);
    return `${u.origin}${u.pathname}`;
  } catch {
    return maskedUrl;
  }
}

/** How many query parameters two URLs share, name and value. */
export function sharedParams(a, b) {
  try {
    const pa = new URL(a).searchParams;
    const pb = new URL(b).searchParams;
    let n = 0;
    for (const [k, v] of pa) if (pb.get(k) === v) n++;
    return n;
  } catch {
    return 0;
  }
}

/** Hosts never recorded: the local model and the app itself. */
export function skipHost(raw) {
  try {
    const h = new URL(raw).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.test');
  } catch {
    return true;
  }
}

/** Largest body kept (uncompressed). Bigger replies are noted, not stored. */
export const MAX_BODY_BYTES = 30 * 1024 * 1024;
