import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { addDays, canonicalIdea, scoreIdea, summariseIdeas, validateIdea, valueOnOrBefore, type Idea } from '../src/utils/ideaJournal';
import { appendIdea, ideaHash, loadIdeas } from '../src/utils/ideaStore';

const base: Omit<Idea, 'hash'> = {
  id: 'a',
  loggedAt: '2026-01-05T10:00:00Z',
  author: 'tester',
  iso3: 'BRA',
  instrument: 'fx',
  direction: 'long',
  horizonDays: 30,
  thesis: 'Carry and a hawkish bank',
  type: 'carry',
  target: 'BRL',
  entry: { date: '2026-01-05', level: 5 },
  horizonDate: '2026-02-04',
};
const idea = (x: Partial<Idea> = {}): Idea => ({ ...base, hash: 'h', ...x }) as Idea;

test('validateIdea lists what is missing and accepts a full idea', () => {
  assert.deepEqual(validateIdea(base), []);
  const p = validateIdea({ iso3: 'br', instrument: 'fx', direction: 'up', horizonDays: 3, thesis: ' ', type: 'x' as any });
  assert.equal(p.length, 5);
  assert.ok(validateIdea({ ...base, instrument: 'policy', direction: 'up', invalidationPct: 5 }).some((s) => s.includes('currency ideas only')));
  assert.deepEqual(validateIdea({ ...base, instrument: 'policy', direction: 'unchanged' }), []);
});

test('addDays and valueOnOrBefore', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  const pts = [{ date: '2026-01-02', value: 1 }, { date: '2026-01-05', value: 2 }, { date: '2026-01-07', value: 3 }];
  assert.deepEqual(valueOnOrBefore(pts, '2026-01-06'), { date: '2026-01-05', level: 2 });
  assert.equal(valueOnOrBefore(pts, '2026-01-01'), null);
});

test('fx long is a hit when units per dollar fall by the horizon', () => {
  const pts = [{ date: '2026-01-20', value: 4.9 }, { date: '2026-02-05', value: 4.8 }];
  const s = scoreIdea(idea(), pts, '2026-03-01');
  assert.equal(s.status, 'hit');
  assert.equal(s.at!.date, '2026-02-05');
  assert.equal(s.move, Number((100 * (5 / 4.8 - 1)).toFixed(2)));
  assert.equal(scoreIdea(idea({ direction: 'short' }), pts, '2026-03-01').status, 'miss');
});

test('fx invalidation ends the idea before the horizon', () => {
  const pts = [{ date: '2026-01-20', value: 5.3 }, { date: '2026-02-05', value: 4.5 }];
  const s = scoreIdea(idea({ invalidationPct: 5 }), pts, '2026-03-01');
  assert.equal(s.status, 'invalidated');
  assert.equal(s.at!.date, '2026-01-20');
});

test('open before the horizon, no_data after it with nothing published', () => {
  const pts = [{ date: '2026-01-20', value: 4.9 }];
  const open = scoreIdea(idea(), pts, '2026-01-25');
  assert.equal(open.status, 'open');
  assert.ok(open.move! > 0);
  assert.equal(scoreIdea(idea(), pts, '2026-03-01').status, 'no_data');
});

test('policy ideas: up, down, unchanged', () => {
  const p = idea({ instrument: 'policy', direction: 'up', target: 'BR', entry: { date: '2026-01-05', level: 10 } });
  const pts = [{ date: '2026-02-04', value: 10.5 }];
  assert.equal(scoreIdea(p, pts, '2026-03-01').status, 'hit');
  assert.equal(scoreIdea({ ...p, direction: 'down' }, pts, '2026-03-01').status, 'miss');
  assert.equal(scoreIdea({ ...p, direction: 'unchanged' }, [{ date: '2026-02-10', value: 10 }], '2026-03-01').status, 'hit');
});

test('summary counts hits by type', () => {
  const rows = summariseIdeas([
    { idea: idea(), score: { status: 'hit', move: 2 } },
    { idea: idea({ type: 'value' }), score: { status: 'miss', move: -1 } },
    { idea: idea({ type: 'value' }), score: { status: 'open' } },
  ]);
  assert.deepEqual(rows[0], { type: 'all', closed: 2, hits: 1, hitRate: 0.5, avgFxMove: 0.5, open: 1 });
  assert.equal(rows.find((r) => r.type === 'value')!.open, 1);
});

test('the store appends hashed records and spots a changed line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideas-'));
  const file = path.join(dir, 'local', 'ideas.jsonl');
  const a = appendIdea(file, base);
  appendIdea(file, { ...base, id: 'b' });
  assert.equal(a.hash, ideaHash(base));
  assert.equal(canonicalIdea(a), canonicalIdea(base));
  const text = fs.readFileSync(file, 'utf8').replace('"Carry and a hawkish bank"', '"Edited later"');
  fs.writeFileSync(file, `${text}not json\n`);
  const { ideas, badLines } = loadIdeas(file);
  assert.equal(ideas.length, 2);
  assert.equal(badLines, 1);
  assert.deepEqual(ideas.map((i) => i.hashOk), [false, true], "only the edited first line fails");
  fs.rmSync(dir, { recursive: true, force: true });
});
