import { netInterestPct } from './imfFiscal';
import { ucdpFigures, ucdpMissing } from './ucdpConflict';
import { HC_SPREAD_LABEL, hcSpreadMissing, hcSpreadWhen } from './hardCurrencySpread';
import type { CouncilAssessmentRun } from '../types/council';
import { getSnapshotDataStatus, DATA_MODE_LABEL, formatAsOf, type SnapshotDataStatus } from './dataStatus';
import { describeOfficialYield, formatPeriod } from './officialYields';
import { nextOfficialEvent, upcomingOfficialEvents } from '../data/officialCalendar';
import { missingReason, type MissingReason } from './liveFigures';

/**
 * Role briefs and report templates built from the current country snapshot.
 * Every figure carries a short source tag ("IMF WEO", "World Bank", "official, Sep 2026 avg",
 * "AI estimate", "sample", "model") so a reader can tell a published number from a placeholder.
 * The plain-language judgements are simple, stated rules on those figures, not model output.
 */

export interface BriefRow {
  label: string;
  value: string;
  source: string;
  /** True when the figure is a published official or live-feed value (shown in green). */
  verified: boolean;
  /** No real source filled this figure: value reads Missing and source says why. */
  missing?: boolean;
  /** What to do about a missing figure. */
  help?: string;
}

export interface BriefGroup {
  title: string;
  rows: BriefRow[];
}

export interface CountryBrief {
  /** One-sentence summary. */
  headline: string;
  /** Short plain-language observations, each tied to the figures shown. */
  judgements: string[];
  groups: BriefGroup[];
  /** Set when figures are missing, so the reader is told up front. */
  sampleWarning?: string;
}

export interface NoteSection {
  id: string;
  heading: string;
  lines: string[];
}

export type SourceKind = 'imf' | 'worldbank' | 'market' | 'yield' | 'cds' | 'model' | 'sample';
type Kind = SourceKind;

/** Where a figure path comes from, for its source tag. */
function pathSource(status: SnapshotDataStatus, path: string, open?: CouncilAssessmentRun['openData']): string {
  if (path === 'market.sovereign10YBondYieldPct' && status.officialYield) return `official, ${describeOfficialYield(status.officialYield).when}`;
  if (path === 'market.cds5YSpreadBps' && status.ownCds) return `your ${status.ownCds.source} data, ${formatPeriod(status.ownCds.date)}`;
  if (path === 'market.hcBondSpreadBps' && open?.hcBondSpread) return `BCRP, J.P. Morgan EMBI Global, ${hcSpreadWhen(open.hcBondSpread.period)}; bond spread, not CDS`;
  const tag = open?.liveFields?.[path];
  if (path.startsWith('imf.')) {
    // The WEO year the figure is for, so a saved figure is read with its period ("IMF WEO, 2025").
    const year = open?.imfIndicators?.years?.[path];
    const base = tag || 'IMF WEO';
    return year && !base.includes(year) ? `${base}, ${year}` : base;
  }
  if (path.startsWith('wb.')) return tag || 'World Bank';
  if (path.startsWith('market.exchangeRate') || path.startsWith('market.fx')) {
    if (tag?.includes('kept from the')) return tag;
    const day = String(open?.fetchedAt || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? `FX spot, ${formatPeriod(day)}` : 'FX spot';
  }
  return tag || 'live feed';
}

/** Why a figure path is missing, and what would fill it. */
export function pathMissing(status: SnapshotDataStatus, path: string): MissingReason {
  if (path === 'market.sovereign10YBondYieldPct') return missingReason('yield', status.iso3);
  if (path === 'market.cds5YSpreadBps') return missingReason('cds', status.iso3);
  if (path === 'market.hcBondSpreadBps') return hcSpreadMissing(status.iso3);
  if (path === 'market.policyRatePct') return missingReason('policy', status.iso3);
  if (path.startsWith('imf.'))
    return status.isFeedLive('imf')
      ? { kind: 'unreachable', short: 'Not in IMF data', help: 'The IMF feed answered but has no figure for this country.' }
      : missingReason('debt', status.iso3);
  if (path.startsWith('wb.'))
    return status.isFeedLive('worldbank')
      ? { kind: 'unreachable', short: 'Not in World Bank data', help: 'The World Bank feed answered but has no recent figure for this country.' }
      : missingReason('reserves', status.iso3);
  if (path.startsWith('market.exchangeRate') || path.startsWith('market.fx'))
    return { kind: 'unreachable', short: 'FX feed did not answer', help: 'The free exchange-rate feed did not answer. Press Refresh now under Research > One country.' };
  if (path.startsWith('gdelt.')) return { kind: 'unreachable', short: 'GDELT did not answer', help: 'The free GDELT news feed did not answer. Press Refresh now under Research > One country.' };
  return { kind: 'setup', short: 'No source yet', help: 'No live or official source is connected for this figure yet.' };
}

export function missingRow(label: string, reason: MissingReason): BriefRow {
  return { label, value: 'Missing', source: reason.short, verified: false, missing: true, help: reason.help };
}

/** A figure from one path: shown only when a real source filled it. */
export function liveRow(status: SnapshotDataStatus, label: string, path: string, fmt: (v: number) => string, open?: CouncilAssessmentRun['openData']): BriefRow {
  const v = status.live(path);
  return v === undefined ? missingRow(label, pathMissing(status, path)) : { label, value: fmt(v), source: pathSource(status, path, open), verified: true };
}

const PATH_NAME: Record<string, string> = {
  'market.policyRatePct': 'a policy rate',
  'market.sovereign10YBondYieldPct': 'an official 10Y yield',
  'market.cds5YSpreadBps': 'your CDS',
  'market.hcBondSpreadBps': 'a USD bond spread',
  'imf.cpiInflationPct': 'live inflation',
  'imf.debtToGdpPct': 'live debt/GDP',
  'imf.realGdpGrowthPct': 'live growth',
  'imf.primaryFiscalBalancePct': 'a live primary balance',
  'imf.overallBalancePct': 'a live overall balance',
};

const usdBn = (v: number) => `${v < 0 ? '-' : ''}US$${Math.abs(v).toFixed(1)} bn`;

/**
 * Net interest paid, % of GDP: primary balance minus overall balance, both IMF Fiscal Monitor for
 * the same year (src/utils/imfFiscal.ts). Missing when either is missing or the years differ.
 */
export function netInterestRow(status: SnapshotDataStatus, open?: CouncilAssessmentRun['openData']): BriefRow {
  const years = open?.imfIndicators?.years || {};
  const yPrimary = years['imf.primaryFiscalBalancePct'];
  const yOverall = years['imf.overallBalancePct'];
  const row = modelRow(status, 'Net interest paid', ['imf.primaryFiscalBalancePct', 'imf.overallBalancePct'], () => '', `primary minus overall balance, IMF Fiscal Monitor${yOverall ? ` ${yOverall}` : ''}`);
  if (row.missing) return row;
  const v = netInterestPct(status.live('imf.primaryFiscalBalancePct'), status.live('imf.overallBalancePct'), yPrimary, yOverall);
  return v === undefined
    ? missingRow('Net interest paid', { kind: 'unreachable', short: 'Balances are for different years', help: `The IMF primary balance is for ${yPrimary} and the overall balance for ${yOverall}; net interest needs both for the same year.` })
    : { ...row, value: `${pct(v)} of GDP` };
}

/** A figure worked out here from other figures: shown only when every input is live. */
export function modelRow(status: SnapshotDataStatus, label: string, inputs: string[], value: () => string, how = 'model, from figures above'): BriefRow {
  const gap = inputs.find((p) => !status.isLive(p));
  return gap ? missingRow(label, { ...pathMissing(status, gap), short: `Needs ${PATH_NAME[gap] || 'live inputs'}` }) : { label, value: value(), source: how, verified: false };
}

/** A built-in figure with no connected source (debt maturity profile, rollover figures). */
export const noSourceRow = (label: string, help = 'No live or official source is connected for this figure yet.'): BriefRow =>
  missingRow(label, { kind: 'setup', short: 'No source yet', help });

/** Old-style tag by kind. Built-in and AI-estimated figures are never tagged as data. */
export function sourceTag(status: SnapshotDataStatus, kind: Kind): { source: string; verified: boolean } {
  switch (kind) {
    case 'imf':
      return status.isFeedLive('imf') ? { source: 'IMF WEO', verified: true } : { source: 'missing', verified: false };
    case 'worldbank':
      return status.isFeedLive('worldbank') ? { source: 'World Bank', verified: true } : { source: 'missing', verified: false };
    case 'market':
      return { source: 'missing', verified: false };
    case 'yield':
      return status.officialYield ? { source: `official, ${describeOfficialYield(status.officialYield).when}`, verified: true } : { source: 'missing', verified: false };
    case 'cds':
      return status.ownCds ? { source: `your ${status.ownCds.source} data, ${formatPeriod(status.ownCds.date)}`, verified: true } : { source: 'missing', verified: false };
    case 'model':
      return { source: 'model, from figures above', verified: false };
    case 'sample':
      return { source: 'missing', verified: false };
  }
}

export const when = (e: { date: string; daysUntil: number }) =>
  `${formatPeriod(e.date)}, ${e.daysUntil === 0 ? 'today' : e.daysUntil === 1 ? 'tomorrow' : `in ${e.daysUntil} days`}`;
export const pct = (v: number, d = 1) => `${v.toFixed(d)}%`;
export const pts = (v: number, d = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(d)} pts`;

/** Count the missing figures in a brief and say so up front. */
export function missingNote(groups: BriefGroup[], countryName: string): string | undefined {
  const rows = groups.flatMap((g) => g.rows);
  const missing = rows.filter((r) => r.missing).length;
  if (!missing) return undefined;
  return `${missing} of ${rows.length} figures for ${countryName} are missing because their source is not connected or did not answer. They read Missing; no built-in values are shown.`;
}

/* ------------------------------------------------------------------------------------------
 * Economist: growth, inflation and policy, fiscal path, external position.
 * ------------------------------------------------------------------------------------------ */

export function economistBrief(run: CouncilAssessmentRun, now: Date = new Date()): CountryBrief {
  const open = run.openData;
  const status = getSnapshotDataStatus(open);
  const L = status.live;
  const g = L('imf.realGdpGrowthPct');
  const cpi = L('imf.cpiInflationPct');
  const policy = L('market.policyRatePct');
  const debt = L('imf.debtToGdpPct');
  const debt27 = L('imf.debtToGdpForecast2027Pct');
  const pb = L('imf.primaryFiscalBalancePct');
  const ca = L('wb.currentAccountPctGdp');
  const res = L('wb.fxReservesMonthsImport');
  const realRate = policy !== undefined && cpi !== undefined ? policy - cpi : undefined;
  const debtChange = debt !== undefined && debt27 !== undefined ? debt27 - debt : undefined;
  const nextMeeting = nextOfficialEvent(run.iso3, 'MPC_DECISION', now);
  const nextCpi = nextOfficialEvent(run.iso3, 'CPI_RELEASE', now);

  // Each observation only from live figures; none is written from a missing one.
  const j: string[] = [];
  if (g !== undefined)
    j.push(`Growth is ${g >= 4 ? 'strong' : g >= 2 ? 'moderate' : g >= 0 ? 'weak' : 'negative'} at ${pct(g)} a year${cpi !== undefined ? `, with inflation at ${pct(cpi)}` : ''}.`);
  else if (cpi !== undefined) j.push(`Inflation is ${pct(cpi)}.`);
  if (realRate !== undefined)
    j.push(
      realRate > 2
        ? `Monetary policy is tight: the policy rate is ${pct(realRate)} above inflation.`
        : realRate >= 0
          ? `Monetary policy is mildly restrictive: the policy rate is ${pct(realRate)} above inflation.`
          : `Real interest rates are negative (${pct(realRate)}): policy is loose relative to inflation.`
    );
  if (debt !== undefined)
    j.push(
      `Government debt is ${pct(debt, 0)} of GDP${
        debtChange === undefined ? '' : ` and is forecast to ${Math.abs(debtChange) < 1 ? 'stay roughly flat' : debtChange > 0 ? `rise by ${debtChange.toFixed(0)} pts` : `fall by ${Math.abs(debtChange).toFixed(0)} pts`} by 2027`
      }.`
    );
  if (pb !== undefined) j.push(`The primary balance is ${pct(pb)} of GDP.`);
  const ext: string[] = [];
  if (ca !== undefined && ca < -4) ext.push(`a current account deficit of ${pct(Math.abs(ca))} of GDP`);
  if (res !== undefined && res < 3) ext.push('reserves below the usual three-month import floor');
  if (ca !== undefined || res !== undefined)
    j.push(ext.length ? `External weak points: ${ext.join(', ')}.` : `The external position looks comfortable on ${[res !== undefined ? 'reserves' : '', ca !== undefined ? 'the current account' : ''].filter(Boolean).join(' and ')}.`);

  const parts = [
    g !== undefined ? (g >= 2 ? 'growing' : 'slow growth') : '',
    cpi !== undefined ? `inflation ${pct(cpi)}` : '',
    debt !== undefined ? `debt ${debtChange === undefined ? '' : debtChange > 1 ? 'rising ' : debtChange < -1 ? 'falling ' : 'stable '}at ${pct(debt, 0)} of GDP` : '',
  ].filter(Boolean);
  const headline = parts.length ? `${run.countryName}: ${parts.join(', ')}.` : `${run.countryName}: no live economic figures yet.`;

  const groups: BriefGroup[] = [
    {
      title: 'Growth and inflation',
      rows: [
        liveRow(status, 'Real GDP growth', 'imf.realGdpGrowthPct', (v) => pct(v), open),
        liveRow(status, 'CPI inflation', 'imf.cpiInflationPct', (v) => pct(v), open),
        liveRow(status, 'Unemployment rate', 'imf.unemploymentPct', (v) => pct(v), open),
      ],
    },
    {
      title: 'Monetary policy',
      rows: [
        liveRow(status, 'Policy rate', 'market.policyRatePct', (v) => pct(v, 2), open),
        modelRow(status, 'Real policy rate', ['market.policyRatePct', 'imf.cpiInflationPct'], () => pct(realRate as number)),
        {
          label: 'Next rate decision',
          value: nextMeeting ? when(nextMeeting) : 'not on file',
          source: nextMeeting ? nextMeeting.sourceName : 'no official schedule loaded',
          verified: Boolean(nextMeeting),
        },
        ...(nextCpi ? [{ label: 'Next CPI release', value: when(nextCpi), source: nextCpi.sourceName, verified: true }] : []),
      ],
    },
    {
      title: 'Fiscal and debt',
      rows: [
        liveRow(status, 'Debt / GDP', 'imf.debtToGdpPct', (v) => pct(v), open),
        liveRow(status, 'Debt / GDP, 2027 forecast', 'imf.debtToGdpForecast2027Pct', (v) => pct(v), open),
        liveRow(status, 'Primary balance', 'imf.primaryFiscalBalancePct', (v) => `${pct(v)} of GDP`, open),
        liveRow(status, 'Overall balance', 'imf.overallBalancePct', (v) => `${pct(v)} of GDP`, open),
        netInterestRow(status, open),
        liveRow(status, 'Revenue', 'imf.revenuePct', (v) => `${pct(v)} of GDP`, open),
        liveRow(status, 'Expenditure', 'imf.expenditurePct', (v) => `${pct(v)} of GDP`, open),
        noSourceRow('Balance that keeps debt stable', 'Needs the average interest rate on government debt, which no connected source provides yet.'),
        liveRow(status, '10Y government yield', 'market.sovereign10YBondYieldPct', (v) => pct(v, 2), open),
      ],
    },
    {
      title: 'External position',
      rows: [
        liveRow(status, 'Current account', 'wb.currentAccountPctGdp', (v) => `${pct(v)} of GDP`, open),
        liveRow(status, 'Current account, US dollars', 'imf.currentAccountUsdBn', usdBn, open),
        liveRow(status, 'FX reserves', 'wb.fxReservesMonthsImport', (v) => `${v.toFixed(1)} months of imports`, open),
        liveRow(status, 'External debt', 'wb.externalDebtPctGni', (v) => `${pct(v, 0)} of GNI`, open),
      ],
    },
  ];
  return { headline, judgements: j, sampleWarning: missingNote(groups, run.countryName), groups };
}

/**
 * Every figure the country pages lean on, with its source or why it is missing. Used by the Overview
 * tab so the user can see at a glance what is live and what needs setting up.
 */
export function countryDataSources(run: CouncilAssessmentRun): BriefGroup[] {
  const open = run.openData;
  const status = getSnapshotDataStatus(open);
  const r = (label: string, path: string, fmt: (v: number) => string) => liveRow(status, label, path, fmt, open);
  const ds = open.debtSchedule;
  return [
    {
      title: 'IMF (free, no key)',
      rows: [
        r('Real GDP growth', 'imf.realGdpGrowthPct', (v) => pct(v)),
        r('CPI inflation', 'imf.cpiInflationPct', (v) => pct(v)),
        r('Debt / GDP', 'imf.debtToGdpPct', (v) => pct(v)),
        r('Debt / GDP, 2027 forecast', 'imf.debtToGdpForecast2027Pct', (v) => pct(v)),
        r('Primary balance', 'imf.primaryFiscalBalancePct', (v) => `${pct(v)} of GDP`),
        r('Overall balance (Fiscal Monitor)', 'imf.overallBalancePct', (v) => `${pct(v)} of GDP`),
        r('Revenue (Fiscal Monitor)', 'imf.revenuePct', (v) => `${pct(v)} of GDP`),
        r('Expenditure (Fiscal Monitor)', 'imf.expenditurePct', (v) => `${pct(v)} of GDP`),
        r('Unemployment rate', 'imf.unemploymentPct', (v) => pct(v)),
        r('Current account, US dollars', 'imf.currentAccountUsdBn', usdBn),
        r('Current account (IMF WEO)', 'imf.currentAccountImfPct', (v) => `${pct(v)} of GDP`),
      ],
    },
    {
      title: 'World Bank (free, no key)',
      rows: [
        r('FX reserves', 'wb.fxReservesMonthsImport', (v) => `${v.toFixed(1)} months of imports`),
        r('Current account', 'wb.currentAccountPctGdp', (v) => `${pct(v)} of GDP`),
        r('External debt', 'wb.externalDebtPctGni', (v) => `${pct(v, 0)} of GNI`),
        r('Political stability (WGI)', 'wb.politicalStabilityPercentile', (v) => `${v.toFixed(0)}th percentile`),
        ds?.qeds
          ? { label: 'External debt due, next 12 months (QEDS)', value: `$${ds.qeds.next12mUsdBn.toFixed(1)} bn`, source: 'QEDS (World Bank/IMF)', verified: true }
          : missingRow('External debt due, next 12 months (QEDS)', { kind: 'unreachable', short: 'QEDS did not answer', help: 'The free QEDS feed did not answer, or does not cover this country. Press Refresh now under Research > One country.' }),
      ],
    },
    {
      title: 'Markets',
      rows: [
        r('10Y government yield', 'market.sovereign10YBondYieldPct', (v) => pct(v, 2)),
        r(`${HC_SPREAD_LABEL} over Treasuries (not CDS)`, 'market.hcBondSpreadBps', (v) => `${Math.round(v)} bps`),
        r('Policy rate', 'market.policyRatePct', (v) => pct(v, 2)),
        r(`Spot FX (${open.currencyCode} per USD)`, 'market.exchangeRatePerUsd', (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(v >= 10 ? 2 : 4))),
        noSourceRow('Credit rating', 'Needs a ratings feed (licensed); AI estimates are not used.'),
      ],
    },
    {
      title: 'News',
      rows: [r('News tone (GDELT)', 'gdelt.averageTone', (v) => v.toFixed(1))],
    },
    ucdpGroup(open),
  ];
}

/** Conflict figures from the UCDP files in data/local/ucdp/, or Missing with the reason. */
function ucdpGroup(open: CouncilAssessmentRun['openData']): BriefGroup {
  const title = 'Conflict (UCDP downloaded files)';
  const u = open.ucdp;
  if (!u?.latest) {
    const why = ucdpMissing(null, open.iso3);
    return { title, rows: [missingRow('Armed conflict and conflict deaths (UCDP)', { kind: 'setup', short: why.short, help: why.help })] };
  }
  const { figures, missing } = ucdpFigures(u);
  return {
    title,
    rows: [
      ...figures.map((f) => ({ label: f.label, value: f.value, source: f.tag === 'model' ? f.source : `${f.source} (CC BY 4.0, cite UCDP)`, verified: f.tag !== 'model' })),
      ...missing.map((m) => missingRow(m.split(' not added')[0], { kind: 'setup', short: 'file not added', help: m })),
    ],
  };
}

/* ------------------------------------------------------------------------------------------
 * Report sections.
 * ------------------------------------------------------------------------------------------ */

const clean = (t: string) => t.replace(/\s*\(Ref:[^)]*\)/g, '').trim();

export function groupLines(g: BriefGroup): string[] {
  return g.rows.map((r) => `- ${r.label}: ${r.value} (${r.source})`);
}

export function sourcesSection(run: CouncilAssessmentRun, purpose: string): NoteSection {
  const status = getSnapshotDataStatus(run.openData);
  return {
    id: 'sources',
    heading: 'Data and sources',
    lines: [
      `Data status: ${DATA_MODE_LABEL[status.mode]}${status.asOf ? `, as of ${formatAsOf(status.asOf)}` : ''}. Each figure above names its source. "Missing" means no live or official source filled it, and no built-in value is used instead; "model" means calculated here from live figures.`,
      status.liveFeeds.length ? `Feeds that answered: ${status.liveFeeds.join('; ')}.` : 'No live feeds answered on the last sync.',
      purpose,
    ],
  };
}

export function calendarSection(run: CouncilAssessmentRun, heading: string, now: Date): NoteSection {
  const events = upcomingOfficialEvents([run.iso3], 90, now);
  return {
    id: 'calendar',
    heading,
    lines: events.length
      ? events.map((e) => `- ${e.date}: ${e.title} (source: ${e.sourceName})`)
      : [`No official dates on file for ${run.countryName} in the next 90 days.`],
  };
}

/** Section ids and headings for the economist's country note, in order. */
export const ECONOMIST_SECTIONS: Record<string, string> = {
  summary: 'Summary',
  growth: 'Growth and inflation',
  policy: 'Monetary policy',
  fiscal: 'Fiscal and debt',
  external: 'External position',
  risks: 'Risks to the outlook',
  calendar: 'Coming up',
  sources: 'Data and sources',
};

export function buildEconomistSections(run: CouncilAssessmentRun, include: (id: string) => boolean, now: Date = new Date()): NoteSection[] {
  const b = economistBrief(run, now);
  const byTitle = (t: string) => b.groups.find((g) => g.title === t)!;
  const out: NoteSection[] = [];
  if (include('summary')) {
    out.push({ id: 'summary', heading: ECONOMIST_SECTIONS.summary, lines: [b.headline, ...(b.sampleWarning ? [`**Note:** ${b.sampleWarning}`] : []), ...b.judgements.map((x) => `- ${x}`)] });
  }
  const groups: Array<[string, string]> = [
    ['growth', 'Growth and inflation'],
    ['policy', 'Monetary policy'],
    ['fiscal', 'Fiscal and debt'],
    ['external', 'External position'],
  ];
  for (const [id, title] of groups) if (include(id)) out.push({ id, heading: ECONOMIST_SECTIONS[id], lines: groupLines(byTitle(title)) });
  if (include('risks')) {
    const vul = run.supremeCouncil?.policyResearcherReport.structuralVulnerabilities || [];
    out.push({
      id: 'risks',
      heading: ECONOMIST_SECTIONS.risks,
      lines: vul.length ? vul.slice(0, 5).map((v) => `- ${clean(v)}`) : ['Write the main risks to the outlook here. Running the council adds a draft list.'],
    });
  }
  if (include('calendar')) out.push(calendarSection(run, ECONOMIST_SECTIONS.calendar, now));
  if (include('sources')) out.push(sourcesSection(run, 'Analysis for discussion. Not a forecast endorsed by any official body.'));
  return out;
}
