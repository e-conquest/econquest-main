import { WeoRow, WeoSeries } from '../services/weoApi';

export function weoHistory(rows: WeoRow[], series: WeoSeries | null) {
  const sorted = [...rows].sort((a, b) => a.year - b.year);
  if (new Set(sorted.map(r => r.year)).size !== sorted.length || sorted.some(r =>
    !Number.isInteger(r.year) || r.year < 1900 || r.year >= 2200 ||
    (r.value !== null && !Number.isFinite(r.value)) || !series || r.country !== series.country || r.indicator !== series.indicator
  )) throw new Error('Invalid or mixed WEO annual series.');
  const segments: WeoRow[][] = [];
  let segment: WeoRow[] = [];
  for (const row of sorted) {
    const previous = segment.at(-1);
    const broken = row.status === 'B' || row.status === 'D' || previous?.status === 'B' || previous?.status === 'D';
    if (row.value === null || (previous && (row.year !== previous.year + 1 || row.classification !== previous.classification || broken))) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (row.value !== null) segment.push(row);
  }
  if (segment.length) segments.push(segment);
  const actual = sorted.filter(r => r.value !== null && r.classification === 'actual');
  const estimates = sorted.filter(r => r.value !== null && r.classification === 'estimate_projection');
  return { sorted, segments, latestActual: actual.at(-1), estimates,
    unknownCount: sorted.filter(r => r.value !== null && r.classification === 'unknown').length };
}
