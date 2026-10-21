import React, { useState, useMemo } from 'react';
import {
  SovereignEntity,
  LayerOutputs,
  MacroScenario,
  CustomScenarioParams
} from '../types/riskEngine';
import {
  computeSovereignYieldCurve,
  computeDebtMaturityWall,
  computeCentralBankPolicyProfile,
  computePortfolioRiskAttribution,
  PRESET_INSTITUTIONAL_BOOKS
} from '../math/institutionalMacroAnalytics';

interface IcTearSheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  sovereigns: SovereignEntity[];
  pipelineOutputs: Record<string, LayerOutputs>;
  selectedSovereignId: string;
  onSelectSovereign: (id: string) => void;
  activeScenario: MacroScenario;
  customParams?: CustomScenarioParams;
}

export const IcTearSheetModal: React.FC<IcTearSheetModalProps> = ({
  isOpen,
  onClose,
  sovereigns,
  pipelineOutputs,
  selectedSovereignId,
  onSelectSovereign,
  activeScenario,
  customParams
}) => {
  const [reportScope, setReportScope] = useState<'single_sovereign' | 'global_committee'>(
    'single_sovereign'
  );
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);

  const selectedSovereign = useMemo(
    () => sovereigns.find((s) => s.id === selectedSovereignId) || sovereigns[0],
    [sovereigns, selectedSovereignId]
  );

  const out = pipelineOutputs[selectedSovereign.id];
  const yieldCurve = useMemo(
    () =>
      computeSovereignYieldCurve(
        selectedSovereign,
        out,
        activeScenario,
        customParams
      ),
    [selectedSovereign, out, activeScenario, customParams]
  );
  const maturityWall = useMemo(
    () => computeDebtMaturityWall(selectedSovereign, out, activeScenario),
    [selectedSovereign, out, activeScenario]
  );
  const cbProfile = useMemo(
    () => computeCentralBankPolicyProfile(selectedSovereign, out, activeScenario),
    [selectedSovereign, out, activeScenario]
  );
  const corePortfolio = useMemo(
    () =>
      computePortfolioRiskAttribution(
        PRESET_INSTITUTIONAL_BOOKS.em_distressed_alpha.positions,
        sovereigns,
        pipelineOutputs,
        activeScenario,
        customParams
      ),
    [sovereigns, pipelineOutputs, activeScenario, customParams]
  );

  if (!isOpen) return null;

  const triggerDownload = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setDownloadStatus(`Exported ${filename}`);
    setTimeout(() => setDownloadStatus(null), 3000);
  };

  const handleExportJson = () => {
    const payload = {
      metadata: {
        workspace: 'experimental-sandbox',
        warning: 'ILLUSTRATIVE OUTPUTS: not observed monitoring, investment advice or validated portfolio risk.',
        reportTitle:
          reportScope === 'single_sovereign'
            ? `EconQuest IC Sovereign Risk Memo - ${selectedSovereign.name} (${selectedSovereign.code})`
            : 'EconQuest Global Macro Risk Committee Pack',
        generatedAtIso: new Date().toISOString(),
        activeMacroScenario: activeScenario,
        modelStatus: 'EXPERIMENTAL: annual fitted hazard/HMM; other layers and market inputs remain illustrative',
        methodology: 'EconQuest 6-Layer VaR + Nelson-Siegel + Augmented Taylor Rule'
      },
      focusSovereign: {
        entity: selectedSovereign,
        pipelineOutputs: out,
        yieldCurveAnalytics: yieldCurve,
        debtMaturityWall: maturityWall,
        centralBankPolicy: cbProfile
      },
      globalUniverseSummary: sovereigns.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        region: s.region,
        posteriorHazard12mPct: Number(
          ((pipelineOutputs[s.id]?.calibratedPosteriorHazard || 0) * 100).toFixed(2)
        ),
        cds5yBps: s.cdsSpread5yBps,
        polymarketImpliedPct: s.predictionMarket.impliedProbPercent,
        arbitrageDivergencePct: Number(
          (pipelineOutputs[s.id]?.arbitrageDivergence || 0).toFixed(2)
        ),
        regime: pipelineOutputs[s.id]?.regime,
        annualModel: pipelineOutputs[s.id]?.annualModel,
        lVar99Pct: Number((pipelineOutputs[s.id]?.lVar99 || 0).toFixed(2)),
        es975Pct: Number((pipelineOutputs[s.id]?.es975 || 0).toFixed(2))
      })),
      portfolioRiskPack: corePortfolio
    };

    const filename =
      reportScope === 'single_sovereign'
        ? `econquest-ic-memo-${selectedSovereign.code.toLowerCase()}-${activeScenario}.json`
        : `econquest-global-macro-committee-pack-${activeScenario}.json`;

    triggerDownload(JSON.stringify(payload, null, 2), filename, 'application/json');
  };

  const handleExportCsv = () => {
    const headers = [
      'Workspace_Warning',
      'Code',
      'Sovereign',
      'Region',
      'FX_Regime',
      'Scenario',
      'Model_Version',
      'Observed_Year',
      'Target_Year',
      'Already_In_Default',
      'Model_Status',
      'L1_Hazard_Pct',
      'Posterior_12M_PD_Pct',
      'Polymarket_Implied_Pct',
      'Alpha_Divergence_Pct',
      'HMM_Regime',
      'CDS_5Y_Bps',
      'Slope_2s10s_Bps',
      'Next_12M_FX_Wall_Bln',
      'Reserve_Coverage_Pct',
      'Policy_Rate_Pct',
      'Taylor_Implied_Pct',
      'Policy_Gap_Bps',
      'VaR_99_Pct',
      'ES_975_Pct',
      'L_VaR_99_Pct'
    ];

    const rows = sovereigns.map((s) => {
      const pOut = pipelineOutputs[s.id];
      const yc = computeSovereignYieldCurve(s, pOut, activeScenario, customParams);
      const mw = computeDebtMaturityWall(s, pOut, activeScenario);
      const cb = computeCentralBankPolicyProfile(s, pOut, activeScenario);

      return [
        '"EXPERIMENTAL SANDBOX - illustrative, not observed monitoring or validated risk"',
        s.code,
        `"${s.name}"`,
        `"${s.region}"`,
        `"${s.fxRegime}"`,
        activeScenario,
        pOut?.annualModel.version,
        pOut?.annualModel.observationYear,
        pOut?.annualModel.forecastYear,
        pOut?.annualModel.inDefault,
        pOut?.annualModel.status,
        ((pOut?.layer1ReconciledHazard || 0) * 100).toFixed(2),
        ((pOut?.calibratedPosteriorHazard || 0) * 100).toFixed(2),
        s.predictionMarket.impliedProbPercent.toFixed(2),
        (pOut?.arbitrageDivergence || 0).toFixed(2),
        pOut?.regime || 'Calm',
        s.cdsSpread5yBps,
        yc.slope2s10sBps,
        mw.next12mFxDebtServiceBln.toFixed(2),
        mw.reserveCoverageRatioPct.toFixed(1),
        cb.policyRatePct.toFixed(2),
        cb.taylorImpliedRatePct.toFixed(2),
        cb.policyRateGapBps,
        (pOut?.var99 || 0).toFixed(2),
        (pOut?.es975 || 0).toFixed(2),
        (pOut?.lVar99 || 0).toFixed(2)
      ].join(',');
    });

    const csvString = [headers.join(','), ...rows].join('\n');
    const filename = `econquest-institutional-risk-matrix-${activeScenario}.csv`;
    triggerDownload(csvString, filename, 'text/csv;charset=utf-8;');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#0b101c] border border-[#233352] rounded-xl max-w-4xl w-full max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Top Modal Header */}
        <div className="px-6 py-4 bg-[#0e1526] border-b border-[#1a2742] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>Investment Committee (IC) Risk Reporting</span>
              <span aria-hidden="true">·</span>
              <span>FRTB MAR20 Audit Ready</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-emerald-400">Scenario: {activeScenario}</span>
            </div>
            <h2 className="text-base font-bold text-slate-100 mt-0.5">
              Institutional Quantitative Risk Tear-Sheet & Data Snapshot Exporter
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCsv}
              className="px-3 py-1.5 bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-600/60 text-emerald-300 text-xs font-semibold rounded transition-colors whitespace-nowrap"
            >
              ⬇ Download CSV Matrix
            </button>
            <button
              onClick={handleExportJson}
              className="px-3 py-1.5 bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-600/60 text-cyan-300 text-xs font-semibold rounded transition-colors whitespace-nowrap"
            >
              ⬇ Download JSON Snapshot
            </button>
            <button
              onClick={onClose}
              className="px-2.5 py-1.5 bg-[#162238] hover:bg-[#1f304d] text-slate-300 text-xs font-mono rounded transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Sub-Toolbar: Scope Toggle & Sovereign Selector */}
        <div className="px-6 py-3 bg-[#090d16] border-b border-[#1a2438] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-1 bg-[#0e1524] p-1 rounded border border-[#1a2438]">
            <button
              onClick={() => setReportScope('single_sovereign')}
              className={`px-3 py-1 rounded font-medium transition-colors ${
                reportScope === 'single_sovereign'
                  ? 'bg-[#17233b] text-emerald-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Single-Sovereign Credit Memo
            </button>
            <button
              onClick={() => setReportScope('global_committee')}
              className={`px-3 py-1 rounded font-medium transition-colors ${
                reportScope === 'global_committee'
                  ? 'bg-[#17233b] text-cyan-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Global Macro Committee Pack
            </button>
          </div>

          <div className="flex items-center gap-3">
            {downloadStatus && (
              <span className="text-emerald-400 font-mono text-xs">
                ✓ {downloadStatus}
              </span>
            )}
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Focus Sovereign:</span>
              <select
                value={selectedSovereign.id}
                onChange={(e) => onSelectSovereign(e.target.value)}
                className="bg-[#111726] border border-[#23314d] text-slate-100 text-xs font-mono rounded px-2.5 py-1 focus:outline-none"
              >
                {sovereigns.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.flag} {s.code} · {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Scrollable Tear-Sheet Document Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs">
          {reportScope === 'single_sovereign' ? (
            <>
              {/* Sovereign Credit Memo Header Box */}
              <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="text-slate-400 text-[11px] font-mono">
                    SOVEREIGN CREDIT & TAIL-RISK MEMORANDUM
                  </div>
                  <div className="text-base font-bold text-slate-100 mt-0.5">
                    {selectedSovereign.flag} {selectedSovereign.name} ({selectedSovereign.code}) · {selectedSovereign.region} · {selectedSovereign.fxRegime} Regime
                  </div>
                </div>
                <div className="flex items-center gap-4 font-mono tabular-nums">
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400">12M POSTERIOR PD</div>
                    <div className="text-lg font-bold text-rose-400">
                      {((out?.calibratedPosteriorHazard || 0) * 100).toFixed(2)}%
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400">99% L-VaR / ES 97.5%</div>
                    <div className="text-lg font-bold text-amber-400">
                      {out?.lVar99.toFixed(1)}% / {out?.es975.toFixed(1)}%
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400">ALPHA DIVERGENCE</div>
                    <div className="text-lg font-bold text-emerald-400">
                      {out?.arbitrageDivergence && out.arbitrageDivergence > 0
                        ? `+${out.arbitrageDivergence.toFixed(1)}%`
                        : `${out?.arbitrageDivergence.toFixed(1)}%`}
                    </div>
                  </div>
                </div>
              </div>

              {/* 3-Column Diagnostic Breakdown */}
              <p className="text-xs text-amber-300">
                Research-only fit · observed {out?.annualModel.observationYear} · target {out?.annualModel.forecastYear} ·
                {' '}{out?.annualModel.version}. Onset hazard assumes no current default; not usable as a default
                forecast for countries already in default. Other layers remain illustrative.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono tabular-nums">
                <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-2">
                  <div className="font-sans font-bold text-slate-100 border-b border-[#1a2438] pb-1.5">
                    01. 6-Layer Pipeline Diagnostics
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">L1 Firth Logit Prior:</span>
                    <span className="text-slate-200">{((out?.baselineProbLogit || 0) * 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">L1 LightGBM Challenger:</span>
                    <span className="text-slate-200">{((out?.lightgbmChallengerProb || 0) * 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">L3 HMM Regime State:</span>
                    <span className="text-amber-300">{out?.regime}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">L4 Merton Distance (DD):</span>
                    <span className="text-slate-200">{out?.distanceToDistress.toFixed(2)}σ</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">L4 Composite LGD:</span>
                    <span className="text-rose-400">{out?.compositeSeverityLge.toFixed(1)}%</span>
                  </div>
                </div>

                <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-2">
                  <div className="font-sans font-bold text-slate-100 border-b border-[#1a2438] pb-1.5">
                    02. Term Structure & Maturity Wall
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">2Y / 10Y USD Eurobond:</span>
                    <span className="text-slate-200">
                      {yieldCurve.points[1].usdEurobondYield}% / {yieldCurve.points[5].usdEurobondYield}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">2s10s Curve Slope:</span>
                    <span className={yieldCurve.isInverted ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                      {yieldCurve.slope2s10sBps} bps
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">5Y CDS-Bond Basis:</span>
                    <span className="text-cyan-400">{yieldCurve.points[3].cdsBasisBps} bps</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Next 12M FX Debt Wall:</span>
                    <span className="text-amber-300">${maturityWall.next12mFxDebtServiceBln}B</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">12M Reserve Coverage:</span>
                    <span className="text-slate-200">{maturityWall.reserveCoverageRatioPct}%</span>
                  </div>
                </div>

                <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-2">
                  <div className="font-sans font-bold text-slate-100 border-b border-[#1a2438] pb-1.5">
                    03. Monetary Policy & Taylor Rule
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Policy Rate / CPI:</span>
                    <span className="text-slate-200">
                      {cbProfile.policyRatePct}% / {cbProfile.headlineCpiPct}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Taylor Implied Rate:</span>
                    <span className="text-slate-200">{cbProfile.taylorImpliedRatePct}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Policy Rate Gap:</span>
                    <span className={cbProfile.policyRateGapBps < -100 ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                      {cbProfile.policyRateGapBps} bps
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">REER Misalignment:</span>
                    <span className="text-slate-200">
                      {cbProfile.reerMisalignmentPct > 0 ? `+${cbProfile.reerMisalignmentPct}%` : `${cbProfile.reerMisalignmentPct}%`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Monetary Stance:</span>
                    <span className="text-amber-300 font-sans">{cbProfile.monetaryStance}</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-wrap items-center justify-between gap-4 font-mono tabular-nums">
                <div>
                  <div className="text-xs text-slate-400 font-sans">GLOBAL PORTFOLIO RISK COMMITTEE SUMMARY</div>
                  <div className="text-sm font-bold text-slate-100 font-sans">
                    EM High-Yield & Special Situations Book (${corePortfolio.totalNotionalUsdM}M Notional)
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div>
                    <div className="text-[10px] text-slate-400">NET POST-HEDGE 99% VaR</div>
                    <div className="text-base font-bold text-emerald-400">
                      ${corePortfolio.netPostHedgeVarUsdM}M ({corePortfolio.netPostHedgeVarPct}%)
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">97.5% EXPECTED SHORTFALL</div>
                    <div className="text-base font-bold text-rose-400">
                      ${corePortfolio.netPostHedgeEs975UsdM}M
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">NET ANNUAL CARRY</div>
                    <div className="text-base font-bold text-cyan-400">
                      +${corePortfolio.netAnnualCarryUsdM}M
                    </div>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto border border-[#1a2438] rounded-lg">
                <table className="w-full text-left text-xs border-collapse font-mono tabular-nums">
                  <thead>
                    <tr className="bg-[#090d16] border-b border-[#1a2438] text-slate-400 text-[11px] uppercase">
                      <th className="py-2 px-3">Sovereign</th>
                      <th className="py-2 px-3 text-right">12M PD</th>
                      <th className="py-2 px-3 text-right">2s10s Slope</th>
                      <th className="py-2 px-3 text-right">12M FX Wall</th>
                      <th className="py-2 px-3 text-right">Taylor Gap</th>
                      <th className="py-2 px-3 text-right">99% L-VaR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1a2438]/70 bg-[#0e1524]">
                    {sovereigns.map((s) => {
                      const pOut = pipelineOutputs[s.id];
                      const yc = computeSovereignYieldCurve(s, pOut, activeScenario, customParams);
                      const mw = computeDebtMaturityWall(s, pOut, activeScenario);
                      const cb = computeCentralBankPolicyProfile(s, pOut, activeScenario);
                      return (
                        <tr key={s.id}>
                          <td className="py-2 px-3 font-sans font-semibold text-slate-100">
                            {s.flag} {s.name} ({s.code})
                          </td>
                          <td className="py-2 px-3 text-right text-rose-400">
                            {((pOut?.calibratedPosteriorHazard || 0) * 100).toFixed(1)}%
                          </td>
                          <td className="py-2 px-3 text-right text-slate-200">
                            {yc.slope2s10sBps} bps
                          </td>
                          <td className="py-2 px-3 text-right text-amber-300">
                            ${mw.next12mFxDebtServiceBln}B
                          </td>
                          <td className="py-2 px-3 text-right text-cyan-400">
                            {cb.policyRateGapBps} bps
                          </td>
                          <td className="py-2 px-3 text-right text-slate-100 font-bold">
                            {(pOut?.lVar99 || 0).toFixed(1)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
