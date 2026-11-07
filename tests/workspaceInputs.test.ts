import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasAiModel, panelUses, workspaceInputs, type WorkspaceInputsState } from '../src/utils/workspaceInputs.ts';

const fresh: WorkspaceInputsState = {
  watchlistName: 'EM watch',
  watchlistCount: 5,
  countryName: 'Brazil',
  holdingsCount: 0,
  liveCount: 0,
  keys: [
    { id: 'FRED_API_KEY', source: 'none', section: 'free_key' },
    { id: 'EIA_API_KEY', source: 'none', section: 'free_key' },
    { id: 'GEMINI_API_KEY', source: 'none', section: 'free_key' },
  ],
  aiProvider: 'gemini',
  research: { briefs: 0, docs: 0 },
};
const byId = (s: WorkspaceInputsState) => Object.fromEntries(workspaceInputs(s).map((c) => [c.id, c]));

test('a fresh install: feeds, keys and AI need setup, with a Missing reason; optional inputs read None yet', () => {
  const c = byId(fresh);
  assert.equal(c.feeds.state, 'setup');
  assert.match(c.feeds.note, /^Missing: no feed has answered yet/);
  assert.equal(c.keys.state, 'setup');
  assert.equal(c.keys.value, '0 of 2 set', 'the Gemini key counts under AI model, not free keys');
  assert.equal(c.ai.state, 'setup');
  assert.equal(c.holdings.value, 'None yet');
  assert.equal(c.holdings.state, 'empty');
  assert.equal(c.research.value, 'None yet');
  assert.equal(c.watchlist.state, 'ok');
});

test('everything set reads ok and keeps showing what it feeds', () => {
  const c = byId({
    ...fresh,
    liveCount: 3,
    holdingsCount: 4,
    aiProvider: 'ollama',
    keys: fresh.keys!.map((k) => (k.id === 'FRED_API_KEY' ? { ...k, source: 'app' as const } : k)),
    research: { briefs: 2, docs: 1 },
  });
  for (const id of ['watchlist', 'country', 'feeds', 'keys', 'ai', 'holdings', 'research']) assert.equal(c[id].state, 'ok', id);
  assert.equal(c.feeds.value, 'Live for 3 of 5');
  assert.equal(c.research.value, '2 briefs · 1 document');
  assert.equal(c.holdings.value, '4 positions');
  assert.ok(c.watchlist.drives.length > 0);
});

test('server not answering: keys and saved research read Missing, never zero', () => {
  const c = byId({ ...fresh, keys: undefined, research: undefined });
  assert.equal(c.keys.value, 'Missing');
  assert.equal(c.research.value, 'Missing');
  assert.match(c.keys.note, /did not answer/);
});

test('empty watchlist needs setup', () => {
  const c = byId({ ...fresh, watchlistCount: 0 });
  assert.equal(c.watchlist.state, 'setup');
  assert.equal(c.feeds.value, 'No countries');
});

test('Gemini counts as a model only with a key; Ollama always does', () => {
  assert.equal(hasAiModel('gemini', fresh.keys), false);
  assert.equal(hasAiModel('gemini', [{ id: 'GEMINI_API_KEY', source: 'env' }]), true);
  assert.equal(hasAiModel('ollama', undefined), true);
});

test('each panel lists the inputs that feed it', () => {
  const chips = workspaceInputs(fresh);
  assert.deepEqual(panelUses(chips, 'calendar').map((c) => c.id), ['watchlist']);
  assert.deepEqual(panelUses(chips, 'council').map((c) => c.id), ['watchlist', 'country', 'feeds', 'keys', 'ai', 'research']);
});

test('holdings mark the watchlist and also feed Portfolio', () => {
  const chips = workspaceInputs(fresh);
  assert.deepEqual(chips.find((c) => c.id === 'holdings')!.drives, ['watchlist']);
  assert.match(chips.find((c) => c.id === 'holdings')!.alsoFeeds!, /Portfolio/);
});
