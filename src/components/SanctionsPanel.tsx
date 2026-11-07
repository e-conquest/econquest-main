import React, { useEffect, useState } from 'react';
import { Ban } from 'lucide-react';
import { ValidationBadge } from './ValidationBadge';
import type { CountrySanctions, SanctionsEntry, SanctionsData } from '../utils/sanctionsLists';
import { SANCTIONS_LISTS } from '../utils/sanctionsLists';

/**
 * Country Research > History & data > Sanctions lists (src/utils/sanctionsLists.ts): OFAC and UN
 * entries tied to the country by address or nationality, by programme, and a plain-text name search.
 */

type Reply =
  | ({ ok: true; sentence: string; method: string; files: SanctionsData['files']; skipped: SanctionsData['skipped']; unknownCountries: Array<[string, number]> } & CountrySanctions)
  | { ok: false; reason: string; method: string; skipped?: SanctionsData['skipped'] };

const TYPE_LABEL: Record<string, string> = { individual: 'people', entity: 'firms and bodies', vessel: 'vessels', aircraft: 'aircraft' };

export const SanctionsPanel: React.FC<{ iso3: string; countryName: string }> = ({ iso3, countryName }) => {
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<SanctionsEntry[] | null>(null);

  useEffect(() => {
    let live = true;
    setReply(null);
    setError(null);
    fetch(`/api/sanctions/${encodeURIComponent(iso3)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: Reply) => live && setReply(b))
      .catch((e: Error) => live && setError(`The sanctions lists could not be read (${e.message}).`));
    return () => {
      live = false;
    };
  }, [iso3]);

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    fetch(`/api/sanctions-search?q=${encodeURIComponent(q.trim())}`)
      .then((r) => r.json())
      .then((b: { matches: SanctionsEntry[] }) => setMatches(b.matches || []))
      .catch(() => setMatches([]));
  };

  return (
    <section className="ui-panel" data-sanctions="true" data-no-provenance-overlay="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <Ban className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Sanctions lists, {countryName}
          <ValidationBadge id="sanctions_lists" />
        </h2>
        <p className="ui-label">People, firms, vessels and aircraft on the OFAC and UN sanctions lists with an address or nationality in the country. Not a compliance screen.</p>
      </header>
      <div className="p-4 space-y-3">
        {!reply && !error && <p className="ui-body">Loading…</p>}
        {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}
        {reply && !reply.ok && (
          <p className="text-sm text-amber-700 dark:text-amber-400" data-missing="true">
            Missing: {reply.reason}.{reply.skipped?.length ? ` Not read: ${reply.skipped.map((s) => `${s.file} (${s.reason})`).join('; ')}.` : ''}
          </p>
        )}
        {reply?.ok && (
          <>
            <p className="text-sm text-slate-900 dark:text-white" data-sanctions-sentence="true">{reply.sentence}</p>
            <table className="text-xs">
              <tbody>
                {reply.byList.map((l) => (
                  <tr key={l.list} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-0.5 pr-4 text-slate-500 dark:text-slate-400">{SANCTIONS_LISTS[l.list].name}</td>
                    <td className="py-0.5 pr-4 tabular-nums text-right">{l.entries}</td>
                    <td className="py-0.5 text-slate-500">{Object.entries(l.byType).map(([t, n]) => `${n} ${TYPE_LABEL[t] || t}`).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {reply.programs.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-slate-900 dark:text-white">Programmes</h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                  {reply.programs.map((p) => `${p.program} (${SANCTIONS_LISTS[p.list].short}) ${p.entries}`).join(' · ')}
                </p>
              </div>
            )}
            {reply.unListedByYear.length > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                UN entries by year first listed: {reply.unListedByYear.map((y) => `${y.year} ${y.entries}`).join(', ')}.
              </p>
            )}
            <form className="flex gap-2 items-center" onSubmit={search}>
              <input type="search" className="flex-1 px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white" aria-label="Search names on the lists" placeholder="Search names on all lists" value={q} onChange={(e) => setQ(e.target.value)} />
              <button type="submit" className="ui-btn text-xs">Search</button>
            </form>
            {matches && (
              <div className="text-xs" data-sanctions-matches="true">
                {matches.length === 0 ? (
                  <p className="text-slate-500">No listed name holds every word of the search. That does not clear a name: the lists' aliases and spellings are not searched.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {matches.map((m) => (
                      <li key={`${m.list}-${m.id}`}>
                        {m.name} <span className="text-slate-500">({SANCTIONS_LISTS[m.list].short} {m.id}; {m.type}; {m.programs.join(', ') || 'no programme'}{m.countries.length ? `; ${m.countries.join(', ')}` : ''})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Files read: {reply.files.map((f) => `${f.file} (${f.entries} entries${f.modified ? `, ${f.modified}` : ''})`).join('; ')}.
              {reply.skipped.length ? ` Not read: ${reply.skipped.map((s) => `${s.file} (${s.reason})`).join('; ')}.` : ''}
              {reply.unknownCountries.length ? ` Country names not matched: ${reply.unknownCountries.map(([n, k]) => `${n} (${k})`).join(', ')}.` : ''}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Method: {reply.method} Description, not a tested signal.</p>
          </>
        )}
      </div>
    </section>
  );
};
