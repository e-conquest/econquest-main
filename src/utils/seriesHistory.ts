/**
 * One place for every figure's history. Several feeds already bring a run of observations (BIS
 * policy rates, the OECD leading indicator, monthly inflation, CFTC positioning, US Treasury TIC
 * holdings, World Bank Pink Sheet prices); everything else gets a history from the pull archive
 * (src/utils/pullArchive.ts): the value each saved pull showed, dated by the pull.
 *
 * Only real observations are returned. A figure with no history says why, in words, and a series
 * never has a point filled in, carried forward or smoothed.
 *
 * Browser-safe (no fs): the server hands in what it has pulled.
 */
import { CDS_HIDDEN } from './cdsHidden';
import { CBPOL_AREA, type CbpolPull } from './bisPolicyRates';
import { CFTC_CURRENCY_CODES, type CftcWeek } from './cftcPositioning';
import { type PriceSeries } from './commodityPrices';
import { areaSeries } from './oecdSdmx';
import { type CliSeries } from './oecdCli';
import { QNA_SOURCE, qnaFor, type QnaSeries } from './oecdQna';
import { activityMissing, type ActivitySeries } from './monthlyActivity';
import { type CpiBasis } from './oecdInflation';
import { type TicTable } from './ticHoldings';
import { OFFICIAL_FIGURES, officialSeries, type OfficialHistoryFile } from './officialHistory';
import { outputGapFromGrowth, outputGapSeries } from './outputGap';
import { fxDailySeries, type FxHistoryFile } from './fxHistory';
import type { FxExtraFile } from './fxExtra';
import { bisCreditSeries, type BisCreditCycle } from './bisCreditCycle';
import { idsCreditorSeries, type IdsCreditors } from './idsCreditors';
import { sovereignDefaultSeries, type SovereignDefaults } from './sovereignDefaults';
import { inflationExpectationSeries, type InflationExpectations } from './inflationExpectations';
import { focusSeries, type InflationSurveys } from './inflationSurveys';
import { impliedDefaultSeries } from './impliedDefault';
import { BIS_ISO2 } from './bisDebtSecurities';
import { HC_SPREAD_NOT_CDS, HC_SPREAD_SOURCE, hasHcSpreadSource, type HcSpreadPull } from './hardCurrencySpread';

export type SeriesFreq = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual' | 'per pull';

export interface SeriesPoint {
  /** YYYY-MM-DD, YYYY-MM, YYYY-Qn or YYYY. */
  date: string;
  value: number;
  /** For archive series: what the source said that pull (e.g. "IMF WEO", "World Bank, 2024"). */
  note?: string;
  /** Official history: the source changed this value since the app first read it ("Revised from 87.1 on 2026-11-06"). */
  revised?: string;
}

export interface Series {
  id: string;
  label: string;
  unit: string;
  freq: SeriesFreq;
  source: string;
  /** When the feed behind it was last pulled (ISO). */
  pulledAt?: string;
  /** Oldest first. */
  points: SeriesPoint[];
  /** A sentence on how to read it, when it is not obvious. */
  about?: string;
}

export interface SeriesMissing {
  id: string;
  label: string;
  reason: string;
}

export interface SeriesSet {
  iso3: string;
  series: Series[];
  missing: SeriesMissing[];
}

/** One archived pull, as the archive reader returns it (snapshot shape kept loose on purpose). */
export interface ArchivedSnapshot {
  date: string;
  pulledAt: number;
  snapshot: { liveFields?: Record<string, string>; [k: string]: unknown };
}

export interface SeriesInputs {
  cbpol?: CbpolPull | null;
  cli?: { pulledAt: string; series: CliSeries } | null;
  /** OECD quarterly real GDP growth (src/utils/oecdQna.ts). */
  qna?: { pulledAt: string; series: QnaSeries } | null;
  /** Monthly activity indexes (src/utils/monthlyActivity.ts), by ISO3. */
  activity?: { pulledAt: string; series: Record<string, ActivitySeries> } | null;
  cpi?: { pulledAt: string; series: Record<string, { basis: CpiBasis; points: { period: string; value: number }[]; short?: string; long?: string }> } | null;
  cftc?: { pulledAt: string; weeks: Record<string, CftcWeek[]> } | null;
  tic?: { pulledAt: string; table: TicTable } | null;
  /** False when the OECD inflation pull itself has not answered (national series may still be in cpi). */
  cpiOecdAnswered?: boolean;
  /** Saved pulls for the country, any order. */
  archive?: ArchivedSnapshot[];
  /** Full World Bank / IMF history for the country (src/utils/officialHistory.ts), when downloaded. */
  official?: OfficialHistoryFile | null;
  /** Hard-currency bond spreads (BCRP EMBIG, monthly), when pulled. */
  hcSpread?: HcSpreadPull | null;
  /** Daily ECB reference rates per US dollar (src/utils/fxHistory.ts), when pulled. */
  fxHistory?: FxHistoryFile | null;
  /** Daily central-bank rates for PEN, COP and ARS (src/utils/fxExtra.ts), when pulled. */
  fxExtra?: FxExtraFile | null;
  /** BIS credit-to-GDP gap, debt service ratio and real house prices (src/utils/bisCreditCycle.ts), when pulled. */
  bisCredit?: BisCreditCycle | null;
  /** Creditor mix and terms of public external debt (src/utils/idsCreditors.ts), when pulled. */
  idsCreditors?: IdsCreditors | null;
  /** Sovereign default history, BoC-BoE database (src/utils/sovereignDefaults.ts), when pulled. */
  sovereignDefaults?: SovereignDefaults | null;
  /** US inflation expectations from FRED (src/utils/inflationExpectations.ts), US only. */
  inflationExpectations?: InflationExpectations | null;
  /** Survey expectations (src/utils/inflationSurveys.ts): the Focus series on Brazil's page. */
  inflationSurveys?: InflationSurveys | null;
  /** The country's currency (ISO 4217), for the daily exchange rate. */
  currency?: string;
}

/** Figures given a history from the pull archive: the live-field key and where the value sits. */
export const ARCHIVE_FIGURES: Array<{ id: string; field: string; label: string; unit: string }> = [
  { id: 'debt_gdp', field: 'imf.debtToGdpPct', label: 'Government debt', unit: '% of GDP' },
  { id: 'primary_balance', field: 'imf.primaryFiscalBalancePct', label: 'Primary balance', unit: '% of GDP' },
  { id: 'gdp_growth', field: 'imf.realGdpGrowthPct', label: 'Real GDP growth', unit: '%' },
  { id: 'cpi_imf', field: 'imf.cpiInflationPct', label: 'Inflation (IMF WEO)', unit: '%' },
  { id: 'reserves_months', field: 'wb.fxReservesMonthsImport', label: 'Reserves', unit: 'months of imports' },
  { id: 'current_account', field: 'wb.currentAccountPctGdp', label: 'Current account', unit: '% of GDP' },
  { id: 'external_debt', field: 'wb.externalDebtPctGni', label: 'External debt', unit: '% of GNI' },
  { id: 'stability', field: 'wb.politicalStabilityPercentile', label: 'Political stability rank', unit: 'percentile' },
  { id: 'yield_10y', field: 'market.sovereign10YBondYieldPct', label: '10Y government bond yield', unit: '%' },
  // 5Y CDS is hidden for now (src/utils/cdsHidden.ts); the USD bond spread has its own monthly series.
  ...(CDS_HIDDEN ? [] : [{ id: 'cds_5y', field: 'market.cds5YSpreadBps', label: '5Y CDS (your data)', unit: 'bp' }]),
  { id: 'fx_per_usd', field: 'market.exchangeRatePerUsd', label: 'Exchange rate', unit: 'per USD' },
  { id: 'gdelt_tone', field: 'gdelt.averageTone', label: 'News tone (GDELT)', unit: 'tone' },
];

const GROUP_FOR_PREFIX: Record<string, string> = {
  imf: 'imfIndicators',
  wb: 'worldBankIndicators',
  market: 'monetaryAndMarket',
  gdelt: 'gdeltMetrics',
};

/** The number a live-field key points at in a snapshot, or undefined. */
export function snapshotValue(snapshot: Record<string, unknown>, field: string): number | undefined {
  const [prefix, key] = field.split('.');
  const group = snapshot[GROUP_FOR_PREFIX[prefix] ?? ''] as Record<string, unknown> | undefined;
  const v = group?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

const sortByDate = (pts: SeriesPoint[]) => pts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function policyRate(iso3: string, pull: CbpolPull | null | undefined): Series | SeriesMissing {
  const label = 'Policy rate';
  const area = CBPOL_AREA[iso3];
  if (!area) return { id: 'policy_rate', label, reason: 'Not in BIS policy rates' };
  if (!pull) return { id: 'policy_rate', label, reason: 'BIS has not answered yet' };
  const daily = pull.daily?.[area];
  const monthly = pull.monthly?.[area];
  const dailyPts = sortByDate((daily?.points || []).filter((p) => finite(p.pct)).map((p) => ({ date: p.period, value: p.pct })));
  const monthlyPts = sortByDate((monthly?.points || []).filter((p) => finite(p.pct)).map((p) => ({ date: p.period, value: p.pct })));
  if (!dailyPts.length && !monthlyPts.length) return { id: 'policy_rate', label, reason: 'Not in BIS policy rates' };
  const bank = daily?.bank || monthly?.bank;
  const base = {
    id: 'policy_rate',
    label,
    unit: '%',
    source: `BIS central bank policy rates${bank ? ` (${bank})` : ''}`,
    pulledAt: pull.pulledAt,
  };
  // The daily pull keeps only the latest observation or two, while the monthly one holds years of
  // month-ends. Use the daily run on its own only when it reaches back as far as the monthly one;
  // otherwise chart the month-ends and add the daily figures that came after the last month-end.
  const dailyCoversMonthly = dailyPts.length > 0 && (!monthlyPts.length || dailyPts[0].date.slice(0, 7) <= monthlyPts[0].date);
  if (dailyCoversMonthly) return { ...base, freq: 'daily', points: dailyPts };
  const lastMonth = monthlyPts[monthlyPts.length - 1].date;
  const after = dailyPts.filter((p) => p.date.slice(0, 7) > lastMonth).map((p) => ({ ...p, note: 'latest daily figure' }));
  return {
    ...base,
    freq: 'monthly',
    points: [...monthlyPts, ...after],
    ...(after.length ? { about: 'Month-end rates, then the latest daily figure after the last month-end.' } : {}),
  };
}

function leadingIndicator(iso3: string, pull: SeriesInputs['cli']): Series | SeriesMissing {
  const label = 'OECD leading indicator';
  const pts = pull ? areaSeries(iso3, pull.series) : undefined;
  if (!pull) return { id: 'cli', label, reason: 'OECD data has not answered yet' };
  if (!pts?.length) return { id: 'cli', label, reason: 'The OECD publishes no leading indicator for this country' };
  return {
    id: 'cli',
    label,
    unit: 'index, 100 = trend',
    freq: 'monthly',
    source: 'OECD via DBnomics',
    pulledAt: pull.pulledAt,
    points: sortByDate(pts.filter((p) => finite(p.value)).map((p) => ({ date: p.period, value: p.value }))),
    about: 'Above 100 = above trend; rising = growth picking up.',
  };
}

/** Quarterly real GDP growth from the OECD quarterly national accounts: q/q and y/y. */
function quarterlyGdp(iso3: string, pull: SeriesInputs['qna']): Array<Series | SeriesMissing> {
  const defs = [
    { id: 'gdp_qoq', basis: 'qoq' as const, label: 'Real GDP growth, quarterly (q/q)', about: 'Growth on the previous quarter, seasonally adjusted, not annualised.' },
    { id: 'gdp_yoy_q', basis: 'yoy' as const, label: 'Real GDP growth, quarterly (y/y)', about: 'Growth on the same quarter a year earlier, seasonally adjusted.' },
  ];
  const a = pull ? qnaFor(iso3, pull.series) : null;
  return defs.map((d) => {
    if (!pull) return { id: d.id, label: d.label, reason: 'OECD quarterly national accounts have not answered yet' };
    const pts = a?.[d.basis] ?? [];
    if (!pts.length) return { id: d.id, label: d.label, reason: 'The OECD publishes no quarterly GDP for this country' };
    return {
      id: d.id,
      label: d.label,
      unit: '%',
      freq: 'quarterly' as const,
      source: QNA_SOURCE,
      pulledAt: pull.pulledAt,
      points: sortByDate(pts.filter((p) => finite(p.value)).map((p) => ({ date: p.period, value: p.value }))),
      about: d.about,
    };
  });
}

/** Monthly activity index (BCB IBC-Br, Eurostat industrial production), for the GDP nowcast. */
function activityIndex(iso3: string, pull: SeriesInputs['activity']): Series | SeriesMissing {
  const label = 'Activity index, monthly';
  const a = pull?.series?.[iso3];
  if (!a?.points?.length) return { id: 'activity_monthly', label, reason: activityMissing(iso3, Boolean(pull)) };
  return {
    id: 'activity_monthly',
    label: `${label} (${a.short})`,
    unit: a.unit,
    freq: 'monthly',
    source: a.long,
    pulledAt: pull!.pulledAt,
    points: sortByDate(a.points.filter((p) => finite(p.value)).map((p) => ({ date: p.period, value: p.value }))),
    about: 'Seasonally adjusted volume index; it comes out four to eight weeks after the month, well before quarterly GDP.',
  };
}

function inflation(iso3: string, pull: SeriesInputs['cpi'], oecdAnswered = true): Series | SeriesMissing {
  const label = 'Inflation, monthly';
  if (!pull) return { id: 'cpi_monthly', label, reason: 'Monthly inflation has not answered yet' };
  const s = areaSeries(iso3, pull.series);
  if (!s?.points?.length) {
    return { id: 'cpi_monthly', label, reason: oecdAnswered ? 'No monthly inflation source for this country yet' : 'OECD inflation has not answered yet' };
  }
  return {
    id: 'cpi_monthly',
    label,
    unit: '% year on year',
    freq: 'monthly',
    source: s.long || (s.basis === 'national' ? 'National statistics' : 'OECD via DBnomics'),
    pulledAt: pull.pulledAt,
    points: sortByDate(s.points.filter((p) => finite(p.value)).map((p) => ({ date: p.period, value: p.value }))),
  };
}

function positioning(iso3: string, pull: SeriesInputs['cftc']): Series | SeriesMissing {
  const label = 'Futures positioning (leveraged funds)';
  const def = CFTC_CURRENCY_CODES[iso3];
  if (!def) return { id: 'cftc_lev_net', label, reason: 'No CFTC currency future for this country' };
  if (!pull) return { id: 'cftc_lev_net', label, reason: 'CFTC has not answered yet' };
  const weeks = pull.weeks?.[def.code] || [];
  const points = weeks
    .filter((w) => finite(w.levNet) && finite(w.openInterest) && w.openInterest > 0)
    .map((w) => ({ date: w.date, value: Number(((w.levNet / w.openInterest) * 100).toFixed(2)) }));
  if (!points.length) return { id: 'cftc_lev_net', label, reason: 'CFTC sent no weeks for this currency' };
  return {
    id: 'cftc_lev_net',
    label,
    unit: '% of open interest, net long',
    freq: 'weekly',
    source: `CFTC Traders in Financial Futures, ${def.market}`,
    pulledAt: pull.pulledAt,
    points: sortByDate(points),
    about: 'Positive = funds net long the currency against the dollar.',
  };
}

function ticHoldings(iso3: string, pull: SeriesInputs['tic']): Series | SeriesMissing {
  const label = 'US Treasuries held';
  if (!pull) return { id: 'tic_holdings', label, reason: 'US Treasury TIC has not answered yet' };
  const row = pull.table?.rows?.[iso3];
  const months = pull.table?.months || [];
  if (!row?.length) return { id: 'tic_holdings', label, reason: 'Not listed separately in TIC' };
  const points = months.map((m, i) => ({ date: m, value: row[i] })).filter((p) => finite(p.value));
  return { id: 'tic_holdings', label, unit: 'USD bn', freq: 'monthly', source: 'US Treasury TIC (SLT table 5)', pulledAt: pull.pulledAt, points: sortByDate(points) };
}

/** USD bond spread over Treasuries, monthly, from BCRP (up to 36 months). A bond spread, not CDS. */
function hcSpread(iso3: string, pull: SeriesInputs['hcSpread']): Series | SeriesMissing {
  const label = 'USD bond spread over Treasuries (not CDS)';
  if (!hasHcSpreadSource(iso3)) return { id: 'hc_spread', label, reason: 'No free official source publishes it for this country' };
  if (!pull) return { id: 'hc_spread', label, reason: 'BCRP (central bank of Peru) has not answered yet' };
  const obs = pull.countries[iso3];
  if (!obs?.history?.length) return { id: 'hc_spread', label, reason: 'Not in the BCRP reply' };
  const points = sortByDate(obs.history.filter((p) => finite(p.bps)).map((p) => ({ date: p.period, value: p.bps })));
  return { id: 'hc_spread', label, unit: 'bp', freq: 'monthly', source: HC_SPREAD_SOURCE, pulledAt: pull.at, points, about: HC_SPREAD_NOT_CDS };
}

/** Archive series for one figure: one point per saved pull that had it live. */
export function archiveSeries(archive: ArchivedSnapshot[] | undefined, fig: (typeof ARCHIVE_FIGURES)[number]): Series | SeriesMissing {
  const pulls = [...(archive || [])].sort((a, b) => a.pulledAt - b.pulledAt);
  if (!pulls.length) return { id: fig.id, label: fig.label, reason: 'No saved pulls yet; the archive started with this version' };
  const points: SeriesPoint[] = [];
  for (const p of pulls) {
    const src = p.snapshot?.liveFields?.[fig.field];
    const v = src ? snapshotValue(p.snapshot as Record<string, unknown>, fig.field) : undefined;
    if (src && v !== undefined) points.push({ date: p.date, value: v, note: src });
  }
  if (!points.length) return { id: fig.id, label: fig.label, reason: `No saved pull had it (${pulls.length} pull${pulls.length === 1 ? '' : 's'} checked)` };
  return {
    id: fig.id,
    label: fig.label,
    unit: fig.unit,
    freq: 'per pull',
    source: 'Saved pulls (value as each pull showed it)',
    points,
    about: 'Each point is the figure as the app saw it on that day; the source and period are in its note.',
  };
}

const isSeries = (x: Series | SeriesMissing): x is Series => 'points' in x;

/**
 * A figure's history: the full official run when it has been downloaded (every year the World Bank
 * or IMF publish), otherwise the saved pulls. With neither, Missing with both reasons.
 */
function figureHistory(fig: (typeof ARCHIVE_FIGURES)[number], inputs: SeriesInputs): Series | SeriesMissing {
  if (fig.id === 'fx_per_usd') {
    // The published daily run when the ECB has the currency; the saved pulls otherwise.
    const daily = fxDailySeries(inputs.fxHistory, inputs.currency, inputs.fxExtra);
    if (isSeries(daily)) return daily;
    const archived = archiveSeries(inputs.archive, fig);
    if (isSeries(archived)) return { ...archived, about: `${archived.about} No daily history: ${daily.reason.charAt(0).toLowerCase()}${daily.reason.slice(1)}.` };
    return { id: fig.id, label: fig.label, reason: `${archived.reason}; no daily history: ${daily.reason.charAt(0).toLowerCase()}${daily.reason.slice(1)}` };
  }
  const def = OFFICIAL_FIGURES.find((o) => o.id === fig.id);
  const official = def ? officialSeries(inputs.official, def) : null;
  if (official && isSeries(official)) return official;
  const archived = archiveSeries(inputs.archive, fig);
  if (isSeries(archived) || !official) return archived;
  return { id: fig.id, label: fig.label, reason: inputs.official ? official.reason : `${archived.reason}; full history not downloaded yet` };
}

/** Every history the app has for a country, and what is missing with the reason. */
export function countrySeries(iso3: string, inputs: SeriesInputs): SeriesSet {
  const code = String(iso3 || '').toUpperCase();
  const all: Array<Series | SeriesMissing> = [
    policyRate(code, inputs.cbpol),
    inflation(code, inputs.cpi, inputs.cpiOecdAnswered !== false),
    leadingIndicator(code, inputs.cli),
    ...quarterlyGdp(code, inputs.qna),
    activityIndex(code, inputs.activity),
    positioning(code, inputs.cftc),
    ticHoldings(code, inputs.tic),
    hcSpread(code, inputs.hcSpread),
    impliedDefaultSeries(hcSpread(code, inputs.hcSpread)),
    ...bisCreditSeries(inputs.bisCredit, Boolean(BIS_ISO2[code])),
    ...idsCreditorSeries(inputs.idsCreditors),
    ...sovereignDefaultSeries(code, inputs.sovereignDefaults),
    ...inflationExpectationSeries(code, inputs.inflationExpectations),
    ...focusSeries(code, inputs.inflationSurveys),
    ...ARCHIVE_FIGURES.map((f) => figureHistory(f, inputs)),
    ...OFFICIAL_FIGURES.filter((o) => !ARCHIVE_FIGURES.some((f) => f.id === o.id)).map((o) => officialSeries(inputs.official, o)),
  ];
  // The IMF publishes no output gap series: where it has none, the app's stated estimate stands in,
  // labelled as such (src/utils/outputGap.ts).
  const gapAt = all.findIndex((x) => x.id === 'output_gap');
  if (gapAt >= 0 && !isSeries(all[gapAt])) {
    const growth = all.find((x) => x.id === 'gdp_growth');
    if (growth && isSeries(growth)) {
      const est = outputGapFromGrowth(growth.points, { pulledAt: growth.pulledAt });
      if (est.ok) all[gapAt] = outputGapSeries(est);
      else all[gapAt] = { ...all[gapAt], reason: `${(all[gapAt] as SeriesMissing).reason}; the app estimate needs more history: ${est.reason}` };
    }
  }
  return { iso3: code, series: all.filter(isSeries), missing: all.filter((x): x is SeriesMissing => !isSeries(x)) };
}

/** World commodity prices as series (Pink Sheet monthly, EIA daily). */
export function commoditySeries(prices: PriceSeries[], pulledAt: Record<'pink_sheet' | 'eia', string | undefined>): Series[] {
  return prices
    .filter((p) => p.points?.length)
    .map((p) => ({
      id: `commodity_${p.source}_${p.code}`.toLowerCase(),
      label: p.name,
      unit: p.unit,
      freq: p.source === 'eia' ? ('daily' as const) : ('monthly' as const),
      source: p.source === 'eia' ? 'US EIA spot prices' : 'World Bank Pink Sheet',
      pulledAt: pulledAt[p.source],
      points: sortByDate(p.points.filter((x) => finite(x.value)).map((x) => ({ date: x.period, value: x.value }))),
    }));
}

/** A series without its points, for lists. */
export function seriesSummary(s: Series): Omit<Series, 'points'> & { count: number; first?: string; last?: string; latest?: number; projectedTo?: string } {
  const { points, ...rest } = s;
  // The latest figure is the newest outturn; IMF projection years are counted but never shown as "latest".
  const actual = points.filter((p) => p.note !== 'IMF projection');
  const lastActual = actual[actual.length - 1] ?? points[points.length - 1];
  const projectedTo = actual.length < points.length ? points[points.length - 1]?.date : undefined;
  return { ...rest, count: points.length, first: points[0]?.date, last: lastActual?.date, latest: lastActual?.value, ...(projectedTo ? { projectedTo } : {}) };
}

/** Months between two YYYY-MM periods. */
function monthGap(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/**
 * Stretches where a regular series has no observation: more than one month apart for monthly
 * series, more than ten days for weekly ones. Daily and per-pull series are not checked (a daily
 * policy rate skips weekends and holidays; pulls are weekly by design). Each gap names the last
 * point before it and the first after it.
 */
export function seriesGaps(s: Pick<Series, 'freq' | 'points'>): Array<{ after: string; before: string }> {
  const out: Array<{ after: string; before: string }> = [];
  for (let i = 1; i < s.points.length; i++) {
    const a = s.points[i - 1].date;
    const b = s.points[i].date;
    if (s.freq === 'monthly' && /^\d{4}-\d{2}$/.test(a) && /^\d{4}-\d{2}$/.test(b) && monthGap(a, b) > 1) out.push({ after: a, before: b });
    if (s.freq === 'weekly' && Date.parse(b) - Date.parse(a) > 10 * 24 * 60 * 60 * 1000) out.push({ after: a, before: b });
  }
  return out;
}
