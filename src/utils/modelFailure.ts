/**
 * Why an AI model step did not answer, in plain words, so the chat can say more than
 * "no model answered". Also the time a step may wait for a model on this computer.
 */

/** Steps that summarise a whole conversation, the Supreme Council's final step (a large model), and Settings > AI model > Test. */
export const LONG_CHAT_STEPS = new Set(['COUNCIL_SYNTHESIS', 'COUNCIL_DEBATE', 'AI_MODEL_TEST', 'REVIEW_OPTIONS', 'STAGE_3_SUPREME_COUNCIL', 'AI_MODEL_TEST_REFEREE']);

/**
 * The full council's desk and cascade steps: on a laptop a 7B model needs well over 16 s to write a
 * desk answer (Sam's Mac, 2026-11-06: all three desks cut off at 16 s). They stream and get the same
 * long wait as the summary, but keep the normal context window.
 */
export const DESK_STEPS = new Set(['STAGE_1_GEO_DESK', 'STAGE_1_SOV_DESK', 'STAGE_1_MACRO_DESK', 'STAGE_2_CONTAGION_CASCADE']);

/** Steps that stream from Ollama and wait on silence rather than on a short total. */
export function isLongLocalStep(stepName: string): boolean {
  return LONG_CHAT_STEPS.has(stepName) || DESK_STEPS.has(stepName);
}

/** A local model (Ollama on a laptop) can take a minute or more to read the agents' answers. */
export const LONG_CHAT_STEP_MIN_MS = 120_000;

/**
 * How long one local-model call may take. The user's timeout from Menu > Settings > AI model wins when it is
 * longer; the summary and debate steps never wait less than LONG_CHAT_STEP_MIN_MS.
 */
export function localStepTimeoutMs(stepName: string, userTimeoutSec: unknown, isDeepStep: boolean): number {
  const user = typeof userTimeoutSec === 'number' && userTimeoutSec >= 5 && userTimeoutSec <= 600 ? Math.round(userTimeoutSec * 1000) : null;
  const base = user ?? (isDeepStep ? 25_000 : 16_000);
  return isLongLocalStep(stepName) ? Math.max(base, LONG_CHAT_STEP_MIN_MS) : base;
}

export interface ModelAttempt {
  /** e.g. "Ollama qwen2.5:7b at http://localhost:11434" or "Gemini". */
  where: string;
  error?: unknown;
  timeoutMs?: number;
  /** The model answered, but not with a JSON object. */
  notJson?: boolean;
  /** Ollama is running but this model is not downloaded (the model name). */
  notPulled?: string;
}

/** One short sentence for one failed attempt. */
export function describeAttempt(a: ModelAttempt): string {
  if (a.notJson) return `${a.where} answered, but not in the format the app needs`;
  if (a.notPulled) return `${a.where}: that model is not downloaded (run "ollama pull ${a.notPulled}" on this computer)`;
  if (a.error instanceof ModelWaitError) {
    const s = Math.round(a.error.waitedMs / 1000);
    if (a.error.kind === 'first') return `${a.where} is running but wrote nothing within ${s} s (the model may still be loading, or the computer is short of memory: check "ollama ps")`;
    if (a.error.kind === 'idle') return `${a.where} stopped writing for ${s} s partway through its answer`;
    return `${a.where} was still writing after ${s} s`;
  }
  const e = a.error as { name?: string; message?: string; cause?: { code?: string } } | undefined;
  const msg = String(e?.message || e || '').trim();
  const code = e?.cause?.code || '';
  if (e?.name === 'AbortError' || /aborted/i.test(msg)) {
    return `${a.where} did not answer within ${Math.round((a.timeoutMs || 0) / 1000)} s`;
  }
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) return `${a.where} is not running`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /ENOTFOUND|EAI_AGAIN/.test(msg)) return `${a.where} could not be found`;
  if (/HTTP 404/.test(msg)) return `${a.where} answered HTTP 404 (is that model pulled? run "ollama pull" for it)`;
  const http = msg.match(/HTTP (\d{3})(?::\s*(.+))?/);
  if (http) {
    const said = http[2]?.trim();
    if (!said) return `${a.where} answered HTTP ${http[1]}`;
    const memory = /signal: killed/i.test(said)
      ? ' (the model was killed while loading, usually for lack of memory: on a Mac check that "docker ps" shows no Ollama container on port 11434 and that "ollama ps" says GPU)'
      : /memory|out of memory|oom|insufficient|resource/i.test(said)
        ? ' (the computer is short of memory for this model: close other apps or check "ollama ps")'
        : '';
    return `${a.where} answered HTTP ${http[1]}: "${said}"${memory}`;
  }
  if (/fetch failed/i.test(msg)) return `${a.where} could not be reached`;
  return `${a.where} failed (${msg.slice(0, 160) || 'unknown error'})`;
}

/**
 * The reason for the chat. Local-model "could not be found" lines for the Docker fallback addresses
 * are dropped when another attempt says more, so a laptop user sees the line that matters.
 */
export function describeFailures(attempts: ModelAttempt[], geminiKeySet: boolean): string {
  const lines = attempts.map(describeAttempt);
  const dockerReached = lines.some((l) => /host\.docker\.internal/.test(l) && !/could not be (found|reached)/.test(l));
  const useful = lines.filter(
    (l) =>
      !/(host\.docker\.internal|ollama:11434).*could not be (found|reached)/.test(l) &&
      // Inside Docker, "localhost is not running" is expected once the host address was reached.
      !(dockerReached && /(localhost|127\.0\.0\.1)(:\d+)? is not running/.test(l))
  );
  const shown = useful.length ? useful : lines;
  if (!geminiKeySet) shown.push('no Gemini key is set');
  return shown.length ? shown.join('; ') : 'no model is set up';
}

/** Steps that may stream: how long to wait for the first word, between words, and in all. */
export interface StreamWait {
  firstTokenMs: number;
  idleMs: number;
  totalMs: number;
}

/**
 * Summary and debate: the first word may take as long as the step timeout (a cold model loads first),
 * then the model may keep writing for up to five minutes as long as it does not stall for a minute.
 */
export function streamWaitFor(stepName: string, stepTimeoutMs: number): StreamWait {
  if (!isLongLocalStep(stepName)) return { firstTokenMs: stepTimeoutMs, idleMs: stepTimeoutMs, totalMs: stepTimeoutMs };
  return { firstTokenMs: stepTimeoutMs, idleMs: 60_000, totalMs: Math.max(300_000, stepTimeoutMs) };
}

/** Thrown when a streaming local model stops short of a full answer. */
export class ModelWaitError extends Error {
  constructor(public readonly kind: 'first' | 'idle' | 'total', public readonly waitedMs: number) {
    super(`model wait: ${kind} after ${waitedMs} ms`);
    this.name = 'ModelWaitError';
  }
}

/** True when Ollama's /api/tags list has the model ("qwen2.5:7b", or "llama3" meaning "llama3:latest"). */
export function ollamaHasModel(tags: unknown, model: string): boolean {
  const list = (tags as { models?: Array<{ name?: string; model?: string }> } | null)?.models;
  if (!Array.isArray(list)) return true; // unknown shape: do not block the call
  const want = model.includes(':') ? model : `${model}:latest`;
  return list.some((m) => m?.name === want || m?.model === want || m?.name === model || m?.model === model);
}
