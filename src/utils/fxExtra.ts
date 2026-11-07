/**
 * Daily exchange rates per US dollar for currencies the ECB does not publish (gap analysis D1,
 * 2026-11-07), each straight from the central bank or its official open-data portal, free and
 * without a key:
 *
 * - PEN: Banco Central de Reserva del Perú, interbank rate (sell), series PD04638PD.
 * - COP: Tasa Representativa del Mercado (TRM), certified by the Superintendencia Financiera, on
 *   datos.gov.co (dataset 32sa-8pi3).
 * - ARS: Banco Central de la República Argentina, official quote (Cotizaciones, USD).
 *
 * Reply formats checked against each source on 2026-11-07. A day a source did not publish has no
 * point: nothing is filled in or carried forward (a TRM row valid over a weekend counts once, on
 * its first day). The ECB file (src/utils/fxHistory.ts) wins for every currency it has; these are
 * read only for the others. Saved by the server to data/live/fx-extra.json.
 *
 * Browser-safe, pure.
 */
import type { Series, SeriesPoint } from './seriesHistory';

export type ExtraFxCode = 'PEN' | 'COP' | 'ARS';

export interface ExtraFxSource {
  code: ExtraFxCode;
  name: string;
  /** Short label for the source line. */
  source: string;
  /** First day asked for. */
  firstDay: string;
  about: string;
}

export const EXTRA_FX: Record<ExtraFxCode, ExtraFxSource> = {
  PEN: {
    code: 'PEN',
    name: 'Peruvian sol',
    source: 'Banco Central de Reserva del Perú, interbank rate (sell), PD04638PD',
    firstDay: '2000-01-01',
    about: 'Soles per US dollar, interbank market, sell side, as published daily by the BCRP.',
  },
  COP: {
    code: 'COP',
    name: 'Colombian peso',
    source: 'TRM (Superintendencia Financiera de Colombia), datos.gov.co',
    firstDay: '2000-01-01',
    about: 'Pesos per US dollar, the Tasa Representativa del Mercado certified for each business day; one point on the first day of each validity period.',
  },
  ARS: {
    code: 'ARS',
    name: 'Argentine peso',
    source: 'Banco Central de la República Argentina, official quote',
    firstDay: '2003-01-01',
    about: 'Pesos per US dollar, the BCRA official quote (Cotizaciones, USD). Parallel-market rates are not included.',
  },
};

export interface ExtraFxSeriesFile {
  pulledAt: string;
  /** Last day the full history was asked for; later pulls ask only for the recent window. */
  through: string;
  rates: Record<string, number>;
}

export interface FxExtraFile {
  version: 1;
  currencies: Partial<Record<ExtraFxCode, ExtraFxSeriesFile>>;
}

export const EMPTY_FX_EXTRA: FxExtraFile = { version: 1, currencies: {} };

/** A pull asks again for this many days back, so late corrections are picked up. */
export const FX_EXTRA_RECENT_DAYS = 45;
export const FX_EXTRA_REFRESH_MS = 12 * 60 * 60 * 1000;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000));

/** Windows to ask for: [from, to] pairs, oldest first. ARS pages by year (the API caps rows per reply). */
export function extraFxWindows(code: ExtraFxCode, saved: ExtraFxSeriesFile | undefined, now = new Date()): Array<[string, string]> {
  const today = isoDay(now);
  const from = saved?.through ? addDays(saved.through, -FX_EXTRA_RECENT_DAYS) : EXTRA_FX[code].firstDay;
  if (from > today) return [];
  const step = code === 'ARS' ? 365 : code === 'PEN' ? 365 * 5 : 365 * 40;
  const out: Array<[string, string]> = [];
  for (let a = from; a <= today; a = addDays(a, step)) {
    const b = addDays(a, step - 1);
    out.push([a, b < today ? b : today]);
  }
  return out;
}

export function extraFxNeedsPull(saved: ExtraFxSeriesFile | undefined, now = new Date()): boolean {
  if (!saved) return true;
  const t = Date.parse(saved.pulledAt);
  return !Number.isFinite(t) || now.getTime() - t >= FX_EXTRA_REFRESH_MS;
}

export function extraFxUrl(code: ExtraFxCode, from: string, to: string): string {
  if (code === 'PEN') return `https://estadisticas.bcrp.gob.pe/estadisticas/series/api/PD04638PD/json/${from}/${to}`;
  if (code === 'COP')
    return `https://www.datos.gov.co/resource/32sa-8pi3.json?$where=${encodeURIComponent(`vigenciadesde>='${from}T00:00:00' AND vigenciadesde<='${to}T23:59:59'`)}&$order=vigenciadesde&$limit=50000`;
  return `https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD?fechadesde=${from}&fechahasta=${to}&limit=1000`;
}

const BCRP_MONTHS: Record<string, string> = { Ene: '01', Feb: '02', Mar: '03', Abr: '04', May: '05', Jun: '06', Jul: '07', Ago: '08', Set: '09', Sep: '09', Oct: '10', Nov: '11', Dic: '12' };

/** Plausible units per US dollar: rejects zeros, negatives and absurd values. */
const ok = (v: number) => Number.isFinite(v) && v > 0 && v < 1e7;

/** BCRP: { periods: [{ name: '01.Set.26', values: ['3.36'] }] }; 'n.d.' means not published. */
export function parseBcrpDaily(json: unknown): Record<string, number> | null {
  const periods = (json as { periods?: unknown })?.periods;
  if (!Array.isArray(periods)) return null;
  const out: Record<string, number> = {};
  for (const p of periods as Array<{ name?: unknown; values?: unknown }>) {
    const m = /^(\d{2})\.([A-Za-z]{3})\.(\d{2})$/.exec(String(p?.name ?? ''));
    const mon = m && BCRP_MONTHS[m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase()];
    if (!m || !mon) continue;
    const v = Number(Array.isArray(p.values) ? p.values[0] : NaN);
    if (!ok(v)) continue;
    const yy = Number(m[3]);
    out[`${yy >= 90 ? 1900 + yy : 2000 + yy}-${mon}-${m[1]}`] = Number(v.toFixed(6));
  }
  return Object.keys(out).length ? out : null;
}

/** datos.gov.co TRM: [{ valor: '3213.97', unidad: 'COP', vigenciadesde: '2026-09-01T00:00:00.000' }]. */
export function parseTrm(json: unknown): Record<string, number> | null {
  if (!Array.isArray(json)) return null;
  const out: Record<string, number> = {};
  for (const r of json as Array<{ valor?: unknown; unidad?: unknown; vigenciadesde?: unknown }>) {
    const day = String(r?.vigenciadesde ?? '').slice(0, 10);
    const v = Number(r?.valor);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || (r?.unidad !== undefined && r.unidad !== 'COP') || !ok(v)) continue;
    out[day] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** BCRA: { results: [{ fecha: 'YYYY-MM-DD', detalle: [{ codigoMoneda: 'USD', tipoCotizacion: 1513 }] }] }. */
export function parseBcraQuotes(json: unknown): Record<string, number> | null {
  const results = (json as { results?: unknown })?.results;
  if (!Array.isArray(results)) return null;
  const out: Record<string, number> = {};
  for (const r of results as Array<{ fecha?: unknown; detalle?: unknown }>) {
    const day = String(r?.fecha ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Array.isArray(r.detalle)) continue;
    const usd = (r.detalle as Array<{ codigoMoneda?: unknown; tipoCotizacion?: unknown }>).find((d) => d?.codigoMoneda === 'USD');
    const v = Number(usd?.tipoCotizacion);
    if (ok(v)) out[day] = v;
  }
  return Object.keys(out).length ? out : null;
}

export function parseExtraFx(code: ExtraFxCode, json: unknown): Record<string, number> | null {
  return code === 'PEN' ? parseBcrpDaily(json) : code === 'COP' ? parseTrm(json) : parseBcraQuotes(json);
}

/** Shape check for a file read from disk; anything else reads as empty. */
export function readFxExtraFile(raw: unknown): FxExtraFile {
  const cur = (raw as { currencies?: unknown })?.currencies;
  const out: FxExtraFile = { version: 1, currencies: {} };
  if (!cur || typeof cur !== 'object') return out;
  for (const code of Object.keys(EXTRA_FX) as ExtraFxCode[]) {
    const s = (cur as Record<string, Partial<ExtraFxSeriesFile>>)[code];
    if (s && typeof s.pulledAt === 'string' && typeof s.through === 'string' && s.rates && typeof s.rates === 'object') out.currencies[code] = { pulledAt: s.pulledAt, through: s.through, rates: s.rates };
  }
  return out;
}

/** Daily units per US dollar for a non-ECB currency, oldest first; null when it is not one of these or nothing is saved. */
export function extraFxDailySeries(file: FxExtraFile | null | undefined, ccy: string | undefined): Series | null {
  const code = String(ccy || '').toUpperCase() as ExtraFxCode;
  const def = EXTRA_FX[code];
  const saved = def ? file?.currencies?.[code] : undefined;
  if (!def || !saved) return null;
  const points: SeriesPoint[] = Object.entries(saved.rates)
    .filter(([, v]) => typeof v === 'number' && ok(v))
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!points.length) return null;
  return {
    id: 'fx_per_usd',
    label: 'Exchange rate',
    unit: `${code} per USD`,
    freq: 'daily',
    source: def.source,
    pulledAt: saved.pulledAt,
    points,
    about: `${def.about} A higher number is a weaker ${code}.`,
  };
}
