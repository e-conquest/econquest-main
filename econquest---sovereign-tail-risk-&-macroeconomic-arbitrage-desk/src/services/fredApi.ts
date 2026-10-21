import { MacroRun, MacroSummary, providerRequest, validMacroSummary } from './imfApi';

export type FredMode = 'current' | 'historical';
export interface FredReport {
  mode: FredMode; asOf: string; errors?: string[]; retrievedAt?: string; rowCount?: number; seriesCount?: number;
  availableSeries?: number; numericCount?: number; missingCount?: number; unavailableSeries?: string[];
  valueConvention?: string; vintagePolicy?: string; coveragePolicy?: string; limitation?: string;
}
export interface FredSummary extends Omit<MacroSummary, 'report'> { report: FredReport }
export interface FredRun extends FredSummary { sources: MacroRun['sources'] }
export interface FredMetadata {
  id: string; title: string; units: string; units_short: string; frequency: string; frequency_short: 'D' | 'M' | 'Q';
  seasonal_adjustment: string; seasonal_adjustment_short: string; last_updated: string;
  observation_start: string; observation_end: string; realtime_start: string; realtime_end: string; notes?: string;
}
export interface FredSeries {
  id: string; name: string; metadata: FredMetadata; metadataAsOf: string; metadataSourceHash: string;
  vintageSourceHashes: string[]; vintageDates: string[]; firstArchivedVintage: string | null; latestEligibleVintage: string | null;
  status: 'available' | 'unavailable'; reason: string; validCount: number; missingCount: number;
  firstObservation: string | null; lastObservation: string | null; latestValidObservation: string | null; analysisBlocked: boolean;
}
export interface FredRow {
  seriesId: string; date: string; value: number | null; rawValue: string;
  realtimeStart: string; realtimeEnd: string; sourceHash: string;
}
export interface FredConfig { configured: boolean; today: string; earliestDate: string; series: { id: string; name: string; frequency: string }[] }
export interface FredHistory { rows: FredRow[]; series: FredSeries }
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const fredDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const nullableDate = (v: unknown) => v === null || fredDate(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string');

export function validFredSummary(v: unknown): v is FredSummary {
  if (!object(v) || !validMacroSummary({ ...v, report: {} }) || !object(v.report)) return false;
  const r = v.report;
  return ['current', 'historical'].includes(String(r.mode)) && fredDate(r.asOf) &&
    (r.errors === undefined || strings(r.errors)) && (r.unavailableSeries === undefined || strings(r.unavailableSeries)) &&
    ['rowCount', 'seriesCount', 'availableSeries', 'numericCount', 'missingCount'].every(k => r[k] === undefined || integer(r[k])) &&
    ['valueConvention', 'vintagePolicy', 'coveragePolicy', 'limitation'].every(k => r[k] === undefined || typeof r[k] === 'string') &&
    (r.retrievedAt === undefined || (typeof r.retrievedAt === 'string' && Number.isFinite(Date.parse(r.retrievedAt))));
}
function validRun(v: unknown): v is FredRun {
  return validFredSummary(v) && 'sources' in v && Array.isArray(v.sources) && v.sources.every(s => object(s) &&
    integer(s.ordinal) && typeof s.path === 'string' && !/[?&]api_key=/i.test(s.path) &&
    integer(s.httpStatus) && integer(s.bytes) && hash(s.sha256));
}
function validMetadata(v: unknown): v is FredMetadata {
  return object(v) && ['id', 'title', 'units', 'units_short', 'frequency', 'seasonal_adjustment', 'seasonal_adjustment_short', 'last_updated'].every(k => typeof v[k] === 'string' && v[k] !== '') &&
    ['D', 'M', 'Q'].includes(String(v.frequency_short)) &&
    ['observation_start', 'observation_end', 'realtime_start', 'realtime_end'].every(k => fredDate(v[k])) &&
    (v.notes === undefined || typeof v.notes === 'string');
}
function validSeries(v: unknown): v is FredSeries {
  return object(v) && typeof v.id === 'string' && typeof v.name === 'string' && validMetadata(v.metadata) &&
    v.metadata.id === v.id && fredDate(v.metadataAsOf) && v.metadata.realtime_start === v.metadataAsOf && v.metadata.realtime_end === v.metadataAsOf &&
    hash(v.metadataSourceHash) && Array.isArray(v.vintageSourceHashes) && v.vintageSourceHashes.every(hash) &&
    Array.isArray(v.vintageDates) && v.vintageDates.every(fredDate) &&
    v.vintageDates.every((d, i, a) => i === 0 || d > a[i - 1]) &&
    nullableDate(v.firstArchivedVintage) && nullableDate(v.latestEligibleVintage) &&
    v.firstArchivedVintage === (v.vintageDates[0] ?? null) &&
    (v.latestEligibleVintage === null || v.vintageDates.includes(v.latestEligibleVintage)) &&
    ['available', 'unavailable'].includes(String(v.status)) && typeof v.reason === 'string' &&
    integer(v.validCount) && integer(v.missingCount) && (v.status === 'available') === (v.validCount > 0) &&
    ['firstObservation', 'lastObservation', 'latestValidObservation'].every(k => nullableDate(v[k])) &&
    typeof v.analysisBlocked === 'boolean';
}
function validRow(v: unknown): v is FredRow {
  return object(v) && typeof v.seriesId === 'string' && fredDate(v.date) &&
    fredDate(v.realtimeStart) && fredDate(v.realtimeEnd) && hash(v.sourceHash) && typeof v.rawValue === 'string' &&
    (v.rawValue === '.' ? v.value === null :
      /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(v.rawValue) &&
      typeof v.value === 'number' && Number.isFinite(v.value) && Number(v.rawValue) === v.value);
}
export async function getFredConfig(): Promise<FredConfig> {
  const v = await providerRequest('/providers/fred/config');
  if (!object(v) || typeof v.configured !== 'boolean' || !fredDate(v.today) || !fredDate(v.earliestDate) ||
    !Array.isArray(v.series) || !v.series.every(s => object(s) && ['id', 'name', 'frequency'].every(k => typeof s[k] === 'string'))) {
    throw new Error('Invalid FRED configuration contract.');
  }
  return { configured: v.configured, today: v.today, earliestDate: v.earliestDate, series: v.series };
}
export async function getFredRun(id: string): Promise<FredRun> {
  const value = await providerRequest(`/fred/${encodeURIComponent(id)}`);
  if (!validRun(value)) throw new Error('Invalid FRED/ALFRED snapshot contract.');
  return value;
}
export async function startFred(mode: FredMode, asOf: string): Promise<FredRun> {
  const value = await providerRequest('/providers/fred/pull', true, { researchUse: true, mode, ...(mode === 'historical' ? { asOf } : {}) });
  if (!validRun(value) || value.report.mode !== mode || (mode === 'historical' && value.report.asOf !== asOf)) {
    throw new Error('Invalid FRED/ALFRED acquisition identity or contract.');
  }
  return value;
}
export async function mutateFred(id: string, action: 'commit' | 'rollback' | 'cancel'): Promise<void> {
  await providerRequest(action === 'cancel' ? `/providers/fred/${encodeURIComponent(id)}/cancel` : `/fred/${encodeURIComponent(id)}/${action}`, true);
}
export async function getFredCatalog(run: FredRun): Promise<FredSeries[]> {
  const v = await providerRequest(`/fred/${encodeURIComponent(run.id)}/series`);
  if (!object(v) || v.runId !== run.id || v.mode !== run.report.mode || v.asOf !== run.report.asOf ||
    !Array.isArray(v.series) || !v.series.every(validSeries) || new Set(v.series.map(s => s.id)).size !== v.series.length ||
    v.series.length !== run.report.seriesCount || v.series.some(s =>
      (s.status === 'available' && s.metadataAsOf !== run.report.asOf) ||
      (s.latestEligibleVintage !== null && s.latestEligibleVintage > run.report.asOf))) {
    throw new Error('Invalid FRED native-series catalog.');
  }
  return v.series;
}
export async function getFredHistory(run: FredRun, seriesId: string): Promise<FredHistory> {
  const rows: FredRow[] = [];
  let series: FredSeries | undefined;
  let total: number | undefined;
  do {
    const params = new URLSearchParams({ series_id: seriesId, offset: String(rows.length), limit: '5000' });
    const v = await providerRequest(`/fred/${encodeURIComponent(run.id)}/observations?${params}`);
    if (!object(v) || !integer(v.total) || v.total > 1_000_000 || v.offset !== rows.length || v.limit !== 5000 ||
      (total !== undefined && total !== v.total) || !validSeries(v.series) || v.series.id !== seriesId ||
      (series && JSON.stringify(series) !== JSON.stringify(v.series)) || !Array.isArray(v.rows) ||
      (v.series.status === 'available' && v.series.metadataAsOf !== run.report.asOf) ||
      (v.series.latestEligibleVintage !== null && v.series.latestEligibleVintage > run.report.asOf) ||
      v.rows.length !== Math.min(5000, Math.max(0, v.total - rows.length)) || !v.rows.every(validRow) ||
      v.rows.some(r => r.seriesId !== seriesId || r.realtimeStart !== run.report.asOf || r.realtimeEnd !== run.report.asOf || r.date > run.report.asOf)) {
      throw new Error('Invalid, mixed or truncated FRED history; previous review retained.');
    }
    total = v.total; series = v.series; rows.push(...v.rows);
  } while (rows.length < total);
  if (!series || rows.some((r, i) => i > 0 && r.date <= rows[i - 1].date) ||
    series.validCount !== rows.filter(r => r.value !== null).length || series.missingCount !== rows.filter(r => r.value === null).length ||
    series.firstObservation !== (rows[0]?.date ?? null) || series.lastObservation !== (rows.at(-1)?.date ?? null)) {
    throw new Error('FRED coverage counts or chronological identity do not match native history.');
  }
  return { rows, series };
}
