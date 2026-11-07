/**
 * Menu > Models & validation > Track record: every pre-registered test on record in one table
 * (src/utils/testLedger.ts), with a CSV download. Failed tests and earlier versions stay listed.
 */
import { Download } from 'lucide-react';
import { ledgerCsvRows, ledgerRows, ledgerSummary, LEDGER_HEADER } from '../utils/testLedger';
import { EXPORT_NOTICE } from '../utils/disclaimer';
import type { HolmReading } from '../utils/multipleTesting';
import type { ValidationReply } from './useValidation';

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const STATUS_TEXT = { passed: 'Passed', failed: 'Failed', too_few_cases: 'Too few cases' } as const;
const STATUS_CLASS = {
  passed: 'text-emerald-700 dark:text-emerald-400',
  failed: 'text-rose-700 dark:text-rose-400',
  too_few_cases: 'text-slate-500 dark:text-slate-400',
} as const;
const TONE_CLASS = { positive: 'text-emerald-700 dark:text-emerald-400', warning: 'text-amber-700 dark:text-amber-300', negative: 'text-rose-700 dark:text-rose-400' } as const;

export function TestLedgerTable({ v, holmMap }: { v: ValidationReply | null; holmMap: Map<string, HolmReading> }) {
  const rows = ledgerRows(v, holmMap);
  const download = () => {
    const text = '﻿' + [LEDGER_HEADER, ...ledgerCsvRows(rows), [EXPORT_NOTICE]].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `econquest-test-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const day = (iso?: string) => (iso ? iso.slice(0, 10) : '');
  return (
    <section data-test-ledger className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500 dark:text-slate-400" data-test-ledger-summary>
          {ledgerSummary(rows)}
        </p>
        {rows.length > 0 && (
          <button type="button" onClick={download} className="ui-btn ui-btn-ghost inline-flex items-center gap-1" data-test-ledger-csv>
            <Download className="w-3.5 h-3.5" aria-hidden /> CSV
          </button>
        )}
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-1 pr-2 font-normal">Test</th>
                <th className="py-1 pr-2 font-normal">Registered</th>
                <th className="py-1 pr-2 font-normal">Last run</th>
                <th className="py-1 pr-2 font-normal">Verdict</th>
                <th className="py-1 pr-2 font-normal text-right">Raw p</th>
                <th className="py-1 pr-2 font-normal text-right">Holm p</th>
                <th className="py-1 pr-2 font-normal">Grade</th>
                <th className="py-1 font-normal">Forward record</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r) => (
                <tr key={r.key} data-ledger-row={r.key} data-status={r.status} className={r.latest ? '' : 'text-slate-500 dark:text-slate-400'}>
                  <td className="py-1 pr-2 align-top">
                    <span className="block">{r.id.replace(/_/g, ' ')} v{r.version}</span>
                    <span className="block text-slate-400 dark:text-slate-500">
                      {r.kind}
                      {r.latest ? '' : ', earlier version'}
                      {r.hash ? <span title={`SHA-256 ${r.hash}`}> · {r.hash.slice(0, 8)}</span> : null}
                    </span>
                  </td>
                  <td className="py-1 pr-2 align-top whitespace-nowrap">{r.registeredOn || '–'}</td>
                  <td className="py-1 pr-2 align-top whitespace-nowrap">{day(r.ranAt) || '–'}</td>
                  <td className={`py-1 pr-2 align-top whitespace-nowrap ${STATUS_CLASS[r.status]}`} title={r.verdict}>
                    {STATUS_TEXT[r.status]}
                  </td>
                  <td className="py-1 pr-2 align-top text-right tabular-nums">{r.rawP === undefined ? '–' : Number(r.rawP.toPrecision(3))}</td>
                  <td className="py-1 pr-2 align-top text-right tabular-nums" title={r.alpha === undefined ? undefined : `Pass mark ${r.alpha}`}>
                    {r.holmP === undefined ? '–' : `${r.holmP}${r.holds ? ' ✓' : ''}`}
                  </td>
                  <td className={`py-1 pr-2 align-top ${r.grade ? TONE_CLASS[r.grade.tone] : ''}`} title={r.grade?.why}>
                    {r.grade?.label || '–'}
                  </td>
                  <td className="py-1 align-top">
                    {r.forward
                      ? r.forward.scored > 0
                        ? `${r.forward.hits}/${r.forward.scored} (${r.forward.hitRatePct}% vs base ${r.forward.baseRatePct}%)${r.forward.pending ? `, ${r.forward.pending} open` : ''}`
                        : `${r.forward.pending} open, none scored`
                      : r.status === 'passed'
                        ? 'Starts at next run'
                        : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Holm p is adjusted across every test in this table; a tick means it is still at or below that test's own pass mark. Greyed rows are earlier versions, kept on record. Hover a verdict for its full text and a grade for why. Backtest figures are hypothetical.
      </p>
    </section>
  );
}
