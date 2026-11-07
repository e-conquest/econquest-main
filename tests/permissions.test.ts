import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refusal, requiredRole, roleAtLeast } from '../src/utils/permissions';

test('admin-only: keys, users, backup, audit log, connectors, AI settings, webhooks, alerts', () => {
  for (const [m, p] of [
    ['PUT', '/api/settings/keys/FRED_API_KEY'],
    ['DELETE', '/api/settings/keys/FRED_API_KEY'],
    ['GET', '/api/users'],
    ['POST', '/api/users'],
    ['GET', '/api/backup/download'],
    ['POST', '/api/backup/restore'],
    ['GET', '/api/audit'],
    ['GET', '/api/audit/export.csv'],
    ['POST', '/api/connectors/ping-and-inspect'],
    ['POST', '/api/ai/runtime-config-save'],
    ['POST', '/api/ai/ollama-pull'],
    ['POST', '/api/council/webhook-dispatch'],
    ['PUT', '/api/morning-brief'],
    ['PUT', '/api/watch-rules'],
  ]) assert.equal(requiredRole(m, p), 'admin', `${m} ${p}`);
});

test('analyst: council, saved research, reviews, sign-offs, data refresh; and reading masked keys', () => {
  for (const [m, p] of [
    ['POST', '/api/council/synthesise'],
    ['POST', '/api/research/briefs'],
    ['DELETE', '/api/research/docs/abc'],
    ['POST', '/api/reviews'],
    ['POST', '/api/signoffs/brief/x'],
    ['POST', '/api/data/refresh'],
    ['GET', '/api/settings/keys'],
    ['POST', '/api/some-new-route'],
  ]) assert.equal(requiredRole(m, p), 'analyst', `${m} ${p}`);
});

test('viewer: reads, own sign-in and own workspace only', () => {
  for (const [m, p] of [
    ['GET', '/api/data/sovereign-snapshot'],
    ['GET', '/api/research'],
    ['GET', '/'],
    ['POST', '/api/auth/password'],
    ['POST', '/api/auth/sign-out'],
    ['PUT', '/api/workspace/sovereign_council_watchlists_v1'],
  ]) assert.equal(requiredRole(m, p), 'viewer', `${m} ${p}`);
});

test('role order and refusal wording', () => {
  assert.equal(roleAtLeast('admin', 'analyst'), true);
  assert.equal(roleAtLeast('analyst', 'admin'), false);
  assert.equal(roleAtLeast('viewer', 'viewer'), true);
  assert.equal(refusal('viewer', 'analyst'), 'Your account is a Viewer. Only an Analyst or Admin can do this; ask your admin.');
  assert.equal(refusal('analyst', 'admin'), 'Your account is an Analyst. Only an Admin can do this; ask your admin.');
});
