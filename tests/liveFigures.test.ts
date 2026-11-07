import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasFigure, missingReason, missingSummary, toLive } from '../src/utils/liveFigures.ts';
import type { WatchlistItem } from '../src/types/council.ts';

const row = (o: Partial<WatchlistItem> = {}): WatchlistItem =>
  ({
    iso3: 'MEX', countryName: 'Mexico', region: '', currencyCode: 'MXN', focusTheme: '',
    yield10YPct: 9.1, cds5YBps: 120, debtToGdpPct: 55, fxReservesMonths: 4.6, cpiInflationPct: 4.8, policyRatePct: 9.15,
    ...o,
  }) as WatchlistItem;

test('a row with no recorded sources keeps no figures at all (old saved rows, the built-in catalogue)', () => {
  // Old saved rows may still carry the retired composite risk score: toLive drops it.
  const l = toLive(row({ compositeRisk: 0.47, alertStatus: 'ELEVATED' } as Partial<WatchlistItem>));
  for (const k of ['compositeRisk', 'alertStatus', 'riskSource']) assert.equal((l as Record<string, unknown>)[k], undefined, k);
  for (const k of ['yield10YPct', 'cds5YBps', 'debtToGdpPct', 'fxReservesMonths', 'cpiInflationPct', 'policyRatePct'] as const)
    assert.equal(l[k], undefined, k);
  assert.equal(l.countryName, 'Mexico');
});

test('figures from real sources stay: IMF, World Bank, official yield, your CDS; AI estimates do not', () => {
  const l = toLive(
    row({ debtSource: 'live', reservesSource: 'live', cpiSource: 'live', policyRateSource: 'ai_estimate', yield10YSource: 'official', yield10YPeriod: '2026-08', cds5YSource: 'own' })
  );
  assert.deepEqual(
    [l.debtToGdpPct, l.fxReservesMonths, l.cpiInflationPct, l.policyRatePct, l.yield10YPct, l.cds5YBps],
    [55, 4.6, 4.8, undefined, 9.1, 120]
  );
  // Sam, 23:27Z: AI web-search estimates count as missing.
  assert.equal(toLive(row({ cds5YSource: 'ai_estimate' })).cds5YBps, undefined);
  assert.equal(toLive(row({ yield10YSource: 'ai_estimate' })).yield10YPct, undefined);
  assert.equal(toLive(row({ yield10YSource: 'sample' })).yield10YPct, undefined);
  assert.equal(toLive(row({ cpiSource: 'sample' })).cpiInflationPct, undefined);
  // The BIS policy rate counts, with its date; any other policy-rate source drops the date too.
  const bis = toLive(row({ policyRateSource: 'bis', policyRateDate: '2026-10-27', policyRateBank: 'Bank of Mexico' }));
  assert.deepEqual([bis.policyRatePct, bis.policyRateDate, hasFigure(bis, 'policy')], [9.15, '2026-10-27', true]);
  assert.equal(toLive(row({ policyRateSource: 'sample', policyRateDate: '2026-10-27' })).policyRateDate, undefined);
});

test('missing reasons say whether to set something up or that a free feed did not answer', () => {
  assert.equal(missingReason('cds', 'MEX').kind, 'setup');
  assert.match(missingReason('cds', 'MEX').help, /Your own paid data/);
  assert.equal(missingReason('policy', 'MEX').short, 'BIS did not answer');
  assert.equal(missingReason('policy', 'MEX').kind, 'unreachable');
  assert.equal(missingReason('policy', 'EGY').short, 'Not in BIS policy rates');
  assert.doesNotMatch(missingReason('cds', 'MEX').help, /Gemini/);
  assert.equal(missingReason('debt', 'MEX').kind, 'unreachable');
  assert.equal(missingReason('yield', 'MEX').kind, 'unreachable'); // free FRED series exists
  assert.equal(missingReason('yield', 'EGY').kind, 'setup'); // no free series
  assert.equal(missingReason('yield', 'TUR').short, 'Needs EVDS key');
});

test('summary counts missing figures across the list, setup reason first', () => {
  const s = missingSummary([row({ cpiSource: 'live', iso3: 'MEX' }), row({ iso3: 'EGY' })]);
  const y = s.find((r) => r.key === 'yield')!;
  assert.equal(y.count, 2);
  assert.equal(y.reason.kind, 'setup'); // Egypt needs setup, which beats Mexico's feed outage
  assert.equal(s.find((r) => r.key === 'cpi')!.count, 1);
  assert.ok(hasFigure(row({ cds5YSource: 'own' }), 'cds'));
  assert.ok(!hasFigure(row({ cds5YSource: 'ai_estimate' }), 'cds'));
});

test('summary skips a figure every row has (a feed filled it for all of them) instead of crashing', () => {
  const s = missingSummary([row({ policyRateSource: 'bis', iso3: 'MEX' }), row({ policyRateSource: 'bis', iso3: 'BRA', countryName: 'Brazil' })]);
  assert.equal(s.find((r) => r.key === 'policy'), undefined);
  assert.equal(s.find((r) => r.key === 'yield')!.count, 2);
  // CDS is hidden for now (src/utils/cdsHidden.ts), so it is never listed as missing.
  assert.equal(s.find((r) => r.key === 'cds'), undefined);
});
