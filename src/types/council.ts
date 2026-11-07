export type DeskId = 'geopolitical' | 'sovereign' | 'macro';

export type WorkspaceLayoutMode = 'executive_brief' | 'split_workbench' | 'full_report';

export type SubAgentId =
  | 'ag1_intel_scraper'
  | 'ag2_transmission_mapper'
  | 'ag3_sanctions_legal'
  | 'ag4_fiscal_auditor'
  | 'ag5_external_balance'
  | 'ag6_political_will'
  | 'ag7_hf_nowcaster'
  | 'ag8_cb_watcher'
  | 'ag9_global_spillover';

export type ProvenanceTier =
  | 'TIER_1_MULTILATERAL_API'
  | 'TIER_2_PREDICTION_EVENT'
  | 'TIER_3_SEARCH_POLICY_DOC'
  | 'TIER_4_MODEL_ESTIMATE';

export type TimeframeKey = '30D' | '90D' | '1Y' | '5Y' | '10Y_WEO';

export interface QuantitativeMetric {
  label: string;
  value: string;
  numericValue: number;
  unit: string;
  change: string;
  source: string;
  provenanceTier: ProvenanceTier;
}

export interface GroundingSource {
  title: string;
  uri: string;
  sourceType?: string;
}

export interface SubAgentReport {
  agentId: SubAgentId;
  agentCode: string;
  agentName: string;
  deskId: DeskId;
  roleTitle: string;
  dataSourcesUsed: string[];
  stance: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  riskScore: number; // 0.00 to 1.00
  confidence: number; // 0.00 to 1.00
  brierCalibrationWeight: number; // 0.50 to 1.00
  keyMetrics: QuantitativeMetric[];
  findingsSummary: string;
  structuredPayload: Record<string, string | number | boolean>;
  groundingSources: GroundingSource[];
}

export interface DeskDebateRound {
  roundNumber: number;
  proposerAgent: string;
  proposerStance: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  thesis: string;
  challengerAgent: string;
  challengerStance: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  counterThesis: string;
  deskLeadResolution: string;
  riskScoreAdjustment: number;
}

export interface MinorityDissentEntry {
  dissentId: string;
  deskId: DeskId;
  agentId: SubAgentId;
  agentName: string;
  agentRiskScore: number;
  deskConsensusScore: number;
  divergenceDelta: number;
  coreDissentArgument: string;
  earlyWarningTrigger: string;
  falsificationThreshold: string;
}

export interface DeskDebateTranscript {
  deskId: DeskId;
  deskName: string;
  deskLeadTitle: string;
  initialRiskSpread: number;
  rounds: DeskDebateRound[];
  preCascadeRiskScore: number;
  postCascadeRiskScore: number;
  consensusStance: 'CONSTRUCTIVE' | 'CAUTIOUS' | 'DEFENSIVE' | 'DISTRESSED';
  consensusSummary: string;
  minorityDissents: MinorityDissentEntry[];
}

export interface CascadeStep {
  stepOrder: number;
  sourceDesk: DeskId;
  targetDesk: DeskId;
  triggerAgent: string;
  receivingAgent: string;
  shockVariable: string;
  shockDelta: string;
  priorRiskScore: number;
  postCascadeRiskScore: number;
  transmissionMechanism: string;
  jsonPatch: Record<string, number | string>;
}

export interface CrisisAnalogMatch {
  analogId: string;
  crisisName: string;
  year: number;
  regionOrCountry: string;
  similarityScorePct: number;
  matchingDrivers: string[];
  historicalOutcome: {
    fxDrawdown3MPct: number;
    sovereignSpreadWideningBps: number;
    localBondReturn6MPct: number;
    policyResponseSummary: string;
  };
  keyDifferencesToday: string;
}

export interface RegimeProbabilityDistribution {
  baseCase: {
    label: string;
    probabilityPct: number;
    expectedSpreadDeltaBps: number;
    narrative: string;
  };
  adverseTailCase: {
    label: string;
    probabilityPct: number;
    expectedSpreadDeltaBps: number;
    narrative: string;
  };
  constructiveReformCase: {
    label: string;
    probabilityPct: number;
    expectedSpreadDeltaBps: number;
    narrative: string;
  };
}

export interface CounterfactualShockConfig {
  brentCrudeShockUsd: number;
  fedTerminalRateShockBps: number;
  chokepointTransitDropPct: number;
  domesticFiscalSlippagePctGdp: number;
}

export interface CROOverrideState {
  geopoliticalRiskScore: number;
  sovereignRiskScore: number;
  macroRiskScore: number;
  energyInflationShockPct: number;
  debtServicingSpreadBps: number;
  fxReserveAdequacyMonths: number;
  politicalWillIndex: number;
  counterfactualShocks: CounterfactualShockConfig;
  croNotes: string;
  croApproverName: string;
  isOverridden: boolean;
  approvedAt?: string;
}

export interface DecisionPointRow {
  variableId: string;
  variableName: string;
  deskSource: DeskId;
  provenanceTier: ProvenanceTier;
  currentValue: string;
  bullThreshold: string;
  bearBreakTrigger: string;
  requiredActionIfTriggered: string;
  urgency: 'IMMEDIATE' | 'HIGH' | 'MONITOR';
}

export interface TradeExecutionTicket {
  ticketId: string;
  assetClass: 'RATES' | 'FX' | 'SOVEREIGN_CREDIT' | 'COMMODITIES' | 'EQUITY_INDEX';
  instrument: string;
  /** The referee model's call, or null when it gave none (shown as Missing). */
  direction: 'LONG' | 'SHORT' | 'HEDGE' | null;
  conviction: 'HIGH' | 'MEDIUM' | 'TACTICAL' | null;
  /** Nothing in the app sizes trades yet: null (shown as Missing). */
  sizingWeightPct: number | null;
  targetHorizon: string;
  entryLevel: string;
  targetLevel: string;
  invalidationStopTrigger: string;
  entryRationale: string;
}

export interface SupremeCouncilOutput {
  /** True only when an AI model wrote this report in a council run; the built-in starting report has none. */
  fromModel?: boolean;
  reportId: string;
  schemaVersion: 'SMCR-1.0';
  generatedAt: string;
  decisionVerdict: 'EXECUTE_TRADES' | 'DEFENSIVE_HEDGE' | 'HOLD_AND_MONITOR';
  compositeRiskScore: number;
  /** How far the council agreed, 0-1. Nothing measures it yet, so it is null (shown as Missing). */
  globalCoherenceScore: number | null;
  executiveSummary: string;
  decisionPointMatrix: DecisionPointRow[];
  policyResearcherReport: {
    structuralVulnerabilities: string[];
    transmissionPathways: string[];
    policyRecommendations: Array<{
      authority: string;
      action: string;
      expectedImpact: string;
      priority: 'IMMEDIATE' | 'MEDIUM_TERM' | 'STRUCTURAL';
    }>;
    longTermRegimeOutlook: string;
  };
  marketTranslationLayer: {
    regimeStance: string;
    tradeExpressions: TradeExecutionTicket[];
    riskGuardianCheck: {
      factorCrowdingWarning: string;
      /** Not estimated anywhere in the app yet: null (shown as Missing). */
      liquidityHaircutPct: number | null;
      /** Not estimated anywhere in the app yet: null (shown as Missing). */
      maxDrawdownEstimatePct: number | null;
      /** Written by the referee model, or MODEL_FIELD_MISSING. */
      tailRiskHedgeInstrument: string;
      /** The referee model's call, or null when it gave none. */
      approvalStatus: 'APPROVED' | 'APPROVED_WITH_HEDGE' | 'RESTRICTED' | null;
    };
  };
}

export interface PolymarketContract {
  id: string;
  question: string;
  probabilityPct: number;
  volumeUsd: number;
  category: string;
  url: string;
  /** Polymarket's own reported change in the price, over a day, a week and a month, in percentage points. */
  change1dPts?: number;
  change1wPts?: number;
  change1mPts?: number;
}

export interface GdeltEventItem {
  title: string;
  sourceDomain: string;
  publishedAt: string;
  toneScore: number;
  url: string;
}

export interface MaturityWallBucket {
  periodLabel: string;
  domesticLocalPctGdp: number;
  externalHardCurrencyPctGdp: number;
  totalUsdBn: number;
  avgCouponPct: number;
  isPeakRollover?: boolean;
}

export interface DebtRolloverProfile {
  greenspanGuidottiRatioPct: number; // Liquid FX Reserves / 12M Short-Term External Debt
  shortTermExternalDebtUsdBn: number;
  liquidFxReservesUsdBn: number;
  weightedAvgMaturityYears: number;
  floatingRateDebtSharePct: number;
  foreignHoldingsSharePct: number;
  rolloverVerdict: string;
  buckets: MaturityWallBucket[];
}

export interface DsaAnalytics {
  effectiveRealInterestRatePct: number; // r
  realGdpGrowthRatePct: number; // g
  rMinusGDifferentialPct: number; // r - g
  debtStabilizingPrimaryBalancePct: number; // pb* = ((r - g)/(1 + g)) * d
  actualPrimaryBalancePct: number; // pb
  fiscalConsolidationGapPct: number; // pb* - pb
  dsaInterpretation: string;
}

export interface YieldCurveTenorPoint {
  tenor: '3M' | '1Y' | '2Y' | '5Y' | '10Y' | '30Y';
  currentYieldPct: number;
  prior90DYieldPct: number;
  usdHedgedBasisBps: number;
}

export interface YieldCurveProfile {
  slope2s10sBps: number;
  curveRegimeLabel: string;
  localVsUsdBasisSummary: string;
  tenors: YieldCurveTenorPoint[];
}

export interface InstitutionalCatalystEvent {
  eventId: string;
  dateLabel: string;
  daysOut: number;
  category:
    | 'CENTRAL_BANK_MPC'
    | 'CENTRAL_BANK_REPORT'
    | 'DATA_RELEASE'
    | 'IMF_FISCAL_REVIEW'
    | 'CREDIT_RATING_WINDOW'
    | 'BOND_REDEMPTION_WALL'
    | 'GEOPOLITICAL_DEADLINE';
  title: string;
  /** Official schedule this date was read from (src/data/officialCalendar.ts). */
  sourceName?: string;
  sourceUrl?: string;
  consensusExpectation: string;
  tailRiskScenario: string;
  impliedVolatilityImpact: string;
  deskOwner: DeskId;
}

export interface FactorSensitivityRow {
  factorName: string;
  shockMagnitudeDescription: string;
  local10YYieldImpactBps: number;
  spotFxImpactPct: number;
  cds5YImpactBps: number;
  transmissionChannel: string;
}

export interface OpenDataSnapshot {
  iso3: string;
  countryName: string;
  region: string;
  currencyCode: string;
  fetchedAt: string;
  liveApiSourcesActive: string[];
  /**
   * Set by the server: the feeds that actually answered on the last pull. Absent on
   * snapshots saved by older versions (treated as unverified). See utils/dataStatus.ts.
   */
  dataStatus?: {
    verifiedLiveSources: string[];
    checkedAt: string;
  };
  /**
   * Figures a live feed actually filled, by path (e.g. 'imf.debtToGdpPct'), with a short source
   * label. Any figure not listed is a built-in value and must not be shown as data.
   */
  liveFields?: Record<string, string>;
  /** The BIS central bank policy rate behind market.policyRatePct, when the feed has one (src/utils/bisPolicyRates.ts). */
  bisPolicyRate?: {
    ratePct: number;
    date: string;
    freq: 'daily' | 'monthly';
    bank?: string;
    rate?: string;
    change12mPts?: number;
    lastMove?: { period: string; fromPct: number; toPct: number };
    stale: boolean;
    pulledAt: string;
  };
  imfIndicators: {
    debtToGdpPct: number;
    debtToGdpForecast2027Pct: number;
    primaryFiscalBalancePct: number;
    realGdpGrowthPct: number;
    cpiInflationPct: number;
    /** IMF WEO output gap, % of potential GDP; set only where the IMF publishes one (mostly advanced economies). */
    outputGapPct?: number;
    /** IMF Fiscal Monitor general government revenue, expenditure and overall balance, % of GDP (src/utils/imfFiscal.ts). */
    revenuePct?: number;
    expenditurePct?: number;
    overallBalancePct?: number;
    /** IMF WEO unemployment rate, %. */
    unemploymentPct?: number;
    /** IMF WEO current account balance, US$ billions and % of GDP. */
    currentAccountUsdBn?: number;
    currentAccountImfPct?: number;
    sourceUrl: string;
    /** WEO year each live figure is for, by liveFields key (e.g. 'imf.debtToGdpPct' -> '2025'). */
    years?: Record<string, string>;
  };
  worldBankIndicators: {
    fxReservesMonthsImport: number;
    externalDebtPctGni: number;
    currentAccountPctGdp: number;
    politicalStabilityPercentile: number;
    sourceUrl: string;
  };
  monetaryAndMarket: {
    policyRatePct: number;
    realPolicyRatePct: number;
    sovereign10YBondYieldPct: number;
    cds5YSpreadBps: number;
    /** Hard-currency (USD) bond spread over Treasuries, bps, BCRP EMBIG monthly. Set only from the feed; never a built-in value. */
    hcBondSpreadBps?: number;
    exchangeRatePerUsd: number;
    fxYtdChangePct: number;
    chokepointExposureIndex: number;
  };
  polymarketContracts: PolymarketContract[];
  /** GDELT pull for this country (tone, its shift over the timeline, the date pulled). Set only when GDELT answered. */
  gdeltPull?: { pulledAt: string; tone: number; toneShift?: import('../utils/gdeltTone').GdeltToneShift };
  /** GDELT 2.0 raw files (events and GKG), latest complete week against the weeks before; laid over when served (utils/gdeltRaw.ts). */
  gdeltRaw?: import('../utils/gdeltRaw').GdeltRawReading;
  /** UCDP conflict figures from the downloaded CSV files in data/local/ucdp/; laid over when served (utils/ucdpConflict.ts). */
  ucdp?: import('../utils/ucdpConflict').UcdpReading;
  /** GDELT 1.0 monthly history: latest complete month against all months on disk; laid over when served (utils/gdeltDaily.ts). */
  gdeltDaily?: import('../utils/gdeltDaily').V1Reading;
  /** ACLED conflict events, monthly counts for twelve months, with your own ACLED account; laid over when served (utils/acled.ts). */
  acled?: import('../utils/acled').AcledReading;
  /** Why the ACLED figures are missing, in words (no account, no API access, no answer). */
  acledMissing?: string;
  gdeltMetrics: {
    conflictIntensityIndex: number;
    averageTone: number;
    articleCount24h: number;
    topHeadlines: GdeltEventItem[];
  };
  debtRollover: DebtRolloverProfile;
  dsaAnalytics: DsaAnalytics;
  yieldCurve: YieldCurveProfile;
  catalystCalendar: InstitutionalCatalystEvent[];
  factorBetas: FactorSensitivityRow[];
  liveCreditRating?: string;
  /** Official 10Y yield (OECD via FRED, monthly average) when the country is covered and the feed answered. */
  official10YYield?: import('../utils/officialYields').OfficialYieldObservation;
  groundingCitations?: Array<{ title: string; uri: string }>;
  /** US 10Y Treasury yield (OECD monthly via FRED), the benchmark for the spread over Treasuries. */
  us10YYield?: import('../utils/officialYields').OfficialYieldObservation;
  /** 5Y CDS from the user's own licensed data, when the own-account switch is on (utils/ownCds.ts). */
  ownCds5Y?: { bps: number; date: string; source: string };
  /** Hard-currency (USD) bond spread over Treasuries when BCRP covers the country (utils/hardCurrencySpread.ts). A bond spread, not CDS. */
  hcBondSpread?: import('../utils/hardCurrencySpread').HcSpreadObservation;
  /** Government external debt falling due, when QEDS or IDS answered (see utils/debtSchedule.ts). */
  debtSchedule?: import('../utils/debtSchedule').DebtSchedule;
  livePlumbingOverrides?: {
    usSofrRatePct?: number;
    usEffrRatePct?: number;
    fedOnRrpBalanceUsdBn?: number;
    fxRatesVsUsd?: Record<string, number>;
    fetchedAt?: string;
  };
}

export interface ChartDataPoint {
  period: string;
  primaryValue: number;
  secondaryValue: number;
  tertiaryValue?: number;
  thresholdValue?: number;
  isForecast?: boolean;
}

export interface AnnotatedChartSpec {
  chartId: string;
  categoryKicker: string;
  title: string;
  conclusionHeadline: string;
  subtitle: string;
  deskOwner: DeskId;
  primarySeriesLabel: string;
  primaryUnit: string;
  secondarySeriesLabel: string;
  secondaryUnit: string;
  thresholdLabel: string;
  thresholdValue: number;
  provenanceTier: ProvenanceTier;
  dataSourceCitation: string;
  explainer: {
    whatItMeasures: string;
    whyItMattersInstitutionally: string;
    regimeBreakThresholdExplanation: string;
    crossDeskCascadeLink: string;
  };
  seriesByTimeframe: Record<TimeframeKey, ChartDataPoint[]>;
}

export interface WatchlistItem {
  /** A benchmark market added for peer comparisons (src/utils/marketEdgeAnchors.ts), not on your watchlist. */
  isBenchmark?: boolean;
  iso3: string;
  countryName: string;
  region: string;
  currencyCode: string;
  focusTheme: string;
  yield10YPct: number;
  cds5YBps: number;
  debtToGdpPct: number;
  fxReservesMonths: number;
  /** Whether this row's figures came from live feeds (see utils/dataStatus.ts). Absent = sample. */
  dataMode?: 'live' | 'partial' | 'sample' | 'unverified';
  dataAsOf?: string;
  /** Where yield10YPct came from (see utils/watchlistYield.ts). Absent = sample. */
  yield10YSource?: 'official' | 'ai_estimate' | 'sample' | 'uploaded';
  /** Where cds5YBps came from: the user's own data, an AI estimate, or the sample. Absent = sample. */
  cds5YSource?: 'own' | 'ai_estimate' | 'sample';
  cds5YDate?: string;
  cds5YProvider?: string;
  /** USD bond spread over US Treasuries, bps (J.P. Morgan EMBI Global via BCRP, monthly). Only from the feed; a bond spread, not CDS. */
  hcSpreadBps?: number;
  /** YYYY-MM of that monthly average. */
  hcSpreadPeriod?: string;
  hcSpreadChange12mBps?: number;
  /** Official figures only: YYYY-MM (monthly average) or YYYY-MM-DD (daily rate). */
  yield10YPeriod?: string;
  yield10YFrequency?: 'monthly' | 'daily';
  /** Official monthly yields only: change against 3 and 12 calendar months earlier, percentage points. */
  yield10YChange3mPts?: number;
  yield10YChange12mPts?: number;
  /** Macro figures for the ranked divergence list (utils/divergences.ts). Set by the live watchlist. */
  cpiInflationPct?: number;
  policyRatePct?: number;
  /** 'oecd' when the OECD monthly figure filled CPI, 'live' when the IMF feed answered, else 'sample'. */
  cpiSource?: 'live' | 'sample' | 'oecd';
  /** YYYY-MM of the OECD monthly CPI figure, when cpiSource is 'oecd'. */
  cpiMonth?: string;
  /**
   * Output gap (% of potential GDP): the IMF's where it publishes one ('imf'), else the app's stated
   * estimate from IMF real GDP growth ('estimate', src/utils/outputGap.ts) with its band across methods.
   */
  outputGap?: { pct: number; year: string; source?: 'imf' | 'estimate'; low?: number; high?: number };
  /** Debt sustainability summary (src/utils/debtSustainability.ts) from the saved IMF history. */
  debtSustainability?: DsaSummary;
  /** 'bis' when the BIS central bank policy rates feed filled policyRatePct; anything else does not count. */
  policyRateSource?: 'bis' | 'ai_estimate' | 'sample';
  /** BIS figures only: the date (YYYY-MM-DD, or YYYY-MM for an end-of-month figure), the central bank, and the history read from the BIS. */
  policyRateDate?: string;
  policyRateBank?: string;
  policyRateStale?: boolean;
  policyRateChange12mPts?: number;
  policyRateLastMove?: { period: string; fromPct: number; toPct: number };
  /** BIS: every move in the history read, oldest first, and the first month read. */
  policyRateMoves?: { period: string; fromPct: number; toPct: number }[];
  policyRateHistoryFrom?: string;
  /** 'live' when the IMF filled debt/GDP, or the World Bank filled reserves; else built-in. */
  debtSource?: 'live' | 'sample';
  reservesSource?: 'live' | 'sample';
  /** BIS international government bonds: outstanding and due within a year, USD bn. */
  intlBondsUsdBn?: number;
  intlBondsDue1yUsdBn?: number;
  intlBondsAsOf?: string;
  /** BIS real effective exchange rate against its 10-year average, percent (utils/fxValuation.ts). */
  reerGapPct?: number;
  reerPeriod?: string;
  /** Three-month realised volatility against the US dollar, annualised percent (ECB rates). */
  fxVol3mPct?: number;
  fxVolTo?: string;
  /** US effective federal funds rate (NY Fed), for carry. */
  usFedFundsPct?: number;
  usFedFundsDate?: string;
  /** Where the fed funds rate came from: the New York Fed API, or FRED (DFF) when that was down. */
  usFedFundsSource?: 'nyfed' | 'fred';
  /** CFTC currency futures positioning (utils/cftcPositioning.ts), with the date the app pulled it. */
  cftc?: import('../utils/cftcPositioning').CftcPositioning & { pulledAt: string };
  /** TIC holdings of US Treasuries (utils/ticHoldings.ts), with the date the app pulled them. */
  tic?: import('../utils/ticHoldings').TicHolding & { pulledAt: string };
  /** IMF official reserves and balance of payments (utils/imfReserves.ts), with the date the app pulled them. */
  imf?: import('../utils/imfReserves').ImfExternal & { pulledAt: string };
  /** OECD composite leading indicator (utils/oecdCli.ts), with the date the app pulled it. */
  oecdCli?: import('../utils/oecdCli').CliReading & { pulledAt: string };
  /** Set when the OECD answered but publishes no CLI for this country (so the reason can say so). */
  oecdCliPulledAt?: string;
  /** How often timing signals were followed by what they point to, in this country's history (utils/signalRecord.ts). */
  signalRecord?: import('../utils/signalRecord').SignalRecord;
  /** GDELT news tone and its shift (utils/gdeltTone.ts), with the date the app pulled it. */
  gdelt?: { pulledAt: string; tone: number; toneShift?: import('../utils/gdeltTone').GdeltToneShift };
  /** OECD monthly CPI inflation (utils/oecdInflation.ts), with the date the app pulled it. */
  oecdCpi?: import('../utils/oecdInflation').CpiReading & { pulledAt: string };
  /** Set when the OECD answered but publishes no CPI for this country. */
  oecdCpiPulledAt?: string;
  /** UN Comtrade partners and export mix (utils/comtradeTrade.ts), with the date the app pulled them. */
  comtrade?: import('../utils/comtradeTrade').ComtradeProfile & { pulledAt: string };
  /** IMF COFER world currency shares of FX reserves (utils/imfCofer.ts); the same world reading on every row. */
  cofer?: import('../utils/imfCofer').CoferReading & { pulledAt: string };
  /** Official trade shares for the scenario ranking (utils/scenarioExposure.ts). */
  trade?: import('../utils/scenarioExposure').TradeExposure;
  /** Public debt and fiscal figures from live feeds only, each with its year (utils/fiscalDebt.ts). */
  fiscal?: import('../utils/fiscalDebt').FiscalFigures;
  /** GDELT tone and headlines, WGI political stability and Polymarket odds, live only (utils/politicsEvents.ts). */
  politics?: import('../utils/politicsEvents').PoliticsFigures;
}

/** Built-in figures on a watchlist row; LiveWatchlistItem leaves each out unless a live source filled it. */
export type BuiltInWatchlistField =
  | 'yield10YPct'
  | 'cds5YBps'
  | 'debtToGdpPct'
  | 'fxReservesMonths';

/** A watchlist row with only figures from live, official, your own or AI-search sources (utils/liveFigures.ts). */
export type LiveWatchlistItem = Omit<WatchlistItem, BuiltInWatchlistField> & Partial<Pick<WatchlistItem, BuiltInWatchlistField>>;

export interface WatchlistGroup {
  id: string;
  name: string;
  description: string;
  isCustom?: boolean;
  items: WatchlistItem[];
}

export type ExternalInternalConnectorMetricKey =
  | 'gdpGrowth'
  | 'cpiInflation'
  | 'debtToGdp'
  | 'cds5yBps'
  | 'fxReservesMonths'
  | 'policyRate'
  | 'politicalStability';

export interface ExternalInternalConnectorConfig {
  id: string;
  name: string;
  category: 'macro_rest' | 'llm_gateway' | 'webhook_bus';
  networkScope: 'external' | 'internal_host';
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  bodyTemplate?: string;
  enabled: boolean;
  timeoutMs: number;
  telemetryMappings?: Partial<Record<ExternalInternalConnectorMetricKey, string>>;
  injectIntoCouncilPrompt?: boolean;
  lastStatus?: 'untested' | 'ok' | 'error';
  lastLatencyMs?: number;
  lastTestedAt?: string;
}

export interface DockerSelfHostGuiConfig {
  targetOs: 'mac_apple_silicon' | 'mac_intel' | 'windows_nvidia' | 'windows_cpu' | 'linux';
  topology: 'host_ollama' | 'bundled_cpu' | 'bundled_gpu';
  appPort: number;
  ollamaPort: number;
  containerName: string;
  keepAlive: string;
  corsOrigins: string;
  autoPullOnBoot: boolean;
}

export type IntegrationBroadcastScope =
  | 'all_desks_bundle'
  | 'geopolitical_desk'
  | 'sovereign_desk'
  | 'macro_desk'
  | 'supreme_council';

export interface TopLevelIntegrationConfig {
  requireApiKey: boolean;
  apiKey: string;
  webhookHmacSecret: string;
  autoBroadcastOnRun: boolean;
  defaultScope: IntegrationBroadcastScope;
  includeSubAgents: boolean;
  includeQuantSuites: boolean;
}

export interface IntegrationDeliveryReceipt {
  deliveryId: string;
  timestamp: string;
  iso3: string;
  countryName: string;
  scope: IntegrationBroadcastScope;
  eventType: string;
  targetName: string;
  targetUrl: string;
  transport: 'WEBHOOK_POST' | 'SSE_STREAM' | 'REST_PULL';
  statusCode: number;
  ok: boolean;
  latencyMs: number;
  hmacSignature: string;
  payloadBytes: number;
  responsePreview: string;
}

export interface AIRuntimeConfig {
  providerMode: 'gemini' | 'ollama' | 'hybrid' | 'openai_compatible';
  geminiQuickModel: string;
  geminiDeepModel: string;
  ollamaBaseUrl: string;
  ollamaQuickModel: string;
  ollamaDeepModel: string;
  openAiBaseUrl: string;
  openAiModel: string;
  webhookTargetUrl: string;
  enableSearchGrounding: boolean;
  maxDebateRounds: number;
  temperature?: number;
  numCtx?: number;
  timeoutSeconds?: number;
  deskModelOverrides?: {
    geopolitical?: string;
    sovereign?: string;
    macro?: string;
    supremeCouncil?: string;
  };
  agentModelOverrides?: Partial<Record<SubAgentId, string>>;
  agentPromptOverrides?: Partial<Record<SubAgentId, string>>;
  dockerGuiConfig?: DockerSelfHostGuiConfig;
  apiConnectors?: ExternalInternalConnectorConfig[];
  integrationConfig?: TopLevelIntegrationConfig;
}

export interface CouncilAssessmentRun {
  runId: string;
  iso3: string;
  countryName: string;
  scenarioPrompt: string;
  policyDocumentTitle?: string;
  policyDocumentSnippet?: string;
  runtimeUsed: string;
  stage: 'IDLE' | 'RUNNING_PHASE_1_2' | 'AWAITING_CRO_APPROVAL' | 'RUNNING_SUPREME_COUNCIL' | 'COMPLETED';
  /** How long each step took on this run, measured by the server (src/utils/councilTiming.ts). */
  timing?: import('../utils/councilTiming').CouncilTiming;
  openData: OpenDataSnapshot;
  charts: AnnotatedChartSpec[];
  subAgents: SubAgentReport[];
  deskDebates: Record<DeskId, DeskDebateTranscript>;
  cascadeSteps: CascadeStep[];
  crisisAnalogs: CrisisAnalogMatch[];
  regimeDistribution: RegimeProbabilityDistribution;
  croState: CROOverrideState;
  supremeCouncil?: SupremeCouncilOutput;
  pipelineExecutionTelemetry?: CouncilPipelineTelemetry;
  /** Sentences removed because a number did not trace to what the council was given (utils/runFigureCheck.ts). */
  figureCheck?: {
    desks?: import('../utils/runFigureCheck').FigureCheck;
    report?: import('../utils/runFigureCheck').FigureCheck;
  };
}

export interface ForecastingShockInputs {
  realRateShockBps: number; // -200 to +400 bps
  realGdpGrowthShockPct: number; // -4.0% to +3.0%
  primaryBalanceShockPctGdp: number; // -3.0% to +3.0% GDP
  fxDepreciationShockPct: number; // 0% to +35%
  externalVolatilityMultiplier: number; // 0.5x to 2.5x
}

export interface StochasticFanPoint {
  year: string;
  deterministicBaseline: number;
  p10: number;
  p25: number;
  p50Median: number;
  p75: number;
  p90: number;
  p95Extreme: number;
  distressThreshold: number;
}

export interface StochasticDebtSimulationResult {
  pathsSimulated: number;
  distressThresholdPctGdp: number;
  probabilityOfDistress2030Pct: number;
  medianDebt2030PctGdp: number;
  p95Debt2030PctGdp: number;
  foreignCurrencyRevaluationImpactPctGdp: number;
  conclusionHeadline: string;
  fanSeries: StochasticFanPoint[];
}

export interface BvarIrfHorizonPoint {
  quarterLabel: string;
  quarterIndex: number;
  meanResponse: number;
  lower68: number;
  upper68: number;
  lower95: number;
  upper95: number;
}

export interface BvarIrfVariableSeries {
  variableId: 'cds_5y_bps' | 'yield_10y_bps' | 'cpi_yoy_pct' | 'gdp_yoy_pct';
  variableLabel: string;
  unit: string;
  peakQuarter: string;
  peakImpact: number;
  halfLifeQuarters: number;
  horizonPoints: BvarIrfHorizonPoint[];
}

export interface BvarIrfModelResult {
  impulseDescription: string;
  conclusionHeadline: string;
  series: BvarIrfVariableSeries[];
}

export interface TailDensityPoint {
  xValue: number;
  baselineDensity: number;
  stressedDensity: number;
  isTailZone: boolean;
}

export interface GarFarTailResult {
  conclusionHeadline: string;
  gdpMeanForecastPct: number;
  gdpGar5thPercentilePct: number; // 5% left-tail recession growth-at-risk
  recessionProbabilityPct: number;
  fiscalMeanBalancePctGdp: number;
  fiscalFar95thDeficitPctGdp: number; // 95% right-tail deficit blowout
  gdpDensityCurve: TailDensityPoint[];
}

export interface NssCurvePoint {
  tenor: string;
  maturityYears: number;
  spotYieldPct: number;
  forward1Y1YYieldPct: number;
  forward2Y1YYieldPct: number;
  expectedPolicyRatePathPct: number;
  sovereignTermPremiumBps: number;
}

export interface NssTermStructureResult {
  beta0Level: number;
  beta1Slope: number;
  beta2Curvature: number;
  implied1YPolicyRateDeltaBps: number;
  tenYearTermPremiumBps: number;
  conclusionHeadline: string;
  points: NssCurvePoint[];
}

export interface EarlyWarningSignalFactor {
  factorName: string;
  currentReading: string;
  zScore: number; // standard deviations from historical tranquil mean
  warningThresholdZ: number;
  status: 'TRANQUIL' | 'WATCH' | 'CRISIS_ALERT';
  contributionWeightPct: number;
}

export interface MarkovAndEwsResult {
  compositeCrisisZScore: number;
  crisisProbability12MPct: number;
  currentDominantRegime: 'CONSTRUCTIVE_CARRY' | 'FISCAL_DOMINANCE' | 'SUDDEN_STOP_CRISIS';
  conclusionHeadline: string;
  transitionMatrix: {
    fromRegime: string;
    toCarryPct: number;
    toFiscalDominancePct: number;
    toSuddenStopPct: number;
  }[];
  ewsFactors: EarlyWarningSignalFactor[];
}

export interface FiscalDominanceFrontierPoint {
  policyRatePct: number;
  inflationPassThroughPct: number;
  annualInterestBillDeltaPctGdp: number;
  regime: 'MONETARY_DOMINANCE' | 'TRANSITION_ZONE' | 'FISCAL_DOMINANCE';
}

export interface FiscalDominanceAndFxBurnResult {
  blanchardLeeperThresholdRatePct: number;
  currentPolicyRatePct: number;
  policyRateHeadroomBps: number; // negative if already in fiscal dominance
  floatingShortDebtSharePct: number;
  annualFiscalCostPer100BpsPctGdp: number;
  isFiscalDominanceActive: boolean;
  grossFxReservesUsdBn: number;
  imfAra100FloorUsdBn: number;
  monthlyFxiBurnRateUsdBn: number;
  monthsToAraBreach: number;
  conclusionHeadline: string;
  frontierCurve: FiscalDominanceFrontierPoint[];
}

export interface GfnComponentItem {
  componentLabel: string;
  pctOfGdp: number;
  usdBillions: number;
  shareOfTotalGfnPct: number;
}

export interface InvestorAbsorptionBucket {
  investorSector: string;
  baselineSharePct: number;
  stressedAbsorptionPctGdp: number;
  maxCapacityLimitPctGdp: number;
  crowdingOutOrConstraintNote: string;
}

export interface ImfSrdsfGfnResult {
  totalGfnPctGdp: number;
  imfEmDistressThresholdPctGdp: number; // 15% GDP for EM, 20% for AM
  gfnExcessOverThresholdPctGdp: number;
  srdsfRiskZone: 'LOW_ROLLOVER_RISK' | 'MODERATE_STRESS' | 'HIGH_ROLLOVER_CRISIS';
  sovereignBankDoomLoopCet1DepletionBps: number;
  postStressBankCet1RatioPct: number;
  centralBankMonetizationResidualPctGdp: number;
  conclusionHeadline: string;
  gfnComponents: GfnComponentItem[];
  investorAbsorptionMatrix: InvestorAbsorptionBucket[];
}

export interface EconometricForecastSuite {
  stochasticDsa: StochasticDebtSimulationResult;
  bvarIrf: BvarIrfModelResult;
  garFarTail: GarFarTailResult;
  nssTermStructure: NssTermStructureResult;
  markovEws: MarkovAndEwsResult;
  fiscalDominanceAndFxBurn: FiscalDominanceAndFxBurnResult;
  imfSrdsfGfn: ImfSrdsfGfnResult;
}

export type BacktestBenchmarkId = 'BLENDED_50_50' | 'EMBI_USD' | 'GBI_EM_LOCAL';

export type BacktestRegimeFilter =
  | 'ALL_REGIMES'
  | 'CRISIS_AND_SHOCK_ONLY'
  | 'CARRY_AND_RECOVERY';

export interface BacktestConfigState {
  benchmarkId: BacktestBenchmarkId;
  regimeFilter: BacktestRegimeFilter;
  enforceCroStopLoss: boolean;
  sizingMode: 'BRIER_WEIGHTED' | 'EQUAL_WEIGHT';
  leverageTarget: number; // 0.5, 1.0, 1.5
}

export interface BacktestEquityPoint {
  periodLabel: string;
  regimeTag: 'CARRY' | 'SHOCK' | 'RECOVERY';
  regimeEventDescription: string;
  strategyCumulativeReturnPct: number;
  benchmarkCumulativeReturnPct: number;
  cumulativeAlphaPct: number;
  periodStrategyReturnPct: number;
  periodBenchmarkReturnPct: number;
  periodAlphaBps: number;
  strategyDrawdownPct: number;
  benchmarkDrawdownPct: number;
}

export interface DeskAttributionMetrics {
  deskId: DeskId | 'supreme_council';
  deskName: string;
  leadAgentTitle: string;
  totalSignalsGenerated: number;
  winningSignals: number;
  losingSignals: number;
  hitRatePct: number;
  avgWinBps: number;
  avgLossBps: number;
  profitFactor: number;
  cumulativeAlphaContributionPct: number;
  alphaShareOfTotalPct: number;
  annualizedSharpe: number;
  informationRatio: number;
  maxDrawdownPct: number;
  brierCalibrationScore: number; // lower is better (e.g. 0.14), displayed alongside accuracy weight
  impliedVotingWeightPct: number;
  bestHistoricalCall: string;
}

export interface HistoricalTradeBlotterItem {
  ticketId: string;
  entryQuarter: string;
  exitQuarter: string;
  regimeContext: string;
  regimeTag: 'CARRY' | 'SHOCK' | 'RECOVERY';
  deskId: DeskId;
  deskName: string;
  originatingSubAgent: string;
  instrument: string;
  direction: 'LONG' | 'SHORT' | 'STEEPENER' | 'FLATTENER' | 'TAIL_HEDGE';
  sizingWeightPct: number;
  entryLevel: string;
  targetLevel: string;
  stopLevel: string;
  realizedExitLevel: string;
  executionOutcome: 'TARGET_HIT' | 'CRO_STOP_SAVED' | 'UNHEDGED_DRAWDOWN' | 'TACTICAL_GAIN';
  realizedPnlBps: number;
  realizedNavReturnPct: number;
  benchmarkPeriodReturnPct: number;
  netAlphaPct: number;
  tradeThesisAudit: string;
}

export interface StrategyBacktestResult {
  benchmarkId: BacktestBenchmarkId;
  benchmarkLabel: string;
  conclusionHeadline: string;
  horizonLabel: string;
  totalStrategyReturnPct: number;
  totalBenchmarkReturnPct: number;
  netCumulativeAlphaPct: number;
  annualizedAlphaPct: number;
  annualizedSharpeRatio: number;
  informationRatio: number;
  overallHitRatePct: number;
  overallProfitFactor: number;
  strategyMaxDrawdownPct: number;
  benchmarkMaxDrawdownPct: number;
  croDrawdownSavedPct: number;
  equityCurve: BacktestEquityPoint[];
  deskAttribution: DeskAttributionMetrics[];
  tradeBlotter: HistoricalTradeBlotterItem[];
}

export type PortfolioExpressionType =
  | 'LOCAL_RATES_RECEIVER'
  | 'USD_EUROBOND_LONG'
  | 'CDS_5Y_PROTECTION'
  | 'CURVE_2S10S_STEEPENER'
  | 'FX_HEDGED_LOCAL_CARRY';

export interface PortfolioPositionItem {
  iso3: string;
  countryName: string;
  currencyCode: string;
  expressionType: PortfolioExpressionType;
  weightNavPct: number; // e.g., 25% of NAV
}

export interface PortfolioRiskMandateConfig {
  portfolioNavUsdMillions: number; // e.g., 250 ($250M book)
  maxPortfolioDv01UsdThousands: number; // e.g., 180 ($180k/bp)
  maxSingleCountryCs01UsdThousands: number; // e.g., 85 ($85k/bp)
  maxCvar99PctNav: number; // e.g., 4.5% of NAV
}

export interface KeyRateBucketExposure {
  tenorBucket: '2Y' | '5Y' | '10Y' | '30Y';
  rateDv01UsdThousands: number; // $/bp in thousands
  creditCs01UsdThousands: number; // $/bp in thousands
  mandateBucketLimitUsdThousands: number;
  netCarryBps: number;
}

export interface PortfolioPositionRiskContribution {
  iso3: string;
  countryName: string;
  currencyCode: string;
  expressionType: PortfolioExpressionType;
  weightNavPct: number;
  notionalUsdMillions: number;
  rateDv01UsdThousands: number;
  creditCs01UsdThousands: number;
  standaloneVolAnnualPct: number;
  mctrPctNav: number; // Marginal Contribution to Total Risk (% NAV)
  componentCvarPctNav: number; // Absolute contribution to 99% CVaR (% NAV)
  componentRiskSharePct: number; // % share of total portfolio tail risk (sums to 100%)
  liquidityDaysToLiquidate: number;
  stressedBidAskCostBps: number;
  breachesSingleCountryCs01: boolean;
}

export interface ContagionMatrixRow {
  iso3: string;
  countryName: string;
  correlations: { targetIso3: string; rho: number }[];
  betaUs10YReal50Bps: number; // Spread/Return impact in bps for +50bps US 10Y real yield shock
  betaDxyPlus5Pct: number; // Impact in bps for +5% DXY shock
  betaBrentPlus20Usd: number; // Impact in bps for +$20/bbl oil shock
  betaChinaPmiMinus2Pts: number; // Impact in bps for -2pt China PMI shock
  compositeShockPnlUsdThousands: number;
}

export interface PortfolioTailRiskResult {
  conclusionHeadline: string;
  portfolioNavUsdMillions: number;
  grossExposurePct: number;
  totalNetRateDv01UsdThousands: number;
  totalNetCreditCs01UsdThousands: number;
  parametricVar95TenDayPct: number;
  cornishFisherVar99TenDayPct: number;
  expectedShortfallCvar99TenDayPct: number;
  expectedShortfallCvar99UsdMillions: number;
  liquidityAdjustedLvar99TenDayPct: number;
  liquidityHorizonDays: number;
  diversificationBenefitPct: number;
  dv01MandateUtilizationPct: number;
  cs01MaxSingleUtilizationPct: number;
  cvarMandateUtilizationPct: number;
  hasMandateBreach: boolean;
  keyRateBuckets: KeyRateBucketExposure[];
  positionContributions: PortfolioPositionRiskContribution[];
  contagionMatrix: ContagionMatrixRow[];
}

export interface RestructuringSimulationParams {
  exitYieldPct: number; // e.g., 11.5%
  principalHaircutPct: number; // e.g., 20%
  maturityExtensionYears: number; // e.g., 5 years
  couponReductionBps: number; // e.g., 150 bps
}

export interface SeniorityTrancheItem {
  trancheName: string;
  governingLaw: 'MULTILATERAL_PREFERRED' | 'OFFICIAL_BILATERAL' | 'NY_ENGLISH_LAW_CAC' | 'DOMESTIC_LOCAL_LAW';
  shareOfTotalDebtPct: number;
  cacVotingThresholdPct: number;
  assumedHaircutSensitivity: string;
  impliedRecoveryCents: number;
}

export interface RatingMigrationProfile {
  currentCompositeRating: string;
  ratingTierClassification: 'INVESTMENT_GRADE' | 'CROSSOVER_BB' | 'HIGH_YIELD_B' | 'DISTRESSED_CCC';
  notchesToIgThreshold: number; // positive = above IG cutoff, negative = below IG cutoff
  notchesToDistressedCutoff: number;
  probUpgrade12MPct: number;
  probStable12MPct: number;
  probDowngrade1Notch12MPct: number;
  probFallenAngelOrDefaultCliff12MPct: number;
  forcedIndexOutflowIfDowngradedUsdBn: number;
  indexMembershipStatus: string;
}

export interface CacHoldoutGameTheoryResult {
  icmaSingleLimb75SharePct: number;
  legacyDualLimbSharePct: number;
  noCacOrDomesticSharePct: number;
  blockingMinorityThresholdPct: number;
  singleSeriesBlockingCostUsdMillions: number;
  aggregatedSingleLimbBlockingCostUsdMillions: number;
  holdoutLitigationProbPct: number;
  officialCreditorCoordinationLagMonths: number;
  nashEquilibriumPayoffCents: number;
  holdoutExpectedNetPayoffCents: number;
  gameTheoryVerdict: string;
}

export interface RestructuringAndRatingResult {
  conclusionHeadline: string;
  currentBenchmarkBondPriceCents: number;
  currentContractualCouponPct: number;
  currentRemainingMaturityYears: number;
  restructuredNpvRecoveryCents: number;
  preRestructuringClaimCents: number;
  impliedNpvHaircutPct: number;
  marginOfSafetyVsMarketCents: number;
  cdsImplied1YDefaultProbPct: number;
  cdsImplied5YCumulativeDefaultProbPct: number;
  lossGivenDefaultLgdPct: number;
  seniorityWaterfall: SeniorityTrancheItem[];
  ratingMigration: RatingMigrationProfile;
  cacGameTheory: CacHoldoutGameTheoryResult;
}

export interface CouncilKellyTicketItem {
  ticketId: string;
  originatingDesk: string;
  instrument: string;
  direction: string;
  brierCalibratedWinProbPct: number;
  rewardToRiskPayoffRatio: number;
  fullKellyFractionPct: number;
  halfKellyNavAllocationPct: number;
  recommendedNotionalUsdMillions: number;
  allocatedDv01OrCs01UsdThousands: number;
  lobQuotedBidAskBps: number;
  lobMarketImpactSlippageBps: number;
  totalExecutionDragBps: number;
  optimalTwapExecutionDays: number;
  expectedGrossAlphaBps: number;
  netPostSlippageAlphaBps: number;
  executionFeasibilityStatus: 'IMMEDIATE_BLOCK' | 'TWAP_SLICED' | 'LIQUIDITY_CONSTRAINED';
}

export interface CouncilKellyLobExecutionResult {
  conclusionHeadline: string;
  compositeBrierConvictionPct: number;
  totalHalfKellyGrossNavPct: number;
  totalAllocatedNotionalUsdMillions: number;
  weightedExecutionSlippageBps: number;
  netPortfolioExpectedAlphaBps: number;
  dealerInventoryRegime: string;
  tickets: CouncilKellyTicketItem[];
}

export interface CrossCurrencyBasisPoint {
  tenor: '1Y' | '3Y' | '5Y' | '10Y';
  usdEurobondYieldPct: number;
  localSovereignYieldPct: number;
  fxForwardOrXccyHedgeCostPct: number;
  xccySwapBasisBps: number; // CIP deviation / cross-currency basis
  fxHedgedLocalYieldInUsdPct: number;
  netHedgedPickUpOverEurobondBps: number; // positive = FX-hedged local bond beats USD Eurobond
  optimalExpression: 'BUY_FX_HEDGED_LOCAL' | 'BUY_USD_EUROBOND';
}

export interface JurisdictionalLegalBasis {
  bondPairLabel: string;
  nyLawEurobondYieldPct: number;
  domesticLawEquivalentYieldPct: number;
  jurisdictionalLegalSpreadBps: number; // Protection premium for NY/English law vs local law
  onTheRunBidAskBps: number;
  stressedCrisisBidAskBps: number;
  avgDailyTurnoverUsdMillions: number;
  redenominationRiskAssessment: string;
}

export interface CrossCurrencyAndLegalResult {
  conclusionHeadline: string;
  fiveYearNetHedgedPickUpBps: number;
  fiveYearXccyBasisBps: number;
  preferredSovereignVehicle: string;
  basisCurve: CrossCurrencyBasisPoint[];
  legalAndLiquidity: JurisdictionalLegalBasis;
}

export interface GeopoliticalWargameParams {
  chokepointClosureSeverityPct: number; // 0 to 100%
  tariffEscalationPct: number; // 0 to 60%
  sanctionsAndClearingIntensity: number; // 0 to 100 index
  electoralAndUnrestShock: number; // 0 to 100 index
  cyberHybridIntensityPct?: number; // 0 to 100 index (Cyber & Subsea Infrastructure Attack)
}

export interface MaritimeChokepointImpact {
  corridorId: string;
  corridorName: string;
  primaryCommodities: string;
  sovereignTradeShareExposedPct: number;
  reroutingDelayDays: number;
  freightAndWarRiskSurgePct: number;
  importedCpiPassThroughBps: number;
  currentAccountImpactPctGdp: number;
  cds5YSpreadImpactBps: number;
  vulnerabilityStatus: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
  lat: number;
  lon: number;
  linkedSupplyChainIds: string[];
}

export interface ReserveCustodyTranche {
  custodyCategory: string;
  jurisdictionLabel: string;
  shareOfReservesPct: number;
  amountUsdBn: number;
  freezeVulnerability: 'HIGH_G7_EXPOSED' | 'MODERATE_MULTILATERAL' | 'IMMUNE_DOMESTIC_OR_NON_G7';
  effectiveHaircutUnderSanctionsPct: number;
}

export interface BilateralTariffExposure {
  partnerBloc: string;
  shareOfSovereignExportsPct: number;
  effectiveTariffRatePct: number;
  estimatedGdpDragBps: number;
  fxDepreciationPressurePct: number;
  keyVulnerableSectors: string;
}

export interface SanctionsAndReserveFreezeResult {
  conclusionHeadline: string;
  headlineReservesUsdBn: number;
  headlineImportCoverMonths: number;
  sanctionsInsulatedReservesUsdBn: number;
  sanctionsInsulatedImportCoverMonths: number;
  g7FreezeExposedSharePct: number;
  domesticGoldAndNonG7SharePct: number;
  paymentAgentTechnicalDefaultProbPct: number;
  clearingChannelAssessment: string;
  custodyTranches: ReserveCustodyTranche[];
  tariffExposures: BilateralTariffExposure[];
}

export interface ElectoralFragilityProfile {
  nextPoliticalCatalystLabel: string;
  preElectionFiscalSlippagePctGdp: number;
  coalitionCohesionScore: number; // 0 to 100 (higher = more stable)
  cbAndJudicialInsulationScore: number; // 0 to 100 (higher = more insulated)
  socialUnrestAndStrikeIntensity: number; // 0 to 100 (higher = more unrest)
  regimeContinuityProbPct: number;
}

export interface EscalationBranchNode {
  stageId: 'STAGE_1_CONTAINMENT' | 'STAGE_2_HYBRID_SANCTIONS' | 'STAGE_3_KINETIC_BLOCKADE';
  stageTitle: string;
  branchProbabilityPct: number;
  triggerConditions: string;
  local10YYieldDeltaBps: number;
  cds5YSpreadDeltaBps: number;
  spotFxDeltaPct: number;
  recommendedDeskAction: string;
}

export interface GprAndEscalationResult {
  conclusionHeadline: string;
  compositeGprZScore: number;
  gprThreatZScore: number; // Caldara-Iacoviello GPR Threats (rhetoric, warnings, Polymarket odds)
  gprActZScore: number; // Caldara-Iacoviello GPR Acts (realized kinetic/sanctions events)
  gdeltGoldsteinTone: number;
  expectedProbabilityWeightedCdsDeltaBps: number;
  electoralProfile: ElectoralFragilityProfile;
  escalationTree: EscalationBranchNode[];
}

export interface GeopoliticalTailHedgeItem {
  hedgeId: string;
  instrumentName: string;
  assetClass: 'COMMODITY_VOL' | 'SOVEREIGN_CDS' | 'FX_OPTIONS' | 'PRECIOUS_METALS' | 'SAFE_HAVEN_RATES';
  annualizedCarryCostBps: number; // negative = cost/bleed, positive = positive carry
  twoSigmaGprShockPayoffBps: number;
  convexityToCarryRatio: number; // Payoff / |Cost|
  correlationToSovereignDrawdown: number;
  recommendedAllocationPctNav: number;
  protectionMechanism: string;
}

export interface OsintConflictEvent {
  eventId: string;
  timestampUtc: string;
  sourceFeed: 'GDELT_2.0_CAMEO' | 'ACLED_CONFLICT' | 'OFAC_TREASURY' | 'LIVE_AI_OSINT';
  cameoCode: string;
  eventCategory: 'MARITIME_INTERDICTION' | 'SANCTIONS_ENFORCEMENT' | 'CIVIL_UNREST_PROTEST' | 'CYBER_INFRASTRUCTURE' | 'DIPLOMATIC_RUPTURE';
  headline: string;
  locationLabel: string;
  goldsteinScale: number; // -10.0 (extreme conflict) to +10.0 (cooperation)
  acledSeverityScore: number; // 0 to 100
  empiricalCdsImpactBps: number;
  empiricalFxImpactPct: number;
  verificationStatus: 'VERIFIED_PRIMARY' | 'MULTI_SOURCE_CORROBORATED' | 'ANALYST_INJECTED';
  lat: number;
  lon: number;
  linkedChokepointIds: string[];
  linkedSupplyChainIds: string[];
}

export interface DiplomaticBlocNode {
  blocName: string;
  ungaVotingAlignmentPct: number; // 0 to 100% voting coincidence
  idealPointDistance: number; // 0.0 (identical) to 3.0 (polar opposite)
  bilateralTradeSharePct: number;
  fdiStockSharePct: number;
  defenseAndSecurityTreatyStatus: string;
  secondarySanctionsSpilloverRisk: 'CRITICAL' | 'ELEVATED' | 'MODERATE' | 'LOW';
}

export interface DiplomaticAlignmentResult {
  conclusionHeadline: string;
  geoeconomicBlocClassification: 'US_G7_ANCHORED' | 'MULTI_ALIGNED_SWING_HEDGER' | 'EURASIAN_SCO_TILTED' | 'FRONTIER_CONTESTED';
  usG7IdealPointScore: number; // -1.0 to +1.0
  chinaScoIdealPointScore: number; // -1.0 to +1.0
  nonAlignedSwingLeverageScore: number; // 0 to 100
  friendShoringFdiNetBetaPctGdp: number; // positive = net beneficiary of nearshoring/friend-shoring
  secondarySanctionsContagionProbPct: number;
  blocTopology: DiplomaticBlocNode[];
}

export interface StrategicSupplyChainNode {
  chainId: string;
  commodityOrTechName: string;
  shortLabel: string;
  strategicCategory: 'SEMICONDUCTORS' | 'CRITICAL_MINERALS' | 'RENEWABLE_METALS' | 'HYDROCARBONS' | 'FOOD_FERTILIZER';
  sovereignPosition: 'NET_STRATEGIC_EXPORTER' | 'ACUTE_IMPORT_DEPENDENT' | 'BALANCED_PROCESSOR';
  netTradeBalancePctConsumption: number; // negative = import dependent, positive = net exporter
  globalSupplierHhiIndex: number; // >2500 = highly concentrated monopoly choke
  primarySupplierBloc: string;
  supplierHubLat: number;
  supplierHubLon: number;
  domesticStockpileDays: number;
  exportControlVulnerabilityScore: number; // 0 to 100
  stressedGdpImpactBps: number;
  stressedCpiImpactBps: number;
  isExportBanActive: boolean;
  linkedChokepointIds: string[];
  downstreamDomesticSectors: string;
}

export interface ChokepointCommodityCell {
  corridorId: string;
  corridorShortName: string;
  chainId: string;
  chainShortName: string;
  transitFlowDependencyPct: number; // 0 to 100% of commodity transiting this chokepoint
  stressedCpiImpactBps: number;
  stressedGdpImpactBps: number;
  severityTier: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
}

export interface UpstreamSupplyFlowLink {
  linkId: string;
  upstreamHubLabel: string;
  chokepointCorridorId: string;
  chokepointLabel: string;
  chainId: string;
  commodityLabel: string;
  domesticSectorLabel: string;
  flowVolumeSharePct: number;
  stressedBottleneckScore: number; // 0 to 100
}

export interface StrategicSupplyChainResult {
  conclusionHeadline: string;
  aggregateSupplyChainVulnerabilityScore: number;
  exportRetaliationLeverageScore: number;
  totalSupplyShockGdpDragBps: number;
  totalSupplyShockCpiPassThroughBps: number;
  supplyChainNodes: StrategicSupplyChainNode[];
  chokepointCommodityMatrix: ChokepointCommodityCell[];
  upstreamFlowLinks: UpstreamSupplyFlowLink[];
}

export interface SubseaCableRouteArc {
  cableId: string;
  cableName: string;
  landingStationLabel: string;
  startLat: number;
  startLon: number;
  midLat: number;
  midLon: number;
  endLat: number;
  endLon: number;
  bandwidthSharePct: number;
  status: 'OPERATIONAL' | 'DEGRADED_LATENCY' | 'CHOKED_ALERT';
  linkedChokepointId: string;
}

export interface BilateralTradeCorridorArc {
  corridorId: string;
  partnerName: string;
  partnerLat: number;
  partnerLon: number;
  tradeSharePct: number;
  effectiveTariffPct: number;
  primaryGoods: string;
  linkedSupplyChainIds: string[];
}

export interface CyberInfrastructureVector {
  vectorId: string;
  infrastructureDomain: 'SUBSEA_CABLES_SWIFT' | 'POWER_GRID_SCADA' | 'CENTRAL_BANK_RTGS' | 'PORT_CUSTOMS_LOGISTICS';
  domainName: string;
  redundancyScore: number; // 0 to 100 (higher = more resilient)
  chokeConcentrationMetric: string;
  activeThreatActorProfile: string;
  attackProbabilityPct: number;
  estimatedDailyGdpLossUsdMillions: number;
  bankingLiquidityFreezeHours: number;
  vulnerabilityTier: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
}

export interface CyberVulnerabilityResult {
  conclusionHeadline: string;
  compositeCyberFragilityScore: number; // 0 to 100
  subseaCableRedundancyCount: number;
  powerGridReserveMarginPct: number;
  stressed7DayHybridAttackGdpDragBps: number;
  stressedBankingSpreadWideningBps: number;
  vectors: CyberInfrastructureVector[];
}

export interface GeoPortfolioTransmissionRow {
  iso3: string;
  countryName: string;
  currencyCode: string;
  weightNavPct: number;
  notionalUsdMillions: number;
  geopoliticalSpilloverBeta: number;
  projectedCdsWideningBps: number;
  projectedFxMovePct: number;
  projectedLocalYieldMoveBps: number;
  unhedgedStressPnlUsdThousands: number;
  unhedgedStressReturnBpsNav: number;
}

export interface GeoPortfolioTransmissionSummary {
  conclusionHeadline: string;
  portfolioNavUsdMillions: number;
  totalUnhedgedGeoStressPnlUsdThousands: number;
  totalUnhedgedGeoStressPctNav: number;
  tailHedgeOffsetPnlUsdThousands: number;
  netHedgedGeoStressPnlUsdThousands: number;
  netHedgedGeoStressPctNav: number;
  baselineCvar99PctNav: number;
  geoStressedCvar99PctNav: number;
  propagatedForecastShocks: {
    realRateShockBps: number;
    realGdpGrowthShockPct: number;
    primaryBalanceShockPctGdp: number;
    fxDepreciationShockPct: number;
    externalVolatilityMultiplier: number;
  };
  positionTransmissions: GeoPortfolioTransmissionRow[];
}

export interface GeopoliticalRiskDeskSuite {
  wargameParams: GeopoliticalWargameParams;
  sovereignCoord: { lat: number; lon: number; capitalLabel: string };
  chokepointConclusionHeadline: string;
  totalExposedMaritimeTradePct: number;
  aggregateChokepointCpiPassThroughBps: number;
  aggregateChokepointCdsImpactBps: number;
  chokepoints: MaritimeChokepointImpact[];
  sanctionsAndReserves: SanctionsAndReserveFreezeResult;
  gprAndEscalation: GprAndEscalationResult;
  tailHedgeConclusionHeadline: string;
  topRankedHedgeInstrument: string;
  tailHedges: GeopoliticalTailHedgeItem[];
  // Tier-1 Institutional Upgrade Modules
  osintEventStreamHeadline: string;
  osintEvents: OsintConflictEvent[];
  diplomaticAlignment: DiplomaticAlignmentResult;
  strategicSupplyChain: StrategicSupplyChainResult;
  cyberVulnerability: CyberVulnerabilityResult;
  portfolioTransmission: GeoPortfolioTransmissionSummary;
  subseaCableRoutes: SubseaCableRouteArc[];
  bilateralTradeCorridors: BilateralTradeCorridorArc[];
}

export interface SupplyChainShockParams {
  upstreamExportQuotaCutPct: number; // 0 to 80%
  maritimeRoutingDelayDays: number; // 0 to 30 days
  inventoryBurnMultiplier: number; // 0.5x to 2.5x
  importSubstitutionElasticityPct: number; // 0 to 60%
}

export interface LeontiefSectorNode {
  sectorId: string;
  sectorName: string;
  shortCode: string;
  shareOfDomesticGvaPct: number;
  importedInputReliancePct: number;
  backwardLinkageMultiplier: number; // Column sum of (I - A)^-1
  forwardLinkageMultiplier: number; // Row sum of (I - A)^-1
  stressedOutputContractionPct: number;
  stressedProducerPriceSpikeBps: number;
  bottleneckStatus: 'CRITICAL_CHOKE' | 'HIGH_CASCADE' | 'MODERATE' | 'BUFFER_RESILIENT';
}

export interface LeontiefCell {
  supplierSectorId: string;
  supplierShortCode: string;
  consumingSectorId: string;
  consumingShortCode: string;
  directTechnicalCoeffAij: number; // 0.00 to 0.55
  totalRequirementMultiplierLij: number; // element of (I - A)^-1
  stressedCascadeLossBpsGdp: number;
  tier: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
}

export interface BilateralCriticalInputRow {
  corridorId: string;
  partnerCountryOrBloc: string;
  criticalInputsSupplied: string;
  sovereignImportSharePct: number;
  globalSupplierHhi: number;
  exportControlRegime: string;
  domesticSubstitutionLagMonths: number;
  bilateralRetaliationLeverageScore: number; // 0 to 100
  stressedAnnualImportBillDeltaUsdBn: number;
  riskClassification: 'MONOPOLY_CHOKE' | 'STRATEGIC_DEPENDENCY' | 'DIVERSIFIED';
}

export interface StockpileDepletionSeries {
  inputId: string;
  inputLabel: string;
  initialStockpileDays: number;
  dailyBurnRateNormalDays: number;
  stressedDepletionHorizonDay: number; // Day T* when buffer hits 0 or critical 15d floor
  breachesCritical15DayFloor: boolean;
  points: { day: number; remainingDaysBuffer: number }[];
}

export interface IbSectorImpactRow {
  sectorId: string;
  sectorName: string;
  ebitdaMarginCompressionBps: number;
  corporateCreditSpreadWideningBps: number;
  evToEbitdaMultipleImpactPct: number;
  workingCapitalFacilityNeedUsdMillions: number;
  ibCapexAndMaAdvisoryMandate: string;
  hedgeFundTradeExpression: string;
}

export interface InstitutionalSupplyChainMatrixSuite {
  shockParams: SupplyChainShockParams;
  embargoedInputIds: string[];
  leontiefConclusionHeadline: string;
  aggregateLeontiefMultiplier: number;
  totalEconomyOutputContractionPctGdp: number;
  totalSupplyChainPpiPassThroughBps: number;
  earliestProductionHaltDay: number;
  mostVulnerableInputLabel: string;
  totalIbWorkingCapitalNeedUsdMillions: number;
  leontiefSectors: LeontiefSectorNode[];
  leontiefMatrix: LeontiefCell[];
  bilateralCriticalInputs: BilateralCriticalInputRow[];
  depletionTrajectories: StockpileDepletionSeries[];
  ibSectorImpacts: IbSectorImpactRow[];
}

export type LiquidityCrisisPresetId =
  | 'baseline'
  | 'gfc_2008'
  | 'euro_2011'
  | 'repo_2019'
  | 'covid_2020'
  | 'custom';

export interface LiquidityStressParams {
  presetId: LiquidityCrisisPresetId;
  usdBasisSqueezeBps: number; // 0 to 150 bps widening in offshore USD basis
  interbankFraOisShockBps: number; // 0 to 120 bps widening in LIBOR/FRA-OIS & GC Repo-SOFR
  fedQtAndTgaDrainUsdBn: number; // 0 to 1000 $Bn reserve drain
  gsibTurnWindowDressingMultiplier: number; // 1.0x to 2.5x balance-sheet scarcity multiplier
}

export interface XccyTermStructurePoint {
  tenor: '1M' | '3M' | '6M' | '1Y' | '2Y' | '5Y' | '10Y';
  baselineBasisBps: number;
  stressedBasisBps: number;
  cipImpliedUsdRatePct: number;
  hedgedUstPickupBps: number;
}

export interface CurrencyFundingCorridorRow {
  corridorId: string;
  currencyCode: string;
  pairLabel: string;
  sovereignLabel: string;
  regionGroup: 'G10' | 'EM';
  isTargetSovereign: boolean;
  spotRateVsUsd: number;
  domesticPolicyRatePct: number;
  domestic10YBondYieldPct: number;
  rfrBenchmarkName: string; // e.g., ESTR, TONA, SONIA, SARON, CORRA, AONIA, SHIBOR, TIIE, MIBOR, JIBAR
  xccyBasis3MBps: number;
  xccyBasis1YBps: number;
  xccyBasis5YBps: number;
  baselineXccyBasis3MBps: number;
  liborOrFraOisSpreadBps: number;
  rfrOisSpreadBps: number;
  repoHaircutPct: number;
  cbSwapOrRepoDrawUsdBn: number;
  cipArbitragePickupBps: number; // FX-hedged 3M/1Y UST vs Local Sovereign Bond yield pickup (bps)
  syntheticUsdBorrowingCostPct: number; // Implied USD funding cost via FX swap
  compositeStressZScore: number; // -1.0 to +4.5
  regimeStatus: 'AMPLE_LIQUIDITY' | 'TURN_PRESSURE' | 'FUNDING_SQUEEZE' | 'ACUTE_DOLLAR_SHORTAGE';
  termStructurePoints: XccyTermStructurePoint[];
  deskTradeExpression: string;
}

export interface CentralBankLiquidityFacilityRow {
  facilityId: string;
  centralBank: string;
  facilityName: string;
  tickerCode: string;
  policyRatePct: number;
  currentUsageUsdBn: number;
  stressedUsageUsdBn: number;
  capacityLimitLabel: string;
  utilizationPctOfCap: number;
  collateralAccepted: string;
  counterpartyScope: string;
  reserveScarcitySignal: 'ABUNDANT' | 'AMPLE' | 'SCARCE' | 'CRITICAL_DRAIN';
  plumbingNotes: string;
}

export interface GlobalLiquidityPortfolioTransmission {
  targetSovereignExternalRolloverSpreadDeltaBps: number;
  targetSovereignFxHedgeCarryCostPct: number;
  targetSovereignSyntheticUsdCostPct: number;
  portfolioFundingLvarDeltaPctNav: number;
  estimatedMarginCallBufferUsdMillions: number;
  ibTreasuryAdvisoryMandate: string;
  hfRelativeValueArbitrageTrade: string;
}

export interface GlobalLiquidityFundingSuite {
  stressParams: LiquidityStressParams;
  headlineConclusion: string;
  globalLiquidityStressIndexZScore: number;
  usSofrRatePct: number;
  usEffrRatePct: number;
  usGcRepoRatePct: number;
  us3mFraOisSpreadBps: number;
  usSofrEffrSpreadBps: number;
  usGcRepoSofrSpreadBps: number;
  fedNetLiquidityImpulseUsdTn: number;
  fedBankReservesUsdTn: number;
  fedOnRrpBalanceUsdBn: number;
  fedSrfDrawsUsdBn: number;
  fedFimaDrawsUsdBn: number;
  fedSwapLinesTotalUsdBn: number;
  corridors: CurrencyFundingCorridorRow[];
  centralBankFacilities: CentralBankLiquidityFacilityRow[];
  portfolioTransmission: GlobalLiquidityPortfolioTransmission;
}

export type MarketMakerBookId = 'AVELLANEDA_STOIKOV_MM' | 'CIP_BASIS_ARB' | 'SOVEREIGN_FX_CARRY';

export interface MarketMakerStrategyConfig {
  bookAumUsdMillions: number; // e.g., $500M
  grossLeverageMultiplier: number; // 1.0x to 8.0x
  avellanedaRiskAversionGamma: number; // 0.05 (aggressive) to 1.00 (defensive)
  inventorySkewPct: number; // -80% (net short inventory) to +80% (net long inventory)
  orderArrivalIntensityKappa: number; // 0.5 to 3.0 (liquidity depth / order flow arrival rate)
  mmBookWeightPct: number; // e.g., 35%
  cipArbBookWeightPct: number; // e.g., 40%
  carryBookWeightPct: number; // e.g., 25%
  fundingLegCurrency: 'USD' | 'JPY' | 'CHF' | 'EUR';
  autoDeleverageOnMarginCall: boolean;
}

export interface StrategyBookSummary {
  bookId: MarketMakerBookId;
  bookName: string;
  modelSpecification: string;
  allocatedNotionalUsdMillions: number;
  weightPct: number;
  grossAlphaBps: number;
  fundingAndRepoDragBps: number;
  squeezeMtmAndSlippageDragBps: number;
  netAlphaBps: number;
  netPnlUsdMillions: number;
  baselineAnnualizedSharpe: number;
  stressedAnnualizedSharpe: number;
  primaryRiskDriver: string;
}

export interface PnLWaterfallStep {
  stepId: string;
  label: string;
  category: 'GROSS_ALPHA' | 'FUNDING_DRAG' | 'SQUEEZE_MTM' | 'NET_TOTAL';
  valueUsdMillions: number;
  valueBpsOfAum: number;
  cumulativeUsdMillions: number;
  driverDetail: string;
}

export interface StrategyEquityCurveDay {
  day: number;
  dayLabel: string;
  baselineCumulativePnlUsdM: number;
  baselineCumulativeReturnPct: number;
  stressedCumulativePnlUsdM: number;
  stressedCumulativeReturnPct: number;
  marginUtilizationPct: number;
  dailyFundingDragUsdM: number;
}

export interface CorridorStrategyAlphaRow {
  corridorId: string;
  pairLabel: string;
  sovereignLabel: string;
  regionGroup: 'G10' | 'EM';
  isTargetSovereign: boolean;
  dominantBook: MarketMakerBookId;
  dominantBookLabel: string;
  notionalAllocationUsdM: number;
  reservationSpreadAdjustBps: number;
  optimalHalfSpreadBps: number;
  quotedBidAskSpreadBps: number;
  cipBasisPickupBps: number;
  netCarryDifferentialBps: number;
  repoAndFundingDragBps: number;
  squeezeBasisMtmShockBps: number;
  netStrategyReturnBps: number;
  netStrategyPnlUsdM: number;
  stressedSharpeRatio: number;
  dv01UsdThousands: number;
  fxDeltaUsdMillions: number;
  inventorySkewPositionPct: number;
  executionSignal: 'PROVIDE_DEPTH' | 'HARVEST_CIP_BASIS' | 'LONG_CARRY' | 'WIDEN_QUOTES_DEFENSIVE' | 'DELEVERAGE_STOP';
}

export interface MarginAndStopOutTelemetry {
  initialMarginRequiredUsdM: number;
  variationMarginCallUsdM: number;
  repoHaircutEncumbranceUsdM: number;
  totalEncumberedCapitalUsdM: number;
  unencumberedCashBufferUsdM: number;
  marginUtilizationPctOfAum: number;
  effectiveLeverageAfterHaircut: number;
  stopOutThresholdPct: number;
  distanceToStopOutPct: number;
  marginStatus: 'NOMINAL_BUFFER' | 'ELEVATED_ENCUMBRANCE' | 'MARGIN_WARNING' | 'STOP_OUT_DELEVERAGING';
  primeBrokerDiagnostic: string;
}

export interface MarketMakerSimulationSuite {
  config: MarketMakerStrategyConfig;
  headlineConclusion: string;
  grossNotionalUsdMillions: number;
  baseline30DayNetPnlUsdM: number;
  stressed30DayNetPnlUsdM: number;
  fundingSqueezePnlImpactUsdM: number;
  stressedAnnualizedReturnPct: number;
  baselineSharpeRatio: number;
  stressedSharpeRatio: number;
  avgOptimalBidAskSpreadBps: number;
  adverseSelectionRatioPct: number;
  books: StrategyBookSummary[];
  waterfall: PnLWaterfallStep[];
  equityCurve30D: StrategyEquityCurveDay[];
  corridorPositions: CorridorStrategyAlphaRow[];
  marginTelemetry: MarginAndStopOutTelemetry;
}

export type PipelineNodeId =
  | 'STAGE_0_LIVE_DATA'
  | 'STAGE_1_GEO_DESK'
  | 'STAGE_1_SOV_DESK'
  | 'STAGE_1_MACRO_DESK'
  | 'STAGE_2_CONTAGION_CASCADE'
  | 'STAGE_3_SUPREME_COUNCIL';

export type PipelineNodeStatus =
  | 'VERIFIED_AI'
  | 'RETRY_RECOVERED'
  | 'QUANT_ANCHOR_FALLBACK'
  | 'AWAITING_GATE';

export interface PipelineStageTelemetry {
  nodeId: PipelineNodeId;
  stageLabel: string;
  agentsCovered: string[];
  status: PipelineNodeStatus;
  latencyMs: number;
  retriesUsed: number;
  schemaVerified: boolean;
  quantitativeAnchorScore?: number;
  rawModelScore?: number;
  finalBoundedScore?: number;
  anchorDriftClamped?: boolean;
  diagnosticNote: string;
}

export interface CouncilPipelineTelemetry {
  pipelineRunId: string;
  executedAt: string;
  totalLatencyMs: number;
  overallReliabilityScorePct: number;
  activeProvider: string;
  searchGroundingSourcesCount: number;
  stages: PipelineStageTelemetry[];
}

// ============================================================================
// TIER-6 PORTFOLIO, DMO FUNDING & POLICY DOCUMENT INTELLIGENCE SUITE
// ============================================================================

export interface EmbiSovereignPosition {
  iso3: string;
  countryName: string;
  region: string;
  creditRating: string;
  isCurrentActiveSovereign: boolean;
  embiBenchmarkWeightPct: number;
  activePortfolioWeightPct: number;
  activeTiltBps: number; // (active - benchmark) * 100
  cds5YSpreadBps: number;
  eurobond10YZSpreadBps: number;
  local10YYieldPct: number;
  debtToGdpPct: number;
  fxReservesMonths: number;
  empiricalBetaToEmbi: number;
  modifiedDurationYears: number;
  spreadDurationYears: number;
  expected12MTotalReturnPct: number;
  annualizedCarryAndRollBps: number;
  tailCvar99ContributionPct: number;
  convictionSignal: 'OVERWEIGHT_CONVICTION' | 'BENCHMARK_NEUTRAL' | 'UNDERWEIGHT_DEFENSIVE' | 'SHORT_CREDIT_HEDGE';
}

export interface CrossSovereignPairTrade {
  pairId: string;
  longIso3: string;
  longCountryName: string;
  shortIso3: string;
  shortCountryName: string;
  instrumentType: '5Y_USD_CDS' | '10Y_USD_EUROBOND' | '5Y_LOCAL_LCY_BOND';
  longLegSpreadOrYieldBps: number;
  shortLegSpreadOrYieldBps: number;
  currentSpreadDifferentialBps: number;
  historical12MMeanSpreadBps: number;
  historical12MStdDevBps: number;
  currentSpreadZScore: number;
  empiricalHedgeRatioBeta: number; // Cov(dS_long, dS_short) / Var(dS_short)
  longLegWeightPct: number;
  shortLegBetaHedgedWeightPct: number;
  netSpreadDurationContributionYrs: number;
  annualizedNetCarryPickupBps: number;
  meanReversionTargetBps: number;
  stopLossTriggerBps: number;
  expected90DReturnBps: number;
  pairRationale: string;
  history12M: {
    monthLabel: string;
    spreadDiffBps: number;
    meanSpreadBps: number;
    upper2SigmaBps: number;
    lower2SigmaBps: number;
    zScore: number;
  }[];
}

export interface EmbiPortfolioAndPairBookResult {
  headlineSummary: string;
  benchmarkWeightedSpreadBps: number;
  activePortfolioWeightedSpreadBps: number;
  exAnteTrackingErrorBps: number;
  portfolioBetaToEmbi: number;
  portfolioModifiedDurationYears: number;
  portfolioSpreadDurationYears: number;
  weightedCarryToVolRatio: number;
  parametricVaR99Pct: number;
  cornishFisherCvar99Pct: number;
  positions: EmbiSovereignPosition[];
  activePairTrade: CrossSovereignPairTrade;
  presetPairIdeas: {
    pairId: string;
    label: string;
    longIso3: string;
    shortIso3: string;
    instrumentType: '5Y_USD_CDS' | '10Y_USD_EUROBOND' | '5Y_LOCAL_LCY_BOND';
  }[];
}

export interface TreasuryFundingMixParams {
  shortTermTBillsPct: number; // 91d / 364d T-Bills
  mediumLongLocalBondsPct: number; // 5Y / 10Y Fixed Local Bonds
  usdEurobondsPct: number; // Hard-Currency Eurobonds
  sukukAndSyndicatedLoansPct: number; // Domestic Sukuk & Commercial Bank Syndications
  officialImfAndBilateralPct: number; // Concessional IMF EFF/RSF & Bilateral Tranches
}

export interface MonthlyTreasuryAuctionPoint {
  monthIndex: number;
  monthLabel: string; // M+1 .. M+24
  calendarQuarter: string;
  grossFinancingNeedPctGdp: number;
  primaryDeficitComponentPctGdp: number;
  maturingTBillRolloverPctGdp: number;
  bondAndEurobondAmortizationPctGdp: number;
  domesticIssuanceSupplyPctGdp: number;
  externalAndOfficialSupplyPctGdp: number;
  simulatedBidToCoverRatio: number; // e.g., 2.45x down to 1.05x
  auctionClearingTailBps: number; // clearing yield minus WI mid (bps)
  marginalDomesticClearingYieldPct: number;
  domesticBankSovereignHoldingsPctTier1: number;
  privateCreditCrowdingOutIndex: number; // 0 to 100
  cumulativeUncoveredFundingGapPctGdp: number;
  auctionStatus: 'WELL_COVERED' | 'TAIL_WIDENING' | 'UNDERSUBSCRIBED_STRESS';
}

export interface TreasuryAuctionRolloverResult {
  normalizedMix: TreasuryFundingMixParams;
  headlineDiagnostic: string;
  total24MGrossFinancingNeedPctGdp: number;
  annualizedGfnPctGdp: number;
  weightedAverageCostOfBorrowingPct: number;
  baselineWacbPct: number;
  wacbDeltaBps: number;
  weightedAverageMaturityYears: number;
  averageBidToCoverRatio: number;
  minBidToCoverRatio: number;
  peakAuctionTailBps: number;
  peakBankSovereignExposurePctTier1: number;
  cumulative24MUncoveredGapPctGdp: number;
  crowdingOutSeverity: 'LOW_ABSORPTION_STRESS' | 'MODERATE_CROWDING_OUT' | 'SEVERE_DOOM_LOOP_SATURATION';
  monthlySchedule: MonthlyTreasuryAuctionPoint[];
}

export type PolicyDocumentCategory =
  | 'MPC_MONETARY_STATEMENT'
  | 'IMF_ARTICLE_IV_STAFF_REPORT'
  | 'EUROBOND_CAC_PROSPECTUS';

export interface ExtractedPolicyClause {
  clauseId: string;
  categoryLabel: string;
  verbatimQuote: string;
  quantitativeMetricExtracted: string;
  directionalSignal: 'HAWKISH_TIGHTENING' | 'DOVISH_ACCOMMODATIVE' | 'FISCAL_CONSOLIDATION' | 'FISCAL_SLIPPAGE_RISK' | 'CREDITOR_FRIENDLY' | 'RESTRUCTURING_RISK';
  impactScoreBps: number;
  confidencePct: number;
}

export interface CalibratedPolicyShockVector {
  policyRateDeltaBps: number;
  primaryFiscalBalanceDeltaPctGdp: number;
  sovereignSpreadShockBps: number;
  energyAndCpiShockPct: number;
  fxReserveAdequacyDeltaMonths: number;
  politicalWillDeltaPoints: number;
  rationaleSummary: string;
}

export interface PolicyDocumentAnalysisResult {
  documentTitle: string;
  documentCategory: PolicyDocumentCategory;
  analyzedAt: string;
  providerUsed: string;
  isAiEnhanced: boolean;
  executiveSynthesis: string;
  hawkishDovishStanceScore: number; // -100 (Ultra-Dovish) to +100 (Ultra-Hawkish)
  monetaryStanceLabel: string;
  fiscalSlippageRiskScore: number; // 0 (Strict Rule Compliance) to 100 (Severe Slippage)
  imfProgramTrancheDisbursementProbPct: number; // 0 to 100%
  taylorRuleImpliedPolicyRatePct: number;
  actualPolicyRateGapBps: number;
  cacVotingThresholdType: string;
  extractedClauses: ExtractedPolicyClause[];
  calibratedShockVector: CalibratedPolicyShockVector;
}

// ============================================================================
// TIER-7 DECISION COMMAND CENTER & INSTITUTIONAL EDGE SUITE (ZERO NOTIONAL)
// ============================================================================

export interface SovereignDislocationRow {
  iso3: string;
  countryName: string;
  region: string;
  currencyCode: string;
  isCurrentActiveSovereign: boolean;
  market5YCdsSpreadBps: number;
  fundamentalFair5YCdsSpreadBps: number;
  dislocationSpreadGapBps: number; // Market CDS - Fundamental Fair CDS (positive = market cheap/oversold)
  dislocationZScore: number;
  marketImplied5YDefaultProbPct: number; // 1 - exp(-5 * lambda_market)
  econometric5YDefaultProbPct: number; // 1 - exp(-5 * lambda_model)
  defaultProbGapPct: number; // Market PD - Econometric PD
  local10YYieldPct: number;
  debtToGdpPct: number;
  fxReservesMonths: number;
  realPolicyRatePct: number;
  convictionRank: number;
  actionableSignal:
    | 'DISTRESSED_OVERSHOOT_BUY_CREDIT'
    | 'FAIRLY_PRICED_CARRY_HOLD'
    | 'COMPLACENT_MARKET_BUY_CDS_PROTECTION';
  tradeExpressionSummary: string;
}

export interface CrossSovereignDislocationScreenerResult {
  headlineConclusion: string;
  topLongCreditOpportunity: SovereignDislocationRow;
  topShortProtectionOpportunity: SovereignDislocationRow;
  universeMeanSpreadGapBps: number;
  universeCrossSectionalDispersionBps: number;
  rows: SovereignDislocationRow[];
}

export interface PreMortemFailureBranch {
  branchId: string;
  pathwayTitle: string;
  failureCategory:
    | 'FISCAL_IMF_PROGRAM_RUPTURE'
    | 'FX_RESERVE_XCCY_SUDDEN_STOP'
    | 'GEOPOLITICAL_CHOKEPOINT_CONTAGION';
  conditionalProbabilityPct: number;
  causalChainNarrative: string;
  projected5YCdsWideningBps: number;
  projected10YLocalYieldSpikeBps: number;
  projectedSpotFxDepreciationPct: number;
  primaryEarlyWarningLeadIndicator: string;
  preEmptiveMitigationAction: string;
}

export interface KillSwitchTripwireItem {
  tripwireId: string;
  indicatorLabel: string;
  domain: 'CREDIT_CDS' | 'FX_RESERVES' | 'LOCAL_RATES' | 'DOLLAR_FUNDING' | 'GEOPOLITICAL_OSINT';
  currentLiveReading: string;
  hardStopThreshold: string;
  distanceToTriggerLabel: string;
  bufferConsumptionPct: number; // 0% (well clear) to 100% (breached)
  tripwireStatus: 'ARMED_SAFE' | 'WARNING_BUFFER_THIN' | 'KILL_SWITCH_BREACHED';
  automatedExecutionProtocol: string;
}

export interface CognitiveBiasGuardrailItem {
  biasId: string;
  biasName: string;
  diagnosticQuestion: string;
  quantitativeRealityCheck: string;
  guardrailStatus: 'VERIFIED_ANCHORED' | 'ELEVATED_BIAS_RISK';
}

export interface PreMortemAndKillSwitchResult {
  headlineSummary: string;
  activeStanceAssumed: string;
  aggregate90DFailureProbPct: number;
  expectedTailDrawdownBps: number;
  breachedTripwiresCount: number;
  warningTripwiresCount: number;
  failureBranches: PreMortemFailureBranch[];
  killSwitchTripwires: KillSwitchTripwireItem[];
  cognitiveBiasChecklist: CognitiveBiasGuardrailItem[];
}

export type DecisionThesisDirection =
  | 'LONG_SOVEREIGN_CREDIT'
  | 'SHORT_CREDIT_BUY_CDS'
  | 'LONG_LCY_RATES_RECEIVER'
  | 'SHORT_FX_TACTICAL_HEDGE';

export interface DecisionLedgerEntry {
  entryId: string;
  loggedAt: string;
  iso3: string;
  countryName: string;
  direction: DecisionThesisDirection;
  thesisRationale: string;
  entry5YCdsBps: number;
  entry10YYieldPct: number;
  assigned90DCrisisProbPct: number;
  targetSpreadDeltaBps: number;
  hardStopSpreadDeltaBps: number;
  invalidationTriggerNote: string;
}

export interface EvaluatedDecisionLedgerRow extends DecisionLedgerEntry {
  currentLive5YCdsBps: number;
  currentLive10YYieldPct: number;
  realizedSpreadChangeBps: number;
  directionalPerformanceBps: number; // positive = winning thesis in bps
  progressToTargetPct: number;
  realizedCrisisOutcomeBinary: 0 | 1;
  entryBrierScore: number; // (p - o)^2
  thesisHealthStatus:
    | 'TARGET_ACHIEVED'
    | 'THESIS_INTACT'
    | 'DRIFTING_WATCH'
    | 'STOP_TRIGGERED_INVALIDATED';
}

export interface BrierCalibrationBucket {
  bucketLabel: string;
  forecastProbPct: number;
  observedFrequencyPct: number;
  perfectCalibrationPct: number;
  sampleWeight: number;
}

export interface DecisionLedgerSummaryMetrics {
  headlineDiagnostic: string;
  totalLoggedDecisions: number;
  directionalHitRatePct: number;
  cumulativeNetPerformanceBps: number;
  meanPerformancePerCallBps: number;
  compositeBrierScore: number; // 0.00 (perfect) to 0.25 (random coin flip)
  brierSkillScorePct: number; // 1 - BS / BS_climatology
  evaluatedRows: EvaluatedDecisionLedgerRow[];
  calibrationCurve: BrierCalibrationBucket[];
}

export type MacroQuadrantId =
  | 'Q1_STAGFLATIONARY_SUPPLY_SHOCK'
  | 'Q2_USD_LIQUIDITY_TERM_SQUEEZE'
  | 'Q3_EM_FISCAL_DOMINANCE_FREEZE'
  | 'Q4_GOLDILOCKS_DISINFLATION';

export interface MacroQuadrantScenarioCell {
  quadrantId: MacroQuadrantId;
  quadrantTitle: string;
  growthRegimeLabel: string;
  inflationLiquidityLabel: string;
  assignedProbabilityPct: number;
  globalDriverAssumptions: string;
  activeSovereignCdsDeltaBps: number;
  activeSovereign10YYieldDeltaBps: number;
  activeSovereignFxDeltaPct: number;
  optimalQuadrantTradeExpression: string;
}

export interface SovereignQuadrantStressRow {
  iso3: string;
  countryName: string;
  isCurrentActiveSovereign: boolean;
  spot5YCdsBps: number;
  q1StagflationCdsDeltaBps: number;
  q2UsdSqueezeCdsDeltaBps: number;
  q3FiscalFreezeCdsDeltaBps: number;
  q4GoldilocksCdsDeltaBps: number;
  probWeightedExpectedCdsDeltaBps: number;
  probWeightedExpected10YYieldDeltaBps: number;
  regimeResilienceRank: number;
  resilienceClassification: 'ALL_WEATHER_RESILIENT' | 'MODERATE_BETA' | 'HIGH_TAIL_FRAGILITY';
}

export interface FourQuadrantMacroStressResult {
  headlineSummary: string;
  activeSovereignProbWeightedCdsDeltaBps: number;
  activeSovereignProbWeighted10YYieldDeltaBps: number;
  activeSovereignProbWeightedFxDeltaPct: number;
  allWeatherDominantHedge: string;
  quadrants: MacroQuadrantScenarioCell[];
  sovereignMatrix: SovereignQuadrantStressRow[];
}

// ============================================================================
// TIER-7.5 POLYMARKET & KALSHI EVENT ARBITRAGE & BAYESIAN SHOCK SUITE
// ============================================================================

export type PredictionMarketVenue = 'POLYMARKET' | 'KALSHI';

export type PredictionEventCategory =
  | 'CENTRAL_BANK_RATES'
  | 'INFLATION_CPI'
  | 'TARIFFS_TRADE'
  | 'GEOPOLITICAL_CONFLICT'
  | 'SOVEREIGN_FISCAL_DEFAULT';

export interface RawVenueEventContract {
  contractId: string;
  venue: PredictionMarketVenue;
  tickerOrSlug: string;
  question: string;
  category: PredictionEventCategory;
  yesPriceCents: number; // 1 to 99¢
  noPriceCents: number; // 1 to 99¢
  bidAskSpreadCents: number; // e.g., 1¢ to 4¢
  impliedProbabilityPct: number; // 1 to 99%
  counterVenuePriceCents?: number; // Matched Kalshi or Polymarket equivalent price in cents
  isLiveApiSourced: boolean;
  url: string;
}

export interface NormalizedPredictionContract extends RawVenueEventContract {
  counterVenueName: PredictionMarketVenue;
  counterVenuePriceCents: number;
  crossVenueSpreadCents: number; // yesPriceCents - counterVenuePriceCents
  netCrossVenueArbCents: number; // max(0, |crossVenueSpreadCents| - bidAskSpreadCents)
  crossVenueRoutingSignal:
    | 'BUY_KALSHI_SELL_POLYMARKET'
    | 'BUY_POLYMARKET_SELL_KALSHI'
    | 'NO_ARB_WITHIN_FRICTION';
  cdsHazardImpliedProbPct: number; // Event probability implied by active sovereign 5Y CDS & regime hazard
  econometricModelProbPct: number; // Event probability implied by IMF/WB/GDELT fundamentals
  eventVsCdsProbGapPct: number; // impliedProbabilityPct - cdsHazardImpliedProbPct
  sovereignCdsBetaBpsPer10Pct: number; // Conditional 5Y CDS move (bps) per +10% event probability jump
  sovereign10YYieldBetaBpsPer10Pct: number;
  sovereignFxBetaPctPer10Pct: number;
  crossAssetArbSignal:
    | 'EVENT_HIGH_BUY_SOVEREIGN_CDS'
    | 'EVENT_LOW_BUY_EVENT_YES_CONTRACT'
    | 'CROSS_ASSET_EQUILIBRIUM';
  crossAssetTradeExpression: string;
}

export interface ConditionalBayesianEventSimulation {
  selectedContract: NormalizedPredictionContract;
  currentMarketProbPct: number;
  simulatedShockProbPct: number;
  probDeltaPct: number;
  priorSovereignCrisisProbPct: number;
  posteriorSovereignCrisisProbPct: number;
  conditional5YCdsDeltaBps: number;
  conditional10YYieldDeltaBps: number;
  conditionalSpotFxDeltaPct: number;
  bayesianTransmissionSummary: string;
  responseCurve: {
    eventOddsCents: number;
    projected5YCdsBps: number;
    posteriorCrisisProbPct: number;
  }[];
}

export interface PredictionMarketArbitrageSuite {
  headlineSummary: string;
  activeSourcesLabel: string;
  polymarketContractsCount: number;
  kalshiContractsCount: number;
  topCrossVenueArbContract: NormalizedPredictionContract;
  topEventVsCdsDislocationContract: NormalizedPredictionContract;
  contracts: NormalizedPredictionContract[];
  bayesianSimulation: ConditionalBayesianEventSimulation;
}

// ============================================================================
// TIER-8 SOVEREIGN SHADOW RATINGS, FX EQUILIBRIUM, INVESTOR BASE & IC DOSSIER
// ============================================================================

export type RatingAgencyPillarId =
  | 'INSTITUTIONAL_EFFECTIVENESS'
  | 'ECONOMIC_STRUCTURE_GROWTH'
  | 'EXTERNAL_LIQUIDITY_IIP'
  | 'FISCAL_PERFORMANCE_DEBT'
  | 'MONETARY_FLEXIBILITY';

export interface SovereignRatingPillarScore {
  pillarId: RatingAgencyPillarId;
  pillarLabel: string;
  weightPct: number;
  baselineScore: number; // 0 to 100
  stressedScore: number; // 0 to 100
  agencyImpliedGrade: string; // e.g., "BBB", "BB-", "B+"
  primaryEmpiricalDrivers: string;
}

export interface ShadowRatingStressInputs {
  fiscalSlippagePctGdp: number; // -3.0% to +5.0% of GDP deficit shock
  institutionalGovernanceShockPts: number; // -25 to +20 points
  externalReserveDrainMonths: number; // -3.0 to +2.0 months of import cover
  monetaryCredibilityShockPts: number; // -25 to +20 points
}

export interface SovereignShadowRatingRow {
  iso3: string;
  countryName: string;
  officialRating: string; // S&P / Fitch equivalent scale (AAA to SD)
  officialMoodysEquivalent: string; // Aaa to C
  officialNumericNotch: number; // 1 (SD) to 21 (AAA)
  baselineShadowRating: string;
  baselineShadowNotch: number;
  stressedShadowRating: string;
  stressedShadowNotch: number;
  notchDislocationVsOfficial: number; // stressedShadowNotch - officialNumericNotch (+ = upgrade candidate, - = downgrade risk)
  distanceToInvestmentGradeCliffNotches: number; // stressedShadowNotch - 12 (where 12 = BBB-)
  isFallenAngelWarning: boolean;
  prob12MUpgradePct: number;
  prob12MStablePct: number;
  prob12MDowngradePct: number;
  forcedIndexSellingSpreadImpactBps: number;
  ratingActionSignal:
    | 'RISING_STAR_UPGRADE_CANDIDATE'
    | 'FALLEN_ANGEL_CLIFF_ALERT'
    | 'MULTI_NOTCH_DOWNGRADE_WATCH'
    | 'ALIGNED_STABLE_OUTLOOK';
  isCurrentActiveSovereign: boolean;
}

export interface SovereignShadowRatingSuite {
  headlineDiagnostic: string;
  activeSovereignRow: SovereignShadowRatingRow;
  pillars: SovereignRatingPillarScore[];
  peerRatingLadder: SovereignShadowRatingRow[];
  fallenAngelCliffSpreadBps: number;
  compositeShadowScore: number; // 0 to 100
}

export interface FxEquilibriumStressInputs {
  termsOfTradeShockPct: number; // -25% to +25%
  realRateDifferentialShiftBps: number; // -300 to +300 bps
  balassaSamuelsonProductivityShiftPct: number; // -5% to +5%
}

export interface SovereignFxEquilibriumRow {
  iso3: string;
  countryName: string;
  currencyCode: string;
  spotReerIndex: number; // Base 100 = 10Y historical real effective average
  beerEquilibriumReerIndex: number; // Behavioral Equilibrium Exchange Rate index
  beerMisalignmentPct: number; // + = Overvalued, - = Undervalued
  structuralCurrentAccountNormPctGdp: number; // IMF EBA FEER norm (% of GDP)
  cyclicallyAdjustedCurrentAccountPctGdp: number; // (% of GDP)
  currentAccountGapPctGdp: number; // Cyclically adjusted CA - Structural CA Norm (% GDP)
  tradeElasticityEta: number; // Semi-elasticity of CA/GDP to REER (typically 0.18 to 0.32)
  feerImpliedMisalignmentPct: number; // + = Overvalued, - = Undervalued
  consensusFxMisalignmentPct: number; // 50% BEER + 50% FEER (% Over/Undervalued)
  requiredRealFxAdjustmentPct: number; // Real depreciation (-) or appreciation (+) required to restore equilibrium
  realCarryDifferentialBps: number; // Real local policy rate minus US real rate (bps)
  devaluation12MTailProbPct: number;
  fxValuationRegime:
    | 'SEVERELY_OVERVALUED_DEVALUATION_RISK'
    | 'MODERATELY_OVERVALUED'
    | 'FAIR_VALUE_EQUILIBRIUM'
    | 'UNDERVALUED_REAL_CARRY_LONG';
  recommendedFxExpression: string;
  isCurrentActiveSovereign: boolean;
}

export interface FxEquilibriumValuationSuite {
  headlineDiagnostic: string;
  activeSovereignFx: SovereignFxEquilibriumRow;
  peerFxValuationTable: SovereignFxEquilibriumRow[];
  mostOvervaluedSovereign: SovereignFxEquilibriumRow;
  mostUndervaluedSovereign: SovereignFxEquilibriumRow;
}

export type InvestorBaseSectorId =
  | 'DOMESTIC_COMMERCIAL_BANKS'
  | 'DOMESTIC_PENSIONS_INSURERS'
  | 'DOMESTIC_CENTRAL_BANK'
  | 'FOREIGN_PRIVATE_REAL_MONEY'
  | 'FOREIGN_OFFICIAL_MULTILATERAL';

export interface InvestorBaseCreditorShare {
  sectorId: InvestorBaseSectorId;
  sectorLabel: string;
  baselineSharePctOfTotalDebt: number; // Sums to 100%
  postShockSharePctOfTotalDebt: number; // Sums to 100%
  rolloverStabilityScore: number; // 0 to 100
  typicalDurationYears: number;
  flightSensitivityLabel: string;
}

export interface InvestorBaseDoomLoopStressInputs {
  foreignPrivateExitShockPct: number; // 0% to 35% of foreign private holdings exiting
  sovereignBondHaircutMarkToMarketPct: number; // 0% to 30% MTM price drop on domestic bank sovereign book
}

export interface SovereignInvestorBaseRow {
  iso3: string;
  countryName: string;
  domesticBanksSharePct: number;
  domesticNonBankSharePct: number;
  domesticCentralBankSharePct: number;
  foreignPrivateSharePct: number;
  foreignOfficialSharePct: number;
  sovereignHoldingsPctOfBankTier1Cet1: number; // e.g., 145% to 380% of domestic bank Tier-1 capital
  baselineBankSystemCet1RatioPct: number; // e.g., 13.8%
  stressedBankSystemCet1RatioPct: number; // Post MTM sovereign haircut + forced absorption
  cet1CapitalErosionPctPts: number;
  suddenStop10YRepricingBps: number; // Yield spike (bps) from foreign private exit
  doomLoopContagionScore: number; // 0 to 100
  doomLoopRegime:
    | 'CRITICAL_SOVEREIGN_BANK_DOOM_LOOP'
    | 'ELEVATED_DOMESTIC_CROWDING_OUT'
    | 'FOREIGN_SUDDEN_STOP_VULNERABLE'
    | 'DIVERSIFIED_RESILIENT_BASE';
  isCurrentActiveSovereign: boolean;
}

export interface InvestorBaseDoomLoopSuite {
  headlineDiagnostic: string;
  activeSovereignRow: SovereignInvestorBaseRow;
  activeCreditorBreakdown: InvestorBaseCreditorShare[];
  peerInvestorBaseMatrix: SovereignInvestorBaseRow[];
  suddenStopCurve: {
    foreignExitPct: number;
    projected10YYieldBpsDelta: number;
    stressedBankCet1RatioPct: number;
  }[];
}

export interface ICPitchbookSovereignComparisonRow {
  iso3: string;
  countryName: string;
  currencyCode: string;
  spot5YCdsBps: number;
  modelVsMarketCdsGapPct: number;
  officialVsShadowRating: string;
  notchDislocation: number;
  consensusFxMisalignmentPct: number;
  bankDoomLoopScore: number;
  cet1PostStressPct: number;
  topPredictionEventOddsCents: number;
  icConvictionVote: 'OVERWEIGHT_LONG' | 'MARKET_WEIGHT_HOLD' | 'UNDERWEIGHT_SHORT_HEDGE';
  primaryTradeStructure: string;
  isCurrentActiveSovereign: boolean;
}

export interface BoardroomICPitchbookDossier {
  dossierId: string;
  generatedAtIso: string;
  committeeTitle: string;
  activeCountryName: string;
  activeIso3: string;
  icExecutiveThesis: string;
  recommendedCommitteeVote: 'APPROVE_OVERWEIGHT_ALLOCATION' | 'APPROVE_DEFENSIVE_CDS_HEDGE' | 'HOLD_NEUTRAL_WAIT_FOR_CATALYST';
  convictionConfidencePct: number;
  keyThesisPillars: string[];
  killSwitchGovernanceRules: {
    triggerMetric: string;
    currentLevel: string;
    hardStopLimit: string;
    mandatoryAction: string;
  }[];
  comparativeMatrix: ICPitchbookSovereignComparisonRow[];
  croSignOffAttestation: string;
}

// ============================================================================
// TIER-9: RESTRUCTURING, MONETARY REACTION FUNCTION & GEO-RISK DESK (9.1 - 9.4)
// Strictly normalized (% of GDP, bps, 0-100c recovery per 100c par, % share, years, months)
// ============================================================================

export type CreditorSeniorityTierId =
  | 'imf_world_bank_mdb_pcs'
  | 'paris_club_official_bilateral'
  | 'non_paris_club_bilateral'
  | 'external_eurobonds_cac'
  | 'domestic_law_local_currency';

export interface RestructuringTermSheetInputs {
  principalHaircutPct: number; // 0 to 70%
  couponReductionBps: number; // -500 to 0 bps
  maturityExtensionYears: number; // 0 to 15 years
  gracePeriodYears: number; // 0 to 5 years
  exitYieldPct: number; // 5 to 22%
  vriGdpWarrantKickerBps: number; // 0 to 250 bps
  cacRegime: 'SINGLE_LIMB_AGGREGATED_75' | 'DUAL_LIMB_SERIES_66_75' | 'LEGACY_UNANIMOUS_NO_CAC';
}

export interface SovereignCreditorTierRow {
  tierId: CreditorSeniorityTierId;
  tierLabel: string;
  seniorityRank: number;
  legalRegime: string;
  debtShareOfTotalPct: number; // sums to 100%
  preRestructuringDebtGdpPct: number; // % of GDP
  appliedPrincipalHaircutPct: number; // %
  maturityExtensionYears: number; // years
  couponAdjustmentBps: number; // bps
  npvRecoveryCentsPerPar: number; // 0 to 100c per 100c par
  impliedPresentValueLossPct: number; // % NPV relief
  comparabilityStatus: 'PREFERRED_CREDITOR_EXEMPT' | 'COMPARABLE_BURDEN_PARITY' | 'DOMESTIC_STABILITY_CARVEOUT' | 'UNDER_RELIEF_GAP';
  cacVotingThresholdPct: number; // % required for binding restructuring
  estimatedHoldoutRiskPct: number; // % probability of holdout litigation block
}

export interface SovereignRestructuringPeerRow {
  iso3: string;
  countryName: string;
  preDebtToGdpPct: number;
  postDebtToGdpPct: number;
  imfDsaSustainabilityTargetGdpPct: number;
  eurobondNpvRecoveryCents: number;
  compositeNpvHaircutPct: number;
  gfnReductionPctGdp: number;
  holdoutLitigationProbPct: number;
  dsaVerdict: 'RESTORED_SUSTAINABLE' | 'MARGINAL_BUFFER' | 'DEEPER_HAIRCUT_REQUIRED';
  isCurrentActiveSovereign: boolean;
}

export interface SovereignRestructuringWaterfallSuite {
  computedAtIso: string;
  headlineDiagnostic: string;
  activeCountryName: string;
  activeIso3: string;
  termSheetInputs: RestructuringTermSheetInputs;
  preRestructuringDebtGdpPct: number;
  postRestructuringDebtGdpPct: number;
  imfTargetDebtGdpPct: number;
  preRestructuringGfnPctGdp: number;
  postRestructuringGfnPctGdp: number;
  eurobondNpvRecoveryCents: number; // 0-100c including VRI kicker
  vriPresentValueGainCents: number; // c per 100c par
  weightedAverageNpvHaircutPct: number;
  parisClubComparabilityGapPct: number;
  cacHoldoutBlockingProbPct: number;
  creditorWaterfall: SovereignCreditorTierRow[];
  exitYieldSensitivityCurve: {
    exitYieldPct: number;
    eurobondNpvCents: number;
    bilateralNpvCents: number;
  }[];
  peerRestructuringTable: SovereignRestructuringPeerRow[];
}

export interface TaylorRuleStressInputs {
  neutralRealRateRStarPct: number; // -1.0% to +4.0%
  inflationTargetPct: number; // 1.5% to 6.0%
  inflationGapWeightAlpha: number; // 0.2 to 2.0 (standard Taylor = 0.5)
  outputGapWeightBeta: number; // 0.1 to 1.5 (standard Taylor = 0.5)
  fxPassThroughDefenseWeightGamma: number; // 0.0 to 0.6
  simulatedSupplyInflationShockBps: number; // -200 to +500 bps
}

export interface SovereignTaylorRuleRow {
  iso3: string;
  countryName: string;
  currencyCode: string;
  spotPolicyRatePct: number;
  headlineInflationPct: number;
  inflationTargetPct: number;
  estimatedOutputGapPctGdp: number;
  neutralRealRatePct: number;
  taylorImpliedPolicyRatePct: number;
  policyStanceGapBps: number; // Spot - Taylor (+ = Hawkish, - = Dovish / Behind curve)
  realPolicyRatePct: number;
  interestToRevenuePct: number;
  fiscalDominanceScore: number; // 0 - 100
  financialRepressionTaxPctGdp: number; // % of GDP implicit liquidation of debt
  regimeClassification: 'CREDIBLE_ORTHODOX_HAWK' | 'NEUTRAL_TAYLOR_ALIGNED' | 'BEHIND_THE_CURVE_DOVISH' | 'FISCAL_DOMINANCE_REPRESSION';
  isCurrentActiveSovereign: boolean;
}

export interface TaylorRuleFiscalDominanceSuite {
  computedAtIso: string;
  headlineDiagnostic: string;
  activeRow: SovereignTaylorRuleRow;
  peerTaylorMatrix: SovereignTaylorRuleRow[];
  yieldCurveTransmission: {
    tenorLabel: '3M' | '1Y' | '2Y' | '5Y' | '10Y' | '30Y';
    tenorYears: number;
    spotNominalYieldPct: number;
    taylorEquilibriumNominalYieldPct: number;
    realYieldPct: number;
  }[];
}

export type ReserveCustodyBucketId =
  | 'g7_western_custody_securities'
  | 'domestic_vaulted_monetary_gold'
  | 'non_g7_em_currencies_pboc_swaps'
  | 'imf_sdr_holdings'
  | 'bis_multilateral_liquidity';

export type MaritimeChokepointId =
  | 'strait_of_hormuz'
  | 'bab_el_mandeb_red_sea'
  | 'suez_canal'
  | 'strait_of_malacca'
  | 'panama_canal';

export interface GeoSanctionsChokepointInputs {
  g7ReserveFreezeSeverityPct: number; // 0 to 100% freeze of G7-custodied assets
  activeChokepointDisruption: MaritimeChokepointId;
  chokepointBlockadeIntensityPct: number; // 0 to 100%
  secondaryTariffPenaltyBps: number; // 0 to 1500 bps effective trade tariff
}

export interface ReserveCustodyShareRow {
  bucketId: ReserveCustodyBucketId;
  bucketLabel: string;
  preShockSharePct: number; // sums to 100%
  sanctionFreezeHaircutPct: number; // 0 to 100%
  postShockAccessibleSharePct: number; // % of original total reserves remaining liquid
  custodyJurisdictionNote: string;
}

export interface SovereignGeoRiskRow {
  iso3: string;
  countryName: string;
  preShockImportCoverMonths: number;
  g7CustodyExposurePct: number;
  domesticGoldAndSwapBufferPct: number;
  sanctionImmuneReserveSharePct: number;
  postFreezeImportCoverMonths: number;
  primaryChokepointExposurePctTrade: number;
  netEnergyFoodImportDependencyPctGdp: number;
  blockadeCpiPassThroughBps: number;
  emergencyFiscalSubsidyCostPctGdp: number;
  geoResilienceVerdict: 'FORTRESS_AUTARKY_BUFFER' | 'MODERATE_CHOKEPOINT_SENSITIVITY' | 'HIGH_CUSTODY_FREEZE_VULNERABILITY' | 'CRITICAL_EXTERNAL_BLOCKADE_RISK';
  isCurrentActiveSovereign: boolean;
}

export interface GeoSanctionsChokepointSuite {
  computedAtIso: string;
  headlineDiagnostic: string;
  activeRow: SovereignGeoRiskRow;
  activeCustodyBreakdown: ReserveCustodyShareRow[];
  chokepointVulnerabilityBreakdown: {
    chokepointId: MaritimeChokepointId;
    chokepointName: string;
    tradeShareRoutedPct: number;
    freightInsuranceSurgeBps: number;
    gdpGrowthDragPct: number;
  }[];
  peerGeoMatrix: SovereignGeoRiskRow[];
}

export type NgfsClimateScenarioId =
  | 'ORDERLY_NET_ZERO_2050'
  | 'DELAYED_DISORDERLY_TRANSITION'
  | 'HOT_HOUSE_WORLD_CURRENT_POLICIES';

export interface ClimateFiscalSlbInputs {
  selectedNgfsScenario: NgfsClimateScenarioId;
  globalCarbonTaxTrajectoryScore: number; // 0 to 100 intensity
  acuteWeatherShockSeverityPct: number; // 0 to 100
  slbTargetMissProbabilityPct: number; // 0 to 100%
}

export interface SovereignClimateSlbRow {
  iso3: string;
  countryName: string;
  hydrocarbonFiscalRevenueSharePct: number; // % of total government revenue
  agricultureAndClimateSensitiveGdpPct: number; // % of GDP
  strandedRevenueErosionPctRev: number; // % of government revenue lost in transition
  physicalClimateDamagePctGdp: number; // % of GDP annual fiscal/macro damage
  projected10YClimateDebtAdderPctGdp: number; // cumulative % of GDP added to public debt
  sovereignGreeniumDiscountBps: number; // negative bps = cheaper green borrowing
  slbCouponStepUpPenaltyBps: number; // +bps coupon step-up on KPI miss
  netClimateSpreadImpactBps: number; // net 10Y sovereign spread impact in bps
  climateFiscalRatingRiskNotches: number; // -notches under NGFS stress
  isCurrentActiveSovereign: boolean;
}

export interface NgfsClimateFiscalSuite {
  computedAtIso: string;
  headlineDiagnostic: string;
  activeScenario: NgfsClimateScenarioId;
  activeRow: SovereignClimateSlbRow;
  scenarioComparisonForActive: {
    scenarioId: NgfsClimateScenarioId;
    scenarioTitle: string;
    transitionFiscalCostPctGdp: number;
    physicalDamageCostPctGdp: number;
    cumulativeDebtAdder10YPctGdp: number;
    sovereignSpreadShockBps: number;
  }[];
  peerClimateMatrix: SovereignClimateSlbRow[];
}

// ============================================================================
// TIER-10: PERSONA PLAYBOOKS, CROSS-HUB SIGNAL SCANNER, STRATEGY BACKTESTER
// & ACADEMIC LATEX / CSV EMPIRICAL EXPORTER (10.1 - 10.4)
// Strictly normalized (% of GDP, bps, 0-100c, % share, Sharpe, Brier 0-1)
// ============================================================================

export type UserPersonaId =
  | 'INDIVIDUAL_TRADER'
  | 'INSTITUTIONAL_PM_IC'
  | 'POLICY_RESEARCHER';

export interface CrossHubPersonaSignal {
  signalId: string;
  rank: number;
  personaId: UserPersonaId;
  iso3: string;
  countryName: string;
  sourceHubLabel: string;
  targetNavSection: string;
  signalCategory: string;
  headlineThesis: string;
  convictionScore: number; // 0 - 100
  primaryDislocationMetric: string;
  entryBenchmark: string;
  targetConvergence: string;
  killSwitchInvalidation: string;
  recommendedExpression: string;
  shockPropagationPayload: {
    label: string;
    cdsDeltaBps: number;
    yield10YDeltaBps: number;
    fxDepreciationPct: number;
  };
}

export interface PersonaPlaybookStep {
  stepNumber: number;
  stepTitle: string;
  hubReference: string;
  targetNavSection: string;
  liveTelemetryBadge: string;
  analyticalObjective: string;
  decisionRule: string;
  edgeMechanism: string;
}

export interface PersonaWorkflowPlaybook {
  personaId: UserPersonaId;
  personaTitle: string;
  personaSubtitle: string;
  coreEdgeStatement: string;
  primaryMetricsUsed: string[];
  steps: PersonaPlaybookStep[];
}

export type SystematicStrategyId =
  | 'PREDICTION_MARKET_CDS_ARB'
  | 'TAYLOR_BEHIND_CURVE_FX_SHORT'
  | 'SHADOW_RATING_FALLEN_ANGEL_HEDGE'
  | 'DISTRESSED_EUROBOND_NPV_WORKOUT';

export interface StrategyBacktestInputs {
  strategyId: SystematicStrategyId;
  entryThresholdScore: number; // e.g. 6 to 25 (c or bps scaled)
  stopLossKillSwitchBps: number; // 35 to 250 bps
  holdingHorizonDays: 30 | 90 | 180;
  transactionBidAskHaircutBps: number; // 2 to 35 bps
}

export interface StrategyBacktestWindowPoint {
  windowLabel: string;
  episodeDescription: string;
  sovereignIso3: string;
  grossAlphaBps: number;
  netAlphaAfterCostBps: number;
  cumulativeAlphaBps: number;
  drawdownBps: number;
  outcome: 'WIN' | 'LOSS' | 'STOPPED_OUT';
}

export interface StrategyBacktestSuite {
  computedAtIso: string;
  strategyId: SystematicStrategyId;
  strategyTitle: string;
  strategyRuleSummary: string;
  targetPersona: UserPersonaId;
  inputs: StrategyBacktestInputs;
  totalCumulativeNetAlphaBps: number;
  annualizedSharpeRatio: number;
  winHitRatePct: number;
  profitFactor: number;
  maxDrawdownBps: number;
  brierCalibrationScore: number; // 0.00 to 1.00 (lower = better calibrated)
  historicalWindows: StrategyBacktestWindowPoint[];
}

export interface EmpiricalPanelCountryRow {
  iso3: string;
  countryName: string;
  debtToGdpPct: number;
  primaryBalancePctGdp: number;
  rMinusGSnowballPct: number;
  officialRating: string;
  shadowRating: string;
  notchDislocation: number;
  reerMisalignmentPct: number;
  bankCet1PostStressPct: number;
  eurobondWorkoutNpvCents: number;
  taylorStanceGapBps: number;
  fiscalDominanceScore: number;
  sanctionImmuneReservesPct: number;
  ngfs10YClimateDebtAdderPctGdp: number;
  spot5YCdsBps: number;
}

export interface AcademicResearchExportSuite {
  generatedAtIso: string;
  paperTitle: string;
  abstractSummary: string;
  econometricSpecificationLatex: string;
  latexBooktabsTable: string;
  bibtexCitationBlock: string;
  panelRows: EmpiricalPanelCountryRow[];
}

// ============================================================================
// TIER-11: TURNKEY PRODUCTION HARDENING, 4-CATEGORY NAVIGATION, GLOBAL
// COMMAND PALETTE (CMD+K), PRE-FLIGHT MODEL INTEGRITY AUDITOR, SESSION
// PERSISTENCE & CUSTOM ISO-3 SOVEREIGN ONBOARDING
// ============================================================================

export type NavigationCategoryGroupId =
  | 'CAT_1_CORE_COUNCIL_MACRO'
  | 'CAT_2_PORTFOLIO_EXECUTION_DECISION'
  | 'CAT_3_RATINGS_RESTRUCTURING_GEORISK'
  | 'CAT_4_PERSONA_PLAYBOOKS_SIGNALS';

export type CommandPaletteItemCategory =
  | 'ANALYTICAL_HUB'
  | 'SUB_MODULE'
  | 'SOVEREIGN_SWITCH'
  | 'PERSONA_MODE'
  | 'STRESS_SCENARIO'
  | 'EXPORT_AND_AUDIT';

export interface CommandPaletteItem {
  id: string;
  category: CommandPaletteItemCategory;
  categoryBadge: string;
  title: string;
  subtitle: string;
  shortcutHint?: string;
  keywords: string[];
  targetNavSection?: string;
  targetIso3?: string;
  targetPersona?: UserPersonaId;
  actionType?:
    | 'OPEN_INTEGRITY_AUDITOR'
    | 'OPEN_CUSTOM_SOVEREIGN_WIZARD'
    | 'OPEN_SESSION_MANAGER'
    | 'EXPORT_SMCR_PDF'
    | 'SYNC_LIVE_MACRO'
    | 'RUN_COUNCIL_PIPELINE';
}

export type IntegrityCheckCategory =
  | 'ACCOUNTING_IDENTITY'
  | 'NO_NOTIONAL_COMPLIANCE'
  | 'BOUNDS_AND_FINITENESS'
  | 'API_PROVENANCE';

export interface ModelIntegrityAuditCheck {
  checkId: string;
  category: IntegrityCheckCategory;
  hubReference: string;
  title: string;
  formulaChecked: string;
  expectedInvariant: string;
  observedReading: string;
  residualDeviationLabel: string;
  status: 'PASS' | 'WARN';
  diagnosticDetail: string;
}

export interface DataProvenanceFeedStatus {
  feedId: string;
  institutionName: string;
  endpointOrDataset: string;
  metricsProvided: string;
  status: 'LIVE_SYNCED' | 'VERIFIED_BASELINE';
  lastVerifiedTimestamp: string;
}

export interface ModelIntegrityAuditReport {
  generatedAtIso: string;
  activeSovereignIso3: string;
  activeSovereignName: string;
  watchlistCount: number;
  totalChecksRun: number;
  passedChecksCount: number;
  readinessScorePct: number;
  zeroNotionalComplianceVerified: boolean;
  executiveAuditVerdict: string;
  checks: ModelIntegrityAuditCheck[];
  provenanceFeeds: DataProvenanceFeedStatus[];
}

export interface CustomSovereignOnboardingDraft {
  iso3: string;
  countryName: string;
  region: string;
  currencyCode: string;
  focusTheme: string;
  debtToGdpPct: number;
  primaryFiscalBalancePct: number;
  realGdpGrowthPct: number;
  cpiInflationPct: number;
  policyRatePct: number;
  sovereign10YBondYieldPct: number;
  cds5YSpreadBps: number;
  fxReservesMonthsImport: number;
  externalDebtPctGni: number;
  currentAccountPctGdp: number;
  politicalStabilityPercentile: number;
  exchangeRatePerUsd: number;
  chokepointExposureIndex: number;
}

export interface WorkspaceSessionSnapshot {
  schemaVersion: 'ECONQUEST-SESSION-1.0';
  savedAtIso: string;
  sessionLabel: string;
  activeIso3: string;
  activeCountryName: string;
  activePersona: UserPersonaId;
  activeNavSection: string;
  layoutMode: WorkspaceLayoutMode;
  darkMode: boolean;
  scenarioDirective: string;
  // Old sessions may still carry forecastShocks, geopoliticalWargameParams and liquidityStressParams
  // (inputs of the retired model desk engines); they are ignored.
  watchlists: WatchlistGroup[];
  activeWatchlistId: string;
  customOnboardedSovereigns: CustomSovereignOnboardingDraft[];
}



/** The few debt-sustainability figures the council and the watchlist carry (src/utils/debtSustainability.ts). */
export interface DsaSummary {
  year: string;
  debtNow: number;
  /** Baseline on IMF inputs where it ran, else the IMF path. */
  base?: { label: string; end: number; year: string };
  worst?: { label: string; end: number };
  stabilisingPb?: number;
  projectedPb?: number;
  rMinusG?: number;
  method: string;
}
