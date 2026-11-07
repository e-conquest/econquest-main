import type { OpenDataSnapshot } from '../types/council';
import { getSnapshotDataStatus, type DataFeedKey } from './dataStatus';
import { describeOfficialYield } from './officialYields';

/**
 * Plain, honest banner text after a data refresh: what actually came from a live source,
 * and what is still a built-in sample or an AI estimate. Never green when nothing answered.
 */
export interface SyncMessage {
  type: 'success' | 'info' | 'warning';
  message: string;
}

const FEED_NAME: Array<[DataFeedKey, string]> = [
  ['imf', 'IMF'],
  ['worldbank', 'World Bank'],
  ['fx', 'exchange rate'],
  ['nyfed', 'US funding rates'],
  ['treasury', 'US Treasury'],
  ['gdelt', 'news (GDELT)'],
  ['polymarket', 'prediction markets'],
];

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function describeSnapshotSync(snapshot: OpenDataSnapshot, countryName = snapshot.countryName): SyncMessage {
  const status = getSnapshotDataStatus(snapshot);
  if (status.mode === 'unverified') {
    return { type: 'warning', message: `${countryName}: these figures were saved by an older version that did not record their sources, so treat them as unverified.` };
  }
  if (status.liveFeeds.length === 0) {
    return {
      type: 'warning',
      message: `${countryName}: no data source answered, so its figures read Missing until one does. No built-in values are shown.`,
    };
  }

  const live = FEED_NAME.filter(([k]) => status.isFeedLive(k)).map(([, name]) => name);
  if (status.officialYield) live.push(`10Y yield (official, ${describeOfficialYield(status.officialYield).when})`);

  const notLive: string[] = [];
  if (!status.isFeedLive('imf') || !status.isFeedLive('worldbank')) notLive.push('debt and reserves');
  const prices = ['CDS', 'policy rate', 'rating'];
  if (!status.officialYield) prices.splice(1, 0, '10Y yield');

  const parts = [`${countryName} updated. Live: ${joinList(live) || 'none'}.`];
  if (status.marketSource === 'ai_estimate') parts.push(`AI estimates (not market prices): ${joinList(prices)}.`);
  else notLive.push(...prices);
  if (notLive.length) parts.push(`Still missing: ${joinList(notLive)}.`);

  return { type: status.mode === 'live' ? 'success' : 'info', message: parts.join(' ') };
}
