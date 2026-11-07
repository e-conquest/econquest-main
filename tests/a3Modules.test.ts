import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crashSentence, crashStats, type FxMonth } from '../src/utils/fxFactors.ts';
import { impliedDefaultPct, impliedDefaultSeries } from '../src/utils/impliedDefault.ts';
import { cashflows, presentValue, restructuring } from '../src/utils/restructuring.ts';

const row = (month: string, net: number): FxMonth => ({ month, long: [], short: [], gross: net, cost: 0, net, turnover: 0 });

test('carry crash statistics: drawdown, worst month and three months, skew, share negative', () => {
  const nets = [1, 1, 1, 1, -5, -5, 2, 1, 1, 1, 1, 1];
  const rows = nets.map((v, i) => row(`2020-${String(i + 1).padStart(2, '0')}`, v));
  const c = crashStats(rows)!;
  // Peak after April (1.01^4), trough after June: 0.95 x 0.95 - 1 = -9.75%.
  assert.equal(c.maxDrawdownPct, -9.75);
  assert.equal(c.drawdownFrom, '2020-04');
  assert.equal(c.drawdownTo, '2020-06');
  assert.deepEqual(c.worstMonth, { month: '2020-05', netPct: -5 });
  assert.equal(c.worst3mPct, Number(((1.01 * 0.95 * 0.95 - 1) * 100).toFixed(3)));
  assert.ok(c.skew < 0);
  assert.equal(c.negativeMonthsPct, Number(((2 / 12) * 100).toFixed(3)));
  assert.match(crashSentence(c), /description, not part of the test/);
  assert.equal(crashStats(rows.slice(0, 11)), null);
});

test('spread-implied default probability: credit triangle, 40% recovery, 5 years', () => {
  // 300 bp: intensity 0.03 / 0.6 = 5% a year; 1 - exp(-0.25) = 22.1%.
  assert.equal(impliedDefaultPct(300), 22.1);
  assert.equal(impliedDefaultPct(0), 0);
  assert.equal(impliedDefaultPct(-10), undefined);
  assert.equal(impliedDefaultPct(300, 1), undefined);
  const s = impliedDefaultSeries({ id: 'hc_spread', label: 'x', unit: 'bp', freq: 'monthly', source: 'BCRP', points: [{ date: '2026-09', value: 300 }] });
  assert.ok('points' in s && s.points[0].value === 22.1 && /risk-neutral|Risk-neutral/.test(s.about || ''));
  const m = impliedDefaultSeries({ id: 'hc_spread', label: 'x', reason: 'No free official source publishes it for this country' });
  assert.ok('reason' in m && /Needs the USD bond spread/.test(m.reason));
});

test('restructuring calculator: par bond at its coupon is worth 100; face and NPV haircuts', () => {
  const bullet = { face: 100, couponPct: 5, years: 10, graceYears: 9 };
  assert.equal(Math.round(presentValue(cashflows(bullet), 5) * 1e6) / 1e6, 100);
  const same = restructuring({ oldBond: bullet, newBond: bullet, exitYieldPct: 5 })!;
  assert.equal(same.npvHaircutPct, 0);
  const half = restructuring({ oldBond: bullet, newBond: { ...bullet, face: 50 }, exitYieldPct: 5 })!;
  assert.equal(half.npvHaircutPct, 50);
  assert.equal(half.faceHaircutPct, 50);
  assert.equal(half.marketHaircutPct, 50);
  // Amortising after 2 grace years: principal in equal parts over the last 3 years.
  assert.deepEqual(cashflows({ face: 90, couponPct: 0, years: 5, graceYears: 2 }), [0, 0, 30, 30, 30]);
  // A longer, lower-coupon bond at a high exit yield loses value even with no face cut.
  const ext = restructuring({ oldBond: bullet, newBond: { face: 100, couponPct: 3, years: 20, graceYears: 10 }, exitYieldPct: 10 })!;
  assert.ok(ext.npvHaircutPct > 0 && ext.faceHaircutPct === 0);
  assert.equal(restructuring({ oldBond: bullet, newBond: { ...bullet, face: 0 }, exitYieldPct: 5 }), null);
});
