import { CDS_HIDDEN } from '../utils/cdsHidden';
import React, { useState } from 'react';
import { yieldSourceHelp, yieldSourceNote } from '../utils/watchlistYield';
import { WatchlistGroup, WatchlistItem } from '../types/council';
import { SOVEREIGN_CATALOG } from '../data/presetsAndBaselines';
import { Plus, Trash2, ArrowUpRight, FolderPlus, Search } from 'lucide-react';

interface WatchlistSidebarProps {
  watchlists: WatchlistGroup[];
  activeWatchlistId: string;
  selectedIso3: string;
  onSelectWatchlist: (id: string) => void;
  onSelectSovereign: (item: WatchlistItem) => void;
  onCreateWatchlist: (name: string, description: string) => void;
  onDeleteWatchlist: (id: string) => void;
  onAddSovereignToWatchlist: (watchlistId: string, item: WatchlistItem) => void;
  onRemoveSovereignFromWatchlist: (watchlistId: string, iso3: string) => void;
}

export const WatchlistSidebar: React.FC<WatchlistSidebarProps> = ({
  watchlists,
  activeWatchlistId,
  selectedIso3,
  onSelectWatchlist,
  onSelectSovereign,
  onCreateWatchlist,
  onDeleteWatchlist,
  onAddSovereignToWatchlist,
  onRemoveSovereignFromWatchlist,
}) => {
  const [showNewListForm, setShowNewListForm] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListDesc, setNewListDesc] = useState('');

  const [showAddSovereignForm, setShowAddSovereignForm] = useState(false);
  const [customIso3, setCustomIso3] = useState('');
  const [customCountry, setCustomCountry] = useState('');
  const [customCurrency, setCustomCurrency] = useState('USD');
  const [customTheme, setCustomTheme] = useState('');
  const [customYield, setCustomYield] = useState('8.50');
  const [customDebtGdp, setCustomDebtGdp] = useState('68.0');
  const [customReserves, setCustomReserves] = useState('5.5');
  const [searchFilter, setSearchFilter] = useState('');

  const activeList = watchlists.find((w) => w.id === activeWatchlistId) || watchlists[0];

  const filteredItems = (activeList?.items || []).filter(
    (item) =>
      item.countryName.toLowerCase().includes(searchFilter.toLowerCase()) ||
      item.iso3.toLowerCase().includes(searchFilter.toLowerCase()) ||
      item.focusTheme.toLowerCase().includes(searchFilter.toLowerCase())
  );

  const availableCatalogToQuickAdd = SOVEREIGN_CATALOG.filter(
    (cat) => !activeList?.items.some((existing) => existing.iso3 === cat.iso3)
  );

  const handleCreateListSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newListName.trim()) return;
    onCreateWatchlist(
      newListName.trim(),
      newListDesc.trim() || 'Custom institutional sovereign & macro risk watchlist.'
    );
    setNewListName('');
    setNewListDesc('');
    setShowNewListForm(false);
  };

  const handleAddCustomSovereignSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customIso3.trim() || !customCountry.trim()) return;
    const iso = customIso3.trim().toUpperCase().slice(0, 4);
    const yieldVal = Number(customYield) || 8.0;
    const debtVal = Number(customDebtGdp) || 65.0;
    const resVal = Number(customReserves) || 5.0;

    const newItem: WatchlistItem = {
      iso3: iso,
      countryName: customCountry.trim(),
      region: 'Custom Sovereign',
      currencyCode: customCurrency.trim().toUpperCase() || 'LOC',
      focusTheme:
        customTheme.trim() ||
        'Sovereign Fiscal Sustainability, Central Bank Policy Path & External Balance Sheet Assessment',
      yield10YPct: yieldVal,
      // No CDS for a hand-added country: without your own CDS data (cds5YSource 'own') toLive drops it.
      cds5YBps: NaN,
      debtToGdpPct: debtVal,
      fxReservesMonths: resVal,
    };

    onAddSovereignToWatchlist(activeList.id, newItem);
    setCustomIso3('');
    setCustomCountry('');
    setCustomTheme('');
    setShowAddSovereignForm(false);
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col">
      {/* Header & Watchlist Selector */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Institutional Watchlist Manager
            </div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Sovereign &amp; Macro Watchlists
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setShowNewListForm(!showNewListForm)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors whitespace-nowrap shrink-0"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>New Watchlist</span>
          </button>
        </div>

        {/* Watchlist Group Tabs */}
        <div className="flex flex-col gap-1">
          {watchlists.map((wl) => {
            const isActive = wl.id === activeList?.id;
            return (
              <div
                key={wl.id}
                className={`flex items-center justify-between px-3 py-2 text-xs transition-colors border ${
                  isActive
                    ? 'bg-slate-900 text-white dark:bg-slate-800 dark:text-slate-100 border-slate-900 dark:border-slate-700 font-semibold'
                    : 'bg-slate-50 dark:bg-slate-950/50 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800/50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectWatchlist(wl.id)}
                  className="flex-1 text-left truncate pr-2"
                >
                  <span>{wl.name}</span>
                  <span className="ml-1.5 opacity-70 tabular-nums">({wl.items.length})</span>
                </button>
                {wl.isCustom && (
                  <button
                    type="button"
                    onClick={() => onDeleteWatchlist(wl.id)}
                    title="Delete custom watchlist"
                    className="text-slate-400 hover:text-rose-500 p-0.5 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Create New Watchlist Inline Form */}
        {showNewListForm && (
          <form
            onSubmit={handleCreateListSubmit}
            className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5"
          >
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Create Custom Institutional Watchlist
            </div>
            <input
              type="text"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="e.g., LatAm Fiscal & Carry Desk"
              required
              className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
            />
            <input
              type="text"
              value={newListDesc}
              onChange={(e) => setNewListDesc(e.target.value)}
              placeholder="Optional mandate or desk focus note..."
              className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewListForm(false)}
                className="px-2.5 py-1 text-xs text-slate-600 dark:text-slate-400"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="ui-btn ui-btn-primary"
              >
                Save Watchlist
              </button>
            </div>
          </form>
        )}

        {/* Active Watchlist Description & Filter */}
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          {activeList?.description}
        </p>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filter by ISO, country, theme..."
              className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowAddSovereignForm(!showAddSovereignForm)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Country</span>
          </button>
        </div>

        {/* Add Custom Country / Preset Drawer */}
        {showAddSovereignForm && (
          <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
            {availableCatalogToQuickAdd.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                  Quick-Add from Institutional Catalog:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {availableCatalogToQuickAdd.map((cat) => (
                    <button
                      key={cat.iso3}
                      type="button"
                      onClick={() => onAddSovereignToWatchlist(activeList.id, cat)}
                      className="px-2 py-1 text-xs tabular-nums bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:border-blue-500 text-slate-800 dark:text-slate-200"
                    >
                      + {cat.iso3} ({cat.countryName})
                    </button>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={handleAddCustomSovereignSubmit} className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Or Add Any Custom ISO-3 Sovereign / Macro Flashpoint:
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  value={customIso3}
                  onChange={(e) => setCustomIso3(e.target.value)}
                  placeholder="ISO3 (e.g. ARG)"
                  maxLength={4}
                  required
                  className="px-2 py-1 text-xs tabular-nums bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                />
                <input
                  type="text"
                  value={customCountry}
                  onChange={(e) => setCustomCountry(e.target.value)}
                  placeholder="Country Name"
                  required
                  className="col-span-2 px-2 py-1 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-slate-500 block">10Y Yield %</label>
                  <input
                    type="number"
                    step="0.1"
                    value={customYield}
                    onChange={(e) => setCustomYield(e.target.value)}
                    className="w-full px-2 py-1 text-xs tabular-nums bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block">Debt/GDP %</label>
                  <input
                    type="number"
                    step="0.5"
                    value={customDebtGdp}
                    onChange={(e) => setCustomDebtGdp(e.target.value)}
                    className="w-full px-2 py-1 text-xs tabular-nums bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block">Reserves (m)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={customReserves}
                    onChange={(e) => setCustomReserves(e.target.value)}
                    className="w-full px-2 py-1 text-xs tabular-nums bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
              <input
                type="text"
                value={customTheme}
                onChange={(e) => setCustomTheme(e.target.value)}
                placeholder="Key risk thesis / policy theme..."
                className="w-full px-2 py-1 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddSovereignForm(false)}
                  className="px-2 py-1 text-xs text-slate-500"
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="ui-btn ui-btn-primary"
                >
                  Add to Watchlist
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Watchlist Rows */}
      <div className="divide-y divide-slate-200 dark:divide-slate-800">
        {filteredItems.length === 0 ? (
          <div className="p-6 text-center space-y-2">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              No sovereigns match your filter in this watchlist.
            </div>
            <button
              type="button"
              onClick={() => setShowAddSovereignForm(true)}
              className="ui-btn ui-btn-primary"
            >
              Add First Sovereign Entry
            </button>
          </div>
        ) : (
          filteredItems.map((item) => {
            const isSelected = item.iso3 === selectedIso3;
            return (
              <div
                key={item.iso3}
                onClick={() => onSelectSovereign(item)}
                className={`p-3.5 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-blue-50/70 dark:bg-blue-950/30'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="tabular-nums font-semibold text-xs text-blue-600 dark:text-blue-400 shrink-0">
                      {item.iso3}
                    </span>
                    <span className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">
                      {item.countryName}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {activeList.items.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveSovereignFromWatchlist(activeList.id, item.iso3);
                        }}
                        title="Remove from watchlist"
                        className="text-slate-400 hover:text-rose-500 p-0.5"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1 mt-1">
                  {item.focusTheme}
                </p>

                <div className={`grid ${CDS_HIDDEN ? 'grid-cols-3' : 'grid-cols-4'} gap-2 mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/70 text-xs tabular-nums`}>
                  <div title={`${yieldSourceNote(item)}. ${yieldSourceHelp(item)}`}>
                    <span className="text-slate-400 block">
                      10Y yield
                    </span>
                    <span
                      className={`font-semibold ${
                        item.yield10YSource === 'official'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {item.yield10YPct.toFixed(1)}%
                    </span>
                  </div>
                  {/* CDS hidden for now (src/utils/cdsHidden.ts). */}
                  {!CDS_HIDDEN && item.cds5YSource === 'own' && (
                    <div>
                      <span className="text-slate-400 block">5Y CDS</span>
                      <span className="text-slate-800 dark:text-slate-200 font-semibold">
                        {item.cds5YBps}bp
                      </span>
                    </div>
                  )}
                  <div>
                    <span className="text-slate-400 block">Debt/GDP</span>
                    <span className="text-slate-800 dark:text-slate-200 font-semibold">
                      {item.debtToGdpPct.toFixed(0)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">FX Res</span>
                    <span className="text-slate-800 dark:text-slate-200 font-semibold">
                      {item.fxReservesMonths.toFixed(1)}m
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      {filteredItems.length > 0 && (
        <p className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-slate-800">
          A green 10Y yield is an official figure. Hover a yield to see its source and date. A dash means no
          source answered for that country.
        </p>
      )}
    </div>
  );
};
