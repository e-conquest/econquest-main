import test from 'node:test';
import assert from 'node:assert/strict';
import { describeAttempt, describeFailures, localStepTimeoutMs, LONG_CHAT_STEP_MIN_MS, ModelWaitError, ollamaHasModel, streamWaitFor } from '../src/utils/modelFailure.ts';

test('summary and debate steps give a local model at least two minutes', () => {
  assert.equal(localStepTimeoutMs('COUNCIL_SYNTHESIS', undefined, false), LONG_CHAT_STEP_MIN_MS);
  assert.equal(localStepTimeoutMs('COUNCIL_DEBATE', 20, false), LONG_CHAT_STEP_MIN_MS);
  assert.equal(localStepTimeoutMs('COUNCIL_SYNTHESIS', 300, false), 300_000);
  // Quick steps keep their old limits.
  assert.equal(localStepTimeoutMs('COUNCIL_CHOOSE_AGENTS', undefined, false), 16_000);
  assert.equal(localStepTimeoutMs('STAGE_3_SUPREME_COUNCIL', undefined, true), 120_000); // a referee on a large model
  // Desks and the cascade wait like the summary: a 7B model on a laptop needs more than 16 s.
  assert.equal(localStepTimeoutMs('STAGE_1_GEO_DESK', 40, false), LONG_CHAT_STEP_MIN_MS);
  assert.equal(localStepTimeoutMs('STAGE_1_GEO_DESK', 2, false), LONG_CHAT_STEP_MIN_MS);
  assert.equal(localStepTimeoutMs('STAGE_2_CONTAGION_CASCADE', 300, false), 300_000);
  assert.deepEqual(streamWaitFor('STAGE_1_MACRO_DESK', LONG_CHAT_STEP_MIN_MS), { firstTokenMs: LONG_CHAT_STEP_MIN_MS, idleMs: 60_000, totalMs: 300_000 });
});

test('each failed attempt is said in plain words', () => {
  const where = 'Ollama qwen2.5:7b at http://localhost:11434';
  const abort = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
  assert.equal(describeAttempt({ where, error: abort, timeoutMs: 16000 }), `${where} did not answer within 16 s`);
  const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  assert.equal(describeAttempt({ where, error: refused }), `${where} is not running`);
  assert.match(describeAttempt({ where, error: new Error('Model endpoint x failed with HTTP 404') }), /HTTP 404 \(is that model pulled/);
  assert.equal(describeAttempt({ where, error: new Error('Model endpoint x failed with HTTP 500') }), `${where} answered HTTP 500`);
  assert.equal(
    describeAttempt({ where, error: new Error('Model endpoint x failed with HTTP 500: model requires more system memory (21.5 GiB) than is available (17.2 GiB)') }),
    `${where} answered HTTP 500: "model requires more system memory (21.5 GiB) than is available (17.2 GiB)" (the computer is short of memory for this model: close other apps or check "ollama ps")`
  );
  assert.equal(
    describeAttempt({ where, error: new Error('Model endpoint x failed with HTTP 500: llama runner process has terminated: exit status 2') }),
    `${where} answered HTTP 500: "llama runner process has terminated: exit status 2"`
  );
  assert.match(
    describeAttempt({ where, error: new Error('Model endpoint x failed with HTTP 500: llama-server process has terminated: signal: killed') }),
    /killed while loading.*docker ps/
  );
  assert.equal(describeAttempt({ where, notJson: true }), `${where} answered, but not in the format the app needs`);
  assert.equal(describeAttempt({ where: 'Gemini', error: new Error('API key not valid') }), 'Gemini failed (API key not valid)');
});

test('the Docker fallback addresses are left out when the main one says more', () => {
  const notFound = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const reason = describeFailures(
    [
      { where: 'Ollama gemma4:31b at http://localhost:11434', error: abort, timeoutMs: 120000 },
      { where: 'Ollama gemma4:31b at http://host.docker.internal:11434', error: notFound },
      { where: 'Ollama gemma4:31b at http://ollama:11434', error: notFound },
    ],
    false
  );
  assert.equal(reason, 'Ollama gemma4:31b at http://localhost:11434 did not answer within 120 s; no Gemini key is set');
  assert.equal(describeFailures([], false), 'no Gemini key is set');
  assert.equal(describeFailures([], true), 'no model is set up');
});

test('inside Docker, the localhost line is dropped once the host address was reached', () => {
  const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  const reason = describeFailures(
    [
      { where: 'Ollama qwen2.5:7b at http://localhost:11434', error: refused },
      { where: 'Ollama qwen2.5:7b at http://host.docker.internal:11434', error: new ModelWaitError('first', 120000) },
    ],
    true
  );
  assert.match(reason, /^Ollama qwen2.5:7b at http:\/\/host.docker.internal:11434 is running but wrote nothing within 120 s/);
  assert.doesNotMatch(reason, /localhost/);
});

test('streaming waits: long chat steps wait on silence, quick steps keep one limit', () => {
  assert.deepEqual(streamWaitFor('COUNCIL_SYNTHESIS', 120000), { firstTokenMs: 120000, idleMs: 60000, totalMs: 300000 });
  assert.deepEqual(streamWaitFor('COUNCIL_CHOOSE_AGENTS', 16000), { firstTokenMs: 16000, idleMs: 16000, totalMs: 16000 });
  assert.match(describeAttempt({ where: 'X', error: new ModelWaitError('idle', 60000) }), /stopped writing for 60 s/);
  assert.match(describeAttempt({ where: 'X', error: new ModelWaitError('total', 300000) }), /still writing after 300 s/);
  assert.match(describeAttempt({ where: 'X', notPulled: 'qwen2.5:7b' }), /ollama pull qwen2.5:7b/);
});

test('ollamaHasModel reads the /api/tags list', () => {
  const tags = { models: [{ name: 'qwen2.5:7b' }, { name: 'llama3:latest' }] };
  assert.equal(ollamaHasModel(tags, 'qwen2.5:7b'), true);
  assert.equal(ollamaHasModel(tags, 'llama3'), true);
  assert.equal(ollamaHasModel(tags, 'gemma4:31b'), false);
  assert.equal(ollamaHasModel(null, 'gemma4:31b'), true);
});

test('a local model is told the allowed values and which keys are lists', async () => {
  const { schemaKeyHints } = await import('../src/server/ai.ts');
  assert.deepEqual(
    schemaKeyHints({
      decisionVerdict: { type: 'STRING', enum: ['EXECUTE_TRADES', 'DEFENSIVE_HEDGE', 'HOLD_AND_MONITOR'] },
      structuralVulnerabilities: { type: 'ARRAY', items: { type: 'STRING' } },
      options: { type: 'ARRAY', items: { type: 'OBJECT' } },
      executiveSummary: { type: 'STRING' },
    }),
    [
      'decisionVerdict (exactly one of: EXECUTE_TRADES, DEFENSIVE_HEDGE, HOLD_AND_MONITOR)',
      'structuralVulnerabilities (a JSON list of strings)',
      'options (a JSON list of objects)',
      'executiveSummary',
    ]
  );
});
