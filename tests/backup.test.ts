import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { backupFileName, buildBackup, describeBackup, keepSecrets, parseBackup, stripSecrets } from '../src/utils/backup.ts';
import { currentBackup, restoreBackup } from '../src/utils/backupStore.ts';
import { addNotebook, EMPTY_LIBRARY } from '../src/utils/researchLibrary.ts';
import { loadLibrary, researchFilePath, saveLibrary } from '../src/utils/researchStore.ts';
import { loadWatchRules, saveWatchRules, watchRulesFilePath } from '../src/utils/watchRulesStore.ts';
import { loadWorkspace, setWorkspaceValue, workspaceFilePath } from '../src/utils/workspaceStore.ts';

const AI_KEY = 'econquest_ai_runtime_config_v1';
const RULE = { id: 'r1', iso3: '*', metric: 'policy_rate', op: '>=', value: 10, createdAt: '2026-11-05T00:00:00Z' } as const;

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'econquest-backup-'));
  return { dir, files: { research: researchFilePath(dir), watchRules: watchRulesFilePath(dir), workspace: workspaceFilePath(dir) } };
}

test('stripSecrets removes keys, secrets and tokens at any depth, and keeps the rest', () => {
  const v = { providerMode: 'ollama', integrationConfig: { apiKey: 'k', webhookHmacSecret: 's', baseUrl: 'u' }, apiConnectors: [{ id: 'c', authToken: 't', url: 'x' }] };
  assert.deepEqual(stripSecrets(v), { providerMode: 'ollama', integrationConfig: { baseUrl: 'u' }, apiConnectors: [{ id: 'c', url: 'x' }] });
});

test('keepSecrets puts back the secrets this computer has, matching list items by id', () => {
  const restored = { providerMode: 'gemini', integrationConfig: { baseUrl: 'new' }, apiConnectors: [{ id: 'b', url: 'y' }, { id: 'a', url: 'x2' }] };
  const current = { providerMode: 'ollama', integrationConfig: { apiKey: 'k', baseUrl: 'old' }, apiConnectors: [{ id: 'a', authToken: 'ta', url: 'x' }] };
  assert.deepEqual(keepSecrets(restored, current), {
    providerMode: 'gemini',
    integrationConfig: { baseUrl: 'new', apiKey: 'k' },
    apiConnectors: [{ id: 'b', url: 'y' }, { id: 'a', url: 'x2', authToken: 'ta' }],
  });
});

test('a backup never carries API keys and reads back the same', () => {
  const made = addNotebook(EMPTY_LIBRARY, 'Brazil fiscal', new Date('2026-11-05T10:00:00Z'))!;
  const b = buildBackup(
    {
      research: made.lib,
      watchRules: [RULE],
      workspace: { [AI_KEY]: JSON.stringify({ providerMode: 'gemini', integrationConfig: { apiKey: 'SECRET123' } }), 'econquest.holdings.v1': '[]', unknown_key: '"x"' },
    },
    new Date('2026-11-05T12:00:00Z')
  );
  const text = JSON.stringify(b);
  assert.ok(!text.includes('SECRET123'));
  assert.ok(!text.includes('unknown_key'));
  const back = parseBackup(text);
  assert.ok(back.ok);
  if (!back.ok) return;
  assert.deepEqual(back.backup, b);
  assert.equal(back.summary.notebooks, 1);
  assert.equal(back.summary.watchRules, 1);
  assert.deepEqual(back.summary.workspace, ['holdings', 'AI model settings']);
  assert.equal(describeBackup(back.summary), '1 notebook, 1 watch alert, holdings and AI model settings');
  assert.equal(backupFileName(new Date('2026-11-05T12:00:00Z')), 'econquest-backup-2026-11-05.json');
});

test('parseBackup refuses files that are not backups or come from a newer app', () => {
  assert.equal(parseBackup('not json').ok, false);
  assert.equal(parseBackup({ format: 'other' }).ok, false);
  const newer = parseBackup({ format: 'econquest-backup', version: 99, contents: {} });
  assert.equal(newer.ok, false);
  if (!newer.ok) assert.match(newer.error, /newer version/);
  const empty = parseBackup({ format: 'econquest-backup', version: 1, createdAt: 'x', contents: {} });
  assert.ok(empty.ok);
  if (empty.ok) assert.equal(describeBackup(empty.summary), 'nothing saved yet');
});

test('restore replaces the three files, saves a copy first and keeps this computer\'s AI secrets', () => {
  const { dir, files } = setup();
  // Now on this computer: one notebook, no alerts, AI settings with an integration key.
  saveLibrary(files.research, addNotebook(EMPTY_LIBRARY, 'Old notebook')!.lib);
  setWorkspaceValue(files.workspace, AI_KEY, JSON.stringify({ providerMode: 'ollama', integrationConfig: { apiKey: 'LOCALKEY' } }));
  setWorkspaceValue(files.workspace, 'econquest.holdings.v1', '[{"iso3":"BRA"}]');

  // The backup: a different notebook, one alert, Gemini, and no holdings.
  const backup = buildBackup({
    research: addNotebook(EMPTY_LIBRARY, 'Turkey inflation')!.lib,
    watchRules: [RULE],
    workspace: { [AI_KEY]: JSON.stringify({ providerMode: 'gemini' }) },
  });
  const { savedCopy } = restoreBackup(files, backup, new Date('2026-11-05T13:00:00Z'));

  assert.deepEqual(loadLibrary(files.research).notebooks.map((n) => n.title), ['Turkey inflation']);
  assert.deepEqual(loadWatchRules(files.watchRules), [RULE]);
  const ws = loadWorkspace(files.workspace).values;
  assert.deepEqual(JSON.parse(ws[AI_KEY]), { providerMode: 'gemini', integrationConfig: { apiKey: 'LOCALKEY' } });
  assert.equal(ws['econquest.holdings.v1'], undefined, 'restore replaces, it does not merge');

  // The copy of what was there before can itself be restored.
  assert.equal(savedCopy, path.join('data', 'local', 'backups', 'before-restore-2026-11-05T13-00-00-000Z.json'));
  const copyFile = path.join(dir, 'local', 'backups', readdirSync(path.join(dir, 'local', 'backups'))[0]);
  const copy = parseBackup(readFileSync(copyFile, 'utf8'));
  assert.ok(copy.ok);
  if (copy.ok) {
    assert.deepEqual(copy.backup.contents.research.notebooks.map((n) => n.title), ['Old notebook']);
    assert.deepEqual(copy.summary.workspace, ['holdings', 'AI model settings']);
    assert.ok(!readFileSync(copyFile, 'utf8').includes('LOCALKEY'));
  }
  if (process.platform !== 'win32') assert.equal(statSync(copyFile).mode & 0o777, 0o600);
  assert.equal(currentBackup(files).contents.watchRules.length, 1);
});

test('policy reviews go in the backup and come back; an older backup without them leaves them alone', async () => {
  const { newReview, putReview, loadReviews, reviewFilePath } = await import('../src/utils/policyReviewStore.ts');
  const { dir, files } = setup();
  const withReviews = { ...files, reviews: reviewFilePath(dir) };
  const frame = { iso3: 'BRA', problem: 'Inflation is above target.', goal: { indicator: 'Inflation', direction: 'lower' as const }, constraints: [], asOf: '2026-11-01' };
  putReview(withReviews.reviews, newReview(frame, [], new Date('2026-11-05T00:00:00Z')));
  const backup = currentBackup(withReviews);
  assert.equal(backup.contents.reviews?.length, 1);
  const parsed = parseBackup(JSON.stringify(backup));
  assert.ok(parsed.ok);
  if (parsed.ok) assert.match(describeBackup(parsed.summary), /1 policy review/);
  // An older backup (no reviews field) keeps what is on this computer.
  const old = JSON.parse(JSON.stringify(backup));
  delete old.contents.reviews;
  const oldParsed = parseBackup(old);
  assert.ok(oldParsed.ok);
  if (oldParsed.ok) restoreBackup(withReviews, oldParsed.backup);
  assert.equal(loadReviews(withReviews.reviews).reviews.length, 1);
  // A backup with an empty list restores the empty list.
  if (parsed.ok) restoreBackup(withReviews, { ...parsed.backup, contents: { ...parsed.backup.contents, reviews: [] } });
  assert.equal(loadReviews(withReviews.reviews).reviews.length, 0);
});

test('answer snapshots go in the backup; restore adds the missing ones and never changes one already here', async () => {
  const { buildSnapshot, saveSnapshot, listSnapshotIds, loadSnapshot, snapshotDir } = await import('../src/utils/answerSnapshotStore.ts');
  const { dir, files } = setup();
  const withSnaps = { ...files, snapshots: snapshotDir(dir) };
  const snap = buildSnapshot({
    inputs: { question: 'Is Brazil tight?', earlier: [], askedAt: '2026-11-05T10:00:00.000Z', asOf: null, answers: [] },
    settings: { step: 'COUNCIL_SYNTHESIS', mode: 'summary', providerMode: 'ollama', model: 'qwen2.5:32b', temperature: 0, seed: 42, templateHash: 't', promptHash: 'p' },
    output: { provider: null, brief: null, removed: 0, contradicted: 0 },
    via: 'Council chat',
    now: new Date('2026-11-05T10:00:01Z'),
  });
  saveSnapshot(withSnaps.snapshots, snap);
  const backup = currentBackup(withSnaps);
  assert.equal(backup.contents.snapshots?.length, 1);
  const parsed = parseBackup(JSON.stringify(backup));
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.match(describeBackup(parsed.summary), /1 answer snapshot/);
  // On another computer: restored. Here: the one on disk stays as it is.
  const other = setup();
  const otherSnaps = { ...other.files, snapshots: snapshotDir(other.dir) };
  restoreBackup(otherSnaps, parsed.backup);
  assert.deepEqual(listSnapshotIds(otherSnaps.snapshots), [snap.id]);
  const tampered = structuredClone(parsed.backup);
  tampered.contents.snapshots![0].inputs.question = 'Changed';
  restoreBackup(otherSnaps, tampered);
  assert.equal(loadSnapshot(otherSnaps.snapshots, snap.id)!.inputs.question, 'Is Brazil tight?');
});
