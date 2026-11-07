import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOfficialSections,
  OFFICIAL_SECTIONS,
  officialBrief,
  projectDebt,
  standardScenarios,
  sustainabilitySignals,
} from '../src/utils/officialNote.ts';
import { buildBaselineOpenData } from '../src/data/presetsAndBaselines.ts';
import { fillTestValues, markLive } from './helpers/live.ts';
import type { CouncilAssessmentRun, OpenDataSnapshot } from '../src/types/council.ts';

const NOW = new Date('2026-11-04T12:00:00Z');

function runFor(iso3: string, tweak: (s: OpenDataSnapshot) => void = () => {}, live = true): CouncilAssessmentRun {
  const openData = buildBaselineOpenData(iso3);
  openData.dataStatus = { verifiedLiveSources: [], checkedAt: '2026-11-04T12:00:00Z' };
  if (live) {
    markLive(openData);
    fillTestValues(openData, ['market.sovereign10YBondYieldPct']);
    openData.official10YYield = { valuePct: openData.monetaryAndMarket.sovereign10YBondYieldPct, period: '2026-09', source: 'OECD via FRED', seriesId: 'S', url: 'u', frequency: 'monthly' };
    openData.dataStatus!.verifiedLiveSources.push('FRED / OECD 10Y government yield (monthly average)');
  }
  tweak(openData);
  return { iso3, countryName: openData.countryName, openData } as unknown as CouncilAssessmentRun;
}

test('debt dynamics: r = g and pb = 0 keeps debt flat; a surplus lowers it', () => {
  assert.deepEqual(projectDebt({ debtPct: 60, r: 3, g: 3, pb: 0 }, 3), [60, 60, 60, 60]);
  const p = projectDebt({ debtPct: 60, r: 3, g: 3, pb: 2 }, 2);
  assert.deepEqual(p, [60, 58, 56]);
});

test('debt dynamics matches the formula by hand', () => {
  // d1 = 80 * 1.05 / 1.02 - (-1) = 83.35...
  assert.equal(projectDebt({ debtPct: 80, r: 5, g: 2, pb: -1 }, 1)[1], 83.4);
});

test('every shock ends at or above the baseline, and the combined shock is the worst', () => {
  const sc = standardScenarios({ debtPct: 70, r: 4, g: 3, pb: 0.5 });
  const end = (id: string) => sc.find((s) => s.id === id)!.path.at(-1)!;
  for (const id of ['growth', 'interest', 'primary', 'combined']) assert.ok(end(id) >= end('baseline'), id);
  assert.ok(end('combined') >= Math.max(end('growth'), end('interest'), end('primary')));
  assert.equal(sc[0].path.length, 6);
});

test('warning signs: a low-debt surplus country shows few, a stressed one many', () => {
  const calm = runFor('MEX', (s) => {
    s.imfIndicators.debtToGdpPct = 40;
    s.imfIndicators.primaryFiscalBalancePct = 2;
    s.dsaAnalytics.effectiveRealInterestRatePct = 2;
    s.dsaAnalytics.realGdpGrowthRatePct = 3;
    s.dsaAnalytics.rMinusGDifferentialPct = -1;
    s.dsaAnalytics.fiscalConsolidationGapPct = -2;
    s.worldBankIndicators.fxReservesMonthsImport = 6;
    s.worldBankIndicators.externalDebtPctGni = 30;
  });
  const calmSc = standardScenarios({ debtPct: 40, r: 2, g: 3, pb: 2 });
  assert.equal(sustainabilitySignals(calm, calmSc, -2, -1).level, 'low');
  const bad = runFor('EGY', (s) => {
    s.imfIndicators.debtToGdpPct = 95;
    s.dsaAnalytics.rMinusGDifferentialPct = 4;
    s.dsaAnalytics.fiscalConsolidationGapPct = 4;
    s.worldBankIndicators.fxReservesMonthsImport = 2;
  });
  const badSc = standardScenarios({ debtPct: 95, r: 7, g: 3, pb: -1 });
  const r = sustainabilitySignals(bad, badSc, 4, 4);
  assert.equal(r.level, 'high');
  assert.ok(r.signs.some((x) => x.includes('70% of GDP')));
});

test('brief labels projections as model output and dates the horizon', () => {
  const b = officialBrief(runFor('ZAF'), NOW);
  const proj = b.groups.find((g) => g.title.startsWith('Projection to 2031'))!;
  assert.equal(proj.rows.length, 5);
  assert.ok(proj.rows.every((r) => r.source.startsWith('model') && !r.verified));
  assert.match(b.headline, /the IMF forecasts \d+% for 2027/);
  assert.ok(b.judgements.some((j) => /by 2031/.test(j)));
});

test('assessment: all sections in order, the path printed year by year, and the disclaimer', () => {
  const all = buildOfficialSections(runFor('BRA'), () => true, NOW);
  assert.deepEqual(all.map((s) => s.id), Object.keys(OFFICIAL_SECTIONS));
  const proj = all.find((s) => s.id === 'projection')!;
  assert.match(proj.lines[0], /2026 to 2031/);
  assert.equal(proj.lines[1].split('→').length, 6);
  assert.ok(all.at(-1)!.lines.some((l) => /Not an IMF or World Bank/.test(l)));
  assert.ok(all.find((s) => s.id === 'method')!.lines.some((l) => /not an IMF or World Bank risk rating/.test(l)));
});

test('a projection far above the IMF 2027 forecast is flagged as an upper bound', () => {
  const run = runFor('BRA', (s) => {
    s.imfIndicators.debtToGdpPct = 80;
    s.imfIndicators.debtToGdpForecast2027Pct = 82;
    s.imfIndicators.primaryFiscalBalancePct = -1;
    s.imfIndicators.realGdpGrowthPct = 2;
    s.imfIndicators.cpiInflationPct = 4;
    s.official10YYield!.valuePct = 13; // real rate about 10%
    s.monetaryAndMarket.sovereign10YBondYieldPct = 13;
  });
  assert.ok(officialBrief(run, NOW).judgements.some((j) => /upper bound/.test(j)));
});

test('no projection without every input live, and the brief names what is missing', () => {
  const b = officialBrief(runFor('BRA', () => {}, false), NOW);
  assert.equal(b.scenarios.length, 0);
  assert.ok(b.judgements.some((j) => /No debt projection: it needs live debt\/GDP, primary balance, growth, inflation, official 10Y yield/.test(j)));
  assert.match(b.headline, /no sustainability reading until the missing figures are live/);
  const sections = buildOfficialSections(runFor('BRA', () => {}, false), () => true, NOW);
  assert.match(sections.find((s) => s.id === 'projection')!.lines[0], /No projection/);
  // Only the yield missing: still no projection.
  const noYield = officialBrief(runFor('BRA', (s) => { delete s.official10YYield; }), NOW);
  assert.ok(noYield.judgements.some((j) => /needs live official 10Y yield\./.test(j)));
});
