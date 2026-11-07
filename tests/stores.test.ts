import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadLibrary, researchFilePath, saveLibrary } from '../src/utils/researchStore.ts';
import { loadWatchRules, saveWatchRules, watchRulesFilePath } from '../src/utils/watchRulesStore.ts';
import { gdeltToneShift, toneTurn, GDELT_MIN_EARLIER_DAYS } from '../src/utils/gdeltTone.ts';

const fresh = () => mkdtempSync(path.join(tmpdir(), 'econquest-store-'));

test('research library: a missing or broken file reads as empty, never throws', () => {
  const dir = fresh();
  const file = researchFilePath(dir);
  assert.equal(file, path.join(dir, 'local', 'research.json'));
  assert.deepEqual(loadLibrary(file), { briefs: [], docs: [], notebooks: [], episodes: [], councilDocs: [] });
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '{not json');
  assert.deepEqual(loadLibrary(file), { briefs: [], docs: [], notebooks: [], episodes: [], councilDocs: [] });
});

test('research library: save then load round-trips, file is private and no temp file is left', () => {
  const dir = fresh();
  const file = researchFilePath(dir);
  const lib = loadLibrary(file);
  saveLibrary(file, lib);
  assert.deepEqual(loadLibrary(file), lib);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(path.dirname(file)), ['research.json']);
});

test('watch rules: save then load keeps valid rules and drops bad ones', () => {
  const dir = fresh();
  const file = watchRulesFilePath(dir);
  assert.deepEqual(loadWatchRules(file), [], 'no file yet');
  const good = { id: 'r1', iso3: '*', metric: 'policy_rate', op: '>=', value: 10, createdAt: '2026-11-05T00:00:00Z' } as const;
  saveWatchRules(file, [good]);
  assert.deepEqual(loadWatchRules(file), [good]);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  // A hand-edited file with a made-up metric and a non-number threshold keeps only the good rule.
  writeFileSync(file, JSON.stringify({ rules: [good, { ...good, id: 'r2', metric: 'nonsense' }, { ...good, id: 'r3', value: 'ten' }] }));
  assert.deepEqual(loadWatchRules(file).map((r) => r.id), ['r1']);
  writeFileSync(file, 'garbage');
  assert.deepEqual(loadWatchRules(file), []);
  assert.match(readFileSync(file, 'utf8'), /garbage/, 'a bad file is left for the user, not overwritten on read');
});

const series = (values: number[], start = '2026-08-01') =>
  values.map((v, i) => {
    const d = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
    return { date: `${d}T000000Z`, value: v };
  });

test('GDELT tone: too short a timeline gives no shift', () => {
  assert.equal(gdeltToneShift(series(Array(7 + GDELT_MIN_EARLIER_DAYS - 1).fill(-1))), null);
  assert.equal(gdeltToneShift(null), null);
  assert.equal(gdeltToneShift('x'), null);
});

test('GDELT tone: averages, shift, dates and the turn wording', () => {
  const s = gdeltToneShift(series([...Array(21).fill(-1), ...Array(7).fill(1)]))!;
  assert.equal(s.earlier, -1);
  assert.equal(s.recent, 1);
  assert.equal(s.shift, 2);
  assert.equal(s.earlierDays, 21);
  assert.equal(s.earlierFrom, '2026-08-01');
  assert.equal(s.recentTo, '2026-08-28');
  assert.equal(toneTurn(s.shift), 'turning more positive');
  assert.equal(toneTurn(-0.99), 'steady');
  assert.equal(toneTurn(-1), 'turning more negative');
});

test('GDELT tone: points without a number are skipped, not read as zero', () => {
  const pts = [...series(Array(21).fill(-2)), { date: '20260822T000000Z', value: null }, ...series(Array(7).fill(-2), '2026-08-23')];
  const s = gdeltToneShift(pts)!;
  assert.equal(s.earlier, -2);
  assert.equal(s.recent, -2);
  assert.equal(s.shift, 0);
});
