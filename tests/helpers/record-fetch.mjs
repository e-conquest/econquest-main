/**
 * Loaded into the server with NODE_OPTIONS="--import ..." by `npm run record:feeds`.
 * Real fetch, but every reply from a feed is also saved (gzipped, keys taken out of the URL) under
 * RECORD_DIR, with an index line per request in RECORD_DIR/requests.jsonl. CI then replays them
 * (replay-fetch.mjs), so a parser is tested against what each source really sends.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { MAX_BODY_BYTES, bodyName, maskUrl, skipHost } from './feedRecording.mjs';

const dir = process.env.RECORD_DIR;
if (!dir) throw new Error('RECORD_DIR is not set');
mkdirSync(path.join(dir, 'bodies'), { recursive: true });
const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const res = await realFetch(input, init);
  if (skipHost(url) || method !== 'GET') return res;
  try {
    const buf = Buffer.from(await res.clone().arrayBuffer());
    const masked = maskUrl(url);
    const line = { method, url: masked, status: res.status, contentType: res.headers.get('content-type') || '', bytes: buf.length, at: new Date().toISOString() };
    if (buf.length <= MAX_BODY_BYTES) {
      const name = bodyName(method, masked);
      writeFileSync(path.join(dir, 'bodies', name), gzipSync(buf, { level: 9 }));
      line.body = name;
    } else {
      line.skipped = 'too large';
    }
    appendFileSync(path.join(dir, 'requests.jsonl'), JSON.stringify(line) + '\n');
  } catch (error) {
    appendFileSync(path.join(dir, 'requests.jsonl'), JSON.stringify({ method, url: maskUrl(url), error: String(error?.message || error) }) + '\n');
  }
  return res;
};
