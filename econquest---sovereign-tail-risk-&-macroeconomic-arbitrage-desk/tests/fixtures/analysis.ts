import { DESK_INDICATORS, type DeskAnalysis } from '../../src/services/analysisApi';
import type { WeoRow } from '../../src/services/weoApi';

export function deskAnalysis(): DeskAnalysis {
  const sourceHash = 'a'.repeat(64);
  const labels = ['Real GDP growth', 'Annual-average CPI inflation', 'General government gross debt', 'Current account balance'];
  const indicators = DESK_INDICATORS.map((code, i) => ({ code, label: labels[i], unit: i < 2 ? '% annual change' : '% of GDP' }));
  const runId = 'synthetic-weo-not-empirical';
  return {
    contractVersion: 'weo-macro-desk-v1', rightsPolicy: 'local-research-only-publication-blocked-v1', publicAllowed: false,
    watchlist: ['USA'], indicators, limitations: ['Synthetic test fixture, not empirical evidence. Public publication blocked.'],
    digest: 'b'.repeat(64), unmappedWatchlist: [],
    source: { provider: 'imf-weo', runId, acquisitionStartedAt: '2026-10-20T00:00:00Z', retrievedAt: '2026-10-20T00:01:00Z', publicationDate: '2026-10-13T02:00:00Z',
      sources: [{ ordinal: 1, path: '/data/WEO/synthetic', sha256: sourceHash, httpStatus: 200, bytes: 10 }] },
    countries: [{ code: 'USA', iso3: 'USA', name: 'United States', watchlisted: true,
      metrics: indicators.map(indicator => {
        const attributes = { FREQUENCY: 'A', UNIT: 'PT', SCALE: '0', LATEST_ACTUAL_ANNUAL_DATA: '2024' };
        const rows: WeoRow[] = [2023, 2024, 2025].map((year, n) => ({
          country: 'USA', indicator: indicator.code, year, value: n * 2, rawValue: String(n * 2),
          classification: n < 2 ? 'actual' : 'estimate_projection', status: null, sourceHash, attributes,
        }));
        return { ...indicator, evidenceId: `${runId}/USA/${indicator.code}`, rows,
          series: { country: 'USA', indicator: indicator.code, unit: 'PT', unitLabel: 'Percent', scale: '0',
            scaleLabel: 'Units', latestActualYear: 2024, validCount: 3, missingCount: 0, missingYears: [],
            attributes, sourceHash, analysisBlocked: false },
          latestActual: rows[1], previousActual: rows[0], changePp: 2, changeBlockedReason: null,
          freshness: 'unverified' as const, missingActualYears: [] };
      }) }]
  };
}
