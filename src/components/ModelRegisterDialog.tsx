/**
 * Menu > Models & validation: the register of every rule that turns figures into a call, with its
 * status. A status other than Not validated / Descriptive / Model-assisted comes only from a
 * pre-registered backtest. See src/data/modelRegister.ts.
 */
import { useEffect, useRef, useState } from 'react';
import { Download, List, Play, ShieldQuestion, Table2, X } from 'lucide-react';
import { MODEL_REGISTER, REGISTER_HEADER, registerRows, STATUS_LABEL, type ValidationStatus } from '../data/modelRegister';
import { ValidationBadge } from './ValidationBadge';
import { TestLedgerTable } from './TestLedgerTable';
import { effectiveStatus, entryGrade, runValidation, useValidation, validationHolm, type ValidationReply } from './useValidation';
import { GRADE_POLICY } from '../utils/evidenceGrade';
import { holmSentence } from '../utils/multipleTesting';
import { forwardSentence } from '../utils/forwardRecord';
import { EXPORT_NOTICE } from '../utils/disclaimer';
import { forecastRegisterStatus, forecastVerdicts } from '../utils/forecastRegister';

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function downloadCsv(v: ValidationReply | null) {
  const holmMap = validationHolm(v);
  const rows = registerRows(MODEL_REGISTER, (id) => {
    const r = v?.results?.[id];
    const g = entryGrade(id, MODEL_REGISTER.find((e) => e.id === id)?.status ?? 'not_validated', v, holmMap);
    const gradeText = g ? ` Evidence grade: ${g.label}. ${g.why}` : '';
    if (r) return { status: r.status, text: `${r.verdict} Test v${r.specVersion}, hash ${r.specHash}, run ${r.ranAt}. ${holmSentence(holmMap.get(`${r.id} v${r.specVersion}`))}${gradeText}`.trim() };
    const fs = forecastRegisterStatus(id, v?.forecasts);
    return fs ? { status: fs, text: forecastVerdicts(id, v?.forecasts).map((x) => `${x.id} v${x.specVersion}: ${x.verdict} Hash ${x.specHash}, run ${x.ranAt}. ${holmSentence(holmMap.get(`forecast ${x.id} v${x.specVersion}`))}`.trim()).join(' ') + gradeText } : undefined;
  });
  const text = '\uFEFF' + [REGISTER_HEADER, ...rows, [EXPORT_NOTICE]].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `econquest-model-register-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ModelRegisterDialog({ focusId, onClose }: { focusId?: string | null; onClose: () => void }) {
  const [open, setOpen] = useState<string | null>(focusId ?? null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    if (focusId) document.getElementById(`register-${focusId}`)?.scrollIntoView({ block: 'center' });
  }, [focusId]);

  const v = useValidation();
  const holmMap = validationHolm(v);
  const [runError, setRunError] = useState<string | null>(null);
  const [view, setView] = useState<'register' | 'record'>('register');
  const counts = MODEL_REGISTER.reduce<Partial<Record<ValidationStatus, number>>>((acc, e) => {
    const s = effectiveStatus(e.id, e.status, v);
    return { ...acc, [s]: (acc[s] ?? 0) + 1 };
  }, {});
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="model-register-title" className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2 id="model-register-title" className="ui-title inline-flex items-center gap-2">
            <ShieldQuestion className="w-4 h-4" aria-hidden /> Models & validation
          </h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close models and validation" className="ui-btn ui-btn-ghost">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto ui-body">
          <p>
            Every rule in the app that turns figures into a call. A rule is marked passed or failed only by a backtest
            whose pass mark was fixed before it ran. Until then it reads Not validated, wherever it shows.
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400" data-register-counts>
            {(Object.keys(STATUS_LABEL) as ValidationStatus[])
              .filter((s) => counts[s])
              .map((s) => `${counts[s]} ${STATUS_LABEL[s].toLowerCase()}`)
              .join(' · ')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={v?.running}
              onClick={async () => {
                setRunError(null);
                setRunError(await runValidation());
              }}
              className="ui-btn ui-btn-primary inline-flex items-center gap-1 disabled:opacity-60"
              data-run-backtests
            >
              <Play className="w-3.5 h-3.5" aria-hidden /> {v?.running ? 'Running backtests…' : 'Run backtests'}
            </button>
            <button type="button" onClick={() => downloadCsv(v)} className="ui-btn ui-btn-ghost inline-flex items-center gap-1">
              <Download className="w-3.5 h-3.5" aria-hidden /> CSV
            </button>
            <button
              type="button"
              onClick={() => setView(view === 'record' ? 'register' : 'record')}
              aria-pressed={view === 'record'}
              className="ui-btn ui-btn-ghost inline-flex items-center gap-1"
              data-test-ledger-toggle
            >
              {view === 'record' ? <List className="w-3.5 h-3.5" aria-hidden /> : <Table2 className="w-3.5 h-3.5" aria-hidden />} {view === 'record' ? 'Register' : 'Track record'}
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400" data-backtest-status>
            {v?.lastRun ? `Backtests last run ${when(v.lastRun.at)}.` : 'Backtests not run yet on this computer.'} They pull the long free histories (BIS policy rates since 1990, OECD leading indicator, CFTC since 2006), so they need a connection and take a minute or two. Same as `npm run backtest`.
          </p>
          {holmMap.size > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400" data-holm-summary>
              {holmMap.size} pre-registered tests on record (every version run, failed ones too). Each verdict below shows its Holm-adjusted p across all of them; {[...holmMap.values()].filter((h) => h.holds).length} hold after the correction. The recorded verdicts are not changed.
            </p>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400" data-grade-policy>
            A pass carries an evidence grade. Validated: it still holds after the correction for every test on record, or {GRADE_POLICY.promoteMonths} months of forward record beat its base rate. Provisional pass: it passed alone but not after the correction. Under review or Withdrawn: once {GRADE_POLICY.minForwardScored} forward calls are scored, a hit rate below the base rate (Withdrawn when significantly below). Review due: the test last ran more than {GRADE_POLICY.reviewMonths} months ago. Backtest figures are hypothetical. Details in docs/METHODS.md.
          </p>
          {runError && <p className="text-rose-600 dark:text-rose-400">{runError}</p>}
          {v?.lastRun?.problems?.length ? <p className="text-amber-700 dark:text-amber-300">Last run: {v.lastRun.problems.join(' · ')}</p> : null}
          {view === 'record' && <TestLedgerTable v={v} holmMap={holmMap} />}
          <ul className={`divide-y divide-slate-100 dark:divide-slate-800 ${view === 'record' ? 'hidden' : ''}`}>
            {MODEL_REGISTER.map((e) => (
              <li key={e.id} id={`register-${e.id}`} className="py-2">
                <div className="flex items-start justify-between gap-3">
                  <button type="button" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id} className="text-left">
                    <span className="block">{e.name}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {e.use} · {e.says}
                    </span>
                  </button>
                  <ValidationBadge id={e.id} />
                </div>
                {open === e.id && (
                  <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                    <dt className="text-slate-500 dark:text-slate-400">Rule</dt>
                    <dd>{e.method}</dd>
                    <dt className="text-slate-500 dark:text-slate-400">Reads</dt>
                    <dd>{e.inputs}</dd>
                    <dt className="text-slate-500 dark:text-slate-400">Shows in</dt>
                    <dd>{e.where}</dd>
                    {(() => {
                      const g = entryGrade(e.id, e.status, v, holmMap);
                      return g ? (
                        <>
                          <dt className="text-slate-500 dark:text-slate-400">Evidence grade</dt>
                          <dd data-evidence-grade-text={g.grade}>
                            {g.label}. {g.why}
                          </dd>
                        </>
                      ) : null;
                    })()}
                    <dt className="text-slate-500 dark:text-slate-400">How it is tested</dt>
                    <dd>{e.testPlan}</dd>
                    <dt className="text-slate-500 dark:text-slate-400">Limits</dt>
                    <dd>{e.limits}</dd>
                    <dt className="text-slate-500 dark:text-slate-400">Code</dt>
                    <dd className="break-all">{e.code}</dd>
                    {(() => {
                      const mine = (v?.specs || []).filter((x) => x.id === e.id || x.file === `${e.id}.json`).sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
                      const spec = mine[0];
                      const earlier = Object.values(v?.versions || {}).filter((x) => x.id === e.id && x.specVersion !== v?.results?.[e.id]?.specVersion).sort((a, b) => b.specVersion - a.specVersion);
                      const r = v?.results?.[e.id];
                      const fv = forecastVerdicts(e.id, v?.forecasts);
                      return (
                        <>
                          {fv.length > 0 && (
                            <>
                              <dt className="text-slate-500 dark:text-slate-400">Evaluation verdicts</dt>
                              <dd data-forecast-verdicts={e.id}>
                                {fv.map((x) => (
                                  <span key={x.id} className="block" data-forecast-verdict={x.id} data-status={x.status}>
                                    <span className="font-medium">{x.id.replace(/_/g, ' ')}</span> (test v{x.specVersion}, run {when(x.ranAt)}): {x.verdict} <span data-holm={`forecast ${x.id} v${x.specVersion}`}>{holmSentence(holmMap.get(`forecast ${x.id} v${x.specVersion}`))}</span>
                                    {x.crash && (
                                      <span className="block text-slate-500 dark:text-slate-400" data-crash-stats={x.id}>
                                        {x.crash}
                                      </span>
                                    )}
                                    {v?.forward?.[`${x.id} v${x.specVersion}`] && (
                                      <span className="block" data-forward-record={x.id}>
                                        {forwardSentence(v.forward[`${x.id} v${x.specVersion}`])}
                                        {v.forward[`${x.id} v${x.specVersion}`].recent.slice(0, 3).map((c) => (
                                          <span key={c.when} className="block text-slate-500 dark:text-slate-400">
                                            {c.when}: {c.what} {c.hit === undefined ? `Open until ${c.due}.` : c.hit ? 'Positive.' : 'Not positive.'}
                                          </span>
                                        ))}
                                      </span>
                                    )}
                                  </span>
                                ))}
                                <span className="block text-slate-400 dark:text-slate-500">{e.id.startsWith('fx_') ? 'docs/validation/signals/ · npm run signals:evaluate · data/local/validation/signals.json' : 'docs/validation/forecasts/ · npm run forecast:evaluate · data/local/validation/forecasts.json'}</span>
                              </dd>
                            </>
                          )}
                          {spec && (
                            <>
                              <dt className="text-slate-500 dark:text-slate-400">Pre-registered test</dt>
                              <dd>
                                {spec.problem ? (
                                  <span className="text-rose-600 dark:text-rose-400">{spec.file}: {spec.problem}.</span>
                                ) : (
                                  <>
                                    Version {spec.version}, registered {spec.registeredOn}
                                    {spec.retestOf ? `, a re-test of version ${spec.retestOf.version}, which ${spec.retestOf.verdict}. What changed: ${spec.retestOf.change}` : ''}. {spec.hypothesis} Pass mark: at least {spec.passMark?.minCases} cases, a lift of {spec.passMark?.minLiftPts} points or more over the base rate, p at or below {spec.passMark?.maxPValue}
                                    {spec.framework === 2 ? `, with p from whole years resampled together, and a positive lift in at least ${Math.round((spec.passMark?.minSeriesShare ?? 0.5) * 100)}% of series (method 2)` : ' (method 1: cases counted as independent)'}. Sample from {spec.sample?.from}.{' '}
                                    <span className="break-all text-slate-400 dark:text-slate-500">docs/validation/preregistered/{spec.file} · SHA-256 {spec.hash}</span>
                                    {spec.knownLimits?.length ? <span className="block mt-1">Known limits, stated before the run: {spec.knownLimits.join(' ')}</span> : null}
                                  </>
                                )}
                              </dd>
                            </>
                          )}
                          {r && (
                            <>
                              <dt className="text-slate-500 dark:text-slate-400">Latest verdict</dt>
                              <dd data-backtest-verdict={e.id}>
                                {r.verdict} {r.series.length} series, {r.span.from} to {r.span.to}. Run {when(r.ranAt)} on test version {r.specVersion}
                                {spec?.hash && spec.hash !== r.specHash ? ' (the test file has changed since: run again)' : ''}.
                                <span className="block" data-holm={`${r.id} v${r.specVersion}`}>{holmSentence(holmMap.get(`${r.id} v${r.specVersion}`))}</span>
                                <span className="block text-slate-400 dark:text-slate-500">{r.data}</span>
                              </dd>
                              {(r.status === 'passed' || v?.forward?.[`${r.id} v${r.specVersion}`]) && (
                                <>
                                  <dt className="text-slate-500 dark:text-slate-400">Forward record</dt>
                                  <dd data-forward-record={e.id}>
                                    {v?.forward?.[`${r.id} v${r.specVersion}`] ? (
                                      <>
                                        {forwardSentence(v.forward[`${r.id} v${r.specVersion}`])}
                                        {v.forward[`${r.id} v${r.specVersion}`].recent.map((c) => (
                                          <span key={`${c.where}-${c.when}`} className="block text-slate-500 dark:text-slate-400">
                                            {c.where} {c.when}: {c.what} {c.hit === undefined ? `Open until ${c.due}.` : c.hit ? 'Followed.' : 'Not followed.'}
                                          </span>
                                        ))}
                                      </>
                                    ) : (
                                      'Passed: from the next run, each new call is written down before its outcome is known and scored when its window ends.'
                                    )}
                                    {v?.forwardCheck && !v.forwardCheck.chainOk && <span className="block text-rose-700 dark:text-rose-400">The forward record file ({v.forwardCheck.file}) has been changed: its hash chain does not hold.</span>}
                                  </dd>
                                </>
                              )}
                              {earlier.length > 0 && (
                                <>
                                  <dt className="text-slate-500 dark:text-slate-400">Earlier versions</dt>
                                  <dd data-backtest-earlier={e.id}>
                                    {earlier.map((x) => (
                                      <span key={x.specVersion} className="block">
                                        Version {x.specVersion}: {x.verdict} {holmSentence(holmMap.get(`${x.id} v${x.specVersion}`))}
                                        {x.robustness && (x.framework ?? 1) === 1 ? ` Stricter check: ${x.robustness.status.replace(/_/g, ' ')}.` : ''}
                                      </span>
                                    ))}
                                  </dd>
                                </>
                              )}
                              {r.robustness && (
                                <>
                                  <dt className="text-slate-500 dark:text-slate-400">{(r.framework ?? 1) === 2 ? 'By series' : 'Stricter check'}</dt>
                                  <dd data-backtest-robustness={e.id}>
                                    {(r.framework ?? 1) === 1 && <span className="block">Method 2: {r.robustness.verdict}</span>}
                                    <span className="block text-slate-500 dark:text-slate-400">
                                      {r.robustness.bySeries.map((b) => `${b.where} ${b.hits}/${b.cases} (${b.liftPts > 0 ? '+' : ''}${b.liftPts})`).join(' · ')}
                                    </span>
                                  </dd>
                                </>
                              )}
                            </>
                          )}
                        </>
                      );
                    })()}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
