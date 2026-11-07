import { test } from 'node:test';
import assert from 'node:assert/strict';
import { episodeFileName, episodeMarkdown } from '../src/utils/episodeHandout.ts';

const NOW = new Date('2026-11-05T12:00:00Z');
const ep = { id: 'e-1', title: 'Copom cut, Sep 2026', iso3: 'BRA', date: '2026-09-18', questions: ['Was the cut early?'], notes: 'Point to the August print.', createdAt: '', updatedAt: '' };
const replay = {
  iso3: 'BRA', decisionDate: '2026-09-18', asOf: '2026-09-11', action: 'cut' as const, rateBeforePct: 14.5, rateAfterPct: 14,
  inflation: { month: '2026-08', pct: 4.4, source: 'IBGE IPCA via BCB' }, target: { pct: 3, bandPts: 1.5, bank: 'BCB', url: 'https://www.bcb.gov.br', checked: false },
  rule: { pct: 7.1, gapPts: 7.4, signal: 'cut' as const, method: 'rule = …' }, matched: true, missing: [], caveats: ['Revised figures caveat.'],
};

test('student handout: the week-before data and questions, not the answer or notes', () => {
  const md = episodeMarkdown(ep, 'Brazil', { replay, policySource: 'BIS central bank policy rates' }, { now: NOW });
  assert.match(md, /^# Copom cut, Sep 2026/);
  assert.match(md, /Policy rate on 2026-09-11: 14\.50% \(BIS central bank policy rates\)/);
  assert.match(md, /4\.40% for 2026-08 \(IBGE IPCA via BCB\)/);
  assert.match(md, /OECD leading indicator: Missing/);
  assert.match(md, /1\. Was the cut early\?/);
  assert.match(md, /- Revised figures caveat\./);
  assert.ok(!md.includes('The bank cut'));
  assert.ok(!md.includes('August print'));
});

test('teacher copy adds what happened and the notes; missing data says why', () => {
  const md = episodeMarkdown(ep, 'Brazil', { replay, policySource: null }, { teacher: true, now: NOW });
  assert.match(md, /teacher copy/);
  assert.match(md, /The bank cut from 14\.50% to 14\.00%: in line with the rule/);
  assert.match(md, /Point to the August print\./);
  const none = episodeMarkdown({ ...ep, questions: [] }, 'Brazil', { error: 'No BIS policy rate history for this country.' }, { now: NOW });
  assert.match(none, /Missing: No BIS policy rate history/);
  assert.match(none, /_No questions set for this episode yet\._/);
  assert.equal(episodeFileName(ep, true), 'episode-copom-cut-sep-2026-teacher.md');
});
