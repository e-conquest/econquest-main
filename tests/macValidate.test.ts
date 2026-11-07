import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clip, parseValidateArgs, redact, renderReport, secretValues, stripAnsi, VALIDATE_STEPS, type ValidateEnv } from '../src/utils/macValidate.ts';

const ids = (o: ReturnType<typeof parseValidateArgs>) => o.steps.map((s) => s.id);

test('steps run in a fixed order; --skip leaves steps out, --only picks them, unknown names are named', () => {
  assert.deepEqual(ids(parseValidateArgs([])), ['data', 'backtest', 'weo', 'forecast', 'signals', 'council']);
  assert.deepEqual(ids(parseValidateArgs(['--skip', 'council,backtest'])), ['data', 'weo', 'forecast', 'signals']);
  assert.deepEqual(ids(parseValidateArgs(['--only=signals,data'])), ['data', 'signals']);
  assert.deepEqual(ids(parseValidateArgs(['--only', 'data', '--skip', 'data'])), ['data']);
  assert.deepEqual(parseValidateArgs(['--skip', 'nope,data']).unknown, ['nope']);
  assert.ok(VALIDATE_STEPS.find((s) => s.id === 'council')!.needsApp);
});

test('keys never reach the report: secret-looking env values and saved keys are hidden', () => {
  const s = secretValues({ FRED_API_KEY: 'abcd1234efgh', ACLED_PASSWORD: 'hunter2hunter2', SHORT_KEY: 'abc', PATH: '/usr/bin:/bin' }, ['savedkey-0001']);
  assert.ok(s.includes('abcd1234efgh') && s.includes('hunter2hunter2') && s.includes('savedkey-0001'));
  assert.ok(!s.includes('abc') && !s.includes('/usr/bin:/bin'));
  assert.equal(redact('url?api_key=abcd1234efgh&x=1 savedkey-0001', s), 'url?api_key=[hidden]&x=1 [hidden]');
  assert.equal(stripAnsi('\u001b[32mPASS\u001b[0m done'), 'PASS done');
});

test('long output keeps its start and its end', () => {
  const t = `START${'x'.repeat(1000)}END`;
  const c = clip(t, 100);
  assert.ok(c.startsWith('START') && c.endsWith('END') && c.includes('characters cut'));
  assert.equal(clip('short', 100), 'short');
});

test('report: environment, one row per step, failures carry a hint, skipped steps say why', () => {
  const env: ValidateEnv = {
    ranAt: '2026-11-06T23:50:00.000Z',
    commit: '61d6e1f',
    dirty: [],
    node: 'v22.0.0',
    platform: 'darwin arm64',
    app: { url: 'http://127.0.0.1:3737', sameCode: false },
    ollama: { version: '0.40.5', models: ['qwen2.5:32b'] },
  };
  const md = renderReport(env, [
    { id: 'data', title: 'Data sources (check:data)', status: 'ok', code: 0, ms: 61_000, output: 'IMF OK' },
    { id: 'signals', title: 'Currency signal tests (signals:evaluate)', status: 'failed', code: 1, ms: 2_000, output: 'boom', hint: 'Uses the saved ECB history.' },
    { id: 'council', title: 'Council regression', status: 'skipped', ms: 0, reason: 'the app is not running', output: '' },
  ]);
  assert.match(md, /on commit 61d6e1f\. 1 ok, 1 failed, 1 skipped/);
  assert.match(md, /OLDER or different code than this folder/);
  assert.match(md, /version 0\.40\.5, 1 models: qwen2\.5:32b/);
  assert.match(md, /\| Data sources \(check:data\) \| ok \| 1m 01s \|/);
  assert.match(md, /\| Currency signal tests \(signals:evaluate\) \| FAILED \(exit 1\) \| 2s \|/);
  assert.match(md, /skipped: the app is not running/);
  assert.match(md, /Hint: Uses the saved ECB history\./);
  assert.ok(!md.includes('## Council regression'), 'no output section for a skipped step');
});
