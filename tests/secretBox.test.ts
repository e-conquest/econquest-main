import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { makeSecretBox, secretBoxFromEnv } from '../src/utils/secretBox';
import { loadSettings, saveSettings } from '../src/utils/userSettings';

const SECRET = 'x'.repeat(16) + 'correct-horse-battery-staple';

test('AES-GCM round trip; a wrong key or a changed byte does not open', () => {
  const box = makeSecretBox(SECRET, 'test');
  const sealed = box.encrypt('my-fred-key');
  assert.match(sealed, /^enc:v1:/);
  assert.ok(!sealed.includes('my-fred-key'));
  assert.notEqual(sealed, box.encrypt('my-fred-key'), 'fresh IV each time');
  assert.equal(box.decrypt(sealed), 'my-fred-key');
  assert.equal(makeSecretBox(SECRET + '!', 'other').decrypt(sealed), null);
  const parts = sealed.split(':');
  parts[4] = Buffer.from('tampered').toString('base64');
  assert.equal(box.decrypt(parts.join(':')), null);
});

test('master key from env, a key file, or the Docker secret; too short is a stated problem', () => {
  assert.deepEqual(secretBoxFromEnv({}, () => null), { box: null, problem: null });
  assert.equal(secretBoxFromEnv({ ECONQUEST_SECRET_KEY: SECRET }, () => null).box?.source, 'ECONQUEST_SECRET_KEY');
  assert.match(secretBoxFromEnv({ ECONQUEST_SECRET_KEY: 'short' }, () => null).problem || '', /shorter than 32/);
  assert.equal(secretBoxFromEnv({ ECONQUEST_SECRET_KEY_FILE: '/k' }, (p) => (p === '/k' ? SECRET + '\n' : null)).box?.source, '/k');
  assert.match(secretBoxFromEnv({ ECONQUEST_SECRET_KEY_FILE: '/missing' }, () => null).problem || '', /cannot be read/);
  assert.equal(secretBoxFromEnv({}, (p) => (p === '/run/secrets/econquest_secret_key' ? SECRET : null)).box?.source, '/run/secrets/econquest_secret_key');
});

test('settings file: encrypted with a master key, plain without; unreadable keys are kept, not lost', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'settings-')), 'settings.json');
  const box = makeSecretBox(SECRET, 'test');
  saveSettings(file, { apiKeys: { FRED_API_KEY: 'abcdefabcdefabcdefabcdefabcdef12' } }, null);
  assert.equal(loadSettings(file, box).plainOnDisk, true, 'plain file still loads with a key set');
  saveSettings(file, loadSettings(file, box), box);
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('abcdefabcdef'), 'no plain key on disk');
  assert.equal(JSON.parse(raw).encrypted, 'aes-256-gcm');
  assert.equal(loadSettings(file, box).apiKeys.FRED_API_KEY, 'abcdefabcdefabcdefabcdefabcdef12');

  const noKey = loadSettings(file, null);
  assert.deepEqual(noKey.apiKeys, {});
  assert.deepEqual(noKey.unreadable, ['FRED_API_KEY']);
  // Saving another key while the master key is missing keeps the sealed one.
  saveSettings(file, { apiKeys: { EIA_API_KEY: 'eiaeiaeiaeiaeiaeiaeiaeiaeiaeiaei' } }, null);
  assert.equal(loadSettings(file, box).apiKeys.FRED_API_KEY, 'abcdefabcdefabcdefabcdefabcdef12');
});
