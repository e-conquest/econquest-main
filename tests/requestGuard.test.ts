import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostAllowed, hostName, outboundUrlProblem, withoutSecrets, writeAllowed } from '../src/utils/requestGuard';

test('hostName strips the port and keeps IPv6 brackets', () => {
  assert.equal(hostName('LocalHost:3000'), 'localhost');
  assert.equal(hostName('[::1]:3737'), '[::1]');
  assert.equal(hostName(undefined), '');
});

test('hostAllowed: localhost names pass, other names are refused unless opened on purpose', () => {
  for (const h of ['localhost:3000', '127.0.0.1:3737', '[::1]:3000', 'app.localhost:3000']) assert.equal(hostAllowed(h, {}), true, h);
  assert.equal(hostAllowed('evil.example:3000', {}), false);
  assert.equal(hostAllowed(undefined, {}), false);
  assert.equal(hostAllowed('my-mac.local:3000', { ALLOWED_HOSTS: 'my-mac.local' }), true);
  assert.equal(hostAllowed('evil.example', { ALLOWED_HOSTS: 'my-mac.local' }), false);
  // Opened to the network on purpose without a list: any name, as before.
  assert.equal(hostAllowed('192.168.1.20:3000', { HOST: '0.0.0.0' }), true);
  assert.equal(hostAllowed('evil.example', { HOST: '0.0.0.0', ALLOWED_HOSTS: '192.168.1.20' }), false);
  assert.equal(hostAllowed('evil.example', { HOST: '127.0.0.1' }), false);
});

test('writeAllowed refuses changes sent from another site', () => {
  assert.equal(writeAllowed('GET', { origin: 'https://evil.example', host: 'localhost:3000' }), true);
  assert.equal(writeAllowed('POST', { origin: 'http://localhost:3000', host: 'localhost:3000' }), true);
  assert.equal(writeAllowed('POST', { host: 'localhost:3000' }), true);
  assert.equal(writeAllowed('PUT', { origin: 'https://evil.example', host: 'localhost:3000' }), false);
  assert.equal(writeAllowed('DELETE', { origin: 'null', host: 'localhost:3000' }), false);
  assert.equal(writeAllowed('POST', { 'sec-fetch-site': 'cross-site', host: 'localhost:3000' }), false);
});

test('outboundUrlProblem blocks the app itself and metadata addresses, keeps internal hosts', () => {
  assert.match(outboundUrlProblem('http://127.0.0.1:3000/api/settings/keys', 3000) || '', /itself/);
  assert.match(outboundUrlProblem('http://localhost:3000/x', '3000') || '', /itself/);
  assert.match(outboundUrlProblem('http://169.254.169.254/latest/meta-data', 3000) || '', /metadata/);
  assert.match(outboundUrlProblem('file:///etc/passwd', 3000) || '', /http/);
  assert.match(outboundUrlProblem('not a url', 3000) || '', /valid/);
  assert.equal(outboundUrlProblem('http://localhost:11434/api/tags', 3000), null);
  assert.equal(outboundUrlProblem('http://10.0.0.5:8080/risk', 3000), null);
  assert.equal(outboundUrlProblem('https://hooks.example.com/x', 3000), null);
});

test('withoutSecrets drops the integration key and webhook secret', () => {
  const out = withoutSecrets({ a: 1, integrationConfig: { apiKey: 'k', webhookHmacSecret: 's', requireApiKey: false } });
  assert.deepEqual(out.integrationConfig, { requireApiKey: false, apiKeySet: true, webhookSecretSet: true });
});
