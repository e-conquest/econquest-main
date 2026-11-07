import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverLabel, debtPath, fiscalFromSnapshot, formatQuarter, stabilisingPrimaryBalance } from '../src/utils/fiscalDebt.ts';
import { planCouncil, runCouncil } from '../src/utils/askCouncil.ts';
import type { OpenDataSnapshot, WatchlistItem } from '../src/types/council.ts';

const snap = (o: Partial<OpenDataSnapshot> = {}): OpenDataSnapshot =>
  ({
    iso3: 'BRA',
    imfIndicators: {
      debtToGdpPct: 87.3,
      debtToGdpForecast2027Pct: 92.1,
      primaryFiscalBalancePct: -0.6,
      realGdpGrowthPct: 2.2,
      cpiInflationPct: 4.4,
      sourceUrl: '',
      years: { 'imf.debtToGdpPct': '2025', 'imf.debtToGdpForecast2027Pct': '2027', 'imf.primaryFiscalBalancePct': '2025', 'imf.realGdpGrowthPct': '2025' },
    },
    liveFields: { 'imf.debtToGdpPct': 'IMF WEO', 'imf.debtToGdpForecast2027Pct': 'IMF WEO forecast', 'imf.primaryFiscalBalancePct': 'IMF WEO', 'imf.realGdpGrowthPct': 'IMF WEO' },
    debtSchedule: {
      qeds: { asOf: '2026Q2', buckets: [], next12mUsdBn: 30 },
      ids: { years: [{ year: 2026, debtServiceUsdBn: 40 }, { year: 2027, debtServiceUsdBn: 45.5, principalUsdBn: 30 }] },
      bis: { intl: { asOf: '2026-Q2', outstandingUsdBn: 65.9, dueWithin1yUsdBn: 1.8 } },
      fetchedAt: '2026-11-05T00:00:00Z',
    },
    ...o,
  }) as unknown as OpenDataSnapshot;

test('fiscal figures come only from live feeds, each with its year', () => {
  const f = fiscalFromSnapshot(snap(), new Date('2026-11-05T00:00:00Z'))!;
  assert.deepEqual(f.debtPctGdp, { value: 87.3, year: '2025' });
  assert.deepEqual(f.debtProjectionPctGdp, { value: 92.1, year: '2027' });
  assert.deepEqual(f.extDue12m, { usdBn: 30, asOf: '2026Q2' });
  assert.deepEqual(f.idsNext, { year: 2027, debtServiceUsdBn: 45.5, principalUsdBn: 30 });
  assert.deepEqual(f.intlBonds, { usdBn: 65.9, due1yUsdBn: 1.8, asOf: '2026-Q2' });
  // A built-in IMF value (not marked live) or one without its year is left out.
  const notLive = fiscalFromSnapshot(snap({ liveFields: {}, debtSchedule: undefined }));
  assert.equal(notLive, undefined);
  const noYear = fiscalFromSnapshot(snap({ debtSchedule: undefined, imfIndicators: { ...snap().imfIndicators, years: {} } }));
  assert.equal(noYear, undefined);
});

test('stated rules: debt path, debt-stabilising primary balance, reserve cover', () => {
  assert.deepEqual(debtPath({ debtPctGdp: { value: 87.3, year: '2025' }, debtProjectionPctGdp: { value: 92.1, year: '2027' } })?.path, 'rising');
  assert.equal(debtPath({ debtPctGdp: { value: 50, year: '2025' }, debtProjectionPctGdp: { value: 51, year: '2027' } })?.path, 'stable');
  assert.equal(debtPath({ debtPctGdp: { value: 50, year: '2025' } }), undefined);
  // 87.3 × (0.05 − 0.022) / 1.022 = 2.39
  assert.equal(stabilisingPrimaryBalance(87.3, 5, 2.2).toFixed(2), '2.39');
  assert.equal(coverLabel(0.8), 'thin');
  assert.equal(coverLabel(2), 'adequate');
  assert.equal(coverLabel(12), 'ample');
  assert.equal(formatQuarter('2026Q2'), 'Q2 2026');
  assert.equal(formatQuarter('2026-Q2'), 'Q2 2026');
});

const row = (o: Partial<WatchlistItem> = {}): WatchlistItem =>
  ({
    iso3: 'BRA',
    countryName: 'Brazil',
    yield10YPct: 9.4,
    yield10YSource: 'official',
    yield10YPeriod: '2026-09',
    cpiInflationPct: 4.4,
    cpiSource: 'oecd',
    cpiMonth: '2026-04',
    fiscal: fiscalFromSnapshot(snap(), new Date('2026-11-05T00:00:00Z')),
    imf: { reserves: { usdBn: 363.1, period: '2026-09' }, pulledAt: '2026-11-05' },
    ...o,
  }) as unknown as WatchlistItem;

test('Fiscal & Debt Agent: asked on debt questions, answers from sourced figures with its rules shown', () => {
  const q = 'Is Brazil debt sustainable?';
  const plan = planCouncil(q, [row()]);
  assert.deepEqual(plan.agents.map((a) => a.id), ['fiscal']);
  const a = runCouncil(q, plan, [row()]).find((x) => x.id === 'fiscal')!;
  const f = a.findings[0];
  assert.match(f.reading, /Government debt is 87\.3% of GDP and the IMF projects it rising to 2027/);
  assert.match(f.reading, /short of the level that would hold debt steady/);
  assert.match(f.reading, /cover the government's external principal due in the next year 12\.1 times \(ample\)/);
  const by = (label: string) => f.figures.find((g) => g.label === label)!;
  assert.equal(by('Government debt').source, 'IMF World Economic Outlook, 2025');
  assert.equal(by('Government debt').tag, 'official');
  assert.equal(by('Primary balance that holds debt steady').tag, 'model');
  assert.equal(by('Primary balance that holds debt steady').value, '+2.4% of GDP'); // real rate 5.0, growth 2.2
  assert.equal(by('Government external principal due in the next 12 months').source, 'World Bank QEDS, from Q2 2026');
  assert.equal(by('Of which due within a year').value, '$1.8bn');
  assert.ok(f.figures.every((g) => g.tag === 'official' || g.tag === 'model'));
});

test('Fiscal & Debt Agent: says what is missing instead of filling it', () => {
  const none = runCouncil('debt', planCouncil('debt', [row({ fiscal: undefined })]), [row({ fiscal: undefined })])[0];
  assert.equal(none.findings.length, 0);
  assert.match(none.missing[0], /Brazil: no debt or fiscal figures/);
  const noYield = row({ yield10YPct: undefined, yield10YSource: undefined });
  const a = runCouncil('debt', planCouncil('debt', [noYield]), [noYield])[0];
  assert.ok(a.missing.some((m) => /no debt-stabilising primary balance, as a 10Y yield and inflation is missing/.test(m)));
  assert.ok(!a.findings[0].figures.some((g) => g.label === 'Primary balance that holds debt steady'));
});
