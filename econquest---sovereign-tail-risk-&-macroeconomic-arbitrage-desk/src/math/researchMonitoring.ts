import { Dataset, Observation } from '../services/dataApi';
import { BENCHMARK_SOVEREIGNS } from '../data/sovereignData';
import {
  ANNUAL_FEATURES, FITTED_MODELS, filterAnnualRegimes, getAnnualHistory, hasObservedHistory, importAnnualRows, predictAnnualHazard
} from './fittedModels';

export const RESEARCH_COUNTRIES = BENCHMARK_SOVEREIGNS.filter(s => hasObservedHistory(s.code));

export function annualRows(observations: Observation[]): Record<string, unknown>[] {
  return observations.map(row => {
    if (!row.country || !Number.isInteger(row.year) || typeof row.inDefault !== 'boolean' ||
      !row.values || row.values.length !== 6) throw new Error('Incomplete annual observation contract.');
    return {
      country_code: row.country, year: row.year, in_default: row.inDefault,
      ...Object.fromEntries(ANNUAL_FEATURES.map((key, i) => [key, row.values![i]]))
    };
  });
}

export function annualResearch(dataset?: Dataset) {
  if (dataset && dataset.kind !== 'annual') throw new Error('Annual research requires an annual dataset.');
  const entities = dataset ? importAnnualRows(annualRows(dataset.observations), RESEARCH_COUNTRIES) : RESEARCH_COUNTRIES;
  return entities.map(entity => {
    const history = getAnnualHistory(entity);
    const last = history[history.length - 1];
    const imported = dataset?.observations.some(row => row.country === entity.code) ?? false;
    return {
      code: entity.code, name: entity.name,
      observationYear: last.year, forecastYear: last.year + 1, inDefault: last.inDefault,
      inputs: history, modelVersion: FITTED_MODELS.modelVersion,
      inputVersion: imported ? dataset!.version : `bundled-${FITTED_MODELS.dataSha256}`,
      source: imported ? `${dataset!.source} overlaid on bundled annual history` : 'Bundled World Bank / BoC-BoE revised historical snapshot',
      baselineSha256: FITTED_MODELS.dataSha256,
      imported,
      imputedFeatures: ANNUAL_FEATURES.filter((_, i) => last.values[i] === null),
      ...predictAnnualHazard(last.values),
      ...filterAnnualRegimes(history)
    };
  });
}

export function observationTime(row: Observation): number {
  if (row.observedAt !== undefined) return Date.parse(row.observedAt);
  if (row.year !== undefined) return Date.UTC(row.year, 11, 31, 23, 59, 59);
  throw new Error('Observation has no period.');
}

export function freshness(dataset: Dataset, now: number) {
  const groups = new Map<string, number>();
  for (const row of dataset.observations) {
    const key = row.country ?? row.symbol;
    const observed = observationTime(row);
    if (!key || !Number.isFinite(observed) || observed > now) throw new Error('Invalid observation time or identity.');
    groups.set(key, Math.max(groups.get(key) ?? -Infinity, observed));
  }
  const ages = [...groups].map(([series, latest]) => ({ series, latest, ageDays: (now - latest) / 86400000 }));
  const stale = dataset.freshnessDays !== null && ages.some(item => item.ageDays > dataset.freshnessDays!);
  if (dataset.sessionPolicy) {
    const expired = now >= Date.parse(dataset.sessionPolicy.nextCheckAt);
    const complete = ages.every(item => item.latest === Date.parse(dataset.sessionPolicy!.expectedCloseAt));
    return {
      state: expired ? 'unverified' as const : complete ? 'current' as const : 'stale' as const,
      eligible: !expired && complete,
      ages, importAgeDays: (now - Date.parse(dataset.createdAt)) / 86400000
    };
  }
  return {
    state: dataset.freshnessDays === null ? 'unverified' as const : stale ? 'stale' as const : 'current' as const,
    eligible: dataset.freshnessDays !== null && !stale,
    ages,
    importAgeDays: (now - Date.parse(dataset.createdAt)) / 86400000
  };
}

export function marketSeries(dataset: Dataset, symbol: string) {
  if (dataset.kind !== 'market') throw new Error('Market monitoring requires market data.');
  const rows = dataset.observations.filter(row => row.symbol === symbol).sort((a, b) => observationTime(a) - observationTime(b));
  if (rows.length === 0 || rows.some(row => typeof row.value !== 'number' || !Number.isFinite(row.value))) {
    throw new Error('No valid market observations for this symbol.');
  }
  const latest = rows[rows.length - 1];
  const previous = rows.at(-2);
  // Absolute changes are meaningful across more units than percentage returns.
  const change = previous ? latest.value! - previous.value! : null;
  return { rows, latest, previous, change };
}
