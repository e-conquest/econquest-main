import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  applyKeysToEnv,
  describeKeys,
  effectiveKeys,
  envKeySnapshot,
  isLocalRequest,
  keySources,
  loadSettings,
  maskKey,
  saveSettings,
  settingsFilePath,
  withKey,
  withoutKey,
} from '../src/utils/userSettings.ts';

const GOOD = 'abcdef0123456789abcdef0123456789';

test('a FRED key must be 32 lower-case letters and digits', () => {
  assert.ok('error' in withKey({ apiKeys: {} }, 'FRED_API_KEY', 'short'));
  assert.ok('error' in withKey({ apiKeys: {} }, 'FRED_API_KEY', GOOD.toUpperCase()));
  assert.ok('error' in withKey({ apiKeys: {} }, 'FRED_API_KEY', ''));
  assert.ok('error' in withKey({ apiKeys: {} }, 'NOT_A_KEY', GOOD));
  const ok = withKey({ apiKeys: {} }, 'FRED_API_KEY', `  ${GOOD}\n`);
  assert.ok('settings' in ok);
  assert.equal(ok.settings.apiKeys.FRED_API_KEY, GOOD);
});

test('a key saved in the app wins over .env, and removing it goes back to .env', () => {
  const envFile = { FRED_API_KEY: 'fromenv' };
  const saved = { apiKeys: { FRED_API_KEY: GOOD } };
  assert.equal(effectiveKeys(envFile, saved).FRED_API_KEY, GOOD);
  assert.equal(keySources(envFile, saved).FRED_API_KEY, 'app');
  const env: Record<string, string | undefined> = { ...envFile };
  applyKeysToEnv(env, envFile, saved);
  assert.equal(env.FRED_API_KEY, GOOD);
  applyKeysToEnv(env, envFile, withoutKey(saved, 'FRED_API_KEY'));
  assert.equal(env.FRED_API_KEY, 'fromenv');
  applyKeysToEnv(env, {}, { apiKeys: {} });
  assert.equal(env.FRED_API_KEY, undefined);
  assert.equal(keySources({}, { apiKeys: {} }).FRED_API_KEY, 'none');
});

test('the browser only ever sees the last four characters', () => {
  assert.equal(maskKey(GOOD), '••••6789');
  assert.equal(maskKey('short'), '••••');
  assert.equal(maskKey(''), '');
  const [fred] = describeKeys({ FRED_API_KEY: 'x' }, { apiKeys: { FRED_API_KEY: GOOD } });
  assert.equal(fred.source, 'app');
  assert.equal(fred.masked, '••••6789');
  assert.equal(fred.envAlsoSet, true);
  assert.ok(!JSON.stringify(fred).includes(GOOD));
});

test('settings file: saved readable by this user only, broken or missing reads as empty', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'econquest-settings-'));
  try {
    const file = settingsFilePath(dir);
    assert.deepEqual(loadSettings(file), { apiKeys: {} });
    saveSettings(file, { apiKeys: { FRED_API_KEY: GOOD } });
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(loadSettings(file).apiKeys.FRED_API_KEY, GOOD);
    assert.match(readFileSync(file, 'utf8'), /FRED_API_KEY/);
    writeFileSync(file, '{not json');
    assert.deepEqual(loadSettings(file), { apiKeys: {} });
    writeFileSync(file, JSON.stringify({ apiKeys: { FRED_API_KEY: GOOD, SOMETHING_ELSE: 'x' } }));
    assert.deepEqual(loadSettings(file).apiKeys, { FRED_API_KEY: GOOD });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('keys can be changed only from this computer unless SETTINGS_ALLOW_REMOTE is true', () => {
  assert.ok(isLocalRequest('127.0.0.1', {}));
  assert.ok(isLocalRequest('::1', {}));
  assert.ok(isLocalRequest('::ffff:127.0.0.1', {}));
  assert.ok(!isLocalRequest('192.168.1.20', {}));
  assert.ok(!isLocalRequest(undefined, {}));
  assert.ok(isLocalRequest('172.17.0.1', { SETTINGS_ALLOW_REMOTE: 'true' }));
});

test('the .env snapshot keeps only the known keys', () => {
  const snap = envKeySnapshot({ FRED_API_KEY: 'a', PATH: '/bin' });
  assert.equal(snap.FRED_API_KEY, 'a');
  assert.ok(!('PATH' in snap));
  for (const id of ['COMTRADE_API_KEY', 'EIA_API_KEY', 'EVDS_API_KEY', 'EVDS_TR10Y_SERIES', 'FRED_API_KEY', 'CDS_FEED', 'LSEG_PASSWORD']) assert.ok(id in snap, id);
});

test('EIA, Comtrade and EVDS: keys checked loosely, the series code shown in full', () => {
  assert.ok('error' in withKey({ apiKeys: {} }, 'EIA_API_KEY', 'has spaces in it ok'));
  assert.ok('settings' in withKey({ apiKeys: {} }, 'EIA_API_KEY', 'A'.repeat(40)));
  assert.ok('settings' in withKey({ apiKeys: {} }, 'COMTRADE_API_KEY', 'abcdef0123456789abcdef0123456789'));
  assert.ok('settings' in withKey({ apiKeys: {} }, 'EVDS_API_KEY', 'AbC123xyz'));
  assert.ok('error' in withKey({ apiKeys: {} }, 'EVDS_TR10Y_SERIES', 'not-a-code'));
  const ok = withKey({ apiKeys: {} }, 'EVDS_TR10Y_SERIES', 'TP.ABC.D10');
  assert.ok('settings' in ok);
  const series = describeKeys({}, ok.settings).find((k) => k.id === 'EVDS_TR10Y_SERIES')!;
  assert.equal(series.secret, false);
  assert.equal(series.masked, 'TP.ABC.D10');
  const evdsKey = describeKeys({}, { apiKeys: { EVDS_API_KEY: 'AbC123xyz0' } }).find((k) => k.id === 'EVDS_API_KEY')!;
  assert.equal(evdsKey.secret, true);
  assert.equal(evdsKey.masked, '••••xyz0');
});

test('own paid CDS data: a pick-one source, a full file path, LSEG password kept secret', () => {
  const base = { apiKeys: {} };
  assert.ok('error' in withKey(base, 'CDS_FEED', 'bloomberg'));
  assert.ok('settings' in withKey(base, 'CDS_FEED', 'off'));
  assert.ok('error' in withKey(base, 'CDS_CSV_PATH', 'cds.csv'));
  assert.ok('settings' in withKey(base, 'CDS_CSV_PATH', '/Users/sam/cds.csv'));
  assert.ok('settings' in withKey(base, 'CDS_CSV_PATH', 'C:\\data\\cds.csv'));
  assert.ok('error' in withKey(base, 'LSEG_CDS_RICS', 'nonsense'));
  assert.ok('settings' in withKey(base, 'LSEG_CDS_RICS', 'BRA=ABC,TUR=DEF'));
  const keys = describeKeys({}, { apiKeys: { CDS_FEED: 'lseg', LSEG_PASSWORD: 'hunter22secret' } });
  const feed = keys.find((k) => k.id === 'CDS_FEED')!;
  assert.equal(feed.section, 'own_account');
  assert.deepEqual(feed.choices!.map((c) => c.value), ['off', 'csv', 'lseg']);
  assert.equal(feed.masked, 'lseg');
  const pw = keys.find((k) => k.id === 'LSEG_PASSWORD')!;
  assert.equal(pw.secret, true);
  assert.ok(!JSON.stringify(keys).includes('hunter22secret'));
  assert.equal(keys.find((k) => k.id === 'FRED_API_KEY')!.section, 'free_key');
});

test('Gemini key: listed under AI model, masked, loosely checked', () => {
  assert.ok('error' in withKey({ apiKeys: {} }, 'GEMINI_API_KEY', 'short'));
  const ok = withKey({ apiKeys: {} }, 'GEMINI_API_KEY', 'AIzaSyA1234567890abcdefGHIJKLmnop_-xyz');
  assert.ok('settings' in ok);
  const g = describeKeys({}, ok.settings).find((k) => k.id === 'GEMINI_API_KEY')!;
  assert.equal(g.section, 'ai');
  assert.equal(g.checkId, 'gemini');
  assert.equal(g.masked, '••••-xyz');
});
