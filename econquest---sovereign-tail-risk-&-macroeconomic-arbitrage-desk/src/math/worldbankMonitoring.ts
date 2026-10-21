import { WorldBankRow } from '../services/worldbankApi';

export function worldbankHistory(rows: WorldBankRow[]) {
  const sorted = [...rows].sort((a, b) => a.year - b.year);
  const first = sorted[0];
  if (new Set(sorted.map(r => r.year)).size !== sorted.length || sorted.some(r =>
    !Number.isInteger(r.year) || r.year < 1900 || r.year >= 2100 || (r.value !== null && !Number.isFinite(r.value)) ||
    r.country !== first.country || r.indicator !== first.indicator || r.sourceId !== first.sourceId || r.counterpart !== first.counterpart
  )) throw new Error('Invalid or mixed World Bank annual series.');
  const segments: WorldBankRow[][] = [];
  let segment: WorldBankRow[] = [];
  for (const row of sorted) {
    const previous = segment.at(-1);
    if (row.value === null || (previous && (row.year !== previous.year + 1 ||
      row.unit !== previous.unit || row.status || previous.status || row.footnote || previous.footnote ||
      Object.keys(row.attributes ?? {}).length || Object.keys(previous.attributes ?? {}).length))) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (row.value !== null) segment.push(row);
  }
  if (segment.length) segments.push(segment);
  return { sorted, segments };
}
