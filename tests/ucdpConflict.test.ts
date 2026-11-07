/**
 * UCDP downloaded files: real rows from the 26.1 CSVs (tests/fixtures/ucdp/), read through the
 * same folder reader the app uses, zipped and unzipped.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { addUcdpCsv, detectDataset, emptyUcdpData, gwCell, parseCsv, ucdpFigures, ucdpInputLine, ucdpMissing, ucdpReading } from '../src/utils/ucdpConflict.ts';
import { UCDP_BUNDLED_DIR, loadUcdpFolder, ucdpData } from '../src/utils/ucdpStore.ts';
import { checkConnections } from '../src/utils/connectionCheck.ts';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ucdp');
const csvs = readdirSync(fixtures).filter((f) => f.endsWith('.csv'));

function folderWith(zipped: boolean): string {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ucdp-'));
  const dir = path.join(dataDir, 'local', 'ucdp');
  mkdirSync(dir, { recursive: true });
  for (const f of csvs) {
    if (zipped) writeFileSync(path.join(dir, f.replace('.csv', '-csv.zip')), zipSync({ [f]: strToU8(readFileSync(path.join(fixtures, f), 'utf8')) }));
    else cpSync(path.join(fixtures, f), path.join(dir, f));
  }
  return dataDir;
}

test('CSV reader keeps quoted commas and empty cells', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,"x, y",""\r\n2,,"say ""hi"""\n'), [['a', 'b', 'c'], ['1', 'x, y', ''], ['2', '', 'say "hi"']]);
  assert.deepEqual(gwCell('750, 770, 999'), { iso3: ['IND', 'PAK'], unknown: [999] });
  // States that no longer exist count under today's country: South Vietnam with Vietnam once.
  assert.deepEqual(gwCell('816, 817, 680, 751'), { iso3: ['VNM', 'YEM', 'IND'], unknown: [] });
});

test('each UCDP file is recognised by its columns', () => {
  const kinds = csvs.map((f) => detectDataset(parseCsv(readFileSync(path.join(fixtures, f), 'utf8'))[0])).sort();
  assert.deepEqual(kinds, ['acd', 'brd', 'dyadic', 'nonstate', 'onesided']);
  assert.equal(detectDataset(['iso3', 'date', 'value']), null);
});

test('zipped and unzipped downloads read the same, with real 2025 figures', () => {
  const a = loadUcdpFolder(path.join(folderWith(false), 'local', 'ucdp'))!;
  const b = ucdpData(folderWith(true), null)!;
  assert.deepEqual(a.countries, b.countries);
  assert.equal(a.files.acd?.version, '26.1');
  assert.equal(a.files.brd?.maxYear, 2025);
  const ukr = ucdpReading(a, 'UKR')!;
  assert.equal(ukr.latest.year, 2025);
  assert.equal(ukr.latest.stateBased?.best, 94741, 'battle deaths where the battles were (BattleDeaths_v26_1_conf.csv)');
  assert.equal(ukr.latest.conflicts?.wars, 1);
  assert.deepEqual(ukr.missingDatasets, []);
  const mex = ucdpReading(a, 'MEX')!;
  assert.equal(mex.latest.nonState?.best, 7775);
  assert.equal(mex.latest.conflicts?.n, 0, 'no state-based conflict in Mexico: a real zero');
  const rus = ucdpReading(a, 'RUS')!;
  assert.ok((rus.latest.abroad?.n || 0) > 0 && rus.latest.abroad!.places.includes('Mali'), 'Russia as a supporting side in Mali');
});

test('figures and council line name UCDP, its release and the scope; a missing file is named', () => {
  const data = emptyUcdpData();
  for (const f of csvs.filter((x) => !x.startsWith('OneSided'))) addUcdpCsv(data, f, readFileSync(path.join(fixtures, f), 'utf8'));
  const r = ucdpReading(data, 'UKR')!;
  const out = ucdpFigures(r);
  assert.ok(out.figures.some((f) => f.label === 'Conflict intensity, 2025' && f.value === 'war' && f.tag === 'model'));
  assert.ok(out.figures.every((f) => /UCDP|Rule:/.test(f.source)));
  assert.equal(r.latest.totalBest, undefined, 'no total without the one-sided file');
  assert.ok(out.missing[0].includes('One-Sided'));
  assert.equal(out.weight, 0.8);
  const line = ucdpInputLine(r, ucdpMissing(data, 'UKR'));
  assert.match(line, /^- UCDP conflict, 2025: 1 armed conflicts/);
  assert.match(line, /not added: UCDP One-Sided Violence/);
});

test('Missing with the reason: no files, Hong Kong, a country with no code', () => {
  assert.equal(ucdpReading(null, 'BRA'), null);
  assert.match(ucdpInputLine(null, ucdpMissing(null, 'BRA')), /MISSING \(UCDP files not added\)/);
  assert.equal(ucdpMissing(null, 'HKG').short, 'not a separate country in UCDP');
  assert.equal(ucdpMissing(null, 'ZZZ').short, 'no UCDP country code for this country in the app');
  assert.equal(loadUcdpFolder(path.join(tmpdir(), 'no-such-ucdp-folder')), null);
});

test('an older release next to a newer one is skipped', () => {
  const data = emptyUcdpData();
  const text = readFileSync(path.join(fixtures, 'NonState_v26_1.csv'), 'utf8');
  addUcdpCsv(data, 'NonState_v26_1.csv', text);
  assert.equal(addUcdpCsv(data, 'NonState_v25_1.csv', text.replace(/,26\.1$/gm, ',25.1')), null);
  assert.match(data.skipped[0].reason, /newer/);
});

test('data check: needs setup without files, connected with the releases read', async () => {
  const none = await checkConnections({ env: {}, only: ['ucdp'], ucdp: () => null });
  assert.equal(none.results[0].state, 'needs_setup');
  const dataDir = folderWith(true);
  const ok = await checkConnections({ env: {}, only: ['ucdp'], ucdp: () => ucdpData(dataDir, null) });
  assert.equal(ok.results[0].state, 'connected');
  assert.match(ok.results[0].detail, /UCDP\/PRIO Armed Conflict Dataset 26\.1/);
  assert.match(ok.results[0].sample || '', /^Brazil 2025/);
});

test('the release shipped in datasets/ucdp/ reads all five files and matches the fixture rows', () => {
  const data = loadUcdpFolder(UCDP_BUNDLED_DIR)!;
  assert.deepEqual(Object.keys(data.files).sort(), ['acd', 'brd', 'dyadic', 'nonstate', 'onesided']);
  assert.ok(Object.values(data.files).every((f) => f!.version === '26.1' && f!.maxYear === 2025));
  assert.deepEqual(data.skipped, []);
  assert.deepEqual(data.unknownCodes, {}, 'every Gleditsch-Ward code in the release has a country');
  const ukr = ucdpReading(data, 'UKR')!;
  assert.equal(ukr.latest.stateBased?.best, 94741);
  assert.equal(ucdpReading(data, 'MEX')!.latest.nonState?.best, 7775);
  // A copy of the same release in data/local/ucdp/ is skipped, not counted twice.
  const both = ucdpData(folderWith(true))!;
  assert.equal(ucdpReading(both, 'UKR')!.latest.stateBased?.best, 94741);
  assert.equal(both.skipped.length, 5);
});
