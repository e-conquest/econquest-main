import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { canSaveStep, frameTitle, parseFrame, stepStates, summarise, type PolicyReview, type ReviewFrame } from '../src/utils/policyReview';
import { deleteReview, loadReviews, newReview, putReview, saveStep, verifyReview } from '../src/utils/policyReviewStore';

const today = new Date('2026-11-05T12:00:00Z');
const input = { iso3: 'bra', problem: 'Inflation is well above target while growth is slowing.', goal: { indicator: 'Headline inflation', direction: 'lower', target: '3%', by: '2027-12' }, constraints: [' Election in Oct 2026 ', ''], asOf: '2026-11-01' };
const frame = (): ReviewFrame => {
  const p = parseFrame(input, today);
  assert.ok('frame' in p, 'errors' in p ? p.errors.join(' ') : '');
  return (p as { frame: ReviewFrame }).frame;
};
const ok = (r: ReturnType<typeof saveStep>): PolicyReview => {
  assert.ok('review' in r, 'error' in r ? r.error : '');
  return (r as { review: PolicyReview }).review;
};

test('parseFrame tidies a good frame and lists every reason a bad one cannot be saved', () => {
  const f = frame();
  assert.equal(f.iso3, 'BRA');
  assert.deepEqual(f.constraints, ['Election in Oct 2026']);
  assert.equal(frameTitle(f), 'BRA: lower Headline inflation to 3% (as of 2026-11-01)');
  const bad = parseFrame({ iso3: 'x', problem: 'short', goal: { direction: 'up', by: 'soon' }, asOf: '2027-01-01' }, today);
  assert.ok('errors' in bad);
  const errs = (bad as { errors: string[] }).errors.join(' ');
  for (const m of [/country/, /problem/, /indicator/, /lower, higher/, /"By"/, /future/]) assert.match(errs, m);
});

test('steps save only in order, each chained to the step before', () => {
  const r0 = newReview(frame(), [], today);
  assert.equal(stepStates(r0).frame, 'done');
  assert.equal(summarise(r0).next, 'diagnose');
  assert.match(canSaveStep(r0, 'options') ?? '', /Diagnose must be done first/);
  const r1 = ok(saveStep(r0, 'diagnose', { figures: [{ label: 'Inflation', value: '5.1%' }] }, today));
  assert.equal(r1.steps.diagnose?.basedOn, r0.steps.frame?.hash);
  const r2 = ok(saveStep(r1, 'options', { ranked: ['Hold rates'] }, today));
  assert.deepEqual(Object.values(stepStates(r2)).slice(0, 3), ['done', 'done', 'done']);
  assert.equal(r2.runs.length, 3);
});

test('changing the frame marks every later step out of date until it is run again', () => {
  const r0 = newReview(frame(), [], today);
  const r1 = ok(saveStep(r0, 'diagnose', { figures: [] }, today));
  const r2 = ok(saveStep(r1, 'options', { ranked: [] }, today));
  const r3 = ok(saveStep(r2, 'frame', { ...frame(), asOf: '2026-10-01' }, today));
  const s = stepStates(r3);
  assert.equal(s.diagnose, 'out_of_date');
  assert.equal(s.options, 'out_of_date');
  assert.match(canSaveStep(r3, 'options') ?? '', /out of date/);
  const r4 = ok(saveStep(r3, 'diagnose', { figures: [] }, today));
  assert.equal(stepStates(r4).diagnose, 'done');
  assert.equal(stepStates(r4).options, 'out_of_date');
  assert.match(r4.title, /as of 2026-10-01/);
});

test('the same frame and figures give the same hashes; an edited file is caught', () => {
  const a = ok(saveStep(newReview(frame(), [], today), 'diagnose', { figures: [{ v: 1 }] }, today));
  const b = ok(saveStep(newReview(frame(), [], new Date('2026-11-06T00:00:00Z')), 'diagnose', { figures: [{ v: 1 }] }, today));
  assert.equal(a.steps.diagnose?.hash, b.steps.diagnose?.hash);
  assert.deepEqual(verifyReview(a), []);
  const tampered = { ...a, steps: { ...a.steps, diagnose: { ...a.steps.diagnose!, content: { figures: [{ v: 2 }] } } } };
  assert.deepEqual(verifyReview(tampered), ['diagnose']);
});

test('reviews are kept in a file, newest first, and can be deleted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviews-'));
  const file = path.join(dir, 'local', 'reviews.json');
  assert.deepEqual(loadReviews(file).reviews, []);
  const a = newReview(frame(), [], new Date('2026-11-01T00:00:00Z'));
  const b = newReview(frame(), [a.id], new Date('2026-11-02T00:00:00Z'), a.id);
  putReview(file, a);
  putReview(file, b);
  assert.deepEqual(loadReviews(file).reviews.map((r) => r.id), [b.id, a.id]);
  assert.equal(loadReviews(file).reviews[0].previousId, a.id);
  assert.equal(deleteReview(file, a.id), true);
  assert.equal(deleteReview(file, a.id), false);
  assert.equal(loadReviews(file).reviews.length, 1);
});
