import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusSeries, parseEcbCsv, parseFocus12m, spfWorldSeries } from '../src/utils/inflationSurveys.ts';
import { countrySeries } from '../src/utils/seriesHistory.ts';

// Shaped like the ECB "csvdata" format (columns named in the header); values made up for the test.
const CSV = `KEY,FREQ,REF_AREA,FCT_TOPIC,FCT_BREAKDOWN,FCT_HORIZON,SURVEY_FREQ,FCT_SOURCE,TIME_PERIOD,OBS_VALUE,OBS_STATUS
SPF.Q.U2.HICP.POINT.LT.Q.AVG,Q,U2,HICP,POINT,LT,Q,AVG,2026-Q2,2.01,A
SPF.Q.U2.HICP.POINT.LT.Q.AVG,Q,U2,HICP,POINT,LT,Q,AVG,2026-Q3,2.04,A
SPF.Q.U2.HICP.POINT.LT.Q.AVG,Q,U2,HICP,POINT,LT,Q,AVG,2026-Q4,,M`;

test('ECB csvdata: TIME_PERIOD and OBS_VALUE found by name, quarters in the app format, blanks skipped', () => {
  assert.deepEqual(parseEcbCsv(CSV), [{ date: '2026Q2', value: 2.01 }, { date: '2026Q3', value: 2.04 }]);
  assert.deepEqual(parseEcbCsv('<html>Not found</html>'), []);
  assert.deepEqual(parseEcbCsv('A,B\n1,2'), []);
});

test('Focus: smoothed medians on the all-respondent base, one per date; other rows ignored', () => {
  const json = {
    value: [
      { Indicador: 'IPCA', Data: '2026-11-06', Suavizada: 'S', baseCalculo: 0, Media: 4.1, Mediana: 4.05 },
      { Indicador: 'IPCA', Data: '2026-11-06', Suavizada: 'N', baseCalculo: 0, Media: 4.2, Mediana: 4.15 },
      { Indicador: 'IPCA', Data: '2026-11-06', Suavizada: 'S', baseCalculo: 1, Media: 4.0, Mediana: 3.95 },
      { Indicador: 'IPCA', Data: '2026-10-30', Suavizada: 'S', baseCalculo: 0, Media: 4.12, Mediana: 4.1 },
      { Indicador: 'IGP-M', Data: '2026-10-30', Suavizada: 'S', baseCalculo: 0, Mediana: 5 },
    ],
  };
  assert.deepEqual(parseFocus12m(json), [{ date: '2026-10-30', value: 4.1 }, { date: '2026-11-06', value: 4.05 }]);
  assert.deepEqual(parseFocus12m({ value: [{ indicator: 'IPCA', date: '2026-11-06', median: 4 }] }), []);
  assert.deepEqual(parseFocus12m({ error: 'x' }), []);
});

test('Focus only on Brazil; a reply the app cannot read is Missing with the reason', () => {
  const surveys = { fetchedAt: '2026-11-07T17:00:00Z', spf: {}, focus: [{ date: '2026-10-30', value: 4.1 }, { date: '2026-11-06', value: 4.05 }] };
  const [f] = focusSeries('BRA', surveys);
  assert.ok('points' in f);
  assert.deepEqual(f.points, [{ date: '2026-10', value: 4.1 }, { date: '2026-11', value: 4.05 }]);
  assert.match(f.about!, /latest survey 2026-11-06: 4\.05%/);
  assert.deepEqual(focusSeries('MEX', surveys), []);
  const [m] = focusSeries('BRA', { ...surveys, focus: [], focusReason: 'The BCB Focus service answered HTTP 500' });
  assert.ok('reason' in m && /HTTP 500/.test(m.reason));
  assert.ok(countrySeries('BRA', { inflationSurveys: surveys }).series.some((s) => s.id === 'focus_ipca_12m'));
});

test('SPF world series: each series or Missing with the reason, never a number', () => {
  const set = spfWorldSeries({ fetchedAt: '2026-11-07T17:00:00Z', spf: { 'Q.U2.HICP.POINT.LT.Q.AVG': parseEcbCsv(CSV) }, focus: [] });
  const lt = set.find((s) => s.id === 'spf_hicp_lt')!;
  assert.ok('points' in lt && lt.freq === 'quarterly' && lt.points.length === 2);
  const y1 = set.find((s) => s.id === 'spf_hicp_1y')!;
  assert.ok('reason' in y1 && /P12M/.test(y1.reason));
  assert.ok(spfWorldSeries(null).every((s) => 'reason' in s));
});
