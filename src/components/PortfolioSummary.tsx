import { CDS_HIDDEN } from '../utils/cdsHidden';
import React, { useMemo } from 'react';
import { Upload } from 'lucide-react';
import type { LiveWatchlistItem } from '../types/council';
import { yieldSourceHelp, yieldSourceNote } from '../utils/watchlistYield';
import type { StagedTradeTicketSpec } from '../utils/nssYieldCurveAndCatalystEngine';
import { summariseBook, type Holding } from '../utils/holdings';
import { bookView, type BookLine } from '../utils/bookNote';
import { missingReason, type FigureKey } from '../utils/liveFigures';

/**
 * Top of the Portfolio page: what the book holds, with weights and live figures by country.
 * With holdings imported, weights are by gross notional. Without them, the book is the
 * watchlist at equal weight, and the page says so. Rows arrive with built-in figures removed
 * (toLive): a figure without a real source reads Missing with the reason, and averages use only the
 * countries that have it.
 */

interface PortfolioSummaryProps {
  watchlistItems: LiveWatchlistItem[];
  /** Watchlist plus the full catalogue, for the figures of held countries. */
  riskLookup: LiveWatchlistItem[];
  holdings: Holding[];
  stagedTickets: StagedTradeTicketSpec[];
  onOpenCountry: (item: LiveWatchlistItem) => void;
  onManageHoldings: () => void;
}

const Stat: React.FC<{ label: string; value: string; note?: string; missing?: boolean; help?: string }> = ({ label, value, note, missing, help }) => (
  <div className="min-w-0" title={help}>
    <div className="ui-label">{label}</div>
    <div className={`text-lg font-semibold ui-num ${missing ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-white'}`}>{value}</div>
    {note && <div className={missing ? 'text-xs text-amber-700 dark:text-amber-400' : 'ui-label'}>{note}</div>}
  </div>
);

const fmtMm = (v: number) => `$${v.toLocaleString(undefined, { maximumFractionDigits: v >= 100 ? 0 : 1 })}mm`;
const signed = (v: number, f: (x: number) => string) => (v < 0 ? `−${f(-v)}` : f(v));

type Row = BookLine;

/** A grey Missing with the short reason underneath and the fix in the tooltip. */
const MissingCell: React.FC<{ k: FigureKey; iso3: string }> = ({ k, iso3 }) => {
  const r = missingReason(k, iso3);
  return (
    <span title={r.help}>
      <span className="text-slate-400 dark:text-slate-500">Missing</span>
      <span className="block text-xs whitespace-nowrap text-amber-700 dark:text-amber-400">{r.short}</span>
    </span>
  );
};

/** Weighted average of a figure over the rows that have it, with the share of weight covered. */
function coveredAvg(rows: Row[], get: (i: LiveWatchlistItem) => number | undefined): { value: number; share: number } | undefined {
  const covered = rows.filter((r) => r.item);
  const have = covered.filter((r) => get(r.item!) !== undefined);
  const w = have.reduce((a, r) => a + r.weight, 0);
  const wAll = covered.reduce((a, r) => a + r.weight, 0);
  if (!w || !wAll) return undefined;
  return { value: have.reduce((a, r) => a + get(r.item!)! * r.weight, 0) / w, share: w / wAll };
}

const coverNote = (c: { share: number }) => (c.share >= 0.999 ? undefined : `${(c.share * 100).toFixed(0)}% of weight has this`);

export const PortfolioSummary: React.FC<PortfolioSummaryProps> = ({
  watchlistItems,
  riskLookup,
  holdings,
  stagedTickets,
  onOpenCountry,
  onManageHoldings,
}) => {
  const hasHoldings = holdings.length > 0;

  const s = useMemo(() => {
    const v = bookView(holdings, riskLookup, watchlistItems);
    return {
      rows: v.lines,
      book: hasHoldings ? summariseBook(holdings, riskLookup) : null,
      avgCds: coveredAvg(v.lines, (i) => i.cds5YBps),
      countries: v.lines.length,
    };
  }, [hasHoldings, holdings, riskLookup, watchlistItems]);

  if (!hasHoldings && watchlistItems.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="ui-body">No holdings and an empty watchlist. Import holdings to see your book.</p>
        <button type="button" className="ui-btn ui-btn-primary" onClick={onManageHoldings}>
          <Upload className="w-3.5 h-3.5" /> Import holdings
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-no-stat-ref="true" data-no-provenance-overlay="true">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="ui-label">
          {hasHoldings
            ? `Your holdings: ${holdings.length} position${holdings.length === 1 ? '' : 's'}, weighted by gross notional.`
            : 'No holdings loaded, so this table is your watchlist at equal weight. Import holdings to weight it by your positions.'}
        </p>
        <button type="button" className="ui-btn" onClick={onManageHoldings}>
          <Upload className="w-3.5 h-3.5" /> {hasHoldings ? 'Edit holdings' : 'Import holdings'}
        </button>
      </div>

      {hasHoldings && s.book ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
          <Stat label="Gross notional" value={fmtMm(s.book.grossUsdMm)} note={`${s.countries} ${s.countries === 1 ? 'country' : 'countries'}`} />
          <Stat
            label="Net credit exposure"
            value={signed(s.book.netCreditUsdMm, fmtMm)}
            note="Long bonds and sold protection, less hedges"
          />
          <Stat
            label="Credit DV01"
            value={`${signed(s.book.dv01UsdK, (v) => `$${v.toFixed(1)}k`)} / bp`}
            note={s.book.missingDuration ? `${s.book.missingDuration} position${s.book.missingDuration === 1 ? '' : 's'} without duration left out` : 'Loss per 1 bp wider spreads'}
          />
          {/* CDS hidden for now (src/utils/cdsHidden.ts). */}
          {CDS_HIDDEN ? null : s.avgCds ? (
            <Stat label="Weighted 5Y CDS" value={`${s.avgCds.value.toFixed(0)} bps`} note={coverNote(s.avgCds) || 'your CDS data'} />
          ) : (
            <Stat label="Weighted 5Y CDS" value="Missing" note={missingReason('cds', '').short} help={missingReason('cds', '').help} missing />
          )}
        </div>
      ) : null}

      {s.book && s.book.uncovered.length > 0 && (
        <p className="ui-label">
          {s.book.uncovered.join(', ')} {s.book.uncovered.length === 1 ? 'is' : 'are'} not covered by the app. These positions count in notional and DV01 but have no figures.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 min-w-0">
          {/* Phones: one tappable card per country instead of a table that scrolls sideways. */}
          <ul className="sm:hidden divide-y divide-slate-100 dark:divide-slate-800 border-y border-slate-100 dark:border-slate-800">
            {s.rows.map((r) => {
              const body = (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-slate-900 dark:text-white">{r.countryName}</span>
                    {!r.item && <span className="ui-badge">No data</span>}
                  </div>
                  <dl className="mt-1 grid grid-cols-2 gap-x-3 text-sm ui-num">
                    <div>
                      <dt className="ui-label">Weight</dt>
                      <dd>{(r.weight * 100).toFixed(0)}%</dd>
                    </div>
                    <div title={r.item?.yield10YPct !== undefined ? yieldSourceHelp(r.item) : undefined}>
                      <dt className="ui-label">10Y yield</dt>
                      <dd>{r.item?.yield10YPct !== undefined ? `${r.item.yield10YPct.toFixed(2)}%` : r.item ? <MissingCell k="yield" iso3={r.iso3} /> : '–'}</dd>
                      {r.item?.yield10YPct !== undefined && (
                        <dd
                          className={`text-xs ${
                            r.item.yield10YSource === 'official'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {yieldSourceNote(r.item)}
                        </dd>
                      )}
                    </div>
                    {hasHoldings && (
                      <div className="mt-1">
                        <dt className="ui-label">Net credit</dt>
                        <dd>{signed(r.netCreditUsdMm ?? 0, fmtMm)}</dd>
                      </div>
                    )}
                    {hasHoldings && (
                      <div className="mt-1">
                        <dt className="ui-label">DV01 ($k/bp)</dt>
                        <dd>{signed(r.dv01UsdK ?? 0, (v) => v.toFixed(1))}</dd>
                      </div>
                    )}
                  </dl>
                </>
              );
              return (
                <li key={r.iso3}>
                  {r.item ? (
                    <button
                      type="button"
                      onClick={() => onOpenCountry(r.item!)}
                      className="w-full text-left py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="py-2.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">The book by country</caption>
            <thead>
              <tr className="ui-label text-left border-b border-slate-100 dark:border-slate-800">
                <th className="py-1.5 pr-3 font-normal">Country</th>
                {hasHoldings && <th className="py-1.5 pr-3 font-normal text-right">Net credit</th>}
                {hasHoldings && <th className="py-1.5 pr-3 font-normal text-right">DV01 ($k/bp)</th>}
                <th className="py-1.5 pr-3 font-normal text-right">10Y yield</th>
                <th className="py-1.5 pr-3 font-normal text-right">Weight</th>
                <th className="py-1.5 font-normal w-1/4 hidden sm:table-cell" aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => (
                <tr
                  key={r.iso3}
                  className={`border-b border-slate-50 dark:border-slate-800/60 ${r.item ? 'hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer' : ''}`}
                  onClick={() => r.item && onOpenCountry(r.item)}
                >
                  <td className="py-1.5 pr-3 text-slate-900 dark:text-white whitespace-nowrap">
                    {r.countryName}
                    {!r.item && <span className="ui-badge ml-2">No data</span>}
                  </td>
                  {hasHoldings && (
                    <td className="py-1.5 pr-3 text-right ui-num whitespace-nowrap">{signed(r.netCreditUsdMm ?? 0, fmtMm)}</td>
                  )}
                  {hasHoldings && (
                    <td className="py-1.5 pr-3 text-right ui-num">{signed(r.dv01UsdK ?? 0, (v) => v.toFixed(1))}</td>
                  )}
                  <td className="py-1.5 pr-3 text-right" title={r.item?.yield10YPct !== undefined ? yieldSourceHelp(r.item) : undefined}>
                    {r.item && r.item.yield10YPct === undefined ? (
                      <MissingCell k="yield" iso3={r.iso3} />
                    ) : r.item ? (
                      <>
                        <span className="ui-num">{r.item.yield10YPct!.toFixed(2)}%</span>
                        <span
                          className={`block text-xs whitespace-nowrap ${
                            r.item.yield10YSource === 'official'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {yieldSourceNote(r.item)}
                        </span>
                      </>
                    ) : (
                      '–'
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right ui-num">{(r.weight * 100).toFixed(0)}%</td>
                  <td className="py-1.5 hidden sm:table-cell">
                    <div className="h-1.5 bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-1.5 bg-slate-500 dark:bg-slate-400"
                        style={{ width: `${Math.round(r.weight * 100)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className="ui-label mt-1">
            {(() => {
              const items = s.rows.filter((r) => r.item);
              const have = items.filter((r) => r.item!.yield10YPct !== undefined).length;
              return `${have} of ${items.length} yields are official or uploaded figures; the rest are missing, not estimated.`;
            })()}{' '}
            Tap or click a country to open it.
          </p>
        </div>

        <div>
          <div className="ui-section-title mb-1">Staged trade ideas</div>
          {stagedTickets.length === 0 ? (
            <p className="ui-label">None yet. Stage a ticket from Workspace or any desk.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {stagedTickets.slice(0, 5).map((t) => (
                <li key={t.ticketId} className="py-1.5">
                  <div className="text-sm text-slate-900 dark:text-white truncate" title={t.strategyTitle}>
                    {t.strategyTitle}
                  </div>
                  <div className="ui-label">
                    {t.countryName} · conviction {t.convictionScore0To100}/100
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
