import test from 'node:test';
import assert from 'node:assert/strict';
import { beer, beerSentence } from '../src/utils/beer.ts';

const years = Array.from({ length: 25 }, (_, k) => 1998 + k);
const wob = (y: number, a: number) => Math.sin(y * a);

function inputs(gapLast = 0) {
  const tot = years.map((y) => ({ date: String(y), value: 100 * Math.exp(0.1 * wob(y, 0.9)) }));
  const gdp = years.map((y) => ({ date: String(y), value: 20000 * Math.exp(0.02 * (y - 1998) + 0.05 * wob(y, 1.3)) }));
  const us = years.map((y) => ({ date: String(y), value: 50000 * Math.exp(0.01 * (y - 1998)) }));
  const ca = years.map((y) => ({ date: String(y), value: 2 * wob(y, 0.5) }));
  // REER built exactly from the fundamentals: ln REER = 4 + 0.5 ln ToT + 0.3 ln(gdp/us) + 0.2 NFA/100.
  let nfa = 0;
  const level = new Map<string, number>();
  years.forEach((y, k) => {
    nfa += ca[k].value;
    level.set(String(y), Math.exp(4 + 0.5 * Math.log(tot[k].value) + 0.3 * Math.log(gdp[k].value / us[k].value) + (0.2 * nfa) / 100 + 0.001 * wob(y, 2.1)));
  });
  const reerMonthly = years.flatMap((y) => Array.from({ length: 12 }, (_, m) => ({ period: `${y}-${String(m + 1).padStart(2, '0')}`, value: level.get(String(y))! })));
  reerMonthly.push({ period: '2023-03', value: level.get('2022')! * Math.exp(gapLast / 100) });
  return { reerMonthly, tot, gdpPcPpp: gdp, usGdpPcPpp: us, currentAccount: ca };
}

test('BEER recovers the coefficients and reads the latest gap against the latest fair value', () => {
  const r = beer(inputs(10));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.ok(Math.abs(r.coef[0].beta - 0.5) < 0.02, String(r.coef[0].beta));
  assert.ok(Math.abs(r.coef[1].beta - 0.3) < 0.02, String(r.coef[1].beta));
  assert.ok(r.coef.every((c) => c.signOk));
  assert.equal(r.n, 25, 'only complete years count (2023 has one month)');
  assert.equal(r.latest.month, '2023-03');
  assert.equal(r.latest.fairValueYear, '2022');
  assert.ok(Math.abs(r.latest.gapPct - 10) < 0.5, String(r.latest.gapPct));
  assert.match(beerSentence('Testland', r), /(9\.\d|10\.\d)% above the BEER fair value for 2022 \(dear/);
});

test('BEER says what is missing, and needs 15 years', () => {
  const m = beer({ ...inputs(), tot: [] });
  assert.equal(m.ok, false);
  if (!m.ok) assert.match(m.reason, /terms of trade/);
  const short = inputs();
  const s = beer({ ...short, tot: short.tot.slice(-10) });
  assert.equal(s.ok, false);
  if (!s.ok) assert.match(s.reason, /Only 10 years/);
});
