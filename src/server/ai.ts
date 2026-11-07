/**
 * AI model calls: the Gemini client, Ollama and OpenAI-compatible endpoints, picking the model
 * for each step from Menu > Settings > AI model, JSON clean-up, and the resilient step runner
 * that retries, falls back across providers and reports which model answered.
 */

import { AIRuntimeConfig, SubAgentReport } from '../types/council.ts';
import { geminiModel } from '../utils/geminiModel';
import { DEFAULT_REFEREE_MODEL, isRefereeStep, refereeModelOrDefault } from '../utils/refereeModel';
import { ThinkingLevel, GoogleGenAI } from '@google/genai';
import { describeFailures, isLongLocalStep, localStepTimeoutMs, LONG_CHAT_STEPS, type ModelAttempt, ModelWaitError, ollamaHasModel, type StreamWait, streamWaitFor } from '../utils/modelFailure';
import { ollamaBaseUrlDefault } from '../utils/serverRuntime';
import { serverGuiRuntimeConfig } from './integrations';
import { type ModelStats, ollamaStats } from '../utils/councilTiming';

// Rebuilt when the Gemini key is changed in Menu > Settings.
export const makeGeminiClient = () =>
  new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'econquest-terminal',
      },
    },
  });
// Built on first use, so a computer that only runs Ollama never constructs it (the SDK warns at
// construction when no key is set).
let gemini: GoogleGenAI | null = null;
export function geminiClient(): GoogleGenAI {
  if (!gemini) gemini = makeGeminiClient();
  return gemini;
}

/** Rebuild the Gemini client after the key changes in Menu > Settings (on its next use). */
export function resetGeminiClient(): void {
  gemini = null;
}

function resolveStepModelFromGuiConfig(
  stepName: string,
  isDeepCouncilStep: boolean,
  cfg: Partial<AIRuntimeConfig>
): string {
  const deskOverrides = cfg.deskModelOverrides || serverGuiRuntimeConfig.deskModelOverrides || {};
  const agentOverrides = cfg.agentModelOverrides || serverGuiRuntimeConfig.agentModelOverrides || {};
  const quickDefault =
    cfg.ollamaQuickModel ||
    serverGuiRuntimeConfig.ollamaQuickModel ||
    process.env.OLLAMA_QUICK_MODEL ||
    'qwen2.5:7b';
  // The referee model (src/utils/refereeModel.ts): the old 8B default, from a saved setting or the
  // Docker image's env, becomes qwen2.5:32b; with nothing set, the referee is never the fast model.
  const deepDefault =
    refereeModelOrDefault(cfg.ollamaDeepModel) ||
    refereeModelOrDefault(serverGuiRuntimeConfig.ollamaDeepModel) ||
    refereeModelOrDefault(process.env.OLLAMA_DEEP_MODEL) ||
    DEFAULT_REFEREE_MODEL;

  if (stepName === 'STAGE_1_GEO_DESK') {
    return (
      deskOverrides.geopolitical?.trim() ||
      agentOverrides.ag1_intel_scraper?.trim() ||
      agentOverrides.ag2_transmission_mapper?.trim() ||
      agentOverrides.ag3_sanctions_legal?.trim() ||
      quickDefault
    );
  }
  if (stepName === 'STAGE_1_SOV_DESK') {
    return (
      deskOverrides.sovereign?.trim() ||
      agentOverrides.ag4_fiscal_auditor?.trim() ||
      agentOverrides.ag5_external_balance?.trim() ||
      agentOverrides.ag6_political_will?.trim() ||
      quickDefault
    );
  }
  if (stepName === 'STAGE_1_MACRO_DESK') {
    return (
      deskOverrides.macro?.trim() ||
      agentOverrides.ag7_hf_nowcaster?.trim() ||
      agentOverrides.ag8_cb_watcher?.trim() ||
      agentOverrides.ag9_global_spillover?.trim() ||
      quickDefault
    );
  }
  if (isDeepCouncilStep) {
    return deskOverrides.supremeCouncil?.trim() || deepDefault;
  }
  return quickDefault;
}

/** The reason a model endpoint gives with an error status (Ollama sends {"error": "..."}), as ": reason", or "". */
async function endpointSays(res: Response): Promise<string> {
  try {
    const text = (await res.text()).trim();
    if (!text) return '';
    let said = text;
    try {
      const j = JSON.parse(text);
      said = typeof j?.error === 'string' ? j.error : typeof j?.error?.message === 'string' ? j.error.message : text;
    } catch {
      /* plain text */
    }
    return `: ${said.replace(/\s+/g, ' ').slice(0, 300)}`;
  } catch {
    return '';
  }
}

/**
 * The keys a local model must return, with what each holds. Ollama gets only this text (not the
 * schema Gemini gets), so allowed values and lists must be spelled out here or the model writes
 * free text (for example "Proceed with caution" instead of HOLD_AND_MONITOR).
 */
export function schemaKeyHints(properties: Record<string, any>): string[] {
  return Object.entries(properties).map(([key, p]) => {
    const type = String(p?.type || '').toUpperCase();
    if (Array.isArray(p?.enum) && p.enum.length) return `${key} (exactly one of: ${p.enum.join(', ')})`;
    if (type === 'ARRAY') {
      const items = p?.items;
      const of = String(items?.type || '').toUpperCase() === 'STRING' ? 'strings' : String(items?.type || '').toUpperCase() === 'OBJECT' ? 'objects' : 'items';
      return `${key} (a JSON list of ${of})`;
    }
    return key;
  });
}

export async function callOllamaOrOpenAICompatible(
  baseUrl: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  isOllama: boolean,
  timeoutMs = 20000,
  schemaKeysHint?: string[],
  inferenceOptions?: { temperature?: number; numCtx?: number; seed?: number; statsOut?: { value?: ModelStats } },
  /** Ollama only: stream the answer and time out on silence instead of on total length. */
  wait?: StreamWait
): Promise<string> {
  const cleanUrl = baseUrl.replace(/\/+$/, '');
  const endpoint = isOllama ? `${cleanUrl}/api/chat` : `${cleanUrl}/chat/completions`;
  const schemaInstruction =
    schemaKeysHint && schemaKeysHint.length > 0
      ? `\n\nCRITICAL JSON SCHEMA REQUIREMENT: Return ONLY a valid JSON object containing these exact top-level keys: ${schemaKeysHint.join(', ')}. Do not wrap in markdown code fences.`
      : '\n\nCRITICAL: Return ONLY a valid JSON object. Do not wrap in markdown code fences.';

  const temperature =
    typeof inferenceOptions?.temperature === 'number' &&
    inferenceOptions.temperature >= 0 &&
    inferenceOptions.temperature <= 1.5
      ? Number(inferenceOptions.temperature.toFixed(2))
      : 0.2;
  const numCtx =
    typeof inferenceOptions?.numCtx === 'number' &&
    inferenceOptions.numCtx >= 1024 &&
    inferenceOptions.numCtx <= 65536
      ? Math.round(inferenceOptions.numCtx)
      : 8192;
  const seed = Number.isInteger(inferenceOptions?.seed) ? inferenceOptions!.seed : undefined;

  const isReasoningModel = /deepseek-r1|qwq|qwen3/i.test(model);
  const body = isOllama
    ? {
        model,
        stream: false,
        // Reasoning models with <think> blocks work best when allowed to emit or when format: 'json' is paired with explicit key hints
        ...(isReasoningModel ? {} : { format: 'json' }),
        ...(wait ? { stream: true, keep_alive: '30m' } : {}),
        options: {
          temperature,
          num_ctx: numCtx,
          ...(seed !== undefined ? { seed } : {}),
          // A cap so a model that keeps emitting blank JSON padding cannot run on forever.
          ...(wait ? { num_predict: isReasoningModel ? 4096 : 2048 } : {}),
        },
        messages: [
          { role: 'system', content: `${systemPrompt}${schemaInstruction}` },
          { role: 'user', content: userPrompt },
        ],
      }
    : {
        model,
        response_format: { type: 'json_object' },
        temperature,
        ...(seed !== undefined ? { seed } : {}),
        messages: [
          { role: 'system', content: `${systemPrompt}${schemaInstruction}` },
          { role: 'user', content: userPrompt },
        ],
      };

  if (isOllama && wait) return streamOllamaChat(endpoint, body, wait, inferenceOptions?.statsOut);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const postRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!postRes.ok) throw new Error(`Model endpoint ${endpoint} failed with HTTP ${postRes.status}${await endpointSays(postRes)}`);
    const json: any = await postRes.json();
    if (isOllama && inferenceOptions?.statsOut) inferenceOptions.statsOut.value = ollamaStats(json);
    return isOllama ? json?.message?.content || '{}' : json?.choices?.[0]?.message?.content || '{}';
  } finally {
    clearTimeout(timer);
  }
}

/** Reads an Ollama /api/chat stream; times out on no first word, on a stall, or on total length. */
async function streamOllamaChat(endpoint: string, body: Record<string, unknown>, wait: StreamWait, statsOut?: { value?: ModelStats }): Promise<string> {
  const controller = new AbortController();
  let gotFirst = false;
  let why: ModelWaitError | null = null;
  let idleTimer: NodeJS.Timeout | undefined;
  const arm = () => {
    clearTimeout(idleTimer);
    const ms = gotFirst ? wait.idleMs : wait.firstTokenMs;
    idleTimer = setTimeout(() => {
      why = new ModelWaitError(gotFirst ? 'idle' : 'first', ms);
      controller.abort();
    }, ms);
  };
  const totalTimer = setTimeout(() => {
    why = new ModelWaitError('total', wait.totalMs);
    controller.abort();
  }, wait.totalMs);
  arm();
  let text = '';
  try {
    const postRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!postRes.ok) throw new Error(`Model endpoint ${endpoint} failed with HTTP ${postRes.status}${await endpointSays(postRes)}`);
    if (!postRes.body) throw new Error(`Model endpoint ${endpoint} sent no body`);
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of postRes.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg?.error) throw new Error(`Model endpoint ${endpoint} said: ${String(msg.error).slice(0, 160)}`);
        const piece = msg?.message?.content;
        if (typeof piece === 'string' && piece) {
          text += piece;
          if (piece.trim()) gotFirst = true;
        }
        if (msg?.done) {
          if (statsOut) statsOut.value = ollamaStats(msg);
          return text || '{}';
        }
      }
      arm();
    }
    return text || '{}';
  } catch (error) {
    throw why ?? error;
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(totalTimer);
  }
}

export function sanitizeAndParseJson<T>(rawText: string, fallback: T): { parsed: T; schemaVerified: boolean } {
  if (!rawText || typeof rawText !== 'string') {
    return { parsed: fallback, schemaVerified: false };
  }
  // Strip <think>...</think> chain-of-thought blocks emitted by DeepSeek-R1 / QwQ / local reasoning models
  const withoutThink = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .trim();

  const trimmed = withoutThink
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === 'object') {
      return { parsed: obj as T, schemaVerified: true };
    }
  } catch {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        const sliced = trimmed.slice(firstBrace, lastBrace + 1);
        const obj = JSON.parse(sliced);
        if (obj && typeof obj === 'object') {
          return { parsed: obj as T, schemaVerified: true };
        }
      } catch {
        // Fall through to fallback
      }
    }
  }
  return { parsed: fallback, schemaVerified: false };
}

/** Shown where a council desk's AI model did not answer: nothing is filled in from built-in text. */
export const NO_MODEL_DESK = 'No AI model answered for this part, so it is left empty.';
export const NO_MODEL_COUNCIL =
  'No AI model answered, so the council gave no assessment and no verdict. Nothing was filled in from built-in text. Set it up or test it under Menu > Settings > AI model.';

export function clampScoreToAnchor(
  rawScore: unknown,
  anchorScore: number,
  corridor = 0.22
): { rawModelScore: number; finalBoundedScore: number; anchorDriftClamped: boolean } {
  // Only the model's own score: no score from the model stays NaN (shown as missing), and with no
  // anchor (NaN) the score is not bounded. The anchor is always another model output, never a
  // built-in figure.
  if (typeof rawScore !== 'number' || !Number.isFinite(rawScore)) return { rawModelScore: NaN, finalBoundedScore: NaN, anchorDriftClamped: false };
  const rawNormalized = Number(Math.max(0.05, Math.min(0.98, rawScore)).toFixed(2));
  if (!Number.isFinite(anchorScore)) return { rawModelScore: rawNormalized, finalBoundedScore: rawNormalized, anchorDriftClamped: false };
  const minAllowed = Math.max(0.1, Number((anchorScore - corridor).toFixed(2)));
  const maxAllowed = Math.min(0.95, Number((anchorScore + corridor).toFixed(2)));
  const clamped = Number(Math.max(minAllowed, Math.min(maxAllowed, rawNormalized)).toFixed(2));
  return {
    rawModelScore: rawNormalized,
    finalBoundedScore: clamped,
    anchorDriftClamped: Math.abs(rawNormalized - clamped) >= 0.01,
  };
}

export function normalizeStance(raw: unknown, fallbackScore: number): SubAgentReport['stance'] {
  const up = String(raw || '').toUpperCase().trim();
  if (up === 'BEARISH' || up === 'BULLISH' || up === 'NEUTRAL') return up;
  if (fallbackScore >= 0.6) return 'BEARISH';
  if (fallbackScore <= 0.38) return 'BULLISH';
  return 'NEUTRAL';
}

/** The configured Ollama address, then the ones Docker uses for the Mac host or a bundled service. */
export function ollamaCandidateUrls(configuredBaseUrl: string): string[] {
  if (configuredBaseUrl.includes('localhost') || configuredBaseUrl.includes('127.0.0.1')) return [configuredBaseUrl, 'http://host.docker.internal:11434', 'http://ollama:11434'];
  if (configuredBaseUrl.includes('host.docker.internal')) return [configuredBaseUrl, 'http://localhost:11434', 'http://ollama:11434'];
  return [configuredBaseUrl];
}

/**
 * Loads the full council's desk model into Ollama before the desks start, so its load time is
 * measured on its own and not charged to the first desk. Empty prompt: Ollama loads and answers
 * at once. Returns null when the provider is not Ollama.
 */
export async function warmDeskModel(providerMode: string, runtimeConfig: Partial<AIRuntimeConfig>): Promise<{ ms: number; model: string; ok: boolean; loadMs?: number; error?: string } | null> {
  if (!['ollama', 'hybrid', 'hybrid_failover'].includes(providerMode)) return null;
  const model = resolveStepModelFromGuiConfig('STAGE_1_GEO_DESK', false, runtimeConfig);
  const t0 = Date.now();
  let lastError = 'Ollama did not answer';
  for (const url of ollamaCandidateUrls(runtimeConfig.ollamaBaseUrl || ollamaBaseUrlDefault(process.env))) {
    try {
      const r = await fetch(`${url.replace(/\/+$/, '')}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: '', keep_alive: '30m', stream: false }),
        signal: AbortSignal.timeout(180_000),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) {
        lastError = `Ollama at ${url} answered HTTP ${r.status}${j?.error ? `: ${String(j.error).slice(0, 160)}` : ''}`;
        continue;
      }
      const loadMs = typeof j?.load_duration === 'number' ? Math.round(j.load_duration / 1e6) : undefined;
      return { ms: Date.now() - t0, model, ok: true, ...(loadMs !== undefined ? { loadMs } : {}) };
    } catch (error: any) {
      lastError = error?.name === 'TimeoutError' ? `Ollama at ${url} took longer than 180 s to load ${model}` : `Ollama at ${url}: ${error?.cause?.code || error?.message || error}`;
    }
  }
  return { ms: Date.now() - t0, model, ok: false, error: lastError };
}

export async function executeResilientLlmStep<T>(options: {
  stepName: string;
  providerMode: string;
  runtimeConfig: Partial<AIRuntimeConfig>;
  systemInstruction: string;
  prompt: string;
  responseSchema: any;
  thinkingLevel?: ThinkingLevel;
  fallbackValue: T;
  maxRetries?: number;
  /** Fixed sampling for steps that must give the same answer on a re-run (src/utils/answerSnapshot.ts). */
  temperature?: number;
  seed?: number;
}): Promise<{
  data: T;
  latencyMs: number;
  retriesUsed: number;
  schemaVerified: boolean;
  usedFallback: boolean;
  providerUsed: string;
  /** The model that answered and the sampling it ran with (not set when no model answered). */
  model?: string;
  temperature?: number;
  seed?: number;
  /** When usedFallback: why no model answered, in plain words (utils/modelFailure.ts). */
  failure?: string;
  /** Ollama's own counters for the answer: load, read and write time, tokens (src/utils/councilTiming.ts). */
  stats?: ModelStats;
}> {
  const startMs = Date.now();
  const attempts: ModelAttempt[] = [];
  const maxRetries = options.maxRetries ?? 2;
  let retriesUsed = 0;

  // Referee steps (Supreme Council final step, chat summary and explanations, debate) run on the
  // large "Referee model", never on the fast one (src/utils/refereeModel.ts).
  const isDeepCouncilStep = isRefereeStep(options.stepName) || options.thinkingLevel === ThinkingLevel.HIGH;

  const schemaKeysHint = options.responseSchema?.properties ? schemaKeyHints(options.responseSchema.properties) : undefined;

  // 1. Try Local / Self-Hosted Ollama or OpenAI-Compatible Runtime first when selected (or in hybrid mode)
  if (
    options.providerMode === 'ollama' ||
    options.providerMode === 'hybrid' ||
    options.providerMode === 'hybrid_failover' ||
    options.providerMode === 'openai_compatible'
  ) {
    const isOllama = options.providerMode !== 'openai_compatible';
    const configuredBaseUrl = isOllama
      ? options.runtimeConfig.ollamaBaseUrl || ollamaBaseUrlDefault(process.env)
      : options.runtimeConfig.openAiBaseUrl ||
        process.env.OPENAI_COMPATIBLE_BASE_URL ||
        'http://localhost:8000/v1';

    const modelName = isOllama
      ? resolveStepModelFromGuiConfig(options.stepName, isDeepCouncilStep, options.runtimeConfig)
      : options.runtimeConfig.openAiModel ||
        serverGuiRuntimeConfig.openAiModel ||
        process.env.OPENAI_COMPATIBLE_MODEL ||
        'gpt-4o';

    const customTimeoutSec =
      options.runtimeConfig.timeoutSeconds || serverGuiRuntimeConfig.timeoutSeconds;
    const stepTimeoutMs = localStepTimeoutMs(options.stepName, customTimeoutSec, isDeepCouncilStep);

    // Build candidate endpoints so Docker containers automatically resolve host.docker.internal or bundled ollama service
    const candidateUrls = isOllama ? ollamaCandidateUrls(configuredBaseUrl) : [configuredBaseUrl];

    const wait = isOllama && isLongLocalStep(options.stepName) ? streamWaitFor(options.stepName, stepTimeoutMs) : undefined;
    const localTemperature = options.temperature ?? options.runtimeConfig.temperature ?? serverGuiRuntimeConfig.temperature ?? 0.2;
    for (const candidateUrl of candidateUrls) {
      const where = isOllama ? `Ollama ${modelName} at ${candidateUrl}` : `${modelName} at ${candidateUrl}`;
      if (wait) {
        // A quick check first, so a dead address or a model that is not downloaded fails in seconds.
        try {
          const tags = await fetch(`${candidateUrl.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(4000) });
          if (!tags.ok) throw new Error(`HTTP ${tags.status}`);
          if (!ollamaHasModel(await tags.json().catch(() => null), modelName)) {
            attempts.push({ where, notPulled: modelName });
            continue;
          }
        } catch (error) {
          attempts.push({ where, error: (error as Error)?.name === 'TimeoutError' ? new Error('fetch failed') : error });
          continue;
        }
      }
      try {
        const statsOut: { value?: ModelStats } = {};
        const rawText = await callOllamaOrOpenAICompatible(
          candidateUrl,
          modelName,
          options.systemInstruction,
          options.prompt,
          isOllama,
          stepTimeoutMs,
          schemaKeysHint,
          {
            temperature: localTemperature,
            seed: options.seed,
            // Long chat steps read every agent's document: with a short window Ollama drops the
            // start of the prompt (the instructions) without saying so.
            numCtx: Math.max(options.runtimeConfig.numCtx ?? serverGuiRuntimeConfig.numCtx ?? 8192, LONG_CHAT_STEPS.has(options.stepName) ? 16384 : 0),
            statsOut,
          },
          wait
        );
        const { parsed, schemaVerified } = sanitizeAndParseJson<T>(rawText, options.fallbackValue);
        if (schemaVerified) {
          return {
            data: parsed,
            latencyMs: Date.now() - startMs,
            retriesUsed,
            schemaVerified: true,
            usedFallback: false,
            providerUsed: isOllama
              ? `Local Ollama (${modelName} · ${isRefereeStep(options.stepName) ? 'Referee' : isDeepCouncilStep ? 'Phase 3 Deep' : 'Phase 1-2 Sub-Agents'})`
              : `OpenAI-Compatible (${modelName})`,
            model: modelName,
            temperature: localTemperature,
            ...(options.seed !== undefined ? { seed: options.seed } : {}),
            ...(statsOut.value ? { stats: statsOut.value } : {}),
          };
        }
        attempts.push({ where, notJson: true });
      } catch (error) {
        retriesUsed++;
        attempts.push({ where, error, timeoutMs: stepTimeoutMs });
      }
    }
  }

  // 2. Execute on Google Gemini with exponential backoff + jitter
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY') {
    const geminiName = geminiModel(options.runtimeConfig, process.env, isDeepCouncilStep);
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          retriesUsed++;
          const backoffMs = 350 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 180);
          await new Promise((r) => setTimeout(r, backoffMs));
        }
        const resp = await geminiClient().models.generateContent({
          model: geminiName,
          contents: `${options.systemInstruction}\n\n${options.prompt}`,
          config: {
            thinkingConfig: { thinkingLevel: options.thinkingLevel ?? ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: options.responseSchema,
            // Policy review steps run at temperature 0 so a rerun reads as close as the model allows.
            ...(options.stepName.startsWith('REVIEW_') ? { temperature: 0 } : {}),
            // Council chat answers too, with a fixed seed (src/utils/answerSnapshot.ts).
            ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
            ...(options.seed !== undefined ? { seed: options.seed } : {}),
          },
        });
        const { parsed, schemaVerified } = sanitizeAndParseJson<T>(
          resp.text ?? '{}',
          options.fallbackValue
        );
        if (schemaVerified) {
          return {
            data: parsed,
            latencyMs: Date.now() - startMs,
            retriesUsed,
            schemaVerified: true,
            usedFallback: false,
            providerUsed:
              options.providerMode === 'gemini'
                ? `Google Gemini (${geminiName})`
                : `Hybrid Failover -> Google Gemini (${geminiName})`,
            model: geminiName,
            ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
            ...(options.seed !== undefined ? { seed: options.seed } : {}),
          };
        }
        if (attempt === maxRetries) attempts.push({ where: 'Gemini', notJson: true });
      } catch (error) {
        // Continue to next retry attempt; the last error is the one reported.
        if (attempt === maxRetries) attempts.push({ where: 'Gemini', error });
      }
    }
  }

  const failure = describeFailures(attempts, Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'));
  console.warn(`[AI] ${options.stepName}: no model answered (${failure}).`);
  return {
    data: options.fallbackValue,
    latencyMs: Date.now() - startMs,
    retriesUsed,
    schemaVerified: true,
    usedFallback: true,
    providerUsed: 'Quantitative Anchor Deterministic Engine',
    failure,
  };
}
