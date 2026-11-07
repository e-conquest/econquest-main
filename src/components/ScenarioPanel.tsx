import React, { useEffect, useMemo, useState } from 'react';
import { ValidationBadge } from './ValidationBadge';
import { Globe2 } from 'lucide-react';
import { applyScenario, scenarioSentence, type FactorId, type ResponseId, type ScenarioModelOutcome } from '../utils/scenarioEngine';
import { explainInChat } from '../utils/explainHandoff';
import type { GrVarOutcome } from '../utils/grVar';

/**
 * Country Research > History & data > Global shock scenarios (src/utils/scenarioEngine.ts): the
 * country's currency and policy rate on the US policy rate and the dollar, fitted on monthly moves;
 * stated shocks are applied here so the numbers change as you type.
 */

interface Reply {
  iso3: string;
  name: string;
  models: ScenarioModelOutcome[];
  presets: Array<{ id: string; label: string; shock: Partial<Record<FactorId, number>> }>;
  factors: Array<{ id: FactorId; label: string; unit: string }>;
  responses: Record<ResponseId, { label: string; unit: string; note: string }>;
  missingFactors: string[];
  stress?: { key: string; choices: Array<{ key: string; label: string }> };
  method: string;
  sources: string[];
  grVar?: (Extract<GrVarOutcome, { ok: true }> & { sentence: string; method: string; file?: string }) | { ok: false; reason: string; method: string };
}

const f = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const sg = (v: number, d: number) => `${v >= 0 ? '+' : ''}${f(v, d)}`;

export const ScenarioPanel: React.FC<{ iso3: string; countryName: string }> = ({ iso3, countryName }) => {
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState('tight');
  const [stressKey, setStressKey] = useState('stlfsi');
  const [shock, setShock] = useState<Partial<Record<FactorId, number>>>({ us_rate: 1, dollar: 5 });

  useEffect(() => {
    let live = true;
    setReply(null);
    setError(null);
    fetch(`/api/scenario/${encodeURIComponent(iso3)}?stress=${encodeURIComponent(stressKey)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: Reply) => live && setReply(b))
      .catch((e: Error) => live && setError(`The scenario models could not be read (${e.message}).`));
    return () => {
      live = false;
    };
  }, [iso3, stressKey]);

  const fitted = useMemo(() => (reply?.models || []).filter((m): m is Extract<ScenarioModelOutcome, { ok: true }> => m.ok), [reply]);
  const results = useMemo(() => fitted.map((m) => ({ m, r: applyScenario(m, shock) })), [fitted, shock]);
  const label = reply?.presets.find((p) => p.id === preset)?.label || 'Your scenario';

  return (
    <section className="ui-panel" data-scenario="true" data-no-provenance-overlay="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <Globe2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Global shock scenarios, {countryName}
          <ValidationBadge id="global_scenarios" />
          {results.length > 0 && reply && (
            <button
              type="button"
              className="ui-btn ml-auto text-xs"
              data-explain-panel="true"
              onClick={() =>
                explainInChat({
                  kind: 'panel',
                  label: `Global shock scenario "${label}", ${countryName}`,
                  value: scenarioSentence(countryName, label, results.map((x) => x.r)),
                  source: reply.sources.join('; '),
                  iso3,
                  countryName,
                  detail: [reply.method, ...results.map(({ m }) => `${reply.responses[m.response].label}: ${m.factors.map((id, k) => `${id} ${m.beta[k]} (s.e. ${m.se[k]})`).join(', ')}; R² ${m.r2}, ${m.from} to ${m.to}`)],
                })
              }
            >
              Explain
            </button>
          )}
        </h2>
        <p className="ui-label">If the Fed moves, the dollar swings, US financial stress rises or supply chains tighten, how have this country's currency and policy rate moved with it? Fitted on the last 15 years of monthly moves; co-movement, not a forecast.</p>
      </header>
      <div className="p-4 space-y-3">
        {!reply && !error && <p className="ui-body">Loading…</p>}
        {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}
        {reply && (
          <>
            {reply.stress && (
              <label className="ui-label flex items-center gap-2" data-scenario-stress="true">
                Financial stress index
                <select className="px-2 py-1 text-xs border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white" value={stressKey} onChange={(e) => setStressKey(e.target.value)}>
                  {reply.stress.choices.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              {reply.presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="ui-pill"
                  aria-pressed={preset === p.id}
                  onClick={() => {
                    setPreset(p.id);
                    setShock(p.shock);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              {reply.factors.map((fa) => (
                <label key={fa.id} className="flex items-center gap-2">
                  <span className="text-slate-500 dark:text-slate-400">{fa.label}</span>
                  <input
                    type="number"
                    step={fa.unit === 'pts' ? 0.25 : 1}
                    className="w-20 px-2 py-1 text-sm tabular-nums border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                    value={shock[fa.id] ?? 0}
                    onChange={(e) => {
                      setPreset('custom');
                      setShock({ ...shock, [fa.id]: Number(e.target.value) || 0 });
                    }}
                  />
                  <span className="text-slate-500 dark:text-slate-400">{fa.unit}</span>
                </label>
              ))}
            </div>
            {results.length > 0 && <p className="text-sm text-slate-900 dark:text-white" data-scenario-sentence="true">{scenarioSentence(countryName, label, results.map((x) => x.r))}</p>}
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-left text-slate-500 dark:text-slate-400">
                  <th className="py-1 pr-3 font-medium">Response</th>
                  <th className="py-1 pr-3 font-medium text-right">Implied move</th>
                  <th className="py-1 pr-3 font-medium text-right">90% band</th>
                  <th className="py-1 pr-3 font-medium text-right">Typical month (residual s.d.)</th>
                  <th className="py-1 font-medium">Fit</th>
                </tr>
              </thead>
              <tbody>
                {reply.models.map((m) => {
                  const meta = reply.responses[m.response];
                  if (!m.ok) {
                    return (
                      <tr key={m.response} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="py-0.5 pr-3">{meta.label}</td>
                        <td colSpan={4} className="py-0.5 text-amber-700 dark:text-amber-400" data-missing="true">Missing: {m.reason}</td>
                      </tr>
                    );
                  }
                  const r = applyScenario(m, shock);
                  const d = m.response === 'fx' ? 1 : 2;
                  return (
                    <tr key={m.response} className="border-t border-slate-100 dark:border-slate-800" data-scenario-response={m.response}>
                      <td className="py-0.5 pr-3">{meta.label} <span className="text-slate-500">({meta.note})</span></td>
                      <td className="py-0.5 pr-3 text-right">{sg(r.value, d)} {meta.unit}</td>
                      <td className="py-0.5 pr-3 text-right">{f(r.lo, d)} to {f(r.hi, d)}</td>
                      <td className="py-0.5 pr-3 text-right">±{f(m.residualSd, d)} {meta.unit}</td>
                      <td className="py-0.5 text-slate-500 dark:text-slate-400">
                        {m.factors.map((id, k) => `${reply.factors.find((x) => x.id === id)?.label}: ${sg(m.beta[k], 2)} (s.e. ${f(m.se[k], 2)})`).join('; ')}; R² {f(m.r2, 2)}, {m.from} to {m.to}
                        {r.beyondSample.length > 0 && <span className="text-amber-700 dark:text-amber-400"> Shock larger than any month in the sample: extrapolation.</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {reply.missingFactors.length > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400" data-missing="true">
                Missing factors: {reply.missingFactors.join('; ')}.
              </p>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Method: {reply.method} The dollar factor is euros per dollar, not a trade-weighted index. Oil is not a factor yet: only five years of monthly prices are saved. Financial stress is the index picked above (zero = average, up = more stress or tighter conditions); supply chain pressure is the NY Fed GSCPI (standard deviations, up = more pressure). Each index can also be charted and tested in the Chart Agent. Sources: {reply.sources.join('; ')}.
            </p>
            {reply.grVar && (
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2" data-gr-var="true">
                <h3 className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-2">
                  Geopolitical risk VaR
                  <ValidationBadge id="gr_var" />
                </h3>
                {!reply.grVar.ok ? (
                  <p className="text-xs text-amber-700 dark:text-amber-400" data-missing="true">Missing: {reply.grVar.reason}.</p>
                ) : (
                  <>
                    <p className="text-sm text-slate-900 dark:text-white" data-gr-var-sentence="true">{reply.grVar.sentence}</p>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-slate-500 dark:text-slate-400">
                          <th className="py-1 pr-3 font-medium">Stress months by</th>
                          <th className="py-1 pr-3 font-medium text-right">Months</th>
                          <th className="py-1 pr-3 font-medium text-right">95% VaR, stress / all</th>
                          <th className="py-1 pr-3 font-medium text-right">Expected shortfall, stress / all</th>
                          <th className="py-1 font-medium text-right">Global channels imply</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reply.grVar.blocks.map((b) => (
                          <tr key={b.basis} className="border-t border-slate-100 dark:border-slate-800 tabular-nums">
                            <td className="py-0.5 pr-3">{b.basis === 'world' ? 'World GPR' : 'Country GPR'} ≥ {f(b.threshold, 1)}</td>
                            <td className="py-0.5 pr-3 text-right">{b.stress.months} of {b.all.months}</td>
                            <td className="py-0.5 pr-3 text-right">{sg(b.stress.var95, 1)}% / {sg(b.all.var95, 1)}%</td>
                            <td className="py-0.5 pr-3 text-right">{sg(b.stress.es95, 1)}% / {sg(b.all.es95, 1)}%</td>
                            <td className="py-0.5 text-right">{b.scenario ? `${sg(b.scenario.value, 1)}% (${f(b.scenario.lo, 1)} to ${f(b.scenario.hi, 1)})` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Positive = weaker currency against the US dollar, monthly. Latest stress months: {reply.grVar.blocks[0].recentStress.join(', ')}.{reply.grVar.notes.length ? ` Not shown: ${reply.grVar.notes.join('; ')}.` : ''} Method: {reply.grVar.method} GPR file: {reply.grVar.file || '—'}. Description, not a tested signal.
                    </p>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
};
