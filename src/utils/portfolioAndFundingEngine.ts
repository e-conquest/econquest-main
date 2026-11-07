import {
  CalibratedPolicyShockVector,
  CrossSovereignPairTrade,
  EmbiPortfolioAndPairBookResult,
  EmbiSovereignPosition,
  ExtractedPolicyClause,
  MonthlyTreasuryAuctionPoint,
  OpenDataSnapshot,
  PolicyDocumentAnalysisResult,
  PolicyDocumentCategory,
  TreasuryAuctionRolloverResult,
  TreasuryFundingMixParams,
  WatchlistItem,
} from '../types/council';
import { SOVEREIGN_CATALOG, buildBaselineOpenData } from '../data/presetsAndBaselines';

export const DEFAULT_TREASURY_FUNDING_MIX: TreasuryFundingMixParams = {
  shortTermTBillsPct: 38,
  mediumLongLocalBondsPct: 28,
  usdEurobondsPct: 14,
  sukukAndSyndicatedLoansPct: 10,
  officialImfAndBilateralPct: 10,
};

export function computeEmbiPortfolioAndPairBook(
  activeSnapshot: OpenDataSnapshot,
  watchlistItems: WatchlistItem[] = SOVEREIGN_CATALOG,
  activeTiltOverridesBps: Record<string, number> = {},
  pairConfig?: {
    longIso3: string;
    shortIso3: string;
    instrumentType: '5Y_USD_CDS' | '10Y_USD_EUROBOND' | '5Y_LOCAL_LCY_BOND';
    longWeightPct?: number;
  },
  /** % weights per ISO3 from the user's imported holdings; replaces the model's active tilts. */
  holdingsWeightsPct?: Record<string, number>
): EmbiPortfolioAndPairBookResult {
  const useHoldings = !!holdingsWeightsPct && Object.keys(holdingsWeightsPct).length > 0;
  const activeCode = activeSnapshot.iso3.toUpperCase();

  // Build universe directly from live watchlistItems + SOVEREIGN_CATALOG (ensuring active sovereign is included)
  const baseCatalog = watchlistItems.length >= 4 ? watchlistItems : SOVEREIGN_CATALOG;
  const mergedMap = new Map<string, WatchlistItem>();
  baseCatalog.forEach((item) => mergedMap.set(item.iso3.toUpperCase(), item));
  SOVEREIGN_CATALOG.forEach((item) => {
    if (!mergedMap.has(item.iso3.toUpperCase()) && mergedMap.size < 8) {
      mergedMap.set(item.iso3.toUpperCase(), item);
    }
  });

  let universeItems = Array.from(mergedMap.values()).slice(0, 8);
  if (useHoldings) {
    // Held countries first, so none of them drop out of the 8-name universe.
    const held = Object.keys(holdingsWeightsPct!)
      .map((iso) => mergedMap.get(iso) || SOVEREIGN_CATALOG.find((c) => c.iso3 === iso))
      .filter((x): x is WatchlistItem => !!x);
    const rest = Array.from(mergedMap.values()).filter((x) => !held.some((h) => h.iso3 === x.iso3));
    universeItems = [...held, ...rest].slice(0, Math.max(8, held.length));
  }
  if (!universeItems.some((u) => u.iso3.toUpperCase() === activeCode)) {
    universeItems[0] = {
      iso3: activeCode,
      countryName: activeSnapshot.countryName,
      region: activeSnapshot.region || 'Global Sovereign',
      currencyCode: activeSnapshot.currencyCode,
      focusTheme: 'Active Sovereign Telemetry',
      yield10YPct: activeSnapshot.monetaryAndMarket.sovereign10YBondYieldPct,
      cds5YBps: activeSnapshot.monetaryAndMarket.cds5YSpreadBps,
      debtToGdpPct: activeSnapshot.imfIndicators.debtToGdpPct,
      fxReservesMonths: activeSnapshot.worldBankIndicators.fxReservesMonthsImport,
    };
  }

  // Derive benchmark weights inversely proportional to credit spread extremism & normalized to 100%
  const rawBenchScores = universeItems.map((item) => {
    const isCurrent = item.iso3.toUpperCase() === activeCode;
    const cds = isCurrent ? activeSnapshot.monetaryAndMarket.cds5YSpreadBps : item.cds5YBps;
    // EMBI Global Diversified caps country weights and weights liquid issuers higher
    const score = Math.max(6, 22 - Math.min(14, cds / 85));
    return { item, score };
  });
  const totalBenchScore = rawBenchScores.reduce((acc, x) => acc + x.score, 0) || 100;

  const benchAllocated = rawBenchScores.map(({ item, score }) => {
    const embiBenchmarkWeightPct = Number(((score / totalBenchScore) * 100).toFixed(2));
    const isCurrent = item.iso3.toUpperCase() === activeCode;
    const snap = isCurrent ? activeSnapshot : buildBaselineOpenData(item.iso3);

    const cds5Y = Math.round(
      isCurrent ? activeSnapshot.monetaryAndMarket.cds5YSpreadBps : item.cds5YBps
    );
    const local10Y = Number(
      (isCurrent
        ? activeSnapshot.monetaryAndMarket.sovereign10YBondYieldPct
        : item.yield10YPct
      ).toFixed(2)
    );
    const debtToGdp = Number(
      (isCurrent ? activeSnapshot.imfIndicators.debtToGdpPct : item.debtToGdpPct).toFixed(1)
    );
    const fxReservesMonths = Number(
      (isCurrent
        ? activeSnapshot.worldBankIndicators.fxReservesMonthsImport
        : item.fxReservesMonths
      ).toFixed(2)
    );

    // Default active tilt derived from real-rate carry vs. CDS spread ratio unless overridden by user slider
    const realRateCarryAdvantage = local10Y - cds5Y / 100 - 4.2;
    const defaultTiltBps = Math.max(
      -200,
      Math.min(200, Math.round(realRateCarryAdvantage * 22))
    );
    const requestedTiltBps =
      typeof activeTiltOverridesBps[item.iso3] === 'number'
        ? activeTiltOverridesBps[item.iso3]
        : defaultTiltBps;

    const rawActiveWeight = useHoldings
      ? holdingsWeightsPct![item.iso3] || 0
      : Math.max(1.0, embiBenchmarkWeightPct + requestedTiltBps / 100);
    return {
      item,
      snap,
      embiBenchmarkWeightPct,
      rawActiveWeight,
      cds5Y,
      local10Y,
      debtToGdp,
      fxReservesMonths,
    };
  });

  const totalRawActive = benchAllocated.reduce((acc, x) => acc + x.rawActiveWeight, 0) || 100;

  const positions: EmbiSovereignPosition[] = benchAllocated.map((entry) => {
    const {
      item,
      snap,
      embiBenchmarkWeightPct,
      rawActiveWeight,
      cds5Y,
      local10Y,
      debtToGdp,
      fxReservesMonths,
    } = entry;

    const activePortfolioWeightPct = Number(((rawActiveWeight / totalRawActive) * 100).toFixed(2));
    const activeTiltBps = Math.round((activePortfolioWeightPct - embiBenchmarkWeightPct) * 100);

    const basisAdjustment = Math.round((cds5Y - 200) * 0.14 + 28);
    const eurobond10YZSpreadBps = Math.max(40, cds5Y + basisAdjustment);

    // Empirical beta to EMBI index derived from sovereign CDS vs EMBI average (~280 bps)
    const empiricalBetaToEmbi = Number(
      Math.max(0.55, Math.min(1.85, 0.65 + cds5Y / 520)).toFixed(2)
    );

    const modifiedDurationYears = Number(
      Math.max(4.6, Math.min(7.4, 7.1 - cds5Y / 450)).toFixed(2)
    );
    const spreadDurationYears = Number((modifiedDurationYears * 0.94).toFixed(2));

    const annualizedCarryAndRollBps = Math.round(eurobond10YZSpreadBps * 0.88 + 38);
    const expectedSpreadCompressionBps =
      activeTiltBps > 40 ? 30 : activeTiltBps < -40 ? -20 : 8;
    const expected12MTotalReturnPct = Number(
      (
        4.15 +
        (annualizedCarryAndRollBps + expectedSpreadCompressionBps * spreadDurationYears) / 100
      ).toFixed(2)
    );

    const tailVolFactor = 0.042 * empiricalBetaToEmbi * (1 + cds5Y / 950);
    const tailCvar99ContributionPct = Number(
      ((activePortfolioWeightPct / 100) * tailVolFactor * 2.68 * 100).toFixed(2)
    );

    const creditRating =
      snap.liveCreditRating ||
      (cds5Y < 140
        ? 'BBB'
        : cds5Y < 240
        ? 'BB+'
        : cds5Y < 340
        ? 'BB-'
        : cds5Y < 520
        ? 'B'
        : 'CCC+');

    const convictionSignal: EmbiSovereignPosition['convictionSignal'] =
      activeTiltBps >= 55
        ? 'OVERWEIGHT_CONVICTION'
        : activeTiltBps <= -95
        ? 'SHORT_CREDIT_HEDGE'
        : activeTiltBps <= -30
        ? 'UNDERWEIGHT_DEFENSIVE'
        : 'BENCHMARK_NEUTRAL';

    return {
      iso3: item.iso3,
      countryName: item.countryName,
      region: item.region,
      creditRating,
      isCurrentActiveSovereign: item.iso3.toUpperCase() === activeCode,
      embiBenchmarkWeightPct,
      activePortfolioWeightPct,
      activeTiltBps,
      cds5YSpreadBps: cds5Y,
      eurobond10YZSpreadBps,
      local10YYieldPct: local10Y,
      debtToGdpPct: debtToGdp,
      fxReservesMonths,
      empiricalBetaToEmbi,
      modifiedDurationYears,
      spreadDurationYears,
      expected12MTotalReturnPct,
      annualizedCarryAndRollBps,
      tailCvar99ContributionPct,
      convictionSignal,
    };
  });

  const benchmarkWeightedSpreadBps = Math.round(
    positions.reduce(
      (acc, p) => acc + (p.embiBenchmarkWeightPct / 100) * p.eurobond10YZSpreadBps,
      0
    )
  );
  const activePortfolioWeightedSpreadBps = Math.round(
    positions.reduce(
      (acc, p) => acc + (p.activePortfolioWeightPct / 100) * p.eurobond10YZSpreadBps,
      0
    )
  );

  const squaredTiltSum = positions.reduce((acc, p) => {
    const wDiff = (p.activePortfolioWeightPct - p.embiBenchmarkWeightPct) / 100;
    const countrySpreadVolBps = 92 * p.empiricalBetaToEmbi;
    return acc + Math.pow(wDiff * countrySpreadVolBps * p.spreadDurationYears, 2);
  }, 0);
  const exAnteTrackingErrorBps = Math.max(14, Math.round(Math.sqrt(squaredTiltSum * 1.4)));

  const portfolioBetaToEmbi = Number(
    positions
      .reduce((acc, p) => acc + (p.activePortfolioWeightPct / 100) * p.empiricalBetaToEmbi, 0)
      .toFixed(2)
  );

  const portfolioModifiedDurationYears = Number(
    positions
      .reduce((acc, p) => acc + (p.activePortfolioWeightPct / 100) * p.modifiedDurationYears, 0)
      .toFixed(2)
  );
  const portfolioSpreadDurationYears = Number(
    positions
      .reduce((acc, p) => acc + (p.activePortfolioWeightPct / 100) * p.spreadDurationYears, 0)
      .toFixed(2)
  );

  const weightedCarryBps = positions.reduce(
    (acc, p) => acc + (p.activePortfolioWeightPct / 100) * p.annualizedCarryAndRollBps,
    0
  );
  const weightedCarryToVolRatio = Number(
    (weightedCarryBps / Math.max(75, 140 * portfolioBetaToEmbi)).toFixed(2)
  );

  const cornishFisherCvar99Pct = Number(
    positions.reduce((acc, p) => acc + p.tailCvar99ContributionPct * 0.78, 0).toFixed(2)
  );
  const parametricVaR99Pct = Number((cornishFisherCvar99Pct * 0.74).toFixed(2));

  // Pair trade computation using live positions
  const defaultLongIso =
    positions.find((p) => p.isCurrentActiveSovereign)?.iso3 || positions[0].iso3;
  const defaultShortIso =
    positions.find((p) => p.iso3 !== defaultLongIso)?.iso3 || positions[1]?.iso3 || 'ZAF';

  const longIso = pairConfig?.longIso3 || defaultLongIso;
  const shortIso =
    pairConfig?.shortIso3 && pairConfig.shortIso3 !== longIso
      ? pairConfig.shortIso3
      : defaultShortIso;
  const instType = pairConfig?.instrumentType || '5Y_USD_CDS';
  const longWeightPct = pairConfig?.longWeightPct || 10.0;

  const longPos = positions.find((p) => p.iso3 === longIso) || positions[0];
  const shortPos =
    positions.find((p) => p.iso3 === shortIso) ||
    positions.find((p) => p.iso3 !== longPos.iso3) ||
    positions[0];

  const getMetricBps = (pos: EmbiSovereignPosition) => {
    if (instType === '5Y_USD_CDS') return pos.cds5YSpreadBps;
    if (instType === '10Y_USD_EUROBOND') return pos.eurobond10YZSpreadBps;
    return Math.round(pos.local10YYieldPct * 100);
  };

  const longSpreadBps = getMetricBps(longPos);
  const shortSpreadBps = getMetricBps(shortPos);
  const currentDiffBps = longSpreadBps - shortSpreadBps;

  const empiricalHedgeRatioBeta = Number(
    ((longPos.empiricalBetaToEmbi / Math.max(0.4, shortPos.empiricalBetaToEmbi)) * 0.88).toFixed(2)
  );
  const shortLegBetaHedgedWeightPct = Number(
    (longWeightPct * empiricalHedgeRatioBeta).toFixed(2)
  );

  const historicalStdDevBps = Math.max(
    22,
    Math.round(Math.abs(longSpreadBps + shortSpreadBps) * 0.062)
  );
  const seedShift = ((longIso.charCodeAt(0) * 7 + shortIso.charCodeAt(1) * 11) % 32) + 16;
  const historical12MMeanSpreadBps = Math.round(
    currentDiffBps - (longSpreadBps >= shortSpreadBps ? seedShift : -seedShift)
  );
  const currentSpreadZScore = Number(
    ((currentDiffBps - historical12MMeanSpreadBps) / historicalStdDevBps).toFixed(2)
  );

  const netSpreadDurationContributionYrs = Number(
    (
      (longWeightPct / 100) * longPos.spreadDurationYears -
      (shortLegBetaHedgedWeightPct / 100) * shortPos.spreadDurationYears
    ).toFixed(2)
  );

  const annualizedNetCarryPickupBps = Math.round(
    longSpreadBps - shortSpreadBps * empiricalHedgeRatioBeta * 0.92
  );
  const meanReversionTargetBps = historical12MMeanSpreadBps;
  const stopLossTriggerBps = Math.round(
    currentDiffBps +
      (currentDiffBps >= historical12MMeanSpreadBps ? 1 : -1) * historicalStdDevBps * 1.65
  );

  const expectedConvergenceBps = Math.abs(currentDiffBps - meanReversionTargetBps) * 0.65;
  const expected90DReturnBps = Math.round(
    expectedConvergenceBps * 0.85 + annualizedNetCarryPickupBps / 4
  );

  const months = [
    'M-11',
    'M-10',
    'M-9',
    'M-8',
    'M-7',
    'M-6',
    'M-5',
    'M-4',
    'M-3',
    'M-2',
    'M-1',
    'Spot',
  ];
  const history12M = months.map((mLabel, idx) => {
    const progress = idx / 11;
    const wave =
      Math.sin(idx * 0.95 + longIso.charCodeAt(0)) * historicalStdDevBps * 0.82 +
      Math.cos(idx * 0.55) * historicalStdDevBps * 0.32;
    const spreadDiffBps =
      idx === 11
        ? currentDiffBps
        : Math.round(
            historical12MMeanSpreadBps +
              wave +
              progress * (currentDiffBps - historical12MMeanSpreadBps) * 0.55
          );
    const zScore = Number(
      ((spreadDiffBps - historical12MMeanSpreadBps) / historicalStdDevBps).toFixed(2)
    );
    return {
      monthLabel: mLabel,
      spreadDiffBps,
      meanSpreadBps: historical12MMeanSpreadBps,
      upper2SigmaBps: Math.round(historical12MMeanSpreadBps + 2 * historicalStdDevBps),
      lower2SigmaBps: Math.round(historical12MMeanSpreadBps - 2 * historicalStdDevBps),
      zScore,
    };
  });

  const activePairTrade: CrossSovereignPairTrade = {
    pairId: `${longPos.iso3}_VS_${shortPos.iso3}_${instType}`,
    longIso3: longPos.iso3,
    longCountryName: longPos.countryName,
    shortIso3: shortPos.iso3,
    shortCountryName: shortPos.countryName,
    instrumentType: instType,
    longLegSpreadOrYieldBps: longSpreadBps,
    shortLegSpreadOrYieldBps: shortSpreadBps,
    currentSpreadDifferentialBps: currentDiffBps,
    historical12MMeanSpreadBps,
    historical12MStdDevBps: historicalStdDevBps,
    currentSpreadZScore,
    empiricalHedgeRatioBeta,
    longLegWeightPct: longWeightPct,
    shortLegBetaHedgedWeightPct,
    netSpreadDurationContributionYrs,
    annualizedNetCarryPickupBps,
    meanReversionTargetBps,
    stopLossTriggerBps,
    expected90DReturnBps,
    pairRationale: `Long ${longPos.countryName} (${longPos.iso3}) vs. Short ${shortPos.countryName} (${shortPos.iso3}) via ${instType.replace(/_/g, ' ')} at β = ${empiricalHedgeRatioBeta}x (${longWeightPct}% vs. ${shortLegBetaHedgedWeightPct}% index weight). Captures ${currentSpreadZScore >= 0 ? `+${currentSpreadZScore}σ` : `${currentSpreadZScore}σ`} spread dislocation with ${annualizedNetCarryPickupBps >= 0 ? `+${annualizedNetCarryPickupBps}` : annualizedNetCarryPickupBps} bps annualized carry differential.`,
    history12M,
  };

  // Build preset pair ideas dynamically from available positions
  const p0 = positions[0]?.iso3 || 'BRA';
  const p1 = positions[1]?.iso3 || 'TUR';
  const p2 = positions[2]?.iso3 || 'EGY';
  const p3 = positions[3]?.iso3 || 'ZAF';

  return {
    headlineSummary: `EMBI Global Diversified Book carries ${activePortfolioWeightedSpreadBps} bps OAS (Benchmark ${benchmarkWeightedSpreadBps} bps) with ${exAnteTrackingErrorBps} bps Ex-Ante Tracking Error, β = ${portfolioBetaToEmbi}x, Spread Duration ${portfolioSpreadDurationYears}y, and 99% Cornish-Fisher Tail CVaR of ${cornishFisherCvar99Pct}%.`,
    benchmarkWeightedSpreadBps,
    activePortfolioWeightedSpreadBps,
    exAnteTrackingErrorBps,
    portfolioBetaToEmbi,
    portfolioModifiedDurationYears,
    portfolioSpreadDurationYears,
    weightedCarryToVolRatio,
    parametricVaR99Pct,
    cornishFisherCvar99Pct,
    positions,
    activePairTrade,
    presetPairIdeas: [
      {
        pairId: `${p0}_VS_${p1}_CDS`,
        label: `Core EM Credit RV: Long ${p0} vs. Short ${p1} (5Y CDS)`,
        longIso3: p0,
        shortIso3: p1,
        instrumentType: '5Y_USD_CDS',
      },
      {
        pairId: `${p1}_VS_${p3}_EUROBOND`,
        label: `Disinflation Reformer vs. Twin-Deficit Beta: Long ${p1} / Short ${p3} (10Y Eurobond)`,
        longIso3: p1,
        shortIso3: p3,
        instrumentType: '10Y_USD_EUROBOND',
      },
      {
        pairId: `${p2}_VS_${p0}_EUROBOND`,
        label: `High-Spread Compression vs. Core Benchmark: Long ${p2} / Short ${p0} (10Y Eurobond)`,
        longIso3: p2,
        shortIso3: p0,
        instrumentType: '10Y_USD_EUROBOND',
      },
      {
        pairId: `${p0}_VS_${p3}_LCY`,
        label: `Ex-Ante Real Rate Carry Differential: Long ${p0} / Short ${p3} (5Y Local Bond)`,
        longIso3: p0,
        shortIso3: p3,
        instrumentType: '5Y_LOCAL_LCY_BOND',
      },
    ],
  };
}

export function computeTreasuryAuctionRolloverSimulator(
  snapshot: OpenDataSnapshot,
  rawMix: TreasuryFundingMixParams = DEFAULT_TREASURY_FUNDING_MIX
): TreasuryAuctionRolloverResult {
  const sum =
    Math.max(0, rawMix.shortTermTBillsPct) +
    Math.max(0, rawMix.mediumLongLocalBondsPct) +
    Math.max(0, rawMix.usdEurobondsPct) +
    Math.max(0, rawMix.sukukAndSyndicatedLoansPct) +
    Math.max(0, rawMix.officialImfAndBilateralPct);

  const scale = sum > 0 ? 100 / sum : 1;
  const normalizedMix: TreasuryFundingMixParams = {
    shortTermTBillsPct: Number((Math.max(0, rawMix.shortTermTBillsPct) * scale).toFixed(1)),
    mediumLongLocalBondsPct: Number(
      (Math.max(0, rawMix.mediumLongLocalBondsPct) * scale).toFixed(1)
    ),
    usdEurobondsPct: Number((Math.max(0, rawMix.usdEurobondsPct) * scale).toFixed(1)),
    sukukAndSyndicatedLoansPct: Number(
      (Math.max(0, rawMix.sukukAndSyndicatedLoansPct) * scale).toFixed(1)
    ),
    officialImfAndBilateralPct: Number(
      (Math.max(0, rawMix.officialImfAndBilateralPct) * scale).toFixed(1)
    ),
  };

  const debtToGdp = snapshot.imfIndicators.debtToGdpPct;
  const primaryDeficitPctGdp = Math.max(0, -snapshot.imfIndicators.primaryFiscalBalancePct);
  const annualizedGfnPctGdp = Number(
    Math.min(
      34,
      Math.max(
        8.5,
        primaryDeficitPctGdp + debtToGdp * 0.165 + (normalizedMix.shortTermTBillsPct - 35) * 0.08
      )
    ).toFixed(2)
  );

  const basePolicyRate = snapshot.monetaryAndMarket.policyRatePct;
  const base10YLocalYield = snapshot.monetaryAndMarket.sovereign10YBondYieldPct;
  const baseEurobondYield = Number(
    (4.35 + snapshot.monetaryAndMarket.cds5YSpreadBps / 100).toFixed(2)
  );
  const baseSukukYield = Number((base10YLocalYield * 0.88).toFixed(2));
  const officialImfCostPct = 3.65;

  const domesticSharePct =
    normalizedMix.shortTermTBillsPct +
    normalizedMix.mediumLongLocalBondsPct +
    normalizedMix.sukukAndSyndicatedLoansPct * 0.65;

  const bankBaseExposureTier1 = Math.min(
    240,
    Math.max(68, Math.round(debtToGdp * 1.65 + (domesticSharePct - 60) * 1.35))
  );

  let cumulativeGapPctGdp = 0;
  const monthlySchedule: MonthlyTreasuryAuctionPoint[] = [];

  for (let m = 1; m <= 24; m++) {
    const qIdx = Math.ceil(m / 3);
    const yearLabel = m <= 12 ? 'Y1' : 'Y2';
    const calendarQuarter = `${yearLabel}·Q${((qIdx - 1) % 4) + 1}`;

    const isRolloverHump = m % 3 === 0;
    const isEurobondMaturityMonth = m === 6 || m === 14 || m === 22;

    const baseMonthlyGfnPctGdp = annualizedGfnPctGdp / 12;
    const primaryDeficitComponentPctGdp = Number((baseMonthlyGfnPctGdp * 0.22).toFixed(2));

    const tBillAmplifier =
      1 + ((normalizedMix.shortTermTBillsPct - 35) / 100) * (m > 6 ? 0.55 : 0.25);
    const maturingTBillRolloverPctGdp = Number(
      (baseMonthlyGfnPctGdp * (isRolloverHump ? 0.68 : 0.44) * tBillAmplifier).toFixed(2)
    );
    const bondAndEurobondAmortizationPctGdp = Number(
      (baseMonthlyGfnPctGdp * (isEurobondMaturityMonth ? 0.58 : 0.24)).toFixed(2)
    );

    const grossFinancingNeedPctGdp = Number(
      (
        primaryDeficitComponentPctGdp +
        maturingTBillRolloverPctGdp +
        bondAndEurobondAmortizationPctGdp
      ).toFixed(2)
    );

    const domesticIssuanceSupplyPctGdp = Number(
      ((grossFinancingNeedPctGdp * domesticSharePct) / 100).toFixed(2)
    );
    const externalAndOfficialSupplyPctGdp = Number(
      (grossFinancingNeedPctGdp - domesticIssuanceSupplyPctGdp).toFixed(2)
    );

    const domesticBankSovereignHoldingsPctTier1 = Number(
      Math.min(310, bankBaseExposureTier1 + m * ((domesticSharePct - 55) * 0.045)).toFixed(1)
    );

    const supplyPressure = (grossFinancingNeedPctGdp / baseMonthlyGfnPctGdp - 1) * 0.55;
    const saturationPenalty = Math.max(0, (domesticBankSovereignHoldingsPctTier1 - 135) * 0.0065);
    const officialReliefBonus = (normalizedMix.officialImfAndBilateralPct - 10) * 0.018;

    const simulatedBidToCoverRatio = Number(
      Math.max(
        0.92,
        Math.min(3.25, 2.35 - supplyPressure - saturationPenalty + officialReliefBonus)
      ).toFixed(2)
    );

    const auctionClearingTailBps = Math.round(
      Math.max(
        2,
        (2.4 - simulatedBidToCoverRatio) * 28 +
          (simulatedBidToCoverRatio < 1.35 ? (1.35 - simulatedBidToCoverRatio) * 110 : 0)
      )
    );

    const marginalDomesticClearingYieldPct = Number(
      (basePolicyRate * 0.52 + base10YLocalYield * 0.48 + auctionClearingTailBps / 100).toFixed(2)
    );

    const privateCreditCrowdingOutIndex = Math.round(
      Math.min(99, Math.max(12, (domesticBankSovereignHoldingsPctTier1 - 55) * 0.48))
    );

    const eurobondAccessShortfall =
      snapshot.monetaryAndMarket.cds5YSpreadBps > 600 && normalizedMix.usdEurobondsPct > 18
        ? grossFinancingNeedPctGdp * ((normalizedMix.usdEurobondsPct - 18) / 100) * 0.45
        : 0;
    const domesticUndersubscriptionGap =
      simulatedBidToCoverRatio < 1.2
        ? domesticIssuanceSupplyPctGdp * (1.2 - simulatedBidToCoverRatio) * 0.65
        : 0;

    cumulativeGapPctGdp = Number(
      (cumulativeGapPctGdp + eurobondAccessShortfall + domesticUndersubscriptionGap).toFixed(2)
    );

    const auctionStatus: MonthlyTreasuryAuctionPoint['auctionStatus'] =
      simulatedBidToCoverRatio < 1.25 || auctionClearingTailBps >= 45
        ? 'UNDERSUBSCRIBED_STRESS'
        : simulatedBidToCoverRatio < 1.65 || auctionClearingTailBps >= 22
        ? 'TAIL_WIDENING'
        : 'WELL_COVERED';

    monthlySchedule.push({
      monthIndex: m,
      monthLabel: `M+${m}`,
      calendarQuarter,
      grossFinancingNeedPctGdp,
      primaryDeficitComponentPctGdp,
      maturingTBillRolloverPctGdp,
      bondAndEurobondAmortizationPctGdp,
      domesticIssuanceSupplyPctGdp,
      externalAndOfficialSupplyPctGdp,
      simulatedBidToCoverRatio,
      auctionClearingTailBps,
      marginalDomesticClearingYieldPct,
      domesticBankSovereignHoldingsPctTier1,
      privateCreditCrowdingOutIndex,
      cumulativeUncoveredFundingGapPctGdp: cumulativeGapPctGdp,
      auctionStatus,
    });
  }

  const total24MGrossFinancingNeedPctGdp = Number(
    monthlySchedule.reduce((acc, pt) => acc + pt.grossFinancingNeedPctGdp, 0).toFixed(1)
  );

  const avgTailPct =
    monthlySchedule.reduce((acc, pt) => acc + pt.auctionClearingTailBps, 0) /
    (monthlySchedule.length * 100);

  const weightedAverageCostOfBorrowingPct = Number(
    (
      (normalizedMix.shortTermTBillsPct * (basePolicyRate + avgTailPct) +
        normalizedMix.mediumLongLocalBondsPct * (base10YLocalYield + avgTailPct * 1.15) +
        normalizedMix.usdEurobondsPct * baseEurobondYield +
        normalizedMix.sukukAndSyndicatedLoansPct * baseSukukYield +
        normalizedMix.officialImfAndBilateralPct * officialImfCostPct) /
      100
    ).toFixed(2)
  );

  const baselineWacbPct = Number(
    (
      (DEFAULT_TREASURY_FUNDING_MIX.shortTermTBillsPct * basePolicyRate +
        DEFAULT_TREASURY_FUNDING_MIX.mediumLongLocalBondsPct * base10YLocalYield +
        DEFAULT_TREASURY_FUNDING_MIX.usdEurobondsPct * baseEurobondYield +
        DEFAULT_TREASURY_FUNDING_MIX.sukukAndSyndicatedLoansPct * baseSukukYield +
        DEFAULT_TREASURY_FUNDING_MIX.officialImfAndBilateralPct * officialImfCostPct) /
      100
    ).toFixed(2)
  );

  const wacbDeltaBps = Math.round((weightedAverageCostOfBorrowingPct - baselineWacbPct) * 100);

  const weightedAverageMaturityYears = Number(
    (
      (normalizedMix.shortTermTBillsPct * 0.65 +
        normalizedMix.mediumLongLocalBondsPct * 6.8 +
        normalizedMix.usdEurobondsPct * 8.5 +
        normalizedMix.sukukAndSyndicatedLoansPct * 4.2 +
        normalizedMix.officialImfAndBilateralPct * 10.5) /
      100
    ).toFixed(2)
  );

  const averageBidToCoverRatio = Number(
    (
      monthlySchedule.reduce((acc, pt) => acc + pt.simulatedBidToCoverRatio, 0) /
      monthlySchedule.length
    ).toFixed(2)
  );
  const minBidToCoverRatio = Number(
    Math.min(...monthlySchedule.map((pt) => pt.simulatedBidToCoverRatio)).toFixed(2)
  );
  const peakAuctionTailBps = Math.max(...monthlySchedule.map((pt) => pt.auctionClearingTailBps));
  const peakBankSovereignExposurePctTier1 = Number(
    Math.max(...monthlySchedule.map((pt) => pt.domesticBankSovereignHoldingsPctTier1)).toFixed(1)
  );

  const crowdingOutSeverity: TreasuryAuctionRolloverResult['crowdingOutSeverity'] =
    peakBankSovereignExposurePctTier1 >= 185 || minBidToCoverRatio < 1.25
      ? 'SEVERE_DOOM_LOOP_SATURATION'
      : peakBankSovereignExposurePctTier1 >= 135 || minBidToCoverRatio < 1.55
      ? 'MODERATE_CROWDING_OUT'
      : 'LOW_ABSORPTION_STRESS';

  return {
    normalizedMix,
    headlineDiagnostic: `24-Month Cumulative GFN of ${total24MGrossFinancingNeedPctGdp}% GDP (${annualizedGfnPctGdp}% annualized GDP) clears at WACB = ${weightedAverageCostOfBorrowingPct}% (${wacbDeltaBps >= 0 ? `+${wacbDeltaBps}` : wacbDeltaBps} bps vs. baseline) and WAM = ${weightedAverageMaturityYears} yrs. Average Auction Bid-to-Cover is ${averageBidToCoverRatio}x (Trough ${minBidToCoverRatio}x, Peak Tail +${peakAuctionTailBps} bps) with Domestic Bank Sovereign Exposure peaking at ${peakBankSovereignExposurePctTier1}% of Tier-1 Capital.`,
    total24MGrossFinancingNeedPctGdp,
    annualizedGfnPctGdp,
    weightedAverageCostOfBorrowingPct,
    baselineWacbPct,
    wacbDeltaBps,
    weightedAverageMaturityYears,
    averageBidToCoverRatio,
    minBidToCoverRatio,
    peakAuctionTailBps,
    peakBankSovereignExposurePctTier1,
    cumulative24MUncoveredGapPctGdp: cumulativeGapPctGdp,
    crowdingOutSeverity,
    monthlySchedule,
  };
}

export function getCuratedPolicyDocumentTemplate(
  snapshot: OpenDataSnapshot,
  category: PolicyDocumentCategory
): { title: string; text: string; category: PolicyDocumentCategory } {
  const cName = snapshot.countryName;
  const ccy = snapshot.currencyCode;
  const polRate = snapshot.monetaryAndMarket.policyRatePct;
  const cpi = snapshot.imfIndicators.cpiInflationPct;
  const debt = snapshot.imfIndicators.debtToGdpPct;
  const pb = snapshot.imfIndicators.primaryFiscalBalancePct;
  const resMo = snapshot.worldBankIndicators.fxReservesMonthsImport;

  if (category === 'MPC_MONETARY_STATEMENT') {
    return {
      category,
      title: `${cName} Central Bank Monetary Policy Committee (MPC) Rate Decision Communiqué`,
      text: `[OFFICIAL MPC COMMUNIQUÉ — ${cName.toUpperCase()} CENTRAL BANK]
1. The Monetary Policy Committee (MPC) voted to maintain a restrictive monetary stance with the benchmark policy rate anchored around ${polRate}% in response to persistent services-sector price stickiness and headline CPI inflation running at ${cpi}% YoY.
2. The Committee notes that unanchored 24-month inflation expectations, exchange-rate pass-through into tradable goods (${ccy}/USD), and elevated maritime Red Sea / Hormuz freight surcharges pose upside risks to the disinflation trajectory.
3. Forward Guidance & Reaction Function: Should primary fiscal expenditure exceed the budgeted consolidation corridor (${pb}% of GDP) or should core inflation fail to converge toward the target band within two quarters, the Committee stands ready to deliver an additional +150 bps to +250 bps of pre-emptive monetary tightening and tighten statutory reserve requirement ratios (RRR).
4. Foreign Exchange Liquidity: Gross international reserves cover ${resMo} months of imports; the Central Bank reiterates its commitment to a flexible exchange rate regime, limiting bilateral FX intervention strictly to disorderly market volatility.`,
    };
  }

  if (category === 'EUROBOND_CAC_PROSPECTUS') {
    return {
      category,
      title: `Republic of ${cName} USD Global Medium-Term Note (GMTN) Offering Circular — ICMA Single-Limb CAC & Pari Passu Covenant Extract`,
      text: `[OFFERING CIRCULAR EXTRACT — REPUBLIC OF ${cName.toUpperCase()} NY-LAW EXTERNAL INDEBTEDNESS]
Section 14.2: Collective Action Clauses (ICMA Enhanced Single-Limb Aggregation).
(a) Uniformly Applicable Modification: Any modification or reserve matter affecting multiple series of External Debt Securities issued under the 2016/2024 Trust Indenture shall become binding across all series if approved by Holders of at least 75% of the aggregate principal amount of all affected series taken as a single aggregated voting class, without requiring series-by-series two-limb thresholds, provided the exchange offer satisfies the "Uniformly Applicable" consideration test (identical NPV menu offered to all pooled series).
(b) Two-Limb Fallback Aggregation: If the Republic elects a differential menu across short-dated and long-dated Eurobond tranches, modifications require (i) 66.67% of aggregate principal across pooled series AND (ii) >50.0% within each individual series.
(c) Pari Passu & Negative Pledge: The Notes rank pari passu with all unsecured External Indebtedness, excluding multilateral IMF EFF/RSF facilities and bilateral official Paris Club claims subject to Comparability of Treatment (CoT) parameters.`,
    };
  }

  return {
    category: 'IMF_ARTICLE_IV_STAFF_REPORT',
    title: `IMF Article IV Staff Concluding Statement & Quantitative Performance Criteria (QPC) Audit — ${cName}`,
    text: `[IMF EXECUTIVE BOARD ARTICLE IV & EFF REVIEW — ${cName.toUpperCase()}]
1. Fiscal Sustainability & Debt Anchor: Public gross debt stands at ${debt}% of GDP with gross financing needs (GFN) elevated due to short-term domestic T-bill rollover concentration. Staff assesses sovereign debt as sustainable on a forward-looking basis ONLY contingent on achieving a +1.5% of GDP cumulative primary fiscal adjustment over the next 18 months (current primary balance: ${pb}% of GDP).
2. Quantitative Performance Criteria (QPC) & Structural Benchmarks:
   - Floor on Net International Reserves (NIR): Authorities must rebuild liquid FX buffers from ${resMo} months of imports by at least +0.6 months of import cover over the program year, ceasing quasi-fiscal subsidized FX allocations.
   - Ceiling on Central Bank Net Domestic Assets (NDA) & Zero Monetary Financing: Strict prohibition on central bank primary market overdraft advances to the Treasury.
3. Downside Risks: Pre-election energy subsidy pressures or delays in state-owned enterprise (SOE) tariff cost-recovery could trigger a +1.2% of GDP fiscal slippage, widening sovereign 5Y CDS spreads (${snapshot.monetaryAndMarket.cds5YSpreadBps} bps) and delaying the upcoming IMF review tranche disbursement.`,
  };
}

export function computeDeterministicDocumentAnalysis(
  snapshot: OpenDataSnapshot,
  documentTitle: string,
  documentText: string,
  categoryHint?: PolicyDocumentCategory
): PolicyDocumentAnalysisResult {
  const lower = (documentText || '').toLowerCase();
  const titleLower = (documentTitle || '').toLowerCase();

  const detectedCategory: PolicyDocumentCategory =
    categoryHint ||
    (lower.includes('collective action') ||
    lower.includes('single-limb') ||
    lower.includes('pari passu') ||
    titleLower.includes('prospectus') ||
    titleLower.includes('cac')
      ? 'EUROBOND_CAC_PROSPECTUS'
      : lower.includes('monetary policy committee') ||
        lower.includes('mpc') ||
        lower.includes('policy rate') ||
        titleLower.includes('mpc')
      ? 'MPC_MONETARY_STATEMENT'
      : 'IMF_ARTICLE_IV_STAFF_REPORT');

  const hawkishTerms = [
    'restrictive',
    'tightening',
    'vigilance',
    'upside risks',
    'unanchored',
    'stickiness',
    'pre-emptive',
    'hike',
    'inflation expectations',
    'pass-through',
  ];
  const dovishTerms = [
    'easing',
    'accommodative',
    'rate cut',
    'disinflation',
    'slack',
    'support growth',
    'lower rates',
    'anchored',
  ];
  const slippageTerms = [
    'slippage',
    'subsidy',
    'arrears',
    'delay',
    'waiver',
    'deficit',
    'rollover concentration',
    'contingent liabilities',
    'breach',
    'overdraft',
  ];
  const consolidationTerms = [
    'consolidation',
    'primary surplus',
    'expenditure containment',
    'structural benchmark',
    'tax mobilization',
    'zero monetary financing',
  ];

  const hawkCount = hawkishTerms.filter((t) => lower.includes(t)).length;
  const doveCount = dovishTerms.filter((t) => lower.includes(t)).length;
  const slipCount = slippageTerms.filter((t) => lower.includes(t)).length;
  const consCount = consolidationTerms.filter((t) => lower.includes(t)).length;

  const cpi = snapshot.imfIndicators.cpiInflationPct;
  const gdp = snapshot.imfIndicators.realGdpGrowthPct;
  const taylorRuleImpliedPolicyRatePct = Number(
    Math.max(2.0, 2.5 + cpi + 0.5 * (cpi - 4.5) + 0.5 * (gdp - 3.2)).toFixed(2)
  );
  const actualPolicyRateGapBps = Math.round(
    (snapshot.monetaryAndMarket.policyRatePct - taylorRuleImpliedPolicyRatePct) * 100
  );

  const hawkishDovishStanceScore = Math.max(
    -95,
    Math.min(
      95,
      Math.round(
        (hawkCount - doveCount) * 14 +
          (actualPolicyRateGapBps > 0 ? 18 : -12) +
          (detectedCategory === 'MPC_MONETARY_STATEMENT' ? 12 : 0)
      )
    )
  );

  const monetaryStanceLabel =
    hawkishDovishStanceScore >= 40
      ? 'HAWKISH_RESTRICTIVE_BIAS'
      : hawkishDovishStanceScore >= 12
      ? 'MODERATELY_HAWKISH_VIGILANT'
      : hawkishDovishStanceScore <= -35
      ? 'DOVISH_EASING_CYCLE'
      : 'DATA_DEPENDENT_NEUTRAL';

  const fiscalSlippageRiskScore = Math.max(
    12,
    Math.min(
      94,
      Math.round(
        42 +
          slipCount * 9 -
          consCount * 5 +
          Math.max(0, -snapshot.imfIndicators.primaryFiscalBalancePct) * 6 +
          (snapshot.imfIndicators.debtToGdpPct > 75 ? 10 : 0)
      )
    )
  );

  const imfProgramTrancheDisbursementProbPct = Math.max(
    18,
    Math.min(96, Math.round(100 - fiscalSlippageRiskScore * 0.62 + consCount * 4))
  );

  const cacVotingThresholdType = lower.includes('single-limb')
    ? 'ICMA Enhanced Single-Limb (75% Pooled Aggregate)'
    : lower.includes('two-limb')
    ? 'ICMA Two-Limb (66.7% Pooled + 50% Per-Series)'
    : 'Standard Sovereign Pari Passu & Cross-Default Indenture';

  const sentences = documentText
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 35);

  const extractedClauses: ExtractedPolicyClause[] = (
    sentences.length >= 3
      ? sentences.slice(0, 4)
      : [
          `Monetary stance anchored at ${snapshot.monetaryAndMarket.policyRatePct}% against ${cpi}% headline CPI.`,
          `Fiscal consolidation gap requires stabilizing ${snapshot.imfIndicators.debtToGdpPct}% Debt/GDP trajectory.`,
          `External reserve adequacy at ${snapshot.worldBankIndicators.fxReservesMonthsImport} months import cover under QPC monitoring.`,
        ]
  ).map((sent, idx) => {
    const sLow = sent.toLowerCase();
    const isHawk =
      sLow.includes('rate') || sLow.includes('inflation') || sLow.includes('tighten');
    const isFiscalSlip =
      sLow.includes('slippage') || sLow.includes('subsidy') || sLow.includes('deficit');
    const isCac =
      sLow.includes('75%') || sLow.includes('single-limb') || sLow.includes('pari passu');

    return {
      clauseId: `CL-${idx + 1}`,
      categoryLabel: isCac
        ? 'CAC & Creditor Aggregation'
        : isHawk
        ? 'Monetary Reaction Function'
        : isFiscalSlip
        ? 'Fiscal & QPC Risk Trigger'
        : 'External Buffer & Reserve Floor',
      verbatimQuote: sent.length > 210 ? `${sent.slice(0, 207)}...` : sent,
      quantitativeMetricExtracted: isCac
        ? '75% Single-Limb Pooling Threshold'
        : isHawk
        ? `Policy Rate ${snapshot.monetaryAndMarket.policyRatePct}% vs Taylor ${taylorRuleImpliedPolicyRatePct}%`
        : isFiscalSlip
        ? `Primary Balance ${snapshot.imfIndicators.primaryFiscalBalancePct}% GDP`
        : `FX Reserves ${snapshot.worldBankIndicators.fxReservesMonthsImport}m Cover`,
      directionalSignal: isCac
        ? 'CREDITOR_FRIENDLY'
        : isHawk
        ? hawkishDovishStanceScore >= 0
          ? 'HAWKISH_TIGHTENING'
          : 'DOVISH_ACCOMMODATIVE'
        : isFiscalSlip
        ? 'FISCAL_SLIPPAGE_RISK'
        : 'FISCAL_CONSOLIDATION',
      impactScoreBps: isCac ? -35 : isFiscalSlip ? 65 : isHawk ? 45 : -25,
      confidencePct: 92 - idx * 3,
    };
  });

  const calibratedShockVector: CalibratedPolicyShockVector = {
    policyRateDeltaBps:
      hawkishDovishStanceScore >= 30 ? 125 : hawkishDovishStanceScore <= -25 ? -100 : 50,
    primaryFiscalBalanceDeltaPctGdp:
      fiscalSlippageRiskScore >= 62 ? -0.9 : fiscalSlippageRiskScore <= 38 ? 0.6 : -0.3,
    sovereignSpreadShockBps: Math.round(
      (fiscalSlippageRiskScore - 45) * 1.8 - (hawkishDovishStanceScore > 20 ? 15 : 0)
    ),
    energyAndCpiShockPct: Number(
      Math.max(1.5, (fiscalSlippageRiskScore / 25) * 1.8).toFixed(1)
    ),
    fxReserveAdequacyDeltaMonths:
      imfProgramTrancheDisbursementProbPct >= 65 ? 0.45 : -0.4,
    politicalWillDeltaPoints:
      imfProgramTrancheDisbursementProbPct >= 65 ? 6 : -8,
    rationaleSummary: `Calibrated from ${detectedCategory.replace(/_/g, ' ')}: Monetary Stance ${hawkishDovishStanceScore >= 0 ? `+${hawkishDovishStanceScore}` : hawkishDovishStanceScore} (${monetaryStanceLabel}), Fiscal Slippage Risk ${fiscalSlippageRiskScore}/100, and IMF Tranche Probability ${imfProgramTrancheDisbursementProbPct}%.`,
  };

  return {
    documentTitle: documentTitle || 'Institutional Policy & Indenture Document',
    documentCategory: detectedCategory,
    analyzedAt: new Date().toISOString(),
    providerUsed: 'Deterministic Econometric & Lexicon Engine',
    isAiEnhanced: false,
    executiveSynthesis: `Document audit of "${documentTitle}" for ${snapshot.countryName} (${snapshot.iso3}) indicates a ${monetaryStanceLabel.replace(/_/g, ' ')} stance (score ${hawkishDovishStanceScore}/100, actual policy rate ${actualPolicyRateGapBps >= 0 ? `+${actualPolicyRateGapBps}` : actualPolicyRateGapBps} bps vs. Taylor Rule ${taylorRuleImpliedPolicyRatePct}%) alongside a ${fiscalSlippageRiskScore}/100 Fiscal Slippage Risk index and ${imfProgramTrancheDisbursementProbPct}% probability of on-schedule IMF/official tranche disbursement.`,
    hawkishDovishStanceScore,
    monetaryStanceLabel,
    fiscalSlippageRiskScore,
    imfProgramTrancheDisbursementProbPct,
    taylorRuleImpliedPolicyRatePct,
    actualPolicyRateGapBps,
    cacVotingThresholdType,
    extractedClauses,
    calibratedShockVector,
  };
}
