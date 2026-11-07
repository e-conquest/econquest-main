/**
 * Full official history for each country: every year the World Bank and the IMF World Economic
 * Outlook publish for the figures the app shows. The snapshot keeps only the newest value (that is
 * what every screen displays); this file keeps the whole run so the History tab, charts and
 * downloads work from disk, also offline.
 *
 * Saved per country in data/history/<ISO3>.json by the server (see fetchOfficialHistory in
 * server.ts). Only real observations are kept: a year the source left blank stays out, nothing is
 * filled in or smoothed. IMF years after the newest complete year are IMF projections and say so.
 *
 * Browser-safe (no fs): parsing and the series shape only.
 */
import type { Series, SeriesMissing, SeriesPoint } from './seriesHistory';

export type OfficialSource = 'wb' | 'imf';

export interface OfficialFigure {
  /** Series id. The first eight match the archive figures (src/utils/seriesHistory.ts ARCHIVE_FIGURES). */
  id: string;
  source: OfficialSource;
  /** World Bank indicator code or IMF DataMapper indicator. */
  code: string;
  label: string;
  unit: string;
  /** Turns the published number into the one the app shows. */
  transform?: (v: number) => number;
  about?: string;
  /** Overrides the source name (e.g. IMF Fiscal Monitor series served through the same DataMapper). */
  sourceName?: string;
}

/** WGI political stability estimate (-2.5 to +2.5) to the 0-100 rank the snapshot shows. */
export const stabilityPercentile = (v: number) => Number(Math.max(2, Math.min(98, ((v + 2.5) / 5) * 100)).toFixed(1));

export const OFFICIAL_FIGURES: OfficialFigure[] = [
  { id: 'debt_gdp', source: 'imf', code: 'GGXWDG_NGDP', label: 'Government debt', unit: '% of GDP' },
  // IMF Fiscal Monitor series on DataMapper: the WEO codes GGXONLB_NGDP / GGXCNL_NGDP answer empty there.
  { id: 'primary_balance', source: 'imf', code: 'GGXONLB_G01_GDP_PT', label: 'Primary balance', unit: '% of GDP', sourceName: 'IMF Fiscal Monitor', about: 'IMF Fiscal Monitor: general government primary net lending/borrowing.' },
  { id: 'overall_balance', source: 'imf', code: 'GGXCNL_G01_GDP_PT', label: 'Overall fiscal balance', unit: '% of GDP', sourceName: 'IMF Fiscal Monitor', about: 'IMF Fiscal Monitor: general government net lending/borrowing. Primary minus overall balance = net interest paid.' },
  { id: 'revenue', source: 'imf', code: 'GGR_G01_GDP_PT', label: 'Government revenue', unit: '% of GDP', sourceName: 'IMF Fiscal Monitor', about: 'IMF Fiscal Monitor: general government revenue.' },
  { id: 'expenditure', source: 'imf', code: 'G_X_G01_GDP_PT', label: 'Government expenditure', unit: '% of GDP', sourceName: 'IMF Fiscal Monitor', about: 'IMF Fiscal Monitor: general government total expenditure, interest included.' },
  { id: 'unemployment', source: 'imf', code: 'LUR', label: 'Unemployment rate', unit: '%', about: 'IMF WEO: unemployment rate, national definitions (they differ between countries).' },
  { id: 'current_account_usd', source: 'imf', code: 'BCA', label: 'Current account, US dollars', unit: 'USD bn', about: 'IMF WEO: current account balance in billions of US dollars.' },
  { id: 'gdp_usd', source: 'imf', code: 'NGDPD', label: 'GDP, US dollars', unit: 'USD bn', about: 'IMF WEO: GDP at current prices in US dollars. Used to turn dollar debt flows into % of GDP.' },
  { id: 'gdp_growth', source: 'imf', code: 'NGDP_RPCH', label: 'Real GDP growth', unit: '%' },
  { id: 'cpi_imf', source: 'imf', code: 'PCPIPCH', label: 'Inflation (IMF WEO)', unit: '%' },
  { id: 'output_gap', source: 'imf', code: 'NGAP_NPGDP', label: 'Output gap', unit: '% of potential GDP' },
  { id: 'reserves_months', source: 'wb', code: 'FI.RES.TOTL.MO', label: 'Reserves', unit: 'months of imports' },
  { id: 'current_account', source: 'wb', code: 'BN.CAB.XOKA.GD.ZS', label: 'Current account', unit: '% of GDP' },
  { id: 'external_debt', source: 'wb', code: 'DT.DOD.DECT.GN.ZS', label: 'External debt', unit: '% of GNI' },
  {
    id: 'stability',
    source: 'wb',
    code: 'PV.EST',
    label: 'Political stability rank',
    unit: 'percentile',
    transform: stabilityPercentile,
    about: 'World Bank WGI estimate (-2.5 to +2.5) shown on a 0-100 scale, as on the country page.',
  },
  { id: 'reserves_usd', source: 'wb', code: 'FI.RES.TOTL.CD', label: 'Total reserves incl. gold', unit: 'USD bn', transform: (v) => Number((v / 1e9).toFixed(2)) },
  { id: 'short_term_debt_reserves', source: 'wb', code: 'DT.DOD.DSTC.IR.ZS', label: 'Short-term external debt', unit: '% of reserves' },
  { id: 'short_term_debt_usd', source: 'wb', code: 'DT.DOD.DSTC.CD', label: 'Short-term external debt, US dollars', unit: 'USD bn', transform: (v) => Number((v / 1e9).toFixed(2)), about: 'World Bank IDS: external debt with original maturity of one year or less, all sectors.' },
  { id: 'broad_money_gdp', source: 'wb', code: 'FM.LBL.BMNY.GD.ZS', label: 'Broad money', unit: '% of GDP' },
  { id: 'terms_of_trade', source: 'wb', code: 'TT.PRI.MRCH.XD.WD', label: 'Terms of trade', unit: 'index (2015 = 100)', about: 'World Bank: net barter terms of trade, export unit values over import unit values. Used in the BEER fair value.' },
  { id: 'gdp_pc_ppp', source: 'wb', code: 'NY.GDP.PCAP.PP.KD', label: 'GDP per head, PPP', unit: 'constant 2021 international $', about: 'World Bank: GDP per head at purchasing power parity, constant prices. Used against the US as a productivity stand-in in the BEER fair value.' },
  { id: 'fdi_in_gdp', source: 'wb', code: 'BX.KLT.DINV.WD.GD.ZS', label: 'Foreign direct investment, net inflows', unit: '% of GDP', sourceName: 'World Bank WDI', about: 'World Bank: direct investment into the country by foreigners (lasting interest, 10% or more of voting stock), net of disinvestment, as % of GDP. Yearly.' },
  { id: 'fdi_out_gdp', source: 'wb', code: 'BM.KLT.DINV.WD.GD.ZS', label: 'Foreign direct investment, net outflows', unit: '% of GDP', sourceName: 'World Bank WDI', about: 'World Bank: direct investment abroad by residents, net of disinvestment, as % of GDP. Yearly.' },
  { id: 'fdi_net_usd', source: 'wb', code: 'BN.KLT.DINV.CD', label: 'Direct investment, net (balance of payments)', unit: 'USD bn', transform: (v) => Number((v / 1e9).toFixed(2)), sourceName: 'World Bank WDI', about: 'World Bank: net direct investment in the balance of payments. World Bank BoP sign convention (BPM6): net = what residents invest abroad minus what foreigners invest in the country, so a negative number means more came in than went out.' },
  { id: 'portfolio_net_usd', source: 'wb', code: 'BN.KLT.PTXL.CD', label: 'Portfolio investment, net (balance of payments)', unit: 'USD bn', transform: (v) => Number((v / 1e9).toFixed(2)), sourceName: 'World Bank WDI', about: 'World Bank: net cross-border flows in debt and equity securities other than direct investment and reserves. World Bank BoP sign convention (BPM6): net = what residents invest abroad minus what foreigners invest in the country, so a negative number means more came in than went out.' },
  { id: 'financial_account_usd', source: 'wb', code: 'BN.FIN.TOTL.CD', label: 'Net financial account (balance of payments)', unit: 'USD bn', transform: (v) => Number((v / 1e9).toFixed(2)), sourceName: 'World Bank WDI', about: 'World Bank: net acquisition of foreign financial assets minus net incurrence of liabilities, all categories. World Bank BoP sign convention (BPM6): net = what residents invest abroad minus what foreigners invest in the country, so a negative number means more came in than went out.' },
  { id: 'exports_usd', source: 'wb', code: 'NE.EXP.GNFS.CD', label: 'Exports of goods and services', unit: 'USD bn', transform: (v) => Number((v / 1e9).toFixed(2)) },
  { id: 'cpi_index', source: 'wb', code: 'FP.CPI.TOTL', label: 'Consumer price index', unit: 'index (2010 = 100)', sourceName: 'World Bank WDI', about: 'World Bank: consumer price index, yearly average, 2010 = 100. Used to turn nominal amounts into real ones (Unit converters).' },
  { id: 'population', source: 'wb', code: 'SP.POP.TOTL', label: 'Population', unit: 'million people', transform: (v) => Number((v / 1e6).toFixed(3)), sourceName: 'World Bank WDI', about: 'World Bank: total population, mid-year. Used for per-head amounts (Unit converters).' },
  { id: 'fx_lcu_usd', source: 'wb', code: 'PA.NUS.FCRF', label: 'Official exchange rate', unit: 'local currency per US$, yearly average', sourceName: 'World Bank WDI', about: 'World Bank: official exchange rate, local currency units per US dollar, average of the year (IMF IFS). Used to turn local currency into US dollars (Unit converters).' },
  { id: 'ppp_factor', source: 'wb', code: 'PA.NUS.PPP', label: 'PPP conversion factor, GDP', unit: 'local currency per international $', sourceName: 'World Bank ICP', about: 'World Bank International Comparison Program: PPP conversion factor for GDP, local currency units per international dollar. Used for amounts at purchasing power parity (Unit converters).' },
  { id: 'wgi_voice', source: 'wb', code: 'VA.EST', label: 'Voice and accountability', unit: 'WGI estimate (world mean 0, sd 1)', sourceName: 'World Bank WGI', about: 'World Bank Worldwide Governance Indicators: voice and accountability, estimate on a scale where the world average is 0 and one standard deviation is 1 (about -2.5 to +2.5). Used in the country risk scorecard.' },
  { id: 'wgi_stability', source: 'wb', code: 'PV.EST', label: 'Political stability and absence of violence', unit: 'WGI estimate (world mean 0, sd 1)', sourceName: 'World Bank WGI', about: 'World Bank Worldwide Governance Indicators: political stability and absence of violence or terrorism, estimate on a scale where the world average is 0 and one standard deviation is 1 (about -2.5 to +2.5). Used in the country risk scorecard.' },
  { id: 'wgi_effectiveness', source: 'wb', code: 'GE.EST', label: 'Government effectiveness', unit: 'WGI estimate (world mean 0, sd 1)', sourceName: 'World Bank WGI', about: 'World Bank Worldwide Governance Indicators: government effectiveness, estimate on a scale where the world average is 0 and one standard deviation is 1 (about -2.5 to +2.5). Used in the country risk scorecard.' },
  { id: 'wgi_regulatory', source: 'wb', code: 'RQ.EST', label: 'Regulatory quality', unit: 'WGI estimate (world mean 0, sd 1)', sourceName: 'World Bank WGI', about: 'World Bank Worldwide Governance Indicators: regulatory quality, estimate on a scale where the world average is 0 and one standard deviation is 1 (about -2.5 to +2.5). Used in the country risk scorecard.' },
  { id: 'wgi_rule_of_law', source: 'wb', code: 'RL.EST', label: 'Rule of law', unit: 'WGI estimate (world mean 0, sd 1)', sourceName: 'World Bank WGI', about: 'World Bank Worldwide Governance Indicators: rule of law, estimate on a scale where the world average is 0 and one standard deviation is 1 (about -2.5 to +2.5). Used in the country risk scorecard.' },
  { id: 'wgi_corruption', source: 'wb', code: 'CC.EST', label: 'Control of corruption', unit: 'WGI estimate (world mean 0, sd 1)', sourceName: 'World Bank WGI', about: 'World Bank Worldwide Governance Indicators: control of corruption, estimate on a scale where the world average is 0 and one standard deviation is 1 (about -2.5 to +2.5). Used in the country risk scorecard.' },
];

export interface OfficialRun {
  /** Oldest first. Dates are years (YYYY). */
  points: SeriesPoint[];
}

export interface OfficialHistoryFile {
  iso3: string;
  /** When the last download finished (ISO). */
  pulledAt: string;
  /** Series id -> observations. */
  series: Record<string, OfficialRun>;
  /** Figure ids the last download asked for, so a figure added later triggers one new download. */
  asked?: string[];
  /** Series id -> why it did not come back this time (a later download tries again). */
  failed?: Record<string, string>;
  /** Series id -> values the source changed between downloads, oldest first (see historyRevisions). */
  revisions?: Record<string, HistoryRevision[]>;
}

/**
 * A value the source changed between two downloads: the year, what it was and what it is now.
 * IMF years from the current one on are projections, revised at every WEO; they are marked so a
 * screen can tell a revised outturn from a revised forecast. A year the source dropped has no `to`.
 */
export interface HistoryRevision {
  date: string;
  from: number;
  to?: number;
  /** When the new value was first downloaded, and when the old one was. */
  seenAt: string;
  prevPulledAt: string;
  projection?: boolean;
}

/** Revisions kept per series (each WEO revises several years; this is decades of them). */
export const KEEP_REVISIONS = 300;

/** Changes this small are rounding, not revisions. */
const REVISION_TOL = 0.0005;

/**
 * What changed between the saved download and the new one, per series: years in both whose value
 * moved, and years the source no longer publishes. New years are not revisions.
 */
export function historyRevisions(prev: OfficialHistoryFile | null | undefined, next: Pick<OfficialHistoryFile, 'series' | 'pulledAt'>): Record<string, HistoryRevision[]> {
  const out: Record<string, HistoryRevision[]> = {};
  if (!prev?.series) return out;
  const thisYear = new Date(next.pulledAt).getUTCFullYear();
  for (const fig of OFFICIAL_FIGURES) {
    const before = prev.series[fig.id]?.points;
    const after = next.series[fig.id]?.points;
    if (!before?.length || !after?.length || before === after) continue;
    const now = new Map(after.map((p) => [p.date, p.value]));
    const list: HistoryRevision[] = [];
    for (const p of before) {
      const projection = fig.source === 'imf' && Number(p.date) >= thisYear ? { projection: true } : {};
      const v = now.get(p.date);
      if (v === undefined) list.push({ date: p.date, from: p.value, seenAt: next.pulledAt, prevPulledAt: prev.pulledAt, ...projection });
      else if (Math.abs(v - p.value) > REVISION_TOL * Math.max(1, Math.abs(p.value))) list.push({ date: p.date, from: p.value, to: v, seenAt: next.pulledAt, prevPulledAt: prev.pulledAt, ...projection });
    }
    if (list.length) out[fig.id] = list;
  }
  return out;
}

/** The saved revisions with the new ones added, newest KEEP_REVISIONS per series. */
export function mergeRevisions(prev: OfficialHistoryFile['revisions'], added: Record<string, HistoryRevision[]>): Record<string, HistoryRevision[]> | undefined {
  const out: Record<string, HistoryRevision[]> = {};
  for (const id of new Set([...Object.keys(prev || {}), ...Object.keys(added)])) {
    const list = [...(prev?.[id] || []), ...(added[id] || [])].slice(-KEEP_REVISIONS);
    if (list.length) out[id] = list;
  }
  return Object.keys(out).length ? out : undefined;
}

const fmtRev = (v: number) => String(Number(v.toFixed(3)));

/** "Revised from 87.1 on 2026-11-06" for each year whose current value the source changed (latest change). */
export function revisionNotes(revs: HistoryRevision[] | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of revs || []) if (r.to !== undefined) m.set(r.date, `Revised from ${fmtRev(r.from)} on ${r.seenAt.slice(0, 10)}`);
  return m;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Years from the World Bank v2 JSON answer ([meta, rows]). Null when the answer is not that shape. */
export function parseWorldBankYears(body: unknown): Array<{ year: string; value: number }> | null {
  if (!Array.isArray(body)) return null;
  const rows = Array.isArray(body[1]) ? body[1] : body.length === 1 ? [] : null;
  if (!rows) return null;
  const out: Array<{ year: string; value: number }> = [];
  for (const r of rows as Array<{ date?: unknown; value?: unknown }>) {
    const year = String(r?.date ?? '');
    if (/^\d{4}$/.test(year) && finite(r?.value)) out.push({ year, value: r.value as number });
  }
  return out.sort((a, b) => (a.year < b.year ? -1 : 1));
}

/** Years from the IMF DataMapper answer ({values: {CODE: {ISO3: {year: value}}}}). */
export function parseImfYears(body: unknown, code: string, iso3: string): Array<{ year: string; value: number }> | null {
  const values = (body as { values?: Record<string, Record<string, Record<string, unknown>>> })?.values;
  if (!values || typeof values !== 'object') return null;
  const run = values[code]?.[iso3];
  if (!run) return [];
  return Object.entries(run)
    .filter(([y, v]) => /^\d{4}$/.test(y) && finite(v))
    .map(([year, value]) => ({ year, value: value as number }))
    .sort((a, b) => (a.year < b.year ? -1 : 1));
}

/** The points saved for one figure: published values after the figure's transform. */
export function officialPoints(fig: OfficialFigure, years: Array<{ year: string; value: number }>): SeriesPoint[] {
  return years.map(({ year, value }) => ({ date: year, value: fig.transform ? fig.transform(value) : Number(value.toFixed(3)) }));
}

/**
 * The IMF projects ahead: years from the current one on are projections in the WEO. Each such point
 * carries the note "IMF projection" so a chart or download never passes it off as an outturn.
 */
export function markImfProjections(points: SeriesPoint[], now = new Date()): SeriesPoint[] {
  const thisYear = now.getUTCFullYear();
  return points.map((p) => (Number(p.date) >= thisYear ? { ...p, note: 'IMF projection' } : p));
}

const SOURCE_NAME: Record<OfficialSource, string> = { wb: 'World Bank Open Data', imf: 'IMF World Economic Outlook' };

/** A saved run as a Series (annual), or Missing with the reason. */
export function officialSeries(file: OfficialHistoryFile | null | undefined, fig: OfficialFigure, now = new Date()): Series | SeriesMissing {
  if (!file) return { id: fig.id, label: fig.label, reason: 'Full history not downloaded yet' };
  const run = file.series?.[fig.id];
  if (!run?.points?.length) {
    const why = file.failed?.[fig.id];
    return { id: fig.id, label: fig.label, reason: why || `${fig.sourceName || SOURCE_NAME[fig.source]} publishes no figures for this country` };
  }
  const notes = revisionNotes(file.revisions?.[fig.id]);
  const marked = fig.source === 'imf' ? markImfProjections(run.points, now) : run.points;
  const points = notes.size ? marked.map((p) => (notes.has(p.date) ? { ...p, revised: notes.get(p.date) } : p)) : marked;
  const projected = points.some((p) => p.note === 'IMF projection');
  return {
    id: fig.id,
    label: fig.label,
    unit: fig.unit,
    freq: 'annual',
    source: `${fig.sourceName || SOURCE_NAME[fig.source]} (${fig.code})`,
    pulledAt: file.pulledAt,
    points,
    about: [fig.about, projected ? 'Years from this one on are IMF projections, marked as such.' : '', notes.size ? `${notes.size} year${notes.size === 1 ? '' : 's'} revised by the source since the app first downloaded ${notes.size === 1 ? 'it' : 'them'}.` : ''].filter(Boolean).join(' ') || undefined,
  };
}

/** Rough size on disk of a history file, for the offline-data estimate. */
export function historyPointCount(file: OfficialHistoryFile | null | undefined): number {
  return Object.values(file?.series || {}).reduce((n, r) => n + (r.points?.length || 0), 0);
}
