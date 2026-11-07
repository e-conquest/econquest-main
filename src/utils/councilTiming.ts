/**
 * How long a full council report took, step by step: the data pull, the three desk steps (nine
 * agents, three per desk, sent at the same time), the web search, the cascade, and the supreme
 * council (the referee model). Measured by the server on the run itself, never estimated.
 *
 * Your review of the desk results between the two phases is a pause, not model time: it is shown
 * apart and left out of the total.
 */

/** What Ollama says about one answer (its own counters; Gemini sends none). */
export interface ModelStats {
  /** Loading the model into memory (0 when it was already loaded). */
  loadMs?: number;
  /** Reading the prompt. */
  readMs?: number;
  /** Writing the answer. */
  writeMs?: number;
  promptTokens?: number;
  outputTokens?: number;
}

export type StepOutcome = 'model' | 'no_model' | 'skipped' | 'no_model_needed';

export interface StepTiming {
  id: string;
  label: string;
  ms: number;
  outcome: StepOutcome;
  model?: string;
  /** Why no model answered, or why the step was skipped. */
  reason?: string;
  stats?: ModelStats;
}

export interface CouncilTiming {
  version: 1;
  /** Phase 1 (data, desks, search, cascade) from request to reply. */
  phase1Ms: number;
  /** Time between the desk results and your approval. Not model time. */
  reviewMs?: number;
  /** Phase 2 (supreme council) from request to reply. */
  supremeMs?: number;
  steps: StepTiming[];
  /** Step ids that were sent at the same time. */
  sentTogether: string[];
}

/** Converts Ollama's nanosecond counters; undefined when it sent none. */
export function ollamaStats(msg: unknown): ModelStats | undefined {
  if (!msg || typeof msg !== 'object') return undefined;
  const m = msg as Record<string, unknown>;
  const ms = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v / 1e6) : undefined);
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);
  const out: ModelStats = {
    loadMs: ms(m.load_duration),
    readMs: ms(m.prompt_eval_duration),
    writeMs: ms(m.eval_duration),
    promptTokens: n(m.prompt_eval_count),
    outputTokens: n(m.eval_count),
  };
  for (const k of Object.keys(out) as (keyof ModelStats)[]) if (out[k] === undefined) delete out[k];
  return Object.keys(out).length ? out : undefined;
}

/** One step from what executeResilientLlmStep returned. */
export function stepTiming(
  id: string,
  label: string,
  r: { latencyMs: number; usedFallback: boolean; model?: string; failure?: string; stats?: ModelStats } | null | undefined,
  fallbackMs = 0
): StepTiming {
  if (!r) return { id, label, ms: fallbackMs, outcome: 'no_model', reason: 'the step failed' };
  return {
    id,
    label,
    ms: r.latencyMs,
    outcome: r.usedFallback ? 'no_model' : 'model',
    ...(r.model && !r.usedFallback ? { model: r.model } : {}),
    ...(r.usedFallback && r.failure ? { reason: r.failure } : {}),
    ...(r.stats && !r.usedFallback ? { stats: r.stats } : {}),
  };
}

/** "0.4s", "12s", "4m 12s", "1h 3m". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Model and data time for the whole report, without your review pause. */
export function totalMs(t: CouncilTiming): number {
  return t.phase1Ms + (t.supremeMs ?? 0);
}

/** The step that took longest. */
export function slowestStep(t: CouncilTiming): StepTiming | null {
  return t.steps.reduce<StepTiming | null>((a, s) => (s.outcome === 'skipped' ? a : !a || s.ms > a.ms ? s : a), null);
}

/** Words written per second, from Ollama's own counters. */
export function writeSpeed(stats?: ModelStats): number | null {
  if (!stats?.outputTokens || !stats.writeMs) return null;
  return Math.round((stats.outputTokens / (stats.writeMs / 1000)) * 10) / 10;
}

/** "Took 4m 12s", plus the review pause when there was one. */
export function tookLine(t: CouncilTiming): string {
  const review = t.reviewMs !== undefined && t.reviewMs >= 1000 ? ` (plus ${formatDuration(t.reviewMs)} while you reviewed the desks)` : '';
  return `Took ${formatDuration(totalMs(t))}${review}`;
}

/** Where the time went in one step, in plain words, from Ollama's counters. */
export function statsText(stats?: ModelStats): string {
  if (!stats) return '';
  const parts: string[] = [];
  if (stats.loadMs !== undefined && stats.loadMs >= 1000) parts.push(`loading the model ${formatDuration(stats.loadMs)}`);
  if (stats.readMs !== undefined) parts.push(`reading ${stats.promptTokens ?? '?'} tokens ${formatDuration(stats.readMs)}`);
  if (stats.writeMs !== undefined) {
    const speed = writeSpeed(stats);
    parts.push(`writing ${stats.outputTokens ?? '?'} tokens ${formatDuration(stats.writeMs)}${speed ? ` (${speed}/s)` : ''}`);
  }
  return parts.join(', ');
}

const OUTCOME: Record<StepOutcome, string> = {
  model: 'answered',
  no_model: 'no model answered',
  skipped: 'skipped',
  no_model_needed: 'no model',
};

/** Plain-text table for the terminal (npm run council:time) and the server log. */
export function timingTable(t: CouncilTiming): string {
  const rows = t.steps.map((s) => [
    s.label + (t.sentTogether.includes(s.id) ? ' *' : ''),
    s.outcome === 'skipped' ? '-' : formatDuration(s.ms),
    s.model || OUTCOME[s.outcome],
    s.outcome === 'model' ? statsText(s.stats) : s.reason || '',
  ]);
  rows.push(['Review pause (not counted)', t.reviewMs !== undefined ? formatDuration(t.reviewMs) : '-', '', '']);
  rows.push(['Total', formatDuration(totalMs(t)), '', '']);
  const head = ['Step', 'Took', 'Model', 'Where the time went'];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(w[i]))).join('  ').trimEnd();
  const out = [line(head), w.map((n, i) => (i === w.length - 1 ? '-'.repeat(Math.min(n, 40)) : '-'.repeat(n))).join('  '), ...rows.map(line)];
  if (t.sentTogether.length) out.push('', '* sent to the model at the same time; the slowest of them sets the pace.');
  return out.join('\n');
}

/** Checks a timing record read back from a saved run or the timing log. */
export function isCouncilTiming(v: unknown): v is CouncilTiming {
  const t = v as CouncilTiming;
  return Boolean(t && t.version === 1 && typeof t.phase1Ms === 'number' && Array.isArray(t.steps) && t.steps.every((s) => typeof s?.id === 'string' && typeof s.ms === 'number'));
}
