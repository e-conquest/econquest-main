import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { holm, holmReadings, holmSentence, testsOnRecord } from '../src/utils/multipleTesting.ts';

const close = (a: number | undefined, b: number, d = 1e-9) => assert.ok(a !== undefined && Math.abs(a - b) < d, `${a} vs ${b}`);

describe('Holm correction', () => {
  it('matches the textbook step-down', () => {
    // p = 0.01, 0.04, 0.03, 0.005 (m = 4): sorted 0.005, 0.01, 0.03, 0.04 -> 0.02, 0.03, 0.06, 0.06
    const a = holm([
      { key: 'a', p: 0.01 },
      { key: 'b', p: 0.04 },
      { key: 'c', p: 0.03 },
      { key: 'd', p: 0.005 },
    ]);
    close(a.get('d'), 0.02);
    close(a.get('a'), 0.03);
    close(a.get('c'), 0.06);
    close(a.get('b'), 0.06);
  });

  it('caps at 1 and treats a missing p as 1', () => {
    const a = holm([
      { key: 'x', p: 0.6 },
      { key: 'y', p: NaN },
    ]);
    assert.equal(a.get('x'), 1);
    assert.equal(a.get('y'), 1);
  });

  it('one test is left as it is', () => {
    close(holm([{ key: 'only', p: 0.03 }]).get('only'), 0.03);
  });
});

describe('tests on record', () => {
  const backtests = {
    'taylor_gap v1': { id: 'taylor_gap', specVersion: 1, status: 'failed' as const, pValue: 0.2, robustness: { pValue: 0.4 } },
    'taylor_gap v2': { id: 'taylor_gap', specVersion: 2, status: 'failed' as const, pValue: 0.3 },
    'cycle_clock v1': { id: 'cycle_clock', specVersion: 1, status: 'passed' as const, pValue: 0.001, robustness: { pValue: 0.004 } },
  };
  it('counts every version, takes the larger p, and keeps each pass mark', () => {
    const t = testsOnRecord(backtests, () => 0.05, [{ id: 'gdp_nowcast', version: 1, p: 0.02, alpha: 0.1, status: 'passed' }]);
    assert.equal(t.length, 4);
    assert.equal(t.find((x) => x.key === 'taylor_gap v1')!.p, 0.4);
    assert.equal(t.find((x) => x.key === 'cycle_clock v1')!.p, 0.004);
    const h = holmReadings(t);
    // 0.004 x 4 = 0.016 <= 0.05: holds; nowcast 0.02 x 3 = 0.06 <= 0.10: holds.
    assert.equal(h.get('cycle_clock v1')!.holds, true);
    close(h.get('forecast gdp_nowcast v1')!.adjusted, 0.06);
    assert.equal(h.get('forecast gdp_nowcast v1')!.holds, true);
    assert.equal(h.get('taylor_gap v2')!.holds, false);
    assert.match(holmSentence(h.get('cycle_clock v1')), /across 4 tests on record.*holds at its pass mark of 0.05/);
  });

  it('does not count the same version twice', () => {
    assert.equal(testsOnRecord({ a: backtests['taylor_gap v2'], b: backtests['taylor_gap v2'] }, () => undefined).length, 1);
  });
});
