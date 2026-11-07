import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isSnapshotId, modelFromProvider, summariseSnapshot, type SnapshotInputs, type SnapshotSettings } from '../src/utils/answerSnapshot.ts';
import { buildSnapshot, listSnapshotIds, loadSnapshot, saveSnapshot, verifySnapshot } from '../src/utils/answerSnapshotStore.ts';

const inputs: SnapshotInputs = {
  question: 'Is Brazil behind the curve?',
  earlier: [],
  askedAt: '2026-11-05T10:00:00.000Z',
  asOf: null,
  answers: [
    {
      id: 'cb',
      name: 'Central Bank Watcher',
      why: 'inflation',
      findings: [{ iso3: 'BRA', countryName: 'Brazil', reading: 'Policy looks tight.', figures: [{ label: 'Policy rate', value: '13.75%', source: 'BIS policy rates, Oct 2026', tag: 'official' }], weight: 0.5 }],
      missing: [],
    },
  ] as SnapshotInputs['answers'],
};
const settings: SnapshotSettings = { step: 'COUNCIL_SYNTHESIS', mode: 'summary', providerMode: 'ollama', model: 'qwen2.5:32b', temperature: 0, seed: 42, templateHash: 'a'.repeat(64), promptHash: 'b'.repeat(64) };
const output = { provider: 'Local Ollama (qwen2.5:32b · Referee)', brief: { headline: 'Brazil looks tight.', points: [], disagreements: [], gaps: [] }, removed: 0, contradicted: 0 };

test('the same inputs hash the same; a changed figure or instruction changes the inputs hash', () => {
  const a = buildSnapshot({ inputs, settings, output, via: 'Council chat', now: new Date('2026-11-05T10:00:01Z') });
  const b = buildSnapshot({ inputs, settings, output, via: 'Council chat', now: new Date('2026-11-06T10:00:01Z') });
  assert.equal(a.inputsHash, b.inputsHash);
  assert.notEqual(a.id, b.id);
  assert.ok(isSnapshotId(a.id));
  const moved = structuredClone(inputs);
  moved.answers[0].findings[0].figures[0].value = '14.25%';
  assert.notEqual(buildSnapshot({ inputs: moved, settings, output, via: 'x' }).inputsHash, a.inputsHash);
  assert.notEqual(buildSnapshot({ inputs, settings: { ...settings, templateHash: 'c'.repeat(64) }, output, via: 'x' }).inputsHash, a.inputsHash);
  assert.deepEqual(a.figures, [{ iso3: 'BRA', agent: 'Central Bank Watcher', label: 'Policy rate', value: '13.75%', source: 'BIS policy rates, Oct 2026', tag: 'official' }]);
});

test('saved snapshots load back, verify, and an edit after saving shows', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'snap-'));
  const s = buildSnapshot({ inputs, settings, output, via: 'Council chat', now: new Date('2026-11-05T10:00:01Z') });
  const first = saveSnapshot(dir, s);
  const second = saveSnapshot(dir, s);
  assert.equal(first.id, s.id);
  assert.equal(second.id, `${s.id}x`);
  assert.equal(readdirSync(dir).length, 2);
  assert.deepEqual(listSnapshotIds(dir), [`${s.id}x`, s.id]);
  const back = loadSnapshot(dir, s.id)!;
  assert.deepEqual(verifySnapshot(back), []);
  back.output.brief!.headline = 'Brazil looks loose.';
  assert.deepEqual(verifySnapshot(back), ['output']);
  assert.equal(loadSnapshot(dir, '../etc/passwd'), null);
  const sum = summariseSnapshot(s);
  assert.equal(sum.model, 'qwen2.5:32b');
  assert.deepEqual(sum.agents, ['Central Bank Watcher']);
});

test('modelFromProvider reads the model tag', () => {
  assert.equal(modelFromProvider('Local Ollama (qwen2.5:32b · Referee)'), 'qwen2.5:32b');
  assert.equal(modelFromProvider('Google Gemini (gemini-3.8-flash)'), 'gemini-3.8-flash');
  assert.equal(modelFromProvider(undefined), null);
});

test('compareRuns names what changed: model, figures, sentences', async () => {
  const { compareRuns } = await import('../src/utils/answerSnapshot.ts');
  const a = buildSnapshot({ inputs, settings, output, via: 'x', documents: [] });
  const moved = structuredClone(inputs);
  moved.answers[0].findings[0].figures[0].value = '14.25%';
  const out2 = { ...output, brief: { headline: 'Brazil looks very tight.', points: ['Policy rate 14.25%.'], disagreements: [], gaps: [] } };
  const b = buildSnapshot({ inputs: moved, settings: { ...settings, model: 'gemma4:31b' }, output: out2, via: 'x' });
  const c = compareRuns({ snapshot: summariseSnapshot(a), brief: output.brief }, { snapshot: summariseSnapshot(b), brief: out2.brief, provider: 'p' });
  assert.equal(c.sameAnswer, false);
  assert.equal(c.headlineChanged, true);
  assert.deepEqual(c.pointsAdded, ['Policy rate 14.25%.']);
  assert.deepEqual(c.figuresChanged.map((f) => [f.label, f.before, f.after]), [['Policy rate', '13.75%', '14.25%']]);
  assert.ok(c.notes.some((n) => /qwen2.5:32b then, gemma4:31b now/.test(n)));
  const same = compareRuns({ snapshot: summariseSnapshot(a), brief: output.brief }, { snapshot: summariseSnapshot(a), brief: output.brief });
  assert.deepEqual(same.notes, ['Same answer, word for word.']);
});
