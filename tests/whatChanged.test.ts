import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeLines, deltaOf, pickPrevious, whatChanged } from '../src/utils/whatChanged.ts';
import { councilBriefSections, type AgentAnswer } from '../src/utils/askCouncil.ts';
import { addBrief, EMPTY_LIBRARY, summarise } from '../src/utils/researchLibrary.ts';

const cb = (rate: string, cpi: string, call: 'tight' | 'neutral' | 'loose'): AgentAnswer => ({
  id: 'cb',
  name: 'Central Bank Watcher',
  why: 'x',
  missing: [],
  findings: [
    {
      iso3: 'BRA',
      countryName: 'Brazil',
      reading: 'r',
      weight: 0.5,
      stance: [{ dim: 'policy', call }],
      figures: [
        { label: 'Policy rate', value: rate, source: 'BIS, 2026-10-27', tag: 'official' },
        { label: 'CPI inflation', value: cpi, source: 'OECD monthly, Apr 2026', tag: 'live' },
        { label: 'Inflation target', value: '3.0% ± 1.5', source: 'BCB', tag: 'official' },
      ],
    },
  ],
});
const cal: AgentAnswer = { id: 'calendar', name: 'Calendar', why: 'x', missing: [], findings: [{ iso3: 'BRA', countryName: 'Brazil', reading: 'r', weight: 1, figures: [{ label: 'Next', value: 'in 3 days', source: 'x', tag: 'official' }] }] };

test('deltas read in the figure’s own unit', () => {
  assert.equal(deltaOf('14.25%', '15.00%'), '+0.75 pts');
  assert.equal(deltaOf('$363.1bn', '$350.0bn'), '-$13.1bn');
  assert.equal(deltaOf('185 bps', '170 bps'), '-15 bps');
  assert.equal(deltaOf('rising (+4.8 pts)', 'stable (+1.0 pts)'), undefined);
});

test('figures that moved and calls that flipped are listed; unchanged ones counted; calendar countdowns ignored', () => {
  const prev = { question: 'Is Brazil tight?', askedAt: '2026-11-01T10:00:00Z', scopeNote: 'Brazil', answers: [cb('14.25%', '4.6%', 'neutral'), cal], synthesis: null };
  const r = whatChanged(prev, [cb('15.00%', '4.6%', 'tight'), { ...cal, findings: [{ ...cal.findings[0], figures: [{ label: 'Next', value: 'in 1 day', source: 'x', tag: 'official' }] }] }]);
  assert.equal(r.changes.length, 1);
  assert.deepEqual([r.changes[0].label, r.changes[0].before, r.changes[0].after, r.changes[0].delta], ['Policy rate', '14.25%', '15.00%', '+0.75 pts']);
  assert.deepEqual(r.stanceChanges.map((s) => [s.before, s.after]), [['neutral', 'tight']]);
  assert.equal(r.unchanged, 2);
  const lines = changeLines(r);
  assert.match(lines[0], /Brazil, Central Bank Watcher Agent: call moved from neutral to tight/);
  assert.match(lines[1], /Policy rate 14\.25% → 15\.00% \(\+0\.75 pts\)\. Now: BIS, 2026-10-27/);
  const sections = councilBriefSections({ ...prev, askedAt: '2026-11-05T10:00:00Z', answers: [cb('15.00%', '4.6%', 'tight')], changes: r }, (id) => id === 'changes');
  assert.equal(sections[0].heading, 'What changed since last time');
  assert.match(sections[0].lines[0], /saved question of 2026-11-01 10:00 UTC: “Is Brazil tight\?”/);
});

test('the earlier conversation is the latest saved one on the same countries and agents, never this one', () => {
  let lib = addBrief(EMPTY_LIBRARY, { question: 'old', askedAt: '2026-11-01T10:00:00Z', scopeNote: '', answers: [cb('14.25%', '4.6%', 'neutral')], synthesis: null }).lib;
  lib = addBrief(lib, { question: 'fx only', askedAt: '2026-11-02T10:00:00Z', scopeNote: '', answers: [{ id: 'fx', name: 'FX', why: '', missing: [], findings: [{ iso3: 'BRA', countryName: 'Brazil', reading: '', weight: 0, figures: [] }] }], synthesis: null }).lib;
  lib = addBrief(lib, { question: 'current', askedAt: '2026-11-05T10:00:00Z', scopeNote: '', answers: [cb('15.00%', '4.6%', 'tight')], synthesis: null }).lib;
  const s = summarise(lib).briefs;
  assert.deepEqual(s[0].countries, ['BRA']);
  assert.equal(pickPrevious(s, s[0].id, [cb('15.00%', '4.6%', 'tight')])?.question, 'old');
  assert.equal(pickPrevious(s.filter((b) => b.question !== 'old'), s[0].id, [cb('15.00%', '4.6%', 'tight')]), undefined);
});
