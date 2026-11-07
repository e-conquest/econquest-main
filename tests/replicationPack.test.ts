import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { computeChart, type ChartRequest } from '../src/utils/councilChart.ts';
import { packSettings, replicationPack, replicationZip } from '../src/utils/replicationPack.ts';

let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
const months = Array.from({ length: 180 }, (_, k) => `${2010 + Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`);
const pa: Array<{ date: string; value: number }> = [];
const pb: Array<{ date: string; value: number }> = [];
let a = 5;
let b = 2;
months.forEach((m, k) => {
  a += rnd();
  b = 0.6 * b + 0.3 * a + rnd();
  pa.push({ date: m, value: a });
  if (k % 17 !== 3) pb.push({ date: m, value: b });
});
const req: ChartRequest = {
  series: [
    { iso3: 'TUR', countryName: 'Turkey', id: 'policy_rate', label: 'Policy rate' },
    { iso3: 'TUR', countryName: 'Turkey', id: 'cpi_monthly', label: 'Inflation' },
  ],
  tests: ['summary', 'correlation', 'regression', 'leadlag', 'granger', 'rolling', 'adf', 'hp'],
  transform: 'level',
  why: 'test',
  notes: [],
};
const result = computeChart(req, [
  { id: 'policy_rate', label: 'Policy rate', unit: '%', freq: 'monthly', source: 'BIS policy rates', points: pa },
  { id: 'cpi_monthly', label: 'Inflation', unit: '%', freq: 'monthly', source: 'IMF World Economic Outlook', points: pb },
]);
const fig = (title: RegExp, label: RegExp) => result.tests.find((t) => title.test(t.title))?.figures.find((f) => label.test(f.label))?.value;

test('settings match the ones the app used for its tests', () => {
  const s = packSettings(result);
  assert.equal(String(s.pairs), fig(/^Correlation/, /Points/));
  assert.equal(String(s.grangerLags), fig(/Granger/, /^Lags/));
  assert.equal(String(s.rollingWindow), fig(/rolling/, /Window/));
  assert.equal(String(s.hpLambda), fig(/HP filter/, /λ/));
  assert.equal(s.leadLagMax, 18);
});

test('the pack holds the data without trend lines, three scripts and the app figures', () => {
  const p = replicationPack(result, new Date('2026-11-07T00:00:00Z'));
  assert.deepEqual(Object.keys(p.files).sort(), ['README.md', 'data.csv', 'replicate.R', 'replicate.do', 'replicate.py']);
  const csv = p.files['data.csv'].trim().split('\n');
  assert.equal(csv[0], 'date,s0,s1');
  assert.equal(csv.length, 181);
  assert.ok(csv.some((r) => r.endsWith(',')), 'a row where the second line has no value is left blank');
  assert.equal(p.tests.length, 8);
  for (const f of ['replicate.py', 'replicate.R', 'replicate.do']) {
    assert.match(p.files[f], /\b6\b/, `${f} carries the Granger lags`);
    assert.match(p.files[f], /\b36\b/, `${f} carries the rolling window`);
    assert.match(p.files[f], /129600/, `${f} carries the HP lambda`);
  }
  // Stata syntax the script relies on: operator ranges written L(1/p)D.x, negative lags inside the string, scalars by scalar().
  const doFile = p.files['replicate.do'];
  assert.match(doFile, /L\(1\/`p'\)D\.s0/);
  assert.doesNotMatch(doFile, /\)\.D\./);
  assert.match(doFile, /display "lag `k': r = "/);
  assert.match(doFile, /scalar\(T\)/);
  assert.match(p.files['README.md'], /Source: BIS policy rates/);
  assert.match(p.files['README.md'], /Correlation \(r\): 0\.95/);
  assert.match(p.files['README.md'], /2026-11-07/);
});

test('tests not asked for are left out of the scripts', () => {
  const r = computeChart({ ...req, tests: ['correlation'] }, [
    { id: 'policy_rate', label: 'Policy rate', unit: '%', freq: 'monthly', source: 'BIS policy rates', points: pa },
    { id: 'cpi_monthly', label: 'Inflation', unit: '%', freq: 'monthly', source: 'IMF', points: pb },
  ]);
  const p = replicationPack(r);
  assert.deepEqual(p.tests, ['correlation']);
  assert.doesNotMatch(p.files['replicate.py'], /granger|adf\(|LAMBDA/);
  assert.doesNotMatch(p.files['replicate.do'], /testparm|tsfilter/);
});

test('across countries: country, x, y and the two cross-section tests', () => {
  const cross = {
    title: 'Yield against debt, across countries',
    freq: 'annual',
    transform: 'level',
    lines: [],
    scatter: { xLabel: 'Government debt', yLabel: '10Y yield', pairs: [{ date: 'Brazil', x: 80, y: 12 }, { date: "Cote d'Ivoire, Rep.", x: 55, y: 7 }] },
    sources: ['IMF World Economic Outlook'],
    tests: [{ test: 'regression', title: 'Regression across countries', reading: 'r', figures: [] }],
    missing: [],
    notes: [],
  } as unknown as Parameters<typeof replicationPack>[0];
  const p = replicationPack(cross);
  assert.equal(p.settings, null);
  assert.deepEqual(p.tests, ['regression']);
  assert.equal(p.files['data.csv'], 'country,x,y\nBrazil,80,12\n"Cote d\'Ivoire, Rep.",55,7\n');
  assert.match(p.files['replicate.R'], /lm\(y ~ x/);
  assert.doesNotMatch(p.files['replicate.R'], /cor\.test/);
});

test('the zip unpacks to the same files in one folder', () => {
  const files = unzipSync(replicationZip(result));
  const names = Object.keys(files).sort();
  assert.equal(names.length, 5);
  assert.ok(names.every((n) => n.startsWith('turkey-policy-rate-vs-turkey-inflation/')));
  assert.match(strFromU8(files[names.find((n) => n.endsWith('data.csv'))!]), /^date,s0,s1\n/);
});
