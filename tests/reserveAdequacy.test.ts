import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveAdequacy, reserveAdequacySentence } from '../src/utils/reserveAdequacy.ts';

const series = (id: string, pts: Array<[string, number, boolean?]>) => ({
  id,
  label: id,
  unit: 'x',
  freq: 'annual' as const,
  source: `src ${id}`,
  points: pts.map(([date, value, proj]) => ({ date, value, ...(proj ? { note: 'IMF projection' } : {}) })),
});

test('ARA without other liabilities: both weightings, upper bound, traditional ratios', () => {
  const r = reserveAdequacy({
    reservesUsd: series('res', [['2023', 40], ['2024', 50]]),
    shortTermDebtUsd: series('std', [['2023', 40], ['2024', 50]]),
    broadMoneyGdp: series('bm', [['2023', 50], ['2024', 50]]),
    exportsUsd: series('x', [['2023', 80], ['2024', 100]]),
    gdpUsd: series('gdp', [['2023', 360], ['2024', 400], ['2026', 450, true]]),
    reservesMonths: series('m', [['2024', 4.2]]),
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  const l = r.latest;
  assert.equal(l.year, 2024);
  assert.equal(l.broadMoneyUsdBn, 200);
  // floating: 0.3*50 + 0.05*200 + 0.05*100 = 30; fixed: 15 + 20 + 10 = 45
  assert.equal(l.metricFloating, 30);
  assert.equal(l.metricFixed, 45);
  assert.equal(l.ratioFloatingMax, 166.7);
  assert.equal(l.ratioFixedMax, 111.1);
  assert.equal(r.reading, 'unknown');
  assert.equal(r.reservesToShortTermDebt?.pct, 100);
  assert.equal(r.reservesToBroadMoney?.pct, 25);
  assert.equal(r.monthsOfImports?.value, 4.2);
  assert.match(reserveAdequacySentence(r, 'Testland'), /does not show adequacy/);
});

test('ARA: under 100% even on the partial metric reads as below; Missing names what is absent', () => {
  const r = reserveAdequacy({
    reservesUsd: series('res', [['2024', 20]]),
    shortTermDebtUsd: series('std', [['2024', 50]]),
    broadMoneyGdp: series('bm', [['2024', 50]]),
    exportsUsd: series('x', [['2024', 100]]),
    gdpUsd: series('gdp', [['2024', 400]]),
  });
  assert.ok(r.ok && r.reading === 'below');
  if (r.ok) assert.match(reserveAdequacySentence(r, 'X'), /under the 100% floor/);
  const none = reserveAdequacy({ reservesUsd: series('res', [['2024', 20]]) });
  assert.equal(none.ok, false);
  if (!none.ok) assert.match(none.reason, /short-term external debt/);
});
