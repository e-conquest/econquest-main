import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countrySeries } from '../src/utils/seriesHistory';
import { parseQna, qnaReading, qnaSentence, qnaUrl, quarterKey } from '../src/utils/oecdQna';

const doc = (area: string, transformation: string, periods: string[], values: unknown[], extra: Record<string, string> = {}) => ({
  dimensions: { FREQ: 'Q', ADJUSTMENT: 'Y', REF_AREA: area, SECTOR: 'S1', TRANSACTION: 'B1GQ', UNIT_MEASURE: 'PC', PRICE_BASE: 'L', TRANSFORMATION: transformation, ...extra },
  period: periods,
  value: values,
});

const reply = JSON.stringify({
  series: {
    docs: [
      doc('BRA', 'G1', ['2025-Q3', '2025-Q4', '2026-Q1'], [0.1, 'NA', 0.4]),
      doc('BRA', 'GY', ['2025-Q3', '2025-Q4', '2026-Q1'], [2.2, 1.9, 2.0]),
      // Not the series the app reads: annual, and not seasonally adjusted.
      doc('BRA', 'G1', ['2024', '2025'], [3.0, 2.5], { FREQ: 'A' }),
      doc('MEX', 'G1', ['2026-Q1'], [9.9], { ADJUSTMENT: 'N' }),
      doc('USA', 'G1', ['2026Q1', '2026Q2'], [0.5, 0.7]),
    ],
  },
});

test('reads quarterly real GDP growth, keeping only seasonally adjusted quarterly B1GQ series and real values', () => {
  const s = parseQna(reply)!;
  assert.deepEqual(s.BRA.qoq, [{ period: '2025-Q3', value: 0.1 }, { period: '2026-Q1', value: 0.4 }]);
  assert.equal(s.BRA.yoy.length, 3);
  assert.equal(s.MEX, undefined);
  assert.deepEqual(s.USA.qoq.map((p) => p.period), ['2026-Q1', '2026-Q2']);
  assert.equal(parseQna('not json'), null);
  assert.equal(parseQna(JSON.stringify({ series: { docs: [] } })), null);
});

test('newest quarter reading and its sentence', () => {
  const r = qnaReading('BRA', parseQna(reply))!;
  assert.deepEqual(r, { iso3: 'BRA', quarter: '2026-Q1', qoqPct: 0.4, yoyPct: 2 });
  assert.equal(qnaSentence(r), 'Real GDP +0.4% q/q, +2.0% y/y (Q1 2026).');
  assert.equal(qnaReading('EGY', parseQna(reply)), null);
});

test('quarter keys and the DBnomics query', () => {
  assert.equal(quarterKey('2025Q3'), '2025-Q3');
  assert.equal(quarterKey('2025-q4'), '2025-Q4');
  assert.equal(quarterKey('2025-07'), null);
  const u = decodeURIComponent(qnaUrl({ areas: ['BRA'] }));
  assert.match(u, /DSD_NAMAIN1@DF_QNA_EXPENDITURE_GROWTH_OECD/);
  assert.match(u, /"TRANSACTION":\["B1GQ"\]/);
  assert.match(u, /"REF_AREA":\["BRA"\]/);
  assert.doesNotMatch(decodeURIComponent(qnaUrl({ wide: true })), /ADJUSTMENT/);
});

test('history: quarterly GDP series for a covered country, Missing with the reason otherwise', () => {
  const qna = { pulledAt: '2026-11-06T00:00:00Z', series: parseQna(reply)! };
  const bra = countrySeries('BRA', { qna });
  const s = bra.series.find((x) => x.id === 'gdp_qoq')!;
  assert.equal(s.freq, 'quarterly');
  assert.deepEqual(s.points.map((p) => p.date), ['2025-Q3', '2026-Q1']);
  const egy = countrySeries('EGY', { qna });
  assert.match(egy.missing.find((x) => x.id === 'gdp_qoq')!.reason, /publishes no quarterly GDP/);
  assert.match(countrySeries('BRA', {}).missing.find((x) => x.id === 'gdp_yoy_q')!.reason, /not answered/);
});
