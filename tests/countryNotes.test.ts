import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEconomistSections, economistBrief, sourceTag, ECONOMIST_SECTIONS } from '../src/utils/countryNotes.ts';
import { getSnapshotDataStatus } from '../src/utils/dataStatus.ts';
import { buildBaselineOpenData } from '../src/data/presetsAndBaselines.ts';
import type { CouncilAssessmentRun, OpenDataSnapshot } from '../src/types/council.ts';
import { FEED_PATHS, markLive } from './helpers/live.ts';

const NOW = new Date('2026-11-04T12:00:00Z');

function runFor(iso3: string, sources: string[], tweak: (s: OpenDataSnapshot) => void = () => {}): CouncilAssessmentRun {
  const openData = buildBaselineOpenData(iso3);
  openData.dataStatus = { verifiedLiveSources: sources, checkedAt: '2026-11-04T12:00:00Z' };
  tweak(openData);
  return { iso3, countryName: openData.countryName, openData } as unknown as CouncilAssessmentRun;
}

test('source tags: missing unless the feed answered; official yield names its date', () => {
  const none = getSnapshotDataStatus(runFor('MEX', []).openData);
  assert.deepEqual(sourceTag(none, 'imf'), { source: 'missing', verified: false });
  const live = runFor('MEX', ['IMF DataMapper WEO', 'World Bank Open Data v2', 'FRED / OECD 10Y government yield (monthly average)'], (s) => {
    s.official10YYield = { valuePct: 9.35, period: '2026-09', source: 'OECD via FRED', seriesId: 'S', url: 'u', frequency: 'monthly' };
  }).openData;
  const st = getSnapshotDataStatus(live);
  assert.deepEqual(sourceTag(st, 'imf'), { source: 'IMF WEO', verified: true });
  assert.deepEqual(sourceTag(st, 'yield'), { source: 'official, Sep 2026 avg', verified: true });
  assert.equal(sourceTag(st, 'market').verified, false);
});

test('no built-in figures: without live feeds every figure reads Missing with a reason, and the brief says so', () => {
  const b = economistBrief(runFor('BRA', []), NOW);
  assert.match(b.sampleWarning || '', /missing/);
  assert.match(b.headline, /no live economic figures yet/);
  assert.equal(b.judgements.length, 0, 'no observation is written from a missing figure');
  const rows = b.groups.flatMap((g) => g.rows).filter((r) => r.label !== 'Next rate decision' && r.label !== 'Next CPI release');
  for (const r of rows) {
    assert.equal(r.value, 'Missing', r.label);
    assert.ok(r.help && r.source, `${r.label} says why`);
  }
  // A figure the server marked live shows; the rest stay missing.
  const live = economistBrief(runFor('BRA', [], (s) => markLive(s)), NOW);
  const debt = live.groups.flatMap((g) => g.rows).find((r) => r.label === 'Debt / GDP')!;
  assert.equal(debt.verified, true);
  assert.notEqual(debt.value, 'Missing');
  const policy = live.groups.flatMap((g) => g.rows).find((r) => r.label === 'Policy rate')!;
  assert.equal(policy.value, 'Missing');
  assert.equal(policy.source, 'BIS did not answer');
});

test('AI web-search estimates count as missing', () => {
  const r = runFor('BRA', ['Gemini search grounding'], (s) => {
    s.liveFields = { 'market.policyRatePct': 'AI estimate', 'market.cds5YSpreadBps': 'AI estimate' };
  });
  const st = getSnapshotDataStatus(r.openData);
  assert.equal(st.isLive('market.policyRatePct'), false);
  assert.equal(st.live('market.cds5YSpreadBps'), undefined);
});

test('judgements follow the stated rules, on live figures only', () => {
  const tight = economistBrief(
    runFor('BRA', [], (s) => {
      markLive(s);
      s.imfIndicators.cpiInflationPct = 4;
      s.monetaryAndMarket.policyRatePct = 15;
      s.imfIndicators.realGdpGrowthPct = 1.2;
      s.worldBankIndicators.fxReservesMonthsImport = 2.1;
    }),
    NOW
  );
  assert.ok(tight.judgements.some((j) => j.startsWith('Growth is weak at 1.2%')));
  // The policy rate has no real source, so there is no reading on policy.
  assert.ok(!tight.judgements.some((j) => /Monetary policy|Real interest/.test(j)));
  assert.ok(tight.judgements.some((j) => j.includes('reserves below the usual three-month import floor')));
  const withRate = economistBrief(
    runFor('TUR', [], (s) => {
      markLive(s, [...FEED_PATHS, 'market.policyRatePct']);
      s.imfIndicators.cpiInflationPct = 40;
      s.monetaryAndMarket.policyRatePct = 30;
    }),
    NOW
  );
  assert.ok(withRate.judgements.some((j) => j.startsWith('Real interest rates are negative (-10.0%)')));
});

test('the next official rate decision comes from the calendar', () => {
  const policy = economistBrief(runFor('BRA', []), NOW).groups.find((g) => g.title === 'Monetary policy')!;
  const next = policy.rows.find((r) => r.label === 'Next rate decision')!;
  assert.match(next.value, /^\d{1,2} [A-Z][a-z]{2} 2026, (today|tomorrow|in \d+ days)$/);
  assert.equal(next.verified, true);
});

test('country note: all sections by default, switched-off sections left out', () => {
  const run = runFor('ZAF', []);
  const all = buildEconomistSections(run, () => true, NOW);
  assert.deepEqual(all.map((s) => s.id), Object.keys(ECONOMIST_SECTIONS));
  assert.ok(all[0].lines.some((l) => l.startsWith('**Note:**')), 'missing-figures note is in the summary');
  const some = buildEconomistSections(run, (id) => id !== 'external' && id !== 'risks', NOW);
  assert.ok(!some.some((s) => s.id === 'external' || s.id === 'risks'));
  const fiscal = all.find((s) => s.id === 'fiscal')!;
  assert.ok(fiscal.lines.every((l) => /: Missing \(.+\)$|\((IMF WEO|model, from figures above|official, .+)\)$/.test(l)), fiscal.lines.join('\n'));
});

test('saved figures carry their period: IMF figures name the WEO year, spot FX the day it was read', async () => {
  const { liveRow } = await import('../src/utils/countryNotes.ts');
  const run = runFor('BRA', ['IMF DataMapper WEO', 'ExchangeRate-API Spot FX (Live)'], (s) => {
    s.imfIndicators.cpiInflationPct = 5;
    s.imfIndicators.years = { 'imf.cpiInflationPct': '2025' };
    s.monetaryAndMarket.exchangeRatePerUsd = 5.469;
    s.fetchedAt = '2026-11-05T19:58:05.643Z';
    s.liveFields = { 'imf.cpiInflationPct': 'IMF WEO', 'market.exchangeRatePerUsd': 'ExchangeRate-API' };
  });
  const st = getSnapshotDataStatus(run.openData);
  assert.equal(liveRow(st, 'CPI', 'imf.cpiInflationPct', String, run.openData).source, 'IMF WEO, 2025');
  const fx = liveRow(st, 'FX', 'market.exchangeRatePerUsd', String, run.openData).source;
  assert.match(fx, /^FX spot, .*2026/);
  assert.doesNotMatch(fx, /live/);
});

test('IMF Fiscal Monitor and WEO extras (D5): shown when live, net interest = primary minus overall for the same year', () => {
  const rowsOf = (tweak: (s: OpenDataSnapshot) => void) => economistBrief(runFor('BRA', [], tweak), NOW).groups.flatMap((g) => g.rows);
  const live = rowsOf((s) => {
    s.imfIndicators.primaryFiscalBalancePct = 0.4;
    s.imfIndicators.overallBalancePct = -7.6;
    s.imfIndicators.revenuePct = 41.2;
    s.imfIndicators.unemploymentPct = 6;
    s.imfIndicators.currentAccountUsdBn = -61.3;
    s.imfIndicators.years = { 'imf.primaryFiscalBalancePct': '2025', 'imf.overallBalancePct': '2025' };
    s.liveFields = {
      'imf.primaryFiscalBalancePct': 'IMF WEO',
      'imf.overallBalancePct': 'IMF Fiscal Monitor',
      'imf.revenuePct': 'IMF Fiscal Monitor',
      'imf.unemploymentPct': 'IMF WEO',
      'imf.currentAccountUsdBn': 'IMF WEO',
    };
  });
  const row = (l: string) => live.find((r) => r.label === l)!;
  assert.equal(row('Net interest paid').value, '8.0% of GDP');
  assert.match(row('Net interest paid').source, /primary minus overall balance, IMF Fiscal Monitor 2025/);
  assert.equal(row('Revenue').verified, true);
  assert.equal(row('Unemployment rate').value, '6.0%');
  assert.equal(row('Current account, US dollars').value, '-US$61.3 bn');
  assert.equal(row('Expenditure').value, 'Missing');
  // Different years: no net interest.
  const mixed = rowsOf((s) => {
    s.imfIndicators.primaryFiscalBalancePct = 0.4;
    s.imfIndicators.overallBalancePct = -7.6;
    s.imfIndicators.years = { 'imf.primaryFiscalBalancePct': '2025', 'imf.overallBalancePct': '2024' };
    s.liveFields = { 'imf.primaryFiscalBalancePct': 'IMF WEO', 'imf.overallBalancePct': 'IMF Fiscal Monitor' };
  });
  const ni = mixed.find((r) => r.label === 'Net interest paid')!;
  assert.equal(ni.value, 'Missing');
  assert.equal(ni.source, 'Balances are for different years');
});
