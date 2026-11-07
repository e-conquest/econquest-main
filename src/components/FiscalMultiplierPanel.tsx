import React, { useMemo } from 'react';
import { Scale } from 'lucide-react';
import type { WatchlistItem } from '../types/council';
import { multiplierView } from '../utils/fiscalMultipliers';
import { explainInChat } from '../utils/explainHandoff';

/**
 * Country Research > History & data > Fiscal multipliers: where the country sits in the IMF
 * bucket approach on the figures the app holds, what it cannot judge, and the published ranges.
 * A cited reference, not an estimate.
 */
export const FiscalMultiplierPanel: React.FC<{ iso3: string; countryName: string; item?: WatchlistItem }> = ({ iso3, countryName, item }) => {
  const mv = useMemo(
    () =>
      multiplierView({
        iso3,
        ...(item?.fiscal?.debtPctGdp ? { debtPctGdp: item.fiscal.debtPctGdp } : {}),
        ...(item?.outputGap ? { outputGap: item.outputGap } : {}),
        ...(item?.policyRateSource === 'bis' && item.policyRatePct !== undefined ? { policyRatePct: item.policyRatePct } : {}),
      }),
    [iso3, item],
  );
  return (
    <section className="ui-panel" data-multipliers="true" data-no-provenance-overlay="true" data-no-stat-ref="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <Scale className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Fiscal multipliers, {countryName}
          <button
            type="button"
            className="ui-btn ml-auto text-xs"
            data-explain-panel="true"
            onClick={() =>
              explainInChat({
                kind: 'panel',
                label: `Fiscal multipliers, ${countryName}`,
                value: `${mv.guide.low} to ${mv.guide.high} first year, normal times (${mv.guide.bucket} bucket)`,
                source: mv.method,
                iso3,
                countryName,
                detail: [`Trough ${mv.cycle.trough.low} to ${mv.cycle.trough.high}; peak ${mv.cycle.peak.low} to ${mv.cycle.peak.high}`, mv.cycle.note, ...mv.literature.slice(0, 5).map((l) => `${l.finding}: ${l.value} [${l.source}]`)],
              })
            }
          >
            Explain
          </button>
        </h2>
        <p className="ui-label">How much output moves per unit of fiscal tightening or stimulus in the first year. Published reference ranges, not an estimate for this country.</p>
      </header>
      <div className="p-4 space-y-3">
        <p className="text-sm text-slate-900 dark:text-white" data-multiplier-sentence="true">
          {mv.sentence}
        </p>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm tabular-nums">
          <div title={mv.guide.why}>
            <dt className="ui-label">Normal times ({mv.guide.bucket} bucket)</dt>
            <dd className="text-slate-900 dark:text-white">
              {mv.guide.low} to {mv.guide.high}
            </dd>
          </div>
          <div>
            <dt className="ui-label">At the trough of the cycle (+60%)</dt>
            <dd className="text-slate-900 dark:text-white">
              {mv.cycle.trough.low} to {mv.cycle.trough.high}
            </dd>
          </div>
          <div>
            <dt className="ui-label">At the peak (−40%)</dt>
            <dd className="text-slate-900 dark:text-white">
              {mv.cycle.peak.low} to {mv.cycle.peak.high}
            </dd>
          </div>
          <div title={mv.lowerBound?.why}>
            <dt className="ui-label">At the lower bound for rates (+30%)</dt>
            <dd className="text-slate-900 dark:text-white">{mv.lowerBound ? `${mv.lowerBound.low} to ${mv.lowerBound.high}` : 'Does not apply'}</dd>
          </div>
        </dl>
        <p className="text-xs text-slate-600 dark:text-slate-300">{mv.cycle.note}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-multiplier-characteristics="true">
            <thead>
              <tr className="text-left text-slate-500 dark:text-slate-400">
                <th className="py-1 pr-3">Characteristic (1 point each)</th>
                <th className="py-1 pr-3">Point</th>
                <th className="py-1 pr-3">Why</th>
              </tr>
            </thead>
            <tbody>
              {mv.characteristics.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 dark:border-slate-800 align-top">
                  <td className="py-1 pr-3 text-slate-900 dark:text-white">{c.label}</td>
                  <td className="py-1 pr-3 tabular-nums">{c.point === undefined ? 'Not known' : c.point}</td>
                  <td className="py-1 pr-3 text-xs text-slate-600 dark:text-slate-300">{c.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Score {mv.score.min === mv.score.max ? mv.score.min : `${mv.score.min} to ${mv.score.max}`} of 6 → {mv.normal.buckets.join(' / ')} ({mv.normal.low} to {mv.normal.high}). Score 0-3 = low, 3-4 = medium, 4-6 = large.
          </p>
        </div>
        <details className="text-xs text-slate-500 dark:text-slate-400" open>
          <summary className="cursor-pointer">Published ranges</summary>
          <ul className="mt-1 space-y-1">
            {mv.literature.map((l) => (
              <li key={l.id}>
                <span className="text-slate-900 dark:text-white">{l.finding}:</span> {l.value}. <span className="italic">{l.source}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1">{mv.method}</p>
        </details>
      </div>
    </section>
  );
};
