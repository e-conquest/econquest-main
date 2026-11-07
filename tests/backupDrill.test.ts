import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBackup } from '../src/utils/backup.ts';
import { restoredDifferences, runBackupDrill, secretFieldsIn } from '../src/utils/backupDrill.ts';
import { addNotebook, EMPTY_LIBRARY } from '../src/utils/researchLibrary.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RULE = { id: 'r1', iso3: 'BRA', metric: 'policy_rate', op: '>=', value: 10, createdAt: '2026-11-05T00:00:00Z' } as const;

function drillBackup() {
  const lib = addNotebook(EMPTY_LIBRARY, 'Drill notebook', new Date('2026-11-05T10:00:00Z'))!.lib;
  return buildBackup(
    {
      research: lib,
      watchRules: [RULE],
      workspace: {
        'econquest.holdings.v1': '[{"iso3":"BRA","weight":1}]',
        econquest_ai_runtime_config_v1: JSON.stringify({ providerMode: 'ollama', integrationConfig: { apiKey: 'NEVER-IN-A-BACKUP' } }),
      },
    },
    new Date('2026-11-06T05:00:00Z')
  );
}

test('secretFieldsIn finds filled key fields at any depth, also inside JSON strings', () => {
  assert.deepEqual(secretFieldsIn({ a: { apiKey: 'x', token: '' }, b: '{"webhookHmacSecret":"s"}' }), ['$.a.apiKey', '$.b.webhookHmacSecret']);
  assert.deepEqual(secretFieldsIn({ providerMode: 'ollama' }), []);
});

test('restoredDifferences: same contents in any order is no difference; a missing alert is', () => {
  const b = drillBackup();
  assert.deepEqual(restoredDifferences(b, structuredClone(b)), []);
  const lost = structuredClone(b);
  lost.contents.watchRules = [];
  assert.match(restoredDifferences(b, lost).join(' '), /watch alerts: 1 in the file, 0 restored/);
});

test('drill: a backup restores into a fresh install through the real server, with no keys', { timeout: 120_000 }, async () => {
  const b = drillBackup();
  assert.ok(!JSON.stringify(b).includes('NEVER-IN-A-BACKUP'));
  const r = await runBackupDrill(JSON.stringify(b), ROOT);
  assert.ok(r.ok, r.steps.map((s) => `${s.ok ? 'OK' : 'FAIL'} ${s.text}`).join('\n'));
  assert.ok(r.steps.some((s) => s.text === 'Everything came back: 1 notebook, 1 watch alert, holdings and AI model settings.'));
});

test('drill: a file that carries a key fails the drill', { timeout: 120_000 }, async () => {
  const b = drillBackup() as unknown as { contents: { workspace: Record<string, string> } };
  b.contents.workspace['econquest_ai_runtime_config_v1'] = JSON.stringify({ providerMode: 'ollama', apiKey: 'LEAKED' });
  const r = await runBackupDrill(JSON.stringify(b), ROOT);
  assert.equal(r.ok, false);
  assert.ok(r.steps.some((s) => !s.ok && s.text.includes('key or secret fields')));
});
