import { fredDate, FredRow } from '../services/fredApi';

export function fredHistory(rows: FredRow[], frequency: 'D' | 'M' | 'Q') {
  if (rows.some((r, i) => !fredDate(r.date) || (r.value !== null && !Number.isFinite(r.value)) ||
    (i > 0 && (r.date <= rows[i - 1].date || r.seriesId !== rows[0].seriesId ||
      r.realtimeStart !== rows[0].realtimeStart || r.realtimeEnd !== rows[0].realtimeEnd)))) {
    throw new Error('Invalid, unsorted or mixed FRED history.');
  }
  const segments: FredRow[][] = [];
  let segment: FredRow[] = [];
  for (const row of rows) {
    const previous = segment.at(-1);
    let consecutive = true;
    if (previous) {
      const expected = new Date(`${previous.date}T00:00:00Z`);
      if (frequency === 'D') expected.setUTCDate(expected.getUTCDate() + 1);
      else expected.setUTCMonth(expected.getUTCMonth() + (frequency === 'M' ? 1 : 3));
      consecutive = expected.toISOString().slice(0, 10) === row.date;
    }
    if (row.value === null || !consecutive) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (row.value !== null) segment.push(row);
  }
  if (segment.length) segments.push(segment);
  return { segments, valid: rows.filter(r => r.value !== null), missing: rows.filter(r => r.value === null) };
}
