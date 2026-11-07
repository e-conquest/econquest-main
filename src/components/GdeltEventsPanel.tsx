import React, { useEffect, useState } from 'react';
import { Newspaper } from 'lucide-react';
import type { GdeltRawReading, GdeltRawSeries } from '../utils/gdeltRaw';
import { GOLDSTEIN_RULE } from '../utils/gdeltRaw';
import { rawGdeltFigures } from '../utils/politicsEvents';
import { requiredCredit } from '../data/requiredCredits';
import { SourceCredits } from './SourceCredits';

/**
 * Country Research > Markets & signals > News and events: weekly event counts and the economic
 * themes in the news, from the GDELT 2.0 raw files (utils/gdeltRaw.ts). Shows only what the files
 * hold; before a pull it says Missing and how to pull.
 */

type Reply = {
  series: GdeltRawSeries | null;
  reading: GdeltRawReading | null;
  pull: { pulledAt?: string; note?: string; pausedUntil?: string };
  weeks: number;
  gkgEveryHours: number;
};

const sg = (v: number, d = 2) => `${v > 0 ? '+' : ''}${v.toFixed(d)}`;

export const GdeltEventsPanel: React.FC<{ iso3: string; countryName: string }> = ({ iso3, countryName }) => {
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setReply(null);
    setError(null);
    fetch(`/api/gdelt-raw/${encodeURIComponent(iso3)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: Reply) => live && setReply(b))
      .catch((e: Error) => live && setError(`The GDELT figures could not be read (${e.message}).`));
    return () => {
      live = false;
    };
  }, [iso3]);

  const r = reply?.reading;
  const s = reply?.series;
  const sentences = r ? rawGdeltFigures(r).sentences : [];

  return (
    <section className="ui-panel" data-gdelt-raw="true" data-no-provenance-overlay="true" data-no-stat-ref="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <Newspaper className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          News and events, {countryName}
        </h2>
        <p className="ui-label">Weekly event counts and the economic themes in the news, read from GDELT's own 15-minute files.</p>
      </header>
      <div className="p-4 space-y-3">
        {!reply && !error && <p className="ui-body">Loading…</p>}
        {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}
        {reply && !r && (
          <p className="text-sm text-amber-700 dark:text-amber-400" data-missing="true">
            Missing: {reply.pull.pulledAt ? `no GDELT files on disk name ${countryName} yet` : 'GDELT raw files not pulled yet'}. Pull them with Menu &gt; Offline data, or{' '}
            <code>npm run gdelt:pull</code> ({reply.weeks} weeks back).
            {reply.pull.note ? ` Last pull: ${reply.pull.note}.` : ''}
          </p>
        )}
        {r && (
          <>
            {sentences.length > 0 && (
              <p className="text-sm text-slate-900 dark:text-white" data-gdelt-sentence="true">
                {sentences.join(' ')}
              </p>
            )}
            {r.events && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm tabular-nums">
                {(
                  [
                    ['Events', r.events.count, r.events.baseline?.count],
                    ['Protests', r.events.protests, r.events.baseline?.protests],
                    ['Sanctions', r.events.sanctions, r.events.baseline?.sanctions],
                    ['Violent', r.events.violence, r.events.baseline?.violence],
                  ] as Array<[string, number, number | undefined]>
                ).map(([label, v, b]) => (
                  <div key={label}>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
                    <div className="font-medium text-slate-900 dark:text-white">{v}</div>
                    {b !== undefined && <div className="text-xs text-slate-500 dark:text-slate-400">before {b}/wk</div>}
                  </div>
                ))}
                <div title={GOLDSTEIN_RULE}>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Goldstein</div>
                  <div className="font-medium text-slate-900 dark:text-white">{sg(r.events.goldsteinMean)}</div>
                  {r.events.baseline && <div className="text-xs text-slate-500 dark:text-slate-400">before {sg(r.events.baseline.goldsteinMean)}</div>}
                </div>
              </div>
            )}
            {r.gkg && r.gkg.themes.length > 0 && (
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Economic themes, share of {r.gkg.articles} articles naming {countryName} (tone {sg(r.gkg.toneMean)})</div>
                <ul className="text-sm space-y-0.5 tabular-nums">
                  {r.gkg.themes.slice(0, 6).map((t) => (
                    <li key={t.id} className="flex justify-between gap-3">
                      <span className="text-slate-900 dark:text-white">{t.label}</span>
                      <span className="text-slate-600 dark:text-slate-300">
                        {t.sharePct}%{t.baselineSharePct !== undefined ? ` (before ${t.baselineSharePct}%)` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(r.topPersons.length > 0 || r.topOrgs.length > 0) && (
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Most named in economic coverage (4 weeks): {[...r.topPersons.map((p) => p.name), ...r.topOrgs.map((o) => o.name)].join(', ')}
              </p>
            )}
            {s && s.weeks.length > 1 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-blue-700 dark:text-blue-300">Week by week ({s.weeks.length} weeks)</summary>
                <div className="overflow-x-auto mt-2">
                  <table className="w-full text-xs tabular-nums">
                    <thead className="text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="text-left font-normal pr-2">Week of</th>
                        <th className="text-right font-normal px-1">Events</th>
                        <th className="text-right font-normal px-1">Protests</th>
                        <th className="text-right font-normal px-1">Sanctions</th>
                        <th className="text-right font-normal px-1">Violent</th>
                        <th className="text-right font-normal px-1">Goldstein</th>
                        <th className="text-right font-normal px-1">Articles</th>
                        <th className="text-right font-normal pl-1">Files read</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-900 dark:text-white">
                      {[...s.weeks].reverse().map((w) => (
                        <tr key={w.weekStart} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="pr-2">{w.weekStart}</td>
                          <td className="text-right px-1">{w.events?.count ?? '–'}</td>
                          <td className="text-right px-1">{w.events?.protests ?? '–'}</td>
                          <td className="text-right px-1">{w.events?.sanctions ?? '–'}</td>
                          <td className="text-right px-1">{w.events?.violence ?? '–'}</td>
                          <td className="text-right px-1">{w.events ? sg(w.events.goldsteinMean) : '–'}</td>
                          <td className="text-right px-1">{w.gkg?.articles ?? '–'}</td>
                          <td className="text-right pl-1">
                            {w.coverage.eventsFiles}/{w.coverage.expectedFiles}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              GDELT 2.0 events files and Global Knowledge Graph, pulled {r.pulledAt?.slice(0, 10) || 'date unknown'}
              {r.latestFileAt ? `, newest file ${r.latestFileAt.slice(0, 16).replace('T', ' ')} UTC` : ''}. Week of {r.weekStart}
              {r.complete ? '' : ' (in progress)'}: {r.eventsFilesRead} of {r.eventsFilesExpected} events files read
              {r.gkg?.sampleShare != null && r.gkg.sampleShare < 1 ? `; one GKG file every ${reply!.gkgEveryHours} hours, theme figures are shares of the articles read` : ''}. An event counts where it took
              place or when {countryName} is an actor.
            </p>
            <SourceCredits credits={[requiredCredit('gdelt')]} />
          </>
        )}
      </div>
    </section>
  );
};
