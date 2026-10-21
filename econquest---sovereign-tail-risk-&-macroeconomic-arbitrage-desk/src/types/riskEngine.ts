/**
 * Type definitions for EconQuest / Panoptix Quantitative VaR Engine
 * Based on: "EconQuest Geopolitical-Macroeconomic Risk Methodology White Paper"
 */

import type { AnnualObservation, annualModelProvenance } from '../math/fittedModels';

export type RegimeType = 'Calm' | 'Stressed' | 'Crisis';

export type MacroScenario =
  | 'baseline'
  | 'scenarioA_fedTightening'
  | 'scenarioB_commodityCollapse'
  | 'scenarioC_malaccaBlockade'
  | 'custom';

export type GuiLayoutTemplate = 'topbar' | 'sidebar' | 'dual_pane';

export interface CustomScenarioParams {
  id: string;
  name: string;
  description: string;
  
  // Sovereign Yield Curves & Credit Spreads
  usYieldCurveShiftBps: number; // bps (-200 to +600)
  sovereignSpreadWideningBps: number; // bps (0 to +1000)
  curveSteepeningBps: number; // bps (-150 to +250)
  
  // Commodity Price Indices
  commodityPriceShockPercent: number; // % (-60 to +60)
  energyOilShockPercent: number; // % (-60 to +80)
  metalsTermsOfTradeShockPercent: number; // % (-50 to +50)
  
  // FX Volatility & Currency Dynamics
  fxImpliedVolSkewJump: number; // % (0 to +45)
  broadUsdAppreciation: number; // % (0 to +30)
  reserveDrainPercent: number; // % (-50 to 0)
  
  // Geopolitical, Supply Chain & Banking Nexus
  textStressIndexShockSigma: number; // sigma (-2.0 to +6.0)
  aisChokepointDisruptionPct: number; // % (0 to 80)
  crossBorderContagionRho: number; // correlation shift (0.0 to +0.50)
}

export interface SovereignEntity {
  annualMacroHistory?: AnnualObservation[];
  id: string;
  name: string;
  code: string;
  flag: string;
  region: 'Latin America' | 'Sub-Saharan Africa' | 'South Asia' | 'Middle East / North Africa' | 'Southeast Asia' | 'Emerging Europe';
  isIslandState: boolean; // Triggers Pillar 7 15% switch
  fxRegime: 'Floating' | 'Pegged' | 'Managed Float' | 'Dollarized';
  
  // Baseline Macro-Fiscal Solvency Drivers (Layer 1)
  publicDebtToGdp: number; // % of GDP
  shortTermFxDebtToReserves: number; // % of reserves
  netReservesToImportsMonths: number; // Months of imports
  primaryDeficitGap: number; // pp of GDP
  politicalInstabilityPitf: number; // Index 0-10
  commodityExportShock: number; // Normalized index -5 to +5
  
  // Real-Time High-Frequency Market Signals (Layer 2)
  cdsSpread5yBps: number; // bps
  fxImpliedVolSkew: number; // %
  textStressIndex: number; // sigma units (-3 to +5)
  
  // Prediction Market Pricing (Section 3.2.1)
  predictionMarket: {
    marketName: 'Polymarket' | 'Kalshi';
    contractTitle: string;
    impliedProbPercent: number; // e.g. 12.5%
    marketVolumeUsd: number;
    orderBookBid: number;
    orderBookAsk: number;
    liquidityTau: number; // tau_market
  };
  
  // Balance Sheet CCA Drivers (Layer 4)
  sovereignAssetValueVA: number; // Billion USD
  distressThresholdDB: number; // Billion USD (Short-term debt + 0.5 * Long-term debt)
  assetVolatilitySigmaA: number; // annual sigma (e.g. 0.18)
  
  // Loss given default empirical parameters
  imfProgramInvolved: boolean;
  stateAssetsAbroadEligibleBillion: number;
  
  // Chokepoint & Maritime Supply Chain Sensitivity
  maritimeChokepointExposure: 'Low' | 'Moderate' | 'High' | 'Critical';
  
  // Baseline Scorecard Pillar Scores (0-100)
  pillarScores: {
    p1_fiscalDebt: number;
    p2_externalFragility: number;
    p3_institutionalIntegrity: number;
    p4_politicalDynamics: number;
    p5_macroFragility: number;
    p6_securityConflict: number;
    p7_climateCatastrophe: number;
  };
}

export interface IndicatorDefinition {
  id: string;
  pillar: number;
  name: string;
  unit: string;
  weight: number; // decimal e.g. 0.15 for 15%
  s0: number;
  s25: number;
  s50: number;
  s75: number;
  s100: number;
  direction: 1 | -1; // +1 higher value = higher risk; -1 higher value = lower risk
  primarySource: string;
}

export interface PillarBreakdown {
  pillarId: number;
  name: string;
  rawScore: number;
  calibratedScore: number;
  weight: number;
  isMaxIndicatorFired: boolean;
  dominantIndicatorName: string;
}

export interface LayerOutputs {
  annualModel: ReturnType<typeof annualModelProvenance>;
  // Layer 1
  baselineLogit: number;
  baselineProbLogit: number;
  lightgbmChallengerProb: number;
  layer1ReconciledHazard: number;
  
  // Layer 2
  logOddsPrior: number;
  scorecardDeltaShift: number;
  highFreqSignalShift: number;
  posteriorLogOdds: number;
  calibratedPosteriorHazard: number;
  predictionMarketSynthesizedProb: number;
  arbitrageDivergence: number; // model vs prediction market (%)
  isArbitrageAlert: boolean;
  
  // Layer 3
  regime: RegimeType;
  regimeProbabilities: { calm: number; stressed: number; crisis: number };
  aisChokepointStatus: string;
  tsiShockZScore: number;
  
  // Layer 4
  distanceToDistress: number; // DD
  mertonLgd: number; // %
  evtTailSeverity: number; // %
  compositeSeverityLge: number; // %
  
  // Layer 5
  studentTCopulaNu: number;
  tailDependenceLambdaU: number;
  crossBorderContagionFactor: number;
  
  // Layer 6
  sobolIterations: number;
  var99: number; // 99% 1-year VaR (% of debt / portfolio)
  es975: number; // 97.5% Expected Shortfall under FRTB
  lVar99: number; // Liquidity-Adjusted VaR
  lossDistributionPoints: { lossPercent: number; density: number }[];
}

export interface DataFeedConfig {
  id: string;
  name: string;
  category:
    | 'Prediction Markets'
    | 'Macro Solvency'
    | 'Geopolitical Conflict'
    | 'Supply Chain & AIS'
    | 'Credit & Spreads'
    | 'Yahoo Finance (yfinance)'
    | 'Custom Feed';
  targetPipelineLayer:
    | 'FRED / ALFRED'
    | 'BIS research'
    | 'IDS research'
    | 'UN Comtrade'
    | 'GDELT research'
    | 'ACLED research'
    | 'World Bank research'
    | 'WEO research'
    | 'Monthly IMF'
    | 'Layer 1: Hazard'
    | 'Layer 2: Bayesian Log-Odds'
    | 'Layer 3: HMM Regime'
    | 'Layer 4: Structural CCA'
    | 'Layer 5: Copula'
    | 'Pillar 1-7 Scorecard';
  protocol: 'REST (JSON)' | 'SDMX (XML)' | 'WebSocket (WSS)' | 'Server-Sent Events (SSE)' | 'gRPC Web' | 'Webhook Push';
  endpointUrl: string;
  cadence: 'Manual' | 'Streaming (<1s)' | '1-Minute Tick' | '5-Minute' | '15-Minute' | 'Hourly' | 'Daily Batch';
  status: 'Connected' | 'Idle' | 'Syncing' | 'Error';
  latencyMs: number;
  enabled: boolean;
  primarySourceDoc: string;
  lastSyncTimestamp?: string;
  samplePayloadPreview?: string;
}

export interface YFinanceQuote {
  symbol: string;
  name: string;
  category: 'Sovereign ETF' | 'FX Currency' | 'Commodity' | 'Rates & Volatility';
  price: number;
  change: number;
  changePercent: number;
  currency: string;
  dayHigh: number;
  dayLow: number;
  yearHigh: number;
  yearLow: number;
  volume: string;
  impliedVol?: number;
  relevanceToDesk: string;
  linkedSovereignId?: string;
  historicalSparkline: number[];
}
