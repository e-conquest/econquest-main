import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCouncil, runCouncil, type AgentAnswer } from '../src/utils/askCouncil.ts';
import {
  AGENT_DOC_SECTIONS,
  SYNTHESIS_DOC_SECTIONS,
  agentDocSections,
  coverageOf,
  documentMarkdown,
  documentsAsText,
  isCouncilDocument,
  synthesisDocSections,
  toAgentDocument,
  toAgentDocuments,
  toSynthesisDocument,
} from '../src/utils/agentDocument.ts';
import type { WatchlistItem } from '../src/types/council.ts';

const it = (iso3: string, countryName: string, o: Partial<WatchlistItem> = {}): WatchlistItem =>
  ({ iso3, countryName, cds5YBps: 150, cds5YSource: 'own', cds5YProvider: 'file', policyRateSource: 'bis', ...o }) as WatchlistItem;

const TUR = it('TUR', 'Turkey', { cpiInflationPct: 34, cpiSource: 'live', policyRatePct: 30, policyRateDate: '2026-10-27', policyRateBank: 'Central Bank of the Republic of Türkiye' });
const ZAF = it('ZAF', 'South Africa', { cpiInflationPct: 3.4, cpiSource: 'live', policyRatePct: 8 });
const ALL = [TUR, ZAF];
const CTX = { question: 'Which central banks look behind the curve?', askedAt: '2026-11-05T17:40:00.000Z', scope: 'your whole watchlist (2 countries)', countriesAsked: 2 };

const answer = (o: Partial<AgentAnswer> = {}): AgentAnswer => ({
  id: 'cb',
  name: 'Central Bank Watcher',
  why: 'the question is about inflation',
  findings: [
    {
      iso3: 'TUR',
      countryName: 'Turkey',
      reading: 'Policy is tight.',
      weight: 0.5,
      stance: [{ dim: 'policy', call: 'tight' }],
      figures: [
        { label: 'Policy rate', value: '30%', source: 'BIS policy rates', tag: 'live' },
        { label: 'Real rate', value: '-4 pts', source: 'Model: policy rate less inflation', tag: 'model' },
      ],
    },
  ],
  missing: [],
  ...o,
});

test('every agent document has the same sections in the same order', () => {
  const q = CTX.question;
  const docs = toAgentDocuments(runCouncil(q, planCouncil(q, ALL), ALL, new Date('2026-11-05T12:00:00Z')), CTX);
  assert.ok(docs.length >= 1);
  for (const d of docs) {
    assert.deepEqual(agentDocSections(d).map((s) => s.heading), [...AGENT_DOC_SECTIONS]);
    assert.ok(isCouncilDocument(d), d.id);
    assert.match(d.id, /^doc-[a-z]+-20261105174000/);
  }
});

test('figures keep tag and source; sourced ones get a reference number, rule readings keep their method', () => {
  const d = toAgentDocument(answer(), CTX);
  const [live, rule] = d.findings[0].figures;
  assert.equal(live.ref, 1);
  assert.equal(live.tagText, 'Live data');
  assert.equal(rule.ref, undefined);
  assert.equal(rule.tagText, 'Central Bank Watcher Agent');
  assert.deepEqual(d.sources.map((s) => s.source), ['BIS policy rates']);
  assert.deepEqual(d.findings[0].calls, ['monetary policy: tight']);
  const md = documentMarkdown(d);
  assert.match(md, /Policy rate: 30% \(Live data\) \[1\]/);
  assert.match(md, /Real rate: -4 pts \(Central Bank Watcher Agent; Model: policy rate less inflation\)/);
});

test('coverage is a stated rule on counts, not a confidence score', () => {
  assert.equal(coverageOf(answer(), 1).level, 'full');
  const partial = coverageOf(answer({ missing: ['South Africa: no inflation figure'] }), 2);
  assert.equal(partial.level, 'partial');
  assert.match(partial.line, /^Partial: 1 of 2 countries answered; 2 figures \(1 live, 1 by the agent’s stated rules\); 1 gap\. Rule:/);
  assert.equal(coverageOf(answer({ findings: [], missing: ['no figures'] }), 2).level, 'none');
});

test('missing data stays missing with its reason; no figure is added', () => {
  const d = toAgentDocument(answer({ findings: [], missing: ['Turkey: Needs setup (FRED key)'] }), CTX);
  const s = agentDocSections(d);
  assert.deepEqual(s.find((x) => x.heading === 'Findings')!.lines, ['No reading from the figures on hand.']);
  assert.deepEqual(s.find((x) => x.heading === 'Missing data')!.lines, ['- Turkey: Needs setup (FRED key)']);
});

test('synthesis reads the agent documents and has its own fixed template', () => {
  const docs = [toAgentDocument(answer(), CTX), toAgentDocument(answer({ id: 'fx', name: 'FX Valuation', findings: [], missing: ['no REER'] }), CTX)];
  const text = documentsAsText(docs);
  assert.match(text, /=== Document 1: Central Bank Watcher Agent ===/);
  assert.match(text, /=== Document 2: FX Valuation Agent ===[\s\S]*Missing data:\n- no REER\nCoverage: none/);

  const written = toSynthesisDocument(docs, { brief: { headline: 'Turkey is tight.', points: ['Policy rate 30%.'], disagreements: [], gaps: [] }, removed: ['A 99% claim.'], provider: 'gemini' }, CTX);
  assert.equal(written.status, 'written');
  assert.deepEqual(synthesisDocSections(written).map((s) => s.heading), [...SYNTHESIS_DOC_SECTIONS]);
  assert.deepEqual(written.gaps, ['FX Valuation Agent: no REER']);
  assert.deepEqual(written.agents.map((a) => a.coverage), ['partial', 'none']); // 1 of 2 countries answered
  assert.ok(isCouncilDocument(written));
  assert.match(documentMarkdown(written), /1 sentence\(s\) removed because a number did not trace back/);

  const none = toSynthesisDocument(docs, { brief: null, removed: [], reason: 'No AI model answered.' }, CTX);
  assert.equal(none.status, 'not written');
  assert.match(synthesisDocSections(none)[1].lines[0], /^Not written\. No AI model answered\./);
});

test('isCouncilDocument rejects junk', () => {
  assert.equal(isCouncilDocument(null), false);
  assert.equal(isCouncilDocument({ kind: 'agent', id: '../x', question: 'q', askedAt: 'a', sources: [], findings: [], missing: [] }), false);
});

test('council documents save to the research library for Reports, same id replaces, junk dropped on read', async () => {
  const { EMPTY_LIBRARY, addCouncilDoc, removeCouncilDoc, summarise, parseLibrary } = await import('../src/utils/researchLibrary.ts');
  const a = toAgentDocument(answer(), CTX);
  const s = toSynthesisDocument([a], { brief: null, removed: [], reason: 'No AI model answered.' }, CTX);
  let lib = addCouncilDoc(addCouncilDoc(EMPTY_LIBRARY, a), s);
  lib = addCouncilDoc(lib, a); // saved twice: one entry
  assert.equal(lib.councilDocs.length, 2);
  const sum = summarise(lib).councilDocs;
  assert.deepEqual(sum.map((d) => d.author).sort(), ['Central Bank Watcher Agent', 'Synthesis']);
  assert.ok(sum.some((d) => d.status === 'not written'));
  const back = parseLibrary(JSON.parse(JSON.stringify({ ...lib, councilDocs: [...lib.councilDocs, { kind: 'agent', id: 'x' }] })));
  assert.equal(back.councilDocs.length, 2);
  assert.equal(removeCouncilDoc(lib, a.id).councilDocs.length, 1);
  assert.deepEqual(parseLibrary({}).councilDocs, []);
});
