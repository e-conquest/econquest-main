import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFedBalanceSheet, parseFredCsvSeries, type Obs } from '../src/utils/fedBalanceSheet.ts';

/** Weekly Wednesdays from a start date. */
function weeks(start: string, n: number, f: (i: number) => number): Obs[] {
  return Array.from({ length: n }, (_, i) => ({ date: new Date(Date.parse(start) + i * 7 * 86400000).toISOString().slice(0, 10), value: f(i) }));
}

test('FRED CSV: both header styles; "." and blanks skipped; sorted oldest first', () => {
  const a = parseFredCsvSeries('observation_date,WALCL\n2026-10-28,6600000\n2026-10-21,.\n2026-10-14,6610000\n');
  assert.deepEqual(a, [
    { date: '2026-10-14', value: 6610000 },
    { date: '2026-10-28', value: 6600000 },
  ]);
  assert.equal(parseFredCsvSeries('DATE,WALCL\n2026-10-28,1\n').length, 1);
  assert.deepEqual(parseFredCsvSeries('<html>not a csv</html>'), []);
});

test('units: millions become billions; 4- and 52-week changes from the matching week', () => {
  const walcl = weeks('2025-10-29', 53, (i) => 7_000_000 - i * 10_000); // millions
  const sheet = buildFedBalanceSheet({ WALCL: walcl, WRESBAL: weeks('2025-10-29', 53, () => 3000), WTREGEN: weeks('2025-10-29', 53, () => 800_000), RRPONTSYD: weeks('2025-10-29', 53, () => 100) });
  const a = sheet.lines.find((l) => l.id === 'WALCL')!;
  assert.equal(a.latest?.value, 6480);
  assert.equal(a.latest?.date, walcl[52].date);
  assert.equal(a.change4w, -40);
  assert.equal(a.change52w, -520);
  assert.ok('value' in sheet.netLiquidity);
  if ('value' in sheet.netLiquidity) {
    assert.equal(sheet.netLiquidity.value, 6480 - 800 - 100);
    assert.equal(sheet.netLiquidity.date, walcl[52].date);
    assert.equal(sheet.netLiquidity.change4w, -40);
  }
});

test('a series that did not load reads Missing with the reason, and net liquidity says what it lacks', () => {
  const sheet = buildFedBalanceSheet({ WALCL: weeks('2026-09-02', 9, () => 6_600_000), WRESBAL: null, WTREGEN: weeks('2026-09-02', 9, () => 800_000), RRPONTSYD: null });
  const res = sheet.lines.find((l) => l.id === 'WRESBAL')!;
  assert.equal(res.latest, undefined);
  assert.match(res.missing!, /FRED did not answer/);
  assert.ok('missing' in sheet.netLiquidity);
  if ('missing' in sheet.netLiquidity) assert.match(sheet.netLiquidity.missing, /reverse repos/);
});

test('net liquidity needs all three parts on the same Wednesday', () => {
  const sheet = buildFedBalanceSheet({
    WALCL: [{ date: '2026-10-28', value: 6_600_000 }],
    WTREGEN: [{ date: '2026-10-21', value: 800_000 }],
    RRPONTSYD: [{ date: '2026-10-28', value: 100 }],
  });
  assert.ok('missing' in sheet.netLiquidity);
});
