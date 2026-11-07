/**
 * Shared by the model recorder (model-record-fetch.mjs, `npm run council:record` on the Mac) and the
 * replayer (model-replay-fetch.mjs, CI): how one call to Ollama's /api/chat is named.
 *
 * The name is a SHA-256 of what decides the answer: the model, the messages (system instruction,
 * template, frozen inputs), the sampling options and the output format. How the reply travels
 * (streamed or not, keep_alive) is left out. Change any prompt, template, input or setting and the
 * name changes, so CI finds no recording and says which step changed.
 */
import { createHash } from 'node:crypto';

/** Keys sorted at every level, so the same request always gives the same text. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The part of an /api/chat body that decides the answer. */
export function decidingPart(body) {
  const b = body && typeof body === 'object' ? body : {};
  const { stream: _s, keep_alive: _k, ...rest } = b;
  const options = { ...(rest.options || {}) };
  // num_predict is a safety cap on length, set only for streamed calls; it does not change the words.
  delete options.num_predict;
  return { ...rest, options };
}

export function callKey(body) {
  return createHash('sha256').update(canonical(decidingPart(body))).digest('hex');
}

export const isChatUrl = (url) => /\/api\/chat(\?|$)/.test(url);
export const isTagsUrl = (url) => /\/api\/tags(\?|$)/.test(url);

/** First line where two prompts differ, for a plain "what changed" message. */
export function firstDifference(a, b) {
  const x = String(a || '').split('\n');
  const y = String(b || '').split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) return { line: i + 1, recorded: (x[i] ?? '(nothing)').slice(0, 200), now: (y[i] ?? '(nothing)').slice(0, 200) };
  }
  return null;
}
