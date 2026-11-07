import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { codeHash } from '../src/utils/codeHash.ts';

test('codeHash changes when any file under src/ or server.ts changes, and is null without server.ts', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codehash-'));
  assert.equal(codeHash(root), null);
  writeFileSync(path.join(root, 'server.ts'), 'a');
  mkdirSync(path.join(root, 'src', 'utils'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'utils', 'x.ts'), 'one');
  const first = codeHash(root);
  assert.match(first!, /^[0-9a-f]{16}$/);
  assert.equal(codeHash(root), first);
  writeFileSync(path.join(root, 'src', 'utils', 'x.ts'), 'two');
  assert.notEqual(codeHash(root), first);
});
