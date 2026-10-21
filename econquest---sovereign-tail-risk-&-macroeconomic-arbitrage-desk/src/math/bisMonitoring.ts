import type { BisRow } from '../services/bisApi';

export function bisQuarter(period: string): number {
  return Number(period.slice(0, 4)) * 4 + Number(period.at(-1)) - 1;
}

export function bisHistory(rows: BisRow[]) {
  const sorted = [...rows].sort((a, b) => a.period.localeCompare(b.period));
  const segments: BisRow[][] = [];
  let segment: BisRow[] = [];
  for (const row of sorted) {
    const previous = segment.at(-1);
    if (row.value === null || row.flagged || (previous && (
      bisQuarter(row.period) !== bisQuarter(previous.period) + 1 ||
      row.attributes.UNIT_MEASURE !== previous.attributes.UNIT_MEASURE ||
      row.attributes.UNIT_MULT !== previous.attributes.UNIT_MULT))) {
      segment = [];
    }
    if (row.value !== null) {
      if (!segment.length) segments.push(segment);
      segment.push(row);
    }
    if (row.flagged) segment = [];
  }
  return { sorted, segments };
}
