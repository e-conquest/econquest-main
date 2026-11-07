/**
 * The watchlist table's columns and the user's choice of them, shared by the Workspace card and
 * the pop-out window (?view=watchlist). Choices are kept in this browser's storage, so a change in
 * one window shows in the other.
 */
import { hcSpreadWhen } from './hardCurrencySpread';
import { CDS_HIDDEN } from './cdsHidden';
import type { LiveWatchlistItem, WatchlistGroup, WatchlistItem } from '../types/council';
import { missingReason, type FigureKey, type MissingReason } from './liveFigures';
import { cdsSourceNote, yieldSourceNote } from './watchlistYield';
import { cftcMissing, positioningLabel } from './cftcPositioning';
import { formatMonth, ticMissing } from './ticHoldings';
import { formatImfPeriod, imfMissing, reserveCover } from './imfReserves';
import { cliMissing } from './oecdCli';
import { formatMonth as oecdMonth } from './oecdSdmx';

export const WATCHLIST_STORAGE_KEY = 'sovereign_council_watchlists_v1';
export const WATCHLIST_VIEW_KEY = 'econquest.watchlistView.v1';
/** Messages between the main window and the pop-out. */
export const WATCHLIST_CHANNEL = 'econquest-watchlist';
export type WatchlistMessage = { type: 'open-country'; iso3: string };

/** What the previous visit recorded, for the change columns. */
export type LastLook = Record<string, { cds5YBps?: number; cdsSource?: string; yield10YPct?: number; yieldSource?: string }>;

export type ColumnId =
  | 'cds'
  | 'hcSpread'
  | 'cdsChange'
  | 'yield'
  | 'yieldChange'
  | 'debt'
  | 'reserves'
  | 'cpi'
  | 'policy'
  | 'reer'
  | 'fxvol'
  | 'positioning'
  | 'ustHoldings'
  | 'imfReserves'
  | 'importCover'
  | 'imfCurrentAccount'
  | 'oecdCli'
  | 'data';

export interface ColumnDef {
  id: ColumnId;
  label: string;
  /** Plain words for the column picker. */
  help: string;
  align: 'left' | 'right';
  /** Sort key; undefined sorts last. */
  value: (it: LiveWatchlistItem, last?: LastLook) => number | string | undefined;
  /** Shown value; '–' when there is no figure. */
  text: (it: LiveWatchlistItem, last?: LastLook) => string;
  /** Where the figure came from, shown under it. */
  note?: (it: LiveWatchlistItem) => string | undefined;
  /** When the figure is missing: which source, and whether it needs setting up. */
  figure?: FigureKey;
  /** For colouring changes. */
  higherIsWorse?: boolean;
  isChange?: boolean;
}

const DATA_LABEL: Record<NonNullable<LiveWatchlistItem['dataMode']>, string> = {
  live: 'Live',
  partial: 'Partly live',
  sample: 'No live feed',
  unverified: 'Not checked',
};

const num = (v: number | undefined, digits: number, unit = '') => (v === undefined || !Number.isFinite(v) ? '–' : `${v.toFixed(digits)}${unit}`);
const signed = (v: number | undefined, digits: number, unit = '') =>
  v === undefined || Math.abs(v) < Math.pow(10, -digits) / 2 ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}${unit}`;

export function cdsChange(it: LiveWatchlistItem, last?: LastLook): number | undefined {
  const prev = last?.[it.iso3];
  // Only between two real figures from the same kind of source.
  return prev?.cds5YBps !== undefined && it.cds5YBps !== undefined && prev.cdsSource === it.cds5YSource ? it.cds5YBps - prev.cds5YBps : undefined;
}

/** A yield change only when both figures come from the same kind of source, in basis points. */
export function yieldChangeBp(it: LiveWatchlistItem, last?: LastLook): number | undefined {
  const prev = last?.[it.iso3];
  if (!prev || prev.yield10YPct === undefined || it.yield10YPct === undefined || (prev.yieldSource || 'sample') !== (it.yield10YSource || 'sample')) return undefined;
  return (it.yield10YPct - prev.yield10YPct) * 100;
}

export const COLUMNS: ColumnDef[] = [
  { id: 'cds', label: '5Y CDS (bps)', help: 'Five-year credit default swap spread', align: 'right', figure: 'cds', value: (it) => it.cds5YBps, text: (it) => num(it.cds5YBps, 0), note: (it) => (it.cds5YBps === undefined ? undefined : cdsSourceNote(it)) },
  { id: 'cdsChange', label: 'CDS change', help: 'Since your last visit', align: 'right', value: cdsChange, text: (it, l) => signed(cdsChange(it, l), 0), higherIsWorse: true, isChange: true },
  { id: 'hcSpread', label: 'USD bond spread (bps)', help: 'Extra yield on the government\'s US dollar bonds over US Treasuries, monthly average (J.P. Morgan EMBI Global via the central bank of Peru). A bond spread, not CDS.', align: 'right', figure: 'hcspread', value: (it) => it.hcSpreadBps, text: (it) => num(it.hcSpreadBps, 0), note: (it) => (it.hcSpreadPeriod ? hcSpreadWhen(it.hcSpreadPeriod) : undefined) },
  { id: 'yield', label: '10Y yield', help: 'Ten-year government bond yield', align: 'right', figure: 'yield', value: (it) => it.yield10YPct, text: (it) => num(it.yield10YPct, 2, '%'), note: (it) => (it.yield10YPct === undefined ? undefined : yieldSourceNote(it)) },
  { id: 'yieldChange', label: 'Yield change', help: 'Since your last visit, same kind of source only', align: 'right', value: yieldChangeBp, text: (it, l) => signed(yieldChangeBp(it, l), 0, ' bp'), higherIsWorse: true, isChange: true },
  { id: 'debt', label: 'Debt/GDP', help: 'Government debt as a share of GDP', align: 'right', figure: 'debt', value: (it) => it.debtToGdpPct, text: (it) => num(it.debtToGdpPct, 1, '%'), note: (it) => (it.debtToGdpPct === undefined ? undefined : 'Live, IMF') },
  { id: 'reserves', label: 'Reserves (mo)', help: 'FX reserves in months of imports', align: 'right', figure: 'reserves', value: (it) => it.fxReservesMonths, text: (it) => num(it.fxReservesMonths, 1), note: (it) => (it.fxReservesMonths === undefined ? undefined : 'Live, World Bank') },
  {
    id: 'cpi',
    label: 'Inflation',
    help: 'CPI inflation, y/y: OECD monthly where the OECD publishes it, IMF otherwise',
    align: 'right',
    figure: 'cpi',
    value: (it) => it.cpiInflationPct,
    text: (it) => num(it.cpiInflationPct, 1, '%'),
    note: (it) =>
      it.cpiInflationPct === undefined
        ? undefined
        : it.cpiSource === 'oecd' && it.cpiMonth
          ? `${it.oecdCpi?.short || 'OECD'}, ${oecdMonth(it.cpiMonth)}${it.oecdCpi?.trend ? `, ${it.oecdCpi.trend}` : ''}`
          : 'Live, IMF',
  },
  {
    id: 'policy',
    label: 'Policy rate',
    help: 'Central bank policy rate',
    align: 'right',
    figure: 'policy',
    value: (it) => it.policyRatePct,
    text: (it) => num(it.policyRatePct, 2, '%'),
    note: (it) =>
      it.policyRatePct === undefined || it.policyRateSource !== 'bis'
        ? undefined
        : `BIS, ${it.policyRateDate || 'date not given'}${it.policyRateStale ? ', may be out of date' : ''}`,
  },
  {
    id: 'reer',
    label: 'REER vs 10y avg',
    help: 'Real effective exchange rate against its 10-year average, BIS',
    align: 'right',
    value: (it) => it.reerGapPct,
    text: (it) => signed(it.reerGapPct, 1, '%'),
    note: (it) => (it.reerGapPct === undefined ? undefined : it.reerPeriod ? `BIS, ${it.reerPeriod}` : 'BIS'),
  },
  {
    id: 'fxvol',
    label: 'FX vol (3m)',
    help: 'Three-month realised volatility against the US dollar, ECB rates',
    align: 'right',
    value: (it) => it.fxVol3mPct,
    text: (it) => num(it.fxVol3mPct, 1, '%'),
    note: (it) => (it.fxVol3mPct === undefined ? undefined : 'ECB rates'),
  },
  {
    id: 'positioning',
    label: 'Lev. funds net',
    help: 'Leveraged funds net position in the currency future, share of open interest, CFTC weekly (only currencies with a CME future)',
    align: 'right',
    value: (it) => it.cftc?.levNetPctOi,
    text: (it) => signed(it.cftc?.levNetPctOi, 1, '%'),
    note: (it) =>
      it.cftc
        ? `CFTC, ${it.cftc.reportDate}${it.cftc.percentile !== undefined ? `, ${positioningLabel(it.cftc.percentile)}` : ''}`
        : cftcMissing(it.iso3).short,
  },
  {
    id: 'ustHoldings',
    label: 'UST holdings',
    help: 'Holdings of US Treasuries, USD bn, US Treasury TIC monthly (only the ~20 holders Treasury names)',
    align: 'right',
    value: (it) => it.tic?.holdingsUsdBn,
    text: (it) => num(it.tic?.holdingsUsdBn, 1),
    note: (it) =>
      it.tic
        ? `TIC, ${formatMonth(it.tic.month)}${it.tic.change12mPct !== undefined ? `, ${signed(it.tic.change12mPct, 1, '%')} y/y` : ''}`
        : ticMissing(it.iso3).short,
  },
  {
    id: 'imfReserves',
    label: 'Reserves',
    help: 'Official reserve assets, USD bn, IMF International Liquidity (monthly)',
    align: 'right',
    value: (it) => it.imf?.reserves?.usdBn,
    text: (it) => num(it.imf?.reserves?.usdBn, 1),
    note: (it) =>
      it.imf?.reserves
        ? `IMF, ${formatImfPeriod(it.imf.reserves.period)}${it.imf.reserves.change12mPct !== undefined ? `, ${signed(it.imf.reserves.change12mPct, 1, '%')} y/y` : ''}`
        : imfMissing(it.imf, 'reserves').help,
  },
  {
    id: 'importCover',
    label: 'Import cover',
    help: 'Months of imports the reserves cover: IMF reserves over the last four quarters of IMF BOP imports of goods and services, divided by 12',
    align: 'right',
    value: (it) => it.imf?.monthsOfImports,
    text: (it) => num(it.imf?.monthsOfImports, 1, 'm'),
    note: (it) =>
      it.imf?.monthsOfImports !== undefined && it.imf.imports4q
        ? `IMF reserves and BOP imports to ${formatImfPeriod(it.imf.imports4q.through)}, ${reserveCover(it.imf.monthsOfImports)}`
        : imfMissing(it.imf, it.imf?.reserves ? 'imports' : 'reserves').help,
  },
  {
    id: 'imfCurrentAccount',
    label: 'Current acct',
    help: 'Current account, % of GDP, last four quarters, IMF Balance of Payments over IMF WEO GDP',
    align: 'right',
    value: (it) => it.imf?.currentAccount4q?.pctGdp,
    text: (it) => signed(it.imf?.currentAccount4q?.pctGdp, 1, '%'),
    note: (it) =>
      it.imf?.currentAccount4q?.pctGdp !== undefined
        ? `IMF BOP, 4 quarters to ${formatImfPeriod(it.imf.currentAccount4q.through)}, GDP WEO ${it.imf.currentAccount4q.gdpYear}`
        : it.imf?.currentAccount
          ? 'IMF BOP has the quarter but not four in a row, or the WEO has no GDP for that year'
          : imfMissing(it.imf, 'currentAccount').help,
  },
  {
    id: 'oecdCli',
    label: 'Leading ind.',
    help: 'OECD Composite Leading Indicator, amplitude adjusted (100 = long-term average), monthly',
    align: 'right',
    value: (it) => it.oecdCli?.level,
    text: (it) => num(it.oecdCli?.level, 1),
    note: (it) =>
      it.oecdCli
        ? `OECD, ${formatMonth(it.oecdCli.month)}${it.oecdCli.phase ? `, ${it.oecdCli.phase}` : ''}`
        : cliMissing(!!it.oecdCliPulledAt).short,
  },
  { id: 'data', label: 'Data', help: 'Whether the row came from live feeds', align: 'left', value: (it) => DATA_LABEL[it.dataMode || 'sample'], text: (it) => DATA_LABEL[it.dataMode || 'sample'] },
];

/** Why a cell is empty, when its figure has a known source that did not fill it. */
export function cellMissing(col: ColumnDef, it: LiveWatchlistItem): MissingReason | undefined {
  if (!col.figure || col.value(it) !== undefined) return undefined;
  return missingReason(col.figure, it.iso3);
}

/** CDS columns while CDS is hidden (src/utils/cdsHidden.ts): not offered, and dropped from saved views. */
const HIDDEN_COLUMNS = new Set<ColumnId>(CDS_HIDDEN ? ['cds', 'cdsChange'] : []);
/** The columns the table can show. */
export const VISIBLE_COLUMNS: ColumnDef[] = COLUMNS.filter((c) => !HIDDEN_COLUMNS.has(c.id));
export const COLUMN_BY_ID = Object.fromEntries(COLUMNS.map((c) => [c.id, c])) as Record<ColumnId, ColumnDef>;

/** The columns the Workspace table always showed, in the same order. */
export const DEFAULT_COLUMNS: ColumnId[] = (['cds', 'cdsChange', 'hcSpread', 'yield', 'yieldChange', 'debt', 'reserves', 'data'] as ColumnId[]).filter((c) => !HIDDEN_COLUMNS.has(c));

export type SortKey = 'country' | ColumnId;
export interface WatchlistView {
  columns: ColumnId[];
  sort: { key: SortKey; dir: 'asc' | 'desc' };
  /** The list the pop-out shows; absent = the first list. */
  watchlistId?: string;
}

export const DEFAULT_VIEW: WatchlistView = { columns: DEFAULT_COLUMNS, sort: { key: 'country', dir: 'asc' } };

/** Keeps only known columns, without repeats; falls back to the defaults when nothing usable is left. */
export function cleanView(raw: unknown): WatchlistView {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<WatchlistView>;
  const cols = Array.isArray(r.columns) ? r.columns.filter((c, i, a): c is ColumnId => c in COLUMN_BY_ID && !HIDDEN_COLUMNS.has(c) && a.indexOf(c) === i) : [];
  const keyOk = r.sort?.key === 'country' || (r.sort?.key && r.sort.key in COLUMN_BY_ID && !HIDDEN_COLUMNS.has(r.sort.key as ColumnId));
  // A saved sort on a column that no longer exists (or is hidden) falls back to the default sort, direction included.
  const key = keyOk ? r.sort!.key : DEFAULT_VIEW.sort.key;
  const dir = keyOk ? (r.sort?.dir === 'asc' ? 'asc' : 'desc') : DEFAULT_VIEW.sort.dir;
  return {
    columns: cols.length ? cols : [...DEFAULT_COLUMNS],
    sort: { key, dir },
    ...(typeof r.watchlistId === 'string' && r.watchlistId ? { watchlistId: r.watchlistId } : {}),
  };
}

export function loadView(): WatchlistView {
  try {
    const raw = globalThis.localStorage?.getItem(WATCHLIST_VIEW_KEY);
    return cleanView(raw ? JSON.parse(raw) : null);
  } catch {
    return cleanView(null);
  }
}

export function saveView(view: WatchlistView): void {
  try {
    globalThis.localStorage?.setItem(WATCHLIST_VIEW_KEY, JSON.stringify(view));
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
}

export function toggleColumn(view: WatchlistView, id: ColumnId): WatchlistView {
  const on = view.columns.includes(id);
  if (on && view.columns.length === 1) return view; // keep at least one figure
  const columns = on ? view.columns.filter((c) => c !== id) : [...view.columns, id];
  return { ...view, columns };
}

export function moveColumn(view: WatchlistView, id: ColumnId, by: -1 | 1): WatchlistView {
  const i = view.columns.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= view.columns.length) return view;
  const columns = [...view.columns];
  [columns[i], columns[j]] = [columns[j], columns[i]];
  return { ...view, columns };
}

/** Clicking a header: the same key flips direction, a new key starts high to low (A to Z for text). */
export function sortBy(view: WatchlistView, key: SortKey): WatchlistView {
  if (view.sort.key === key) return { ...view, sort: { key, dir: view.sort.dir === 'asc' ? 'desc' : 'asc' } };
  const textual = key === 'country' || key === 'data';
  return { ...view, sort: { key, dir: textual ? 'asc' : 'desc' } };
}

/** Rows in the chosen order; a row with no figure for the key always goes last. */
export function sortRows(items: LiveWatchlistItem[], view: WatchlistView, last?: LastLook): LiveWatchlistItem[] {
  const { key, dir } = view.sort;
  const get = (it: LiveWatchlistItem) => (key === 'country' ? it.countryName : COLUMN_BY_ID[key].value(it, last));
  const sign = dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (va === undefined && vb === undefined) return a.countryName.localeCompare(b.countryName);
    if (va === undefined) return 1;
    if (vb === undefined) return -1;
    const c = typeof va === 'string' || typeof vb === 'string' ? String(va).localeCompare(String(vb)) : va - vb;
    return c * sign || a.countryName.localeCompare(b.countryName);
  });
}

/** The saved watchlists, as the main window keeps them. */
export function loadWatchlists(): WatchlistGroup[] {
  try {
    const raw = globalThis.localStorage?.getItem(WATCHLIST_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as WatchlistGroup[]) : [];
  } catch {
    return [];
  }
}

export function saveWatchlists(groups: WatchlistGroup[]): void {
  try {
    globalThis.localStorage?.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(groups));
  } catch {
    // Storage unavailable.
  }
}

export function addToList(groups: WatchlistGroup[], listId: string, item: WatchlistItem): WatchlistGroup[] {
  return groups.map((g) => (g.id !== listId || g.items.some((i) => i.iso3 === item.iso3) ? g : { ...g, items: [...g.items, item] }));
}

export function removeFromList(groups: WatchlistGroup[], listId: string, iso3: string): WatchlistGroup[] {
  return groups.map((g) => (g.id === listId ? { ...g, items: g.items.filter((i) => i.iso3 !== iso3) } : g));
}

export const POP_OUT_URL = '/?view=watchlist';
