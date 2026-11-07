import React, { useEffect, useState } from 'react';
import { BookOpen, Download, Plus, Trash2 } from 'lucide-react';
import { suggestedTopics, type Notebook } from '../utils/researchLibrary';
import { useResearchLibrary } from './SavedResearch';

/**
 * Reports > Research notebooks: saved council conversations and documents grouped by topic, with
 * your own notes, exported as one Markdown file. Kept with the rest of your saved research on this
 * computer (data/local/research.json).
 */

type Country = { iso3: string; countryName: string };

const day = (iso: string) => iso.slice(0, 10);

export const ResearchNotebooks: React.FC<{ countries?: Country[] }> = ({ countries = [] }) => {
  const lib = useResearchLibrary();
  const [title, setTitle] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [open, setOpen] = useState<Notebook | null>(null);
  const [notes, setNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState(true);

  const names = Object.fromEntries(countries.map((c) => [c.iso3, c.countryName]));
  const topics = suggestedTopics(lib.briefs, lib.notebooks, names).slice(0, 4);

  const show = async (id: string | null) => {
    setOpenId(id);
    const nb = id ? await lib.loadNotebook(id) : null;
    setOpen(nb);
    setNotes(nb?.notes || '');
    setNotesSaved(true);
  };

  // Keep the open notebook in step after a change elsewhere (an item deleted, contents changed).
  const summary = lib.notebooks.find((n) => n.id === openId);
  const stamp = summary ? `${summary.updatedAt}|${summary.briefIds.join(',')}|${summary.docIds.join(',')}` : '';
  useEffect(() => {
    if (!openId || !summary) return;
    let live = true;
    void lib.loadNotebook(openId).then((nb) => live && nb && setOpen(nb));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);

  const create = async (t: string, briefIds?: string[]) => {
    const id = await lib.createNotebook(t, briefIds);
    if (id) {
      setTitle('');
      await show(id);
    }
  };

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const saveNotes = async () => {
    if (!open || notesSaved) return;
    if (await lib.updateNotebook(open.id, { notes })) setNotesSaved(true);
  };

  return (
    <section className="ui-panel" data-research-notebooks="true" data-no-provenance-overlay="true" data-no-stat-ref="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Research notebooks
        </h2>
        <p className="ui-label">
          Group saved council conversations and documents by topic, add your notes, and download the lot as one Markdown file. Kept on this computer in data/local/research.json.
        </p>
      </header>
      <div className="p-4 space-y-3">
        {lib.error && <p className="text-xs text-amber-700 dark:text-amber-400">{lib.error}</p>}

        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) void create(title.trim());
          }}
        >
          <label className="sr-only" htmlFor="notebook-title">
            New notebook title
          </label>
          <input
            id="notebook-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New notebook, e.g. Brazil fiscal"
            maxLength={120}
            className="flex-1 min-w-[12rem] px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
          />
          <button type="submit" className="ui-btn" disabled={!title.trim()}>
            <Plus className="w-3.5 h-3.5" /> Start notebook
          </button>
        </form>

        {topics.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" data-notebook-topics="true">
            <span className="text-xs text-slate-500 dark:text-slate-400">From your saved conversations:</span>
            {topics.map((t) => (
              <button key={t.iso3} type="button" className="ui-pill" onClick={() => void create(t.title, t.briefIds)}>
                + {t.title} ({t.briefIds.length} conversations)
              </button>
            ))}
          </div>
        )}

        {lib.notebooks.length === 0 && !lib.error && (
          <p className="ui-body">
            No notebooks yet. Save a conversation from Council chat on Workspace, then start a notebook here and tick what belongs in it.
          </p>
        )}

        {lib.notebooks.length > 0 && (
          <ul className="space-y-1.5">
            {lib.notebooks.map((n) => (
              <li key={n.id} className="border border-slate-200 dark:border-slate-700" data-notebook={n.title}>
                <button
                  type="button"
                  aria-expanded={openId === n.id}
                  onClick={() => void show(openId === n.id ? null : n.id)}
                  className="w-full text-left px-2 py-1.5 flex flex-wrap items-baseline justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <span className="text-sm text-slate-900 dark:text-white">{n.title}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {n.briefIds.length} conversation{n.briefIds.length === 1 ? '' : 's'} · {n.docIds.length} document{n.docIds.length === 1 ? '' : 's'}
                    {n.notesChars ? ' · notes' : ''} · changed {day(n.updatedAt)}
                  </span>
                </button>
                {openId === n.id && (
                  <div className="px-2 pb-3 pt-1 space-y-3 border-t border-slate-100 dark:border-slate-800">
                    {!open ? (
                      <p className="text-xs text-slate-500">Opening…</p>
                    ) : (
                      <>
                        <div>
                          <label className="ui-label block mb-1" htmlFor={`nb-notes-${n.id}`}>
                            Your notes
                          </label>
                          <textarea
                            id={`nb-notes-${n.id}`}
                            value={notes}
                            onChange={(e) => {
                              setNotes(e.target.value);
                              setNotesSaved(false);
                            }}
                            onBlur={() => void saveNotes()}
                            rows={5}
                            maxLength={20000}
                            placeholder="What you think, what to check next, what would change your mind."
                            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                          />
                          <div className="flex items-center gap-2">
                            <button type="button" className="ui-btn" disabled={notesSaved} onClick={() => void saveNotes()}>
                              {notesSaved ? 'Notes saved' : 'Save notes'}
                            </button>
                          </div>
                        </div>

                        <fieldset>
                          <legend className="ui-label mb-1">Saved conversations in this notebook</legend>
                          {lib.briefs.length === 0 ? (
                            <p className="text-xs text-slate-500 dark:text-slate-400">No saved conversations yet.</p>
                          ) : (
                            <ul className="max-h-48 overflow-auto space-y-0.5">
                              {lib.briefs.map((b) => (
                                <li key={b.id}>
                                  <label className="flex items-start gap-2 text-sm text-slate-800 dark:text-slate-200 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      className="mt-1"
                                      checked={open.briefIds.includes(b.id)}
                                      onChange={() => void lib.updateNotebook(open.id, { briefIds: toggle(open.briefIds, b.id) })}
                                    />
                                    <span>
                                      {b.question} <span className="text-xs text-slate-500 dark:text-slate-400">({day(b.askedAt)})</span>
                                    </span>
                                  </label>
                                </li>
                              ))}
                            </ul>
                          )}
                        </fieldset>

                        {lib.docs.length > 0 && (
                          <fieldset>
                            <legend className="ui-label mb-1">Saved documents in this notebook</legend>
                            <div className="flex flex-wrap gap-1.5">
                              {lib.docs.map((d) => (
                                <label key={d.id} className="ui-pill inline-flex items-center gap-1 cursor-pointer">
                                  <input type="checkbox" checked={open.docIds.includes(d.id)} onChange={() => void lib.updateNotebook(open.id, { docIds: toggle(open.docIds, d.id) })} />
                                  {d.title}
                                </label>
                              ))}
                            </div>
                          </fieldset>
                        )}

                        <div className="flex flex-wrap gap-2">
                          <a className="ui-btn inline-flex" href={`/api/export/notebook/${encodeURIComponent(open.id)}.md`} download onClick={() => void saveNotes()}>
                            <Download className="w-3.5 h-3.5" /> Download notebook (Markdown)
                          </a>
                          <button
                            type="button"
                            className="ui-btn"
                            onClick={async () => {
                              if (await lib.deleteNotebook(open.id)) void show(null);
                            }}
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Delete notebook
                          </button>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          The download holds your notes, each conversation as its full council brief with sources and references, and the opening of each document. Deleting the notebook keeps the conversations and documents.
                        </p>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
