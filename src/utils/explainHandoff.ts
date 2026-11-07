/**
 * "Explain" on a figure, chart or panel anywhere in the app: the page fires this event with the
 * exact figure (as shown, with source and as-of); App opens Council chat and the chat asks the
 * council to explain it (src/utils/explain.ts).
 *
 * Browser-safe.
 */
import type { ChartResult } from './councilChart';
import type { ExplainFocus } from './explain';

export const EXPLAIN_EVENT = 'econquest:explain';

export function explainInChat(focus: ExplainFocus): void {
  window.dispatchEvent(new CustomEvent<ExplainFocus>(EXPLAIN_EVENT, { detail: focus }));
}

const num = (v: number) => String(Number(v.toFixed(Math.abs(v) >= 100 ? 0 : 2)));

/** A chart as a focus: its title, each line's latest point and source, and each test's reading. */
export function chartFocus(r: ChartResult): ExplainFocus {
  const countries = [...new Set((r.request?.series || []).map((s) => s.countryName).filter((c): c is string => Boolean(c)))];
  const iso = [...new Set((r.request?.series || []).map((s) => s.iso3).filter((c): c is string => Boolean(c)))];
  const lines = r.lines
    .filter((l) => l.points.length)
    .map((l) => {
      const last = l.points[l.points.length - 1];
      return `${l.label}: latest ${num(last.value)}${l.unit === '%' ? '%' : ` ${l.unit}`} (${last.date}) [${l.source}]`;
    });
  const tests = r.tests.filter((t) => t.figures.length).map((t) => `${t.title}: ${t.reading}`);
  return {
    kind: 'chart',
    label: r.title,
    ...(r.first && r.last ? { asOf: `${r.first} to ${r.last}` } : {}),
    ...(countries.length === 1 ? { countryName: countries[0] } : {}),
    ...(iso.length === 1 ? { iso3: iso[0] } : {}),
    detail: [...lines, ...tests].slice(0, 8),
  };
}
