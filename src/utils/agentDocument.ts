/**
 * Standard documents for Council chat (Sam, 2026-11-05).
 *
 * Every agent's answer is written up in the same fixed template, so the answers can be read side
 * by side and the synthesis agent reads one shape whatever the agent:
 *
 *   1. Question       what was asked, when, about which countries
 *   2. Why asked      why this agent was picked
 *   3. What it covers the agent's remit and method
 *   4. Findings       per country: the reading, the agent's call in fixed words, every figure with
 *                     its tag (Live data, Official, Your document, or the agent's own rule) and source
 *   5. Missing        what the agent could not answer, and why
 *   6. Coverage       how many countries answered and what the figures rest on, by a stated rule
 *   7. Sources        each source once, numbered
 *
 * The synthesis document has its own fixed template (answer, disagreements, gaps, the agent
 * documents it read, the checks on its sentences, sources, method). Nothing here adds a figure:
 * every value comes from an agent's answer, and a missing figure stays missing with its reason.
 *
 * Browser-safe.
 */
import type { ChartResult } from './councilChart';
import { FORECAST_AGENT_COVERS } from './forecastAgent';
import { CLAIM_AGENT_COVERS } from './claimCheck';
import { isCitable, References, type Reference } from './citations';
import { COUNCIL_AGENTS, isDocFinding, tagLabel, type AgentAnswer, type AgentId, type FigureTag, type SynthesisResult } from './askCouncil';
import { DIM_LABEL } from './stanceCheck';
import { withNotice } from './disclaimer';

export const DOC_TEMPLATE_VERSION = 1;

export const AGENT_DOC_SECTIONS = ['Question', 'Why asked', 'What it covers', 'Findings', 'Missing data', 'Coverage', 'Sources'] as const;
export const SYNTHESIS_DOC_SECTIONS = ['Question', 'Answer', 'Where the agents disagree', 'Gaps', 'Agent documents read', 'Checks', 'Sources', 'Method'] as const;

export interface DocFigure {
  label: string;
  value: string;
  tag: FigureTag;
  /** Tag in words: Live data, Official, Your document, or "<Agent> Agent" for a stated rule. */
  tagText: string;
  source: string;
  /** Reference number in Sources; absent for a rule reading (its method is the source text). */
  ref?: number;
}

export interface DocFinding {
  iso3: string;
  subject: string;
  reading: string;
  calls: string[];
  figures: DocFigure[];
}

export type CoverageLevel = 'full' | 'partial' | 'none';

export interface DocCoverage {
  level: CoverageLevel;
  /** Countries in the question's scope (0 for the Policy Document Agent, which reads your files). */
  countriesAsked: number;
  countriesAnswered: number;
  figures: number;
  byTag: { live: number; official: number; document: number; rule: number };
  gaps: number;
  /** The rule and the counts in one sentence. */
  line: string;
}

export interface AgentDocument {
  kind: 'agent';
  version: number;
  id: string;
  agentId: AgentId;
  agentName: string;
  title: string;
  question: string;
  askedAt: string;
  scope: string;
  whyAsked: string;
  covers: string;
  findings: DocFinding[];
  missing: string[];
  coverage: DocCoverage;
  sources: Reference[];
  /** The Chart Agent's chart, kept with its document so Reports can draw it again. */
  chart?: ChartResult;
}

export interface SynthesisDocument {
  kind: 'synthesis';
  version: number;
  id: string;
  title: string;
  question: string;
  askedAt: string;
  scope: string;
  /** 'written' when a model answered and its sentences passed the checks; otherwise why not. */
  status: 'written' | 'not written';
  writtenBy?: string;
  reason?: string;
  headline: string;
  points: string[];
  disagreements: string[];
  gaps: string[];
  agents: Array<{ docId: string; agentName: string; findings: number; coverage: CoverageLevel }>;
  removed: string[];
  contradicted: Array<{ sentence: string; reason: string }>;
  sources: Reference[];
}

export type CouncilDocument = AgentDocument | SynthesisDocument;

export interface DocContext {
  question: string;
  askedAt: string;
  scope: string;
  /** Countries in scope, for coverage. */
  countriesAsked: number;
}

const stamp = (askedAt: string) => askedAt.replace(/[^0-9]/g, '').slice(0, 17);
export const agentDocId = (agentId: AgentId, askedAt: string) => `doc-${agentId}-${stamp(askedAt)}`;
export const synthesisDocId = (askedAt: string) => `doc-synthesis-${stamp(askedAt)}`;

const DOC_AGENT_COVERS = 'passages from documents you added that match the question, and each figure a document states checked against the app’s figure for the same country';

const CHART_AGENT_COVERS = 'charts the series the question names from the app’s own history, on their common frequency, and runs the statistical tests asked for (correlation, regression, lead/lag, Granger, ADF, HP filter, rolling correlation, and the econometrics lab: Newey-West errors, VAR impulse responses, local projections, Johansen cointegration, Chow and Bai-Perron breaks)';

export function agentCovers(id: AgentId): string {
  if (id === 'chart') return CHART_AGENT_COVERS;
  if (id === 'forecast') return FORECAST_AGENT_COVERS;
  if (id === 'claim') return CLAIM_AGENT_COVERS;
  return id === 'doc' ? DOC_AGENT_COVERS : COUNCIL_AGENTS[id]?.covers || '';
}

/**
 * Coverage by a stated rule, not a model's confidence: full when every country in scope has a
 * finding and nothing is missing; none when there is no finding; partial otherwise.
 */
export function coverageOf(a: AgentAnswer, countriesAsked: number): DocCoverage {
  const doc = a.id === 'doc';
  const answered = doc ? 0 : new Set(a.findings.filter((f) => !isDocFinding(f)).map((f) => f.iso3)).size;
  const figs = a.findings.flatMap((f) => f.figures);
  const byTag = {
    live: figs.filter((g) => g.tag === 'live').length,
    official: figs.filter((g) => g.tag === 'official').length,
    document: figs.filter((g) => g.tag === 'document').length,
    rule: figs.filter((g) => g.tag === 'model').length,
  };
  const asked = doc ? 0 : countriesAsked;
  const level: CoverageLevel = !a.findings.length ? 'none' : (doc || answered >= asked) && !a.missing.length ? 'full' : 'partial';
  const scope = doc
    ? `${a.findings.length} ${a.findings.length === 1 ? 'passage or check' : 'passages and checks'} from your documents`
    : `${answered} of ${asked} ${asked === 1 ? 'country' : 'countries'} answered`;
  const tags = [
    byTag.live && `${byTag.live} live`,
    byTag.official && `${byTag.official} official`,
    byTag.document && `${byTag.document} from your documents`,
    byTag.rule && `${byTag.rule} by the agent’s stated rules`,
  ].filter(Boolean);
  const line =
    `${level === 'full' ? 'Full' : level === 'partial' ? 'Partial' : 'None'}: ${scope}; ` +
    `${figs.length} ${figs.length === 1 ? 'figure' : 'figures'}${tags.length ? ` (${tags.join(', ')})` : ''}; ` +
    `${a.missing.length} ${a.missing.length === 1 ? 'gap' : 'gaps'}. ` +
    'Rule: full when every country in scope has a finding and nothing is missing, none when there is no finding, partial otherwise.';
  return { level, countriesAsked: asked, countriesAnswered: answered, figures: figs.length, byTag, gaps: a.missing.length, line };
}

/** One agent's answer in the standard template. */
export function toAgentDocument(a: AgentAnswer, ctx: DocContext): AgentDocument {
  const refs = new References();
  const findings: DocFinding[] = a.findings.map((f) => ({
    iso3: f.iso3,
    subject: f.countryName,
    reading: f.reading,
    calls: (f.stance || []).map((s) => `${DIM_LABEL[s.dim]}: ${s.call}`),
    figures: f.figures.map((g) => ({
      label: g.label,
      value: g.value,
      tag: g.tag,
      tagText: tagLabel(g.tag, a.name),
      source: g.source,
      ...(isCitable(g.source, g.tag) ? { ref: refs.cite(g.source) } : {}),
    })),
  }));
  return {
    kind: 'agent',
    version: DOC_TEMPLATE_VERSION,
    id: agentDocId(a.id, ctx.askedAt),
    agentId: a.id,
    agentName: a.name,
    title: `${a.name} Agent: ${ctx.question}`.slice(0, 200),
    question: ctx.question,
    askedAt: ctx.askedAt,
    scope: ctx.scope,
    whyAsked: a.why,
    covers: agentCovers(a.id),
    findings,
    missing: [...a.missing],
    coverage: coverageOf(a, ctx.countriesAsked),
    sources: refs.list,
    ...(a.chart ? { chart: a.chart } : {}),
  };
}

export function toAgentDocuments(answers: AgentAnswer[], ctx: DocContext): AgentDocument[] {
  return answers.map((a) => toAgentDocument(a, ctx));
}

/** The synthesis agent's answer in its standard template, built from the agent documents it read. */
export function toSynthesisDocument(docs: AgentDocument[], synthesis: SynthesisResult | null, ctx: DocContext): SynthesisDocument {
  const b = synthesis?.brief;
  const written = Boolean(b && (b.headline || b.points.length));
  const refs = new References();
  for (const d of docs) for (const r of d.sources) refs.cite(r.source);
  const agentGaps = docs.flatMap((d) => d.missing.map((m) => `${d.agentName} Agent: ${m}`));
  return {
    kind: 'synthesis',
    version: DOC_TEMPLATE_VERSION,
    id: synthesisDocId(ctx.askedAt),
    title: `Synthesis: ${ctx.question}`.slice(0, 200),
    question: ctx.question,
    askedAt: ctx.askedAt,
    scope: ctx.scope,
    status: written ? 'written' : 'not written',
    ...(written && synthesis?.provider ? { writtenBy: synthesis.provider } : {}),
    ...(!written ? { reason: synthesis?.reason || (synthesis ? 'No sentence passed the checks.' : 'The synthesis agent has not answered yet.') } : {}),
    headline: b?.headline || '',
    points: b?.points || [],
    disagreements: b?.disagreements || [],
    gaps: [...(b?.gaps || []), ...agentGaps],
    agents: docs.map((d) => ({ docId: d.id, agentName: d.agentName, findings: d.findings.length, coverage: d.coverage.level })),
    removed: synthesis?.removed || [],
    contradicted: (synthesis?.contradicted || []).map((c) => ({ sentence: c.sentence, reason: c.reason })),
    sources: refs.list,
  };
}

const when = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;
const sourceLines = (refs: Reference[], askedAt: string) => {
  const day = askedAt.slice(0, 10);
  return refs.map((r) => `[${r.n}] ${r.source}.${r.url ? ` ${r.url}` : ''}${day ? ` Read by the app on ${day}.` : ''}`);
};

/** The agent document as sections, in the fixed order, for the screen, Markdown and Reports. */
export function agentDocSections(d: AgentDocument): Array<{ heading: string; lines: string[] }> {
  const findings: string[] = [];
  for (const f of d.findings) {
    if (findings.length) findings.push('');
    findings.push(`**${f.subject}**: ${f.reading}`);
    for (const c of f.calls) findings.push(`- Call on ${c}`);
    for (const g of f.figures) findings.push(`- ${g.label}: ${g.value} (${g.tagText}${g.ref ? `) [${g.ref}]` : `; ${g.source})`}`);
  }
  return [
    { heading: 'Question', lines: [d.question, `Asked ${when(d.askedAt)} about ${d.scope}.`] },
    { heading: 'Why asked', lines: [`Asked because ${d.whyAsked}.`] },
    { heading: 'What it covers', lines: [d.covers ? `${d.covers[0].toUpperCase()}${d.covers.slice(1)}.` : 'Not stated.'] },
    { heading: 'Findings', lines: findings.length ? findings : ['No reading from the figures on hand.'] },
    { heading: 'Missing data', lines: d.missing.length ? d.missing.map((m) => `- ${m}`) : ['Nothing reported missing.'] },
    { heading: 'Coverage', lines: [d.coverage.line] },
    { heading: 'Sources', lines: d.sources.length ? sourceLines(d.sources, d.askedAt) : ['No outside source: every figure here is the agent’s stated rule or your own document.'] },
  ];
}

export function synthesisDocSections(d: SynthesisDocument): Array<{ heading: string; lines: string[] }> {
  const checks = [
    ...(d.status === 'written' ? [`Every number had to trace back to an agent document, and no sentence could describe an agent’s call in an opposing word.`] : []),
    ...(d.removed.length ? [`${d.removed.length} sentence(s) removed because a number did not trace back:`, ...d.removed.map((r) => `- ${r}`)] : []),
    ...(d.contradicted.length ? [`${d.contradicted.length} sentence(s) removed because they contradicted an agent’s call:`, ...d.contradicted.map((c) => `- “${c.sentence}” ${c.reason}`)] : []),
  ];
  return [
    { heading: 'Question', lines: [d.question, `Asked ${when(d.askedAt)} about ${d.scope}.`] },
    {
      heading: 'Answer',
      lines:
        d.status === 'written'
          ? [...(d.headline ? [`**${d.headline}**`] : []), ...d.points.map((p) => `- ${p}`), `Written by the synthesis agent (${d.writtenBy || 'AI model'}) from the agent documents only.`]
          : [`Not written. ${d.reason || ''} The agent documents stand on their own.`.trim()],
    },
    { heading: 'Where the agents disagree', lines: d.disagreements.length ? d.disagreements.map((x) => `- ${x}`) : [d.status === 'written' ? 'The synthesis agent found no disagreement.' : 'Not assessed.'] },
    { heading: 'Gaps', lines: d.gaps.length ? d.gaps.map((g) => `- ${g}`) : ['Nothing reported missing.'] },
    { heading: 'Agent documents read', lines: d.agents.map((a) => `- ${a.agentName} Agent: ${a.findings} ${a.findings === 1 ? 'finding' : 'findings'}, coverage ${a.coverage}`) },
    { heading: 'Checks', lines: checks.length ? checks : ['No AI sentences to check.'] },
    { heading: 'Sources', lines: d.sources.length ? sourceLines(d.sources, d.askedAt) : ['No outside source.'] },
    { heading: 'Method', lines: ['Each agent answered only from figures the app holds; built-in figures and AI estimates are never used, and a missing figure says why. The synthesis agent read only the agent documents listed above.', 'For discussion. Not investment advice.'] },
  ];
}

export function documentSections(d: CouncilDocument) {
  return d.kind === 'agent' ? agentDocSections(d) : synthesisDocSections(d);
}

export function documentMarkdown(d: CouncilDocument): string {
  const out = [`# ${d.kind === 'agent' ? `${d.agentName} Agent` : 'Synthesis'}`, '', `Standard council document, template v${d.version}.`, ''];
  for (const s of documentSections(d)) out.push(`## ${s.heading}`, '', ...s.lines, '');
  return withNotice(out.join('\n'));
}

/**
 * What the synthesis agent reads: every agent document in the same template, one after another.
 * Rule readings keep their method beside them; sourced figures keep their source.
 */
export function documentsAsText(docs: AgentDocument[]): string {
  if (!docs.length) return '';
  const lines = [`Question: ${docs[0].question}`, `Scope: ${docs[0].scope}`, '', `You have ${docs.length} standard agent ${docs.length === 1 ? 'document' : 'documents'}.`, ''];
  docs.forEach((d, i) => {
    lines.push(`=== Document ${i + 1}: ${d.agentName} Agent ===`, `Why asked: ${d.whyAsked}`, `What it covers: ${d.covers}`, 'Findings:');
    if (!d.findings.length) lines.push('- none');
    for (const f of d.findings) {
      lines.push(`- ${f.subject}: ${f.reading}`);
      for (const c of f.calls) lines.push(`  - Call on ${c}`);
      for (const g of f.figures) lines.push(`  - ${g.label}: ${g.value} [${g.tagText}; ${g.source}]`);
    }
    lines.push('Missing data:', ...(d.missing.length ? d.missing.map((m) => `- ${m}`) : ['- none']));
    lines.push(`Coverage: ${d.coverage.level}`, '');
  });
  return lines.join('\n');
}

/** Light shape check for documents read back from disk or sent to the server. */
export function isCouncilDocument(v: unknown): v is CouncilDocument {
  const d = v as CouncilDocument;
  return Boolean(
    d &&
      typeof d === 'object' &&
      (d.kind === 'agent' || d.kind === 'synthesis') &&
      typeof d.id === 'string' &&
      /^doc-[a-z]+-\d+$/.test(d.id) &&
      typeof d.question === 'string' &&
      typeof d.askedAt === 'string' &&
      Array.isArray(d.sources) &&
      (d.kind === 'agent' ? Array.isArray(d.findings) && Array.isArray(d.missing) : Array.isArray(d.points) && Array.isArray(d.agents))
  );
}

