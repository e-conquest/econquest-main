/**
 * Which pre-registered nowcast/forecast evaluations (data/local/validation/forecasts.json) stand
 * behind each Models & validation entry, and the one status the entry's badge shows. Pure.
 */
import type { ValidationStatus } from '../data/modelRegister';

export const REGISTER_FORECAST_IDS: Record<string, string[]> = {
  gdp_nowcast: ['gdp_nowcast'],
  app_forecasts: ['cpi_nowcast', 'gdp_forecast', 'cpi_forecast', 'policy_rate_forecast', 'debt_forecast'],
  debt_fan: ['debt_fan_coverage'],
  // Currency factor tests (docs/validation/signals/, npm run signals:evaluate) use the same verdict shape.
  fx_carry: ['fx_carry'],
  fx_value: ['fx_value'],
  fx_momentum: ['fx_momentum'],
};

export interface ForecastVerdict {
  id: string;
  status: 'passed' | 'failed' | 'too_few_cases';
  verdict: string;
  specVersion: number;
  specHash: string;
  ranAt: string;
  /** Currency factor tests: how the strategy lost when it lost (src/utils/fxFactors.ts crashSentence). */
  crash?: string;
}

/** Passed only when every evaluation behind the entry passed; failed when any failed; else none. */
export function forecastRegisterStatus(entryId: string, results: Record<string, ForecastVerdict> | undefined): ValidationStatus | undefined {
  const ids = REGISTER_FORECAST_IDS[entryId];
  if (!ids || !results) return undefined;
  const got = ids.map((id) => results[id]).filter((r): r is ForecastVerdict => Boolean(r));
  if (!got.length) return undefined;
  if (got.some((r) => r.status === 'failed')) return 'failed';
  if (got.length === ids.length && got.every((r) => r.status === 'passed')) return 'passed';
  return got.some((r) => r.status === 'too_few_cases') ? 'too_few_cases' : undefined;
}

export function forecastVerdicts(entryId: string, results: Record<string, ForecastVerdict> | undefined): ForecastVerdict[] {
  return (REGISTER_FORECAST_IDS[entryId] || []).map((id) => results?.[id]).filter((r): r is ForecastVerdict => Boolean(r));
}

/** The n series with the highest relative RMSE (model against benchmark), worst first. */
export function worstSeries<T extends { where: string; relRmse: number }>(bySeries: T[], n: number): T[] {
  return bySeries.slice().sort((a, b) => b.relRmse - a.relRmse).slice(0, n);
}
