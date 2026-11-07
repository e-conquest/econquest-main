import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { auditRows, canonicalJson, checkLog, describeRequest, figuresFromAnswers, GENESIS, nextEntry } from '../src/utils/auditLog';
import { appendAudit, auditFiles, readAudit, resetAuditCache } from '../src/utils/auditStore';

const tmpFiles = () => {
  resetAuditCache();
  return auditFiles(fs.mkdtempSync(path.join(os.tmpdir(), 'audit-')));
};

test('canonicalJson sorts keys at every level so equal entries hash the same', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}');
  assert.equal(canonicalJson({ a: undefined, b: 2 }), '{"b":2}');
});

test('entries chain from GENESIS and the check passes on an untouched log', () => {
  const a = nextEntry(null, { kind: 'research', summary: 'Saved a document in Reports' }, new Date('2026-11-05T20:00:00Z'));
  const b = nextEntry(a, { kind: 'settings', summary: 'Changed the watch alerts' }, new Date('2026-11-05T20:01:00Z'));
  assert.equal(a.seq, 1);
  assert.equal(a.prev, GENESIS);
  assert.equal(b.prev, a.hash);
  const { check, entries } = checkLog([JSON.stringify(a), JSON.stringify(b), '']);
  assert.equal(check.ok, true);
  assert.equal(entries.length, 2);
  assert.equal(check.lastHash, b.hash);
});

test('the check finds an edited, removed or cut-off line', () => {
  const files = tmpFiles();
  for (let i = 0; i < 4; i++) appendAudit(files, { kind: 'data', summary: `step ${i}` });
  assert.equal(readAudit(files).check.ok, true);
  const lines = fs.readFileSync(files.log, 'utf8').trim().split('\n');

  const edited = [...lines];
  edited[1] = edited[1].replace('step 1', 'step X');
  const e = checkLog(edited);
  assert.equal(e.check.ok, false);
  assert.equal(e.check.brokenAt, 2);
  assert.match(e.check.problem!, /changed after it was written/);
  assert.equal(e.entries.length, 1);

  const removed = [lines[0], lines[2], lines[3]];
  assert.match(checkLog(removed).check.problem!, /entry 2 is missing/);

  const cut = [...lines.slice(0, 3), lines[3].slice(0, 20)];
  assert.match(checkLog(cut).check.problem!, /not a readable entry/);

  // Removing lines from the end leaves a valid chain; the head file catches it.
  fs.writeFileSync(files.log, lines.slice(0, 2).join('\n') + '\n');
  const tail = readAudit(files);
  assert.equal(tail.check.ok, false);
  assert.match(tail.check.problem!, /removed from the end/);
});

test('appendAudit carries on the chain after a restart (cache cleared) and writes mode 600', () => {
  const files = tmpFiles();
  appendAudit(files, { kind: 'data', summary: 'one' });
  resetAuditCache();
  const two = appendAudit(files, { kind: 'data', summary: 'two' });
  assert.equal(two?.seq, 2);
  const { check } = readAudit(files);
  assert.equal(check.ok, true);
  assert.equal(check.entries, 2);
  if (process.platform !== 'win32') assert.equal(fs.statSync(files.log).mode & 0o777, 0o600);
});

test('appendAudit never throws when the log cannot be written', () => {
  resetAuditCache();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
  const blocker = path.join(dir, 'local');
  fs.writeFileSync(blocker, 'not a folder');
  assert.equal(appendAudit(auditFiles(dir), { kind: 'data', summary: 'x' }), null);
});

test('describeRequest names what a request did and never reads its body', () => {
  assert.equal(describeRequest('GET', '/api/research'), null);
  assert.equal(describeRequest('POST', '/api/council/synthesise'), null);
  assert.equal(describeRequest('POST', '/api/ai/ollama-status'), null);
  assert.deepEqual(describeRequest('GET', '/api/export/BRA/track-record.csv'), { kind: 'export', summary: 'Downloaded track record for BRA (CSV)', detail: { path: '/api/export/BRA/track-record.csv' } });
  const key = describeRequest('PUT', '/api/settings/keys/FRED_API_KEY');
  assert.equal(key?.kind, 'settings');
  assert.match(key!.summary, /value itself is not logged/);
  assert.equal(describeRequest('DELETE', '/api/research/briefs/abc')?.summary, 'Deleted a council conversation in Reports');
  assert.equal(describeRequest('POST', '/api/backup/restore')?.kind, 'settings');
  assert.equal(describeRequest('PUT', '/api/workspace/econquest.holdings.v1'), null);
});

test('figuresFromAnswers keeps each figure with its agent, country and source, and rows flatten for CSV', () => {
  const figures = figuresFromAnswers([
    {
      name: 'Central Bank Watcher',
      findings: [{ iso3: 'BRA', figures: [{ label: 'Policy rate', value: '13.75%', source: 'BIS policy rates, Oct 2026', tag: 'official' }] }],
    },
  ]);
  assert.deepEqual(figures, [{ iso3: 'BRA', agent: 'Central Bank Watcher', label: 'Policy rate', value: '13.75%', source: 'BIS policy rates, Oct 2026', tag: 'official' }]);
  const e = nextEntry(null, { kind: 'council', summary: 'Council answer: "Is Brazil tight?"', detail: { model: 'Ollama qwen2.5:7b', figures } });
  const [row] = auditRows([e]);
  assert.equal(row[3], '', 'no account while sign-in is off');
  assert.equal(row[5], 'Ollama qwen2.5:7b');
  assert.equal(row[6], 'BRA Policy rate 13.75% (BIS policy rates, Oct 2026)');
});

test('an entry names the signed-in account and still checks; entries without one keep their old hash', () => {
  const by = { id: 'a1', username: 'ana', name: 'Ana' };
  const a = nextEntry(null, { kind: 'research', summary: 'Saved a document in Reports' }, new Date('2026-11-06T05:00:00Z'));
  const b = nextEntry(a, { kind: 'research', summary: 'Saved a document in Reports', by }, new Date('2026-11-06T05:01:00Z'));
  assert.equal(a.by, undefined);
  assert.deepEqual(b.by, by);
  assert.equal(checkLog([JSON.stringify(a), JSON.stringify(b)]).check.ok, true);
  const forged = { ...b, by: { ...by, name: 'Sam' } };
  assert.equal(checkLog([JSON.stringify(a), JSON.stringify(forged)]).check.ok, false, 'changing who did it breaks the chain');
  assert.equal(auditRows([b])[0][3], 'Ana (ana)');
});
