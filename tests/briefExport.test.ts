import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefFileName, councilBriefMarkdown, councilBriefPdf, pdfSafe } from '../src/utils/briefExport.ts';
import type { SavedCouncilBrief } from '../src/utils/askCouncil.ts';

const brief: SavedCouncilBrief = {
  question: 'Is Brazil’s debt sustainable?',
  askedAt: '2026-11-05T06:15:00Z',
  scopeNote: 'Brazil',
  answers: [
    {
      id: 'fiscal',
      name: 'Fiscal & Debt',
      why: 'the question mentions "debt"',
      findings: [
        {
          iso3: 'BRA',
          countryName: 'Brazil',
          reading: 'Debt is on a rising path.',
          figures: [{ label: 'Debt/GDP', value: '86.4%', tag: 'live', source: 'IMF WEO, 2025' }],
          weight: 1,
        },
      ],
      missing: ['No IMF forecast beyond 2027.'],
    } as any,
  ],
  synthesis: { brief: { headline: 'Debt rises → 92% by 2031.', points: ['Primary balance falls short.'], disagreements: [], gaps: [] }, removed: [], provider: 'Ollama' } as any,
};

test('Markdown keeps every figure with a numbered source, lists the references and ends with the disclaimer', () => {
  const md = councilBriefMarkdown(brief);
  assert.match(md, /^# Council brief/);
  assert.match(md, /Debt\/GDP 86\.4% \(Live data\) \[1\]/);
  assert.match(md, /## References\n\n\[1\] IMF WEO, 2025\. https:\/\/www\.imf\.org\/external\/datamapper\/ Read by the app on 2026-11-05\./);
  assert.match(md, /Is Brazil’s debt sustainable\?/);
  assert.match(md, /_Research, not validated advice\./);
});

test('file names carry the date and the question', () => {
  assert.equal(briefFileName(brief), 'council-brief-2026-11-05-is-brazils-debt-sustainable');
  assert.equal(briefFileName({ ...brief, question: '???' }), 'council-brief-2026-11-05');
});

test('PDF text uses only characters the PDF fonts can draw', () => {
  assert.equal(pdfSafe('“A” → B – C ≥ 1 · ok'), '"A" -> B - C >= 1 - ok');
  assert.equal(pdfSafe('Türkiye'), 'Türkiye', 'Latin-1 letters stay');
  assert.equal(pdfSafe('中'), '?');
});

test('the PDF is a real PDF', async () => {
  const bytes = new Uint8Array(await councilBriefPdf(brief));
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  assert.ok(bytes.length > 1000);
});
