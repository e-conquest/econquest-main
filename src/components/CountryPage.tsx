import { HC_SPREAD_LABEL, HC_SPREAD_LONG, HC_SPREAD_NOT_CDS, HC_SPREAD_SOURCE, hcSpreadWhen } from '../utils/hardCurrencySpread';
import React, { useEffect, useMemo, useState } from 'react';
import { noteExamOpened } from '../utils/examMode';
import { openDataLicences } from './AboutDialog';
import { Plus, RefreshCw } from 'lucide-react';
import type { CouncilAssessmentRun, WatchlistItem } from '../types/council';
import { DataStatusBadge } from './DataStatusBadge';
import { useOnlineStatus } from './OfflineData';
import { hasOfficialSchedule, upcomingOfficialEvents } from '../data/officialCalendar';
import { describeOfficialYield, formatPeriod } from '../utils/officialYields';
import { getSnapshotDataStatus } from '../utils/dataStatus';
import { countryDataSources, pathMissing } from '../utils/countryNotes';
import { creditsForSources } from '../data/requiredCredits';
import { SourceCredits } from './SourceCredits';
import { describeAge, freshnessChecks } from '../utils/freshness';
import { toLive } from '../utils/liveFigures';
import { BriefGroups, CountryBriefPanel, type BriefView } from './CountryBriefPanel';
import { MarketsMacroPanel } from './MarketsMacroPanel';
import { AsOfPanel } from './AsOfPanel';
import { DecisionReplayPanel } from './DecisionReplayPanel';
import { TrackRecordPanel } from './TrackRecordPanel';
import { GdeltEventsPanel } from './GdeltEventsPanel';
import { GdeltHistoryPanel } from './GdeltHistoryPanel';
import { PanelBoundary } from './PanelBoundary';
import { ResearchSectionNav } from './ResearchSections';
import { lazyNamed, DeskLoading } from './LazyDesk';
// Charts (recharts) load only when History opens, keeping them out of the first download.
const HistoryPanel = lazyNamed(() => import('./HistoryPanel'), 'HistoryPanel');
const OutputGapPanel = lazyNamed(() => import('./OutputGapPanel'), 'OutputGapPanel');
const DebtSustainabilityPanel = lazyNamed(() => import('./DebtSustainabilityPanel'), 'DebtSustainabilityPanel');
const WeoVintagesPanel = lazyNamed(() => import('./WeoVintagesPanel'), 'WeoVintagesPanel');
const UsVintagesPanel = lazyNamed(() => import('./UsVintagesPanel'), 'UsVintagesPanel');
const BohnPanel = lazyNamed(() => import('./BohnPanel'), 'BohnPanel');
const GfnPanel = lazyNamed(() => import('./GfnPanel'), 'GfnPanel');
const RuleFamilyPanel = lazyNamed(() => import('./RuleFamilyPanel'), 'RuleFamilyPanel');
const ScenarioPanel = lazyNamed(() => import('./ScenarioPanel'), 'ScenarioPanel');
const EventStudyPanel = lazyNamed(() => import('./EventStudyPanel'), 'EventStudyPanel');
const BeerPanel = lazyNamed(() => import('./BeerPanel'), 'BeerPanel');
const LocalProjectionsPanel = lazyNamed(() => import('./LocalProjectionsPanel'), 'LocalProjectionsPanel');
const ReserveAdequacyPanel = lazyNamed(() => import('./ReserveAdequacyPanel'), 'ReserveAdequacyPanel');
const RiskScorecardPanel = lazyNamed(() => import('./RiskScorecardPanel'), 'RiskScorecardPanel');
const UnitConverterPanel = lazyNamed(() => import('./UnitConverterPanel'), 'UnitConverterPanel');
const ExercisesPanel = lazyNamed(() => import('./ExercisesPanel'), 'ExercisesPanel');
const ModelSandboxPanel = lazyNamed(() => import('./ModelSandboxPanel'), 'ModelSandboxPanel');
const SanctionsPanel = lazyNamed(() => import('./SanctionsPanel'), 'SanctionsPanel');
const ForecastPanel = lazyNamed(() => import('./ForecastPanel'), 'ForecastPanel');
const FiscalMultiplierPanel = lazyNamed(() => import('./FiscalMultiplierPanel'), 'FiscalMultiplierPanel');

/**
 * Country page: everything about one sovereign, in the four sections Research shares with
 * Compare and My holdings. The old specialist desk tabs ran on built-in figures and were removed.
 */

export type CountryTabId = 'brief' | 'macro' | 'overview' | 'history';

export interface CountryTabConfig {
  id: CountryTabId;
  label: string;
}

// The first four use Research's shared section names (utils/researchSections.ts); ids stay so old links land.
export const COUNTRY_TABS: CountryTabConfig[] = [
  // Role start view (economist, banker): figures with sources and a link to the report template.
  { id: 'brief', label: 'Summary' },
  // MarketEdge: the economy, market pricing and model readings of where they disagree.
  { id: 'macro', label: 'Markets & signals' },
  // History: each figure's run of real observations as a chart (src/components/HistoryPanel.tsx).
  { id: 'history', label: 'History & data' },
  // Sources (id 'overview'): what is live for this country.
  { id: 'overview', label: 'Sources' },
];

/** Where the Country page opens when no role or desk says otherwise. */
export const DEFAULT_COUNTRY_TAB: CountryTabConfig = COUNTRY_TABS.find((t) => t.id === 'overview')!;

const Figure: React.FC<{ label: string; value: string; title?: string; missing?: string; onHistory?: () => void }> = ({ label, value, title, missing, onHistory }) => (
  <div
    className={`min-w-0 ${onHistory ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50' : ''}`}
    title={onHistory ? `${title ? `${title} ` : ''}Click for its history.` : title}
    data-missing={missing ? 'true' : undefined}
    role={onHistory ? 'button' : undefined}
    tabIndex={onHistory ? 0 : undefined}
    onClick={onHistory}
    onKeyDown={onHistory ? (e) => (e.key === 'Enter' || e.key === ' ') && onHistory() : undefined}
  >
    <div className="text-xs text-slate-500 dark:text-slate-400 sm:whitespace-nowrap">{label}</div>
    <div className={`text-sm whitespace-nowrap [font-variant-numeric:tabular-nums] ${missing ? 'text-slate-400 dark:text-slate-500' : 'font-semibold text-slate-900 dark:text-white'}`}>
      {value}
    </div>
    {missing && <div className="text-xs text-amber-700 dark:text-amber-400 sm:whitespace-nowrap">{missing}</div>}
  </div>
);

/** The header's key figures, each shown only from a real source. */
const HEADER_FIGURES: Array<{ path: string; label: string; fmt: (v: number) => string; series: string }> = [
  { path: 'imf.debtToGdpPct', label: 'Debt / GDP', fmt: (v) => `${v.toFixed(1)}%`, series: 'debt_gdp' },
  // The free stand-in for CDS (hidden for now): a bond spread, labelled as one.
  { path: 'market.hcBondSpreadBps', label: HC_SPREAD_LABEL, fmt: (v) => `${Math.round(v)} bps`, series: 'hc_spread' },
  { path: 'market.sovereign10YBondYieldPct', label: '10Y yield', fmt: (v) => `${v.toFixed(2)}%`, series: 'yield_10y' },
  { path: 'market.policyRatePct', label: 'Policy rate', fmt: (v) => `${v.toFixed(2)}%`, series: 'policy_rate' },
  { path: 'wb.fxReservesMonthsImport', label: 'Reserves', fmt: (v) => `${v.toFixed(1)} mo`, series: 'reserves_months' },
];

export const CountryPage: React.FC<{
  run: CouncilAssessmentRun;
  watchlistItems: WatchlistItem[];
  activeTab: CountryTabId;
  onChangeTab: (tab: CountryTabId) => void;
  onSelectCountry: (item: WatchlistItem) => void;
  onAddCountry: () => void;
  onSync: () => void;
  isSyncing: boolean;
  /** Opens the Compare page (the watchlist side by side). */
  onOpenCompare?: () => void;
  briefView: BriefView;
  onWriteNote: (view: BriefView) => void;
}> = ({
  run,
  watchlistItems,
  activeTab,
  onChangeTab,
  onSelectCountry,
  onAddCountry,
  onSync,
  isSyncing,
  onOpenCompare,
  briefView,
  onWriteNote,
}) => {
  const net = useOnlineStatus();
  const offline = !!net && !net.online;
  // Exam mode: what was opened goes to the audit log for the teacher.
  useEffect(() => noteExamOpened('country', `${run.countryName}, ${activeTab}`), [run.countryName, activeTab]);
  const item = watchlistItems.find((w) => w.iso3 === run.iso3);
  const tabs = COUNTRY_TABS;
  const tab = tabs.find((t) => t.id === activeTab) || DEFAULT_COUNTRY_TAB;
  const open = run.openData;
  const status = useMemo(() => getSnapshotDataStatus(open), [open]);
  const events = useMemo(() => upcomingOfficialEvents([run.iso3], 120), [run.iso3]);
  // Which series History opens on, when a header figure was clicked.
  const [historyPick, setHistoryPick] = useState<string | null>(null);
  const showHistory = tabs.some((t) => t.id === 'history');

  return (
    <div className="space-y-3" data-country-page="true">
      {/* Country header: one row with selector, key figures, data status and actions */}
      <div className="ui-panel px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <label htmlFor="country-select" className="sr-only">
              Country
            </label>
            <select
              id="country-select"
              value={run.iso3}
              onChange={(e) => {
                if (e.target.value === '__add') {
                  onAddCountry();
                  return;
                }
                const next = watchlistItems.find((w) => w.iso3 === e.target.value);
                if (next) onSelectCountry(next);
              }}
              className="text-lg font-semibold text-slate-900 dark:text-white bg-transparent border border-slate-200 dark:border-slate-700 px-2 py-1 pr-7"
            >
              {!item && <option value={run.iso3}>{run.countryName}</option>}
              {watchlistItems.map((w) => (
                <option key={w.iso3} value={w.iso3}>
                  {w.countryName}
                </option>
              ))}
              <option value="__add">+ Add a country…</option>
            </select>
            {/* On a phone, Refresh sits beside the country as an icon. */}
            <button
              type="button"
              onClick={onSync}
              disabled={isSyncing}
              className="ui-btn inline-flex sm:hidden ml-auto"
              aria-label={isSyncing ? 'Refreshing' : 'Refresh now'}
              title="Pull every data feed for this country again now"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Two columns on a phone so the five figures take three short rows, one row on a wide screen. */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 w-full sm:w-auto sm:flex sm:flex-wrap sm:items-center sm:gap-x-5">
            {HEADER_FIGURES.map((f) => {
              const v = status.live(f.path);
              const why = v === undefined ? pathMissing(status, f.path) : undefined;
              return (
                <Figure
                  key={f.path}
                  label={f.path === 'market.hcBondSpreadBps' && open.hcBondSpread ? `${HC_SPREAD_LABEL}, ${hcSpreadWhen(open.hcBondSpread.period)}` : f.path === 'market.cds5YSpreadBps' && status.ownCds ? `5Y CDS, ${formatPeriod(status.ownCds.date)}` : f.path === 'market.sovereign10YBondYieldPct' && status.officialYield ? `10Y yield, ${describeOfficialYield(status.officialYield).when}` : f.label}
                  value={v === undefined ? 'Missing' : f.fmt(v)}
                  missing={why?.short}
                  title={why ? why.help : f.path === 'market.hcBondSpreadBps' && open.hcBondSpread ? `${HC_SPREAD_LONG}, ${hcSpreadWhen(open.hcBondSpread.period)}, ${HC_SPREAD_SOURCE}. ${HC_SPREAD_NOT_CDS}` : f.path === 'market.sovereign10YBondYieldPct' && status.officialYield ? `Official figure: ${describeOfficialYield(status.officialYield).long}.` : f.path === 'market.cds5YSpreadBps' && status.ownCds ? `Your own ${status.ownCds.source} quote.` : undefined}
                  onHistory={
                    showHistory
                      ? () => {
                          setHistoryPick(f.series);
                          onChangeTab('history');
                        }
                      : undefined
                  }
                />
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
            <DataStatusBadge snapshot={open} />
            <button
              type="button"
              onClick={onSync}
              disabled={isSyncing}
              className="ui-btn hidden sm:inline-flex"
              title="Pull every data feed for this country again now (normally once a week, or within the hour after a failed pull)"
            >
              <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Refreshing…' : 'Refresh now'}
            </button>
          </div>
        </div>

        {/* Sections: the same four as Compare and My holdings */}
        <ResearchSectionNav
          ariaLabel="Country sections"
          active={tab.id}
          onChange={(id) => onChangeTab(id as CountryTabId)}
          sections={tabs}
        />
      </div>

      {tab.id === 'overview' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3" data-no-stat-ref="true">
          <div className="xl:col-span-2 space-y-2" data-no-provenance-overlay="true">
            <section className="ui-panel">
              <header className="ui-panel-header">
                <h2 className="ui-section-title">{offline ? `What is saved for ${run.countryName}` : `What is live for ${run.countryName}`}</h2>
                <p className="ui-label">
                  Every figure the country pages use, with its source, or why it is missing and what would fill it. No built-in values are shown.
                  {offline && ' The feeds cannot be reached from this computer, so these are the figures from the last pull, each with its own date.'}
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <a className="ui-btn inline-flex" href={`/api/export/${encodeURIComponent(run.iso3)}/figures.csv`} download>
                    Download these figures (CSV)
                  </a>
                  <a className="ui-btn inline-flex" href={`/api/export/${encodeURIComponent(run.iso3)}/figures.xlsx`} download>
                    Excel
                  </a>
                  <button type="button" className="ui-btn ui-btn-ghost inline-flex" onClick={() => openDataLicences()} data-open-licences>
                    Data licences
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Before sharing these figures, check each source&apos;s terms: some need a credit, a few need the provider&apos;s permission for client or commercial use.</p>
                <SourceCredits credits={creditsForSources(run.openData?.liveApiSourcesActive ?? [])} className="mt-1" />
              </header>
            </section>
            <FreshnessPanel item={watchlistItems.find((w) => w.iso3 === run.iso3)} />
            <BriefGroups brief={{ headline: '', judgements: [], groups: countryDataSources(run) }} />
          </div>
          <section className="ui-panel">
            <header className="ui-panel-header">
              <h2 className="ui-section-title">Coming up</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Official schedule, next 120 days</p>
            </header>
            <div className="p-4">
              {events.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {hasOfficialSchedule(run.iso3)
                    ? 'Nothing scheduled in the next 120 days.'
                    : `No official schedule on file for ${run.countryName}.`}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {events.slice(0, 6).map((ev) => (
                    <li key={`${ev.date}-${ev.title}`} className="py-2 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm text-slate-900 dark:text-white">
                          {ev.title}
                          {ev.dateKind === 'legal_deadline' && <span className="text-xs text-slate-500 dark:text-slate-400"> · latest date in law</span>}
                        </div>
                        <a
                          href={ev.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-slate-500 dark:text-slate-400 hover:underline"
                        >
                          {ev.sourceName}
                        </a>
                      </div>
                      <div className="text-right text-xs shrink-0">
                        <div className="font-medium text-slate-900 dark:text-white">
                          {new Date(`${ev.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                        </div>
                        <div className="text-slate-500 dark:text-slate-400">
                          {ev.daysUntil === 0 ? 'today' : `in ${ev.daysUntil}d`}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={onAddCountry}
                className="mt-3 inline-flex items-center gap-1 text-xs text-blue-700 dark:text-blue-300 hover:underline"
              >
                <Plus className="w-3 h-3" /> Add another country
              </button>
            </div>
          </section>
        </div>
      )}

      {tab.id === 'history' && (
        <div className="space-y-3">
          <div id="tool-history" className="scroll-mt-4" />
          <React.Suspense fallback={<DeskLoading />}>
            <HistoryPanel key={run.iso3} iso3={run.iso3} countryName={run.countryName} pick={historyPick} />
          </React.Suspense>
          <PanelBoundary name="Event history">
            <GdeltHistoryPanel key={`gdelt-daily-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} />
          </PanelBoundary>
          <div id="tool-risk-scorecard" className="scroll-mt-4" />
          <PanelBoundary name="Country risk scorecard">
            <React.Suspense fallback={<DeskLoading />}>
              <RiskScorecardPanel key={`risk-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} />
            </React.Suspense>
          </PanelBoundary>
          <div id="tool-sanctions" className="scroll-mt-4" />
          <PanelBoundary name="Sanctions lists">
            <React.Suspense fallback={<DeskLoading />}>
              <SanctionsPanel key={`sanctions-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} />
            </React.Suspense>
          </PanelBoundary>
          <div id="tool-unit-converters" className="scroll-mt-4" />
          <PanelBoundary name="Unit converters">
            <React.Suspense fallback={<DeskLoading />}>
              <UnitConverterPanel key={`conv-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} />
            </React.Suspense>
          </PanelBoundary>
          <div id="tool-exercises" className="scroll-mt-4" />
          <PanelBoundary name="Exercises">
            <React.Suspense fallback={<DeskLoading />}>
              <ExercisesPanel key={`ex-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} />
            </React.Suspense>
          </PanelBoundary>
          <div id="tool-sandboxes" className="scroll-mt-4" />
          <PanelBoundary name="Model sandboxes">
            <React.Suspense fallback={<DeskLoading />}>
              <ModelSandboxPanel key={`sb-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} />
            </React.Suspense>
          </PanelBoundary>
          <div id="tool-forecast" className="scroll-mt-4" />
          <PanelBoundary name="Nowcast and forecasts">
            <React.Suspense fallback={<DeskLoading />}>
              <ForecastPanel key={`fc-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} />
            </React.Suspense>
          </PanelBoundary>
          <div id="tool-output-gap" className="scroll-mt-4" />
          <PanelBoundary name="Output gap">
            <React.Suspense fallback={<DeskLoading />}>
              <OutputGapPanel key={`gap-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} />
            </React.Suspense>
          </PanelBoundary>
          <div id="tool-debt-sustainability" className="scroll-mt-4" />
          <PanelBoundary name="Debt sustainability">
            <React.Suspense fallback={<DeskLoading />}>
              <DebtSustainabilityPanel key={`dsa-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} />
            </React.Suspense>
          </PanelBoundary>
          <div id="tool-gross-financing-need" className="scroll-mt-4" />
          <PanelBoundary name="Gross financing need">
            <React.Suspense fallback={<DeskLoading />}>
              <GfnPanel key={`gfn-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} />
            </React.Suspense>
          </PanelBoundary>
          <div id="tool-reserve-adequacy" className="scroll-mt-4" />
          <PanelBoundary name="Reserve adequacy">
            <React.Suspense fallback={<DeskLoading />}>
              <ReserveAdequacyPanel key={`ara-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} />
            </React.Suspense>
          </PanelBoundary>
          <div id="tool-fiscal-reaction" className="scroll-mt-4" />
          <PanelBoundary name="Fiscal reaction">
            <React.Suspense fallback={<DeskLoading />}>
              <BohnPanel key={`bohn-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} />
            </React.Suspense>
          </PanelBoundary>
          <div id="tool-global-scenarios" className="scroll-mt-4" />
          <PanelBoundary name="Global shock scenarios">
            <React.Suspense fallback={<DeskLoading />}>
              <ScenarioPanel key={`scenario-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} />
            </React.Suspense>
          </PanelBoundary>
          <div id="tool-event-study" className="scroll-mt-4" />
          <PanelBoundary name="Currency around rate decisions">
            <React.Suspense fallback={<DeskLoading />}>
              <EventStudyPanel key={`event-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} />
            </React.Suspense>
          </PanelBoundary>
          <div id="tool-beer" className="scroll-mt-4" />
          <PanelBoundary name="BEER fair value">
            <React.Suspense fallback={<DeskLoading />}>
              <BeerPanel key={`beer-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} />
            </React.Suspense>
          </PanelBoundary>
          <div id="tool-rule-family" className="scroll-mt-4" />
          <PanelBoundary name="Policy rules">
            <React.Suspense fallback={<DeskLoading />}>
              <RuleFamilyPanel key={`rules-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} />
            </React.Suspense>
          </PanelBoundary>
          <div id="tool-local-projections" className="scroll-mt-4" />
          <PanelBoundary name="Inflation after rate changes">
            <React.Suspense fallback={<DeskLoading />}>
              <LocalProjectionsPanel key={`lp-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} />
            </React.Suspense>
          </PanelBoundary>
          <div id="tool-fiscal-multipliers" className="scroll-mt-4" />
          <PanelBoundary name="Fiscal multipliers">
            <React.Suspense fallback={<DeskLoading />}>
              <FiscalMultiplierPanel key={`mult-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} item={item} />
            </React.Suspense>
          </PanelBoundary>
          <div id="tool-weo-vintages" className="scroll-mt-4" />
          <PanelBoundary name="IMF forecasts by edition">
            <React.Suspense fallback={<DeskLoading />}>
              <WeoVintagesPanel key={`weo-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} />
            </React.Suspense>
          </PanelBoundary>
          {run.iso3 === 'USA' && (
            <>
              <div id="tool-us-vintages" className="scroll-mt-4" />
              <PanelBoundary name="US data as first published">
                <React.Suspense fallback={<DeskLoading />}>
                  <UsVintagesPanel />
                </React.Suspense>
              </PanelBoundary>
            </>
          )}
          <div id="tool-as-of" className="scroll-mt-4" />
          <PanelBoundary name="As of a past day">
            <AsOfPanel key={`asof-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} />
          </PanelBoundary>
          <div id="tool-decision-replay" className="scroll-mt-4" />
          <PanelBoundary name="Replicate a rate decision">
            <DecisionReplayPanel key={`replay-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} />
          </PanelBoundary>
          <div id="tool-track-record" className="scroll-mt-4" />
          <PanelBoundary name="Track record">
            <TrackRecordPanel key={`track-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} />
          </PanelBoundary>
        </div>
      )}
      {tab.id === 'macro' && (
        <MarketsMacroPanel
          run={run}
          peers={watchlistItems}
          onOpenCountry={onSelectCountry}
          onOpenCompare={onOpenCompare}
          afterSummary={
            <PanelBoundary name="News and events">
              <GdeltEventsPanel key={`gdelt-${run.iso3}`} iso3={run.iso3} countryName={run.countryName} />
            </PanelBoundary>
          }
        />
      )}
      {tab.id === 'brief' && <CountryBriefPanel key={briefView} run={run} peers={watchlistItems} view={briefView} onWriteNote={onWriteNote} />}
    </div>
  );
};

/**
 * Sources tab: dated figures older than their source usually runs, with why and what would give a
 * fresher one (src/utils/freshness.ts). Says so in one line when everything is within its usual age.
 */
const FreshnessPanel: React.FC<{ item?: WatchlistItem }> = ({ item }) => {
  const checks = item ? freshnessChecks(item) : [];
  if (!checks.length) return null;
  const stale = checks.filter((c) => c.stale);
  return (
    <section className="ui-panel" data-freshness="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title">{stale.length ? `Older than usual (${stale.length} of ${checks.length} dated figures)` : 'Freshness'}</h2>
        <p className="ui-label">
          {stale.length
            ? 'These figures are older than their source normally runs (how often it comes out plus its usual delay). Read them with their date.'
            : `All ${checks.length} dated figures are within their usual age.`}
        </p>
      </header>
      {stale.length > 0 && (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {stale.map((c) => (
            <li key={c.id} className="px-4 py-2 text-sm" data-stale-figure={c.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-slate-800 dark:text-slate-100">{c.label}</span>
                <span className="text-xs tabular-nums text-amber-700 dark:text-amber-400">
                  {c.period}: {describeAge(c)}
                </span>
              </div>
              {c.why && <p className="text-xs text-slate-600 dark:text-slate-400">{c.why}</p>}
              {c.fresher && <p className="text-xs text-slate-600 dark:text-slate-400">Fresher source: {c.fresher}.</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
