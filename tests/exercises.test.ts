import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExercises, checkAnswer, inMonth, inYear } from '../src/utils/exercises.ts';
import type { Series } from '../src/utils/seriesHistory.ts';

const S = (id: string, unit: string, points: Array<[string, number, string?]>): Series =>
  ({ id, label: id, unit, freq: 'annual', source: `src ${id}`, points: points.map(([date, value, note]) => ({ date, value, ...(note ? { note } : {}) })) }) as Series;

const series = {
  policy_rate: S('policy_rate', '%', [['2024-11-28', 50], ['2024-12-02', 50], ['2024-12-27', 47.5]]),
  cpi_monthly: S('cpi_monthly', '%', [['2024-12', 44.4]]),
  cpi_imf: S('cpi_imf', '%', [['2024', 58.5], ['2025', 35, 'IMF projection']]),
  output_gap: S('output_gap', '% of potential GDP', [['2024', 1.2]]),
  yield_10y: S('yield_10y', '%', [['2024-12', 27]]),
  gdp_growth: S('gdp_growth', '%', [['2024', 3.2]]),
  debt_gdp: S('debt_gdp', '% of GDP', [['2023', 29.3], ['2024', 26.1]]),
};

test('answers come from the series at the date, with workings and inputs', () => {
  const r = buildExercises({ countryName: 'Turkey', month: '2024-12', series, target: { pct: 5, bank: 'CBRT' } });
  const by = Object.fromEntries(r.exercises.map((e) => [e.id, e]));
  assert.equal(by.real_rate.answer, 3.1); // 47.5 (last in December) - 44.4
  assert.equal(by.taylor.answer, 2 + 58.5 + 0.5 * 53.5 + 0.6);
  assert.match(by.taylor.workings, /actual policy rate at the end of 2024 was 47.5%/);
  // g = 1.032 x 1.585 - 1 = 63.572%; r - g = 27 - 63.57
  assert.equal(by.r_minus_g.answer, -36.57);
  assert.equal(by.debt_change.answer, -3.2);
  assert.equal(r.notSet.length, 0);
  assert.ok(checkAnswer(by.real_rate, 3.15) && !checkAnswer(by.real_rate, 3.3));
});

test('missing inputs leave the question unset, with why; projections and other years are not used', () => {
  const r = buildExercises({ countryName: 'Turkey', month: '2025-06', series });
  assert.equal(r.exercises.length, 0);
  const why = Object.fromEntries(r.notSet.map((n) => [n.id, n.reason]));
  assert.match(why.real_rate, /no policy rate on file for 2025-06/);
  assert.match(why.taylor, /no inflation target/);
  assert.match(why.debt_change, /no IMF debt ratio for 2025/);
  assert.equal(inYear(series.cpi_imf, '2025'), undefined);
  assert.equal(inMonth(series.policy_rate, '2024-12')!.value, 47.5);
});
