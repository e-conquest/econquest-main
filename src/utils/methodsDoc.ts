/**
 * docs/METHODS.md: a methods note for each model and signal in the app, generated from the model
 * register (src/data/modelRegister.ts), the pre-registered backtests (docs/validation/preregistered/)
 * and the verdicts recorded from real runs (docs/validation/recorded-verdicts.json), plus the three
 * stated-method views that make no call to backtest (output gap, debt sustainability, fiscal
 * multipliers). `npm run docs:methods` writes it; a test fails if it is out of date.
 *
 * Browser-safe: the caller reads the files and passes them in.
 */
import { MODEL_REGISTER, STATUS_LABEL, type RegisterEntry } from '../data/modelRegister';
import { RESEARCH_NOTICE } from './disclaimer';
import { GRADE_POLICY } from './evidenceGrade';

export interface PreregisteredSpec {
  file: string;
  hash?: string;
  id: string;
  version: number;
  registeredOn: string;
  hypothesis: string;
  framework?: number;
  retestOf?: { version: number; verdict: string; change: string };
  sample?: { from?: string };
  passMark?: { minCases?: number; minLiftPts?: number; maxPValue?: number; minSeriesShare?: number; minYears?: number };
  knownLimits?: string[];
}

export interface RecordedVerdict {
  /** The test's own id (its file name in docs/validation/<kind folder>/). */
  id: string;
  /** The register entry it tests, when that differs from the test id (debt_fan_coverage tests debt_fan). */
  registerId?: string;
  /** Backtest (docs/validation/preregistered/, the default), forecast evaluation (forecasts/) or currency signal test (signals/). */
  kind?: VerdictKind;
  version: number;
  ranAt: string;
  verdict: 'passed' | 'failed' | 'too_few_cases';
  /** Backtest method (1 or 2); forecast evaluations and signal tests have one method each. */
  method?: number;
  summary: string;
}

export type VerdictKind = 'backtest' | 'forecast' | 'signal';

/** Where each kind of pre-registered test lives, under docs/validation/. */
export const VERDICT_FOLDER: Record<VerdictKind, string> = { backtest: 'preregistered', forecast: 'forecasts', signal: 'signals' };

const KIND_LABEL: Record<VerdictKind, string> = { backtest: 'Backtest', forecast: 'Forecast evaluation', signal: 'Signal test' };

const verdictFor = (e: { id: string }) => (v: RecordedVerdict) => (v.registerId ?? v.id) === e.id;
const statusText = (v: RecordedVerdict) => `${KIND_LABEL[v.kind ?? 'backtest']} ${VERDICT_LABEL[v.verdict].toLowerCase()}`;

const VERDICT_LABEL: Record<RecordedVerdict['verdict'], string> = { passed: 'Passed', failed: 'Failed', too_few_cases: 'Too few cases' };

/** The views that state a method on official data and make no call a backtest could score. */
export const STATED_METHODS: { id: string; name: string; where: string; method: string[]; limits: string; code: string }[] = [
  {
    id: 'output_gap',
    name: 'Output gap (app estimate)',
    where: 'Research > History & data, Policy review Diagnose, Central Bank Watcher and Fiscal & Debt agents',
    method: [
      'The IMF DataMapper publishes no output gap for the countries the app covers, so the app estimates one from log real GDP chained from IMF WEO real growth (NGDP_RPCH).',
      'Three standard filters on the same input: Hodrick-Prescott with lambda 100, Hodrick-Prescott with lambda 6.25 (Ravn and Uhlig 2002), and the Hamilton (2018) regression filter in annual form (h = 2, p = 1).',
      'The reading is the median of the three; the band is lowest to highest. The HP trend runs over the IMF projections to ease the end-point problem, and projection years say so.',
    ],
    limits: 'Filters on GDP alone are rough and are revised as new years arrive; the newest years move most. A stated method on official data, not an official estimate and not a forecast.',
    code: 'src/utils/outputGap.ts',
  },
  {
    id: 'debt_sustainability',
    name: 'Debt sustainability view',
    where: 'Research > History & data, Policy review Diagnose, Fiscal & Debt Agent',
    method: [
      'Public debt dynamics: d(t) = d(t-1) x (1 + i) / (1 + n) - pb + sfa, on IMF WEO debt, IMF Fiscal Monitor primary and overall balance, IMF growth and inflation. Consumer price inflation stands in for the GDP deflator, which the DataMapper does not publish.',
      'Five-year scenarios: the IMF path as published, a baseline on the IMF inputs with no stock-flow adjustment, ten-year historical averages, and growth, primary balance, interest rate and combined shocks shaped like the IMF standardised stress tests (2013 Staff Guidance Note), with sizes stated by the app.',
    ],
    limits: 'A view on stated assumptions, not a forecast and not an IMF DSA. Shock sizes are the app\'s choices, not the IMF\'s country calibration.',
    code: 'src/utils/debtSustainability.ts',
  },
  {
    id: 'gross_financing_need',
    name: 'Gross financing need (lower bound)',
    where: 'Research > History & data',
    method: [
      'GFN = overall deficit + amortisation, % of GDP, from last year to five years out. Deficit = minus the IMF Fiscal Monitor overall balance; interest shown = primary minus overall balance.',
      'Amortisation = World Bank IDS projected principal on public and publicly guaranteed external debt (DT.AMT.DPPG.CD, all creditors) divided by IMF WEO GDP in US dollars (NGDPD) for the same year. QEDS next-12-month general government external principal is shown alongside.',
      'Flag: a total of 15% of GDP or more, the IMF market-access DSA benchmark for emerging markets.',
    ],
    limits: 'Domestic amortisation (local debt held by residents) has no free cross-country source, so the total is a lower bound; for countries that borrow mainly at home it can be far below the true need. IDS covers low- and middle-income countries only. IMF years from this one on and all IDS years are projections.',
    code: 'src/utils/grossFinancingNeed.ts',
  },
  {
    id: 'risk_scorecard',
    name: 'Country risk scorecard',
    where: 'Research > History & data',
    method: [
      'Governance: the six World Bank Worldwide Governance Indicators (voice and accountability, political stability, government effectiveness, regulatory quality, rule of law, control of corruption), as published estimates where 0 is the world average and 1 is one standard deviation. Within 0.25 of 0 reads as near the average; 1 or more away reads as well above or below. Change against five years earlier.',
      'Armed conflict: UCDP/PRIO conflicts located in the country (and how many at war level), and UCDP best estimates of state-based, non-state and one-sided deaths, for the latest year UCDP has coded, with the three years before.',
      'Unrest: protests and violence as a share of the country\'s GDELT 1.0 events in the latest complete month, as z-scores against the previous 24 months, and the spike episodes of the last 24 months (see Unrest spikes).',
      'Geopolitical risk: the Caldara and Iacoviello Geopolitical Risk index (AER 2022), the share of articles in ten leading newspapers about adverse geopolitical events and threats, for the country (44 countries covered) and the world, read from the authors\' monthly file you save in data/local/gpr/ as .xlsx or .csv. Latest month, where it sits among all months on file, and the 12-month and all-time means.',
      'Economy: government debt, real growth, inflation (IMF WEO, latest outturn year, projections left out), current account, reserves in months of imports and external debt (World Bank), against five years earlier.',
      'No overall score: any weighting of the pillars would be a guess, and one number would look more certain than the figures are.',
    ],
    limits: 'WGI and UCDP are yearly and lag a year or more. WGI estimates are built from surveys and expert ratings and carry wide margins of error; small changes are within them. GDELT counts news reports, which rise with media attention. Figures not on file are listed as missing with the reason.',
    code: 'src/utils/countryRiskScorecard.ts',
  },
  {
    id: 'sanctions_lists',
    name: 'Sanctions lists',
    where: 'Research > History & data',
    method: [
      'Files you download into data/local/sanctions/ (npm run sanctions:pull tries the official addresses): OFAC SDN.CSV and ADD.CSV, the non-SDN CONS_PRIM.CSV and CONS_ADD.CSV (legacy CSV layout), and the UN Security Council consolidated.xml.',
      'An entry counts for a country when one of its addresses is in the country (OFAC, UN) or one of its nationalities is (UN). An entry can count for several countries. Country names are matched to ISO codes by a stated table; names it cannot match are listed, never guessed.',
      'Counts by list and by type (people, firms and bodies, vessels, aircraft), the programmes with the most entries as the list names them, and UN entries by the year first listed.',
      'Name search: every word of the query (case and accents ignored) must appear in the listed name.',
    ],
    limits: 'Not a compliance screen: the lists\' aliases (OFAC ALT.CSV, UN aliases) are not searched, there is no fuzzy matching, and the OFAC 50% rule (firms owned by listed persons) is not applied. Entries with no address or nationality in the country do not count for it. EU and UK lists are not read yet.',
    code: 'src/utils/sanctionsLists.ts',
  },
  {
    id: 'gr_var',
    name: 'Geopolitical risk VaR',
    where: 'Research > History & data > Global shock scenarios',
    method: [
      'Stress months: the Caldara and Iacoviello Geopolitical Risk index (world; and the country index where the file has one) at or above its 90th percentile over the months that also have the currency (at least 100 overlapping months and 20 stress months).',
      'VaR and expected shortfall: the 95th percentile of the monthly currency change against the US dollar (100 x log change of units per dollar, month-end ECB rates; positive = weaker), and the mean change at or beyond it, in stress months and in all months.',
      'Global channels: the mean US policy rate and dollar moves of the stress months, put through the country\'s fitted scenario model (Global shock scenarios), with its 90% band from Newey-West coefficient errors.',
    ],
    limits: 'Past co-movement with a news-based index, not a forecast. GPR stays high for months at a time, so the stress months are fewer independent episodes than their count, and a 95% tail read from 20 to 40 months is rough. Currency only; no bond or equity prices. Built fresh, not ported from another tool.',
    code: 'src/utils/grVar.ts',
  },
  {
    id: 'historical_context',
    name: 'Historical context line',
    where: 'Research > History & data > History (under the chart)',
    method: [
      'The latest real observation of the figure (IMF projections left out) against all earlier observations: a record high or low, or "highest/lowest since" the most recent earlier date at least as extreme, whichever run is longer.',
      'A "since" date is shown only when it is far enough back to matter: at least 3 years (yearly), 4 quarters, 12 months, 26 weeks or 60 days.',
      'Where it sits: the share of all observations at or below it. Change on the observation one year earlier, in points for shares and rates.',
    ],
    limits: 'Only the history the app has saved for that figure; a short series makes "on record" weak, so the first date is always given. No rank among peers yet.',
    code: 'src/utils/historicalContext.ts',
  },
  {
    id: 'claim_check',
    name: 'Claim check',
    where: 'Today > Council chat (the Claim Check answer, when a question states a figure or a ranking)',
    method: [
      'Figures stated in the question (policy rate, inflation, government debt, primary balance, official reserves, real GDP growth) are found by the rules of the document figure check and compared with the app figure for the one watchlist country the question names, within the same tolerances (0.05 to 1 point; 2% for reserves).',
      'A year in the question that differs from the year of the app figure is reported as a different period, neither a match nor a difference.',
      'Rankings (highest, lowest, largest and so on in the G20, the G7 or the watchlist): the country\'s app figure is ranked against the members the app holds a figure for. A higher (or lower) figure elsewhere disproves the claim; ranking first supports it fully only when every member is covered, otherwise the uncovered members are named.',
    ],
    limits: 'A check against the app\'s figures, which may be older than the claim or measure something else (monthly against annual inflation, mixed sources across countries). Stated figures are checked only when the question names one country. Targets and forecasts are left out. No other groups (EM, the world) are ranked.',
    code: 'src/utils/claimCheck.ts',
  },
  {
    id: 'story_leads',
    name: 'Story leads',
    where: 'Research > Compare countries > Summary',
    method: [
      'Records: the latest real observation of each official yearly series (IMF WEO, World Bank; projections left out) that is the highest or lowest on record (at least 10 observations) or since a year at least 10 years earlier, for the last two calendar years only (the Historical context line\'s rules).',
      'Revisions: values the IMF or World Bank revised in the last 30 days (Data health), by at least 0.5 points for figures in % and 5% of the old value otherwise; projections left out.',
      'Moved: what moved since your last visit, by the rules of Since your last visit (read only; opening Compare does not reset it). Ordered records on record first, then by how far back and how large.',
    ],
    limits: 'Only countries with saved yearly history, and only official yearly figures for records; a record in a short series means little, and the figure may be revised again. Gaps between data and market prices are in Where data and price disagree on the same page.',
    code: 'src/utils/storyLeads.ts',
  },
  {
    id: 'publication_export',
    name: 'Publication export',
    where: 'Research > One country > History & data > History (Publish chart, under the chart)',
    method: [
      'The chart is redrawn on white as SVG, or PNG at twice screen size, with its title, unit and frequency, the figure\'s source, the period shown, the export date and a credit line.',
      'The credit line is the attribution each source asks for in the licence register (src/data/dataLicences.ts), with its placeholder filled from the figure\'s source text; it can be edited before export.',
      'A source whose terms restrict free sharing, or need permission where free sharing is not settled, blocks the export until you tick that you hold permission. Sources with unclear terms, or not named in the register, are listed.',
    ],
    limits: 'The register reflects terms as read on its check date and is not legal advice; you are responsible for what you publish. Only the History chart has the button so far.',
    code: 'src/utils/creditLines.ts',
  },
  {
    id: 'unit_converters',
    name: 'Unit converters',
    where: 'Research > One country > History & data',
    method: [
      'Real terms: amount x CPI(target year) / CPI(year of the amount), World Bank consumer price index (2010 = 100).',
      'US dollars: amount / official exchange rate, local currency per US$, average of the year (World Bank, from IMF IFS). Purchasing power parity: amount / World Bank ICP conversion factor for GDP. Per head: amount / mid-year population (World Bank).',
      'Only the year asked for is used; a year with no figure reads Missing with the years on file. IMF projections are never used.',
    ],
    limits: 'Yearly averages: a single day\'s amount converts only roughly, and in high inflation the year\'s average rate can be far from the rate on the day. The GDP PPP factor suits economy-wide amounts, not one household\'s basket.',
    code: 'src/utils/unitConverters.ts',
  },
  {
    id: 'exercises',
    name: 'Exercises with answer keys',
    where: 'Research > One country > History & data',
    method: [
      'Real policy rate: the BIS policy rate at the end of the month less monthly inflation (y/y) for the same month; tolerance 0.1 points.',
      'Taylor (1993) rule: neutral real rate 2% + inflation + 0.5 x (inflation - target) + 0.5 x output gap, with IMF WEO inflation and output gap for the year and the bank\'s current published target, both stated in the question; tolerance 0.1. The key also gives the actual year-end policy rate against the rule.',
      'r minus g: the December 10Y government bond yield less nominal GDP growth, (1 + real growth)(1 + inflation) - 1 from the IMF WEO; tolerance 0.2. Debt change: the IMF WEO government debt ratio this year less last year; tolerance 0.2.',
    ],
    limits: 'Only questions whose inputs are all on file are set; others are listed with why. IMF projections are never used. The current inflation target is used for past years. In exam mode the answer key stays on the server and answers are only marked right or not.',
    code: 'src/utils/exercises.ts',
  },
  {
    id: 'model_sandboxes',
    name: 'Model sandboxes',
    where: 'Research > One country > History & data',
    method: [
      'Debt dynamics: d(t) = d(t-1) x (1 + i) / (1 + n) - pb, with n = (1 + g)(1 + inflation) - 1, and the debt-stabilising primary balance d x (i - n) / (1 + n), the same identity as Debt sustainability. Starting values are the latest year of that panel\'s history (IMF WEO debt, growth, inflation, primary balance; effective interest rate where the app has one).',
      'Taylor rule: neutral real rate + inflation + a x (inflation - target) + b x output gap, starting from Taylor (1993): 2, 0.5 and 0.5, the latest IMF WEO inflation outturn, the bank\'s current published target and the app\'s output gap.',
      'Output gap: log real GDP chained from IMF WEO growth outturns less an HP trend with any lambda (100 yearly, 6.25 Ravn-Uhlig), against the Hamilton (2018) regression residual with any horizon h; at least 15 unbroken years.',
    ],
    limits: 'Illustration of the formulas, not a forecast: every term is held constant over the horizon and nothing feeds back. A starting value the app does not have reads Missing and the sandbox waits until it is set. IMF projections are never used for the filters.',
    code: 'src/utils/modelSandboxes.ts',
  },
  {
    id: 'econometrics_lab',
    name: 'Econometrics lab',
    where: 'Council chat > a Chart Agent chart (ask in words, or Open larger > Tests)',
    method: [
      'All on the rows where both of the first two series have a value, in order. Newey-West: OLS of the second series on the first with Bartlett-kernel HAC errors, lag floor(4 (n/100)^(2/9)).',
      'VAR: both series in the chart\'s units, constant, lag by AIC (ln|Sigma| + 2pK^2/T) from 1 to 12 (monthly), 8 (quarterly) or 3 (yearly) on one sample; orthogonalised responses with the first series ordered first (Cholesky), over 24, 12 or 8 periods; 90% band from a seeded residual bootstrap (300 draws, 100 on samples over 1,500 points).',
      'Local projections (Jordà 2005): y(t+h) - y(t-1) on dx(t) and 3, 2 or 1 lags of both changes, one OLS per horizon, Newey-West errors with lag at least h + 1, 90% bands.',
      'Johansen (1991) trace test, unrestricted constant, VECM with the VAR\'s lag less one in differences; 5% critical values 15.49 (rank 0) and 3.84 (rank at most 1), MacKinnon, Haug and Michelis (1999).',
      'Breaks: regression of the second series on the first; sup-F, the largest Chow (1960) statistic over break dates with 15% trimming, against Bai and Perron\'s (2003) 5% value of 11.47; when it rejects, Bai-Perron (1998) global least squares with up to 3 breaks, the number chosen by BIC.',
    ],
    limits: 'Description, not a tested signal: none of these is a forecast or a causal estimate. VAR surprises are reduced-form, not identified shocks, and the Cholesky order matters. A VAR or regression in levels of series that wander can mislead; Johansen assumes they do wander. Break dates are estimates. Checked against statsmodels (Newey-West, VAR, local projections, Johansen) and a brute-force search (breaks).',
    code: 'src/utils/econometricsLab.ts',
  },
  {
    id: 'replication_pack',
    name: 'Replication pack',
    where: 'Council chat > a Chart Agent chart > Replication pack',
    method: [
      'data.csv holds the lines the chart drew, one row per date (or country, x, y for a chart across countries); trend lines the HP test adds are left out and recomputed.',
      'replicate.py, replicate.R and replicate.do run the tests the chart ran on the first two columns, on the rows where both have a value: correlation, OLS regression, lead/lag (up to 1.5 years of rows either way), Granger F test, rolling correlation (3 years of rows, at least 8), ADF with a constant and its lag chosen by AIC on one sample (MacKinnon 2010 critical values), the HP filter as a linear solve with the app\'s lambda, and where the first line stands.',
      'The README lists each column with its label, unit, source and credit, the settings, and the app\'s readings and figures to check against.',
    ],
    limits: 'A saved chart keeps its latest 600 points per line; the app ran its tests on every point, so a longer sample can give slightly different figures (the README says so when it applies). The Python and R scripts were checked against the app\'s figures; the Stata script follows the same steps.',
    code: 'src/utils/replicationPack.ts',
  },
  {
    id: 'reserve_adequacy',
    name: 'Reserve adequacy (IMF ARA, partial)',
    where: 'Research > History & data',
    method: [
      'Traditional ratios: reserves in months of imports, reserves / short-term external debt (Greenspan-Guidotti, 100%), reserves / broad money (20%).',
      'IMF ARA EM metric without other portfolio liabilities: 30% of short-term external debt (World Bank IDS) + 5% (floating) or 10% (fixed) of broad money (World Bank, % of GDP x IMF WEO GDP in US$) + 5% or 10% of exports of goods and services (World Bank). Both weightings shown; reserves include gold.',
      'Reading: reserves under 100% of the floating-weight partial metric are under 100% of the full IMF metric whatever the regime; above that, adequacy cannot be shown without the missing term.',
    ],
    limits: 'Other portfolio liabilities (from the international investment position) have no free cross-country source, so the ratio is an upper bound of the IMF\'s. The exchange rate regime is not a free feed. Short-term debt is World Bank IDS, low- and middle-income countries only; annual data lag a year or more.',
    code: 'src/utils/reserveAdequacy.ts',
  },
  {
    id: 'debt_fan',
    name: 'Debt fan chart (stochastic)',
    where: 'Research > History & data > Debt sustainability',
    method: [
      'Centred on the debt sustainability baseline (the debt identity on the IMF\'s projected growth, inflation, interest and primary balance), five years.',
      'Each simulated year draws one whole past year (bootstrap with replacement, up to the last 25 outturn years with all four inputs, at least 10) and adds that year\'s deviations from the sample means to the baseline inputs, so the four shocks keep their joint behaviour. Interest shocks phase in as a fifth of the debt rolls over each year.',
      '2,000 paths with a fixed seed; reports the 10th, 25th, 50th, 75th and 90th percentiles by year and the share of paths ending above today\'s debt and above the baseline. Shape of the IMF market-access DSA fan (IMF 2013).',
    ],
    limits: 'Only shocks the sample has seen; no stock-flow adjustments (valuation, bank support), which drive many debt jumps. Centred on the IMF\'s inputs, not an app forecast. CPI inflation stands in for the GDP deflator.',
    code: 'src/utils/debtFan.ts',
  },
  {
    id: 'local_projections',
    name: 'Inflation after policy rate changes (local projections)',
    where: 'Research > History & data',
    method: [
      'Jorda (2005) local projections on monthly data: inflation (% y/y, OECD or national CPI) h months ahead less the month before, on the change in the BIS month-end policy rate in month t, with 3 lags of both monthly changes. One OLS per horizon: 0, 3, 6, 9, 12, 18, 24 months.',
      'Newey-West standard errors with lag max(h + 1, floor(4 x (n/100)^(2/9))); 90% bands. Needs 60 months and at least 5 rate changes.',
    ],
    limits: 'Reduced form: the rate change is not an identified monetary policy shock. Central banks move ahead of expected inflation, so early responses often have the "wrong" sign (price puzzle). Records co-movement in the sample, not the effect of policy; regimes and targets change over long samples.',
    code: 'src/utils/localProjections.ts',
  },
  {
    id: 'rule_family',
    name: 'Policy rule family',
    where: 'Research > History & data',
    method: [
      'Five rules on the same inputs (latest monthly inflation pi, the bank\'s stated target pi*, output gap, r* 2%): Taylor (1993) r* + pi + 0.5(pi - pi*) + 0.5 gap; balanced approach, gap weight 1.0; inflation only, no gap term; inertial 0.85 x current rate + 0.15 x Taylor (1993); first difference current rate + 0.5(pi - pi*) + 0.5 x change in the gap over a year.',
      'Output gap: IMF WEO (NGAP_NPGDP) for this year where published (a projection), else the app\'s own estimate, labelled. Rules needing the gap show Missing without it.',
      'Reading: the policy rate more than 1 point above every rule = tight on all; more than 1 point below = loose on all; otherwise inside the range.',
    ],
    limits: 'r* is a stated parameter, not data: each point lower moves the level rules one point down, the inertial rule 0.15 and the first-difference rule not at all. Rules are cross-checks of stance, not forecasts; banks also weigh the exchange rate, financial stability and expectations. Annual output gaps are revised every WEO.',
    code: 'src/utils/ruleFamily.ts',
  },
  {
    id: 'costed_options',
    name: 'Costed fiscal options',
    where: 'Research > History & data > Debt sustainability',
    method: [
      'Four stated options against the debt sustainability baseline on IMF inputs: tighten 0.5 pt at once, 1 pt over 2 years, 2 pts over 3 years, loosen 1 pt at once. The primary balance rises by the step each year and stays up.',
      'Real growth in a step year is lower by multiplier x step (output level loss persists; later growth as baseline). Multiplier: the IMF bucket-approach first-year range for the country\'s group in normal times (TNM 14/04 Table 6: emerging 0.1-0.3, advanced 0.4-0.6), both ends shown.',
      'Debt from the identity d(t) = d(t-1)(1 + i)/(1 + n) - pb, so interest falls with debt. Reports debt at the horizon, the change against the baseline and the output lost; flags when debt rises above the baseline in year 1 (denominator effect).',
    ],
    limits: 'No cycle or lower-bound adjustment to the multiplier, no confidence or risk-premium effects, inflation and interest as in the baseline. Composition (spending or taxes) is not modelled. Stated options on stated assumptions, not a forecast or a recommendation.',
    code: 'src/utils/costedOptions.ts',
  },
  {
    id: 'beer',
    name: 'BEER fair value (behavioural equilibrium exchange rate)',
    where: 'Research > History & data',
    method: [
      'Clark and MacDonald (1998), one country at a time: OLS of the log BIS real broad effective exchange rate (yearly average of complete years) on log net barter terms of trade (World Bank), log GDP per head at PPP against the US (World Bank, a Balassa-Samuelson stand-in), and the current account summed from its first year (a net foreign assets proxy), at least 15 years, Newey-West errors.',
      'Misalignment = 100 x (log REER - log fitted). The latest monthly REER is set against the fair value of the latest year with all fundamentals, and the year is stated. Coefficients whose sign is opposite to theory (all three are expected positive) are flagged.',
    ],
    limits: 'A levels regression on 20-30 annual points with no cointegration test: a yardstick, not a forecast, and it implies a gap that closes, which is not tested here. Productivity is against the US, not trade partners. Net foreign assets have no free API, so the summed current account (no valuation changes) stands in. World Bank data are today\'s vintage.',
    code: 'src/utils/beer.ts',
  },
  {
    id: 'event_study',
    name: 'Currency around rate decisions (event study)',
    where: 'Research > History & data',
    method: [
      'Events: every day the BIS daily policy rate series changes (the date the new rate takes effect), its own central bank or the Federal Reserve, split into hikes and cuts; a change within 10 daily observations of the last kept one is dropped so one episode is not counted twice.',
      'Path: 100 x log change of units per US dollar (ECB reference rates) from the ECB business day before the event to each day from 10 before to 20 after (up = weaker currency). Average path for hikes and for cuts, 90% band from resampling the events (2,000 draws, fixed seed); at least 5 events per group.',
    ],
    limits: 'Description of the past, not a tested signal. No measure of surprise: an expected decision moves little on the day. Episodes with very different causes are averaged. ECB daily fixings, not intraday prices; currencies the ECB does not publish have no study.',
    code: 'src/utils/eventStudy.ts',
  },
  {
    id: 'unrest_onset',
    name: 'Unrest spikes (GDELT) and conflict onset',
    where: 'Research > History & data (Event history)',
    method: [
      "Each complete month (daily files covering the month), protests (CAMEO root 14) and violence (roots 18 to 20) as a share of the events GDELT 1.0 places in the country or names it as an actor. z = (share - mean of the previous 24 complete months) / max(their standard deviation, 0.25 points). A spike is z of 3 or more; an episode is the first month of a run of spikes. Only earlier months enter the baseline.",
      'Pre-registered test (unrest_onset v1): every country-year from 2018 with at least 10 scored months and no state-based armed conflict located in the country (UCDP/PRIO). A year with a spike episode is a call that conflict is located in the country the next calendar year. Base rate: the share of all such quiet country-years followed by conflict, pooled. Method 2: whole years resampled, p at most 0.05, a lift of at least 3 points, 30 cases over 6 years.',
    ],
    limits: 'UCDP files are yearly, so the outcome is the next calendar year. GDELT on disk starts in 2016, leaving about seven scored years. The pooled base rate mixes countries with very different risks. News-based machine coding, with coverage that varies by country and year.',
    code: 'src/utils/unrestSpikes.ts',
  },
  {
    id: 'idea_journal',
    name: 'Trade idea journal',
    where: 'Menu > Idea journal',
    method: [
      'An idea is a country, an instrument (its currency against the US dollar from ECB reference rates, or its policy rate from BIS daily data), a direction, a horizon of 7 to 730 days, an optional invalidation (currency ideas: an adverse move of that many %), a thesis and a type (carry, value, momentum, macro, policy, event, other).',
      'When logged the server fixes the entry level (latest published value, with its date) and the horizon date, takes the SHA-256 of the record\'s canonical JSON and appends it to data/local/ideas.jsonl; the app never edits a record, and a changed line is shown as not matching its hash.',
      'Scoring: on the first published value on or after the horizon date. Currency: move = 100 x (entry / value - 1) in the idea\'s direction (units per USD falling = the currency strengthening), a hit when above zero; invalidated if the adverse move is reached on any ECB day first. Policy rate: up, down or unchanged against the entry. Hit rate and average currency move by idea type.',
    ],
    limits: 'Scoring, not a signal. Spot moves only, no carry or costs. Few ideas give a noisy hit rate. The hash shows a change, it does not prevent deletion of the file.',
    code: 'src/utils/ideaJournal.ts',
  },
  {
    id: 'global_scenarios',
    name: 'Global shock scenarios (scenario engine)',
    where: 'Research > History & data',
    method: [
      'One OLS per response on monthly changes over the last 15 years (at least 60 months): the currency (100 x log change of units per US dollar, ECB month-end) and the policy rate (BIS month-end, change in points), each on the US policy rate change (BIS), the dollar (100 x log change of euros per dollar, ECB) US financial stress (change in the index you pick: the St. Louis Fed Financial Stress Index STLFSI4 by default, or the Chicago Fed NFCI or adjusted NFCI; FRED, the last weekly reading of the month) and global supply chain pressure (change in the NY Fed GSCPI, monthly).',
      'A scenario is a set of stated factor moves (presets: Fed +1 point, dollar +5%, both, the reverse, financial stress +1 point, stress +1 with dollar +5%, supply chain pressure +1 point; or your own). Implied move = coefficients x shock, intercept left out; 90% band from the Newey-West covariance of the coefficients. The residual standard deviation is shown as the size of a typical unexplained month.',
    ],
    limits: 'Contemporaneous co-movement, linear in the shock: not causal, and the Fed and the dollar often move for the same reasons as the country. Shocks larger than any month in the sample are flagged as extrapolation. The dollar factor is euros per dollar, not a trade-weighted index. Oil is not a factor yet (only five years of monthly prices saved); the NY Fed supply chain pressure index is not either (no checked download). The Chicago Fed NFCI is left out as a near-duplicate of the stress index. Currencies the ECB does not publish have no currency model.',
    code: 'src/utils/scenarioEngine.ts',
  },
  {
    id: 'fiscal_reaction',
    name: 'Fiscal reaction (Bohn test)',
    where: 'Research > History & data',
    method: [
      'OLS of the IMF Fiscal Monitor primary balance (% of GDP) on the previous year\'s IMF WEO government debt (% of GDP) and the app\'s output gap estimate: pb(t) = a + rho x d(t-1) + gamma x gap(t). IMF projection years are left out.',
      'Newey-West (HAC, Bartlett) standard errors with lag floor(4 x (n/100)^(2/9)). Needs 15 years; when the output gap covers fewer than 80% of them the regression runs without it and says so.',
      'Reading: rho above zero with p below 0.05 = the primary balance responds to debt (Bohn 1998\'s sufficient condition for sustainability holds in the sample); p below 0.10 = weak; otherwise no response found.',
    ],
    limits: 'A record of past behaviour on the whole sample: the response can change with governments and regimes, and short samples give wide errors. No response found does not by itself show debt is unsustainable. Not a forecast.',
    code: 'src/utils/bohnTest.ts',
  },
  {
    id: 'fiscal_multipliers',
    name: 'Fiscal multipliers (cited reference view)',
    where: 'Research > History & data, Policy review Diagnose, Fiscal & Debt Agent',
    method: [
      'The app does not estimate multipliers. It places a country in the IMF bucket approach (Batini, Eyraud, Forni and Weber 2014, IMF TNM 14/04) using only figures it holds, and shows the published first-year ranges (low 0.1-0.3, medium 0.4-0.6, large 0.7-1.0, Table 6) with the cycle and lower-bound adjustments from p.14.',
      'A characteristic the app has no data for stays "not known" and widens the range rather than being guessed.',
    ],
    limits: 'Calibrated on advanced economies; emerging and low-income countries generally sit in the low bucket. A reference, not an estimate.',
    code: 'src/utils/fiscalMultipliers.ts',
  },
];

function passMarkText(s: PreregisteredSpec): string {
  const p = s.passMark ?? {};
  const parts = [
    p.minCases !== undefined ? `at least ${p.minCases} cases` : '',
    p.minLiftPts !== undefined ? `a lift of ${p.minLiftPts} points or more over the base rate` : '',
    p.maxPValue !== undefined ? `p at or below ${p.maxPValue}` : '',
    s.framework === 2 && p.minSeriesShare !== undefined ? `a positive lift in at least ${Math.round(p.minSeriesShare * 100)}% of series` : '',
    s.framework === 2 && p.minYears !== undefined ? `at least ${p.minYears} years` : '',
  ].filter(Boolean);
  return parts.join(', ');
}

function entrySection(e: RegisterEntry, specs: PreregisteredSpec[], verdicts: RecordedVerdict[]): string[] {
  const mine = specs.filter((s) => s.id === e.id).sort((a, b) => a.version - b.version);
  const ran = verdicts.filter(verdictFor(e)).sort((a, b) => a.version - b.version || a.ranAt.localeCompare(b.ranAt));
  const latest = ran[ran.length - 1];
  const out = [`### ${e.name}`, ''];
  out.push(`- **Says:** ${e.says}`);
  out.push(`- **Rule:** ${e.method}`);
  out.push(`- **Reads:** ${e.inputs}`);
  out.push(`- **Shows in:** ${e.where}`);
  out.push(`- **Use:** ${e.use}`);
  out.push(`- **Status:** ${latest ? `${statusText(latest)} (${latest.id !== e.id ? `${latest.id} ` : ''}version ${latest.version}, recorded ${latest.ranAt.slice(0, 10)})` : STATUS_LABEL[e.status]}`);
  out.push(`- **How it is tested:** ${e.testPlan}`);
  out.push(`- **Limits:** ${e.limits}`);
  out.push(`- **Code:** \`${e.code}\``);
  if (mine.length) {
    out.push('', '**Pre-registered tests**', '');
    for (const s of mine) {
      const retest = s.retestOf ? ` A re-test of version ${s.retestOf.version}, which ${s.retestOf.verdict}; what changed: ${s.retestOf.change}` : '';
      out.push(
        `- Version ${s.version} (\`docs/validation/preregistered/${s.file}\`, registered ${s.registeredOn}, method ${s.framework === 2 ? '2, whole years resampled' : '1, cases counted as independent'}${s.sample?.from ? `, sample from ${s.sample.from}` : ''}). ${s.hypothesis}${retest} Pass mark: ${passMarkText(s)}.${s.hash ? ` SHA-256 ${s.hash.slice(0, 16)}…` : ''}`
      );
    }
  }
  if (ran.length) {
    out.push('', '**Recorded verdicts**', '');
    for (const v of ran)
      out.push(
        `- ${v.id !== e.id ? `${v.id}, version` : 'Version'} ${v.version}, ${v.ranAt}: **${VERDICT_LABEL[v.verdict]}** (${v.method ? `method ${v.method}` : KIND_LABEL[v.kind ?? 'backtest'].toLowerCase()}). ${v.summary}`
      );
  } else if (mine.length) {
    out.push('', '**Recorded verdicts**', '', '- None recorded yet. Run `npm run backtest` (or Menu > Models & validation > Run backtests).');
  }
  const limits = mine.flatMap((s) => (s.knownLimits ?? []).map((l) => `v${s.version}: ${l}`));
  if (limits.length) out.push('', '**Known limits, stated before the run**', '', ...limits.map((l) => `- ${l}`));
  out.push('');
  return out;
}

/** How a pass becomes the label users see (src/utils/evidenceGrade.ts). */
function gradeSection(): string[] {
  const P = GRADE_POLICY;
  return [
    '## Evidence grades',
    '',
    'A recorded verdict is never changed. A test that passed also carries an evidence grade in the app (the badge beside the panel and Menu > Models & validation), read from the correction across all tests on record and the forward record on the computer that runs the app:',
    '',
    `- **Validated** (green): passed its pre-registered test and still holds after the Holm correction across every test on record; or, failing that, ${P.promoteMonths} months of forward record with at least ${P.minForwardScored} scored calls beat the test's own base rate (one-sided binomial p at or under ${P.alpha}).`,
    '- **Provisional pass** (amber): passed alone but not after the correction. A single-test p of 0.05 is too lax once many rules have been tried (Harvey, Liu and Zhu 2016).',
    `- **Under review** (amber): once ${P.minForwardScored} or more forward calls are scored, the forward hit rate is below the base rate.`,
    `- **Withdrawn** (red): the forward hit rate is significantly below the base rate (one-sided binomial p at or under ${P.alpha}). It stays withdrawn until a new pre-registered version passes.`,
    `- **Review due** (amber): the test last ran more than ${P.reviewMonths} months ago.`,
    '',
    'The grades follow the practice of model-validation teams: pre-registration and no re-tuning after a fail; correction for multiple testing; out-of-sample confirmation; ongoing monitoring with green, amber and red zones (as in the Basel Committee\'s 1996 backtesting framework); and periodic revalidation and outcomes analysis (the Federal Reserve and OCC guidance on model risk management, SR 11-7, 2011). Backtest figures are hypothetical results and are labelled so, net of the registered costs where a test has costs, in the way the SEC marketing rule and the GIPS standards treat hypothetical performance. The grade is a research label, not investment advice.',
    '',
  ];
}

export function methodsMarkdown(specs: PreregisteredSpec[], verdicts: RecordedVerdict[]): string {
  const latestFor = (id: string) =>
    verdicts.filter(verdictFor({ id })).sort((a, b) => a.version - b.version || a.ranAt.localeCompare(b.ranAt)).pop();
  const out: string[] = [
    '# Methods',
    '',
    '<!-- Generated by `npm run docs:methods` from src/data/modelRegister.ts, docs/validation/preregistered/ and docs/validation/recorded-verdicts.json. Edit those, not this file. -->',
    '',
    `${RESEARCH_NOTICE} One note per model and signal: what it says, the rule, what it reads, where it shows, how it is`,
    'tested, its pre-registered backtests and the verdicts recorded from real runs. A verdict comes only from a test whose',
    'rule, sample and pass mark were fixed and hashed before it ran; a failed rule is never tuned until it passes (a',
    'changed rule is registered as a new, labelled re-test). Passing a backtest is not independent model validation.',
    '',
    'The live verdicts are in Menu > Models & validation, read from `data/local/validation/results.json` on the computer',
    'that ran them; they win over the recorded verdicts here, which are copied from the owner\'s runs.',
    '',
    '**Method 1** counts each case as independent. **Method 2** redraws whole calendar years of cases together 4,000',
    'times (fixed seed), reports a 90% range for the lift and a p-value, and asks that the lift is positive in at least',
    'half the series with five or more cases. A p-value of 0.00025 is the smallest 4,000 redraws can give.',
    '',
    '## Summary',
    '',
    '| Model or signal | Use | Status | Latest recorded verdict |',
    '| --- | --- | --- | --- |',
    ...MODEL_REGISTER.map((e) => {
      const v = latestFor(e.id);
      return `| ${e.name} | ${e.use} | ${v ? statusText(v) : STATUS_LABEL[e.status]} | ${v ? `${v.id !== e.id ? `${v.id} ` : ''}v${v.version}, ${v.ranAt.slice(0, 10)}${v.method ? `, method ${v.method}` : ''}` : 'None'} |`;
    }),
    ...STATED_METHODS.map((m) => `| ${m.name} | Research | Stated method, no call to test | Not applicable |`),
    '',
    ...gradeSection(),
    '## Models and signals',
    '',
  ];
  for (const e of MODEL_REGISTER) out.push(...entrySection(e, specs, verdicts));
  out.push('## Stated-method views', '', 'These show where things stand on a stated method and make no call a backtest could score.', '');
  for (const m of STATED_METHODS) {
    out.push(`### ${m.name}`, '', `- **Shows in:** ${m.where}`, ...m.method.map((l) => `- ${l}`), `- **Limits:** ${m.limits}`, `- **Code:** \`${m.code}\``, '');
  }
  return out.join('\n');
}
