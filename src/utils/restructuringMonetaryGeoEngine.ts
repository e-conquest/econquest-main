import {
  OpenDataSnapshot,
  WatchlistItem,
  CreditorSeniorityTierId,
  RestructuringTermSheetInputs,
  SovereignCreditorTierRow,
  SovereignRestructuringPeerRow,
  SovereignRestructuringWaterfallSuite,
  TaylorRuleStressInputs,
  SovereignTaylorRuleRow,
  TaylorRuleFiscalDominanceSuite,
  MaritimeChokepointId,
  GeoSanctionsChokepointInputs,
  ReserveCustodyShareRow,
  SovereignGeoRiskRow,
  GeoSanctionsChokepointSuite,
  NgfsClimateScenarioId,
  ClimateFiscalSlbInputs,
  SovereignClimateSlbRow,
  NgfsClimateFiscalSuite,
} from '../types/council';
import { buildBaselineOpenData } from '../data/presetsAndBaselines';

export const DEFAULT_RESTRUCTURING_TERM_SHEET: RestructuringTermSheetInputs = {
  principalHaircutPct: 30,
  couponReductionBps: -200,
  maturityExtensionYears: 6,
  gracePeriodYears: 2,
  exitYieldPct: 11.0,
  vriGdpWarrantKickerBps: 75,
  cacRegime: 'SINGLE_LIMB_AGGREGATED_75',
};

export const DEFAULT_TAYLOR_RULE_INPUTS: TaylorRuleStressInputs = {
  neutralRealRateRStarPct: 1.5,
  inflationTargetPct: 3.0,
  inflationGapWeightAlpha: 0.65,
  outputGapWeightBeta: 0.5,
  fxPassThroughDefenseWeightGamma: 0.25,
  simulatedSupplyInflationShockBps: 0,
};

export const DEFAULT_GEO_SANCTIONS_CHOKEPOINT_INPUTS: GeoSanctionsChokepointInputs = {
  g7ReserveFreezeSeverityPct: 50,
  activeChokepointDisruption: 'strait_of_hormuz',
  chokepointBlockadeIntensityPct: 45,
  secondaryTariffPenaltyBps: 250,
};

export const DEFAULT_CLIMATE_FISCAL_SLB_INPUTS: ClimateFiscalSlbInputs = {
  selectedNgfsScenario: 'DELAYED_DISORDERLY_TRANSITION',
  globalCarbonTaxTrajectoryScore: 65,
  acuteWeatherShockSeverityPct: 40,
  slbTargetMissProbabilityPct: 45,
};

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// Country-calibrated creditor seniority profiles (% of total public debt, summing to 100%)
const CREDITOR_SENIORITY_PROFILES: Record<
  string,
  {
    imfMdbPcsPct: number;
    parisClubPct: number;
    nonParisClubPct: number;
    eurobondsCacPct: number;
    domesticLawPct: number;
    imfDsaSustainabilityTargetGdpPct: number;
  }
> = {
  USA: { imfMdbPcsPct: 0, parisClubPct: 2, nonParisClubPct: 4, eurobondsCacPct: 24, domesticLawPct: 70, imfDsaSustainabilityTargetGdpPct: 95 },
  DEU: { imfMdbPcsPct: 0, parisClubPct: 3, nonParisClubPct: 2, eurobondsCacPct: 35, domesticLawPct: 60, imfDsaSustainabilityTargetGdpPct: 60 },
  GBR: { imfMdbPcsPct: 0, parisClubPct: 2, nonParisClubPct: 3, eurobondsCacPct: 28, domesticLawPct: 67, imfDsaSustainabilityTargetGdpPct: 85 },
  JPN: { imfMdbPcsPct: 0, parisClubPct: 1, nonParisClubPct: 1, eurobondsCacPct: 10, domesticLawPct: 88, imfDsaSustainabilityTargetGdpPct: 180 },
  FRA: { imfMdbPcsPct: 0, parisClubPct: 3, nonParisClubPct: 3, eurobondsCacPct: 44, domesticLawPct: 50, imfDsaSustainabilityTargetGdpPct: 85 },
  ITA: { imfMdbPcsPct: 2, parisClubPct: 4, nonParisClubPct: 2, eurobondsCacPct: 32, domesticLawPct: 60, imfDsaSustainabilityTargetGdpPct: 110 },
  BRA: { imfMdbPcsPct: 3, parisClubPct: 3, nonParisClubPct: 4, eurobondsCacPct: 14, domesticLawPct: 76, imfDsaSustainabilityTargetGdpPct: 72 },
  MEX: { imfMdbPcsPct: 4, parisClubPct: 4, nonParisClubPct: 3, eurobondsCacPct: 29, domesticLawPct: 60, imfDsaSustainabilityTargetGdpPct: 58 },
  IND: { imfMdbPcsPct: 5, parisClubPct: 5, nonParisClubPct: 2, eurobondsCacPct: 8, domesticLawPct: 80, imfDsaSustainabilityTargetGdpPct: 75 },
  CHN: { imfMdbPcsPct: 1, parisClubPct: 1, nonParisClubPct: 2, eurobondsCacPct: 6, domesticLawPct: 90, imfDsaSustainabilityTargetGdpPct: 80 },
  ZAF: { imfMdbPcsPct: 5, parisClubPct: 4, nonParisClubPct: 5, eurobondsCacPct: 24, domesticLawPct: 62, imfDsaSustainabilityTargetGdpPct: 68 },
  TUR: { imfMdbPcsPct: 4, parisClubPct: 5, nonParisClubPct: 9, eurobondsCacPct: 34, domesticLawPct: 48, imfDsaSustainabilityTargetGdpPct: 45 },
  ARG: { imfMdbPcsPct: 22, parisClubPct: 6, nonParisClubPct: 8, eurobondsCacPct: 36, domesticLawPct: 28, imfDsaSustainabilityTargetGdpPct: 55 },
  EGY: { imfMdbPcsPct: 16, parisClubPct: 9, nonParisClubPct: 18, eurobondsCacPct: 22, domesticLawPct: 35, imfDsaSustainabilityTargetGdpPct: 65 },
  NGA: { imfMdbPcsPct: 14, parisClubPct: 6, nonParisClubPct: 14, eurobondsCacPct: 24, domesticLawPct: 42, imfDsaSustainabilityTargetGdpPct: 48 },
  KEN: { imfMdbPcsPct: 24, parisClubPct: 8, nonParisClubPct: 19, eurobondsCacPct: 18, domesticLawPct: 31, imfDsaSustainabilityTargetGdpPct: 55 },
  PAK: { imfMdbPcsPct: 21, parisClubPct: 11, nonParisClubPct: 24, eurobondsCacPct: 12, domesticLawPct: 32, imfDsaSustainabilityTargetGdpPct: 60 },
};

/**
 * Present value of restructured bond per 100c original par:
 * Pre-restructuring baseline assumed 7Y average remaining maturity,coupon = preCouponPct.
 * Post-restructuring: principal = (100 - haircutPct), maturity = 7 + extensionYears,
 * grace = graceYears (interest-only, principal amortized or bullet at maturity),
 * coupon = max(1.0%, preCouponPct + couponReductionBps / 100), discounted at exitYieldPct.
 */
function computeBondNpvCentsPerPar(
  haircutPct: number,
  preCouponPct: number,
  couponReductionBps: number,
  maturityExtensionYears: number,
  gracePeriodYears: number,
  exitYieldPct: number
): number {
  const survivingPrincipal = clamp(100 - haircutPct, 5, 100);
  const newCouponRate = clamp(preCouponPct + couponReductionBps / 100, 0.5, 18.0) / 100;
  const discountRate = clamp(exitYieldPct, 2.0, 35.0) / 100;
  const totalYears = Math.max(2, Math.round(7 + maturityExtensionYears));
  const grace = clamp(Math.round(gracePeriodYears), 0, totalYears - 1);
  const amortYears = Math.max(1, totalYears - grace);

  let pv = 0;
  let remainingPrincipal = survivingPrincipal;
  const annualPrincipalPayment = survivingPrincipal / amortYears;

  for (let t = 1; t <= totalYears; t++) {
    // During grace period, coupon is reduced by 35% step-up structure
    const effectiveCoupon = t <= grace ? newCouponRate * 0.65 : newCouponRate;
    const interestPayment = remainingPrincipal * effectiveCoupon;
    const principalPayment = t > grace ? annualPrincipalPayment : 0;
    const cashflow = interestPayment + principalPayment;
    pv += cashflow / Math.pow(1 + discountRate, t);
    remainingPrincipal = Math.max(0, remainingPrincipal - principalPayment);
  }

  return Number(clamp(pv, 4, 100).toFixed(1));
}

/**
 * 9.1 IMF & Paris Club Debt Restructuring & NPV Recovery Waterfall Simulator
 */
export function computeSovereignRestructuringWaterfallSuite(
  activeOpenData: OpenDataSnapshot,
  watchlistItems: WatchlistItem[],
  termSheet: RestructuringTermSheetInputs = DEFAULT_RESTRUCTURING_TERM_SHEET
): SovereignRestructuringWaterfallSuite {
  const hasActive = watchlistItems.some((w) => w.iso3 === activeOpenData.iso3);
  const allItems: { iso3: string; countryName: string }[] = hasActive
    ? watchlistItems
    : [
        { iso3: activeOpenData.iso3, countryName: activeOpenData.countryName },
        ...watchlistItems,
      ];

  const evaluateSovereignRestructuring = (snap: OpenDataSnapshot) => {
    const profile = CREDITOR_SENIORITY_PROFILES[snap.iso3] || {
      imfMdbPcsPct: 10,
      parisClubPct: 7,
      nonParisClubPct: 11,
      eurobondsCacPct: 27,
      domesticLawPct: 45,
      imfDsaSustainabilityTargetGdpPct: 60,
    };

    const preDebtGdp = snap.imfIndicators.debtToGdpPct;
    const preCouponPct = clamp(snap.monetaryAndMarket.sovereign10YBondYieldPct * 0.72, 3.5, 11.5);
    const vriGainCents = Number(
      ((termSheet.vriGdpWarrantKickerBps / 100) * 2.15 * Math.max(0.4, snap.imfIndicators.realGdpGrowthPct / 2.5)).toFixed(1)
    );

    // 1. IMF / World Bank / MDB Preferred Creditor Status (PCS): 0% principal haircut, 0% coupon cut
    const pcsNpv = 100.0;

    // 2. Paris Club Official Bilateral: Equal-burden Comparability of Treatment (prefers maturity extension + coupon relief over nominal face-value cut, or blended haircut)
    const parisClubHaircutPct = Number((termSheet.principalHaircutPct * 0.75).toFixed(1));
    const parisClubExtYears = Math.min(18, termSheet.maturityExtensionYears + 3);
    const parisClubNpv = computeBondNpvCentsPerPar(
      parisClubHaircutPct,
      preCouponPct * 0.75,
      termSheet.couponReductionBps - 50,
      parisClubExtYears,
      termSheet.gracePeriodYears + 1,
      termSheet.exitYieldPct
    );

    // 3. Non-Paris Club Bilateral: Comparability of treatment benchmarked to Paris Club
    const nonParisHaircutPct = Number((termSheet.principalHaircutPct * 0.7).toFixed(1));
    const nonParisExtYears = Math.min(18, termSheet.maturityExtensionYears + 2);
    const nonParisNpv = computeBondNpvCentsPerPar(
      nonParisHaircutPct,
      preCouponPct * 0.85,
      termSheet.couponReductionBps,
      nonParisExtYears,
      termSheet.gracePeriodYears + 1,
      termSheet.exitYieldPct
    );

    // 4. External Foreign-Law Eurobonds (with CACs + VRI GDP Warrant kicker)
    const baseEurobondNpv = computeBondNpvCentsPerPar(
      termSheet.principalHaircutPct,
      preCouponPct,
      termSheet.couponReductionBps,
      termSheet.maturityExtensionYears,
      termSheet.gracePeriodYears,
      termSheet.exitYieldPct
    );
    const eurobondNpv = Number(clamp(baseEurobondNpv + vriGainCents, 5, 99.5).toFixed(1));

    // 5. Domestic-Law Local Currency Debt (carve-out to prevent domestic bank CET1 collapse: lower nominal haircut, maturity reprofiling)
    const domesticHaircutPct = Number((termSheet.principalHaircutPct * 0.35).toFixed(1));
    const domesticNpv = computeBondNpvCentsPerPar(
      domesticHaircutPct,
      preCouponPct * 1.05,
      Math.round(termSheet.couponReductionBps * 0.5),
      Math.max(2, Math.round(termSheet.maturityExtensionYears * 0.6)),
      Math.max(1, termSheet.gracePeriodYears - 1),
      Math.max(6.0, termSheet.exitYieldPct - 1.5)
    );

    const cacThresholdPct =
      termSheet.cacRegime === 'SINGLE_LIMB_AGGREGATED_75'
        ? 75
        : termSheet.cacRegime === 'DUAL_LIMB_SERIES_66_75'
        ? 66.7
        : 100;

    // Holdout litigation risk rises if haircut is deep (>45%), recovery < 42c, or non-aggregated CACs are used
    const baseHoldoutRisk =
      termSheet.cacRegime === 'SINGLE_LIMB_AGGREGATED_75'
        ? 11
        : termSheet.cacRegime === 'DUAL_LIMB_SERIES_66_75'
        ? 29
        : 68;
    const holdoutProb = clamp(
      Math.round(
        baseHoldoutRisk +
          Math.max(0, termSheet.principalHaircutPct - 35) * 0.65 +
          Math.max(0, 48 - eurobondNpv) * 0.8 -
          termSheet.vriGdpWarrantKickerBps * 0.04
      ),
      4,
      95
    );

    const tiers: SovereignCreditorTierRow[] = [
      {
        tierId: 'imf_world_bank_mdb_pcs',
        tierLabel: 'IMF / World Bank / MDBs (Preferred Creditor)',
        seniorityRank: 1,
        legalRegime: 'Treaty Preferred Creditor Status (De Facto Super-Senior)',
        debtShareOfTotalPct: profile.imfMdbPcsPct,
        preRestructuringDebtGdpPct: Number(((preDebtGdp * profile.imfMdbPcsPct) / 100).toFixed(1)),
        appliedPrincipalHaircutPct: 0,
        maturityExtensionYears: 0,
        couponAdjustmentBps: 0,
        npvRecoveryCentsPerPar: pcsNpv,
        impliedPresentValueLossPct: 0,
        comparabilityStatus: 'PREFERRED_CREDITOR_EXEMPT',
        cacVotingThresholdPct: 100,
        estimatedHoldoutRiskPct: 0,
      },
      {
        tierId: 'paris_club_official_bilateral',
        tierLabel: 'Paris Club Official Bilateral Creditors',
        seniorityRank: 2,
        legalRegime: 'Paris Club Evian / Common Framework Comparability',
        debtShareOfTotalPct: profile.parisClubPct,
        preRestructuringDebtGdpPct: Number(((preDebtGdp * profile.parisClubPct) / 100).toFixed(1)),
        appliedPrincipalHaircutPct: parisClubHaircutPct,
        maturityExtensionYears: parisClubExtYears,
        couponAdjustmentBps: termSheet.couponReductionBps - 50,
        npvRecoveryCentsPerPar: parisClubNpv,
        impliedPresentValueLossPct: Number((100 - parisClubNpv).toFixed(1)),
        comparabilityStatus: 'COMPARABLE_BURDEN_PARITY',
        cacVotingThresholdPct: 100,
        estimatedHoldoutRiskPct: 5,
      },
      {
        tierId: 'non_paris_club_bilateral',
        tierLabel: 'Non-Paris Club Official Bilateral',
        seniorityRank: 3,
        legalRegime: 'G20 Common Framework Bilateral Comparability',
        debtShareOfTotalPct: profile.nonParisClubPct,
        preRestructuringDebtGdpPct: Number(((preDebtGdp * profile.nonParisClubPct) / 100).toFixed(1)),
        appliedPrincipalHaircutPct: nonParisHaircutPct,
        maturityExtensionYears: nonParisExtYears,
        couponAdjustmentBps: termSheet.couponReductionBps,
        npvRecoveryCentsPerPar: nonParisNpv,
        impliedPresentValueLossPct: Number((100 - nonParisNpv).toFixed(1)),
        comparabilityStatus:
          Math.abs(nonParisNpv - parisClubNpv) <= 8
            ? 'COMPARABLE_BURDEN_PARITY'
            : 'UNDER_RELIEF_GAP',
        cacVotingThresholdPct: 100,
        estimatedHoldoutRiskPct: clamp(Math.round(holdoutProb * 0.65), 8, 75),
      },
      {
        tierId: 'external_eurobonds_cac',
        tierLabel: 'External Foreign-Law Eurobonds (NY / English Law)',
        seniorityRank: 4,
        legalRegime:
          termSheet.cacRegime === 'SINGLE_LIMB_AGGREGATED_75'
            ? 'ICMA Enhanced Single-Limb Aggregated CAC (75%)'
            : termSheet.cacRegime === 'DUAL_LIMB_SERIES_66_75'
            ? 'Dual-Limb Series-by-Series CAC (66.7% / 75%)'
            : 'Legacy Unanimous Consent (High Vulture Holdout Risk)',
        debtShareOfTotalPct: profile.eurobondsCacPct,
        preRestructuringDebtGdpPct: Number(((preDebtGdp * profile.eurobondsCacPct) / 100).toFixed(1)),
        appliedPrincipalHaircutPct: termSheet.principalHaircutPct,
        maturityExtensionYears: termSheet.maturityExtensionYears,
        couponAdjustmentBps: termSheet.couponReductionBps,
        npvRecoveryCentsPerPar: eurobondNpv,
        impliedPresentValueLossPct: Number((100 - eurobondNpv).toFixed(1)),
        comparabilityStatus:
          Math.abs(eurobondNpv - parisClubNpv) <= 10
            ? 'COMPARABLE_BURDEN_PARITY'
            : 'UNDER_RELIEF_GAP',
        cacVotingThresholdPct: cacThresholdPct,
        estimatedHoldoutRiskPct: holdoutProb,
      },
      {
        tierId: 'domestic_law_local_currency',
        tierLabel: 'Domestic-Law Local Currency Debt (DDR Reprofiling)',
        seniorityRank: 5,
        legalRegime: 'Local Statutory Retrofit & Bank CET1 Stability Carve-Out',
        debtShareOfTotalPct: profile.domesticLawPct,
        preRestructuringDebtGdpPct: Number(((preDebtGdp * profile.domesticLawPct) / 100).toFixed(1)),
        appliedPrincipalHaircutPct: domesticHaircutPct,
        maturityExtensionYears: Math.max(2, Math.round(termSheet.maturityExtensionYears * 0.6)),
        couponAdjustmentBps: Math.round(termSheet.couponReductionBps * 0.5),
        npvRecoveryCentsPerPar: domesticNpv,
        impliedPresentValueLossPct: Number((100 - domesticNpv).toFixed(1)),
        comparabilityStatus: 'DOMESTIC_STABILITY_CARVEOUT',
        cacVotingThresholdPct: 50,
        estimatedHoldoutRiskPct: 4,
      },
    ];

    const weightedPostDebtGdp = tiers.reduce((acc, t) => {
      const survivingRatio = (100 - t.appliedPrincipalHaircutPct) / 100;
      return acc + t.preRestructuringDebtGdpPct * survivingRatio;
    }, 0);

    const weightedNpvHaircutPct = tiers.reduce(
      (acc, t) => acc + (t.impliedPresentValueLossPct * t.debtShareOfTotalPct) / 100,
      0
    );

    const preGfnPctGdp = Number(
      Math.max(
        4.5,
        snap.imfIndicators.debtToGdpPct * 0.16 - snap.imfIndicators.primaryFiscalBalancePct
      ).toFixed(1)
    );
    const gfnReliefPctGdp = Number(
      clamp(
        preGfnPctGdp *
          (0.18 +
            termSheet.maturityExtensionYears * 0.032 +
            termSheet.gracePeriodYears * 0.045 +
            termSheet.principalHaircutPct * 0.004 -
            termSheet.couponReductionBps * 0.0003),
        1.2,
        preGfnPctGdp * 0.78
      ).toFixed(1)
    );
    const postGfnPctGdp = Number(Math.max(2.5, preGfnPctGdp - gfnReliefPctGdp).toFixed(1));

    const comparabilityGap = Number(Math.abs(eurobondNpv - parisClubNpv).toFixed(1));

    return {
      tiers,
      preDebtGdp: Number(preDebtGdp.toFixed(1)),
      postDebtGdp: Number(weightedPostDebtGdp.toFixed(1)),
      imfTargetDebtGdp: profile.imfDsaSustainabilityTargetGdpPct,
      preGfnPctGdp: Number(preGfnPctGdp.toFixed(1)),
      postGfnPctGdp,
      gfnReliefPctGdp,
      eurobondNpv,
      vriGainCents,
      weightedNpvHaircutPct: Number(weightedNpvHaircutPct.toFixed(1)),
      comparabilityGap,
      holdoutProb,
      preCouponPct,
      parisClubHaircutPct,
      parisClubExtYears,
    };
  };

  const activeEval = evaluateSovereignRestructuring(activeOpenData);

  const exitYieldSensitivityCurve = [6, 8, 10, 11, 12, 14, 16, 18, 20].map((yieldPt) => {
    const eb = computeBondNpvCentsPerPar(
      termSheet.principalHaircutPct,
      activeEval.preCouponPct,
      termSheet.couponReductionBps,
      termSheet.maturityExtensionYears,
      termSheet.gracePeriodYears,
      yieldPt
    );
    const pc = computeBondNpvCentsPerPar(
      activeEval.parisClubHaircutPct,
      activeEval.preCouponPct * 0.75,
      termSheet.couponReductionBps - 50,
      activeEval.parisClubExtYears,
      termSheet.gracePeriodYears + 1,
      yieldPt
    );
    return {
      exitYieldPct: yieldPt,
      eurobondNpvCents: Number(clamp(eb + activeEval.vriGainCents, 4, 99.5).toFixed(1)),
      bilateralNpvCents: pc,
    };
  });

  const peerRestructuringTable: SovereignRestructuringPeerRow[] = allItems.map((item) => {
    const isCurrent = item.iso3 === activeOpenData.iso3;
    const snap = isCurrent ? activeOpenData : buildBaselineOpenData(item.iso3);
    const ev = isCurrent ? activeEval : evaluateSovereignRestructuring(snap);

    const dsaVerdict: SovereignRestructuringPeerRow['dsaVerdict'] =
      ev.postDebtGdp <= ev.imfTargetDebtGdp
        ? 'RESTORED_SUSTAINABLE'
        : ev.postDebtGdp <= ev.imfTargetDebtGdp + 10
        ? 'MARGINAL_BUFFER'
        : 'DEEPER_HAIRCUT_REQUIRED';

    return {
      iso3: snap.iso3,
      countryName: snap.countryName,
      preDebtToGdpPct: ev.preDebtGdp,
      postDebtToGdpPct: ev.postDebtGdp,
      imfDsaSustainabilityTargetGdpPct: ev.imfTargetDebtGdp,
      eurobondNpvRecoveryCents: ev.eurobondNpv,
      compositeNpvHaircutPct: ev.weightedNpvHaircutPct,
      gfnReductionPctGdp: ev.gfnReliefPctGdp,
      holdoutLitigationProbPct: ev.holdoutProb,
      dsaVerdict,
      isCurrentActiveSovereign: isCurrent,
    };
  });

  const headlineDiagnostic = `${activeOpenData.countryName} (${activeOpenData.iso3}) IMF/Paris Club Workout: ${termSheet.principalHaircutPct}% Eurobond haircut + ${termSheet.maturityExtensionYears}Y extension at ${termSheet.exitYieldPct.toFixed(1)}% exit yield yields ${activeEval.eurobondNpv.toFixed(1)}¢ recovery per 100¢ par (incl. +${activeEval.vriGainCents.toFixed(1)}¢ GDP warrant kicker) and reduces public debt from ${activeEval.preDebtGdp.toFixed(1)}% to ${activeEval.postDebtGdp.toFixed(1)}% of GDP (IMF DSA target: ${activeEval.imfTargetDebtGdp.toFixed(1)}% of GDP).`;

  return {
    computedAtIso: new Date().toISOString(),
    headlineDiagnostic,
    activeCountryName: activeOpenData.countryName,
    activeIso3: activeOpenData.iso3,
    termSheetInputs: termSheet,
    preRestructuringDebtGdpPct: activeEval.preDebtGdp,
    postRestructuringDebtGdpPct: activeEval.postDebtGdp,
    imfTargetDebtGdpPct: activeEval.imfTargetDebtGdp,
    preRestructuringGfnPctGdp: activeEval.preGfnPctGdp,
    postRestructuringGfnPctGdp: activeEval.postGfnPctGdp,
    eurobondNpvRecoveryCents: activeEval.eurobondNpv,
    vriPresentValueGainCents: activeEval.vriGainCents,
    weightedAverageNpvHaircutPct: activeEval.weightedNpvHaircutPct,
    parisClubComparabilityGapPct: activeEval.comparabilityGap,
    cacHoldoutBlockingProbPct: activeEval.holdoutProb,
    creditorWaterfall: activeEval.tiers,
    exitYieldSensitivityCurve,
    peerRestructuringTable,
  };
}

/**
 * 9.2 Central Bank Augmented Taylor Rule & Fiscal Dominance Lab
 */
export function computeTaylorRuleFiscalDominanceSuite(
  activeOpenData: OpenDataSnapshot,
  watchlistItems: WatchlistItem[],
  stressInputs: TaylorRuleStressInputs = DEFAULT_TAYLOR_RULE_INPUTS
): TaylorRuleFiscalDominanceSuite {
  const hasActive = watchlistItems.some((w) => w.iso3 === activeOpenData.iso3);
  const allItems: { iso3: string; countryName: string }[] = hasActive
    ? watchlistItems
    : [
        { iso3: activeOpenData.iso3, countryName: activeOpenData.countryName },
        ...watchlistItems,
      ];

  const computeRowForSnapshot = (snap: OpenDataSnapshot, isCurrent: boolean): SovereignTaylorRuleRow => {
    const spotPolicyRate = snap.monetaryAndMarket.policyRatePct;
    const supplyShockPct = stressInputs.simulatedSupplyInflationShockBps / 100;
    const headlineInflation = Number(
      Math.max(-1.0, snap.imfIndicators.cpiInflationPct + (isCurrent ? supplyShockPct : supplyShockPct * 0.65)).toFixed(2)
    );

    // Calibrate country-specific inflation target around user slider if peer vs active
    const targetInflation = isCurrent
      ? stressInputs.inflationTargetPct
      : snap.imfIndicators.cpiInflationPct > 10
      ? 5.0
      : snap.imfIndicators.cpiInflationPct > 4.5
      ? 3.5
      : 2.0;

    const rStar = isCurrent
      ? stressInputs.neutralRealRateRStarPct
      : snap.imfIndicators.debtToGdpPct > 90
      ? 1.0
      : 1.75;

    const potentialGrowthPct = snap.imfIndicators.realGdpGrowthPct > 4 ? 4.2 : 2.3;
    const outputGapPctGdp = Number(
      clamp(snap.imfIndicators.realGdpGrowthPct - potentialGrowthPct, -4.5, 4.5).toFixed(2)
    );

    const inflationGap = headlineInflation - targetInflation;
    const fxPassThroughTerm =
      stressInputs.fxPassThroughDefenseWeightGamma *
      Math.max(0, (snap.monetaryAndMarket.cds5YSpreadBps - 120) / 100);

    const taylorImplied = Number(
      clamp(
        rStar +
          headlineInflation +
          stressInputs.inflationGapWeightAlpha * inflationGap +
          stressInputs.outputGapWeightBeta * outputGapPctGdp +
          fxPassThroughTerm,
        0.0,
        65.0
      ).toFixed(2)
    );

    const policyStanceGapBps = Math.round((spotPolicyRate - taylorImplied) * 100);
    const realPolicyRatePct = Number((spotPolicyRate - headlineInflation).toFixed(2));
    const interestToRevenuePct = clamp(
      (snap.imfIndicators.debtToGdpPct * (snap.monetaryAndMarket.sovereign10YBondYieldPct / 100)) / 0.24,
      2.5,
      62.0
    );

    // Fiscal Dominance Score (0-100): high when interest/revenue is high AND central bank is behind the curve or real rates are negative
    const fiscalDominanceScore = clamp(
      Math.round(
        interestToRevenuePct * 1.45 +
          Math.max(0, -policyStanceGapBps) * 0.08 +
          Math.max(0, -realPolicyRatePct) * 6.5 +
          Math.max(0, snap.imfIndicators.debtToGdpPct - 70) * 0.35
      ),
      5,
      98
    );

    // Financial Repression Tax (% of GDP): domestic debt share eroded when real rate < neutral r*
    const realRateSuppressionGap = Math.max(0, rStar - realPolicyRatePct);
    const extDebtShare = clamp(snap.worldBankIndicators.externalDebtPctGni, 5, 85);
    const domesticDebtRatio = (100 - extDebtShare) / 100;
    const financialRepressionTaxPctGdp = Number(
      (((snap.imfIndicators.debtToGdpPct * domesticDebtRatio) * realRateSuppressionGap) / 100).toFixed(2)
    );

    const regimeClassification: SovereignTaylorRuleRow['regimeClassification'] =
      fiscalDominanceScore >= 68 && policyStanceGapBps < -75
        ? 'FISCAL_DOMINANCE_REPRESSION'
        : policyStanceGapBps >= 75 && realPolicyRatePct >= rStar
        ? 'CREDIBLE_ORTHODOX_HAWK'
        : policyStanceGapBps <= -100
        ? 'BEHIND_THE_CURVE_DOVISH'
        : 'NEUTRAL_TAYLOR_ALIGNED';

    return {
      iso3: snap.iso3,
      countryName: snap.countryName,
      currencyCode: snap.currencyCode,
      spotPolicyRatePct: Number(spotPolicyRate.toFixed(2)),
      headlineInflationPct: headlineInflation,
      inflationTargetPct: Number(targetInflation.toFixed(2)),
      estimatedOutputGapPctGdp: outputGapPctGdp,
      neutralRealRatePct: Number(rStar.toFixed(2)),
      taylorImpliedPolicyRatePct: taylorImplied,
      policyStanceGapBps,
      realPolicyRatePct,
      interestToRevenuePct: Number(interestToRevenuePct.toFixed(1)),
      fiscalDominanceScore,
      financialRepressionTaxPctGdp,
      regimeClassification,
      isCurrentActiveSovereign: isCurrent,
    };
  };

  const peerTaylorMatrix = allItems.map((item) => {
    const isCurrent = item.iso3 === activeOpenData.iso3;
    const snap = isCurrent ? activeOpenData : buildBaselineOpenData(item.iso3);
    return computeRowForSnapshot(snap, isCurrent);
  });

  const activeRow =
    peerTaylorMatrix.find((r) => r.iso3 === activeOpenData.iso3) || peerTaylorMatrix[0];

  const getTenorYield = (tenor: '3M' | '1Y' | '2Y' | '5Y' | '10Y' | '30Y', fallback: number) =>
    activeOpenData.yieldCurve.tenors.find((t) => t.tenor === tenor)?.currentYieldPct ?? fallback;

  const y3M = getTenorYield('3M', activeOpenData.monetaryAndMarket.policyRatePct);
  const y1Y = getTenorYield('1Y', activeOpenData.monetaryAndMarket.policyRatePct + 0.15);
  const y2Y = getTenorYield('2Y', activeOpenData.monetaryAndMarket.sovereign10YBondYieldPct - 0.45);
  const y5Y = getTenorYield('5Y', activeOpenData.monetaryAndMarket.sovereign10YBondYieldPct - 0.2);
  const y10Y = getTenorYield('10Y', activeOpenData.monetaryAndMarket.sovereign10YBondYieldPct);
  const y30Y = getTenorYield('30Y', activeOpenData.monetaryAndMarket.sovereign10YBondYieldPct + 0.35);

  const stanceAdjustmentPct = -activeRow.policyStanceGapBps / 100;

  const yieldCurveTransmission: TaylorRuleFiscalDominanceSuite['yieldCurveTransmission'] = [
    {
      tenorLabel: '3M',
      tenorYears: 0.25,
      spotNominalYieldPct: Number(y3M.toFixed(2)),
      taylorEquilibriumNominalYieldPct: Number(
        (y3M + stanceAdjustmentPct * 0.95).toFixed(2)
      ),
      realYieldPct: Number((y3M - activeRow.headlineInflationPct).toFixed(2)),
    },
    {
      tenorLabel: '1Y',
      tenorYears: 1,
      spotNominalYieldPct: Number(y1Y.toFixed(2)),
      taylorEquilibriumNominalYieldPct: Number(
        (y1Y + stanceAdjustmentPct * 0.82).toFixed(2)
      ),
      realYieldPct: Number((y1Y - activeRow.headlineInflationPct).toFixed(2)),
    },
    {
      tenorLabel: '2Y',
      tenorYears: 2,
      spotNominalYieldPct: Number(y2Y.toFixed(2)),
      taylorEquilibriumNominalYieldPct: Number(
        (y2Y + stanceAdjustmentPct * 0.68).toFixed(2)
      ),
      realYieldPct: Number((y2Y - activeRow.headlineInflationPct * 0.9).toFixed(2)),
    },
    {
      tenorLabel: '5Y',
      tenorYears: 5,
      spotNominalYieldPct: Number(y5Y.toFixed(2)),
      taylorEquilibriumNominalYieldPct: Number(
        (y5Y + stanceAdjustmentPct * 0.45).toFixed(2)
      ),
      realYieldPct: Number((y5Y - activeRow.headlineInflationPct * 0.8).toFixed(2)),
    },
    {
      tenorLabel: '10Y',
      tenorYears: 10,
      spotNominalYieldPct: Number(y10Y.toFixed(2)),
      taylorEquilibriumNominalYieldPct: Number(
        (y10Y + stanceAdjustmentPct * 0.3).toFixed(2)
      ),
      realYieldPct: Number((y10Y - activeRow.headlineInflationPct * 0.72).toFixed(2)),
    },
    {
      tenorLabel: '30Y',
      tenorYears: 30,
      spotNominalYieldPct: Number(y30Y.toFixed(2)),
      taylorEquilibriumNominalYieldPct: Number(
        (y30Y + stanceAdjustmentPct * 0.2).toFixed(2)
      ),
      realYieldPct: Number((y30Y - activeRow.headlineInflationPct * 0.65).toFixed(2)),
    },
  ];

  const headlineDiagnostic = `${activeRow.countryName} (${activeRow.iso3}) MPC Reaction Audit: Spot policy rate (${activeRow.spotPolicyRatePct.toFixed(2)}%) vs. Augmented Taylor Rule (${activeRow.taylorImpliedPolicyRatePct.toFixed(2)}%) shows a ${activeRow.policyStanceGapBps >= 0 ? `+${activeRow.policyStanceGapBps}` : activeRow.policyStanceGapBps} bps stance gap (${activeRow.regimeClassification.replace(/_/g, ' ')}) with a Fiscal Dominance Score of ${activeRow.fiscalDominanceScore}/100.`;

  return {
    computedAtIso: new Date().toISOString(),
    headlineDiagnostic,
    activeRow,
    peerTaylorMatrix,
    yieldCurveTransmission,
  };
}

// Country-calibrated reserve custody and maritime chokepoint exposure profiles
const GEO_CUSTODY_PROFILES: Record<
  string,
  {
    g7CustodyPct: number;
    domesticGoldPct: number;
    nonG7SwapsPct: number;
    imfSdrPct: number;
    bisMultilateralPct: number;
    hormuzTradePct: number;
    redSeaTradePct: number;
    suezTradePct: number;
    malaccaTradePct: number;
    panamaTradePct: number;
    netEnergyFoodImportPctGdp: number;
  }
> = {
  USA: { g7CustodyPct: 32, domesticGoldPct: 52, nonG7SwapsPct: 2, imfSdrPct: 10, bisMultilateralPct: 4, hormuzTradePct: 6, redSeaTradePct: 7, suezTradePct: 8, malaccaTradePct: 18, panamaTradePct: 26, netEnergyFoodImportPctGdp: -1.2 },
  DEU: { g7CustodyPct: 28, domesticGoldPct: 56, nonG7SwapsPct: 3, imfSdrPct: 9, bisMultilateralPct: 4, hormuzTradePct: 9, redSeaTradePct: 16, suezTradePct: 18, malaccaTradePct: 21, panamaTradePct: 5, netEnergyFoodImportPctGdp: 3.4 },
  GBR: { g7CustodyPct: 58, domesticGoldPct: 22, nonG7SwapsPct: 4, imfSdrPct: 11, bisMultilateralPct: 5, hormuzTradePct: 8, redSeaTradePct: 15, suezTradePct: 16, malaccaTradePct: 17, panamaTradePct: 7, netEnergyFoodImportPctGdp: 2.8 },
  JPN: { g7CustodyPct: 78, domesticGoldPct: 8, nonG7SwapsPct: 4, imfSdrPct: 6, bisMultilateralPct: 4, hormuzTradePct: 28, redSeaTradePct: 11, suezTradePct: 12, malaccaTradePct: 42, panamaTradePct: 14, netEnergyFoodImportPctGdp: 5.8 },
  CHN: { g7CustodyPct: 46, domesticGoldPct: 14, nonG7SwapsPct: 28, imfSdrPct: 7, bisMultilateralPct: 5, hormuzTradePct: 24, redSeaTradePct: 16, suezTradePct: 17, malaccaTradePct: 48, panamaTradePct: 11, netEnergyFoodImportPctGdp: 4.1 },
  IND: { g7CustodyPct: 54, domesticGoldPct: 18, nonG7SwapsPct: 14, imfSdrPct: 8, bisMultilateralPct: 6, hormuzTradePct: 34, redSeaTradePct: 22, suezTradePct: 21, malaccaTradePct: 26, panamaTradePct: 4, netEnergyFoodImportPctGdp: 4.9 },
  BRA: { g7CustodyPct: 68, domesticGoldPct: 9, nonG7SwapsPct: 11, imfSdrPct: 7, bisMultilateralPct: 5, hormuzTradePct: 7, redSeaTradePct: 8, suezTradePct: 9, malaccaTradePct: 22, panamaTradePct: 16, netEnergyFoodImportPctGdp: -4.2 },
  MEX: { g7CustodyPct: 74, domesticGoldPct: 8, nonG7SwapsPct: 5, imfSdrPct: 8, bisMultilateralPct: 5, hormuzTradePct: 4, redSeaTradePct: 5, suezTradePct: 5, malaccaTradePct: 12, panamaTradePct: 19, netEnergyFoodImportPctGdp: 1.4 },
  ZAF: { g7CustodyPct: 52, domesticGoldPct: 21, nonG7SwapsPct: 13, imfSdrPct: 9, bisMultilateralPct: 5, hormuzTradePct: 18, redSeaTradePct: 14, suezTradePct: 14, malaccaTradePct: 24, panamaTradePct: 4, netEnergyFoodImportPctGdp: 2.2 },
  TUR: { g7CustodyPct: 34, domesticGoldPct: 38, nonG7SwapsPct: 18, imfSdrPct: 6, bisMultilateralPct: 4, hormuzTradePct: 19, redSeaTradePct: 21, suezTradePct: 24, malaccaTradePct: 14, panamaTradePct: 3, netEnergyFoodImportPctGdp: 5.4 },
  EGY: { g7CustodyPct: 38, domesticGoldPct: 24, nonG7SwapsPct: 24, imfSdrPct: 8, bisMultilateralPct: 6, hormuzTradePct: 26, redSeaTradePct: 46, suezTradePct: 49, malaccaTradePct: 15, panamaTradePct: 3, netEnergyFoodImportPctGdp: 6.8 },
  ARG: { g7CustodyPct: 26, domesticGoldPct: 19, nonG7SwapsPct: 41, imfSdrPct: 9, bisMultilateralPct: 5, hormuzTradePct: 5, redSeaTradePct: 6, suezTradePct: 7, malaccaTradePct: 18, panamaTradePct: 14, netEnergyFoodImportPctGdp: -3.5 },
};

/**
 * 9.3 Geopolitical Reserve Custody Freeze & Maritime Chokepoint Vulnerability Matrix
 */
export function computeGeoSanctionsChokepointSuite(
  activeOpenData: OpenDataSnapshot,
  watchlistItems: WatchlistItem[],
  inputs: GeoSanctionsChokepointInputs = DEFAULT_GEO_SANCTIONS_CHOKEPOINT_INPUTS
): GeoSanctionsChokepointSuite {
  const hasActive = watchlistItems.some((w) => w.iso3 === activeOpenData.iso3);
  const allItems: { iso3: string; countryName: string }[] = hasActive
    ? watchlistItems
    : [
        { iso3: activeOpenData.iso3, countryName: activeOpenData.countryName },
        ...watchlistItems,
      ];

  const getProfile = (iso3: string) =>
    GEO_CUSTODY_PROFILES[iso3] || {
      g7CustodyPct: 56,
      domesticGoldPct: 16,
      nonG7SwapsPct: 14,
      imfSdrPct: 8,
      bisMultilateralPct: 6,
      hormuzTradePct: 15,
      redSeaTradePct: 14,
      suezTradePct: 15,
      malaccaTradePct: 20,
      panamaTradePct: 9,
      netEnergyFoodImportPctGdp: 2.5,
    };

  const evaluateGeoRow = (snap: OpenDataSnapshot, isCurrent: boolean): SovereignGeoRiskRow => {
    const p = getProfile(snap.iso3);
    const freezeRatio = inputs.g7ReserveFreezeSeverityPct / 100;

    // G7 custody takes full freeze severity; IMF SDRs & BIS take partial (35% of freeze severity if secondary sanctions apply); Domestic Gold & Non-G7 swaps remain accessible
    const frozenG7Pct = p.g7CustodyPct * freezeRatio;
    const frozenSdrBisPct = (p.imfSdrPct + p.bisMultilateralPct) * freezeRatio * 0.35;
    const sanctionImmuneSharePct = Number(
      clamp(100 - frozenG7Pct - frozenSdrBisPct, 12, 100).toFixed(1)
    );

    const preImportCover = snap.worldBankIndicators.fxReservesMonthsImport;
    const postFreezeImportCover = Number(
      ((preImportCover * sanctionImmuneSharePct) / 100).toFixed(2)
    );

    const chokepointExposureMap: Record<MaritimeChokepointId, number> = {
      strait_of_hormuz: p.hormuzTradePct,
      bab_el_mandeb_red_sea: p.redSeaTradePct,
      suez_canal: p.suezTradePct,
      strait_of_malacca: p.malaccaTradePct,
      panama_canal: p.panamaTradePct,
    };

    const activeChokepointTradePct = chokepointExposureMap[inputs.activeChokepointDisruption];
    const blockadeRatio = inputs.chokepointBlockadeIntensityPct / 100;

    // Inflation pass-through in bps from freight surge + energy/food import sensitivity + secondary tariffs
    const importVulnerability = Math.max(0.5, p.netEnergyFoodImportPctGdp + 2.5);
    const blockadeCpiPassThroughBps = Math.round(
      activeChokepointTradePct * blockadeRatio * 6.8 +
        importVulnerability * blockadeRatio * 34 +
        inputs.secondaryTariffPenaltyBps * 0.28
    );

    const emergencyFiscalSubsidyCostPctGdp = Number(
      clamp(
        (blockadeCpiPassThroughBps / 100) * 0.42 +
          Math.max(0, p.netEnergyFoodImportPctGdp) * blockadeRatio * 0.25,
        0.1,
        6.5
      ).toFixed(2)
    );

    const geoResilienceVerdict: SovereignGeoRiskRow['geoResilienceVerdict'] =
      postFreezeImportCover < 2.8 && blockadeCpiPassThroughBps >= 180
        ? 'CRITICAL_EXTERNAL_BLOCKADE_RISK'
        : postFreezeImportCover < 3.5 || p.g7CustodyPct >= 65
        ? 'HIGH_CUSTODY_FREEZE_VULNERABILITY'
        : blockadeCpiPassThroughBps >= 130
        ? 'MODERATE_CHOKEPOINT_SENSITIVITY'
        : 'FORTRESS_AUTARKY_BUFFER';

    return {
      iso3: snap.iso3,
      countryName: snap.countryName,
      preShockImportCoverMonths: Number(preImportCover.toFixed(1)),
      g7CustodyExposurePct: p.g7CustodyPct,
      domesticGoldAndSwapBufferPct: p.domesticGoldPct + p.nonG7SwapsPct,
      sanctionImmuneReserveSharePct: sanctionImmuneSharePct,
      postFreezeImportCoverMonths: postFreezeImportCover,
      primaryChokepointExposurePctTrade: activeChokepointTradePct,
      netEnergyFoodImportDependencyPctGdp: p.netEnergyFoodImportPctGdp,
      blockadeCpiPassThroughBps,
      emergencyFiscalSubsidyCostPctGdp,
      geoResilienceVerdict,
      isCurrentActiveSovereign: isCurrent,
    };
  };

  const peerGeoMatrix = allItems.map((item) => {
    const isCurrent = item.iso3 === activeOpenData.iso3;
    const snap = isCurrent ? activeOpenData : buildBaselineOpenData(item.iso3);
    return evaluateGeoRow(snap, isCurrent);
  });

  const activeRow =
    peerGeoMatrix.find((r) => r.iso3 === activeOpenData.iso3) || peerGeoMatrix[0];
  const activeProfile = getProfile(activeOpenData.iso3);
  const freezeRatio = inputs.g7ReserveFreezeSeverityPct / 100;

  const activeCustodyBreakdown: ReserveCustodyShareRow[] = [
    {
      bucketId: 'g7_western_custody_securities',
      bucketLabel: 'G7 Sovereign Securities (NY Fed / Euroclear / BoE Custody)',
      preShockSharePct: activeProfile.g7CustodyPct,
      sanctionFreezeHaircutPct: inputs.g7ReserveFreezeSeverityPct,
      postShockAccessibleSharePct: Number(
        (activeProfile.g7CustodyPct * (1 - freezeRatio)).toFixed(1)
      ),
      custodyJurisdictionNote: 'Directly immobilizable under G7 / OFAC / EU executive freeze orders',
    },
    {
      bucketId: 'domestic_vaulted_monetary_gold',
      bucketLabel: 'Domestic Vaulted Monetary Bullion',
      preShockSharePct: activeProfile.domesticGoldPct,
      sanctionFreezeHaircutPct: 0,
      postShockAccessibleSharePct: activeProfile.domesticGoldPct,
      custodyJurisdictionNote: 'Physically held in domestic central bank vault; immune to foreign custody freeze',
    },
    {
      bucketId: 'non_g7_em_currencies_pboc_swaps',
      bucketLabel: 'Non-G7 FX Reserves & Bilateral Swap Lines (CNY / AED / BRICS)',
      preShockSharePct: activeProfile.nonG7SwapsPct,
      sanctionFreezeHaircutPct: 0,
      postShockAccessibleSharePct: activeProfile.nonG7SwapsPct,
      custodyJurisdictionNote: 'Settled via non-Western correspondent rails and bilateral central bank swaps',
    },
    {
      bucketId: 'imf_sdr_holdings',
      bucketLabel: 'IMF Special Drawing Rights (SDR Allocations)',
      preShockSharePct: activeProfile.imfSdrPct,
      sanctionFreezeHaircutPct: Math.round(inputs.g7ReserveFreezeSeverityPct * 0.35),
      postShockAccessibleSharePct: Number(
        (activeProfile.imfSdrPct * (1 - freezeRatio * 0.35)).toFixed(1)
      ),
      custodyJurisdictionNote: 'Requires voluntary counterparty central bank exchange to convert SDRs into hard liquidity',
    },
    {
      bucketId: 'bis_multilateral_liquidity',
      bucketLabel: 'BIS Basel & Multilateral Liquidity Deposits',
      preShockSharePct: activeProfile.bisMultilateralPct,
      sanctionFreezeHaircutPct: Math.round(inputs.g7ReserveFreezeSeverityPct * 0.35),
      postShockAccessibleSharePct: Number(
        (activeProfile.bisMultilateralPct * (1 - freezeRatio * 0.35)).toFixed(1)
      ),
      custodyJurisdictionNote: 'Subject to multilateral clearing constraints under severe secondary sanctions',
    },
  ];

  const chokepointRatio = inputs.chokepointBlockadeIntensityPct / 100;
  const chokepointVulnerabilityBreakdown: GeoSanctionsChokepointSuite['chokepointVulnerabilityBreakdown'] = [
    {
      chokepointId: 'strait_of_hormuz',
      chokepointName: 'Strait of Hormuz (21% Global Petroleum Liquids)',
      tradeShareRoutedPct: activeProfile.hormuzTradePct,
      freightInsuranceSurgeBps: Math.round(activeProfile.hormuzTradePct * chokepointRatio * 14),
      gdpGrowthDragPct: Number((-activeProfile.hormuzTradePct * chokepointRatio * 0.045).toFixed(2)),
    },
    {
      chokepointId: 'bab_el_mandeb_red_sea',
      chokepointName: 'Bab el-Mandeb / Red Sea Corridor',
      tradeShareRoutedPct: activeProfile.redSeaTradePct,
      freightInsuranceSurgeBps: Math.round(activeProfile.redSeaTradePct * chokepointRatio * 12),
      gdpGrowthDragPct: Number((-activeProfile.redSeaTradePct * chokepointRatio * 0.038).toFixed(2)),
    },
    {
      chokepointId: 'suez_canal',
      chokepointName: 'Suez Canal (Europe-Asia Container Artery)',
      tradeShareRoutedPct: activeProfile.suezTradePct,
      freightInsuranceSurgeBps: Math.round(activeProfile.suezTradePct * chokepointRatio * 11),
      gdpGrowthDragPct: Number((-activeProfile.suezTradePct * chokepointRatio * 0.036).toFixed(2)),
    },
    {
      chokepointId: 'strait_of_malacca',
      chokepointName: 'Strait of Malacca (Indo-Pacific Trade Lifeline)',
      tradeShareRoutedPct: activeProfile.malaccaTradePct,
      freightInsuranceSurgeBps: Math.round(activeProfile.malaccaTradePct * chokepointRatio * 13),
      gdpGrowthDragPct: Number((-activeProfile.malaccaTradePct * chokepointRatio * 0.042).toFixed(2)),
    },
    {
      chokepointId: 'panama_canal',
      chokepointName: 'Panama Canal (Atlantic-Pacific Bulk & LNG)',
      tradeShareRoutedPct: activeProfile.panamaTradePct,
      freightInsuranceSurgeBps: Math.round(activeProfile.panamaTradePct * chokepointRatio * 9),
      gdpGrowthDragPct: Number((-activeProfile.panamaTradePct * chokepointRatio * 0.028).toFixed(2)),
    },
  ];

  const headlineDiagnostic = `${activeRow.countryName} (${activeRow.iso3}) Geo-Economic Audit: A ${inputs.g7ReserveFreezeSeverityPct}% G7 custody freeze leaves ${activeRow.sanctionImmuneReserveSharePct.toFixed(1)}% of reserves accessible (${activeRow.postFreezeImportCoverMonths.toFixed(2)} months import cover vs. ${activeRow.preShockImportCoverMonths.toFixed(1)}M baseline), while a ${inputs.chokepointBlockadeIntensityPct}% ${inputs.activeChokepointDisruption.replace(/_/g, ' ')} disruption adds +${activeRow.blockadeCpiPassThroughBps} bps CPI pass-through.`;

  return {
    computedAtIso: new Date().toISOString(),
    headlineDiagnostic,
    activeRow,
    activeCustodyBreakdown,
    chokepointVulnerabilityBreakdown,
    peerGeoMatrix,
  };
}

// Country-calibrated Hydrocarbon Fiscal Revenue Share (% of govt rev) and Climate-Sensitive GDP (% of GDP)
const CLIMATE_FISCAL_PROFILES: Record<
  string,
  {
    hydrocarbonFiscalRevPct: number;
    climateSensitiveGdpPct: number;
    greenBondFrameworkCredibility: number; // 0-100
  }
> = {
  USA: { hydrocarbonFiscalRevPct: 4.5, climateSensitiveGdpPct: 6.2, greenBondFrameworkCredibility: 74 },
  DEU: { hydrocarbonFiscalRevPct: 1.8, climateSensitiveGdpPct: 5.0, greenBondFrameworkCredibility: 92 },
  GBR: { hydrocarbonFiscalRevPct: 3.2, climateSensitiveGdpPct: 4.8, greenBondFrameworkCredibility: 88 },
  JPN: { hydrocarbonFiscalRevPct: 1.2, climateSensitiveGdpPct: 6.8, greenBondFrameworkCredibility: 85 },
  FRA: { hydrocarbonFiscalRevPct: 1.5, climateSensitiveGdpPct: 5.5, greenBondFrameworkCredibility: 90 },
  ITA: { hydrocarbonFiscalRevPct: 2.4, climateSensitiveGdpPct: 7.4, greenBondFrameworkCredibility: 82 },
  BRA: { hydrocarbonFiscalRevPct: 14.5, climateSensitiveGdpPct: 18.2, greenBondFrameworkCredibility: 78 },
  MEX: { hydrocarbonFiscalRevPct: 19.8, climateSensitiveGdpPct: 12.6, greenBondFrameworkCredibility: 68 },
  IND: { hydrocarbonFiscalRevPct: 8.4, climateSensitiveGdpPct: 22.5, greenBondFrameworkCredibility: 72 },
  CHN: { hydrocarbonFiscalRevPct: 6.2, climateSensitiveGdpPct: 14.0, greenBondFrameworkCredibility: 76 },
  ZAF: { hydrocarbonFiscalRevPct: 11.2, climateSensitiveGdpPct: 14.8, greenBondFrameworkCredibility: 70 },
  TUR: { hydrocarbonFiscalRevPct: 4.2, climateSensitiveGdpPct: 13.5, greenBondFrameworkCredibility: 62 },
  ARG: { hydrocarbonFiscalRevPct: 12.6, climateSensitiveGdpPct: 16.4, greenBondFrameworkCredibility: 52 },
  EGY: { hydrocarbonFiscalRevPct: 16.4, climateSensitiveGdpPct: 19.5, greenBondFrameworkCredibility: 58 },
  NGA: { hydrocarbonFiscalRevPct: 48.0, climateSensitiveGdpPct: 26.5, greenBondFrameworkCredibility: 48 },
};

/**
 * 9.4 NGFS Climate Fiscal Stress & SLB "Greenium" Analyzer
 */
export function computeNgfsClimateFiscalSuite(
  activeOpenData: OpenDataSnapshot,
  watchlistItems: WatchlistItem[],
  inputs: ClimateFiscalSlbInputs = DEFAULT_CLIMATE_FISCAL_SLB_INPUTS
): NgfsClimateFiscalSuite {
  const hasActive = watchlistItems.some((w) => w.iso3 === activeOpenData.iso3);
  const allItems: { iso3: string; countryName: string }[] = hasActive
    ? watchlistItems
    : [
        { iso3: activeOpenData.iso3, countryName: activeOpenData.countryName },
        ...watchlistItems,
      ];

  const getClimateProfile = (iso3: string) =>
    CLIMATE_FISCAL_PROFILES[iso3] || {
      hydrocarbonFiscalRevPct: 11.0,
      climateSensitiveGdpPct: 14.0,
      greenBondFrameworkCredibility: 66,
    };

  const evaluateScenarioForSnapshot = (
    snap: OpenDataSnapshot,
    scenario: NgfsClimateScenarioId,
    isCurrent: boolean
  ): SovereignClimateSlbRow => {
    const cp = getClimateProfile(snap.iso3);
    const carbonMult = inputs.globalCarbonTaxTrajectoryScore / 65;
    const weatherMult = inputs.acuteWeatherShockSeverityPct / 40;

    // Scenario multipliers for Transition vs Physical risk
    const transitionFactor =
      scenario === 'ORDERLY_NET_ZERO_2050'
        ? 0.38 * carbonMult
        : scenario === 'DELAYED_DISORDERLY_TRANSITION'
        ? 0.56 * carbonMult
        : 0.14 * carbonMult;

    const physicalFactor =
      scenario === 'ORDERLY_NET_ZERO_2050'
        ? 0.06 * weatherMult
        : scenario === 'DELAYED_DISORDERLY_TRANSITION'
        ? 0.11 * weatherMult
        : 0.21 * weatherMult;

    const strandedRevenueErosionPctRev = Number(
      clamp(cp.hydrocarbonFiscalRevPct * transitionFactor, 0.2, 42.0).toFixed(1)
    );
    const physicalClimateDamagePctGdp = Number(
      clamp(cp.climateSensitiveGdpPct * physicalFactor, 0.2, 8.5).toFixed(2)
    );

    // Convert revenue erosion into % of GDP assuming revenue/GDP ~ 24%
    const transitionFiscalLossPctGdp = Number(((strandedRevenueErosionPctRev * 0.24)).toFixed(2));
    const projected10YClimateDebtAdderPctGdp = Number(
      clamp((transitionFiscalLossPctGdp + physicalClimateDamagePctGdp) * 6.4, 1.5, 48.0).toFixed(1)
    );

    // Greenium discount (negative bps) vs SLB coupon step-up penalty (+bps)
    const greeniumDiscountBps = -Math.round((cp.greenBondFrameworkCredibility / 100) * 24);
    const slbStepUpPenaltyBps = Math.round(
      (inputs.slbTargetMissProbabilityPct / 100) *
        (25 + (100 - cp.greenBondFrameworkCredibility) * 0.45)
    );

    const macroClimateSpreadAdderBps = Math.round(projected10YClimateDebtAdderPctGdp * 4.2);
    const netClimateSpreadImpactBps =
      macroClimateSpreadAdderBps + greeniumDiscountBps + slbStepUpPenaltyBps;

    const climateFiscalRatingRiskNotches = -Math.min(
      4,
      Math.floor(projected10YClimateDebtAdderPctGdp / 8.5)
    );

    return {
      iso3: snap.iso3,
      countryName: snap.countryName,
      hydrocarbonFiscalRevenueSharePct: cp.hydrocarbonFiscalRevPct,
      agricultureAndClimateSensitiveGdpPct: cp.climateSensitiveGdpPct,
      strandedRevenueErosionPctRev,
      physicalClimateDamagePctGdp,
      projected10YClimateDebtAdderPctGdp,
      sovereignGreeniumDiscountBps: greeniumDiscountBps,
      slbCouponStepUpPenaltyBps: slbStepUpPenaltyBps,
      netClimateSpreadImpactBps,
      climateFiscalRatingRiskNotches,
      isCurrentActiveSovereign: isCurrent,
    };
  };

  const peerClimateMatrix = allItems.map((item) => {
    const isCurrent = item.iso3 === activeOpenData.iso3;
    const snap = isCurrent ? activeOpenData : buildBaselineOpenData(item.iso3);
    return evaluateScenarioForSnapshot(snap, inputs.selectedNgfsScenario, isCurrent);
  });

  const activeRow =
    peerClimateMatrix.find((r) => r.iso3 === activeOpenData.iso3) || peerClimateMatrix[0];

  const scenarios: { id: NgfsClimateScenarioId; title: string }[] = [
    { id: 'ORDERLY_NET_ZERO_2050', title: 'NGFS Orderly Net Zero 2050 (Early Carbon Transition)' },
    { id: 'DELAYED_DISORDERLY_TRANSITION', title: 'NGFS Delayed / Disorderly Transition (Stranded Asset Shock)' },
    { id: 'HOT_HOUSE_WORLD_CURRENT_POLICIES', title: 'NGFS Hot House World (Severe Physical Damage)' },
  ];

  const scenarioComparisonForActive = scenarios.map((sc) => {
    const row = evaluateScenarioForSnapshot(activeOpenData, sc.id, true);
    return {
      scenarioId: sc.id,
      scenarioTitle: sc.title,
      transitionFiscalCostPctGdp: Number((row.strandedRevenueErosionPctRev * 0.24).toFixed(2)),
      physicalDamageCostPctGdp: row.physicalClimateDamagePctGdp,
      cumulativeDebtAdder10YPctGdp: row.projected10YClimateDebtAdderPctGdp,
      sovereignSpreadShockBps: row.netClimateSpreadImpactBps,
    };
  });

  const headlineDiagnostic = `${activeRow.countryName} (${activeRow.iso3}) NGFS Climate & SLB Audit (${inputs.selectedNgfsScenario.replace(/_/g, ' ')}): Stranded hydrocarbon revenue erosion of ${activeRow.strandedRevenueErosionPctRev.toFixed(1)}% of revenues and physical damage of ${activeRow.physicalClimateDamagePctGdp.toFixed(2)}% of GDP add +${activeRow.projected10YClimateDebtAdderPctGdp.toFixed(1)}% of GDP to 10Y public debt (Greenium: ${activeRow.sovereignGreeniumDiscountBps} bps, SLB Step-Up Risk: +${activeRow.slbCouponStepUpPenaltyBps} bps).`;

  return {
    computedAtIso: new Date().toISOString(),
    headlineDiagnostic,
    activeScenario: inputs.selectedNgfsScenario,
    activeRow,
    scenarioComparisonForActive,
    peerClimateMatrix,
  };
}
