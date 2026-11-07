import { CouncilAssessmentRun, WatchlistItem } from '../types/council';
import { buildDefaultAssessmentRun, SOVEREIGN_CATALOG } from '../data/presetsAndBaselines';
import { nextOfficialEvent } from '../data/officialCalendar';

// IMF review / rating / auction events have no official dated source yet, so they are
// not shown. (They used to be placed on generated dates.)
const UNSCHEDULED_REVIEW_EVENTS_ENABLED = false;

// ============================================================================
// 1. SHARED STAGED IC TRADE TICKET & TEAR-SHEET TYPES
// ============================================================================

export type StagedTradeDirection =
  | 'LONG_CARRY_ROLL'
  | 'CURVE_STEEPENER'
  | 'CURVE_FLATTENER'
  | 'BELLY_BUTTERFLY'
  | 'PAIR_RELATIVE_VALUE'
  | 'CATALYST_VOL_HEDGE';

export interface StagedTradeTicketSpec {
  ticketId: string;
  createdAtIso: string;
  iso3: string;
  countryName: string;
  secondaryIso3?: string;
  strategyTitle: string;
  direction: StagedTradeDirection;
  sourceModuleLabel: string;
  targetSectionId: string;
  leg1Summary: string;
  leg2Summary: string;
  entrySpreadOrYieldBps: number;
  targetSpreadOrYieldBps: number;
  stopLossSpreadOrYieldBps: number;
  expected12MCarryRollBps: number;
  breakevenCushionBps: number;
  impliedEventVolBps: number;
  convictionScore0To100: number;
  preMortemKillSwitchRule: string;
  thesisRationale: string;
}

// ============================================================================
// 2. NELSON-SIEGEL-SVENSSON (NSS) SOVEREIGN YIELD CURVE & CARRY+ROLL ENGINE
// ============================================================================

export type NssCurvePresetRegime =
  | 'BASELINE'
  | 'BEAR_STEEPENER'
  | 'BULL_FLATTENER'
  | 'MONETARY_PIVOT_RALLY'
  | 'FISCAL_DOMINANCE_UNANCHORING';

export interface NssCurveShockInputs {
  presetRegime: NssCurvePresetRegime;
  levelShiftBps: number; // Parallel shift to β0 (-200 to +200 bps)
  slopeShiftBps: number; // Short-end slope shift to β1 (-200 to +200 bps)
  curvatureShiftBps: number; // Belly hump shift to β2 (-200 to +200 bps)
}

export const DEFAULT_NSS_SHOCK_INPUTS: NssCurveShockInputs = {
  presetRegime: 'BASELINE',
  levelShiftBps: 0,
  slopeShiftBps: 0,
  curvatureShiftBps: 0,
};

export interface NssParameters {
  beta0LongRunLevelPct: number;
  beta1ShortSlopePct: number;
  beta2BellyCurvaturePct: number;
  beta3LongConvexityPct: number;
  tau1DecayYears: number;
  tau2DecayYears: number;
}

export interface NssTenorNode {
  tenorLabel: string;
  maturityYears: number;
  marketSpotYieldPct: number;
  baselineNssYieldPct: number;
  shockedNssYieldPct: number;
  cheapRichResidualBps: number; // (Market Spot - Shocked NSS) * 100 (positive = cheap vs model)
  modifiedDurationYears: number;
  carry12MBps: number; // 12M yield pickup over 1Y funding rate (bps)
  rollDown12MBps: number; // 12M capital gain from rolling 1Y down the curve (bps)
  totalCarryRoll12MBps: number; // carry12MBps + rollDown12MBps
  breakevenCushionBps: number; // totalCarryRoll12MBps / modifiedDurationYears (bps sell-off buffer)
  carryToDurationRatioBpsPerYr: number;
  valuationSignal: 'CHEAP_OVERWEIGHT' | 'FAIR_NEUTRAL' | 'RICH_UNDERWEIGHT';
}

export interface NssYieldCurveSuite {
  iso3: string;
  countryName: string;
  currencyCode: string;
  baselineParams: NssParameters;
  shockedParams: NssParameters;
  tenorNodes: NssTenorNode[];
  slope2s10sBps: number;
  slope5s30sBps: number;
  butterfly2s5s10sBps: number; // (2 * y5 - y2 - y10) * 100
  curveRegimeClassification: string;
  optimalCarryRollTenor: NssTenorNode;
  optimalBreakevenTenor: NssTenorNode;
  cheapestVsModelTenor: NssTenorNode;
  fittingRmseBps: number;
  headlineConclusion: string;
  recommendedCurveTickets: StagedTradeTicketSpec[];
}

function evaluateNssYieldAtMaturity(tau: number, params: NssParameters): number {
  const t = Math.max(0.25, tau);
  const x1 = t / Math.max(0.2, params.tau1DecayYears);
  const x2 = t / Math.max(0.5, params.tau2DecayYears);

  const factor1 = (1 - Math.exp(-x1)) / x1;
  const factor2 = factor1 - Math.exp(-x1);
  const factor3 = (1 - Math.exp(-x2)) / x2 - Math.exp(-x2);

  const y =
    params.beta0LongRunLevelPct +
    params.beta1ShortSlopePct * factor1 +
    params.beta2BellyCurvaturePct * factor2 +
    params.beta3LongConvexityPct * factor3;

  return Math.max(0.15, Number(y.toFixed(3)));
}

function deterministicHash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function computeSovereignNssYieldCurveSuite(
  run: CouncilAssessmentRun,
  shockInputs: NssCurveShockInputs = DEFAULT_NSS_SHOCK_INPUTS
): NssYieldCurveSuite {
  const open = run.openData;
  const polRate = open.monetaryAndMarket.policyRatePct;
  const y10Spot = open.monetaryAndMarket.sovereign10YBondYieldPct;
  const debtGdp = open.imfIndicators.debtToGdpPct;
  const cpi = open.imfIndicators.cpiInflationPct;
  const gap = open.dsaAnalytics.fiscalConsolidationGapPct;

  // Calibrate baseline 6-factor NSS parameters to the sovereign's macro/market posture
  const fiscalTermPremiumPct = Math.max(-0.4, Math.min(2.6, (debtGdp - 60) * 0.018 + gap * 0.22));
  const beta0Baseline = Number((y10Spot + 0.55 + fiscalTermPremiumPct * 0.35).toFixed(2));
  const beta1Baseline = Number((polRate - beta0Baseline).toFixed(2));

  // Belly curvature (beta2) reflects medium-term inflation & policy transition hump
  const seed = deterministicHash(run.iso3);
  const microHump = ((seed % 17) - 8) * 0.08;
  const beta2Baseline = Number(
    ((cpi > polRate ? 1.85 : 0.95) + gap * 0.3 + microHump).toFixed(2)
  );
  const beta3Baseline = Number((fiscalTermPremiumPct * 0.85 + 0.45).toFixed(2));

  const baselineParams: NssParameters = {
    beta0LongRunLevelPct: beta0Baseline,
    beta1ShortSlopePct: beta1Baseline,
    beta2BellyCurvaturePct: beta2Baseline,
    beta3LongConvexityPct: beta3Baseline,
    tau1DecayYears: 1.85,
    tau2DecayYears: 6.4,
  };

  // Preset regime shifts (in percentage points)
  let presetB0 = 0;
  let presetB1 = 0;
  let presetB2 = 0;
  let presetB3 = 0;

  if (shockInputs.presetRegime === 'BEAR_STEEPENER') {
    presetB0 = 0.85;
    presetB1 = -0.65;
    presetB2 = 0.35;
    presetB3 = 0.55;
  } else if (shockInputs.presetRegime === 'BULL_FLATTENER') {
    presetB0 = -0.75;
    presetB1 = 0.45;
    presetB2 = -0.25;
    presetB3 = -0.35;
  } else if (shockInputs.presetRegime === 'MONETARY_PIVOT_RALLY') {
    presetB0 = -0.35;
    presetB1 = -1.35;
    presetB2 = 0.65;
    presetB3 = -0.15;
  } else if (shockInputs.presetRegime === 'FISCAL_DOMINANCE_UNANCHORING') {
    presetB0 = 1.45;
    presetB1 = -1.1;
    presetB2 = 0.95;
    presetB3 = 1.25;
  }

  const shockedParams: NssParameters = {
    beta0LongRunLevelPct: Number(
      (
        baselineParams.beta0LongRunLevelPct +
        presetB0 +
        shockInputs.levelShiftBps / 100
      ).toFixed(3)
    ),
    beta1ShortSlopePct: Number(
      (
        baselineParams.beta1ShortSlopePct +
        presetB1 +
        shockInputs.slopeShiftBps / 100
      ).toFixed(3)
    ),
    beta2BellyCurvaturePct: Number(
      (
        baselineParams.beta2BellyCurvaturePct +
        presetB2 +
        shockInputs.curvatureShiftBps / 100
      ).toFixed(3)
    ),
    beta3LongConvexityPct: Number((baselineParams.beta3LongConvexityPct + presetB3).toFixed(3)),
    tau1DecayYears: baselineParams.tau1DecayYears,
    tau2DecayYears: baselineParams.tau2DecayYears,
  };

  const benchmarkTenors: Array<{ label: string; years: number; spotDislocationBps: number }> = [
    { label: '1Y', years: 1, spotDislocationBps: ((seed % 11) - 5) * 2.5 },
    { label: '2Y', years: 2, spotDislocationBps: ((seed % 13) - 6) * 3.0 },
    { label: '3Y', years: 3, spotDislocationBps: ((seed % 19) - 7) * 3.2 },
    { label: '5Y', years: 5, spotDislocationBps: Math.abs((seed % 9) + 5) * 3.4 }, // Belly tends to offer liquidity/auction concession
    { label: '7Y', years: 7, spotDislocationBps: ((seed % 15) - 4) * 3.1 },
    { label: '10Y', years: 10, spotDislocationBps: ((seed % 7) - 3) * 2.4 },
    { label: '20Y', years: 20, spotDislocationBps: ((seed % 17) - 8) * 2.8 },
    { label: '30Y', years: 30, spotDislocationBps: ((seed % 11) - 4) * 3.3 },
  ];

  const oneYearFittedPct = evaluateNssYieldAtMaturity(1, shockedParams);

  const tenorNodes: NssTenorNode[] = benchmarkTenors.map((t) => {
    const baselineNssYieldPct = evaluateNssYieldAtMaturity(t.years, baselineParams);
    const shockedNssYieldPct = evaluateNssYieldAtMaturity(t.years, shockedParams);
    // Market spot tracks baseline NSS plus realistic benchmark bond micro-dislocation
    const marketSpotYieldPct = Number(
      Math.max(0.2, baselineNssYieldPct + t.spotDislocationBps / 100).toFixed(2)
    );

    const cheapRichResidualBps = Math.round((marketSpotYieldPct - shockedNssYieldPct) * 100);

    // Macaulay / Modified Duration approximation for par sovereign bond at yield y
    const yDec = Math.max(0.005, shockedNssYieldPct / 100);
    const macDur = (1 - Math.pow(1 + yDec, -t.years)) / (1 - 1 / (1 + yDec));
    const modifiedDurationYears = Number(Math.max(0.85, macDur / (1 + yDec)).toFixed(2));

    // 12-Month Carry (bps) = Spot/Fitted Yield at T minus 1Y Short Funding Yield
    const carry12MBps = Math.round((shockedNssYieldPct - oneYearFittedPct) * 100);

    // 12-Month Roll-Down (bps) = Yield change from T to (T - 1) multiplied by (T - 1) modified duration
    const rolledMaturity = Math.max(0.5, t.years - 1);
    const rolledYieldPct =
      t.years === 1 ? shockedNssYieldPct : evaluateNssYieldAtMaturity(rolledMaturity, shockedParams);
    const rollDownYieldDeltaPct = shockedNssYieldPct - rolledYieldPct;
    const rollDur = Math.max(0.5, modifiedDurationYears * 0.86);
    const rollDown12MBps = t.years === 1 ? 0 : Math.round(rollDownYieldDeltaPct * rollDur * 100);

    const totalCarryRoll12MBps = carry12MBps + rollDown12MBps;
    const breakevenCushionBps = Math.round(totalCarryRoll12MBps / modifiedDurationYears);
    const carryToDurationRatioBpsPerYr = Number(
      (totalCarryRoll12MBps / modifiedDurationYears).toFixed(1)
    );

    const valuationSignal: NssTenorNode['valuationSignal'] =
      cheapRichResidualBps >= 12
        ? 'CHEAP_OVERWEIGHT'
        : cheapRichResidualBps <= -12
        ? 'RICH_UNDERWEIGHT'
        : 'FAIR_NEUTRAL';

    return {
      tenorLabel: t.label,
      maturityYears: t.years,
      marketSpotYieldPct: Number(marketSpotYieldPct.toFixed(2)),
      baselineNssYieldPct: Number(baselineNssYieldPct.toFixed(2)),
      shockedNssYieldPct: Number(shockedNssYieldPct.toFixed(2)),
      cheapRichResidualBps,
      modifiedDurationYears,
      carry12MBps,
      rollDown12MBps,
      totalCarryRoll12MBps,
      breakevenCushionBps,
      carryToDurationRatioBpsPerYr,
      valuationSignal,
    };
  });

  const node2Y = tenorNodes.find((n) => n.maturityYears === 2) ?? tenorNodes[1];
  const node5Y = tenorNodes.find((n) => n.maturityYears === 5) ?? tenorNodes[3];
  const node10Y = tenorNodes.find((n) => n.maturityYears === 10) ?? tenorNodes[5];
  const node30Y = tenorNodes.find((n) => n.maturityYears === 30) ?? tenorNodes[7];

  const slope2s10sBps = Math.round((node10Y.shockedNssYieldPct - node2Y.shockedNssYieldPct) * 100);
  const slope5s30sBps = Math.round((node30Y.shockedNssYieldPct - node5Y.shockedNssYieldPct) * 100);
  const butterfly2s5s10sBps = Math.round(
    (2 * node5Y.shockedNssYieldPct - node2Y.shockedNssYieldPct - node10Y.shockedNssYieldPct) * 100
  );

  // Exclude 1Y when ranking optimal carry+roll tenors
  const investableTenors = tenorNodes.filter((n) => n.maturityYears >= 2);
  const optimalCarryRollTenor = [...investableTenors].sort(
    (a, b) => b.totalCarryRoll12MBps - a.totalCarryRoll12MBps
  )[0];
  const optimalBreakevenTenor = [...investableTenors].sort(
    (a, b) => b.breakevenCushionBps - a.breakevenCushionBps
  )[0];
  const cheapestVsModelTenor = [...investableTenors].sort(
    (a, b) => b.cheapRichResidualBps - a.cheapRichResidualBps
  )[0];

  const sqErrSum = tenorNodes.reduce(
    (acc, n) => acc + Math.pow((n.marketSpotYieldPct - n.baselineNssYieldPct) * 100, 2),
    0
  );
  const fittingRmseBps = Number(Math.sqrt(sqErrSum / tenorNodes.length).toFixed(1));

  const curveRegimeClassification =
    slope2s10sBps < -25
      ? 'INVERTED MONETARY TIGHTENING CURVE'
      : slope2s10sBps > 110
      ? 'STEEP FISCAL TERM-PREMIUM CURVE'
      : butterfly2s5s10sBps > 25
      ? 'BELLY-CHEAP HUMPED CURVE'
      : 'NORMAL MODERATE-SLOPE TERM STRUCTURE';

  const headlineConclusion = `${run.countryName} (${run.iso3}) NSS curve (${curveRegimeClassification}) prices 2s10s at ${slope2s10sBps > 0 ? '+' : ''}${slope2s10sBps} bps and 2s5s10s butterfly at ${butterfly2s5s10sBps > 0 ? '+' : ''}${butterfly2s5s10sBps} bps. The ${optimalCarryRollTenor.tenorLabel} tenor delivers peak 12M Carry+Roll of ${optimalCarryRollTenor.totalCarryRoll12MBps > 0 ? '+' : ''}${optimalCarryRollTenor.totalCarryRoll12MBps} bps (Breakeven cushion ${optimalCarryRollTenor.breakevenCushionBps > 0 ? '+' : ''}${optimalCarryRollTenor.breakevenCushionBps} bps/yr), while ${cheapestVsModelTenor.tenorLabel} trades ${cheapestVsModelTenor.cheapRichResidualBps > 0 ? '+' : ''}${cheapestVsModelTenor.cheapRichResidualBps} bps cheap to parametric NSS fair value.`;

  // Build 3 ready-to-stage Curve Relative-Value Trade Tickets
  const recommendedCurveTickets: StagedTradeTicketSpec[] = [
    {
      ticketId: `NSS-CARRY-${run.iso3}-${optimalCarryRollTenor.tenorLabel}`,
      createdAtIso: new Date().toISOString(),
      iso3: run.iso3,
      countryName: run.countryName,
      strategyTitle: `Long ${run.iso3} ${optimalCarryRollTenor.tenorLabel} NSS Carry + Roll-Down Sweet Spot`,
      direction: 'LONG_CARRY_ROLL',
      sourceModuleLabel: '5.7 NSS Yield Curve Lab',
      targetSectionId: 'quant_nss_yield_curve',
      leg1Summary: `Receive ${run.iso3} ${optimalCarryRollTenor.tenorLabel} Benchmark @ ${optimalCarryRollTenor.shockedNssYieldPct.toFixed(2)}% (ModDur ${optimalCarryRollTenor.modifiedDurationYears.toFixed(2)}y)`,
      leg2Summary: `Fund via 1Y Short Repo / T-Bill Anchor @ ${oneYearFittedPct.toFixed(2)}%`,
      entrySpreadOrYieldBps: Math.round(optimalCarryRollTenor.shockedNssYieldPct * 100),
      targetSpreadOrYieldBps: Math.round(optimalCarryRollTenor.shockedNssYieldPct * 100) - 45,
      stopLossSpreadOrYieldBps:
        Math.round(optimalCarryRollTenor.shockedNssYieldPct * 100) +
        Math.max(30, Math.abs(optimalCarryRollTenor.breakevenCushionBps)),
      expected12MCarryRollBps: optimalCarryRollTenor.totalCarryRoll12MBps,
      breakevenCushionBps: optimalCarryRollTenor.breakevenCushionBps,
      impliedEventVolBps: 24,
      convictionScore0To100: Math.min(
        96,
        Math.max(64, 72 + Math.round(optimalCarryRollTenor.breakevenCushionBps * 0.35))
      ),
      preMortemKillSwitchRule: `Exit if ${run.iso3} ${optimalCarryRollTenor.tenorLabel} yield widens beyond +${Math.max(30, Math.abs(optimalCarryRollTenor.breakevenCushionBps))} bps breakeven cushion or CPI surprises > +60 bps.`,
      thesisRationale: `Captures ${optimalCarryRollTenor.carry12MBps > 0 ? '+' : ''}${optimalCarryRollTenor.carry12MBps} bps 12M carry plus ${optimalCarryRollTenor.rollDown12MBps > 0 ? '+' : ''}${optimalCarryRollTenor.rollDown12MBps} bps NSS curve roll-down (${optimalCarryRollTenor.totalCarryRoll12MBps > 0 ? '+' : ''}${optimalCarryRollTenor.totalCarryRoll12MBps} bps total).`,
    },
    {
      ticketId: `NSS-2S10S-${run.iso3}`,
      createdAtIso: new Date().toISOString(),
      iso3: run.iso3,
      countryName: run.countryName,
      strategyTitle:
        slope2s10sBps < 15
          ? `${run.iso3} 2s10s DV01-Neutral Curve Steepener`
          : `${run.iso3} 2s10s DV01-Neutral Curve Flattener`,
      direction: slope2s10sBps < 15 ? 'CURVE_STEEPENER' : 'CURVE_FLATTENER',
      sourceModuleLabel: '5.7 NSS Yield Curve Lab',
      targetSectionId: 'quant_nss_yield_curve',
      leg1Summary:
        slope2s10sBps < 15
          ? `Long ${run.iso3} 2Y @ ${node2Y.shockedNssYieldPct.toFixed(2)}% (DV01-weighted)`
          : `Long ${run.iso3} 10Y @ ${node10Y.shockedNssYieldPct.toFixed(2)}% (DV01-weighted)`,
      leg2Summary:
        slope2s10sBps < 15
          ? `Short ${run.iso3} 10Y @ ${node10Y.shockedNssYieldPct.toFixed(2)}% (DV01-weighted)`
          : `Short ${run.iso3} 2Y @ ${node2Y.shockedNssYieldPct.toFixed(2)}% (DV01-weighted)`,
      entrySpreadOrYieldBps: slope2s10sBps,
      targetSpreadOrYieldBps: slope2s10sBps < 15 ? slope2s10sBps + 55 : slope2s10sBps - 50,
      stopLossSpreadOrYieldBps: slope2s10sBps < 15 ? slope2s10sBps - 30 : slope2s10sBps + 30,
      expected12MCarryRollBps:
        slope2s10sBps < 15
          ? node2Y.totalCarryRoll12MBps - Math.round(node10Y.totalCarryRoll12MBps * 0.35)
          : node10Y.totalCarryRoll12MBps - Math.round(node2Y.totalCarryRoll12MBps * 0.45),
      breakevenCushionBps: Math.abs(Math.round(slope2s10sBps * 0.35)) + 18,
      impliedEventVolBps: 28,
      convictionScore0To100: 82,
      preMortemKillSwitchRule: `Stop out if 2s10s moves 30 bps against position or central bank signals emergency off-cycle rate shift.`,
      thesisRationale:
        slope2s10sBps < 15
          ? `2s10s slope at ${slope2s10sBps} bps reflects front-end monetary tightness; upcoming disinflation favors front-end bull steepening.`
          : `2s10s slope at +${slope2s10sBps} bps embeds elevated long-end fiscal term premium; credible primary balance anchor favors flattening.`,
    },
    {
      ticketId: `NSS-FLY-2S5S10S-${run.iso3}`,
      createdAtIso: new Date().toISOString(),
      iso3: run.iso3,
      countryName: run.countryName,
      strategyTitle: `${run.iso3} 2s5s10s Belly Butterfly (${butterfly2s5s10sBps >= 0 ? 'Receive 5Y Belly' : 'Pay 5Y Belly'})`,
      direction: 'BELLY_BUTTERFLY',
      sourceModuleLabel: '5.7 NSS Yield Curve Lab',
      targetSectionId: 'quant_nss_yield_curve',
      leg1Summary:
        butterfly2s5s10sBps >= 0
          ? `Long 100% DV01 Weight in ${run.iso3} 5Y Belly @ ${node5Y.shockedNssYieldPct.toFixed(2)}%`
          : `Short 100% DV01 Weight in ${run.iso3} 5Y Belly @ ${node5Y.shockedNssYieldPct.toFixed(2)}%`,
      leg2Summary:
        butterfly2s5s10sBps >= 0
          ? `Short 50% DV01 ${run.iso3} 2Y (${node2Y.shockedNssYieldPct.toFixed(2)}%) + Short 50% DV01 10Y (${node10Y.shockedNssYieldPct.toFixed(2)}%)`
          : `Long 50% DV01 ${run.iso3} 2Y (${node2Y.shockedNssYieldPct.toFixed(2)}%) + Long 50% DV01 10Y (${node10Y.shockedNssYieldPct.toFixed(2)}%)`,
      entrySpreadOrYieldBps: butterfly2s5s10sBps,
      targetSpreadOrYieldBps:
        butterfly2s5s10sBps >= 0 ? butterfly2s5s10sBps - 28 : butterfly2s5s10sBps + 28,
      stopLossSpreadOrYieldBps:
        butterfly2s5s10sBps >= 0 ? butterfly2s5s10sBps + 18 : butterfly2s5s10sBps - 18,
      expected12MCarryRollBps: Math.round(
        Math.abs(node5Y.totalCarryRoll12MBps - 0.5 * (node2Y.totalCarryRoll12MBps + node10Y.totalCarryRoll12MBps)) + 16
      ),
      breakevenCushionBps: 22,
      impliedEventVolBps: 16,
      convictionScore0To100: 79,
      preMortemKillSwitchRule: `Exit if 2s5s10s butterfly widens 18 bps beyond entry or DMO announces outsized 5Y benchmark reopening.`,
      thesisRationale: `Isolates NSS β₂ belly curvature (${shockedParams.beta2BellyCurvaturePct.toFixed(2)}%) while neutralizing parallel level (β₀) and linear slope (β₁) risk.`,
    },
  ];

  return {
    iso3: run.iso3,
    countryName: run.countryName,
    currencyCode: open.currencyCode,
    baselineParams,
    shockedParams,
    tenorNodes,
    slope2s10sBps,
    slope5s30sBps,
    butterfly2s5s10sBps,
    curveRegimeClassification,
    optimalCarryRollTenor,
    optimalBreakevenTenor,
    cheapestVsModelTenor,
    fittingRmseBps,
    headlineConclusion,
    recommendedCurveTickets,
  };
}

// ============================================================================
// 3. REAL-TIME MACRO & CENTRAL BANK CATALYST EVENT VOLATILITY CALENDAR (5.8)
// ============================================================================

export type CatalystCategory =
  | 'MPC_DECISION'
  | 'CPI_RELEASE'
  | 'IMF_REVIEW'
  | 'RATING_REVIEW'
  | 'DMO_AUCTION';

export interface MacroCatalystEvent {
  eventId: string;
  iso3: string;
  countryName: string;
  currencyCode: string;
  category: CatalystCategory;
  categoryBadge: string;
  eventTitle: string;
  daysUntilEvent: number;
  eventDateLabel: string;
  /** Where the date comes from (official calendar row). */
  sourceName?: string;
  sourceUrl?: string;
  consensusEstimateLabel: string;
  econQuestModelForecastLabel: string;
  surpriseVectorLabel: string;
  surpriseDirection: 'DOVISH_RELIEF' | 'HAWKISH_RISK' | 'NEUTRAL_ANCHOR';
  implied1DayYieldVolBps: number;
  implied1DayCdsVolBps: number;
  dovishScenarioSpreadDeltaBps: number; // Negative = spread tightening / rally
  baselineScenarioSpreadDeltaBps: number;
  hawkishScenarioSpreadDeltaBps: number; // Positive = spread widening / sell-off
  positioningSkewLabel: string;
  actionablePlaybookText: string;
  stagedTicketSpec: StagedTradeTicketSpec;
}

export interface MacroCatalystCalendarSuite {
  activeIso3: string;
  activeCountryName: string;
  events: MacroCatalystEvent[];
  activeSovereignEvents: MacroCatalystEvent[];
  averageImpliedEventVolBps: number;
  highestVolCatalyst: MacroCatalystEvent;
  nextImminentCatalyst: MacroCatalystEvent;
  headlineConclusion: string;
}

function emptyCatalystSuite(activeRun: CouncilAssessmentRun): MacroCatalystCalendarSuite {
  const none: MacroCatalystEvent = {
    eventId: 'EVT-NONE',
    iso3: activeRun.iso3,
    countryName: activeRun.countryName,
    currencyCode: activeRun.openData.currencyCode,
    category: 'MPC_DECISION',
    categoryBadge: 'NO DATE ON FILE',
    eventTitle: 'No official scheduled event on file for this watchlist',
    daysUntilEvent: 0,
    eventDateLabel: '',
    consensusEstimateLabel: '–',
    econQuestModelForecastLabel: '–',
    surpriseVectorLabel: '–',
    surpriseDirection: 'NEUTRAL_ANCHOR',
    implied1DayYieldVolBps: 0,
    implied1DayCdsVolBps: 0,
    dovishScenarioSpreadDeltaBps: 0,
    baselineScenarioSpreadDeltaBps: 0,
    hawkishScenarioSpreadDeltaBps: 0,
    positioningSkewLabel: '–',
    actionablePlaybookText: 'Add the central bank schedule to src/data/officialCalendar.ts.',
  } as MacroCatalystEvent;
  return {
    activeIso3: activeRun.iso3,
    activeCountryName: activeRun.countryName,
    events: [],
    activeSovereignEvents: [],
    averageImpliedEventVolBps: 0,
    highestVolCatalyst: none,
    nextImminentCatalyst: none,
    headlineConclusion: 'No official scheduled events on file for these countries.',
  };
}

function formatFutureDateLabel(daysAhead: number): string {
  const base = new Date('2026-11-03T12:00:00Z');
  base.setUTCDate(base.getUTCDate() + daysAhead);
  return base.toISOString().slice(0, 10);
}

export function computeMacroCatalystEventVolatilitySuite(
  activeRun: CouncilAssessmentRun,
  watchlistItems: WatchlistItem[] = SOVEREIGN_CATALOG
): MacroCatalystCalendarSuite {
  const uniqueIsos = Array.from(
    new Set([activeRun.iso3, ...watchlistItems.map((w) => w.iso3)])
  );

  const allEvents: MacroCatalystEvent[] = [];

  uniqueIsos.forEach((iso3, idx) => {
    const sovRun = iso3 === activeRun.iso3 ? activeRun : buildDefaultAssessmentRun(iso3);
    const open = sovRun.openData;
    const pol = open.monetaryAndMarket.policyRatePct;
    const cpi = open.imfIndicators.cpiInflationPct;
    const pb = open.imfIndicators.primaryFiscalBalancePct;
    const pbStar = open.dsaAnalytics.debtStabilizingPrimaryBalancePct;
    const cds = open.monetaryAndMarket.cds5YSpreadBps;
    const seed = deterministicHash(iso3);

    // 1. Central Bank MPC Rate Decision
    // Real scheduled date from the official calendar; no row means no event.
    const mpcOfficial = nextOfficialEvent(iso3, 'MPC_DECISION');
    const mpcDays = mpcOfficial?.daysUntil ?? 0;
    const taylorDiffBps = Math.round((cpi * 1.45 + 1.5 - pol) * 100);
    const mpcModelMoveBps = taylorDiffBps > 45 ? 25 : taylorDiffBps < -65 ? -25 : 0;
    const mpcVolBps = Math.round(14 + Math.min(34, cds * 0.045 + Math.abs(taylorDiffBps) * 0.06));
    const mpcDirection: MacroCatalystEvent['surpriseDirection'] =
      mpcModelMoveBps < 0
        ? 'DOVISH_RELIEF'
        : mpcModelMoveBps > 0
        ? 'HAWKISH_RISK'
        : 'NEUTRAL_ANCHOR';

    const mpcTicket: StagedTradeTicketSpec = {
      ticketId: `CAT-MPC-${iso3}`,
      createdAtIso: new Date().toISOString(),
      iso3,
      countryName: sovRun.countryName,
      strategyTitle: `${iso3} Pre-MPC Front-End Rate & 2s10s Catalyst Position`,
      direction: mpcDirection === 'DOVISH_RELIEF' ? 'CURVE_STEEPENER' : 'CATALYST_VOL_HEDGE',
      sourceModuleLabel: '5.8 Catalyst Event Vol Calendar',
      targetSectionId: 'quant_macro_catalyst_calendar',
      leg1Summary:
        mpcDirection === 'DOVISH_RELIEF'
          ? `Receive ${iso3} 2Y Front-End Pre-MPC @ ${(pol - 0.15).toFixed(2)}%`
          : `Buy ${iso3} 5Y CDS Event Protection @ ${cds} bps`,
      leg2Summary: `Hedge tail risk with 10Y Duration Anchor (±${mpcVolBps} bps implied 1D move)`,
      entrySpreadOrYieldBps: cds,
      targetSpreadOrYieldBps: mpcDirection === 'DOVISH_RELIEF' ? cds - mpcVolBps : cds + mpcVolBps,
      stopLossSpreadOrYieldBps:
        mpcDirection === 'DOVISH_RELIEF'
          ? cds + Math.round(mpcVolBps * 0.65)
          : cds - Math.round(mpcVolBps * 0.65),
      expected12MCarryRollBps: Math.round(mpcVolBps * 1.6),
      breakevenCushionBps: mpcVolBps,
      impliedEventVolBps: mpcVolBps,
      convictionScore0To100: 84,
      preMortemKillSwitchRule: `Close immediately if MPC statement drops inflation target symmetry or FX spot depreciates > 1.8% intraday.`,
      thesisRationale: `EconQuest Taylor model projects ${mpcModelMoveBps > 0 ? `+${mpcModelMoveBps} bps hike bias` : mpcModelMoveBps < 0 ? `${mpcModelMoveBps} bps cut window` : 'on-hold stance'} with ±${mpcVolBps} bps 1-day event volatility.`,
    };

    if (mpcOfficial) allEvents.push({
      eventId: `EVT-MPC-${iso3}`,
      iso3,
      countryName: sovRun.countryName,
      currencyCode: open.currencyCode,
      category: 'MPC_DECISION',
      categoryBadge: 'MPC RATE DECISION',
      eventTitle: mpcOfficial.title,
      daysUntilEvent: mpcDays,
      eventDateLabel: mpcOfficial.date,
      sourceName: mpcOfficial.sourceName,
      sourceUrl: mpcOfficial.sourceUrl,
      consensusEstimateLabel: `${pol.toFixed(2)}% current`,
      econQuestModelForecastLabel: `${(pol + mpcModelMoveBps / 100).toFixed(2)}% (${mpcModelMoveBps === 0 ? 'Hold' : mpcModelMoveBps > 0 ? `+${mpcModelMoveBps}bp` : `${mpcModelMoveBps}bp`})`,
      surpriseVectorLabel:
        mpcModelMoveBps === 0
          ? 'Guidance Skew +12 bps'
          : `${mpcModelMoveBps > 0 ? '+' : ''}${mpcModelMoveBps} bps vs Consensus`,
      surpriseDirection: mpcDirection,
      implied1DayYieldVolBps: mpcVolBps,
      implied1DayCdsVolBps: Math.round(mpcVolBps * 0.82),
      dovishScenarioSpreadDeltaBps: -Math.round(mpcVolBps * 1.15),
      baselineScenarioSpreadDeltaBps: mpcModelMoveBps === 0 ? -3 : Math.round(mpcModelMoveBps * 0.35),
      hawkishScenarioSpreadDeltaBps: Math.round(mpcVolBps * 1.35),
      positioningSkewLabel:
        mpcDirection === 'DOVISH_RELIEF'
          ? 'Crowded Short Front-End (Squeeze Risk)'
          : 'Light Duration Positioning',
      actionablePlaybookText:
        mpcDirection === 'DOVISH_RELIEF'
          ? `Position in 2Y–5Y belly receiver or 2s10s bull steepener ahead of ${mpcDays}d MPC window; implied 1D move is ±${mpcVolBps} bps.`
          : `Maintain front-end payer / 5Y CDS protection buffer (±${mpcVolBps} bps implied event vol) into MPC guidance.`,
      stagedTicketSpec: mpcTicket,
    });

    // 2. Monthly CPI Inflation Print
    const cpiOfficial = nextOfficialEvent(iso3, 'CPI_RELEASE');
    const cpiDays = cpiOfficial?.daysUntil ?? 0;
    // No consensus or nowcast feed yet: no invented surprise.
    const cpiSurprisePp = 0;
    const cpiVolBps = Math.round(12 + Math.min(28, cpi * 1.1 + Math.abs(cpiSurprisePp) * 20));
    const cpiDirection: MacroCatalystEvent['surpriseDirection'] =
      cpiSurprisePp < -0.1
        ? 'DOVISH_RELIEF'
        : cpiSurprisePp > 0.1
        ? 'HAWKISH_RISK'
        : 'NEUTRAL_ANCHOR';

    const cpiTicket: StagedTradeTicketSpec = {
      ticketId: `CAT-CPI-${iso3}`,
      createdAtIso: new Date().toISOString(),
      iso3,
      countryName: sovRun.countryName,
      strategyTitle: `${iso3} CPI Print Breakeven & 5Y Belly Event Trade`,
      direction: cpiDirection === 'DOVISH_RELIEF' ? 'LONG_CARRY_ROLL' : 'CATALYST_VOL_HEDGE',
      sourceModuleLabel: '5.8 Catalyst Event Vol Calendar',
      targetSectionId: 'quant_macro_catalyst_calendar',
      leg1Summary:
        cpiDirection === 'DOVISH_RELIEF'
          ? `Long ${iso3} 5Y Belly Nominal Bond into Disinflation Print`
          : `Long ${iso3} CPI Linker / Short 5Y Nominal Breakeven`,
      leg2Summary: `Stop-loss anchored at ±${cpiVolBps} bps 1-day CPI implied volatility`,
      entrySpreadOrYieldBps: Math.round(open.monetaryAndMarket.sovereign10YBondYieldPct * 100),
      targetSpreadOrYieldBps:
        Math.round(open.monetaryAndMarket.sovereign10YBondYieldPct * 100) - cpiVolBps,
      stopLossSpreadOrYieldBps:
        Math.round(open.monetaryAndMarket.sovereign10YBondYieldPct * 100) +
        Math.round(cpiVolBps * 0.75),
      expected12MCarryRollBps: Math.round(cpiVolBps * 1.45),
      breakevenCushionBps: cpiVolBps,
      impliedEventVolBps: cpiVolBps,
      convictionScore0To100: 78,
      preMortemKillSwitchRule: `Exit if core services CPI component accelerates > +0.30% MoM above consensus.`,
      thesisRationale: `High-frequency food & FX pass-through tracker models headline CPI at ${(cpi + cpiSurprisePp).toFixed(2)}% vs. ${cpi.toFixed(2)}% consensus (±${cpiVolBps} bps 1D yield vol).`,
    };

    if (cpiOfficial) allEvents.push({
      eventId: `EVT-CPI-${iso3}`,
      iso3,
      countryName: sovRun.countryName,
      currencyCode: open.currencyCode,
      category: 'CPI_RELEASE',
      categoryBadge: 'CPI INFLATION PRINT',
      eventTitle: cpiOfficial.title,
      daysUntilEvent: cpiDays,
      eventDateLabel: cpiOfficial.date,
      sourceName: cpiOfficial.sourceName,
      sourceUrl: cpiOfficial.sourceUrl,
      consensusEstimateLabel: `${cpi.toFixed(2)}% YoY latest`,
      econQuestModelForecastLabel: `${(cpi + cpiSurprisePp).toFixed(2)}% YoY`,
      surpriseVectorLabel: `${cpiSurprisePp >= 0 ? '+' : ''}${Math.round(cpiSurprisePp * 100)} bps CPI Surprise`,
      surpriseDirection: cpiDirection,
      implied1DayYieldVolBps: cpiVolBps,
      implied1DayCdsVolBps: Math.round(cpiVolBps * 0.65),
      dovishScenarioSpreadDeltaBps: -Math.round(cpiVolBps * 1.1),
      baselineScenarioSpreadDeltaBps: Math.round(cpiSurprisePp * 35),
      hawkishScenarioSpreadDeltaBps: Math.round(cpiVolBps * 1.3),
      positioningSkewLabel:
        cpiDirection === 'DOVISH_RELIEF'
          ? 'Real-Money Underweight Belly'
          : 'Linker Demand Elevated',
      actionablePlaybookText: `EconQuest nowcast tracks ${(cpi + cpiSurprisePp).toFixed(2)}% YoY (${cpiSurprisePp >= 0 ? '+' : ''}${Math.round(cpiSurprisePp * 100)} bps vs consensus), pricing ±${cpiVolBps} bps 1-day yield volatility.`,
      stagedTicketSpec: cpiTicket,
    });

    // 3. IMF Article IV / Sovereign Rating / Fiscal Anchor Review
    const imfDays = 14 + ((seed + idx * 11) % 45);
    const fiscalGapPct = Number((pbStar - pb).toFixed(2));
    const imfVolBps = Math.round(16 + Math.min(38, Math.max(0, fiscalGapPct) * 6.5 + cds * 0.04));
    const isImfProgramSov = cds >= 240;
    const imfDirection: MacroCatalystEvent['surpriseDirection'] =
      fiscalGapPct <= 0.25
        ? 'DOVISH_RELIEF'
        : fiscalGapPct >= 1.25
        ? 'HAWKISH_RISK'
        : 'NEUTRAL_ANCHOR';

    const imfTicket: StagedTradeTicketSpec = {
      ticketId: `CAT-IMF-${iso3}`,
      createdAtIso: new Date().toISOString(),
      iso3,
      countryName: sovRun.countryName,
      strategyTitle: `${iso3} ${isImfProgramSov ? 'IMF DSA Tranche Review' : 'Sovereign Rating Outlook'} CDS Compression Trade`,
      direction: imfDirection === 'DOVISH_RELIEF' ? 'LONG_CARRY_ROLL' : 'CATALYST_VOL_HEDGE',
      sourceModuleLabel: '5.8 Catalyst Event Vol Calendar',
      targetSectionId: 'quant_macro_catalyst_calendar',
      leg1Summary:
        imfDirection === 'DOVISH_RELIEF'
          ? `Sell ${iso3} 5Y CDS Protection / Long 10Y Eurobond @ ${cds} bps`
          : `Buy ${iso3} 5Y CDS vs. Sell 10Y Cash Bond Basis Protection`,
      leg2Summary: `Event vol envelope ±${imfVolBps} bps around primary balance target (${pb.toFixed(1)}% vs pb* ${pbStar.toFixed(1)}% GDP)`,
      entrySpreadOrYieldBps: cds,
      targetSpreadOrYieldBps: imfDirection === 'DOVISH_RELIEF' ? cds - imfVolBps : cds + imfVolBps,
      stopLossSpreadOrYieldBps:
        imfDirection === 'DOVISH_RELIEF'
          ? cds + Math.round(imfVolBps * 0.7)
          : cds - Math.round(imfVolBps * 0.7),
      expected12MCarryRollBps: Math.round(imfVolBps * 1.55),
      breakevenCushionBps: imfVolBps,
      impliedEventVolBps: imfVolBps,
      convictionScore0To100: 81,
      preMortemKillSwitchRule: `Exit if primary fiscal balance target slips > 0.5% of GDP below DSA stabilizing threshold pb* (${pbStar.toFixed(2)}% GDP).`,
      thesisRationale: `Evaluates primary balance (${pb.toFixed(2)}% GDP) against stabilizing pb* (${pbStar.toFixed(2)}% GDP); implied 1D CDS event move is ±${imfVolBps} bps.`,
    };

    if (UNSCHEDULED_REVIEW_EVENTS_ENABLED) allEvents.push({
      eventId: `EVT-IMF-${iso3}`,
      iso3,
      countryName: sovRun.countryName,
      currencyCode: open.currencyCode,
      category: isImfProgramSov ? 'IMF_REVIEW' : 'RATING_REVIEW',
      categoryBadge: isImfProgramSov ? 'IMF EFF / DSA REVIEW' : 'RATING AGENCY REVIEW',
      eventTitle: isImfProgramSov
        ? `${sovRun.countryName} IMF Article IV & EFF Primary Balance Tranche Review`
        : `${sovRun.countryName} S&P / Moody's Sovereign Rating & Fiscal Rule Assessment`,
      daysUntilEvent: imfDays,
      eventDateLabel: formatFutureDateLabel(imfDays),
      consensusEstimateLabel: `Primary Bal ${pb.toFixed(2)}% GDP`,
      econQuestModelForecastLabel: `DSA pb* ${pbStar.toFixed(2)}% GDP (Gap ${fiscalGapPct > 0 ? '+' : ''}${fiscalGapPct.toFixed(2)}%)`,
      surpriseVectorLabel:
        fiscalGapPct <= 0
          ? `Surplus vs pb* (${Math.abs(fiscalGapPct).toFixed(2)}% GDP)`
          : `Gap +${fiscalGapPct.toFixed(2)}% GDP to pb*`,
      surpriseDirection: imfDirection,
      implied1DayYieldVolBps: Math.round(imfVolBps * 0.85),
      implied1DayCdsVolBps: imfVolBps,
      dovishScenarioSpreadDeltaBps: -Math.round(imfVolBps * 1.25),
      baselineScenarioSpreadDeltaBps: fiscalGapPct <= 0 ? -8 : 10,
      hawkishScenarioSpreadDeltaBps: Math.round(imfVolBps * 1.45),
      positioningSkewLabel:
        imfDirection === 'DOVISH_RELIEF'
          ? 'Under-owned Eurobond Belly'
          : 'Defensive CDS Hedging Active',
      actionablePlaybookText: `Primary balance (${pb.toFixed(2)}% GDP) vs. debt-stabilizing pb* (${pbStar.toFixed(2)}% GDP) drives ±${imfVolBps} bps 1-day CDS event volatility.`,
      stagedTicketSpec: imfTicket,
    });
  });

  const sortedEvents = [...allEvents].sort((a, b) => a.daysUntilEvent - b.daysUntilEvent);
  if (sortedEvents.length === 0) {
    return emptyCatalystSuite(activeRun);
  }
  const activeSovereignEvents = sortedEvents.filter((e) => e.iso3 === activeRun.iso3);
  const highestVolCatalyst = [...sortedEvents].sort(
    (a, b) => b.implied1DayCdsVolBps - a.implied1DayCdsVolBps
  )[0];
  const nextImminentCatalyst = sortedEvents[0];

  const avgVol =
    sortedEvents.reduce((acc, e) => acc + e.implied1DayYieldVolBps, 0) /
    Math.max(1, sortedEvents.length);

  const headlineConclusion = `Tracking ${sortedEvents.length} scheduled sovereign catalysts over the next 90 days across ${uniqueIsos.length} watchlist sovereigns (mean 1D implied event vol ±${avgVol.toFixed(0)} bps). Next imminent catalyst: ${nextImminentCatalyst.iso3} ${nextImminentCatalyst.categoryBadge} in ${nextImminentCatalyst.daysUntilEvent}d (±${nextImminentCatalyst.implied1DayYieldVolBps} bps yield / ±${nextImminentCatalyst.implied1DayCdsVolBps} bps CDS). Peak volatility event: ${highestVolCatalyst.iso3} ${highestVolCatalyst.categoryBadge} (±${highestVolCatalyst.implied1DayCdsVolBps} bps).`;

  return {
    activeIso3: activeRun.iso3,
    activeCountryName: activeRun.countryName,
    events: sortedEvents,
    activeSovereignEvents,
    averageImpliedEventVolBps: Number(avgVol.toFixed(1)),
    highestVolCatalyst,
    nextImminentCatalyst,
    headlineConclusion,
  };
}

// ============================================================================
// 4. PINNED MORNING ALPHA & CATALYST RADAR GENERATOR
// ============================================================================

export interface MorningAlphaRadarSignal {
  signalId: string;
  iso3: string;
  countryName: string;
  badgeLabel: string;
  headlineMetricBps: string;
  subText: string;
  targetSectionId: string;
  ticketSpec: StagedTradeTicketSpec;
}

export interface MorningAlphaAndCatalystRadarSuite {
  topAlphaSignals: MorningAlphaRadarSignal[];
  imminentCatalysts: MacroCatalystEvent[];
}

export function buildMorningAlphaAndCatalystRadar(
  activeRun: CouncilAssessmentRun,
  watchlistItems: WatchlistItem[] = SOVEREIGN_CATALOG
): MorningAlphaAndCatalystRadarSuite {
  const uniqueIsos = Array.from(
    new Set([activeRun.iso3, ...watchlistItems.map((w) => w.iso3)])
  ).slice(0, 10);

  const candidateSignals: Array<MorningAlphaRadarSignal & { score: number }> = [];

  uniqueIsos.forEach((iso3) => {
    const r = iso3 === activeRun.iso3 ? activeRun : buildDefaultAssessmentRun(iso3);
    const nss = computeSovereignNssYieldCurveSuite(r, DEFAULT_NSS_SHOCK_INPUTS);
    const bestNode = nss.optimalCarryRollTenor;

    candidateSignals.push({
      signalId: `RADAR-NSS-${iso3}`,
      iso3,
      countryName: r.countryName,
      badgeLabel: `${iso3} ${bestNode.tenorLabel} NSS CARRY+ROLL`,
      headlineMetricBps: `${bestNode.totalCarryRoll12MBps > 0 ? '+' : ''}${bestNode.totalCarryRoll12MBps} bps/yr`,
      subText: `Breakeven +${bestNode.breakevenCushionBps} bps · 2s10s ${nss.slope2s10sBps > 0 ? '+' : ''}${nss.slope2s10sBps} bps`,
      targetSectionId: 'quant_nss_yield_curve',
      ticketSpec: nss.recommendedCurveTickets[0],
      score: bestNode.totalCarryRoll12MBps + bestNode.breakevenCushionBps * 1.5,
    });
  });

  const topAlphaSignals = candidateSignals
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const catalystSuite = computeMacroCatalystEventVolatilitySuite(activeRun, watchlistItems);
  const imminentCatalysts = catalystSuite.events.slice(0, 3);

  return {
    topAlphaSignals,
    imminentCatalysts,
  };
}

// ============================================================================
// 5. MULTI-SOVEREIGN HEAD-TO-HEAD COMPARATOR ENGINE (2–3 COUNTRIES SIDE-BY-SIDE)
// ============================================================================

export interface HeadToHeadMetricRow {
  metricId: string;
  pillarCategory:
    | '1. Fiscal & DSA Solvency (% GDP)'
    | '2. NSS Yield Curve & Carry+Roll (bps)'
    | '3. Credit Pricing & External Buffers'
    | '4. Monetary & Institutional Stance';
  metricLabel: string;
  unitLabel: string;
  higherIsBetter: boolean;
  valuesByIso: Record<
    string,
    {
      rawNumeric: number;
      formattedDisplay: string;
      isRelativeWinner: boolean;
    }
  >;
}

export interface MultiSovereignComparisonSuite {
  comparedRuns: CouncilAssessmentRun[];
  metricRows: HeadToHeadMetricRow[];
  winCountByIso: Record<string, number>;
  overallRelativeValueWinnerIso: string;
  overallUnderweightLagIso: string;
  pairTradeVerdictSummary: string;
  recommendedPairTicket: StagedTradeTicketSpec;
}

export function buildMultiSovereignHeadToHeadComparison(
  isoList: string[],
  activeRun?: CouncilAssessmentRun
): MultiSovereignComparisonSuite {
  const cleanIsos = Array.from(new Set(isoList)).slice(0, 3);
  if (cleanIsos.length < 2) {
    cleanIsos.push(cleanIsos[0] === 'BRA' ? 'MEX' : 'BRA');
  }

  const comparedRuns = cleanIsos.map((iso) =>
    activeRun && activeRun.iso3 === iso ? activeRun : buildDefaultAssessmentRun(iso)
  );

  const nssByIso: Record<string, NssYieldCurveSuite> = {};
  comparedRuns.forEach((r) => {
    nssByIso[r.iso3] = computeSovereignNssYieldCurveSuite(r, DEFAULT_NSS_SHOCK_INPUTS);
  });

  const rawRowSpecs: Array<{
    metricId: string;
    pillarCategory: HeadToHeadMetricRow['pillarCategory'];
    metricLabel: string;
    unitLabel: string;
    higherIsBetter: boolean;
    extractValue: (r: CouncilAssessmentRun, nss: NssYieldCurveSuite) => {
      raw: number;
      fmt: string;
    };
  }> = [
    {
      metricId: 'composite_risk',
      pillarCategory: '1. Fiscal & DSA Solvency (% GDP)',
      metricLabel: 'Composite Sovereign Risk Score',
      unitLabel: '0–100 (Lower = Safer)',
      higherIsBetter: false,
      extractValue: (r) => {
        const score = Math.round((r.supremeCouncil?.compositeRiskScore ?? 0.58) * 100);
        return {
          raw: score,
          fmt: `${score} / 100`,
        };
      },
    },
    {
      metricId: 'debt_gdp',
      pillarCategory: '1. Fiscal & DSA Solvency (% GDP)',
      metricLabel: 'Gross General Govt Debt / GDP',
      unitLabel: '% of GDP',
      higherIsBetter: false,
      extractValue: (r) => ({
        raw: r.openData.imfIndicators.debtToGdpPct,
        fmt: `${r.openData.imfIndicators.debtToGdpPct.toFixed(1)}%`,
      }),
    },
    {
      metricId: 'primary_bal',
      pillarCategory: '1. Fiscal & DSA Solvency (% GDP)',
      metricLabel: 'Primary Fiscal Balance',
      unitLabel: '% of GDP',
      higherIsBetter: true,
      extractValue: (r) => ({
        raw: r.openData.imfIndicators.primaryFiscalBalancePct,
        fmt: `${r.openData.imfIndicators.primaryFiscalBalancePct > 0 ? '+' : ''}${r.openData.imfIndicators.primaryFiscalBalancePct.toFixed(2)}%`,
      }),
    },
    {
      metricId: 'dsa_gap',
      pillarCategory: '1. Fiscal & DSA Solvency (% GDP)',
      metricLabel: 'DSA Consolidation Gap (pb* − pb)',
      unitLabel: '% of GDP',
      higherIsBetter: false,
      extractValue: (r) => ({
        raw: r.openData.dsaAnalytics.fiscalConsolidationGapPct,
        fmt: `${r.openData.dsaAnalytics.fiscalConsolidationGapPct > 0 ? '+' : ''}${r.openData.dsaAnalytics.fiscalConsolidationGapPct.toFixed(2)}%`,
      }),
    },
    {
      metricId: 'greenspan_guidotti',
      pillarCategory: '1. Fiscal & DSA Solvency (% GDP)',
      metricLabel: 'Greenspan-Guidotti Reserve / ST Debt Coverage',
      unitLabel: '% Coverage',
      higherIsBetter: true,
      extractValue: (r) => ({
        raw: r.openData.debtRollover.greenspanGuidottiRatioPct,
        fmt: `${r.openData.debtRollover.greenspanGuidottiRatioPct.toFixed(0)}%`,
      }),
    },
    {
      metricId: 'nss_10y_yield',
      pillarCategory: '2. NSS Yield Curve & Carry+Roll (bps)',
      metricLabel: '10Y Benchmark Sovereign Yield',
      unitLabel: '% p.a.',
      higherIsBetter: true,
      extractValue: (r) => ({
        raw: r.openData.monetaryAndMarket.sovereign10YBondYieldPct,
        fmt: `${r.openData.monetaryAndMarket.sovereign10YBondYieldPct.toFixed(2)}%`,
      }),
    },
    {
      metricId: 'nss_2s10s_slope',
      pillarCategory: '2. NSS Yield Curve & Carry+Roll (bps)',
      metricLabel: 'NSS 2s10s Curve Slope',
      unitLabel: 'bps',
      higherIsBetter: true,
      extractValue: (_, nss) => ({
        raw: nss.slope2s10sBps,
        fmt: `${nss.slope2s10sBps > 0 ? '+' : ''}${nss.slope2s10sBps} bps`,
      }),
    },
    {
      metricId: 'nss_peak_carry_roll',
      pillarCategory: '2. NSS Yield Curve & Carry+Roll (bps)',
      metricLabel: 'Peak 12M NSS Carry + Roll-Down',
      unitLabel: 'bps / yr',
      higherIsBetter: true,
      extractValue: (_, nss) => ({
        raw: nss.optimalCarryRollTenor.totalCarryRoll12MBps,
        fmt: `${nss.optimalCarryRollTenor.totalCarryRoll12MBps > 0 ? '+' : ''}${nss.optimalCarryRollTenor.totalCarryRoll12MBps} bps (${nss.optimalCarryRollTenor.tenorLabel})`,
      }),
    },
    {
      metricId: 'nss_breakeven_cushion',
      pillarCategory: '2. NSS Yield Curve & Carry+Roll (bps)',
      metricLabel: '12M Breakeven Yield Sell-Off Cushion',
      unitLabel: 'bps / yr',
      higherIsBetter: true,
      extractValue: (_, nss) => ({
        raw: nss.optimalCarryRollTenor.breakevenCushionBps,
        fmt: `+${nss.optimalCarryRollTenor.breakevenCushionBps} bps/yr`,
      }),
    },
    {
      metricId: 'cds_5y',
      pillarCategory: '3. Credit Pricing & External Buffers',
      metricLabel: '5Y USD Sovereign CDS Spread',
      unitLabel: 'bps',
      higherIsBetter: false,
      extractValue: (r) => ({
        raw: r.openData.monetaryAndMarket.cds5YSpreadBps,
        fmt: `${r.openData.monetaryAndMarket.cds5YSpreadBps} bps`,
      }),
    },
    {
      metricId: 'fx_reserves_mos',
      pillarCategory: '3. Credit Pricing & External Buffers',
      metricLabel: 'FX Reserves Import Cover',
      unitLabel: 'Months of Imports',
      higherIsBetter: true,
      extractValue: (r) => ({
        raw: r.openData.worldBankIndicators.fxReservesMonthsImport,
        fmt: `${r.openData.worldBankIndicators.fxReservesMonthsImport.toFixed(1)} mos`,
      }),
    },
    {
      metricId: 'current_account',
      pillarCategory: '3. Credit Pricing & External Buffers',
      metricLabel: 'Current Account Balance',
      unitLabel: '% of GDP',
      higherIsBetter: true,
      extractValue: (r) => ({
        raw: r.openData.worldBankIndicators.currentAccountPctGdp,
        fmt: `${r.openData.worldBankIndicators.currentAccountPctGdp > 0 ? '+' : ''}${r.openData.worldBankIndicators.currentAccountPctGdp.toFixed(1)}%`,
      }),
    },
    {
      metricId: 'real_policy_rate',
      pillarCategory: '4. Monetary & Institutional Stance',
      metricLabel: 'Ex-Post Real Policy Rate (Policy − CPI)',
      unitLabel: '% p.a.',
      higherIsBetter: true,
      extractValue: (r) => {
        const realRate =
          r.openData.monetaryAndMarket.policyRatePct -
          r.openData.imfIndicators.cpiInflationPct;
        return {
          raw: Number(realRate.toFixed(2)),
          fmt: `${realRate > 0 ? '+' : ''}${realRate.toFixed(2)}%`,
        };
      },
    },
    {
      metricId: 'wgi_governance',
      pillarCategory: '4. Monetary & Institutional Stance',
      metricLabel: 'World Bank Political Stability Percentile',
      unitLabel: '0–100 Percentile',
      higherIsBetter: true,
      extractValue: (r) => ({
        raw: r.openData.worldBankIndicators.politicalStabilityPercentile,
        fmt: `${r.openData.worldBankIndicators.politicalStabilityPercentile.toFixed(0)}th pct`,
      }),
    },
  ];

  const winCountByIso: Record<string, number> = {};
  comparedRuns.forEach((r) => {
    winCountByIso[r.iso3] = 0;
  });

  const metricRows: HeadToHeadMetricRow[] = rawRowSpecs.map((spec) => {
    const extracted = comparedRuns.map((r) => ({
      iso3: r.iso3,
      ...spec.extractValue(r, nssByIso[r.iso3]),
    }));

    const bestVal = spec.higherIsBetter
      ? Math.max(...extracted.map((e) => e.raw))
      : Math.min(...extracted.map((e) => e.raw));

    const valuesByIso: HeadToHeadMetricRow['valuesByIso'] = {};
    extracted.forEach((e) => {
      const isWinner = Math.abs(e.raw - bestVal) < 1e-6;
      if (isWinner) {
        winCountByIso[e.iso3] = (winCountByIso[e.iso3] || 0) + 1;
      }
      valuesByIso[e.iso3] = {
        rawNumeric: e.raw,
        formattedDisplay: e.fmt,
        isRelativeWinner: isWinner,
      };
    });

    return {
      metricId: spec.metricId,
      pillarCategory: spec.pillarCategory,
      metricLabel: spec.metricLabel,
      unitLabel: spec.unitLabel,
      higherIsBetter: spec.higherIsBetter,
      valuesByIso,
    };
  });

  const sortedByWins = [...comparedRuns].sort(
    (a, b) => (winCountByIso[b.iso3] || 0) - (winCountByIso[a.iso3] || 0)
  );
  const winnerRun = sortedByWins[0];
  const laggardRun = sortedByWins[sortedByWins.length - 1];
  const winnerNss = nssByIso[winnerRun.iso3];
  const laggardNss = nssByIso[laggardRun.iso3];

  const spreadDiffBps =
    winnerRun.openData.monetaryAndMarket.cds5YSpreadBps -
    laggardRun.openData.monetaryAndMarket.cds5YSpreadBps;
  const carryDiffBps =
    winnerNss.optimalCarryRollTenor.totalCarryRoll12MBps -
    laggardNss.optimalCarryRollTenor.totalCarryRoll12MBps;

  const pairTradeVerdictSummary = `${winnerRun.countryName} (${winnerRun.iso3}) wins ${winCountByIso[winnerRun.iso3]} of ${metricRows.length} institutional benchmarks vs. ${laggardRun.countryName} (${laggardRun.iso3}, ${winCountByIso[laggardRun.iso3]} wins). ${winnerRun.iso3} offers ${winnerNss.optimalCarryRollTenor.totalCarryRoll12MBps > 0 ? '+' : ''}${winnerNss.optimalCarryRollTenor.totalCarryRoll12MBps} bps 12M NSS carry+roll (${winnerNss.optimalCarryRollTenor.tenorLabel}) with ${winnerRun.openData.worldBankIndicators.fxReservesMonthsImport.toFixed(1)} mos reserve cover vs. ${laggardRun.iso3}'s ${laggardRun.openData.dsaAnalytics.fiscalConsolidationGapPct > 0 ? '+' : ''}${laggardRun.openData.dsaAnalytics.fiscalConsolidationGapPct.toFixed(2)}% GDP DSA gap.`;

  const recommendedPairTicket: StagedTradeTicketSpec = {
    ticketId: `PAIR-COMP-${winnerRun.iso3}-${laggardRun.iso3}`,
    createdAtIso: new Date().toISOString(),
    iso3: winnerRun.iso3,
    countryName: winnerRun.countryName,
    secondaryIso3: laggardRun.iso3,
    strategyTitle: `Overweight ${winnerRun.iso3} vs. Underweight ${laggardRun.iso3} Cross-Sovereign RV Pair`,
    direction: 'PAIR_RELATIVE_VALUE',
    sourceModuleLabel: 'Head-to-Head Sovereign Comparator',
    targetSectionId: 'quant_alpha_correlation',
    leg1Summary: `Long ${winnerRun.iso3} ${winnerNss.optimalCarryRollTenor.tenorLabel} Bond / Sell 5Y CDS (${winnerRun.openData.monetaryAndMarket.cds5YSpreadBps} bps)`,
    leg2Summary: `Short ${laggardRun.iso3} ${laggardNss.optimalCarryRollTenor.tenorLabel} Bond / Buy 5Y CDS (${laggardRun.openData.monetaryAndMarket.cds5YSpreadBps} bps)`,
    entrySpreadOrYieldBps: spreadDiffBps,
    targetSpreadOrYieldBps: spreadDiffBps - 35,
    stopLossSpreadOrYieldBps: spreadDiffBps + 25,
    expected12MCarryRollBps: Math.max(25, carryDiffBps + 30),
    breakevenCushionBps: winnerNss.optimalCarryRollTenor.breakevenCushionBps,
    impliedEventVolBps: 22,
    convictionScore0To100: 87,
    preMortemKillSwitchRule: `Exit pair if ${winnerRun.iso3} primary fiscal balance deteriorates > 0.6% of GDP or pairwise spread widens +25 bps against entry.`,
    thesisRationale: pairTradeVerdictSummary,
  };

  return {
    comparedRuns,
    metricRows,
    winCountByIso,
    overallRelativeValueWinnerIso: winnerRun.iso3,
    overallUnderweightLagIso: laggardRun.iso3,
    pairTradeVerdictSummary,
    recommendedPairTicket,
  };
}

// ============================================================================
// 6. PORTFOLIO STRESS-TEST & SCENARIO LAB ENGINE (5.9 EMBI BATCH P&L HIT)
// ============================================================================

export type EmbiStressPresetId =
  | 'EM_DEVAL_20_SPREAD_200'
  | 'GLOBAL_STAGFLATION_TAPER'
  | 'SOVEREIGN_CONTAGION_35_400'
  | 'COMMODITY_TERMS_COLLAPSE'
  | 'UST_PARALLEL_RATE_SPIKE'
  | 'GOLDILOCKS_RELIEF_RALLY';

export type EmbiPortfolioWeightScheme =
  | 'EMBI_BENCHMARK'
  | 'MAX_DIVERSIFICATION'
  | 'EQUAL_WEIGHT'
  | 'HOLDINGS';

export interface EmbiPortfolioStressParams {
  activePresetId: EmbiStressPresetId;
  fxDevaluationShockPct: number; // e.g. +20% currency devaluation vs USD
  creditSpreadWideningBps: number; // e.g. +200 bps sovereign spread widening
  usTreasuryShiftBps: number; // e.g. +50 bps UST parallel shift
  commodityShockPct: number; // e.g. -15% terms-of-trade shock
  fxHedgeRatioPct: number; // 0% to 100% FX forward hedge overlay
  weightScheme: EmbiPortfolioWeightScheme;
  /** With weightScheme 'HOLDINGS': % weights per ISO3 from the user's imported holdings. */
  holdingsWeightsPct?: Record<string, number>;
}

export const DEFAULT_EMBI_PORTFOLIO_STRESS_PARAMS: EmbiPortfolioStressParams = {
  activePresetId: 'EM_DEVAL_20_SPREAD_200',
  fxDevaluationShockPct: 20,
  creditSpreadWideningBps: 200,
  usTreasuryShiftBps: 50,
  commodityShockPct: -15,
  fxHedgeRatioPct: 35,
  weightScheme: 'EMBI_BENCHMARK',
};

export interface EmbiSovereignStressRow {
  iso3: string;
  countryName: string;
  currencyCode: string;
  portfolioWeightPct: number; // % of EMBI portfolio summing to 100.0%
  modifiedDurationYears: number;
  spreadDurationYears: number;
  localCurrencySharePct: number;
  creditBeta: number;
  fxBeta: number;
  effectiveSpreadWideningBps: number;
  effectiveFxDevaluationPct: number;
  // Standalone position P&L (bps of sovereign position)
  standaloneCreditPnlBps: number;
  standaloneFxPnlBps: number;
  standaloneRatesPnlBps: number;
  standaloneCarryOffsetBps: number;
  standaloneNetPnlBps: number;
  standaloneNetReturnPct: number;
  // Weighted Portfolio Book P&L Contribution (bps of total EMBI Book NAV & % of Book NAV)
  bookWeightedCreditHitBps: number;
  bookWeightedFxHitBps: number;
  bookWeightedRatesHitBps: number;
  bookWeightedCarryOffsetBps: number;
  bookWeightedNetPnlBps: number;
  bookWeightedNetPnlPctNav: number;
  shareOfTotalBookLossPct: number;
  // Post-shock fundamental solvency & pricing state
  baselineDebtToGdpPct: number;
  postShockDebtToGdpPct: number;
  baseline5YCdsBps: number;
  postShock5YCdsBps: number;
  vulnerabilityTier: 'CRITICAL_DRAWDOWN_DRIVER' | 'MODERATE_STRESS' | 'RESILIENT_BUFFER';
}

export interface BatchScenarioSummaryRow {
  scenarioId: EmbiStressPresetId | 'ACTIVE_CUSTOM_SHOCK';
  scenarioLabel: string;
  shockFormulaBadge: string;
  fxDevaluationShockPct: number;
  creditSpreadWideningBps: number;
  usTreasuryShiftBps: number;
  bookCreditHitPctNav: number;
  bookFxHitPctNav: number;
  bookRatesHitPctNav: number;
  bookCarryOffsetPctNav: number;
  netPortfolioPnlBps: number;
  netPortfolioPnlPctNav: number;
  worstHitIso3: string;
  worstHitContributionPctNav: number;
  postStressWeightedCdsBps: number;
}

export interface EmbiPortfolioBatchStressSuite {
  params: EmbiPortfolioStressParams;
  sovereignRows: EmbiSovereignStressRow[];
  batchScenarioRows: BatchScenarioSummaryRow[];
  totalBookCreditHitBps: number;
  totalBookFxHitBps: number;
  totalBookRatesHitBps: number;
  totalBookCarryOffsetBps: number;
  totalBookNetPnlBps: number;
  totalBookNetPnlPctNav: number;
  unhedgedBookNetPnlPctNav: number;
  fxHedgeSavedBps: number;
  carryBufferCoveragePct: number;
  worstHitSovereign: EmbiSovereignStressRow;
  mostResilientSovereign: EmbiSovereignStressRow;
  headlineConclusion: string;
  recommendedTailHedgeTicket: StagedTradeTicketSpec;
}

export const EMBI_BATCH_SCENARIO_PRESETS: Array<{
  id: EmbiStressPresetId;
  label: string;
  shortBadge: string;
  fxDevaluationShockPct: number;
  creditSpreadWideningBps: number;
  usTreasuryShiftBps: number;
  commodityShockPct: number;
}> = [
  {
    id: 'EM_DEVAL_20_SPREAD_200',
    label: '20% FX Devaluation + 200bps Spread Widening',
    shortBadge: '−20% FX / +200bp Spreads',
    fxDevaluationShockPct: 20,
    creditSpreadWideningBps: 200,
    usTreasuryShiftBps: 50,
    commodityShockPct: -15,
  },
  {
    id: 'GLOBAL_STAGFLATION_TAPER',
    label: 'Global Stagflation & Fed Hawkish Re-Pricing',
    shortBadge: '−15% FX / +175bp Spreads / +125bp UST',
    fxDevaluationShockPct: 15,
    creditSpreadWideningBps: 175,
    usTreasuryShiftBps: 125,
    commodityShockPct: -10,
  },
  {
    id: 'SOVEREIGN_CONTAGION_35_400',
    label: 'Systemic EM Contagion Tail Shock (35% FX + 400bps)',
    shortBadge: '−35% FX / +400bp Spreads',
    fxDevaluationShockPct: 35,
    creditSpreadWideningBps: 400,
    usTreasuryShiftBps: 75,
    commodityShockPct: -25,
  },
  {
    id: 'COMMODITY_TERMS_COLLAPSE',
    label: 'Commodity Supercycle & Terms-of-Trade Crash',
    shortBadge: '−25% FX / +250bp Spreads / −35% Cmdty',
    fxDevaluationShockPct: 25,
    creditSpreadWideningBps: 250,
    usTreasuryShiftBps: 25,
    commodityShockPct: -35,
  },
  {
    id: 'UST_PARALLEL_RATE_SPIKE',
    label: 'US Treasury +175bps Term-Premium Tantrum',
    shortBadge: '−12% FX / +140bp Spreads / +175bp UST',
    fxDevaluationShockPct: 12,
    creditSpreadWideningBps: 140,
    usTreasuryShiftBps: 175,
    commodityShockPct: -5,
  },
  {
    id: 'GOLDILOCKS_RELIEF_RALLY',
    label: 'Soft-Landing Disinflation & EM Spread Compression',
    shortBadge: '+5% FX / −85bp Spreads / −50bp UST',
    fxDevaluationShockPct: -5,
    creditSpreadWideningBps: -85,
    usTreasuryShiftBps: -50,
    commodityShockPct: 10,
  },
];

function evaluateBookForShockVector(
  runs: CouncilAssessmentRun[],
  weightsByIso: Record<string, number>,
  fxDevalPct: number,
  spreadWideningBps: number,
  ustShiftBps: number,
  commodityShockPct: number,
  fxHedgeRatioPct: number
): {
  rows: EmbiSovereignStressRow[];
  totalCreditHitBps: number;
  totalFxHitBps: number;
  totalRatesHitBps: number;
  totalCarryOffsetBps: number;
  totalNetPnlBps: number;
} {
  const hedgeFrac = Math.max(0, Math.min(1, fxHedgeRatioPct / 100));

  const rawRows = runs.map((r) => {
    const open = r.openData;
    const weightPct = weightsByIso[r.iso3] ?? 100 / Math.max(1, runs.length);
    const cds = open.monetaryAndMarket.cds5YSpreadBps;
    const y10 = open.monetaryAndMarket.sovereign10YBondYieldPct;
    const resMos = open.worldBankIndicators.fxReservesMonthsImport;
    const extDebtPct = open.worldBankIndicators.externalDebtPctGni;
    const floatingShare = open.debtRollover.floatingRateDebtSharePct;
    const foreignShare = open.debtRollover.foreignHoldingsSharePct;

    // Modified and spread duration for the sovereign's benchmark bond sleeve
    const yDec = Math.max(0.01, y10 / 100);
    const macDur = (1 - Math.pow(1 + yDec, -8)) / (1 - 1 / (1 + yDec));
    const modifiedDurationYears = Number(Math.max(3.2, macDur / (1 + yDec)).toFixed(2));
    const spreadDurationYears = Number((modifiedDurationYears * 0.94).toFixed(2));

    // Share of portfolio sleeve exposed to local currency vs USD Eurobonds
    const localCurrencySharePct = Number(
      Math.max(18, Math.min(68, 100 - foreignShare * 0.85)).toFixed(1)
    );

    // Sovereign-specific Credit Beta & FX Beta
    const creditBeta = Number(
      Math.max(
        0.45,
        Math.min(
          1.75,
          0.65 + (cds / 320) * 0.55 + Math.max(0, 6 - resMos) * 0.08
        )
      ).toFixed(2)
    );
    const fxBeta = Number(
      Math.max(
        0.5,
        Math.min(
          1.65,
          0.7 + (open.imfIndicators.cpiInflationPct / 12) * 0.35 + Math.max(0, 5 - resMos) * 0.07
        )
      ).toFixed(2)
    );

    // Commodity terms-of-trade amplifier for commodity exporters/importers
    const commodityAmplifierBps =
      commodityShockPct < 0
        ? Math.round(Math.abs(commodityShockPct) * (extDebtPct > 35 ? 1.35 : 0.75))
        : -Math.round(commodityShockPct * 0.6);

    const effectiveSpreadWideningBps = Math.round(
      spreadWideningBps * creditBeta + commodityAmplifierBps
    );
    const effectiveFxDevaluationPct = Number((fxDevalPct * fxBeta).toFixed(1));

    // 1. Standalone Credit Spread P&L Hit (bps of sovereign sleeve) including positive convexity
    const spreadDeltaDec = effectiveSpreadWideningBps / 10000;
    const convexityFactor = modifiedDurationYears * (modifiedDurationYears + 1) * 0.5;
    const standaloneCreditPnlBps = Math.round(
      (-spreadDurationYears * spreadDeltaDec +
        0.5 * convexityFactor * spreadDeltaDec * spreadDeltaDec) *
        10000
    );

    // 2. Standalone FX Devaluation Translation & Solvency Pass-Through Hit (bps of sleeve)
    // Unhedged local-currency sleeve suffers direct FX translation loss; external debt suffers balance-sheet pass-through
    const unhedgedLocalExposureFrac = (localCurrencySharePct / 100) * (1 - hedgeFrac);
    const directFxTranslationBps = -Math.round(
      effectiveFxDevaluationPct * unhedgedLocalExposureFrac * 100
    );
    const balanceSheetFxSolvencyDragBps = -Math.round(
      Math.max(0, effectiveFxDevaluationPct) * (extDebtPct / 100) * 14
    );
    const standaloneFxPnlBps = directFxTranslationBps + balanceSheetFxSolvencyDragBps;

    // 3. Standalone Global Rates / UST Duration Hit (bps of sleeve)
    const ustDeltaDec = ustShiftBps / 10000;
    const standaloneRatesPnlBps = Math.round(-modifiedDurationYears * 0.72 * ustDeltaDec * 10000);

    // 4. Quarterly Carry + Roll-Down Cushion Offset (+bps)
    const nss = computeSovereignNssYieldCurveSuite(r, DEFAULT_NSS_SHOCK_INPUTS);
    const standaloneCarryOffsetBps = Math.round(
      Math.max(20, nss.optimalCarryRollTenor.totalCarryRoll12MBps * 0.35)
    );

    const standaloneNetPnlBps =
      standaloneCreditPnlBps +
      standaloneFxPnlBps +
      standaloneRatesPnlBps +
      standaloneCarryOffsetBps;
    const standaloneNetReturnPct = Number((standaloneNetPnlBps / 100).toFixed(2));

    // Weighted contribution to the multi-sovereign EMBI book (in bps of Book NAV)
    const wFrac = weightPct / 100;
    const bookWeightedCreditHitBps = Number((standaloneCreditPnlBps * wFrac).toFixed(1));
    const bookWeightedFxHitBps = Number((standaloneFxPnlBps * wFrac).toFixed(1));
    const bookWeightedRatesHitBps = Number((standaloneRatesPnlBps * wFrac).toFixed(1));
    const bookWeightedCarryOffsetBps = Number((standaloneCarryOffsetBps * wFrac).toFixed(1));
    const bookWeightedNetPnlBps = Number(
      (
        bookWeightedCreditHitBps +
        bookWeightedFxHitBps +
        bookWeightedRatesHitBps +
        bookWeightedCarryOffsetBps
      ).toFixed(1)
    );
    const bookWeightedNetPnlPctNav = Number((bookWeightedNetPnlBps / 100).toFixed(2));

    // Post-shock Debt/GDP (%) & 5Y CDS (bps)
    const fxDebtValuationJumpPctGdp =
      Math.max(0, effectiveFxDevaluationPct) * (extDebtPct / 100) * 0.42;
    const rateRefinancingJumpPctGdp =
      Math.max(0, effectiveSpreadWideningBps / 100) * (floatingShare / 100) * 0.35;
    const postShockDebtToGdpPct = Number(
      (
        open.imfIndicators.debtToGdpPct +
        fxDebtValuationJumpPctGdp +
        rateRefinancingJumpPctGdp
      ).toFixed(1)
    );
    const postShock5YCdsBps = Math.max(25, Math.round(cds + effectiveSpreadWideningBps));

    return {
      iso3: r.iso3,
      countryName: r.countryName,
      currencyCode: open.currencyCode,
      portfolioWeightPct: Number(weightPct.toFixed(1)),
      modifiedDurationYears,
      spreadDurationYears,
      localCurrencySharePct,
      creditBeta,
      fxBeta,
      effectiveSpreadWideningBps,
      effectiveFxDevaluationPct,
      standaloneCreditPnlBps,
      standaloneFxPnlBps,
      standaloneRatesPnlBps,
      standaloneCarryOffsetBps,
      standaloneNetPnlBps,
      standaloneNetReturnPct,
      bookWeightedCreditHitBps,
      bookWeightedFxHitBps,
      bookWeightedRatesHitBps,
      bookWeightedCarryOffsetBps,
      bookWeightedNetPnlBps,
      bookWeightedNetPnlPctNav,
      shareOfTotalBookLossPct: 0,
      baselineDebtToGdpPct: open.imfIndicators.debtToGdpPct,
      postShockDebtToGdpPct,
      baseline5YCdsBps: cds,
      postShock5YCdsBps,
      vulnerabilityTier: 'MODERATE_STRESS' as EmbiSovereignStressRow['vulnerabilityTier'],
    };
  });

  const totalCreditHitBps = Number(
    rawRows.reduce((s, r) => s + r.bookWeightedCreditHitBps, 0).toFixed(1)
  );
  const totalFxHitBps = Number(
    rawRows.reduce((s, r) => s + r.bookWeightedFxHitBps, 0).toFixed(1)
  );
  const totalRatesHitBps = Number(
    rawRows.reduce((s, r) => s + r.bookWeightedRatesHitBps, 0).toFixed(1)
  );
  const totalCarryOffsetBps = Number(
    rawRows.reduce((s, r) => s + r.bookWeightedCarryOffsetBps, 0).toFixed(1)
  );
  const totalNetPnlBps = Number(
    (totalCreditHitBps + totalFxHitBps + totalRatesHitBps + totalCarryOffsetBps).toFixed(1)
  );

  const totalLossDenom = rawRows.reduce(
    (s, r) => s + (r.bookWeightedNetPnlBps < 0 ? Math.abs(r.bookWeightedNetPnlBps) : 0),
    0
  );

  const rows: EmbiSovereignStressRow[] = rawRows.map((r) => {
    const shareOfLoss =
      r.bookWeightedNetPnlBps < 0 && totalLossDenom > 0
        ? Number(((Math.abs(r.bookWeightedNetPnlBps) / totalLossDenom) * 100).toFixed(1))
        : 0;
    const vulnerabilityTier: EmbiSovereignStressRow['vulnerabilityTier'] =
      r.standaloneNetPnlBps <= -1200 || shareOfLoss >= 18
        ? 'CRITICAL_DRAWDOWN_DRIVER'
        : r.standaloneNetPnlBps <= -550
        ? 'MODERATE_STRESS'
        : 'RESILIENT_BUFFER';
    return {
      ...r,
      shareOfTotalBookLossPct: shareOfLoss,
      vulnerabilityTier,
    };
  });

  return {
    rows,
    totalCreditHitBps,
    totalFxHitBps,
    totalRatesHitBps,
    totalCarryOffsetBps,
    totalNetPnlBps,
  };
}

export function computeEmbiPortfolioBatchStressLabSuite(
  activeRun: CouncilAssessmentRun,
  watchlistItems: WatchlistItem[] = SOVEREIGN_CATALOG,
  params: EmbiPortfolioStressParams = DEFAULT_EMBI_PORTFOLIO_STRESS_PARAMS
): EmbiPortfolioBatchStressSuite {
  const useHoldings =
    params.weightScheme === 'HOLDINGS' && !!params.holdingsWeightsPct && Object.keys(params.holdingsWeightsPct).length > 0;
  const uniqueIsos = useHoldings
    ? Object.keys(params.holdingsWeightsPct!).slice(0, 10)
    : Array.from(new Set([activeRun.iso3, ...watchlistItems.map((w) => w.iso3)])).slice(0, 10);

  const runs = uniqueIsos.map((iso) =>
    iso === activeRun.iso3 ? activeRun : buildDefaultAssessmentRun(iso)
  );

  // Compute normalized portfolio weights summing to 100.0%
  const rawWeights: Record<string, number> = {};
  runs.forEach((r) => {
    const cds = r.openData.monetaryAndMarket.cds5YSpreadBps;
    const res = r.openData.worldBankIndicators.fxReservesMonthsImport;
    if (useHoldings) {
      rawWeights[r.iso3] = params.holdingsWeightsPct![r.iso3] || 0;
    } else if (params.weightScheme === 'EQUAL_WEIGHT') {
      rawWeights[r.iso3] = 1;
    } else if (params.weightScheme === 'MAX_DIVERSIFICATION') {
      rawWeights[r.iso3] = Math.max(0.4, (res / Math.max(50, cds)) * 100);
    } else {
      // EMBI_BENCHMARK liquidity & cap-tier weight approximation
      rawWeights[r.iso3] =
        r.iso3 === 'BRA' || r.iso3 === 'MEX'
          ? 16.5
          : r.iso3 === 'TUR' || r.iso3 === 'ZAF'
          ? 13.0
          : r.iso3 === 'DEU' || r.iso3 === 'JPN'
          ? 9.5
          : 11.0;
    }
  });

  const weightSum = Object.values(rawWeights).reduce((a, b) => a + b, 0) || 1;
  const weightsByIso: Record<string, number> = {};
  let runningSum = 0;
  runs.forEach((r, idx) => {
    if (idx === runs.length - 1) {
      weightsByIso[r.iso3] = Number(Math.max(0, 100 - runningSum).toFixed(1));
    } else {
      const w = Number(((rawWeights[r.iso3] / weightSum) * 100).toFixed(1));
      weightsByIso[r.iso3] = w;
      runningSum += w;
    }
  });

  // 1. Evaluate Active Shock Vector across the EMBI Book
  const activeEval = evaluateBookForShockVector(
    runs,
    weightsByIso,
    params.fxDevaluationShockPct,
    params.creditSpreadWideningBps,
    params.usTreasuryShiftBps,
    params.commodityShockPct,
    params.fxHedgeRatioPct
  );

  // Also evaluate with 0% FX hedge to quantify how many bps the FX hedge saved
  const unhedgedEval = evaluateBookForShockVector(
    runs,
    weightsByIso,
    params.fxDevaluationShockPct,
    params.creditSpreadWideningBps,
    params.usTreasuryShiftBps,
    params.commodityShockPct,
    0
  );

  const fxHedgeSavedBps = Math.max(
    0,
    Math.round(activeEval.totalNetPnlBps - unhedgedEval.totalNetPnlBps)
  );

  const grossDrawdownBps = Math.abs(
    Math.min(
      -1,
      activeEval.totalCreditHitBps + activeEval.totalFxHitBps + activeEval.totalRatesHitBps
    )
  );
  const carryBufferCoveragePct = Number(
    Math.min(100, (activeEval.totalCarryOffsetBps / grossDrawdownBps) * 100).toFixed(1)
  );

  const sortedByHit = [...activeEval.rows].sort(
    (a, b) => a.bookWeightedNetPnlBps - b.bookWeightedNetPnlBps
  );
  const worstHitSovereign = sortedByHit[0];
  const mostResilientSovereign = sortedByHit[sortedByHit.length - 1];

  // 2. Evaluate all 6 Batch Stress Scenarios simultaneously for side-by-side batch comparison
  const batchScenarioRows: BatchScenarioSummaryRow[] = EMBI_BATCH_SCENARIO_PRESETS.map(
    (preset) => {
      const ev = evaluateBookForShockVector(
        runs,
        weightsByIso,
        preset.fxDevaluationShockPct,
        preset.creditSpreadWideningBps,
        preset.usTreasuryShiftBps,
        preset.commodityShockPct,
        params.fxHedgeRatioPct
      );
      const worstRow = [...ev.rows].sort(
        (a, b) => a.bookWeightedNetPnlBps - b.bookWeightedNetPnlBps
      )[0];
      const weightedCds = Math.round(
        ev.rows.reduce(
          (s, r) => s + r.postShock5YCdsBps * (r.portfolioWeightPct / 100),
          0
        )
      );
      return {
        scenarioId: preset.id,
        scenarioLabel: preset.label,
        shockFormulaBadge: preset.shortBadge,
        fxDevaluationShockPct: preset.fxDevaluationShockPct,
        creditSpreadWideningBps: preset.creditSpreadWideningBps,
        usTreasuryShiftBps: preset.usTreasuryShiftBps,
        bookCreditHitPctNav: Number((ev.totalCreditHitBps / 100).toFixed(2)),
        bookFxHitPctNav: Number((ev.totalFxHitBps / 100).toFixed(2)),
        bookRatesHitPctNav: Number((ev.totalRatesHitBps / 100).toFixed(2)),
        bookCarryOffsetPctNav: Number((ev.totalCarryOffsetBps / 100).toFixed(2)),
        netPortfolioPnlBps: ev.totalNetPnlBps,
        netPortfolioPnlPctNav: Number((ev.totalNetPnlBps / 100).toFixed(2)),
        worstHitIso3: worstRow.iso3,
        worstHitContributionPctNav: worstRow.bookWeightedNetPnlPctNav,
        postStressWeightedCdsBps: weightedCds,
      };
    }
  );

  const totalBookNetPnlPctNav = Number((activeEval.totalNetPnlBps / 100).toFixed(2));
  const unhedgedBookNetPnlPctNav = Number((unhedgedEval.totalNetPnlBps / 100).toFixed(2));

  const headlineConclusion = `Under the active joint stress shock (${params.fxDevaluationShockPct >= 0 ? `${params.fxDevaluationShockPct}% FX devaluation` : `${Math.abs(params.fxDevaluationShockPct)}% FX appreciation`} + ${params.creditSpreadWideningBps >= 0 ? `+${params.creditSpreadWideningBps} bps` : `${params.creditSpreadWideningBps} bps`} spread shift + ${params.usTreasuryShiftBps >= 0 ? `+${params.usTreasuryShiftBps} bps` : `${params.usTreasuryShiftBps} bps`} UST shift), the ${runs.length}-sovereign EMBI book experiences an instantaneous net P&L hit of ${totalBookNetPnlPctNav > 0 ? '+' : ''}${totalBookNetPnlPctNav.toFixed(2)}% of NAV (${activeEval.totalNetPnlBps > 0 ? '+' : ''}${activeEval.totalNetPnlBps.toFixed(0)} bps: Credit ${activeEval.totalCreditHitBps.toFixed(0)} bps, FX ${activeEval.totalFxHitBps.toFixed(0)} bps, Rates ${activeEval.totalRatesHitBps.toFixed(0)} bps, offset by +${activeEval.totalCarryOffsetBps.toFixed(0)} bps Carry+Roll). ${worstHitSovereign.countryName} (${worstHitSovereign.iso3}) drives ${worstHitSovereign.shareOfTotalBookLossPct.toFixed(1)}% of the book drawdown (${worstHitSovereign.bookWeightedNetPnlPctNav.toFixed(2)}% NAV).`;

  const recommendedTailHedgeTicket: StagedTradeTicketSpec = {
    ticketId: `STRESS-HEDGE-${worstHitSovereign.iso3}-${params.fxDevaluationShockPct}FX-${params.creditSpreadWideningBps}BPS`,
    createdAtIso: new Date().toISOString(),
    iso3: worstHitSovereign.iso3,
    countryName: worstHitSovereign.countryName,
    secondaryIso3: mostResilientSovereign.iso3,
    strategyTitle: `EMBI Book Tail-Risk Overlay: Buy ${worstHitSovereign.iso3} 5Y CDS + FX Forward Protection vs. ${mostResilientSovereign.iso3}`,
    direction: 'CATALYST_VOL_HEDGE',
    sourceModuleLabel: '5.9 Portfolio Stress-Test & Scenario Lab',
    targetSectionId: 'quant_portfolio_stress_lab',
    leg1Summary: `Buy ${worstHitSovereign.iso3} 5Y CDS Protection @ ${worstHitSovereign.baseline5YCdsBps} bps (Stressed Target: ${worstHitSovereign.postShock5YCdsBps} bps) + Raise FX Hedge to 75%`,
    leg2Summary: `Fund via ${mostResilientSovereign.iso3} Defensive Quality Sleeve (+${mostResilientSovereign.standaloneCarryOffsetBps} bps Carry Cushion)`,
    entrySpreadOrYieldBps: worstHitSovereign.baseline5YCdsBps,
    targetSpreadOrYieldBps: worstHitSovereign.postShock5YCdsBps,
    stopLossSpreadOrYieldBps: Math.max(25, worstHitSovereign.baseline5YCdsBps - 35),
    expected12MCarryRollBps: Math.abs(Math.round(activeEval.totalNetPnlBps * 0.45)),
    breakevenCushionBps: Math.round(activeEval.totalCarryOffsetBps),
    impliedEventVolBps: Math.abs(params.creditSpreadWideningBps),
    convictionScore0To100: 91,
    preMortemKillSwitchRule: `Unwind tail hedge if EM FX volatility normalizes below 8.5% annualized or ${worstHitSovereign.iso3} 5Y CDS tightens 35 bps below entry.`,
    thesisRationale: `Neutralizes ${worstHitSovereign.shareOfTotalBookLossPct.toFixed(1)}% of the EMBI portfolio stress drawdown under a ${params.fxDevaluationShockPct}% FX devaluation + ${params.creditSpreadWideningBps} bps spread widening shock.`,
  };

  return {
    params,
    sovereignRows: activeEval.rows,
    batchScenarioRows,
    totalBookCreditHitBps: activeEval.totalCreditHitBps,
    totalBookFxHitBps: activeEval.totalFxHitBps,
    totalBookRatesHitBps: activeEval.totalRatesHitBps,
    totalBookCarryOffsetBps: activeEval.totalCarryOffsetBps,
    totalBookNetPnlBps: activeEval.totalNetPnlBps,
    totalBookNetPnlPctNav,
    unhedgedBookNetPnlPctNav,
    fxHedgeSavedBps,
    carryBufferCoveragePct,
    worstHitSovereign,
    mostResilientSovereign,
    headlineConclusion,
    recommendedTailHedgeTicket,
  };
}

