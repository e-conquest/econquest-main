/**
 * Unit converters (seven-groups plan, Phase 5, teaching and journalists): an amount in local
 * currency turned into real terms, US dollars, per head and purchasing power parity, each step
 * with the figure it used, its year and its source.
 *
 *   Real       amount x CPI(target year) / CPI(amount's year)   World Bank CPI, 2010 = 100
 *   US dollars amount / exchange rate (yearly average)          World Bank, official rate (IMF IFS)
 *   Per head   amount / population                              World Bank population
 *   PPP        amount / PPP conversion factor                   World Bank ICP
 *
 * Only the year asked for is used; a year with no figure reads Missing with the years on file,
 * never the nearest year in its place. Browser-safe, pure.
 */
import type { SeriesPoint } from './seriesHistory';

export interface ConverterSeries {
  cpi?: SeriesPoint[];
  population?: SeriesPoint[];
  fx?: SeriesPoint[];
  ppp?: SeriesPoint[];
}

export interface ConvStep {
  label: string;
  value: number;
  unit: string;
  /** The factor and where it came from, in words. */
  how: string;
  source: string;
}

export type ConvResult = { ok: true; step: ConvStep } | { ok: false; label: string; reason: string };

export const CONVERTER_SOURCES = {
  cpi: 'World Bank WDI, consumer price index (FP.CPI.TOTL)',
  fx: 'World Bank WDI, official exchange rate (PA.NUS.FCRF, from IMF IFS)',
  population: 'World Bank WDI, population (SP.POP.TOTL)',
  ppp: 'World Bank ICP, PPP conversion factor for GDP (PA.NUS.PPP)',
} as const;

const real = (pts: SeriesPoint[] | undefined) => (pts || []).filter((p) => Number.isFinite(p.value) && p.note !== 'IMF projection');
const at = (pts: SeriesPoint[] | undefined, year: string) => real(pts).find((p) => String(p.date).slice(0, 4) === year)?.value;
const span = (pts: SeriesPoint[] | undefined) => {
  const r = real(pts);
  return r.length ? `on file ${String(r[0].date).slice(0, 4)} to ${String(r[r.length - 1].date).slice(0, 4)}` : 'none on file';
};
const sig = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : Number(v.toPrecision(4)).toString());

export function toReal(amount: number, year: string, target: string, cpi: SeriesPoint[] | undefined, cur: string): ConvResult {
  const label = `In ${target} prices`;
  const a = at(cpi, year);
  const b = at(cpi, target);
  if (a === undefined || b === undefined || a <= 0) return { ok: false, label, reason: `consumer price index for ${a === undefined ? year : target} not on file (${span(cpi)})` };
  return { ok: true, step: { label, value: (amount * b) / a, unit: `${cur}, ${target} prices`, how: `x CPI ${target} (${sig(b)}) / CPI ${year} (${sig(a)})`, source: CONVERTER_SOURCES.cpi } };
}

export function toUsd(amount: number, year: string, fx: SeriesPoint[] | undefined): ConvResult {
  const label = 'In US dollars';
  const r = at(fx, year);
  if (r === undefined || r <= 0) return { ok: false, label, reason: `exchange rate for ${year} not on file (${span(fx)})` };
  return { ok: true, step: { label, value: amount / r, unit: `US$, ${year}`, how: `/ ${sig(r)} local currency per US$ (${year} average)`, source: CONVERTER_SOURCES.fx } };
}

export function toPpp(amount: number, year: string, ppp: SeriesPoint[] | undefined): ConvResult {
  const label = 'At purchasing power parity';
  const r = at(ppp, year);
  if (r === undefined || r <= 0) return { ok: false, label, reason: `PPP conversion factor for ${year} not on file (${span(ppp)})` };
  return { ok: true, step: { label, value: amount / r, unit: `international $, ${year}`, how: `/ ${sig(r)} local currency per international $ (${year})`, source: CONVERTER_SOURCES.ppp } };
}

/** Per head of population; population is in millions. */
export function perHead(amount: number, year: string, population: SeriesPoint[] | undefined, unit: string): ConvResult {
  const label = 'Per head';
  const m = at(population, year);
  if (m === undefined || m <= 0) return { ok: false, label, reason: `population for ${year} not on file (${span(population)})` };
  return { ok: true, step: { label, value: amount / (m * 1e6), unit: `${unit} per person`, how: `/ ${sig(m)} million people (${year})`, source: CONVERTER_SOURCES.population } };
}

/** Every conversion of one local-currency amount. `target` is the year for real terms. */
export function convertAll(amount: number, year: string, target: string, s: ConverterSeries, cur = 'local currency'): ConvResult[] {
  const out: ConvResult[] = [toReal(amount, year, target, s.cpi, cur), toUsd(amount, year, s.fx), toPpp(amount, year, s.ppp), perHead(amount, year, s.population, cur)];
  const usd = out[1];
  if (usd.ok) {
    const ph = perHead(usd.step.value, year, s.population, 'US$');
    out.push(ph.ok ? { ok: true, step: { ...ph.step, label: 'Per head, US dollars', how: `${usd.step.how}, then ${ph.step.how}`, source: `${CONVERTER_SOURCES.fx}; ${CONVERTER_SOURCES.population}` } } : { ...ph, label: 'Per head, US dollars' });
  }
  return out;
}

export const fmtAmount = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : Math.abs(v) >= 1 ? v.toFixed(2) : Number(v.toPrecision(3)).toString());

export const CONVERTER_METHOD =
  'Real terms: the amount times the consumer price index of the target year over that of the amount\'s year (World Bank, 2010 = 100). US dollars: divided by the official exchange rate, the average of the year (World Bank, from IMF IFS). Purchasing power parity: divided by the World Bank ICP conversion factor for GDP. Per head: divided by the mid-year population. Only the year asked for is used: a missing year reads Missing, never the nearest year. Yearly averages, so a single day\'s amount converts only roughly.';
