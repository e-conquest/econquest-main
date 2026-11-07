import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asOfRows, parseAsOfDate } from '../src/utils/asOf.ts';

// Rows as csvExport.figureRows writes them (FIGURES_HEADER order).
const row = (field: string, value: number | null, status: 'Live' | 'Missing', period = '', source = '', reason = '') => ['BRA', 'Brazil', field, field, value, '%', status, period, source, reason, '2026-11-05'];

test('pairs then and now by field; change only when both sides are live', () => {
  const then = [row('a', 13.75, 'Live', '2026-09', 'BIS'), row('b', null, 'Missing', '', '', 'Needs setup')];
  const now = [row('a', 14.25, 'Live', '2026-10', 'BIS'), row('b', 5, 'Live', '2025', 'IMF WEO'), row('c', 2, 'Live')];
  const r = asOfRows(then, now);
  assert.deepEqual(r.map((x) => [x.field, x.change]), [['a', 0.5], ['b', null], ['c', null]]);
  assert.deepEqual([r[0].then.period, r[0].now.period], ['2026-09', '2026-10']);
  assert.equal(r[1].then.reason, 'Needs setup');
  assert.equal(r[2].then.reason, 'not in this pull');
});

test('dates: only real YYYY-MM-DD days', () => {
  assert.equal(parseAsOfDate('2026-11-05'), '2026-11-05');
  assert.equal(parseAsOfDate('2026-02-30'), null);
  assert.equal(parseAsOfDate('2026-11'), null);
  assert.equal(parseAsOfDate(undefined), null);
});
