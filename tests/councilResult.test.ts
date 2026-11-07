import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelCouncil } from '../src/utils/councilResult';
import { buildDefaultAssessmentRun } from '../src/data/presetsAndBaselines';

test('modelCouncil hides the built-in starting report and keeps one a model wrote', () => {
  const run = buildDefaultAssessmentRun('BRA');
  assert.ok(run.supremeCouncil, 'every country starts with a built-in report');
  assert.equal(modelCouncil(run), undefined);
  const written = { ...run, supremeCouncil: { ...run.supremeCouncil!, fromModel: true } };
  assert.equal(modelCouncil(written)?.fromModel, true);
  assert.equal(modelCouncil(null), undefined);
});

test('coherence and composite: a number when there is one, Missing with the reason otherwise (never a built-in 0.91 or 0.62)', async () => {
  const { coherenceText, compositeText, COHERENCE_MISSING } = await import('../src/utils/councilResult.ts');
  assert.equal(coherenceText({ globalCoherenceScore: 0.734 }), '73%');
  assert.equal(coherenceText({ globalCoherenceScore: null }), COHERENCE_MISSING);
  assert.equal(coherenceText(undefined), COHERENCE_MISSING);
  assert.equal(compositeText({ compositeRiskScore: 0.45 }), '0.45 / 1.00');
  assert.equal(compositeText({ compositeRiskScore: 0.45 }, 100), '45/100');
  assert.match(compositeText(undefined), /^Missing/);
});

test('risk check: drawdown and haircut are Missing unless measured; the built-in report carries no figures or approval', async () => {
  const { riskPctText, approvalText, RISK_ESTIMATE_MISSING, MODEL_FIELD_MISSING } = await import('../src/utils/councilResult.ts');
  assert.equal(riskPctText(3.4), '3.4%');
  assert.equal(riskPctText(null), RISK_ESTIMATE_MISSING);
  assert.equal(approvalText('APPROVED_WITH_HEDGE'), 'approved with hedge');
  assert.match(approvalText(null), /^missing/);
  const rg = buildDefaultAssessmentRun('BRA').supremeCouncil!.marketTranslationLayer.riskGuardianCheck;
  assert.equal(rg.liquidityHaircutPct, null);
  assert.equal(rg.maxDrawdownEstimatePct, null);
  assert.equal(rg.approvalStatus, null);
  assert.equal(rg.tailRiskHedgeInstrument, MODEL_FIELD_MISSING);
  assert.equal(buildDefaultAssessmentRun('BRA').supremeCouncil!.globalCoherenceScore, null);
});

test('tickets and triggers: no built-in sizing, calls or decision triggers in the starting report', async () => {
  const { sizingText, ticketCallText, TRIGGERS_MISSING } = await import('../src/utils/councilResult.ts');
  const sc = buildDefaultAssessmentRun('BRA').supremeCouncil!;
  assert.deepEqual(sc.decisionPointMatrix, []);
  for (const t of sc.marketTranslationLayer.tradeExpressions) {
    assert.equal(t.sizingWeightPct, null);
    assert.equal(t.direction, null);
    assert.equal(t.conviction, null);
  }
  assert.match(sizingText(null), /^Missing/);
  assert.equal(sizingText(20), '20%');
  assert.equal(ticketCallText(null), 'missing');
  assert.match(TRIGGERS_MISSING, /^Missing/);
});

test('a placeholder the model writes ("NA", "N/A", "none") counts as no answer', async () => {
  const { isModelPlaceholder } = await import('../src/utils/councilResult.ts');
  for (const p of ['NA', 'N/A', 'n/a.', 'none', ' - ', 'Unknown']) assert.equal(isModelPlaceholder(p), true, p);
  for (const t of ['Brazilian Government Bond', 'Unclear due to missing data.', 'NAFTA trade']) assert.equal(isModelPlaceholder(t), false, t);
});
