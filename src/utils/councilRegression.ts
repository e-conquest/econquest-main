/**
 * Council regression set (docs/validation/council-regression/cases.json): fixed agent answers and
 * the reading a good summary must give. Each run goes through the same summary step as Council
 * chat (temperature 0, fixed seed, number checks) and is saved as an answer snapshot, so a failing
 * case can be opened and re-run.
 *
 * `npm run council:regress` runs it against the AI model set in the app (Sam's Ollama referee on
 * the Mac) and compares with the recorded baseline. `npm run council:record` runs it on a private
 * copy of the server and records every model reply (tests/fixtures/council-recorded/), which CI
 * replays: CI then fails when a prompt, template or input change would alter what the real model
 * was asked, when the replayed answers differ from the baseline, or when a structural check fails
 * (docs/validation/council-regression/README.md).
 *
 * Browser-safe: types and the check. The server runs the cases.
 */
import type { AgentAnswer, SynthesisResult } from './askCouncil';
import type { ReviewFrame } from './policyReview';

export interface RegressionExpect {
  /** Pattern (case-insensitive) the headline must match. */
  headline?: string;
  /** Names that must appear somewhere in the answer. */
  mention?: string[];
  /** Pattern (case-insensitive) that must not appear anywhere in the answer. */
  forbid?: string;
  /** Pattern the gaps must match (the answer must say what is missing). */
  gapsMention?: string;
  /** At most this many sentences removed by the number and stance checks. */
  maxRemoved?: number;
  /** kind "options": at least this many usable options. */
  minOptions?: number;
}

/** A frozen input for the Supreme Council's final step: the figures, desk readings and CRO scores. */
export interface SupremeCaseInput {
  iso3: string;
  countryName: string;
  currencyCode?: string;
  /** Each figure by its council path (src/utils/councilInputs.ts); every other figure is MISSING. */
  figures: Array<{ path: string; value: number; source: string }>;
  /** Feed names the figures came from, as the data status records them ("IMF", "BIS"...). */
  feeds: string[];
  /** Each desk's consensus reading, as the desk debates would give it. */
  desks: { geopolitical: string; sovereign: string; macro: string };
  /** The CRO's approved scores (0-1) and notes; scenario shocks left out are MISSING. */
  cro: { geopoliticalRiskScore: number; sovereignRiskScore: number; macroRiskScore: number; croNotes: string };
}

/** A frozen input for the Policy review Options step: the frame and the diagnosis figures. */
export interface OptionsCaseInput {
  frame: ReviewFrame;
  /** Diagnosis figures that are live; every other diagnosis figure is Missing ("not in this test case"). */
  figures: Array<{ field: string; figure: string; value: number; unit: string; period: string; source: string }>;
}

export interface RegressionCase {
  id: string;
  /**
   * Which step it checks: "summary" (Council chat summary, the default), "supreme" (the Supreme
   * Council's final report) or "options" (Policy review step 3), all on the referee model.
   */
  kind?: 'summary' | 'supreme' | 'options';
  question: string;
  answers: AgentAnswer[];
  /** kind "supreme": the frozen input. */
  supreme?: SupremeCaseInput;
  /** kind "options": the frozen input. */
  options?: OptionsCaseInput;
  expect: RegressionExpect;
}

export interface RegressionSet {
  about?: string;
  version: number;
  cases: RegressionCase[];
}

export interface RegressionCaseResult {
  id: string;
  question: string;
  pass: boolean;
  /** Why it failed, in plain words; empty when it passed. */
  failures: string[];
  headline: string;
  removed: number;
  snapshotId?: string;
  /** The model that answered (null when none did). */
  model?: string | null;
  temperature?: number;
  seed?: number;
  /** SHA-256 of the exact system instruction and prompt sent. */
  promptHash?: string;
  /** SHA-256 of the answer as checked (after the number checks). */
  outputHash?: string;
  /** The answer as checked, kept so a baseline shows what the model said. */
  answer?: string[];
}

export interface RegressionReport {
  ranAt: string;
  setVersion: number;
  /** SHA-256 of the case file, so a report names exactly which set it ran. */
  setHash: string;
  model: string | null;
  passed: number;
  total: number;
  results: RegressionCaseResult[];
}

export function parseRegressionSet(raw: unknown): RegressionSet {
  const o = raw as Partial<RegressionSet> | null;
  const cases = (Array.isArray(o?.cases) ? o!.cases : []).filter(
    (c): c is RegressionCase =>
      Boolean(
        c &&
          typeof c.id === 'string' &&
          typeof c.question === 'string' &&
          c.expect &&
          typeof c.expect === 'object' &&
          (c.kind === 'supreme'
            ? Boolean(c.supreme && Array.isArray(c.supreme.figures))
            : c.kind === 'options'
              ? Boolean(c.options && c.options.frame && Array.isArray(c.options.figures))
              : Array.isArray(c.answers))
      )
  ).map((c) => ({ ...c, answers: Array.isArray(c.answers) ? c.answers : [] }));
  return { ...(o?.about ? { about: o.about } : {}), version: Number(o?.version) || 0, cases };
}

const re = (p: string) => new RegExp(p, 'i');

/** The text a case's inputs give, for the structural number check. */
export function caseInputText(c: RegressionCase): string[] {
  const out = [c.question, JSON.stringify(c.answers)];
  if (c.supreme) {
    const { cro } = c.supreme;
    const composite = Number(((cro.geopoliticalRiskScore + cro.sovereignRiskScore + cro.macroRiskScore) / 3).toFixed(2));
    out.push(JSON.stringify(c.supreme), String(composite));
  }
  if (c.options) {
    out.push(JSON.stringify(c.options));
    // The diagnosis works out the real policy rate when both inputs are there (reviewDiagnosis.ts).
    const v = (field: string) => c.options!.figures.find((f) => f.field === field)?.value;
    const rate = v('market.policyRatePct');
    const cpi = v('imf.cpiInflationPct');
    if (rate !== undefined && cpi !== undefined) out.push(String(Math.round((rate - cpi) * 100) / 100));
  }
  return out;
}

/** Checks one summary against what the case expects. */
export function checkRegressionCase(c: RegressionCase, out: SynthesisResult & { optionCount?: number }): RegressionCaseResult {
  const b = out.brief;
  const failures: string[] = [];
  const removed = (out.removed?.length ?? 0) + (out.contradicted?.length ?? 0);
  if (!b) {
    failures.push(`No answer: ${out.reason || 'no AI model answered'}`);
  } else {
    const all = [b.headline, ...b.points, ...b.disagreements, ...b.gaps].join('\n');
    const e = c.expect;
    if (e.headline && !re(e.headline).test(b.headline)) failures.push(`The headline does not give the expected reading (/${e.headline}/): "${b.headline}"`);
    for (const name of e.mention ?? []) if (!all.toLowerCase().includes(name.toLowerCase())) failures.push(`The answer does not mention ${name}.`);
    if (e.forbid) {
      const hit = all.match(re(e.forbid));
      if (hit) failures.push(`The answer says something it must not ("${hit[0]}").`);
    }
    if (e.gapsMention && !re(e.gapsMention).test(b.gaps.join('\n'))) failures.push('The answer does not say what is missing.');
    if (e.minOptions !== undefined && (out.optionCount ?? 0) < e.minOptions) failures.push(`${out.optionCount ?? 0} usable option(s); at least ${e.minOptions} expected.`);
    if (e.maxRemoved !== undefined && removed > e.maxRemoved) failures.push(`${removed} sentence(s) were removed by the checks (at most ${e.maxRemoved} allowed): the model wrote numbers or calls the agents did not give.`);
  }
  return { id: c.id, question: c.question, pass: failures.length === 0, failures, headline: b?.headline || '', removed, ...(out.snapshot ? { snapshotId: out.snapshot.id } : {}) };
}

/** A recorded run (`npm run council:record`): the report plus where and on what it ran. */
export interface RegressionBaseline {
  recordedAt: string;
  /** The referee model the replies came from. */
  model: string;
  /** Ollama's version on the recording machine, when it said. */
  ollamaVersion?: string | null;
  /** The app commit the recording was made on, when git was there. */
  commit?: string | null;
  report: RegressionReport;
}

export interface BaselineComparison {
  /** Differences from the baseline, in plain words; empty when the run matches it exactly. */
  drift: string[];
  /** Cases that passed in the baseline and fail now. */
  newlyFailing: string[];
  /** Cases that already failed in the baseline (known, reported, not new). */
  knownFailing: string[];
}

const short = (t: string) => (t.length > 140 ? `${t.slice(0, 137)}...` : t);

/** The first sentence that differs between two checked answers, in words. */
export function answerDiff(before: string[] | undefined, after: string[] | undefined): string {
  if (!before || !after) return 'The recording does not keep the full answer to compare.';
  const gone = before.find((x) => !after.includes(x));
  const added = after.find((x) => !before.includes(x));
  if (!gone && !added) return 'Same sentences in a different order or list.';
  return [gone ? `Recorded: "${short(gone)}"` : '', added ? `Now: "${short(added)}"` : ''].filter(Boolean).join(' ');
}

/** Compares a run with the recorded baseline, case by case. */
export function compareToBaseline(report: RegressionReport, baseline: RegressionBaseline): BaselineComparison {
  const drift: string[] = [];
  const newlyFailing: string[] = [];
  const knownFailing: string[] = [];
  const was = new Map(baseline.report.results.map((r) => [r.id, r]));
  if (report.setHash !== baseline.report.setHash) drift.push('The case file changed since the recording (cases.json hash differs).');
  for (const r of report.results) {
    const b = was.get(r.id);
    if (!b) {
      drift.push(`${r.id}: new case, not in the recording.`);
      continue;
    }
    if (!b.pass) knownFailing.push(r.id);
    else if (!r.pass) newlyFailing.push(r.id);
    if (b.promptHash && r.promptHash && b.promptHash !== r.promptHash) drift.push(`${r.id}: the prompt sent to the model changed.`);
    if ((r.model ?? null) !== (b.model ?? null)) drift.push(`${r.id}: answered by ${r.model || 'no model'}, recorded on ${b.model || 'no model'}.`);
    if (b.outputHash && r.outputHash !== b.outputHash) {
      if ((b.headline || '') !== (r.headline || '')) drift.push(`${r.id}: the answer changed. Recorded: "${short(b.headline || '(none)')}" Now: "${short(r.headline || '(none)')}"`);
      else drift.push(`${r.id}: same headline, the rest of the answer changed. ${answerDiff(b.answer, r.answer)}`);
    }
  }
  for (const id of was.keys()) if (!report.results.some((r) => r.id === id)) drift.push(`${id}: in the recording, no longer in the case file.`);
  return { drift, newlyFailing, knownFailing };
}

/**
 * Checks every answer must pass whatever the case expects: it names a model, the model is a
 * referee-sized one (not 8B or less), it ran at temperature 0 with a fixed seed, and every number
 * left in the answer is one the case gave (the number checks should have removed the rest).
 */
export function structuralProblems(r: RegressionCaseResult, inputs: string[], isSmall: (tag: string) => boolean): string[] {
  const out: string[] = [];
  if (!r.model) return [`${r.id}: no model answered.`];
  if (isSmall(r.model)) out.push(`${r.id}: ran on ${r.model}, a small model; referee steps need the large referee model.`);
  if (r.temperature !== undefined && r.temperature !== 0) out.push(`${r.id}: ran at temperature ${r.temperature}, not 0.`);
  if (r.seed === undefined || r.seed === null) out.push(`${r.id}: ran without a fixed seed.`);
  for (const line of r.answer ?? []) {
    // Template text leaking through: an unfilled number or field from a built-in report.
    const leak = line.match(/\bNaN\b|\bundefined\b|\[object Object\]/);
    if (leak) out.push(`${r.id}: the answer shows template text ("${leak[0]}" in "${short(line)}").`);
  }
  const allowed = new Set(inputs.join('\n').match(NUMBER) ?? []);
  for (const line of r.answer ?? []) {
    for (const n of line.match(NUMBER) ?? []) {
      if (!allowed.has(n)) out.push(`${r.id}: the answer quotes ${n}, which no input gave ("${short(line)}").`);
    }
  }
  return out;
}

/** Numbers with a decimal point or a % sign: figures, not counts like "two" or list markers. */
const NUMBER = /\d+\.\d+|\d+(?=\s?%)/g;
