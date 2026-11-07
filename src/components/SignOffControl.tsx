/**
 * Draft -> Reviewed -> Approved on a saved council conversation (Reports > Saved research).
 * Each step records a name and the report's content hash on the server (src/utils/signoff.ts).
 */
import { useEffect, useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import type { SignOffStatus, SignOffStep, SignOffView } from '../utils/signoff';

const LABEL: Record<SignOffStatus, string> = { draft: 'Draft', reviewed: 'Reviewed', approved: 'Approved', changed: 'Changed after sign-off' };
const TONE: Record<SignOffStatus, string> = { draft: '', reviewed: 'ui-badge-accent', approved: 'ui-badge-positive', changed: 'ui-badge-warning' };
const NAME_KEY = 'econquest.signoffName.v1';

/** Keyed "brief:<id>" or "review:<id>". */
let cache: Record<string, SignOffView> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<(v: Record<string, SignOffView> | null) => void>();

function reload(): Promise<void> {
  loading = fetch('/api/signoffs')
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (j?.briefs) {
        const next: Record<string, SignOffView> = {};
        for (const [id, v] of Object.entries(j.briefs as Record<string, SignOffView>)) next[`brief:${id}`] = v;
        for (const [id, v] of Object.entries((j.reviews || {}) as Record<string, SignOffView>)) next[`review:${id}`] = v;
        cache = next;
      }
      listeners.forEach((l) => l(cache));
    })
    .catch(() => undefined)
    .finally(() => {
      loading = null;
    });
  return loading;
}

function useSignOffs() {
  const [v, setV] = useState(cache);
  useEffect(() => {
    listeners.add(setV);
    if (!loading) void reload();
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}

const readName = () => {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
};

export function SignOffControl({ briefId, kind = 'brief' }: { briefId: string; kind?: 'brief' | 'review' }) {
  const all = useSignOffs();
  const view = all?.[`${kind}:${briefId}`];
  const status: SignOffStatus = view?.status ?? 'draft';
  const [pending, setPending] = useState<SignOffStep | null>(null);
  const [name, setName] = useState(readName);
  const [error, setError] = useState('');

  const sign = async () => {
    if (!pending) return;
    setError('');
    try {
      localStorage.setItem(NAME_KEY, name.trim());
    } catch {
      /* not remembered: fine */
    }
    try {
      const r = await fetch(`/api/signoffs/${kind}/${encodeURIComponent(briefId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: pending, by: name }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setPending(null);
      await reload();
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  const who =
    status === 'approved'
      ? ` by ${view?.approvedBy}${view?.selfApproved ? ' (self-approved, no second reviewer)' : view?.reviewedBy ? `, reviewed by ${view.reviewedBy}` : ''}`
      : status === 'reviewed'
      ? ` by ${view?.reviewedBy}`
      : status === 'changed'
      ? ': review again'
      : '';
  const steps: Array<{ step: SignOffStep; label: string }> =
    status === 'draft' || status === 'changed'
      ? [{ step: 'reviewed', label: 'Mark reviewed' }]
      : status === 'reviewed'
      ? [
          { step: 'approved', label: 'Approve' },
          { step: 'withdrawn', label: 'Withdraw' },
        ]
      : [{ step: 'withdrawn', label: 'Withdraw approval' }];

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-signoff={status}>
      <span className={`ui-badge ${TONE[status]} font-normal`} title={view ? `Content SHA-256 ${view.contentHash}` : undefined}>
        <BadgeCheck className="w-3 h-3" aria-hidden />
        {LABEL[status]}
        {who}
      </span>
      {!pending &&
        steps.map((s) => (
          <button key={s.step} type="button" className="ui-btn ui-btn-ghost" onClick={() => setPending(s.step)}>
            {s.label}
          </button>
        ))}
      {pending && (
        <span className="inline-flex flex-wrap items-center gap-1">
          <label className="sr-only" htmlFor={`signoff-name-${kind}-${briefId}`}>
            Your name
          </label>
          <input
            id={`signoff-name-${kind}-${briefId}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void sign()}
            placeholder="Your name"
            className="px-2 py-1 text-xs w-36 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
            autoFocus
          />
          <button type="button" className="ui-btn ui-btn-primary" disabled={!name.trim()} onClick={() => void sign()}>
            Sign: {pending === 'withdrawn' ? 'withdraw' : pending}
          </button>
          <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setPending(null)}>
            Cancel
          </button>
        </span>
      )}
      {error && <span className="text-rose-600 dark:text-rose-400">{error}</span>}
    </div>
  );
}

/** Refresh every sign-off badge (after a report is saved over or deleted). */
export const refreshSignOffs = reload;
