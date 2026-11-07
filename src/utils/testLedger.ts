/**
 * Test ledger (gap analysis R1, the single track-record page): one row for every pre-registered test on record, every version
 * run, failed ones too. Each row carries the test file's registration date and hash where the
 * server has it, the recorded verdict, the raw and Holm-adjusted p, the evidence grade of a pass
 * and the forward record. Nothing here changes a recorded verdict; it only lays them side by side.
 *
 * Browser-safe, pure.
 */
import { evidenceGrade, type GradeReading } from './evidenceGrade';
import type { HolmReading } from './multipleTesting';
import type { ForwardSummary } from './forwardRecord';
import type { ForecastVerdict } from './forecastRegister';

/** The parts of /api/validation this module reads (src/components/useValidation.ts ValidationReply). */
export interface LedgerInput {
  results?: Record<string, { id: string; specVersion: number; specHash: string; ranAt: string; status: 'passed' | 'failed' | 'too_few_cases'; verdict: string }>;
  versions?: Record<string, { id: string; specVersion: number; specHash: string; ranAt: string; status: 'passed' | 'failed' | 'too_few_cases'; verdict: string }>;
  specs?: Array<{ id?: string; version?: number; registeredOn?: string; hash: string; file: string }>;
  forecasts?: Record<string, ForecastVerdict>;
  forecastTests?: Array<{ id: string; version: number; p: number; alpha: number; status: 'passed' | 'failed' | 'too_few_cases' }>;
  forward?: Record<string, ForwardSummary>;
}

export interface LedgerRow {
  /** Holm key: "taylor_gap v2" or "forecast gdp_nowcast v1". */
  key: string;
  kind: 'backtest' | 'forecast' | 'signal';
  id: string;
  version: number;
  /** The newest version on record for this id. */
  latest: boolean;
  registeredOn?: string;
  hash?: string;
  ranAt?: string;
  status: 'passed' | 'failed' | 'too_few_cases';
  verdict?: string;
  rawP?: number;
  holmP?: number;
  alpha?: number;
  holds?: boolean;
  /** Evidence grade, for a pass only. */
  grade?: GradeReading;
  forward?: ForwardSummary;
}

const KIND_ORDER = { backtest: 0, forecast: 1, signal: 2 } as const;

export function ledgerRows(v: LedgerInput | null | undefined, holmMap: Map<string, HolmReading>, now = new Date()): LedgerRow[] {
  if (!v) return [];
  const rows: LedgerRow[] = [];
  const seen = new Set<string>();
  const backtests = [...Object.values(v.versions || {}), ...Object.values(v.results || {})];
  const latestBt = new Map<string, number>();
  for (const r of backtests) latestBt.set(r.id, Math.max(latestBt.get(r.id) ?? 0, r.specVersion));
  // Latest results win over a saved copy of the same version.
  for (const r of [...Object.values(v.results || {}), ...Object.values(v.versions || {})]) {
    if (!r?.id) continue;
    const key = `${r.id} v${r.specVersion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const spec = (v.specs || []).find((s) => s.id === r.id && s.version === r.specVersion);
    const holm = holmMap.get(key);
    const forward = v.forward?.[key];
    const grade = evidenceGrade({ status: r.status, ranAt: r.ranAt, holm, forward, now }) ?? undefined;
    rows.push({
      key,
      kind: 'backtest',
      id: r.id,
      version: r.specVersion,
      latest: latestBt.get(r.id) === r.specVersion,
      registeredOn: spec?.registeredOn,
      hash: r.specHash,
      ranAt: r.ranAt,
      status: r.status,
      verdict: r.verdict,
      rawP: holm?.p,
      holmP: holm?.adjusted,
      alpha: holm?.alpha,
      holds: holm?.holds,
      ...(grade ? { grade } : {}),
      ...(forward ? { forward } : {}),
    });
  }
  const latestFc = new Map<string, number>();
  for (const f of v.forecastTests || []) latestFc.set(f.id, Math.max(latestFc.get(f.id) ?? 0, f.version));
  for (const f of v.forecastTests || []) {
    const key = `forecast ${f.id} v${f.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const saved = v.forecasts?.[f.id];
    const current = saved && saved.specVersion === f.version ? saved : undefined;
    const holm = holmMap.get(key);
    const forward = v.forward?.[`${f.id} v${f.version}`];
    const netOfCosts = f.id.startsWith('fx_');
    const grade = evidenceGrade({ status: f.status, ranAt: current?.ranAt, holm, forward, netOfCosts, now }) ?? undefined;
    rows.push({
      key,
      kind: netOfCosts ? 'signal' : 'forecast',
      id: f.id,
      version: f.version,
      latest: latestFc.get(f.id) === f.version,
      ...(current ? { hash: current.specHash, ranAt: current.ranAt, verdict: current.verdict } : {}),
      status: f.status,
      rawP: holm?.p ?? f.p,
      holmP: holm?.adjusted,
      alpha: holm?.alpha ?? f.alpha,
      holds: holm?.holds,
      ...(grade ? { grade } : {}),
      ...(forward ? { forward } : {}),
    });
  }
  return rows.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id) || b.version - a.version);
}

export const LEDGER_HEADER = [
  'Kind',
  'Test',
  'Version',
  'Latest version',
  'Registered on',
  'Test file SHA-256',
  'Last run',
  'Verdict',
  'Raw p',
  'Holm-adjusted p',
  'Pass mark for p',
  'Holds after correction',
  'Evidence grade',
  'Forward calls scored',
  'Forward hit rate %',
  'Forward base rate %',
  'Forward calls open',
  'Verdict text',
];

const STATUS_TEXT = { passed: 'Passed', failed: 'Failed', too_few_cases: 'Too few cases' } as const;

export function ledgerCsvRows(rows: LedgerRow[]): string[][] {
  const s = (x: unknown) => (x === undefined || x === null ? '' : String(x));
  return rows.map((r) => [
    r.kind,
    r.id,
    s(r.version),
    r.latest ? 'yes' : 'no',
    s(r.registeredOn),
    s(r.hash),
    s(r.ranAt),
    STATUS_TEXT[r.status],
    s(r.rawP),
    s(r.holmP),
    s(r.alpha),
    r.holds === undefined ? '' : r.holds ? 'yes' : 'no',
    s(r.grade?.label),
    s(r.forward?.scored),
    s(r.forward?.hitRatePct),
    s(r.forward?.baseRatePct),
    s(r.forward?.pending),
    s(r.verdict),
  ]);
}

/** One line over the table: how many tests, how many passed, how many hold after the correction. */
export function ledgerSummary(rows: LedgerRow[]): string {
  if (!rows.length) return 'No pre-registered test has run on this computer yet.';
  const passed = rows.filter((r) => r.status === 'passed').length;
  const holds = rows.filter((r) => r.holds).length;
  const fwd = rows.filter((r) => r.forward && r.forward.scored > 0).length;
  return `${rows.length} tests on record (every version run, failed ones too): ${passed} passed as registered, ${holds} hold after the Holm correction across all ${rows.length}, ${fwd} with scored forward calls.`;
}
