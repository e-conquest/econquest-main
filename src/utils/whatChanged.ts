/**
 * What changed since last time (Sam, 2026-11-05). When you ask the council about countries you
 * asked about before, the answer is compared with your latest saved conversation on them: which
 * figures moved, by how much, and which agent calls flipped. Stated comparison, no AI: a figure is
 * matched by agent, country and label, and counts as changed when its value reads differently.
 */
import type { AgentAnswer, SavedCouncilBrief } from './askCouncil';
import type { BriefSummary } from './researchLibrary';

export interface FigureChange {
  iso3: string;
  countryName: string;
  agent: string;
  label: string;
  before: string;
  after: string;
  beforeSource: string;
  afterSource: string;
  /** After less before, when both read as numbers in the same unit, e.g. "+0.75". */
  delta?: string;
}

export interface StanceChange {
  iso3: string;
  countryName: string;
  agent: string;
  dim: string;
  before: string;
  after: string;
}

export interface ChangeReport {
  /** The earlier conversation compared with. */
  sinceAskedAt: string;
  sinceQuestion: string;
  changes: FigureChange[];
  stanceChanges: StanceChange[];
  /** Figures found in both with the same value. */
  unchanged: number;
}

/** Agents left out: documents are yours, and calendar countdowns change every day by design. */
const SKIP_AGENTS = new Set(['doc', 'calendar']);
const SKIP_LABELS = /^Headline$/;

type Keyed = { iso3: string; countryName: string; agent: string; label: string; value: string; source: string };

function figures(answers: AgentAnswer[]): Map<string, Keyed> {
  const out = new Map<string, Keyed>();
  for (const a of answers) {
    if (SKIP_AGENTS.has(a.id)) continue;
    for (const f of a.findings) {
      if (f.iso3.startsWith('doc:')) continue;
      for (const g of f.figures) {
        if (SKIP_LABELS.test(g.label)) continue;
        out.set(`${a.id}|${f.iso3}|${g.label}`, { iso3: f.iso3, countryName: f.countryName, agent: a.name, label: g.label, value: g.value, source: g.source });
      }
    }
  }
  return out;
}

/** "13.75%" -> {n: 13.75, unit: "%", d: 2}; "$363.1bn" -> {n: 363.1, unit: "$bn", d: 1}. */
export function readNumber(v: string): { n: number; unit: string; d: number } | undefined {
  const m = v.match(/^\s*(\$)?([+-−]?\d+(?:\.\d+)?)\s*([^\s(]*)/);
  if (!m) return undefined;
  const raw = m[2].replace('−', '-');
  return { n: Number(raw), unit: `${m[1] || ''}${m[3] || ''}`, d: raw.includes('.') ? raw.split('.')[1].length : 0 };
}

export function deltaOf(before: string, after: string): string | undefined {
  const a = readNumber(before);
  const b = readNumber(after);
  if (!a || !b || a.unit !== b.unit) return undefined;
  const diff = b.n - a.n;
  const sign = diff >= 0 ? '+' : '-';
  const abs = Math.abs(diff).toFixed(Math.max(a.d, b.d));
  if (a.unit === '%') return `${sign}${abs} pts`;
  if (a.unit.startsWith('$')) return `${sign}$${abs}${a.unit.slice(1)}`;
  return `${sign}${abs}${a.unit ? ` ${a.unit}` : ''}`;
}

export function whatChanged(prev: SavedCouncilBrief, answers: AgentAnswer[]): ChangeReport {
  const before = figures(prev.answers);
  const after = figures(answers);
  const changes: FigureChange[] = [];
  let unchanged = 0;
  for (const [key, now] of after) {
    const was = before.get(key);
    if (!was) continue;
    if (was.value === now.value) {
      unchanged++;
      continue;
    }
    const delta = deltaOf(was.value, now.value);
    changes.push({ iso3: now.iso3, countryName: now.countryName, agent: now.agent, label: now.label, before: was.value, after: now.value, beforeSource: was.source, afterSource: now.source, ...(delta ? { delta } : {}) });
  }
  const stanceChanges: StanceChange[] = [];
  for (const a of answers) {
    const pa = prev.answers.find((x) => x.id === a.id);
    if (!pa) continue;
    for (const f of a.findings) {
      const pf = pa.findings.find((x) => x.iso3 === f.iso3);
      for (const s of f.stance || []) {
        const ps = pf?.stance?.find((x) => x.dim === s.dim);
        if (ps && ps.call !== s.call) stanceChanges.push({ iso3: f.iso3, countryName: f.countryName, agent: a.name, dim: s.dim, before: ps.call, after: s.call });
      }
    }
  }
  return { sinceAskedAt: prev.askedAt, sinceQuestion: prev.question, changes, stanceChanges, unchanged };
}

/** The latest saved conversation, other than this one, that asked an agent of this answer about a country of this answer. */
export function pickPrevious(saved: BriefSummary[], currentId: string, answers: AgentAnswer[]): BriefSummary | undefined {
  const agents = new Set<string>(answers.filter((a) => !SKIP_AGENTS.has(a.id)).map((a) => a.id));
  const countries = new Set(answers.flatMap((a) => a.findings.filter((f) => !f.iso3.startsWith('doc:')).map((f) => f.iso3)));
  return saved.find((b) => b.id !== currentId && (b.agents || []).some((a) => agents.has(a)) && (b.countries || []).some((c) => countries.has(c)));
}

/** Lines for the brief and the screen. */
export function changeLines(r: ChangeReport, max = 15): string[] {
  const lines = [
    ...r.stanceChanges.map((s) => `- ${s.countryName}, ${s.agent} Agent: call moved from ${s.before} to ${s.after}.`),
    ...r.changes.slice(0, max).map((c) => `- ${c.countryName}, ${c.agent} Agent: ${c.label} ${c.before} → ${c.after}${c.delta ? ` (${c.delta})` : ''}. Now: ${c.afterSource}.`),
  ];
  if (r.changes.length > max) lines.push(`- and ${r.changes.length - max} more.`);
  if (!lines.length) lines.push(`No figure or call changed (${r.unchanged} figures compared).`);
  else if (r.unchanged) lines.push(`${r.unchanged} other figures are unchanged.`);
  return lines;
}
