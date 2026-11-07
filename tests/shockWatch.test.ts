import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shockSummary, shockWatch } from '../src/utils/shockWatch.ts';
import { priceShock, enrichTrade } from '../src/utils/scenarioExposure.ts';
import { shockRows } from '../src/utils/marketsMacro.ts';

const base = { iso3: 'EGY', countryName: 'Egypt', compositeRisk: 0.8 };

test('every rule fires on its inputs, alerts first, each naming its rule', () => {
  const it = {
    ...base,
    imf: {
      iso3: 'EGY',
      reserves: { key: 'r', period: '2026-09', usdBn: 20, change12mPct: -12 },
      monthsOfImports: 2.5,
      currentAccount4q: { usdBn: -20, through: '2026-Q2', pctGdp: -5.5 },
    },
    fiscal: { extDue12m: { usdBn: 15, asOf: '2026Q2' }, intlBonds: { usdBn: 40, due1yUsdBn: 8, asOf: '2026-Q2' } },
    yield10YChange3mPts: 1.2,
    yield10YPeriod: '2026-09',
    gdelt: { pulledAt: '2026-11-01T00:00:00Z', tone: -4, toneShift: { recent: -4, earlier: -2.5, shift: -1.5, earlierDays: 80 } },
  } as never;
  const s = shockWatch(it);
  const keys = s.warnings.map((w) => `${w.level}:${w.key}`);
  assert.deepEqual(keys, ['alert:debt_due', 'alert:reserves_falling', 'alert:import_cover', 'alert:external_gap', 'alert:yield_jump', 'watch:news_tone']);
  assert.match(s.warnings[0].detail, /cover 0\.9x the \$15\.0bn external principal .* plus \$8\.0bn international bonds/);
  assert.match(s.warnings[0].rule, /under 1x = alert/);
  assert.equal(shockSummary(s), '5 alerts, 1 watch');
  assert.ok(s.notChecked.some((n) => /terms-of-trade/.test(n)));
});

test('nothing fires on comfortable figures; missing inputs are listed, never filled', () => {
  const ok = shockWatch({ ...base, imf: { iso3: 'X', reserves: { key: 'r', period: '2026-09', usdBn: 300, change12mPct: 4 }, monthsOfImports: 9 } } as never);
  assert.equal(ok.warnings.length, 0);
  assert.match(shockSummary(ok), /^No warning on the checks that could run \(2 of 7\)$/);
  const none = shockWatch(base as never);
  assert.equal(none.notChecked.length, 7);
});

test('terms-of-trade swing uses the actual 3-month moves on the export mix and the fuel bill', () => {
  const trade = enrichTrade(
    { fuelImportsPctMerch: 10, fuelExportsPctMerch: 0, importsPctGdp: 30, exportsPctGdp: 40, wbYear: '2025' },
    { year: '2024', exportSharePct: {}, importSharePct: {}, exportMixPct: { '26': 50 }, productYear: '2024' },
    [
      { code: 'CRUDE_BRENT', source: 'pink_sheet', asOf: '2026-10', latest: 90, change3mPct: 20, change12mPct: 5 },
      { code: 'IRON_ORE', source: 'pink_sheet', asOf: '2026-10', latest: 80, change3mPct: -15, change12mPct: 0 },
    ]
  )!;
  assert.deepEqual(trade.priceMoves3m, { CRUDE_BRENT: 20, IRON_ORE: -15 });
  const shock = priceShock(trade, trade.priceMoves3m)!;
  {
    // Iron ore: 50% of exports x 40% of GDP x -15% = -3.0; fuel bill 3% of GDP x +20% = -0.6.
    assert.equal(shock.pctGdp, -3.6);
    const s = shockWatch({ ...base, trade } as never);
    const tot = s.warnings.find((w) => w.key === 'terms_of_trade')!;
    assert.equal(tot.level, 'alert');
    assert.match(tot.detail, /−3\.6% of GDP if prices held a year/);
  }
});

test('Country tab rows: summary first, warnings with their rule, then what was not checked', () => {
  const rows = shockRows({ ...base, yield10YChange3mPts: 0.6, yield10YPeriod: '2026-09' } as never);
  assert.equal(rows[0].label, 'Summary');
  assert.equal(rows[0].value, '1 watch');
  assert.match(rows[1].label, /^Watch: Sharp rise in the 10Y yield$/);
  assert.equal(rows[rows.length - 1].label, 'Not checked');
});
