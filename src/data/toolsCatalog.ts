/**
 * The Tools page (Sam, 2026-11-05: "finish the tools page", under the no-built-in-figures rule).
 *
 * READY tools run only on live feeds, official series and your own files, and show Missing with the
 * reason otherwise. HIDDEN desks are the older library: each computes from built-in example figures,
 * so it stays hidden until the data it needs is connected. Each says what that data is, and which
 * ready tool covers the same question today.
 */

export type ToolTarget =
  | { area: 'today'; anchor: string }
  | { area: 'compare'; anchor: string }
  | { area: 'country'; tab: 'brief' | 'macro' | 'overview' | 'history'; brief?: 'economist' | 'banker' | 'official'; anchor?: string }
  | { area: 'reports' }
  | { area: 'portfolio'; anchor?: string };

export type ToolCategoryId = 'council' | 'monitor' | 'screen' | 'country' | 'history' | 'portfolio' | 'write';

export interface ToolCategory {
  id: ToolCategoryId;
  title: string;
  /** One line on what the group is for. */
  purpose: string;
}

/** Groups on the Tools page, by what you are trying to do, in page order. */
export const TOOL_CATEGORIES: ToolCategory[] = [
  { id: 'council', title: 'Council chat', purpose: 'Put a question to the agents and get an answer built only from live figures.' },
  { id: 'monitor', title: 'Keep up', purpose: 'What changed since you last looked, and what is coming up.' },
  { id: 'screen', title: 'Screen and compare countries', purpose: 'Line countries up side by side to find the outliers.' },
  { id: 'country', title: 'Study one country', purpose: 'Briefs and checks for the country you have open.' },
  { id: 'history', title: 'Look back', purpose: 'Past figures, past decisions and how the rule calls held up.' },
  { id: 'portfolio', title: 'Your portfolio', purpose: 'Your holdings against the risks and signals.' },
  { id: 'write', title: 'Write and share', purpose: 'Notes, briefs and handouts to download as Markdown or PDF.' },
];

export interface ReadyTool {
  id: string;
  category: ToolCategoryId;
  title: string;
  what: string;
  sources: string;
  target: ToolTarget;
}

export const READY_TOOLS: ReadyTool[] = [
  {
    id: 'ask_council',
    category: 'council',
    title: 'Council chat',
    what: 'Ask a question about your watchlist. Desk agents answer from live figures with their sources, and a synthesis agent may quote only those figures.',
    sources: 'Live figures below; Gemini or Ollama for the summary, if set up',
    target: { area: 'today', anchor: 'tool-council' },
  },
  {
    id: 'marketedge',
    category: 'screen',
    title: 'MarketEdge screen',
    what: 'Your watchlist plus the US, China, Russia, UK, EU and India: 10Y yield, spread over the US, CDS and real FX against its own history.',
    sources: 'Official 10Y yields (FRED/OECD, Tesouro, EVDS), your CDS file, BIS real exchange rates',
    target: { area: 'compare', anchor: 'tool-marketedge' },
  },
  {
    id: 'panel_builder',
    category: 'screen',
    title: 'Compare countries',
    what: 'Pick countries and figures for one table, latest values or full history, and download it as CSV with the source and period of every value.',
    sources: 'Every live figure and series in the app',
    target: { area: 'compare', anchor: 'tool-panel' },
  },
  {
    id: 'fed_balance_sheet',
    category: 'screen',
    title: 'Fed balance sheet',
    what: 'Federal Reserve total assets, bank reserves, the Treasury General Account and overnight reverse repos, each with its date and its change over 4 and 52 weeks, plus net liquidity when all parts share a Wednesday.',
    sources: 'Federal Reserve H.4.1 and NY Fed via FRED (no key needed)',
    target: { area: 'compare', anchor: 'tool-fed-balance-sheet' },
  },
  {
    id: 'regime_quadrant',
    category: 'screen',
    title: 'Growth and inflation',
    what: 'Each country placed by the 6-month change in its OECD leading indicator and the 3-month change in its monthly inflation, with what each quadrant means for policy.',
    sources: 'OECD leading indicator via DBnomics; monthly inflation (OECD, BCB, Eurostat)',
    target: { area: 'compare', anchor: 'tool-regime' },
  },
  {
    id: 'digest',
    category: 'monitor',
    title: 'Since your last visit',
    what: 'Policy rate moves, new inflation prints, leading-indicator turns, 10Y moves of 25 bp or more and watch alerts that started firing since you last opened Workspace.',
    sources: 'BIS policy rates, monthly inflation, OECD leading indicator, official 10Y yields, your watch rules',
    target: { area: 'today', anchor: 'tool-digest' },
  },
  {
    id: 'story-leads',
    category: 'screen',
    title: 'Story leads',
    what: 'Official yearly figures at a record or a ten-year high or low, large recent IMF or World Bank revisions, and what moved since your last visit.',
    sources: 'Saved IMF WEO and World Bank history, Data health revisions',
    target: { area: 'compare', anchor: 'tool-story-leads' },
  },
  {
    id: 'divergences',
    category: 'screen',
    title: 'Where data and price disagree',
    what: 'One line per country, biggest gap first: cheap or rich CDS against peers, policy rate against inflation, carry and currency valuation.',
    sources: 'Live IMF and World Bank figures, official yields, your CDS file, BIS',
    target: { area: 'compare', anchor: 'tool-divergences' },
  },
  {
    id: 'scenarios',
    category: 'screen',
    title: 'Scenario exposure',
    what: 'Who is most exposed to a Hormuz closure, a Taiwan blockade or tighter Russia sanctions, from trade and energy shares.',
    sources: 'World Bank and WITS trade data',
    target: { area: 'compare', anchor: 'tool-scenarios' },
  },
  {
    id: 'calendar',
    category: 'monitor',
    title: 'Official calendar',
    what: 'Rate decisions, CPI releases, elections, budget deadlines and IMF reviews, each linked to its source.',
    sources: 'Central bank, statistics office and election calendars on file',
    target: { area: 'today', anchor: 'tool-calendar' },
  },
  {
    id: 'economist_brief',
    category: 'country',
    title: 'Country economist brief',
    what: 'Growth, inflation, debt, reserves and the external position for the open country, with the rule behind each observation.',
    sources: 'IMF WEO, World Bank, official yields',
    target: { area: 'country', tab: 'brief', brief: 'economist' },
  },
  {
    id: 'issuer_brief',
    category: 'country',
    title: 'Issuer note',
    what: 'Market access, debt falling due in the next 12 months, distress tests and pricing against peers on official yields.',
    sources: 'World Bank/IMF QEDS, BIS debt securities, official yields, your CDS file',
    target: { area: 'country', tab: 'brief', brief: 'banker' },
  },
  {
    id: 'sustainability',
    category: 'country',
    title: 'Debt sustainability',
    what: 'Debt path under baseline and shock scenarios, the stabilising primary balance and r minus g, run only when every input is live.',
    sources: 'IMF WEO debt, growth, inflation and primary balance; official 10Y yield',
    target: { area: 'country', tab: 'brief', brief: 'official' },
  },
  {
    id: 'country_marketedge',
    category: 'country',
    title: 'Country markets and macro',
    what: 'The open country against its peers: policy stance, FX valuation, carry per unit of volatility, futures positioning, US Treasury holdings, the OECD leading indicator, IMF reserves and balance of payments, and world reserve currency shares.',
    sources: 'Live feeds, official yields, BIS, ECB exchange rates, CFTC Commitments of Traders, US Treasury TIC, OECD, IMF IL, BOP and COFER, your CDS file',
    target: { area: 'country', tab: 'macro' },
  },
  {
    id: 'what_is_live',
    category: 'country',
    title: 'What is live',
    what: 'Every figure the country pages use, with its source, or why it is missing and what would fill it.',
    sources: 'All connected feeds',
    target: { area: 'country', tab: 'overview' },
  },
  {
    id: 'history',
    category: 'history',
    title: 'History',
    what: 'A chart of every figure the app has kept for the open country, built from its saved weekly pulls, with the source and period of each point.',
    sources: 'Saved pulls (data/archive), BIS policy rates, monthly inflation, OECD leading indicator',
    target: { area: 'country', tab: 'history', anchor: 'tool-history' },
  },
  {
    id: 'as_of',
    category: 'history',
    title: 'As of a past day',
    what: 'The figures the app held on a past day beside today\'s, each with its own source and period, downloadable as CSV or Excel.',
    sources: 'Saved pulls (data/archive)',
    target: { area: 'country', tab: 'history', anchor: 'tool-as-of' },
  },
  {
    id: 'decision_replay',
    category: 'history',
    title: 'Replicate a rate decision',
    what: 'Pick one of the central bank\'s moves, or any date: the data the week before, what a simple Taylor rule pointed to, and what the bank did.',
    sources: 'BIS policy rates, monthly inflation, central bank targets, IMF output gap',
    target: { area: 'country', tab: 'history', anchor: 'tool-decision-replay' },
  },
  {
    id: 'track_record',
    category: 'history',
    title: 'Track record',
    what: 'The rule call the app made on each saved pull and what the central bank did in the 90 days after. No odds, no hindsight on the inputs.',
    sources: 'Saved pulls, BIS policy rates',
    target: { area: 'country', tab: 'history', anchor: 'tool-track-record' },
  },
  {
    id: 'book',
    category: 'portfolio',
    title: 'Book and client briefs',
    what: 'Concentration, figures by country and dates to watch across your holdings, or your watchlist at equal weight.',
    sources: 'Your holdings file, your CDS file, official yields',
    target: { area: 'portfolio' },
  },
  {
    id: 'holdings_signals',
    category: 'portfolio',
    title: 'Signals on your holdings',
    what: 'Each imported holding beside the signals that bear on it (Taylor rule, cycle, 10Y moves, shock alerts), marked as leaning with or against the position.',
    sources: 'Your holdings file, BIS policy rates, OECD leading indicator, official 10Y yields',
    target: { area: 'portfolio', anchor: 'tool-holdings-signals' },
  },
  {
    id: 'reports',
    category: 'write',
    title: 'Reports',
    what: 'Country note, issuer note, sustainability assessment, portfolio and client reviews, and the council brief, as Markdown or PDF.',
    sources: 'The briefs above',
    target: { area: 'reports' },
  },
  {
    id: 'notebooks',
    category: 'write',
    title: 'Research notebooks',
    what: 'Saved council conversations and documents grouped by topic, with your notes, downloaded as one Markdown file with every source and reference.',
    sources: 'Your saved research (data/local/research.json)',
    target: { area: 'reports' },
  },
  {
    id: 'teaching_episodes',
    category: 'write',
    title: 'Teaching episodes',
    what: 'A country, a past rate decision and your questions; a student handout with the data the week before and a teacher copy with what the bank did.',
    sources: 'BIS policy rates, monthly inflation, OECD leading indicator, central bank targets',
    target: { area: 'reports' },
  },
];

export interface HiddenDesk {
  id: string;
  label: string;
  /** The data it would need to run on real figures. */
  needs: string;
  /** A ready tool that answers the same question today, by READY_TOOLS id. */
  coveredBy?: string;
}

export interface HiddenGroup {
  title: string;
  desks: HiddenDesk[];
}

export const HIDDEN_GROUPS: HiddenGroup[] = [
  {
    title: 'Markets and trading',
    desks: [
      { id: 'quant_nss_yield_curve', label: 'Yield curve and carry', needs: 'Government yields at every maturity (an official curve file or a licensed feed).' },
      { id: 'quant_cds_basis', label: 'CDS curve and basis', needs: 'A CDS curve by tenor and bond prices (licensed).' },
      { id: 'quant_trade_blotter', label: 'Trade blotter and DV01', needs: 'Bond-level positions with prices.' },
      { id: 'market_maker_alpha', label: 'Order book depth', needs: 'Dealer quotes and order book data (licensed).' },
      { id: 'decision_prediction_markets', label: 'Prediction markets', needs: 'Kalshi prices; Polymarket is connected for the council only.' },
      { id: 'quant_macro_catalyst_calendar', label: 'Event volatility calendar', needs: 'Option-implied volatility (licensed).', coveredBy: 'calendar' },
      { id: 'persona_cross_hub_signal_scanner', label: 'Signal scanner', needs: 'Live inputs for every signal it combines.', coveredBy: 'divergences' },
      { id: 'decision_dislocation_screener', label: 'Model against market', needs: 'Live CDS for every country.', coveredBy: 'divergences' },
      { id: 'risk_analytics', label: 'Peer z-score matrix', needs: 'Live risk inputs for a full peer set.', coveredBy: 'marketedge' },
    ],
  },
  {
    title: 'Portfolio',
    desks: [
      { id: 'quant_portfolio_stress_lab', label: 'Portfolio stress lab', needs: 'Your holdings plus live CDS and yields for every holding.', coveredBy: 'book' },
      { id: 'embi_portfolio_pair_book', label: 'EMBI pair book', needs: 'EMBI index weights and bond prices (licensed).' },
      { id: 'portfolio_risk_desk', label: 'Contagion and CVaR', needs: 'Price history for each holding, to estimate correlations.' },
      { id: 'quant_alpha_correlation', label: 'Correlation matrix', needs: 'Daily price history across countries.' },
      { id: 'persona_strategy_backtester_lab', label: 'Strategy backtester', needs: 'Historical price series.' },
      { id: 'decision_premortem_killswitch', label: 'Pre-mortem and stop levels', needs: 'Staged trades priced off live markets.' },
      { id: 'decision_ledger_brier', label: 'Decision record', needs: 'Covered by Track record under Research > One country > History & data: the rule call on each saved pull and what the bank did 90 days later.', coveredBy: 'track_record' },
    ],
  },
  {
    title: 'Debt and policy',
    desks: [
      { id: 'forecasting_lab', label: 'Debt fan charts', needs: 'Historical shock series for the fan; the central path is in the sustainability brief.', coveredBy: 'sustainability' },
      { id: 'taylor_rule_fiscal_dominance', label: 'Taylor rule', needs: 'Its sliders ran on built-in inputs; the live rule check is on the country MarketEdge tab and in the Central Bank agent.', coveredBy: 'country_marketedge' },
      { id: 'dmo_treasury_auction_sim', label: 'Auction simulator', needs: 'The debt office auction calendar and results.' },
      { id: 'ratings_shadow_fallen_angel', label: 'Shadow rating', needs: 'Ratings history (licensed).' },
      { id: 'debt_investor_base_doom_loop', label: 'Investor base and banks', needs: 'Holders of government debt by sector.' },
      { id: 'restructuring_npv_cac_waterfall', label: 'Restructuring waterfall', needs: 'Bond terms and creditor composition.' },
      { id: 'quant_restructuring_npv', label: 'Haircut and exit yield', needs: 'Bond cash flows and prices.' },
      { id: 'ngfs_climate_slb_greenium', label: 'Climate stress', needs: 'NGFS scenario data and green bond prices.' },
    ],
  },
  {
    title: 'Macro',
    desks: [
      { id: 'charts_watchlists', label: 'Macro map and horizon charts', needs: 'Live history for each charted series.', coveredBy: 'what_is_live' },
      { id: 'global_liquidity', label: 'Global liquidity', needs: 'Cross-currency basis and funding spreads (licensed).' },
      { id: 'decision_quadrant_stress', label: 'Regime quadrant', needs: 'Its stress grid ran on built-in inputs; the live growth and inflation quadrant is under Research > Compare countries.', coveredBy: 'regime_quadrant' },
      { id: 'fx_beer_feer_equilibrium', label: 'FX equilibrium models', needs: 'Productivity and terms-of-trade series.', coveredBy: 'country_marketedge' },
      { id: 'quant_matrix_econometrics', label: 'Econometrics', needs: 'Historical series for the regressions.' },
      { id: 'quant_macro_surprise', label: 'Data surprises', needs: 'Consensus forecasts (licensed).' },
    ],
  },
  {
    title: 'Geopolitics',
    desks: [
      { id: 'geopolitical_desk', label: 'Wargaming', needs: 'Conflict event data beyond GDELT (ACLED is not connected).', coveredBy: 'scenarios' },
      { id: 'supply_chain_matrix', label: 'Supply-chain matrix', needs: 'Product-level trade flows.', coveredBy: 'scenarios' },
      { id: 'geopolitical_reserves_chokepoints', label: 'Reserve custody', needs: 'Reserve holdings by custodian, which countries do not publish.' },
      { id: 'backtest_engine', label: 'Crisis replay', needs: 'A historical crisis data set.' },
    ],
  },
  {
    title: 'Documents and council',
    desks: [
      { id: 'mpc_imf_document_ai', label: 'Policy document reader', needs: 'Covered by Policy documents in Council chat: add a PDF or text file there.', coveredBy: 'ask_council' },
      { id: 'policy_doc_lab', label: 'Document and CSV lab', needs: 'A CSV upload, not built yet. Documents are covered by Policy documents in Council chat.' },
      { id: 'council_debates', label: 'Council debate', needs: 'Covered by Run the full council in Council chat: the agents debate, then it waits for your approval.', coveredBy: 'ask_council' },
      { id: 'cro_reports', label: 'Risk sign-off dossier', needs: 'Covered by the approval step in Council chat.', coveredBy: 'ask_council' },
      { id: 'persona_guided_playbook_cockpit', label: 'Guided playbooks', needs: 'Covered by the report templates.', coveredBy: 'reports' },
      { id: 'ic_pitchbook_dossier_exporter', label: 'Pitchbook export', needs: 'Covered by Reports.', coveredBy: 'reports' },
      { id: 'persona_academic_latex_csv_exporter', label: 'LaTeX and CSV export', needs: 'Covered by the Markdown export in Reports.', coveredBy: 'reports' },
    ],
  },
];

export const READY_BY_ID = Object.fromEntries(READY_TOOLS.map((t) => [t.id, t])) as Record<string, ReadyTool>;
