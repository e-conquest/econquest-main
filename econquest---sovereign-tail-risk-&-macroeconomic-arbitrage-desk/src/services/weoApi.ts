import { MacroRun, MacroSummary, providerRequest, validMacroSummary } from './imfApi';

export interface WeoReport {
  errors?: string[];
  publicationDate?: string;
  firstYear?: number;
  lastYear?: number;
  rowCount?: number;
  seriesCount?: number;
  requiredPairs?: number;
  absentPairs?: number;
  availableEconomies?: number;
  availableIndicators?: number;
  analysisBlockedSeries?: number;
  unknownClassificationRows?: number;
  countries?: { code: string; name: string; iso3: string | null }[];
  indicators?: { code: string; name: string; description: string }[];
  classificationPolicy?: string;
  coveragePolicy?: string;
  valueConvention?: string;
  limitation?: string;
}
export interface WeoSummary extends Omit<MacroSummary, 'report'> { report: WeoReport }
export interface WeoRun extends WeoSummary { sources: MacroRun['sources'] }
export type WeoClassification = 'actual' | 'estimate_projection' | 'unknown';
export interface WeoRow {
  country: string; indicator: string; year: number; value: number | null; rawValue: string | null;
  classification: WeoClassification; status: string | null; sourceHash: string; attributes: Record<string, string>;
}
export interface WeoSeries {
  country: string; indicator: string; unit: string | null; unitLabel: string;
  scale: string | null; scaleLabel: string; latestActualYear: number | null;
  validCount: number; missingCount: number; missingYears: number[];
  attributes: Record<string, string>; sourceHash: string; analysisBlocked: boolean;
  classificationNote?: string | null;
}
export interface WeoCoverage {
  country: string; name: string; indicator: string; indicatorName: string;
  validCount: number; absent: boolean; missingYears: number[]; latestActualYear: number | null; analysisBlocked: boolean;
}
interface Page<T> { rows: T[]; total: number; offset: number; limit: number }
export interface WeoObservations extends Page<WeoRow> { series: WeoSeries | null }
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const year = (v: unknown): v is number => integer(v) && v >= 1900 && v < 2200;
const nullableYear = (v: unknown) => v === null || year(v);
const strings = (v: unknown): v is Record<string, string> => object(v) && Object.values(v).every(x => typeof x === 'string');
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const years = (v: unknown): v is number[] => Array.isArray(v) && v.every(year);

function validReport(v: unknown): v is WeoReport {
  return object(v) && (v.errors === undefined || (Array.isArray(v.errors) && v.errors.every(x => typeof x === 'string'))) &&
    ['rowCount', 'seriesCount', 'requiredPairs', 'absentPairs', 'availableEconomies', 'availableIndicators', 'analysisBlockedSeries', 'unknownClassificationRows'].every(k => v[k] === undefined || integer(v[k])) &&
    ['firstYear', 'lastYear'].every(k => v[k] === undefined || year(v[k])) &&
    (v.publicationDate === undefined || (typeof v.publicationDate === 'string' && Number.isFinite(Date.parse(v.publicationDate)))) &&
    ['classificationPolicy', 'coveragePolicy', 'valueConvention', 'limitation'].every(k => v[k] === undefined || typeof v[k] === 'string') &&
    (v.countries === undefined || (Array.isArray(v.countries) && v.countries.every(c => object(c) && typeof c.code === 'string' && typeof c.name === 'string' && (c.iso3 === null || typeof c.iso3 === 'string')))) &&
    (v.indicators === undefined || (Array.isArray(v.indicators) && v.indicators.every(i => object(i) && ['code', 'name', 'description'].every(k => typeof i[k] === 'string'))));
}
export function validWeoSummary(v: unknown): v is WeoSummary {
  return object(v) && validReport(v.report) && validMacroSummary({ ...v, report: {} });
}
function validRun(v: unknown): v is WeoRun {
  return validWeoSummary(v) && 'sources' in v && Array.isArray(v.sources) && v.sources.every(s => object(s) &&
    integer(s.ordinal) && typeof s.path === 'string' && integer(s.httpStatus) && integer(s.bytes) && hash(s.sha256));
}
function validRow(v: unknown): v is WeoRow {
  return object(v) && typeof v.country === 'string' && typeof v.indicator === 'string' && year(v.year) &&
    (v.value === null || (typeof v.value === 'number' && Number.isFinite(v.value))) && (v.rawValue === null || typeof v.rawValue === 'string') &&
    ['actual', 'estimate_projection', 'unknown'].includes(String(v.classification)) && (v.status === null || typeof v.status === 'string') &&
    hash(v.sourceHash) && strings(v.attributes);
}
function validSeries(v: unknown): v is WeoSeries {
  return object(v) && ['country', 'indicator', 'unitLabel', 'scaleLabel'].every(k => typeof v[k] === 'string') &&
    ['unit', 'scale'].every(k => v[k] === null || typeof v[k] === 'string') && nullableYear(v.latestActualYear) &&
    integer(v.validCount) && integer(v.missingCount) && years(v.missingYears) &&
    strings(v.attributes) && hash(v.sourceHash) && typeof v.analysisBlocked === 'boolean' &&
    (v.classificationNote == null || typeof v.classificationNote === 'string');
}
function page(v: unknown, offset: number): v is Page<unknown> {
  return object(v) && integer(v.total) && v.offset === offset && integer(v.limit) &&
    Array.isArray(v.rows) && v.rows.length <= v.limit && v.rows.length <= v.total;
}
export async function getWeoRun(id: string): Promise<WeoRun> {
  const value = await providerRequest(`/weo/${encodeURIComponent(id)}`);
  if (!validRun(value)) throw new Error('Invalid WEO release contract; last valid review retained.');
  return value;
}
export async function startWeo(): Promise<WeoRun> {
  const value = await providerRequest('/providers/imf-weo/pull', true);
  if (!validRun(value)) throw new Error('Invalid WEO acquisition contract.');
  return value;
}
export async function mutateWeo(id: string, action: 'commit' | 'rollback' | 'cancel'): Promise<void> {
  await providerRequest(action === 'cancel' ? `/providers/imf-weo/${encodeURIComponent(id)}/cancel` : `/weo/${encodeURIComponent(id)}/${action}`, true);
}
export async function getWeoObservations(id: string, country: string, indicator: string): Promise<WeoObservations> {
  const params = new URLSearchParams({ country, indicator, limit: '400' });
  const v = await providerRequest(`/weo/${encodeURIComponent(id)}/observations?${params}`);
  if (!page(v, 0) || !('series' in v) || !(v.series === null || validSeries(v.series)) ||
    !v.rows.every(validRow) || v.rows.some(r => r.country !== country || r.indicator !== indicator) ||
    (v.series !== null && (v.series.country !== country || v.series.indicator !== indicator)) || v.total !== v.rows.length) {
    throw new Error('Invalid or truncated WEO annual series contract.');
  }
  return { rows: v.rows, series: v.series, total: v.total, offset: v.offset, limit: v.limit };
}
export async function getWeoCoverage(id: string, country = '', indicator = '', offset = 0): Promise<Page<WeoCoverage>> {
  const params = new URLSearchParams({ country, indicator, offset: String(offset), limit: '50' });
  const v = await providerRequest(`/weo/${encodeURIComponent(id)}/coverage?${params}`);
  const valid = (r: unknown): r is WeoCoverage => object(r) &&
    ['country', 'name', 'indicator', 'indicatorName'].every(k => typeof r[k] === 'string') &&
    integer(r.validCount) && typeof r.absent === 'boolean' && years(r.missingYears) &&
    nullableYear(r.latestActualYear) && typeof r.analysisBlocked === 'boolean';
  if (!page(v, offset) || !v.rows.every(valid)) throw new Error('Invalid WEO coverage contract.');
  return { rows: v.rows, total: v.total, offset: v.offset, limit: v.limit };
}
