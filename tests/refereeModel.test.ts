import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRefereeStep, isSmallModel, largestModel, modelSizeB, smallRefereeNote } from '../src/utils/refereeModel.ts';

test('referee steps: Supreme Council, chat summary and explanations, debate; not agent picking or desks', () => {
  for (const s of ['STAGE_3_SUPREME_COUNCIL', 'COUNCIL_SYNTHESIS', 'COUNCIL_DEBATE', 'REVIEW_OPTIONS']) assert.ok(isRefereeStep(s), s);
  for (const s of ['COUNCIL_CHOOSE_AGENTS', 'STAGE_1_GEO_DESK', 'STAGE_2_CONTAGION_CASCADE', 'AI_MODEL_TEST']) assert.equal(isRefereeStep(s), false, s);
});

test('model size from the Ollama tag; 8B or less is small', () => {
  assert.equal(modelSizeB('gemma4:31b'), 31);
  assert.equal(modelSizeB('qwen2.5:7b'), 7);
  assert.equal(modelSizeB('deepseek-r1:8b'), 8);
  assert.equal(modelSizeB('qwen3:30b-a3b'), 30);
  assert.equal(modelSizeB('llama3.1'), null);
  assert.ok(isSmallModel('deepseek-r1:8b') && isSmallModel('qwen2.5:7b'));
  assert.equal(isSmallModel('gemma4:31b'), false);
  assert.equal(isSmallModel('mystery'), false); // unknown size is not flagged
  assert.equal(largestModel(['qwen2.5:7b', 'deepseek-r1:8b', 'gemma4:31b', 'qwen2.5:14b']), 'gemma4:31b');
  assert.equal(largestModel(['qwen2.5:7b']), undefined);
});

test('the note under an answer names a small referee and where to change it', () => {
  assert.match(smallRefereeNote('Local Ollama (qwen2.5:7b · Referee)')!, /qwen2.5:7b, a small model.*Menu > Settings > AI model/);
  assert.equal(smallRefereeNote('Local Ollama (gemma4:31b · Referee)'), null);
  assert.equal(smallRefereeNote('Gemini'), null);
});

test('default referee is qwen2.5:32b; the old 8B default moves to it, a chosen model stays', async () => {
  const { DEFAULT_REFEREE_MODEL, refereeModelOrDefault } = await import('../src/utils/refereeModel.ts');
  assert.equal(DEFAULT_REFEREE_MODEL, 'qwen2.5:32b');
  assert.equal(refereeModelOrDefault('deepseek-r1:8b'), 'qwen2.5:32b');
  assert.equal(refereeModelOrDefault('gemma4:31b'), 'gemma4:31b');
  assert.equal(refereeModelOrDefault(''), undefined);
});
