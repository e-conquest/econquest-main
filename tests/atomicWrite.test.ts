import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeFileAtomic } from '../src/utils/atomicWrite';

test('writeFileAtomic creates the folder, writes the file and leaves no temporary file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-'));
  const file = path.join(dir, 'live', 'cache.json');
  writeFileAtomic(file, JSON.stringify({ a: 1 }));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 1 });
  writeFileAtomic(file, JSON.stringify({ a: 2 }));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 2 });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['cache.json']);
});

test('writeFileAtomic keeps the old file when the write fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-'));
  const file = path.join(dir, 'cache.json');
  writeFileAtomic(file, 'old');
  // A folder where the temporary file's target should be makes the rename fail.
  const blocked = path.join(dir, 'blocked');
  fs.mkdirSync(path.join(blocked, 'x'), { recursive: true });
  assert.throws(() => writeFileAtomic(blocked, 'new'));
  assert.equal(fs.readFileSync(file, 'utf8'), 'old');
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), []);
});
