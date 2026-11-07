/**
 * Loaded into the server under test (NODE_OPTIONS="--import ..."). Answers every call to an Ollama
 * /api/chat with the reply recorded on Sam's Mac (tests/fixtures/council-recorded/), matched by what
 * decides the answer (modelRecording.mjs). A call that was not recorded (a prompt, template, input
 * or setting changed) gets HTTP 404 and a line in MODEL_REPLAY_LOG naming the step and the first
 * line that differs from the closest recording. Every other request fails, as if offline.
 *
 * The clock is set back to when the recording was made.
 */
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { callKey, decidingPart, firstDifference, isChatUrl, isTagsUrl } from './modelRecording.mjs';

const dir = process.env.MODEL_REPLAY_DIR;
if (!dir) throw new Error('MODEL_REPLAY_DIR is not set');
const log = process.env.MODEL_REPLAY_LOG || '';
const index = JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8'));
const calls = new Map();
const callDir = path.join(dir, 'calls');
if (existsSync(callDir)) {
  for (const f of readdirSync(callDir)) {
    if (!f.endsWith('.json')) continue;
    const c = JSON.parse(readFileSync(path.join(callDir, f), 'utf8'));
    calls.set(c.key, c);
  }
}

const RealDate = Date;
const shift = RealDate.parse(index.recordedAt) - RealDate.now();
class ShiftedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(RealDate.now() + shift);
    else super(...args);
  }
  static now() {
    return RealDate.now() + shift;
  }
}
globalThis.Date = ShiftedDate;

const note = (line) => {
  if (log) appendFileSync(log, JSON.stringify(line) + '\n');
};
const realFetch = globalThis.fetch;
const models = [...new Set([...calls.values()].map((c) => c.model))];

globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (/^https?:\/\/(127\.0\.0\.1|localhost):\d+\/api\/(?!chat|tags)/.test(url)) return realFetch(input, init);
  if (isTagsUrl(url)) return new Response(JSON.stringify({ models: models.map((name) => ({ name })) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (isChatUrl(url)) {
    let body = {};
    try {
      body = JSON.parse(String(init.body || '{}'));
    } catch {
      // not JSON
    }
    const key = callKey(body);
    const hit = calls.get(key);
    if (hit) {
      note({ hit: key, model: hit.model });
      return new Response(hit.reply, { status: 200, headers: hit.contentType ? { 'Content-Type': hit.contentType } : {} });
    }
    // Closest recording: same system instruction first line, same model.
    const now = decidingPart(body);
    const sys = (m) => String(m?.request?.messages?.[0]?.content ?? m?.messages?.[0]?.content ?? '').split('\n')[0];
    const near = [...calls.values()].find((c) => sys(c) === sys(now) && c.model === now.model) || [...calls.values()].find((c) => sys(c) === sys(now));
    let diff = null;
    if (near) {
      const nowText = (now.messages || []).map((m) => m.content).join('\n');
      const recText = (near.request.messages || []).map((m) => m.content).join('\n');
      diff = firstDifference(recText, nowText) || { line: 0, recorded: JSON.stringify(near.request.options), now: JSON.stringify(now.options) };
      if (near.model !== now.model) diff = { line: 0, recorded: `model ${near.model}`, now: `model ${now.model}` };
    }
    note({ miss: key, model: now.model, step: sys(now).slice(0, 120), diff });
    return new Response(JSON.stringify({ error: 'not in the recorded model replies' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  throw new TypeError('fetch failed (offline: model replay)');
};
