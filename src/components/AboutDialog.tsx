import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, Info, X } from 'lucide-react';
import { REQUIRED_CREDITS } from '../data/requiredCredits';
import { SourceCredits } from './SourceCredits';
import { DATA_LICENCES, LICENCE_SHARE_LABEL, LICENCE_STATUS_HELP, LICENCE_STATUS_LABEL, openLicenceQuestions, type LicenceStatus } from '../data/dataLicences';

/**
 * Menu > About & data licences: what the app is, the standing research notice, and the licence
 * register (src/data/dataLicences.ts, the same rows as docs/DATA_LICENCES.md). Opened on a source
 * with `focusId` from the Sources panel.
 */

export const OPEN_ABOUT_EVENT = 'econquest:open-about';

/** Opens Menu > About & data licences from any panel, optionally on one source's row. */
export function openDataLicences(id?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_ABOUT_EVENT, { detail: id ? { id } : undefined }));
}

const STATUS_CLASS: Record<LicenceStatus, string> = {
  open: 'text-emerald-700 dark:text-emerald-400',
  conditions: 'text-blue-700 dark:text-blue-400',
  permission: 'text-amber-700 dark:text-amber-400',
  not_verified: 'text-slate-500 dark:text-slate-400',
};

export function AboutDialog({ focusId, onClose }: { focusId?: string | null; onClose: () => void }) {
  const [open, setOpen] = useState<string | null>(focusId ?? null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    if (focusId) document.getElementById(`licence-${focusId}`)?.scrollIntoView({ block: 'center' });
  }, [focusId]);

  const counts = DATA_LICENCES.reduce<Partial<Record<LicenceStatus, number>>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  const questions = openLicenceQuestions();

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="about-title" className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2 id="about-title" className="ui-title inline-flex items-center gap-2">
            <Info className="w-4 h-4" aria-hidden /> About & data licences
          </h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close about and data licences" className="ui-btn ui-btn-ghost">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto ui-body">
          <p>
            A research workspace for sovereign and macro questions. Figures come only from public feeds, official series or your own
            files, each with its source and date; a figure nobody published reads Missing.
          </p>
          <p className="border border-amber-200 dark:border-amber-800 p-2 text-amber-800 dark:text-amber-300" data-research-notice>
            Research, not validated advice. No model in the app has been independently validated; each signal shows its pre-registered
            backtest verdict under Menu &gt; Models &amp; validation. Nothing here is a recommendation to buy or sell.
          </p>
          <h3 className="ui-section-title">Credits</h3>
          <p>Three sources ask for a visible credit wherever their figures show. The app shows each one beside those figures, and here:</p>
          <ul className="space-y-1" data-about-credits>
            {REQUIRED_CREDITS.map((c) => (
              <li key={c.id}>
                <SourceCredits credits={[c]} className="!text-sm !text-slate-700 dark:!text-slate-200" />
              </li>
            ))}
          </ul>
          <h3 className="ui-section-title">Data licences</h3>
          <p>
            What each source&apos;s own terms say about showing its figures to other people and about commercial use, with the credit it
            asks for. Read on each terms page; where a page could not be read the row says so. A research note, not legal advice. Also in
            docs/DATA_LICENCES.md.
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400" data-licence-counts>
            {(Object.keys(LICENCE_STATUS_LABEL) as LicenceStatus[])
              .filter((s) => counts[s])
              .map((s) => `${counts[s]} ${LICENCE_STATUS_LABEL[s].toLowerCase()}`)
              .join(' · ')}
          </p>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {DATA_LICENCES.map((r) => (
              <li key={r.id} id={`licence-${r.id}`} className="py-2">
                <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id} className="w-full text-left flex items-start justify-between gap-3">
                  <span>
                    <span className="block">{r.name}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{r.usedFor}</span>
                  </span>
                  <span className={`shrink-0 text-xs font-medium ${STATUS_CLASS[r.status]}`} title={LICENCE_STATUS_HELP[r.status]}>
                    {LICENCE_STATUS_LABEL[r.status]}
                  </span>
                </button>
                {open === r.id && (
                  <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                    <dt className="text-slate-500 dark:text-slate-400">Free sharing</dt>
                    <dd data-licence-share={r.share}>
                      {LICENCE_SHARE_LABEL[r.share]}. {r.shareNote}
                    </dd>
                    <dt className="text-slate-500 dark:text-slate-400">Show to others</dt>
                    <dd>{r.display}</dd>
                    <dt className="text-slate-500 dark:text-slate-400">Commercial use</dt>
                    <dd>{r.commercial}</dd>
                    <dt className="text-slate-500 dark:text-slate-400">Credit</dt>
                    <dd>{r.attribution}</dd>
                    {r.flag && (
                      <>
                        <dt className="text-slate-500 dark:text-slate-400">Open question</dt>
                        <dd>{r.flag}</dd>
                      </>
                    )}
                    {r.quotes.length > 0 && (
                      <>
                        <dt className="text-slate-500 dark:text-slate-400">From the terms</dt>
                        <dd className="space-y-1">
                          {r.quotes.map((q) => (
                            <blockquote key={q} className="border-l-2 border-slate-200 dark:border-slate-700 pl-2 italic">
                              {q}
                            </blockquote>
                          ))}
                        </dd>
                      </>
                    )}
                    <dt className="text-slate-500 dark:text-slate-400">Terms read</dt>
                    <dd className="space-x-2">
                      {r.terms.map((t) => (
                        <a key={t.url} href={t.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline">
                          {t.label} <ExternalLink className="w-3 h-3" aria-hidden />
                        </a>
                      ))}
                      <span className="text-slate-400 dark:text-slate-500">checked {r.checked}</span>
                    </dd>
                  </dl>
                )}
              </li>
            ))}
          </ul>
          {questions.length > 0 && (
            <details>
              <summary className="cursor-pointer">Open questions ({questions.length})</summary>
              <ol className="mt-1 list-decimal pl-5 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                {questions.map((r) => (
                  <li key={r.id}>
                    <span className="font-medium">{r.name}:</span> {r.flag}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
