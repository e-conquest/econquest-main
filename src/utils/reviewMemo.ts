/**
 * Policy review, step 5 "Recommendation memo": written only from the saved steps above (frame,
 * diagnosis, options, evidence) and the principal's choices (which option to recommend, their
 * reasoning, what to watch and when to review). No AI writes it: the same steps and choices always
 * give the same memo, word for word, so its hash is what the sign-off records.
 *
 * Every figure is cited by its diagnosis reference [n], and the references list each one with its
 * source, period and the saved pull it came from. The memo opens by saying it is research, not
 * validated advice, unless every signal the options lean on has passed a pre-registered backtest.
 *
 * Browser-safe.
 */
import type { ReviewFrame, PolicyReview } from './policyReview';
import { figureText, type Diagnosis } from './reviewDiagnosis';
import { LENSES, LENS_LABEL, LEVER_LABEL, type OptionsStep } from './reviewOptions';
import type { EvidenceStep } from './reviewEvidence';

export const MEMO_TEMPLATE_VERSION = 'review-memo-v1';

export interface WatchItem {
  /** What to watch, e.g. "Inflation [1]". */
  indicator: string;
  /** Optional level or move that would change the recommendation. */
  trigger?: string;
}

export interface MemoInputs {
  /** Rank of the option recommended. */
  recommended: number;
  /** The principal's own reasoning, optional. */
  rationale: string;
  watch: WatchItem[];
  /** YYYY-MM-DD: when to look again (step 6). */
  reviewDate: string;
}

export interface MemoSection {
  heading: string;
  lines: string[];
}

export interface MemoStep {
  templateVersion: string;
  inputs: MemoInputs;
  title: string;
  researchOnly: boolean;
  sections: MemoSection[];
  markdown: string;
}

export const RESEARCH_BANNER = 'Research, not validated advice. The signals behind these options have not all passed a pre-registered backtest (Menu > Models & validation). Use it to structure a decision, not to make one.';
export const VALIDATED_BANNER = 'Every signal these options lean on has passed its pre-registered backtest. The ranking of options is still the council\'s judgement on the evidence, not a forecast.';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Checks the principal's choices against the saved options. */
export function parseMemoInputs(v: unknown, options: OptionsStep, asOf: string): { inputs: MemoInputs } | { error: string } {
  const b = (v ?? {}) as Record<string, unknown>;
  const recommended = Math.round(Number(b.recommended));
  if (!options.options.some((o) => o.rank === recommended)) return { error: 'Pick one of the ranked options to recommend.' };
  const reviewDate = typeof b.reviewDate === 'string' ? b.reviewDate.trim() : '';
  if (!DAY.test(reviewDate) || Number.isNaN(Date.parse(`${reviewDate}T00:00:00Z`))) return { error: 'Set a review date (YYYY-MM-DD).' };
  if (reviewDate <= asOf) return { error: 'The review date must be after the As of day.' };
  const watch = (Array.isArray(b.watch) ? b.watch : [])
    .map((w: any) => ({ indicator: typeof w?.indicator === 'string' ? w.indicator.trim().slice(0, 120) : '', trigger: typeof w?.trigger === 'string' ? w.trigger.trim().slice(0, 200) : '' }))
    .filter((w) => w.indicator)
    .slice(0, 8)
    .map((w) => (w.trigger ? w : { indicator: w.indicator }));
  if (!watch.length) return { error: 'Name at least one indicator to watch.' };
  const rationale = typeof b.rationale === 'string' ? b.rationale.trim().slice(0, 3000) : '';
  return { inputs: { recommended, rationale, watch, reviewDate } };
}

/** Defaults for the memo form: top option, the goal indicator to watch, review on the goal date or six months on. */
export function defaultMemoInputs(frame: ReviewFrame, d: Diagnosis, options: OptionsStep): MemoInputs {
  const goal = frame.goal.indicator.toLowerCase();
  const hit = d.figures.find((x) => x.label.toLowerCase().includes(goal) || goal.includes(x.label.toLowerCase().replace(/ \(.*\)$/, '')));
  const t = new Date(`${frame.asOf}T00:00:00Z`);
  t.setUTCMonth(t.getUTCMonth() + 6);
  const sixMonths = t.toISOString().slice(0, 10);
  const by = frame.goal.by ? (frame.goal.by.length === 7 ? `${frame.goal.by}-01` : frame.goal.by) : '';
  return {
    recommended: options.options[0]?.rank ?? 1,
    rationale: '',
    watch: [{ indicator: hit ? `${hit.label} [${hit.ref}]` : frame.goal.indicator, ...(frame.goal.target ? { trigger: `target ${frame.goal.target}` } : {}) }],
    reviewDate: by && by > frame.asOf && by < sixMonths ? by : sixMonths,
  };
}

const short = (h?: string) => (h ? h.slice(0, 12) : 'none');

export function buildMemo(review: Pick<PolicyReview, 'title' | 'steps'>, inputs: MemoInputs): MemoStep {
  const frame = review.steps.frame!.content as ReviewFrame;
  const d = review.steps.diagnose!.content as Diagnosis;
  const o = review.steps.options!.content as OptionsStep;
  const e = review.steps.evidence!.content as EvidenceStep;
  const rec = o.options.find((x) => x.rank === inputs.recommended)!;
  const recEvidence = e.perOption.find((x) => x.rank === rec.rank);
  const sections: MemoSection[] = [];
  const goalText = `${frame.goal.indicator}, ${frame.goal.direction}${frame.goal.target ? `, to ${frame.goal.target}` : ''}${frame.goal.by ? `, by ${frame.goal.by}` : ''}`;

  sections.push({
    heading: 'Purpose',
    lines: [
      ...(frame.audience ? [`For: ${frame.audience}.`] : []),
      `Problem: ${frame.problem}`,
      `Goal: ${goalText}.`,
      `Constraints: ${frame.constraints.length ? frame.constraints.join('; ') : 'none stated'}.`,
      `Data as of ${frame.asOf} (saved pull of ${d.pullDate}${d.incomplete ? ', incomplete' : ''}). ${d.coverage}`,
    ],
  });

  const recLines = [
    `**${rec.title}** (${LEVER_LABEL[rec.lever]}, ranked ${rec.rank} of ${o.options.length}${rec.fromUser ? ', your option' : ''}).`,
    ...(rec.how ? [`How it works: ${rec.how}`] : []),
    ...(rec.effect ? [`Effect on the goal: ${rec.effect}`] : []),
    ...(rec.timeToEffect ? [`Time to effect: ${rec.timeToEffect}`] : []),
    ...(rec.tradeoffs ? [`Trade-offs: ${rec.tradeoffs}`] : []),
    ...(rec.whoBears ? [`Who bears the cost: ${rec.whoBears}`] : []),
    ...(rec.mustBeTrue ? [`What must be true: ${rec.mustBeTrue}`] : []),
    ...(rec.risks ? [`Risks: ${rec.risks}`] : []),
    ...(rec.refs.length ? [`Rests on ${rec.refs.map((n) => `[${n}]`).join(' ')}.`] : []),
  ];
  if (inputs.rationale) recLines.push('', `Reasoning (the principal's own): ${inputs.rationale}`);
  if (!o.model) recLines.push('', 'The council did not assess this option; it is the principal\'s own.');
  sections.push({ heading: 'Recommendation', lines: recLines });

  sections.push({
    heading: 'Diagnosis',
    lines: [
      ...d.figures.map((x) => `- ${x.label}: ${figureText(x)}`),
      ...d.readings.map((r) => `- ${r.label}: ${r.value === null ? r.reason : `${r.value} percentage points. ${r.method}${r.caveat ? ` ${r.caveat}` : ''}`}`),
    ],
  });

  sections.push({
    heading: 'Options considered',
    lines: [
      ...(o.ranking ? [o.ranking, ''] : []),
      ...o.options.map((x) => `- ${x.rank}. ${x.title} (${LEVER_LABEL[x.lever]}${x.fromUser ? ', your option' : ''})${x.tradeoffs ? `. Trade-offs: ${x.tradeoffs}` : ''}${x.whoBears ? ` Who bears the cost: ${x.whoBears}` : ''}`),
      ...LENSES.filter((l) => rec.views[l]).map((l) => `- ${LENS_LABEL[l]} Agent on the recommendation: ${rec.views[l]}`),
    ],
  });

  const ran = e.analyses.filter((a) => recEvidence?.analyses.includes(a.id));
  sections.push({
    heading: 'Evidence',
    lines: [
      recEvidence?.note || 'No evidence pack entry for this option.',
      ...ran.flatMap((a) => a.tests.filter((t) => !/^Not run/.test(t.reading)).map((t) => `- ${a.title}, ${t.title.toLowerCase()}: ${t.reading}${t.caution ? ` (${t.caution})` : ''}`)),
      ...(e.episodes.items.length
        ? [`- Past episodes: ${e.episodes.items.length} policy-rate moves at least a year before ${frame.asOf} (${e.episodes.items.map((x) => `${x.date} ${x.action} to ${x.toPct}%${x.changePts !== undefined ? `, inflation ${x.changePts >= 0 ? '+' : ''}${x.changePts} pts a year later` : ''}`).join('; ')}). What followed a move is not what it caused.`]
        : [`- Past episodes: Missing (${e.episodes.missing || 'none found'}).`]),
      ...e.signals.map((s) => `- ${s.name}: ${s.statusLabel}${s.verdict ? `. ${s.verdict}` : ''}`),
    ],
  });

  sections.push({
    heading: 'What to watch and when to review',
    lines: [...inputs.watch.map((w) => `- ${w.indicator}${w.trigger ? `: ${w.trigger}` : ''}`), `Review on ${inputs.reviewDate}: Track outcomes sets what happened beside these figures.`],
  });

  const gaps = [...new Set([...d.figures.filter((x) => x.value === null).map((x) => `${x.label} [${x.ref}] Missing: ${x.reason}`), ...o.gaps, ...e.analyses.flatMap((a) => a.missing)])];
  sections.push({ heading: 'Gaps', lines: gaps.length ? gaps.map((g) => `- ${g}`) : ['None recorded.'] });

  sections.push({
    heading: 'Method and reproducibility',
    lines: [
      `Policy review ${review.title}. Templates: options ${o.templateVersion}, evidence ${e.templateVersion}, memo ${MEMO_TEMPLATE_VERSION}.`,
      o.model ? `Options written by ${o.model} at temperature ${o.temperature}; prompt hash ${short(o.promptHash)}. Sentences with numbers not in the diagnosis removed: ${o.removed.length}.` : 'Options entered by the principal; no AI model used.',
      `Step hashes: frame ${short(review.steps.frame?.hash)}, diagnose ${short(review.steps.diagnose?.hash)}, options ${short(review.steps.options?.hash)}, evidence ${short(review.steps.evidence?.hash)}.`,
      'This memo is assembled from those saved steps and the choices above, with no AI; the same steps give the same memo.',
    ],
  });

  sections.push({
    heading: 'References',
    lines: d.figures.map((x) => `[${x.ref}] ${x.label}: ${x.value === null ? `Missing (${x.reason})` : `${x.value}${x.unit === '%' ? '%' : ` ${x.unit}`}, ${x.source}${x.period ? `, ${x.period}` : ''}`}; app pull of ${d.pullDate}.`),
  });

  const title = `Policy memo: ${review.title}`;
  const md = [`# ${title}`, '', `> ${e.researchOnly ? RESEARCH_BANNER : VALIDATED_BANNER}`, ''];
  for (const s of sections) md.push(`## ${s.heading}`, '', ...s.lines, '');
  return { templateVersion: MEMO_TEMPLATE_VERSION, inputs, title, researchOnly: e.researchOnly, sections, markdown: md.join('\n') };
}

export function memoFileName(memo: MemoStep, ext: 'md' | 'pdf'): string {
  return `${memo.title.replace(/^Policy memo: /, 'policy-memo-').replace(/[^A-Za-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/-$/, '').slice(0, 90)}.${ext}`;
}
