import historicalData from '../data/historicalEvaluation.json';
import { FITTED_MODELS, predictAnnualHazard } from './fittedModels';

export interface BinaryMetrics {
  rows: number;
  events: number;
  brier: number;
  logLoss: number;
  rocAuc: number | null;
  averagePrecision: number | null;
}

export function computeBinaryMetrics(outcomes: number[], probabilities: number[]): BinaryMetrics {
  if (outcomes.length === 0 || outcomes.length !== probabilities.length ||
    !outcomes.every(y => y === 0 || y === 1) ||
    !probabilities.every(p => Number.isFinite(p) && p >= 0 && p <= 1)) {
    throw new Error('Binary evaluation requires equally sized nonempty binary outcomes and finite probabilities in [0,1].');
  }
  const n = outcomes.length;
  const events = outcomes.reduce<number>((sum, y) => sum + y, 0);
  let brier = 0;
  let logLoss = 0;
  for (let i = 0; i < n; i++) {
    brier += (probabilities[i] - outcomes[i]) ** 2;
    // Match sklearn's float64 clipping for log-loss reporting.
    const p = Math.max(Number.EPSILON, Math.min(1 - Number.EPSILON, probabilities[i]));
    logLoss -= outcomes[i] * Math.log(p) + (1 - outcomes[i]) * Math.log1p(-p);
  }
  const ranked = probabilities.map((p, i) => ({ p, y: outcomes[i] })).sort((a, b) => b.p - a.p);
  let positives = 0;
  let negatives = 0;
  let aucNumerator = 0;
  let precisionSum = 0;
  for (let i = 0; i < n;) {
    let j = i;
    let groupEvents = 0;
    while (j < n && ranked[j].p === ranked[i].p) {
      groupEvents += ranked[j].y;
      j++;
    }
    const groupNegatives = j - i - groupEvents;
    // Each higher-scored positive beats later negatives; tied pairs count half.
    aucNumerator += groupEvents * ((n - events) - negatives - groupNegatives + groupNegatives / 2);
    positives += groupEvents;
    negatives += groupNegatives;
    precisionSum += groupEvents * positives / j;
    i = j;
  }
  return {
    rows: n, events, brier: brier / n, logLoss: logLoss / n,
    rocAuc: events > 0 && events < n ? aucNumerator / (events * (n - events)) : null,
    averagePrecision: events > 0 ? precisionSum / events : null
  };
}

export interface HistoricalEvaluation {
  schemaVersion: number;
  modelVersion: string;
  dataSha256: string;
  constantTrainingRate: number;
  rows: {
    country: string;
    predictorYear: number;
    outcomeYear: number;
    outcome: number;
    values: (number | null)[];
  }[];
}

export function getBacktestValidation(history: HistoricalEvaluation = historicalData) {
  if (history.schemaVersion !== 1 || history.modelVersion !== FITTED_MODELS.modelVersion ||
    history.dataSha256 !== FITTED_MODELS.dataSha256 ||
    !Number.isFinite(history.constantTrainingRate) ||
    history.constantTrainingRate <= 0 || history.constantTrainingRate >= 1 ||
    Math.abs(history.constantTrainingRate - FITTED_MODELS.hazard.trainingEvents / FITTED_MODELS.hazard.trainingRows) > 1e-12 ||
    !Array.isArray(history.rows) || history.rows.length === 0) {
    throw new Error('Historical evaluation does not match the fitted model and observed panel.');
  }
  const seen = new Set<string>();
  const probabilities = { firth: [] as number[], lightgbm: [] as number[], blend: [] as number[], constantTrainingRate: [] as number[] };
  const outcomes: number[] = [];
  for (const row of history.rows) {
    const key = `${row.country}/${row.predictorYear}`;
    if (!/^[A-Z]{3}$/.test(row.country) || !Number.isInteger(row.predictorYear) ||
      row.predictorYear < FITTED_MODELS.hazard.testPredictorYears[0] ||
      row.predictorYear > FITTED_MODELS.hazard.testPredictorYears[1] ||
      row.outcomeYear !== row.predictorYear + 1 || (row.outcome !== 0 && row.outcome !== 1) ||
      seen.has(key) || !Array.isArray(row.values) || row.values.filter(v => v !== null).length < 4) {
      throw new Error(`Invalid or duplicated held-out country-year: ${key}`);
    }
    seen.add(key);
    const prediction = predictAnnualHazard(row.values);
    probabilities.firth.push(prediction.firthLogitProb);
    probabilities.lightgbm.push(prediction.lightgbmProb);
    probabilities.blend.push(prediction.reconciledHazard);
    probabilities.constantTrainingRate.push(history.constantTrainingRate);
    outcomes.push(row.outcome);
  }
  const models = {
    firth: computeBinaryMetrics(outcomes, probabilities.firth),
    lightgbm: computeBinaryMetrics(outcomes, probabilities.lightgbm),
    blend: computeBinaryMetrics(outcomes, probabilities.blend),
    constantTrainingRate: computeBinaryMetrics(outcomes, probabilities.constantTrainingRate)
  };
  return {
    modelVersion: history.modelVersion, dataSha256: history.dataSha256,
    rows: outcomes.length, events: models.blend.events,
    predictorYears: [Math.min(...history.rows.map(r => r.predictorYear)), Math.max(...history.rows.map(r => r.predictorYear))],
    outcomeYears: [Math.min(...history.rows.map(r => r.outcomeYear)), Math.max(...history.rows.map(r => r.outcomeYear))],
    models
  };
}

export interface LossObservation {
  portfolio: string;
  modelVersion: string;
  unit: string;
  forecastIssuedAt: string;
  periodStart: string;
  periodEnd: string;
  confidence: number;
  var: number;
  es?: number;
  loss: number;
}

type LikelihoodResult =
  | { available: true; statistic: number; pValue: number; reject: boolean }
  | { available: false; reason: string };
export interface LossBacktest {
  portfolio: string;
  modelVersion: string;
  unit: string;
  confidence: number;
  observations: number;
  breaches: number;
  expectedBreaches: number;
  transitions: { n00: number; n01: number; n10: number; n11: number };
  kupiec: LikelihoodResult;
  independence: LikelihoodResult;
  conditionalCoverage: LikelihoodResult;
  es: { available: true; statistic: number } | { available: false; reason: string };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function timestamp(value: unknown): number {
  if (typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw new Error('Forecast and period timestamps must be UTC ISO dates, for example 2024-01-01T00:00:00Z.');
  }
  const result = Date.parse(value);
  if (!Number.isFinite(result) || new Date(result).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new Error(`Invalid historical timestamp: ${value}`);
  }
  return result;
}

function validLossObservation(value: unknown): value is LossObservation {
  if (!object(value)) return false;
  return ['portfolio', 'modelVersion', 'unit'].every(key =>
    typeof value[key] === 'string' && String(value[key]).trim().length > 0) &&
    typeof value.forecastIssuedAt === 'string' && typeof value.periodStart === 'string' &&
    typeof value.periodEnd === 'string' &&
    typeof value.confidence === 'number' && Number.isFinite(value.confidence) && value.confidence > 0 && value.confidence < 1 &&
    typeof value.var === 'number' && Number.isFinite(value.var) && value.var >= 0 &&
    typeof value.loss === 'number' && Number.isFinite(value.loss) &&
    (value.es === undefined || (typeof value.es === 'number' && Number.isFinite(value.es) && value.es > 0 && value.es >= value.var));
}

export function parseLossHistory(value: unknown): LossObservation[] {
  if (!Array.isArray(value) || value.length < 2 || !value.every(validLossObservation)) {
    throw new Error('Supply at least two loss records with portfolio, modelVersion, unit, UTC timestamps, confidence in (0,1), nonnegative VaR, finite loss and optional positive ES >= VaR.');
  }
  const ordered = [...value].sort((a, b) => timestamp(a.periodStart) - timestamp(b.periodStart));
  const first = ordered[0];
  const horizon = timestamp(first.periodEnd) - timestamp(first.periodStart);
  let previousEnd: number | undefined;
  for (const row of ordered) {
    const start = timestamp(row.periodStart);
    const end = timestamp(row.periodEnd);
    const issued = timestamp(row.forecastIssuedAt);
    if (issued > start || start >= end || end > Date.now()) {
      throw new Error('Require forecasts issued no later than period start and completed, positive-length historical periods.');
    }
    if (previousEnd !== undefined && start < previousEnd) throw new Error('Duplicate or overlapping loss periods are not allowed.');
    if (row.portfolio !== first.portfolio || row.modelVersion !== first.modelVersion ||
      row.unit !== first.unit || row.confidence !== first.confidence || end - start !== horizon) {
      throw new Error('Use one portfolio, model version, unit, confidence and fixed period duration per historical backtest.');
    }
    if ((row.es === undefined) !== (first.es === undefined)) throw new Error('Supply ES for every record or omit it for every record.');
    previousEnd = end;
  }
  return ordered;
}

function binomialLogLikelihood(successes: number, failures: number, probability: number): number {
  return (successes === 0 ? 0 : successes * Math.log(probability)) +
    (failures === 0 ? 0 : failures * Math.log1p(-probability));
}

// erfc approximation (absolute error below 1.5e-7) for chi-square(1) survival probabilities.
function erfc(x: number): number {
  if (x === 0) return 1;
  const t = 1 / (1 + 0.5 * x);
  return t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 +
    t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 +
      t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
}

function likelihoodResult(statistic: number, degreesOfFreedom: 1 | 2): Extract<LikelihoodResult, { available: true }> {
  if (!Number.isFinite(statistic)) throw new Error('Non-finite historical likelihood-ratio statistic.');
  const lr = Math.max(0, statistic);
  const pValue = Math.min(1, Math.max(0, degreesOfFreedom === 1 ? erfc(Math.sqrt(lr / 2)) : Math.exp(-lr / 2)));
  return { available: true, statistic: lr, pValue, reject: pValue < 0.05 };
}

export function computeLossBacktest(input: LossObservation[]): LossBacktest {
  const rows = parseLossHistory(input);
  const first = rows[0];
  const n = rows.length;
  const hits = rows.map(row => row.loss > row.var);
  const breaches = hits.filter(Boolean).length;
  const q = 1 - first.confidence;
  const nullLikelihood = breaches * Math.log(q) + (n - breaches) * Math.log(first.confidence);
  const fittedLikelihood = binomialLogLikelihood(breaches, n - breaches, breaches / n);
  const kupiec = likelihoodResult(2 * (fittedLikelihood - nullLikelihood), 1);
  const transitions = { n00: 0, n01: 0, n10: 0, n11: 0 };
  for (let i = 1; i < n; i++) {
    // Missing periods cannot be treated as adjacent observations.
    if (rows[i].periodStart !== rows[i - 1].periodEnd &&
      timestamp(rows[i].periodStart) !== timestamp(rows[i - 1].periodEnd)) continue;
    if (hits[i - 1]) {
      if (hits[i]) transitions.n11++; else transitions.n10++;
    } else {
      if (hits[i]) transitions.n01++; else transitions.n00++;
    }
  }
  const { n00, n01, n10, n11 } = transitions;
  const afterNoBreach = n00 + n01;
  const afterBreach = n10 + n11;
  let independence: LikelihoodResult;
  let conditionalCoverage: LikelihoodResult;
  if (afterNoBreach === 0 || afterBreach === 0) {
    independence = { available: false, reason: 'Insufficient consecutive transitions following both breach and non-breach states.' };
    conditionalCoverage = { available: false, reason: 'Independence component is not identifiable from these transitions.' };
  } else {
    const unrestricted = binomialLogLikelihood(n01, n00, n01 / afterNoBreach) +
      binomialLogLikelihood(n11, n10, n11 / afterBreach);
    const independent = binomialLogLikelihood(n01 + n11, n00 + n10,
      (n01 + n11) / (afterNoBreach + afterBreach));
    independence = likelihoodResult(2 * (unrestricted - independent), 1);
    conditionalCoverage = likelihoodResult(kupiec.statistic + independence.statistic, 2);
  }
  let es: LossBacktest['es'] = { available: false, reason: 'No same-confidence historical ES forecasts supplied.' };
  if (first.es !== undefined) {
    let ratioSum = 0;
    for (let i = 0; i < n; i++) {
      const expectedShortfall = rows[i].es;
      if (expectedShortfall === undefined) throw new Error('Missing ES forecast.');
      if (hits[i]) ratioSum += rows[i].loss / expectedShortfall;
    }
    const statistic = 1 - ratioSum / (n * q);
    if (!Number.isFinite(statistic)) throw new Error('Non-finite ES exceedance statistic.');
    es = { available: true, statistic };
  }
  return {
    portfolio: first.portfolio, modelVersion: first.modelVersion, unit: first.unit,
    confidence: first.confidence, observations: n, breaches, expectedBreaches: n * q,
    transitions, kupiec, independence, conditionalCoverage, es
  };
}
