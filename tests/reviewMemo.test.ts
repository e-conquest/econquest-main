import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PolicyReview, ReviewFrame } from '../src/utils/policyReview';
import type { Diagnosis } from '../src/utils/reviewDiagnosis';
import type { OptionsStep, PolicyOption } from '../src/utils/reviewOptions';
import type { EvidenceStep } from '../src/utils/reviewEvidence';
import { buildMemo, defaultMemoInputs, memoFileName, parseMemoInputs, RESEARCH_BANNER } from '../src/utils/reviewMemo';

const frame: ReviewFrame = { iso3: 'BRA', problem: 'Inflation is above target and growth is slowing.', goal: { indicator: 'Inflation', direction: 'lower', target: '3%', by: '2027-12' }, constraints: ['Election in October'], asOf: '2026-11-01', audience: 'Monetary policy committee' };
const fig = (ref: number, label: string, value: number | null) => ({ ref, field: `f${ref}`, group: 'g', label, unit: '%', value, status: value === null ? ('Missing' as const) : ('Live' as const), period: value === null ? '' : '2026', source: value === null ? '' : 'IMF WEO', reason: value === null ? 'IMF did not answer' : '' });
const d: Diagnosis = { iso3: 'BRA', asOf: '2026-11-01', pullDate: '2026-10-30', pulledAt: '', incomplete: false, figures: [fig(1, 'Inflation (IMF WEO)', 4.4), fig(2, 'Policy rate', null)], readings: [], coverage: '1 of 2 indicators live, 1 missing.' };
const opt = (rank: number, title: string): PolicyOption => ({ rank, title, lever: 'monetary', how: 'Keep rates high.', effect: 'Lower inflation.', timeToEffect: 'a year', tradeoffs: 'Slower growth.', whoBears: 'Borrowers.', mustBeTrue: 'Expectations anchored.', risks: 'Recession.', refs: [1], views: { cb: 'Tight enough.' }, fromUser: false });
const o: OptionsStep = { templateVersion: 'review-options-v1', model: 'Local Ollama (qwen)', temperature: 0, promptHash: 'abcdef1234567890', options: [opt(1, 'Hold rates'), opt(2, 'Fiscal rule')], ranking: 'Monetary first.', gaps: ['Policy rate missing.'], userOptions: [], removed: [] };
const e: EvidenceStep = { templateVersion: 'review-evidence-v1', asOf: '2026-11-01', analyses: [], episodes: { items: [], method: 'm', missing: 'no BIS history' }, signals: [{ id: 'taylor_gap', name: 'Policy rule check (Taylor gap)', status: 'not_validated', statusLabel: 'Not validated', informs: ['monetary'] }], perOption: [{ rank: 1, title: 'Hold rates', lever: 'monetary', analyses: [], signals: ['taylor_gap'], note: 'No analysis could run.' }], researchOnly: true };
const rec = (content: unknown, hash: string) => ({ content, savedAt: '2026-11-01T00:00:00Z', hash });
const review: Pick<PolicyReview, 'title' | 'steps'> = { title: 'BRA: lower Inflation to 3% (as of 2026-11-01)', steps: { frame: rec(frame, 'f'.repeat(64)), diagnose: rec(d, 'd'.repeat(64)), options: rec(o, 'o'.repeat(64)), evidence: rec(e, 'e'.repeat(64)) } };

test('choices are checked: a ranked option, a review date after As of, something to watch', () => {
  assert.match((parseMemoInputs({ recommended: 9 }, o, frame.asOf) as any).error, /ranked options/);
  assert.match((parseMemoInputs({ recommended: 1, reviewDate: '2026-10-01', watch: [{ indicator: 'x' }] }, o, frame.asOf) as any).error, /after the As of/);
  assert.match((parseMemoInputs({ recommended: 1, reviewDate: '2027-05-01', watch: [] }, o, frame.asOf) as any).error, /at least one/);
  const ok = parseMemoInputs({ recommended: 2, reviewDate: '2027-05-01', watch: [{ indicator: ' Inflation [1] ', trigger: '' }], rationale: ' Mine ' }, o, frame.asOf);
  assert.deepEqual(ok, { inputs: { recommended: 2, rationale: 'Mine', watch: [{ indicator: 'Inflation [1]' }], reviewDate: '2027-05-01' } });
});

test('defaults: top option, the goal figure with its reference, review in six months', () => {
  assert.deepEqual(defaultMemoInputs(frame, d, o), { recommended: 1, rationale: '', watch: [{ indicator: 'Inflation (IMF WEO) [1]', trigger: 'target 3%' }], reviewDate: '2027-05-01' });
});

test('the memo is assembled from the steps, cites references with sources, says research only, and is the same every time', () => {
  const inputs = { recommended: 1, rationale: 'Credibility first.', watch: [{ indicator: 'Inflation [1]', trigger: 'above 4.4' }], reviewDate: '2027-05-01' };
  const m = buildMemo(review, inputs);
  assert.equal(m.researchOnly, true);
  assert.ok(m.markdown.includes(`> ${RESEARCH_BANNER}`));
  for (const s of ['**Hold rates** (Monetary, ranked 1 of 2)', "Reasoning (the principal's own): Credibility first.", '[1] Inflation (IMF WEO): 4.4%, IMF WEO, 2026; app pull of 2026-10-30.', '[2] Policy rate: Missing (IMF did not answer)', 'Policy rule check (Taylor gap): Not validated', 'Review on 2027-05-01', 'prompt hash abcdef123456', 'Central Bank Watcher Agent on the recommendation: Tight enough.']) assert.ok(m.markdown.includes(s), s);
  assert.deepEqual(buildMemo(review, inputs), m);
  assert.equal(memoFileName(m, 'pdf'), 'policy-memo-BRA-lower-Inflation-to-3-as-of-2026-11-01.pdf');
});
