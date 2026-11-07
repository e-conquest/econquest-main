import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askCouncilColumns, fullCouncilColumns } from '../src/utils/councilNetwork.ts';

test('full council network: every agent labelled by task, statuses from the server, you in the loop', () => {
  const cols = fullCouncilColumns(
    {
      data: { status: 'done', ms: 1200, note: '3 live sources' },
      geo: { status: 'running' },
      sov: { status: 'fallback', note: 'No model answered: built-in figures used' },
      search: { status: 'skipped', note: 'Needs a Gemini key' },
    },
    'debating'
  );
  assert.deepEqual(cols.map((c) => c.title), ['1. Data', '2. Desk debates, in parallel', '3. Knock-on effects', '4. Your review', '5. Final report']);
  const by = Object.fromEntries(cols.flatMap((c) => c.nodes).map((n) => [n.id, n]));
  assert.equal(by.data.status, 'done');
  assert.equal(by.data.ms, 1200);
  assert.equal(by.geo.status, 'running');
  assert.deepEqual(by.macro.members, ['High-Frequency Nowcaster', 'Central Bank Watcher', 'Global Spillover']);
  assert.equal(by.sov.status, 'fallback');
  assert.equal(by.cascade.status, 'waiting'); // not started yet: never shown as done on a timer
  assert.equal(by.review.status, 'waiting');
  assert.equal(fullCouncilColumns({}, 'awaiting_review')[3].nodes[0].status, 'running');
  assert.equal(fullCouncilColumns({}, 'writing_report')[3].nodes[0].status, 'done');
});

test('ask network: planner and desk agents finish at once on app figures; synthesis says when no model answered', () => {
  const answers = [{ id: 'cb' as const, name: 'Central Bank Watcher', why: 'the question mentions "inflation"', findings: [], missing: [] }];
  const writing = askCouncilColumns(answers, true, null);
  assert.equal(writing[1].nodes[0].label, 'Central Bank Watcher Agent');
  assert.equal(writing[1].nodes[0].task, 'Asked: you mentioned "inflation"');
  assert.equal(writing[2].nodes[0].status, 'running');
  const none = askCouncilColumns(answers, false, { brief: null, removed: [], reason: 'No AI model answered.' });
  assert.equal(none[2].nodes[0].status, 'skipped');
  assert.match(none[2].nodes[0].note!, /^no summary: No AI model answered/);
});

test('ask network: the planner says when the AI model picked the agents', () => {
  const answers = [{ id: 'fx' as const, name: 'FX Valuation', why: 'the AI model judged: the lira drives it', findings: [], missing: [] }];
  assert.match(askCouncilColumns(answers, false, null)[0].nodes[0].note!, /stated rules, not AI/);
  const ai = askCouncilColumns(answers, false, null, 'ai');
  assert.match(ai[0].nodes[0].task, /AI model picked/);
  assert.equal(ai[1].nodes[0].task, 'AI pick: the lira drives it');
});
