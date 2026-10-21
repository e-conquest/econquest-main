import { providerRequest } from './imfApi';

export const COMTRADE_CONTRACT = 'comtrade-original-annual-total-v1';
export interface ComtradeArea {
  code: number; name: string; iso3: string | null; isGroup: boolean;
  effective: string | null; expired: string | null;
  kind?: 'individual' | 'world' | 'special' | 'aggregate' | 'unreviewed';
}
export interface ComtradeReport {
  contractVersion?: string; errors?: string[]; firstYear?: number; lastYear?: number;
  rowCount?: number; numericCount?: number; taskCount?: number; completedTasks?: number;
  phase?: string; pauseReason?: string | null; notBefore?: number | null; transportComplete?: boolean;
  reporterCount?: number; reporters?: ComtradeArea[]; partners?: ComtradeArea[];
  limitation?: string; availableReporterYears?: number; plannedDataChunks?: number; dataPlanned?: boolean;
}
export interface ComtradeSummary {
  id: string; createdAt: string; status: 'running' | 'interrupted' | 'staged' | 'committed' | 'rolled_back';
  active: boolean; report: ComtradeReport; progress: Record<string, unknown>;
}
export interface ComtradeRun extends ComtradeSummary {
  sources: { ordinal: number; path: string; httpStatus: number; sha256: string; bytes: number; retrievedAt: string }[];
}
export interface ComtradeRow {
  reporter: number; partner: number; flow: 'M' | 'X'; year: number;
  value: number | null; rawValue: number | null; exclusionReason: string | null;
  partnerKind: NonNullable<ComtradeArea['kind']>; classification: string;
  unit: 'Current US dollars'; sourceHash: string; datasetCode: string; attributes: Record<string, unknown>;
}
export interface ComtradeTask {
  key: string; kind: 'discovery' | 'data'; status: 'pending' | 'complete';
  spec: Record<string, unknown>; result: Record<string, unknown>;
}
export interface ComtradeConfig {
  contractVersion: typeof COMTRADE_CONTRACT; configured: boolean; dailyRequestBudget: number;
  passRequests: number; passSeconds: number; firstYear: number; manualResume: true;
}
interface Page<T> { rows: T[]; total: number; offset: number; limit: number }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const amount = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
const kinds = ['individual', 'world', 'aggregate', 'special', 'unreviewed'];
function areas(value: unknown): value is ComtradeArea[] {
  return Array.isArray(value) && value.every(v => object(v) && integer(v.code) && typeof v.name === 'string' && v.name.length > 0 &&
    (v.iso3 === null || typeof v.iso3 === 'string') && typeof v.isGroup === 'boolean' &&
    [v.effective, v.expired].every(d => d === null || date(d)) && (v.kind === undefined || kinds.includes(String(v.kind)))) &&
    new Set(value.map(v => v.code)).size === value.length;
}
function report(value: unknown): value is ComtradeReport {
  return object(value) && (value.contractVersion === undefined || value.contractVersion === COMTRADE_CONTRACT) &&
    (value.errors === undefined || (Array.isArray(value.errors) && value.errors.every(v => typeof v === 'string'))) &&
    ['rowCount', 'numericCount', 'taskCount', 'completedTasks', 'firstYear', 'lastYear', 'reporterCount', 'availableReporterYears', 'plannedDataChunks'].every(k => value[k] === undefined || integer(value[k])) &&
    ['phase', 'limitation'].every(k => value[k] === undefined || typeof value[k] === 'string') &&
    (value.pauseReason === undefined || value.pauseReason === null || typeof value.pauseReason === 'string') &&
    (value.notBefore === undefined || value.notBefore === null || (typeof value.notBefore === 'number' && Number.isFinite(value.notBefore) && value.notBefore > 0)) &&
    ['transportComplete', 'dataPlanned'].every(k => value[k] === undefined || typeof value[k] === 'boolean') &&
    (value.reporters === undefined || areas(value.reporters)) && (value.partners === undefined || areas(value.partners)) &&
    (value.numericCount === undefined || (integer(value.numericCount) && integer(value.rowCount) && value.numericCount <= value.rowCount)) &&
    (value.completedTasks === undefined || (integer(value.completedTasks) && integer(value.taskCount) && value.completedTasks <= value.taskCount));
}
export function validComtradeSummary(value: unknown): value is ComtradeSummary {
  return object(value) && typeof value.id === 'string' && date(value.createdAt) &&
    ['running', 'interrupted', 'staged', 'committed', 'rolled_back'].includes(String(value.status)) &&
    typeof value.active === 'boolean' && (!value.active || value.status === 'committed') && object(value.progress) && report(value.report) &&
    (!['staged', 'committed', 'rolled_back'].includes(String(value.status)) ||
      (value.report.contractVersion === COMTRADE_CONTRACT && value.report.transportComplete === true &&
       value.report.numericCount !== undefined && value.report.numericCount > 0 &&
       value.report.taskCount !== undefined && value.report.taskCount > 0 && value.report.taskCount === value.report.completedTasks &&
       Array.isArray(value.report.errors) && value.report.errors.length === 0));
}
function run(value: unknown): value is ComtradeRun {
  return validComtradeSummary(value) && 'sources' in value && Array.isArray(value.sources) &&
    value.sources.every(v => object(v) && integer(v.ordinal) && v.ordinal > 0 && integer(v.bytes) && integer(v.httpStatus) &&
      typeof v.path === 'string' && hash(v.sha256) && date(v.retrievedAt));
}
export function validComtradeRow(value: unknown): value is ComtradeRow {
  return object(value) && integer(value.reporter) && integer(value.partner) && integer(value.year) &&
    value.year >= 1962 && value.year < new Date().getUTCFullYear() && ['M', 'X'].includes(String(value.flow)) &&
    amount(value.value) && amount(value.rawValue) && (value.exclusionReason === null || (typeof value.exclusionReason === 'string' && value.exclusionReason.length > 0)) &&
    (value.exclusionReason === null ? value.value !== null && value.value === value.rawValue : value.value === null && value.rawValue === null) &&
    kinds.includes(String(value.partnerKind)) && value.unit === 'Current US dollars' && hash(value.sourceHash) &&
    typeof value.datasetCode === 'string' && /^\d+$/.test(value.datasetCode) && typeof value.classification === 'string' && /^(H[0-6]|S[1-4])$/.test(value.classification) &&
    object(value.attributes) && value.attributes.isOriginalClassification === true &&
    typeof value.attributes.isReported === 'boolean' &&
    value.attributes.typeCode === 'C' && value.attributes.freqCode === 'A' &&
    value.attributes.period === String(value.year) && value.attributes.aggrLevel === 0 &&
    value.attributes.classificationSearchCode === (value.classification.startsWith('H') ? 'HS' : value.classification) &&
    value.attributes.primaryValue === value.rawValue && value.attributes.reporterCode === value.reporter &&
    value.attributes.partnerCode === value.partner && value.attributes.flowCode === value.flow &&
    value.attributes.refYear === value.year && value.attributes.cmdCode === 'TOTAL' &&
    value.attributes.partner2Code === 0 && value.attributes.motCode === 0 && value.attributes.customsCode === 'C00' &&
    value.attributes.classificationCode === value.classification;
}
export async function getComtradeConfig(): Promise<ComtradeConfig> {
  const response = await fetch('/api/providers/comtrade/config', { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (response.status === 404) throw new Error('Backend restart required to enable UN Comtrade. Existing provider data is unchanged.');
  if (!response.ok) throw new Error(`Comtrade configuration HTTP ${response.status}.`);
  const value: unknown = await response.json();
  if (!object(value) || value.contractVersion !== COMTRADE_CONTRACT || typeof value.configured !== 'boolean' || value.manualResume !== true ||
    value.firstYear !== 1962 || !integer(value.passRequests) || value.passRequests < 1 || !integer(value.passSeconds) || value.passSeconds < 1 ||
    !integer(value.dailyRequestBudget) || value.dailyRequestBudget > 500 || value.dailyRequestBudget < value.passRequests) {
    throw new Error('Incompatible Comtrade backend contract; acquisition blocked.');
  }
  return { contractVersion: COMTRADE_CONTRACT, configured: value.configured, manualResume: true, firstYear: value.firstYear,
    passRequests: value.passRequests, passSeconds: value.passSeconds, dailyRequestBudget: value.dailyRequestBudget };
}
export async function getComtradeRun(id: string): Promise<ComtradeRun> {
  const value = await providerRequest(`/comtrade/${encodeURIComponent(id)}`);
  if (!run(value) || value.id !== id) throw new Error('Invalid Comtrade manifest.');
  return value;
}
export async function startComtrade(id?: string): Promise<ComtradeRun> {
  const config = await getComtradeConfig();
  if (!config.configured) throw new Error('Configure COMTRADE_API_KEY privately in the backend; never paste it into chat.');
  const value = await providerRequest(`/providers/comtrade/${id ? `${encodeURIComponent(id)}/resume` : 'pull'}`, true, { researchUse: true });
  if (!run(value) || (id && value.id !== id)) throw new Error('Invalid Comtrade acquisition.');
  return value;
}
export async function mutateComtrade(id: string, action: 'cancel' | 'commit' | 'rollback'): Promise<void> {
  await providerRequest(action === 'cancel' ? `/providers/comtrade/${encodeURIComponent(id)}/cancel` : `/comtrade/${encodeURIComponent(id)}/${action}`, true);
}
function page<T>(value: unknown, offset: number, limit: number, valid: (row: unknown) => row is T): Page<T> {
  if (!object(value) || !integer(value.total) || value.offset !== offset || value.limit !== limit ||
      !Array.isArray(value.rows) || value.rows.length !== Math.min(limit, Math.max(0, value.total - offset)) || !value.rows.every(valid)) {
    throw new Error('Invalid Comtrade page boundaries or records.');
  }
  return { total: value.total, offset, limit, rows: value.rows };
}
export async function getComtradeSeries(id: string, reporter: number, partner: number, flow: 'M' | 'X'): Promise<ComtradeRow[]> {
  const params = new URLSearchParams({ reporter: String(reporter), partner: String(partner), flow, limit: '100' });
  const result = page(await providerRequest(`/comtrade/${encodeURIComponent(id)}/observations?${params}`), 0, 100, validComtradeRow);
  if (result.total !== result.rows.length || result.rows.some((r, i) => r.reporter !== reporter || r.partner !== partner || r.flow !== flow ||
    (i > 0 && r.year <= result.rows[i - 1].year))) throw new Error('Incomplete/mixed Comtrade series.');
  return result.rows;
}
export async function getComtradeTasks(id: string, offset: number): Promise<Page<ComtradeTask>> {
  const valid = (v: unknown): v is ComtradeTask => object(v) && typeof v.key === 'string' &&
    ['discovery', 'data'].includes(String(v.kind)) && ['pending', 'complete'].includes(String(v.status)) && object(v.spec) && object(v.result);
  return page(await providerRequest(`/comtrade/${encodeURIComponent(id)}/tasks?offset=${offset}&limit=100`), offset, 100, valid);
}
