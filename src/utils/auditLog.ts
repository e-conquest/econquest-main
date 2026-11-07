/**
 * Audit log (Sam, 2026-11-05): an append-only record of what the app showed and what was done in it,
 * so any council answer or saved report can be traced afterwards: the question, the AI model that
 * wrote the summary, every figure the agents used with its source and period, and each save,
 * delete, export, settings or key change.
 *
 * Each line is chained to the one before it by a SHA-256 hash (prev + the entry itself), in the
 * spirit of the change ledger in the Python econquest program. Checking the log recomputes the
 * chain, so a line changed or removed after it was written shows up. What it cannot show: someone
 * with access to the file who rewrites the whole chain from that point on. Keeping an export (or
 * just the latest hash) somewhere else covers that; a keyed seal is a later step.
 *
 * Never logged: API keys, passwords, uploaded document text, holdings amounts. Requests are logged
 * by what they did (route and outcome), not by their body.
 *
 * Server-only (uses node:crypto). The browser imports types only.
 */
import { createHash } from 'crypto';
import { apiKeyField } from '../data/apiKeyFields';

export type AuditKind = 'council' | 'research' | 'export' | 'settings' | 'data' | 'model' | 'workspace' | 'audit' | 'validation' | 'signoff' | 'access' | 'idea';

export const AUDIT_KIND_LABEL: Record<AuditKind, string> = {
  council: 'Council answer',
  research: 'Saved research',
  export: 'Download',
  settings: 'Settings',
  data: 'Data',
  model: 'AI model',
  workspace: 'Holdings and lists',
  audit: 'Audit log',
  validation: 'Validation',
  signoff: 'Sign-off',
  access: 'Sign-in and accounts',
  idea: 'Trade idea',
};

export interface AuditFigure {
  iso3: string;
  agent: string;
  label: string;
  value: string;
  /** Source as the agent showed it, with the period (e.g. "IMF IL, Sep 2026"). */
  source: string;
  tag: string;
}

/** Who did it: the signed-in account. Absent while sign-in is off (one user, no accounts). */
export interface AuditActor {
  id: string;
  username: string;
  name: string;
}

export interface AuditInput {
  kind: AuditKind;
  by?: AuditActor;
  /** One line in plain words, e.g. 'Council answer: "Is Brazil debt sustainable?"'. */
  summary: string;
  detail?: Record<string, unknown>;
}

export interface AuditEntry extends AuditInput {
  seq: number;
  /** ISO time the entry was written. */
  at: string;
  /** Hash of the entry before; GENESIS for the first. */
  prev: string;
  hash: string;
}

export const GENESIS = 'GENESIS';
export const MAX_FIGURES = 400;

/** JSON with object keys sorted at every level, so the same entry always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function entryHash(e: Omit<AuditEntry, 'hash'>): string {
  const { seq, at, kind, summary, detail, prev, by } = e;
  // `by` is left out of the hash when absent, so entries written before accounts existed still check.
  return createHash('sha256').update(canonicalJson({ seq, at, kind, summary, detail: detail ?? null, prev, by })).digest('hex');
}

/** The next entry after `last` (null for an empty log). */
export function nextEntry(last: Pick<AuditEntry, 'seq' | 'hash'> | null, input: AuditInput, at: Date = new Date()): AuditEntry {
  const base = {
    seq: last ? last.seq + 1 : 1,
    at: at.toISOString(),
    kind: input.kind,
    summary: String(input.summary).slice(0, 500),
    ...(input.detail ? { detail: input.detail } : {}),
    prev: last ? last.hash : GENESIS,
    ...(input.by ? { by: { id: input.by.id, username: input.by.username, name: input.by.name } } : {}),
  };
  return { ...base, hash: entryHash(base) };
}

export interface AuditCheck {
  ok: boolean;
  entries: number;
  /** Line number (from 1) where the chain first breaks. */
  brokenAt?: number;
  problem?: string;
  firstAt?: string;
  lastAt?: string;
  lastHash?: string;
}

/**
 * Recompute the chain over the file's lines. `head` is the last entry the app recorded writing
 * (kept in a separate small file); when the log ends before it, lines were removed from the end.
 */
export function checkLog(lines: string[], head?: { seq: number; hash: string } | null): { check: AuditCheck; entries: AuditEntry[] } {
  const entries: AuditEntry[] = [];
  let last: AuditEntry | null = null;
  const fail = (at: number, problem: string) => ({
    check: { ok: false, entries: entries.length, brokenAt: at, problem, firstAt: entries[0]?.at, lastAt: last?.at, lastHash: last?.hash },
    entries,
  });
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let e: AuditEntry;
    try {
      e = JSON.parse(line);
    } catch {
      return fail(i + 1, `line ${i + 1} is not a readable entry (cut off or edited)`);
    }
    const expectSeq = last ? last.seq + 1 : 1;
    if (e.seq !== expectSeq) return fail(i + 1, `entry ${expectSeq} is missing (line ${i + 1} is entry ${e.seq})`);
    if (e.prev !== (last ? last.hash : GENESIS)) return fail(i + 1, `entry ${e.seq} does not follow the one before it`);
    const { hash, ...rest } = e;
    if (entryHash(rest) !== hash) return fail(i + 1, `entry ${e.seq} was changed after it was written`);
    entries.push(e);
    last = e;
  }
  if (head && head.seq > 0) {
    if (!last || last.seq < head.seq) return fail(lines.length + 1, `the log ends at entry ${last?.seq ?? 0} but entry ${head.seq} was written: entries were removed from the end`);
    const atHead = entries.find((x) => x.seq === head.seq);
    if (atHead && atHead.hash !== head.hash) return fail(head.seq, `entry ${head.seq} differs from the one the app wrote`);
  }
  return { check: { ok: true, entries: entries.length, firstAt: entries[0]?.at, lastAt: last?.at, lastHash: last?.hash }, entries };
}

/** The figures agents used, flattened for the log. */
export function figuresFromAnswers(answers: Array<{ name?: string; findings?: Array<{ iso3?: string; figures?: Array<{ label?: string; value?: string; source?: string; tag?: string }> }> }>): AuditFigure[] {
  const out: AuditFigure[] = [];
  for (const a of answers) {
    for (const f of a?.findings ?? []) {
      for (const g of f?.figures ?? []) {
        if (out.length >= MAX_FIGURES) return out;
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

/**
 * What a successful request did, in plain words, or null when it changes nothing worth logging
 * (reads, status polls). Bodies are never read, so nothing secret reaches the log.
 */
export function describeRequest(method: string, path: string): AuditInput | null {
  const m = method.toUpperCase();
  const p = path.split('?')[0];
  let x: RegExpMatchArray | null;
  if (m === 'GET') {
    if ((x = p.match(/^\/api\/export\/([^/]+)\/([^/]+)\.(csv|xlsx)$/))) return { kind: 'export', summary: `Downloaded ${x[2].replace(/-/g, ' ')} for ${x[1].toUpperCase()} (${x[3].toUpperCase()})`, detail: { path: p } };
    if ((x = p.match(/^\/api\/audit\/export\.(csv|jsonl)$/))) return { kind: 'audit', summary: `Downloaded the audit log (${x[1].toUpperCase()})` };
    if (p === '/api/backup/download') return { kind: 'settings', summary: 'Downloaded a backup' };
    return null;
  }
  if (!['POST', 'PUT', 'DELETE'].includes(m)) return null;
  // Logged with full detail by the route itself, or read-only checks.
  if (/^\/api\/council\/(synthesise|debate|choose-agents|rerun|regression)$/.test(p)) return null;
  if (/^\/api\/ai\/(ollama-status|runtime-config-load)$/.test(p)) return null;
  if (p === '/api/audit/check') return null;
  // Sign-in, sign-out and account changes are logged by their routes, with the account name.
  if (/^\/api\/auth\//.test(p)) return null;
  // Sign-offs are logged by their route, with the name and content hash.
  if (/^\/api\/signoffs\//.test(p)) return null;

  if ((x = p.match(/^\/api\/settings\/keys\/([^/]+)(\/test)?$/))) {
    const field = apiKeyField(decodeURIComponent(x[1]));
    const name = field?.label || x[1];
    const secret = field?.secret !== false;
    if (x[2]) return { kind: 'settings', summary: `Tested the setting "${name}"` };
    return { kind: 'settings', summary: m === 'DELETE' ? `Removed the setting "${name}"` : `Saved the setting "${name}"${secret ? ' (the value itself is not logged)' : ''}` };
  }
  // Logged by the route only when the value really changed (the page re-sends it on every load).
  if (/^\/api\/workspace\//.test(p)) return null;
  if ((x = p.match(/^\/api\/research\/(briefs|council-docs|docs|notebooks|episodes)(?:\/([^/]+))?$/))) {
    const what = { briefs: 'council conversation', 'council-docs': 'council document', docs: 'document', notebooks: 'notebook', episodes: 'teaching episode' }[x[1]]!;
    const verb = m === 'DELETE' ? 'Deleted' : m === 'PUT' ? 'Updated' : 'Saved';
    return { kind: 'research', summary: `${verb} a ${what} in Reports`, ...(x[2] ? { detail: { id: x[2] } } : {}) };
  }
  const fixed: Record<string, AuditInput> = {
    'POST /api/backup/restore': { kind: 'settings', summary: 'Restored a backup (the previous files were kept)' },
    'POST /api/validation/run': { kind: 'validation', summary: 'Ran the pre-registered backtests' },
    'POST /api/data/refresh': { kind: 'data', summary: 'Refreshed the data feeds' },
    'POST /api/preload/start': { kind: 'data', summary: 'Started downloading all country data' },
    'POST /api/preload/stop': { kind: 'data', summary: 'Stopped downloading country data' },
    'PUT /api/morning-brief': { kind: 'settings', summary: 'Changed the morning brief settings' },
    'POST /api/morning-brief/run': { kind: 'research', summary: 'Ran the morning brief' },
    'PUT /api/watch-rules': { kind: 'settings', summary: 'Changed the watch alerts' },
    'POST /api/ai/runtime-config-save': { kind: 'model', summary: 'Changed the AI model settings' },
    'POST /api/ai/ollama-pull': { kind: 'model', summary: 'Downloaded an Ollama model' },
    'POST /api/ai/ollama-test': { kind: 'model', summary: 'Tested Ollama' },
    'POST /api/ai/try-model': { kind: 'model', summary: 'Tested the AI model' },
    'POST /api/council/phase1-and-cascade': { kind: 'council', summary: 'Ran the full council' },
    'POST /api/council/supreme-council': { kind: 'council', summary: 'Ran the council verdict step' },
    'POST /api/council/supreme-synthesis': { kind: 'council', summary: 'Ran the council verdict step' },
    'POST /api/council/analyze-policy-document': { kind: 'council', summary: 'Read a policy document with the AI model' },
    'POST /api/connectors/ping-and-inspect': { kind: 'settings', summary: 'Checked a connector' },
    'POST /api/council/webhook-dispatch': { kind: 'settings', summary: 'Sent a council result to a webhook' },
    'POST /api/v1/integration/publish': { kind: 'settings', summary: 'Published a council result through the integration API' },
  };
  const hit = fixed[`${m} ${p}`];
  if (hit) return hit;
  return { kind: 'data', summary: `${m} ${p}` };
}

export const AUDIT_HEADER = ['Entry', 'Time (UTC)', 'Kind', 'By', 'What happened', 'AI model', 'Figures used', 'Detail', 'Hash'];

export function auditRows(entries: AuditEntry[]): Array<Array<string | number>> {
  return entries.map((e) => {
    const d = (e.detail ?? {}) as Record<string, unknown>;
    const figures = Array.isArray(d.figures) ? (d.figures as AuditFigure[]) : [];
    const rest = { ...d };
    delete rest.figures;
    return [
      e.seq,
      e.at,
      AUDIT_KIND_LABEL[e.kind] ?? e.kind,
      e.by ? `${e.by.name} (${e.by.username})` : '',
      e.summary,
      typeof d.model === 'string' ? d.model : '',
      figures.map((f) => `${f.iso3} ${f.label} ${f.value} (${f.source})`).join('; '),
      Object.keys(rest).length ? JSON.stringify(rest) : '',
      e.hash,
    ];
  });
}
