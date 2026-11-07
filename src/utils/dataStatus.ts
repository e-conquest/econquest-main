import type { OpenDataSnapshot } from '../types/council';

/**
 * Honest data-status labels.
 *
 * A snapshot starts from built-in sample values (presetsAndBaselines.ts). Only the
 * server records which feeds actually answered, in `dataStatus.verifiedLiveSources`.
 * Snapshots saved before that field existed are reported as "unverified".
 */
export type DataFeedKey =
  | 'imf'
  | 'worldbank'
  | 'nyfed'
  | 'fx'
  | 'polymarket'
  | 'gdelt'
  | 'treasury'
  | 'ai_market'
  | 'official_yield'
  | 'own_cds';

const FEED_PATTERNS: Record<DataFeedKey, RegExp> = {
  imf: /IMF/i,
  worldbank: /World Bank/i,
  nyfed: /NY Fed/i,
  fx: /Spot FX|ExchangeRate|Frankfurter/i,
  polymarket: /Polymarket/i,
  gdelt: /GDELT/i,
  treasury: /US Treasury/i,
  ai_market: /Gemini/i,
  official_yield: /FRED|Tesouro Direto|CBRT EVDS/i,
  own_cds: /Own CDS/i,
};

export type SnapshotDataMode = 'live' | 'partial' | 'sample' | 'unverified';

export interface SnapshotDataStatus {
  mode: SnapshotDataMode;
  liveFeeds: string[];
  /** Policy rate, yields, CDS and rating: AI web-search estimate, or built-in sample. */
  marketSource: 'ai_estimate' | 'sample';
  asOf: string;
  /** Where the 10Y yield came from. 'official' = OECD via FRED, monthly average for `yieldPeriod`. */
  yieldSource: 'official' | 'ai_estimate' | 'sample';
  yieldPeriod?: string;
  /** The official observation itself, when yieldSource is 'official'. */
  officialYield?: OpenDataSnapshot['official10YYield'];
  /** 5Y CDS from the user's own licensed data, when the own-account switch is on and covers the country. */
  ownCds?: OpenDataSnapshot['ownCds5Y'];
  isFeedLive: (key: DataFeedKey) => boolean;
  /**
   * Whether one figure came from a real source, by path ('imf.debtToGdpPct', 'wb.fxReservesMonthsImport',
   * 'market.sovereign10YBondYieldPct' ...). AI web-search estimates do not count (Sam, 2026-11-04).
   */
  isLive: (path: string) => boolean;
  /** The figure itself when it is live, else undefined; never a built-in value. */
  live: (path: string) => number | undefined;
  iso3: string;
}

export function getSnapshotDataStatus(snapshot: OpenDataSnapshot): SnapshotDataStatus {
  const verified = snapshot.dataStatus;
  const liveFeeds = verified ? verified.verifiedLiveSources : [];
  const isFeedLive = (key: DataFeedKey) => liveFeeds.some((s) => FEED_PATTERNS[key].test(s));
  const isLive = (path: string): boolean => {
    if (path === 'market.sovereign10YBondYieldPct') return Boolean(snapshot.official10YYield && isFeedLive('official_yield'));
    if (path === 'market.cds5YSpreadBps') return Boolean(snapshot.ownCds5Y && isFeedLive('own_cds'));
    const src = snapshot.liveFields?.[path];
    return Boolean(src && src !== 'AI estimate');
  };
  let mode: SnapshotDataMode;
  if (!verified) mode = 'unverified';
  else if (liveFeeds.length === 0) mode = 'sample';
  else if (isFeedLive('imf') && isFeedLive('worldbank')) mode = 'live';
  else mode = 'partial';
  return {
    mode,
    liveFeeds,
    marketSource: isFeedLive('ai_market') ? 'ai_estimate' : 'sample',
    asOf: verified?.checkedAt || snapshot.fetchedAt,
    yieldSource:
      snapshot.official10YYield && isFeedLive('official_yield')
        ? 'official'
        : isFeedLive('ai_market')
          ? 'ai_estimate'
          : 'sample',
    yieldPeriod: snapshot.official10YYield?.period,
    officialYield: snapshot.official10YYield && isFeedLive('official_yield') ? snapshot.official10YYield : undefined,
    ownCds: snapshot.ownCds5Y && isFeedLive('own_cds') ? snapshot.ownCds5Y : undefined,
    isFeedLive,
    isLive,
    live: (path: string) => {
      if (!isLive(path)) return undefined;
      const [group, key] = path.split('.');
      const src: Record<string, unknown> | undefined =
        group === 'imf' ? (snapshot.imfIndicators as unknown as Record<string, unknown>) : group === 'wb' ? (snapshot.worldBankIndicators as unknown as Record<string, unknown>) : group === 'market' ? (snapshot.monetaryAndMarket as unknown as Record<string, unknown>) : group === 'gdelt' ? (snapshot.gdeltMetrics as unknown as Record<string, unknown>) : undefined;
      const v = src?.[key];
      return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    },
    iso3: snapshot.iso3,
  };
}

export const DATA_MODE_LABEL: Record<SnapshotDataMode, string> = {
  live: 'Live data',
  partial: 'Partly live',
  sample: 'No live data',
  unverified: 'Source not verified',
};

export const DATA_MODE_HELP: Record<SnapshotDataMode, string> = {
  live: 'IMF and World Bank figures were fetched from their public APIs.',
  partial: 'Some feeds answered. Figures from feeds that did not answer read Missing.',
  sample: 'No data feed answered, so figures read Missing. No built-in values are shown.',
  unverified:
    'This snapshot was saved by an older version that did not record which feeds answered. Press Refresh now under Research > One country.',
};

/**
 * The status badge's words. While the feeds cannot be reached the figures on screen are the last
 * saved pull, so a snapshot that was live when saved reads "Saved data", never "Live data".
 */
export function dataBadgeText(mode: SnapshotDataMode, offline: boolean, asOf: string): { label: string; help: string; saved: boolean } {
  if (offline && (mode === 'live' || mode === 'partial')) {
    return {
      label: 'Saved data',
      help: `The free data feeds cannot be reached from this computer, so these are the figures saved${asOf ? ` on ${asOf}` : ''}. ${mode === 'partial' ? 'Some feeds had not answered when they were saved. ' : ''}They refresh once the feeds answer again.`,
      saved: true,
    };
  }
  return { label: DATA_MODE_LABEL[mode], help: DATA_MODE_HELP[mode], saved: false };
}

export function formatAsOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
