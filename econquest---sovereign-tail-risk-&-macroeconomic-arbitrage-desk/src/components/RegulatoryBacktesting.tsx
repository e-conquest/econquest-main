import React, { useMemo, useState } from 'react';
import { getBacktestValidation } from '../math/backtesting';
import { FITTED_MODELS } from '../math/fittedModels';
import { computeLossBacktest, parseLossHistory, LossBacktest } from '../math/backtesting';

export const RegulatoryBacktesting: React.FC = () => {
  const backtest = useMemo(() => getBacktestValidation(), []);
  const [lossBacktest, setLossBacktest] = useState<LossBacktest | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [filename, setFilename] = useState('');
  const beatsBaseline = backtest.models.blend.brier < backtest.models.constantTrainingRate.brier &&
    backtest.models.blend.logLoss < backtest.models.constantTrainingRate.logLoss;

  const importLosses = async (file: File) => {
    try {
      const rows = parseLossHistory(JSON.parse(await file.text()));
      const results = computeLossBacktest(rows);
      setLossBacktest(results);
      setFilename(file.name);
      setImportError(null);
    } catch (error) {
      console.error('Historical loss backtest import failed:', error);
      setLossBacktest(null);
      setFilename('');
      setImportError(error instanceof Error ? error.message : 'Invalid historical loss backtest.');
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-amber-500/30 bg-[#0e1524] p-4">
        <h2 className="text-lg font-bold text-amber-300">Historical Default-Model Evaluation — Research Only</h2>
        <p className="mt-2 text-xs text-slate-300">
          Model {backtest.modelVersion}. Metrics below are recalculated in the browser from
          {' '}{backtest.rows} held-out country-year predictor rows and their observed next-year outcomes,
          not fixed display values. Predictor years {backtest.predictorYears.join('–')};
          outcome years {backtest.outcomeYears.join('–')}; {backtest.events} default onsets.
          Validation-selected LightGBM weight: {FITTED_MODELS.hazard.lightgbmWeight.toFixed(2)}.
          {' '}{beatsBaseline
            ? 'The blend beats the constant-rate baseline on Brier/log loss but remains research-only.'
            : 'The blend does not consistently beat the constant-rate baseline on Brier/log loss.'}
        </p>
        <p className="mt-2 text-xs text-amber-200">
          This is a retrospective temporal holdout using revised macro data, not a point-in-time forecast archive.
          It evaluates Layer 1 only, not the heuristic Bayesian/VaR layers or the full desk.
          No rating-agency comparisons or regulatory pass claims are inferred from these data.
        </p>
        <div className="overflow-x-auto">
          <table className="mt-3 w-full text-left text-xs">
            <thead className="text-slate-400">
              <tr><th>Model</th><th>Brier ↓</th><th>Log loss ↓</th><th>ROC AUC ↑</th><th>Average precision ↑</th></tr>
            </thead>
            <tbody>
              {Object.entries(backtest.models).map(([name, result]) => (
                <tr key={name} className="border-t border-slate-800">
                  <td className="py-2">{name}</td><td>{result.brier.toFixed(4)}</td>
                  <td>{result.logLoss.toFixed(4)}</td><td>{result.rocAuc?.toFixed(4) ?? 'Unavailable: one class'}</td>
                  <td>{result.averagePrecision?.toFixed(4) ?? 'Unavailable: no events'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 break-all font-mono text-[10px] text-slate-500">
          Observed panel SHA-256: {backtest.dataSha256}
        </p>
      </section>

      <section className="rounded-lg border border-[#1a2438] bg-[#0e1524] p-4 space-y-3">
        <h2 className="text-lg font-bold text-slate-100">Historical VaR / Expected Shortfall Backtests</h2>
        <p className="text-xs text-slate-300">
          Upload a JSON array of non-overlapping realized-loss periods and forecasts issued no later than each
          period start. One portfolio, model version, unit, and confidence level per upload.
          Losses are positive for losses and negative for gains. Equality with VaR is not a breach.
          Records are ordered and checked; nothing is saved to a server.
        </p>
        <pre className="overflow-x-auto rounded bg-[#090d16] p-3 text-[11px] text-slate-400">
          {'[{ "portfolio": "book-id", "modelVersion": "version-id", "unit": "USD",\n' +
            '   "forecastIssuedAt": "2024-01-01T00:00:00Z",\n' +
            '   "periodStart": "2024-01-01T00:00:00Z", "periodEnd": "2024-01-02T00:00:00Z",\n' +
            '   "confidence": 0.99, "var": 100, "es": 150, "loss": 20 }, ...]'}
        </pre>
        <p className="text-xs text-amber-200">
          Schema example only, not historical evidence. ES is optional; when supplied it must use the same
          confidence, horizon and units as VaR. Do not pair 99% VaR with 97.5% ES.
          Historical issuance timestamps must come from your archive; this importer cannot verify their authenticity.
        </p>
        <label className="block text-xs text-cyan-300">
          Import historical forecast/loss JSON
          <input className="ml-3" type="file" accept=".json,application/json"
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              if (file) void importLosses(file);
              event.currentTarget.value = '';
            }} />
        </label>
        {importError && <p role="alert" className="text-sm text-rose-300">{importError}</p>}
        {!lossBacktest ? (
          <p className="text-sm text-amber-300">
            Unavailable: no validated historical forecast/loss series supplied.
            The sovereign default panel cannot establish VaR coverage or ES accuracy.
          </p>
        ) : (
          <div className="space-y-3 text-xs text-slate-300">
            <p>{filename}: {lossBacktest.observations} periods · {lossBacktest.portfolio} ·
              {' '}{lossBacktest.modelVersion} · {lossBacktest.unit} · {(lossBacktest.confidence * 100).toFixed(2)}% confidence</p>
            <p>Observed breaches: {lossBacktest.breaches}; expected: {lossBacktest.expectedBreaches.toFixed(2)}.</p>
            <table className="w-full text-left">
              <thead><tr><th>Test</th><th>LR statistic</th><th>p-value</th><th>5% decision</th></tr></thead>
              <tbody>
                {([
                  ['Kupiec unconditional coverage', lossBacktest.kupiec],
                  ['Christoffersen independence', lossBacktest.independence],
                  ['Christoffersen conditional coverage', lossBacktest.conditionalCoverage]
                ] as const).map(([name, result]) => (
                  <tr key={name} className="border-t border-slate-800">
                    <td className="py-2">{name}</td>
                    <td>{result.available ? result.statistic.toFixed(4) : 'Unavailable'}</td>
                    <td>{result.available ? result.pValue.toFixed(6) : '—'}</td>
                    <td>{result.available ? (result.reject ? 'Reject null' : 'Do not reject null') : result.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-amber-200">
              Asymptotic p-values assume suitable independent, non-overlapping observations and may be unreliable
              with rare breaches or small samples. Non-rejection is not proof of validity or regulatory approval.
            </p>
            <p>
              ES exceedance statistic (Acerbi–Szekely Z₂):
              {' '}{lossBacktest.es.available ? lossBacktest.es.statistic.toFixed(6) : lossBacktest.es.reason}
            </p>
            <p className="text-amber-200">
              No ES p-value or pass/fail is asserted: a model-specific null distribution/simulation is needed.
              No Basel traffic-light zone is assigned to an arbitrary historical sample.
            </p>
          </div>
        )}
      </section>
    </div>
  );
};
