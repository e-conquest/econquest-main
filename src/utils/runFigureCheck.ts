/**
 * Number check for the full nine-agent council (Sam, 2026-11-05).
 *
 * Council chat already removes any summary sentence whose numbers do not trace back to an
 * agent's figure. The full council's desk debates, cascade and final report are free text written
 * by an AI model (or, when no model answers, built-in example text), so the same rule applies here:
 * a sentence keeps its place only when every number in it can be found in what the council was
 * given (the figures passed to it, its model scores and your own inputs). Everything removed is
 * kept in a list with where it was, so the screen can say what was taken out.
 */
import type { CouncilAssessmentRun, SupremeCouncilOutput } from '../types/council';

export interface RemovedSentence {
  /** Where in the run, in words, e.g. "Macro desk, round 1 challenger". */
  where: string;
  sentence: string;
}

export interface FigureCheck {
  checkedAt: string;
  /** Sentences kept and removed across the checked fields. */
  kept: number;
  removed: RemovedSentence[];
}

const NUM = /\d+(?:\.\d+)?/g;

/**
 * Labels that carry digits without being figures: agent and stage names (AG-4, Stage 2), tenors
 * (10Y, 5Y, 3M), quarters (Q2), years (2027), and report ids. They are taken out before checking.
 */
const NOT_FIGURES: RegExp[] = [
  /\bAG-\d+\b/gi,
  /\b(?:stage|phase|step|round|tier|layer|pillar)\s+\d+\b/gi,
  /\b\d{1,2}[YM]\b/g,
  /\bQ[1-4]\b/g,
  /\b(?:19|20)\d{2}\b/g,
  /\bSMCR-\d+(?:\.\d+)?\b/gi,
  /\b[A-Z]{2,}\d+[A-Z\d]*\b/g, // series codes such as GGXWDG or MT103
];

export function figuresIn(text: string): string[] {
  let t = text;
  for (const re of NOT_FIGURES) t = t.replace(re, ' ');
  return t.match(NUM) || [];
}

/** Numbers written as a percentage ("62%"), which may be a 0-1 score scaled up. */
function percentFigures(text: string): Set<string> {
  let t = text;
  for (const re of NOT_FIGURES) t = t.replace(re, ' ');
  return new Set([...t.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => m[1]));
}

/** Numbers the council was given, and 0-1 scores scaled to percentages (traced only where "%" is written). */
export interface Allowed {
  plain: number[];
  scaledScores: number[];
}

/** Every number in the texts given to the council, as numbers. */
export function allowedFrom(texts: Array<string | number | undefined | null>): Allowed {
  const set = new Set<number>();
  const scaled = new Set<number>();
  for (const t of texts) {
    if (t === undefined || t === null) continue;
    if (typeof t === 'number') {
      if (Number.isFinite(t)) {
        set.add(t);
        // Scores 0 to 1 are often written as percentages.
        if (Math.abs(t) <= 1) scaled.add(Number((t * 100).toFixed(4)));
      }
      continue;
    }
    for (const n of t.match(NUM) || []) set.add(Number(n));
  }
  return { plain: [...set], scaledScores: [...scaled] };
}

/** A number traces back when a given figure, rounded to the digits written, gives it. */
export function tracesTo(written: string, allowed: number[]): boolean {
  const v = Number(written);
  const d = written.includes('.') ? written.split('.')[1].length : 0;
  const f = 10 ** d;
  return allowed.some((a) => Math.round(a * f) === Math.round(v * f));
}

/** Split prose into sentences, keeping decimals ("4.5%") and abbreviations like "e.g." together. */
export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z("“‘[])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const ALL_REMOVED = 'Removed: every sentence here quoted a figure the council was not given.';

/** Checker over one run: clean(text, where) returns the text with untraceable sentences taken out. */
export function figureChecker(allowed: Allowed) {
  const withPct = [...allowed.plain, ...allowed.scaledScores];
  const removed: RemovedSentence[] = [];
  let kept = 0;
  const clean = (text: string | undefined, where: string): string | undefined => {
    if (typeof text !== 'string' || !text.trim()) return text;
    const out: string[] = [];
    for (const s of sentences(text)) {
      const pct = percentFigures(s);
      if (figuresIn(s).every((n) => tracesTo(n, pct.has(n) ? withPct : allowed.plain))) {
        out.push(s);
        kept++;
      } else removed.push({ where, sentence: s });
    }
    return out.length ? out.join(' ') : ALL_REMOVED;
  };
  const result = (): FigureCheck => ({ checkedAt: new Date().toISOString(), kept, removed });
  return { clean, result };
}

const DESK_NAME: Record<string, string> = { geopolitical: 'Geopolitical desk', sovereign: 'Sovereign desk', macro: 'Macro desk' };

/** The scores the council itself works out; the text may quote them. */
export function runScores(run: CouncilAssessmentRun): number[] {
  const out: number[] = [];
  for (const a of run.subAgents || []) out.push(a.riskScore, a.confidence);
  for (const d of Object.values(run.deskDebates || {})) {
    out.push(d.preCascadeRiskScore, d.postCascadeRiskScore, d.initialRiskSpread);
    for (const r of d.rounds || []) out.push(r.riskScoreAdjustment);
    for (const m of d.minorityDissents || []) out.push(m.agentRiskScore, m.deskConsensusScore, m.divergenceDelta);
  }
  for (const c of run.cascadeSteps || []) {
    out.push(c.priorRiskScore, c.postCascadeRiskScore);
    for (const v of Object.values(c.jsonPatch || {})) if (typeof v === 'number') out.push(v);
  }
  const cro = run.croState as unknown as Record<string, unknown> | undefined;
  for (const v of Object.values(cro || {})) if (typeof v === 'number') out.push(v);
  return out.filter((n) => Number.isFinite(n));
}

/** Phase 1 and 2: desk agents, debates, dissents and cascade. Changes the run in place. */
export function checkDeskText(run: CouncilAssessmentRun, contextTexts: string[]): FigureCheck {
  const { clean, result } = figureChecker(allowedFrom([...contextTexts, ...runScores(run)]));
  for (const a of run.subAgents || []) a.findingsSummary = clean(a.findingsSummary, `${a.agentName}`) ?? a.findingsSummary;
  for (const [id, d] of Object.entries(run.deskDebates || {})) {
    const desk = DESK_NAME[id] || id;
    d.consensusSummary = clean(d.consensusSummary, `${desk}, consensus`) ?? d.consensusSummary;
    (d.rounds || []).forEach((r, i) => {
      r.thesis = clean(r.thesis, `${desk}, round ${i + 1} thesis`) ?? r.thesis;
      r.counterThesis = clean(r.counterThesis, `${desk}, round ${i + 1} challenge`) ?? r.counterThesis;
      r.deskLeadResolution = clean(r.deskLeadResolution, `${desk}, round ${i + 1} resolution`) ?? r.deskLeadResolution;
    });
    for (const m of d.minorityDissents || []) {
      m.coreDissentArgument = clean(m.coreDissentArgument, `${desk}, dissent`) ?? m.coreDissentArgument;
      m.earlyWarningTrigger = clean(m.earlyWarningTrigger, `${desk}, dissent warning sign`) ?? m.earlyWarningTrigger;
      m.falsificationThreshold = clean(m.falsificationThreshold, `${desk}, dissent test`) ?? m.falsificationThreshold;
    }
  }
  (run.cascadeSteps || []).forEach((c, i) => {
    c.shockDelta = clean(c.shockDelta, `Cascade step ${i + 1}, shock`) ?? c.shockDelta;
    c.transmissionMechanism = clean(c.transmissionMechanism, `Cascade step ${i + 1}, how it spreads`) ?? c.transmissionMechanism;
  });
  return result();
}

/** Phase 3: the final report. Returns a checked copy. */
export function checkSupremeText(out: SupremeCouncilOutput, contextTexts: string[], scores: number[]): { output: SupremeCouncilOutput; check: FigureCheck } {
  const { clean, result } = figureChecker(allowedFrom([...contextTexts, ...scores, out.compositeRiskScore]));
  const p = out.policyResearcherReport;
  const m = out.marketTranslationLayer;
  const output: SupremeCouncilOutput = {
    ...out,
    executiveSummary: clean(out.executiveSummary, 'Executive summary') ?? out.executiveSummary,
    policyResearcherReport: {
      ...p,
      structuralVulnerabilities: (p.structuralVulnerabilities || []).map((v, i) => clean(v, `Vulnerability ${i + 1}`) ?? v),
      transmissionPathways: (p.transmissionPathways || []).map((v, i) => clean(v, `Transmission pathway ${i + 1}`) ?? v),
      policyRecommendations: (p.policyRecommendations || []).map((r, i) => ({
        ...r,
        action: clean(r.action, `Policy recommendation ${i + 1}`) ?? r.action,
        expectedImpact: clean(r.expectedImpact, `Policy recommendation ${i + 1}, expected impact`) ?? r.expectedImpact,
      })),
      longTermRegimeOutlook: clean(p.longTermRegimeOutlook, 'Long-term outlook') ?? p.longTermRegimeOutlook,
    },
    marketTranslationLayer: {
      ...m,
      regimeStance: clean(m.regimeStance, 'Regime stance') ?? m.regimeStance,
      tradeExpressions: (m.tradeExpressions || []).map((t, i) => ({
        ...t,
        entryRationale: clean(t.entryRationale, `Trade idea ${i + 1}, rationale`) ?? t.entryRationale,
        invalidationStopTrigger: clean(t.invalidationStopTrigger, `Trade idea ${i + 1}, invalidation`) ?? t.invalidationStopTrigger,
      })),
      riskGuardianCheck: {
        ...m.riskGuardianCheck,
        factorCrowdingWarning: clean(m.riskGuardianCheck.factorCrowdingWarning, 'Crowding warning') ?? m.riskGuardianCheck.factorCrowdingWarning,
      },
    },
  };
  return { output, check: result() };
}
