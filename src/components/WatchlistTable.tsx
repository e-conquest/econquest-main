import { SettingsText } from './SettingsText';
import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Columns3, X } from 'lucide-react';
import type { LiveWatchlistItem } from '../types/council';
import { FIGURE_LABEL, missingSummary } from '../utils/liveFigures';
import {
  COLUMN_BY_ID,
  cellMissing,
  VISIBLE_COLUMNS,
  DEFAULT_VIEW,
  moveColumn,
  sortBy,
  sortRows,
  toggleColumn,
  type ColumnDef,
  type LastLook,
  type SortKey,
  type WatchlistView,
} from '../utils/watchlistView';

// Published or your own data shows green; sample and AI estimates stay grey.
const GOOD_NOTE = /^(Official|Own|Your|Live|BIS|ECB)/;

function Cell({ col, it, last }: { col: ColumnDef; it: LiveWatchlistItem; last?: LastLook }) {
  const missing = cellMissing(col, it);
  if (missing)
    return (
      <span title={missing.help} className="inline-block text-left" data-missing={missing.kind}>
        <div className="text-slate-400 dark:text-slate-500">Missing</div>
        <div className={`text-xs whitespace-nowrap ${missing.kind === 'setup' ? 'text-amber-700 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}>{missing.short}</div>
      </span>
    );
  const text = col.text(it, last);
  if (col.isChange) {
    const v = col.value(it, last);
    const worse = typeof v === 'number' && text !== '–' && (col.higherIsWorse ? v > 0 : v < 0);
    const cls = text === '–' ? 'text-slate-400 dark:text-slate-500' : worse ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400';
    return <span className={`text-xs ${cls}`}>{text}</span>;
  }
  const note = col.note?.(it);
  return (
    <>
      <div className={col.id === 'data' ? 'text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap' : 'font-medium'}>{text}</div>
      {note && <div className={`text-xs whitespace-nowrap ${GOOD_NOTE.test(note) ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>{note}</div>}
    </>
  );
}

/** Choose which figures show and in what order. */
export const ColumnPicker: React.FC<{ view: WatchlistView; onChange: (v: WatchlistView) => void; onClose: () => void }> = ({ view, onChange, onClose }) => (
  <div className="border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3 space-y-2" data-watchlist-columns="true">
    <div className="flex items-center justify-between gap-2">
      <div className="text-sm font-medium text-slate-900 dark:text-white">Columns</div>
      <div className="flex items-center gap-3">
        <button type="button" className="text-xs text-blue-700 dark:text-blue-300 hover:underline" onClick={() => onChange({ ...view, columns: [...DEFAULT_VIEW.columns] })}>
          Reset
        </button>
        <button type="button" aria-label="Close columns" onClick={onClose} className="text-slate-500 hover:text-slate-800 dark:hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
    <p className="text-xs text-slate-500 dark:text-slate-400">Tick the figures you want. Arrows change the order. Saved in this browser, for this tab and the pop-out.</p>
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
      {[...view.columns.map((id) => COLUMN_BY_ID[id]), ...VISIBLE_COLUMNS.filter((c) => !view.columns.includes(c.id))].map((c) => {
        const on = view.columns.includes(c.id);
        const i = view.columns.indexOf(c.id);
        return (
          <li key={c.id} className="flex items-center gap-2 text-sm">
            <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer" title={c.help}>
              <input type="checkbox" checked={on} disabled={on && view.columns.length === 1} onChange={() => onChange(toggleColumn(view, c.id))} />
              <span className="truncate text-slate-800 dark:text-slate-200">{c.label}</span>
              <span className="hidden md:inline truncate text-xs text-slate-500 dark:text-slate-400">{c.help}</span>
            </label>
            {on && (
              <span className="flex shrink-0">
                <button type="button" aria-label={`Move ${c.label} left`} disabled={i === 0} onClick={() => onChange(moveColumn(view, c.id, -1))} className="p-0.5 text-slate-500 disabled:opacity-30">
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button type="button" aria-label={`Move ${c.label} right`} disabled={i === view.columns.length - 1} onClick={() => onChange(moveColumn(view, c.id, 1))} className="p-0.5 text-slate-500 disabled:opacity-30">
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  </div>
);

/**
 * What is missing across the list and what would fill it: setup items first (the user can act on
 * them), then free feeds that did not answer.
 */
export const MissingSources: React.FC<{ items: LiveWatchlistItem[]; compact?: boolean }> = ({ items, compact }) => {
  const rows = missingSummary(items).sort((a, b) => Number(b.reason.kind === 'setup') - Number(a.reason.kind === 'setup'));
  if (!rows.length || !items.length) return null;
  return (
    <details className={`mb-3 border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/20 ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'}`} data-missing-sources="true">
      <summary className="cursor-pointer text-amber-900 dark:text-amber-200">
        {compact
          ? `A dash (–) means missing: ${rows.length} ${rows.length === 1 ? 'figure' : 'figures'}. What to set up`
          : `Some figures are missing: ${rows.map((r) => FIGURE_LABEL[r.key]).join(', ')}. No built-in values are shown in their place. What to set up`}
      </summary>
      <ul className="mt-2 space-y-1.5">
        {rows.map((r) => (
          <li key={r.key} className="text-slate-700 dark:text-slate-300">
            <span className="font-medium">{FIGURE_LABEL[r.key]}</span>, missing for {r.count} of {items.length}
            <span className={`ml-1 text-xs px-1 border ${r.reason.kind === 'setup' ? 'border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300' : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400'}`}>
              {r.reason.kind === 'setup' ? 'Needs setup' : 'Feed did not answer'}
            </span>
            <div className="text-xs text-slate-600 dark:text-slate-400">{r.reason.help}</div>
          </li>
        ))}
      </ul>
    </details>
  );
};

/** How many of the chosen columns the Workspace corner card shows; the pop-out shows them all. */
export const COMPACT_COLUMNS = 2;

export const ColumnsButton: React.FC<{ open: boolean; onClick: () => void }> = ({ open, onClick }) => (
  <button type="button" onClick={onClick} aria-expanded={open} className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-300 hover:underline whitespace-nowrap">
    <Columns3 className="w-3.5 h-3.5" /> Columns
  </button>
);

/**
 * The watchlist as a table (a card per country on phones), with the columns and order the user chose.
 * Click a header to sort by it.
 */
export const WatchlistTable: React.FC<{
  items: LiveWatchlistItem[];
  view: WatchlistView;
  onChangeView: (v: WatchlistView) => void;
  lastLook?: LastLook;
  highlightIso3?: string;
  onOpen: (item: LiveWatchlistItem) => void;
  /** Pop-out only: a remove button on each row. */
  onRemove?: (iso3: string) => void;
  /** Small corner card on Workspace: the first COMPACT_COLUMNS chosen columns, tight rows, one layout. */
  compact?: boolean;
  /** Countries in your imported holdings, marked "Held" in the corner card. */
  heldIso3?: ReadonlySet<string>;
}> = ({ items, view, onChangeView, lastLook, highlightIso3, onOpen, onRemove, compact, heldIso3 }) => {
  const rows = useMemo(() => sortRows(items, view, lastLook), [items, view, lastLook]);
  const allCols = view.columns.map((id) => COLUMN_BY_ID[id]);
  const cols = compact ? allCols.slice(0, COMPACT_COLUMNS) : allCols;
  const sortMark = (key: SortKey) => (view.sort.key === key ? (view.sort.dir === 'asc' ? ' ↑' : ' ↓') : '');
  const header = (key: SortKey, label: string, align: 'left' | 'right') => (
    <th key={key} className={`py-2 pr-3 font-medium ${align === 'right' ? 'text-right' : ''}`} aria-sort={view.sort.key === key ? (view.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onChangeView(sortBy(view, key))} className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap">
        {label}
        {sortMark(key)}
      </button>
    </th>
  );
  const [confirm, setConfirm] = useState<string | null>(null);

  if (items.length === 0) return <p className="text-sm text-slate-500 dark:text-slate-400">No countries on this list yet.</p>;

  if (compact)
    return (
      <table className="w-full text-xs [font-variant-numeric:tabular-nums]" data-no-provenance-overlay="true" data-watchlist-table="compact">
        <thead>
          <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
            {header('country', 'Country', 'left')}
            {cols.map((c) => header(c.id, c.label, c.align))}
          </tr>
        </thead>
        <tbody>
          {rows.map((it) => (
            <tr
              key={it.iso3}
              onClick={() => onOpen(it)}
              title={`Open ${it.countryName}`}
              className={`border-b border-slate-100 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 ${it.iso3 === highlightIso3 ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''}`}
            >
              <td className="py-1 pr-2 font-medium text-slate-900 dark:text-white">
                {it.countryName.replace(/\s*\(.*\)$/, '')}
                {it.iso3 === highlightIso3 && <span className="ml-1.5 font-normal text-blue-700 dark:text-blue-300" title="The country open under Research > One country">Open</span>}
                {heldIso3?.has(it.iso3) && <span className="ml-1.5 font-normal text-emerald-700 dark:text-emerald-400" title="In your imported holdings" data-held={it.iso3}>Held</span>}
              </td>
              {cols.map((c) => (
                <td key={c.id} className={`py-1 pr-2 ${c.align === 'right' ? 'text-right' : ''}`}>
                  {(() => {
                    // One line per row in the corner card: a missing figure is a dash, with the reason on hover.
                    const miss = cellMissing(c, it);
                    return miss ? (
                      <span className="text-slate-400 dark:text-slate-500" title={`Missing: ${miss.short}. ${miss.help}`} aria-label={`Missing, ${miss.short}`}>
                        –
                      </span>
                    ) : (
                      <Cell col={c} it={it} last={lastLook} />
                    );
                  })()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );

  return (
    <>
      <ul className="sm:hidden -mx-4 divide-y divide-slate-100 dark:divide-slate-800 [font-variant-numeric:tabular-nums]" data-no-provenance-overlay="true">
        {rows.map((it) => (
          <li key={it.iso3} className={it.iso3 === highlightIso3 ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''}>
            <button type="button" onClick={() => onOpen(it)} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-slate-900 dark:text-white">{it.countryName}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {it.iso3} · {it.currencyCode}
                </div>
                <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  {cols.map((c) => (
                    <div key={c.id}>
                      <dt className="text-xs text-slate-500 dark:text-slate-400">{c.label}</dt>
                      <dd className="text-slate-900 dark:text-white">
                        <Cell col={c} it={it} last={lastLook} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
            </button>
            {onRemove && (
              <div className="px-4 pb-2">
                <button type="button" onClick={() => onRemove(it.iso3)} className="text-xs text-rose-700 dark:text-rose-400 hover:underline">
                  Remove {it.countryName}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="hidden sm:block overflow-x-auto -mx-4 px-4">
        <table className="w-full text-sm [font-variant-numeric:tabular-nums]" data-no-provenance-overlay="true" data-watchlist-table="true">
          <thead>
            <tr className="text-left text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
              {header('country', 'Country', 'left')}
              {cols.map((c) => header(c.id, c.label, c.align))}
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((it) => (
              <tr
                key={it.iso3}
                onClick={() => onOpen(it)}
                className={`border-b border-slate-100 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 ${it.iso3 === highlightIso3 ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''}`}
              >
                <td className="py-2 pr-3">
                  <div className="font-medium text-slate-900 dark:text-white">{it.countryName}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {it.iso3} · {it.currencyCode}
                  </div>
                </td>
                {cols.map((c) => (
                  <td key={c.id} className={`py-2 pr-3 ${c.align === 'right' ? 'text-right' : ''}`}>
                    <Cell col={c} it={it} last={lastLook} />
                  </td>
                ))}
                <td className="py-2 text-right whitespace-nowrap">
                  {onRemove ? (
                    confirm === it.iso3 ? (
                      <span className="inline-flex gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="text-rose-700 dark:text-rose-400 hover:underline" onClick={() => (onRemove(it.iso3), setConfirm(null))}>
                          Remove
                        </button>
                        <button type="button" className="text-slate-500 hover:underline" onClick={() => setConfirm(null)}>
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Remove ${it.countryName}`}
                        title={`Remove ${it.countryName} from this list`}
                        className="p-1 text-slate-400 hover:text-rose-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirm(it.iso3);
                        }}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-400 inline" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};
