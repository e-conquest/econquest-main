import React, { useMemo, useState } from 'react';
import { toDisplayCase } from '../utils/displayCase';
import { CouncilAssessmentRun, WatchlistItem } from '../types/council';
import {
  buildMultiSovereignHeadToHeadComparison,
  computeSovereignNssYieldCurveSuite,
  computeMacroCatalystEventVolatilitySuite,
  DEFAULT_NSS_SHOCK_INPUTS,
  StagedTradeTicketSpec,
  StagedTradeDirection,
} from '../utils/nssYieldCurveAndCatalystEngine';
import {
  X,
  Columns,
  Briefcase,
  CheckCircle2,
  Plus,
  Trash2,
  Download,
  FileText,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import { coherenceText, compositeText } from '../utils/councilResult';

// ============================================================================
// 1. MULTI-SOVEREIGN HEAD-TO-HEAD COMPARATOR DRAWER (2–3 COUNTRIES SIDE-BY-SIDE)
// ============================================================================

interface MultiSovereignComparatorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeRun: CouncilAssessmentRun;
  watchlistItems: WatchlistItem[];
  onSelectSovereign: (item: WatchlistItem) => void;
  onStageTradeTicket: (ticket: StagedTradeTicketSpec) => void;
}

export const MultiSovereignComparatorDrawer: React.FC<
  MultiSovereignComparatorDrawerProps
> = ({
  isOpen,
  onClose,
  activeRun,
  watchlistItems,
  onSelectSovereign,
  onStageTradeTicket,
}) => {
  const [selectedIsos, setSelectedIsos] = useState<string[]>(() => {
    const first = activeRun.iso3;
    const second: string = first === 'BRA' ? 'MEX' : 'BRA';
    const third: string = first === 'TUR' || second === 'TUR' ? 'ZAF' : 'TUR';
    return [first, second, third];
  });

  const handleToggleIso = (iso3: string) => {
    setSelectedIsos((prev) => {
      if (prev.includes(iso3)) {
        if (prev.length <= 2) return prev; // Keep at least 2 countries
        return prev.filter((x) => x !== iso3);
      }
      if (prev.length >= 3) {
        return [prev[0], prev[1], iso3];
      }
      return [...prev, iso3];
    });
  };

  const comparisonSuite = useMemo(
    () => buildMultiSovereignHeadToHeadComparison(selectedIsos, activeRun),
    [selectedIsos, activeRun]
  );

  if (!isOpen) return null;

  const handleExportComparisonCsv = () => {
    const isoHeaders = comparisonSuite.comparedRuns.map(
      (r) => `${r.iso3}_${r.countryName.replace(/\s+/g, '_')}`
    );
    const headers = ['Pillar', 'Metric', 'Unit', ...isoHeaders, 'Relative_Winner'];
    const rows = comparisonSuite.metricRows.map((row) => {
      const winnerIso =
        comparisonSuite.comparedRuns.find(
          (r) => row.valuesByIso[r.iso3]?.isRelativeWinner
        )?.iso3 || '';
      return [
        `"${row.pillarCategory}"`,
        `"${row.metricLabel}"`,
        `"${row.unitLabel}"`,
        ...comparisonSuite.comparedRuns.map(
          (r) => `"${row.valuesByIso[r.iso3]?.formattedDisplay || ''}"`
        ),
        winnerIso,
      ];
    });
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute(
      'download',
      `EconQuest_HeadToHead_${selectedIsos.join('_vs_')}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-5xl bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 h-full flex flex-col shadow-2xl">
        {/* Top Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 bg-slate-50 dark:bg-slate-900">
          <div>
            <div className="flex items-center gap-2 text-xs tabular-nums text-blue-600 dark:text-blue-400 font-semibold">
              <Columns className="w-4 h-4" />
              <span>Multi-sovereign head-to-head relative-value comparator (2–3 countries)</span>
            </div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white mt-0.5">
              Side-by-Side DSA Solvency, NSS Term Structure Carry+Roll & Credit Buffer Scorecard
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportComparisonCsv}
              className="ui-btn inline-flex"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Country Selector Bar (Pick 2 or 3 Sovereigns) */}
        <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400 mr-1">
              Select 2–3 Sovereigns:
            </span>
            {watchlistItems.map((item) => {
              const isSelected = selectedIsos.includes(item.iso3);
              return (
                <button
                  key={item.iso3}
                  type="button"
                  onClick={() => handleToggleIso(item.iso3)}
                  aria-pressed={isSelected}
                  className="ui-pill"
                >
                  {item.iso3} · {item.countryName}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 text-xs tabular-nums">
            <button
              type="button"
              onClick={() => setSelectedIsos(['BRA', 'MEX', 'TUR'])}
              className="px-2 py-1 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-blue-400"
            >
              Preset: BRA vs MEX vs TUR
            </button>
            <button
              type="button"
              onClick={() => setSelectedIsos(['ZAF', 'EGY', 'ARG'])}
              className="px-2 py-1 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-blue-400"
            >
              Preset: High-Beta EM
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Automated Pair Trade Verdict Banner */}
          <div className="p-4 border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/50 dark:bg-emerald-950/30 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
                Head-to-head relative value verdict · winner:{' '}
                {comparisonSuite.overallRelativeValueWinnerIso} (
                {comparisonSuite.winCountByIso[comparisonSuite.overallRelativeValueWinnerIso]}{' '}
                benchmark wins)
              </div>
              <p className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                {comparisonSuite.pairTradeVerdictSummary}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  onStageTradeTicket(comparisonSuite.recommendedPairTicket);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs tabular-nums font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>
                  Stage {comparisonSuite.overallRelativeValueWinnerIso} vs{' '}
                  {comparisonSuite.overallUnderweightLagIso} Pair Ticket
                </span>
              </button>
            </div>
          </div>

          {/* Head-to-Head Scorecard Table */}
          <div className="border border-slate-200 dark:border-slate-800 overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                  <th className="py-2.5 px-3 text-left font-sans font-semibold">
                    Institutional benchmark metric
                  </th>
                  <th className="py-2.5 px-3 text-left font-sans font-semibold text-slate-500">
                    Unit / polarity
                  </th>
                  {comparisonSuite.comparedRuns.map((r) => (
                    <th key={r.iso3} className="py-2.5 px-3 text-right">
                      <div className="flex flex-col items-end">
                        <button
                          type="button"
                          onClick={() => {
                            const found = watchlistItems.find((w) => w.iso3 === r.iso3);
                            if (found) onSelectSovereign(found);
                          }}
                          className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {r.countryName} ({r.iso3})
                        </button>
                        <span className="text-xs text-slate-500">
                          {r.supremeCouncil?.marketTranslationLayer.regimeStance || 'Hold & Monitor'} ·{' '}
                          {comparisonSuite.winCountByIso[r.iso3]} Wins
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {comparisonSuite.metricRows.map((row, idx) => {
                  const prevPillar =
                    idx > 0 ? comparisonSuite.metricRows[idx - 1].pillarCategory : null;
                  const showPillarHeader = row.pillarCategory !== prevPillar;
                  return (
                    <React.Fragment key={row.metricId}>
                      {showPillarHeader && (
                        <tr className="bg-slate-50 dark:bg-slate-900/70">
                          <td
                            colSpan={2 + comparisonSuite.comparedRuns.length}
                            className="py-1.5 px-3 text-xs tabular-nums font-semibold text-slate-700 dark:text-slate-300"
                          >
                            {row.pillarCategory}
                          </td>
                        </tr>
                      )}
                      <tr className="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                        <td className="py-2 px-3 font-sans font-medium text-slate-900 dark:text-slate-100">
                          {row.metricLabel}
                        </td>
                        <td className="py-2 px-3 text-xs text-slate-500 dark:text-slate-400">
                          {row.unitLabel} ({row.higherIsBetter ? 'Higher = Better' : 'Lower = Better'})
                        </td>
                        {comparisonSuite.comparedRuns.map((r) => {
                          const cell = row.valuesByIso[r.iso3];
                          return (
                            <td
                              key={r.iso3}
                              className={`py-2 px-3 text-right font-semibold ${
                                cell?.isRelativeWinner
                                  ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/20 font-semibold'
                                  : 'text-slate-800 dark:text-slate-200'
                              }`}
                            >
                              <div className="inline-flex items-center justify-end gap-1.5">
                                {cell?.isRelativeWinner && (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                )}
                                <span>{cell?.formattedDisplay}</span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 2. 1-CLICK EXECUTIVE TEAR-SHEET & IC TRADE TICKET QUICK-DRAWER
// ============================================================================

interface ExecutiveTearSheetAndTradeTicketDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeRun: CouncilAssessmentRun;
  stagedTickets: StagedTradeTicketSpec[];
  onAddTicket: (ticket: StagedTradeTicketSpec) => void;
  onRemoveTicket: (ticketId: string) => void;
  onNavigateToSection: (sectionId: string) => void;
}

export const ExecutiveTearSheetAndTradeTicketDrawer: React.FC<
  ExecutiveTearSheetAndTradeTicketDrawerProps
> = ({
  isOpen,
  onClose,
  activeRun,
  stagedTickets,
  onAddTicket,
  onRemoveTicket,
  onNavigateToSection,
}) => {
  const [customTitle, setCustomTitle] = useState<string>('');
  const [customDirection, setCustomDirection] =
    useState<StagedTradeDirection>('LONG_CARRY_ROLL');
  const [customEntryBps, setCustomEntryBps] = useState<number>(
    activeRun.openData.monetaryAndMarket.cds5YSpreadBps
  );
  const [customTargetBps, setCustomTargetBps] = useState<number>(
    Math.max(25, activeRun.openData.monetaryAndMarket.cds5YSpreadBps - 45)
  );
  const [customStopBps, setCustomStopBps] = useState<number>(
    activeRun.openData.monetaryAndMarket.cds5YSpreadBps + 30
  );
  const [customKillSwitch, setCustomKillSwitch] = useState<string>(
    `Exit if ${activeRun.iso3} primary fiscal balance slips > 0.5% of GDP below pb* or 5Y CDS widens +30 bps.`
  );
  const [showCustomForm, setShowCustomForm] = useState<boolean>(false);

  const nssSuite = useMemo(
    () => computeSovereignNssYieldCurveSuite(activeRun, DEFAULT_NSS_SHOCK_INPUTS),
    [activeRun]
  );

  const catalystSuite = useMemo(
    () => computeMacroCatalystEventVolatilitySuite(activeRun),
    [activeRun]
  );

  if (!isOpen) return null;

  const nextSovCatalyst =
    catalystSuite.activeSovereignEvents[0] || catalystSuite.nextImminentCatalyst;

  const handleCreateCustomTicket = () => {
    const newTicket: StagedTradeTicketSpec = {
      ticketId: `CUSTOM-IC-${activeRun.iso3}-${Date.now().toString().slice(-4)}`,
      createdAtIso: new Date().toISOString(),
      iso3: activeRun.iso3,
      countryName: activeRun.countryName,
      strategyTitle:
        customTitle.trim() ||
        `${activeRun.iso3} Discretionary Sovereign Relative-Value Ticket`,
      direction: customDirection,
      sourceModuleLabel: 'Executive IC Ticket Builder',
      targetSectionId: 'quant_nss_yield_curve',
      leg1Summary: `Active Position on ${activeRun.countryName} (${activeRun.iso3}) @ ${customEntryBps} bps`,
      leg2Summary: `Target ${customTargetBps} bps · Stop-Loss ${customStopBps} bps`,
      entrySpreadOrYieldBps: customEntryBps,
      targetSpreadOrYieldBps: customTargetBps,
      stopLossSpreadOrYieldBps: customStopBps,
      expected12MCarryRollBps: nssSuite.optimalCarryRollTenor.totalCarryRoll12MBps,
      breakevenCushionBps: nssSuite.optimalCarryRollTenor.breakevenCushionBps,
      impliedEventVolBps: nextSovCatalyst.implied1DayYieldVolBps,
      convictionScore0To100: 85,
      preMortemKillSwitchRule: customKillSwitch,
      thesisRationale: `Structured around ${activeRun.iso3} ${nssSuite.optimalCarryRollTenor.tenorLabel} NSS carry+roll (+${nssSuite.optimalCarryRollTenor.totalCarryRoll12MBps} bps/yr) and DSA consolidation gap (${activeRun.openData.dsaAnalytics.fiscalConsolidationGapPct.toFixed(2)}% GDP).`,
    };
    onAddTicket(newTicket);
    setCustomTitle('');
    setShowCustomForm(false);
  };

  const handleExportTearSheetMarkdown = () => {
    const lines = [
      `# EconQuest sovereign tear sheet and IC trade tickets`,
      `Generated: ${new Date().toISOString()}`,
      ``,
      `## 1. Sovereign tear sheet: ${activeRun.countryName} (${activeRun.iso3})`,
      `- **Executive Stance**: ${activeRun.supremeCouncil?.marketTranslationLayer.regimeStance || 'Hold & Monitor'} (Composite Risk: ${compositeText(activeRun.supremeCouncil, 100)}, Coherence: ${coherenceText(activeRun.supremeCouncil)})`,
      `- **Debt & DSA Solvency**: Debt/GDP ${activeRun.openData.imfIndicators.debtToGdpPct.toFixed(1)}% | Primary Balance ${activeRun.openData.imfIndicators.primaryFiscalBalancePct.toFixed(2)}% GDP vs. Stabilizing pb* ${activeRun.openData.dsaAnalytics.debtStabilizingPrimaryBalancePct.toFixed(2)}% GDP (Gap: ${activeRun.openData.dsaAnalytics.fiscalConsolidationGapPct.toFixed(2)}% GDP)`,
      `- **NSS Yield Curve & Carry+Roll**: 2s10s Slope ${nssSuite.slope2s10sBps > 0 ? '+' : ''}${nssSuite.slope2s10sBps} bps | 2s5s10s Butterfly ${nssSuite.butterfly2s5s10sBps > 0 ? '+' : ''}${nssSuite.butterfly2s5s10sBps} bps | Optimal Carry+Roll Tenor: ${nssSuite.optimalCarryRollTenor.tenorLabel} (+${nssSuite.optimalCarryRollTenor.totalCarryRoll12MBps} bps/yr, Breakeven +${nssSuite.optimalCarryRollTenor.breakevenCushionBps} bps/yr)`,
      `- **Credit & External Buffers**: 5Y CDS ${activeRun.openData.monetaryAndMarket.cds5YSpreadBps} bps | 10Y Yield ${activeRun.openData.monetaryAndMarket.sovereign10YBondYieldPct.toFixed(2)}% | FX Reserves ${activeRun.openData.worldBankIndicators.fxReservesMonthsImport.toFixed(1)} months of imports`,
      `- **Next Macro Catalyst**: ${nextSovCatalyst.eventTitle} in ${nextSovCatalyst.daysUntilEvent}d (${nextSovCatalyst.eventDateLabel}) · Implied 1D Event Vol ±${nextSovCatalyst.implied1DayYieldVolBps} bps`,
      ``,
      `## 2. Staged IC trade tickets (${stagedTickets.length})`,
      ...stagedTickets.flatMap((t, idx) => [
        `### Ticket ${idx + 1}: ${t.strategyTitle} (${t.ticketId})`,
        `- **Sovereign**: ${t.countryName} (${t.iso3}${t.secondaryIso3 ? ` vs. ${t.secondaryIso3}` : ''}) · **Direction**: ${t.direction}`,
        `- **Leg 1**: ${t.leg1Summary}`,
        `- **Leg 2 / Funding**: ${t.leg2Summary}`,
        `- **Entry / Target / Stop-Loss**: Entry ${t.entrySpreadOrYieldBps} bps | Target ${t.targetSpreadOrYieldBps} bps | Stop-Loss ${t.stopLossSpreadOrYieldBps} bps`,
        `- **12M Carry+Roll & Cushion**: +${t.expected12MCarryRollBps} bps/yr Carry+Roll | +${t.breakevenCushionBps} bps/yr Breakeven Cushion | Implied Event Vol ±${t.impliedEventVolBps} bps`,
        `- **Pre-Mortem Kill-Switch**: ${t.preMortemKillSwitchRule}`,
        `- **Thesis Rationale**: ${t.thesisRationale}`,
        ``,
      ]),
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${activeRun.iso3}_IC_TearSheet_And_Trade_Tickets.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-4xl bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 h-full flex flex-col shadow-2xl">
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 bg-slate-50 dark:bg-slate-900">
          <div>
            <div className="flex items-center gap-2 text-xs tabular-nums text-blue-600 dark:text-blue-400 font-semibold">
              <Briefcase className="w-4 h-4" />
              <span>1-Click executive tear-sheet & IC trade ticket book</span>
            </div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white mt-0.5">
              {activeRun.countryName} ({activeRun.iso3}) Instant IC Tear-Sheet & Staged Relative-Value Trade Tickets
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportTearSheetMarkdown}
              className="ui-btn ui-btn-primary inline-flex"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export IC Tear-Sheet (.md)</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* SECTION 1: 1-PAGE SOVEREIGN EXECUTIVE TEAR-SHEET */}
          <div className="p-4 border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2.5">
              <div>
                <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400 block">
                  1-Page boardroom sovereign snapshot
                </span>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {activeRun.countryName} ({activeRun.iso3} · {activeRun.openData.currencyCode}) —{' '}
                  <span className="tabular-nums text-blue-600 dark:text-blue-400">
                    {activeRun.supremeCouncil?.marketTranslationLayer.regimeStance ||
                      'Hold & Monitor'}
                  </span>
                </h3>
              </div>
              <div className="flex items-center gap-2 text-xs tabular-nums">
                <span>
                  Composite Risk:{' '}
                  <strong>
                    {Math.round((activeRun.supremeCouncil?.compositeRiskScore ?? 0.58) * 100)}/100
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Coherence:{' '}
                  <strong>
                    {coherenceText(activeRun.supremeCouncil)}
                  </strong>
                </span>
              </div>
            </div>

            {/* 4-Pillar Tear-Sheet KPI Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 tabular-nums text-xs">
              <div className="p-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="text-xs text-slate-500">1. DSA solvency (% GDP)</div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white mt-1">
                  Debt {activeRun.openData.imfIndicators.debtToGdpPct.toFixed(1)}% GDP
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  PB {activeRun.openData.imfIndicators.primaryFiscalBalancePct.toFixed(2)}% vs pb*{' '}
                  {activeRun.openData.dsaAnalytics.debtStabilizingPrimaryBalancePct.toFixed(2)}%
                </div>
              </div>

              <div className="p-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="text-xs text-slate-500">2. NSS curve sweet spot</div>
                <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mt-1">
                  {nssSuite.optimalCarryRollTenor.tenorLabel} +
                  {nssSuite.optimalCarryRollTenor.totalCarryRoll12MBps} bps/yr
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  2s10s {nssSuite.slope2s10sBps > 0 ? '+' : ''}
                  {nssSuite.slope2s10sBps} bps · Cushion +
                  {nssSuite.optimalCarryRollTenor.breakevenCushionBps} bps
                </div>
              </div>

              <div className="p-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="text-xs text-slate-500">3. Credit & reserves</div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white mt-1">
                  5Y CDS {activeRun.openData.monetaryAndMarket.cds5YSpreadBps} bps
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  FX Cover {activeRun.openData.worldBankIndicators.fxReservesMonthsImport.toFixed(1)}{' '}
                  mos · 10Y {activeRun.openData.monetaryAndMarket.sovereign10YBondYieldPct.toFixed(2)}%
                </div>
              </div>

              <div className="p-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="text-xs text-slate-500">4. Next catalyst vol</div>
                <div className="text-sm font-semibold text-amber-600 dark:text-amber-400 mt-1">
                  {nextSovCatalyst.categoryBadge} ({nextSovCatalyst.daysUntilEvent}d)
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Implied 1D Move ±{nextSovCatalyst.implied1DayYieldVolBps} bps
                </div>
              </div>
            </div>

            {/* Quick-Stage Recommended Curve Tickets for Active Sovereign */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <span className="text-xs text-slate-600 dark:text-slate-400">
                Quick-Stage {activeRun.iso3} Algorithmic Curve & Catalyst Tickets:
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {nssSuite.recommendedCurveTickets.map((t) => (
                  <button
                    key={t.ticketId}
                    type="button"
                    onClick={() => onAddTicket(t)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs tabular-nums font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    <span>+ {t.strategyTitle.slice(0, 34)}...</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* SECTION 2: STAGED IC TRADE TICKETS */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span>
                    Staged Investment Committee Trade Ticket Book ({stagedTickets.length} Active)
                  </span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Every ticket enforces explicit Entry / Target / Stop-Loss levels (bps), 12M Carry+Roll cushion (bps/yr), and Pre-Mortem Kill-Switch rules.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCustomForm((v) => !v)}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs tabular-nums font-semibold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{showCustomForm ? 'Close Custom Ticket Form' : 'New Custom IC Ticket'}</span>
              </button>
            </div>

            {showCustomForm && (
              <div className="p-4 border border-blue-200 dark:border-blue-900/70 bg-blue-50/30 dark:bg-blue-950/20 space-y-3 text-xs">
                <div className="tabular-nums font-semibold text-blue-700 dark:text-blue-300">
                  Create Custom IC Trade Ticket for {activeRun.countryName} ({activeRun.iso3})
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs tabular-nums text-slate-500 mb-1">
                      Strategy Title
                    </label>
                    <input
                      type="text"
                      value={customTitle}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      placeholder={`e.g. Long ${activeRun.iso3} 5Y Belly vs. Short 10Y Steepener`}
                      className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs tabular-nums text-slate-500 mb-1">
                      Structure Direction
                    </label>
                    <select
                      value={customDirection}
                      onChange={(e) =>
                        setCustomDirection(e.target.value as StagedTradeDirection)
                      }
                      className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white tabular-nums"
                    >
                      <option value="LONG_CARRY_ROLL">Long carry and roll</option>
                      <option value="CURVE_STEEPENER">Curve steepener</option>
                      <option value="CURVE_FLATTENER">Curve flattener</option>
                      <option value="BELLY_BUTTERFLY">Belly butterfly</option>
                      <option value="PAIR_RELATIVE_VALUE">Pair relative value</option>
                      <option value="CATALYST_VOL_HEDGE">Catalyst volatility hedge</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 tabular-nums">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">
                      Entry Level (bps)
                    </label>
                    <input
                      type="number"
                      value={customEntryBps}
                      onChange={(e) => setCustomEntryBps(Number(e.target.value))}
                      className="w-full px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">
                      Target Level (bps)
                    </label>
                    <input
                      type="number"
                      value={customTargetBps}
                      onChange={(e) => setCustomTargetBps(Number(e.target.value))}
                      className="w-full px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">
                      Stop-Loss Level (bps)
                    </label>
                    <input
                      type="number"
                      value={customStopBps}
                      onChange={(e) => setCustomStopBps(Number(e.target.value))}
                      className="w-full px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs tabular-nums text-slate-500 mb-1">
                    Pre-Mortem Kill-Switch Rule
                  </label>
                  <input
                    type="text"
                    value={customKillSwitch}
                    onChange={(e) => setCustomKillSwitch(e.target.value)}
                    className="w-full px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleCreateCustomTicket}
                    className="ui-btn ui-btn-primary"
                  >
                    Add Ticket to IC Book
                  </button>
                </div>
              </div>
            )}

            {/* Ticket List */}
            <div className="space-y-3">
              {stagedTickets.map((ticket) => (
                <div
                  key={ticket.ticketId}
                  className="p-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 text-xs tabular-nums">
                        <span className="font-semibold text-blue-600 dark:text-blue-400">
                          {ticket.iso3}
                          {ticket.secondaryIso3 ? ` vs ${ticket.secondaryIso3}` : ''}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="text-slate-500">{toDisplayCase(ticket.direction)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="text-slate-500">Source: {ticket.sourceModuleLabel}</span>
                      </div>
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">
                        {ticket.strategyTitle}
                      </h4>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onNavigateToSection(ticket.targetSectionId);
                          onClose();
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs tabular-nums text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        <span>Open Source Desk</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveTicket(ticket.ticketId)}
                        title="Remove ticket from IC Book"
                        className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs tabular-nums bg-slate-50 dark:bg-slate-950 p-2.5 border border-slate-100 dark:border-slate-800">
                    <div>
                      <span className="text-xs text-slate-400 block">Primary leg 1</span>
                      <span className="text-slate-800 dark:text-slate-200">
                        {ticket.leg1Summary}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-400 block">
                        Hedge / funding leg 2
                      </span>
                      <span className="text-slate-800 dark:text-slate-200">
                        {ticket.leg2Summary}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs tabular-nums">
                    <div>
                      <span className="text-xs text-slate-500 block">Entry level</span>
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {ticket.entrySpreadOrYieldBps} bps
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">Target level</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        {ticket.targetSpreadOrYieldBps} bps
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">Stop-loss</span>
                      <span className="font-semibold text-rose-600 dark:text-rose-400">
                        {ticket.stopLossSpreadOrYieldBps} bps
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">12M carry+roll</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        +{ticket.expected12MCarryRollBps} bps/yr
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">Breakeven cushion</span>
                      <span className="font-semibold text-blue-600 dark:text-blue-400">
                        +{ticket.breakevenCushionBps} bps/yr
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    {ticket.thesisRationale}
                  </p>

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-1.5 text-xs tabular-nums text-amber-700 dark:text-amber-400">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      <strong>Kill-Switch:</strong> {ticket.preMortemKillSwitchRule}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
