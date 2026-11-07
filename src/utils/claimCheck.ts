/**
 * Claim check (seven-groups plan, Phase 5, journalists): a typed sentence such as "Turkey's
 * inflation is 33%" or "Is it true Turkey's inflation is the highest in the G20?" is checked
 * against the app's own figures, by stated rules and no AI.
 *
 *   Figures   the document figure check (utils/docFigureCheck.ts) finds the figures the sentence
 *             states for the policy rate, inflation, government debt, primary balance, reserves and
 *             growth; each is put next to the app's figure for the one watchlist country it names,
 *             with the same tolerance. A year in the sentence that is not the year of the app's
 *             figure is reported as a different period, not as a match or a difference.
 *   Rankings  "highest / lowest / largest ... in the G20 / G7 / on the watchlist": the named
 *             country's figure is ranked against the members of that group the watchlist holds a
 *             figure for. A higher figure elsewhere disproves the claim; topping the covered members
 *             only supports it when every member is covered.
 *
 * A check against the app's figures, which may be older or measure something else (monthly against
 * annual inflation). Browser-safe, pure.
 */
import type { LiveWatchlistItem } from '../types/council';
import type { AgentAnswer, AgentFigure, AgentFinding } from './askCouncil';
import { MEASURE_LABEL, TOLERANCE, appFigure, compareClaims, extractClaims, fmtMeasure, type DocMeasure } from './docFigureCheck';

export const CLAIM_AGENT_NAME = 'Claim Check';
export const CLAIM_AGENT_COVERS =
  "a figure or a ranking stated in the question (\"inflation is 33%\", \"the highest in the G20\") checked against the app's figure for the country, with the source and date, by stated rules";

export const GROUPS: Record<'G20' | 'G7', { label: string; members: string[] }> = {
  // The G20's 19 member countries (the EU and the African Union are not countries).
  G20: { label: 'the G20', members: ['ARG', 'AUS', 'BRA', 'CAN', 'CHN', 'FRA', 'DEU', 'IND', 'IDN', 'ITA', 'JPN', 'KOR', 'MEX', 'RUS', 'SAU', 'ZAF', 'TUR', 'GBR', 'USA'] },
  G7: { label: 'the G7', members: ['CAN', 'FRA', 'DEU', 'ITA', 'JPN', 'GBR', 'USA'] },
};

/** Measure words without a number, for rankings. Order matters: debt before growth ("debt growth" is rare). */
const MEASURE_WORDS: Array<{ measure: DocMeasure; re: RegExp }> = [
  { measure: 'policy', re: /\b(?:policy rate|interest rates?|key rate|benchmark rate|repo rate|bank rate|selic)\b/i },
  { measure: 'primary', re: /\bprimary (?:fiscal )?(?:balance|surplus|deficit)\b/i },
  { measure: 'debt', re: /\b(?:government|public|sovereign|state) debt\b|\bdebt(?:[- ]to[- ]gdp| ratio)?\b/i },
  { measure: 'reserves', re: /\breserves\b/i },
  { measure: 'cpi', re: /\binflation\b|\bconsumer prices?\b|\bcpi\b/i },
  { measure: 'growth', re: /\bgrowth\b|\bgdp\b|\bgrew\b|\bexpanded\b/i },
];

const RANK_RE =
  /\b(highest|lowest|largest|biggest|smallest|fastest|slowest|strongest|weakest)\b[^.?!]{0,50}?\b(?:in|among|of|on)\s+(?:the\s+|our\s+|my\s+)?(G-?20|G-?7|watchlist|world|emerging (?:markets?|economies))\b/i;
const HIGH = /highest|largest|biggest|fastest|strongest/i;

export interface RankClaim {
  measure: DocMeasure;
  direction: 'max' | 'min';
  group: 'G20' | 'G7' | 'watchlist' | 'other';
  /** The group as the sentence names it. */
  groupText: string;
}

export function rankClaim(text: string): RankClaim | null {
  const m = text.match(RANK_RE);
  if (!m) return null;
  const measure = MEASURE_WORDS.find((w) => w.re.test(text))?.measure;
  if (!measure) return null;
  const g = m[2].toUpperCase().replace('-', '');
  const group = g === 'G20' || g === 'G7' ? g : g === 'WATCHLIST' ? 'watchlist' : 'other';
  return { measure, direction: HIGH.test(m[1]) ? 'max' : 'min', group, groupText: m[2] };
}

/** Does the question state something checkable (a figure or a ranking)? */
export function asksClaim(text: string): boolean {
  return extractClaims(text).length > 0 || rankClaim(text) !== null;
}

const yearOf = (s: string) => s.match(/\b(19[5-9]\d|20\d\d)\b/)?.[1];
const baseName = (n: string) => n.replace(/\s*\(.*\)\s*$/, '').trim();

export type ClaimVerdict = 'matches' | 'differs' | 'different period' | 'no app figure' | 'holds' | 'holds among covered' | 'does not hold' | 'cannot check';

export interface ClaimResult {
  verdict: ClaimVerdict;
  reading: string;
  figures: AgentFigure[];
}

/** Each stated figure against the app's figure for one country. */
export function checkFigures(text: string, it: LiveWatchlistItem): ClaimResult[] {
  const name = baseName(it.countryName);
  const said = yearOf(text);
  return compareClaims(extractClaims(text), it).map((c): ClaimResult => {
    const label = MEASURE_LABEL[c.claim.measure];
    const stated = fmtMeasure(c.claim.measure, c.claim.value);
    if (!c.app || c.gap === undefined) return { verdict: 'no app figure', reading: `${label}: the sentence says ${stated} for ${name}; the app holds no figure to check it against.`, figures: [] };
    const appSaid = fmtMeasure(c.claim.measure, c.app.value);
    const appFig: AgentFigure = { label: `${label}, ${name}, in the app`, value: appSaid, source: c.app.source, tag: c.app.tag };
    const appYear = yearOf(c.app.source);
    if (said && appYear && said !== appYear)
      return {
        verdict: 'different period',
        reading: `${label}: the sentence says ${stated} in ${said}; the app's figure is ${appSaid} for ${appYear} (${c.app.source}), a different period, so it neither confirms nor contradicts it.`,
        figures: [appFig, { label: `${label}: sentence against the app`, value: 'different period', source: `the sentence names ${said}, the app's figure is for ${appYear}`, tag: 'model' }],
      };
    const tol = TOLERANCE[c.claim.measure];
    const gap = `${c.gap > 0 ? '+' : ''}${c.gap.toFixed(tol.unit === '%' ? 0 : 2)} ${tol.unit}`;
    return {
      verdict: c.matches ? 'matches' : 'differs',
      reading: c.matches
        ? `${label}: the sentence's ${stated} matches the app's ${appSaid} (${c.app.source}).`
        : `${label}: the sentence says ${stated}, the app's figure is ${appSaid} (${c.app.source}), a difference of ${gap}.`,
      figures: [appFig, { label: `${label}: sentence against the app`, value: c.matches ? 'matches' : `differs by ${gap}`, source: `sentence less app; within ${tol.value} ${tol.unit} counts as matching`, tag: 'model' }],
    };
  });
}

/** A ranking claim for one country against the group members on the watchlist. */
export function checkRank(rc: RankClaim, it: LiveWatchlistItem, items: LiveWatchlistItem[]): ClaimResult {
  const name = baseName(it.countryName);
  const label = MEASURE_LABEL[rc.measure];
  const word = rc.direction === 'max' ? 'highest' : 'lowest';
  if (rc.group === 'other')
    return { verdict: 'cannot check', reading: `${label}: "${rc.groupText}" is not a group the app can rank; it ranks within the G20, the G7 or the watchlist.`, figures: [] };
  const own = appFigure(it, rc.measure);
  if (!own) return { verdict: 'cannot check', reading: `${label}: the app holds no figure for ${name}, so the ranking cannot be checked.`, figures: [] };
  const members = rc.group === 'watchlist' ? items.filter((i) => !i.isBenchmark).map((i) => i.iso3) : GROUPS[rc.group].members;
  const groupLabel = rc.group === 'watchlist' ? 'the watchlist' : GROUPS[rc.group].label;
  if (!members.includes(it.iso3)) return { verdict: 'cannot check', reading: `${label}: ${name} is not a member of ${groupLabel}.`, figures: [] };
  const rows = members
    .map((iso) => items.find((i) => i.iso3 === iso))
    .filter((i): i is LiveWatchlistItem => !!i)
    .map((i) => ({ it: i, fig: appFigure(i, rc.measure) }))
    .filter((r): r is { it: LiveWatchlistItem; fig: NonNullable<ReturnType<typeof appFigure>> } => !!r.fig)
    .sort((a, b) => (rc.direction === 'max' ? b.fig.value - a.fig.value : a.fig.value - b.fig.value));
  const covered = rows.length;
  const uncovered = members.filter((iso) => !rows.some((r) => r.it.iso3 === iso));
  const rank = rows.findIndex((r) => r.it.iso3 === it.iso3) + 1;
  const top = rows[0];
  const sources = [...new Set(rows.map((r) => r.fig.source.replace(/,.*$/, '')))];
  const mixed = sources.length > 1 ? ` The figures come from ${sources.join(' and ')}, so they are not all for the same period.` : '';
  const figures: AgentFigure[] = [
    { label: `${label}, ${name}, in the app`, value: fmtMeasure(rc.measure, own.value), source: own.source, tag: own.tag },
    ...rows
      .filter((r) => r.it.iso3 !== it.iso3)
      .slice(0, 3)
      .map((r): AgentFigure => ({ label: `${label}, ${baseName(r.it.countryName)}, in the app`, value: fmtMeasure(rc.measure, r.fig.value), source: r.fig.source, tag: r.fig.tag })),
  ];
  const ofGroup = rc.group === 'watchlist' ? `${covered} watchlist countries with a figure` : `${covered} of the ${members.length} members of ${groupLabel} the app holds a figure for`;
  if (rank > 1) {
    const verdictFig: AgentFigure = { label: `${label}: is ${name} the ${word}?`, value: 'does not hold', source: `rank ${rank} of ${ofGroup}`, tag: 'model' };
    return {
      verdict: 'does not hold',
      reading: `${label}: in the app's figures ${name} is not the ${word} in ${groupLabel}; it ranks ${rank} of ${ofGroup}, and ${baseName(top.it.countryName)} is ${word === 'highest' ? 'higher' : 'lower'} at ${fmtMeasure(rc.measure, top.fig.value)} (${top.fig.source}).${mixed}`,
      figures: [...figures, verdictFig],
    };
  }
  const whole = uncovered.length === 0;
  const verdict: ClaimVerdict = whole ? 'holds' : 'holds among covered';
  const note = whole ? '' : ` The app holds no figure for ${uncovered.length} member${uncovered.length === 1 ? '' : 's'} (${uncovered.join(', ')}), so it cannot rule them out.`;
  return {
    verdict,
    reading: `${label}: ${name} is the ${word} of the ${ofGroup}, at ${fmtMeasure(rc.measure, own.value)} (${own.source}).${note}${mixed}`,
    figures: [...figures, { label: `${label}: is ${name} the ${word}?`, value: whole ? 'holds' : 'holds among the members covered', source: `rank 1 of ${ofGroup}`, tag: 'model' }],
  };
}

const WEIGHT: Record<ClaimVerdict, number> = { 'does not hold': 0.95, differs: 0.9, 'holds among covered': 0.8, holds: 0.8, matches: 0.7, 'different period': 0.6, 'no app figure': 0.3, 'cannot check': 0.3 };

/**
 * The Claim Check answer for a question, or null when it states nothing checkable. `named` are
 * the watchlist countries the question names.
 */
export function claimAnswer(text: string, named: LiveWatchlistItem[], items: LiveWatchlistItem[]): AgentAnswer | null {
  const figures = extractClaims(text);
  const rc = rankClaim(text);
  if (!figures.length && !rc) return null;
  const answer: AgentAnswer = { id: 'claim', name: CLAIM_AGENT_NAME, why: 'The question states a figure or a ranking to check.', findings: [], missing: [] };
  if (!named.length) {
    answer.missing.push('the sentence names no watchlist country, so its figures were not checked');
    return answer;
  }
  if (named.length > 1 && figures.length) answer.missing.push(`the sentence names ${named.length} countries; stated figures are checked only when it names one, so ask about one country at a time`);
  const findings: AgentFinding[] = [];
  for (const it of named) {
    const results = [...(named.length === 1 ? checkFigures(text, it) : []), ...(rc ? [checkRank(rc, it, items)] : [])];
    if (!results.length) continue;
    findings.push({
      iso3: it.iso3,
      countryName: it.countryName,
      reading: `${results.map((r) => r.reading).join(' ')} Checked against the app's figures, which may be older than the sentence or measure something else.`,
      figures: results.flatMap((r) => r.figures),
      weight: Math.max(...results.map((r) => WEIGHT[r.verdict])),
    });
  }
  answer.findings = findings;
  return answer;
}

export const CLAIM_METHOD =
  "Figures stated in the sentence (policy rate, inflation, government debt, primary balance, official reserves, real GDP growth) are found by the same rules as the document figure check and compared with the app's figure for the one watchlist country the sentence names, within the same tolerances; a year in the sentence that differs from the year of the app's figure is reported as a different period. Rankings (highest, lowest, largest and so on in the G20, the G7 or the watchlist) rank the country's app figure against the members the app holds a figure for: a higher figure elsewhere disproves the claim, and topping the covered members supports it fully only when every member is covered. Sentences about targets or forecasts are left out. A check against the app's figures, not a verdict on the truth.";
