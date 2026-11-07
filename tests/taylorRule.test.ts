import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taylorCheck, taylorMethod, taylorRate, taylorSentence, taylorStance, TAYLOR_R_STAR } from '../src/utils/taylorRule.ts';
import { taylorRows } from '../src/utils/marketsMacro.ts';

test('the rule: r* + inflation + half the inflation gap + half the output gap', () => {
  assert.equal(TAYLOR_R_STAR, 2);
  // UK-style: inflation 3.8, target 2, gap -0.5 -> 2 + 3.8 + 0.9 - 0.25 = 6.45
  assert.equal(taylorRate(3.8, 2, -0.5), 6.45);
  // Without a gap the term is left out.
  assert.equal(taylorRate(4.5, 3, undefined), 7.25);
});

test('stance: more than 1 pt either side of the rule', () => {
  assert.equal(taylorStance(1.5), 'tighter than the rule');
  assert.equal(taylorStance(-1.01), 'looser than the rule');
  assert.equal(taylorStance(0.6), 'close to the rule');
});

test('Brazil: BIS rate, monthly inflation and the BCB target give a reading without an output gap', () => {
  const r = taylorCheck({ iso3: 'BRA', policyRatePct: 13.75, policyRateSource: 'bis', cpiInflationPct: 4.4, cpiSource: 'oecd', cpiMonth: '2026-09' });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.reading.rulePct, 7.1); // 2 + 4.4 + 0.5 x 1.4
    assert.equal(r.reading.gapToRulePts, 6.65);
    assert.equal(r.reading.stance, 'tighter than the rule');
    assert.equal(r.reading.withoutOutputGap, true);
    assert.match(taylorMethod(r.reading), /output gap left out/);
    assert.match(taylorSentence(r.reading), /6\.65 pts above .* without an output gap/);
  }
});

test('with an IMF output gap the term counts and is named with its year', () => {
  const r = taylorCheck({ iso3: 'GBR', policyRatePct: 3.75, policyRateSource: 'bis', cpiInflationPct: 3.8, cpiSource: 'live', outputGap: { pct: -0.5, year: '2025' } });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.reading.rulePct, 6.45);
    assert.equal(r.reading.gapToRulePts, -2.7);
    assert.equal(r.reading.stance, 'looser than the rule');
    assert.match(taylorMethod(r.reading), /IMF WEO 2025/);
  }
});

test('no reading without live inputs: sample rates, sample inflation or no target each say what is missing', () => {
  const sample = taylorCheck({ iso3: 'BRA', policyRatePct: 10, policyRateSource: 'sample', cpiInflationPct: 4, cpiSource: 'sample' });
  assert.deepEqual(sample.ok ? [] : sample.missing, ['the BIS policy rate', 'live inflation']);
  const egypt = taylorCheck({ iso3: 'EGY', policyRatePct: 20, policyRateSource: 'bis', cpiInflationPct: 12, cpiSource: 'live' });
  assert.deepEqual(egypt.ok ? [] : egypt.missing, ["the central bank's inflation target"]);
  assert.equal(taylorCheck(undefined).ok, false);
});

test('Country tab rows: missing inputs give one Missing row, never a number', () => {
  const rows = taylorRows(undefined);
  assert.equal(rows.length, 1);
  assert.match(String(rows[0].value), /Missing|Needs/);
  const ok = taylorRows({ iso3: 'BRA', policyRatePct: 13.75, policyRateSource: 'bis', cpiInflationPct: 4.4, cpiSource: 'oecd' } as any);
  assert.equal(ok[0].label, 'Taylor rule rate');
  assert.equal(ok[0].value, '7.10% (no output gap)');
});
