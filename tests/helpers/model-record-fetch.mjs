/**
 * Loaded into a private copy of the server by `npm run council:record` (NODE_OPTIONS="--import ...").
 * Real fetch, but every call to an Ollama /api/chat is also saved under MODEL_RECORD_DIR/calls/,
 * named by what decides the answer (modelRecording.mjs): the request (model, messages, options) and
 * the reply exactly as Ollama sent it. CI replays them (model-replay-fetch.mjs).
 *
 * Only model calls are saved. The regression cases use frozen inputs, so no feed is asked and no
 * key is involved.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { callKey, decidingPart, isChatUrl } from './modelRecording.mjs';

const dir = process.env.MODEL_RECORD_DIR;
if (!dir) throw new Error('MODEL_RECORD_DIR is not set');
mkdirSync(path.join(dir, 'calls'), { recursive: true });
const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const res = await realFetch(input, init);
  if (!res.ok) return res;
  if (!isChatUrl(url)) return res;
  let body;
  try {
    body = JSON.parse(String(init.body || ''));
  } catch {
    return res;
  }
  const key = callKey(body);
  // Read a copy to the end without holding up the server, which reads the stream as it comes.
  res
    .clone()
    .text()
    .then((text) => {
      writeFileSync(
        path.join(dir, 'calls', `${key}.json`),
        JSON.stringify({ key, model: body.model, request: decidingPart(body), streamed: Boolean(body.stream), contentType: res.headers.get('content-type') || '', reply: text, at: new Date().toISOString() }, null, 1)
      );
    })
    .catch((error) => process.stderr.write(`[model-record] could not save a reply: ${error?.message || error}\n`));
  return res;
};
