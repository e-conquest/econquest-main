import type { OpenDataSnapshot, WatchlistItem } from '../types/council';
import { getSnapshotDataStatus } from './dataStatus';
import { formatPeriod, type OfficialYieldObservation } from './officialYields';

export type YieldSource = NonNullable<WatchlistItem['yield10YSource']>;

type YieldFields = Pick<WatchlistItem, 'yield10YPct' | 'yield10YSource' | 'yield10YPeriod' | 'yield10YFrequency' | 'yield10YChange3mPts' | 'yield10YChange12mPts'>;

/**
 * The 10Y yield a watchlist row should show, and where it came from.
 * An official figure wins: first the one recorded on the snapshot (only if its feed answered),
 * then one fetched separately for the watchlist. Otherwise the snapshot's own value,
 * labelled as an AI estimate or a sample value.
 */
export function watchlistYieldFields(
  snapshot: OpenDataSnapshot,
  fetchedOfficial?: OfficialYieldObservation | null
): YieldFields {
  const status = getSnapshotDataStatus(snapshot);
  const official = status.officialYield ?? fetchedOfficial ?? undefined;
  if (official) {
    return {
      yield10YPct: official.valuePct,
      yield10YSource: 'official',
      yield10YPeriod: official.period,
      yield10YFrequency: official.frequency === 'daily' ? 'daily' : 'monthly',
      ...(official.change3mPts !== undefined ? { yield10YChange3mPts: official.change3mPts } : {}),
      ...(official.change12mPts !== undefined ? { yield10YChange12mPts: official.change12mPts } : {}),
    };
  }
  return {
    yield10YPct: snapshot.monetaryAndMarket.sovereign10YBondYieldPct,
    yield10YSource: status.yieldSource === 'official' ? 'sample' : status.yieldSource,
    yield10YPeriod: undefined,
    yield10YFrequency: undefined,
  };
}

/** Short source note for a row, e.g. "Official, Sep 2026 avg", "Official, 30 Oct 2026", "AI estimate", "Sample". */
export function yieldSourceNote(item: Pick<WatchlistItem, 'yield10YSource' | 'yield10YPeriod' | 'yield10YFrequency'>): string {
  if (item.yield10YSource === 'official' && item.yield10YPeriod) {
    const when = formatPeriod(item.yield10YPeriod);
    return `Official, ${item.yield10YFrequency === 'daily' ? when : `${when} avg`}`;
  }
  if (item.yield10YSource === 'ai_estimate') return 'AI estimate';
  if (item.yield10YSource === 'uploaded') return 'Your upload';
  return 'Sample';
}

/** Short source note for a CDS figure: "Your LSEG, 3 Nov 2026", "AI estimate" or "Sample". */
export function cdsSourceNote(item: Pick<WatchlistItem, 'cds5YSource' | 'cds5YDate' | 'cds5YProvider'>): string {
  if (item.cds5YSource === 'own') return `Your ${item.cds5YProvider || 'data'}${item.cds5YDate ? `, ${formatPeriod(item.cds5YDate)}` : ''}`;
  if (item.cds5YSource === 'ai_estimate') return 'AI estimate';
  return 'Sample';
}

/** Longer explanation for a tooltip. */
export function yieldSourceHelp(item: Pick<WatchlistItem, 'yield10YSource' | 'yield10YPeriod' | 'yield10YFrequency'>): string {
  if (item.yield10YSource === 'official') {
    return item.yield10YFrequency === 'daily'
      ? `Official daily 10-year rate from the government or central bank, ${yieldSourceNote(item).replace('Official, ', '')}. Open the country for the exact series.`
      : `Official monthly average 10-year government bond yield (${yieldSourceNote(item).replace('Official, ', '')}). Open the country for the exact series.`;
  }
  if (item.yield10YSource === 'ai_estimate') return 'Estimate from an AI web search, not a market price.';
  if (item.yield10YSource === 'uploaded') return 'From a file you uploaded.';
  return 'Built-in sample value, not a market price. No free official 10-year series is connected for this country.';
}
