import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  archiveDay,
  archivedDayOnOrBefore,
  keepDaysFromEnv,
  listArchivedCountries,
  listArchivedDays,
  pruneArchive,
  readArchivedPull,
  writeArchivedPull,
} from '../src/utils/pullArchive.ts';

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'eq-archive-'));
}

const at = (iso: string) => Date.parse(iso);

test('each pull is kept by day and read back as saved', () => {
  const root = tmpRoot();
  writeArchivedPull(root, 'BRA', { snapshot: { debt: 77.7 }, pulledAt: at('2026-10-29T08:00:00Z'), schema: 2 });
  writeArchivedPull(root, 'BRA', { snapshot: { debt: 78.1 }, pulledAt: at('2026-11-05T08:00:00Z'), incomplete: true, schema: 2 });
  assert.deepEqual(listArchivedDays(root, 'BRA'), ['2026-10-29', '2026-11-05']);
  const old = readArchivedPull<{ debt: number }>(root, 'BRA', '2026-10-29');
  assert.equal(old?.snapshot.debt, 77.7);
  assert.equal(old?.date, '2026-10-29');
  assert.equal(readArchivedPull(root, 'BRA', '2026-11-05')?.incomplete, true);
  assert.ok(fs.existsSync(path.join(root, 'BRA', '2026-10-29.json.gz')));
});

test('a later pull the same day replaces that day, earlier days stay', () => {
  const root = tmpRoot();
  writeArchivedPull(root, 'mex', { snapshot: { v: 1 }, pulledAt: at('2026-11-05T08:00:00Z') });
  writeArchivedPull(root, 'MEX', { snapshot: { v: 2 }, pulledAt: at('2026-11-05T09:00:00Z') });
  assert.deepEqual(listArchivedDays(root, 'MEX'), ['2026-11-05']);
  assert.equal(readArchivedPull<{ v: number }>(root, 'MEX', '2026-11-05')?.snapshot.v, 2);
});

test('on-or-before finds the pull that stood on a date and never guesses before the archive starts', () => {
  const days = ['2026-10-01', '2026-10-08', '2026-10-15'];
  assert.equal(archivedDayOnOrBefore(days, '2026-10-10'), '2026-10-08');
  assert.equal(archivedDayOnOrBefore(days, '2026-10-15'), '2026-10-15');
  assert.equal(archivedDayOnOrBefore(days, '2026-12-01'), '2026-10-15');
  assert.equal(archivedDayOnOrBefore(days, '2026-09-30'), null);
  assert.equal(archivedDayOnOrBefore(days, 'not-a-date'), null);
});

test('nothing is pruned by default; a keep setting removes only older days', () => {
  const root = tmpRoot();
  for (const d of ['2026-01-01', '2026-10-01', '2026-11-01']) {
    writeArchivedPull(root, 'ZAF', { snapshot: {}, pulledAt: at(`${d}T00:00:00Z`) });
  }
  assert.equal(keepDaysFromEnv(undefined), 0);
  assert.equal(keepDaysFromEnv('abc'), 0);
  assert.equal(keepDaysFromEnv('-3'), 0);
  assert.equal(keepDaysFromEnv('90'), 90);
  const now = at('2026-11-05T00:00:00Z');
  assert.deepEqual(pruneArchive(root, 'ZAF', 0, now), []);
  assert.deepEqual(pruneArchive(root, 'ZAF', 90, now), ['2026-01-01']);
  assert.deepEqual(listArchivedDays(root, 'ZAF'), ['2026-10-01', '2026-11-01']);
});

test('missing folders, bad names and unreadable files read as empty, not errors', () => {
  const root = tmpRoot();
  assert.deepEqual(listArchivedDays(root, 'XXX'), []);
  assert.deepEqual(listArchivedCountries(path.join(root, 'nope')), []);
  assert.equal(readArchivedPull(root, 'BRA', '../../etc'), null);
  fs.mkdirSync(path.join(root, 'BRA'), { recursive: true });
  fs.writeFileSync(path.join(root, 'BRA', '2026-11-01.json.gz'), 'not gzip');
  assert.equal(readArchivedPull(root, 'BRA', '2026-11-01'), null);
  writeArchivedPull(root, 'EGY', { snapshot: {}, pulledAt: at('2026-11-02T00:00:00Z') });
  assert.deepEqual(listArchivedCountries(root), ['BRA', 'EGY']);
  assert.equal(writeArchivedPull(root, '', { snapshot: {}, pulledAt: 1 }), null);
  assert.equal(archiveDay(at('2026-11-05T23:59:00Z')), '2026-11-05');
});
