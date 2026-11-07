import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docTitle, passages, questionTerms, searchDocs, type PolicyDoc } from '../src/utils/policyDocs.ts';
import { allowedNumbers, checkBrief, docAgent, planCouncil, runCouncil, suggestFollowUps } from '../src/utils/askCouncil.ts';
import type { WatchlistItem } from '../src/types/council.ts';

const MPC: PolicyDoc = {
  id: 'mpc',
  title: 'CBRT MPC statement October 2026',
  addedAt: '2026-11-05T00:00:00Z',
  text: [
    'The Monetary Policy Committee has decided to keep the policy rate, the one-week repo auction rate, at 39.5 percent.',
    'Leading indicators suggest that the underlying trend of inflation declined in October. Inflation expectations and pricing behaviour remain risks to the disinflation process.',
    'The Committee will keep the tight monetary policy stance until price stability is achieved.',
    'Tourism revenues were strong over the summer.',
  ].join('\n\n'),
};

test('question terms drop stop words and short words', () => {
  assert.deepEqual(questionTerms("What is the CBRT's policy rate and is it tight?"), ['cbrt', 'policy', 'rate', 'tight']);
});

test('passages: paragraphs, short ones joined, long ones cut at sentence ends', () => {
  assert.equal(passages(MPC.text).length, 4);
  assert.deepEqual(passages('Title\n\nA body paragraph that is long enough to stand on its own as a passage of the document.'), [
    'Title A body paragraph that is long enough to stand on its own as a passage of the document.',
  ]);
  const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} talks about the budget.`).join(' ');
  const ps = passages(long);
  assert.ok(ps.length > 1 && ps.every((p) => p.length <= 1050));
  assert.equal(ps.join(' ').replace(/\s+/g, ' '), long);
});

test('search: passages sharing the most question words first, with the words listed; unrelated passages left out', () => {
  const hits = searchDocs('Will the committee keep monetary policy tight while inflation falls?', [MPC]);
  assert.equal(hits[0].part, 3);
  assert.deepEqual(hits[0].matched, ['committee', 'keep', 'monetary', 'policy', 'tight']);
  assert.ok(hits.every((h) => h.part !== 4), 'tourism passage not picked');
  assert.deepEqual(searchDocs('Weather tomorrow?', [MPC]), []);
  assert.equal(searchDocs('inflationary', [MPC])[0].part, 2, 'one-word question, matched on the stem');
});

test('Policy Document Agent quotes passages word for word, so their numbers pass the number check', () => {
  const a = docAgent('What is the policy rate?', [MPC]);
  assert.equal(a.id, 'doc');
  assert.equal(a.why, 'you added a document');
  assert.match(a.findings[0].reading, /39\.5 percent/);
  assert.equal(a.findings[0].figures[0].tag, 'document');
  assert.ok(allowedNumbers('What is the policy rate?', [a]).includes(39.5));
  const { brief, removed } = checkBrief(
    { headline: 'The MPC statement puts the policy rate at 39.5 percent.', points: ['It also says the rate is 42 percent.'], disagreements: [], gaps: [] },
    'What is the policy rate?',
    [a]
  );
  assert.match(brief.headline, /39\.5/);
  assert.equal(removed.length, 1);
  assert.match(docAgent('Weather tomorrow?', [MPC]).missing[0], /no passage/);
});

test('runCouncil adds the document agent only when documents are added; follow-up suggestions skip it', () => {
  const it = (iso3: string, countryName: string): WatchlistItem => ({ iso3, countryName, cds5YBps: 150, yield10YPct: 8 }) as WatchlistItem;
  const ALL = [it('TUR', 'Turkey'), it('ZAF', 'South Africa')];
  const q = 'Is Turkey policy tight?';
  const plan = planCouncil(q, ALL);
  assert.ok(!runCouncil(q, plan, ALL).some((a) => a.id === 'doc'));
  const withDoc = runCouncil(q, plan, ALL, new Date(), [MPC]);
  assert.equal(withDoc[withDoc.length - 1].id, 'doc');
  assert.ok(!suggestFollowUps(plan, withDoc).some((s) => /CBRT/.test(s)));
});

test('file names become titles', () => {
  assert.equal(docTitle('imf_article-iv_2026.pdf'), 'imf article iv 2026');
});

test('PDF page text: a large vertical gap becomes a paragraph break, normal line spacing does not', async () => {
  const { pdfPageText } = await import('../src/utils/readDocument.ts');
  const t = pdfPageText([
    { str: 'First paragraph line one', hasEOL: true, transform: [0, 0, 0, 0, 0, 700], height: 10 },
    { str: 'line two', hasEOL: true, transform: [0, 0, 0, 0, 0, 688], height: 10 },
    { str: 'Second paragraph', hasEOL: false, transform: [0, 0, 0, 0, 0, 650], height: 10 },
  ]);
  assert.equal(t, 'First paragraph line one\nline two\n\nSecond paragraph');
});
