/**
 * Survey inflation expectations (gap analysis D10, second part):
 *
 *   ECB Survey of Professional Forecasters (euro area, quarterly), ECB Data Portal, dataset SPF:
 *     mean point forecast of HICP inflation one year ahead, two years ahead and in the longer term.
 *     World series (the euro area is not a country page): spf_hicp_1y, spf_hicp_2y, spf_hicp_lt.
 *   Banco Central do Brasil Focus market survey (Brazil, daily), Olinda OData service
 *     "Expectativas", entity ExpectativasMercadoInflacao12Meses: median IPCA inflation expected over
 *     the next 12 months. Country series focus_ipca_12m on Brazil's page, shown at month-end.
 *
 * NOT VERIFIED YET: both APIs refuse automated readers from this project's cloud session, so the
 * ECB series keys and the Focus field names (Indicador, Data, Mediana, Suavizada, baseCalculo) are
 * written from the providers' published documentation as remembered, not read live. The parsers
 * look fields up by name, ignoring case, and give nothing (Missing with the reason) when the reply
 * does not match, so a wrong guess shows as Missing, never as a wrong number. `npm run check:data`
 * prints the start of each reply so the layout can be confirmed on a machine that reaches them.
 *
 * Browser-safe, pure.
 */
import type { Series, SeriesMissing, SeriesPoint } from './seriesHistory';

export type SurveyObs = { date: string; value: number };

export const ECB_SPF_SERIES: Array<{ id: string; key: string; label: string; about: string }> = [
  { id: 'spf_hicp_1y', key: 'Q.U2.HICP.POINT.P12M.Q.AVG', label: 'Euro area SPF: HICP inflation one year ahead', about: 'Mean point forecast of euro-area HICP inflation one year after the latest data, ECB Survey of Professional Forecasters, quarterly.' },
  { id: 'spf_hicp_2y', key: 'Q.U2.HICP.POINT.P24M.Q.AVG', label: 'Euro area SPF: HICP inflation two years ahead', about: 'Mean point forecast of euro-area HICP inflation two years after the latest data, ECB Survey of Professional Forecasters, quarterly.' },
  { id: 'spf_hicp_lt', key: 'Q.U2.HICP.POINT.LT.Q.AVG', label: 'Euro area SPF: HICP inflation, longer term', about: 'Mean point forecast of euro-area HICP inflation in the longer term (about five years ahead), ECB Survey of Professional Forecasters, quarterly. The ECB aims for 2% over the medium term.' },
];

export const ecbSpfUrl = (key: string) => `https://data-api.ecb.europa.eu/service/data/SPF/${key}?format=csvdata`;
export const ECB_SPF_SOURCE = 'ECB Survey of Professional Forecasters (ECB Data Portal, dataset SPF)';

export const FOCUS_URL =
  "https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoInflacao12Meses?$filter=Indicador%20eq%20'IPCA'&$orderby=Data%20desc&$top=10000&$format=json";
export const FOCUS_SOURCE = 'Banco Central do Brasil, Focus market expectations survey (Olinda OData, ExpectativasMercadoInflacao12Meses)';

/** ECB "csvdata": the TIME_PERIOD and OBS_VALUE columns, wherever they sit. Quarters "2026-Q3" become "2026Q3" (the app's quarter format). */
export function parseEcbCsv(text: string): SurveyObs[] {
  const lines = String(text || '').replace(/^﻿/, '').trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const split = (l: string) => l.split(',').map((c) => c.replace(/^"|"$/g, '').trim());
  const head = split(lines[0]).map((h) => h.toUpperCase());
  const ti = head.indexOf('TIME_PERIOD');
  const vi = head.indexOf('OBS_VALUE');
  if (ti < 0 || vi < 0) return [];
  const out: SurveyObs[] = [];
  for (const l of lines.slice(1)) {
    const c = split(l);
    const date = c[ti] || '';
    const raw = c[vi] || '';
    const value = Number(raw);
    if (!/^\d{4}(-Q[1-4]|-\d{2})?$/.test(date) || raw === '' || !Number.isFinite(value) || Math.abs(value) > 50) continue;
    out.push({ date: date.replace('-Q', 'Q'), value });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

const field = (row: Record<string, unknown>, name: string): unknown => {
  const k = Object.keys(row).find((x) => x.toLowerCase() === name.toLowerCase());
  return k === undefined ? undefined : row[k];
};

/**
 * Focus 12-month IPCA: one median per survey date. Prefers the smoothed series (Suavizada "S") and
 * the base of all respondents (baseCalculo 0) where the reply carries those fields.
 */
export function parseFocus12m(json: unknown): SurveyObs[] {
  const rows = (json as { value?: unknown })?.value;
  if (!Array.isArray(rows)) return [];
  const recs = rows.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object');
  const hasSmooth = recs.some((r) => field(r, 'Suavizada') !== undefined);
  const hasBase = recs.some((r) => field(r, 'baseCalculo') !== undefined);
  const byDate = new Map<string, number>();
  for (const r of recs) {
    const ind = field(r, 'Indicador');
    if (ind !== undefined && String(ind).toUpperCase() !== 'IPCA') continue;
    if (hasSmooth && String(field(r, 'Suavizada') ?? '').toUpperCase() !== 'S') continue;
    if (hasBase && Number(field(r, 'baseCalculo')) !== 0) continue;
    const date = String(field(r, 'Data') ?? '').slice(0, 10);
    const value = Number(field(r, 'Mediana'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || field(r, 'Mediana') === null || !Number.isFinite(value) || Math.abs(value) > 100) continue;
    byDate.set(date, value);
  }
  return [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, value]) => ({ date, value }));
}

export interface InflationSurveys {
  fetchedAt: string;
  /** ECB series key -> quarterly observations. */
  spf: Record<string, SurveyObs[]>;
  spfReason?: string;
  focus: SurveyObs[];
  focusReason?: string;
}

const monthEnd = (obs: SurveyObs[]): SeriesPoint[] => {
  const m = new Map<string, number>();
  for (const o of obs) m.set(o.date.slice(0, 7), o.value);
  return [...m.entries()].map(([date, value]) => ({ date, value }));
};

/** Brazil only: the Focus 12-month IPCA expectation, or Missing with the reason. */
export function focusSeries(iso3: string, s: InflationSurveys | null | undefined): Array<Series | SeriesMissing> {
  if (String(iso3 || '').toUpperCase() !== 'BRA') return [];
  const id = 'focus_ipca_12m';
  const label = 'Focus survey: IPCA inflation expected over the next 12 months';
  if (!s) return [{ id, label, reason: 'The BCB Focus service has not answered yet' }];
  if (!s.focus.length) return [{ id, label, reason: s.focusReason || 'The BCB Focus reply had no IPCA medians the app could read' }];
  const last = s.focus[s.focus.length - 1];
  return [{ id, label, unit: '%', freq: 'monthly', source: FOCUS_SOURCE, pulledAt: s.fetchedAt, points: monthEnd(s.focus), about: `Median of market forecasters' expected IPCA inflation over the next 12 months (smoothed), shown at month-end; latest survey ${last.date}: ${last.value.toFixed(2)}%. The BCB targets 3%.` }];
}

/** Euro-area SPF as world series, or Missing with the reason. */
export function spfWorldSeries(s: InflationSurveys | null | undefined): Array<Series | SeriesMissing> {
  return ECB_SPF_SERIES.map((d) => {
    if (!s) return { id: d.id, label: d.label, reason: 'The ECB Data Portal has not answered yet' };
    const obs = s.spf[d.key];
    if (!obs?.length) return { id: d.id, label: d.label, reason: s.spfReason || `The ECB gave no observations for SPF.${d.key}` };
    return { id: d.id, label: d.label, unit: '%', freq: 'quarterly' as const, source: `${ECB_SPF_SOURCE}, SPF.${d.key}`, pulledAt: s.fetchedAt, points: obs.map((o) => ({ date: o.date, value: o.value })), about: d.about };
  });
}
