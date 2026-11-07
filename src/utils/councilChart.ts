/**
 * Charts from Council chat. A question such as "chart Brazil's policy rate against inflation and
 * test whether one leads the other" becomes a chart request (which series, which tests); the chat
 * fetches the series the app holds, and computeChart() draws the lines and runs the tests with
 * src/utils/stats.ts. The result is also an agent answer (the Chart Agent), so the summary agent can
 * talk about it and follow-up questions can ask about the results. Only real series are charted:
 * a series the app does not hold is listed as Missing with the reason.
 */
import type { LiveWatchlistItem } from '../types/council';
import { INFLATION_TARGETS } from './marketsMacro';
import { breaksTest, hacRegression, JOHANSEN_CRIT, johansenTest, lpTest, SUPF_CRIT_5, varTest, type LabStep } from './econometricsLab';
import { TAYLOR_R_STAR, TAYLOR_WEIGHTS } from './taylorRule';
import {
  adf,
  alignPair,
  commonFreq,
  crossCorrelation,
  fmtP,
  granger,
  hpFilter,
  hpLambda,
  ols,
  pearson,
  periodsPerYear,
  rollingCorrelation,
  sampleCaution,
  strengthWord,
  toFreq,
  transform,
  TRANSFORM_LABEL,
  type Freq,
  type Pair,
  type Point,
  type Transform,
} from './stats';

export type ChartTest = 'summary' | 'correlation' | 'regression' | 'leadlag' | 'granger' | 'adf' | 'hp' | 'rolling' | 'hac' | 'var' | 'lp' | 'coint' | 'breaks';

/** Tests that need two series (the econometrics lab's included). */
export const PAIR_TESTS: ChartTest[] = ['correlation', 'regression', 'leadlag', 'granger', 'rolling', 'hac', 'var', 'lp', 'coint', 'breaks'];
/** Every test, in the order they are run and shown. */
export const TEST_ORDER: ChartTest[] = ['summary', 'correlation', 'regression', 'hac', 'leadlag', 'granger', 'rolling', 'var', 'lp', 'coint', 'breaks', 'adf', 'hp'];

export const TEST_TITLE: Record<ChartTest, string> = {
  summary: 'Where it stands',
  correlation: 'Correlation',
  regression: 'Regression',
  leadlag: 'Which moves first (lead/lag)',
  granger: 'Granger causality',
  adf: 'Stationarity (ADF test)',
  hp: 'Trend and cycle (HP filter)',
  rolling: 'Is the relationship stable? (rolling correlation)',
  hac: 'Regression with Newey-West errors',
  var: 'VAR with impulse responses',
  lp: 'Local projections',
  coint: 'Cointegration (Johansen)',
  breaks: 'Structural breaks (Chow and Bai-Perron)',
};

export interface ChartSeriesRef {
  /** Null for world series (commodity prices). */
  iso3: string | null;
  countryName: string | null;
  id: string;
  /** Tried when the first series is missing (monthly inflation falls back to the IMF annual figure). */
  fallback?: string;
  label: string;
}

export interface ChartRequest {
  series: ChartSeriesRef[];
  tests: ChartTest[];
  transform: Transform;
  /** Why the planner made a chart, in words. */
  why: string;
  /** Notes for the reader (countries left out, and so on). */
  notes: string[];
  /** A ready-made macro chart (Phillips curve, real policy rate...): its id and title. */
  preset?: PresetId;
  title?: string;
  /** Lines worked out from the series (real rate = policy rate - inflation), drawn first. */
  derived?: DerivedLine[];
  /** Which of the series to draw beside the worked-out lines (all when left out); the rest are only inputs. */
  show?: number[];
  /** Across countries: series hold x then y for each country in turn; one point per country, at its latest figure. */
  cross?: { x: string; y: string };
}

/** A line worked out from the request's series: constant + sum of k x series[i], on dates all of them have. */
export interface DerivedLine {
  label: string;
  unit: string;
  constant: number;
  terms: Array<{ i: number; k: number; /** Left out when that series is missing, with this note. */ optional?: string }>;
  /** The formula in words, shown under the chart. */
  method: string;
}

/** A series as the app's /api/series routes return it (only the fields the chart needs). */
export interface FetchedSeries {
  id: string;
  label: string;
  unit: string;
  freq: string;
  source: string;
  points: Point[];
}

export interface ChartLine {
  key: string;
  label: string;
  unit: string;
  axis: 'left' | 'right';
  source: string;
  points: Point[];
  dashed?: boolean;
}

export interface ChartTestResult {
  test: ChartTest;
  title: string;
  reading: string;
  /** label, value: what the reading rests on. */
  figures: Array<{ label: string; value: string }>;
  caution?: string;
  /** Lead/lag table or rolling correlation, for the small chart under the test. */
  lags?: Array<{ lag: number; r: number; p: number }>;
  rolling?: Point[];
  /** Impulse responses (VAR, local projections): horizon in periods, response and 90% band. */
  irf?: { label: string; steps: LabStep[] };
}

export interface ChartResult {
  title: string;
  freq: Freq;
  transform: Transform;
  lines: ChartLine[];
  scatter?: { xLabel: string; yLabel: string; pairs: Pair[]; fit?: { a: number; b: number } };
  /** Across countries: the sources behind the points (credits, Sharing mode). */
  sources?: string[];
  tests: ChartTestResult[];
  missing: string[];
  notes: string[];
  first?: string;
  last?: string;
  /** What was asked for, so the larger view can redraw it another way (and a saved chart can too). */
  request?: ChartRequest;
}

// ---------------------------------------------------------------------------------------------
// Reading a chart request out of a question

/** Words for each series, most specific first. World series carry no country. */
const SERIES_WORDS: Array<{ re: RegExp; id: string; label: string; world?: boolean; fallback?: string }> = [
  { re: /external debt/i, id: 'external_debt', label: 'External debt' },
  { re: /output gap/i, id: 'output_gap', label: 'Output gap' },
  { re: /current account/i, id: 'current_account', label: 'Current account' },
  { re: /primary (?:fiscal )?balance|fiscal balance|budget balance|deficit/i, id: 'primary_balance', label: 'Primary balance' },
  { re: /(?:government |public )?debt(?:[- ]to[- ]gdp| ratio)?/i, id: 'debt_gdp', label: 'Government debt' },
  { re: /policy rate|interest rates?|central bank rate|selic|repo rate|key rate/i, id: 'policy_rate', label: 'Policy rate' },
  { re: /\bspf\b[^.?]{0,20}long(?:er)?[- ]term|long(?:er)?[- ]term[^.?]{0,20}\bspf\b/i, id: 'spf_hicp_lt', label: 'Euro area SPF: HICP inflation, longer term', world: true },
  { re: /\bspf\b|professional forecasters/i, id: 'spf_hicp_2y', label: 'Euro area SPF: HICP inflation two years ahead', world: true },
  { re: /focus survey|focus (?:inflation )?expectations?/i, id: 'focus_ipca_12m', label: 'Focus survey: IPCA expected over 12 months' },
  { re: /5y5y|five[- ]year,? five[- ]year/i, id: 'us_5y5y_forward', label: 'US 5y5y forward inflation expectation' },
  { re: /breakevens?/i, id: 'us_breakeven_10y', label: 'US 10-year breakeven inflation' },
  { re: /\binflation\b|\bcpi\b|consumer prices/i, id: 'cpi_monthly', fallback: 'cpi_imf', label: 'Inflation' },
  { re: /leading indicator|\bcli\b/i, id: 'cli', label: 'OECD leading indicator' },
  { re: /10[- ]?y(?:ea)?r?(?: bond)? yields?|bond yields?|\byields?\b/i, id: 'yield_10y', label: '10Y government bond yield' },
  { re: /quarterly (?:real )?gdp|gdp,? (?:q\/q|quarterly|by quarter)/i, id: 'gdp_qoq', fallback: 'gdp_growth', label: 'Real GDP growth, quarterly (q/q)' },
  { re: /activity index|ibc-?br|industrial production/i, id: 'activity_monthly', label: 'Activity index, monthly' },
  { re: /(?:real )?gdp growth|\bgrowth\b|\bgdp\b/i, id: 'gdp_growth', label: 'Real GDP growth' },
  { re: /\breserves\b/i, id: 'reserves_months', label: 'Reserves' },
  { re: /exchange rate|\bcurrency\b|\bfx\b/i, id: 'fx_per_usd', label: 'Exchange rate' },
  { re: /positioning|\bcftc\b/i, id: 'cftc_lev_net', label: 'Leveraged funds positioning (CFTC)' },
  { re: /news tone|\btone\b/i, id: 'gdelt_tone', label: 'News tone (GDELT)' },
  { re: /adjusted (?:nfci|national financial conditions)|\banfci\b/i, id: 'stress_anfci', label: 'Chicago Fed adjusted NFCI', world: true },
  { re: /\bnfci\b|chicago fed|financial conditions index/i, id: 'stress_nfci', label: 'Chicago Fed NFCI', world: true },
  { re: /financial stress|stlfsi|st\.? louis fed (?:stress )?index/i, id: 'stress_stlfsi', label: 'St. Louis Fed Financial Stress Index', world: true },
  { re: /supply[- ]chain|\bgscpi\b/i, id: 'gscpi', label: 'NY Fed Global Supply Chain Pressure Index', world: true },
  { re: /\bbrent\b|\boil\b/i, id: 'commodity_pink_sheet_crude_brent', label: 'Brent crude', world: true },
  { re: /\bgold\b/i, id: 'commodity_pink_sheet_gold', label: 'Gold', world: true },
  { re: /\bcopper\b/i, id: 'commodity_pink_sheet_copper', label: 'Copper', world: true },
  { re: /\bwheat\b/i, id: 'commodity_pink_sheet_wheat_us_hrw', label: 'Wheat (US HRW)', world: true },
  { re: /natural gas|\blng\b/i, id: 'commodity_pink_sheet_ngas_eur', label: 'Natural gas, Europe', world: true },
  { re: /soybeans?/i, id: 'commodity_pink_sheet_soybeans', label: 'Soybeans', world: true },
];

const CHART_WORDS = /\b(chart|plot|graph|draw|visuali[sz]e|scatter)\b/i;
const TEST_WORDS: Array<[RegExp, ChartTest]> = [
  [/correlat|move together|co-?move/i, 'correlation'],
  [/regress|sensitiv|elasticit|\bbeta\b|scatter/i, 'regression'],
  [/lead.?lag|leads? or lags|which (?:one )?leads|moves? first|comes? first/i, 'leadlag'],
  [/granger|helps? (?:to )?predict|predictive/i, 'granger'],
  [/stationar|unit root|\badf\b|dickey/i, 'adf'],
  [/\bhp\b|hodrick|prescott|trend and cycle|cycle and trend|(?:gap from|against|above|below) (?:its )?trend|detrend/i, 'hp'],
  [/\bstable\b|rolling|still hold|over time/i, 'rolling'],
  [/newey|west errors|\bhac\b|robust (?:standard )?errors|autocorrelation[- ]robust/i, 'hac'],
  [/\bVAR\b|vector autoregress|impulse respons/, 'var'],
  [/local projection|jord[aà]/i, 'lp'],
  [/cointegrat|johansen|long[- ]run relationship/i, 'coint'],
  [/structural break|\bchow\b|bai[- ]?perron|break ?points?|regime (?:change|shift)/i, 'breaks'],
];
const TRANSFORM_WORDS: Array<[RegExp, Transform]> = [
  [/year[- ]on[- ]year|\by\/y\b|\byoy\b|annual change/i, 'yoy'],
  [/z[- ]?scores?|standardi[sz]/i, 'zscore'],
  [/\bindex(ed)?\b|rebased/i, 'index100'],
  [/\bchanges?\b|first difference/i, 'change'],
];

// ---------------------------------------------------------------------------------------------
// Ready-made macro charts: asked for by name, built from the series the app holds

export type PresetId = 'phillips' | 'real_rate' | 'real_yield' | 'taylor' | 'term_spread' | 'r_minus_g' | 'cli_policy';

interface Preset {
  id: PresetId;
  re: RegExp;
  name: string;
  /** What the chart is for, in one line (shown in the list of ready-made charts). */
  about: string;
  series: string[];
  tests: ChartTest[];
  show?: number[];
  derived?: (iso3: string) => { lines: DerivedLine[]; notes: string[] } | { missing: string };
}

const word = (id: string) => SERIES_WORDS.find((w) => w.id === id)!;

export const PRESETS: Preset[] = [
  {
    id: 'phillips',
    re: /phillips/i,
    name: 'Phillips curve',
    about: 'inflation against the output gap, with the regression slope',
    series: ['output_gap', 'cpi_monthly'],
    tests: ['regression', 'correlation'],
  },
  {
    id: 'taylor',
    re: /taylor(?: rule| gap)?/i,
    name: 'Taylor rule gap',
    about: 'the policy rate against a simple Taylor rule, over time',
    series: ['policy_rate', 'cpi_monthly', 'output_gap'],
    tests: ['summary'],
    show: [0],
    derived: (iso3) => {
      const t = INFLATION_TARGETS[iso3];
      if (!t) return { missing: "the central bank's inflation target (the app holds targets for a short list of countries)" };
      const wi = TAYLOR_WEIGHTS.inflation;
      const wo = TAYLOR_WEIGHTS.output;
      const gapNote = 'output gap term left out (no IMF output gap and no app estimate for this country)';
      const rule = `rule = r* ${TAYLOR_R_STAR}% + inflation + ${wi} x (inflation - target ${t.pct}%) + ${wo} x output gap; r* is Taylor (1993)'s 2%, a stated parameter`;
      return {
        lines: [
          { label: 'Policy rate minus Taylor rule', unit: '% pts', constant: -(TAYLOR_R_STAR - wi * t.pct), terms: [{ i: 0, k: 1 }, { i: 1, k: -(1 + wi) }, { i: 2, k: -wo, optional: gapNote }], method: `Gap = policy rate - rule rate; ${rule}. Above zero = tighter than the rule` },
          { label: 'Taylor rule rate', unit: '%', constant: TAYLOR_R_STAR - wi * t.pct, terms: [{ i: 1, k: 1 + wi }, { i: 2, k: wo, optional: gapNote }], method: '' },
        ],
        notes: [],
      };
    },
  },
  {
    id: 'real_rate',
    re: /real (?:policy |interest |short[- ]term )?rates?|ex[- ]post real rate/i,
    name: 'Real policy rate',
    about: 'the policy rate minus inflation',
    series: ['policy_rate', 'cpi_monthly'],
    tests: ['summary'],
    derived: () => ({ lines: [{ label: 'Real policy rate', unit: '%', constant: 0, terms: [{ i: 0, k: 1 }, { i: 1, k: -1 }], method: 'Real policy rate = policy rate - inflation (ex post, on the inflation the app holds)' }], notes: [] }),
  },
  {
    id: 'real_yield',
    re: /real (?:10[- ]?y(?:ea)?r? |bond )?yields?/i,
    name: 'Real 10Y yield',
    about: 'the 10-year bond yield minus inflation',
    series: ['yield_10y', 'cpi_monthly'],
    tests: ['summary'],
    derived: () => ({ lines: [{ label: 'Real 10Y yield', unit: '%', constant: 0, terms: [{ i: 0, k: 1 }, { i: 1, k: -1 }], method: 'Real 10Y yield = 10Y government bond yield - inflation (ex post, not inflation expectations)' }], notes: [] }),
  },
  {
    id: 'term_spread',
    re: /term spread|yield curve|curve slope|10y? (?:minus|less|over|-) (?:the )?policy/i,
    name: 'Yield curve slope',
    about: 'the 10-year yield minus the policy rate',
    series: ['yield_10y', 'policy_rate'],
    tests: ['summary'],
    derived: () => ({ lines: [{ label: '10Y yield minus policy rate', unit: '% pts', constant: 0, terms: [{ i: 0, k: 1 }, { i: 1, k: -1 }], method: 'Slope = 10Y government bond yield - policy rate; below zero = inverted curve' }], notes: [] }),
  },
  {
    id: 'r_minus_g',
    re: /\br\s*[-−–]\s*g\b|r minus g|interest[- ]growth (?:differential|gap)/i,
    name: 'r minus g',
    about: 'the real interest rate on debt minus real growth, the debt-dynamics gap',
    series: ['yield_10y', 'cpi_monthly', 'gdp_growth'],
    tests: ['summary'],
    derived: () => ({
      lines: [{ label: 'r - g (real 10Y yield minus real growth)', unit: '% pts', constant: 0, terms: [{ i: 0, k: 1 }, { i: 1, k: -1 }, { i: 2, k: -1 }], method: 'r - g = 10Y yield - inflation - real GDP growth. It uses the market yield, not the average rate the government pays on its stock of debt; above zero, debt to GDP rises unless there is a primary surplus' }],
      notes: [],
    }),
  },
  {
    id: 'cli_policy',
    re: /(?:leading indicator|\bcli\b).{0,40}(?:policy|rate)|(?:policy|rate) cycle.{0,40}(?:leading indicator|\bcli\b)|policy cycle/i,
    name: 'Leading indicator vs policy rate',
    about: 'the OECD leading indicator against the policy rate, and which turns first',
    series: ['cli', 'policy_rate'],
    tests: ['leadlag', 'correlation'],
  },
];

/** The ready-made chart a question asks for by name, if any. */
export function presetInQuestion(question: string): Preset | undefined {
  return PRESETS.find((p) => p.re.test(question));
}

/** A ready-made chart for one country. */
export function presetRequest(preset: Preset, c: { iso3: string; countryName: string }, notes: string[] = []): ChartRequest {
  const series: ChartSeriesRef[] = preset.series.map((id) => ({ iso3: c.iso3, countryName: c.countryName, id, fallback: word(id).fallback, label: `${c.countryName}: ${word(id).label}` }));
  const d = preset.derived?.(c.iso3);
  const own = [...notes];
  let derived: DerivedLine[] | undefined;
  if (d && 'missing' in d) own.push(`${preset.name} could not be worked out: Missing ${d.missing}`);
  else if (d) {
    derived = d.lines;
    own.push(...d.notes);
  }
  return { series, tests: preset.tests, transform: 'level', why: `the question asks for the ${preset.name}`, notes: own, preset: preset.id, title: `${c.countryName}: ${preset.name}`, ...(derived ? { derived, ...(preset.show ? { show: preset.show } : {}) } : {}) };
}

/** The series a question names, in the order it names them; each phrase counts once. */
export function seriesInQuestion(question: string): Array<(typeof SERIES_WORDS)[number]> {
  let rest = question;
  const hits: Array<{ at: number; w: (typeof SERIES_WORDS)[number] }> = [];
  for (const w of SERIES_WORDS) {
    const re = new RegExp(w.re.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(rest))) {
      if (!hits.some((h) => h.w.id === w.id)) hits.push({ at: m.index, w });
      // Blank the phrase out so "debt to GDP" is not also read as GDP growth.
      rest = rest.slice(0, m.index) + ' '.repeat(m[0].length) + rest.slice(m.index + m[0].length);
    }
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.w);
}

/** The tests a question asks for. */
export function testsInQuestion(question: string): ChartTest[] {
  return TEST_WORDS.filter(([re]) => re.test(question)).map(([, t]) => t);
}

/** Most series one chart draws. */
export const MAX_LINES = 4;

/**
 * A chart request when the question asks for a chart or a statistical test on named series; null
 * otherwise. `countries` are the plan's countries (named in the question, or the whole watchlist).
 */
export function chartRequest(question: string, countries: LiveWatchlistItem[], namedCountries: boolean): ChartRequest | null {
  const preset = presetInQuestion(question);
  if (preset && countries[0]) {
    const notes: string[] = [];
    if (!namedCountries && countries.length > 1) notes.push(`No country was named, so the chart shows ${countries[0].countryName}; name another to see it there`);
    else if (countries.length > 1) notes.push(`The ${preset.name} is drawn for one country at a time, so this shows ${countries[0].countryName}; ask again for the others`);
    const req = presetRequest(preset, countries[0], notes);
    const more = testsInQuestion(question).filter((t) => !req.tests.includes(t));
    return more.length ? { ...req, tests: [...req.tests, ...more] } : req;
  }
  const asked = testsInQuestion(question);
  const wantsChart = CHART_WORDS.test(question);
  let words = seriesInQuestion(question);
  const cross = crossRequest(question, words, countries);
  if (cross) return cross;
  if (!wantsChart && !asked.length) return null;
  if (!words.length) {
    // "Chart Brazil" with no series named: the monetary picture, the most asked-for pair.
    if (!wantsChart) return null;
    words = SERIES_WORDS.filter((w) => w.id === 'policy_rate' || w.id === 'cpi_monthly');
  }
  const notes: string[] = [];
  const own = words.filter((w) => !w.world);
  const world = words.filter((w) => w.world);
  // Without a named country, a per-country series is drawn for the first watchlist country only.
  const pool = namedCountries ? countries : countries.slice(0, 1);
  if (!namedCountries && own.length && countries.length > 1) notes.push(`No country was named, so the chart shows ${pool[0]?.countryName ?? 'the first watchlist country'}; name others to compare them`);
  const series: ChartSeriesRef[] = [];
  if (own.length === 1 && pool.length > 1) {
    // One series across countries: Brazil's and Mexico's policy rates on one chart.
    for (const c of pool.slice(0, MAX_LINES - world.length)) series.push({ iso3: c.iso3, countryName: c.countryName, id: own[0].id, fallback: own[0].fallback, label: `${c.countryName}: ${own[0].label}` });
    if (pool.length > MAX_LINES - world.length) notes.push(`Only the first ${MAX_LINES - world.length} countries fit on one chart`);
  } else if (own.length) {
    const c = pool[0];
    if (!c) return null;
    if (pool.length > 1) notes.push(`Several series for several countries do not fit one chart, so this shows ${c.countryName}; ask again for the others`);
    for (const w of own) series.push({ iso3: c.iso3, countryName: c.countryName, id: w.id, fallback: w.fallback, label: `${c.countryName}: ${w.label}` });
  }
  for (const w of world) series.push({ iso3: null, countryName: null, id: w.id, label: w.label });
  if (series.length > MAX_LINES) notes.push(`Only ${MAX_LINES} series fit on one chart; the rest were left out`);
  const kept = series.slice(0, MAX_LINES);
  if (!kept.length) return null;
  const tests = defaultTests(asked, kept.length);
  // Without the word chart, only make one when a test can actually run on what was named.
  if (!wantsChart && !tests.length) return null;
  const tf = TRANSFORM_WORDS.find(([re]) => re.test(question))?.[1] ?? 'level';
  const why = wantsChart ? 'the question asks for a chart' : `the question asks for ${asked.map((t) => TEST_TITLE[t].toLowerCase()).join(', ')}`;
  return { series: kept, tests, transform: tf, why, notes };
}

const CROSS_WORDS = /across (?:the )?(?:countries|watchlist|markets|emerging markets)|cross[- ]country|cross[- ]section|each country|every country|all (?:the |my )?countries|country by country/i;
/** Most countries on one cross-country scatter. */
export const MAX_CROSS = 30;
/** Fewest countries for the cross-country tests (each carries a small-sample caution below 15). */
export const MIN_CROSS = 5;

/**
 * "Scatter debt to GDP against bond yields across countries": one point per country at its latest
 * figure, with the regression line and which countries sit furthest from it.
 */
function crossRequest(question: string, words: Array<(typeof SERIES_WORDS)[number]>, countries: LiveWatchlistItem[]): ChartRequest | null {
  const own = words.filter((w) => !w.world);
  if (own.length < 2 || countries.length < 3) return null;
  if (!CROSS_WORDS.test(question) && !/\bscatter\b/i.test(question)) return null;
  // A scatter of two series for one country is a time scatter; across countries needs the words, or 3+ countries and "scatter".
  const [xw, yw] = own;
  const pool = countries.slice(0, MAX_CROSS);
  const series: ChartSeriesRef[] = pool.flatMap((c) => [
    { iso3: c.iso3, countryName: c.countryName, id: xw.id, fallback: xw.fallback, label: `${c.countryName}: ${xw.label}` },
    { iso3: c.iso3, countryName: c.countryName, id: yw.id, fallback: yw.fallback, label: `${c.countryName}: ${yw.label}` },
  ]);
  const notes: string[] = [];
  if (own.length > 2) notes.push(`A scatter takes two series, so ${own.slice(2).map((w) => w.label).join(', ')} ${own.length > 3 ? 'were' : 'was'} left out`);
  if (countries.length > MAX_CROSS) notes.push(`Only the first ${MAX_CROSS} countries fit`);
  return { series, tests: ['regression', 'correlation'], transform: 'level', why: 'the question asks to compare countries on a scatter', notes, cross: { x: xw.label, y: yw.label }, title: `${yw.label} against ${xw.label}, across countries` };
}

/** One point per country at its latest figure; the regression across countries and who sits furthest from the line. */
function computeCross(req: ChartRequest, fetched: Array<FetchedSeries | { reason: string }>): ChartResult {
  const { x, y } = req.cross!;
  const missing: string[] = [];
  const pairs: Pair[] = [];
  const dates: string[] = [];
  const sources = new Set<string>();
  let xUnit = '';
  let yUnit = '';
  for (let k = 0; k + 1 < req.series.length; k += 2) {
    const name = (req.series[k].countryName ?? req.series[k].iso3 ?? '').replace(/\s*\(.*\)\s*$/, '');
    const fx = fetched[k];
    const fy = fetched[k + 1];
    const okX = fx && 'points' in fx && fx.points.length ? fx : null;
    const okY = fy && 'points' in fy && fy.points.length ? fy : null;
    if (!okX || !okY) {
      const why = (f: (typeof fetched)[number] | undefined) => (f && 'reason' in f && f.reason) || 'no data';
      missing.push(`${name}: Missing ${[!okX ? `${x} (${why(fx)})` : '', !okY ? `${y} (${why(fy)})` : ''].filter(Boolean).join(' and ')}`);
      continue;
    }
    const lx = okX.points[okX.points.length - 1];
    const ly = okY.points[okY.points.length - 1];
    xUnit ||= okX.unit;
    yUnit ||= okY.unit;
    sources.add(okX.source);
    sources.add(okY.source);
    dates.push(lx.date, ly.date);
    pairs.push({ date: name, x: lx.value, y: ly.value });
  }
  dates.sort();
  const notes = [...req.notes];
  if (pairs.length) notes.push(`Latest figure for each country; the dates run from ${dates[0]} to ${dates[dates.length - 1]}. Sources: ${[...sources].join('; ')}`);
  const xl = `${x}${xUnit ? ` (${xUnit})` : ''}`;
  const yl = `${y}${yUnit ? ` (${yUnit})` : ''}`;
  const out: ChartResult = { title: req.title ?? `${y} against ${x}, across countries`, freq: 'annual', transform: 'level', lines: [], scatter: { xLabel: xl, yLabel: yl, pairs }, sources: [...sources], tests: [], missing, notes, first: dates[0], last: dates[dates.length - 1], request: req };
  const n = pairs.length;
  const caution = n < 15 ? `Only ${n} countries: treat the result as a rough guide.` : undefined;
  for (const test of req.tests) {
    if (test === 'regression') {
      const reg = ols(pairs.map((p) => p.y), pairs.map((p) => [p.x]), MIN_CROSS);
      if ('error' in reg) {
        out.tests.push({ test, title: 'Regression across countries', reading: `Not run: ${reg.error.replace('usable points', 'countries with both figures')}`, figures: [] });
        continue;
      }
      out.scatter!.fit = { a: reg.coef[0], b: reg.coef[1] };
      const resid = pairs.map((p, i) => ({ name: p.date, e: reg.residuals[i] })).sort((a, b) => b.e - a.e);
      const hi = resid[0];
      const lo = resid[resid.length - 1];
      out.tests.push({
        test,
        title: 'Regression across countries',
        reading: `Across ${reg.n} countries, each 1 ${xUnit} more in ${x} goes with ${fmt(reg.coef[1])} ${yUnit} in ${y} (t = ${r2(reg.t[1])}, ${fmtP(reg.p[1])}; R² = ${r2(reg.r2)}). ${hi.name} sits furthest above the line (${fmt(hi.e)} ${yUnit} above the fit), ${lo.name} furthest below (${fmt(Math.abs(lo.e))} ${yUnit} below it). A cross-section at one date: it says how countries compare, not how one country moves over time.`,
        figures: [
          { label: 'Slope across countries', value: fmt(reg.coef[1]) },
          { label: 'R² across countries', value: r2(reg.r2) },
          { label: 'Countries', value: String(reg.n) },
          { label: `Furthest above the line: ${hi.name}`, value: fmt(hi.e) },
          { label: `Furthest below the line: ${lo.name}`, value: fmt(lo.e) },
        ],
        caution,
      });
    }
    if (test === 'correlation') {
      const c = pearson(pairs.map((p) => p.x), pairs.map((p) => p.y), MIN_CROSS);
      if ('error' in c) out.tests.push({ test, title: 'Correlation across countries', reading: `Not run: ${c.error.replace('overlapping points', 'countries with both figures')}`, figures: [] });
      else
        out.tests.push({
          test,
          title: 'Correlation across countries',
          reading: `${strengthWord(c.r)[0].toUpperCase()}${strengthWord(c.r).slice(1)} ${c.r >= 0 ? 'positive' : 'negative'} correlation across ${c.n} countries: r = ${r2(c.r)} (${fmtP(c.p)}).`,
          figures: [
            { label: 'Correlation across countries (r)', value: r2(c.r) },
            { label: 'Countries', value: String(c.n) },
          ],
          caution,
        });
    }
  }
  return out;
}

/** With two series, correlation and lead/lag come by default; tests that need two series drop with one. */
function defaultTests(asked: ChartTest[], lines: number): ChartTest[] {
  const pairTests = PAIR_TESTS;
  const set = new Set<ChartTest>(asked);
  if (lines >= 2 && !asked.some((t) => pairTests.includes(t))) {
    set.add('correlation');
    set.add('leadlag');
  }
  if (lines < 2) for (const t of pairTests) set.delete(t);
  return TEST_ORDER.filter((t) => set.has(t));
}

/** A follow-up about the last chart keeps its series and adds any tests it asks for. */
export function carryChart(question: string, prev: ChartRequest, countries?: LiveWatchlistItem[]): ChartRequest {
  const more = testsInQuestion(question);
  const tf = TRANSFORM_WORDS.find(([re]) => re.test(question))?.[1] ?? prev.transform;
  if (prev.cross) {
    // Across countries: a follow-up naming three or more countries redraws it for them; otherwise it stays as it was.
    const w = (label: string) => SERIES_WORDS.find((x) => x.label === label);
    const xw = w(prev.cross.x);
    const yw = w(prev.cross.y);
    const again = countries && countries.length >= 3 && xw && yw ? crossRequest(`${xw.label} ${yw.label} across countries`, [xw, yw], countries) : null;
    return { ...(again ?? prev), notes: again ? again.notes : [], why: 'the same cross-country scatter as your last question' };
  }
  const preset = prev.preset && PRESETS.find((p) => p.id === prev.preset);
  if (preset) {
    const base = countries?.length ? presetRequest(preset, countries[0]) : { ...prev, notes: [] };
    const tests = [...new Set<ChartTest>([...prev.tests, ...more])];
    return { ...base, tests, transform: tf, why: countries?.length ? `the ${preset.name} again, for ${countries[0].countryName}` : 'carried over from your last question (the same chart)' };
  }
  let series = prev.series;
  const why = countries?.length ? 'the same chart as your last question, for the countries this one names' : 'carried over from your last question (the same chart)';
  if (countries?.length) {
    const own = prev.series.filter((s) => s.iso3);
    const world = prev.series.filter((s) => !s.iso3);
    const oneSeries = own.length > 0 && own.every((s) => s.id === own[0].id);
    const base = (s: ChartSeriesRef) => s.label.replace(/^[^:]+:\s*/, '');
    const swapped: ChartSeriesRef[] = oneSeries && own.length > 1
      ? countries.slice(0, MAX_LINES - world.length).map((c) => ({ ...own[0], iso3: c.iso3, countryName: c.countryName, label: `${c.countryName}: ${base(own[0])}` }))
      : own.map((s) => ({ ...s, iso3: countries[0].iso3, countryName: countries[0].countryName, label: `${countries[0].countryName}: ${base(s)}` }));
    series = [...swapped, ...world].slice(0, MAX_LINES);
  }
  return { ...prev, series, tests: defaultTests([...prev.tests, ...more], series.length), transform: tf, why, notes: [] };
}

// ---------------------------------------------------------------------------------------------
// Drawing and testing

const r2 = (v: number) => v.toFixed(2);
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

function asFreq(f: string): Freq {
  return f === 'daily' || f === 'weekly' || f === 'monthly' || f === 'quarterly' || f === 'annual' ? f : 'annual';
}

/** "monthly" → "months" for lag wording. */
function unitWord(freq: Freq, n: number): string {
  const w = { daily: 'day', weekly: 'week', monthly: 'month', quarterly: 'quarter', annual: 'year' }[freq];
  return `${n} ${w}${n === 1 ? '' : 's'}`;
}

/**
 * The chart and its tests. `fetched` lines up with req.series: a series, or the reason it is missing.
 * Lines are put on their common (coarsest) frequency so they share an axis and the tests compare
 * like with like.
 */
export function computeChart(req: ChartRequest, fetched: Array<FetchedSeries | { reason: string }>): ChartResult {
  if (req.cross) return computeCross(req, fetched);
  const missing: string[] = [];
  const have: Array<{ ref: ChartSeriesRef; s: FetchedSeries; i: number }> = [];
  req.series.forEach((ref, i) => {
    const f = fetched[i];
    if (f && 'points' in f && f.points.length) have.push({ ref, s: f, i });
    else missing.push(`${ref.label}: Missing (${(f && 'reason' in f && f.reason) || 'no data'})`);
  });
  const freq = have.length ? commonFreq(have.map((h) => h.s.points.map((p) => ({ date: p.date, value: p.value })))) : 'annual';
  // A series stored at a finer frequency than its dates show (e.g. "per pull") still lines up by date.
  const units: string[] = [];
  const lines: ChartLine[] = have.map(({ ref, s }, i) => {
    const onFreq = toFreq(s.points, freq);
    const pts = transform(onFreq, req.transform, freq);
    const unit = req.transform === 'level' ? s.unit : req.transform === 'yoy' ? '% y/y' : req.transform === 'zscore' ? 'std. dev.' : req.transform === 'index100' ? 'index' : s.unit;
    if (!units.includes(unit)) units.push(unit);
    const label = ref.countryName && !s.label.includes(ref.countryName) ? `${ref.countryName}: ${s.label}` : s.label;
    return { key: `s${i}`, label, unit, axis: units.indexOf(unit) === 0 ? 'left' : 'right', source: s.source, points: pts };
  });
  const notes = [...req.notes];
  if (req.derived?.length) {
    // Worked-out lines (real rate, Taylor gap...) on the common frequency, before any transform; drawn first.
    const level = new Map(have.map((h) => [h.i, new Map(toFreq(h.s.points, freq).map((p) => [p.date, p.value]))]));
    const made: ChartLine[] = [];
    req.derived.forEach((d, j) => {
      const used = d.terms.filter((t) => level.has(t.i));
      const lost = d.terms.filter((t) => !level.has(t.i));
      if (lost.some((t) => !t.optional)) {
        missing.push(`${d.label}: Missing (needs ${lost.filter((t) => !t.optional).map((t) => req.series[t.i]?.label ?? 'a series').join(' and ')})`);
        return;
      }
      for (const t of lost) if (t.optional && !notes.includes(t.optional)) notes.push(t.optional);
      const dates = [...level.get(used[0].i)!.keys()].filter((dt) => used.every((t) => level.get(t.i)!.has(dt))).sort();
      const pts = dates.map((dt) => ({ date: dt, value: d.constant + used.reduce((sum, t) => sum + t.k * level.get(t.i)!.get(dt)!, 0) }));
      if (!pts.length) {
        missing.push(`${d.label}: Missing (its series share no dates)`);
        return;
      }
      const sources = [...new Set(used.map((t) => have.find((h) => h.i === t.i)!.s.source))].join('; ');
      made.push({ key: `d${j}`, label: d.label, unit: req.transform === 'level' ? d.unit : units[0] ?? d.unit, axis: 'left', source: `worked out from ${sources}`, points: transform(pts, req.transform, freq) });
      if (d.method && !notes.includes(d.method)) notes.push(d.method);
    });
    if (made.length) {
      // The worked-out lines take the left axis; the series they come from move to the right.
      if (req.show) {
        const keep = new Set(have.filter((h) => req.show!.includes(h.i)).map((h) => lines[have.indexOf(h)]));
        lines.splice(0, lines.length, ...lines.filter((l) => keep.has(l)));
      }
      for (const l of [...made, ...lines]) l.axis = l.unit === made[0].unit ? 'left' : 'right';
      lines.unshift(...made);
    }
  }
  if (units.length > 2) notes.push(`The series have ${units.length} different units, so all but the first share the right-hand axis; ask for z-scores to compare their shapes`);
  if (req.transform !== 'level') notes.push(`Shown as: ${TRANSFORM_LABEL[req.transform].toLowerCase()}`);
  const allDates = lines.flatMap((l) => l.points.map((p) => p.date)).sort();
  const title = req.title ?? (lines.length ? lines.map((l) => l.label).join(' vs ') : req.series.map((s) => s.label).join(' vs '));
  const out: ChartResult = { title, freq, transform: req.transform, lines, tests: [], missing, notes, first: allDates[0], last: allDates[allDates.length - 1], request: req };

  const [a, b] = lines;
  const pair = a && b ? alignPair(a.points, b.points, freq) : null;
  const pairs = pair?.pairs ?? [];
  const span = pairs.length ? `${pairs[0].date} to ${pairs[pairs.length - 1].date}, ${pairs.length} ${freq} points` : '';
  const caution = sampleCaution(pairs.length, freq) ?? undefined;
  const fail = (test: ChartTest, why: string) => out.tests.push({ test, title: TEST_TITLE[test], reading: `Not run: ${why}`, figures: [] });

  for (const test of req.tests) {
    if (PAIR_TESTS.includes(test) && (!a || !b)) {
      fail(test, 'it needs two series and the chart has fewer');
      continue;
    }
    if (test === 'correlation') {
      const c = pearson(pairs.map((p) => p.x), pairs.map((p) => p.y));
      if ('error' in c) fail(test, c.error);
      else
        out.tests.push({
          test,
          title: TEST_TITLE[test],
          reading: `${a.label} and ${b.label} show ${strengthWord(c.r)} ${c.r >= 0 ? 'positive' : 'negative'} correlation: r = ${r2(c.r)} (${fmtP(c.p)}, ${span}). Correlation is not causation, and two trending series can correlate by accident.`,
          figures: [
            { label: 'Correlation (r)', value: r2(c.r) },
            { label: 'p-value', value: fmtP(c.p).replace('p = ', '').replace('p ', '') },
            { label: 'Points', value: String(c.n) },
          ],
          caution,
        });
    }
    if (test === 'regression') {
      const reg = ols(pairs.map((p) => p.y), pairs.map((p) => [p.x]));
      if ('error' in reg) fail(test, reg.error);
      else {
        out.scatter = { xLabel: a.label, yLabel: b.label, pairs, fit: { a: reg.coef[0], b: reg.coef[1] } };
        out.tests.push({
          test,
          title: TEST_TITLE[test],
          reading: `Regressing ${b.label} on ${a.label}: each 1 ${a.unit} more in ${a.label} goes with ${fmt(reg.coef[1])} ${b.unit} in ${b.label} (t = ${r2(reg.t[1])}, ${fmtP(reg.p[1])}); R² = ${r2(reg.r2)} over ${reg.n} points. Plain OLS: with trending series the t-statistic overstates confidence.`,
          figures: [
            { label: 'Slope', value: fmt(reg.coef[1]) },
            { label: 'Intercept', value: fmt(reg.coef[0]) },
            { label: 't-statistic', value: r2(reg.t[1]) },
            { label: 'R²', value: r2(reg.r2) },
            { label: 'Points', value: String(reg.n) },
          ],
          caution,
        });
      }
    }
    if (test === 'leadlag') {
      const max = Math.max(1, Math.min(Math.round(periodsPerYear(freq) * 1.5), Math.floor(pairs.length / 4)));
      const cc = crossCorrelation(pairs, max);
      if (!cc.length) fail(test, `too few overlapping points (${pairs.length})`);
      else {
        const top = cc.reduce((x, y) => (Math.abs(y.r) > Math.abs(x.r) ? y : x));
        const zero = cc.find((c) => c.lag === 0);
        const who = top.lag > 0 ? `${a.label} moves first, by about ${unitWord(freq, top.lag)}` : top.lag < 0 ? `${b.label} moves first, by about ${unitWord(freq, -top.lag)}` : 'neither moves first: the two line up best with no lag';
        out.tests.push({
          test,
          title: TEST_TITLE[test],
          reading: `Strongest link at a lag of ${top.lag}: ${who} (r = ${r2(top.r)}, ${fmtP(top.p)}${zero && top.lag !== 0 ? `; with no lag r = ${r2(zero.r)}` : ''}). Lags up to ${unitWord(freq, max)} either way were checked.`,
          figures: [
            { label: 'Best lag', value: String(top.lag) },
            { label: 'Correlation at best lag', value: r2(top.r) },
            ...(zero ? [{ label: 'Correlation with no lag', value: r2(zero.r) }] : []),
          ],
          caution,
          lags: cc.map((c) => ({ lag: c.lag, r: c.r, p: c.p })),
        });
      }
    }
    if (test === 'granger') {
      const lags = Math.max(1, Math.min(periodsPerYear(freq) >= 12 ? 6 : periodsPerYear(freq) >= 4 ? 4 : 2, Math.floor((pairs.length - 10) / 3)));
      const fwd = granger(pairs, lags);
      const back = granger(pairs.map((p) => ({ date: p.date, x: p.y, y: p.x })), lags);
      if ('error' in fwd) fail(test, fwd.error);
      else {
        const say = (p: number, from: string, to: string) => (p < 0.05 ? `past ${from} does help predict ${to}` : `past ${from} adds nothing significant to predicting ${to}`);
        const bp = 'error' in back ? NaN : back.p;
        out.tests.push({
          test,
          title: TEST_TITLE[test],
          reading: `With ${lags} lag(s): ${say(fwd.p, a.label, b.label)} (F = ${r2(fwd.f)}, ${fmtP(fwd.p)})${Number.isFinite(bp) ? `; ${say(bp, b.label, a.label)} (${fmtP(bp)})` : ''}. "Granger causality" means predictive help only, not cause; it assumes both series are stationary.`,
          figures: [
            { label: `F, ${a.label} → ${b.label}`, value: r2(fwd.f) },
            { label: `p, ${a.label} → ${b.label}`, value: fmtP(fwd.p).replace('p = ', '').replace('p ', '') },
            ...(Number.isFinite(bp) ? [{ label: `p, ${b.label} → ${a.label}`, value: fmtP(bp).replace('p = ', '').replace('p ', '') }] : []),
            { label: 'Lags', value: String(lags) },
          ],
          caution,
        });
      }
    }
    if (test === 'rolling') {
      const window = Math.max(8, Math.min(periodsPerYear(freq) * 3, Math.floor(pairs.length / 3)));
      const roll = rollingCorrelation(pairs, window);
      if (roll.length < 2) fail(test, `too few overlapping points for a ${window}-point window`);
      else {
        const vals = roll.map((p) => p.value);
        const lo = Math.min(...vals);
        const hi = Math.max(...vals);
        const now = vals[vals.length - 1];
        const flips = vals.some((v) => v > 0.2) && vals.some((v) => v < -0.2);
        out.tests.push({
          test,
          title: TEST_TITLE[test],
          reading: `Over ${window}-point windows the correlation ranged from ${r2(lo)} to ${r2(hi)} and is ${r2(now)} in the latest window (to ${roll[roll.length - 1].date}). ${flips ? 'It has changed sign, so the relationship is not stable.' : hi - lo > 0.6 ? 'It has moved a lot, so treat the full-sample figure with care.' : 'It has stayed in a fairly narrow range.'}`,
          figures: [
            { label: 'Rolling correlation, lowest', value: r2(lo) },
            { label: 'Rolling correlation, highest', value: r2(hi) },
            { label: 'Rolling correlation, latest', value: r2(now) },
            { label: 'Window', value: String(window) },
          ],
          rolling: roll,
        });
      }
    }
    if (test === 'hac') {
      const r = hacRegression(pairs);
      if ('error' in r) fail(test, r.error);
      else
        out.tests.push({
          test,
          title: TEST_TITLE[test],
          reading: `Regressing ${b.label} on ${a.label} with Newey-West errors (lag ${r.lag}): slope ${fmt(r.slope)} ${b.unit} per ${a.unit}, standard error ${fmt(r.seHac)} against ${fmt(r.seOls)} for plain OLS, so t = ${r2(r.t)} (${fmtP(r.p)}, ${r.n} points). Errors that run on from one period to the next make plain OLS too confident; this keeps the slope and widens the error. Still an association, not a cause.`,
          figures: [
            { label: 'Slope', value: fmt(r.slope) },
            { label: 'Newey-West standard error', value: fmt(r.seHac) },
            { label: 'OLS standard error', value: fmt(r.seOls) },
            { label: 't-statistic (Newey-West)', value: r2(r.t) },
            { label: 'Newey-West lag', value: String(r.lag) },
          ],
          caution,
        });
    }
    if (test === 'var') {
      const r = varTest(pairs, freq);
      if ('error' in r) fail(test, r.error);
      else {
        const s = r.bToA;
        const peak = s.reduce((x, y) => (Math.abs(y.value) > Math.abs(x.value) ? y : x));
        const clear = s.filter((x) => x.lo > 0 || x.hi < 0).length;
        const back = r.aToB.reduce((x, y) => (Math.abs(y.value) > Math.abs(x.value) ? y : x));
        out.tests.push({
          test,
          title: TEST_TITLE[test],
          reading: `VAR with ${r.lags} lag(s) (chosen by AIC from up to ${r.maxLag}), ${r.n} points. After a one-standard-deviation surprise in ${a.label} (${fmt(r.shockA)} ${a.unit}), ${b.label} moves ${fmt(s[0].value)} ${b.unit} at once, ${peak.h === r.horizon ? `and is still growing at ${fmt(peak.value)} after ${unitWord(freq, r.horizon)}` : `most (${fmt(peak.value)}) after ${unitWord(freq, peak.h)}, and ${fmt(s[s.length - 1].value)} after ${unitWord(freq, r.horizon)}`}; the 90% band leaves out zero at ${clear} of ${s.length} horizons. A surprise in ${b.label} (${fmt(r.shockB)} ${b.unit}) moves ${a.label} by at most ${fmt(back.value)} ${a.unit}. ${a.label} is ordered first, so its surprise can move ${b.label} in the same period but not the other way round. Reduced form: the surprises are not identified policy shocks.`,
          figures: [
            { label: 'Lags (AIC)', value: String(r.lags) },
            { label: `${b.label}, on impact`, value: fmt(s[0].value) },
            { label: `${b.label}, largest response`, value: `${fmt(peak.value)} at ${peak.h}` },
            { label: `${b.label}, after ${r.horizon} periods`, value: fmt(s[s.length - 1].value) },
            { label: 'Band', value: `90%, bootstrap of ${r.draws} draws` },
          ],
          caution: caution ?? 'A VAR in levels of series that wander (see the ADF test) can mislead; show the chart as changes to check.',
          irf: { label: `${b.label} after a surprise in ${a.label}`, steps: s },
        });
      }
    }
    if (test === 'lp') {
      const r = lpTest(pairs, freq);
      if ('error' in r) fail(test, r.error);
      else {
        const s = r.steps;
        const last = s[s.length - 1];
        out.tests.push({
          test,
          title: TEST_TITLE[test],
          reading: `Local projections (Jordà 2005), ${r.lags} lag(s) of both changes, ${r.n} points: after a rise of 1 ${a.unit} in ${a.label}, ${b.label} has moved ${s.map((x) => `${fmt(x.value)} after ${x.h}`).join(', ')} periods (90% band at ${last.h}: ${fmt(last.lo)} to ${fmt(last.hi)}). Newey-West errors. Co-movement in the sample, not the effect of one on the other.`,
          figures: s.map((x) => ({ label: `After ${x.h}`, value: `${fmt(x.value)} (${fmt(x.lo)} to ${fmt(x.hi)})` })),
          caution,
          irf: { label: `${b.label} after a 1 ${a.unit} rise in ${a.label}`, steps: s.map(({ h, value, lo, hi }) => ({ h, value, lo, hi })) },
        });
      }
    }
    if (test === 'coint') {
      const v = varTest(pairs, freq, { draws: 0 });
      const lags = 'error' in v ? 2 : v.lags;
      const r = johansenTest(pairs, lags);
      if ('error' in r) fail(test, r.error);
      else {
        const say =
          r.rank === 0
            ? `no long-run relationship is found: the two can drift apart for good`
            : r.rank === 1
              ? `the two share one long-run relationship${r.beta !== undefined ? ` (${a.label} + ${fmt(r.beta)} x ${b.label} stays near its mean)` : ''}, so they do not drift apart for good`
              : `both look stationary on their own, so the test's premise (both wander) fails; see the ADF test`;
        out.tests.push({
          test,
          title: TEST_TITLE[test],
          reading: `Johansen trace test (VAR lag ${r.lags}, ${r.n} points): trace ${r2(r.trace[0])} against a 5% value of ${r2(JOHANSEN_CRIT.r0[1])} for no relationship, and ${r2(r.trace[1])} against ${r2(JOHANSEN_CRIT.r1[1])} for at most one. At 5%, ${say}.`,
          figures: [
            { label: 'Trace, rank 0', value: r2(r.trace[0]) },
            { label: 'Trace, rank at most 1', value: r2(r.trace[1]) },
            { label: 'Rank at 5%', value: String(r.rank) },
            { label: 'VAR lag', value: String(r.lags) },
          ],
          caution: caution ?? 'Meant for series that wander (unit roots); run it on levels, not changes.',
        });
      }
    }
    if (test === 'breaks') {
      const r = breaksTest(pairs);
      if ('error' in r) fail(test, r.error);
      else {
        const regimes = r.regimes.map((g) => `${g.from} to ${g.to}: slope ${fmt(g.slope)}, intercept ${fmt(g.intercept)}`).join('; ');
        out.tests.push({
          test,
          title: TEST_TITLE[test],
          reading: `Regression of ${b.label} on ${a.label}: the largest Chow statistic over break dates (sup-F) is ${r2(r.supF)} at ${r.supFDate}, against a 5% value of ${SUPF_CRIT_5}, so ${r.significant ? `the relationship did change. Bai-Perron finds ${r.breaks.length} break(s) by BIC, at ${r.dates.join(', ')}: ${regimes}` : `no break is found (slope ${fmt(r.regimes[0].slope)} throughout)`}. Each regime is at least ${r.minSize} points long; break dates are estimates.`,
          figures: [
            { label: 'sup-F', value: r2(r.supF) },
            { label: '5% critical value', value: String(SUPF_CRIT_5) },
            { label: 'Breaks (BIC)', value: String(r.breaks.length) },
            ...(r.dates.length ? [{ label: 'Break dates', value: r.dates.join(', ') }] : []),
          ],
          caution,
        });
      }
    }
    if (test === 'summary') {
      const subject = lines.filter((l) => l.key.startsWith('d'));
      for (const l of (subject.length ? subject : lines).slice(0, 1)) {
        const vals = l.points.map((p) => p.value);
        if (!vals.length) continue;
        const now = vals[vals.length - 1];
        const avg = vals.reduce((x, y) => x + y, 0) / vals.length;
        const below = Math.round((100 * vals.filter((v) => v < now).length) / vals.length);
        const from = l.points[0].date;
        const to = l.points[l.points.length - 1].date;
        const side = Math.abs(now - avg) < 1e-9 ? 'at' : now > avg ? 'above' : 'below';
        out.tests.push({
          test,
          title: `${TEST_TITLE.summary}: ${l.label}`,
          reading: `${l.label} is ${fmt(now)} ${l.unit} at ${to}, ${side} its average of ${fmt(avg)} ${l.unit} since ${from}, and higher than ${below}% of the ${vals.length} ${freq} points (range ${fmt(Math.min(...vals))} to ${fmt(Math.max(...vals))}).`,
          figures: [
            { label: `${l.label}, latest`, value: fmt(now) },
            { label: `${l.label}, average since ${from}`, value: fmt(avg) },
            { label: `${l.label}, lowest`, value: fmt(Math.min(...vals)) },
            { label: `${l.label}, highest`, value: fmt(Math.max(...vals)) },
            { label: `Share of points below the latest`, value: `${below}%` },
          ],
          caution: sampleCaution(vals.length, freq) ?? undefined,
        });
      }
    }
    if (test === 'adf') {
      for (const l of lines.slice(0, 2)) {
        const r = adf(l.points.map((p) => p.value));
        if ('error' in r) {
          out.tests.push({ test, title: `${TEST_TITLE.adf}: ${l.label}`, reading: `Not run: ${r.error}`, figures: [] });
          continue;
        }
        out.tests.push({
          test,
          title: `${TEST_TITLE.adf}: ${l.label}`,
          reading: `${l.label}: ADF statistic ${r2(r.stat)} against a 5% critical value of ${r2(r.critical['5%'])} (${r.lags} lag(s), ${r.n} points). ${r.stationary ? 'The unit root is rejected: the series looks stationary (it tends to return to its mean).' : 'The unit root is not rejected: the series may wander (trend or random walk), so correlations and regressions on its level can mislead; its change is safer.'}`,
          figures: [
            { label: `ADF statistic, ${l.label}`, value: r2(r.stat) },
            { label: '5% critical value', value: r2(r.critical['5%']) },
            { label: 'Lags', value: String(r.lags) },
          ],
          caution: sampleCaution(r.n, freq) ?? undefined,
        });
      }
    }
    if (test === 'hp') {
      const l = lines[0];
      if (!l) continue;
      const hp = hpFilter(l.points.map((p) => p.value), hpLambda(freq));
      if ('error' in hp) {
        fail(test, hp.error);
        continue;
      }
      out.lines.push({ key: `${l.key}_trend`, label: `${l.label}, HP trend`, unit: l.unit, axis: l.axis, source: 'HP filter on the series above', points: l.points.map((p, i) => ({ date: p.date, value: hp.trend[i] })), dashed: true });
      const gap = hp.cycle[hp.cycle.length - 1];
      out.tests.push({
        test,
        title: `${TEST_TITLE.hp}: ${l.label}`,
        reading: `${l.label} is ${fmt(Math.abs(gap))} ${l.unit} ${gap >= 0 ? 'above' : 'below'} its HP trend at the last point (${l.points[l.points.length - 1].date}; smoothing λ = ${hpLambda(freq)}). The HP trend bends towards the latest points, so the end of the sample is the least reliable part.`,
        figures: [
          { label: 'Gap from trend, latest', value: fmt(gap) },
          { label: 'Trend, latest', value: fmt(hp.trend[hp.trend.length - 1]) },
          { label: 'Smoothing λ', value: String(hpLambda(freq)) },
        ],
      });
    }
  }
  // Keep what is drawn (and saved with the conversation) to a sensible size; the tests above used every point.
  for (const l of out.lines) if (l.points.length > MAX_SAVED_POINTS) l.points = l.points.slice(-MAX_SAVED_POINTS);
  if (out.scatter && out.scatter.pairs.length > MAX_SAVED_POINTS) out.scatter.pairs = out.scatter.pairs.slice(-MAX_SAVED_POINTS);
  for (const t of out.tests) if (t.rolling && t.rolling.length > MAX_SAVED_POINTS) t.rolling = t.rolling.slice(-MAX_SAVED_POINTS);
  return out;
}

/** Fetches each series of a request from the app's own history routes; a missing one comes back with its reason. */
export async function fetchChartSeries(req: ChartRequest, get: typeof fetch = fetch): Promise<Array<FetchedSeries | { reason: string }>> {
  const one = async (ref: ChartSeriesRef, id: string): Promise<FetchedSeries | { reason: string }> => {
    const url = ref.iso3 ? `/api/series/${encodeURIComponent(ref.iso3)}/${encodeURIComponent(id)}` : `/api/series/world/${encodeURIComponent(id)}`;
    const r = await get(url);
    const body = (await r.json().catch(() => ({}))) as Partial<FetchedSeries> & { reason?: string; message?: string };
    if (r.ok && Array.isArray(body.points)) return body as FetchedSeries;
    return { reason: body.reason || body.message?.replace(/^.*?Missing\.\s*/, '') || (r.status === 404 ? 'the app holds no history for it yet' : `HTTP ${r.status}`) };
  };
  return Promise.all(
    req.series.map(async (ref) => {
      try {
        const first = await one(ref, ref.id);
        if ('reason' in first && ref.fallback) {
          const alt = await one(ref, ref.fallback);
          if (!('reason' in alt)) return alt;
        }
        return first;
      } catch {
        return { reason: 'the app server did not answer' };
      }
    })
  );
}

/** The chart as an agent finding, so the summary agent and follow-ups can talk about the results. */
export function chartFinding(req: ChartRequest, result: ChartResult): {
  iso3: string;
  countryName: string;
  reading: string;
  figures: Array<{ label: string; value: string; source: string; tag: 'model' }>;
  weight: number;
} | null {
  const ran = result.tests.filter((t) => t.figures.length);
  if (!result.lines.length && !result.scatter?.pairs.length) return null;
  const source = req.cross
    ? `Chart Agent on ${result.scatter?.yLabel} against ${result.scatter?.xLabel}, latest figure per country, ${result.first ?? ''} to ${result.last ?? ''}`
    : `Chart Agent on ${result.lines.map((l) => `${l.label} (${l.source})`).join('; ')}, ${result.first ?? ''} to ${result.last ?? ''}, ${result.freq}`;
  const figures = ran.flatMap((t) => t.figures.map((f) => ({ label: `${t.title}: ${f.label}`, value: f.value, source, tag: 'model' as const })));
  if (req.cross && result.scatter) {
    for (const p of result.scatter.pairs) {
      figures.push({ label: `${p.date}: ${result.scatter.xLabel}`, value: fmt(p.x), source, tag: 'model' });
      figures.push({ label: `${p.date}: ${result.scatter.yLabel}`, value: fmt(p.y), source, tag: 'model' });
    }
  }
  for (const l of result.lines.filter((x) => !x.dashed)) {
    const last = l.points[l.points.length - 1];
    if (last) figures.push({ label: `${l.label}, latest (${last.date})`, value: `${fmt(last.value)} ${l.unit}`, source: l.source, tag: 'model' });
  }
  const reading = ran.length ? ran.map((t) => t.reading).join(' ') : `Charted ${result.title} from ${result.first} to ${result.last}.`;
  const first = req.series.find((s) => s.iso3);
  return { iso3: first?.iso3 ?? 'WLD', countryName: result.title, reading, figures, weight: 1 };
}

/** Suggested follow-ups after a chart: the tests not yet run. */
export function chartFollowUps(req: ChartRequest): string[] {
  const out: string[] = [];
  if (req.cross) return ['Which countries sit furthest from the line, and why?'];
  if (req.derived?.length) {
    if (!req.tests.includes('hp')) out.push('Where is it against its trend?');
    if (!req.tests.includes('adf')) out.push('Is it stationary?');
    out.push('What does this mean for the next policy move?');
    return out;
  }
  if (req.series.length >= 2) {
    if (!req.tests.includes('rolling')) out.push('Is that relationship stable over time?');
    if (!req.tests.includes('granger')) out.push('Does one help predict the other?');
    if (!req.tests.includes('regression')) out.push('Show it as a scatter with a regression line');
  }
  if (!req.tests.includes('adf')) out.push('Are these series stationary?');
  if (!req.tests.includes('hp')) out.push('Where is it against its trend?');
  return out;
}

/** Points kept per line in a saved conversation (enough for a chart, small enough for the file). */
export const MAX_SAVED_POINTS = 600;
