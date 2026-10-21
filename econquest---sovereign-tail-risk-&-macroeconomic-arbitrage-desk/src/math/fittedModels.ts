import rawArtifact from '../data/fittedAnnualModels.json';
import { CustomScenarioParams, MacroScenario, RegimeType, SovereignEntity } from '../types/riskEngine';
import { DEFAULT_CUSTOM_SCENARIO } from '../data/defaultCustomScenarios';

export const ANNUAL_FEATURES = [
  'externalDebtGni', 'shortTermDebtReserves', 'reservesMonths',
  'gdpGrowth', 'inflation', 'currentAccountGdp'
] as const;
export type AnnualFeature = typeof ANNUAL_FEATURES[number];

export const ANNUAL_FEATURE_LABELS: Record<AnnualFeature, string> = {
  externalDebtGni: 'External debt / GNI (%)',
  shortTermDebtReserves: 'Short-term debt / total reserves (%)',
  reservesMonths: 'Gross reserves (months of imports)',
  gdpGrowth: 'Real GDP growth (%)',
  inflation: 'CPI inflation (%)',
  currentAccountGdp: 'Current account / GDP (%)'
};

export interface AnnualObservation {
  year: number;
  values: (number | null)[];
  inDefault: boolean;
}

interface Leaf { leaf_value: number }
interface Split {
  split_feature: number;
  threshold: number;
  decision_type: '<=';
  left_child: Tree;
  right_child: Tree;
}
type Tree = Leaf | Split;
interface Evaluation {
  rows: number;
  events: number;
  brier: number;
  logLoss: number;
  rocAuc: number;
  averagePrecision: number;
}
interface Artifact {
  schemaVersion: number;
  modelVersion: string;
  status: 'research-only';
  dataSha256: string;
  features: string[];
  preprocessing: { medians: number[]; asinhScales: number[]; center: number[]; scale: number[] };
  hazard: {
    target: string;
    trainingPredictorYears: number[];
    validationPredictorYears: number[];
    testPredictorYears: number[];
    trainingRows: number;
    trainingEvents: number;
    firth: { coefficients: number[]; iterations: number };
    lightgbm: { trees: Tree[]; monotoneConstraints: number[] };
    lightgbmWeight: number;
    test: { firth: Evaluation; lightgbm: Evaluation; blend: Evaluation; constantTrainingRate: Evaluation };
  };
  hmm: {
    featureIndices: number[];
    states: RegimeType[];
    center: number[];
    scale: number[];
    initial: number[];
    transition: number[][];
    means: number[][];
    variances: number[][];
    trainingThrough: number;
    trainingSequences: number;
    trainingObservations: number;
  };
  countries: Record<string, AnnualObservation[]>;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function vector(value: unknown, size: number, positive = false): value is number[] {
  return Array.isArray(value) && value.length === size &&
    value.every(v => typeof v === 'number' && Number.isFinite(v) && (!positive || v > 0));
}

function probabilityVector(value: unknown): value is number[] {
  return vector(value, 3, true) && value.every(v => v <= 1) &&
    Math.abs(value.reduce((a, b) => a + b, 0) - 1) < 1e-8;
}

function validTree(value: unknown, depth = 0): value is Tree {
  if (!object(value) || depth > 64) return false;
  if ('leaf_value' in value) return typeof value.leaf_value === 'number' && Number.isFinite(value.leaf_value);
  return Number.isInteger(value.split_feature) && Number(value.split_feature) >= 0 &&
    Number(value.split_feature) < ANNUAL_FEATURES.length && value.decision_type === '<=' &&
    typeof value.threshold === 'number' && Number.isFinite(value.threshold) &&
    validTree(value.left_child, depth + 1) && validTree(value.right_child, depth + 1);
}

function validEvaluation(value: unknown): value is Evaluation {
  return object(value) && ['rows', 'events', 'brier', 'logLoss', 'rocAuc', 'averagePrecision']
    .every(key => typeof value[key] === 'number' && Number.isFinite(value[key]));
}

export function validateAnnualHistory(value: unknown): asserts value is AnnualObservation[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error('An annual model needs at least two consecutive observed years.');
  }
  let lastYear: number | undefined;
  for (const row of value) {
    if (!object(row)) throw new Error('Invalid annual observation.');
    const values = row.values;
    if (!Number.isInteger(row.year) || Number(row.year) < 1900 || Number(row.year) > new Date().getUTCFullYear() ||
      typeof row.inDefault !== 'boolean' || !Array.isArray(values) ||
      values.length !== ANNUAL_FEATURES.length ||
      !values.every(v => v === null || (typeof v === 'number' && Number.isFinite(v))) ||
      [0, 1, 2].some(index => values[index] !== null && Number(values[index]) < 0) ||
      [2, 3, 4].some(index => values[index] === null) ||
      values.filter(v => v !== null).length < 4 ||
      (lastYear !== undefined && row.year !== lastYear + 1)) {
      throw new Error('Invalid annual history: require ordered, consecutive years, at least four predictors, and observed reserves, GDP growth and inflation.');
    }
    lastYear = Number(row.year);
  }
}

export function validateArtifact(value: unknown): asserts value is Artifact {
  if (!object(value) || value.schemaVersion !== 1 || typeof value.modelVersion !== 'string' ||
    value.status !== 'research-only' ||
    typeof value.dataSha256 !== 'string' ||
    JSON.stringify(value.features) !== JSON.stringify(ANNUAL_FEATURES) ||
    !object(value.preprocessing) || !object(value.hazard) || !object(value.hmm) ||
    !object(value.countries)) throw new Error('Unsupported fitted annual model artifact.');
  const p = value.preprocessing;
  const h = value.hazard;
  const m = value.hmm;
  const evaluations = h.test;
  if (!vector(p.medians, 6) || !vector(p.asinhScales, 6, true) ||
    !vector(p.center, 6) || !vector(p.scale, 6, true) ||
    typeof h.target !== 'string' || !vector(h.trainingPredictorYears, 2) ||
    !vector(h.validationPredictorYears, 2) || !vector(h.testPredictorYears, 2) ||
    typeof h.trainingRows !== 'number' || typeof h.trainingEvents !== 'number' ||
    !object(h.firth) || !vector(h.firth.coefficients, 7) ||
    typeof h.firth.iterations !== 'number' || !object(h.lightgbm) ||
    !Array.isArray(h.lightgbm.trees) || h.lightgbm.trees.length === 0 ||
    !h.lightgbm.trees.every(tree => validTree(tree)) ||
    !vector(h.lightgbm.monotoneConstraints, 6) ||
    typeof h.lightgbmWeight !== 'number' || !Number.isFinite(h.lightgbmWeight) ||
    h.lightgbmWeight < 0 || h.lightgbmWeight > 1 || !object(evaluations) ||
    !['firth', 'lightgbm', 'blend', 'constantTrainingRate'].every(key => validEvaluation(evaluations[key])) ||
    JSON.stringify(m.featureIndices) !== '[2,3,4]' ||
    JSON.stringify(m.states) !== '["Calm","Stressed","Crisis"]' ||
    !vector(m.center, 3) || !vector(m.scale, 3, true) || !probabilityVector(m.initial) ||
    !Array.isArray(m.transition) || m.transition.length !== 3 || !m.transition.every(probabilityVector) ||
    !Array.isArray(m.means) || m.means.length !== 3 || !m.means.every(row => vector(row, 3)) ||
    !Array.isArray(m.variances) || m.variances.length !== 3 || !m.variances.every(row => vector(row, 3, true)) ||
    typeof m.trainingThrough !== 'number' || typeof m.trainingSequences !== 'number' ||
    typeof m.trainingObservations !== 'number') {
    throw new Error('Invalid fitted coefficients, tree structure, preprocessing, or HMM parameters.');
  }
  for (const history of Object.values(value.countries)) validateAnnualHistory(history);
}

const validated: unknown = rawArtifact;
validateArtifact(validated);
export const FITTED_MODELS = validated;

export function hasObservedHistory(code: string): boolean {
  return Object.hasOwn(FITTED_MODELS.countries, code);
}

export function getAnnualHistory(entity: SovereignEntity): AnnualObservation[] {
  const history = entity.annualMacroHistory ??
    (hasObservedHistory(entity.code) ? FITTED_MODELS.countries[entity.code] : undefined);
  if (!history) throw new Error(`No observed annual training/inference history for ${entity.code}.`);
  validateAnnualHistory(history);
  return history;
}

function sigmoid(value: number): number {
  return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
}

export function standardizeAnnual(values: (number | null)[]): number[] {
  const p = FITTED_MODELS.preprocessing;
  if (values.length !== 6 || values.some(v => v !== null && !Number.isFinite(v))) {
    throw new Error('Expected six finite or explicitly missing annual predictors.');
  }
  return values.map((v, i) =>
    (Math.asinh((v ?? p.medians[i]) / p.asinhScales[i]) - p.center[i]) / p.scale[i]);
}

function evaluateTree(tree: Tree, values: number[]): number {
  if ('leaf_value' in tree) return tree.leaf_value;
  return evaluateTree(values[tree.split_feature] <= tree.threshold ? tree.left_child : tree.right_child, values);
}

export function predictAnnualHazard(values: (number | null)[]) {
  const x = standardizeAnnual(values);
  const model = FITTED_MODELS.hazard;
  const logitValue = model.firth.coefficients[0] +
    x.reduce((sum, value, index) => sum + value * model.firth.coefficients[index + 1], 0);
  const firthLogitProb = sigmoid(logitValue);
  const lightgbmProb = sigmoid(model.lightgbm.trees.reduce((sum, tree) => sum + evaluateTree(tree, x), 0));
  return {
    logitValue, firthLogitProb, lightgbmProb,
    reconciledHazard: (1 - model.lightgbmWeight) * firthLogitProb + model.lightgbmWeight * lightgbmProb
  };
}

export function filterAnnualRegimes(history: AnnualObservation[]) {
  validateAnnualHistory(history);
  const model = FITTED_MODELS.hmm;
  let posterior = [...model.initial];
  for (let t = 0; t < history.length; t++) {
    const prior = t === 0 ? posterior : model.states.map((_, j) =>
      posterior.reduce((sum, probability, i) => sum + probability * model.transition[i][j], 0));
    const observation = model.featureIndices.map((index, j) => {
      const value = history[t].values[index];
      if (value === null) throw new Error('HMM emissions cannot be imputed.');
      return (Math.asinh(value / FITTED_MODELS.preprocessing.asinhScales[index]) - model.center[j]) / model.scale[j];
    });
    const logWeights = model.states.map((_, state) =>
      Math.log(prior[state]) - 0.5 * observation.reduce((sum, value, j) =>
        sum + Math.log(2 * Math.PI * model.variances[state][j]) +
          (value - model.means[state][j]) ** 2 / model.variances[state][j], 0));
    const largest = Math.max(...logWeights);
    const weights = logWeights.map(logWeight => Math.exp(logWeight - largest));
    const total = weights.reduce((a, b) => a + b, 0);
    posterior = weights.map(weight => weight / total);
  }
  return {
    regime: model.states[posterior.indexOf(Math.max(...posterior))],
    regimeProbabilities: { calm: posterior[0], stressed: posterior[1], crisis: posterior[2] }
  };
}

export function getScenarioHistory(
  entity: SovereignEntity,
  scenario: MacroScenario,
  params: CustomScenarioParams = DEFAULT_CUSTOM_SCENARIO
): AnnualObservation[] {
  const history = getAnnualHistory(entity);
  if (scenario === 'baseline') return history;
  const latest = history[history.length - 1];
  const values = [...latest.values];
  const add = (i: number, delta: number) => { if (values[i] !== null) values[i] += delta; };
  const multiply = (i: number, factor: number) => { if (values[i] !== null) values[i] *= factor; };
  // Scenario perturbations are disclosed assumptions, not estimated causal effects.
  if (scenario === 'scenarioA_fedTightening') {
    multiply(0, 1.08); multiply(1, 1.4); multiply(2, 0.75);
    add(3, -1); add(4, 2); add(5, -1);
  } else if (scenario === 'scenarioB_commodityCollapse') {
    multiply(2, 0.65); add(3, -2); add(4, 3); add(5, -3.8);
  } else if (scenario === 'scenarioC_malaccaBlockade') {
    const exposed = entity.maritimeChokepointExposure === 'High' || entity.maritimeChokepointExposure === 'Critical';
    add(3, exposed ? -1.8 : -0.5); add(4, exposed ? 4 : 1); add(5, exposed ? -1.8 : -0.5);
  } else {
    multiply(0, 1 + params.broadUsdAppreciation / 100);
    multiply(1, Math.max(0.1, 1 + params.broadUsdAppreciation / 100 * 1.4));
    multiply(2, Math.max(0.2, 1 + params.reserveDrainPercent / 100));
    add(3, -(params.usYieldCurveShiftBps + params.sovereignSpreadWideningBps) / 500);
    add(4, params.broadUsdAppreciation * 0.15 + params.energyOilShockPercent * 0.03);
    add(5, params.commodityPriceShockPercent * 0.08);
  }
  if (values.some(v => v !== null && !Number.isFinite(v))) throw new Error('Non-finite annual scenario predictors.');
  // Replace the terminal emission; do not pretend an extra year has elapsed.
  return [...history.slice(0, -1), { ...latest, values }];
}

export function annualModelProvenance(entity: SovereignEntity) {
  const history = getAnnualHistory(entity);
  const latest = history[history.length - 1];
  return {
    version: FITTED_MODELS.modelVersion,
    observationYear: latest.year,
    forecastYear: latest.year + 1,
    source: entity.annualMacroHistory ? 'User-supplied annual observations' : 'World Bank WDI / BoC-BoE 2025 release',
    inDefault: latest.inDefault,
    status: FITTED_MODELS.status,
    target: FITTED_MODELS.hazard.target,
    imputedFeatures: ANNUAL_FEATURES.filter((_, i) => latest.values[i] === null),
    lightgbmWeight: FITTED_MODELS.hazard.lightgbmWeight
  };
}

export function importAnnualRows(
  rows: Record<string, unknown>[],
  sovereigns: SovereignEntity[]
): SovereignEntity[] {
  if (rows.length === 0) throw new Error('No annual observations supplied.');
  const incoming = new Map<string, Map<number, AnnualObservation>>();
  for (const row of rows) {
    const code = String(row.country_code ?? '').trim().toUpperCase();
    if (!sovereigns.some(entity => entity.code === code)) throw new Error(`Unknown sovereign code: ${code}`);
    const year = Number(row.year);
    const inDefault = row.in_default;
    const defaulted = inDefault === true || inDefault === 1 || inDefault === '1' || inDefault === 'true';
    const notDefaulted = inDefault === false || inDefault === 0 || inDefault === '0' || inDefault === 'false';
    if (!Number.isInteger(year) || year < 1900 || (!defaulted && !notDefaulted)) {
      throw new Error(`Invalid year or explicit in_default flag for ${code}.`);
    }
    const values = ANNUAL_FEATURES.map(name => {
      const value = row[name];
      if (value === '' || value === null || value === undefined) return null;
      if (typeof value !== 'number' && typeof value !== 'string') throw new Error(`Invalid ${name} for ${code}.`);
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) throw new Error(`Non-finite ${name} for ${code}.`);
      return numeric;
    });
    let country = incoming.get(code);
    if (!country) { country = new Map(); incoming.set(code, country); }
    if (country.has(year)) throw new Error(`Duplicate ${code}/${year} observation.`);
    country.set(year, { year, values, inDefault: defaulted });
  }
  return sovereigns.map(entity => {
    const incomingHistory = incoming.get(entity.code);
    if (!incomingHistory) return entity;
    const history = new Map(getAnnualHistory(entity).map(row => [row.year, row]));
    for (const [year, row] of incomingHistory) history.set(year, row);
    const annualMacroHistory = [...history.values()].sort((a, b) => a.year - b.year);
    validateAnnualHistory(annualMacroHistory);
    return { ...entity, annualMacroHistory };
  });
}
