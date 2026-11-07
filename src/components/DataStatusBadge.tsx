import React from 'react';
import type { OpenDataSnapshot } from '../types/council';
import { useOnlineStatus } from './OfflineData';
import {
  dataBadgeText,
  formatAsOf,
  getSnapshotDataStatus,
} from '../utils/dataStatus';
import { describeOfficialYield, formatPeriod } from '../utils/officialYields';

const MODE_CLASS = {
  live: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
  partial: 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800',
  sample: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600',
  unverified: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600',
} as const;

const DOT_CLASS = {
  live: 'bg-emerald-500',
  partial: 'bg-amber-500',
  sample: 'bg-slate-400',
  unverified: 'bg-slate-400',
} as const;

/**
 * Tells the user, in one glance, whether the figures on screen are live, partly live,
 * built-in sample values, or AI estimates. Used on the country status bar.
 */
export const DataStatusBadge: React.FC<{ snapshot: OpenDataSnapshot }> = ({ snapshot }) => {
  const status = getSnapshotDataStatus(snapshot);
  const asOf = formatAsOf(status.asOf);
  const net = useOnlineStatus();
  const text = dataBadgeText(status.mode, !!net && !net.online, asOf);
  const feedList = status.liveFeeds.length
    ? `\n\nFeeds that answered${text.saved ? ' when saved' : ''}:\n• ${status.liveFeeds.join('\n• ')}`
    : '';
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        title={`${text.help}${feedList}`}
        data-data-badge={text.saved ? 'saved' : status.mode}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-semibold border ${text.saved ? MODE_CLASS.sample : MODE_CLASS[status.mode]}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${text.saved ? DOT_CLASS.sample : DOT_CLASS[status.mode]}`} />
        <span>{text.label}</span>
        {status.mode !== 'unverified' && asOf && (
          <span className="font-normal opacity-80">· as of {asOf}</span>
        )}
      </span>
      {status.officialYield && (
        <span
          title={
            /EVDS/.test(status.officialYield.source)
              ? `The 10-year yield is ${describeOfficialYield(status.officialYield).long}, series ${status.officialYield.seriesId}, from the central bank's data service.`
              : status.officialYield.frequency === 'daily'
                ? `The 10-year yield is ${describeOfficialYield(status.officialYield).long}. It is the Treasury's own offer rate on that bond, used because Brazil has no free benchmark series.`
                : 'The 10-year government bond yield is the official OECD monthly average, published on FRED. It is usually one to two months behind.'
          }
          className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold border ${MODE_CLASS.live}`}
        >
          10Y yield: official, {formatPeriod(status.officialYield.period)}
        </span>
      )}
      {status.ownCds && (
        <span
          title={`The 5-year CDS is your own ${status.ownCds.source} quote of ${formatPeriod(status.ownCds.date)}, switched on in your settings. It is licensed data: check your licence before sending it on.`}
          className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold border ${MODE_CLASS.live}`}
        >
          5Y CDS: your {status.ownCds.source}, {formatPeriod(status.ownCds.date)}
        </span>
      )}
    </span>
  );
};
