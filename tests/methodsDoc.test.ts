import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { methodsFromRepo } from '../src/utils/methodsDocNode.ts';
import { MODEL_REGISTER } from '../src/data/modelRegister.ts';
import { VERDICT_FOLDER, type RecordedVerdict } from '../src/utils/methodsDoc.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

test('docs/METHODS.md is up to date (run npm run docs:methods after changing the register, a test file or a verdict)', () => {
  assert.equal(readFileSync(new URL('../docs/METHODS.md', import.meta.url), 'utf8'), methodsFromRepo(root));
});

test('every register entry has a methods note and every recorded verdict names a registered test', () => {
  const md = methodsFromRepo(root);
  for (const e of MODEL_REGISTER) assert.ok(md.includes(`### ${e.name}`), e.id);
  const recorded = JSON.parse(readFileSync(new URL('../docs/validation/recorded-verdicts.json', import.meta.url), 'utf8')).verdicts;
  const ids = new Set(MODEL_REGISTER.map((e) => e.id));
  for (const v of recorded as RecordedVerdict[]) {
    const folder = VERDICT_FOLDER[v.kind ?? 'backtest'];
    const manifest = JSON.parse(readFileSync(new URL(`../docs/validation/${folder}/manifest.json`, import.meta.url), 'utf8')).files;
    const file = v.version === 1 ? `${v.id}.json` : `${v.id}.v${v.version}.json`;
    assert.ok(manifest[file], `recorded verdict ${v.id} v${v.version} has no pre-registered test file in ${folder}/`);
    assert.ok(ids.has(v.registerId ?? v.id), `recorded verdict ${v.id} names no register entry`);
  }
});
