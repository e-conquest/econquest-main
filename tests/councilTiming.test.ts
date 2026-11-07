import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, isCouncilTiming, ollamaStats, slowestStep, statsText, stepTiming, timingTable, tookLine, totalMs, writeSpeed, type CouncilTiming } from '../src/utils/councilTiming.ts';

test('durations read the way a person says them', () => {
  assert.equal(formatDuration(400), '0.4s');
  assert.equal(formatDuration(12_300), '12s');
  assert.equal(formatDuration(252_000), '4m 12s');
  assert.equal(formatDuration(3_780_000), '1h 3m');
  assert.equal(formatDuration(-1), 'unknown');
});

test("Ollama's nanosecond counters become milliseconds and tokens; nothing sent means none", () => {
  const s = ollamaStats({ done: true, load_duration: 12_000_000_000, prompt_eval_count: 5000, prompt_eval_duration: 40_000_000_000, eval_count: 900, eval_duration: 90_000_000_000 });
  assert.deepEqual(s, { loadMs: 12000, readMs: 40000, writeMs: 90000, promptTokens: 5000, outputTokens: 900 });
  assert.equal(writeSpeed(s), 10);
  assert.equal(statsText(s), 'loading the model 12s, reading 5000 tokens 40s, writing 900 tokens 1m 30s (10/s)');
  assert.equal(ollamaStats({ message: { content: '{}' } }), undefined);
  assert.equal(ollamaStats(null), undefined);
});

test('a step with no model answering keeps the reason and drops the model name', () => {
  assert.deepEqual(stepTiming('geo', 'Geo', { latencyMs: 16_100, usedFallback: true, failure: 'Ollama qwen2.5:7b took longer than 16 s' }), {
    id: 'geo',
    label: 'Geo',
    ms: 16_100,
    outcome: 'no_model',
    reason: 'Ollama qwen2.5:7b took longer than 16 s',
  });
  assert.equal(stepTiming('sov', 'Sov', null, 9000).ms, 9000);
});

const run: CouncilTiming = {
  version: 1,
  phase1Ms: 40_000,
  reviewMs: 95_000,
  supremeMs: 200_000,
  sentTogether: ['geo', 'sov', 'macro'],
  steps: [
    { id: 'data', label: 'Country data', ms: 1500, outcome: 'no_model_needed' },
    { id: 'geo', label: 'Geopolitical desk', ms: 30_000, outcome: 'model', model: 'qwen2.5:7b' },
    { id: 'sov', label: 'Sovereign credit desk', ms: 31_000, outcome: 'model', model: 'qwen2.5:7b' },
    { id: 'macro', label: 'Macro desk', ms: 16_000, outcome: 'no_model', reason: 'took longer than 16 s' },
    { id: 'search', label: 'Web search (Gemini)', ms: 0, outcome: 'skipped', reason: 'Needs a Gemini key' },
    { id: 'cascade', label: 'Cross-desk cascade', ms: 7000, outcome: 'model', model: 'qwen2.5:7b' },
    { id: 'supreme', label: 'Supreme council (referee)', ms: 199_000, outcome: 'model', model: 'qwen2.5:32b' },
  ],
};

test('the total leaves out your review pause and names the slowest step', () => {
  assert.equal(totalMs(run), 240_000);
  assert.equal(tookLine(run), 'Took 4m 0s (plus 1m 35s while you reviewed the desks)');
  assert.equal(slowestStep(run)?.id, 'supreme');
  assert.ok(isCouncilTiming(run));
  assert.ok(!isCouncilTiming({ version: 2 }));
});

test('the terminal table shows every step, the pause and the total, and marks steps sent together', () => {
  const t = timingTable(run);
  assert.match(t, /Geopolitical desk \*\s+30s\s+qwen2\.5:7b/);
  assert.match(t, /Macro desk \*\s+16s\s+no model answered\s+took longer than 16 s/);
  assert.match(t, /Web search \(Gemini\)\s+-\s+skipped\s+Needs a Gemini key/);
  assert.match(t, /Review pause \(not counted\)\s+1m 35s/);
  assert.match(t, /Total\s+4m 0s/);
  assert.match(t, /sent to the model at the same time/);
});
