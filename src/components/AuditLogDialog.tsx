/**
 * Menu > Audit log: what the app showed and what was done in it, newest first, read from the
 * server's append-only log (data/local/audit/audit-log.jsonl, see src/utils/auditLog.ts).
 * Each council answer lists the AI model and every figure the agents used with source and period.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, ScrollText, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import type { AuditCheck, AuditEntry, AuditFigure, AuditKind } from '../utils/auditLog';

type AuditReply = {
  check: AuditCheck;
  total: number;
  entries: AuditEntry[];
  kinds: Record<AuditKind, string>;
  file: string;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

const DETAIL_LABEL: Record<string, string> = {
  via: 'Asked from',
  scope: 'Scope',
  removedSentences: 'Summary sentences removed by the number check',
  challenges: 'Challenges',
  verdict: 'Verdict',
  path: 'Address',
  id: 'Item',
};

function EntryDetail({ entry }: { entry: AuditEntry }) {
  const d = (entry.detail ?? {}) as Record<string, unknown>;
  const figures = Array.isArray(d.figures) ? (d.figures as AuditFigure[]) : [];
  const missing = Array.isArray(d.missing) ? (d.missing as string[]) : [];
  const rest = Object.entries(d).filter(([k]) => !['figures', 'missing', 'question', 'model', 'headline', 'noModel', 'agents'].includes(k));
  return (
    <div className="mt-2 space-y-2 text-xs text-slate-500 dark:text-slate-400">
      {entry.kind === 'council' && (
        <p>
          AI model: {typeof d.model === 'string' && d.model ? d.model : 'none (the agents’ answers stood alone)'}
          {typeof d.headline === 'string' && d.headline ? <> · Headline: {d.headline}</> : null}
          {typeof d.noModel === 'string' ? <> · {d.noModel}</> : null}
        </p>
      )}
      {Array.isArray(d.agents) && d.agents.length > 0 && <p>Agents: {(d.agents as string[]).join(', ')}</p>}
      {figures.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-slate-500 dark:text-slate-400">
                <th className="pr-3 font-normal">Country</th>
                <th className="pr-3 font-normal">Figure</th>
                <th className="pr-3 font-normal">Value</th>
                <th className="font-normal">Source and period</th>
              </tr>
            </thead>
            <tbody>
              {figures.map((f, i) => (
                <tr key={i} className="align-top border-t border-slate-100 dark:border-slate-800">
                  <td className="pr-3">{f.iso3}</td>
                  <td className="pr-3">{f.label}</td>
                  <td className="pr-3 tabular-nums whitespace-nowrap">{f.value}</td>
                  <td>{f.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {missing.length > 0 && <p>Missing: {missing.join(' · ')}</p>}
      {rest.length > 0 && <p className="break-words">{rest.map(([k, v]) => `${DETAIL_LABEL[k] ?? k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ')}</p>}
      <p className="break-all text-slate-400 dark:text-slate-500">Entry {entry.seq} · hash {entry.hash}</p>
    </div>
  );
}

export function AuditLogDialog({ onClose }: { onClose: () => void }) {
  const [reply, setReply] = useState<AuditReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<AuditKind | ''>('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '300', ...(kind ? { kind } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
      const r = await fetch(`/api/audit?${params}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setReply(await r.json());
      setError(null);
    } catch (e: any) {
      setError(`The app server did not answer (${e?.message || 'error'}).`);
    }
  }, [kind, q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const check = reply?.check;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-log-title"
        className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2 id="audit-log-title" className="ui-title inline-flex items-center gap-2">
            <ScrollText className="w-4 h-4" aria-hidden /> Audit log
          </h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close audit log" className="ui-btn ui-btn-ghost">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto ui-body">
          <p>
            Every council answer (with the AI model and each figure the agents used, its source and period), and every
            save, delete, download, settings and key change. Lines are only ever added, each chained to the one before.
            Keys, document text and holdings amounts are never written here.
          </p>

          {error && <p className="text-rose-600 dark:text-rose-400">{error}</p>}

          {check && (
            <div
              data-testid="audit-check"
              className={`flex items-start gap-2 p-2 border ${check.ok ? 'border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300' : 'border-rose-300 dark:border-rose-900 text-rose-700 dark:text-rose-300'}`}
            >
              {check.ok ? <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" aria-hidden /> : <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />}
              <div>
                {check.ok ? (
                  check.entries ? (
                    <p>
                      Checked {check.entries} {check.entries === 1 ? 'entry' : 'entries'} since {when(check.firstAt!)}: none was changed or removed after it was written.
                    </p>
                  ) : (
                    <p>Nothing logged yet. Entries start with the next council answer, save or change.</p>
                  )
                ) : (
                  <p>Check failed: {check.problem}. Entries before that point are shown below.</p>
                )}
                {check.lastHash && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 break-all">
                    Latest hash {check.lastHash}. Keep a copy of it, or of an export, somewhere else: that shows the whole log was not rewritten.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="audit-kind">
              Kind
            </label>
            <select id="audit-kind" value={kind} onChange={(e) => setKind(e.target.value as AuditKind | '')} className="px-2 py-1.5 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white">
              <option value="">Everything</option>
              {reply &&
                Object.entries(reply.kinds).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
            </select>
            <label className="sr-only" htmlFor="audit-q">
              Search
            </label>
            <input id="audit-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search (country, figure, question)" className="flex-1 min-w-[10rem] px-2 py-1.5 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white" />
            <a href="/api/audit/export.csv" className="ui-btn ui-btn-ghost inline-flex items-center gap-1">
              <Download className="w-3.5 h-3.5" aria-hidden /> CSV
            </a>
            <a href="/api/audit/export.jsonl" className="ui-btn ui-btn-ghost inline-flex items-center gap-1" title="The log file itself, one entry per line, with hashes, so the chain can be checked elsewhere">
              <Download className="w-3.5 h-3.5" aria-hidden /> Log file
            </a>
          </div>

          {reply && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {reply.total > reply.entries.length ? `Newest ${reply.entries.length} of ${reply.total}` : `${reply.total} ${reply.total === 1 ? 'entry' : 'entries'}`} · {reply.file}
            </p>
          )}

          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {reply?.entries.map((e) => (
              <li key={e.seq} className="py-2">
                <button type="button" onClick={() => setOpen(open === e.seq ? null : e.seq)} aria-expanded={open === e.seq} className="w-full text-left">
                  <span className="text-xs text-slate-500 dark:text-slate-400 block">
                    {when(e.at)} · {reply.kinds[e.kind] ?? e.kind}{e.by ? ` · ${e.by.name}` : ''}
                  </span>
                  <span className="block">{e.summary}</span>
                </button>
                {open === e.seq && <EntryDetail entry={e} />}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
