import {
  BoardroomICPitchbookDossier,
  CouncilAssessmentRun,
  FxEquilibriumStressInputs,
  FxEquilibriumValuationSuite,
  ICPitchbookSovereignComparisonRow,
  InvestorBaseCreditorShare,
  InvestorBaseDoomLoopStressInputs,
  InvestorBaseDoomLoopSuite,
  OpenDataSnapshot,
  ShadowRatingStressInputs,
  SovereignFxEquilibriumRow,
  SovereignInvestorBaseRow,
  SovereignRatingPillarScore,
  SovereignShadowRatingRow,
  SovereignShadowRatingSuite,
  WatchlistItem,
} from '../types/council';
import { buildBaselineOpenData } from '../data/presetsAndBaselines';
import {
  computeCrossSovereignDislocationScreener,
  computePreMortemAndKillSwitchSuite,
  computePredictionMarketArbitrageSuite,
} from './decisionCommandEngine';

export const DEFAULT_SHADOW_RATING_STRESS: ShadowRatingStressInputs = {
  fiscalSlippagePctGdp: 0,
  institutionalGovernanceShockPts: 0,
  externalReserveDrainMonths: 0,
  monetaryCredibilityShockPts: 0,
};

export const DEFAULT_FX_EQUILIBRIUM_STRESS: FxEquilibriumStressInputs = {
  termsOfTradeShockPct: 0,
  realRateDifferentialShiftBps: 0,
  balassaSamuelsonProductivityShiftPct: 0,
};

export const DEFAULT_INVESTOR_BASE_STRESS: InvestorBaseDoomLoopStressInputs = {
  foreignPrivateExitShockPct: 10,
  sovereignBondHaircutMarkToMarketPct: 12,
};

const RATING_LADDER: {
  notch: number;
  spFitch: string;
  moodys: string;
  minScore: number;
}[] = [
  { notch: 21, spFitch: 'AAA', moodys: 'Aaa', minScore: 93 },
  { notch: 20, spFitch: 'AA+', moodys: 'Aa1', minScore: 89 },
  { notch: 19, spFitch: 'AA', moodys: 'Aa2', minScore: 85 },
  { notch: 18, spFitch: 'AA-', moodys: 'Aa3', minScore: 81 },
  { notch: 17, spFitch: 'A+', moodys: 'A1', minScore: 77 },
  { notch: 16, spFitch: 'A', moodys: 'A2', minScore: 73 },
  { notch: 15, spFitch: 'A-', moodys: 'A3', minScore: 69 },
  { notch: 14, spFitch: 'BBB+', moodys: 'Baa1', minScore: 64 },
  { notch: 13, spFitch: 'BBB', moodys: 'Baa2', minScore: 59 },
  { notch: 12, spFitch: 'BBB-', moodys: 'Baa3', minScore: 54 }, // Investment Grade Floor
  { notch: 11, spFitch: 'BB+', moodys: 'Ba1', minScore: 49 }, // Fallen Angel / High Yield Entry
  { notch: 10, spFitch: 'BB', moodys: 'Ba2', minScore: 44 },
  { notch: 9, spFitch: 'BB-', moodys: 'Ba3', minScore: 39 },
  { notch: 8, spFitch: 'B+', moodys: 'B1', minScore: 34 },
  { notch: 7, spFitch: 'B', moodys: 'B2', minScore: 29 },
  { notch: 6, spFitch: 'B-', moodys: 'B3', minScore: 24 },
  { notch: 5, spFitch: 'CCC+', moodys: 'Caa1', minScore: 19 },
  { notch: 4, spFitch: 'CCC', moodys: 'Caa2', minScore: 14 },
  { notch: 3, spFitch: 'CCC-', moodys: 'Caa3', minScore: 10 },
  { notch: 2, spFitch: 'CC', moodys: 'Ca', minScore: 6 },
  { notch: 1, spFitch: 'SD', moodys: 'C', minScore: 0 },
];

const OFFICIAL_SOVEREIGN_RATINGS: Record<string, string> = {
  USA: 'AA+',
  DEU: 'AAA',
  JPN: 'A+',
  GBR: 'AA',
  FRA: 'AA-',
  CHN: 'A+',
  IND: 'BBB-',
  IDN: 'BBB',
  MEX: 'BBB',
  BRA: 'BB',
  ZAF: 'BB-',
  TUR: 'B+',
  EGY: 'B-',
  ARG: 'CCC',
  NGA: 'B-',
  KEN: 'B-',
  COL: 'BB+',
  CHL: 'A',
  POL: 'A-',
  SAU: 'A+',
};

function scoreToRatingEntry(score: number) {
  const clamped = Math.max(0, Math.min(100, score));
  for (const row of RATING_LADDER) {
    if (clamped >= row.minScore) return row;
  }
  return RATING_LADDER[RATING_LADDER.length - 1];
}

function ratingStringToEntry(ratingStr: string) {
  const clean = ratingStr.trim().toUpperCase();
  return (
    RATING_LADDER.find((r) => r.spFitch === clean) ||
    RATING_LADDER.find((r) => r.notch === 10)!
  );
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function computeFivePillarsForSnapshot(
  snap: OpenDataSnapshot,
  stress: ShadowRatingStressInputs,
  isTargetSovereign: boolean
): SovereignRatingPillarScore[] {
  const debtGdp = snap.imfIndicators.debtToGdpPct;
  const primBal = snap.imfIndicators.primaryFiscalBalancePct;
  const growth = snap.imfIndicators.realGdpGrowthPct;
  const cpi = snap.imfIndicators.cpiInflationPct;
  const fxResMo = snap.worldBankIndicators.fxReservesMonthsImport;
  const caGdp = snap.worldBankIndicators.currentAccountPctGdp;
  const extDebtGni = snap.worldBankIndicators.externalDebtPctGni;
  const gdelt = snap.gdeltMetrics.conflictIntensityIndex;
  const rMinusG = snap.dsaAnalytics.rMinusGDifferentialPct;

  // 1. Institutional Effectiveness & Governance (20%)
  const baseInst = clamp(Math.round(88 - gdelt * 0.68 - Math.max(0, cpi - 6) * 0.9), 15, 96);
  const stressedInst = isTargetSovereign
    ? clamp(Math.round(baseInst + stress.institutionalGovernanceShockPts), 10, 98)
    : baseInst;

  // 2. Economic Structure & Real Growth Resilience (20%)
  const baseEcon = clamp(
    Math.round(52 + growth * 5.2 - Math.max(0, rMinusG) * 2.4 + (snap.iso3 === 'USA' || snap.iso3 === 'DEU' ? 24 : 0)),
    18,
    96
  );
  const stressedEcon = isTargetSovereign
    ? clamp(Math.round(baseEcon - Math.max(0, stress.fiscalSlippagePctGdp) * 1.8), 12, 96)
    : baseEcon;

  // 3. External Liquidity & International Investment Position (20%)
  const baseExt = clamp(
    Math.round(44 + fxResMo * 4.5 + caGdp * 2.8 - Math.max(0, extDebtGni - 35) * 0.35 + (snap.iso3 === 'USA' || snap.iso3 === 'JPN' ? 28 : 0)),
    12,
    96
  );
  const effResMo = isTargetSovereign
    ? Math.max(0.5, fxResMo + stress.externalReserveDrainMonths)
    : fxResMo;
  const stressedExt = clamp(
    Math.round(44 + effResMo * 4.5 + caGdp * 2.8 - Math.max(0, extDebtGni - 35) * 0.35 + (snap.iso3 === 'USA' || snap.iso3 === 'JPN' ? 28 : 0)),
    10,
    96
  );

  // 4. Fiscal Performance, Flexibility & Debt Burden (% GDP) (20%)
  const baseFisc = clamp(
    Math.round(78 - Math.max(0, debtGdp - 35) * 0.52 + primBal * 4.2 - Math.max(0, rMinusG) * 2.1),
    10,
    95
  );
  const effPrimBal = isTargetSovereign
    ? primBal - stress.fiscalSlippagePctGdp
    : primBal;
  const effDebtGdp = isTargetSovereign
    ? debtGdp + stress.fiscalSlippagePctGdp * 1.4
    : debtGdp;
  const stressedFisc = clamp(
    Math.round(78 - Math.max(0, effDebtGdp - 35) * 0.52 + effPrimBal * 4.2 - Math.max(0, rMinusG) * 2.1),
    8,
    95
  );

  // 5. Monetary Flexibility & Inflation Credibility (20%)
  const baseMon = clamp(
    Math.round(86 - Math.max(0, cpi - 2.5) * 2.45 - Math.max(0, snap.monetaryAndMarket.cds5YSpreadBps - 120) * 0.035),
    12,
    96
  );
  const stressedMon = isTargetSovereign
    ? clamp(Math.round(baseMon + stress.monetaryCredibilityShockPts), 8, 96)
    : baseMon;

  return [
    {
      pillarId: 'INSTITUTIONAL_EFFECTIVENESS',
      pillarLabel: '1. Institutional & Governance Effectiveness',
      weightPct: 20,
      baselineScore: baseInst,
      stressedScore: stressedInst,
      agencyImpliedGrade: scoreToRatingEntry(stressedInst).spFitch,
      primaryEmpiricalDrivers: `GDELT Conflict Tone (${gdelt}/100) · Rule-of-Law & Policy Predictability`,
    },
    {
      pillarId: 'ECONOMIC_STRUCTURE_GROWTH',
      pillarLabel: '2. Economic Structure & Real Growth Trend',
      weightPct: 20,
      baselineScore: baseEcon,
      stressedScore: stressedEcon,
      agencyImpliedGrade: scoreToRatingEntry(stressedEcon).spFitch,
      primaryEmpiricalDrivers: `Real GDP Growth (${growth.toFixed(1)}%) · Snowball r-g (${rMinusG.toFixed(2)}%)`,
    },
    {
      pillarId: 'EXTERNAL_LIQUIDITY_IIP',
      pillarLabel: '3. External Liquidity & Reserve Adequacy',
      weightPct: 20,
      baselineScore: baseExt,
      stressedScore: stressedExt,
      agencyImpliedGrade: scoreToRatingEntry(stressedExt).spFitch,
      primaryEmpiricalDrivers: `FX Reserves (${effResMo.toFixed(1)}m imports) · Current Account (${caGdp.toFixed(1)}% GDP)`,
    },
    {
      pillarId: 'FISCAL_PERFORMANCE_DEBT',
      pillarLabel: '4. Fiscal Trajectory & General Govt Debt (% GDP)',
      weightPct: 20,
      baselineScore: baseFisc,
      stressedScore: stressedFisc,
      agencyImpliedGrade: scoreToRatingEntry(stressedFisc).spFitch,
      primaryEmpiricalDrivers: `Gross Debt (${effDebtGdp.toFixed(1)}% GDP) · Primary Balance (${effPrimBal.toFixed(1)}% GDP)`,
    },
    {
      pillarId: 'MONETARY_FLEXIBILITY',
      pillarLabel: '5. Monetary Credibility & Regime Flexibility',
      weightPct: 20,
      baselineScore: baseMon,
      stressedScore: stressedMon,
      agencyImpliedGrade: scoreToRatingEntry(stressedMon).spFitch,
      primaryEmpiricalDrivers: `Headline CPI (${cpi.toFixed(1)}%) · Policy Rate (${snap.monetaryAndMarket.policyRatePct.toFixed(2)}%)`,
    },
  ];
}

/**
 * 8.1 S&P / Moody's / Fitch Shadow Rating Scorecard & Fallen-Angel Cliff Simulator
 */
export function computeSovereignShadowRatingSuite(
  activeOpenData: OpenDataSnapshot,
  watchlistItems: WatchlistItem[],
  stressInputs: ShadowRatingStressInputs = DEFAULT_SHADOW_RATING_STRESS
): SovereignShadowRatingSuite {
  const hasActive = watchlistItems.some((w) => w.iso3 === activeOpenData.iso3);
  const allItems: { iso3: string; countryName: string }[] = hasActive
    ? watchlistItems
    : [
        {
          iso3: activeOpenData.iso3,
          countryName: activeOpenData.countryName,
        },
        ...watchlistItems,
      ];

  const activePillars = computeFivePillarsForSnapshot(activeOpenData, stressInputs, true);

  const peerRatingLadder: SovereignShadowRatingRow[] = allItems.map((item) => {
    const isCurrent = item.iso3 === activeOpenData.iso3;
    const snap = isCurrent ? activeOpenData : buildBaselineOpenData(item.iso3);
    const pillars = isCurrent
      ? activePillars
      : computeFivePillarsForSnapshot(snap, stressInputs, false);

    const baseComposite =
      pillars.reduce((acc, p) => acc + p.baselineScore * (p.weightPct / 100), 0);
    const stressedComposite =
      pillars.reduce((acc, p) => acc + p.stressedScore * (p.weightPct / 100), 0);

    const officialStr = OFFICIAL_SOVEREIGN_RATINGS[snap.iso3] || 'BB';
    const officialEntry = ratingStringToEntry(officialStr);
    const baseShadowEntry = scoreToRatingEntry(baseComposite);
    const stressedShadowEntry = scoreToRatingEntry(stressedComposite);

    const notchDislocationVsOfficial = stressedShadowEntry.notch - officialEntry.notch;
    const distanceToInvestmentGradeCliffNotches = stressedShadowEntry.notch - 12; // 12 = BBB-

    const isFallenAngelWarning =
      (officialEntry.notch >= 12 && stressedShadowEntry.notch < 12) ||
      (officialEntry.notch === 12 && notchDislocationVsOfficial < 0);

    const prob12MUpgradePct = clamp(
      Math.round(18 + Math.max(0, notchDislocationVsOfficial) * 22 - Math.max(0, -notchDislocationVsOfficial) * 8),
      4,
      82
    );
    const prob12MDowngradePct = clamp(
      Math.round(18 + Math.max(0, -notchDislocationVsOfficial) * 24 + (isFallenAngelWarning ? 15 : 0)),
      5,
      88
    );
    const prob12MStablePct = Math.max(5, 100 - prob12MUpgradePct - prob12MDowngradePct);

    // Forced index-exclusion spread impact (bps) when crossing BBB- (12) -> BB+ (11) or multi-notch downgrade
    const forcedIndexSellingSpreadImpactBps = isFallenAngelWarning
      ? Math.round(115 + Math.abs(notchDislocationVsOfficial) * 28)
      : notchDislocationVsOfficial < 0
      ? Math.round(Math.abs(notchDislocationVsOfficial) * 32)
      : Math.round(-notchDislocationVsOfficial * 18);

    const ratingActionSignal: SovereignShadowRatingRow['ratingActionSignal'] =
      isFallenAngelWarning
        ? 'FALLEN_ANGEL_CLIFF_ALERT'
        : notchDislocationVsOfficial <= -2
        ? 'MULTI_NOTCH_DOWNGRADE_WATCH'
        : notchDislocationVsOfficial >= 1
        ? 'RISING_STAR_UPGRADE_CANDIDATE'
        : 'ALIGNED_STABLE_OUTLOOK';

    return {
      iso3: snap.iso3,
      countryName: snap.countryName,
      officialRating: officialEntry.spFitch,
      officialMoodysEquivalent: officialEntry.moodys,
      officialNumericNotch: officialEntry.notch,
      baselineShadowRating: baseShadowEntry.spFitch,
      baselineShadowNotch: baseShadowEntry.notch,
      stressedShadowRating: stressedShadowEntry.spFitch,
      stressedShadowNotch: stressedShadowEntry.notch,
      notchDislocationVsOfficial,
      distanceToInvestmentGradeCliffNotches,
      isFallenAngelWarning,
      prob12MUpgradePct,
      prob12MStablePct,
      prob12MDowngradePct,
      forcedIndexSellingSpreadImpactBps,
      ratingActionSignal,
      isCurrentActiveSovereign: isCurrent,
    };
  });

  peerRatingLadder.sort((a, b) => b.stressedShadowNotch - a.stressedShadowNotch);

  const activeSovereignRow =
    peerRatingLadder.find((r) => r.isCurrentActiveSovereign) || peerRatingLadder[0];
  const compositeShadowScore = Math.round(
    activePillars.reduce((acc, p) => acc + p.stressedScore * (p.weightPct / 100), 0)
  );

  return {
    headlineDiagnostic: `${activeSovereignRow.countryName} (${activeSovereignRow.iso3}) carries an Official Rating of ${activeSovereignRow.officialRating} (${activeSovereignRow.officialMoodysEquivalent}) vs. a 5-Pillar Quantitative Shadow Rating of ${activeSovereignRow.stressedShadowRating} (${activeSovereignRow.notchDislocationVsOfficial >= 0 ? `+${activeSovereignRow.notchDislocationVsOfficial}` : activeSovereignRow.notchDislocationVsOfficial} notch delta; 12M Downgrade Prob: ${activeSovereignRow.prob12MDowngradePct}%).`,
    activeSovereignRow,
    pillars: activePillars,
    peerRatingLadder,
    fallenAngelCliffSpreadBps: activeSovereignRow.forcedIndexSellingSpreadImpactBps,
    compositeShadowScore,
  };
}

/**
 * 8.2 FX Equilibrium & Real Effective Exchange Rate (BEER / FEER) Valuation Lab
 */
export function computeFxEquilibriumValuationSuite(
  activeOpenData: OpenDataSnapshot,
  watchlistItems: WatchlistItem[],
  stressInputs: FxEquilibriumStressInputs = DEFAULT_FX_EQUILIBRIUM_STRESS
): FxEquilibriumValuationSuite {
  const hasActive = watchlistItems.some((w) => w.iso3 === activeOpenData.iso3);
  const allItems: { iso3: string; countryName: string }[] = hasActive
    ? watchlistItems
    : [
        {
          iso3: activeOpenData.iso3,
          countryName: activeOpenData.countryName,
        },
        ...watchlistItems,
      ];

  const peerFxValuationTable: SovereignFxEquilibriumRow[] = allItems.map((item) => {
    const isCurrent = item.iso3 === activeOpenData.iso3;
    const snap = isCurrent ? activeOpenData : buildBaselineOpenData(item.iso3);

    const caGdp = snap.worldBankIndicators.currentAccountPctGdp;
    const cpi = snap.imfIndicators.cpiInflationPct;
    const polRate = snap.monetaryAndMarket.policyRatePct;
    const realRateLocalPct = polRate - cpi;
    const usRealRatePct = 2.1; // Benchmark US real policy rate anchor
    const baseRealCarryBps = Math.round((realRateLocalPct - usRealRatePct) * 100);
    const realCarryDifferentialBps = isCurrent
      ? baseRealCarryBps + stressInputs.realRateDifferentialShiftBps
      : baseRealCarryBps;

    // Spot REER Index (Base 100 = 10Y historical average)
    // High inflation without commensurate nominal depreciation pushes Spot REER above 100
    const spotReerIndex = Number(
      clamp(
        100 + (cpi - 4.0) * 1.45 - caGdp * 2.1 + (realCarryDifferentialBps / 100) * 0.85,
        74,
        134
      ).toFixed(1)
    );

    // 1. Behavioral Equilibrium Exchange Rate (BEER) Fair Value Index
    const totShift = isCurrent ? stressInputs.termsOfTradeShockPct : 0;
    const prodShift = isCurrent ? stressInputs.balassaSamuelsonProductivityShiftPct : 0;
    const nfaProxyPctGdp = snap.worldBankIndicators.fxReservesMonthsImport * 3.2 - snap.worldBankIndicators.externalDebtPctGni * 0.42;

    const beerEquilibriumReerIndex = Number(
      clamp(
        100 +
          (snap.imfIndicators.realGdpGrowthPct - 2.4) * 1.85 +
          nfaProxyPctGdp * 0.18 +
          totShift * 0.48 +
          prodShift * 1.9 +
          (realCarryDifferentialBps / 100) * 0.35,
        78,
        128
      ).toFixed(1)
    );

    const beerMisalignmentPct = Number(
      (((spotReerIndex - beerEquilibriumReerIndex) / beerEquilibriumReerIndex) * 100).toFixed(1)
    );

    // 2. IMF External Balance Assessment (FEER) Structural Current Account Norm (% GDP)
    const structuralCurrentAccountNormPctGdp = Number(
      clamp(-1.2 + (snap.imfIndicators.realGdpGrowthPct > 3.5 ? -0.8 : 0.6), -3.5, 2.5).toFixed(2)
    );
    const cyclicallyAdjustedCurrentAccountPctGdp = Number(
      (caGdp + (isCurrent ? totShift * 0.14 : 0)).toFixed(2)
    );
    const currentAccountGapPctGdp = Number(
      (cyclicallyAdjustedCurrentAccountPctGdp - structuralCurrentAccountNormPctGdp).toFixed(2)
    );

    // Trade semi-elasticity eta (typical EM/DM range 0.22 to 0.28)
    const tradeElasticityEta = 0.24;
    // If CA Gap < 0 (deficit worse than norm), currency is Overvalued (+)
    const feerImpliedMisalignmentPct = Number(
      clamp((-currentAccountGapPctGdp / tradeElasticityEta), -32, 36).toFixed(1)
    );

    const consensusFxMisalignmentPct = Number(
      (beerMisalignmentPct * 0.5 + feerImpliedMisalignmentPct * 0.5).toFixed(1)
    );
    const requiredRealFxAdjustmentPct = Number((-consensusFxMisalignmentPct).toFixed(1));

    const devaluation12MTailProbPct = clamp(
      Math.round(
        16 +
          Math.max(0, consensusFxMisalignmentPct) * 2.35 +
          Math.max(0, 4.5 - snap.worldBankIndicators.fxReservesMonthsImport) * 8.5 -
          Math.max(0, realCarryDifferentialBps) * 0.02
      ),
      5,
      92
    );

    const fxValuationRegime: SovereignFxEquilibriumRow['fxValuationRegime'] =
      consensusFxMisalignmentPct >= 10
        ? 'SEVERELY_OVERVALUED_DEVALUATION_RISK'
        : consensusFxMisalignmentPct >= 4
        ? 'MODERATELY_OVERVALUED'
        : consensusFxMisalignmentPct <= -4
        ? 'UNDERVALUED_REAL_CARRY_LONG'
        : 'FAIR_VALUE_EQUILIBRIUM';

    const recommendedFxExpression =
      fxValuationRegime === 'SEVERELY_OVERVALUED_DEVALUATION_RISK'
        ? `Long USD/${snap.currencyCode} 6M NDF Outright (Spot REER +${consensusFxMisalignmentPct}% overvalued vs. BEER/FEER)`
        : fxValuationRegime === 'MODERATELY_OVERVALUED'
        ? `FX-Hedged Local Bond Only · Avoid Unhedged ${snap.currencyCode} Spot Exposure`
        : fxValuationRegime === 'UNDERVALUED_REAL_CARRY_LONG'
        ? `Long ${snap.currencyCode} Total Return Carry (${consensusFxMisalignmentPct}% undervalued + ${realCarryDifferentialBps} bps real carry)`
        : `Neutral ${snap.currencyCode} Spot · Harvest Relative Value Vol Skew`;

    return {
      iso3: snap.iso3,
      countryName: snap.countryName,
      currencyCode: snap.currencyCode,
      spotReerIndex,
      beerEquilibriumReerIndex,
      beerMisalignmentPct,
      structuralCurrentAccountNormPctGdp,
      cyclicallyAdjustedCurrentAccountPctGdp,
      currentAccountGapPctGdp,
      tradeElasticityEta,
      feerImpliedMisalignmentPct,
      consensusFxMisalignmentPct,
      requiredRealFxAdjustmentPct,
      realCarryDifferentialBps,
      devaluation12MTailProbPct,
      fxValuationRegime,
      recommendedFxExpression,
      isCurrentActiveSovereign: isCurrent,
    };
  });

  peerFxValuationTable.sort(
    (a, b) => b.consensusFxMisalignmentPct - a.consensusFxMisalignmentPct
  );

  const activeSovereignFx =
    peerFxValuationTable.find((r) => r.isCurrentActiveSovereign) || peerFxValuationTable[0];
  const mostOvervaluedSovereign = peerFxValuationTable[0];
  const mostUndervaluedSovereign =
    peerFxValuationTable[peerFxValuationTable.length - 1] || peerFxValuationTable[0];

  return {
    headlineDiagnostic: `${activeSovereignFx.countryName} (${activeSovereignFx.currencyCode}) Spot REER (${activeSovereignFx.spotReerIndex}) trades at a ${activeSovereignFx.consensusFxMisalignmentPct >= 0 ? `+${activeSovereignFx.consensusFxMisalignmentPct}% Overvaluation` : `${activeSovereignFx.consensusFxMisalignmentPct}% Undervaluation`} vs. BEER (${activeSovereignFx.beerEquilibriumReerIndex}) & FEER Current Account Norm (${activeSovereignFx.structuralCurrentAccountNormPctGdp}% GDP), implying a ${activeSovereignFx.requiredRealFxAdjustmentPct >= 0 ? `+${activeSovereignFx.requiredRealFxAdjustmentPct}%` : `${activeSovereignFx.requiredRealFxAdjustmentPct}%`} real adjustment.`,
    activeSovereignFx,
    peerFxValuationTable,
    mostOvervaluedSovereign,
    mostUndervaluedSovereign,
  };
}

/**
 * 8.3 Sovereign Debt Investor Base (IMF SDIB) & Domestic Bank "Doom Loop" Matrix
 */
export function computeInvestorBaseDoomLoopSuite(
  activeOpenData: OpenDataSnapshot,
  watchlistItems: WatchlistItem[],
  stressInputs: InvestorBaseDoomLoopStressInputs = DEFAULT_INVESTOR_BASE_STRESS
): InvestorBaseDoomLoopSuite {
  const hasActive = watchlistItems.some((w) => w.iso3 === activeOpenData.iso3);
  const allItems: { iso3: string; countryName: string }[] = hasActive
    ? watchlistItems
    : [
        {
          iso3: activeOpenData.iso3,
          countryName: activeOpenData.countryName,
        },
        ...watchlistItems,
      ];

  const peerInvestorBaseMatrix: SovereignInvestorBaseRow[] = allItems.map((item) => {
    const isCurrent = item.iso3 === activeOpenData.iso3;
    const snap = isCurrent ? activeOpenData : buildBaselineOpenData(item.iso3);

    const debtGdp = snap.imfIndicators.debtToGdpPct;
    const extDebtShareProxy = clamp(
      Math.round(snap.worldBankIndicators.externalDebtPctGni * 0.52),
      14,
      54
    );

    // 5-Sector Creditor Decomposition (Strictly % of Total Public Debt summing to 100%)
    const foreignOfficialSharePct = clamp(
      snap.iso3 === 'EGY' || snap.iso3 === 'ARG' || snap.iso3 === 'KEN'
        ? 22
        : snap.iso3 === 'USA' || snap.iso3 === 'DEU'
        ? 14
        : 10,
      6,
      28
    );
    const foreignPrivateSharePct = clamp(
      extDebtShareProxy - foreignOfficialSharePct,
      8,
      36
    );
    const domesticCentralBankSharePct = clamp(
      snap.iso3 === 'JPN' ? 44 : snap.iso3 === 'USA' || snap.iso3 === 'GBR' ? 20 : 12,
      8,
      46
    );
    const domesticBanksSharePct = clamp(
      Math.round(
        26 +
          Math.max(0, debtGdp - 55) * 0.22 -
          (foreignPrivateSharePct - 18) * 0.35
      ),
      18,
      48
    );
    const domesticNonBankSharePct = Math.max(
      6,
      100 -
        (foreignOfficialSharePct +
          foreignPrivateSharePct +
          domesticCentralBankSharePct +
          domesticBanksSharePct)
    );

    // Sovereign debt holdings as % of Domestic Banking System Tier-1 CET1 Capital
    const sovereignHoldingsPctOfBankTier1Cet1 = Math.round(
      domesticBanksSharePct * (debtGdp / 14.5)
    );

    const baselineBankSystemCet1RatioPct = Number(
      clamp(15.2 - (domesticBanksSharePct - 25) * 0.11, 11.2, 16.8).toFixed(1)
    );

    const effForeignExitPct = isCurrent
      ? stressInputs.foreignPrivateExitShockPct
      : 10;
    const effBondHaircutPct = isCurrent
      ? stressInputs.sovereignBondHaircutMarkToMarketPct
      : 12;

    // CET1 erosion from MTM sovereign bond haircut + forced domestic bank absorption of foreign exit
    const cet1CapitalErosionPctPts = Number(
      (
        (sovereignHoldingsPctOfBankTier1Cet1 / 100) *
        (effBondHaircutPct / 100) *
        baselineBankSystemCet1RatioPct *
        0.58 +
        effForeignExitPct * 0.045
      ).toFixed(2)
    );

    const stressedBankSystemCet1RatioPct = Number(
      Math.max(4.5, baselineBankSystemCet1RatioPct - cet1CapitalErosionPctPts).toFixed(2)
    );

    const suddenStop10YRepricingBps = Math.round(
      effForeignExitPct * (foreignPrivateSharePct * 0.42) +
        Math.max(0, sovereignHoldingsPctOfBankTier1Cet1 - 150) * 0.38
    );

    const doomLoopContagionScore = clamp(
      Math.round(
        domesticBanksSharePct * 1.15 +
          (sovereignHoldingsPctOfBankTier1Cet1 / 4.2) +
          cet1CapitalErosionPctPts * 8.5
      ),
      15,
      98
    );

    const doomLoopRegime: SovereignInvestorBaseRow['doomLoopRegime'] =
      doomLoopContagionScore >= 75 || stressedBankSystemCet1RatioPct < 9.5
        ? 'CRITICAL_SOVEREIGN_BANK_DOOM_LOOP'
        : domesticBanksSharePct >= 34
        ? 'ELEVATED_DOMESTIC_CROWDING_OUT'
        : foreignPrivateSharePct >= 26
        ? 'FOREIGN_SUDDEN_STOP_VULNERABLE'
        : 'DIVERSIFIED_RESILIENT_BASE';

    return {
      iso3: snap.iso3,
      countryName: snap.countryName,
      domesticBanksSharePct,
      domesticNonBankSharePct,
      domesticCentralBankSharePct,
      foreignPrivateSharePct,
      foreignOfficialSharePct,
      sovereignHoldingsPctOfBankTier1Cet1,
      baselineBankSystemCet1RatioPct,
      stressedBankSystemCet1RatioPct,
      cet1CapitalErosionPctPts,
      suddenStop10YRepricingBps,
      doomLoopContagionScore,
      doomLoopRegime,
      isCurrentActiveSovereign: isCurrent,
    };
  });

  peerInvestorBaseMatrix.sort((a, b) => b.doomLoopContagionScore - a.doomLoopContagionScore);

  const activeSovereignRow =
    peerInvestorBaseMatrix.find((r) => r.isCurrentActiveSovereign) ||
    peerInvestorBaseMatrix[0];

  const foreignDrainPctOfTotalDebt = Number(
    (
      activeSovereignRow.foreignPrivateSharePct *
      (stressInputs.foreignPrivateExitShockPct / 100)
    ).toFixed(1)
  );

  const postForeignPrivate = Number(
    Math.max(
      1,
      activeSovereignRow.foreignPrivateSharePct - foreignDrainPctOfTotalDebt
    ).toFixed(1)
  );
  // Domestic commercial banks absorb 70% of the foreign exit; domestic pensions absorb 30%
  const postDomBanks = Number(
    (activeSovereignRow.domesticBanksSharePct + foreignDrainPctOfTotalDebt * 0.7).toFixed(1)
  );
  const postDomNonBank = Number(
    (activeSovereignRow.domesticNonBankSharePct + foreignDrainPctOfTotalDebt * 0.3).toFixed(1)
  );

  const activeCreditorBreakdown: InvestorBaseCreditorShare[] = [
    {
      sectorId: 'DOMESTIC_COMMERCIAL_BANKS',
      sectorLabel: 'Domestic Commercial Banks (Tier-1 Balance Sheet)',
      baselineSharePctOfTotalDebt: activeSovereignRow.domesticBanksSharePct,
      postShockSharePctOfTotalDebt: postDomBanks,
      rolloverStabilityScore: 76,
      typicalDurationYears: 3.4,
      flightSensitivityLabel: 'Captive / High Doom-Loop Contagion Risk',
    },
    {
      sectorId: 'DOMESTIC_PENSIONS_INSURERS',
      sectorLabel: 'Domestic Non-Bank (Pensions, Insurers & Mutual Funds)',
      baselineSharePctOfTotalDebt: activeSovereignRow.domesticNonBankSharePct,
      postShockSharePctOfTotalDebt: postDomNonBank,
      rolloverStabilityScore: 84,
      typicalDurationYears: 7.8,
      flightSensitivityLabel: 'Long-Duration Liability-Matched Anchor',
    },
    {
      sectorId: 'DOMESTIC_CENTRAL_BANK',
      sectorLabel: 'Domestic Central Bank (SOMA / Monetary Portfolio)',
      baselineSharePctOfTotalDebt: activeSovereignRow.domesticCentralBankSharePct,
      postShockSharePctOfTotalDebt: activeSovereignRow.domesticCentralBankSharePct,
      rolloverStabilityScore: 94,
      typicalDurationYears: 6.2,
      flightSensitivityLabel: 'Policy Backstop / Inflation Pass-Through Constraint',
    },
    {
      sectorId: 'FOREIGN_PRIVATE_REAL_MONEY',
      sectorLabel: 'Foreign Private Real-Money & Macro Hedge Funds',
      baselineSharePctOfTotalDebt: activeSovereignRow.foreignPrivateSharePct,
      postShockSharePctOfTotalDebt: postForeignPrivate,
      rolloverStabilityScore: 38,
      typicalDurationYears: 5.1,
      flightSensitivityLabel: 'High Sudden-Stop Outflow & FX Hedging Beta',
    },
    {
      sectorId: 'FOREIGN_OFFICIAL_MULTILATERAL',
      sectorLabel: 'Foreign Official (IMF / World Bank / Bilateral / Reserve Mgrs)',
      baselineSharePctOfTotalDebt: activeSovereignRow.foreignOfficialSharePct,
      postShockSharePctOfTotalDebt: activeSovereignRow.foreignOfficialSharePct,
      rolloverStabilityScore: 89,
      typicalDurationYears: 9.5,
      flightSensitivityLabel: 'Concessional / Senior Preferred Creditor Status',
    },
  ];

  const exitSteps = [0, 5, 10, 15, 20, 25, 30, 35];
  const suddenStopCurve = exitSteps.map((exitPct) => {
    const yldDelta = Math.round(
      exitPct * (activeSovereignRow.foreignPrivateSharePct * 0.42) +
        Math.max(0, activeSovereignRow.sovereignHoldingsPctOfBankTier1Cet1 - 150) * 0.25
    );
    const cet1Drop =
      (activeSovereignRow.sovereignHoldingsPctOfBankTier1Cet1 / 100) *
        (stressInputs.sovereignBondHaircutMarkToMarketPct / 100) *
        activeSovereignRow.baselineBankSystemCet1RatioPct *
        0.58 +
      exitPct * 0.045;
    return {
      foreignExitPct: exitPct,
      projected10YYieldBpsDelta: yldDelta,
      stressedBankCet1RatioPct: Number(
        Math.max(4.5, activeSovereignRow.baselineBankSystemCet1RatioPct - cet1Drop).toFixed(2)
      ),
    };
  });

  return {
    headlineDiagnostic: `${activeSovereignRow.countryName} (${activeSovereignRow.iso3}) Domestic Commercial Banks hold ${activeSovereignRow.domesticBanksSharePct}% of total sovereign debt (${activeSovereignRow.sovereignHoldingsPctOfBankTier1Cet1}% of Bank Tier-1 CET1 Capital). Under a ${stressInputs.foreignPrivateExitShockPct}% Foreign Sudden-Stop and ${stressInputs.sovereignBondHaircutMarkToMarketPct}% Bond MTM Haircut, Bank System CET1 erodes by -${activeSovereignRow.cet1CapitalErosionPctPts}% pts (${activeSovereignRow.baselineBankSystemCet1RatioPct}% → ${activeSovereignRow.stressedBankSystemCet1RatioPct}%) and 10Y yields reprice +${activeSovereignRow.suddenStop10YRepricingBps} bps.`,
    activeSovereignRow,
    activeCreditorBreakdown,
    peerInvestorBaseMatrix,
    suddenStopCurve,
  };
}

/**
 * 8.4 Multi-Sovereign Investment Committee (IC) Pitchbook & Comparative Dossier Builder
 */
export function buildBoardroomICPitchbookDossier(
  run: CouncilAssessmentRun,
  watchlistItems: WatchlistItem[],
  customCommitteeVote?: BoardroomICPitchbookDossier['recommendedCommitteeVote'],
  customThesisNote?: string
): BoardroomICPitchbookDossier {
  const shadowSuite = computeSovereignShadowRatingSuite(run.openData, watchlistItems);
  const fxSuite = computeFxEquilibriumValuationSuite(run.openData, watchlistItems);
  const investorSuite = computeInvestorBaseDoomLoopSuite(run.openData, watchlistItems);
  const dislocationSuite = computeCrossSovereignDislocationScreener(
    run.openData,
    watchlistItems
  );
  const preMortemSuite = computePreMortemAndKillSwitchSuite(run);
  const predictionSuite = computePredictionMarketArbitrageSuite(run.openData);

  const comparativeMatrix: ICPitchbookSovereignComparisonRow[] =
    shadowSuite.peerRatingLadder.map((ratingRow) => {
      const fxRow =
        fxSuite.peerFxValuationTable.find((f) => f.iso3 === ratingRow.iso3) ||
        fxSuite.activeSovereignFx;
      const invRow =
        investorSuite.peerInvestorBaseMatrix.find((i) => i.iso3 === ratingRow.iso3) ||
        investorSuite.activeSovereignRow;
      const disRow = dislocationSuite.rows.find((d) => d.iso3 === ratingRow.iso3);

      const spot5YCdsBps =
        disRow?.market5YCdsSpreadBps || run.openData.monetaryAndMarket.cds5YSpreadBps;
      const modelVsMarketCdsGapPct = disRow?.defaultProbGapPct || 0;

      const icConvictionVote: ICPitchbookSovereignComparisonRow['icConvictionVote'] =
        modelVsMarketCdsGapPct >= 4 && ratingRow.notchDislocationVsOfficial >= 0
          ? 'OVERWEIGHT_LONG'
          : modelVsMarketCdsGapPct <= -4 ||
            ratingRow.isFallenAngelWarning ||
            invRow.doomLoopContagionScore >= 76
          ? 'UNDERWEIGHT_SHORT_HEDGE'
          : 'MARKET_WEIGHT_HOLD';

      const primaryTradeStructure =
        icConvictionVote === 'OVERWEIGHT_LONG'
          ? `Sell ${ratingRow.iso3} 5Y CDS Protection (${spot5YCdsBps} bps) + Long ${fxRow.currencyCode} Carry`
          : icConvictionVote === 'UNDERWEIGHT_SHORT_HEDGE'
          ? `Buy ${ratingRow.iso3} 5Y CDS Protection + Long USD/${fxRow.currencyCode} 6M NDF Hedge`
          : `Market-Weight Curve Steepener (2s10s) · Zero Net Duration Tilt`;

      return {
        iso3: ratingRow.iso3,
        countryName: ratingRow.countryName,
        currencyCode: fxRow.currencyCode,
        spot5YCdsBps,
        modelVsMarketCdsGapPct,
        officialVsShadowRating: `${ratingRow.officialRating} → ${ratingRow.stressedShadowRating}`,
        notchDislocation: ratingRow.notchDislocationVsOfficial,
        consensusFxMisalignmentPct: fxRow.consensusFxMisalignmentPct,
        bankDoomLoopScore: invRow.doomLoopContagionScore,
        cet1PostStressPct: invRow.stressedBankSystemCet1RatioPct,
        topPredictionEventOddsCents:
          ratingRow.iso3 === run.iso3
            ? predictionSuite.topEventVsCdsDislocationContract.yesPriceCents
            : Math.max(15, Math.min(82, Math.round(spot5YCdsBps / 9.5))),
        icConvictionVote,
        primaryTradeStructure,
        isCurrentActiveSovereign: ratingRow.isCurrentActiveSovereign,
      };
    });

  const activeComp =
    comparativeMatrix.find((c) => c.isCurrentActiveSovereign) || comparativeMatrix[0];

  const defaultVote: BoardroomICPitchbookDossier['recommendedCommitteeVote'] =
    activeComp.icConvictionVote === 'OVERWEIGHT_LONG'
      ? 'APPROVE_OVERWEIGHT_ALLOCATION'
      : activeComp.icConvictionVote === 'UNDERWEIGHT_SHORT_HEDGE'
      ? 'APPROVE_DEFENSIVE_CDS_HEDGE'
      : 'HOLD_NEUTRAL_WAIT_FOR_CATALYST';

  const defaultThesis = `${run.countryName} (${run.iso3}) trades at a 5Y CDS spread of ${activeComp.spot5YCdsBps} bps (${activeComp.modelVsMarketCdsGapPct >= 0 ? `+${activeComp.modelVsMarketCdsGapPct}%` : `${activeComp.modelVsMarketCdsGapPct}%`} market-vs-model probability dislocation), with a 5-Pillar Quantitative Shadow Rating of ${shadowSuite.activeSovereignRow.stressedShadowRating} vs. Official ${shadowSuite.activeSovereignRow.officialRating}, ${fxSuite.activeSovereignFx.consensusFxMisalignmentPct >= 0 ? `+${fxSuite.activeSovereignFx.consensusFxMisalignmentPct}%` : `${fxSuite.activeSovereignFx.consensusFxMisalignmentPct}%`} BEER/FEER FX misalignment, and ${investorSuite.activeSovereignRow.domesticBanksSharePct}% domestic bank debt ownership (${investorSuite.activeSovereignRow.sovereignHoldingsPctOfBankTier1Cet1}% of Tier-1 CET1). Recommended IC Expression: ${activeComp.primaryTradeStructure}.`;

  return {
    dossierId: `IC-PITCH-${run.iso3}-${new Date().toISOString().slice(0, 10)}`,
    generatedAtIso: new Date().toISOString(),
    committeeTitle: `Global Macro & Sovereign Fixed-Income Investment Committee Pitchbook — ${run.countryName} (${run.iso3}) & Peer Matrix`,
    activeCountryName: run.countryName,
    activeIso3: run.iso3,
    icExecutiveThesis: customThesisNote || defaultThesis,
    recommendedCommitteeVote: customCommitteeVote || defaultVote,
    convictionConfidencePct: Math.round(
      Math.min(
        96,
        Math.max(
          68,
          74 +
            Math.abs(activeComp.modelVsMarketCdsGapPct) * 1.2 +
            Math.abs(activeComp.notchDislocation) * 4
        )
      )
    ),
    keyThesisPillars: [
      `Shadow Rating & Index Cliff: Official ${shadowSuite.activeSovereignRow.officialRating} (${shadowSuite.activeSovereignRow.officialMoodysEquivalent}) vs. Shadow ${shadowSuite.activeSovereignRow.stressedShadowRating} (${shadowSuite.activeSovereignRow.notchDislocationVsOfficial >= 0 ? `+${shadowSuite.activeSovereignRow.notchDislocationVsOfficial}` : shadowSuite.activeSovereignRow.notchDislocationVsOfficial} notches · 12M Downgrade Prob: ${shadowSuite.activeSovereignRow.prob12MDowngradePct}%).`,
      `FX BEER/FEER Equilibrium: ${fxSuite.activeSovereignFx.currencyCode} Spot REER (${fxSuite.activeSovereignFx.spotReerIndex}) shows ${fxSuite.activeSovereignFx.consensusFxMisalignmentPct >= 0 ? `+${fxSuite.activeSovereignFx.consensusFxMisalignmentPct}%` : `${fxSuite.activeSovereignFx.consensusFxMisalignmentPct}%`} consensus misalignment (BEER: ${fxSuite.activeSovereignFx.beerMisalignmentPct}% | FEER: ${fxSuite.activeSovereignFx.feerImpliedMisalignmentPct}%).`,
      `Creditor Base & Bank Doom-Loop: Domestic banks hold ${investorSuite.activeSovereignRow.domesticBanksSharePct}% of total debt (${investorSuite.activeSovereignRow.sovereignHoldingsPctOfBankTier1Cet1}% of Tier-1 CET1); stressed CET1 ratio is ${investorSuite.activeSovereignRow.stressedBankSystemCet1RatioPct}%.`,
      `Prediction Market vs. CDS Signal: Top binary contract "${predictionSuite.topEventVsCdsDislocationContract.tickerOrSlug}" trades at ${predictionSuite.topEventVsCdsDislocationContract.yesPriceCents}¢ vs. ${predictionSuite.topEventVsCdsDislocationContract.cdsHazardImpliedProbPct}% CDS-implied hazard.`,
    ],
    killSwitchGovernanceRules: preMortemSuite.killSwitchTripwires.slice(0, 4).map((ks) => ({
      triggerMetric: ks.indicatorLabel,
      currentLevel: ks.currentLiveReading,
      hardStopLimit: ks.hardStopThreshold,
      mandatoryAction: ks.automatedExecutionProtocol,
    })),
    comparativeMatrix,
    croSignOffAttestation: `SMCR-1.0 & Investment Committee Governance Attestation — All metrics normalized in % of GDP, basis points (bps), rating notches, and % creditor shares (Zero Notional Exposure Assumption). CRO Override Notes: ${run.croState.croNotes}`,
  };
}

/**
 * Exports a Multi-Page Institutional PDF Investment Committee Pitchbook Dossier
 */
export async function exportICPitchbookPdfDossier(dossier: BoardroomICPitchbookDossier): Promise<void> {
  // The PDF library is large, so it loads only when someone exports.
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 16;

  // Header Banner
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageW, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('SOVEREIGN COUNCIL ORCHESTRATOR — INVESTMENT COMMITTEE PITCHBOOK', 14, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(
    `Dossier ID: ${dossier.dossierId}   |   Target: ${dossier.activeCountryName} (${dossier.activeIso3})   |   Vote: ${dossier.recommendedCommitteeVote} (${dossier.convictionConfidencePct}% Confidence)`,
    14,
    21
  );

  y = 36;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('1. EXECUTIVE INVESTMENT COMMITTEE THESIS & CONVICTION VOTE', 14, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const thesisLines = doc.splitTextToSize(dossier.icExecutiveThesis, pageW - 28);
  doc.text(thesisLines, 14, y);
  y += thesisLines.length * 4.5 + 4;

  // 4 Analytical Pillars
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('2. FOUR-PILLAR QUANTITATIVE & CROSS-ASSET EVIDENCE', 14, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  dossier.keyThesisPillars.forEach((pillar, idx) => {
    const pLines = doc.splitTextToSize(`${idx + 1}. ${pillar}`, pageW - 28);
    doc.text(pLines, 14, y);
    y += pLines.length * 4.2 + 2;
  });

  y += 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('3. CROSS-SOVEREIGN COMPARATIVE SCORECARD (ZERO-NOTIONAL METRICS)', 14, y);
  y += 6;

  // Table Header
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y - 4, pageW - 28, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('Sovereign', 16, y);
  doc.text('5Y CDS', 48, y);
  doc.text('Mod-Mkt', 66, y);
  doc.text('Rating -> Shadow', 86, y);
  doc.text('FX Misalign', 118, y);
  doc.text('DoomLoop', 142, y);
  doc.text('IC Vote', 164, y);
  y += 5.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  dossier.comparativeMatrix.forEach((row) => {
    if (y > 265) {
      doc.addPage();
      y = 20;
    }
    if (row.isCurrentActiveSovereign) {
      doc.setFont('helvetica', 'bold');
    } else {
      doc.setFont('helvetica', 'normal');
    }
    doc.text(`${row.countryName} (${row.iso3})`, 16, y);
    doc.text(`${row.spot5YCdsBps} bp`, 48, y);
    doc.text(
      `${row.modelVsMarketCdsGapPct >= 0 ? `+${row.modelVsMarketCdsGapPct}` : row.modelVsMarketCdsGapPct}%`,
      66,
      y
    );
    doc.text(row.officialVsShadowRating, 86, y);
    doc.text(
      `${row.consensusFxMisalignmentPct >= 0 ? `+${row.consensusFxMisalignmentPct}` : row.consensusFxMisalignmentPct}%`,
      118,
      y
    );
    doc.text(`${row.bankDoomLoopScore}/100`, 142, y);
    doc.text(row.icConvictionVote.replace(/_/g, ' '), 164, y);
    y += 5;
  });

  // Page 2: Kill-Switch Governance Tripwires & CRO Attestation
  doc.addPage();
  y = 20;

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageW, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(
    `PRE-MORTEM KILL-SWITCH TRIPWIRES & CRO GOVERNANCE ATTESTATION — ${dossier.activeIso3}`,
    14,
    13
  );

  y = 30;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('4. AUTOMATED PRE-MORTEM KILL-SWITCH GOVERNANCE RULES', 14, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  dossier.killSwitchGovernanceRules.forEach((ks, idx) => {
    const line = `${idx + 1}. ${ks.triggerMetric} | Live: ${ks.currentLevel} | Hard Stop: ${ks.hardStopLimit} -> Action: ${ks.mandatoryAction}`;
    const wrapped = doc.splitTextToSize(line, pageW - 28);
    doc.text(wrapped, 14, y);
    y += wrapped.length * 4.5 + 2.5;
  });

  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('5. CHIEF RISK OFFICER (CRO) & SMCR-1.0 GOVERNANCE ATTESTATION', 14, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const croWrapped = doc.splitTextToSize(dossier.croSignOffAttestation, pageW - 28);
  doc.text(croWrapped, 14, y);

  doc.save(`${dossier.dossierId}.pdf`);
}

/**
 * Exports a Markdown Investment Committee Pitchbook Memo (.md)
 */
export function exportICPitchbookMarkdownMemo(dossier: BoardroomICPitchbookDossier): void {
  const rowsMd = dossier.comparativeMatrix
    .map(
      (r) =>
        `| ${r.countryName} (${r.iso3}) | ${r.spot5YCdsBps} bps | ${r.modelVsMarketCdsGapPct >= 0 ? `+${r.modelVsMarketCdsGapPct}%` : `${r.modelVsMarketCdsGapPct}%`} | ${r.officialVsShadowRating} | ${r.consensusFxMisalignmentPct >= 0 ? `+${r.consensusFxMisalignmentPct}%` : `${r.consensusFxMisalignmentPct}%`} | ${r.bankDoomLoopScore}/100 (CET1 ${r.cet1PostStressPct}%) | ${r.topPredictionEventOddsCents}¢ | **${r.icConvictionVote}** |`
    )
    .join('\n');

  const ksMd = dossier.killSwitchGovernanceRules
    .map(
      (k) =>
        `- **${k.triggerMetric}**: Current \`${k.currentLevel}\` vs. Hard Stop \`${k.hardStopLimit}\` → *${k.mandatoryAction}*`
    )
    .join('\n');

  const md = `# ${dossier.committeeTitle}
- **Dossier ID**: \`${dossier.dossierId}\`
- **Generated At**: \`${dossier.generatedAtIso}\`
- **Recommended Committee Vote**: \`${dossier.recommendedCommitteeVote}\` (${dossier.convictionConfidencePct}% Conviction)

## 1. Executive Thesis
${dossier.icExecutiveThesis}

## 2. Four-Pillar Quantitative Evidence
${dossier.keyThesisPillars.map((p, i) => `${i + 1}. ${p}`).join('\n')}

## 3. Cross-Sovereign Comparative Matrix (Zero-Notional Units)
| Sovereign | Spot 5Y CDS | Model-Market Gap | Official → Shadow | FX BEER/FEER Misalign | Bank Doom-Loop (Stressed CET1) | Event Odds | IC Vote |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
${rowsMd}

## 4. Pre-Mortem Kill-Switch Governance Rules
${ksMd}

## 5. CRO Attestation
> ${dossier.croSignOffAttestation}
`;

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${dossier.dossierId}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Exports a Canonical JSON Investment Committee Pitchbook Dossier (.json)
 */
export function exportICPitchbookJsonDossier(dossier: BoardroomICPitchbookDossier): void {
  const blob = new Blob([JSON.stringify(dossier, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${dossier.dossierId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
