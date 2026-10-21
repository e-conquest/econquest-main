import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import reference from '../../quant/inference-reference.json';
import {
  ANNUAL_FEATURES, FITTED_MODELS, filterAnnualRegimes, getAnnualHistory, getScenarioHistory,
  hasObservedHistory, importAnnualRows, predictAnnualHazard, standardizeAnnual, validateArtifact
} from './fittedModels';
import { BENCHMARK_SOVEREIGNS } from '../data/sovereignData';
import { computeLayer3Regime, runRiskPipeline } from './riskCalculations';
import { DEFAULT_CUSTOM_SCENARIO } from '../data/defaultCustomScenarios';
import { CustomScenarioParams, MacroScenario } from '../types/riskEngine';
import { generate12MonthMapProgression } from '../data/historicalMapData';
import { PRESET_INSTITUTIONAL_BOOKS } from './institutionalMacroAnalytics';

const entities = BENCHMARK_SOVEREIGNS.filter(entity => hasObservedHistory(entity.code));
const near = (actual: number, expected: number, tolerance = 1e-10) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

describe('Fitted annual model inference', () => {
  it('matches actual Python Firth/LightGBM and HMM predictions for every supported country', () => {
    for (const expected of reference) {
      const entity = entities.find(item => item.code === expected.country)!;
      const history = getAnnualHistory(entity);
      const hazard = predictAnnualHazard(history[history.length - 1].values);
      near(hazard.firthLogitProb, expected.firth);
      near(hazard.lightgbmProb, expected.lightgbm);
      const regime = filterAnnualRegimes(history);
      Object.values(regime.regimeProbabilities).forEach((p, index) =>
        near(p, expected.regimeProbabilities[index]));
    }
  });

  it('checks the exact observed panel checksum, not generated history', () => {
    const hash = createHash('sha256')
      .update(readFileSync(new URL('../../quant/data/observed-panel.csv', import.meta.url))).digest('hex');
    assert.equal(hash, FITTED_MODELS.dataSha256);
    assert.equal(FITTED_MODELS.hazard.trainingPredictorYears[1] + 1 <
      FITTED_MODELS.hazard.validationPredictorYears[0], true);
    assert.equal(FITTED_MODELS.hazard.validationPredictorYears[1] + 1 <
      FITTED_MODELS.hazard.testPredictorYears[0], true);
  });

  it('uses the actual validation-selected blend weight', () => {
    const latest = getAnnualHistory(entities[0]).at(-1)!;
    const result = predictAnnualHazard(latest.values);
    const w = FITTED_MODELS.hazard.lightgbmWeight;
    near(result.reconciledHazard, (1 - w) * result.firthLogitProb + w * result.lightgbmProb);
  });

  it('respects all fitted monotonic tree constraints on observed inputs', () => {
    for (const entity of entities) {
      const values = [...getAnnualHistory(entity).at(-1)!.values];
      const base = predictAnnualHazard(values).lightgbmProb;
      FITTED_MODELS.hazard.lightgbm.monotoneConstraints.forEach((direction, feature) => {
        const original = values[feature];
        if (original === null) return;
        const shocked = [...values];
        shocked[feature] = original + 10;
        const next = predictAnnualHazard(shocked).lightgbmProb;
        assert.ok((next - base) * direction >= -1e-12);
      });
    }
  });

  it('imputes only explicit missing predictors with training medians', () => {
    const values = [...getAnnualHistory(entities[0]).at(-1)!.values];
    values[0] = null;
    const filled = [...values];
    filled[0] = FITTED_MODELS.preprocessing.medians[0];
    assert.deepEqual(standardizeAnnual(values), standardizeAnnual(filled));
    assert.throws(() => standardizeAnnual([NaN, 1, 2, 3, 4, 5]), /finite/);
  });

  it('rejects absent data, calendar gaps and malformed model artifacts', () => {
    const fictional = BENCHMARK_SOVEREIGNS.find(s => s.code === 'SEC8')!;
    assert.throws(() => runRiskPipeline(fictional), /No observed annual/);
    const history = getAnnualHistory(entities[0]);
    assert.throws(() => filterAnnualRegimes([history[0], history[2]]), /consecutive/);
    const corrupt = structuredClone(FITTED_MODELS);
    corrupt.hmm.transition[0][0] = -1;
    assert.throws(() => validateArtifact(corrupt), /Invalid fitted/);
    const badTree = structuredClone(FITTED_MODELS);
    badTree.hazard.lightgbm.trees = [];
    assert.throws(() => validateArtifact(badTree), /Invalid fitted/);
  });

  it('filters causally without mutating observations or reading future emissions', () => {
    const history = getAnnualHistory(entities[0]);
    const prefix = history.slice(0, 10);
    const expected = filterAnnualRegimes(prefix);
    const changedFuture = structuredClone(history);
    changedFuture[10].values[4] = 10000;
    assert.deepEqual(filterAnnualRegimes(changedFuture.slice(0, 10)), expected);
    const before = structuredClone(history);
    filterAnnualRegimes(history);
    assert.deepEqual(history, before);
  });

  it('returns finite normalized HMM posteriors under every scenario and extreme custom stress', () => {
    const scenarios: MacroScenario[] = [
      'baseline', 'scenarioA_fedTightening', 'scenarioB_commodityCollapse', 'scenarioC_malaccaBlockade', 'custom'
    ];
    const extreme: CustomScenarioParams = {
      ...DEFAULT_CUSTOM_SCENARIO, sovereignSpreadWideningBps: 1000, usYieldCurveShiftBps: 600,
      reserveDrainPercent: -50, broadUsdAppreciation: 30, commodityPriceShockPercent: -60,
      energyOilShockPercent: 80, fxImpliedVolSkewJump: 45, aisChokepointDisruptionPct: 80
    };
    for (const entity of entities) {
      for (const scenario of scenarios) {
        const result = runRiskPipeline(entity, scenario, true, 0.4, extreme);
        const probabilities = Object.values(result.regimeProbabilities);
        assert.ok(probabilities.every(p => Number.isFinite(p) && p >= 0 && p <= 1));
        near(probabilities.reduce((a, b) => a + b, 0), 1);
        assert.ok(Number.isFinite(result.layer1ReconciledHazard));
        assert.ok(result.layer1ReconciledHazard > 0 && result.layer1ReconciledHazard < 1);
        assert.equal(result.annualModel.status, 'research-only');
        assert.equal(result.annualModel.observationYear, 2024);
      }
    }
  });

  it('makes a zero custom macro shock identical to the annual baseline', () => {
    const zero: CustomScenarioParams = {
      ...DEFAULT_CUSTOM_SCENARIO, usYieldCurveShiftBps: 0, sovereignSpreadWideningBps: 0,
      broadUsdAppreciation: 0, reserveDrainPercent: 0, commodityPriceShockPercent: 0, energyOilShockPercent: 0,
      textStressIndexShockSigma: 0, aisChokepointDisruptionPct: 0
    };
    for (const entity of entities) {
      assert.deepEqual(getScenarioHistory(entity, 'custom', zero), getAnnualHistory(entity));
      assert.deepEqual(computeLayer3Regime(entity, 'custom', zero), computeLayer3Regime(entity, 'baseline'));
    }
  });

  it('does not reintroduce probability thresholds in generated replay regimes', () => {
    const outputs = Object.fromEntries(entities.map(entity => [entity.id, runRiskPipeline(entity)]));
    const replay = generate12MonthMapProgression(entities, outputs);
    for (const snapshot of replay) {
      for (const entity of entities) assert.equal(snapshot.sovereigns[entity.id].hmmRegime, outputs[entity.id].regime);
    }
    for (const preset of Object.values(PRESET_INSTITUTIONAL_BOOKS)) {
      assert.ok(preset.positions.every(p => entities.some(e => e.id === p.sovereignId)));
    }
  });

  it('applies validated observed imports to both fitted models and rejects invalid updates atomically', () => {
    const entity = entities.find(e => e.code === 'TUR')!;
    const latest = getAnnualHistory(entity).at(-1)!;
    const row = {
      country_code: entity.code, year: latest.year, in_default: 0,
      ...Object.fromEntries(ANNUAL_FEATURES.map((name, index) => [name, latest.values[index]])),
      inflation: 0, gdpGrowth: 6, reservesMonths: 10
    };
    const updated = importAnnualRows([row], entities).find(e => e.code === entity.code)!;
    assert.notEqual(runRiskPipeline(updated).baselineProbLogit, runRiskPipeline(entity).baselineProbLogit);
    assert.notDeepEqual(runRiskPipeline(updated).regimeProbabilities, runRiskPipeline(entity).regimeProbabilities);
    assert.equal(runRiskPipeline(updated).annualModel.source, 'User-supplied annual observations');
    assert.throws(() => importAnnualRows([{ ...row, inflation: 'bad' }], entities), /Non-finite/);
    assert.throws(() => importAnnualRows([row, row], entities), /Duplicate/);
    assert.throws(() => importAnnualRows([{ ...row, year: latest.year + 2 }], entities), /consecutive/);
    assert.throws(() => importAnnualRows([{ ...row, country_code: 'SEC8' }], entities), /Unknown sovereign/);
  });
});
