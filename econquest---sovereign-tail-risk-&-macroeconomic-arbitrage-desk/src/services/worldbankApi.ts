import { MacroRun, MacroSummary, providerRequest, validMacroSummary } from './imfApi';

export interface WorldBankReport {
  errors?: string[]; firstYear?: number; lastYear?: number; rowCount?: number; seriesCount?: number;
  requiredPairs?: number; absentPairs?: number; availableEconomies?: number; availableIndicators?: number;
  analysisBlockedSeries?: number; sourceLastUpdated?: string; retrievedAt?: string;
  countries?: { code: string; name: string }[];
  indicators?: { code: string; name: string; sourceTitle?: string; description: string; sourceOrganization: string; unit: string; sourceHash: string }[];
  classificationPolicy?: string; coveragePolicy?: string; valueConvention?: string; limitation?: string;
  sourceId?: string; counterpart?: string; wdiOverlapCodes?: string[]; numericCount?: number;
  historyCutoffYear?: number; excludedFutureRows?: number; excludedFutureNumericRows?: number;
}
export interface WorldBankSummary extends Omit<MacroSummary, 'report'> { report: WorldBankReport }
export interface WorldBankRun extends WorldBankSummary { sources: MacroRun['sources'] }
export interface WorldBankRow {
  country: string; indicator: string; year: number; value: number | null; rawValue: number | null;
  classification: 'reported_unverified'; status?: string; unit?: string; footnote?: string; decimal?: number; sourceHash: string;
  sourceId?: '6'; counterpart?: 'WLD'; attributes?: Record<string, unknown>;
}
export interface WorldBankSeries {
  country: string; indicator: string; validCount: number; missingCount: number; missingYears: number[];
  validYears: number[]; firstYear: number; lastYear: number; flaggedCount: number; analysisBlocked: boolean; limitation: string;
}
export interface WorldBankCoverage {
  country: string; name: string; indicator: string; indicatorName: string;
  validCount: number; absent: boolean; missingYears: number[]; analysisBlocked: boolean;
}
interface Page<T> { rows: T[]; total: number; offset: number; limit: number }
export interface WorldBankObservations extends Page<WorldBankRow> { series: WorldBankSeries | null }
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const year = (v: unknown): v is number => integer(v) && v >= 1900 && v < 2100;
const years = (v: unknown): v is number[] => Array.isArray(v) && v.every(year) && new Set(v).size === v.length;
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const number = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));

export function validWorldBankSummary(v: unknown): v is WorldBankSummary {
  if (!object(v) || !validMacroSummary({ ...v, report: {} }) || !object(v.report)) return false;
  const r = v.report;
  return (r.errors === undefined || (Array.isArray(r.errors) && r.errors.every(x => typeof x === 'string'))) &&
    ['rowCount', 'seriesCount', 'requiredPairs', 'absentPairs', 'availableEconomies', 'availableIndicators', 'analysisBlockedSeries', 'numericCount', 'excludedFutureRows', 'excludedFutureNumericRows'].every(k => r[k] === undefined || integer(r[k])) &&
    ['firstYear', 'lastYear', 'historyCutoffYear'].every(k => r[k] === undefined || year(r[k])) &&
    ['classificationPolicy', 'coveragePolicy', 'valueConvention', 'limitation', 'sourceId', 'counterpart'].every(k => r[k] === undefined || typeof r[k] === 'string') &&
    (r.wdiOverlapCodes === undefined || (Array.isArray(r.wdiOverlapCodes) && r.wdiOverlapCodes.every(c => typeof c === 'string'))) &&
    ['sourceLastUpdated', 'retrievedAt'].every(k => r[k] === undefined || (typeof r[k] === 'string' && Number.isFinite(Date.parse(r[k])))) &&
    (r.countries === undefined || (Array.isArray(r.countries) && r.countries.every(c => object(c) && typeof c.code === 'string' && typeof c.name === 'string'))) &&
    (r.indicators === undefined || (Array.isArray(r.indicators) && r.indicators.every(i => object(i) &&
      ['code', 'name', 'description', 'sourceOrganization', 'unit'].every(k => typeof i[k] === 'string') &&
      (i.sourceTitle === undefined || typeof i.sourceTitle === 'string') && hash(i.sourceHash))));
}
function validRun(v: unknown): v is WorldBankRun {
  return validWorldBankSummary(v) && 'sources' in v && Array.isArray(v.sources) && v.sources.every(s => object(s) &&
    integer(s.ordinal) && typeof s.path === 'string' && integer(s.httpStatus) && integer(s.bytes) && hash(s.sha256));
}
export function validIdsSummary(v: unknown): v is WorldBankSummary {
  return validWorldBankSummary(v) && (v.report.sourceId === undefined || v.report.sourceId === '6') &&
    (v.report.counterpart === undefined || v.report.counterpart === 'WLD') &&
    (!['staged', 'committed', 'rolled_back'].includes(v.status) || (v.report.sourceId === '6' && v.report.counterpart === 'WLD' && !!v.report.numericCount));
}
export type WorldBankProvider = 'worldbank' | 'ids';
function validRow(v: unknown, provider: WorldBankProvider): v is WorldBankRow {
  return object(v) && ['country', 'indicator'].every(k => typeof v[k] === 'string') &&
    year(v.year) && number(v.value) && v.rawValue === v.value && v.classification === 'reported_unverified' &&
    hash(v.sourceHash) && (provider === 'ids'
      ? v.sourceId === '6' && v.counterpart === 'WLD' && object(v.attributes) &&
        ['status', 'unit', 'footnote', 'decimal'].every(k => !(k in v))
      : ['status', 'unit', 'footnote'].every(k => typeof v[k] === 'string') && integer(v.decimal) && v.decimal <= 20);
}
function validSeries(v: unknown): v is WorldBankSeries {
  return object(v) && typeof v.country === 'string' && typeof v.indicator === 'string' &&
    integer(v.validCount) && integer(v.missingCount) && years(v.missingYears) && v.missingYears.length === v.missingCount &&
    years(v.validYears) && v.validYears.length === v.validCount && integer(v.flaggedCount) &&
    year(v.firstYear) && year(v.lastYear) && v.firstYear <= v.lastYear && typeof v.analysisBlocked === 'boolean' && typeof v.limitation === 'string';
}
function page(v: unknown, offset: number): v is Page<unknown> {
  return object(v) && integer(v.total) && v.offset === offset && integer(v.limit) && v.limit > 0 &&
    Array.isArray(v.rows) && v.rows.length === Math.min(v.limit, Math.max(0, v.total - offset));
}
export async function getWorldBankRun(id: string, provider: WorldBankProvider = 'worldbank'): Promise<WorldBankRun> {
  const value = await providerRequest(`/${provider}/${encodeURIComponent(id)}`);
  if (!validRun(value) || (provider === 'ids' && !validIdsSummary(value))) throw new Error('Invalid World Bank snapshot contract; last valid review retained.');
  return value;
}
export async function startWorldBank(provider: WorldBankProvider = 'worldbank'): Promise<WorldBankRun> {
  const value = await providerRequest(`/providers/${provider}/pull`, true, { researchUse: true });
  if (!validRun(value) || (provider === 'ids' && !validIdsSummary(value))) throw new Error('Invalid World Bank acquisition contract.');
  return value;
}
export async function mutateWorldBank(id: string, action: 'commit' | 'rollback' | 'cancel', provider: WorldBankProvider = 'worldbank'): Promise<void> {
  await providerRequest(action === 'cancel' ? `/providers/${provider}/${encodeURIComponent(id)}/cancel` : `/${provider}/${encodeURIComponent(id)}/${action}`, true);
}
export async function getWorldBankObservations(id: string, country: string, indicator: string, provider: WorldBankProvider = 'worldbank'): Promise<WorldBankObservations> {
  const params = new URLSearchParams({ country, indicator, limit: '400' });
  const v = await providerRequest(`/${provider}/${encodeURIComponent(id)}/observations?${params}`);
  if (!page(v, 0) || !('series' in v) || !(v.series === null || validSeries(v.series)) ||
    !v.rows.every((r): r is WorldBankRow => validRow(r, provider)) || v.rows.some(r => r.country !== country || r.indicator !== indicator) ||
    new Set(v.rows.map(r => r.year)).size !== v.rows.length ||
    (v.series !== null && (v.series.country !== country || v.series.indicator !== indicator ||
      v.series.validCount !== v.rows.filter(r => r.value !== null).length)) ||
    (v.series === null && v.rows.length !== 0) || v.total !== v.rows.length) {
    throw new Error('Invalid, mixed or truncated World Bank annual series contract.');
  }
  return { rows: v.rows, series: v.series, total: v.total, offset: v.offset, limit: v.limit };
}
export async function getWorldBankCoverage(id: string, country = '', offset = 0, provider: WorldBankProvider = 'worldbank'): Promise<Page<WorldBankCoverage>> {
  const params = new URLSearchParams({ country, offset: String(offset), limit: '50' });
  const v = await providerRequest(`/${provider}/${encodeURIComponent(id)}/coverage?${params}`);
  const valid = (r: unknown): r is WorldBankCoverage => object(r) &&
    ['country', 'name', 'indicator', 'indicatorName'].every(k => typeof r[k] === 'string') &&
    integer(r.validCount) && typeof r.absent === 'boolean' && r.absent === (r.validCount === 0) &&
    years(r.missingYears) && typeof r.analysisBlocked === 'boolean' && (!country || r.country === country);
  if (!page(v, offset) || !v.rows.every(valid)) throw new Error('Invalid World Bank coverage contract.');
  return { rows: v.rows, total: v.total, offset: v.offset, limit: v.limit };
}
