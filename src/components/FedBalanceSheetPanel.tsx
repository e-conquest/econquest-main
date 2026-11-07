import React, { useEffect, useState } from 'react';
import { Landmark } from 'lucide-react';
import type { FedBalanceSheet, FedLine, Obs } from '../utils/fedBalanceSheet';
import { formatPeriod } from '../utils/officialYields';
import { requiredCredit } from '../data/requiredCredits';
import { SourceCredits } from './SourceCredits';

/**
 * Research > Compare countries > Markets & signals: the Federal Reserve balance sheet (H.4.1) from
 * FRED. Each line has its own date; a line that did not load reads Missing with the reason.
 */

const bn = (v: number) => `$${Math.round(v).toLocaleString('en-US')}bn`;
const sg = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString('en-US')}bn`;

const Spark: React.FC<{ points: Obs[]; label: string }> = ({ points, label }) => {
  if (points.length < 2) return null;
  const w = 120;
  const h = 28;
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const d = points.map((p, i) => `${((i / (points.length - 1)) * w).toFixed(1)},${(h - 2 - ((p.value - lo) / span) * (h - 4)).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${label}, ${formatPeriod(points[0].date)} to ${formatPeriod(points[points.length - 1].date)}`} className="text-blue-600 dark:text-blue-400">
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
};

const Row: React.FC<{ line: FedLine }> = ({ line }) => (
  <tr className="border-t border-slate-100 dark:border-slate-800" data-fed-line={line.id}>
    <th scope="row" className="py-1.5 pr-3 text-left font-normal">
      <a href={line.url} target="_blank" rel="noreferrer" className="hover:underline text-slate-800 dark:text-slate-100">
        {line.label}
      </a>
      <div className="text-xs text-slate-500 dark:text-slate-400">
        {line.note}
        {line.latest ? `, ${formatPeriod(line.latest.date)}` : ''}
      </div>
    </th>
    {line.latest ? (
      <>
        <td className="py-1.5 pr-3 text-right tabular-nums font-semibold">{bn(line.latest.value)}</td>
        <td className="py-1.5 pr-3 text-right tabular-nums">{line.change4w !== undefined ? sg(line.change4w) : '–'}</td>
        <td className="py-1.5 pr-3 text-right tabular-nums">{line.change52w !== undefined ? sg(line.change52w) : '–'}</td>
        <td className="py-1.5 hidden sm:table-cell">
          <Spark points={line.points} label={line.label} />
        </td>
      </>
    ) : (
      <td colSpan={4} className="py-1.5 text-sm text-amber-700 dark:text-amber-400" data-missing="true">
        Missing: {line.missing}
      </td>
    )}
  </tr>
);

export const FedBalanceSheetPanel: React.FC = () => {
  const [reply, setReply] = useState<FedBalanceSheet | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/fed-balance-sheet')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: FedBalanceSheet) => live && setReply(b))
      .catch((e: Error) => live && setError(`The Fed balance sheet could not be read (${e.message}).`));
    return () => {
      live = false;
    };
  }, []);

  const net = reply?.netLiquidity;

  return (
    <section className="ui-panel" data-fed-balance-sheet="true" data-no-provenance-overlay="true" data-no-stat-ref="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <Landmark className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Fed balance sheet
        </h2>
        <p className="ui-label">The dollar liquidity backdrop: the Federal Reserve's weekly H.4.1 figures and overnight reverse repos, with changes over 4 and 52 weeks.</p>
      </header>
      <div className="p-4 space-y-3">
        {!reply && !error && <p className="ui-body">Loading…</p>}
        {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}
        {reply && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 dark:text-slate-400">
                    <th scope="col" className="text-left font-normal pb-1">Series</th>
                    <th scope="col" className="text-right font-normal pb-1 pr-3">Latest</th>
                    <th scope="col" className="text-right font-normal pb-1 pr-3">4 weeks</th>
                    <th scope="col" className="text-right font-normal pb-1 pr-3">52 weeks</th>
                    <th scope="col" className="text-left font-normal pb-1 hidden sm:table-cell">Two years</th>
                  </tr>
                </thead>
                <tbody>
                  {reply.lines.map((l) => (
                    <Row key={l.id} line={l} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm" data-net-liquidity="true">
              {net && 'value' in net ? (
                <>
                  <span className="font-semibold">Net liquidity {bn(net.value)}</span> on {formatPeriod(net.date)}
                  {net.change4w !== undefined ? ` (${sg(net.change4w)} over 4 weeks)` : ''}.{' '}
                </>
              ) : (
                <span className="text-amber-700 dark:text-amber-400" data-missing="true">
                  Net liquidity: Missing. {net && 'missing' in net ? net.missing : ''}.{' '}
                </span>
              )}
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Total assets less the Treasury General Account less overnight reverse repos, all on the same Wednesday. A market shorthand, not an official Fed series.
              </span>
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Source: {reply.source}. Figures in billions of US dollars.</p>
            <SourceCredits credits={[requiredCredit('fred')]} />
          </>
        )}
      </div>
    </section>
  );
};
