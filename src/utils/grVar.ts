/**
 * Geopolitical risk VaR (seven-groups plan, Phase 4; built fresh on the scenario engine, Sam
 * 2026-11-06): how the country's currency has moved in months of high geopolitical risk, against
 * all months, and what the global channels alone would imply.
 *
 *   Stress months   world GPR (Caldara-Iacoviello, utils/gprIndex.ts) at or above its 90th
 *                   percentile over the months that also have the currency; the same with the
 *                   country GPR when the file has one.
 *   Historical VaR  the 95th percentile of the monthly currency change (100 x log, units per US
 *                   dollar; up = weaker) in stress months and in all months, and the expected
 *                   shortfall (mean of the changes at or beyond it).
 *   Scenario        the mean move of the scenario engine's factors (US policy rate, dollar) in the
 *                   stress months, put through the country's fitted model (utils/scenarioEngine.ts)
 *                   with its 90% band: the part of a stress month the global channels explain.
 *
 * A record of past co-movement with a news index, not a forecast and not a tested signal. Stress
 * months overlap in time (GPR stays high for months), so the sample of independent episodes is
 * smaller than the count of months.
 *
 * Browser-safe, pure.
 */
import { applyScenario, type FactorId, type ScenarioModel, type ScenarioResult } from './scenarioEngine';
import type { GprTable } from './gprIndex';

export const GRVAR_STRESS_PCTL = 90;
export const GRVAR_LEVEL = 95;
export const GRVAR_MIN_STRESS = 20;

export interface TailStats {
  months: number;
  /** 95th percentile of the monthly change, % (positive = weaker currency). */
  var95: number;
  /** Mean of the changes at or beyond var95. */
  es95: number;
  mean: number;
}

export interface GrVarBlock {
  basis: 'world' | 'country';
  /** GPR level at or above which a month counts as stress. */
  threshold: number;
  stress: TailStats;
  all: TailStats;
  /** Most recent stress months, newest first (up to 6). */
  recentStress: string[];
  /** Mean factor moves in the stress months, and the model's implied currency move. */
  factorMoves?: Partial<Record<FactorId, number>>;
  scenario?: ScenarioResult;
}

export type GrVarOutcome = { ok: true; blocks: GrVarBlock[]; from: string; to: string; /** Why a block is missing. */ notes: string[] } | { ok: false; reason: string };

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The q-th percentile (0-100), linear between order statistics. */
export function percentile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const pos = ((s.length - 1) * q) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function tailStats(xs: number[]): TailStats {
  const v = percentile(xs, GRVAR_LEVEL);
  const tail = xs.filter((x) => x >= v);
  return { months: xs.length, var95: r2(v), es95: r2(tail.reduce((a, x) => a + x, 0) / tail.length), mean: r2(xs.reduce((a, x) => a + x, 0) / xs.length) };
}

function block(
  basis: 'world' | 'country',
  gpr: Map<string, number>,
  fx: Map<string, number>,
  factors: Partial<Record<FactorId, Map<string, number>>>,
  model: ScenarioModel | null,
): GrVarBlock | string {
  const months = [...fx.keys()].filter((m) => gpr.has(m)).sort();
  if (months.length < GRVAR_MIN_STRESS * 5) return `${basis === 'world' ? 'World' : 'Country'} GPR: only ${months.length} months overlap with the currency; needs ${GRVAR_MIN_STRESS * 5}`;
  const threshold = percentile(months.map((m) => gpr.get(m)!), GRVAR_STRESS_PCTL);
  const stressM = months.filter((m) => gpr.get(m)! >= threshold);
  if (stressM.length < GRVAR_MIN_STRESS) return `${basis === 'world' ? 'World' : 'Country'} GPR: only ${stressM.length} stress months; needs ${GRVAR_MIN_STRESS}`;
  const out: GrVarBlock = {
    basis,
    threshold: r2(threshold),
    stress: tailStats(stressM.map((m) => fx.get(m)!)),
    all: tailStats(months.map((m) => fx.get(m)!)),
    recentStress: stressM.slice(-6).reverse(),
  };
  if (model) {
    const moves: Partial<Record<FactorId, number>> = {};
    for (const id of model.factors) {
      const f = factors[id];
      const vals = stressM.map((m) => f?.get(m)).filter((v): v is number => v !== undefined);
      if (vals.length) moves[id] = r2(vals.reduce((a, x) => a + x, 0) / vals.length);
    }
    out.factorMoves = moves;
    out.scenario = applyScenario(model, moves);
  }
  return out;
}

/** GR-VaR for one country from its monthly currency changes, the GPR table and the fitted fx model. */
export function grVar(
  iso3: string,
  fxChanges: Map<string, number>,
  gpr: GprTable,
  factors: Partial<Record<FactorId, Map<string, number>>>,
  model: ScenarioModel | null,
): GrVarOutcome {
  const col = (name: string) => {
    const vals = gpr.series[name];
    const m = new Map<string, number>();
    if (vals) gpr.months.forEach((mo, i) => vals[i] !== null && m.set(mo, vals[i]!));
    return m;
  };
  const blocks: GrVarBlock[] = [];
  const why: string[] = [];
  for (const [basis, name] of [['world', 'GPR'], ['country', `GPRC_${iso3.toUpperCase()}`]] as const) {
    const series = col(name);
    if (!series.size) {
      if (basis === 'country') continue; // the file covers 44 countries; the world block still stands
      why.push('the GPR file has no world column with values');
      continue;
    }
    const b = block(basis, series, fxChanges, factors, model);
    if (typeof b === 'string') why.push(b);
    else blocks.push(b);
  }
  if (!blocks.length) return { ok: false, reason: why.join('; ') || 'no overlap between the GPR file and the currency' };
  const months = [...fxChanges.keys()].sort();
  return { ok: true, blocks, from: months[0], to: months[months.length - 1], notes: why };
}

export function grVarSentence(name: string, g: Extract<GrVarOutcome, { ok: true }>): string {
  const b = g.blocks[0];
  const scen = b.scenario ? `; the global factor moves of those months alone (US rate, dollar, financial stress, supply chain pressure) imply ${b.scenario.value >= 0 ? '+' : ''}${b.scenario.value}% (90% band ${b.scenario.lo} to ${b.scenario.hi})` : '';
  return `${name}: in the ${b.stress.months} months of highest ${b.basis} geopolitical risk, the currency's 95% monthly VaR was ${b.stress.var95}% weaker (expected shortfall ${b.stress.es95}%), against ${b.all.var95}% (${b.all.es95}%) over all ${b.all.months} months${scen}.`;
}

export const GRVAR_METHOD = `Stress months: the Caldara-Iacoviello Geopolitical Risk index (world, and country where covered) at or above its ${GRVAR_STRESS_PCTL}th percentile over the months that also have the currency. ${GRVAR_LEVEL}% VaR: the ${GRVAR_LEVEL}th percentile of the monthly currency change against the US dollar (100 x log, positive = weaker) in stress months and in all months; expected shortfall: the mean change at or beyond it. Scenario: the mean moves of the scenario engine's factors (US policy rate, dollar, financial stress, supply chain pressure) in the stress months put through the country's fitted scenario model, with its 90% band. Past co-movement, not a forecast; stress months cluster, so there are fewer independent episodes than months.`;
