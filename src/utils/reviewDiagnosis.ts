/**
 * Policy review, step 2 "Diagnose": a fixed set of indicators for the review's country as the app
 * held them on the "As of" day (the archived pull on or before that day), each with its source and
 * period, or Missing with the reason. Two readings are worked out from them (real policy rate,
 * r minus g), only when both inputs are live, and each says how it was worked out.
 *
 * The same pull always gives the same diagnosis, so the step's hash reproduces. Browser-safe: the
 * server reads the archive and calls buildDiagnosis with csvExport.figureRows of that pull.
 */
import { FIGURES_HEADER } from './csvExport';

type Cell = string | number | null | undefined;

/** The indicators every diagnosis shows, in this order (fields of csvExport.figureRows). */
export const DIAGNOSIS_FIELDS: Array<{ field: string; group: string }> = [
  { field: 'imf.cpiInflationPct', group: 'Prices and policy' },
  { field: 'market.policyRatePct', group: 'Prices and policy' },
  { field: 'imf.realGdpGrowthPct', group: 'Growth' },
  { field: 'imf.debtToGdpPct', group: 'Public finances' },
  { field: 'imf.debtToGdpForecast2027Pct', group: 'Public finances' },
  { field: 'imf.primaryFiscalBalancePct', group: 'Public finances' },
  { field: 'market.sovereign10YBondYieldPct', group: 'Markets' },
  { field: 'market.exchangeRatePerUsd', group: 'Markets' },
  { field: 'wb.fxReservesMonthsImport', group: 'External' },
  { field: 'wb.currentAccountPctGdp', group: 'External' },
  { field: 'wb.externalDebtPctGni', group: 'External' },
  { field: 'wb.politicalStabilityPercentile', group: 'Politics' },
  // Added last so the reference numbers [1]..[12] of the standard indicators keep their meaning.
  { field: 'market.hcBondSpreadBps', group: 'Markets' },
];

/** Indicators a goal can name, as shown in the Frame step (labels from the figure list). */
export const GOAL_INDICATORS = [
  'Inflation',
  'Real GDP growth',
  'Government debt',
  'Primary balance',
  'Policy rate',
  '10Y government bond yield',
  'Exchange rate',
  'Reserves',
  'Current account',
  'External debt',
];

export interface DiagnosisFigure {
  /** Reference number used by later steps and the memo, e.g. 3 for [3]. */
  ref: number;
  field: string;
  group: string;
  label: string;
  unit: string;
  value: number | null;
  status: 'Live' | 'Missing';
  period: string;
  source: string;
  reason: string;
}

export interface DiagnosisReading {
  id: 'real_policy_rate' | 'r_minus_g';
  label: string;
  unit: string;
  value: number | null;
  /** How it was worked out, naming the reference numbers it used. */
  method: string;
  /** Why it could not be worked out, when value is null. */
  reason: string;
  /** Note when the inputs come from different periods. */
  caveat: string;
  uses: number[];
}

export interface Diagnosis {
  iso3: string;
  /** The day asked for (the frame's As of). */
  asOf: string;
  /** The day of the archived pull used (on or before asOf). */
  pullDate: string;
  pulledAt: string;
  incomplete: boolean;
  figures: DiagnosisFigure[];
  readings: DiagnosisReading[];
  /** One line in plain words: how many live, how many missing. */
  coverage: string;
}

const col = (name: string) => FIGURES_HEADER.indexOf(name);
const C = { field: col('field'), figure: col('figure'), value: col('value'), unit: col('unit'), status: col('status'), period: col('period'), source: col('source'), reason: col('reason_if_missing') };

const round = (n: number) => Math.round(n * 100) / 100;

export function buildDiagnosis(rows: Cell[][], meta: { iso3: string; asOf: string; pullDate: string; pulledAt: string; incomplete: boolean }): Diagnosis {
  const byField = new Map(rows.map((r) => [String(r[C.field]), r]));
  const figures: DiagnosisFigure[] = DIAGNOSIS_FIELDS.map((d, i) => {
    const r = byField.get(d.field);
    const v = r?.[C.value];
    const live = Boolean(r) && r![C.status] === 'Live' && typeof v === 'number' && Number.isFinite(v);
    return {
      ref: i + 1,
      field: d.field,
      group: d.group,
      label: String(r?.[C.figure] ?? d.field),
      unit: String(r?.[C.unit] ?? ''),
      value: live ? (v as number) : null,
      status: live ? 'Live' : 'Missing',
      period: live ? String(r![C.period] ?? '') : '',
      source: live ? String(r![C.source] ?? '') : '',
      reason: live ? '' : String(r?.[C.reason] ?? '') || 'not in this pull',
    };
  });
  const f = (field: string) => figures.find((x) => x.field === field)!;
  const reading = (id: DiagnosisReading['id'], label: string, parts: DiagnosisFigure[], calc: (v: number[]) => number, how: string): DiagnosisReading => {
    const uses = parts.map((p) => p.ref);
    const missing = parts.filter((p) => p.value === null);
    const periods = [...new Set(parts.map((p) => p.period).filter(Boolean))];
    if (missing.length) {
      return { id, label, unit: 'percentage points', value: null, method: how, reason: `Missing: needs ${missing.map((m) => `${m.label} [${m.ref}]`).join(' and ')}`, caveat: '', uses };
    }
    return {
      id,
      label,
      unit: 'percentage points',
      value: round(calc(parts.map((p) => p.value as number))),
      method: how,
      reason: '',
      caveat: periods.length > 1 ? `Inputs are from different periods (${periods.join(', ')}).` : '',
      uses,
    };
  };
  const cpi = f('imf.cpiInflationPct');
  const policy = f('market.policyRatePct');
  const growth = f('imf.realGdpGrowthPct');
  const y10 = f('market.sovereign10YBondYieldPct');
  const readings = [
    reading('real_policy_rate', 'Real policy rate', [policy, cpi], ([p, c]) => p - c, `Policy rate [${policy.ref}] minus inflation [${cpi.ref}].`),
    reading('r_minus_g', 'r minus g (approximate)', [y10, growth, cpi], ([y, g, c]) => y - (g + c), `10Y yield [${y10.ref}] minus nominal growth, taken as real growth [${growth.ref}] plus inflation [${cpi.ref}].`),
  ];
  const live = figures.filter((x) => x.status === 'Live').length;
  return {
    ...meta,
    figures,
    readings,
    coverage: `${live} of ${figures.length} indicators live${live < figures.length ? `, ${figures.length - live} missing` : ''}.`,
  };
}

/** A figure as text with its reference, e.g. "4.4% [1] (IMF WEO, 2026)", or "Missing [2]: reason". */
export function figureText(x: DiagnosisFigure): string {
  if (x.value === null) return `Missing [${x.ref}]: ${x.reason}`;
  const unit = x.unit === '%' ? '%' : ` ${x.unit}`;
  return `${x.value}${unit} [${x.ref}] (${x.source}${x.period ? `, ${x.period}` : ''})`;
}
