/**
 * Exam mode (seven-groups plan, Phase 5, teaching): one server-wide switch for a class or an exam.
 * With it on, no AI model writes anything: Council chat shows the agents' figures only (no summary,
 * no AI choice of agents, no debate), Explain shows the data only, and every question asked and
 * country opened is written to the audit log, so a teacher can see what was looked at.
 *
 * The switch is kept in data/local/exam-mode.json by the server; only the computer running the app,
 * or an admin when sign-in is on, can change it. Browser-safe, pure.
 */

export interface ExamModeState {
  on: boolean;
  /** When it was last switched, ISO. */
  since?: string;
  /** Who switched it (account name, or "this computer"). */
  by?: string;
}

export const EXAM_REASON = 'Exam mode is on: no AI summary. The agents\' figures and sources above are the whole answer.';
export const EXAM_CHOICE_REASON = 'exam mode is on, so agents are chosen by the words in the question';
export const EXAM_DEBATE_REASON = 'exam mode is on, so the agents do not debate (that step uses an AI model)';

export function parseExamMode(raw: unknown): ExamModeState {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    on: o.on === true,
    ...(typeof o.since === 'string' ? { since: o.since } : {}),
    ...(typeof o.by === 'string' ? { by: o.by.slice(0, 80) } : {}),
  };
}

/** What a student opened, as one audit summary line. */
export function examOpenedSummary(what: string, label: string): string {
  const w = what === 'country' ? 'Opened country' : what === 'question' ? 'Asked' : 'Opened';
  return `Exam mode: ${w} "${label.replace(/\s+/g, ' ').trim().slice(0, 200)}"`;
}

let examOnce: Promise<boolean> | null = null;
/** Browser: record that something was opened, only when exam mode is on (state read once per page load). */
export function noteExamOpened(what: 'country' | 'page', label: string): void {
  if (typeof fetch !== 'function') return;
  examOnce ??= fetch('/api/exam-mode')
    .then((r) => (r.ok ? r.json() : { on: false }))
    .then((b) => b?.on === true)
    .catch(() => false);
  void examOnce.then((on) => {
    if (on) void fetch('/api/exam-mode/opened', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ what, label }) }).catch(() => undefined);
  });
}
