import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import history from '../data/historicalEvaluation.json';
import { ANNUAL_FEATURES, FITTED_MODELS } from './fittedModels';
import {
  computeBinaryMetrics, computeLossBacktest, getBacktestValidation, parseLossHistory, LossObservation
} from './backtesting';

const near = (actual: number, expected: number, tolerance = 1e-10) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

function losses(hits = [0, 0, 1, 1, 0, 0, 0, 1, 0, 0]): LossObservation[] {
  const start = Date.parse('2020-01-01T00:00:00Z');
  return hits.map((hit, i) => ({
    portfolio: 'test-book', modelVersion: 'test-model', unit: 'USD', confidence: 0.9,
    forecastIssuedAt: new Date(start + i * 86400000 - 3600000).toISOString(),
    periodStart: new Date(start + i * 86400000).toISOString(),
    periodEnd: new Date(start + (i + 1) * 86400000).toISOString(),
    var: 100, es: 150, loss: hit ? 200 : 50
  }));
}

describe('Historical backtesting', () => {
  it('recomputes all holdout metrics with Python/sklearn parity', () => {
    const result = getBacktestValidation();
    assert.equal(result.rows, 268);
    assert.equal(result.events, 31);
    assert.deepEqual(result.predictorYears, [2019, 2023]);
    assert.deepEqual(result.outcomeYears, [2020, 2024]);
    for (const key of ['firth', 'lightgbm', 'blend', 'constantTrainingRate'] as const) {
      const reference = FITTED_MODELS.hazard.test[key];
      const computed = result.models[key];
      assert.equal(computed.rows, reference.rows);
      assert.equal(computed.events, reference.events);
      near(computed.brier, reference.brier);
      near(computed.logLoss, reference.logLoss);
      near(computed.rocAuc!, reference.rocAuc);
      near(computed.averagePrecision!, reference.averagePrecision);
    }
  });

  it('checks every exported predictor and outcome and complete risk set against observed history', () => {
    const lines = readFileSync(new URL('../../quant/data/observed-panel.csv', import.meta.url), 'utf8').trim().split(/\r?\n/);
    const columns = lines[0].split(',');
    const panel = new Map(lines.slice(1).map(line => {
      const cells = line.split(',');
      return [`${cells[0]}/${cells[1]}`, cells] as const;
    }));
    const expectedKeys: string[] = [];
    let trainingRows = 0;
    let trainingEvents = 0;
    for (const [key, cells] of panel) {
      const year = Number(cells[1]);
      const next = panel.get(`${cells[0]}/${year + 1}`);
      const values = ANNUAL_FEATURES.map(name => cells[columns.indexOf(name)]);
      if (Number(cells.at(-1)) !== 0 || !next || values.filter(v => v !== '').length < 4) continue;
      if (year <= 2012) {
        trainingRows++;
        if (Number(next.at(-1)) > 0) trainingEvents++;
      }
      if (year >= 2019 && year <= 2023) expectedKeys.push(key);
    }
    assert.equal(trainingRows, FITTED_MODELS.hazard.trainingRows);
    assert.equal(trainingEvents, FITTED_MODELS.hazard.trainingEvents);
    near(history.constantTrainingRate, trainingEvents / trainingRows);
    assert.deepEqual(history.rows.map(r => `${r.country}/${r.predictorYear}`).sort(), expectedKeys.sort());
    for (const row of history.rows) {
      const cells = panel.get(`${row.country}/${row.predictorYear}`)!;
      const next = panel.get(`${row.country}/${row.outcomeYear}`)!;
      assert.equal(Number(cells.at(-1)), 0);
      assert.equal(row.outcome, Number(Number(next.at(-1)) > 0));
      assert.deepEqual(row.values, ANNUAL_FEATURES.map(name => {
        const value = cells[columns.indexOf(name)];
        return value === '' ? null : Number(value);
      }));
    }
  });

  it('changes computed results when historical outcomes change and rejects malformed/stale histories', () => {
    const changed = structuredClone(history);
    changed.rows[0].outcome = 1 - changed.rows[0].outcome;
    assert.notEqual(getBacktestValidation(changed).models.blend.brier, getBacktestValidation().models.blend.brier);
    assert.throws(() => getBacktestValidation({ ...history, modelVersion: 'stale' }), /does not match/);
    assert.throws(() => getBacktestValidation({ ...history, constantTrainingRate: 0.5 }), /does not match/);
    assert.throws(() => getBacktestValidation({ ...history, rows: [] }), /does not match/);
    const duplicate = structuredClone(history);
    duplicate.rows.push(duplicate.rows[0]);
    assert.throws(() => getBacktestValidation(duplicate), /duplicated/);
    const leaked = structuredClone(history);
    leaked.rows[0].predictorYear = 2012;
    assert.throws(() => getBacktestValidation(leaked), /Invalid/);
    const invalid = structuredClone(history);
    invalid.rows[0].values[0] = NaN;
    assert.throws(() => getBacktestValidation(invalid), /finite/);
  });

  it('matches sklearn for tied scores and reports non-identifiable ranking metrics explicitly', () => {
    const metrics = computeBinaryMetrics([0, 1, 0, 1, 1, 0], [.8, .8, .4, .4, .4, .1]);
    near(metrics.brier, .26166666666666666);
    near(metrics.logLoss, .7135581778200728);
    near(metrics.rocAuc!, .6111111111111112);
    near(metrics.averagePrecision!, .5666666666666667);
    near(computeBinaryMetrics([0, 1], [.5, .5]).rocAuc!, .5);
    assert.equal(computeBinaryMetrics([0, 0], [.2, .3]).rocAuc, null);
    assert.equal(computeBinaryMetrics([0, 0], [.2, .3]).averagePrecision, null);
    near(computeBinaryMetrics([1, 1], [.2, .3]).averagePrecision!, 1);
    assert.ok(Number.isFinite(computeBinaryMetrics([1, 0], [0, 1]).logLoss));
    for (const [y, p] of [[[], []], [[1], []], [[2], [.5]], [[1], [NaN]], [[0], [1.1]]]) {
      assert.throws(() => computeBinaryMetrics(y, p), /Binary evaluation/);
    }
  });

  it('matches SciPy likelihood ratios and p-values, and computes ES from actual losses', () => {
    const result = computeLossBacktest(losses());
    assert.equal(result.breaches, 3);
    near(result.expectedBreaches, 1);
    assert.deepEqual(result.transitions, { n00: 4, n01: 2, n10: 2, n11: 1 });
    assert.ok(result.kupiec.available && result.independence.available && result.conditionalCoverage.available && result.es.available);
    near(result.kupiec.statistic, 3.07327173607597);
    near(result.kupiec.pValue, .07958914489974482, 1.5e-7);
    near(result.independence.statistic, 0);
    near(result.independence.pValue, 1);
    near(result.conditionalCoverage.pValue, .21510352222045506);
    near(result.es.statistic, -3);
    assert.equal(result.kupiec.reject, false);
    assert.equal('passed' in result, false);
    assert.equal('pValue' in result.es, false);
    const clustered = computeLossBacktest(losses([0, 0, 0, 0, 1, 1, 1, 0, 0, 0]));
    assert.ok(clustered.independence.available && clustered.conditionalCoverage.available);
    near(clustered.independence.statistic, 2.231435513142097);
    near(clustered.independence.pValue, .13522815768706667, 1.5e-7);
    near(clustered.conditionalCoverage.pValue, .07048512216119873);
  });

  it('handles zero/all breaches without NaN or fictitious independence passes', () => {
    for (const hits of [[0, 0, 0, 0], [1, 1, 1, 1]]) {
      const result = computeLossBacktest(losses(hits));
      assert.ok(result.kupiec.available && Number.isFinite(result.kupiec.statistic));
      assert.equal(result.independence.available, false);
      assert.equal(result.conditionalCoverage.available, false);
    }
    const rows = losses();
    rows[0].loss = rows[0].var;
    assert.equal(computeLossBacktest(rows).breaches, 3);
    assert.equal(computeLossBacktest(rows.map(({ es: _es, ...row }) => row)).es.available, false);
    assert.throws(() => computeLossBacktest([]), /at least two/);
  });

  it('sorts without mutating and excludes transitions across missing periods', () => {
    const rows = losses();
    const reversed = [...rows].reverse();
    assert.deepEqual(computeLossBacktest(reversed), computeLossBacktest(rows));
    assert.equal(reversed[0], rows.at(-1));
    const gapped = [rows[0], rows[2], rows[4]];
    const result = computeLossBacktest(gapped);
    assert.deepEqual(result.transitions, { n00: 0, n01: 0, n10: 0, n11: 0 });
    assert.equal(result.independence.available, false);
  });

  it('rejects late-issued forecasts, invalid values, mixed series, overlapping periods and invalid ES', () => {
    for (const patch of [
      { forecastIssuedAt: '2020-01-01T01:00:00Z' },
      { forecastIssuedAt: 'not-a-date' },
      { periodEnd: '2020-02-30T00:00:00Z' },
      { periodEnd: '2020-01-01T00:00:00Z' },
      { periodEnd: '2099-01-02T00:00:00Z' },
      { periodEnd: '2020-01-03T00:00:00Z' },
      { confidence: 1 }, { confidence: .95 }, { var: -1 }, { loss: Infinity },
      { es: 90 }, { es: 0 }, { es: undefined },
      { portfolio: 'other' }, { modelVersion: 'other' }, { unit: 'EUR' }
    ]) {
      const rows = losses();
      Object.assign(rows[0], patch);
      assert.throws(() => parseLossHistory(rows), Error, JSON.stringify(patch));
    }
    const duplicate = losses();
    duplicate.push(duplicate[0]);
    assert.throws(() => parseLossHistory(duplicate), /overlapping/);
    assert.throws(() => parseLossHistory({}), /at least two/);
    assert.throws(() => parseLossHistory([{}]), /at least two/);
  });
});
