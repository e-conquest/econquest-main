import { MacroRow } from '../services/imfApi';

export function monthNumber(period: string): number {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('Invalid monthly observation period.');
  return Number(period.slice(0, 4)) * 12 + Number(period.slice(5)) - 1;
}

function comparable(a: MacroRow, b: MacroRow): boolean {
  return a.country === b.country && a.indicator === b.indicator && a.scale === b.scale && a.unit === b.unit &&
    a.attributes.REFERENCE_PERIOD === b.attributes.REFERENCE_PERIOD &&
    a.attributes.COMMON_REFERENCE_PERIOD === b.attributes.COMMON_REFERENCE_PERIOD &&
    a.attributes.CURRENCY === b.attributes.CURRENCY && a.attributes.METHODOLOGY === b.attributes.METHODOLOGY &&
    ![a.status, b.status].some(status => status === 'B' || status === 'D' || status === 'F');
}

export function macroSeries(rows: MacroRow[]) {
  const sorted = [...rows].sort((a, b) => monthNumber(a.period) - monthNumber(b.period));
  if (new Set(sorted.map(r => r.period)).size !== sorted.length ||
    sorted.some(r => r.value !== null && (!Number.isFinite(r.value) || !!r.exclusionReason)) ||
    sorted.some(r => r.country !== sorted[0].country || r.indicator !== sorted[0].indicator)) {
    throw new Error('Invalid or mixed IMF series.');
  }
  const segments: MacroRow[][] = [];
  let segment: MacroRow[] = [];
  for (const row of sorted) {
    const previous = segment.at(-1);
    if (row.value === null || (previous && (monthNumber(row.period) - monthNumber(previous.period) !== 1 || !comparable(previous, row)))) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (row.value !== null) segment.push(row);
  }
  if (segment.length) segments.push(segment);
  const valid = sorted.filter(row => row.value !== null);
  const latest = valid.at(-1);
  const previous = latest && sorted.find(row => monthNumber(row.period) === monthNumber(latest.period) - 1);
  const change = latest && previous?.value !== null && previous !== undefined &&
    latest.indicator !== 'reserves' && comparable(previous, latest) && latest.scale === '0'
    ? latest.value! - previous.value! : null;
  return { sorted, segments, latest, change };
}
