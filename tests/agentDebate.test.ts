import { test } from 'node:test';
import assert from 'node:assert/strict';
import { challengesAsText, findChallenges } from '../src/utils/agentDebate.ts';
import { councilBriefSections, sentenceCheck, type AgentAnswer, type AgentFinding } from '../src/utils/askCouncil.ts';

const f = (iso3: string, countryName: string, reading: string, o: Partial<AgentFinding> = {}): AgentFinding => ({ iso3, countryName, reading, figures: [], weight: 0.5, ...o });
const A = (id: AgentAnswer['id'], name: string, findings: AgentFinding[]): AgentAnswer => ({ id, name, why: 'test', findings, missing: [] });

const RV = A('rv', 'Relative Value', [
  f('TUR', 'Turkey', 'CDS of 300 bp looks cheap against risk peers.', { stance: [{ dim: 'cds', call: 'cheap' }] }),
  f('POL', 'Poland', 'CDS of 70 bp looks rich against risk peers.', { stance: [{ dim: 'cds', call: 'rich' }] }),
]);
const FX = A('fx', 'FX Valuation', [
  f('TUR', 'Turkey', 'Real exchange rate 12.4% below its 10-year average: weak.', { stance: [{ dim: 'fx', call: 'weak' }] }),
  f('POL', 'Poland', 'Real exchange rate near its 10-year average.', { stance: [{ dim: 'fx', call: 'near average' }] }),
]);
const SPILL = A('spill', 'Global Spillover', [
  f('TUR', 'Turkey', 'Most exposed to a Hormuz closure: about 2.1% of GDP off the current account in the first round.', { weight: 0.42 }),
  f('POL', 'Poland', 'Most exposed to a Hormuz closure: about 0.3% of GDP off the current account in the first round.', { weight: 0.06 }),
]);
const CAL = A('calendar', 'Calendar', [f('POL', 'Poland', 'Next: NBP rate decision on 2026-11-20 (in 15 days).')]);

test('challenges: cheap CDS meets a large shock exposure and a weak currency; small exposures and in-step readings do not', () => {
  const cs = findChallenges([RV, FX, SPILL, CAL]);
  const tur = cs.filter((c) => c.iso3 === 'TUR');
  assert.deepEqual(tur.map((c) => `${c.from}>${c.to}`), ['spill>rv', 'fx>rv', 'spill>fx']);
  assert.match(tur[0].challenge, /prices too little of a shock: most exposed to a Hormuz closure: about 2\.1% of GDP/);
  assert.equal(tur[0].claim, 'CDS of 300 bp looks cheap against risk peers');
  // Poland: 0.3% exposure is small, the currency is near average; only the near rate decision challenges the CDS call.
  const pol = cs.filter((c) => c.iso3 === 'POL');
  assert.deepEqual(pol.map((c) => `${c.from}>${c.to}`), ['calendar>rv']);
  assert.match(pol[0].challenge, /in 15 days/);
});

test('no challenges when agents agree or only one agent speaks; documents never debate', () => {
  assert.deepEqual(findChallenges([FX]), []);
  const doc = A('doc', 'Policy Document', [f('doc:x:1', 'MPC statement', '“Policy will stay tight.”')]);
  assert.deepEqual(findChallenges([doc, FX]), []);
});

test('the challenge text puts every agent figure on the table, so AI replies quoting them pass the number check', () => {
  const answers = [RV, FX, SPILL];
  const cs = findChallenges(answers);
  assert.match(cs[2].challenge, /weak for its history can look like room to recover/);
  assert.match(challengesAsText(cs), /^Challenges:\n1\. Turkey: the Global Spillover Agent challenges the Relative Value Agent/);
  const { ok } = sentenceCheck('Is Turkey cheap?', answers);
  assert.ok(ok('I partly concede: a 2.1% of GDP hit is large next to CDS of 300 bp.'));
  assert.ok(!ok('I hold my ground: the hit is only 1.5% of GDP.'), 'invented number');
  assert.ok(!ok('Turkey CDS looks rich.'), 'contradicts the Relative Value call');
});

test('debate goes into the saved brief with replies, verdict and the AI note', () => {
  const challenges = findChallenges([RV, FX, SPILL]);
  const base = { question: 'Is Turkey cheap?', askedAt: '2026-11-05T01:00:00Z', scopeNote: 'Turkey', answers: [RV, FX, SPILL], synthesis: null };
  const withAi = councilBriefSections(
    { ...base, chooserNote: 'Agents picked by the AI model (gemini).', debate: { challenges, replies: [{ index: 0, reply: 'I partly concede.' }], verdict: 'Cheap, with a shock risk.', open: ['Reserves'] } },
    () => true
  );
  const d = withAi.find((s) => s.heading === 'Agent debate')!;
  assert.match(d.lines[0], /Turkey: Global Spillover Agent challenges Relative Value Agent/);
  assert.equal(d.lines[1], '  - Relative Value Agent replies: I partly concede.');
  assert.ok(d.lines.includes('Where it lands: Cheap, with a shock risk.'));
  assert.match(withAi.find((s) => s.heading === 'Method')!.lines[0], /^Agents picked by the AI model \(gemini\)\./);
  const noAi = councilBriefSections({ ...base, debate: { challenges, replies: null, reason: 'no AI model answered' } }, () => true);
  assert.match(noAi.find((s) => s.heading === 'Agent debate')!.lines.at(-1)!, /No AI replies \(no AI model answered\)/);
});
