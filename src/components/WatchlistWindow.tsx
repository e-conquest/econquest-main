import React, { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { LiveWatchlistItem, WatchlistGroup } from '../types/council';
import { toLive } from '../utils/liveFigures';
import { SOVEREIGN_CATALOG } from '../data/presetsAndBaselines';
import {
  WATCHLIST_CHANNEL,
  WATCHLIST_STORAGE_KEY,
  WATCHLIST_VIEW_KEY,
  addToList,
  loadView,
  loadWatchlists,
  removeFromList,
  saveView,
  saveWatchlists,
  type LastLook,
  type WatchlistMessage,
  type WatchlistView,
} from '../utils/watchlistView';
import { ColumnPicker, ColumnsButton, MissingSources, WatchlistTable } from './WatchlistTable';

const LAST_VISIT_KEY = 'econquest_today_last_visit_v1';
const THEME_KEY = 'econquest_theme_dark_v1';

function loadLastLook(): { at?: string; rows?: LastLook } {
  try {
    const raw = localStorage.getItem(LAST_VISIT_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v ? { at: v.savedAt, rows: v.rows } : {};
  } catch {
    return {};
  }
}

/**
 * The watchlist on its own, for a second screen (opened at /?view=watchlist).
 * It reads the lists the main window keeps in this browser and follows their changes. Adding or
 * removing a country here changes the same list there. Clicking a country opens it in the main window.
 */
export const WatchlistWindow: React.FC = () => {
  const [groups, setGroups] = useState<WatchlistGroup[]>(() => loadWatchlists());
  const [view, setView] = useState<WatchlistView>(() => loadView());
  const [showColumns, setShowColumns] = useState(false);
  const [adding, setAdding] = useState('');
  const [notice, setNotice] = useState('');
  const [last] = useState(() => loadLastLook());

  useEffect(() => {
    document.title = 'Watchlist · econquest';
    try {
      document.documentElement.classList.toggle('dark', localStorage.getItem(THEME_KEY) === 'true');
    } catch {
      // keep the light theme
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === WATCHLIST_STORAGE_KEY) setGroups(loadWatchlists());
      if (e.key === WATCHLIST_VIEW_KEY) setView(loadView());
      if (e.key === THEME_KEY) document.documentElement.classList.toggle('dark', e.newValue === 'true');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const changeView = (v: WatchlistView) => {
    setView(v);
    saveView(v);
  };
  const list = groups.find((g) => g.id === view.watchlistId) || groups[0];
  const changeGroups = (next: WatchlistGroup[]) => {
    setGroups(next);
    saveWatchlists(next);
  };
  // Never a built-in figure: only what a real source filled.
  const liveItems = useMemo(() => (list ? list.items.map(toLive) : []), [list]);
  const addable = useMemo(() => SOVEREIGN_CATALOG.filter((c) => !list?.items.some((i) => i.iso3 === c.iso3)).sort((a, b) => a.countryName.localeCompare(b.countryName)), [list]);

  const open = (item: LiveWatchlistItem) => {
    const msg: WatchlistMessage = { type: 'open-country', iso3: item.iso3 };
    let sent = false;
    try {
      const ch = new BroadcastChannel(WATCHLIST_CHANNEL);
      ch.postMessage(msg);
      ch.close();
      sent = true;
    } catch {
      // no channel support
    }
    if (window.opener && !window.opener.closed) {
      try {
        window.opener.focus();
      } catch {
        // focus refused by the browser
      }
      setNotice(`Opened ${item.countryName} in the main window.`);
    } else {
      setNotice(sent ? `Opened ${item.countryName} in the main window, if it is open.` : 'Open the main window to read about this country.');
    }
  };

  if (!list)
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 text-sm text-slate-700 dark:text-slate-300">
        No watchlist saved in this browser yet. Open the main app once, then pop the watchlist out again.
      </div>
    );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-3 sm:p-4" data-watchlist-window="true">
      <section className="ui-panel">
        <header className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-sm font-semibold text-slate-900 dark:text-white">Watchlist</h1>
            {groups.length > 1 ? (
              <select
                aria-label="Which list"
                value={list.id}
                onChange={(e) => changeView({ ...view, watchlistId: e.target.value })}
                className="px-1.5 py-1 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white max-w-[16rem]"
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.items.length})
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-sm text-slate-500 dark:text-slate-400">{list.name}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <ColumnsButton open={showColumns} onClick={() => setShowColumns((s) => !s)} />
          </div>
        </header>
        <div className="p-4 space-y-3">
          {showColumns && <ColumnPicker view={view} onChange={changeView} onClose={() => setShowColumns(false)} />}
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const item = SOVEREIGN_CATALOG.find((c) => c.iso3 === adding);
              if (!item) return;
              changeGroups(addToList(groups, list.id, item));
              setAdding('');
              setNotice(`Added ${item.countryName}. Its figures show once the main window next fetches them; until then they read Missing.`);
            }}
          >
            <select aria-label="Add a country" value={adding} onChange={(e) => setAdding(e.target.value)} className="px-1.5 py-1 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white max-w-[16rem]" disabled={addable.length === 0}>
              <option value="">{addable.length ? 'Add a country…' : 'Every country is on this list'}</option>
              {addable.map((c) => (
                <option key={c.iso3} value={c.iso3}>
                  {c.countryName}
                </option>
              ))}
            </select>
            <button type="submit" disabled={!adding} className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-300 hover:underline disabled:opacity-40">
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {list.items.length} countries · changes since {last.at ? `your visit of ${new Date(last.at).toLocaleString()}` : 'your last visit show from your next visit'}
            </span>
          </form>
          {notice && (
            <p className="text-xs text-slate-600 dark:text-slate-400" role="status">
              {notice}
            </p>
          )}
          <MissingSources items={liveItems} />
          <WatchlistTable
            items={liveItems}
            view={view}
            onChangeView={changeView}
            lastLook={last.rows}
            onOpen={open}
            onRemove={(iso3) => {
              const name = list.items.find((i) => i.iso3 === iso3)?.countryName || iso3;
              changeGroups(removeFromList(groups, list.id, iso3));
              setNotice(`Removed ${name}.`);
            }}
          />
        </div>
      </section>
    </div>
  );
};
