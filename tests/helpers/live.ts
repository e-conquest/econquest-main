import type { OpenDataSnapshot } from '../../src/types/council.ts';

/** Figure paths the free IMF, World Bank, GDELT and FX feeds fill. */
export const FEED_PATHS = [
  'imf.debtToGdpPct',
  'imf.debtToGdpForecast2027Pct',
  'imf.cpiInflationPct',
  'imf.realGdpGrowthPct',
  'imf.primaryFiscalBalancePct',
  'wb.fxReservesMonthsImport',
  'wb.currentAccountPctGdp',
  'wb.externalDebtPctGni',
  'wb.politicalStabilityPercentile',
  'gdelt.averageTone',
  'market.exchangeRatePerUsd',
];

/**
 * Test figures a feed might return. The app ships no built-in figures (the empty snapshot is all
 * NaN), so a test that marks a figure live also gives it a value, unless the test set one already.
 */
export const TEST_FEED_VALUES: Record<string, number> = {
  'imf.debtToGdpPct': 86.4,
  'imf.debtToGdpForecast2027Pct': 91.2,
  'imf.cpiInflationPct': 4.55,
  'imf.realGdpGrowthPct': 2.8,
  'imf.primaryFiscalBalancePct': -0.6,
  'wb.fxReservesMonthsImport': 14.2,
  'wb.currentAccountPctGdp': -1.7,
  'wb.externalDebtPctGni': 29.4,
  'wb.politicalStabilityPercentile': 38.5,
  'gdelt.averageTone': -1.8,
  'gdelt.conflictIntensityIndex': 36,
  'market.exchangeRatePerUsd': 5.74,
  'market.fxYtdChangePct': -14.8,
  'market.sovereign10YBondYieldPct': 12.85,
  'market.policyRatePct': 11.75,
  'market.cds5YSpreadBps': 168,
};

const SECTION: Record<string, string> = { imf: 'imfIndicators', wb: 'worldBankIndicators', gdelt: 'gdeltMetrics', market: 'monetaryAndMarket' };

/** Gives each path its test value when the snapshot has none (NaN). */
export function fillTestValues(s: OpenDataSnapshot, paths: string[] = FEED_PATHS): OpenDataSnapshot {
  for (const p of paths) {
    const [prefix, key] = p.split('.');
    const section = (s as any)[SECTION[prefix]];
    if (section && !Number.isFinite(section[key]) && TEST_FEED_VALUES[p] !== undefined) section[key] = TEST_FEED_VALUES[p];
  }
  return s;
}

/** Marks figures as filled by a live feed, as the server does when a feed answers. */
export function markLive(s: OpenDataSnapshot, paths: string[] = FEED_PATHS): OpenDataSnapshot {
  fillTestValues(s, paths);
  s.liveFields = { ...(s.liveFields || {}), ...Object.fromEntries(paths.map((p) => [p, p.startsWith('imf.') ? 'IMF WEO' : p.startsWith('wb.') ? 'World Bank' : 'live feed'])) };
  const feeds = new Set(s.dataStatus?.verifiedLiveSources || []);
  if (paths.some((p) => p.startsWith('imf.'))) feeds.add('IMF DataMapper WEO');
  if (paths.some((p) => p.startsWith('wb.'))) feeds.add('World Bank Open Data v2');
  if (paths.some((p) => p.startsWith('gdelt.'))) feeds.add('GDELT');
  if (paths.some((p) => p.startsWith('market.exchange'))) feeds.add('Spot FX (Frankfurter)');
  s.dataStatus = { verifiedLiveSources: [...feeds], checkedAt: s.dataStatus?.checkedAt || '2026-11-04T12:00:00Z' };
  return s;
}
