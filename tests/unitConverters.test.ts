import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertAll, perHead, toPpp, toReal, toUsd } from '../src/utils/unitConverters.ts';

const yr = (o: Record<string, number>) => Object.entries(o).map(([date, value]) => ({ date, value }));
const S = {
  cpi: yr({ '2015': 100, '2020': 150, '2025': 300 }),
  fx: yr({ '2020': 7.5, '2025': 30 }),
  ppp: yr({ '2025': 10 }),
  population: yr({ '2020': 84, '2025': 86 }),
};

test('each conversion uses the year asked for, with its factor and source', () => {
  const r = toReal(1000, '2020', '2025', S.cpi, 'TRY');
  assert.ok(r.ok && Math.abs(r.step.value - 2000) < 1e-9 && /CPI 2025 \(300\) \/ CPI 2020 \(150\)/.test(r.step.how));
  const u = toUsd(3000, '2025', S.fx);
  assert.ok(u.ok && u.step.value === 100 && /World Bank/.test(u.step.source));
  const p = toPpp(3000, '2025', S.ppp);
  assert.ok(p.ok && p.step.value === 300);
  const h = perHead(86e6, '2025', S.population, 'TRY');
  assert.ok(h.ok && h.step.value === 1);
});

test('a year with no figure is Missing with the years on file, never the nearest year', () => {
  const p = toPpp(1, '2020', S.ppp);
  assert.ok(!p.ok && /2020 not on file \(on file 2025 to 2025\)/.test(p.reason));
  const r = toReal(1, '2019', '2025', S.cpi, 'TRY');
  assert.ok(!r.ok && /2019/.test(r.reason));
  assert.ok(!toUsd(1, '2025', undefined).ok);
});

test('convertAll adds per head in US dollars when both figures are there', () => {
  const all = convertAll(86e6 * 30, '2025', '2025', S);
  const last = all[all.length - 1];
  assert.equal(all.length, 5);
  assert.ok(last.ok && last.step.label === 'Per head, US dollars' && Math.abs(last.step.value - 1) < 1e-9);
  // IMF projections are not used.
  assert.ok(!toUsd(1, '2026', [{ date: '2026', value: 9, note: 'IMF projection' }]).ok);
});
