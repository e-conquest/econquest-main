import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bisCreditGapUrl, bisCreditSeries, bisDsrUrl, bisPropertyUrl, parseBisCreditGap, parseBisDsr, parseBisProperty } from '../src/utils/bisCreditCycle.ts';
import { countrySeries } from '../src/utils/seriesHistory.ts';

// Rows as the BIS answered on 2026-11-07 (Brazil).
const GAP = `FREQ,BORROWERS_CTY,TC_BORROWERS,TC_LENDERS,CG_DTYPE,COLLECTION,DECIMALS,UNIT_MEASURE,UNIT_MULT,TIME_FORMAT,TITLE_TS,TIME_PERIOD,OBS_VALUE,OBS_STATUS,OBS_CONF,OBS_PRE_BREAK
Q,BR,P,A,C,E,1,770,0,,,2025-Q4,1.7781,A,F,
Q,BR,P,A,C,E,1,770,0,,,2026-Q1,0.7199,A,F,
Q,BR,P,A,B,E,1,770,0,,,2025-Q4,91.2526,A,F,
Q,BR,P,A,B,E,1,770,0,,,2026-Q1,91.8091,A,F,
Q,BR,P,A,A,E,1,770,0,,,2025-Q4,93.030679486621,A,F,
Q,BR,P,A,A,E,1,770,0,,,2026-Q1,92.528995240837,A,F,`;
const DSR = `FREQ,BORROWERS_CTY,DSR_BORROWERS,COLLECTION,UNIT_MEASURE,UNIT_MULT,DECIMALS,TITLE_TS,TIME_PERIOD,OBS_VALUE,OBS_CONF,OBS_PRE_BREAK,OBS_STATUS
Q,BR,P,,367,0,1,Brazil - Private non-financial sector,2025-Q4,29.3,F,,A
Q,BR,P,,367,0,1,Brazil - Private non-financial sector,2026-Q1,29.8,F,,A`;
const SPP = `FREQ,REF_AREA,VALUE,UNIT_MEASURE,UNIT_MULT,BREAKS,COVERAGE,TITLE_TS,TIME_PERIOD,OBS_VALUE,OBS_STATUS,OBS_CONF,OBS_PRE_BREAK
Q,BR,R,628,0,,,,2026-Q1,92.2275,A,F,
Q,BR,R,628,0,,,,2026-Q2,91.6772,A,F,
Q,BR,R,771,0,,,,2026-Q1,0.9362,A,F,
Q,BR,R,771,0,,,,2026-Q2,0.6215,A,F,
Q,BR,N,628,0,,,,2026-Q1,221.6281,A,F,
Q,BR,N,771,0,,,,2026-Q2,5.2362,A,F,`;

test('parsers: gap is C (= ratio A minus trend B), DSR private sector, real house prices y/y', () => {
  const g = parseBisCreditGap(GAP);
  assert.deepEqual(g.creditGap, { '2025Q4': 1.7781, '2026Q1': 0.7199 });
  assert.equal(g.creditToGdp?.['2025Q4'], 93.0307);
  assert.ok(Math.abs(93.030679 - 91.2526 - 1.7781) < 1e-3);
  assert.deepEqual(parseBisDsr(DSR).dsr, { '2025Q4': 29.3, '2026Q1': 29.8 });
  assert.deepEqual(parseBisProperty(SPP).realHousePricesYoy, { '2026Q1': 0.9362, '2026Q2': 0.6215 });
  assert.deepEqual(parseBisCreditGap('not csv'), {});
  assert.deepEqual(parseBisDsr(null), {});
  assert.match(bisCreditGapUrl('BR'), /WS_CREDIT_GAP\/Q\.BR\.P\.A\.\/all\?format=csv$/);
  assert.match(bisDsrUrl('BR'), /WS_DSR\/Q\.BR\.\.\/all/);
  assert.match(bisPropertyUrl('BR'), /WS_SPP\/Q\.BR\.\.\/all/);
});

test('series: quarterly, oldest first; Missing says why', () => {
  const cycle = { fetchedAt: '2026-11-07T05:00:00Z', ...parseBisCreditGap(GAP), ...parseBisDsr(DSR) };
  const out = bisCreditSeries(cycle, true);
  const gap = out.find((s) => s.id === 'credit_gap');
  assert.ok(gap && 'points' in gap);
  assert.equal(gap.freq, 'quarterly');
  assert.deepEqual(gap.points.map((p) => p.date), ['2025Q4', '2026Q1']);
  const hp = out.find((s) => s.id === 'house_prices_real_yoy');
  assert.ok(hp && 'reason' in hp && /publishes no real house prices/.test(hp.reason));
  assert.ok(bisCreditSeries(null, true).every((s) => 'reason' in s && s.reason === 'The BIS has not answered yet'));
  assert.ok(bisCreditSeries(cycle, false).every((s) => 'reason' in s && /Not a BIS reporting country/.test(s.reason)));
});

test('country series include the credit cycle for a BIS country', () => {
  const set = countrySeries('BRA', { bisCredit: { fetchedAt: '2026-11-07T05:00:00Z', ...parseBisCreditGap(GAP) } });
  assert.ok(set.series.some((s) => s.id === 'credit_gap' && s.source === 'BIS credit-to-GDP gaps'));
  assert.ok(set.missing.some((s) => s.id === 'debt_service_ratio'));
});
