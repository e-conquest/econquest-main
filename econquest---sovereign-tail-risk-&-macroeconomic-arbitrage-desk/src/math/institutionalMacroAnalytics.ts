import { SovereignEntity, LayerOutputs, MacroScenario, CustomScenarioParams } from '../types/riskEngine';

// ============================================================================
// 1. SOVEREIGN YIELD CURVE & DEBT MATURITY WALL TYPES & ANALYTICS
// ============================================================================

export interface YieldCurveTenorPoint {
  tenor: string;
  years: number;
  usdEurobondYield: number; // %
  baselineEurobondYield: number; // %
  localCurrencyYield: number; // %
  usTreasuryYield: number; // %
  cdsSpreadBps: number; // bps
  cdsBasisBps: number; // CDS spread - Z-spread (bps)
}

export interface SovereignYieldAnalytics {
  sovereignId: string;
  points: YieldCurveTenorPoint[];
  slope2s10sBps: number;
  isInverted: boolean;
  bellyCurvatureBps: number; // 2*5Y - (2Y + 10Y)
  zSpread5yBps: number;
  effectiveDuration5y: number;
  convexity10y: number;
  breakevenInflation5y: number;
}

export interface DebtMaturityYearBucket {
  year: string;
  eurobondUsdBln: number;
  imfMultilateralBln: number;
  bilateralOfficialBln: number;
  domesticLocalBln: number;
  totalMaturityBln: number;
  fxMaturityBln: number;
  usableFxReservesBln: number;
  isRolloverBreach: boolean;
}

export interface SovereignMaturityWallAnalytics {
  sovereignId: string;
  usableFxReservesBln: number;
  next12mFxDebtServiceBln: number;
  next24mFxDebtServiceBln: number;
  peakMaturityYear: string;
  peakMaturityAmountBln: number;
  reserveCoverageRatioPct: number; // Usable reserves / 12m FX maturity (%)
  buckets: DebtMaturityYearBucket[];
}

const TENOR_YEARS: { label: string; t: number }[] = [
  { label: '1Y', t: 1 },
  { label: '2Y', t: 2 },
  { label: '3Y', t: 3 },
  { label: '5Y', t: 5 },
  { label: '7Y', t: 7 },
  { label: '10Y', t: 10 },
  { label: '20Y', t: 20 },
  { label: '30Y', t: 30 }
];

/**
 * Nelson-Siegel parametric curve evaluation:
 * y(t) = beta0 + beta1 * ((1 - exp(-t/tau)) / (t/tau)) + beta2 * (((1 - exp(-t/tau)) / (t/tau)) - exp(-t/tau))
 */
function nelsonSiegel(t: number, beta0: number, beta1: number, beta2: number, tau: number): number {
  const x = Math.max(t / tau, 1e-4);
  const factor1 = (1 - Math.exp(-x)) / x;
  const factor2 = factor1 - Math.exp(-x);
  return beta0 + beta1 * factor1 + beta2 * factor2;
}

export function computeSovereignYieldCurve(
  sovereign: SovereignEntity,
  output: LayerOutputs,
  scenario: MacroScenario,
  customParams?: CustomScenarioParams
): SovereignYieldAnalytics {
  // Scenario shifts on US Treasury curve and sovereign spreads
  let ustShiftPct = 0;
  let ustSteepenPct = 0;
  let spreadMultiplier = 1.0;
  let spreadAdditivePct = 0;

  if (scenario === 'scenarioA_fedTightening') {
    ustShiftPct = 2.0; // +200 bps
    ustSteepenPct = -0.45; // Bear flattening / inversion
    spreadMultiplier = 1.32;
    spreadAdditivePct = 1.25;
  } else if (scenario === 'scenarioB_commodityCollapse') {
    ustShiftPct = -0.35;
    spreadMultiplier = 1.28;
    spreadAdditivePct = sovereign.commodityExportShock < 0 ? 1.8 : 0.6;
  } else if (scenario === 'scenarioC_malaccaBlockade') {
    ustShiftPct = 0.25;
    spreadMultiplier = 1.38;
    spreadAdditivePct =
      sovereign.maritimeChokepointExposure === 'Critical'
        ? 2.4
        : sovereign.maritimeChokepointExposure === 'High'
        ? 1.5
        : 0.5;
  } else if (scenario === 'custom' && customParams) {
    ustShiftPct = customParams.usYieldCurveShiftBps / 100;
    ustSteepenPct = customParams.curveSteepeningBps / 100;
    spreadAdditivePct = customParams.sovereignSpreadWideningBps / 100;
    spreadMultiplier = 1 + Math.max(0, customParams.fxImpliedVolSkewJump / 100);
  }

  const baseSpreadPct = sovereign.cdsSpread5yBps / 100;
  const hazard = output?.calibratedPosteriorHazard || 0.05;

  // Distressed sovereigns invert at the front end (1Y-2Y yields spike above 10Y due to immediate jump-to-default risk)
  const baselineDistressSlope = hazard > 0.16 || sovereign.cdsSpread5yBps > 700
    ? 0.42 * baseSpreadPct // Positive beta1 => inverted credit curve
    : -0.25 * baseSpreadPct; // Normal upward-sloping credit curve

  const activeSpreadPct = baseSpreadPct * spreadMultiplier + spreadAdditivePct;
  const activeDistressSlope =
    hazard > 0.14 || activeSpreadPct > 6.5
      ? 0.48 * activeSpreadPct
      : -0.22 * activeSpreadPct;

  const inflationPremium =
    (sovereign.pillarScores.p5_macroFragility / 100) * 8.5 +
    (sovereign.fxRegime === 'Floating' ? 1.8 : 0.9);

  const points: YieldCurveTenorPoint[] = TENOR_YEARS.map(({ label, t }) => {
    // Baseline UST Nelson-Siegel (Level 4.45%, Slope -0.35%, Curvature -0.20%, tau 2.2)
    const baseUst = nelsonSiegel(t, 4.45, -0.35, -0.20, 2.2);
    const activeUst = nelsonSiegel(
      t,
      4.45 + ustShiftPct + ustSteepenPct * 0.4,
      -0.35 - ustSteepenPct * 0.6,
      -0.20,
      2.2
    );

    // Baseline Sovereign Credit Spread Curve
    const baseCreditSpread = Math.max(
      0.35,
      nelsonSiegel(t, baseSpreadPct * 1.06, baselineDistressSlope, 0.18 * baseSpreadPct, 2.5)
    );

    // Active Scenario Sovereign Credit Spread Curve
    const activeCreditSpread = Math.max(
      0.4,
      nelsonSiegel(t, activeSpreadPct * 1.06, activeDistressSlope, 0.22 * activeSpreadPct, 2.4)
    );

    const baselineEurobondYield = Number((baseUst + baseCreditSpread).toFixed(2));
    const usdEurobondYield = Number((activeUst + activeCreditSpread).toFixed(2));

    // Local currency yield incorporates inflation expectations & FX vol skew
    const localSpread =
      inflationPremium * (1 - 0.08 * Math.log(t)) +
      (sovereign.fxImpliedVolSkew / 10) * 0.65;
    const localCurrencyYield = Number((usdEurobondYield + localSpread).toFixed(2));

    // CDS spread term structure and CDS-Bond Basis (negative basis widens in stress due to balance sheet repo constraints)
    const basisBps = Math.round(
      -12 - (hazard * 100) * 1.6 - (t > 7 ? 14 : 0) + (sovereign.imfProgramInvolved ? -18 : 6)
    );
    const zSpreadBps = Math.round(activeCreditSpread * 100);
    const cdsSpreadBps = Math.max(25, zSpreadBps + basisBps);

    return {
      tenor: label,
      years: t,
      usdEurobondYield,
      baselineEurobondYield,
      localCurrencyYield,
      usTreasuryYield: Number(activeUst.toFixed(2)),
      cdsSpreadBps,
      cdsBasisBps: basisBps
    };
  });

  const y2 = points.find((p) => p.years === 2)?.usdEurobondYield || 5;
  const y5 = points.find((p) => p.years === 5)?.usdEurobondYield || 6;
  const y10 = points.find((p) => p.years === 10)?.usdEurobondYield || 6.5;
  const ust5 = points.find((p) => p.years === 5)?.usTreasuryYield || 4.2;

  const slope2s10sBps = Math.round((y10 - y2) * 100);
  const bellyCurvatureBps = Math.round((2 * y5 - (y2 + y10)) * 100);
  const zSpread5yBps = Math.round((y5 - ust5) * 100);

  // Macaulay / Modified duration approximation for a 5Y par bond at y5 yield
  const r5 = y5 / 100;
  const effectiveDuration5y = Number(
    (((1 - Math.pow(1 + r5, -5)) / r5) / (1 + r5 * 0.5)).toFixed(2)
  );
  const r10 = y10 / 100;
  const convexity10y = Number((78 / Math.pow(1 + r10, 2)).toFixed(1));

  return {
    sovereignId: sovereign.id,
    points,
    slope2s10sBps,
    isInverted: slope2s10sBps < 0,
    bellyCurvatureBps,
    zSpread5yBps,
    effectiveDuration5y,
    convexity10y,
    breakevenInflation5y: Number((inflationPremium * 0.85).toFixed(2))
  };
}

export function computeDebtMaturityWall(
  sovereign: SovereignEntity,
  output: LayerOutputs,
  scenario: MacroScenario
): SovereignMaturityWallAnalytics {
  // Derive usable FX reserves from Sovereign CCA Distress Threshold & ST FX debt ratio
  const totalDebtStockBln = sovereign.distressThresholdDB * 1.25;
  const stDebtRatio = Math.max(0.2, sovereign.shortTermFxDebtToReserves / 100);
  const baseAnnualFxService = totalDebtStockBln * 0.11;
  const baseUsableReservesBln = Math.max(
    0.4,
    Number((baseAnnualFxService / stDebtRatio).toFixed(2))
  );

  const reserveStressHaircut =
    scenario === 'scenarioA_fedTightening'
      ? 0.84
      : scenario === 'scenarioB_commodityCollapse'
      ? 0.88
      : scenario === 'scenarioC_malaccaBlockade'
      ? 0.82
      : 1.0;

  const usableFxReservesBln = Number((baseUsableReservesBln * reserveStressHaircut).toFixed(2));

  const years = ['2026', '2027', '2028', '2029', '2030', '2031', '2032'];
  // Deterministic maturity profile humps per sovereign
  const humpSeed = sovereign.code.charCodeAt(0) + sovereign.code.charCodeAt(1);

  let peakYear = '2027';
  let peakAmt = 0;

  const buckets: DebtMaturityYearBucket[] = years.map((year, idx) => {
    // Hump in 2027 and 2029 for Eurobond walls
    const cycleWeight =
      idx === 1
        ? 1.38
        : idx === 3
        ? 1.26
        : idx === 0
        ? 1.05
        : 0.85 + ((humpSeed + idx * 7) % 5) * 0.07;

    const scenarioRefiAdd = scenario === 'baseline' ? 1.0 : 1.14;
    const totalYearDebt = totalDebtStockBln * 0.135 * cycleWeight * scenarioRefiAdd;

    const eurobondShare = sovereign.imfProgramInvolved ? 0.34 : 0.44;
    const imfShare = sovereign.imfProgramInvolved ? 0.28 : 0.09;
    const bilateralShare = 0.18;
    const domesticShare = 1 - (eurobondShare + imfShare + bilateralShare);

    const eurobondUsdBln = Number((totalYearDebt * eurobondShare).toFixed(2));
    const imfMultilateralBln = Number((totalYearDebt * imfShare).toFixed(2));
    const bilateralOfficialBln = Number((totalYearDebt * bilateralShare).toFixed(2));
    const domesticLocalBln = Number((totalYearDebt * domesticShare).toFixed(2));
    const fxMaturityBln = Number(
      (eurobondUsdBln + imfMultilateralBln + bilateralOfficialBln).toFixed(2)
    );
    const totalMaturityBln = Number((fxMaturityBln + domesticLocalBln).toFixed(2));

    if (totalMaturityBln > peakAmt) {
      peakAmt = totalMaturityBln;
      peakYear = year;
    }

    return {
      year,
      eurobondUsdBln,
      imfMultilateralBln,
      bilateralOfficialBln,
      domesticLocalBln,
      totalMaturityBln,
      fxMaturityBln,
      usableFxReservesBln,
      isRolloverBreach: fxMaturityBln > usableFxReservesBln
    };
  });

  const next12mFxDebtServiceBln = buckets[0].fxMaturityBln;
  const next24mFxDebtServiceBln = Number(
    (buckets[0].fxMaturityBln + buckets[1].fxMaturityBln).toFixed(2)
  );
  const reserveCoverageRatioPct = Number(
    ((usableFxReservesBln / Math.max(0.1, next12mFxDebtServiceBln)) * 100).toFixed(1)
  );

  return {
    sovereignId: sovereign.id,
    usableFxReservesBln,
    next12mFxDebtServiceBln,
    next24mFxDebtServiceBln,
    peakMaturityYear: peakYear,
    peakMaturityAmountBln: peakAmt,
    reserveCoverageRatioPct,
    buckets
  };
}

// ============================================================================
// 2. SYSTEMIC CONTAGION NETWORK & CASCADE SIMULATOR
// ============================================================================

export type ContagionChannelFilter = 'all' | 'trade' | 'banking' | 'financial';

export interface BilateralContagionEdge {
  sourceId: string;
  targetId: string;
  tradeWeight: number; // 0 to 1
  bankingWeight: number; // BIS cross-border claims 0 to 1
  financialWeight: number; // ETF / FX basket correlation 0 to 1
  compositeWeight: number; // 0 to 1
}

export interface ContagionNodeCascadeResult {
  sovereignId: string;
  name: string;
  code: string;
  flag: string;
  region: string;
  isInitialTrigger: boolean;
  baselineHazardPct: number;
  round1DirectHazardPct: number;
  round2LiquidityHazardPct: number;
  round3TerminalHazardPct: number;
  totalHazardDeltaPct: number;
  inducedCdsWideningBps: number;
  capitalFlightDrainBln: number;
  systemicVulnerabilityBeta: number;
  statusAfterCascade: 'Seed Default' | 'Cascade Breach' | 'Stressed Spillover' | 'Resilient';
}

export interface ContagionSimulationSummary {
  edges: BilateralContagionEdge[];
  nodes: ContagionNodeCascadeResult[];
  systemicAmplificationMultiplier: number;
  totalInducedCapitalFlightBln: number;
  cascadeBreachCount: number;
  avgSpreadContagionBps: number;
}

export function computeBilateralContagionMatrix(
  sovereigns: SovereignEntity[],
  channelFilter: ContagionChannelFilter = 'all'
): BilateralContagionEdge[] {
  const edges: BilateralContagionEdge[] = [];

  for (let i = 0; i < sovereigns.length; i++) {
    for (let j = 0; j < sovereigns.length; j++) {
      if (i === j) continue;
      const src = sovereigns[i];
      const dst = sovereigns[j];

      const sameRegion = src.region === dst.region ? 0.38 : 0.10;
      const sharedChokepoint =
        src.maritimeChokepointExposure === dst.maritimeChokepointExposure &&
        (src.maritimeChokepointExposure === 'Critical' || src.maritimeChokepointExposure === 'High')
          ? 0.30
          : 0.08;
      const sizeScale = Math.min(
        1.0,
        Math.log10(Math.max(10, src.sovereignAssetValueVA)) / 3.2
      );

      const tradeWeight = Number(
        Math.min(0.95, (sameRegion * 1.1 + sharedChokepoint * 0.9) * sizeScale).toFixed(3)
      );

      const imfClub = src.imfProgramInvolved && dst.imfProgramInvolved ? 0.28 : 0.09;
      const bankingWeight = Number(
        Math.min(
          0.95,
          (sameRegion * 0.8 + imfClub + (dst.shortTermFxDebtToReserves / 240) * 0.35) * sizeScale
        ).toFixed(3)
      );

      const cdsProximity =
        1 / (1 + Math.abs(src.cdsSpread5yBps - dst.cdsSpread5yBps) / 600);
      const financialWeight = Number(
        Math.min(0.95, 0.22 + cdsProximity * 0.45 + sameRegion * 0.35).toFixed(3)
      );

      let compositeWeight =
        0.35 * tradeWeight + 0.35 * bankingWeight + 0.30 * financialWeight;
      if (channelFilter === 'trade') compositeWeight = tradeWeight;
      if (channelFilter === 'banking') compositeWeight = bankingWeight;
      if (channelFilter === 'financial') compositeWeight = financialWeight;

      if (compositeWeight >= 0.16) {
        edges.push({
          sourceId: src.id,
          targetId: dst.id,
          tradeWeight,
          bankingWeight,
          financialWeight,
          compositeWeight: Number(compositeWeight.toFixed(3))
        });
      }
    }
  }

  return edges;
}

export function simulateContagionCascade(
  sovereigns: SovereignEntity[],
  pipelineOutputs: Record<string, LayerOutputs>,
  shockedIds: string[],
  shockLgdSeverityPct: number = 65,
  contagionAmplification: number = 1.0,
  channelFilter: ContagionChannelFilter = 'all'
): ContagionSimulationSummary {
  const edges = computeBilateralContagionMatrix(sovereigns, channelFilter);
  const severityScale = (shockLgdSeverityPct / 65) * contagionAmplification;

  // Round 0: Baseline hazards
  const h0: Record<string, number> = {};
  const h1: Record<string, number> = {};
  const h2: Record<string, number> = {};
  const h3: Record<string, number> = {};

  sovereigns.forEach((s) => {
    const base = (pipelineOutputs[s.id]?.calibratedPosteriorHazard || 0.05) * 100;
    h0[s.id] = base;
    h1[s.id] = shockedIds.includes(s.id) ? Math.min(99.0, Math.max(base, shockLgdSeverityPct)) : base;
  });

  // Round 1 -> Round 1 Direct Bilateral Spillover
  sovereigns.forEach((dst) => {
    if (shockedIds.includes(dst.id)) return;
    let directHit = 0;
    edges
      .filter((e) => e.targetId === dst.id && shockedIds.includes(e.sourceId))
      .forEach((e) => {
        const externalFragilityMult = 0.6 + (dst.pillarScores.p2_externalFragility / 100) * 0.8;
        directHit += e.compositeWeight * 14.5 * severityScale * externalFragilityMult;
      });
    h1[dst.id] = Math.min(96.0, h0[dst.id] + directHit);
  });

  // Round 2 -> Second-Order Interbank & Liquidity Margin Spiral
  sovereigns.forEach((dst) => {
    if (shockedIds.includes(dst.id)) {
      h2[dst.id] = h1[dst.id];
      return;
    }
    let secondOrderHit = 0;
    edges
      .filter((e) => e.targetId === dst.id)
      .forEach((e) => {
        const neighborDelta = Math.max(0, h1[e.sourceId] - h0[e.sourceId]);
        if (!shockedIds.includes(e.sourceId) && neighborDelta > 0) {
          secondOrderHit += e.compositeWeight * neighborDelta * 0.42 * contagionAmplification;
        }
      });
    // Reflexive amplification from own Round 1 jump
    const selfLiquiditySpiral = (h1[dst.id] - h0[dst.id]) * 0.28 * contagionAmplification;
    h2[dst.id] = Math.min(97.5, h1[dst.id] + secondOrderHit + selfLiquiditySpiral);
  });

  // Round 3 -> Terminal FX & Commodity Equilibrium
  sovereigns.forEach((dst) => {
    if (shockedIds.includes(dst.id)) {
      h3[dst.id] = h2[dst.id];
      return;
    }
    const round2Increment = h2[dst.id] - h1[dst.id];
    const pegPenalty = dst.fxRegime === 'Pegged' || dst.fxRegime === 'Managed Float' ? 1.25 : 0.9;
    h3[dst.id] = Math.min(98.5, h2[dst.id] + round2Increment * 0.38 * pegPenalty);
  });

  let totalBaselineNonTrigger = 0;
  let totalTerminalNonTrigger = 0;
  let totalInducedCapitalFlightBln = 0;
  let cascadeBreachCount = 0;
  let sumSpreadWidening = 0;

  const nodes: ContagionNodeCascadeResult[] = sovereigns.map((s) => {
    const isTrigger = shockedIds.includes(s.id);
    const base = Number(h0[s.id].toFixed(2));
    const r1 = Number(h1[s.id].toFixed(2));
    const r2 = Number(h2[s.id].toFixed(2));
    const r3 = Number(h3[s.id].toFixed(2));
    const delta = Number(Math.max(0, r3 - base).toFixed(2));

    if (!isTrigger) {
      totalBaselineNonTrigger += base;
      totalTerminalNonTrigger += r3;
    }

    const inducedCdsWideningBps = Math.round(delta * 42);
    sumSpreadWidening += inducedCdsWideningBps;

    const capitalFlightDrainBln = Number(
      ((s.distressThresholdDB * 0.12) * (delta / 25)).toFixed(2)
    );
    totalInducedCapitalFlightBln += capitalFlightDrainBln;

    const inboundEdges = edges.filter((e) => e.targetId === s.id);
    const systemicVulnerabilityBeta = Number(
      (
        inboundEdges.reduce((acc, e) => acc + e.compositeWeight, 0) /
        Math.max(1, inboundEdges.length) *
        2.2
      ).toFixed(2)
    );

    let statusAfterCascade: ContagionNodeCascadeResult['statusAfterCascade'] = 'Resilient';
    if (isTrigger) {
      statusAfterCascade = 'Seed Default';
    } else if (r3 >= 25.0 || delta >= 12.0) {
      statusAfterCascade = 'Cascade Breach';
      cascadeBreachCount++;
    } else if (delta >= 4.5 || r3 >= 14.0) {
      statusAfterCascade = 'Stressed Spillover';
    }

    return {
      sovereignId: s.id,
      name: s.name,
      code: s.code,
      flag: s.flag,
      region: s.region,
      isInitialTrigger: isTrigger,
      baselineHazardPct: base,
      round1DirectHazardPct: r1,
      round2LiquidityHazardPct: r2,
      round3TerminalHazardPct: r3,
      totalHazardDeltaPct: delta,
      inducedCdsWideningBps,
      capitalFlightDrainBln,
      systemicVulnerabilityBeta,
      statusAfterCascade
    };
  });

  const systemicAmplificationMultiplier = Number(
    (
      totalBaselineNonTrigger > 0
        ? totalTerminalNonTrigger / totalBaselineNonTrigger
        : 1.0
    ).toFixed(2)
  );

  return {
    edges,
    nodes,
    systemicAmplificationMultiplier,
    totalInducedCapitalFlightBln: Number(totalInducedCapitalFlightBln.toFixed(2)),
    cascadeBreachCount,
    avgSpreadContagionBps: Math.round(sumSpreadWidening / Math.max(1, sovereigns.length))
  };
}

// ============================================================================
// 3. CENTRAL BANK POLICY TRACKER & TAYLOR RULE MONITOR
// ============================================================================

export interface CentralBankPolicyProfile {
  sovereignId: string;
  centralBankName: string;
  currencyCode: string;
  policyRatePct: number; // i
  headlineCpiPct: number; // pi
  inflationTargetPct: number; // pi*
  neutralRealRatePct: number; // r*
  outputGapPct: number; // y (% of potential GDP)
  taylorImpliedRatePct: number; // i_Taylor
  policyRateGapBps: number; // (i - i_Taylor) * 100 (Negative = Behind the Curve)
  realInterestRatePct: number; // i - pi
  reerMisalignmentPct: number; // + Overvalued, - Undervalued
  guidottiGreenspanRatioPct: number; // ST FX Debt / Reserves (>100% = breach)
  monetaryStance: 'Behind the Curve' | 'Restrictive / Hawkish' | 'Neutral Equilibrium';
}

const CENTRAL_BANK_METADATA: Record<
  string,
  { bank: string; ccy: string; policyRate: number; cpi: number; target: number; rStar: number; outputGap: number; reer: number }
> = {
  chile: { bank: 'Banco Central de Chile (BCCh)', ccy: 'CLP', policyRate: 5.25, cpi: 4.1, target: 3.0, rStar: 1.2, outputGap: 0.3, reer: -2.4 },
  belize: { bank: 'Central Bank of Belize (CBB)', ccy: 'BZD', policyRate: 4.50, cpi: 4.4, target: 2.5, rStar: 1.5, outputGap: -0.6, reer: 6.8 },
  'paper-walkthrough': { bank: 'Central Bank of Frontier Alpha', ccy: 'FRN', policyRate: 14.00, cpi: 18.2, target: 5.0, rStar: 2.2, outputGap: -1.8, reer: 14.5 },
  'sri-lanka': { bank: 'Central Bank of Sri Lanka (CBSL)', ccy: 'LKR', policyRate: 8.25, cpi: 6.4, target: 5.0, rStar: 2.0, outputGap: -2.4, reer: 8.2 },
  argentina: { bank: 'Banco Central de la República Argentina (BCRA)', ccy: 'ARS', policyRate: 35.00, cpi: 48.5, target: 10.0, rStar: 3.0, outputGap: -3.1, reer: 21.4 },
  turkey: { bank: 'Türkiye Cumhuriyet Merkez Bankası (TCMB)', ccy: 'TRY', policyRate: 47.50, cpi: 44.8, target: 15.0, rStar: 2.5, outputGap: 0.8, reer: 9.6 },
  ghana: { bank: 'Bank of Ghana (BoG)', ccy: 'GHS', policyRate: 27.00, cpi: 22.8, target: 8.0, rStar: 2.4, outputGap: -1.1, reer: 5.2 },
  indonesia: { bank: 'Bank Indonesia (BI)', ccy: 'IDR', policyRate: 6.00, cpi: 2.6, target: 2.5, rStar: 1.8, outputGap: 0.5, reer: -1.8 },
  pakistan: { bank: 'State Bank of Pakistan (SBP)', ccy: 'PKR', policyRate: 15.00, cpi: 17.6, target: 7.0, rStar: 2.3, outputGap: -2.2, reer: 11.8 },
  'south-africa': { bank: 'South African Reserve Bank (SARB)', ccy: 'ZAR', policyRate: 7.75, cpi: 4.6, target: 4.5, rStar: 1.7, outputGap: -0.4, reer: -3.5 }
};

export function computeCentralBankPolicyProfile(
  sovereign: SovereignEntity,
  output: LayerOutputs,
  scenario: MacroScenario,
  alphaInflationWeight: number = 0.5,
  alphaOutputGapWeight: number = 0.5,
  globalRStarShiftPct: number = 0.0
): CentralBankPolicyProfile {
  const meta = CENTRAL_BANK_METADATA[sovereign.id] || {
    bank: `Central Bank of ${sovereign.name}`,
    ccy: sovereign.code,
    policyRate: 8.5,
    cpi: 7.2,
    target: 4.0,
    rStar: 1.8,
    outputGap: -0.8,
    reer: 4.0
  };

  let cpiShock = 0;
  let rStarScenarioShift = globalRStarShiftPct;
  let fxPressureTerm = 0;

  if (scenario === 'scenarioA_fedTightening') {
    cpiShock = 1.4;
    rStarScenarioShift += 0.85;
    fxPressureTerm = (sovereign.fxImpliedVolSkew / 10) * 1.1;
  } else if (scenario === 'scenarioB_commodityCollapse') {
    cpiShock = sovereign.commodityExportShock < 0 ? 2.2 : -0.6;
    fxPressureTerm = sovereign.commodityExportShock < 0 ? 1.8 : 0.3;
  } else if (scenario === 'scenarioC_malaccaBlockade') {
    cpiShock = 2.6;
    fxPressureTerm = 1.65;
  }

  const headlineCpiPct = Number((meta.cpi + cpiShock).toFixed(2));
  const neutralRealRatePct = Number((meta.rStar + rStarScenarioShift).toFixed(2));
  const inflationGap = headlineCpiPct - meta.target;

  // Augmented EM Taylor Rule:
  // i_Taylor = r* + pi + alpha_pi * (pi - pi*) + alpha_y * y + fx_pass_through
  const taylorImpliedRatePct = Number(
    (
      neutralRealRatePct +
      headlineCpiPct +
      alphaInflationWeight * inflationGap +
      alphaOutputGapWeight * meta.outputGap +
      fxPressureTerm
    ).toFixed(2)
  );

  const policyRateGapBps = Math.round((meta.policyRate - taylorImpliedRatePct) * 100);
  const realInterestRatePct = Number((meta.policyRate - headlineCpiPct).toFixed(2));

  let monetaryStance: CentralBankPolicyProfile['monetaryStance'] = 'Neutral Equilibrium';
  if (policyRateGapBps < -100) {
    monetaryStance = 'Behind the Curve';
  } else if (policyRateGapBps > 125) {
    monetaryStance = 'Restrictive / Hawkish';
  }

  return {
    sovereignId: sovereign.id,
    centralBankName: meta.bank,
    currencyCode: meta.ccy,
    policyRatePct: meta.policyRate,
    headlineCpiPct,
    inflationTargetPct: meta.target,
    neutralRealRatePct,
    outputGapPct: meta.outputGap,
    taylorImpliedRatePct,
    policyRateGapBps,
    realInterestRatePct,
    reerMisalignmentPct: Number((meta.reer + fxPressureTerm * 1.8).toFixed(1)),
    guidottiGreenspanRatioPct: Number(sovereign.shortTermFxDebtToReserves.toFixed(1)),
    monetaryStance
  };
}

// ============================================================================
// 4. MULTI-SOVEREIGN PORTFOLIO VaR & HEDGE OPTIMIZER
// ============================================================================

export interface PortfolioPosition {
  sovereignId: string;
  notionalUsdMillions: number;
  instrument: '5Y USD Eurobond' | '10Y USD Eurobond' | 'Local Currency Sovereign';
  cdsHedgeRatioPct: number; // 0 to 100% notional hedged via 5Y CDS protection
}

export interface PortfolioPositionAttribution {
  sovereignId: string;
  name: string;
  code: string;
  flag: string;
  notionalUsdMillions: number;
  weightPct: number;
  instrument: PortfolioPosition['instrument'];
  cdsHedgeRatioPct: number;
  standaloneVar99Pct: number;
  standaloneVarUsdM: number;
  marginalVarPct: number;
  componentVarUsdM: number; // Euler allocation pre-hedge
  netPostHedgeVarUsdM: number; // Post CDS protection
  componentSharePct: number;
  grossYieldPct: number;
  cdsHedgeCostUsdM: number;
  netCarryUsdM: number;
}

export interface PortfolioAnalyticsSummary {
  totalNotionalUsdM: number;
  undiversifiedVarUsdM: number;
  diversifiedPreHedgeVarUsdM: number;
  diversificationBenefitUsdM: number;
  diversificationBenefitPct: number;
  netPostHedgeVarUsdM: number;
  netPostHedgeVarPct: number;
  netPostHedgeEs975UsdM: number;
  grossAnnualCarryUsdM: number;
  totalCdsHedgeCostUsdM: number;
  netAnnualCarryUsdM: number;
  returnOnVarRatio: number;
  attributions: PortfolioPositionAttribution[];
}

export const PRESET_INSTITUTIONAL_BOOKS: Record<string, { name: string; description: string; positions: PortfolioPosition[] }> = {
  em_distressed_alpha: {
    name: 'EM High-Yield & Special Situations Book ($195M)',
    description: 'Concentrated high-carry frontier & distressed sovereign mandate with selective CDS tail hedges',
    positions: [
      { sovereignId: 'argentina', notionalUsdMillions: 45, instrument: '5Y USD Eurobond', cdsHedgeRatioPct: 40 },
      { sovereignId: 'sri-lanka', notionalUsdMillions: 35, instrument: '5Y USD Eurobond', cdsHedgeRatioPct: 30 },
      { sovereignId: 'pakistan', notionalUsdMillions: 35, instrument: '5Y USD Eurobond', cdsHedgeRatioPct: 35 },
      { sovereignId: 'ghana', notionalUsdMillions: 30, instrument: '10Y USD Eurobond', cdsHedgeRatioPct: 25 },
      { sovereignId: 'turkey', notionalUsdMillions: 30, instrument: '5Y USD Eurobond', cdsHedgeRatioPct: 15 },
      { sovereignId: 'belize', notionalUsdMillions: 20, instrument: '5Y USD Eurobond', cdsHedgeRatioPct: 20 }
    ]
  },
  global_macro_core: {
    name: 'Global Macro Core Sovereign Mandate ($440M)',
    description: 'Balanced investment-grade and BB-tier sovereign allocation anchored by Chile, Indonesia, and South Africa',
    positions: [
      { sovereignId: 'chile', notionalUsdMillions: 140, instrument: '10Y USD Eurobond', cdsHedgeRatioPct: 10 },
      { sovereignId: 'indonesia', notionalUsdMillions: 130, instrument: '10Y USD Eurobond', cdsHedgeRatioPct: 10 },
      { sovereignId: 'south-africa', notionalUsdMillions: 95, instrument: '5Y USD Eurobond', cdsHedgeRatioPct: 20 },
      { sovereignId: 'turkey', notionalUsdMillions: 75, instrument: '5Y USD Eurobond', cdsHedgeRatioPct: 25 }
    ]
  },
  frontier_barbell: {
    name: 'Frontier Tail-Risk Barbell Strategy ($300M)',
    description: 'Barbell pairing low-beta IG sovereigns with deep-discount restructured frontier sovereigns',
    positions: [
      { sovereignId: 'chile', notionalUsdMillions: 90, instrument: '10Y USD Eurobond', cdsHedgeRatioPct: 0 },
      { sovereignId: 'indonesia', notionalUsdMillions: 80, instrument: '10Y USD Eurobond', cdsHedgeRatioPct: 0 },
      { sovereignId: 'argentina', notionalUsdMillions: 50, instrument: '5Y USD Eurobond', cdsHedgeRatioPct: 50 },
      { sovereignId: 'sri-lanka', notionalUsdMillions: 45, instrument: '5Y USD Eurobond', cdsHedgeRatioPct: 45 },
      { sovereignId: 'belize', notionalUsdMillions: 35, instrument: '5Y USD Eurobond', cdsHedgeRatioPct: 30 }
    ]
  }
};

export function computePortfolioRiskAttribution(
  positions: PortfolioPosition[],
  sovereigns: SovereignEntity[],
  pipelineOutputs: Record<string, LayerOutputs>,
  scenario: MacroScenario,
  customParams?: CustomScenarioParams
): PortfolioAnalyticsSummary {
  const activePositions = positions.filter((p) => p.notionalUsdMillions > 0);
  const totalNotionalUsdM = activePositions.reduce((s, p) => s + p.notionalUsdMillions, 0);

  if (totalNotionalUsdM <= 0) {
    return {
      totalNotionalUsdM: 0,
      undiversifiedVarUsdM: 0,
      diversifiedPreHedgeVarUsdM: 0,
      diversificationBenefitUsdM: 0,
      diversificationBenefitPct: 0,
      netPostHedgeVarUsdM: 0,
      netPostHedgeVarPct: 0,
      netPostHedgeEs975UsdM: 0,
      grossAnnualCarryUsdM: 0,
      totalCdsHedgeCostUsdM: 0,
      netAnnualCarryUsdM: 0,
      returnOnVarRatio: 0,
      attributions: []
    };
  }

  // Compute standalone VaR ($M) for each position
  const posData = activePositions.map((pos) => {
    const sov = sovereigns.find((s) => s.id === pos.sovereignId) || sovereigns[0];
    const out = pipelineOutputs[sov.id];
    const curve = computeSovereignYieldCurve(sov, out, scenario, customParams);

    const instMultiplier =
      pos.instrument === '10Y USD Eurobond'
        ? 1.18
        : pos.instrument === 'Local Currency Sovereign'
        ? 1.26
        : 1.0;

    const standaloneVar99Pct = Number(((out?.lVar99 || 15) * instMultiplier).toFixed(2));
    const standaloneVarUsdM = (pos.notionalUsdMillions * standaloneVar99Pct) / 100;

    const yPoint =
      pos.instrument === '10Y USD Eurobond'
        ? curve.points.find((pt) => pt.years === 10)
        : curve.points.find((pt) => pt.years === 5);

    const grossYieldPct =
      pos.instrument === 'Local Currency Sovereign'
        ? yPoint?.localCurrencyYield || 9.0
        : yPoint?.usdEurobondYield || 7.5;

    const cdsSpreadPct = sov.cdsSpread5yBps / 100;
    const cdsHedgeCostUsdM =
      pos.notionalUsdMillions * (pos.cdsHedgeRatioPct / 100) * (cdsSpreadPct / 100);
    const grossCarryUsdM = pos.notionalUsdMillions * (grossYieldPct / 100);

    return {
      pos,
      sov,
      out,
      standaloneVar99Pct,
      standaloneVarUsdM,
      grossYieldPct,
      grossCarryUsdM,
      cdsHedgeCostUsdM
    };
  });

  const undiversifiedVarUsdM = posData.reduce((acc, d) => acc + d.standaloneVarUsdM, 0);

  // Pairwise Student-t copula correlation matrix for Euler Component VaR decomposition
  const n = posData.length;
  const corrMatrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        corrMatrix[i][j] = 1.0;
      } else {
        const sameRegion = posData[i].sov.region === posData[j].sov.region ? 0.62 : 0.36;
        const crisisTailAdd = scenario === 'baseline' ? 0.0 : 0.16;
        corrMatrix[i][j] = Math.min(0.92, sameRegion + crisisTailAdd);
      }
    }
  }

  // Compute portfolio variance under pre-hedge and post-hedge states
  // CDS hedge effectiveness is ~86% against sovereign credit jump-to-default & spread VaR (basis risk remains ~14%)
  const HEDGE_EFFECTIVENESS = 0.86;

  let preHedgeVariance = 0;
  let postHedgeVariance = 0;

  const netStandaloneVars = posData.map(
    (d) => d.standaloneVarUsdM * (1 - (d.pos.cdsHedgeRatioPct / 100) * HEDGE_EFFECTIVENESS)
  );

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      preHedgeVariance +=
        posData[i].standaloneVarUsdM * posData[j].standaloneVarUsdM * corrMatrix[i][j];
      postHedgeVariance +=
        netStandaloneVars[i] * netStandaloneVars[j] * corrMatrix[i][j];
    }
  }

  const diversifiedPreHedgeVarUsdM = Math.sqrt(Math.max(0, preHedgeVariance));
  const netPostHedgeVarUsdM = Math.sqrt(Math.max(0, postHedgeVariance));

  // Euler Component VaR allocation: C_i = (v_i * sum_j(v_j * rho_ij)) / V_portfolio
  const attributions: PortfolioPositionAttribution[] = posData.map((d, i) => {
    let covPre = 0;
    let covPost = 0;
    for (let j = 0; j < n; j++) {
      covPre += posData[j].standaloneVarUsdM * corrMatrix[i][j];
      covPost += netStandaloneVars[j] * corrMatrix[i][j];
    }

    const componentVarUsdM =
      diversifiedPreHedgeVarUsdM > 0
        ? (d.standaloneVarUsdM * covPre) / diversifiedPreHedgeVarUsdM
        : 0;

    const netComponentVarUsdM =
      netPostHedgeVarUsdM > 0
        ? (netStandaloneVars[i] * covPost) / netPostHedgeVarUsdM
        : 0;

    const marginalVarPct =
      d.pos.notionalUsdMillions > 0
        ? (netComponentVarUsdM / d.pos.notionalUsdMillions) * 100
        : 0;

    return {
      sovereignId: d.sov.id,
      name: d.sov.name,
      code: d.sov.code,
      flag: d.sov.flag,
      notionalUsdMillions: d.pos.notionalUsdMillions,
      weightPct: Number(((d.pos.notionalUsdMillions / totalNotionalUsdM) * 100).toFixed(1)),
      instrument: d.pos.instrument,
      cdsHedgeRatioPct: d.pos.cdsHedgeRatioPct,
      standaloneVar99Pct: d.standaloneVar99Pct,
      standaloneVarUsdM: Number(d.standaloneVarUsdM.toFixed(2)),
      marginalVarPct: Number(marginalVarPct.toFixed(2)),
      componentVarUsdM: Number(componentVarUsdM.toFixed(2)),
      netPostHedgeVarUsdM: Number(netComponentVarUsdM.toFixed(2)),
      componentSharePct:
        netPostHedgeVarUsdM > 0
          ? Number(((netComponentVarUsdM / netPostHedgeVarUsdM) * 100).toFixed(1))
          : 0,
      grossYieldPct: d.grossYieldPct,
      cdsHedgeCostUsdM: Number(d.cdsHedgeCostUsdM.toFixed(2)),
      netCarryUsdM: Number((d.grossCarryUsdM - d.cdsHedgeCostUsdM).toFixed(2))
    };
  });

  const grossAnnualCarryUsdM = posData.reduce((s, d) => s + d.grossCarryUsdM, 0);
  const totalCdsHedgeCostUsdM = posData.reduce((s, d) => s + d.cdsHedgeCostUsdM, 0);
  const netAnnualCarryUsdM = grossAnnualCarryUsdM - totalCdsHedgeCostUsdM;
  const diversificationBenefitUsdM = Math.max(0, undiversifiedVarUsdM - diversifiedPreHedgeVarUsdM);

  return {
    totalNotionalUsdM: Number(totalNotionalUsdM.toFixed(1)),
    undiversifiedVarUsdM: Number(undiversifiedVarUsdM.toFixed(2)),
    diversifiedPreHedgeVarUsdM: Number(diversifiedPreHedgeVarUsdM.toFixed(2)),
    diversificationBenefitUsdM: Number(diversificationBenefitUsdM.toFixed(2)),
    diversificationBenefitPct: Number(
      ((diversificationBenefitUsdM / Math.max(1, undiversifiedVarUsdM)) * 100).toFixed(1)
    ),
    netPostHedgeVarUsdM: Number(netPostHedgeVarUsdM.toFixed(2)),
    netPostHedgeVarPct: Number(((netPostHedgeVarUsdM / totalNotionalUsdM) * 100).toFixed(2)),
    netPostHedgeEs975UsdM: Number((netPostHedgeVarUsdM * 1.18).toFixed(2)),
    grossAnnualCarryUsdM: Number(grossAnnualCarryUsdM.toFixed(2)),
    totalCdsHedgeCostUsdM: Number(totalCdsHedgeCostUsdM.toFixed(2)),
    netAnnualCarryUsdM: Number(netAnnualCarryUsdM.toFixed(2)),
    returnOnVarRatio: Number(
      (netAnnualCarryUsdM / Math.max(0.5, netPostHedgeVarUsdM)).toFixed(2)
    ),
    attributions
  };
}

/**
 * Optimizes CDS protection hedge ratios across portfolio positions to maximize
 * VaR reduction per dollar of CDS carry cost within a target hedge budget (% of gross carry).
 */
export function optimizePortfolioCdsHedges(
  positions: PortfolioPosition[],
  sovereigns: SovereignEntity[],
  pipelineOutputs: Record<string, LayerOutputs>,
  maxHedgeBudgetShareOfCarryPct: number = 35
): PortfolioPosition[] {
  // Rank positions by efficiency: (L-VaR99 * PosteriorHazard) / CDS_Spread
  const scored = positions.map((p) => {
    const sov = sovereigns.find((s) => s.id === p.sovereignId) || sovereigns[0];
    const out = pipelineOutputs[sov.id];
    const varPct = out?.lVar99 || 15;
    const hazard = (out?.calibratedPosteriorHazard || 0.05) * 100;
    const cdsPct = Math.max(0.5, sov.cdsSpread5yBps / 100);
    const efficiency = (varPct * (1 + hazard / 15)) / cdsPct;
    return { p, sov, efficiency, hazard };
  });

  const budgetScale = maxHedgeBudgetShareOfCarryPct / 35;

  return scored.map(({ p, hazard, efficiency }) => {
    if (p.notionalUsdMillions <= 0) return { ...p, cdsHedgeRatioPct: 0 };
    // High-hazard or high-efficiency positions get higher protection
    let optimalRatio = Math.round(
      Math.min(90, Math.max(10, (hazard * 1.8 + efficiency * 6.5) * budgetScale)) / 5
    ) * 5;
    return {
      ...p,
      cdsHedgeRatioPct: Math.min(95, Math.max(0, optimalRatio))
    };
  });
}
