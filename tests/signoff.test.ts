import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadSignOffs, recordFor, reportHash, saveSignOff, signOffView, takeStep, type SignOffRecord } from '../src/utils/signoff';

const brief = { id: 'b-1', question: 'Is Brazil policy tight?', askedAt: '2026-11-05T20:00:00Z', answers: [], savedAt: '2026-11-05T20:00:01Z' };
const ok = (r: ReturnType<typeof takeStep>) => {
  assert.ok(!('error' in r), 'error' in r ? r.error : '');
  return r as { record: SignOffRecord };
};

test('reportHash ignores when the report was saved, not what it says', () => {
  assert.equal(reportHash(brief), reportHash({ ...brief, savedAt: '2027-01-01T00:00:00Z' }));
  assert.notEqual(reportHash(brief), reportHash({ ...brief, question: 'Is Brazil policy loose?' }));
});

test('draft -> reviewed -> approved, with names; approval by the reviewer is marked self-approved', () => {
  const h = reportHash(brief);
  assert.equal(signOffView(undefined, h).status, 'draft');
  assert.match((takeStep(undefined, 'brief', 'b-1', h, { step: 'approved', by: 'Sam' }) as any).error, /reviewed first/);
  assert.match((takeStep(undefined, 'brief', 'b-1', h, { step: 'reviewed', by: '  ' }) as any).error, /name/);
  const r1 = ok(takeStep(undefined, 'brief', 'b-1', h, { step: 'reviewed', by: 'Sam' })).record;
  assert.equal(signOffView(r1, h).status, 'reviewed');
  const r2 = ok(takeStep(r1, 'brief', 'b-1', h, { step: 'approved', by: 'sam' })).record;
  const v = signOffView(r2, h);
  assert.equal(v.status, 'approved');
  assert.equal(v.selfApproved, true);
  const r3 = ok(takeStep(r1, 'brief', 'b-1', h, { step: 'approved', by: 'Second Reader' })).record;
  assert.equal(signOffView(r3, h).selfApproved, undefined);
});

test('a report changed after sign-off reads "changed" until reviewed again; withdraw returns it to draft', () => {
  const h = reportHash(brief);
  const r1 = ok(takeStep(undefined, 'brief', 'b-1', h, { step: 'reviewed', by: 'Sam' })).record;
  const r2 = ok(takeStep(r1, 'brief', 'b-1', h, { step: 'approved', by: 'Sam' })).record;
  const h2 = reportHash({ ...brief, question: 'Changed' });
  assert.equal(signOffView(r2, h2).status, 'changed');
  assert.match((takeStep(r2, 'brief', 'b-1', h2, { step: 'approved', by: 'Sam' }) as any).error, /reviewed first/);
  const r3 = ok(takeStep(r2, 'brief', 'b-1', h2, { step: 'reviewed', by: 'Sam' })).record;
  assert.equal(signOffView(r3, h2).status, 'reviewed');
  const r4 = ok(takeStep(r3, 'brief', 'b-1', h2, { step: 'withdrawn', by: 'Sam', note: 'needs the Q3 data' })).record;
  assert.equal(signOffView(r4, h2).status, 'draft');
  assert.equal(r4.history.length, 4);
  assert.match((takeStep(r4, 'brief', 'b-1', h2, { step: 'withdrawn', by: 'Sam' }) as any).error, /Nothing to withdraw/);
});

test('sign-offs are saved apart from the reports, mode 600', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'so-')), 'local', 'signoffs.json');
  const r = ok(takeStep(undefined, 'brief', 'b-1', reportHash(brief), { step: 'reviewed', by: 'Sam' })).record;
  saveSignOff(file, r);
  assert.deepEqual(recordFor(loadSignOffs(file), 'brief', 'b-1'), r);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('with accounts the name comes from the account and the reviewer cannot approve', () => {
  const h = 'h1';
  const ana = { id: 'acc-ana', displayName: 'Ana Analyst' };
  const sam = { id: 'acc-sam', displayName: 'Sam' };
  const r1 = takeStep(undefined, 'brief', 'b-9', h, { step: 'reviewed', by: 'Someone Else' }, new Date(), ana);
  assert.ok(!('error' in r1));
  const rec = (r1 as any).record as SignOffRecord;
  assert.equal(rec.history[0].by, 'Ana Analyst', 'typed name ignored');
  assert.equal(rec.history[0].byAccount, 'acc-ana');
  assert.match((takeStep(rec, 'brief', 'b-9', h, { step: 'approved', by: 'x' }, new Date(), ana) as any).error, /someone else must approve/);
  const r2 = takeStep(rec, 'brief', 'b-9', h, { step: 'approved', by: '' }, new Date(), sam);
  assert.ok(!('error' in r2));
  assert.equal((r2 as any).entry.selfApproved, undefined);
  assert.equal(signOffView((r2 as any).record, h).approvedBy, 'Sam');
});
