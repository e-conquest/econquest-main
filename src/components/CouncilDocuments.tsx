import React, { useEffect, useRef, useState } from 'react';
import { Copy, Download, FileText, Trash2, X } from 'lucide-react';
import { useResearchLibrary } from './SavedResearch';
import type { LiveWatchlistItem } from '../types/council';
import type { FigureTag } from '../utils/askCouncil';
import { lazyNamed } from './LazyDesk';
import { explainInChat } from '../utils/explainHandoff';
import { documentMarkdown, documentSections, type AgentDocument, type CouncilDocument, type CoverageLevel, type SynthesisDocument } from '../utils/agentDocument';

/**
 * Council chat shows each agent's standard document (and the synthesis document) as a card, like
 * an attachment, instead of pouring every finding into the conversation. A card opens the document.
 */

export const TAG_CLASS: Record<FigureTag, string> = {
  live: 'text-emerald-700 dark:text-emerald-400',
  official: 'text-emerald-700 dark:text-emerald-400',
  estimate: 'text-amber-700 dark:text-amber-400',
  sample: 'text-amber-700 dark:text-amber-400',
  model: 'text-blue-700 dark:text-blue-300',
  document: 'text-slate-700 dark:text-slate-300',
};

const COVERAGE_CLASS: Record<CoverageLevel, string> = {
  full: 'text-emerald-700 dark:text-emerald-400',
  partial: 'text-amber-700 dark:text-amber-400',
  none: 'text-slate-500 dark:text-slate-400',
};

/** e.g. central-bank-watcher-agent-2026-11-05-which-central-banks */
export function documentFileName(d: CouncilDocument): string {
  const who = d.kind === 'agent' ? `${d.agentName} agent` : 'synthesis';
  const slug = `${who} ${d.askedAt.slice(0, 10)} ${d.question}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return `${slug || 'council-document'}.md`;
}

function downloadMarkdown(d: CouncilDocument) {
  const blob = new Blob([documentMarkdown(d)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = documentFileName(d);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const Card: React.FC<{ onOpen: () => void; title: string; meta: React.ReactNode; kind: string; strong?: boolean }> = ({ onOpen, title, meta, kind, strong }) => (
  <button
    type="button"
    onClick={onOpen}
    data-council-doc-card={kind}
    className={`flex items-start gap-2 text-left border px-2.5 py-2 min-w-0 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-950/30 ${
      strong ? 'border-slate-400 dark:border-slate-500' : 'border-slate-200 dark:border-slate-700'
    }`}
  >
    <FileText className="w-4 h-4 mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
    <span className="min-w-0">
      <span className="block text-sm font-medium text-slate-900 dark:text-white truncate">{title}</span>
      <span className="block text-xs text-slate-500 dark:text-slate-400">{meta}</span>
    </span>
  </button>
);

/** One card per document: the synthesis first, then each agent. */
export const DocumentCards: React.FC<{
  agents: AgentDocument[];
  synthesis: SynthesisDocument | null;
  /** The synthesis agent is still writing. */
  writing?: boolean;
  onOpen: (d: CouncilDocument) => void;
  /** Saves every document of this answer to Reports. */
  onSaveAll?: () => void;
  /** Ids already saved to Reports. */
  savedIds?: ReadonlySet<string>;
  /** Short note beside the Documents label (how many agents answered with figures). */
  note?: React.ReactNode;
}> = ({ agents, synthesis, writing, onOpen, onSaveAll, savedIds, note }) => {
  const all = [...(synthesis && !writing ? [synthesis] : []), ...agents];
  const allSaved = all.length > 0 && all.every((d) => savedIds?.has(d.id));
  return (
  <div className="space-y-1.5" data-council-documents={agents.length}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="ui-label">Documents{note ? <> · {note}</> : null}</div>
      {onSaveAll && all.length > 0 && (
        <button type="button" className="text-xs text-blue-700 dark:text-blue-300 hover:underline disabled:text-slate-500 disabled:no-underline" onClick={onSaveAll} disabled={allSaved || writing} data-council-docs-save-all="true">
          {allSaved ? 'All saved to Reports' : 'Save all to Reports'}
        </button>
      )}
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
      {writing ? (
        <div className="border border-dashed border-slate-300 dark:border-slate-600 px-2.5 py-2 text-xs text-slate-500 dark:text-slate-400" data-council-doc-card="synthesis-writing">
          Synthesis document: being written from the agent documents…
        </div>
      ) : (
        synthesis && (
          <Card
            kind="synthesis"
            strong
            onOpen={() => onOpen(synthesis)}
            title="Synthesis"
            meta={synthesis.status === 'written' ? `reads ${synthesis.agents.length} agent ${synthesis.agents.length === 1 ? 'document' : 'documents'}` : 'not written: no AI summary'}
          />
        )
      )}
      {agents.map((d) => (
        <Card
          key={d.id}
          kind={d.agentId}
          onOpen={() => onOpen(d)}
          title={`${d.agentName} Agent`}
          meta={
            <>
              {d.findings.length} {d.findings.length === 1 ? 'finding' : 'findings'} · {d.missing.length} {d.missing.length === 1 ? 'gap' : 'gaps'} ·{' '}
              <span className={COVERAGE_CLASS[d.coverage.level]}>coverage {d.coverage.level}</span>
            </>
          }
        />
      ))}
    </div>
  </div>
  );
};

/** **bold** and plain text; nothing else is interpreted. */
function inline(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-medium text-slate-900 dark:text-white">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
}

function Lines({ lines }: { lines: string[] }) {
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length)
      out.push(
        <ul key={`l${out.length}`} className="list-disc pl-5 space-y-0.5">
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>
      );
    list = [];
  };
  for (const l of lines) {
    if (l.startsWith('- ')) list.push(l.slice(2));
    else {
      flush();
      if (l.trim()) out.push(<p key={`p${out.length}`}>{inline(l)}</p>);
    }
  }
  flush();
  return <div className="space-y-1.5">{out}</div>;
}

function AgentFindings({ d, items, onOpenCountry, onExplained }: { d: AgentDocument; items: LiveWatchlistItem[]; onOpenCountry: (it: LiveWatchlistItem) => void; onExplained?: () => void }) {
  if (!d.findings.length) return <p>No reading from the figures on hand.</p>;
  return (
    <ul className="space-y-3">
      {d.findings.map((f) => {
        const item = items.find((i) => i.iso3 === f.iso3);
        return (
          <li key={f.iso3} data-doc-finding={f.iso3}>
            {item ? (
              <button type="button" onClick={() => onOpenCountry(item)} className="font-medium text-slate-900 dark:text-white hover:text-blue-700 dark:hover:text-blue-300">
                {f.subject}
              </button>
            ) : (
              <span className="font-medium text-slate-900 dark:text-white">{f.subject}</span>
            )}
            <span>: {f.reading}</span>
            {f.calls.length > 0 && <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">Call on {f.calls.join('; ')}</p>}
            {f.figures.length > 0 && (
              <table className="mt-1 w-full text-xs">
                <tbody>
                  {f.figures.map((g, i) => (
                    <tr key={`${g.label}-${i}`} className="border-t border-slate-100 dark:border-slate-800 align-top">
                      <td className="py-0.5 pr-2 text-slate-600 dark:text-slate-400">{g.label}</td>
                      <td className="py-0.5 pr-2 tabular-nums text-slate-900 dark:text-slate-100 whitespace-nowrap">{g.value}</td>
                      <td className={`py-0.5 pr-2 whitespace-nowrap ${TAG_CLASS[g.tag]}`}>{g.tagText}</td>
                      <td className="py-0.5 text-slate-500 dark:text-slate-400">{g.ref ? `[${g.ref}]` : g.source}</td>
                      {onExplained && (
                        <td className="py-0.5 pl-2 text-right">
                          <button
                            type="button"
                            className="text-blue-700 dark:text-blue-300 hover:underline"
                            title="Ask the council what this figure means and why it is where it is"
                            data-explain-figure={g.label}
                            onClick={() => {
                              explainInChat({ kind: 'figure', label: g.label, value: g.value, source: g.source, asOf: `read ${d.askedAt.slice(0, 10)}`, iso3: f.iso3, countryName: f.subject });
                              onExplained();
                            }}
                          >
                            Explain
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The open document, over the page; Escape or Close shuts it. */
const CouncilChartCard = lazyNamed(() => import('./CouncilChart'), 'CouncilChartCard');

export const DocumentViewer: React.FC<{
  doc: CouncilDocument;
  items: LiveWatchlistItem[];
  onOpenCountry: (it: LiveWatchlistItem) => void;
  onClose: () => void;
  /** Extra buttons (Save to Reports). */
  actions?: React.ReactNode;
}> = ({ doc, items, onOpenCountry, onClose, actions }) => {
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(documentMarkdown(doc));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  const heading = doc.kind === 'agent' ? `${doc.agentName} Agent` : 'Synthesis';
  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-slate-900/40 sm:p-6" onClick={onClose} data-council-doc-viewer={doc.kind === 'agent' ? doc.agentId : 'synthesis'}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${heading} document`}
        className="w-full sm:max-w-3xl max-h-full flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <div className="min-w-0">
            <div className="text-base font-semibold text-slate-900 dark:text-white">{heading}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Standard council document · template v{doc.version}</div>
          </div>
          <button ref={closeRef} type="button" className="ui-btn" onClick={onClose} aria-label="Close document">
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-3 space-y-4 text-sm text-slate-800 dark:text-slate-200">
          {doc.kind === 'agent' && doc.chart && (
            <React.Suspense fallback={<p className="text-xs text-slate-500 dark:text-slate-400">Drawing the chart…</p>}>
              <CouncilChartCard result={doc.chart} />
            </React.Suspense>
          )}
          {documentSections(doc).map((s) => (
            <section key={s.heading} data-doc-section={s.heading}>
              <h3 className="ui-label mb-1">{s.heading}</h3>
              {doc.kind === 'agent' && s.heading === 'Findings' ? <AgentFindings d={doc} items={items} onOpenCountry={onOpenCountry} onExplained={onClose} /> : <Lines lines={s.lines} />}
            </section>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-slate-200 dark:border-slate-700">
          {actions}
          <button type="button" className="ui-btn" onClick={() => downloadMarkdown(doc)}>
            <Download className="w-4 h-4" aria-hidden /> Download .md
          </button>
          <button type="button" className="ui-btn" onClick={() => void copy()}>
            <Copy className="w-4 h-4" aria-hidden /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
};

/** A Save to Reports button for the viewer. */
export const SaveToReportsButton: React.FC<{ saved: boolean; onSave: () => void }> = ({ saved, onSave }) => (
  <button type="button" className="ui-btn ui-btn-primary" onClick={onSave} disabled={saved} data-council-doc-save="true">
    <FileText className="w-4 h-4" aria-hidden /> {saved ? 'Saved to Reports' : 'Save to Reports'}
  </button>
);

/**
 * Reports > Council documents: the agent and synthesis documents saved from Council chat, kept in
 * data/local/research.json, grouped by question, newest first.
 */
export const SavedCouncilDocuments: React.FC<{ items: LiveWatchlistItem[]; onOpenCountry: (it: LiveWatchlistItem) => void }> = ({ items, onOpenCountry }) => {
  const lib = useResearchLibrary();
  const [open, setOpen] = useState<CouncilDocument | null>(null);
  const close = React.useCallback(() => setOpen(null), []);
  const groups: Array<{ key: string; question: string; askedAt: string; scope: string; docs: typeof lib.councilDocs }> = [];
  for (const d of lib.councilDocs) {
    const key = `${d.askedAt}|${d.question}`;
    const g = groups.find((x) => x.key === key);
    if (g) g.docs.push(d);
    else groups.push({ key, question: d.question, askedAt: d.askedAt, scope: d.scope, docs: [d] });
  }
  for (const g of groups) g.docs.sort((a, b) => (a.kind === b.kind ? a.author.localeCompare(b.author) : a.kind === 'synthesis' ? -1 : 1));
  return (
    <section className="ui-panel p-4 space-y-3" data-saved-council-docs={lib.councilDocs.length}>
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Council documents</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Agent and synthesis documents you saved from Council chat, each in the standard template. Kept on this computer in data/local/research.json.
        </p>
      </div>
      {lib.error && <p className="text-xs text-amber-700 dark:text-amber-400">{lib.error}</p>}
      {!groups.length ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">None saved yet. Choose Save to Reports under a council answer in Council chat, or inside any document it opens.</p>
      ) : (
        <ul className="space-y-3">
          {groups.map((g) => (
            <li key={g.key} className="border-t border-slate-200 dark:border-slate-700 pt-2">
              <p className="text-sm font-medium text-slate-900 dark:text-white">{g.question}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Asked {g.askedAt.slice(0, 16).replace('T', ' ')} UTC about {g.scope}
              </p>
              <ul className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {g.docs.map((d) => (
                  <li key={d.id} className="flex items-stretch">
                    <button
                      type="button"
                      className="flex-1 min-w-0 flex items-start gap-2 text-left border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 hover:border-blue-400 dark:hover:border-blue-500"
                      onClick={() => void lib.loadCouncilDoc(d.id).then((doc) => doc && setOpen(doc))}
                      data-saved-council-doc={d.id}
                    >
                      <FileText className="w-4 h-4 mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-sm text-slate-900 dark:text-white truncate">{d.author}</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">{d.status}</span>
                      </span>
                    </button>
                    <button type="button" className="ui-btn border-l-0" onClick={() => void lib.deleteCouncilDoc(d.id)} aria-label={`Delete ${d.author} document`} title="Delete from Reports">
                      <Trash2 className="w-4 h-4" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <DocumentViewer
          doc={open}
          items={items}
          onOpenCountry={(it) => {
            setOpen(null);
            onOpenCountry(it);
          }}
          onClose={close}
        />
      )}
    </section>
  );
};
