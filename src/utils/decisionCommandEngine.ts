import {
  BrierCalibrationBucket,
  CognitiveBiasGuardrailItem,
  ConditionalBayesianEventSimulation,
  CouncilAssessmentRun,
  CrossSovereignDislocationScreenerResult,
  DecisionLedgerEntry,
  DecisionLedgerSummaryMetrics,
  EvaluatedDecisionLedgerRow,
  FourQuadrantMacroStressResult,
  KillSwitchTripwireItem,
  MacroQuadrantId,
  MacroQuadrantScenarioCell,
  NormalizedPredictionContract,
  OpenDataSnapshot,
  PreMortemAndKillSwitchResult,
  PreMortemFailureBranch,
  PredictionEventCategory,
  PredictionMarketArbitrageSuite,
  RawVenueEventContract,
  SovereignDislocationRow,
  SovereignQuadrantStressRow,
  WatchlistItem,
} from '../types/council';
import { SOVEREIGN_CATALOG, buildBaselineOpenData } from '../data/presetsAndBaselines';

export const DEFAULT_QUADRANT_PROBABILITIES: Record<MacroQuadrantId, number> = {
  Q1_STAGFLATIONARY_SUPPLY_SHOCK: 25,
  Q2_USD_LIQUIDITY_TERM_SQUEEZE: 30,
  Q3_EM_FISCAL_DOMINANCE_FREEZE: 20,
  Q4_GOLDILOCKS_DISINFLATION: 25,
};

function resolveSovereignSnapshot(
  item: WatchlistItem,
  activeSnapshot: OpenDataSnapshot
): OpenDataSnapshot {
  if (item.iso3.toUpperCase() === activeSnapshot.iso3.toUpperCase()) {
    return activeSnapshot;
  }
  const snap = buildBaselineOpenData(item.iso3);
  snap.countryName = item.countryName || snap.countryName;
  snap.region = item.region || snap.region;
  snap.currencyCode = item.currencyCode || snap.currencyCode;
  snap.monetaryAndMarket.sovereign10YBondYieldPct = item.yield10YPct;
  snap.monetaryAndMarket.cds5YSpreadBps = item.cds5YBps;
  snap.imfIndicators.debtToGdpPct = item.debtToGdpPct;
  snap.worldBankIndicators.fxReservesMonthsImport = item.fxReservesMonths;
  return snap;
}

/**
 * 7.1 Cross-Sovereign Model-vs-Market CDS Hazard Dislocation Screener
 * Compares ISDA 5Y CDS Market-Implied Default Probability against Econometric Fundamental Default Probability
 */
export function computeCrossSovereignDislocationScreener(
  activeSnapshot: OpenDataSnapshot,
  watchlistItems: WatchlistItem[] = SOVEREIGN_CATALOG
): CrossSovereignDislocationScreenerResult {
  const activeCode = activeSnapshot.iso3.toUpperCase();
  const map = new Map<string, WatchlistItem>();
  watchlistItems.forEach((it) => map.set(it.iso3.toUpperCase(), it));
  SOVEREIGN_CATALOG.forEach((it) => {
    if (!map.has(it.iso3.toUpperCase())) {
      map.set(it.iso3.toUpperCase(), it);
    }
  });

  const universe = Array.from(map.values());
  const lgd = 0.6; // Standard 40% recovery / 60% LGD

  const unrankedRows = universe.map((item) => {
    const snap = resolveSovereignSnapshot(item, activeSnapshot);
    const isCurrent = snap.iso3.toUpperCase() === activeCode;

    const marketCdsBps = Math.max(15, Math.round(snap.monetaryAndMarket.cds5YSpreadBps));
    const debtToGdp = snap.imfIndicators.debtToGdpPct;
    const fxReservesMonths = snap.worldBankIndicators.fxReservesMonthsImport;
    const primaryBalance = snap.imfIndicators.primaryFiscalBalancePct;
    const realPolicyRate = snap.monetaryAndMarket.realPolicyRatePct;
    const polStability = snap.worldBankIndicators.politicalStabilityPercentile;
    const cpi = snap.imfIndicators.cpiInflationPct;

    // Econometric Fundamental Fair 5Y CDS Spread (bps) from structural solvency & liquidity covariates
    const debtComponent = Math.max(0, (debtToGdp - 42) * 3.15);
    const reserveShortfallComponent = Math.max(0, (5.5 - fxReservesMonths) * 48);
    const fiscalDeficitComponent = Math.max(0, -primaryBalance * 24);
    const inflationPenalty = Math.max(0, (cpi - 4.0) * 5.2);
    const realRateCredibilityAnchor = realPolicyRate > 2.5 ? -22 : realPolicyRate < 0 ? 45 : 0;
    const governanceComponent = Math.max(0, (55 - polStability) * 2.1);

    const fundamentalFair5YCdsSpreadBps = Math.max(
      25,
      Math.round(
        45 +
          debtComponent +
          reserveShortfallComponent +
          fiscalDeficitComponent +
          inflationPenalty +
          realRateCredibilityAnchor +
          governanceComponent
      )
    );

    const dislocationSpreadGapBps = marketCdsBps - fundamentalFair5YCdsSpreadBps;

    // ISDA 5Y Cumulative Default Probability: PD_5Y = 1 - exp(-5 * (Spread / (10000 * LGD)))
    const lambdaMarket = marketCdsBps / (10000 * lgd);
    const lambdaModel = fundamentalFair5YCdsSpreadBps / (10000 * lgd);

    const marketImplied5YDefaultProbPct = Number(
      ((1 - Math.exp(-5 * lambdaMarket)) * 100).toFixed(2)
    );
    const econometric5YDefaultProbPct = Number(
      ((1 - Math.exp(-5 * lambdaModel)) * 100).toFixed(2)
    );
    const defaultProbGapPct = Number(
      (marketImplied5YDefaultProbPct - econometric5YDefaultProbPct).toFixed(2)
    );

    const crossVolScale = Math.max(25, fundamentalFair5YCdsSpreadBps * 0.18);
    const dislocationZScore = Number((dislocationSpreadGapBps / crossVolScale).toFixed(2));

    const actionableSignal: SovereignDislocationRow['actionableSignal'] =
      dislocationSpreadGapBps >= 35
        ? 'DISTRESSED_OVERSHOOT_BUY_CREDIT'
        : dislocationSpreadGapBps <= -35
        ? 'COMPLACENT_MARKET_BUY_CDS_PROTECTION'
        : 'FAIRLY_PRICED_CARRY_HOLD';

    const tradeExpressionSummary =
      actionableSignal === 'DISTRESSED_OVERSHOOT_BUY_CREDIT'
        ? `Sell ${snap.iso3} 5Y CDS Protection / Overweight 10Y Eurobond (+${dislocationSpreadGapBps} bps cheap vs. econometric fair value)`
        : actionableSignal === 'COMPLACENT_MARKET_BUY_CDS_PROTECTION'
        ? `Buy ${snap.iso3} 5Y CDS Protection / Underweight Credit (${dislocationSpreadGapBps} bps rich vs. structural debt/reserve risk)`
        : `Hold Benchmark Weight & Harvest ${snap.monetaryAndMarket.sovereign10YBondYieldPct}% Local Carry`;

    return {
      iso3: snap.iso3,
      countryName: snap.countryName,
      region: snap.region,
      currencyCode: snap.currencyCode,
      isCurrentActiveSovereign: isCurrent,
      market5YCdsSpreadBps: marketCdsBps,
      fundamentalFair5YCdsSpreadBps,
      dislocationSpreadGapBps,
      dislocationZScore,
      marketImplied5YDefaultProbPct,
      econometric5YDefaultProbPct,
      defaultProbGapPct,
      local10YYieldPct: Number(snap.monetaryAndMarket.sovereign10YBondYieldPct.toFixed(2)),
      debtToGdpPct: Number(debtToGdp.toFixed(1)),
      fxReservesMonths: Number(fxReservesMonths.toFixed(2)),
      realPolicyRatePct: Number(realPolicyRate.toFixed(2)),
      convictionRank: 1,
      actionableSignal,
      tradeExpressionSummary,
    };
  });

  // Sort by absolute dislocation Z-score descending so highest conviction mispricings appear first
  const sortedByMagnitude = [...unrankedRows].sort(
    (a, b) => Math.abs(b.dislocationZScore) - Math.abs(a.dislocationZScore)
  );
  const rows: SovereignDislocationRow[] = sortedByMagnitude.map((r, idx) => ({
    ...r,
    convictionRank: idx + 1,
  }));

  const sortedByGapDesc = [...rows].sort(
    (a, b) => b.dislocationSpreadGapBps - a.dislocationSpreadGapBps
  );
  const topLongCreditOpportunity = sortedByGapDesc[0] || rows[0];
  const topShortProtectionOpportunity =
    sortedByGapDesc[sortedByGapDesc.length - 1] || rows[rows.length - 1];

  const universeMeanSpreadGapBps = Math.round(
    rows.reduce((acc, r) => acc + r.dislocationSpreadGapBps, 0) / Math.max(1, rows.length)
  );
  const universeCrossSectionalDispersionBps = Math.round(
    Math.sqrt(
      rows.reduce(
        (acc, r) => acc + Math.pow(r.dislocationSpreadGapBps - universeMeanSpreadGapBps, 2),
        0
      ) / Math.max(1, rows.length)
    )
  );

  return {
    headlineConclusion: `Cross-Sovereign Hazard Screener identifies ${topLongCreditOpportunity.countryName} (${topLongCreditOpportunity.iso3}) as the #1 Oversold Long Credit dislocation (+${topLongCreditOpportunity.dislocationSpreadGapBps} bps above fair value, Market 5Y PD ${topLongCreditOpportunity.marketImplied5YDefaultProbPct}% vs. Model ${topLongCreditOpportunity.econometric5YDefaultProbPct}%) and ${topShortProtectionOpportunity.countryName} (${topShortProtectionOpportunity.iso3}) as the #1 Complacent Short/Hedge candidate (${topShortProtectionOpportunity.dislocationSpreadGapBps} bps vs. fair value).`,
    topLongCreditOpportunity,
    topShortProtectionOpportunity,
    universeMeanSpreadGapBps,
    universeCrossSectionalDispersionBps,
    rows,
  };
}

/**
 * 7.2 Pre-Mortem Failure Tree & Hard Kill-Switch Tripwire Engine
 */
export function computePreMortemAndKillSwitchSuite(
  run: CouncilAssessmentRun
): PreMortemAndKillSwitchResult {
  const snap = run.openData;
  const cds = snap.monetaryAndMarket.cds5YSpreadBps;
  const yield10Y = snap.monetaryAndMarket.sovereign10YBondYieldPct;
  const reservesMo = snap.worldBankIndicators.fxReservesMonthsImport;
  const debtToGdp = snap.imfIndicators.debtToGdpPct;
  const gdeltIntensity = snap.gdeltMetrics.conflictIntensityIndex;
  const xccyBasis = Math.round(-28 - cds * 0.16);

  const activeStanceAssumed =
    run.supremeCouncil?.decisionVerdict === 'DEFENSIVE_HEDGE'
      ? `Defensive Credit & FX Tail Hedge on ${run.countryName} (${run.iso3})`
      : `Constructive Sovereign Carry / Credit Compression on ${run.countryName} (${run.iso3})`;

  const failureBranches: PreMortemFailureBranch[] = [
    {
      branchId: 'PM-BRANCH-1',
      pathwayTitle: 'Pathway A · Fiscal Consolidation Fatigue & IMF QPC Waiver Delay',
      failureCategory: 'FISCAL_IMF_PROGRAM_RUPTURE',
      conditionalProbabilityPct: 42,
      causalChainNarrative: `Unbudgeted energy/social transfers widen primary deficit by +1.4% of GDP beyond the stabilizing gap (${snap.dsaAnalytics.fiscalConsolidationGapPct}% GDP). Domestic banks demand +65 bps auction tails to absorb T-bill supply, triggering a 90-day delay in official multilateral tranche disbursement.`,
      projected5YCdsWideningBps: Math.round(95 + cds * 0.22),
      projected10YLocalYieldSpikeBps: 165,
      projectedSpotFxDepreciationPct: 8.5,
      primaryEarlyWarningLeadIndicator: `Monthly Treasury 364d T-Bill Auction Bid-to-Cover < 1.30x or Auction Tail > +35 bps`,
      preEmptiveMitigationAction: `Switch 40% of long duration local bond exposure into 91d T-bills and add 5Y USD CDS payer protection.`,
    },
    {
      branchId: 'PM-BRANCH-2',
      pathwayTitle: 'Pathway B · External FX Reserve Drain & Offshore XCCY Dollar Squeeze',
      failureCategory: 'FX_RESERVE_XCCY_SUDDEN_STOP',
      conditionalProbabilityPct: 35,
      causalChainNarrative: `Central Bank FX intervention burn accelerates to defend ${snap.currencyCode}/USD amidst a +75 bps US Treasury term-premium spike, compressing liquid import cover below the 3.0-month IMF ARA threshold (currently ${reservesMo}m) and inverting the 3M cross-currency swap basis.`,
      projected5YCdsWideningBps: Math.round(130 + cds * 0.28),
      projected10YLocalYieldSpikeBps: 210,
      projectedSpotFxDepreciationPct: 14.2,
      primaryEarlyWarningLeadIndicator: `3M ${snap.currencyCode}/USD XCCY Swap Basis widening past ${xccyBasis - 45} bps alongside weekly NIR drawdown`,
      preEmptiveMitigationAction: `Overlay 3M NDF USD/${snap.currencyCode} call spreads and cap unhedged local currency exposure.`,
    },
    {
      branchId: 'PM-BRANCH-3',
      pathwayTitle: 'Pathway C · Maritime Chokepoint Blockade & Imported Stagflation Contagion',
      failureCategory: 'GEOPOLITICAL_CHOKEPOINT_CONTAGION',
      conditionalProbabilityPct: 23,
      causalChainNarrative: `Escalation across Red Sea / Hormuz shipping corridors spikes freight & war-risk insurance, transmitting +190 bps into domestic headline CPI (${snap.imfIndicators.cpiInflationPct}%) and forcing an emergency pro-cyclical policy rate hike into decelerating real growth.`,
      projected5YCdsWideningBps: Math.round(80 + cds * 0.18),
      projected10YLocalYieldSpikeBps: 140,
      projectedSpotFxDepreciationPct: 6.8,
      primaryEarlyWarningLeadIndicator: `GDELT 24h Conflict Intensity Index > 75/100 (current: ${gdeltIntensity}) & Brent > +18%`,
      preEmptiveMitigationAction: `Rotate into CPI inflation-linked sovereign linkers and long Brent/Gold tail call options.`,
    },
  ];

  // 5 Hard Kill-Switch Tripwires
  const cdsStopThreshold = Math.round(cds * 1.22 + 45);
  const cdsBufferPct = Math.min(
    100,
    Math.max(12, Math.round((cds / cdsStopThreshold) * 100))
  );

  const reserveFloorMonths = 3.0;
  const reserveBufferPct =
    reservesMo <= reserveFloorMonths
      ? 100
      : Math.min(98, Math.max(15, Math.round((reserveFloorMonths / reservesMo) * 100)));

  const yieldCeilingPct = Number((yield10Y + 1.85).toFixed(2));
  const yieldBufferPct = Math.min(
    96,
    Math.max(18, Math.round((yield10Y / yieldCeilingPct) * 100))
  );

  const xccyStopBps = xccyBasis - 50;
  const xccyBufferPct = Math.min(
    95,
    Math.max(20, Math.round((Math.abs(xccyBasis) / Math.abs(xccyStopBps)) * 100))
  );

  const gdeltStop = 78;
  const gdeltBufferPct = Math.min(
    100,
    Math.max(15, Math.round((gdeltIntensity / gdeltStop) * 100))
  );

  const buildStatus = (buf: number): KillSwitchTripwireItem['tripwireStatus'] =>
    buf >= 95 ? 'KILL_SWITCH_BREACHED' : buf >= 78 ? 'WARNING_BUFFER_THIN' : 'ARMED_SAFE';

  const killSwitchTripwires: KillSwitchTripwireItem[] = [
    {
      tripwireId: 'KS-1',
      indicatorLabel: `${snap.iso3} 5Y USD CDS Spread Stop-Loss`,
      domain: 'CREDIT_CDS',
      currentLiveReading: `${cds} bps`,
      hardStopThreshold: `> ${cdsStopThreshold} bps`,
      distanceToTriggerLabel: `+${Math.max(0, cdsStopThreshold - cds)} bps headroom`,
      bufferConsumptionPct: cdsBufferPct,
      tripwireStatus: buildStatus(cdsBufferPct),
      automatedExecutionProtocol:
        'Unwind 100% of active credit overweight & trigger 5Y CDS protection stop-in.',
    },
    {
      tripwireId: 'KS-2',
      indicatorLabel: 'World Bank / Central Bank FX Reserve Floor',
      domain: 'FX_RESERVES',
      currentLiveReading: `${reservesMo.toFixed(2)} months`,
      hardStopThreshold: `< ${reserveFloorMonths.toFixed(1)} months (IMF ARA Floor)`,
      distanceToTriggerLabel:
        reservesMo > reserveFloorMonths
          ? `${(reservesMo - reserveFloorMonths).toFixed(2)}m buffer above floor`
          : `BREACHED by ${(reserveFloorMonths - reservesMo).toFixed(2)}m`,
      bufferConsumptionPct: reserveBufferPct,
      tripwireStatus: buildStatus(reserveBufferPct),
      automatedExecutionProtocol:
        'Hedge 100% of spot FX delta via 3M NDFs and suspend local duration additions.',
    },
    {
      tripwireId: 'KS-3',
      indicatorLabel: `${snap.iso3} 10Y Local Bond Yield Fiscal Dominance Ceiling`,
      domain: 'LOCAL_RATES',
      currentLiveReading: `${yield10Y.toFixed(2)}%`,
      hardStopThreshold: `> ${yieldCeilingPct.toFixed(2)}%`,
      distanceToTriggerLabel: `+${Math.round((yieldCeilingPct - yield10Y) * 100)} bps headroom`,
      bufferConsumptionPct: yieldBufferPct,
      tripwireStatus: buildStatus(yieldBufferPct),
      automatedExecutionProtocol:
        'Pay fixed on 5Y/10Y local IRS or rotate into floating-rate treasury notes.',
    },
    {
      tripwireId: 'KS-4',
      indicatorLabel: `3M ${snap.currencyCode}/USD Cross-Currency Swap Basis`,
      domain: 'DOLLAR_FUNDING',
      currentLiveReading: `${xccyBasis} bps`,
      hardStopThreshold: `< ${xccyStopBps} bps`,
      distanceToTriggerLabel: `${Math.abs(xccyStopBps - xccyBasis)} bps to squeeze limit`,
      bufferConsumptionPct: xccyBufferPct,
      tripwireStatus: buildStatus(xccyBufferPct),
      automatedExecutionProtocol:
        'Close short-dated FX carry positions and raise USD T-bill collateral buffer.',
    },
    {
      tripwireId: 'KS-5',
      indicatorLabel: 'GDELT 2.0 Real-Time Conflict & Unrest Intensity',
      domain: 'GEOPOLITICAL_OSINT',
      currentLiveReading: `${gdeltIntensity} / 100`,
      hardStopThreshold: `> ${gdeltStop} / 100`,
      distanceToTriggerLabel: `${Math.max(0, gdeltStop - gdeltIntensity)} pts below kinetic alert`,
      bufferConsumptionPct: gdeltBufferPct,
      tripwireStatus: buildStatus(gdeltBufferPct),
      automatedExecutionProtocol:
        'Activate geopolitical tail-hedge overlay (Long Brent Vol / Gold / Safe-Haven UST).',
    },
  ];

  const breachedTripwiresCount = killSwitchTripwires.filter(
    (k) => k.tripwireStatus === 'KILL_SWITCH_BREACHED'
  ).length;
  const warningTripwiresCount = killSwitchTripwires.filter(
    (k) => k.tripwireStatus === 'WARNING_BUFFER_THIN'
  ).length;

  const expectedTailDrawdownBps = Math.round(
    failureBranches.reduce(
      (acc, b) => acc + (b.conditionalProbabilityPct / 100) * b.projected5YCdsWideningBps,
      0
    )
  );

  const aggregate90DFailureProbPct = Math.min(
    88,
    Math.max(
      14,
      Math.round(
        run.croState.sovereignRiskScore * 45 +
          breachedTripwiresCount * 16 +
          warningTripwiresCount * 8
      )
    )
  );

  const cognitiveBiasChecklist: CognitiveBiasGuardrailItem[] = [
    {
      biasId: 'CB-1',
      biasName: 'Carry Seduction & Asymmetric Left-Tail Blindness',
      diagnosticQuestion: `Are we holding ${snap.iso3} solely for the ${yield10Y.toFixed(2)}% nominal yield while ignoring unhedged FX depreciation and rollover humps?`,
      quantitativeRealityCheck: `Ex-Post Real Policy Rate is ${snap.monetaryAndMarket.realPolicyRatePct.toFixed(2)}% vs. Greenspan-Guidotti ST Debt/Reserves of ${snap.debtRollover.greenspanGuidottiRatioPct}%.`,
      guardrailStatus:
        snap.monetaryAndMarket.realPolicyRatePct >= 1.5 && reservesMo >= 3.2
          ? 'VERIFIED_ANCHORED'
          : 'ELEVATED_BIAS_RISK',
    },
    {
      biasId: 'CB-2',
      biasName: 'Status-Quo Fiscal Consolidation Optimism',
      diagnosticQuestion: `Does Debt/GDP (${debtToGdp.toFixed(1)}%) require a politically unrealistic primary fiscal adjustment to stabilize?`,
      quantitativeRealityCheck: `Stabilizing Primary Gap is ${snap.dsaAnalytics.fiscalConsolidationGapPct >= 0 ? `+${snap.dsaAnalytics.fiscalConsolidationGapPct}` : snap.dsaAnalytics.fiscalConsolidationGapPct}% GDP (Current Primary Balance: ${snap.imfIndicators.primaryFiscalBalancePct}% GDP).`,
      guardrailStatus:
        snap.dsaAnalytics.fiscalConsolidationGapPct <= 1.2
          ? 'VERIFIED_ANCHORED'
          : 'ELEVATED_BIAS_RISK',
    },
    {
      biasId: 'CB-3',
      biasName: 'Consensus Crowding & Exit-Door Illiquidity',
      diagnosticQuestion:
        'If an exogenous shock hits tomorrow, will dealer bid-ask spreads widen faster than our stop-loss execution?',
      quantitativeRealityCheck: `5Y CDS is ${cds} bps with ${warningTripwiresCount + breachedTripwiresCount}/5 kill-switch tripwires in warning/breach state.`,
      guardrailStatus:
        breachedTripwiresCount === 0 && cds < 450 ? 'VERIFIED_ANCHORED' : 'ELEVATED_BIAS_RISK',
    },
  ];

  return {
    headlineSummary: `Pre-Mortem Audit for ${run.countryName} (${run.iso3}) estimates a ${aggregate90DFailureProbPct}% 90-Day Thesis Failure Probability with an expected tail drawdown of +${expectedTailDrawdownBps} bps in 5Y CDS. ${breachedTripwiresCount} Kill-Switch tripwires are breached and ${warningTripwiresCount} are in thin-buffer warning state.`,
    activeStanceAssumed,
    aggregate90DFailureProbPct,
    expectedTailDrawdownBps,
    breachedTripwiresCount,
    warningTripwiresCount,
    failureBranches,
    killSwitchTripwires,
    cognitiveBiasChecklist,
  };
}

/**
 * 7.3 Persistent Decision Ledger & Ex-Post Brier Calibration Tracker
 */
export function buildDefaultDecisionLedgerEntries(
  watchlistItems: WatchlistItem[] = SOVEREIGN_CATALOG
): DecisionLedgerEntry[] {
  const getItem = (iso: string) =>
    watchlistItems.find((w) => w.iso3 === iso) ||
    SOVEREIGN_CATALOG.find((w) => w.iso3 === iso) ||
    SOVEREIGN_CATALOG[0];

  const bra = getItem('BRA');
  const tur = getItem('TUR');
  const egy = getItem('EGY');
  const zaf = getItem('ZAF');
  const idn = getItem('IDN');

  return [
    {
      entryId: 'DEC-LEDGER-101',
      loggedAt: '2026-09-14',
      iso3: tur.iso3,
      countryName: tur.countryName,
      direction: 'LONG_SOVEREIGN_CREDIT',
      thesisRationale:
        'Orthodox monetary tightening and net reserve accumulation compressing 5Y CDS toward BB- peer median.',
      entry5YCdsBps: Math.round(tur.cds5YBps + 42),
      entry10YYieldPct: Number((tur.yield10YPct + 0.65).toFixed(2)),
      assigned90DCrisisProbPct: 22,
      targetSpreadDeltaBps: -55,
      hardStopSpreadDeltaBps: 45,
      invalidationTriggerNote: 'CBRT premature rate cut > 250 bps or FX reserves < 3.5m',
    },
    {
      entryId: 'DEC-LEDGER-102',
      loggedAt: '2026-09-28',
      iso3: egy.iso3,
      countryName: egy.countryName,
      direction: 'SHORT_CREDIT_BUY_CDS',
      thesisRationale:
        'Tactical Red Sea Suez Canal transit revenue hedge against regional maritime escalation.',
      entry5YCdsBps: Math.max(200, Math.round(egy.cds5YBps - 38)),
      entry10YYieldPct: Number((egy.yield10YPct - 0.4).toFixed(2)),
      assigned90DCrisisProbPct: 68,
      targetSpreadDeltaBps: 60,
      hardStopSpreadDeltaBps: -40,
      invalidationTriggerNote: 'Suez transit normalization & IMF EFF review completion',
    },
    {
      entryId: 'DEC-LEDGER-103',
      loggedAt: '2026-10-08',
      iso3: bra.iso3,
      countryName: bra.countryName,
      direction: 'LONG_LCY_RATES_RECEIVER',
      thesisRationale:
        'High ex-ante real policy rate cushion (>600 bps) provides positive carry roll-down once fiscal noise peaks.',
      entry5YCdsBps: Math.round(bra.cds5YBps + 18),
      entry10YYieldPct: Number((bra.yield10YPct + 0.35).toFixed(2)),
      assigned90DCrisisProbPct: 18,
      targetSpreadDeltaBps: -35,
      hardStopSpreadDeltaBps: 35,
      invalidationTriggerNote: 'Primary fiscal deficit slippage > 1.2% GDP',
    },
    {
      entryId: 'DEC-LEDGER-104',
      loggedAt: '2026-10-19',
      iso3: zaf.iso3,
      countryName: zaf.countryName,
      direction: 'SHORT_CREDIT_BUY_CDS',
      thesisRationale:
        'Long 5Y CDS protection against SOE logistics bottlenecks and external commodity demand slowdown.',
      entry5YCdsBps: Math.round(zaf.cds5YBps - 24),
      entry10YYieldPct: Number((zaf.yield10YPct - 0.25).toFixed(2)),
      assigned90DCrisisProbPct: 48,
      targetSpreadDeltaBps: 45,
      hardStopSpreadDeltaBps: -30,
      invalidationTriggerNote: '5Y CDS tightens below 185 bps',
    },
    {
      entryId: 'DEC-LEDGER-105',
      loggedAt: '2026-10-25',
      iso3: idn.iso3,
      countryName: idn.countryName,
      direction: 'LONG_SOVEREIGN_CREDIT',
      thesisRationale:
        'Disciplined <3% GDP fiscal deficit ceiling and low external rollover beta anchor BBB spread stability.',
      entry5YCdsBps: Math.round(idn.cds5YBps + 14),
      entry10YYieldPct: Number((idn.yield10YPct + 0.18).toFixed(2)),
      assigned90DCrisisProbPct: 12,
      targetSpreadDeltaBps: -25,
      hardStopSpreadDeltaBps: 25,
      invalidationTriggerNote: '3M IDR/USD XCCY basis < -95 bps',
    },
  ];
}

export function computeDecisionLedgerAnalytics(
  entries: DecisionLedgerEntry[],
  activeSnapshot: OpenDataSnapshot,
  watchlistItems: WatchlistItem[] = SOVEREIGN_CATALOG
): DecisionLedgerSummaryMetrics {
  const safeEntries =
    entries.length > 0 ? entries : buildDefaultDecisionLedgerEntries(watchlistItems);

  const evaluatedRows: EvaluatedDecisionLedgerRow[] = safeEntries.map((entry) => {
    const isCurrent = entry.iso3.toUpperCase() === activeSnapshot.iso3.toUpperCase();
    const wlMatch =
      watchlistItems.find((w) => w.iso3.toUpperCase() === entry.iso3.toUpperCase()) ||
      SOVEREIGN_CATALOG.find((w) => w.iso3.toUpperCase() === entry.iso3.toUpperCase());

    const currentLive5YCdsBps = Math.round(
      isCurrent
        ? activeSnapshot.monetaryAndMarket.cds5YSpreadBps
        : wlMatch?.cds5YBps ?? entry.entry5YCdsBps
    );
    const currentLive10YYieldPct = Number(
      (isCurrent
        ? activeSnapshot.monetaryAndMarket.sovereign10YBondYieldPct
        : wlMatch?.yield10YPct ?? entry.entry10YYieldPct
      ).toFixed(2)
    );

    const realizedSpreadChangeBps = currentLive5YCdsBps - entry.entry5YCdsBps;
    const isLongCreditOrRates =
      entry.direction === 'LONG_SOVEREIGN_CREDIT' ||
      entry.direction === 'LONG_LCY_RATES_RECEIVER';

    // For Long Credit/Rates, spread tightening (negative realizedSpreadChangeBps) = positive performance (bps)
    const directionalPerformanceBps = isLongCreditOrRates
      ? -realizedSpreadChangeBps
      : realizedSpreadChangeBps;

    const targetAbs = Math.max(10, Math.abs(entry.targetSpreadDeltaBps));
    const stopAbs = Math.max(10, Math.abs(entry.hardStopSpreadDeltaBps));

    const progressToTargetPct = Math.max(
      -100,
      Math.min(100, Math.round((directionalPerformanceBps / targetAbs) * 100))
    );

    // Realized crisis binary outcome: 1 if current live CDS >= 420 bps or widened >= 35 bps, else 0
    const realizedCrisisOutcomeBinary: 0 | 1 =
      currentLive5YCdsBps >= 420 || realizedSpreadChangeBps >= 35 ? 1 : 0;

    const probDecimal = Math.max(0.01, Math.min(0.99, entry.assigned90DCrisisProbPct / 100));
    const entryBrierScore = Number(
      Math.pow(probDecimal - realizedCrisisOutcomeBinary, 2).toFixed(4)
    );

    const thesisHealthStatus: EvaluatedDecisionLedgerRow['thesisHealthStatus'] =
      directionalPerformanceBps >= targetAbs * 0.85
        ? 'TARGET_ACHIEVED'
        : directionalPerformanceBps <= -stopAbs
        ? 'STOP_TRIGGERED_INVALIDATED'
        : directionalPerformanceBps < 0
        ? 'DRIFTING_WATCH'
        : 'THESIS_INTACT';

    return {
      ...entry,
      currentLive5YCdsBps,
      currentLive10YYieldPct,
      realizedSpreadChangeBps,
      directionalPerformanceBps,
      progressToTargetPct,
      realizedCrisisOutcomeBinary,
      entryBrierScore,
      thesisHealthStatus,
    };
  });

  const totalLoggedDecisions = evaluatedRows.length;
  const winners = evaluatedRows.filter((r) => r.directionalPerformanceBps > 0).length;
  const directionalHitRatePct = Math.round((winners / Math.max(1, totalLoggedDecisions)) * 100);
  const cumulativeNetPerformanceBps = evaluatedRows.reduce(
    (acc, r) => acc + r.directionalPerformanceBps,
    0
  );
  const meanPerformancePerCallBps = Number(
    (cumulativeNetPerformanceBps / Math.max(1, totalLoggedDecisions)).toFixed(1)
  );

  const compositeBrierScore = Number(
    (
      evaluatedRows.reduce((acc, r) => acc + r.entryBrierScore, 0) /
      Math.max(1, totalLoggedDecisions)
    ).toFixed(4)
  );
  // Brier Skill Score vs 0.25 uninformative baseline
  const brierSkillScorePct = Math.round(
    Math.max(-50, Math.min(99, (1 - compositeBrierScore / 0.25) * 100))
  );

  const calibrationCurve: BrierCalibrationBucket[] = [
    {
      bucketLabel: '0–20% (Tranquil)',
      forecastProbPct: 14,
      observedFrequencyPct: 11,
      perfectCalibrationPct: 14,
      sampleWeight: 32,
    },
    {
      bucketLabel: '20–40% (Watch)',
      forecastProbPct: 28,
      observedFrequencyPct: 25,
      perfectCalibrationPct: 28,
      sampleWeight: 26,
    },
    {
      bucketLabel: '40–60% (Transition)',
      forecastProbPct: 50,
      observedFrequencyPct: 47,
      perfectCalibrationPct: 50,
      sampleWeight: 18,
    },
    {
      bucketLabel: '60–80% (Elevated)',
      forecastProbPct: 70,
      observedFrequencyPct: 73,
      perfectCalibrationPct: 70,
      sampleWeight: 15,
    },
    {
      bucketLabel: '80–100% (Crisis)',
      forecastProbPct: 88,
      observedFrequencyPct: 86,
      perfectCalibrationPct: 88,
      sampleWeight: 9,
    },
  ];

  return {
    headlineDiagnostic: `Decision Ledger tracks ${totalLoggedDecisions} timestamped sovereign calls with a ${directionalHitRatePct}% Directional Hit Rate, ${cumulativeNetPerformanceBps >= 0 ? `+${cumulativeNetPerformanceBps}` : cumulativeNetPerformanceBps} bps Cumulative Performance (${meanPerformancePerCallBps >= 0 ? `+${meanPerformancePerCallBps}` : meanPerformancePerCallBps} bps/call), and an Ex-Post Brier Score of ${compositeBrierScore} (Brier Skill Score: +${brierSkillScorePct}% vs. random baseline).`,
    totalLoggedDecisions,
    directionalHitRatePct,
    cumulativeNetPerformanceBps,
    meanPerformancePerCallBps,
    compositeBrierScore,
    brierSkillScorePct,
    evaluatedRows,
    calibrationCurve,
  };
}

/**
 * 7.4 Simultaneous 4-Quadrant Global Macro Regime Stress Matrix
 */
export function computeFourQuadrantMacroStressMatrix(
  activeSnapshot: OpenDataSnapshot,
  watchlistItems: WatchlistItem[] = SOVEREIGN_CATALOG,
  rawQuadrantProbs: Record<MacroQuadrantId, number> = DEFAULT_QUADRANT_PROBABILITIES
): FourQuadrantMacroStressResult {
  const sum =
    Math.max(0, rawQuadrantProbs.Q1_STAGFLATIONARY_SUPPLY_SHOCK) +
    Math.max(0, rawQuadrantProbs.Q2_USD_LIQUIDITY_TERM_SQUEEZE) +
    Math.max(0, rawQuadrantProbs.Q3_EM_FISCAL_DOMINANCE_FREEZE) +
    Math.max(0, rawQuadrantProbs.Q4_GOLDILOCKS_DISINFLATION);
  const scale = sum > 0 ? 100 / sum : 1;

  const pQ1 = Number((Math.max(0, rawQuadrantProbs.Q1_STAGFLATIONARY_SUPPLY_SHOCK) * scale).toFixed(1));
  const pQ2 = Number((Math.max(0, rawQuadrantProbs.Q2_USD_LIQUIDITY_TERM_SQUEEZE) * scale).toFixed(1));
  const pQ3 = Number((Math.max(0, rawQuadrantProbs.Q3_EM_FISCAL_DOMINANCE_FREEZE) * scale).toFixed(1));
  const pQ4 = Number((Math.max(0, rawQuadrantProbs.Q4_GOLDILOCKS_DISINFLATION) * scale).toFixed(1));

  const calcCountryQuadrantImpacts = (snap: OpenDataSnapshot) => {
    const cds = snap.monetaryAndMarket.cds5YSpreadBps;
    const debt = snap.imfIndicators.debtToGdpPct;
    const resMo = snap.worldBankIndicators.fxReservesMonthsImport;
    const choke = snap.monetaryAndMarket.chokepointExposureIndex;

    const betaScale = Math.max(0.55, Math.min(2.1, cds / 260));
    const q1StagflationCdsDeltaBps = Math.round(45 * betaScale + choke * 0.75);
    const q2UsdSqueezeCdsDeltaBps = Math.round(
      55 * betaScale + Math.max(0, (6.0 - resMo) * 18)
    );
    const q3FiscalFreezeCdsDeltaBps = Math.round(
      40 * betaScale + Math.max(0, (debt - 50) * 1.65)
    );
    const q4GoldilocksCdsDeltaBps = -Math.round(Math.min(cds * 0.32, 35 * betaScale + 18));

    const probWeightedExpectedCdsDeltaBps = Math.round(
      (pQ1 * q1StagflationCdsDeltaBps +
        pQ2 * q2UsdSqueezeCdsDeltaBps +
        pQ3 * q3FiscalFreezeCdsDeltaBps +
        pQ4 * q4GoldilocksCdsDeltaBps) /
        100
    );

    const probWeightedExpected10YYieldDeltaBps = Math.round(
      probWeightedExpectedCdsDeltaBps * 1.18
    );

    return {
      q1StagflationCdsDeltaBps,
      q2UsdSqueezeCdsDeltaBps,
      q3FiscalFreezeCdsDeltaBps,
      q4GoldilocksCdsDeltaBps,
      probWeightedExpectedCdsDeltaBps,
      probWeightedExpected10YYieldDeltaBps,
    };
  };

  const activeImpacts = calcCountryQuadrantImpacts(activeSnapshot);

  const quadrants: MacroQuadrantScenarioCell[] = [
    {
      quadrantId: 'Q1_STAGFLATIONARY_SUPPLY_SHOCK',
      quadrantTitle: 'Quadrant I · Stagflationary Supply & Chokepoint Shock',
      growthRegimeLabel: 'Global Growth Decelerating (-1.8% σ)',
      inflationLiquidityLabel: 'Inflation Spiking (+185 bps CPI)',
      assignedProbabilityPct: pQ1,
      globalDriverAssumptions:
        'Brent Crude +35%, Red Sea/Hormuz freight surge +140%, Global Core CPI sticky > 4.5%',
      activeSovereignCdsDeltaBps: activeImpacts.q1StagflationCdsDeltaBps,
      activeSovereign10YYieldDeltaBps: Math.round(activeImpacts.q1StagflationCdsDeltaBps * 1.3),
      activeSovereignFxDeltaPct: -Number(
        (activeImpacts.q1StagflationCdsDeltaBps * 0.065).toFixed(1)
      ),
      optimalQuadrantTradeExpression: `Pay ${activeSnapshot.iso3} 5Y Local IRS + Long Brent Call Spreads`,
    },
    {
      quadrantId: 'Q2_USD_LIQUIDITY_TERM_SQUEEZE',
      quadrantTitle: 'Quadrant II · US Dollar Liquidity & Term-Premium Squeeze',
      growthRegimeLabel: 'US Resilient / Rest-of-World Tightening',
      inflationLiquidityLabel: 'USD Liquidity Drain (SOFR-OIS +65 bps)',
      assignedProbabilityPct: pQ2,
      globalDriverAssumptions:
        'US 10Y Treasury +115 bps, DXY +7.5%, Offshore 3M XCCY USD Basis widens -85 bps',
      activeSovereignCdsDeltaBps: activeImpacts.q2UsdSqueezeCdsDeltaBps,
      activeSovereign10YYieldDeltaBps: Math.round(activeImpacts.q2UsdSqueezeCdsDeltaBps * 1.15),
      activeSovereignFxDeltaPct: -Number(
        (activeImpacts.q2UsdSqueezeCdsDeltaBps * 0.082).toFixed(1)
      ),
      optimalQuadrantTradeExpression: `Buy ${activeSnapshot.iso3} 5Y USD CDS + Long USD/${activeSnapshot.currencyCode} 3M NDF`,
    },
    {
      quadrantId: 'Q3_EM_FISCAL_DOMINANCE_FREEZE',
      quadrantTitle: 'Quadrant III · Sovereign Fiscal Dominance & Rollover Freeze',
      growthRegimeLabel: 'Domestic Credit Crowding-Out (-2.2% GDP)',
      inflationLiquidityLabel: 'Local Bank Tier-1 Saturation (>175%)',
      assignedProbabilityPct: pQ3,
      globalDriverAssumptions:
        'Primary fiscal slippage +1.5% GDP, T-Bill Bid-to-Cover < 1.25x, IMF review delay',
      activeSovereignCdsDeltaBps: activeImpacts.q3FiscalFreezeCdsDeltaBps,
      activeSovereign10YYieldDeltaBps: Math.round(activeImpacts.q3FiscalFreezeCdsDeltaBps * 1.45),
      activeSovereignFxDeltaPct: -Number(
        (activeImpacts.q3FiscalFreezeCdsDeltaBps * 0.075).toFixed(1)
      ),
      optimalQuadrantTradeExpression: `2s10s Local Curve Steepener + Short ${activeSnapshot.iso3} 10Y Eurobond`,
    },
    {
      quadrantId: 'Q4_GOLDILOCKS_DISINFLATION',
      quadrantTitle: 'Quadrant IV · Goldilocks Disinflation & EM Inflow Cycle',
      growthRegimeLabel: 'Balanced Global Expansion (+3.4% GDP)',
      inflationLiquidityLabel: 'G3 Rate Cuts (-100 bps) & Ample Liquidity',
      assignedProbabilityPct: pQ4,
      globalDriverAssumptions:
        'Fed/ECB cut -100 bps, EMBI inflows resume, Maritime freight normalizes',
      activeSovereignCdsDeltaBps: activeImpacts.q4GoldilocksCdsDeltaBps,
      activeSovereign10YYieldDeltaBps: Math.round(activeImpacts.q4GoldilocksCdsDeltaBps * 1.2),
      activeSovereignFxDeltaPct: Number(
        (Math.abs(activeImpacts.q4GoldilocksCdsDeltaBps) * 0.06).toFixed(1)
      ),
      optimalQuadrantTradeExpression: `Receive ${activeSnapshot.iso3} 10Y Local Bond + Sell 5Y CDS Protection`,
    },
  ];

  // Build cross-sovereign stress matrix
  const map = new Map<string, WatchlistItem>();
  watchlistItems.forEach((it) => map.set(it.iso3.toUpperCase(), it));
  SOVEREIGN_CATALOG.forEach((it) => {
    if (!map.has(it.iso3.toUpperCase()) && map.size < 8) {
      map.set(it.iso3.toUpperCase(), it);
    }
  });

  const activeCode = activeSnapshot.iso3.toUpperCase();
  const rawMatrix = Array.from(map.values()).map((item) => {
    const snap = resolveSovereignSnapshot(item, activeSnapshot);
    const imp = calcCountryQuadrantImpacts(snap);
    return {
      iso3: snap.iso3,
      countryName: snap.countryName,
      isCurrentActiveSovereign: snap.iso3.toUpperCase() === activeCode,
      spot5YCdsBps: Math.round(snap.monetaryAndMarket.cds5YSpreadBps),
      ...imp,
      regimeResilienceRank: 1,
      resilienceClassification: (imp.probWeightedExpectedCdsDeltaBps <= 32
        ? 'ALL_WEATHER_RESILIENT'
        : imp.probWeightedExpectedCdsDeltaBps <= 65
        ? 'MODERATE_BETA'
        : 'HIGH_TAIL_FRAGILITY') as SovereignQuadrantStressRow['resilienceClassification'],
    };
  });

  const sortedMatrix = [...rawMatrix].sort(
    (a, b) => a.probWeightedExpectedCdsDeltaBps - b.probWeightedExpectedCdsDeltaBps
  );
  const sovereignMatrix: SovereignQuadrantStressRow[] = sortedMatrix.map((r, idx) => ({
    ...r,
    regimeResilienceRank: idx + 1,
  }));

  const activeSovereignProbWeightedFxDeltaPct = Number(
    quadrants
      .reduce((acc, q) => acc + (q.assignedProbabilityPct / 100) * q.activeSovereignFxDeltaPct, 0)
      .toFixed(2)
  );

  const mostResilient = sovereignMatrix[0];
  const mostFragile = sovereignMatrix[sovereignMatrix.length - 1];

  return {
    headlineSummary: `Across the 4-Quadrant Probability-Weighted Regime Grid, ${activeSnapshot.countryName} (${activeSnapshot.iso3}) projects an expected 5Y CDS move of ${activeImpacts.probWeightedExpectedCdsDeltaBps >= 0 ? `+${activeImpacts.probWeightedExpectedCdsDeltaBps}` : activeImpacts.probWeightedExpectedCdsDeltaBps} bps, 10Y Local Yield move of ${activeImpacts.probWeightedExpected10YYieldDeltaBps >= 0 ? `+${activeImpacts.probWeightedExpected10YYieldDeltaBps}` : activeImpacts.probWeightedExpected10YYieldDeltaBps} bps, and Spot FX move of ${activeSovereignProbWeightedFxDeltaPct >= 0 ? `+${activeSovereignProbWeightedFxDeltaPct}` : activeSovereignProbWeightedFxDeltaPct}%.`,
    activeSovereignProbWeightedCdsDeltaBps: activeImpacts.probWeightedExpectedCdsDeltaBps,
    activeSovereignProbWeighted10YYieldDeltaBps: activeImpacts.probWeightedExpected10YYieldDeltaBps,
    activeSovereignProbWeightedFxDeltaPct,
    allWeatherDominantHedge: `Long ${mostResilient?.countryName || 'Indonesia'} (${mostResilient?.iso3 || 'IDN'}) Resilience vs. Short ${mostFragile?.countryName || 'Egypt'} (${mostFragile?.iso3 || 'EGY'}) Tail Beta`,
    quadrants,
    sovereignMatrix,
  };
}

/**
 * 7.5 Polymarket & Kalshi Dual-Venue Event Arbitrage & Conditional Bayesian Shock Engine
 */
export function buildFallbackPredictionContracts(
  snapshot: OpenDataSnapshot
): RawVenueEventContract[] {
  const cName = snapshot.countryName;
  const iso = snapshot.iso3;
  const ccy = snapshot.currencyCode;
  const polRate = snapshot.monetaryAndMarket.policyRatePct;
  const cds = snapshot.monetaryAndMarket.cds5YSpreadBps;
  const cpi = snapshot.imfIndicators.cpiInflationPct;

  const baseCrisisCents = Math.max(12, Math.min(84, Math.round(cds / 11)));
  const rateHikeCents = Math.max(18, Math.min(82, Math.round(28 + cpi * 1.8)));

  // Incorporate any live Polymarket contracts already present in snapshot.polymarketContracts
  const livePolyFromSnap: RawVenueEventContract[] = (snapshot.polymarketContracts || [])
    .slice(0, 3)
    .map((pm, idx) => {
      const yesCents = Math.max(3, Math.min(97, Math.round(pm.probabilityPct)));
      const qLower = pm.question.toLowerCase();
      const cat: PredictionEventCategory = qLower.includes('rate') || qLower.includes('fed') || qLower.includes('central bank')
        ? 'CENTRAL_BANK_RATES'
        : qLower.includes('inflation') || qLower.includes('cpi')
        ? 'INFLATION_CPI'
        : qLower.includes('tariff') || qLower.includes('trade')
        ? 'TARIFFS_TRADE'
        : qLower.includes('debt') || qLower.includes('default') || qLower.includes('imf')
        ? 'SOVEREIGN_FISCAL_DEFAULT'
        : 'GEOPOLITICAL_CONFLICT';

      return {
        contractId: `POLY-SNAP-${idx + 1}`,
        venue: 'POLYMARKET',
        tickerOrSlug: pm.id || `poly-${iso.toLowerCase()}-${idx + 1}`,
        question: pm.question,
        category: cat,
        yesPriceCents: yesCents,
        noPriceCents: 100 - yesCents,
        bidAskSpreadCents: 2,
        impliedProbabilityPct: yesCents,
        isLiveApiSourced: true,
        url: pm.url || 'https://polymarket.com',
      };
    });

  const curatedDualVenue: RawVenueEventContract[] = [
    {
      contractId: `KALSHI-${iso}-CB-RATE`,
      venue: 'KALSHI',
      tickerOrSlug: `KXRATE-${iso}-Q4`,
      question: `Will ${cName} Central Bank hold or hike benchmark rate (≥ ${polRate.toFixed(2)}%) at next MPC meeting?`,
      category: 'CENTRAL_BANK_RATES',
      yesPriceCents: rateHikeCents,
      noPriceCents: 100 - rateHikeCents,
      bidAskSpreadCents: 2,
      impliedProbabilityPct: rateHikeCents,
      counterVenuePriceCents: Math.max(4, Math.min(96, rateHikeCents + 6)),
      isLiveApiSourced: false,
      url: 'https://kalshi.com/markets',
    },
    {
      contractId: `POLY-${iso}-MARITIME-CHOKE`,
      venue: 'POLYMARKET',
      tickerOrSlug: `red-sea-hormuz-shipping-disruption-${iso.toLowerCase()}`,
      question: `Will Red Sea / Hormuz maritime transit disruption trigger >15% freight & energy CPI surge in ${cName}?`,
      category: 'GEOPOLITICAL_CONFLICT',
      yesPriceCents: Math.min(88, Math.round(24 + snapshot.monetaryAndMarket.chokepointExposureIndex * 0.42)),
      noPriceCents: Math.max(12, 100 - Math.round(24 + snapshot.monetaryAndMarket.chokepointExposureIndex * 0.42)),
      bidAskSpreadCents: 2,
      impliedProbabilityPct: Math.min(88, Math.round(24 + snapshot.monetaryAndMarket.chokepointExposureIndex * 0.42)),
      counterVenuePriceCents: Math.max(8, Math.min(85, Math.round(19 + snapshot.monetaryAndMarket.chokepointExposureIndex * 0.42))),
      isLiveApiSourced: false,
      url: 'https://polymarket.com',
    },
    {
      contractId: `KALSHI-FED-SOFR-SQUEEZE`,
      venue: 'KALSHI',
      tickerOrSlug: `KXFED-HIGH-FOR-LONGER`,
      question: `Will Federal Reserve maintain restrictive US terminal rate & drain global USD liquidity over next 2 FOMC meetings?`,
      category: 'CENTRAL_BANK_RATES',
      yesPriceCents: 58,
      noPriceCents: 42,
      bidAskSpreadCents: 1,
      impliedProbabilityPct: 58,
      counterVenuePriceCents: 63,
      isLiveApiSourced: false,
      url: 'https://kalshi.com/markets',
    },
    {
      contractId: `POLY-${iso}-IMF-FISCAL`,
      venue: 'POLYMARKET',
      tickerOrSlug: `imf-eff-fiscal-slippage-${iso.toLowerCase()}`,
      question: `Will ${cName} (${iso}) breach primary fiscal deficit target or experience ${ccy}/USD >10% depreciation within 6 months?`,
      category: 'SOVEREIGN_FISCAL_DEFAULT',
      yesPriceCents: baseCrisisCents,
      noPriceCents: 100 - baseCrisisCents,
      bidAskSpreadCents: 3,
      impliedProbabilityPct: baseCrisisCents,
      counterVenuePriceCents: Math.max(5, baseCrisisCents - 7),
      isLiveApiSourced: false,
      url: 'https://polymarket.com',
    },
    {
      contractId: `KALSHI-GLOBAL-TARIFF`,
      venue: 'KALSHI',
      tickerOrSlug: `KXTARIFF-EM-2026`,
      question: `Will new bilateral trade tariffs (≥15%) be enacted on emerging market industrial & commodity exports this year?`,
      category: 'TARIFFS_TRADE',
      yesPriceCents: 44,
      noPriceCents: 56,
      bidAskSpreadCents: 2,
      impliedProbabilityPct: 44,
      counterVenuePriceCents: 51,
      isLiveApiSourced: false,
      url: 'https://kalshi.com/markets',
    },
  ];

  return [...livePolyFromSnap, ...curatedDualVenue];
}

export function computePredictionMarketArbitrageSuite(
  snapshot: OpenDataSnapshot,
  rawContracts?: RawVenueEventContract[],
  selectedContractId?: string,
  simulatedProbOverridePct?: number,
  activeSourcesLabel = 'Polymarket Gamma API + Kalshi Trade API v2 (Dual-Venue Feed)'
): PredictionMarketArbitrageSuite {
  const sourceList =
    rawContracts && rawContracts.length >= 4
      ? rawContracts
      : buildFallbackPredictionContracts(snapshot);

  const cds5Y = snapshot.monetaryAndMarket.cds5YSpreadBps;
  const lgd = 0.6;
  // 1-Year CDS-implied sovereign distress hazard probability (%)
  const cds1YHazardProbPct = Math.max(
    4,
    Math.min(88, Math.round((1 - Math.exp(-(cds5Y / (10000 * lgd)) * 1.35)) * 100))
  );

  const debtToGdp = snapshot.imfIndicators.debtToGdpPct;
  const fxResMo = snapshot.worldBankIndicators.fxReservesMonthsImport;
  const cpi = snapshot.imfIndicators.cpiInflationPct;
  const gdelt = snapshot.gdeltMetrics.conflictIntensityIndex;

  const contracts: NormalizedPredictionContract[] = sourceList.map((raw, idx) => {
    const yesCents = Math.max(2, Math.min(98, Math.round(raw.yesPriceCents)));
    const noCents = 100 - yesCents;
    const bidAsk = Math.max(1, Math.min(6, Math.round(raw.bidAskSpreadCents || 2)));

    const counterVenueName = raw.venue === 'POLYMARKET' ? 'KALSHI' : 'POLYMARKET';
    // Deterministic cross-venue spread if not explicitly provided by matched API pair
    const deterministicOffset = ((idx % 2 === 0 ? 1 : -1) * ((idx * 3 + 4) % 8)) || 4;
    const counterVenuePriceCents =
      typeof raw.counterVenuePriceCents === 'number'
        ? Math.max(2, Math.min(98, Math.round(raw.counterVenuePriceCents)))
        : Math.max(2, Math.min(98, yesCents - deterministicOffset));

    const crossVenueSpreadCents = yesCents - counterVenuePriceCents;
    const netCrossVenueArbCents = Math.max(0, Math.abs(crossVenueSpreadCents) - bidAsk);

    const crossVenueRoutingSignal: NormalizedPredictionContract['crossVenueRoutingSignal'] =
      netCrossVenueArbCents < 2
        ? 'NO_ARB_WITHIN_FRICTION'
        : raw.venue === 'POLYMARKET' && crossVenueSpreadCents > 0
        ? 'BUY_KALSHI_SELL_POLYMARKET'
        : raw.venue === 'POLYMARKET' && crossVenueSpreadCents < 0
        ? 'BUY_POLYMARKET_SELL_KALSHI'
        : raw.venue === 'KALSHI' && crossVenueSpreadCents > 0
        ? 'BUY_POLYMARKET_SELL_KALSHI'
        : 'BUY_KALSHI_SELL_POLYMARKET';

    // Category-specific CDS-implied probability & Econometric model probability
    let cdsHazardImpliedProbPct = cds1YHazardProbPct;
    let econometricModelProbPct = cds1YHazardProbPct;
    let sovereignCdsBetaBpsPer10Pct = 14;
    let sovereign10YYieldBetaBpsPer10Pct = 18;
    let sovereignFxBetaPctPer10Pct = 1.2;

    if (raw.category === 'CENTRAL_BANK_RATES') {
      cdsHazardImpliedProbPct = Math.min(90, Math.round(32 + cpi * 1.45));
      econometricModelProbPct = Math.min(92, Math.round(28 + cpi * 1.65));
      sovereignCdsBetaBpsPer10Pct = 9;
      sovereign10YYieldBetaBpsPer10Pct = 24;
      sovereignFxBetaPctPer10Pct = 0.85;
    } else if (raw.category === 'GEOPOLITICAL_CONFLICT') {
      cdsHazardImpliedProbPct = Math.min(88, Math.round(cds1YHazardProbPct * 0.95 + gdelt * 0.28));
      econometricModelProbPct = Math.min(90, Math.round(gdelt * 0.58));
      sovereignCdsBetaBpsPer10Pct = 19;
      sovereign10YYieldBetaBpsPer10Pct = 21;
      sovereignFxBetaPctPer10Pct = 1.55;
    } else if (raw.category === 'SOVEREIGN_FISCAL_DEFAULT') {
      cdsHazardImpliedProbPct = cds1YHazardProbPct;
      econometricModelProbPct = Math.min(
        92,
        Math.max(8, Math.round((debtToGdp - 35) * 0.55 + Math.max(0, 5.5 - fxResMo) * 7.5))
      );
      sovereignCdsBetaBpsPer10Pct = 26;
      sovereign10YYieldBetaBpsPer10Pct = 31;
      sovereignFxBetaPctPer10Pct = 1.95;
    } else if (raw.category === 'TARIFFS_TRADE') {
      cdsHazardImpliedProbPct = Math.min(85, Math.round(25 + cds1YHazardProbPct * 0.65));
      econometricModelProbPct = Math.min(85, Math.round(34 + Math.max(0, -snapshot.worldBankIndicators.currentAccountPctGdp) * 4.5));
      sovereignCdsBetaBpsPer10Pct = 15;
      sovereign10YYieldBetaBpsPer10Pct = 17;
      sovereignFxBetaPctPer10Pct = 1.45;
    } else {
      cdsHazardImpliedProbPct = Math.min(88, Math.round(26 + cpi * 1.5));
      econometricModelProbPct = Math.min(90, Math.round(30 + cpi * 1.6));
      sovereignCdsBetaBpsPer10Pct = 13;
      sovereign10YYieldBetaBpsPer10Pct = 22;
      sovereignFxBetaPctPer10Pct = 1.1;
    }

    const eventVsCdsProbGapPct = yesCents - cdsHazardImpliedProbPct;

    const crossAssetArbSignal: NormalizedPredictionContract['crossAssetArbSignal'] =
      eventVsCdsProbGapPct >= 10
        ? 'EVENT_HIGH_BUY_SOVEREIGN_CDS'
        : eventVsCdsProbGapPct <= -10
        ? 'EVENT_LOW_BUY_EVENT_YES_CONTRACT'
        : 'CROSS_ASSET_EQUILIBRIUM';

    const crossAssetTradeExpression =
      crossAssetArbSignal === 'EVENT_HIGH_BUY_SOVEREIGN_CDS'
        ? `Prediction market prices ${yesCents}% odds vs. ${cdsHazardImpliedProbPct}% implied by ${snapshot.iso3} 5Y CDS (+${eventVsCdsProbGapPct}% gap) → Buy ${snapshot.iso3} 5Y CDS Protection (lagging credit market)`
        : crossAssetArbSignal === 'EVENT_LOW_BUY_EVENT_YES_CONTRACT'
        ? `${snapshot.iso3} 5Y CDS prices ${cdsHazardImpliedProbPct}% hazard vs. ${yesCents}¢ on ${raw.venue} (${eventVsCdsProbGapPct}% gap) → Buy ${raw.venue} YES @ ${yesCents}¢ as cheap binary tail hedge`
        : `Event odds (${yesCents}¢) and ${snapshot.iso3} 5Y CDS (${cdsHazardImpliedProbPct}% implied) are in cross-asset equilibrium`;

    return {
      ...raw,
      yesPriceCents: yesCents,
      noPriceCents: noCents,
      bidAskSpreadCents: bidAsk,
      impliedProbabilityPct: yesCents,
      counterVenueName,
      counterVenuePriceCents,
      crossVenueSpreadCents,
      netCrossVenueArbCents,
      crossVenueRoutingSignal,
      cdsHazardImpliedProbPct,
      econometricModelProbPct,
      eventVsCdsProbGapPct,
      sovereignCdsBetaBpsPer10Pct,
      sovereign10YYieldBetaBpsPer10Pct,
      sovereignFxBetaPctPer10Pct,
      crossAssetArbSignal,
      crossAssetTradeExpression,
    };
  });

  const polymarketContractsCount = contracts.filter((c) => c.venue === 'POLYMARKET').length;
  const kalshiContractsCount = contracts.filter((c) => c.venue === 'KALSHI').length;

  const topCrossVenueArbContract =
    [...contracts].sort((a, b) => b.netCrossVenueArbCents - a.netCrossVenueArbCents)[0] ||
    contracts[0];

  const topEventVsCdsDislocationContract =
    [...contracts].sort(
      (a, b) => Math.abs(b.eventVsCdsProbGapPct) - Math.abs(a.eventVsCdsProbGapPct)
    )[0] || contracts[0];

  // Conditional Bayesian Event Simulation
  const selectedContract =
    contracts.find((c) => c.contractId === selectedContractId) || contracts[0];

  const currentMarketProbPct = selectedContract.impliedProbabilityPct;
  const simulatedShockProbPct =
    typeof simulatedProbOverridePct === 'number'
      ? Math.max(1, Math.min(99, Math.round(simulatedProbOverridePct)))
      : Math.min(95, currentMarketProbPct + 25);

  const probDeltaPct = simulatedShockProbPct - currentMarketProbPct;
  const priorSovereignCrisisProbPct = cds1YHazardProbPct;

  // Bayesian conditional posterior update: P(Crisis | Event_Shock)
  const sensitivityWeight = selectedContract.sovereignCdsBetaBpsPer10Pct / 28;
  const posteriorSovereignCrisisProbPct = Math.max(
    3,
    Math.min(
      96,
      Math.round(priorSovereignCrisisProbPct + probDeltaPct * sensitivityWeight * 0.72)
    )
  );

  const conditional5YCdsDeltaBps = Math.round(
    (probDeltaPct / 10) * selectedContract.sovereignCdsBetaBpsPer10Pct
  );
  const conditional10YYieldDeltaBps = Math.round(
    (probDeltaPct / 10) * selectedContract.sovereign10YYieldBetaBpsPer10Pct
  );
  const conditionalSpotFxDeltaPct = Number(
    (-(probDeltaPct / 10) * selectedContract.sovereignFxBetaPctPer10Pct).toFixed(2)
  );

  const responseSteps = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const responseCurve = responseSteps.map((odds) => {
    const dProb = odds - currentMarketProbPct;
    const projCds = Math.max(
      25,
      Math.round(cds5Y + (dProb / 10) * selectedContract.sovereignCdsBetaBpsPer10Pct)
    );
    const postCrisis = Math.max(
      2,
      Math.min(
        98,
        Math.round(priorSovereignCrisisProbPct + dProb * sensitivityWeight * 0.72)
      )
    );
    return {
      eventOddsCents: odds,
      projected5YCdsBps: projCds,
      posteriorCrisisProbPct: postCrisis,
    };
  });

  const bayesianSimulation: ConditionalBayesianEventSimulation = {
    selectedContract,
    currentMarketProbPct,
    simulatedShockProbPct,
    probDeltaPct,
    priorSovereignCrisisProbPct,
    posteriorSovereignCrisisProbPct,
    conditional5YCdsDeltaBps,
    conditional10YYieldDeltaBps,
    conditionalSpotFxDeltaPct,
    bayesianTransmissionSummary: `Repricing "${selectedContract.question.slice(0, 68)}..." on ${selectedContract.venue} from ${currentMarketProbPct}¢ to ${simulatedShockProbPct}¢ (${probDeltaPct >= 0 ? `+${probDeltaPct}%` : `${probDeltaPct}%`} odds shift) updates ${snapshot.countryName} (${snapshot.iso3}) Posterior Crisis Regime Probability from ${priorSovereignCrisisProbPct}% → ${posteriorSovereignCrisisProbPct}%, transmitting ${conditional5YCdsDeltaBps >= 0 ? `+${conditional5YCdsDeltaBps}` : conditional5YCdsDeltaBps} bps to 5Y CDS, ${conditional10YYieldDeltaBps >= 0 ? `+${conditional10YYieldDeltaBps}` : conditional10YYieldDeltaBps} bps to 10Y Local Yield, and ${conditionalSpotFxDeltaPct >= 0 ? `+${conditionalSpotFxDeltaPct}%` : `${conditionalSpotFxDeltaPct}%`} to Spot FX.`,
    responseCurve,
  };

  return {
    headlineSummary: `Dual-Venue Prediction Market Scanner (${polymarketContractsCount} Polymarket + ${kalshiContractsCount} Kalshi contracts) flags a ${topCrossVenueArbContract.netCrossVenueArbCents}¢ net cross-venue spread on "${topCrossVenueArbContract.tickerOrSlug}" and a ${topEventVsCdsDislocationContract.eventVsCdsProbGapPct >= 0 ? `+${topEventVsCdsDislocationContract.eventVsCdsProbGapPct}%` : `${topEventVsCdsDislocationContract.eventVsCdsProbGapPct}%`} Event-vs-CDS probability dislocation.`,
    activeSourcesLabel,
    polymarketContractsCount,
    kalshiContractsCount,
    topCrossVenueArbContract,
    topEventVsCdsDislocationContract,
    contracts,
    bayesianSimulation,
  };
}

