/**
 * IMF DataMapper series beyond the five the snapshot always read (gap analysis D5, 2026-11-07):
 * Fiscal Monitor revenue, expenditure and overall balance, and WEO unemployment and current
 * account. Codes, labels and units checked against https://www.imf.org/external/datamapper/api/v1/indicators
 * on 2026-11-07. Each fills imfIndicators.<field> only when the IMF has a figure; otherwise the
 * figure reads Missing. Browser-safe.
 */

export interface ImfExtraSeries {
  /** Field under imfIndicators (live-field key `imf.<field>`). */
  field: 'revenuePct' | 'expenditurePct' | 'overallBalancePct' | 'unemploymentPct' | 'currentAccountUsdBn' | 'currentAccountImfPct';
  label: string;
  unit: string;
  dataset: 'Fiscal Monitor' | 'WEO';
  dp: number;
}

export const IMF_EXTRA: Record<string, ImfExtraSeries> = {
  GGR_G01_GDP_PT: { field: 'revenuePct', label: 'Government revenue', unit: '% of GDP', dataset: 'Fiscal Monitor', dp: 1 },
  G_X_G01_GDP_PT: { field: 'expenditurePct', label: 'Government expenditure', unit: '% of GDP', dataset: 'Fiscal Monitor', dp: 1 },
  GGXCNL_G01_GDP_PT: { field: 'overallBalancePct', label: 'Overall balance', unit: '% of GDP', dataset: 'Fiscal Monitor', dp: 2 },
  LUR: { field: 'unemploymentPct', label: 'Unemployment rate', unit: '%', dataset: 'WEO', dp: 1 },
  BCA: { field: 'currentAccountUsdBn', label: 'Current account', unit: 'US$ bn', dataset: 'WEO', dp: 1 },
  BCA_NGDPD: { field: 'currentAccountImfPct', label: 'Current account (IMF WEO)', unit: '% of GDP', dataset: 'WEO', dp: 1 },
};

/**
 * Net interest paid by the government, % of GDP: the primary balance minus the overall balance
 * (both IMF Fiscal Monitor, same year). Undefined unless both are given and the years match.
 */
export function netInterestPct(primaryPct: number | undefined, overallPct: number | undefined, primaryYear?: string, overallYear?: string): number | undefined {
  if (!Number.isFinite(primaryPct) || !Number.isFinite(overallPct)) return undefined;
  if (primaryYear && overallYear && primaryYear !== overallYear) return undefined;
  return Number(((primaryPct as number) - (overallPct as number)).toFixed(2));
}
