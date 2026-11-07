import React, { useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
import type { LiveWatchlistItem } from '../types/council';
import { ASSET_CLASS_LABEL, type Holding } from '../utils/holdings';
import { portfolioOverlay, rowLeaning, YIELD_MOVE_BPS, type Leaning } from '../utils/portfolioOverlay';

/**
 * Portfolio > Signals on your holdings: each imported holding beside the app's signals that bear on
 * it, marked with or against the position. Stated rules on live figures; no advice, no odds.
 */

const LEAN_CLS: Record<Leaning, string> = {
  with: 'text-emerald-700 dark:text-emerald-400',
  against: 'text-red-700 dark:text-red-400',
  neutral: 'text-slate-500 dark:text-slate-400',
};
const LEAN_WORD: Record<Leaning, string> = { with: 'with', against: 'against', neutral: 'neutral' };
const ROW_WORD = { against: 'Against', mixed: 'Mixed', with: 'With', quiet: 'Nothing either way' } as const;
const mm = (v: number) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}mm`;

export const PortfolioOverlayPanel: React.FC<{ holdings: Holding[]; watchlist: LiveWatchlistItem[]; onManageHoldings?: () => void }> = ({ holdings, watchlist, onManageHoldings }) => {
  const overlay = useMemo(() => portfolioOverlay(holdings, watchlist), [holdings, watchlist]);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section className="ui-panel" data-portfolio-overlay="true" data-no-provenance-overlay="true" data-no-stat-ref="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Signals on your holdings
        </h2>
        <p className="ui-label">Each holding beside the app's signals that bear on it, marked as leaning with or against the position. Stated rules on live figures; not advice.</p>
      </header>
      <div className="p-4 space-y-3">
        {holdings.length === 0 ? (
          <p className="ui-body">
            No holdings imported.{' '}
            {onManageHoldings && (
              <button type="button" className="text-blue-700 dark:text-blue-300 hover:underline" onClick={onManageHoldings}>
                Import your holdings
              </button>
            )}{' '}
            to see which signals point with or against each position.
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-900 dark:text-white tabular-nums" data-overlay-summary="true">
              Against: {mm(overlay.againstUsdMm)} · Mixed: {mm(overlay.mixedUsdMm)} · With: {mm(overlay.withUsdMm)} · Nothing either way or not marked: {mm(overlay.quietUsdMm)} (gross notional).
            </p>
            {overlay.uncovered.length > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">Not on your watchlist, so no figures: {overlay.uncovered.join(', ')}. Add them to the watchlist to cover them.</p>
            )}
            <ul className="space-y-1.5">
              {overlay.rows.map((r) => {
                const k = rowLeaning(r);
                const isOpen = open === r.holding.id;
                return (
                  <li key={r.holding.id} className="border border-slate-200 dark:border-slate-700" data-overlay-row={k}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : r.holding.id)}
                      className="w-full text-left px-2 py-1.5 flex flex-wrap items-baseline justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <span className="text-sm text-slate-900 dark:text-white">
                        {r.holding.instrument} <span className="text-xs text-slate-500 dark:text-slate-400">({r.countryName}, {ASSET_CLASS_LABEL[r.holding.assetClass]}, {r.holding.side.toLowerCase()}, {mm(r.holding.notionalUsdMm)})</span>
                      </span>
                      <span className={`text-xs ${k === 'against' ? LEAN_CLS.against : k === 'with' ? LEAN_CLS.with : LEAN_CLS.neutral}`}>
                        {r.notMarked ? 'Not marked' : ROW_WORD[k]}
                        {r.signals.length ? ` · ${r.signals.filter((s) => s.leaning === 'against').length} against, ${r.signals.filter((s) => s.leaning === 'with').length} with` : ''}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="px-2 pb-2 pt-1 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                        {r.notMarked && <p className="text-xs text-slate-500 dark:text-slate-400">{r.notMarked}</p>}
                        {r.signals.map((s) => (
                          <div key={s.kind} className="text-xs">
                            <span className={`font-medium ${LEAN_CLS[s.leaning]}`}>{LEAN_WORD[s.leaning]}</span> <span className="text-slate-900 dark:text-white">{s.label}:</span>{' '}
                            <span className="text-slate-700 dark:text-slate-300">{s.reading}</span> <span className="text-slate-400">({s.source})</span>
                          </div>
                        ))}
                        {r.missing.length > 0 && (
                          <p className="text-xs text-slate-400" data-missing="true">
                            Missing: {r.missing.join('; ')}.
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <ul className="text-xs text-slate-500 dark:text-slate-400 list-disc pl-4 space-y-0.5">
              <li>Local-currency bonds: the Taylor rule check, the policy cycle and the 3-month 10Y move (at least {YIELD_MOVE_BPS} bps counts). Lower rates lean with a long bond, higher rates against; reversed for a short.</li>
              <li>Every credit holding: a shock early warning alert leans against a long bond or sold protection, and with bought protection.</li>
              <li>FX and other holdings are listed but not marked. A signal against a position is a reason to look, not a call to trade.</li>
            </ul>
          </>
        )}
      </div>
    </section>
  );
};
