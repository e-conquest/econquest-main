/**
 * Report sign-off (Sam, 2026-11-05): a saved council conversation in Reports goes Draft ->
 * Reviewed -> Approved, each step with a name, a time and the SHA-256 of the report's content at
 * that moment. If the report changes afterwards (a follow-up question saved over it), the sign-off
 * no longer matches and the report reads "Changed after sign-off" until it is reviewed again.
 *
 * One person can do both steps while the app has a single user; the approval then says
 * "self-approved, no second reviewer", like EXC-002 in the Python econquest program. An approved
 * report cannot be deleted until the approval is withdrawn. Every step goes in the audit log.
 *
 * With accounts (src/utils/auth.ts) the name is the signed-in account's, not typed, and the step
 * records the account id. Then separation of duties applies: the account that reviewed a report
 * cannot approve it; the server refuses instead of labelling it self-approved.
 *
 * Kept in data/local/signoffs.json, apart from the reports, so the library format is unchanged.
 * Server-only (node:crypto); the browser imports types only.
 */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { canonicalJson } from './auditLog';
import { writeFileAtomic } from './atomicWrite';

export type SignOffStep = 'reviewed' | 'approved' | 'withdrawn';
export type SignOffStatus = 'draft' | 'reviewed' | 'approved' | 'changed';

export const SIGNOFF_LABEL: Record<SignOffStatus, string> = {
  draft: 'Draft',
  reviewed: 'Reviewed',
  approved: 'Approved',
  changed: 'Changed after sign-off',
};

export interface SignOffEntry {
  step: SignOffStep;
  by: string;
  at: string;
  /** SHA-256 of the report content when the step was taken. */
  contentHash: string;
  note?: string;
  /** On an approval by the same person who reviewed it (only possible while sign-in is off). */
  selfApproved?: boolean;
  /** The signed-in account that took the step; absent while sign-in is off. */
  byAccount?: string;
}

export type SignOffKind = 'brief' | 'review';

export interface SignOffRecord {
  kind: SignOffKind;
  id: string;
  history: SignOffEntry[];
}

export interface SignOffFile {
  records: Record<string, SignOffRecord>;
}

export interface SignOffView {
  status: SignOffStatus;
  reviewedBy?: string;
  approvedBy?: string;
  at?: string;
  selfApproved?: boolean;
  contentHash: string;
  history: SignOffEntry[];
}

const key = (kind: string, id: string) => `${kind}:${id}`;

/** Hash of a saved report, leaving out when it was saved (re-saving the same content keeps it). */
export function reportHash(report: Record<string, unknown>): string {
  const { savedAt: _savedAt, ...rest } = report;
  return createHash('sha256').update(canonicalJson(rest)).digest('hex');
}

/** Where a report stands now, from its history and its current content hash. */
export function signOffView(record: SignOffRecord | undefined, currentHash: string): SignOffView {
  const history = record?.history ?? [];
  // The steps since the last withdrawal.
  let start = 0;
  history.forEach((h, i) => h.step === 'withdrawn' && (start = i + 1));
  const live = history.slice(start);
  const ri = live.map((h) => h.step).lastIndexOf('reviewed');
  const reviewed = ri >= 0 ? live[ri] : undefined;
  // An approval counts only when it follows the latest review.
  const approved = live.slice(ri + 1).find((h) => h.step === 'approved');
  const last = live[live.length - 1];
  if (!last) return { status: 'draft', contentHash: currentHash, history };
  if (last.contentHash !== currentHash) return { status: 'changed', reviewedBy: reviewed?.by, approvedBy: approved?.by, at: last.at, contentHash: currentHash, history };
  if (approved) return { status: 'approved', reviewedBy: reviewed?.by, approvedBy: approved.by, at: approved.at, ...(approved.selfApproved ? { selfApproved: true } : {}), contentHash: currentHash, history };
  return { status: 'reviewed', reviewedBy: reviewed?.by, at: reviewed?.at, contentHash: currentHash, history };
}

/** The latest review since the last withdrawal. */
function liveReview(record: SignOffRecord | undefined): SignOffEntry | undefined {
  const history = record?.history ?? [];
  let start = 0;
  history.forEach((h, i) => h.step === 'withdrawn' && (start = i + 1));
  return history.slice(start).filter((h) => h.step === 'reviewed').pop();
}

/** Takes one step, or returns why it cannot be taken. */
export function takeStep(
  record: SignOffRecord | undefined,
  kind: SignOffKind,
  id: string,
  currentHash: string,
  input: { step: unknown; by: unknown; note?: unknown },
  now: Date = new Date(),
  account?: { id: string; displayName: string }
): { record: SignOffRecord; entry: SignOffEntry } | { error: string } {
  const step = input.step;
  if (step !== 'reviewed' && step !== 'approved' && step !== 'withdrawn') return { error: 'The step must be reviewed, approved or withdrawn.' };
  const typed = account ? account.displayName : input.by;
  const by = typeof typed === 'string' ? typed.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
  if (!by) return { error: 'A name is needed to sign.' };
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 500) : undefined;
  const view = signOffView(record, currentHash);
  if (step === 'approved' && view.status !== 'reviewed') return { error: view.status === 'approved' ? 'Already approved.' : 'Mark it reviewed first.' };
  if (step === 'reviewed' && (view.status === 'reviewed' || view.status === 'approved')) return { error: `Already ${view.status}.` };
  if (step === 'withdrawn' && view.status === 'draft') return { error: 'Nothing to withdraw.' };
  if (account && step === 'approved' && liveReview(record)?.byAccount === account.id) {
    return { error: 'You reviewed this report, so someone else must approve it.' };
  }
  const entry: SignOffEntry = {
    step,
    by,
    at: now.toISOString(),
    contentHash: currentHash,
    ...(note ? { note } : {}),
    ...(account ? { byAccount: account.id } : {}),
    ...(!account && step === 'approved' && view.reviewedBy && view.reviewedBy.toLowerCase() === by.toLowerCase() ? { selfApproved: true } : {}),
  };
  return { record: { kind, id, history: [...(record?.history ?? []), entry].slice(-50) }, entry };
}

export function signOffFilePath(dataDir: string): string {
  return path.join(dataDir, 'local', 'signoffs.json');
}

export function loadSignOffs(file: string): SignOffFile {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { records: j?.records && typeof j.records === 'object' ? j.records : {} };
  } catch {
    return { records: {} };
  }
}

export function saveSignOff(file: string, record: SignOffRecord): void {
  const all = loadSignOffs(file);
  all.records[key(record.kind, record.id)] = record;
  writeFileAtomic(file, JSON.stringify(all, null, 1), 0o600);
}

export function recordFor(all: SignOffFile, kind: SignOffKind, id: string): SignOffRecord | undefined {
  return all.records[key(kind, id)];
}
