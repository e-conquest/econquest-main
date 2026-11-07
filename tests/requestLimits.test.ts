import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csrfMatches, csrfToken, isAiCall, RateLimiter } from '../src/utils/requestLimits';

test('CSRF token belongs to one session', () => {
  const t = csrfToken('abc');
  assert.equal(csrfMatches(t, 'abc'), true);
  assert.equal(csrfMatches(t, 'abd'), false);
  assert.equal(csrfMatches('', 'abc'), false);
  assert.equal(csrfMatches(undefined, 'abc'), false);
});

test('AI calls are the council and model tests, writes only', () => {
  assert.equal(isAiCall('POST', '/api/council/synthesise'), true);
  assert.equal(isAiCall('POST', '/api/ai/try-model'), true);
  assert.equal(isAiCall('GET', '/api/council/progress/1'), false);
  assert.equal(isAiCall('POST', '/api/research/briefs'), false);
});

test('rate limiter allows the burst, then refills per minute', () => {
  const l = new RateLimiter();
  const b = { burst: 3, perMinute: 6 };
  const t = 1_000_000;
  assert.equal(l.take('k', b, t), 0);
  assert.equal(l.take('k', b, t), 0);
  assert.equal(l.take('k', b, t), 0);
  assert.equal(l.take('k', b, t), 10, 'one token back after 10 s at 6 per minute');
  assert.equal(l.take('other', b, t), 0, 'separate keys');
  assert.equal(l.take('k', b, t + 10_000), 0);
});
