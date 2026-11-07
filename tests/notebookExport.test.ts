import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOTEBOOK_DOC_EXCERPT, notebookFileName, notebookMarkdown } from '../src/utils/notebookExport.ts';

const NOW = new Date('2026-11-05T12:00:00Z');
const nb = { id: 'n-1', title: 'Brazil fiscal', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z', briefIds: ['b-1', 'b-gone'], docIds: ['d1'], notes: 'Primary balance is the swing factor.' };
const briefs = [{ id: 'b-1', savedAt: '2026-11-04T00:00:00Z', question: 'Is Brazil debt sustainable?', askedAt: '2026-11-04T09:30:00Z', scopeNote: 'Brazil', answers: [], synthesis: null }] as any;

test('a notebook exports notes, contents, each brief under its own heading and document excerpts', () => {
  const long = 'Selic unchanged. '.repeat(200);
  const md = notebookMarkdown(nb, briefs, [{ id: 'd1', title: 'Copom statement', text: long, addedAt: '2026-11-03T00:00:00Z', pages: 4 }], NOW);
  assert.match(md, /^# Brazil fiscal\n/);
  assert.match(md, /exported 2026-11-05/);
  assert.match(md, /## Notes\n\nPrimary balance is the swing factor\./);
  assert.match(md, /1\. Is Brazil debt sustainable\? \(asked 2026-11-04\)/);
  assert.ok(!md.includes('b-gone'));
  // The brief's own top heading sits below the notebook's headings.
  assert.match(md, /## 1\. Is Brazil debt sustainable\?/);
  assert.match(md, /^### Council brief$/m);
  assert.ok(!/^# Council brief$/m.test(md));
  assert.match(md, new RegExp(`Opening ${NOTEBOOK_DOC_EXCERPT.toLocaleString('en-US')} of`));
  assert.match(md, /^> Selic unchanged\./m);
});

test('an empty notebook says so instead of leaving blanks', () => {
  const md = notebookMarkdown({ ...nb, briefIds: [], docIds: [], notes: '' }, [], [], NOW);
  assert.match(md, /_No notes yet\._/);
  assert.match(md, /_No saved conversations in this notebook\._/);
});

test('file name', () => {
  assert.equal(notebookFileName({ ...nb, title: 'São Paulo: rates & FX' }, NOW), 'notebook-sao-paulo-rates-fx-2026-11-05.md');
});
