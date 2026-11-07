import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GEMINI_MODEL, geminiModel } from '../src/utils/geminiModel';

test('Gemini model: GEMINI_MODEL wins, then the quick or deep setting, then the default', () => {
  assert.equal(geminiModel(undefined, {}), DEFAULT_GEMINI_MODEL);
  assert.equal(geminiModel({ geminiQuickModel: '  ' }, {}), DEFAULT_GEMINI_MODEL);
  assert.equal(geminiModel({ geminiQuickModel: 'q', geminiDeepModel: 'd' }, {}), 'q');
  assert.equal(geminiModel({ geminiQuickModel: 'q', geminiDeepModel: 'd' }, {}, true), 'd');
  assert.equal(geminiModel({ geminiQuickModel: 'q' }, { GEMINI_MODEL: 'gemini-next' }), 'gemini-next');
  assert.equal(geminiModel({ geminiQuickModel: 'q' }, { GEMINI_MODEL: ' ' }), 'q');
});
