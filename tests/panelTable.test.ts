import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PANEL_FIGURES, MAX_PANEL_COUNTRIES, panelHistoryRows, panelLatest, panelLatestRows, PANEL_LATEST_HEADER, parseCountries, parseFigureIds } from '../src/utils/panelTable.ts';
import { countrySeries } from '../src/utils/seriesHistory.ts';
import { buildBaselineOpenData } from '../src/data/presetsAndBaselines.ts';

function mex() {
  const s = buildBaselineOpenData('MEX');
  s.liveFields = { 'market.sovereign10YBondYieldPct': 'Official' };
  s.monetaryAndMarket.sovereign10YBondYieldPct = 9.35;
  s.official10YYield = { valuePct: 9.35, period: '2026-09' } as any;
  return s;
}
const cbpol = { pulledAt: '2026-11-05T00:00:00Z', daily: { MX: { bank: 'Bank of Mexico', points: [{ period: '2026-10-27', pct: 6.5 }] } }, monthly: {} };

test('latest: live cells carry value, period and source; others are Missing with a reason and no number', () => {
  const data = [
    { iso3: 'MEX', snapshot: mex(), series: countrySeries('MEX', { cbpol }) },
    { iso3: 'EGY', snapshot: buildBaselineOpenData('EGY'), series: countrySeries('EGY', { cbpol }) },
  ];
  const cells = panelLatest(data, ['policy_rate', 'yield_10y', 'debt_gdp']);
  assert.equal(cells.length, 6);
  const get = (iso3: string, id: string) => cells.find((c) => c.iso3 === iso3 && c.figureId === id)!;
  assert.deepEqual([get('MEX', 'policy_rate').value, get('MEX', 'policy_rate').period], [6.5, '2026-10-27']);
  assert.match(get('MEX', 'policy_rate').source, /Bank of Mexico/);
  assert.deepEqual([get('MEX', 'yield_10y').value, get('MEX', 'yield_10y').period, get('MEX', 'yield_10y').source], [9.35, '2026-09', 'Official']);
  for (const c of [get('MEX', 'debt_gdp'), get('EGY', 'policy_rate'), get('EGY', 'yield_10y')]) {
    assert.equal(c.value, null);
    assert.equal(c.status, 'Missing');
    assert.ok(c.reason.length > 0);
  }
  assert.equal(get('EGY', 'policy_rate').reason, 'Not in BIS policy rates');
  for (const r of panelLatestRows(cells)) assert.equal(r.length, PANEL_LATEST_HEADER.length);
});

test('history: long-format rows for the chosen figures only', () => {
  const data = [{ iso3: 'MEX', snapshot: mex(), series: countrySeries('MEX', { cbpol }) }];
  const rows = panelHistoryRows(data, ['policy_rate']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][1], 'policy_rate');
  assert.equal(panelHistoryRows(data, ['cli']).length, 0);
});

test('parsing: known figures in panel order, defaults when none; countries cleaned and capped', () => {
  assert.deepEqual(parseFigureIds('debt_gdp,nonsense,policy_rate'), ['policy_rate', 'debt_gdp']);
  assert.deepEqual(parseFigureIds(''), DEFAULT_PANEL_FIGURES);
  assert.deepEqual(parseCountries('bra, MEX,bra,../x'), ['BRA', 'MEX', 'X']);
  assert.equal(parseCountries(Array.from({ length: 100 }, (_, i) => `C${i}`).join(',')).length, MAX_PANEL_COUNTRIES);
});
