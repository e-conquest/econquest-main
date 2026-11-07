/**
 * Answer snapshots (Sam, 2026-11-05): every Council chat answer is pinned to exactly what produced
 * it, so it can be traced and run again later with a record of why it differs.
 *
 * A snapshot holds:
 *  - the inputs: the question, the earlier questions of the conversation, the scope, the agents'
 *    answers with every figure (value, source, period) as the summary read them, explain-mode
 *    lenses, the time the question was asked and the data date (As of) the figures come from;
 *  - the settings: AI model, temperature, seed, and a hash of the instructions and of the exact
 *    prompt sent;
 *  - the output: what the model wrote after the number checks, and who wrote it.
 * Inputs and output are hashed separately (SHA-256 of canonical JSON), so a re-run on the same
 * snapshot can say whether the model, the instructions or only the wording changed.
 *
 * Browser-safe: types, constants and plain-word helpers. Hashing and the files are in
 * answerSnapshotStore.ts (server only).
 */
import type { AgentAnswer, CouncilBrief } from './askCouncil';
import type { ExplainPlan } from './explain';

export const SNAPSHOT_VERSION = 1;

/**
 * The summary and explanations run at temperature 0 with a fixed seed, so the same snapshot gives
 * the same answer as closely as the model allows (exactly, on the same Ollama model and machine).
 */
export const COUNCIL_TEMPERATURE = 0;
export const COUNCIL_SEED = 42;

export interface SnapshotFigure {
  iso3: string;
  agent: string;
  label: string;
  value: string;
  /** Source as the agent showed it, with the period (e.g. "IMF IL, Sep 2026"). */
  source: string;
  tag: string;
}

export interface SnapshotDocument {
  docId: string;
  agent: string;
  /** Template version of the standard agent document. */
  version: number;
  /** SHA-256 of the whole document, so a re-run can say which agent's document changed. */
  hash: string;
  figures: number;
}

export interface SnapshotInputs {
  question: string;
  scope?: string;
  countries?: number;
  earlier: Array<{ question: string; headline?: string }>;
  explain?: ExplainPlan;
  /** When the question was asked; it is part of the documents the model reads. */
  askedAt: string;
  /** The data date the figures come from: a locked As of day (YYYY-MM-DD), or null for the latest pull. */
  asOf: string | null;
  /** Set when the conversation was pinned to its figures: the time they were pinned (ISO). */
  dataPinnedAt?: string;
  /** The agents' answers exactly as the summary read them. */
  answers: AgentAnswer[];
}

export interface SnapshotSettings {
  step: 'COUNCIL_SYNTHESIS';
  mode: 'summary' | 'explain';
  /** Provider asked for in Settings (ollama, gemini, hybrid...). */
  providerMode: string;
  /** The model that answered, e.g. "qwen2.5:32b"; null when none answered. */
  model: string | null;
  temperature: number;
  seed: number;
  /** SHA-256 of the instructions and the task wording, without the documents: changes when the app's prompt changes. */
  templateHash: string;
  /** SHA-256 of the exact system instruction and prompt sent. */
  promptHash: string;
}

export interface SnapshotOutput {
  /** Who wrote the text, as shown under the answer ("Local Ollama (qwen2.5:32b · Referee)"). */
  provider: string | null;
  brief: CouncilBrief | null;
  removed: number;
  contradicted: number;
  reason?: string;
}

export interface AnswerSnapshot {
  version: number;
  id: string;
  createdAt: string;
  /** Where it was asked: "Council chat", "Morning brief (scheduled)", or "Re-run of <id>". */
  via: string;
  /** Set on a re-run: the snapshot it replayed. */
  rerunOf?: string;
  inputs: SnapshotInputs;
  settings: SnapshotSettings;
  output: SnapshotOutput;
  /** Every figure the agents used, flattened for display and the audit log. */
  figures: SnapshotFigure[];
  /** Each agent's standard document (agentDocument.ts) as the summary read it: template version and hash. */
  documents: SnapshotDocument[];
  inputsHash: string;
  outputHash: string;
}

/** What the page gets back with an answer: enough to show the drill-down and ask for a re-run. */
export interface SnapshotSummary {
  id: string;
  createdAt: string;
  inputsHash: string;
  outputHash: string;
  promptHash: string;
  templateHash: string;
  model: string | null;
  temperature: number;
  seed: number;
  askedAt: string;
  asOf: string | null;
  dataPinnedAt?: string;
  agents: string[];
  figures: SnapshotFigure[];
  documents: SnapshotDocument[];
  rerunOf?: string;
}

export function summariseSnapshot(s: AnswerSnapshot): SnapshotSummary {
  return {
    id: s.id,
    createdAt: s.createdAt,
    inputsHash: s.inputsHash,
    outputHash: s.outputHash,
    promptHash: s.settings.promptHash,
    templateHash: s.settings.templateHash,
    model: s.settings.model,
    temperature: s.settings.temperature,
    seed: s.settings.seed,
    askedAt: s.inputs.askedAt,
    asOf: s.inputs.asOf,
    ...(s.inputs.dataPinnedAt ? { dataPinnedAt: s.inputs.dataPinnedAt } : {}),
    agents: s.inputs.answers.map((a) => a.name),
    figures: s.figures,
    documents: s.documents ?? [],
    ...(s.rerunOf ? { rerunOf: s.rerunOf } : {}),
  };
}

/** The figures agents used, flattened (same shape as the audit log's). */
export function snapshotFigures(answers: AgentAnswer[], max = 400): SnapshotFigure[] {
  const out: SnapshotFigure[] = [];
  for (const a of answers) {
    for (const f of a?.findings ?? []) {
      for (const g of f?.figures ?? []) {
        if (out.length >= max) return out;
        out.push({
          iso3: String(f?.iso3 ?? '').slice(0, 8),
          agent: String(a?.name ?? '').slice(0, 60),
          label: String(g?.label ?? '').slice(0, 120),
          value: String(g?.value ?? '').slice(0, 60),
          source: String(g?.source ?? '').slice(0, 240),
          tag: String(g?.tag ?? '').slice(0, 20),
        });
      }
    }
  }
  return out;
}

/** "a1b2c3d4" for showing a hash; the full hash stays in the file. */
export const shortHash = (h: string | undefined | null) => String(h || '').slice(0, 8);

/** The model tag from a provider line: "Local Ollama (qwen2.5:32b · Referee)" -> "qwen2.5:32b". */
export function modelFromProvider(provider: string | undefined | null): string | null {
  const m = /\(([^\s·)]+)/.exec(provider || '');
  return m ? m[1] : null;
}

/** A snapshot id: time it was made plus the start of its inputs hash, safe as a file name. */
export function snapshotId(createdAt: string, inputsHash: string): string {
  return `s${createdAt.replace(/[^0-9]/g, '').slice(0, 17)}-${inputsHash.slice(0, 12)}`;
}

export const isSnapshotId = (v: unknown): v is string => typeof v === 'string' && /^s\d{8,17}-[0-9a-f]{12}$/.test(v);

/* ------------------------------------------------------------------------------------------
 * Comparing two runs: a re-run on the same snapshot, or a later answer to the same question.
 * ------------------------------------------------------------------------------------------ */

export interface RunSide {
  snapshot: SnapshotSummary;
  brief: CouncilBrief | null;
  provider?: string | null;
}

export interface FigureChange {
  iso3: string;
  label: string;
  agent: string;
  before: string | null;
  after: string | null;
  beforeSource?: string;
  afterSource?: string;
}

export interface RunComparison {
  /** True when the written answer is word for word the same. */
  sameAnswer: boolean;
  sameInputs: boolean;
  samePrompt: boolean;
  sameInstructions: boolean;
  sameModel: boolean;
  sameSampling: boolean;
  /** Agents whose standard document differs (by hash), or that are in only one run. */
  documentsChanged: string[];
  figuresChanged: FigureChange[];
  headlineChanged: boolean;
  pointsAdded: string[];
  pointsRemoved: string[];
  /** Plain sentences, most important first: why the answers differ, or that they match. */
  notes: string[];
}

const briefSentences = (b: CouncilBrief | null) => (b ? [...b.points, ...b.disagreements, ...b.gaps] : []);

export function compareRuns(before: RunSide, after: RunSide): RunComparison {
  const a = before.snapshot;
  const b = after.snapshot;
  const sameInputs = a.inputsHash === b.inputsHash;
  const samePrompt = a.promptHash === b.promptHash;
  const sameInstructions = a.templateHash === b.templateHash;
  const sameModel = (a.model || null) === (b.model || null);
  const sameSampling = a.temperature === b.temperature && a.seed === b.seed;
  const sameAnswer = a.outputHash === b.outputHash;

  const docsA = new Map(a.documents.map((d) => [d.agent, d.hash]));
  const docsB = new Map(b.documents.map((d) => [d.agent, d.hash]));
  const documentsChanged = [...new Set([...docsA.keys(), ...docsB.keys()])].filter((k) => docsA.get(k) !== docsB.get(k));

  const key = (f: SnapshotFigure) => `${f.iso3}|${f.agent}|${f.label}`;
  const figA = new Map(a.figures.map((f) => [key(f), f]));
  const figB = new Map(b.figures.map((f) => [key(f), f]));
  const figuresChanged: FigureChange[] = [];
  for (const k of new Set([...figA.keys(), ...figB.keys()])) {
    const x = figA.get(k);
    const y = figB.get(k);
    if (x && y && x.value === y.value && x.source === y.source) continue;
    const f = (x || y)!;
    figuresChanged.push({
      iso3: f.iso3,
      label: f.label,
      agent: f.agent,
      before: x ? x.value : null,
      after: y ? y.value : null,
      ...(x ? { beforeSource: x.source } : {}),
      ...(y ? { afterSource: y.source } : {}),
    });
  }

  const sa = briefSentences(before.brief);
  const sb = briefSentences(after.brief);
  const headlineChanged = (before.brief?.headline || '') !== (after.brief?.headline || '');
  const pointsAdded = sb.filter((x) => !sa.includes(x));
  const pointsRemoved = sa.filter((x) => !sb.includes(x));

  const notes: string[] = [];
  if (sameAnswer) notes.push('Same answer, word for word.');
  else if (!before.brief || !after.brief) notes.push(after.brief ? 'This run has an answer; the first had none.' : `No answer this time${after.provider ? '' : ': no AI model answered'}.`);
  else notes.push(`Different answer: ${headlineChanged ? 'the headline changed' : 'same headline'}, ${pointsAdded.length} sentence(s) new, ${pointsRemoved.length} gone.`);
  if (!sameModel) notes.push(`The AI model changed: ${a.model || 'none'} then, ${b.model || 'none'} now.`);
  if (!sameSampling) notes.push(`The sampling changed: temperature ${a.temperature}, seed ${a.seed} then; temperature ${b.temperature}, seed ${b.seed} now.`);
  if (!sameInstructions) notes.push("The app's instructions to the model changed since the first run (an app update).");
  if (figuresChanged.length) notes.push(`${figuresChanged.length} figure(s) differ between the two runs.`);
  else if (documentsChanged.length) notes.push(`The documents of ${documentsChanged.join(', ')} differ.`);
  if (!sameAnswer && sameInputs && samePrompt && sameModel && sameSampling) {
    notes.push('Everything sent was the same, so the difference comes from the model itself (some providers do not give the same text even with a fixed seed).');
  }
  return { sameAnswer, sameInputs, samePrompt, sameInstructions, sameModel, sameSampling, documentsChanged, figuresChanged, headlineChanged, pointsAdded, pointsRemoved, notes };
}
