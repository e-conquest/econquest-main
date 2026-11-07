import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Download, FileText, Trash2, X } from 'lucide-react';
import { downloadCouncilBrief } from '../utils/briefExport';
import { councilBriefSections, saveCouncilBrief, type SavedCouncilBrief } from '../utils/askCouncil';
import type { PolicyDoc } from '../utils/policyDocs';
import type { CouncilDocument } from '../utils/agentDocument';
import { SignOffControl, refreshSignOffs } from './SignOffControl';
import type { BriefSummary, CouncilDocSummary, DocSummary, Episode, EpisodeInput, Notebook, NotebookPatch, NotebookSummary, SavedBriefEntry } from '../utils/researchLibrary';

/** The research library on this computer (data/local/research.json), through the app server. */
export function useResearchLibrary() {
  const [briefs, setBriefs] = useState<BriefSummary[]>([]);
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [notebooks, setNotebooks] = useState<NotebookSummary[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [councilDocs, setCouncilDocs] = useState<CouncilDocSummary[]>([]);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/research');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setBriefs(Array.isArray(j.briefs) ? j.briefs : []);
      setDocs(Array.isArray(j.docs) ? j.docs : []);
      setNotebooks(Array.isArray(j.notebooks) ? j.notebooks : []);
      setEpisodes(Array.isArray(j.episodes) ? j.episodes : []);
      setCouncilDocs(Array.isArray(j.councilDocs) ? j.councilDocs : []);
      setError('');
    } catch (e: any) {
      setError(`Saved research could not be read (${e?.message || 'the app server did not answer'}).`);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // A report saved over (a follow-up) or deleted changes its sign-off state.
  useEffect(() => {
    void refreshSignOffs();
  }, [briefs]);
  const send = async (method: 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown): Promise<Record<string, unknown> | null> => {
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      await refresh();
      return j || {};
    } catch (e: any) {
      setError(`Not saved: ${e?.message || 'the app server did not answer'}.`);
      return null;
    }
  };
  const write = async (method: 'POST' | 'DELETE', url: string, body?: unknown) => {
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || `HTTP ${r.status}`);
      await refresh();
      return true;
    } catch (e: any) {
      setError(`Not saved: ${e?.message || 'the app server did not answer'}.`);
      return false;
    }
  };
  return {
    briefs,
    docs,
    notebooks,
    episodes,
    councilDocs,
    error,
    refresh,
    createEpisode: async (input: EpisodeInput): Promise<string | null> => {
      const j = await send('POST', '/api/research/episodes', input);
      return typeof j?.id === 'string' ? j.id : null;
    },
    updateEpisode: async (id: string, input: EpisodeInput) => (await send('PUT', `/api/research/episodes/${encodeURIComponent(id)}`, input)) !== null,
    deleteEpisode: async (id: string) => (await send('DELETE', `/api/research/episodes/${encodeURIComponent(id)}`)) !== null,
    createNotebook: async (title: string, briefIds?: string[]): Promise<string | null> => {
      const j = await send('POST', '/api/research/notebooks', { title, ...(briefIds ? { briefIds } : {}) });
      return typeof j?.id === 'string' ? j.id : null;
    },
    updateNotebook: async (id: string, patch: NotebookPatch) => (await send('PUT', `/api/research/notebooks/${encodeURIComponent(id)}`, patch)) !== null,
    deleteNotebook: async (id: string) => (await send('DELETE', `/api/research/notebooks/${encodeURIComponent(id)}`)) !== null,
    loadNotebook: async (id: string): Promise<Notebook | null> => {
      const r = await fetch(`/api/research/notebooks/${encodeURIComponent(id)}`).catch(() => null);
      return r?.ok ? ((await r.json()) as Notebook) : null;
    },
    saveBrief: (b: SavedCouncilBrief) => write('POST', '/api/research/briefs', b),
    deleteBrief: (id: string) => write('DELETE', `/api/research/briefs/${encodeURIComponent(id)}`),
    saveDoc: (d: PolicyDoc) => write('POST', '/api/research/docs', d),
    deleteDoc: (id: string) => write('DELETE', `/api/research/docs/${encodeURIComponent(id)}`),
    loadBrief: async (id: string): Promise<SavedBriefEntry | null> => {
      const r = await fetch(`/api/research/briefs/${encodeURIComponent(id)}`).catch(() => null);
      return r?.ok ? ((await r.json()) as SavedBriefEntry) : null;
    },
    /** Save council documents to Reports (one or several in one write). */
    saveCouncilDocs: (docs: CouncilDocument[]) => write('POST', '/api/research/council-docs', { documents: docs }),
    deleteCouncilDoc: (id: string) => write('DELETE', `/api/research/council-docs/${encodeURIComponent(id)}`),
    loadCouncilDoc: async (id: string): Promise<CouncilDocument | null> => {
      const r = await fetch(`/api/research/council-docs/${encodeURIComponent(id)}`).catch(() => null);
      return r?.ok ? ((await r.json()) as CouncilDocument) : null;
    },
    loadDoc: async (id: string): Promise<PolicyDoc | null> => {
      const r = await fetch(`/api/research/docs/${encodeURIComponent(id)}`).catch(() => null);
      return r?.ok ? ((await r.json()) as PolicyDoc) : null;
    },
  };
}

export type ResearchLibraryApi = ReturnType<typeof useResearchLibrary>;

/** **bold** in a line, as the brief sections write it. */
function Line({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <React.Fragment key={i}>{p}</React.Fragment>))}</>;
}

export function BriefView({ brief }: { brief: SavedCouncilBrief }) {
  return (
    <div className="space-y-3" data-saved-brief-view="true">
      {councilBriefSections(brief, () => true).map((s) => (
        <div key={s.heading} className="space-y-1">
          <h4 className="text-sm font-medium text-slate-900 dark:text-white">{s.heading}</h4>
          {s.lines.filter((l) => l.trim()).map((l, i) => (
            <p key={i} className={`text-sm text-slate-800 dark:text-slate-200 ${l.startsWith('  - ') ? 'pl-8' : l.startsWith('- ') ? 'pl-4' : ''}`}>
              <Line text={l.replace(/^\s*- /, '• ')} />
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');

/** Saved council conversations: reopen, copy, send to Reports, delete. */
export function SavedResearchList({ lib, toMarkdown, onSendToReports }: { lib: ResearchLibraryApi; toMarkdown: (b: SavedCouncilBrief) => string; onSendToReports: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [open, setOpen] = useState<SavedBriefEntry | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!lib.briefs.length && !lib.error) return null;
  const list = showAll ? lib.briefs : lib.briefs.slice(0, 5);
  const view = async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      setOpen(null);
      return;
    }
    setOpenId(id);
    setOpen(await lib.loadBrief(id));
  };
  return (
    <details className="px-4 py-2 border-t border-slate-100 dark:border-slate-800" data-saved-research="true">
      <summary className="cursor-pointer ui-label">
        Saved research ({lib.briefs.length}), kept on this computer in data/local/research.json
      </summary>
      {lib.error && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{lib.error}</p>}
      <ul className="mt-2 space-y-1.5">
        {list.map((b) => (
          <li key={b.id} className="border border-slate-200 dark:border-slate-700 p-2 space-y-1" data-saved-brief={b.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <button type="button" className="text-left text-sm text-slate-900 dark:text-white hover:underline" onClick={() => void view(b.id)}>
                {b.question}
                {b.turns > 1 && <span className="text-slate-500 dark:text-slate-400"> (and {b.turns - 1} earlier {b.turns === 2 ? 'question' : 'questions'})</span>}
              </button>
              <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{when(b.askedAt)} UTC</span>
            </div>
            {b.headline && <p className="text-xs text-slate-600 dark:text-slate-400">{b.headline}</p>}
            <SignOffControl briefId={b.id} />
            {openId === b.id && (
              <div className="pt-2 space-y-2">
                {open ? <BriefView brief={open} /> : <p className="text-xs text-slate-500">Opening…</p>}
                {open && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="ui-btn"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(toMarkdown(open));
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        } catch {
                          /* clipboard blocked */
                        }
                      }}
                    >
                      <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy as text'}
                    </button>
                    <button type="button" className="ui-btn" onClick={() => void downloadCouncilBrief(open, 'md')}>
                      <Download className="w-3.5 h-3.5" /> Markdown
                    </button>
                    <button type="button" className="ui-btn" onClick={() => void downloadCouncilBrief(open, 'pdf')}>
                      <Download className="w-3.5 h-3.5" /> PDF
                    </button>
                    <button
                      type="button"
                      className="ui-btn"
                      onClick={() => {
                        saveCouncilBrief(open);
                        onSendToReports();
                      }}
                    >
                      <FileText className="w-3.5 h-3.5" /> Open in Reports
                    </button>
                    <button
                      type="button"
                      className="ui-btn"
                      onClick={async () => {
                        if (await lib.deleteBrief(b.id)) {
                          setOpenId(null);
                          setOpen(null);
                        }
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {lib.briefs.length > 5 && (
        <button type="button" className="mt-1 ui-btn" onClick={() => setShowAll((s) => !s)}>
          {showAll ? 'Show the latest 5' : `Show all ${lib.briefs.length}`}
        </button>
      )}
    </details>
  );
}

/** Saved documents not in use now: add one back to the question, or delete it from this computer. */
export function SavedDocsRow({ lib, activeIds, canAdd, onUse }: { lib: ResearchLibraryApi; activeIds: string[]; canAdd: boolean; onUse: (d: PolicyDoc) => void }) {
  const idle = lib.docs.filter((d) => !activeIds.includes(d.id));
  if (!idle.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-saved-docs="true">
      <span className="text-xs text-slate-500 dark:text-slate-400">Saved documents:</span>
      {idle.map((d) => (
        <span key={d.id} className="ui-pill flex items-center gap-1" data-saved-doc={d.title}>
          <button
            type="button"
            disabled={!canAdd}
            title={canAdd ? 'Use this document in the next question' : 'Remove a document first (at most 5 at once)'}
            onClick={async () => {
              const full = await lib.loadDoc(d.id);
              if (full) onUse(full);
            }}
            className="hover:underline disabled:opacity-50"
          >
            + {d.title}
          </button>
          <button type="button" aria-label={`Delete ${d.title} from this computer`} title="Delete from this computer" onClick={() => void lib.deleteDoc(d.id)} className="hover:text-rose-700">
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
