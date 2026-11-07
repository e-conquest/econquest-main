import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerCsvRows, ledgerRows, ledgerSummary, LEDGER_HEADER } from '../src/utils/testLedger.ts';
import { holmReadings, testsOnRecord } from '../src/utils/multipleTesting.ts';

const bt = (id: string, specVersion: number, status: 'passed' | 'failed', pValue: number) => ({
  id,
  specVersion,
  specHash: `hash${id}${specVersion}`,
  ranAt: '2026-11-01T00:00:00Z',
  status,
  verdict: `${id} v${specVersion} ${status}.`,
  pValue,
});

test('test ledger: every version, latest flagged, Holm and grade per row, forecasts and signals', () => {
  const v = {
    results: { taylor_gap: bt('taylor_gap', 2, 'failed', 0.4), cycle_clock: bt('cycle_clock', 1, 'passed', 0.001) },
    versions: { 'taylor_gap v1': bt('taylor_gap', 1, 'failed', 0.3), 'taylor_gap v2': bt('taylor_gap', 2, 'failed', 0.4) },
    specs: [{ id: 'cycle_clock', version: 1, registeredOn: '2026-11-04', hash: 'x', file: 'cycle_clock.json' }],
    forecasts: { gdp_nowcast: { id: 'gdp_nowcast', status: 'passed' as const, verdict: 'Beats naive.', specVersion: 1, specHash: 'fh', ranAt: '2026-11-02T00:00:00Z' } },
    forecastTests: [
      { id: 'gdp_nowcast', version: 1, p: 0.01, alpha: 0.05, status: 'passed' as const },
      { id: 'fx_carry', version: 1, p: 0.03, alpha: 0.05, status: 'passed' as const },
    ],
  };
  const holm = holmReadings(testsOnRecord({ ...v.versions, cycle_clock: v.results.cycle_clock }, () => 0.05, v.forecastTests));
  const rows = ledgerRows(v, holm, new Date('2026-11-07T00:00:00Z'));
  assert.deepEqual(rows.map((r) => r.key), ['cycle_clock v1', 'taylor_gap v2', 'taylor_gap v1', 'forecast gdp_nowcast v1', 'forecast fx_carry v1']);
  const cc = rows[0];
  assert.equal(cc.registeredOn, '2026-11-04');
  assert.equal(cc.holmP, 0.005);
  assert.equal(cc.holds, true);
  assert.equal(cc.grade?.grade, 'validated');
  assert.equal(rows[1].latest, true);
  assert.equal(rows[2].latest, false);
  assert.equal(rows[2].grade, undefined);
  assert.equal(rows[3].kind, 'forecast');
  assert.equal(rows[3].verdict, 'Beats naive.');
  const fx = rows[4];
  assert.equal(fx.kind, 'signal');
  assert.equal(fx.holds, false); // 5 x 0.03 = 0.15 > 0.05 after Holm
  assert.equal(fx.grade?.grade, 'provisional');
  assert.equal(fx.ranAt, undefined); // no saved verdict for this id: left blank, not invented
  const csv = ledgerCsvRows(rows);
  assert.ok(csv.every((r) => r.length === LEDGER_HEADER.length));
  assert.equal(csv[2][3], 'no');
  assert.match(ledgerSummary(rows), /^5 tests on record .*3 passed as registered, 2 hold after the Holm correction/);
  assert.deepEqual(ledgerRows(null, new Map()), []);
  assert.match(ledgerSummary([]), /No pre-registered test/);
});
