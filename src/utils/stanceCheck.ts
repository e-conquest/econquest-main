/**
 * Stance check for the council summary (Sam, 2026-11-05).
 *
 * Each agent states its call in fixed words: policy tight / neutral / loose (Central Bank Watcher),
 * CDS cheap / in line / rich against risk peers (Relative Value), and the real exchange rate strong /
 * near average / weak against its own history (FX Valuation). A summary sentence about one country
 * that describes the same thing in an opposing word is removed and shown with the agent's call, so
 * the synthesis cannot contradict an agent. The number check catches invented figures; this catches
 * wrong words about real ones.
 */

export type StanceDim = 'policy' | 'cds' | 'fx';
export type PolicyCall = 'tight' | 'neutral' | 'loose';
export type CdsCall = 'cheap' | 'in line' | 'rich';
export type FxCall = 'strong' | 'near average' | 'weak';

export interface Stance {
  dim: StanceDim;
  call: PolicyCall | CdsCall | FxCall;
}

export const DIM_LABEL: Record<StanceDim, string> = {
  policy: 'monetary policy',
  cds: '5Y CDS against risk peers',
  fx: 'the real exchange rate against its history',
};

/** The call behind the Central Bank Watcher's wording (see marketsMacro.policyStance). */
export function policyCall(stanceText: string): PolicyCall {
  const t = stanceText.toLowerCase();
  if (t.startsWith('tight') || t.startsWith('a high real rate')) return 'tight';
  if (t.startsWith('loose') || t.startsWith('a negative real rate')) return 'loose';
  return 'neutral';
}

/** What a sentence must be about for each check to apply. */
const TOPIC: Record<StanceDim, RegExp> = {
  policy: /\b(policy|monetary|central bank|policy rate|real rates?|interest rates?)\b/i,
  cds: /\b(cds|credit default|spreads?|credit)\b/i,
  fx: /\b(currency|currencies|exchange rate|reer|fx|lira|rand|peso|rupiah|zloty)\b/i,
};

/** Words that state each call. Only adjectives: "easing" or "room to cut" describe a move, not a stance. */
const WORDS: Record<StanceDim, Record<string, RegExp>> = {
  policy: {
    tight: /\b(tight|restrictive|hawkish)\b/gi,
    neutral: /\b(neutral)\b/gi,
    loose: /\b(loose|accommodative|dovish|easy (?:policy|money|monetary))\b/gi,
  },
  cds: {
    cheap: /\b(cheap|cheaply priced|undervalued)\b/gi,
    'in line': /\b(in line with (?:its |their )?(?:risk )?peers|fairly priced)\b/gi,
    rich: /\b(rich|richly priced|expensive|overvalued)\b/gi,
  },
  fx: {
    strong: /\b(strong|overvalued|expensive)\b/gi,
    'near average': /\b(near (?:its )?(?:10-year |ten-year )?average|fairly valued)\b/gi,
    weak: /\b(weak|undervalued|cheap)\b/gi,
  },
};

/** "not tight", "no longer loose", "isn't cheap" agree rather than contradict. */
const NEGATED = /(?:\bnot|\bno longer|n't|\bneither|\bnor|\bhardly)\s+(?:very\s+|particularly\s+|that\s+)?$/i;

/** The calls a sentence makes on one dimension, ignoring negated words. */
export function callsIn(sentence: string, dim: StanceDim): string[] {
  if (!TOPIC[dim].test(sentence)) return [];
  const out = new Set<string>();
  for (const [call, re] of Object.entries(WORDS[dim])) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sentence))) {
      if (!NEGATED.test(sentence.slice(Math.max(0, m.index - 24), m.index))) out.add(call);
    }
  }
  return [...out];
}

export interface StancedFinding {
  iso3: string;
  countryName: string;
  agent: string;
  stance: Stance[];
}

export interface Contradiction {
  sentence: string;
  reason: string;
}

const ALIASES: Record<string, string[]> = {
  TUR: ['turkiye', 'türkiye', 'turkish'],
  GBR: ['uk', 'britain', 'united kingdom', 'british'],
  ZAF: ['south africa', 'south african'],
  USA: ['us', 'united states', 'america', 'american'],
  BRA: ['brazilian'],
  MEX: ['mexican'],
  EGY: ['egyptian'],
  IDN: ['indonesian'],
  POL: ['polish'],
};
const baseName = (n: string) => n.replace(/\s*\(.*\)\s*$/, '').trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function mentions(sentence: string, f: { iso3: string; countryName: string }): boolean {
  const names = [baseName(f.countryName), f.iso3, ...(ALIASES[f.iso3] || [])];
  return names.some((n) => new RegExp(`\\b${esc(n)}\\b`, 'i').test(sentence));
}

/**
 * The first contradiction in a sentence, if any. A sentence is checked against a country's calls
 * when it names that country, or when only one country has a call on that dimension. Sentences that
 * name two or more countries with calls are left alone: which word belongs to which is unclear.
 */
export function contradiction(sentence: string, findings: StancedFinding[]): Contradiction | undefined {
  const named = findings.filter((f) => mentions(sentence, f));
  const namedCountries = new Set(named.map((f) => f.iso3));
  for (const dim of ['policy', 'cds', 'fx'] as StanceDim[]) {
    const withCall = findings.filter((f) => f.stance.some((s) => s.dim === dim));
    const countriesWithCall = new Set(withCall.map((f) => f.iso3));
    let target: StancedFinding | undefined;
    if (namedCountries.size === 1) target = withCall.find((f) => namedCountries.has(f.iso3));
    else if (namedCountries.size === 0 && countriesWithCall.size === 1) target = withCall[0];
    if (!target) continue;
    const call = target.stance.find((s) => s.dim === dim)!.call;
    const said = callsIn(sentence, dim);
    const wrong = said.filter((c) => c !== call);
    if (wrong.length && !said.includes(call)) {
      return {
        sentence,
        reason: `It calls ${baseName(target.countryName)}'s ${DIM_LABEL[dim]} ${wrong.join(' or ')}; the ${target.agent} Agent reads it as ${call}.`,
      };
    }
  }
  return undefined;
}
