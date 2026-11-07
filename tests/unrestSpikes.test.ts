/**
 * Unrest spikes (utils/unrestSpikes.ts) and the pre-registered unrest_onset test
 * (utils/backtest.ts unrestOnsetCases, utils/unrestOnset.ts onsetYears). Synthetic months only:
 * these check the arithmetic, not any country's history.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spikeMonths, spikeSentence, completeMonths } from '../src/utils/unrestSpikes.ts';
import { unrestOnsetCases, type BacktestSpec, type OnsetYear, type OpenCall } from '../src/utils/backtest.ts';
import { onsetYears } from '../src/utils/unrestOnset.ts';
import { emptyUcdpData } from '../src/utils/ucdpConflict.ts';
import type { V1Month, V1MonthPoint, V1Series } from '../src/utils/gdeltDaily.ts';

const ym = (i: number, start = 2016) => `${start + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

function point(month: string, protestPct: number, violencePct = 2): V1MonthPoint {
  return { month, events: 1000, sharePct: 1, protests: protestPct * 10, sanctions: 0, violence: violencePct * 10, protestPct, violencePct, goldsteinMean: 0, toneMean: 0 };
}

function series(protest: number[]): V1Series {
  return { iso3: 'XXX', points: protest.map((p, i) => point(ym(i), p)) };
}

test('no reading until a full two-year baseline', () => {
  assert.deepEqual(spikeMonths(series(Array(24).fill(5))), []);
  assert.equal(spikeMonths(series(Array(25).fill(5))).length, 1);
  assert.match(spikeSentence('Nowhere', []), /not enough GDELT months/);
});

test('a jump far above the past two years is a spike; a run counts as one episode', () => {
  const flat = Array.from({ length: 24 }, (_, i) => 5 + (i % 2 ? 0.1 : -0.1));
  const rows = spikeMonths(series([...flat, 9, 9.5, 5]));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].spikes, ['protests']);
  assert.deepEqual(rows[0].episodes, ['protests']);
  // The second month still spikes against its own baseline, but continues the run.
  assert.deepEqual(rows[1].spikes, ['protests']);
  assert.deepEqual(rows[1].episodes, []);
  assert.deepEqual(rows[2].spikes, []);
  assert.match(spikeSentence('Nowhere', rows), /1 spike episode in the last 24 months/);
});

test('the sd floor keeps a dead-flat history from turning a small move into a spike', () => {
  const rows = spikeMonths(series([...Array(24).fill(5), 5.5]));
  // sd 0 -> floor 0.25 -> z 2, under 3.
  assert.equal(rows[0].protestZ, 2);
  assert.deepEqual(rows[0].spikes, []);
});

test('a missing month breaks a run, so the next spike is a new episode', () => {
  const flat = Array.from({ length: 24 }, (_, i) => 5 + (i % 2 ? 0.1 : -0.1));
  const s = series([...flat, 9, 9, 9]);
  s.points.splice(25, 1); // drop the second spike month
  const rows = spikeMonths(s);
  assert.deepEqual(rows.map((r) => r.episodes.length), [1, 1]);
});

test('daily months short of files are not complete', () => {
  const p = { ...point('2020-02', 5), dailyFiles: 20, daysInMonth: 29 };
  assert.equal(completeMonths([p]).length, 0);
  assert.equal(completeMonths([{ ...p, dailyFiles: 28 }]).length, 1);
});

const spec: BacktestSpec = {
  id: 'unrest_onset', version: 1, registeredOn: '2026-11-06', registeredBy: 'test', hypothesis: 'test', method: 'unrest_onset',
  params: { baselineMonths: 24, zSpike: 3, sdFloorPts: 0.25, minMonthsInYear: 10 },
  sample: { from: '2018' }, passMark: { minCases: 30, minLiftPts: 3, maxPValue: 0.05 }, knownLimits: [], framework: 2,
};

const yr = (where: string, year: number, episodes: number, quiet: boolean, next: boolean | null, months = 12): OnsetYear =>
  ({ where, year, months, episodes: Array.from({ length: episodes }, (_, i) => `${year}-0${i + 1} protests`), quiet, next });

test('onset cases: quiet spike years are calls against a pooled base of every quiet year', () => {
  const open: OpenCall[] = [];
  const cases = unrestOnsetCases(spec, [
    yr('AAA', 2019, 1, true, true),
    yr('AAA', 2020, 0, true, false),
    yr('BBB', 2019, 0, true, false),
    yr('BBB', 2020, 2, true, false),
    yr('CCC', 2019, 1, false, true), // already in conflict: not a call, not in the base
    yr('DDD', 2019, 1, true, true, 8), // too few months
    yr('EEE', 2017, 1, true, true), // before the sample
    yr('AAA', 2025, 1, true, null), // outcome not out yet
  ], open);
  assert.equal(cases.length, 2);
  assert.ok(cases.every((c) => c.base === 0.25));
  assert.deepEqual(cases.map((c) => [c.where, c.when, c.hit]), [['AAA', '2019', true], ['BBB', '2020', false]]);
  assert.equal(open.length, 1);
  assert.equal(open[0].due, '2026');
});

test('onsetYears joins GDELT spike years to UCDP conflict located in the country', () => {
  const months: V1Month[] = [];
  for (let i = 0; i < 48; i++) {
    const month = ym(i);
    const pct = i === 30 ? 15 : 5 + (i % 2 ? 0.2 : -0.2);
    const n = 1000;
    months.push({ month, files: [`${month.replace('-', '')}.zip`], world: 100000, countries: {
      KEN: { n, quad: [0, 0, 0, 0], root: {}, protests: Math.round((pct * n) / 100), sanctions: 0, violence: 20, goldsteinSum: 0, toneSum: 0 } as never,
      ZZZ: { n, quad: [0, 0, 0, 0], root: {}, protests: 50, sanctions: 0, violence: 20, goldsteinSum: 0, toneSum: 0 } as never,
    } });
  }
  const ucdp = emptyUcdpData();
  ucdp.files.acd = { dataset: 'acd', file: 'acd.csv', version: 'test', rows: 1, minYear: 1946, maxYear: 2019 };
  ucdp.countries.KEN = { '2019': { conflicts: { n: 1, wars: 0, types: {}, opponents: [] } } };
  const years = onsetYears(months, ucdp);
  // ZZZ is no UCDP country; 2016-17 have no baseline; 2019 has no next year in the file.
  assert.deepEqual(years.map((y) => [y.where, y.year, y.quiet, y.next, y.episodes.length]), [
    ['KEN', 2018, true, true, 1],
    ['KEN', 2019, false, null, 0],
  ]);
});
