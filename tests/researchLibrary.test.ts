import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SAVED_DOCS, EMPTY_LIBRARY, addBrief, addDoc, parseLibrary, removeBrief, removeDoc, summarise } from '../src/utils/researchLibrary.ts';

const brief = (askedAt: string, o = {}) => ({ question: `Q ${askedAt}`, askedAt, scopeNote: 'Brazil', answers: [], synthesis: null, ...o });

test('conversations: one entry per conversation, newest first, with the summary headline', () => {
  let lib = addBrief(EMPTY_LIBRARY, brief('2026-11-05T01:00:00Z')).lib;
  lib = addBrief(lib, brief('2026-11-05T02:00:00Z', { synthesis: { brief: { headline: 'Debt is rising.', points: [], disagreements: [], gaps: [] }, removed: [] } })).lib;
  lib = addBrief(lib, brief('2026-11-05T03:00:00Z', { startedAt: '2026-11-05T01:00:00Z', earlier: [{ question: 'Q1' }] })).lib;
  const s = summarise(lib).briefs;
  assert.deepEqual(s.map((b) => [b.question, b.turns]), [['Q 2026-11-05T03:00:00Z', 2], ['Q 2026-11-05T02:00:00Z', 1]]);
  assert.equal(s[1].headline, 'Debt is rising.');
  assert.equal(removeBrief(lib, s[0].id).briefs.length, 1);
});

test('documents: same id replaces, capped, and a broken file reads as empty', () => {
  let lib = EMPTY_LIBRARY;
  for (let i = 0; i < MAX_SAVED_DOCS + 3; i++) lib = addDoc(lib, { id: `d${i}`, title: `Doc ${i}`, text: 'text', addedAt: '2026-11-05' });
  assert.equal(lib.docs.length, MAX_SAVED_DOCS);
  assert.equal(lib.docs[0].id, `d${MAX_SAVED_DOCS + 2}`);
  lib = addDoc(lib, { id: 'd5', title: 'New title', text: 'text', addedAt: '2026-11-05' });
  assert.equal(lib.docs.filter((d) => d.id === 'd5').length, 1);
  assert.deepEqual(parseLibrary(null), { briefs: [], docs: [], notebooks: [], episodes: [], councilDocs: [] });
  assert.deepEqual(parseLibrary({ briefs: [{ nope: 1 }], docs: [{ id: 'x', title: 't', text: '' }] }), { briefs: [], docs: [], notebooks: [], episodes: [], councilDocs: [] });
});

test('notebooks: group conversations and documents by topic; deleting an item takes it out', async () => {
  const { addNotebook, updateNotebook, removeNotebook, suggestedTopics } = await import('../src/utils/researchLibrary.ts');
  let lib = addBrief(EMPTY_LIBRARY, brief('2026-11-05T01:00:00Z')).lib;
  lib = addDoc(lib, { id: 'd1', title: 'Copom', text: 'Selic unchanged.', addedAt: '2026-11-05' });
  assert.equal(addNotebook(lib, '   '), null);
  const made = addNotebook(lib, 'Brazil fiscal', new Date('2026-11-05T06:00:00Z'))!;
  const bid = lib.briefs[0].id;
  const next = updateNotebook(made.lib, made.id, { briefIds: [bid, 'b-missing', bid], docIds: ['d1'], notes: 'Watch the primary balance.' })!;
  const nb = next.notebooks[0];
  assert.deepEqual([nb.title, nb.briefIds, nb.docIds, nb.notes], ['Brazil fiscal', [bid], ['d1'], 'Watch the primary balance.']);
  assert.equal(updateNotebook(next, 'n-nope', { notes: 'x' }), null);
  // Blank title keeps the old one.
  assert.equal(updateNotebook(next, made.id, { title: '' })!.notebooks[0].title, 'Brazil fiscal');
  const afterDelete = removeDoc(removeBrief(next, bid), 'd1');
  assert.deepEqual([afterDelete.notebooks[0].briefIds, afterDelete.notebooks[0].docIds], [[], []]);
  assert.equal(removeNotebook(next, made.id).notebooks.length, 0);
  // Survives a round trip through the file format; junk notebooks are dropped.
  const parsed = parseLibrary(JSON.parse(JSON.stringify({ ...next, notebooks: [...next.notebooks, { id: '', title: 'x' }] })));
  assert.deepEqual(parsed.notebooks, next.notebooks);
  assert.equal(summarise(next).notebooks[0].notesChars, 26);
  // Suggested topics: countries with two or more conversations, not already a notebook.
  const sums = [
    { id: 'a', countries: ['BRA', 'MEX'] },
    { id: 'b', countries: ['BRA'] },
    { id: 'c', countries: ['TUR'] },
  ] as any;
  assert.deepEqual(suggestedTopics(sums, [], { BRA: 'Brazil' }), [{ iso3: 'BRA', title: 'Brazil', briefIds: ['a', 'b'] }]);
  assert.deepEqual(suggestedTopics(sums, [{ title: 'brazil' }], { BRA: 'Brazil' }), []);
});

test('teaching episodes: a country, a date and questions; bad fields refused or kept', async () => {
  const { addEpisode, updateEpisode, removeEpisode } = await import('../src/utils/researchLibrary.ts');
  assert.deepEqual(addEpisode(EMPTY_LIBRARY, { title: '', iso3: 'BRA', date: '2026-09-18' }), { error: 'An episode needs a title.' });
  assert.ok('error' in addEpisode(EMPTY_LIBRARY, { title: 'x', iso3: 'Brazil', date: '2026-09-18' }));
  assert.ok('error' in addEpisode(EMPTY_LIBRARY, { title: 'x', iso3: 'BRA', date: 'Sept' }));
  const made = addEpisode(EMPTY_LIBRARY, { title: 'Copom cut, Sep 2026', iso3: 'bra', date: '2026-09-18', questions: 'Was the cut early?\n\n  Which figure mattered most?  ' }, new Date('2026-11-05T10:00:00Z'));
  assert.ok(!('error' in made));
  if ('error' in made) return;
  const ep = made.lib.episodes[0];
  assert.deepEqual([ep.iso3, ep.questions], ['BRA', ['Was the cut early?', 'Which figure mattered most?']]);
  const next = updateEpisode(made.lib, made.id, { date: 'bad', notes: 'Point to the 2026-08 print.', questions: ['One'] })!;
  assert.deepEqual([next.episodes[0].date, next.episodes[0].notes, next.episodes[0].questions], ['2026-09-18', 'Point to the 2026-08 print.', ['One']]);
  assert.equal(updateEpisode(made.lib, 'e-nope', {}), null);
  assert.deepEqual(parseLibrary(JSON.parse(JSON.stringify({ ...next, episodes: [...next.episodes, { id: 'e2', title: 't', iso3: 'xx', date: '2026' }] }))).episodes, next.episodes);
  assert.equal(removeEpisode(next, made.id).episodes.length, 0);
});
