import { providerRequest } from './imfApi';
import { validRow, validSeries, WeoRow, WeoSeries } from './weoApi';

export const DESK_INDICATORS = ['NGDP_RPCH', 'PCPIPCH', 'GGXWDG_NGDP', 'BCA_NGDPD'] as const;
export interface DeskMetric {
  code: string; label: string; unit: string; evidenceId: string;
  series: WeoSeries | null; rows: WeoRow[];
  latestActual: WeoRow | null; previousActual: WeoRow | null;
  changePp: number | null; changeBlockedReason: string | null;
  freshness: 'unverified'; missingActualYears: number[];
}
export interface DeskCountry {
  code: string; name: string; iso3: string | null; watchlisted: boolean; metrics: DeskMetric[];
}
export interface DeskAnalysis {
  contractVersion: 'weo-macro-desk-v1';
  rightsPolicy: 'local-research-only-publication-blocked-v1'; publicAllowed: false;
  watchlist: string[]; indicators: { code: string; label: string; unit: string }[];
  limitations: string[]; digest: string; unmappedWatchlist: string[];
  source: { provider: 'imf-weo'; runId: string; acquisitionStartedAt: string; retrievedAt: string | null; publicationDate: string | null;
    sources: { ordinal: number; path: string; sha256: string; httpStatus: number; bytes: number }[] };
  countries: DeskCountry[];
}
export interface DeskBundle { id: string; createdAt: string; reviewNote: string; analysis: DeskAnalysis }
export interface DeskBundleSummary { id: string; createdAt: string; runId: string; digest: string; reviewNote: string }
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const texts = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const sameRow = (a: WeoRow, b: WeoRow) => a.country === b.country && a.indicator === b.indicator &&
  a.year === b.year && a.value === b.value && a.rawValue === b.rawValue && a.classification === b.classification &&
  a.status === b.status && a.sourceHash === b.sourceHash &&
  Object.keys(a.attributes).length === Object.keys(b.attributes).length &&
  Object.entries(a.attributes).every(([key, value]) => b.attributes[key] === value);

function validMetric(v: unknown, country: string, runId: string, hashes: Set<string>): v is DeskMetric {
  if (!object(v) || !text(v.code) || !text(v.label) || !text(v.unit) ||
    v.evidenceId !== `${runId}/${country}/${v.code}` || v.freshness !== 'unverified' ||
    !(v.series === null || validSeries(v.series)) || !Array.isArray(v.rows) || !v.rows.every(validRow) ||
    !Array.isArray(v.missingActualYears) || !v.missingActualYears.every(integer) ||
    !(v.changePp === null || finite(v.changePp)) ||
    !(v.changeBlockedReason === null || text(v.changeBlockedReason)) ||
    !(v.latestActual === null || validRow(v.latestActual)) || !(v.previousActual === null || validRow(v.previousActual))) return false;
  const rows = v.rows;
  const series = v.series;
  if (rows.some((r, i) => r.country !== country || r.indicator !== v.code || !hashes.has(r.sourceHash) ||
    (i > 0 && r.year <= rows[i - 1].year) || (r.classification === 'actual' &&
      (!series || series.latestActualYear === null || r.year > series.latestActualYear || r.status === 'F'))) ||
    (series === null ? rows.length !== 0 : series.country !== country || series.indicator !== v.code ||
      !hashes.has(series.sourceHash))) return false;
  const actual = rows.filter(r => r.value !== null && r.classification === 'actual').at(-1);
  if (actual ? v.latestActual === null || !sameRow(v.latestActual, actual) : v.latestActual !== null) return false;
  const previous = v.previousActual;
  if (previous && (!rows.some(r => sameRow(r, previous)) ||
    previous.classification !== 'actual' || !actual || previous.year !== actual.year - 1)) return false;
  if (JSON.stringify(v.missingActualYears) !== JSON.stringify(rows.filter(r => r.value === null && r.classification === 'actual').map(r => r.year))) return false;
  if (v.changePp !== null) {
    if (v.changeBlockedReason !== null || !v.latestActual || !v.previousActual || v.previousActual.value === null ||
      v.latestActual.value === null || !v.series || v.series.analysisBlocked ||
      v.series.unit !== 'PT' || v.series.scale !== '0' || v.series.attributes.FREQUENCY !== 'A' ||
      [v.latestActual, v.previousActual].some(r => ['B', 'D', 'F'].includes(r.status ?? '')) ||
      v.changePp !== v.latestActual.value - v.previousActual.value) return false;
    const observational = new Set(['OBS_VALUE', 'TIME_PERIOD', 'STATUS', 'OBS_STATUS']);
    const previousAttributes = v.previousActual.attributes;
    const a = Object.entries(v.latestActual.attributes).filter(([key]) => !observational.has(key));
    const b = Object.entries(previousAttributes).filter(([key]) => !observational.has(key));
    if (a.length !== b.length || a.some(([key, value]) => previousAttributes[key] !== value)) return false;
  } else if (!text(v.changeBlockedReason)) return false;
  return true;
}

function validCountry(c: unknown, watchlist: string[], runId: string, hashes: Set<string>): c is DeskCountry {
  if (!object(c) || !text(c.code) || !text(c.name) ||
    !(c.iso3 === null || (text(c.iso3) && /^[A-Z]{3}$/.test(c.iso3))) ||
    c.watchlisted !== (typeof c.iso3 === 'string' && watchlist.includes(c.iso3)) ||
    !Array.isArray(c.metrics) || c.metrics.length !== 4) return false;
  const code = c.code;
  return c.metrics.every((m, n) => validMetric(m, code, runId, hashes) && m.code === DESK_INDICATORS[n]);
}
function validSource(s: unknown): s is DeskAnalysis['source'] {
  return object(s) && s.provider === 'imf-weo' && text(s.runId) && date(s.acquisitionStartedAt) &&
    (s.retrievedAt === null || date(s.retrievedAt)) &&
    (s.publicationDate === null || date(s.publicationDate)) &&
    Array.isArray(s.sources) && s.sources.length > 0 && s.sources.every(source =>
      object(source) && integer(source.ordinal) && source.ordinal > 0 && text(source.path) && hash(source.sha256) &&
      integer(source.httpStatus) && integer(source.bytes));
}

export function validateDeskAnalysis(v: unknown): asserts v is DeskAnalysis {
  if (!object(v) || v.contractVersion !== 'weo-macro-desk-v1' ||
    v.rightsPolicy !== 'local-research-only-publication-blocked-v1' || v.publicAllowed !== false ||
    !hash(v.digest) || !texts(v.watchlist) || new Set(v.watchlist).size !== v.watchlist.length ||
    !texts(v.unmappedWatchlist) || !texts(v.limitations) || !v.limitations.length ||
    !Array.isArray(v.indicators) || v.indicators.length !== 4 || v.indicators.some((i, n) =>
      !object(i) || i.code !== DESK_INDICATORS[n] || !text(i.label) || !text(i.unit)) ||
    !validSource(v.source) || !Array.isArray(v.countries) || !v.countries.length) {
    throw new Error('Invalid macro desk evidence contract; no replacement analysis displayed.');
  }
  const runId = v.source.runId;
  const hashes = new Set(v.source.sources.map(s => s.sha256));
  const countries: DeskCountry[] = [];
  for (const c of v.countries) {
    if (!validCountry(c, v.watchlist, runId, hashes)) {
      throw new Error('Invalid country or macro metric evidence; analysis blocked.');
    }
    countries.push(c);
  }
  const iso = countries.flatMap(c => c.iso3 === null ? [] : [c.iso3]);
  if (new Set(countries.map(c => c.code)).size !== countries.length || new Set(iso).size !== iso.length ||
    JSON.stringify([...v.unmappedWatchlist].sort()) !== JSON.stringify(v.watchlist.filter(c => !iso.includes(c)).sort())) {
    throw new Error('Ambiguous macro desk country mapping.');
  }
}

function validSummary(v: unknown): v is DeskBundleSummary {
  return object(v) && text(v.id) && date(v.createdAt) && text(v.runId) && hash(v.digest) && text(v.reviewNote);
}
function validateBundle(v: unknown): DeskBundle {
  if (!object(v) || !text(v.id) || !date(v.createdAt) || !text(v.reviewNote)) throw new Error('Invalid reviewed bundle metadata.');
  validateDeskAnalysis(v.analysis);
  return { id: v.id, createdAt: v.createdAt, reviewNote: v.reviewNote, analysis: v.analysis };
}
export async function loadDeskPreview(runId: string): Promise<DeskAnalysis> {
  const value = await providerRequest(`/analysis/preview/${encodeURIComponent(runId)}`);
  validateDeskAnalysis(value);
  if (value.source.runId !== runId) throw new Error('Macro desk source selection mismatch.');
  return value;
}
export async function loadDeskBundles(): Promise<DeskBundleSummary[]> {
  const value = await providerRequest('/analysis/bundles');
  if (!Array.isArray(value) || !value.every(validSummary)) throw new Error('Invalid macro desk bundle list.');
  return value;
}
export async function loadDeskBundle(id: string): Promise<DeskBundle> {
  const value = validateBundle(await providerRequest(`/analysis/bundles/${encodeURIComponent(id)}`));
  if (value.id !== id) throw new Error('Macro desk bundle selection mismatch.');
  return value;
}
export async function saveDeskBundle(analysis: DeskAnalysis, reviewNote: string): Promise<DeskBundle> {
  const value = validateBundle(await providerRequest('/analysis/bundles', true, {
    runId: analysis.source.runId, expectedDigest: analysis.digest, reviewNote, researchUse: true
  }));
  if (value.analysis.digest !== analysis.digest || value.analysis.source.runId !== analysis.source.runId) {
    throw new Error('Saved bundle differs from reviewed evidence.');
  }
  return value;
}
