import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carryToVol, effrSourceText, frankfurterSeriesUrl, parseEffr, parseFredDff, parseFxVol, parseReer, reerLabel, reerUrl } from '../src/utils/fxValuation.ts';
import { carrySignal, fxValueSignal } from '../src/utils/divergences.ts';
import type { WatchlistItem } from '../src/types/council.ts';

const HEAD = 'FREQ,EER_TYPE,EER_BASKET,REF_AREA,UNIT_MEASURE,TIME_FORMAT,COLLECTION,TITLE_TS,TIME_PERIOD,OBS_VALUE,OBS_STATUS,OBS_CONF,OBS_PRE_BREAK';
const row = (p: string, v: string | number) => `M,R,B,BR,882,,A,Brazil - Real - Broad (64 economies),${p},${v},A,F,`;
const months = (n: number, v: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => row(`${2016 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, v(i)));

test('URLs: BIS real broad index from ten years back; Frankfurter USD crosses on the .dev host', () => {
  assert.equal(reerUrl('BR', new Date('2026-11-04T00:00:00Z')), 'https://stats.bis.org/api/v1/data/WS_EER/M.R.B.BR/all?startPeriod=2016-11&format=csv');
  assert.match(frankfurterSeriesUrl('ZAR', new Date('2026-11-04T00:00:00Z')), /^https:\/\/api\.frankfurter\.dev\/v1\/2026-07-27\.\.2026-11-04\?from=USD&to=ZAR$/);
});

test('real exchange rate gap against the 10-year average; needs five years', () => {
  const r = parseReer([HEAD, ...months(120, (i) => (i === 119 ? 117.18 : 100))].join('\n'))!;
  assert.equal(r.period, '2025-12');
  assert.equal(r.latest, 117.18);
  assert.equal(r.gapPct, 17); // 117.18 / 100.14 - 1
  assert.equal(reerLabel(r.gapPct), 'strong');
  assert.equal(parseReer([HEAD, ...months(59, () => 100)].join('\n')), null);
  assert.equal(parseReer('not csv'), null);
  assert.equal(reerLabel(-4), 'near average');
});

test('three-month volatility from daily rates, annualised; too few days gives none', () => {
  const rates: Record<string, { ZAR: number }> = {};
  for (let i = 0; i < 60; i++) rates[`2026-08-${String(i + 1).padStart(2, '0')}`] = { ZAR: i % 2 ? 18.18 : 18 };
  const v = parseFxVol({ rates }, 'ZAR')!;
  assert.equal(v.days, 60);
  assert.ok(v.volPct > 14 && v.volPct < 17, String(v.volPct)); // ~1% daily swings
  assert.equal(parseFxVol({ rates: { '2026-08-01': { ZAR: 18 } } }, 'ZAR'), null);
  assert.equal(parseFxVol({ rates }, 'CLP'), null); // not covered
});

test('EFFR and carry-to-volatility', () => {
  assert.deepEqual(parseEffr({ refRates: [{ effectiveDate: '2026-11-03', percentRate: 3.83 }] }), { pct: 3.83, date: '2026-11-03', source: 'nyfed' });
  assert.equal(parseEffr({}), null);
  assert.deepEqual(carryToVol(11.75, 3.83, 12), { carryPts: 7.92, ratio: 0.66 });
  assert.equal(carryToVol(5, 3.83, 0), null);
});

test('fed funds from FRED (DFF) when the New York Fed is down: latest dated value, labelled as such', () => {
  const csv = 'observation_date,DFF\n2026-11-03,3.83\n2026-11-04,3.84\n2026-11-05,.\n';
  assert.deepEqual(parseFredDff(csv), { pct: 3.84, date: '2026-11-04', source: 'fred' });
  assert.equal(parseFredDff('<html>error</html>'), null);
  assert.equal(parseFredDff('observation_date,DFF\n2026-11-04,99\n'), null);
  assert.equal(effrSourceText({ source: 'fred', date: '2026-11-04' }), 'NY Fed via FRED (DFF), 2026-11-04');
  assert.equal(effrSourceText({ source: 'nyfed', date: '2026-11-04' }), 'NY Fed, 2026-11-04');
  assert.equal(effrSourceText({}), 'NY Fed');
});

test('ranked list: currency far from its average, and carry that pays for its swings', () => {
  const it = (o: Partial<WatchlistItem>) => ({ iso3: 'BRA', countryName: 'Brazil', compositeRisk: 0.5, cds5YBps: 150, yield10YPct: 13, ...o }) as WatchlistItem;
  const weak = fxValueSignal(it({ reerGapPct: -18, reerPeriod: '2026-09' }))!;
  assert.equal(weak.label, 'Currency weak for its history');
  assert.equal(weak.quality, 'live');
  assert.match(weak.headline, /18% below its 10-year average \(Sep 2026\)/);
  assert.equal(fxValueSignal(it({ reerGapPct: 6 })), null);
  const carry = carrySignal(it({ policyRatePct: 14.25, usFedFundsPct: 3.83, fxVol3mPct: 12 }))!;
  assert.equal(carry.label, 'Carry pays for the swings');
  assert.equal(carry.quality, 'sample'); // policy rate is a sample figure here
  assert.equal(carrySignal(it({ policyRatePct: 5, usFedFundsPct: 3.83, fxVol3mPct: 12 })), null);
});
