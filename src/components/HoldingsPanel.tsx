import React, { useRef, useState } from 'react';
import { Download, Plus, Trash2, Upload } from 'lucide-react';
import {
  ASSET_CLASS_LABEL,
  HOLDINGS_TEMPLATE_CSV,
  type CountryLookup,
  type Holding,
  type HoldingAssetClass,
  type HoldingSide,
  holdingsToCsv,
  newHoldingId,
  parseHoldingsCsv,
} from '../utils/holdings';

interface HoldingsPanelProps {
  holdings: Holding[];
  countries: CountryLookup[];
  onChange: (next: Holding[]) => void;
  onClose: () => void;
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const inputCls =
  'px-2 py-1 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white min-w-0';

export const HoldingsPanel: React.FC<HoldingsPanelProps> = ({ holdings, countries, onChange, onClose }) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pasted, setPasted] = useState('');
  const [mode, setMode] = useState<'replace' | 'append'>(holdings.length ? 'append' : 'replace');
  const [confirmClear, setConfirmClear] = useState(false);
  const [messages, setMessages] = useState<{ ok?: string; errors: string[] }>({ errors: [] });
  const [draft, setDraft] = useState({
    iso3: countries[0]?.iso3 || '',
    instrument: '',
    assetClass: 'HC_BOND' as HoldingAssetClass,
    side: 'LONG' as HoldingSide,
    notional: '',
    duration: '',
  });

  const importText = (text: string) => {
    const { holdings: parsed, errors } = parseHoldingsCsv(text, countries);
    if (parsed.length) onChange(mode === 'replace' ? parsed : [...holdings, ...parsed]);
    setMessages({
      ok: parsed.length ? `Imported ${parsed.length} position${parsed.length === 1 ? '' : 's'}.` : undefined,
      errors: errors.slice(0, 8).concat(errors.length > 8 ? [`…and ${errors.length - 8} more.`] : []),
    });
    if (parsed.length) setPasted('');
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    importText(await f.text());
    if (fileRef.current) fileRef.current.value = '';
  };

  const addDraft = () => {
    const n = Number(draft.notional);
    const d = Number(draft.duration);
    if (!draft.iso3 || !Number.isFinite(n) || n <= 0) {
      setMessages({ errors: ['Pick a country and enter a notional above zero (USD millions).'] });
      return;
    }
    onChange([
      ...holdings,
      {
        id: newHoldingId(),
        iso3: draft.iso3,
        instrument: draft.instrument.trim() || `${draft.iso3} position`,
        assetClass: draft.assetClass,
        side: draft.side,
        notionalUsdMm: n,
        durationYears: draft.duration && Number.isFinite(d) && d > 0 ? d : undefined,
      },
    ]);
    setDraft({ ...draft, instrument: '', notional: '', duration: '' });
    setMessages({ ok: 'Position added.', errors: [] });
  };

  return (
    <section className="ui-panel" aria-label="Holdings" data-no-stat-ref="true" data-no-provenance-overlay="true">
      <header className="ui-panel-header flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="ui-section-title">Holdings</h2>
          <p className="ui-label">Saved on this computer in data/local/workspace.json, shared by Docker and npm run dev. Nothing leaves your machine.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="ui-btn" onClick={() => downloadText('econquest-holdings-template.csv', HOLDINGS_TEMPLATE_CSV)}>
            <Download className="w-3.5 h-3.5" /> Template
          </button>
          {holdings.length > 0 && (
            <button type="button" className="ui-btn" onClick={() => downloadText('econquest-holdings.csv', holdingsToCsv(holdings))}>
              <Download className="w-3.5 h-3.5" /> Export
            </button>
          )}
          <button type="button" className="ui-btn ui-btn-ghost" onClick={onClose}>
            Done
          </button>
        </div>
      </header>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="ui-section-title">Import a CSV</div>
            <p className="ui-label">
              Columns: country (ISO3 or name), instrument, type (hc_bond, lc_bond, cds, fx), side (long or short),
              notional_usd_mm, duration. Only country and notional are required. For CDS, long means you bought protection.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="ui-label inline-flex items-center gap-1.5">
                <input type="radio" name="hold-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace current
              </label>
              <label className="ui-label inline-flex items-center gap-1.5">
                <input type="radio" name="hold-mode" checked={mode === 'append'} onChange={() => setMode('append')} /> Add to current
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.txt,text/csv"
                className="sr-only"
                id="holdings-file"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              <label htmlFor="holdings-file" className="ui-btn ui-btn-primary cursor-pointer">
                <Upload className="w-3.5 h-3.5" /> Upload CSV
              </label>
            </div>
            <label htmlFor="holdings-paste" className="ui-label block">
              Or paste rows (including the header line)
            </label>
            <textarea
              id="holdings-paste"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={4}
              placeholder={HOLDINGS_TEMPLATE_CSV}
              className={`${inputCls} w-full font-code text-xs`}
            />
            <button type="button" className="ui-btn" disabled={!pasted.trim()} onClick={() => importText(pasted)}>
              Import pasted rows
            </button>
          </div>

          <div className="space-y-2">
            <div className="ui-section-title">Add one position</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="ui-label space-y-0.5">
                <span className="block">Country</span>
                <select className={`${inputCls} w-full`} value={draft.iso3} onChange={(e) => setDraft({ ...draft, iso3: e.target.value })}>
                  {countries.map((c) => (
                    <option key={c.iso3} value={c.iso3}>
                      {c.countryName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ui-label space-y-0.5">
                <span className="block">Type</span>
                <select
                  className={`${inputCls} w-full`}
                  value={draft.assetClass}
                  onChange={(e) => setDraft({ ...draft, assetClass: e.target.value as HoldingAssetClass })}
                >
                  {(Object.keys(ASSET_CLASS_LABEL) as HoldingAssetClass[]).map((k) => (
                    <option key={k} value={k}>
                      {ASSET_CLASS_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ui-label space-y-0.5 col-span-2">
                <span className="block">Instrument</span>
                <input
                  className={`${inputCls} w-full`}
                  value={draft.instrument}
                  placeholder="e.g. BRAZIL 6.125% 2034"
                  onChange={(e) => setDraft({ ...draft, instrument: e.target.value })}
                />
              </label>
              <label className="ui-label space-y-0.5">
                <span className="block">Side</span>
                <select className={`${inputCls} w-full`} value={draft.side} onChange={(e) => setDraft({ ...draft, side: e.target.value as HoldingSide })}>
                  <option value="LONG">Long</option>
                  <option value="SHORT">Short</option>
                </select>
              </label>
              <label className="ui-label space-y-0.5">
                <span className="block">Notional (USD mm)</span>
                <input
                  className={`${inputCls} w-full`}
                  inputMode="decimal"
                  value={draft.notional}
                  onChange={(e) => setDraft({ ...draft, notional: e.target.value })}
                />
              </label>
              <label className="ui-label space-y-0.5">
                <span className="block">Duration (years, optional)</span>
                <input
                  className={`${inputCls} w-full`}
                  inputMode="decimal"
                  value={draft.duration}
                  onChange={(e) => setDraft({ ...draft, duration: e.target.value })}
                />
              </label>
              <div className="flex items-end">
                <button type="button" className="ui-btn w-full" onClick={addDraft}>
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              </div>
            </div>
          </div>
        </div>

        {(messages.ok || messages.errors.length > 0) && (
          <div role="status" className="space-y-1">
            {messages.ok && <p className="text-sm text-emerald-700 dark:text-emerald-300">{messages.ok}</p>}
            {messages.errors.map((e) => (
              <p key={e} className="text-sm text-rose-700 dark:text-rose-300">
                {e}
              </p>
            ))}
          </div>
        )}

        {holdings.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="ui-label text-left pb-1">{holdings.length} positions</caption>
              <thead>
                <tr className="ui-label text-left border-b border-slate-100 dark:border-slate-800">
                  <th className="py-1.5 pr-3 font-normal">Country</th>
                  <th className="py-1.5 pr-3 font-normal">Instrument</th>
                  <th className="py-1.5 pr-3 font-normal">Type</th>
                  <th className="py-1.5 pr-3 font-normal">Side</th>
                  <th className="py-1.5 pr-3 font-normal text-right">Notional ($mm)</th>
                  <th className="py-1.5 pr-3 font-normal text-right">Duration</th>
                  <th className="py-1.5 font-normal" aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => (
                  <tr key={h.id} className="border-b border-slate-50 dark:border-slate-800/60">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{countries.find((c) => c.iso3 === h.iso3)?.countryName || h.iso3}</td>
                    <td className="py-1.5 pr-3">{h.instrument}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{ASSET_CLASS_LABEL[h.assetClass]}</td>
                    <td className="py-1.5 pr-3">{h.side === 'LONG' ? 'Long' : 'Short'}</td>
                    <td className="py-1.5 pr-3 text-right ui-num">{h.notionalUsdMm.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className="py-1.5 pr-3 text-right ui-num">{h.durationYears ? h.durationYears.toFixed(1) : '–'}</td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        className="ui-btn ui-btn-ghost"
                        aria-label={`Remove ${h.instrument}`}
                        onClick={() => onChange(holdings.filter((x) => x.id !== h.id))}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              className="ui-btn ui-btn-ghost mt-2 text-rose-700 dark:text-rose-300"
              onClick={() => {
                if (!confirmClear) {
                  setConfirmClear(true);
                  return;
                }
                onChange([]);
                setConfirmClear(false);
              }}
              onBlur={() => setConfirmClear(false)}
            >
              {confirmClear ? 'Click again to remove all positions' : 'Remove all positions'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
};
