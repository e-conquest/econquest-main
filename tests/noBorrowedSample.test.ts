import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBaselineOpenData, buildDefaultAssessmentRun, SOVEREIGN_CATALOG } from '../src/data/presetsAndBaselines.ts';

const OWN_SNAPSHOT = ['BRA', 'TUR', 'EGY'];
const OTHERS = SOVEREIGN_CATALOG.map((c) => c.iso3).filter((i) => !OWN_SNAPSHOT.includes(i));

test('no country gets built-in contracts, headlines or figures', () => {
  for (const { iso3 } of SOVEREIGN_CATALOG) {
    const s = buildBaselineOpenData(iso3);
    assert.deepEqual(s.polymarketContracts, [], iso3);
    assert.deepEqual(s.gdeltMetrics.topHeadlines, [], iso3);
    assert.equal(s.gdeltMetrics.articleCount24h, 0, iso3);
    assert.ok(Number.isNaN(s.gdeltMetrics.conflictIntensityIndex), iso3);
    for (const section of [s.imfIndicators, s.worldBankIndicators, s.monetaryAndMarket] as unknown as Record<string, unknown>[]) {
      for (const [k, v] of Object.entries(section)) if (typeof v === 'number') assert.ok(Number.isNaN(v), `${iso3} ${k} = ${v}`);
    }
    assert.deepEqual(s.yieldCurve.tenors, [], iso3);
    assert.deepEqual(s.debtRollover.buckets, [], iso3);
    assert.deepEqual(s.factorBetas, [], iso3);
  }
});

test('the sample council for another country never mentions Brazil and quotes no odds', () => {
  for (const iso3 of OTHERS) {
    const text = JSON.stringify(buildDefaultAssessmentRun(iso3));
    assert.doesNotMatch(text, /Brazilian|Brasil|Selic|Copom|valorinternational/, iso3);
    assert.doesNotMatch(text, /Polymarket (Adverse Policy Probability|Odds|Adverse Odds|Fiscal Target Odds|Target Odds) =/, iso3);
  }
});
