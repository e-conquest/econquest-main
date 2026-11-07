import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflationExpectationSeries, monthEndPoints, parseFredApiObservations, US_INFLATION_EXPECTATION_IDS } from '../src/utils/inflationExpectations.ts';
import { countrySeries } from '../src/utils/seriesHistory.ts';

const pull = {
  fetchedAt: '2026-11-07T17:00:00Z',
  series: {
    T5YIE: [
      { date: '2026-09-29', value: 2.31 },
      { date: '2026-09-30', value: 2.33 },
      { date: '2026-10-30', value: 2.3 },
      { date: '2026-11-06', value: 2.29 },
    ],
    EXPINF1YR: [
      { date: '2026-09-01', value: 2.91 },
      { date: '2026-10-01', value: 2.97544 },
    ],
  },
};

test('the FRED API observations parse, skipping "." and keeping dates in order', () => {
  const json = { observations: [{ date: '2026-11-06', value: '2.17' }, { date: '2026-11-05', value: '.' }, { date: '2026-11-04', value: '2.20' }, { date: 'bad', value: '1' }] };
  assert.deepEqual(parseFredApiObservations(json), [{ date: '2026-11-04', value: 2.2 }, { date: '2026-11-06', value: 2.17 }]);
  assert.deepEqual(parseFredApiObservations({}), []);
});

test('daily series are shown at month-end and name the latest day', () => {
  assert.deepEqual(monthEndPoints(pull.series.T5YIE), [{ date: '2026-09', value: 2.33 }, { date: '2026-10', value: 2.3 }, { date: '2026-11', value: 2.29 }]);
  const set = inflationExpectationSeries('USA', pull);
  const be = set.find((s) => s.id === 'us_breakeven_5y')!;
  assert.ok('points' in be);
  assert.equal(be.points.length, 3);
  assert.match(be.about!, /latest day 2026-11-06: 2\.29%/);
  const cle = set.find((s) => s.id === 'us_expinf_1y')!;
  assert.ok('points' in cle);
  assert.deepEqual(cle.points.map((p) => p.date), ['2026-09', '2026-10']);
});

test('a series FRED did not answer is Missing with a reason, never a number', () => {
  const set = inflationExpectationSeries('USA', pull);
  const fwd = set.find((s) => s.id === 'us_5y5y_forward')!;
  assert.ok('reason' in fwd);
  assert.match(fwd.reason, /T5YIFR/);
  const none = inflationExpectationSeries('USA', null);
  assert.equal(none.length, US_INFLATION_EXPECTATION_IDS.length);
  assert.ok(none.every((s) => 'reason' in s && /FRED has not answered/.test(s.reason)));
});

test('only the United States gets these series; other countries are not cluttered', () => {
  assert.deepEqual(inflationExpectationSeries('BRA', pull), []);
  const us = countrySeries('USA', { inflationExpectations: pull });
  assert.ok(us.series.some((s) => s.id === 'us_breakeven_5y'));
  assert.ok(us.missing.some((m) => m.id === 'us_breakeven_10y'));
  assert.ok(!countrySeries('MEX', { inflationExpectations: pull }).series.some((s) => s.id.startsWith('us_')));
});
