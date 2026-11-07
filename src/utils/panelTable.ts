/**
 * The panel builder: countries x figures in one table, for comparison and for papers. Latest
 * mode gives one cell per country and figure (value, unit, period, source, or Missing with the
 * reason); history mode gives every observation of the chosen figures for every chosen country
 * in long format. Ids are the same as the series ids (src/utils/seriesHistory.ts), so the two
 * modes and the History tab always agree on what a figure is.
 *
 * Browser-safe; the server hands in each country's snapshot and series.
 */
import type { OpenDataSnapshot } from '../types/council';
import { figureRows, seriesRows } from './csvExport';
import { ARCHIVE_FIGURES, type SeriesSet } from './seriesHistory';

export interface PanelFigure {
  id: string;
  label: string;
  unit: string;
  /** Where the latest value comes from: the country snapshot, or the newest point of a series. */
  from: 'snapshot' | 'series';
  /** Snapshot field, for snapshot figures. */
  field?: string;
}

export const PANEL_FIGURES: PanelFigure[] = [
  { id: 'policy_rate', label: 'Policy rate', unit: '%', from: 'series' },
  { id: 'cpi_monthly', label: 'Inflation, monthly', unit: '% year on year', from: 'series' },
  ...ARCHIVE_FIGURES.map((f) => ({ id: f.id, label: f.label, unit: f.unit, from: 'snapshot' as const, field: f.field })),
  { id: 'cli', label: 'OECD leading indicator', unit: 'index, 100 = trend', from: 'series' },
  { id: 'cftc_lev_net', label: 'Futures positioning (leveraged funds)', unit: '% of open interest, net long', from: 'series' },
  { id: 'tic_holdings', label: 'US Treasuries held', unit: 'USD bn', from: 'series' },
];

export const DEFAULT_PANEL_FIGURES = ['policy_rate', 'cpi_monthly', 'gdp_growth', 'debt_gdp', 'primary_balance', 'reserves_months', 'current_account', 'yield_10y'];

export const MAX_PANEL_COUNTRIES = 60;

export interface PanelCell {
  iso3: string;
  country: string;
  figureId: string;
  figure: string;
  value: number | null;
  unit: string;
  status: 'Live' | 'Missing';
  period: string;
  source: string;
  reason: string;
}

export interface PanelCountryData {
  iso3: string;
  snapshot: OpenDataSnapshot;
  series: SeriesSet;
}

/** Known figure ids from a comma list, in the panel's order; unknown ids dropped. */
export function parseFigureIds(raw: unknown): string[] {
  const want = new Set(String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  const ids = PANEL_FIGURES.filter((f) => want.has(f.id)).map((f) => f.id);
  return ids.length ? ids : [...DEFAULT_PANEL_FIGURES];
}

/** ISO3 codes from a comma list: upper case, letters and digits only, no repeats, capped. */
export function parseCountries(raw: unknown): string[] {
  const out: string[] = [];
  for (const c of String(raw ?? '').split(',')) {
    const code = c.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code && !out.includes(code)) out.push(code);
  }
  return out.slice(0, MAX_PANEL_COUNTRIES);
}

/** Latest mode: one cell per country and figure. */
export function panelLatest(data: PanelCountryData[], figureIds: string[]): PanelCell[] {
  const figs = PANEL_FIGURES.filter((f) => figureIds.includes(f.id));
  const cells: PanelCell[] = [];
  for (const d of data) {
    const country = d.snapshot.countryName || d.iso3;
    const snapRows = figureRows(d.snapshot);
    for (const f of figs) {
      const base = { iso3: d.iso3, country, figureId: f.id, figure: f.label, unit: f.unit };
      if (f.from === 'snapshot') {
        const r = snapRows.find((row) => row[2] === f.field);
        const live = r?.[6] === 'Live';
        cells.push({
          ...base,
          value: live ? (r?.[4] as number) : null,
          status: live ? 'Live' : 'Missing',
          period: live ? String(r?.[7] ?? '') : '',
          source: live ? String(r?.[8] ?? '') : '',
          reason: live ? '' : String(r?.[9] || 'No source answered'),
        });
        continue;
      }
      const s = d.series.series.find((x) => x.id === f.id);
      const last = s?.points[s.points.length - 1];
      if (s && last) {
        cells.push({ ...base, value: last.value, status: 'Live', period: last.date, source: s.source, reason: '' });
      } else {
        const miss = d.series.missing.find((m) => m.id === f.id);
        cells.push({ ...base, value: null, status: 'Missing', period: '', source: '', reason: miss?.reason || 'No source answered' });
      }
    }
  }
  return cells;
}

export const PANEL_LATEST_HEADER = ['iso3', 'country', 'figure_id', 'figure', 'value', 'unit', 'status', 'period', 'source', 'reason_if_missing'];

export function panelLatestRows(cells: PanelCell[]): Array<Array<string | number | null>> {
  return cells.map((c) => [c.iso3, c.country, c.figureId, c.figure, c.value, c.unit, c.status, c.period, c.source, c.reason]);
}

/** History mode: every observation of the chosen figures, long format (same columns as the series file). */
export function panelHistoryRows(data: PanelCountryData[], figureIds: string[]) {
  return data.flatMap((d) => seriesRows(d.iso3, d.series.series.filter((s) => figureIds.includes(s.id))));
}
