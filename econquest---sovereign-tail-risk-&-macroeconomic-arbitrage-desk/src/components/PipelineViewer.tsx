import React, { useState } from 'react';
import { SovereignEntity, LayerOutputs, MacroScenario } from '../types/riskEngine';
import { ANNUAL_FEATURE_LABELS, ANNUAL_FEATURES, FITTED_MODELS, getAnnualHistory } from '../math/fittedModels';

interface PipelineViewerProps {
  sovereign: SovereignEntity;
  output: LayerOutputs;
  allSovereigns: SovereignEntity[];
  onSelectSovereign: (id: string) => void;
  activeScenario: MacroScenario;
  onNavigateToTab: (tab: string) => void;
}

export const PipelineViewer: React.FC<PipelineViewerProps> = ({
  sovereign,
  output,
  allSovereigns,
  onSelectSovereign,
  activeScenario,
  onNavigateToTab
}) => {
  const [activeLayer, setActiveLayer] = useState<number>(1);
  const history = getAnnualHistory(sovereign);
  const annualObservation = history[history.length - 1];

  return (
    <div className="space-y-6">
      {/* Top Sovereign Selector & Executive Header */}
      <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{sovereign.flag}</span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-100">{sovereign.name}</h2>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-[#1a2438] text-slate-300">
                {sovereign.code}
              </span>
              <span className="text-xs text-slate-400">· {sovereign.region}</span>
              {sovereign.isIslandState && (
                <span className="text-xs font-mono text-cyan-400">
                  · Small Island State (Pillar 7 15%)
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              FX Regime: <span className="text-slate-200 font-mono">{sovereign.fxRegime}</span> · 5Y CDS:{' '}
              <span className="text-slate-200 font-mono">{sovereign.cdsSpread5yBps} bps</span> · Text Stress:{' '}
              <span className="text-slate-200 font-mono">{sovereign.textStressIndex.toFixed(1)}σ</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs text-slate-400 font-mono">Switch Sovereign:</label>
          <select
            value={sovereign.id}
            onChange={(e) => onSelectSovereign(e.target.value)}
            className="bg-[#111726] border border-[#23314d] text-slate-200 text-xs rounded px-3 py-1.5 font-mono focus:outline-none focus:border-emerald-500 cursor-pointer"
          >
            {allSovereigns.map((s) => (
              <option key={s.id} value={s.id}>
                {s.flag} {s.name} ({s.code})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded border border-amber-500/30 bg-amber-950/20 p-4 text-xs text-amber-200">
        Model {output.annualModel.version} · observed {output.annualModel.observationYear} ·
        target year {output.annualModel.forecastYear} (not a current forecast).
        {' '}Onset hazard is conditional on no existing default.
        {output.annualModel.inDefault && <strong> This country was already in default in the source year: the hazard is an out-of-scope diagnostic, not a usable default forecast.</strong>}
        {output.annualModel.imputedFeatures.length > 0 &&
          <span> Missing predictors imputed from training medians: {output.annualModel.imputedFeatures.join(', ')}.</span>}
      </div>

      {/* 6-Layer Navigation Bar */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        {[
          { id: 1, title: 'Layer 1', subtitle: 'Hazard Logit', stat: `${(output.layer1ReconciledHazard * 100).toFixed(1)}%` },
          { id: 2, title: 'Layer 2', subtitle: 'Bayesian Update', stat: `${(output.calibratedPosteriorHazard * 100).toFixed(1)}%` },
          { id: 3, title: 'Layer 3', subtitle: 'HMM Regime', stat: output.regime },
          { id: 4, title: 'Layer 4', subtitle: 'Merton CCA LGD', stat: `${output.compositeSeverityLge.toFixed(1)}%` },
          { id: 5, title: 'Layer 5', subtitle: 'Student-t Copula', stat: `ν=${output.studentTCopulaNu}` },
          { id: 6, title: 'Layer 6', subtitle: 'VaR & ES 97.5%', stat: `${output.es975.toFixed(1)}%` }
        ].map((layer) => (
          <button
            key={layer.id}
            onClick={() => setActiveLayer(layer.id)}
            className={`p-3 text-left rounded-lg border transition-all ${
              activeLayer === layer.id
                ? 'bg-[#152037] border-emerald-500/60 text-slate-100 shadow-sm'
                : 'bg-[#0e1524] border-[#1a2438] text-slate-400 hover:text-slate-200 hover:bg-[#121b2d]'
            }`}
          >
            <div className="text-[11px] font-mono text-emerald-400 font-semibold">{layer.title}</div>
            <div className="text-xs font-medium text-slate-200 truncate">{layer.subtitle}</div>
            <div className="text-sm font-bold font-mono text-slate-100 mt-1">{layer.stat}</div>
          </button>
        ))}
      </div>

      {/* Layer Content Card */}
      <div className="p-6 bg-[#0e1524] border border-[#1a2438] rounded-lg">
        {/* Layer 1: Discrete-Time Hazard Modeling */}
        {activeLayer === 1 && (
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-100">
                  Layer 1: Base Event Probability via Discrete-Time Hazard Modeling
                </h3>
                <span className="font-mono text-xs px-2.5 py-1 rounded bg-[#111726] text-emerald-400 border border-emerald-500/30">
                  Reconciled Hazard: {(output.layer1ReconciledHazard * 100).toFixed(2)}%
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Firth Jeffreys-penalized logistic regression and a monotonic LightGBM challenger fitted offline to
                observed World Bank annual predictors and BoC–BoE default-onset labels.
                Training predictors: {FITTED_MODELS.hazard.trainingPredictorYears.join('–')};
                {' '}{FITTED_MODELS.hazard.trainingRows} at-risk country-years,
                {' '}{FITTED_MODELS.hazard.trainingEvents} onsets. Revised data are not point-in-time vintages.
              </p>
            </div>

            {/* Formula Block */}
            <div className="p-4 bg-[#090d16] border border-[#1a2438] rounded font-mono text-xs text-slate-300 overflow-x-auto space-y-2">
              <div className="text-slate-400 text-[11px]">Fitted hazard on standardized asinh-transformed predictors:</div>
              <div className="text-emerald-300">
                z = {FITTED_MODELS.hazard.firth.coefficients[0].toFixed(4)} + Σ βⱼ · standardized(asinh(xⱼ / scaleⱼ))
              </div>
              <div className="text-slate-400 text-[11px] pt-1">
                Pr(E = 1 | x) = 1 / [1 + exp(-z)] = <span className="text-cyan-300 font-bold">{(output.baselineProbLogit * 100).toFixed(2)}%</span>
              </div>
            </div>

            {/* Ingested Macro Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {ANNUAL_FEATURES.map((feature, index) => (
                <div key={feature} className="p-3 bg-[#111726] border border-[#1a2438] rounded">
                  <div className="text-[11px] text-slate-400">{ANNUAL_FEATURE_LABELS[feature]}</div>
                  <div className="text-lg font-mono font-bold text-slate-100">
                    {annualObservation.values[index]?.toFixed(2) ?? 'Missing / imputed'}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    Observed {annualObservation.year}; fitted standardized β = {FITTED_MODELS.hazard.firth.coefficients[index + 1].toFixed(4)}
                  </div>
                </div>
              ))}
            </div>

            {/* Monotonic LightGBM Challenger Section */}
            <div className="p-4 bg-[#111726] border border-[#1a2438] rounded space-y-2">
              <div className="text-xs font-semibold text-slate-200">
                Monotonic Gradient-Boosted Decision Tree (LightGBM) Challenger
              </div>
              <p className="text-xs text-slate-400">
                {FITTED_MODELS.hazard.lightgbm.trees.length} genuinely fitted trees, with nondecreasing external-debt,
                short-term-debt and inflation effects, and nonincreasing reserves, growth and current-account effects.
                Missing predictors use training medians. Stress scenarios perturb the terminal annual observation using
                illustrative assumptions; the cards above show unshocked source observations.
              </p>
              <div className="flex items-center gap-6 pt-1 text-xs font-mono">
                <div>
                  <span className="text-slate-400">LightGBM Challenger Prob: </span>
                  <span className="text-amber-400 font-bold">
                    {(output.lightgbmChallengerProb * 100).toFixed(2)}%
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Temporal Validation Weighting: </span>
                  <span className="text-slate-200">
                    {(1 - FITTED_MODELS.hazard.lightgbmWeight).toFixed(2)} Firth + {FITTED_MODELS.hazard.lightgbmWeight.toFixed(2)} LightGBM
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Final Layer 1 Prior: </span>
                  <span className="text-emerald-400 font-bold">
                    {(output.layer1ReconciledHazard * 100).toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Layer 2: Bayesian Log-Odds & Scorecard Prior */}
        {activeLayer === 2 && (
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-100">
                  Layer 2: Bayesian Log-Odds Update & Scorecard Prior Integration
                </h3>
                <span className="font-mono text-xs px-2.5 py-1 rounded bg-[#111726] text-emerald-400 border border-emerald-500/30">
                  Calibrated Posterior Hazard: {(output.calibratedPosteriorHazard * 100).toFixed(2)}%
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Synthesizes quantitative Layer 1 hazard with the 7-pillar country scorecard prior (S_i vs S_bar = 45.0)
                and high-frequency market signals (CDS spreads, FX vol skew, Text Stress Index) strictly in log-odds space.
              </p>
            </div>

            {/* Formula Block */}
            <div className="p-4 bg-[#090d16] border border-[#1a2438] rounded font-mono text-xs text-slate-300 overflow-x-auto space-y-2">
              <div className="text-slate-400 text-[11px]">Log-Odds Transformation & Synthesis (Section 3.2 & 6.2):</div>
              <div className="text-emerald-300">
                logit(p_post) = logit(p_model) + w_s·(S_i - S̄) + ∑ w_k·z_k
              </div>
              <div className="text-slate-400 text-[11px] grid grid-cols-1 md:grid-cols-4 gap-2 pt-2">
                <div>
                  Prior logit(p_0):{' '}
                  <span className="text-slate-100 font-bold">{output.logOddsPrior.toFixed(3)}</span>
                </div>
                <div>
                  Scorecard Shift w_s·ΔS:{' '}
                  <span className="text-cyan-300 font-bold">
                    {output.scorecardDeltaShift >= 0 ? `+${output.scorecardDeltaShift.toFixed(3)}` : output.scorecardDeltaShift.toFixed(3)}
                  </span>
                </div>
                <div>
                  Market Signals Shift ∑w·z:{' '}
                  <span className="text-amber-300 font-bold">
                    {output.highFreqSignalShift >= 0 ? `+${output.highFreqSignalShift.toFixed(3)}` : output.highFreqSignalShift.toFixed(3)}
                  </span>
                </div>
                <div>
                  Posterior logit(p_post):{' '}
                  <span className="text-emerald-400 font-bold">{output.posteriorLogOdds.toFixed(3)}</span>
                </div>
              </div>
            </div>

            {/* Arbitrage Detection Card */}
            <div className="p-4 bg-[#111726] border border-[#1a2438] rounded space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">
                  Prediction Market Bayesian Likelihood Synthesis (Section 3.2.1)
                </span>
                {output.isArbitrageAlert && (
                  <span className="text-xs font-mono font-semibold text-emerald-400 bg-emerald-950 px-2.5 py-0.5 rounded border border-emerald-800">
                    ALPHA ARBITRAGE SIGNAL ACTIVE
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
                <div className="p-3 bg-[#090d16] rounded border border-[#1a2438]">
                  <div className="text-slate-400 text-[11px]">Model Calibrated Posterior</div>
                  <div className="text-xl font-bold text-slate-100">
                    {(output.calibratedPosteriorHazard * 100).toFixed(1)}%
                  </div>
                  <div className="text-[10px] text-slate-500">Quantitative Desk Truth</div>
                </div>

                <div className="p-3 bg-[#090d16] rounded border border-[#1a2438]">
                  <div className="text-slate-400 text-[11px]">
                    {sovereign.predictionMarket.marketName} Contract Price
                  </div>
                  <div className="text-xl font-bold text-cyan-400">
                    {sovereign.predictionMarket.impliedProbPercent.toFixed(1)}%
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Vol: ${(sovereign.predictionMarket.marketVolumeUsd / 1000000).toFixed(2)}M
                  </div>
                </div>

                <div className="p-3 bg-[#090d16] rounded border border-[#1a2438]">
                  <div className="text-slate-400 text-[11px]">Model Divergence (Alpha)</div>
                  <div
                    className={`text-xl font-bold ${
                      output.arbitrageDivergence > 0 ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {output.arbitrageDivergence > 0
                      ? `+${output.arbitrageDivergence.toFixed(1)}%`
                      : `${output.arbitrageDivergence.toFixed(1)}%`}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {output.isArbitrageAlert ? 'Mispricing > 5% Threshold' : 'Within arbitrage band'}
                  </div>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => onNavigateToTab('arbitrage')}
                  className="px-3 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded transition-colors"
                >
                  Open Arbitrage Trade Sizing Terminal →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Layer 3: Hidden Markov Model (HMM) Regime Dynamics */}
        {activeLayer === 3 && (
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-100">
                  Layer 3: Hidden Markov Model (HMM) Regime Dynamics
                </h3>
                <span
                  className={`font-mono text-xs px-2.5 py-1 rounded border font-semibold ${
                    output.regime === 'Crisis'
                      ? 'bg-rose-950 text-rose-300 border-rose-800'
                      : output.regime === 'Stressed'
                      ? 'bg-amber-950 text-amber-300 border-amber-800'
                      : 'bg-emerald-950 text-emerald-300 border-emerald-800'
                  }`}
                >
                  Current State: {output.regime} Regime
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Three-state diagonal-Gaussian HMM fitted by Baum–Welch through {FITTED_MODELS.hmm.trainingThrough} on
                {' '}{FITTED_MODELS.hmm.trainingObservations} observed annual reserves/growth/inflation observations
                in {FITTED_MODELS.hmm.trainingSequences} separate consecutive country sequences.
                Causal forward filtering uses learned transition and emission parameters, not hazard thresholds.
                State names order fitted emissions by macro stress; they are not supervised crisis diagnoses.
              </p>
            </div>

            {/* State Probability Breakdown */}
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 bg-[#111726] border border-[#1a2438] rounded">
                <div className="text-xs font-medium text-emerald-400">State 1: Calm</div>
                <div className="text-2xl font-mono font-bold text-slate-100 mt-1">
                  {(output.regimeProbabilities.calm * 100).toFixed(1)}%
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Lowest fitted annual macro-stress state; illustrative downstream copula ν = 12
                </div>
              </div>

              <div className="p-4 bg-[#111726] border border-[#1a2438] rounded">
                <div className="text-xs font-medium text-amber-400">State 2: Stressed</div>
                <div className="text-2xl font-mono font-bold text-slate-100 mt-1">
                  {(output.regimeProbabilities.stressed * 100).toFixed(1)}%
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Intermediate fitted annual macro-stress state; illustrative downstream copula ν = 6
                </div>
              </div>

              <div className="p-4 bg-[#111726] border border-[#1a2438] rounded">
                <div className="text-xs font-medium text-rose-400">State 3: Crisis</div>
                <div className="text-2xl font-mono font-bold text-slate-100 mt-1">
                  {(output.regimeProbabilities.crisis * 100).toFixed(1)}%
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Highest fitted annual macro-stress state; illustrative downstream copula ν = 4
                </div>
              </div>
            </div>

            {/* High Frequency Telemetry Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-[#111726] border border-[#1a2438] rounded space-y-2">
                <div className="text-xs font-semibold text-slate-200">
                  Illustrative Text Stress Index (not an HMM input)
                </div>
                <div className="text-lg font-mono font-bold text-cyan-400">
                  {output.tsiShockZScore >= 0 ? `+${output.tsiShockZScore.toFixed(2)}σ` : `${output.tsiShockZScore.toFixed(2)}σ`}
                </div>
                <p className="text-xs text-slate-400">
                  Legacy scenario metadata. The fitted annual HMM uses observed reserves, GDP growth and inflation,
                  not this illustrative sentiment indicator.
                </p>
              </div>

              <div className="p-4 bg-[#111726] border border-[#1a2438] rounded space-y-2">
                <div className="text-xs font-semibold text-slate-200">
                  Illustrative Maritime Scenario Status (not live AIS)
                </div>
                <div className="text-xs font-mono font-semibold text-slate-300">
                  {output.aisChokepointStatus}
                </div>
                <p className="text-xs text-slate-400">
                  Scenario description only, not an observed vessel-tracking feed or an input to the fitted HMM.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Layer 4: Structural Loss Severity & Contingent Claims Analysis */}
        {activeLayer === 4 && (
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-100">
                  Layer 4: Structural Loss Severity & Contingent Claims Analysis (CCA)
                </h3>
                <span className="font-mono text-xs px-2.5 py-1 rounded bg-[#111726] text-rose-400 border border-rose-500/30">
                  Composite LGD: {output.compositeSeverityLge.toFixed(1)}%
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Models sovereign balance sheet option dynamics (Gray, Merton, & Bodie 2007) combined with Cruces & Trebesch
                empirical haircut Generalized Beta distributions and Extreme Value Theory (EVT).
              </p>
            </div>

            {/* Formula Block */}
            <div className="p-4 bg-[#090d16] border border-[#1a2438] rounded font-mono text-xs text-slate-300 overflow-x-auto space-y-2">
              <div className="text-slate-400 text-[11px]">Merton Distance-to-Distress (DD) Specification:</div>
              <div className="text-emerald-300">
                DD = [ ln(V_A / D_B) + (μ_A - 0.5·σ_A²)·T ] / [ σ_A·√T ] = <span className="text-cyan-300 font-bold">{output.distanceToDistress.toFixed(2)}σ</span>
              </div>
              <div className="text-[11px] text-slate-400">
                Sovereign distress occurs when asset market value V_A falls below distress threshold D_B (short-term debt + 0.5 long-term debt).
              </div>
            </div>

            {/* Merton Inputs & Loss Severity Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-xs">
              <div className="p-3 bg-[#111726] border border-[#1a2438] rounded">
                <div className="text-slate-400 text-[11px]">Sovereign Assets V_A</div>
                <div className="text-lg font-bold text-slate-100">${sovereign.sovereignAssetValueVA}B</div>
              </div>

              <div className="p-3 bg-[#111726] border border-[#1a2438] rounded">
                <div className="text-slate-400 text-[11px]">Distress Threshold D_B</div>
                <div className="text-lg font-bold text-slate-100">${sovereign.distressThresholdDB}B</div>
              </div>

              <div className="p-3 bg-[#111726] border border-[#1a2438] rounded">
                <div className="text-slate-400 text-[11px]">Merton Haircut LGD</div>
                <div className="text-lg font-bold text-amber-400">{output.mertonLgd.toFixed(1)}%</div>
              </div>

              <div className="p-3 bg-[#111726] border border-[#1a2438] rounded">
                <div className="text-slate-400 text-[11px]">EVT Tail Severity (GPD)</div>
                <div className="text-lg font-bold text-rose-400">{output.evtTailSeverity.toFixed(1)}%</div>
              </div>
            </div>

            {/* Legal Attachment Recovery */}
            <div className="p-4 bg-[#111726] border border-[#1a2438] rounded space-y-1 text-xs">
              <div className="font-semibold text-slate-200">Legal & Structural Judicial Asset Recovery</div>
              <p className="text-slate-400">
                Conditioned on state commercial assets held abroad subject to judicial attachment (e.g. US FSIA
                exceptions, CITGO precedent):{' '}
                <span className="text-slate-200 font-mono font-semibold">
                  ${sovereign.stateAssetsAbroadEligibleBillion}B attachable foreign assets
                </span>
                . IMF Program Engagement:{' '}
                <span className="text-slate-200 font-mono font-semibold">
                  {sovereign.imfProgramInvolved ? 'Active Stand-By/EFF Facility' : 'No Program'}
                </span>
                .
              </p>
            </div>
          </div>
        )}

        {/* Layer 5: Joint Tail Risk Copulas & Liquidity-Adjusted VaR */}
        {activeLayer === 5 && (
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-100">
                  Layer 5: Dependence Dynamics & Joint Tail Risk Copulas
                </h3>
                <span className="font-mono text-xs px-2.5 py-1 rounded bg-[#111726] text-cyan-400 border border-cyan-500/30">
                  Degrees of Freedom: ν = {output.studentTCopulaNu}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Linear correlation matrices fail to capture tail dependence during crises. Layer 5 deploys a Student-t
                copula guaranteeing non-zero asymptotic upper tail dependence (λ_u &gt; 0).
              </p>
            </div>

            {/* Formula Block */}
            <div className="p-4 bg-[#090d16] border border-[#1a2438] rounded font-mono text-xs text-slate-300 overflow-x-auto space-y-2">
              <div className="text-slate-400 text-[11px]">Upper Tail Dependence Formula (Section 6.1):</div>
              <div className="text-emerald-300">
                λ_u = 2 · t_{'{'}ν+1{'}'} ( -√[ (ν+1)(1-ρ) / (1+ρ) ] )
              </div>
              <div className="text-slate-400 text-[11px] pt-1">
                At ν = {output.studentTCopulaNu} and correlation ρ = {output.crossBorderContagionFactor.toFixed(2)}, joint tail clustering parameter:{' '}
                <span className="text-cyan-300 font-bold">λ_u = {output.tailDependenceLambdaU.toFixed(4)}</span>
              </div>
            </div>

            {/* BIS Cross Border Banking Matrix */}
            <div className="p-4 bg-[#111726] border border-[#1a2438] rounded space-y-2 text-xs">
              <div className="font-semibold text-slate-200">
                Bank for International Settlements (BIS) Cross-Border Contagion
              </div>
              <p className="text-slate-400">
                Consolidated cross-border banking claims and bilateral FDI linkages dynamically elevate sovereign-to-banking
                spillovers across money centers when regime state shifts to Crisis.
              </p>
              <div className="flex items-center gap-6 pt-2 font-mono text-xs">
                <div>
                  <span className="text-slate-400">Copula Tail Coupling: </span>
                  <span className="text-rose-400 font-bold">
                    {output.studentTCopulaNu <= 4 ? 'MAXIMUM CLUSTERING (ν=4)' : 'MODERATE DISSIPATION'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Systemic Correlation Factor: </span>
                  <span className="text-slate-200 font-bold">{output.crossBorderContagionFactor.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Layer 6: Accelerated Monte Carlo & Tail Metrics */}
        {activeLayer === 6 && (
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-100">
                  Layer 6: Accelerated Monte Carlo Simulation & Tail Metrics
                </h3>
                <span className="font-mono text-xs px-2.5 py-1 rounded bg-[#111726] text-rose-400 border border-rose-500/30">
                  FRTB Expected Shortfall: {output.es975.toFixed(1)}%
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Simulates 100,000+ paths via Scrambled Sobol low-discrepancy sequences with analytical Delta-Gamma-Vega
                Cornish-Fisher approximations for sub-second execution.
              </p>
            </div>

            {/* Key Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-xs">
              <div className="p-3 bg-[#111726] border border-[#1a2438] rounded">
                <div className="text-slate-400 text-[11px]">1-Yr 99% Value-at-Risk</div>
                <div className="text-xl font-bold text-amber-400">{output.var99.toFixed(1)}%</div>
                <div className="text-[10px] text-slate-500">Traditional VaR_0.99</div>
              </div>

              <div className="p-3 bg-[#111726] border border-[#1a2438] rounded">
                <div className="text-slate-400 text-[11px]">FRTB 97.5% Expected Shortfall</div>
                <div className="text-xl font-bold text-rose-400">{output.es975.toFixed(1)}%</div>
                <div className="text-[10px] text-slate-500">Basel III Tail Sensitive</div>
              </div>

              <div className="p-3 bg-[#111726] border border-[#1a2438] rounded">
                <div className="text-slate-400 text-[11px]">Liquidity-Adjusted L-VaR</div>
                <div className="text-xl font-bold text-cyan-400">{output.lVar99.toFixed(1)}%</div>
                <div className="text-[10px] text-slate-500">Spread widening horizon</div>
              </div>

              <div className="p-3 bg-[#111726] border border-[#1a2438] rounded">
                <div className="text-slate-400 text-[11px]">Sobol Paths Evaluated</div>
                <div className="text-xl font-bold text-emerald-400">{output.sobolIterations.toLocaleString()}</div>
                <div className="text-[10px] text-slate-500">Quasi-Monte Carlo (QMC)</div>
              </div>
            </div>

            {/* Empirical Loss Distribution Curve */}
            <div className="p-4 bg-[#090d16] border border-[#1a2438] rounded space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200">
                  Aggregate Sovereign Portfolio Loss Density Function f(L)
                </span>
                <div className="flex items-center gap-4 font-mono text-[11px]">
                  <span className="flex items-center gap-1.5 text-amber-400">
                    <span className="w-2.5 h-0.5 bg-amber-400 inline-block"></span> 99% VaR ({output.var99.toFixed(1)}%)
                  </span>
                  <span className="flex items-center gap-1.5 text-rose-400">
                    <span className="w-2.5 h-0.5 bg-rose-400 inline-block"></span> FRTB 97.5% ES ({output.es975.toFixed(1)}%)
                  </span>
                </div>
              </div>

              {/* Responsive SVG Chart */}
              <div className="h-44 w-full">
                <svg className="w-full h-full" viewBox="0 0 600 160" preserveAspectRatio="none">
                  {/* Grid Lines */}
                  <line x1="40" y1="20" x2="580" y2="20" stroke="#1a2438" strokeDasharray="3 3" />
                  <line x1="40" y1="70" x2="580" y2="70" stroke="#1a2438" strokeDasharray="3 3" />
                  <line x1="40" y1="120" x2="580" y2="120" stroke="#1a2438" strokeDasharray="3 3" />

                  {/* Density Area */}
                  {output.lossDistributionPoints.length > 1 && (
                    <polygon
                      points={`40,140 ${output.lossDistributionPoints
                        .map((pt, i) => {
                          const x = 40 + (i / (output.lossDistributionPoints.length - 1)) * 540;
                          const y = Math.max(20, 140 - pt.density * 18);
                          return `${x},${y}`;
                        })
                        .join(' ')} 580,140`}
                      fill="rgba(16, 185, 129, 0.15)"
                    />
                  )}

                  {/* Density Line */}
                  {output.lossDistributionPoints.length > 1 && (
                    <polyline
                      points={output.lossDistributionPoints
                        .map((pt, i) => {
                          const x = 40 + (i / (output.lossDistributionPoints.length - 1)) * 540;
                          const y = Math.max(20, 140 - pt.density * 18);
                          return `${x},${y}`;
                        })
                        .join(' ')}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="2"
                    />
                  )}

                  {/* VaR Line */}
                  <line
                    x1={40 + (Math.min(100, output.var99) / 100) * 540}
                    y1="10"
                    x2={40 + (Math.min(100, output.var99) / 100) * 540}
                    y2="140"
                    stroke="#f59e0b"
                    strokeWidth="2"
                    strokeDasharray="4 2"
                  />

                  {/* ES Line */}
                  <line
                    x1={40 + (Math.min(100, output.es975) / 100) * 540}
                    y1="10"
                    x2={40 + (Math.min(100, output.es975) / 100) * 540}
                    y2="140"
                    stroke="#ef4444"
                    strokeWidth="2"
                  />

                  {/* Baseline Axis */}
                  <line x1="40" y1="140" x2="580" y2="140" stroke="#334155" strokeWidth="1" />
                </svg>
              </div>

              <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 pt-1">
                <span>0% Portfolio Loss</span>
                <span>50% Loss</span>
                <span>100% Loss (Catastrophic Sovereign Tail)</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
