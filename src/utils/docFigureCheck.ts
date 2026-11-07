/**
 * Check your documents against the app's figures (Sam, 2026-11-05).
 *
 * The Policy Document Agent quotes passages. This adds a check by stated rules, no AI: it finds the
 * figures a document states for a few measures (policy rate, inflation, government debt, primary
 * balance, official reserves, growth), reads which country the document is about, and puts each
 * next to the app's own figure for that country, with its source and date, saying whether they
 * match. A difference is not an error in either: the document may be older, or measure something
 * else (core against headline inflation, a monthly against an annual figure).
 *
 * Sentences about targets, forecasts or projections are left out: a target of 3% is not a reading.
 */
import type { LiveWatchlistItem } from '../types/council';
import { formatPeriod } from './officialYields';
import { formatImfPeriod } from './imfReserves';

export type DocMeasure = 'policy' | 'cpi' | 'debt' | 'primary' | 'reserves' | 'growth';

export const MEASURE_LABEL: Record<DocMeasure, string> = {
  policy: 'Policy rate',
  cpi: 'Inflation',
  debt: 'Government debt',
  primary: 'Primary balance',
  reserves: 'Official reserves',
  growth: 'Real GDP growth',
};

/** How close counts as matching, in the measure's own unit. */
export const TOLERANCE: Record<DocMeasure, { value: number; unit: string }> = {
  policy: { value: 0.05, unit: 'pts' },
  cpi: { value: 0.2, unit: 'pts' },
  debt: { value: 1, unit: 'pts' },
  primary: { value: 0.3, unit: 'pts' },
  reserves: { value: 2, unit: '%' },
  growth: { value: 0.2, unit: 'pts' },
};

export interface DocClaim {
  measure: DocMeasure;
  value: number;
  /** The sentence it came from, trimmed. */
  quote: string;
}

const PCT = String.raw`(-?\d+(?:[.,]\d+)?)\s*(?:%|per ?cent|percent)`;
const PATTERNS: Array<{ measure: DocMeasure; re: RegExp }> = [
  { measure: 'policy', re: new RegExp(String.raw`(?:policy rate|selic|benchmark (?:interest )?rate|key (?:interest )?rate|(?:one-week )?repo rate|bank rate|cash rate|overnight rate|monetary policy rate|federal funds|deposit facility rate)[^.;]{0,80}?` + PCT, 'i') },
  { measure: 'cpi', re: new RegExp(String.raw`(?:headline inflation|consumer price inflation|cpi inflation|annual inflation|inflation rate|inflation|consumer prices?)[^.;]{0,60}?` + PCT, 'i') },
  { measure: 'debt', re: new RegExp(String.raw`(?:general government|gross public|public|government|sovereign) (?:gross )?debt[^.;]{0,60}?` + PCT + String.raw`\s*of\s*gdp`, 'i') },
  { measure: 'primary', re: new RegExp(String.raw`primary (?:fiscal )?(?:balance|surplus|deficit|result)[^.;]{0,60}?` + PCT, 'i') },
  { measure: 'reserves', re: /(?:international|official|foreign(?: exchange)?|fx) reserves[^.;]{0,60}?(?:us)?\$\s?(\d+(?:[.,]\d+)?)\s*(?:bn|billion)/i },
  { measure: 'growth', re: new RegExp(String.raw`(?:real gdp growth|gdp growth|economic growth|real gdp|the economy (?:grew|expanded))[^.;]{0,50}?` + PCT, 'i') },
];

/** Words that make a sentence a target or a forecast rather than a reading. */
const NOT_A_READING = /\b(?:target(?:ed)? (?:of|is|at|was|range|band)|targets? \d|goal of|forecast|projected|projection|expect|expected|expects|will|would|could|should|outlook|scenario|assum|by end-|next year|in 20(?:2[7-9]|3\d))\b/i;

/** Sentences of a document, roughly. */
const sentencesOf = (text: string) => text.replace(/\s+/g, ' ').split(/(?<=[.;!?])\s+(?=[A-Z])/);

export function extractClaims(text: string, max = 12): DocClaim[] {
  const out: DocClaim[] = [];
  const seen = new Set<DocMeasure>();
  for (const s of sentencesOf(text)) {
    if (NOT_A_READING.test(s)) continue;
    for (const { measure, re } of PATTERNS) {
      if (seen.has(measure)) continue;
      const m = s.match(re);
      if (!m) continue;
      let value = Number(m[1].replace(',', '.'));
      if (!Number.isFinite(value)) continue;
      // A primary deficit of 1.2% is a balance of -1.2%.
      if (measure === 'primary' && /primary (?:fiscal )?deficit/i.test(m[0]) && value > 0) value = -value;
      seen.add(measure);
      out.push({ measure, value, quote: s.trim().slice(0, 300) });
    }
    if (out.length >= max) break;
  }
  return out;
}

/** The app's figure for a measure on a watchlist row, with its source and tag; undefined when the app has none. */
export function appFigure(it: LiveWatchlistItem, measure: DocMeasure): { value: number; source: string; tag: 'live' | 'official' } | undefined {
  switch (measure) {
    case 'policy':
      return it.policyRatePct !== undefined && it.policyRateSource === 'bis'
        ? { value: it.policyRatePct, source: `BIS${it.policyRateDate ? `, ${it.policyRateDate}` : ''}`, tag: 'official' }
        : undefined;
    case 'cpi':
      return it.cpiInflationPct !== undefined && (it.cpiSource === 'oecd' || it.cpiSource === 'live')
        ? { value: it.cpiInflationPct, source: it.cpiSource === 'oecd' && it.cpiMonth ? `${it.oecdCpi?.short || 'OECD'} monthly, ${formatPeriod(it.cpiMonth)}` : 'IMF WEO, annual', tag: 'live' }
        : undefined;
    case 'debt':
      return it.fiscal?.debtPctGdp ? { value: it.fiscal.debtPctGdp.value, source: `IMF WEO, ${it.fiscal.debtPctGdp.year}`, tag: 'official' } : undefined;
    case 'primary':
      return it.fiscal?.primaryBalancePctGdp ? { value: it.fiscal.primaryBalancePctGdp.value, source: `IMF WEO, ${it.fiscal.primaryBalancePctGdp.year}`, tag: 'official' } : undefined;
    case 'reserves':
      return it.imf?.reserves ? { value: it.imf.reserves.usdBn, source: `IMF, ${formatImfPeriod(it.imf.reserves.period)}`, tag: 'official' } : undefined;
    case 'growth':
      return it.fiscal?.realGrowthPct ? { value: it.fiscal.realGrowthPct.value, source: `IMF WEO, ${it.fiscal.realGrowthPct.year}`, tag: 'official' } : undefined;
  }
}

export interface DocComparison {
  claim: DocClaim;
  app?: { value: number; source: string; tag: 'live' | 'official' };
  /** Document less app, in the measure's tolerance unit (percent for reserves). */
  gap?: number;
  matches?: boolean;
}

export function compareClaims(claims: DocClaim[], it: LiveWatchlistItem): DocComparison[] {
  return claims.map((claim) => {
    const app = appFigure(it, claim.measure);
    if (!app) return { claim };
    const tol = TOLERANCE[claim.measure];
    const gap = claim.measure === 'reserves' ? (app.value ? ((claim.value - app.value) / app.value) * 100 : 0) : claim.value - app.value;
    return { claim, app, gap, matches: Math.abs(gap) <= tol.value + 1e-9 };
  });
}

export const fmtMeasure = (m: DocMeasure, v: number) =>
  m === 'reserves' ? `$${v.toFixed(1)}bn` : m === 'debt' || m === 'primary' ? `${v.toFixed(1)}% of GDP` : m === 'policy' ? `${v.toFixed(2)}%` : `${v.toFixed(1)}%`;
