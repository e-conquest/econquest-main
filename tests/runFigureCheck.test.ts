import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_REMOVED, allowedFrom, checkDeskText, checkSupremeText, figuresIn, sentences, tracesTo } from '../src/utils/runFigureCheck.ts';
import type { CouncilAssessmentRun, SupremeCouncilOutput } from '../src/types/council.ts';

test('labels with digits are not figures; real figures are', () => {
  assert.deepEqual(figuresIn('AG-4 says the 10Y and 5Y CDS moved in Q2 2026 (Stage 2).'), []);
  assert.deepEqual(figuresIn('Inflation is 4.4% and CDS 185 bps.'), ['4.4', '185']);
});

test('sentences split at full stops but keep decimals together', () => {
  assert.deepEqual(sentences('Inflation is 4.4% now. Rates stay at 13.75%! Next (soon) is May.'), ['Inflation is 4.4% now.', 'Rates stay at 13.75%!', 'Next (soon) is May.']);
});

test('a number traces when a given figure rounds to it; scores may be written as percentages', () => {
  const allowed = allowedFrom(['CPI 4.43%', 0.62]);
  assert.ok(tracesTo('4.4', allowed.plain));
  assert.ok(tracesTo('4', allowed.plain));
  assert.ok(tracesTo('62', allowed.scaledScores));
  assert.equal(tracesTo('62', allowed.plain), false);
  assert.equal(tracesTo('4.5', allowed.plain), false);
});

const run = (): CouncilAssessmentRun =>
  ({
    subAgents: [{ agentName: 'Fiscal Auditor', findingsSummary: 'Debt is 87.3% of GDP. Debt will hit 120% by 2030. No numbers here.', riskScore: 0.6, confidence: 0.7 }],
    deskDebates: {
      macro: {
        consensusSummary: 'Inflation at 4.4% is above target.',
        rounds: [{ thesis: 'Growth is 9.9%.', counterThesis: 'Growth is fine.', deskLeadResolution: 'Hold.', riskScoreAdjustment: 0.02 }],
        minorityDissents: [],
        preCascadeRiskScore: 0.55,
        postCascadeRiskScore: 0.6,
        initialRiskSpread: 0.1,
      },
    },
    cascadeSteps: [{ shockDelta: '+15% energy', transmissionMechanism: 'Oil feeds prices.', priorRiskScore: 0.5, postCascadeRiskScore: 0.6, jsonPatch: { imported_energy_inflation_shock_pct: 15 } }],
    croState: { geopoliticalRiskScore: 0.5 },
  }) as unknown as CouncilAssessmentRun;

test('desk text: sentences with figures the council was not given are removed and listed', () => {
  const r = run();
  const check = checkDeskText(r, ['- IMF gross debt / GDP: 87.3% (IMF WEO)', '- OECD CPI: 4.4%']);
  assert.equal(r.subAgents[0].findingsSummary, 'Debt is 87.3% of GDP. No numbers here.');
  assert.equal(r.deskDebates.macro.consensusSummary, 'Inflation at 4.4% is above target.');
  assert.equal(r.deskDebates.macro.rounds[0].thesis, ALL_REMOVED);
  assert.equal(r.cascadeSteps[0].shockDelta, '+15% energy', 'the cascade’s own shock is a council figure');
  assert.deepEqual(
    check.removed.map((x) => x.where),
    ['Fiscal Auditor', 'Macro desk, round 1 thesis']
  );
  assert.match(check.removed[0].sentence, /120%/);
  assert.ok(check.kept >= 5);
});

test('final report: built-in or invented figures are removed, given ones kept', () => {
  const out = {
    compositeRiskScore: 0.61,
    executiveSummary: 'Composite risk is 0.61, or 61%. The 10Y yield is 14.2%, a built-in figure.',
    policyResearcherReport: { structuralVulnerabilities: ['Reserves cover 10.4 months of imports.'], transmissionPathways: [], policyRecommendations: [{ action: 'Cut by 50 bps.', expectedImpact: 'Lower costs.' }], longTermRegimeOutlook: 'Stable.' },
    marketTranslationLayer: { regimeStance: 'Neutral.', tradeExpressions: [], riskGuardianCheck: { factorCrowdingWarning: 'None.' } },
  } as unknown as SupremeCouncilOutput;
  const { output, check } = checkSupremeText(out, ['- World Bank FX reserves: 10.4 months of imports'], [0.5]);
  assert.equal(output.executiveSummary, 'Composite risk is 0.61, or 61%.');
  assert.deepEqual(output.policyResearcherReport.structuralVulnerabilities, ['Reserves cover 10.4 months of imports.']);
  assert.equal(output.policyResearcherReport.policyRecommendations[0].action, ALL_REMOVED);
  assert.equal(check.removed.length, 2);
});
