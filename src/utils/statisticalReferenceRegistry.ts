export interface StatVariableItem {
  symbol: string;
  meaning: string;
  unit: string;
}

export interface StatThresholdItem {
  label: string;
  value: string;
  severity: 'SAFE' | 'WATCH' | 'DISTRESS';
}

export interface StatRefDefinition {
  id: string;
  title: string;
  category:
    | 'DEBT_DYNAMICS'
    | 'CREDIT_DEFAULT'
    | 'FX_RESERVES'
    | 'MONETARY_INFLATION'
    | 'GEOPOLITICAL_OSINT'
    | 'SUPPLY_CHAIN_IO'
    | 'QUANT_ECONOMETRICS'
    | 'RESTRUCTURING_LEGAL'
    | 'LIQUIDITY_MICROSTRUCTURE'
    | 'PORTFOLIO_TAIL_RISK';
  categoryLabel: string;
  formulaMono: string;
  plainEnglishSummary: string;
  variables: StatVariableItem[];
  thresholds: StatThresholdItem[];
  primarySourceCitation: string;
  methodologyNote: string;
}

export interface ResolvedStatRef extends StatRefDefinition {
  rawRefText: string;
  extractedMetrics: Array<{ label: string; value: string }>;
}

export const STATISTICAL_REFERENCE_CATALOG: Record<string, StatRefDefinition> = {
  DSA_SNOWBALL: {
    id: 'DSA_SNOWBALL',
    title: 'Sovereign Debt-to-GDP Law of Motion & r − g Snowball Identity',
    category: 'DEBT_DYNAMICS',
    categoryLabel: 'Sovereign Debt Sustainability (DSA)',
    formulaMono: 'd_t = ((1 + r_t) / (1 + g_t)) · d_{t-1} − pb_t + sfa_t   |   pb* = ((r − g) / (1 + g)) · d_{t-1}',
    plainEnglishSummary:
      'Measures whether public debt automatically snowballs faster than the economy grows. When the effective real interest rate (r) exceeds real GDP growth (g), the government must run a primary budget surplus (pb*) just to keep the debt-to-GDP ratio flat.',
    variables: [
      { symbol: 'd_t', meaning: 'Gross general government debt-to-GDP ratio at period t', unit: '% of GDP' },
      { symbol: 'r_t', meaning: 'Effective real interest rate on sovereign debt stock', unit: '% p.a.' },
      { symbol: 'g_t', meaning: 'Real GDP growth rate', unit: '% YoY' },
      { symbol: 'pb_t', meaning: 'Primary fiscal balance (revenues minus non-interest spending)', unit: '% of GDP' },
      { symbol: 'pb*', meaning: 'Debt-stabilizing primary balance required to hold Δd_t = 0', unit: '% of GDP' },
      { symbol: 'sfa_t', meaning: 'Stock-flow adjustment (FX valuation effects & state contingent liabilities)', unit: '% of GDP' },
    ],
    thresholds: [
      { label: 'Favorable Growth Dividend', value: 'r − g < 0.0%', severity: 'SAFE' },
      { label: 'Active Fiscal Consolidation Required', value: '0.0% ≤ r − g < +1.5%', severity: 'WATCH' },
      { label: 'Explosive Debt Snowball Regime', value: 'r − g ≥ +1.5% or d_t > 90% EM / 120% DM', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'IMF Sovereign Risk and Debt Sustainability Framework (SRDSF, 2022); Escolano (2010), "A Practical Guide to Public Debt Dynamics", IMF Technical Notes and Manuals 10/02.',
    methodologyNote:
      'Monte Carlo fan charts simulate 1,000 joint paths of (r_t, g_t, pb_t, FX) over a 5-year horizon using historical variance-covariance matrices.',
  },

  GREENSPAN_GUIDOTTI_ARA: {
    id: 'GREENSPAN_GUIDOTTI_ARA',
    title: 'Greenspan-Guidotti Short-Term Debt Cover & IMF ARA Reserve Adequacy',
    category: 'FX_RESERVES',
    categoryLabel: 'External Liquidity & FX Adequacy',
    formulaMono: 'GG_Ratio = FX_Reserves / ST_Ext_Debt_12M   |   ARA_Metric = Reserves / (0.30·STD + 0.15·Oth + 0.10·M2 + 0.10·X)',
    plainEnglishSummary:
      'Tests how many months a central bank can pay all foreign-currency bills and maturing debt if global bond markets suddenly freeze and refuse to roll over loans.',
    variables: [
      { symbol: 'FX_Reserves', meaning: 'Usable liquid official foreign exchange reserves (excluding pledged/frozen tranches)', unit: 'USD Bn' },
      { symbol: 'ST_Ext_Debt_12M', meaning: 'External sovereign + corporate debt maturing within 12 months (remaining maturity)', unit: 'USD Bn' },
      { symbol: 'M2', meaning: 'Broad domestic money supply (captures resident capital flight risk)', unit: 'USD Bn' },
      { symbol: 'X', meaning: 'Annual merchandise and services export earnings (captures terms-of-trade drop)', unit: 'USD Bn' },
      { symbol: 'WAM', meaning: 'Weighted Average Maturity of outstanding public debt stock', unit: 'Years' },
    ],
    thresholds: [
      { label: 'Adequate Reserve Buffer', value: 'GG ≥ 125% · Import Cover ≥ 6.0m · ARA ≥ 100%', severity: 'SAFE' },
      { label: 'Precautionary Watch Zone', value: '100% ≤ GG < 125% · Import Cover 3.0–6.0m', severity: 'WATCH' },
      { label: 'Rollover & Sudden-Stop Vulnerability', value: 'GG < 100% or Import Cover < 3.0m', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'IMF (2015), "Assessing Reserve Adequacy—Specific Proposals", IMF Policy Paper; Greenspan (1999) & Guidotti (1999) External Liquidity Rule.',
    methodologyNote:
      'In sanction scenarios, immobilized G7/Euroclear custody tranches are deducted from gross reserves to compute Sanction-Immune Usable Liquidity.',
  },

  MONETARY_TAYLOR_REAL_RATE: {
    id: 'MONETARY_TAYLOR_REAL_RATE',
    title: 'Ex-Post Real Policy Rate & Augmented Taylor Rule Stance',
    category: 'MONETARY_INFLATION',
    categoryLabel: 'Monetary Policy & Inflation',
    formulaMono: 'r_real = i_policy − π_YoY   |   i_Taylor = r* + π_t + 0.5·(π_t − π*) + 0.5·(y_t − y*) + β_FX·Δe_t',
    plainEnglishSummary:
      'Compares the central bank policy interest rate against headline inflation. A positive real rate cools inflation and defends the currency; a negative real rate means inflation is eroding purchasing power faster than interest rates compensate savers.',
    variables: [
      { symbol: 'i_policy', meaning: 'Central bank benchmark overnight policy rate', unit: '% p.a.' },
      { symbol: 'π_YoY', meaning: 'Headline Consumer Price Index (CPI) year-over-year inflation', unit: '% YoY' },
      { symbol: 'r_real', meaning: 'Real inflation-adjusted policy interest rate', unit: '% p.a.' },
      { symbol: 'r*', meaning: 'Neutral real interest rate consistent with stable inflation at full employment', unit: '% p.a.' },
      { symbol: 'π*', meaning: 'Central bank explicit inflation target', unit: '% YoY' },
    ],
    thresholds: [
      { label: 'Orthodox Restrictive Buffer', value: 'r_real ≥ +1.50%', severity: 'SAFE' },
      { label: 'Neutral / Borderline Real Stance', value: '0.00% ≤ r_real < +1.50%', severity: 'WATCH' },
      { label: 'Financial Repression / Negative Real Yield', value: 'r_real < 0.00%', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'Taylor (1993), "Discretion versus policy rules in practice", Carnegie-Rochester Conference Series on Public Policy 39, 195–214; BIS Central Bank Policy Rate Statistics.',
    methodologyNote:
      'Open-economy EM Taylor rules include an exchange-rate pass-through term (β_FX·Δe_t) to capture imported inflation from currency depreciation.',
  },

  ISDA_CDS_HAZARD_BASIS: {
    id: 'ISDA_CDS_HAZARD_BASIS',
    title: 'ISDA CDS Hazard Rate Bootstrap, Cumulative Default Probability & CDS-Bond Basis',
    category: 'CREDIT_DEFAULT',
    categoryLabel: 'Sovereign Credit & Default Pricing',
    formulaMono: 'λ ≈ S_CDS / (1 − R)   |   PD(0,T) = 1 − exp(−∫_0^T λ(s) ds)   |   Basis = S_CDS − Z_Spread_Bond',
    plainEnglishSummary:
      'Translates the market price of sovereign default insurance (5Y CDS spread) into the implied probability that the government defaults within 5 years, and compares insurance cost against cash Eurobond yields.',
    variables: [
      { symbol: 'S_CDS', meaning: '5-Year Sovereign Credit Default Swap par spread', unit: 'bps' },
      { symbol: 'R', meaning: 'ISDA standard recovery rate assumption on defaulted sovereign debt (LGD = 1 − R)', unit: '% of Par (40% std)' },
      { symbol: 'λ', meaning: 'Risk-neutral annualized default intensity (hazard rate)', unit: '% / yr' },
      { symbol: 'PD(0,5)', meaning: '5-Year cumulative risk-neutral probability of sovereign credit event', unit: '%' },
      { symbol: 'Basis', meaning: '5Y CDS spread minus 5Y cash Eurobond asset-swap / Z-spread', unit: 'bps' },
    ],
    thresholds: [
      { label: 'Investment Grade / Low Credit Stress', value: '5Y CDS < 200 bps · 5Y PD < 15%', severity: 'SAFE' },
      { label: 'High-Yield / Elevated Credit Risk', value: '200 bps ≤ 5Y CDS < 600 bps · 5Y PD 15–40%', severity: 'WATCH' },
      { label: 'Distressed / Upfront Trading Regime', value: '5Y CDS ≥ 600 bps (Severe ≥ 1,000 bps)', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'ISDA Standard CDS Converter Specification (2009); O’Kane (2008), "Modelling Single-name and Multi-name Credit Derivatives", Wiley Finance; Duffie & Singleton (1999).',
    methodologyNote:
      'Piecewise constant hazard rates (λ₁, λ₂, λ₃) are bootstrapped across 1Y, 3Y, 5Y, and 10Y CDS tenors assuming quarterly premium accrual.',
  },

  CALDARA_IACOVIELLO_GPR_GDELT: {
    id: 'CALDARA_IACOVIELLO_GPR_GDELT',
    title: 'Caldara-Iacoviello Geopolitical Risk (GPR) Z-Score, GDELT CAMEO & Polymarket Pricing',
    category: 'GEOPOLITICAL_OSINT',
    categoryLabel: 'Geopolitical & OSINT Intelligence',
    formulaMono: 'Z_GPR = (GPR_t − μ_GPR) / σ_GPR   |   E[ΔCDS] = Σ_k p_k · ΔCDS_k   |   Goldstein ∈ [−10, +10]',
    plainEnglishSummary:
      'Combines automated news-text scanning of military threats/acts (GPR Z-Score), real-time satellite/conflict event logs (GDELT Goldstein scale), and prediction-market odds to price how geopolitical flare-ups widen bond spreads.',
    variables: [
      { symbol: 'Z_GPR', meaning: 'Standardized Caldara-Iacoviello Geopolitical Risk anomaly vs. 10-year Country mean', unit: 'σ (Std Devs)' },
      { symbol: 'GPR_Threat / Act', meaning: 'Decomposition into rhetorical military/sanction threats vs. realized kinetic events', unit: 'Index (1985–2019=100)' },
      { symbol: 'Goldstein', meaning: 'GDELT 2.0 CAMEO event conflict-cooperation intensity scale (−10 extreme war to +10 cooperation)', unit: 'Scale [−10, +10]' },
      { symbol: 'p_k', meaning: 'Prediction-market (Polymarket / Kalshi) implied probability of escalation branch k', unit: '%' },
      { symbol: 'E[ΔCDS]', meaning: 'Probability-weighted expected 5Y sovereign CDS spread widening from geopolitical tree', unit: 'bps' },
    ],
    thresholds: [
      { label: 'Baseline Diplomatic Friction', value: 'Z_GPR < +1.0σ · Goldstein > −3.5', severity: 'SAFE' },
      { label: 'Elevated Hybrid / Sanctions Escalation', value: '+1.0σ ≤ Z_GPR < +2.0σ · Goldstein −3.5 to −6.0', severity: 'WATCH' },
      { label: 'Acute Kinetic / Blockade Regime', value: 'Z_GPR ≥ +2.0σ or Goldstein ≤ −6.0', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'Caldara & Iacoviello (2022), "Measuring Geopolitical Risk", American Economic Review 112(4), 1194–1225; Leetaru & Schrodt (2013) GDELT 2.0 CAMEO Taxonomy; ACLED Armed Conflict Location & Event Data.',
    methodologyNote:
      'Event velocity compares 7-day rolling GDELT CAMEO root-code 17–20 (coercion, blockade, assault, unconventional violence) counts against 365-day baselines.',
  },

  CHOLESKY_BVAR_IRF: {
    id: 'CHOLESKY_BVAR_IRF',
    title: '4-Variable Structural Bayesian Vector Autoregression (BVAR) & Cholesky Impulse Response',
    category: 'QUANT_ECONOMETRICS',
    categoryLabel: 'Macro-Econometric Time Series',
    formulaMono: 'Y_t = c + A_1 Y_{t-1} + A_2 Y_{t-2} + P·ε_t,   Σ_u = P·Pᵀ   |   IRF(h) = ∂Y_{t+h} / ∂ε_{j,t}',
    plainEnglishSummary:
      'Tracks the quarter-by-quarter domino effect (Q0 to Q8) of a sudden external shock—such as an oil spike, Fed rate hike, or shipping blockade—across GDP growth, inflation, central bank rates, and 10Y bond yields.',
    variables: [
      { symbol: 'Y_t', meaning: 'Endogenous state vector [Real GDP Growth, CPI Inflation, Policy Rate, 10Y Sovereign Yield]ᵀ', unit: '4×1 Vector' },
      { symbol: 'P', meaning: 'Lower-triangular Cholesky factor of reduced-form residual covariance Σ_u', unit: '4×4 Matrix' },
      { symbol: 'ε_t', meaning: 'Orthogonalized structural shock impulse (+1σ to +3σ standard deviations)', unit: 'σ' },
      { symbol: 'IRF(h)', meaning: 'Dynamic response at horizon h quarters (h = 0, 1, ..., 8) with 68% / 90% credible bands', unit: 'bps or %' },
    ],
    thresholds: [
      { label: 'Damped Mean-Reverting Impulse', value: 'Peak Yield IRF < +50 bps · Peak CPI < +75 bps', severity: 'SAFE' },
      { label: 'Persistent Stagflationary Propagation', value: 'Peak Yield IRF +50 to +140 bps', severity: 'WATCH' },
      { label: 'Non-Linear Macro-Fiscal Amplification', value: 'Peak Yield IRF > +140 bps or Debt IRF > +4% GDP', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'Litterman (1986), "Forecasting with Bayesian Vector Autoregressions", Journal of Business & Economic Statistics 4(1); Sims (1980), "Macroeconomics and Reality", Econometrica 48(1).',
    methodologyNote:
      'Estimated with Minnesota prior shrinkage hyperparameters (λ₁ = 0.2 overall tightness, λ₂ = 0.5 cross-variable weight, λ₃ = 1.0 lag decay).',
  },

  QUANTILE_GAR_FAR: {
    id: 'QUANTILE_GAR_FAR',
    title: 'Adrian-Boyarchenko-Giannone Quantile Regression: Growth-at-Risk (GaR 5%) & Fiscal-at-Risk (FaR 95%)',
    category: 'QUANT_ECONOMETRICS',
    categoryLabel: 'Macro Tail-Risk Quantiles',
    formulaMono: 'Q_{y_{t+h}}(τ | X_t) = α(τ) + β_1(τ)·FCI_t + β_2(τ)·Macro_t + β_3(τ)·ExtShock_t   (τ ∈ {0.05, 0.50, 0.95})',
    plainEnglishSummary:
      'Instead of only forecasting an average outcome, Quantile Regression estimates the 1-in-20 worst-case recession (5th percentile GDP Growth-at-Risk) and 1-in-20 worst-case budget blowout (95th percentile Fiscal-at-Risk) when financial conditions tighten.',
    variables: [
      { symbol: 'GaR(5%)', meaning: '5th-percentile left-tail conditional real GDP growth forecast over 4 quarters', unit: '% YoY' },
      { symbol: 'FaR(95%)', meaning: '95th-percentile right-tail conditional fiscal deficit blowout under stress', unit: '% of GDP' },
      { symbol: 'FCI_t', meaning: 'Financial Conditions Index (sovereign spread, FX volatility, equity drawdown, interbank spread)', unit: 'Z-Score' },
      { symbol: 'P(GDP < 0)', meaning: 'Integrated probability mass of outright recession over the next 12 months', unit: '%' },
    ],
    thresholds: [
      { label: 'Contained Left-Tail Skew', value: 'GaR(5%) > −0.5% · P(GDP < 0) < 15%', severity: 'SAFE' },
      { label: 'Asymmetric Downside Vulnerability', value: '−2.5% ≤ GaR(5%) ≤ −0.5% · P(GDP < 0) 15–35%', severity: 'WATCH' },
      { label: 'Acute Recessionary Left-Tail', value: 'GaR(5%) < −2.5% or FaR(95%) > 6.5% GDP', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'Adrian, Boyarchenko & Giannone (2019), "Vulnerable Growth", American Economic Review 109(4), 1263–1289; IMF Global Financial Stability Report (GFSR) Growth-at-Risk Framework.',
    methodologyNote:
      'Conditional skewed-t distribution (Azzalini & Capitanio, 2003) is fitted across estimated quantiles τ ∈ {0.05, 0.25, 0.50, 0.75, 0.95} to recover smooth tail densities.',
  },

  NELSON_SIEGEL_SVENSSON_ACM: {
    id: 'NELSON_SIEGEL_SVENSSON_ACM',
    title: 'Nelson-Siegel-Svensson (NSS) Yield Curve Factors & Adrian-Crump-Moench (ACM) Term Premium',
    category: 'QUANT_ECONOMETRICS',
    categoryLabel: 'Fixed Income Yield Curve',
    formulaMono: 'y(τ) = β_0 + β_1((1−e^{−τ/λ_1})/(τ/λ_1)) + β_2((1−e^{−τ/λ_1})/(τ/λ_1) − e^{−τ/λ_1})   |   y_10Y = E[r_short] + TP_10Y',
    plainEnglishSummary:
      'Breaks the government bond yield curve into three intuitive drivers—long-run inflation anchor (Level β₀), short-term central bank policy tightness (Slope β₁), and belly hump (Curvature β₂)—and isolates the extra compensation investors demand for holding 10-year bonds (Term Premium TP₁₀).',
    variables: [
      { symbol: 'β_0', meaning: 'Asymptotic long-run nominal yield level (inflation expectations + real neutral rate)', unit: '% p.a.' },
      { symbol: 'β_1', meaning: 'Short-end minus long-end slope factor (β₁ > 0 indicates an inverted yield curve)', unit: '% (2s10s proxy)' },
      { symbol: 'β_2', meaning: 'Medium-term (2Y–5Y belly) curvature factor', unit: '%' },
      { symbol: 'TP_10Y', meaning: '10-Year Adrian-Crump-Moench term premium (compensation for duration & fiscal supply risk)', unit: '% / bps' },
    ],
    thresholds: [
      { label: 'Anchored Upward-Sloping Curve', value: '2s10s > +25 bps · TP_10Y < 1.25%', severity: 'SAFE' },
      { label: 'Flat Curve or Rising Fiscal Premium', value: '−25 bps ≤ 2s10s ≤ +25 bps · TP_10Y 1.25–2.25%', severity: 'WATCH' },
      { label: 'Deep Inversion or Fiscal Term-Premium Unanchoring', value: '2s10s < −25 bps or TP_10Y > 2.25%', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'Nelson & Siegel (1987), Journal of Business 60(4); Svensson (1994), NBER Working Paper 4871; Adrian, Crump & Moench (2013), "Pricing the Term Structure with Linear Regressions", Journal of Financial Economics 110(1).',
    methodologyNote:
      'Decay parameter λ₁ is calibrated so the curvature loading β₂ peaks at the 3-year to 5-year sovereign benchmark belly.',
  },

  HAMILTON_MARKOV_EWS: {
    id: 'HAMILTON_MARKOV_EWS',
    title: 'Hamilton 3-State Markov Regime-Switching Filter & Kaminsky-Reinhart Crisis Early Warning Signal (EWS)',
    category: 'QUANT_ECONOMETRICS',
    categoryLabel: 'Regime Switching & Crisis EWS',
    formulaMono: 'P(S_t = j | Ω_t) ∝ f(y_t | S_t = j) · Σ_{i=0}^2 p_{ij} · P(S_{t-1} = i | Ω_{t-1})   |   Z_EWS = Σ_m w_m · z_m',
    plainEnglishSummary:
      'Uses a hidden-state filter to calculate the real-time probability that a country has quietly shifted from a Calm market regime into a Fragile or Acute Crisis regime, backed by 6 historical leading indicators of sovereign/currency crises.',
    variables: [
      { symbol: 'S_t ∈ {0,1,2}', meaning: 'Unobserved market state: State 0 (Calm/Expansion), State 1 (Fragile/Transition), State 2 (Crisis/Sudden Stop)', unit: 'Discrete State' },
      { symbol: 'p_{ij}', meaning: 'Markov transition probability of migrating from regime i at t−1 to regime j at t', unit: 'Probability [0,1]' },
      { symbol: 'Z_EWS', meaning: 'Composite Kaminsky-Reinhart Early Warning Z-score across 6 macro-financial indicators', unit: 'σ (Z-Score)' },
      { symbol: 'P_Crisis_12M', meaning: '12-month forward probability of sovereign default, IMF program, or currency crisis', unit: '%' },
    ],
    thresholds: [
      { label: 'Regime 0: Tranquil / Expansion', value: 'Z_EWS < +0.8σ · 12M Crisis Prob < 15%', severity: 'SAFE' },
      { label: 'Regime 1: Fragile / Vulnerable Transition', value: '+0.8σ ≤ Z_EWS < +1.65σ · 12M Crisis Prob 15–35%', severity: 'WATCH' },
      { label: 'Regime 2: Sudden-Stop / Crisis Alert', value: 'Z_EWS ≥ +1.65σ or 12M Crisis Prob ≥ 35%', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'Hamilton (1989), "A New Approach to the Economic Analysis of Nonstationary Time Series", Econometrica 57(2), 357–384; Kaminsky, Lizondo & Reinhart (1998), IMF Staff Papers 45(1).',
    methodologyNote:
      'Noise-to-Signal (NTS) weights prioritize indicators with the lowest false-positive rates in historical EM/DM twin crises (FX reserve velocity, REER overvaluation, M2/Reserves, sovereign spread Z, short-term debt cover, real credit growth).',
  },

  BLANCHARD_LEEPER_FISCAL_DOMINANCE: {
    id: 'BLANCHARD_LEEPER_FISCAL_DOMINANCE',
    title: 'Blanchard-Leeper Fiscal Dominance Reversal Rate (r*) & Central Bank FX Reserve Burn Clock',
    category: 'MONETARY_INFLATION',
    categoryLabel: 'Fiscal Dominance & FX Burn Clock',
    formulaMono: 'r*_Fiscal = g_real + π_target + (pb_max / d_t) − α_bank·(B_sov / CET1)   |   T_breach = (FX_Res − ARA_Floor) / |ΔFXI_monthly|',
    plainEnglishSummary:
      'Identifies the "Reversal Rate" ceiling (r*) where raising interest rates further actually backfires—weakening the currency instead of strengthening it—because higher rates blow up the government’s debt service bill and domestic bank bond portfolios.',
    variables: [
      { symbol: 'r*_Fiscal', meaning: 'Blanchard-Leeper Fiscal Dominance reversal interest rate ceiling', unit: '% p.a.' },
      { symbol: 'Headroom', meaning: 'Remaining policy hike capacity before breaching fiscal dominance (r*_Fiscal − i_policy)', unit: 'bps' },
      { symbol: 'ARA_Floor', meaning: '100% IMF Assessing Reserve Adequacy (ARA) composite minimum floor', unit: 'USD Bn' },
      { symbol: 'ΔFXI_monthly', meaning: 'Net monthly central bank FX spot + forward intervention burn rate', unit: 'USD Bn / mo' },
      { symbol: 'T_breach', meaning: 'Months until usable FX reserves cross below the 100% IMF ARA adequacy floor', unit: 'Months' },
    ],
    thresholds: [
      { label: 'Monetary Dominance (Credible Taylor Rule)', value: 'Headroom > +150 bps · T_breach > 36 Months', severity: 'SAFE' },
      { label: 'Constrained Policy Space', value: '+25 bps ≤ Headroom ≤ +150 bps · T_breach 12–36 Months', severity: 'WATCH' },
      { label: 'Active Fiscal Dominance (Perverse FX Reaction)', value: 'Headroom < +25 bps or T_breach < 12 Months', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'Leeper (1991), "Equilibria under Active and Passive Monetary and Fiscal Policies", Journal of Monetary Economics 27(1); Blanchard (2004), "Fiscal Dominance and Inflation Targeting: Lessons from Brazil", NBER WP 10389; Brunnermeier & Koby (2018).',
    methodologyNote:
      'When i_policy > r*_Fiscal, the elastic debt-default premium outweighs uncovered interest parity (UIP) carry inflows, inverting the currency response to rate hikes.',
  },

  IMF_SRDSF_GFN_DOOM_LOOP: {
    id: 'IMF_SRDSF_GFN_DOOM_LOOP',
    title: 'IMF SRDSF Gross Financing Needs (GFN) Matrix & Gennaioli-Martin-Rossi Sovereign-Bank Doom Loop',
    category: 'DEBT_DYNAMICS',
    categoryLabel: 'GFN Rollover & Bank CET1 Doom Loop',
    formulaMono: 'GFN_t = Primary_Deficit_t + Interest_Bill_t + Maturing_Principal_t   |   ΔCET1 = −(Holdings_AFS_HTM · Dur_eff · Δy_sov) / RWA',
    plainEnglishSummary:
      'Measures the total cash the government must borrow this year to fund its deficit plus pay off maturing bonds (GFN % of GDP), and calculates how much domestic banks’ core capital (CET1) is wiped out when government bond prices fall.',
    variables: [
      { symbol: 'GFN_t', meaning: 'Annual Gross Financing Needs (new deficit + interest + maturing short/long debt)', unit: '% of GDP' },
      { symbol: 'B_dom / Assets', meaning: 'Domestic commercial banks’ sovereign bond holdings as a share of total banking assets', unit: '%' },
      { symbol: 'ΔCET1', meaning: 'Common Equity Tier 1 capital ratio erosion under a stressed sovereign yield spike', unit: 'bps / % RWA' },
      { symbol: 'Credit_Impulse', meaning: 'Resulting contraction in private-sector bank lending growth from capital compression', unit: '% YoY' },
    ],
    thresholds: [
      { label: 'Manageable Rollover & Insulated Banks', value: 'GFN < 10% GDP · Bank Sov Share < 12% · Post-Stress CET1 > 10.5%', severity: 'SAFE' },
      { label: 'Elevated Domestic Absorption Strain', value: '10% ≤ GFN < 15% GDP · Bank Sov Share 12–20%', severity: 'WATCH' },
      { label: 'Acute Rollover Stress & Doom-Loop Trigger', value: 'GFN ≥ 15% GDP (EM) / 20% (DM) or Post-Stress CET1 < 8.5%', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'IMF (2022), "Staff Guidance Note on the Sovereign Risk and Debt Sustainability Framework (SRDSF)"; Gennaioli, Martin & Rossi (2014), "Sovereign Default, Domestic Banks, and Financial Institutions", Journal of Finance 69(2), 819–866; Basel III BCBS Capital Standards.',
    methodologyNote:
      'Captures the two-way diabolic loop: sovereign spread widening erodes bank CET1 capital, forcing credit contraction (lower g_t) and contingent bank recapitalization liabilities (higher sfa_t).',
  },

  FISCAL_CONSOLIDATION_SIM: {
    id: 'FISCAL_CONSOLIDATION_SIM',
    title: 'Fiscal Primary Balance Consolidation Gap & Interest-Rate / FX Debt Sensitivity',
    category: 'DEBT_DYNAMICS',
    categoryLabel: 'Fiscal Policy & Debt Sensitivity',
    formulaMono: 'Δpb_gap = pb* − pb_actual   |   Δ(Interest/Rev) = (Debt_Float · Δi + Debt_FX · Δe) / Fiscal_Revenue',
    plainEnglishSummary:
      'Shows the exact budget gap between what the government is currently spending and what is needed to stabilize debt, plus how much extra tax revenue is consumed by interest payments if borrowing rates rise or the currency drops.',
    variables: [
      { symbol: 'Δpb_gap', meaning: 'Primary fiscal consolidation adjustment required to stabilize debt-to-GDP', unit: '% of GDP' },
      { symbol: 'Debt_Float', meaning: 'Share of public debt resetting interest rates within 12 months', unit: '% of Debt' },
      { symbol: 'Debt_FX', meaning: 'Foreign-currency denominated share of general government debt', unit: '% of Debt' },
      { symbol: 'Interest/Rev', meaning: 'Sovereign interest payments as a percentage of general government tax revenues', unit: '% of Revenue' },
    ],
    thresholds: [
      { label: 'Primary Surplus / Self-Stabilizing', value: 'Δpb_gap ≤ 0.0% GDP · Interest/Rev < 10%', severity: 'SAFE' },
      { label: 'Moderate Consolidation Needed', value: '0.0% < Δpb_gap ≤ +2.0% GDP · Interest/Rev 10–20%', severity: 'WATCH' },
      { label: 'Severe Fiscal Adjustment Fatigue', value: 'Δpb_gap > +2.0% GDP or Interest/Rev > 20%', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'IMF Fiscal Monitor Database; Alesina, Favero & Giavazzi (2019), "Austerity: When It Works and When It Doesn’t", Princeton University Press.',
    methodologyNote:
      'Simulates interactive fiscal consolidation sliders with short-run Keynesian fiscal multipliers (m ≈ 0.4–0.8) feeding back into denominator GDP.',
  },

  CIP_XCCY_NDF_REER: {
    id: 'CIP_XCCY_NDF_REER',
    title: 'Covered Interest Parity (CIP), Cross-Currency Swap Basis (XCCY), NDF Points & REER Misalignment',
    category: 'FX_RESERVES',
    categoryLabel: 'FX Microstructure, CIP Basis & REER',
    formulaMono: 'y_Hedged_USD = y_Local − ((F_{1Y}/S_0 − 1) + Basis_XCCY)   |   CIP_Basis = r_USD − (r_Local − f_swap)   |   Z_REER = (REER_t − μ_10Y)/σ',
    plainEnglishSummary:
      'Measures offshore currency devaluation pressure (12M NDF forwards), dollar funding shortages in cross-currency swaps (CIP/XCCY basis), whether local bonds beat USD Eurobonds after hedging currency risk, and whether the exchange rate is overvalued relative to trading partners (REER Z-Score).',
    variables: [
      { symbol: 'Spot / 12M NDF', meaning: 'Onshore spot exchange rate vs. 12-month Non-Deliverable Forward outright rate', unit: 'LCY per USD' },
      { symbol: 'CIP_Basis / XCCY', meaning: 'Cross-currency swap basis (deviation from Covered Interest Parity; negative = USD funding scarcity)', unit: 'bps' },
      { symbol: 'y_Hedged_USD', meaning: 'USD-hedged yield earned by buying local-currency sovereign bonds and swapping FX exposure', unit: '% p.a.' },
      { symbol: 'Z_REER', meaning: 'BIS Broad Real Effective Exchange Rate Z-score vs. 10-year historical equilibrium', unit: 'σ (Z-Score)' },
      { symbol: 'NY-Law Spread', meaning: 'Yield spread difference between New York/English-law Eurobonds and domestic-law bonds', unit: 'bps' },
    ],
    thresholds: [
      { label: 'Tight CIP Arbitrage & Fair Valuation', value: '|XCCY Basis| < 25 bps · |Z_REER| < 1.0σ', severity: 'SAFE' },
      { label: 'Moderate Dollar Funding Premium', value: '25 bps ≤ |XCCY Basis| < 65 bps · |Z_REER| 1.0–1.8σ', severity: 'WATCH' },
      { label: 'Acute Offshore USD Squeeze / Overvaluation', value: '|XCCY Basis| ≥ 65 bps or Z_REER > +1.8σ', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'Du, Tepper & Verdelhan (2018), "Deviations from Covered Interest Rate Parity", Journal of Finance 73(3), 915–957;Du & Schreger (2016), "Local Currency Sovereign Risk", Journal of Finance 71(3); BIS Effective Exchange Rate Indices.',
    methodologyNote:
      'Compares FX-hedged local currency yields against hard-currency Eurobonds while accounting for governing-law redenomination risk (Chamon, Schumacher & Trebesch, 2018).',
  },

  LEONTIEF_HHI_SUPPLY_CHAIN: {
    id: 'LEONTIEF_HHI_SUPPLY_CHAIN',
    title: 'Leontief Inverse Input-Output Matrix (I − A)⁻¹ & Herfindahl-Hirschman Supplier Concentration (HHI)',
    category: 'SUPPLY_CHAIN_IO',
    categoryLabel: 'Supply-Chain Input-Output & Trade Network',
    formulaMono: 'X = (I − A)^{−1} · Y,   L = I + A + A^2 + ...   |   HHI = Σ_{i=1}^N s_i^2 ∈ [0, 10,000]',
    plainEnglishSummary:
      'Calculates how a bottleneck in one critical raw material (like semiconductors, lithium, or energy) cascades across every downstream factory and sector in the economy ((I − A)⁻¹ multiplier), and measures whether global supply is controlled by a single country monopoly (HHI).',
    variables: [
      { symbol: 'A', meaning: 'Direct technical coefficients matrix (a_{ij} = input from sector i required per $1 output of sector j)', unit: 'N×N Matrix' },
      { symbol: 'L = (I − A)⁻¹', meaning: 'Leontief Inverse matrix capturing direct + all indirect Nth-order upstream supply cascades', unit: 'Multiplier' },
      { symbol: 'HHI', meaning: 'Herfindahl-Hirschman Index of global export market shares s_i (0–100%) squared', unit: 'Index [0–10,000]' },
      { symbol: 'Stockpile', meaning: 'Domestic strategic reserve buffer measured in days of uninterrupted national consumption', unit: 'Days' },
    ],
    thresholds: [
      { label: 'Competitive Diversified Supply', value: 'HHI < 1,500 · Stockpile > 90 Days · Leontief < 1.6x', severity: 'SAFE' },
      { label: 'Moderately Concentrated Supply', value: '1,500 ≤ HHI < 2,500 · Stockpile 45–90 Days', severity: 'WATCH' },
      { label: 'Acute Single-Country Monopoly Choke', value: 'HHI ≥ 2,500 (Extreme ≥ 4,000) & Stockpile < 45 Days', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'Leontief (1986), "Input-Output Economics", Oxford University Press; OECD Inter-Country Input-Output (ICIO) Tables; U.S. DOJ / FTC Horizontal Merger Guidelines (HHI Thresholds); UN Comtrade Bilateral Flows.',
    methodologyNote:
      'Acemoglu, Carvalho, Ozdaglar & Tahbaz-Salehi (2012, Econometrica) network amplification maps sector supply shocks into aggregate GDP and CPI impulses.',
  },

  CORNISH_FISHER_VAR_CVAR_LVAR: {
    id: 'CORNISH_FISHER_VAR_CVAR_LVAR',
    title: 'Cornish-Fisher Non-Normal VaR, Expected Shortfall (CVaR 99%) & Bangia Liquidity-Adjusted VaR (LVaR)',
    category: 'PORTFOLIO_TAIL_RISK',
    categoryLabel: 'Portfolio Tail-Risk & Liquidity VaR',
    formulaMono: 'z_CF = z_α + (z_α^2−1)·(S/6) + (z_α^3−3z_α)·(K/24) − (2z_α^3−5z_α)·(S^2/36)   |   LVaR = CVaR_99 + 0.5·P·(μ_S + k·σ_S)',
    plainEnglishSummary:
      'Calculates the maximum dollar loss on our $250M sovereign bond portfolio during a 10-day market crash—correcting for fat tails (skewness & kurtosis) where normal Bell-curve models underestimate crashes—and adds the cost of wide bid-ask spreads when everyone rushes for the exit at once (LVaR).',
    variables: [
      { symbol: 'VaR(99%)_CF', meaning: '10-Day 99% Cornish-Fisher Value-at-Risk incorporating empirical skewness (S) and excess kurtosis (K)', unit: 'USD M / % NAV' },
      { symbol: 'CVaR(99%)', meaning: 'Expected Shortfall (average portfolio loss conditional on breaching the 99th percentile VaR threshold)', unit: 'USD M / % NAV' },
      { symbol: 'LVaR(99%)', meaning: 'Bangia et al. Liquidity-Adjusted VaR adding stressed bid-ask liquidation cost', unit: 'USD M / % NAV' },
      { symbol: 'DV01 / CS01', meaning: 'Dollar value of a 1 basis point parallel shift in interest rates (DV01) or credit spreads (CS01)', unit: 'USD k / bp' },
      { symbol: 'ρ_stress', meaning: 'Regime-conditional cross-sovereign correlation during risk-off contagion spikes', unit: '[-1.0, +1.0]' },
    ],
    thresholds: [
      { label: 'Within Institutional Risk Mandate', value: '10D CVaR(99%) < 4.5% NAV · Liquidity Drag < 15% of VaR', severity: 'SAFE' },
      { label: 'CRO Risk Budget Watch', value: '4.5% ≤ 10D CVaR(99%) < 7.5% NAV', severity: 'WATCH' },
      { label: 'Mandatory De-Grossing / Hedge Trigger', value: '10D CVaR(99%) ≥ 7.5% NAV or LVaR > 9.0% NAV', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'Cornish & Fisher (1938), Revue de l’Institut International de Statistique; Artzner, Delbaen, Eber & Heath (1999), "Coherent Measures of Risk", Mathematical Finance 9(3); Bangia, Diebold, Schuermann & Stroughair (2001), Risk Magazine.',
    methodologyNote:
      'Component VaR (CVaR_i = w_i · ∂VaR/∂w_i) decomposes total portfolio tail risk exactly across individual sovereign positions via Euler’s homogeneous function theorem.',
  },

  CAC_RESTRUCTURING_NPV: {
    id: 'CAC_RESTRUCTURING_NPV',
    title: 'Sovereign Debt Restructuring NPV Recovery & ICMA Collective Action Clause (CAC) Holdout Game Theory',
    category: 'RESTRUCTURING_LEGAL',
    categoryLabel: 'Restructuring Workout & CAC Game Theory',
    formulaMono: 'NPV_Rec = (1 − H_prin) · Σ_{t=1}^{T+ΔT} [C_new / (1 + y_exit)^t] + [100·(1 − H_prin) / (1 + y_exit)^{T+ΔT}]',
    plainEnglishSummary:
      'Prices how many cents on the dollar bondholders recover after a principal haircut, maturity extension, and coupon cut discounted at the post-default Exit Yield, and models whether a holdout fund can buy 25.1% of a bond to block the restructuring in court.',
    variables: [
      { symbol: 'H_prin', meaning: 'Nominal face-value principal haircut percentage', unit: '% of Par' },
      { symbol: 'ΔT', meaning: 'Maturity re-profiling extension added to original bond tenor', unit: 'Years' },
      { symbol: 'y_exit', meaning: 'Market discount rate applied to newly issued exchange bonds immediately post-restructuring', unit: '% p.a.' },
      { symbol: 'Single-Limb 75%', meaning: 'ICMA (2014) aggregated voting threshold allowing a 75% supermajority across all series to bind holdouts', unit: '% of Stock' },
      { symbol: 'Blocking_Cost', meaning: 'Market capital required to acquire >25% blocking stake at current distressed bond prices', unit: 'USD Millions' },
    ],
    thresholds: [
      { label: 'Orderly Pre-Emptive Re-Profiling', value: 'Single-Limb Share ≥ 75% · Holdout Net Edge < +2.5¢', severity: 'SAFE' },
      { label: 'Mixed Indenture / Series-by-Series Risk', value: 'Single-Limb Share 45–75% · Blocking Cost $50M–$150M', severity: 'WATCH' },
      { label: 'High Holdout Litigation Equilibrium', value: 'Legacy Dual-Limb > 40% & Single-Series Block < $50M', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'ICMA (2014), "Standard Aggregated Collective Action Clauses (CACs) for the Terms and Conditions of Sovereign Notes"; Sturzenegger & Zettelmeyer (2008), "Haircuts: Estimating Investor Losses in Sovereign Debt Restructurings", Journal of International Money and Finance 27(5); Fang, Schumacher & Trebesch (2021).',
    methodologyNote:
      'Compares the cooperative Nash restructuring recovery against expected holdout litigation payoff net of multi-year legal enforcement costs and attachment probabilities.',
  },

  KELLY_ALMGREN_CHRISS_LOB: {
    id: 'KELLY_ALMGREN_CHRISS_LOB',
    title: 'Brier-Calibrated Half-Kelly Optimal Position Sizing & Almgren-Chriss Limit Order Book (LOB) Market Impact',
    category: 'LIQUIDITY_MICROSTRUCTURE',
    categoryLabel: 'Optimal Sizing & Execution Microstructure',
    formulaMono: 'f*_Half = 0.5 · [(p · b − q) / b]   |   ΔP_Impact = (S_BidAsk / 2) + η · σ_daily · √(Q / ADV)',
    plainEnglishSummary:
      'Converts the AI Council’s calibrated win probability (p) and reward-to-risk ratio (b) into an institutional Half-Kelly portfolio allocation, then subtracts the real-world bid-ask spread and Almgren-Chriss square-root price impact of executing that order size.',
    variables: [
      { symbol: 'p, q', meaning: 'Brier-calibrated probability of trade thesis success (p) and failure (q = 1 − p)', unit: 'Probability' },
      { symbol: 'b', meaning: 'Asymmetric reward-to-risk payoff ratio (Target Alpha bps / Stop-Loss bps)', unit: 'Ratio (x)' },
      { symbol: 'f*_Half', meaning: 'Fractional Half-Kelly capital allocation (% of $250M NAV, capped at 28% per position)', unit: '% of NAV' },
      { symbol: 'Q / ADV', meaning: 'Order ticket notional size Q relative to Average Daily Volume (ADV) in dealer order book', unit: '% of ADV' },
      { symbol: 'ΔP_Impact', meaning: 'Total one-way execution slippage combining quoted half-spread plus temporary/permanent market impact', unit: 'bps' },
    ],
    thresholds: [
      { label: 'Immediate Single-Day Execution', value: 'Order Q < 35% Top-3 Dealer Depth · Slippage < 8 bps', severity: 'SAFE' },
      { label: '2–3 Day TWAP Slicing Recommended', value: 'Order Q 35–65% Depth · Slippage 8–18 bps', severity: 'WATCH' },
      { label: 'Illiquid Order Book / Multi-Day Execution Required', value: 'Order Q > 65% Depth or Slippage > 18 bps', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'Kelly (1956), "A New Interpretation of Information Rate", Bell System Technical Journal 35(4); Almgren & Chriss (2001), "Optimal Execution of Portfolio Transactions", Journal of Risk 3(2), 5–40; Brier (1950) Probability Verification Score.',
    methodologyNote:
      'Half-Kelly (0.5·f*) achieves 75% of theoretical log-utility growth while cutting portfolio drawdown variance by 50% and protecting against parameter estimation error.',
  },

  AVELLANEDA_STOIKOV_MM: {
    id: 'AVELLANEDA_STOIKOV_MM',
    title: 'Avellaneda-Stoikov Inventory-Adjusted Market-Making Reservation Price & Optimal Bid-Ask Spread',
    category: 'LIQUIDITY_MICROSTRUCTURE',
    categoryLabel: 'Market-Maker Quoting & Repo Plumbing',
    formulaMono: 'r(s, q, t) = s − q · γ · σ^2 · (T − t)   |   2δ* = γ · σ^2 · (T − t) + (2 / γ) · ln(1 + γ / κ)',
    plainEnglishSummary:
      'Models how institutional bond and FX market-makers skew their mid-price (Reservation Price r) away from accumulated inventory (q) and widen their quoted Bid-Ask spread (2δ*) when volatility spikes or repo balance-sheet funding dries up.',
    variables: [
      { symbol: 'r(s, q, t)', meaning: 'Dealer inventory-adjusted reservation mid-price skewed by current net position q', unit: 'Price / Rate' },
      { symbol: 'q', meaning: 'Normalized dealer net inventory imbalance (q > 0 long inventory; q < 0 short)', unit: 'USD M / Units' },
      { symbol: 'γ', meaning: 'Dealer absolute risk-aversion & balance-sheet capital charge parameter', unit: 'Risk Coeff' },
      { symbol: 'σ', meaning: 'High-frequency asset price volatility over quoting horizon (T − t)', unit: '% / bps' },
      { symbol: 'κ', meaning: 'Order-book liquidity arrival intensity (depth decay parameter)', unit: 'Arrival Rate' },
    ],
    thresholds: [
      { label: 'Deep Two-Way Dealer Liquidity', value: 'Inventory |q| < 30% Limit · Margin Util < 55% AUM', severity: 'SAFE' },
      { label: 'Asymmetric Quoting Skew', value: 'Inventory |q| 30–65% Limit · Margin Util 55–75% AUM', severity: 'WATCH' },
      { label: 'Dealer Balance-Sheet Freeze / Stop-Out', value: 'Inventory |q| > 65% Limit or Margin Util ≥ 85% AUM', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'Avellaneda & Stoikov (2008), "High-frequency trading in a limit order book", Quantitative Finance 8(3), 217–224; Ho & Stoll (1981), "Optimal dealer pricing under transactions and return uncertainty", Journal of Financial Economics 9(1).',
    methodologyNote:
      'Integrates prime-broker initial margin, repo haircut encumbrance, and variation margin calls under a 30-day funding squeeze simulation.',
  },

  CROSS_DESK_CONTAGION_GATE: {
    id: 'CROSS_DESK_CONTAGION_GATE',
    title: 'Cross-Desk Geopolitical → Macro → Sovereign Credit Contagion Elasticity & CRO Confidence Gate',
    category: 'QUANT_ECONOMETRICS',
    categoryLabel: 'Cross-Desk Contagion & CRO Governance',
    formulaMono: 'ΔSpread_Sov = β_{Sov←Macro} · (β_{Macro←Geo} · ΔShock_Geo)   |   Gate_Pass ⟺ C_Composite ≥ 0.70',
    plainEnglishSummary:
      'Tracks how a physical geopolitical shock (shipping freight spike or sanction) transmits first into domestic inflation and growth, and then into sovereign bond spreads—with an automated Chief Risk Officer (CRO) governance gate that halts autonomous trade execution if model confidence falls below 0.70.',
    variables: [
      { symbol: 'ΔShock_Geo', meaning: 'Upstream geopolitical / maritime freight rate or commodity supply impulse', unit: '% / σ' },
      { symbol: 'β_{Macro←Geo}', meaning: 'Pass-through elasticity from shipping/commodity shock into domestic CPI & trade balance', unit: 'bps per %' },
      { symbol: 'β_{Sov←Macro}', meaning: 'Sensitivity of 5Y sovereign CDS / 10Y bond spreads to macro stagflation deterioration', unit: 'bps per bp' },
      { symbol: 'C_Composite', meaning: 'Brier-weighted multi-agent consensus confidence score audited by the CRO gate', unit: 'Score [0.00–1.00]' },
    ],
    thresholds: [
      { label: 'Autonomous Trade Execution Approved', value: 'C_Composite ≥ 0.75 · Cross-Agent Dissent < 20%', severity: 'SAFE' },
      { label: 'Borderline Governance Review', value: '0.70 ≤ C_Composite < 0.75', severity: 'WATCH' },
      { label: 'Mandatory CRO Human-in-the-Loop Escalation', value: 'C_Composite < 0.70 (Autonomous Sizing Halted)', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'BIS (2023) Macro-Financial Stress Testing Framework; Federal Reserve SR 11-7 Supervisory Guidance on Model Risk Management.',
    methodologyNote:
      'Enforces closed-loop institutional governance: every specialist sub-agent’s empirical output is cross-validated before capital allocation.',
  },

  CONTAGION_SPILLOVER_MCTR: {
    id: 'CONTAGION_SPILLOVER_MCTR',
    title: 'Cross-Sovereign Contagion Matrix (Ω_{i→j}), Marginal Contribution to Risk (MCTR) & Component CVaR',
    category: 'PORTFOLIO_TAIL_RISK',
    categoryLabel: 'Multi-Sovereign Contagion & MCTR',
    formulaMono: 'Δs_j = Ω_{i→j}·Δs_i = (w_T·T_{ij} + w_B·B_{ij} + w_FX·ρ_{ij}^{USD})·Δs_i   |   MCTR_i = ∂CVaR_{99}(w)/∂w_i',
    plainEnglishSummary:
      'Quantifies how a crisis in one country spills over into every other country in our portfolio through trade links (T_{ij}), cross-border bank loans (B_{ij}), and shared dollar funding stress (ρ_{ij}), and isolates which country position adds the most crash risk to the book (MCTR_i).',
    variables: [
      { symbol: 'Ω_{i→j}', meaning: 'Bilateral contagion transmission elasticity from epicenter country i to destination country j', unit: 'bps per 100bp' },
      { symbol: 'T_{ij} / B_{ij}', meaning: 'Bilateral export trade intensity and BIS cross-border banking claim exposure weights', unit: 'Weight [0–1]' },
      { symbol: 'MCTR_i', meaning: 'Marginal Contribution to Risk: change in portfolio CVaR₉₉ from adding 1% more weight to sovereign i', unit: '% NAV' },
      { symbol: 'Comp_CVaR_i', meaning: 'Euler-decomposed Component CVaR₉₉ (w_i · MCTR_i) summing exactly to total portfolio CVaR₉₉', unit: '% NAV / $M' },
    ],
    thresholds: [
      { label: 'Diversified Contagion Buffer', value: 'Max Ω_{i→j} < 0.35 · Single-Country Risk Share < 30%', severity: 'SAFE' },
      { label: 'Moderate Regional Cluster Spillover', value: '0.35 ≤ Ω_{i→j} < 0.55 · Risk Share 30–45%', severity: 'WATCH' },
      { label: 'Systemic Contagion Cascade', value: 'Ω_{i→j} ≥ 0.55 or Single-Country Risk Share > 45%', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'Forbes & Rigobon (2002), "No Contagion, Only Interdependence", Journal of Finance 57(5); Tasche (2002), "Expected Shortfall and Beyond", Journal of Banking & Finance 26(7); BIS Consolidated Banking Statistics.',
    methodologyNote:
      'During tail stress regimes, cross-sovereign correlations shift nonlinearly toward 1.0 for high-beta EM borrowers unless offset by long 5Y CDS protection.',
  },

  EWS_AUROC_NSR_BACKTEST: {
    id: 'EWS_AUROC_NSR_BACKTEST',
    title: 'Crisis Early-Warning Signal Calibration: AUROC, Kaminsky-Reinhart Noise-to-Signal (NSR) & Brier Skill Score',
    category: 'QUANT_ECONOMETRICS',
    categoryLabel: 'Historical Crisis Backtesting & EWS Validation',
    formulaMono: 'AUROC = ∫_0^1 TPR(FPR^{−1}(u))du   |   NSR(θ*) = [FPR(θ*) / TPR(θ*)]   |   BSS = 1 − (BS_Model / BS_Climatology)',
    plainEnglishSummary:
      'Measures how accurately our crisis warning models predicted real-world historical debt defaults and currency crashes months before they happened—balancing early detection (True Positive Rate) against false alarms (Noise-to-Signal Ratio).',
    variables: [
      { symbol: 'AUROC', meaning: 'Area Under the Receiver Operating Characteristic curve (0.50 = random coin flip; 1.00 = perfect crisis classification)', unit: 'Area [0.5–1.0]' },
      { symbol: 'NSR(θ*)', meaning: 'Kaminsky-Lizondo-Reinhart Noise-to-Signal ratio (False Positive Rate divided by True Positive Rate at threshold θ*)', unit: 'Ratio (Lower=Better)' },
      { symbol: 'BSS', meaning: 'Brier Skill Score measuring probability forecast accuracy improvement over naive historical crisis frequency', unit: 'Score [0–1]' },
      { symbol: 'Lead_Time', meaning: 'Months prior to T=0 regime break when composite Markov crisis probability first crossed the 35% alert threshold', unit: 'Months' },
    ],
    thresholds: [
      { label: 'Institutional-Grade Early Warning Calibration', value: 'AUROC ≥ 0.82 · NSR < 0.25 · Lead Time ≥ 6 Months', severity: 'SAFE' },
      { label: 'Moderate Predictive Discrimination', value: '0.70 ≤ AUROC < 0.82 · NSR 0.25–0.45', severity: 'WATCH' },
      { label: 'Noisy / Lagging Signal Calibration', value: 'AUROC < 0.70 or NSR > 0.45 or Lead Time < 3 Months', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'Kaminsky, Lizondo & Reinhart (1998), "Leading Indicators of Currency Crises", IMF Staff Papers 45(1); Berge & Jordà (2011), "Evaluating the Classification of Economic Activity into Recessions and Expansions", AEJ: Macroeconomics 3(2); Brier (1950).',
    methodologyNote:
      'Evaluated out-of-sample across canonical emerging and developed market sovereign crises over a 24-month pre-crisis window [T−24m, T=0].',
  },

  NEWEY_WEST_HAC_OLS: {
    id: 'NEWEY_WEST_HAC_OLS',
    title: 'In-Browser Matrix OLS Estimator with Newey-West HAC Covariance & Bohn Fiscal Sustainability Test',
    category: 'QUANT_ECONOMETRICS',
    categoryLabel: 'Matrix Econometrics & HAC Inference',
    formulaMono: 'β̂ = (XᵀX)⁻¹Xᵀy   |   V̂_HAC = (XᵀX)⁻¹ Ω̂_NW (XᵀX)⁻¹   |   pb_t = α + ρ_Bohn·d_{t-1} + γ_Y·Ỹ_t + ε_t',
    plainEnglishSummary:
      'Runs live matrix Ordinary Least Squares (OLS) regressions on sovereign historical time series with Newey-West Heteroskedasticity and Autocorrelation Consistent (HAC) standard errors, testing whether governments systematically raise primary surpluses when debt rises (Bohn sustainability test ρ > 0).',
    variables: [
      { symbol: 'β̂', meaning: 'Exact matrix Ordinary Least Squares parameter vector (XᵀX)⁻¹Xᵀy', unit: 'Vector' },
      { symbol: 'SE_HAC', meaning: 'Newey-West Bartlett-kernel heteroskedasticity and autocorrelation robust standard error', unit: 'Std Error' },
      { symbol: 't_HAC', meaning: 'HAC-robust t-statistic (β̂_k / SE_HAC,k) testing null hypothesis H₀: β_k = 0', unit: 't-stat' },
      { symbol: 'ρ_Bohn', meaning: 'Bohn (1998) fiscal reaction coefficient of primary balance to lagged debt-to-GDP', unit: 'Slope (ρ > 0 sustainable)' },
      { symbol: 'DW', meaning: 'Durbin-Watson first-order residual serial correlation statistic', unit: 'Stat [0–4]' },
    ],
    thresholds: [
      { label: 'Statistically Significant Fiscal Orthodoxy', value: 'ρ_Bohn > +0.035 · |t_HAC| ≥ 2.00 (p < 0.05) · Adj R² ≥ 0.65', severity: 'SAFE' },
      { label: 'Weak / Acyclical Policy Reaction', value: '0.00 ≤ ρ_Bohn ≤ +0.035 · 1.65 ≤ |t_HAC| < 2.00', severity: 'WATCH' },
      { label: 'Fiscal Fatigue / Non-Stationary Debt Drift', value: 'ρ_Bohn < 0.00 or |t_HAC| < 1.65 (Fail to Reject Insolvency)', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'Newey & West (1987), "A Simple, Positive Semi-Definite, Heteroskedasticity and Autocorrelation Consistent Covariance Matrix", Econometrica 55(3), 703–708; Bohn (1998), "The Behavior of U.S. Public Debt and Deficits", Quarterly Journal of Economics 113(3).',
    methodologyNote:
      'Estimated via Gauss-Jordan matrix inversion on (XᵀX) with Bartlett kernel lag truncation L = floor(4·(T/100)^(2/9)).',
  },

  DV01_CS01_CARRY_ROLL: {
    id: 'DV01_CS01_CARRY_ROLL',
    title: 'Multi-Asset Fixed Income Greeks (DV01, CS01, Convexity) & 3M Carry + Roll-Down Attribution',
    category: 'PORTFOLIO_TAIL_RISK',
    categoryLabel: 'Relative-Value Structuring & Risk Greeks',
    formulaMono: 'DV01 = −(∂P/∂y)·10⁻⁴ = N·D_mod·10⁻⁴   |   TR_3M ≈ Carry_3M + Roll_3M − D_mod·Δy + ½·Cvx·(Δy)²',
    plainEnglishSummary:
      'Quantifies exact dollar P&L sensitivity per basis point of interest rate shift (DV01) and credit spread shift (CS01), alongside 90-day static yield carry, curve roll-down gain, and the breakeven yield widening cushion.',
    variables: [
      { symbol: 'DV01', meaning: 'Dollar Value of 01: P&L change in USD for a 1 bp (0.01%) parallel shift in local rates', unit: '$ / bp' },
      { symbol: 'CS01', meaning: 'Credit Spread 01: P&L change in USD for a 1 bp shift in sovereign CDS / Z-spread', unit: '$ / bp' },
      { symbol: 'Carry_3M', meaning: '3-month net coupon/spread accrual minus repo or USD funding cost', unit: 'bps (90D)' },
      { symbol: 'Roll_3M', meaning: '3-month capital appreciation from rolling down a steep yield or hazard curve', unit: 'bps (90D)' },
      { symbol: 'BE_Width', meaning: 'Breakeven spread widening = (Carry_3M + Roll_3M) / Modified_Duration', unit: 'bps' },
    ],
    thresholds: [
      { label: 'High Cushion Relative-Value Trade', value: 'Breakeven Widening ≥ +35 bps · Carry+Roll / Vol ≥ 0.75', severity: 'SAFE' },
      { label: 'Moderate Carry Buffer', value: '+15 bps ≤ Breakeven Widening < +35 bps', severity: 'WATCH' },
      { label: 'Negative Carry / Convexity Trap', value: 'Breakeven Widening < +15 bps or Net DV01 Unhedged', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'Tuckman & Serrat (2022), "Fixed Income Securities: Tools for Today’s Markets", 4th Ed., Wiley Finance; Fabozzi (2015), "Bond Markets, Analysis, and Strategies".',
    methodologyNote:
      'Multi-leg packages (e.g., 2s10s flatteners and CDS-bond negative basis trades) weight leg notionals by inverse modified duration or survival-adjusted RPV01.',
  },

  ECONOMIC_SURPRISE_INDEX_Z: {
    id: 'ECONOMIC_SURPRISE_INDEX_Z',
    title: 'Standardized Macro Release Surprise Z-Score, Decay-Weighted ESI & Bayesian Regime Update',
    category: 'MONETARY_INFLATION',
    categoryLabel: 'Macro Release Surveillance & Surprise Index',
    formulaMono: 'Z_k = (A_k − C_k) / σ_k   |   ESI_t = Σ_k w_k·e^{−λ·Δt_k}·Z_k   |   P(S_t=1 | Z) = [P(Z|S=1)·P(S=1)] / P(Z)',
    plainEnglishSummary:
      'Measures how much actual economic data releases beat or miss Bloomberg/Reuters consensus forecasts in standard-deviation units (Z-scores), aggregates them into Growth and Inflation Surprise Indices, and updates sovereign crisis probabilities via Bayes’ Rule.',
    variables: [
      { symbol: 'Z_k', meaning: 'Standardized surprise for macro release k: (Actual − Consensus) / historical forecast error σ_k', unit: 'σ (Std Devs)' },
      { symbol: 'ESI_t', meaning: 'Exponentially time-decaying Economic Growth Surprise Index (positive = stronger than expected)', unit: 'Index (−100 to +100)' },
      { symbol: 'ISI_t', meaning: 'Exponentially time-decaying Inflation Surprise Index (positive = hotter inflation prints)', unit: 'Index (−100 to +100)' },
      { symbol: 'P(S_t=1|Z)', meaning: 'Posterior Hamilton crisis regime probability after conditioning on realized macro surprises', unit: '% Prob' },
    ],
    thresholds: [
      { label: 'Goldilocks Disinflationary Growth', value: 'ESI > +15 · ISI < +10 · Posterior ΔP(Crisis) ≤ 0%', severity: 'SAFE' },
      { label: 'Mixed / Hawkish Repricing Impulse', value: '−20 ≤ ESI ≤ +15 or +10 ≤ ISI < +35', severity: 'WATCH' },
      { label: 'Stagflationary Surprise Shock', value: 'ESI < −20 and ISI ≥ +35 · Posterior ΔP(Crisis) > +5%', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'Citigroup Global Markets (2003), "Citigroup Economic Surprise Index (CESI) Methodology"; Scotti (2016), "Surprise and Uncertainty Indexes: Real-Time Aggregation of Real-Activity Macro-Surprises", Journal of Monetary Economics 82, 1–19.',
    methodologyNote:
      'Half-life decay weight λ = ln(2)/45 days ensures recent tier-1 prints (CPI, MPC decision, Primary Balance, FX Reserves) dominate the composite signal.',
  },

  BEER_FEER_FX_EQUILIBRIUM: {
    id: 'BEER_FEER_FX_EQUILIBRIUM',
    title: 'Behavioral (BEER) & Fundamental (FEER) Equilibrium Exchange Rate & Balassa-Samuelson Misalignment',
    category: 'FX_RESERVES',
    categoryLabel: 'FX Equilibrium Valuation (BEER / FEER)',
    formulaMono: 'q*_BEER = β_0 + β_ToT·ln(ToT_t) + β_BS·(Prod_Diff_t) + β_RIR·(r_dom − r_for) + β_NFA·(NFA/GDP_t)   |   Δe_FEER = (CA_norm − CA_actual) / η_CA',
    plainEnglishSummary:
      'Estimates a currency’s fair value using both economic fundamentals—Terms of Trade, productivity growth (Balassa-Samuelson), real interest rate differentials, and Net Foreign Assets (BEER)—and the exchange rate adjustment required to bring the Current Account back to a sustainable norm (FEER).',
    variables: [
      { symbol: 'q*_BEER', meaning: 'Behavioral Equilibrium Real Effective Exchange Rate fitted from long-run cointegrating vectors', unit: 'Index (100=Par)' },
      { symbol: 'Δe_FEER', meaning: 'Fundamental Equilibrium Exchange Rate depreciation/appreciation required to close the Current Account gap', unit: '% Misalignment' },
      { symbol: 'ToT_t', meaning: 'Commodity net barter terms-of-trade index (export price index divided by import price index)', unit: 'Index' },
      { symbol: 'r_dom − r_for', meaning: 'Real interest rate differential versus US 10Y TIPS / G3 weighted real yield', unit: 'bps / %' },
      { symbol: 'η_CA', meaning: 'Marshall-Lerner trade balance elasticity with respect to the real exchange rate', unit: 'Elasticity' },
    ],
    thresholds: [
      { label: 'Fairly Valued / Undervalued Buffer', value: 'Composite Misalignment ≤ +5.0% · CA Gap > −1.5% GDP', severity: 'SAFE' },
      { label: 'Moderate Real Overvaluation', value: '+5.0% < Misalignment ≤ +15.0%', severity: 'WATCH' },
      { label: 'Acute Overvaluation / Devaluation Risk', value: 'Misalignment > +15.0% or FEER Gap < −3.5% GDP', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'Clark & MacDonald (1998), "Exchange Rates and Economic Fundamentals: A Methodological Comparison of BEERs and FEERs", IMF Working Paper 98/67; Williamson (1994), "Estimating Equilibrium Exchange Rates", Peterson Institute; IMF External Balance Assessment (EBA).',
    methodologyNote:
      'Blends cointegrating BEER structural drivers (55% weight) with IMF EBA-style FEER current-account elasticity norms (45% weight).',
  },

  SHADOW_RATING_ORDERED_LOGIT: {
    id: 'SHADOW_RATING_ORDERED_LOGIT',
    title: 'Ordered Probit/Logit Sovereign Shadow Credit Rating & Fallen-Angel Forced Selling Cliff',
    category: 'CREDIT_DEFAULT',
    categoryLabel: 'Sovereign Credit Ratings & Fallen-Angel Risk',
    formulaMono: 'Y*_i = X_iᵀβ + ε_i,   Rating_i = k ⟺ μ_{k−1} < Y*_i ≤ μ_k   |   ΔSpread_Cliff = γ_IG→HY · Forced_Sale_Pct_Stock',
    plainEnglishSummary:
      'Uses quantitative macro-fiscal ratios to calculate the fundamental credit rating a country deserves right now (Shadow Rating) compared to S&P/Moody’s/Fitch, and models the spike in bond yields if a downgrade below BBB− forces Investment-Grade index funds to dump the bonds.',
    variables: [
      { symbol: 'Y*_i', meaning: 'Continuous latent sovereign creditworthiness score from 6 macro-fiscal and institutional pillars', unit: 'Score [0–100]' },
      { symbol: 'Notch_Gap', meaning: 'Shadow fundamental rating minus official S&P/Moody’s/Fitch rating (negative = downgrade pressure)', unit: 'Notches' },
      { symbol: 'P(Downgrade)', meaning: '12-month logistic probability of a 1+ notch sovereign rating downgrade', unit: '%' },
      { symbol: 'BBB− Cliff', meaning: 'Distance in notches above the Investment Grade / High Yield (BBB− / BB+) boundary', unit: 'Notches' },
    ],
    thresholds: [
      { label: 'Stable / Upgrade Momentum', value: 'Notch Gap ≥ 0 · Distance to HY ≥ +2 Notches', severity: 'SAFE' },
      { label: 'Negative Outlook / 1-Notch Overrated', value: 'Notch Gap = −1 · P(Downgrade) 25–50%', severity: 'WATCH' },
      { label: 'Fallen-Angel Cliff / Multi-Notch Lag', value: 'Notch Gap ≤ −2 or At BBB− With Negative Gap', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'Afonso, Gomes & Rother (2011), "Short- and Long-Run Determinants of Sovereign Debt Credit Ratings", International Journal of Finance & Economics 16(1); Cantor & Packer (1996), FRBNY Economic Policy Review; S&P Global Sovereign Rating Methodology.',
    methodologyNote:
      'Forced selling pressure at the BBB−/BB+ threshold reflects passive mandate exclusions from Bloomberg Global Aggregate and WGBI indices.',
  },

  DMO_AUCTION_BID_TO_COVER: {
    id: 'DMO_AUCTION_BID_TO_COVER',
    title: 'Treasury DMO Primary Auction Bid-to-Cover Ratio, Auction Tail & Primary Dealer Stop-Out Yield',
    category: 'LIQUIDITY_MICROSTRUCTURE',
    categoryLabel: 'Primary Issuance & Treasury Auction Microstructure',
    formulaMono: 'BTC = Total_Tenders / Offered_Par   |   Tail_bps = (y_StopOut − y_WI_Mid) × 100   |   Δy_Supply = λ_DMO · (Offered / Avg_Depth)',
    plainEnglishSummary:
      'Simulates a live government bond auction to test whether investors bid aggressively (high Bid-to-Cover ratio) or demand a steep discount above the pre-auction market yield (Auction Tail in bps), forcing primary dealers to absorb unsold bonds.',
    variables: [
      { symbol: 'BTC', meaning: 'Bid-to-Cover ratio: total competitive + non-competitive bids divided by auction supply', unit: 'Ratio (x)' },
      { symbol: 'Tail_bps', meaning: 'Auction tail: clearing stop-out yield minus When-Issued (WI) pre-auction mid-yield', unit: 'bps' },
      { symbol: 'Dealer_Take', meaning: 'Residual share of auction supply devolved onto domestic primary dealer balance sheets', unit: '% of Issue' },
      { symbol: 'y_StopOut', meaning: 'Uniform or Dutch auction marginal clearing yield where cumulative demand equals offered supply', unit: '% p.a.' },
    ],
    thresholds: [
      { label: 'Strong Oversubscription (Stop-Through)', value: 'BTC ≥ 2.40x · Tail ≤ 0.5 bps · Dealer Take < 20%', severity: 'SAFE' },
      { label: 'Soft Demand / Moderate Concession', value: '1.75x ≤ BTC < 2.40x · Tail 0.5–4.0 bps', severity: 'WATCH' },
      { label: 'Tailing / Uncovered Auction Stress', value: 'BTC < 1.75x or Tail > 4.0 bps or Dealer Take > 40%', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'Lou, Yan & Zhang (2013), "Anticipated and Repeated Shocks in Liquid Markets", Review of Financial Studies 26(8) (Treasury Auction Cycles); Beetsma et al. (2016), "Price Effects of Sovereign Debt Auctions", Journal of International Money and Finance.',
    methodologyNote:
      'Models downward-sloping institutional demand schedules across Domestic Banks, Pension/Insurance, Foreign Real Money, and Primary Dealers.',
  },

  PCA_ALPHA_CORRELATION: {
    id: 'PCA_ALPHA_CORRELATION',
    title: 'Eigenvalue Principal Component Analysis (PC1 Global Beta vs. Idiosyncratic Alpha) & Minimum-Variance Portfolio',
    category: 'PORTFOLIO_TAIL_RISK',
    categoryLabel: 'Cross-Sovereign Correlation & PCA Decomposition',
    formulaMono: 'R · v_k = λ_k · v_k   |   ΔS_{i,t} = β_{i,PC1}·F_{PC1,t} + ε_{i,t}   |   min_w wᵀΣw  s.t.  wᵀ1 = 1, w_i ≥ 0',
    plainEnglishSummary:
      'Separates global "Risk-On / Risk-Off" market waves that move all emerging markets together (First Principal Component PC1) from pure country-specific stories (Idiosyncratic Alpha ε_i), and solves for the portfolio weights that minimize total volatility.',
    variables: [
      { symbol: 'ρ_{i,j}', meaning: 'Pairwise rolling Pearson correlation of 5Y CDS / 10Y Eurobond spread changes between country i and j', unit: '[-1.0, +1.0]' },
      { symbol: 'PC1_Var%', meaning: 'Share of total cross-sovereign spread variance explained by the 1st global eigenvalue (λ₁ / Σλ_k)', unit: '% Variance' },
      { symbol: 'R²_Alpha', meaning: 'Idiosyncratic variance share (1 − β²_{i,PC1}) driven by domestic fiscal/political catalysts', unit: '% Idiosyncratic' },
      { symbol: 'DR', meaning: 'Choueifaty Diversification Ratio = (Σ w_i σ_i) / √(wᵀ Σ w)', unit: 'Ratio (≥ 1.0x)' },
    ],
    thresholds: [
      { label: 'High Idiosyncratic Dispersion (Alpha Rich)', value: 'PC1 Share < 55% · Avg Pairwise ρ < 0.35 · DR ≥ 1.45x', severity: 'SAFE' },
      { label: 'Moderate Global Macro Beta Dominance', value: '55% ≤ PC1 Share < 72% · Avg Pairwise ρ 0.35–0.55', severity: 'WATCH' },
      { label: 'Correlation-1 Contagion Lockstep', value: 'PC1 Share ≥ 72% or Avg Pairwise ρ > 0.55', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'Longstaff, Pan, Pedersen & Singleton (2011), "How Sovereign Is Sovereign Credit Risk?", American Economic Journal: Macroeconomics 3(2), 75–103; Choueifaty & Coignard (2008), "Toward Maximum Diversification", Journal of Portfolio Management.',
    methodologyNote:
      'Extracts the dominant eigenvector via power iteration on the N×N correlation matrix and solves for inverse-volatility / minimum-variance weights.',
  },

  PORTFOLIO_STRESS_CONVEXITY_PNL: {
    id: 'PORTFOLIO_STRESS_CONVEXITY_PNL',
    title: 'Multi-Sovereign EMBI Batch Stress-Test Attribution: Credit CS01 + Convexity, Unhedged FX & Carry Cushion',
    category: 'PORTFOLIO_TAIL_RISK',
    categoryLabel: 'EMBI Portfolio Batch Stress-Test & Attribution',
    formulaMono: 'ΔNAV_i = w_i · [−CS01_i·(β_i·ΔS_shock) + ½·Cvx_i·(ΔS_i)² − D_UST,i·Δy_UST − θ_FX,i·ΔFX_shock + CarryRoll_30D,i]',
    plainEnglishSummary:
      'Runs simultaneous multi-factor stress shocks (e.g., 20% currency devaluation + 200bps spread widening + US Treasury rate jump) across the entire multi-sovereign EMBI portfolio and decomposes the instantaneous NAV hit into Credit Spread, FX Pass-Through, Duration, and 30D Carry+Roll buffer.',
    variables: [
      { symbol: 'w_i', meaning: 'Normalized portfolio allocation weight of sovereign i (summing to 100.0% of Book NAV)', unit: '% Weight' },
      { symbol: 'β_i · ΔS_shock', meaning: 'Contagion-amplified sovereign spread widening shock scaled by country beta', unit: 'bps' },
      { symbol: 'θ_FX,i · ΔFX', meaning: 'Unhedged local-currency bond valuation loss plus FX-denominated debt/GDP stock-flow shock', unit: 'bps of NAV' },
      { symbol: '½·Cvx·(ΔS)²', meaning: 'Second-order bond convexity & credit hazard non-linearity under large (>150bps) spread shocks', unit: 'bps of NAV' },
      { symbol: 'ΔNAV_Book', meaning: 'Instantaneous aggregate portfolio profit/loss across all sovereign positions', unit: 'bps / % NAV' },
    ],
    thresholds: [
      { label: 'Resilient Portfolio / Carry Cushion Intact', value: 'Book Drawdown > −2.50% NAV (−250 bps)', severity: 'SAFE' },
      { label: 'Moderate Multi-Factor Stress Drawdown', value: '−6.00% ≤ Book Drawdown ≤ −2.50% NAV', severity: 'WATCH' },
      { label: 'Severe Tail Drawdown / Hedge Trigger', value: 'Book Drawdown < −6.00% NAV (< −600 bps)', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'J.P. Morgan EMBI Global Diversified Index Methodology; BCBS (2019), "Minimum Capital Requirements for Market Risk (FRTB)"; IMF Global Financial Stability Report Multi-Factor Sovereign Stress Testing.',
    methodologyNote:
      'Simultaneously evaluates custom 5-factor shock sliders against 6 canonical institutional crisis presets to size optimal CDX.EM / 5Y CDS tail protection.',
  },

  NGFS_CLIMATE_SLB_GREENIUM: {
    id: 'NGFS_CLIMATE_SLB_GREENIUM',
    title: 'NGFS Climate Physical/Transition Sovereign Risk & Sustainability-Linked Bond (SLB) Step-Up Option Pricing',
    category: 'DEBT_DYNAMICS',
    categoryLabel: 'NGFS Climate Stress & SLB Greenium Pricing',
    formulaMono: 'Greenium_bps = y_SLB − y_Vanilla = −[P(Miss_SPT) · PV(ΔCoupon_StepUp) + θ_ESG_Demand]   |   Δd_NGFS = f(Flood_GDP, Carbon_Tax)',
    plainEnglishSummary:
      'Models how acute physical climate disasters (droughts, floods) and carbon border taxes impact sovereign debt-to-GDP under NGFS scenarios, and prices the yield discount (Greenium) and coupon penalty option on Sustainability-Linked Sovereign Bonds (SLBs).',
    variables: [
      { symbol: 'Greenium', meaning: 'Yield spread discount of a sovereign Green/SLB bond relative to an identical vanilla twin bond', unit: 'bps' },
      { symbol: 'P(Miss_SPT)', meaning: 'Risk-neutral probability that the sovereign fails its Sustainability Performance Target (e.g., deforestation or GHG cap)', unit: '%' },
      { symbol: 'ΔCoupon_StepUp', meaning: 'Contractual coupon penalty increase triggered if the sovereign misses its environmental KPI target', unit: 'bps (e.g. +25bp)' },
      { symbol: 'Δd_NGFS', meaning: 'Cumulative 2030/2050 Debt/GDP increase under NGFS Disorderly Transition or Hot House World scenarios', unit: '% of GDP' },
    ],
    thresholds: [
      { label: 'Credible SPT Trajectory & Positive Greenium', value: 'P(Miss SPT) < 25% · NGFS Debt Shock < +4% GDP', severity: 'SAFE' },
      { label: 'Borderline KPI Verification Risk', value: '25% ≤ P(Miss SPT) < 55% · NGFS Debt Shock +4–8% GDP', severity: 'WATCH' },
      { label: 'High Step-Up Trigger & Stranded Asset Shock', value: 'P(Miss SPT) ≥ 55% or NGFS Debt Shock > +8% GDP', severity: 'DISTRESS' },
    ],
    primarySourceCitation:
      'Network for Greening the Financial System (NGFS, 2023), "NGFS Climate Scenarios for Central Banks and Supervisors"; Berrada, Engelhardt, Gibson & Krueger (2022), "The Economics of Sustainability-Linked Bonds", Swiss Finance Institute WP.',
    methodologyNote:
      'Treats the SLB coupon step-up as a digital binary option embedded in the sovereign cash-flow waterfall.',
  },
};

/**
 * Extracts key=value or label:value pairs from a raw statistical reference string
 * so the interactive popover can display live sovereign telemetry alongside the formal formula.
 */
export function extractLiveMetricsFromRefText(rawText: string): Array<{ label: string; value: string }> {
  const cleaned = rawText
    .replace(/^\s*\(?\s*(?:Statistical\s+Reference|Statistical\s+Ref|Ref)\s*:\s*/i, '')
    .replace(/\)\s*$/, '')
    .trim();

  // Split by middle dot `·`, pipe `|`, or semicolon `;`
  const segments = cleaned
    .split(/\s*(?:·|\||;)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  const metrics: Array<{ label: string; value: string }> = [];

  for (const seg of segments) {
    // Skip pure formula definitions like d_t = ((1 + r_t)/(1 + g_t))·d_{t-1}
    if (seg.includes('d_{t-1}') || seg.includes('f* = 0.5')) {
      continue;
    }
    const eqIdx = seg.indexOf('=');
    const colonIdx = seg.indexOf(':');
    if (eqIdx !== -1 && eqIdx < 48) {
      const label = seg.slice(0, eqIdx).trim();
      const value = seg.slice(eqIdx + 1).trim();
      if (label && value) {
        metrics.push({ label, value });
      }
    } else if (colonIdx !== -1 && colonIdx < 48) {
      const label = seg.slice(0, colonIdx).trim();
      const value = seg.slice(colonIdx + 1).trim();
      if (label && value) {
        metrics.push({ label, value });
      }
    } else if (seg.length <= 56 && /\d/.test(seg)) {
      metrics.push({ label: 'Active Telemetry', value: seg });
    }
  }

  return metrics.slice(0, 6);
}

/**
 * Resolves any standalone `Ref: ...` / `Statistical Reference: ...` badge string or
 * inline parenthetical `(Ref: ...)` citation to its full institutional mathematical specification.
 */
export function resolveStatRefDefinition(rawRefText: string): ResolvedStatRef {
  const lower = rawRefText.toLowerCase();
  const extractedMetrics = extractLiveMetricsFromRefText(rawRefText);

  const buildResolved = (def: StatRefDefinition): ResolvedStatRef => ({
    ...def,
    rawRefText,
    extractedMetrics,
  });

  // 0. Direct Catalog Key Match
  for (const key of Object.keys(STATISTICAL_REFERENCE_CATALOG)) {
    if (rawRefText.includes(key)) {
      return buildResolved(STATISTICAL_REFERENCE_CATALOG[key]);
    }
  }

  // 0a-1. Newey-West HAC OLS & Bohn Sustainability Test
  if (
    lower.includes('newey-west') ||
    lower.includes('hac') ||
    lower.includes('bohn') ||
    lower.includes('durbin-watson') ||
    lower.includes('matrix ols')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.NEWEY_WEST_HAC_OLS);
  }

  // 0a-2. DV01, CS01, Carry & Roll-Down
  if (
    lower.includes('dv01') ||
    lower.includes('cs01') ||
    lower.includes('roll-down') ||
    lower.includes('breakeven widening')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.DV01_CS01_CARRY_ROLL);
  }

  // 0a-3. Economic Surprise Index (ESI / ISI) & Bayesian Regime Update
  if (
    lower.includes('surprise index') ||
    lower.includes('esi') ||
    lower.includes('isi') ||
    lower.includes('bayesian') ||
    lower.includes('consensus surprise')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.ECONOMIC_SURPRISE_INDEX_Z);
  }

  // 0a. Historical Crisis Backtest Calibration (AUROC / NSR / Brier Skill Score)
  if (
    lower.includes('auroc') ||
    lower.includes('noise-to-signal') ||
    lower.includes('nsr') ||
    lower.includes('brier skill') ||
    lower.includes('lead time') ||
    lower.includes('lead-time')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.EWS_AUROC_NSR_BACKTEST);
  }

  // 0b. Cross-Sovereign Contagion Spillover & MCTR
  if (
    lower.includes('contagion spillover') ||
    lower.includes('mctr') ||
    lower.includes('ω(') ||
    lower.includes('component cvar') ||
    lower.includes('bilateral spillover')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.CONTAGION_SPILLOVER_MCTR);
  }

  // 1. Cornish-Fisher VaR / CVaR / LVaR / Correlation Matrix
  if (
    lower.includes('cornish-fisher') ||
    lower.includes('cvar') ||
    lower.includes('lvar') ||
    lower.includes('gaussian var') ||
    lower.includes('correlation matrix') ||
    lower.includes('ρ(i,j)')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.CORNISH_FISHER_VAR_CVAR_LVAR);
  }

  // 2. Half-Kelly & Almgren-Chriss LOB Slippage
  if (
    lower.includes('half-kelly') ||
    lower.includes('almgren-chriss') ||
    lower.includes('brier conviction') ||
    lower.includes('square-root impact') ||
    lower.includes('weighted slippage')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.KELLY_ALMGREN_CHRISS_LOB);
  }

  // 3. Collective Action Clause (CAC) & Restructuring NPV
  if (
    lower.includes('single-limb') ||
    lower.includes('dual-limb') ||
    lower.includes('restructured npv') ||
    lower.includes('exit yield') ||
    lower.includes('blocking cost') ||
    lower.includes('cac')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.CAC_RESTRUCTURING_NPV);
  }

  // 4. Blanchard-Leeper Fiscal Dominance & Reversal Rate r*
  if (
    lower.includes('blanchard') ||
    lower.includes('leeper') ||
    lower.includes('fiscal dominance') ||
    lower.includes('reversal rate') ||
    lower.includes('months to breach')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.BLANCHARD_LEEPER_FISCAL_DOMINANCE);
  }

  // 5. IMF SRDSF Gross Financing Needs (GFN) & Bank CET1 Doom Loop
  if (
    lower.includes('srdsf') ||
    lower.includes('gross financing needs') ||
    lower.includes('gfn') ||
    lower.includes('gennaioli') ||
    lower.includes('doom-loop') ||
    lower.includes('cet1')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.IMF_SRDSF_GFN_DOOM_LOOP);
  }

  // 6. Adrian-Boyarchenko-Giannone Quantile Regression (GaR / FaR)
  if (
    lower.includes('adrian-boyarchenko') ||
    lower.includes('quantile regression') ||
    lower.includes('gar(5%)') ||
    lower.includes('far(95%)') ||
    lower.includes('left-tail gdp') ||
    lower.includes('5th-pct')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.QUANTILE_GAR_FAR);
  }

  // 7. Nelson-Siegel-Svensson & ACM Term Premium
  if (
    lower.includes('nelson-siegel') ||
    lower.includes('svensson') ||
    lower.includes('β₀') ||
    lower.includes('tp₁₀') ||
    lower.includes('term premium') ||
    lower.includes('2s10s')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.NELSON_SIEGEL_SVENSSON_ACM);
  }

  // 8. Hamilton 3-State Markov Switching & Kaminsky-Reinhart EWS
  if (
    lower.includes('hamilton') ||
    lower.includes('markov') ||
    lower.includes('kaminsky-reinhart') ||
    lower.includes('12m crisis prob') ||
    lower.includes('composite z') ||
    lower.includes('regime switching')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.HAMILTON_MARKOV_EWS);
  }

  // 9. Cholesky BVAR(2) & Impulse Response
  if (
    lower.includes('cholesky') ||
    lower.includes('bvar') ||
    lower.includes('irf')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.CHOLESKY_BVAR_IRF);
  }

  // 10. Avellaneda-Stoikov Market-Maker
  if (
    lower.includes('avellaneda') ||
    lower.includes('stoikov') ||
    lower.includes('2δ*') ||
    lower.includes('reservation price')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.AVELLANEDA_STOIKOV_MM);
  }

  // 11. Leontief Input-Output & HHI Supply Chain
  if (
    lower.includes('leontief') ||
    lower.includes('hhi') ||
    lower.includes('(i - a)') ||
    lower.includes('(i − a)') ||
    lower.includes('freight → cpi') ||
    lower.includes('stockpile')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.LEONTIEF_HHI_SUPPLY_CHAIN);
  }

  // 12. Covered Interest Parity (CIP), XCCY Basis, NDF, REER, FXI Drain
  if (
    lower.includes('cip') ||
    lower.includes('xccy') ||
    lower.includes('12m ndf') ||
    lower.includes('reer z') ||
    lower.includes('fxi drain') ||
    lower.includes('ny-law vs') ||
    lower.includes('governing law basis')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.CIP_XCCY_NDF_REER);
  }

  // 13. Greenspan-Guidotti, FX Cover, IMF ARA, Rollover Wall
  if (
    lower.includes('greenspan-guidotti') ||
    lower.includes('fx cover') ||
    lower.includes('imf ara') ||
    lower.includes('peak rollover') ||
    lower.includes('gg cover') ||
    lower.includes('import cover') ||
    lower.includes('reserve adequacy')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.GREENSPAN_GUIDOTTI_ARA);
  }

  // 14. ISDA CDS Hazard Rate, 5Y Cum PD, CDS-Bond Basis
  if (
    lower.includes('5y cds') ||
    lower.includes('hazard rate') ||
    lower.includes('cum pd') ||
    lower.includes('λ₁') ||
    lower.includes('par-equiv spread') ||
    lower.includes('cds spread')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.ISDA_CDS_HAZARD_BASIS);
  }

  // 15. Caldara-Iacoviello GPR, GDELT, Polymarket, OFAC
  if (
    lower.includes('caldara') ||
    lower.includes('gpr') ||
    lower.includes('gdelt') ||
    lower.includes('polymarket') ||
    lower.includes('goldstein') ||
    lower.includes('ofac') ||
    lower.includes('event velocity')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.CALDARA_IACOVIELLO_GPR_GDELT);
  }

  // 16. Cross-Desk Contagion & CRO Gate
  if (
    lower.includes('cro gate') ||
    lower.includes('geo→macro') ||
    lower.includes('macro→sov')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.CROSS_DESK_CONTAGION_GATE);
  }

  // 17. Fiscal Primary Gap & Rate/FX Pass-Through
  if (
    lower.includes('primary gap') ||
    lower.includes('fx pass-through') ||
    lower.includes('rate shock')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.FISCAL_CONSOLIDATION_SIM);
  }

  // 18. Monetary Policy Rate, CPI, Real Rate
  if (
    lower.includes('policy =') ||
    lower.includes('cpi =') ||
    lower.includes('real =') ||
    lower.includes('inflation') ||
    lower.includes('taylor')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.MONETARY_TAYLOR_REAL_RATE);
  }

  // 19. BEER / FEER FX Equilibrium
  if (
    lower.includes('beer') ||
    lower.includes('feer') ||
    lower.includes('balassa-samuelson') ||
    lower.includes('equilibrium fx') ||
    lower.includes('currency misalignment')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.BEER_FEER_FX_EQUILIBRIUM);
  }

  // 20. Shadow Rating & Fallen-Angel Cliff
  if (
    lower.includes('shadow rating') ||
    lower.includes('ordered logit') ||
    lower.includes('fallen angel') ||
    lower.includes('fallen-angel') ||
    lower.includes('notch gap') ||
    lower.includes('bbb-')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.SHADOW_RATING_ORDERED_LOGIT);
  }

  // 21. Treasury DMO Primary Auction Bid-to-Cover & Tail
  if (
    lower.includes('bid-to-cover') ||
    lower.includes('auction tail') ||
    lower.includes('stop-out') ||
    lower.includes('dmo auction') ||
    lower.includes('primary dealer take')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.DMO_AUCTION_BID_TO_COVER);
  }

  // 22. PCA Alpha Correlation & Minimum Variance
  if (
    lower.includes('pca') ||
    lower.includes('pc1') ||
    lower.includes('idiosyncratic alpha') ||
    lower.includes('diversification ratio') ||
    lower.includes('eigenvalue')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.PCA_ALPHA_CORRELATION);
  }

  // 23. Portfolio Batch Stress-Test & Convexity Attribution
  if (
    lower.includes('batch stress') ||
    lower.includes('stress-test') ||
    lower.includes('convexity') ||
    lower.includes('200bps') ||
    lower.includes('devaluation') ||
    lower.includes('book nav')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.PORTFOLIO_STRESS_CONVEXITY_PNL);
  }

  // 24. NGFS Climate & SLB Greenium
  if (
    lower.includes('ngfs') ||
    lower.includes('greenium') ||
    lower.includes('slb') ||
    lower.includes('sustainability-linked') ||
    lower.includes('step-up coupon')
  ) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.NGFS_CLIMATE_SLB_GREENIUM);
  }

  // 25. Standalone VaR match
  if (/\bvar\b/i.test(rawRefText) || lower.includes('value-at-risk') || lower.includes('expected shortfall')) {
    return buildResolved(STATISTICAL_REFERENCE_CATALOG.CORNISH_FISHER_VAR_CVAR_LVAR);
  }

  // 26. Default / Debt Snowball r - g & pb*
  return buildResolved(STATISTICAL_REFERENCE_CATALOG.DSA_SNOWBALL);
}

/**
 * Detects whether a UI badge, header, or label contains an institutional statistical reference term
 * (e.g., VaR, CVaR, DV01, CS01, MCTR, Z-Spread, NSS, BEER, FEER, CAC, HAC, AUROC, Brier, etc.)
 * and returns the canonical reference key/text for tooltip resolution.
 */
export function detectStatisticalTermInText(text: string): string | null {
  if (!text || text.length > 180) return null;
  const trimmed = text.trim();
  if (trimmed.length < 2) return null;

  const patterns: Array<{ regex: RegExp; key: string }> = [
    { regex: /\b(?:CVaR|VaR|LVaR|Cornish-Fisher|Expected Shortfall)\b/i, key: 'CORNISH_FISHER_VAR_CVAR_LVAR' },
    { regex: /\b(?:DV01|CS01|Carry\s*\+\s*Roll|Roll-Down|Breakeven Cushion)\b/i, key: 'DV01_CS01_CARRY_ROLL' },
    { regex: /\b(?:MCTR|Component CVaR|Contagion Matrix|Spillover)\b/i, key: 'CONTAGION_SPILLOVER_MCTR' },
    { regex: /\b(?:Z-Spread|CDS-Bond Basis|Hazard Rate|Survival Curve|5Y CDS|Cum PD)\b/i, key: 'ISDA_CDS_HAZARD_BASIS' },
    { regex: /\b(?:Newey-West|HAC|Matrix OLS|Bohn Test|Durbin-Watson)\b/i, key: 'NEWEY_WEST_HAC_OLS' },
    { regex: /\b(?:Nelson-Siegel|Svensson|NSS|ACM Term Premium|2s5s10s|2s10s)\b/i, key: 'NELSON_SIEGEL_SVENSSON_ACM' },
    { regex: /\b(?:Greenspan-Guidotti|IMF ARA|Import Cover|Reserve Adequacy)\b/i, key: 'GREENSPAN_GUIDOTTI_ARA' },
    { regex: /\b(?:BEER|FEER|Balassa-Samuelson)\b/i, key: 'BEER_FEER_FX_EQUILIBRIUM' },
    { regex: /\b(?:Shadow Rating|Fallen-Angel|Ordered Logit)\b/i, key: 'SHADOW_RATING_ORDERED_LOGIT' },
    { regex: /\b(?:Bid-to-Cover|Auction Tail|Stop-Out Yield)\b/i, key: 'DMO_AUCTION_BID_TO_COVER' },
    { regex: /\b(?:Single-Limb|Dual-Limb|CAC|Exit Yield|Haircut NPV)\b/i, key: 'CAC_RESTRUCTURING_NPV' },
    { regex: /\b(?:Half-Kelly|Almgren-Chriss|LOB Slippage)\b/i, key: 'KELLY_ALMGREN_CHRISS_LOB' },
    { regex: /\b(?:Avellaneda-Stoikov|Reservation Price)\b/i, key: 'AVELLANEDA_STOIKOV_MM' },
    { regex: /\b(?:AUROC|Noise-to-Signal|Brier Skill|Brier Score)\b/i, key: 'EWS_AUROC_NSR_BACKTEST' },
    { regex: /\b(?:Cholesky|BVAR|Impulse Response|IRF)\b/i, key: 'CHOLESKY_BVAR_IRF' },
    { regex: /\b(?:Growth-at-Risk|Fiscal-at-Risk|GaR|FaR|Quantile Regression)\b/i, key: 'QUANTILE_GAR_FAR' },
    { regex: /\b(?:Hamilton Markov|Kaminsky-Reinhart|Regime Switching)\b/i, key: 'HAMILTON_MARKOV_EWS' },
    { regex: /\b(?:Fiscal Dominance|Reversal Rate|Blanchard-Leeper)\b/i, key: 'BLANCHARD_LEEPER_FISCAL_DOMINANCE' },
    { regex: /\b(?:SRDSF|Gross Financing Needs|GFN|Doom Loop|CET1)\b/i, key: 'IMF_SRDSF_GFN_DOOM_LOOP' },
    { regex: /\b(?:XCCY|CIP Basis|12M NDF|REER Z-Score)\b/i, key: 'CIP_XCCY_NDF_REER' },
    { regex: /\b(?:Leontief|HHI|Herfindahl)\b/i, key: 'LEONTIEF_HHI_SUPPLY_CHAIN' },
    { regex: /\b(?:Caldara-Iacoviello|GPR Z-Score|Goldstein|GDELT)\b/i, key: 'CALDARA_IACOVIELLO_GPR_GDELT' },
    { regex: /\b(?:Taylor Rule|Real Policy Rate)\b/i, key: 'MONETARY_TAYLOR_REAL_RATE' },
    { regex: /\b(?:PCA|PC1|Diversification Ratio)\b/i, key: 'PCA_ALPHA_CORRELATION' },
    { regex: /\b(?:NGFS|Greenium|SLB)\b/i, key: 'NGFS_CLIMATE_SLB_GREENIUM' },
    { regex: /\b(?:pb\*|r\s*[−-]\s*g|Snowball)\b/i, key: 'DSA_SNOWBALL' },
  ];

  for (const item of patterns) {
    if (item.regex.test(trimmed)) {
      return `${item.key} · ${trimmed}`;
    }
  }
  return null;
}

