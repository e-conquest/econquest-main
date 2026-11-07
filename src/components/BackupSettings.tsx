import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { describeBackup, parseBackup, type BackupFile, type BackupSummary } from '../utils/backup';
import { SYNCED_KEYS } from '../utils/workspaceSync';

/**
 * Menu > Settings > Backup. Download everything you made in the app as one file, or restore one.
 * API keys are never in the file. Restoring saves a copy of the current state first.
 */
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'an unknown date' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

export const BackupSettings: React.FC = () => {
  const [current, setCurrent] = useState<BackupSummary | null>(null);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState<{ name: string; backup: BackupFile; summary: BackupSummary } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/backup');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCurrent(((await res.json()) as { summary: BackupSummary }).summary);
    } catch (e) {
      setError(`The app server did not answer (${e instanceof Error ? e.message : String(e)}).`);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const choose = async (file: File | undefined) => {
    setError('');
    setDone('');
    setChosen(null);
    if (!file) return;
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) return setError(parsed.error);
    setChosen({ name: file.name, backup: parsed.backup, summary: parsed.summary });
  };

  const restore = async () => {
    if (!chosen) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backup: chosen.backup }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; savedCopy?: string };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      // The browser keeps its own copy of holdings and watchlists; drop it so the restored file wins.
      for (const key of SYNCED_KEYS) {
        try {
          localStorage.removeItem(key);
        } catch {
          // storage blocked: the page reload still reads the file first
        }
      }
      setDone(`Restored. What was here before is saved in ${body.savedCopy}. Reloading the app…`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5" data-backup-settings="true">
      <p className="text-xs text-slate-600 dark:text-slate-400">
        One file with your saved research (briefs, documents, notebooks, teaching episodes), policy reviews, council answer snapshots, watch alerts, holdings, watchlists, countries you added and AI model settings. Your API keys are
        never in it. Use it to move to another computer or to keep a copy.
      </p>

      <div>
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Download a backup</h4>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400" data-backup-current="true">
          {current ? `On this computer now: ${describeBackup(current)}.` : error ? '' : 'Loading…'}
        </p>
        <a href="/api/backup/download" download className="mt-2 ui-btn ui-btn-primary inline-flex items-center gap-1.5">
          <Download className="w-3.5 h-3.5" aria-hidden /> Download backup
        </a>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Restore a backup</h4>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          Replaces what is saved here with the file's contents. A copy of what is here now is saved first in data/local/backups/. AI keys and secrets already on this computer are kept.
        </p>
        <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void choose(e.target.files?.[0])} aria-label="Choose a backup file" />
        <button type="button" className="mt-2 ui-btn inline-flex items-center gap-1.5" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload className="w-3.5 h-3.5" aria-hidden /> Choose a backup file
        </button>
        {chosen && (
          <div className="mt-3 p-3 border border-slate-200 dark:border-slate-800" data-backup-chosen="true">
            <p className="text-sm text-slate-800 dark:text-slate-100">
              {chosen.name}, made {when(chosen.summary.createdAt)}: {describeBackup(chosen.summary)}.
            </p>
            <div className="mt-2 flex gap-2">
              <button type="button" className="ui-btn ui-btn-primary" onClick={() => void restore()} disabled={busy}>
                {busy ? 'Restoring…' : 'Restore this backup'}
              </button>
              <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setChosen(null)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {done && (
          <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400" role="status">
            {done}
          </p>
        )}
      </div>

      {error && (
        <p className="text-xs text-rose-700 dark:text-rose-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
