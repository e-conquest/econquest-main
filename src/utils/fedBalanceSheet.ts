/**
 * The Federal Reserve balance sheet (H.4.1 release) from FRED's free CSV download, no key needed.
 *
 * Four series, each with its own date:
 * - WALCL      total assets, Wednesday level, millions of dollars (weekly)
 * - WRESBAL    reserve balances with Federal Reserve Banks, week average, billions (weekly)
 * - WTREGEN    Treasury General Account, Wednesday level, millions (weekly)
 * - RRPONTSYD  overnight reverse repurchase agreements, billions (daily)
 *
 * "Net liquidity" (total assets less the Treasury account less reverse repos) is a common market
 * shorthand, not an official Fed series. It is shown only when all three parts have a value on the
 * same Wednesday; otherwise it reads Missing with the reason.
 */

export interface FedSeriesDef {
  id: string;
  label: string;
  /** Divide the FRED value by this to get billions of dollars. */
  toBillions: number;
  note: string;
}

export const FED_SERIES: FedSeriesDef[] = [
  { id: 'WALCL', label: 'Total assets', toBillions: 1000, note: 'Wednesday level' },
  { id: 'WRESBAL', label: 'Bank reserves at the Fed', toBillions: 1, note: 'Week average' },
  { id: 'WTREGEN', label: 'Treasury General Account', toBillions: 1000, note: 'Wednesday level' },
  { id: 'RRPONTSYD', label: 'Overnight reverse repos', toBillions: 1, note: 'Daily' },
];

export const FED_SOURCE = 'Federal Reserve H.4.1 and NY Fed, via FRED (St. Louis Fed)';

export interface Obs {
  date: string;
  value: number;
}

export interface FedLine {
  id: string;
  label: string;
  note: string;
  url: string;
  latest?: Obs;
  /** Change in billions against the observation about 4 and 52 weeks earlier. */
  change4w?: number;
  change52w?: number;
  /** Why there is no latest value. */
  missing?: string;
  /** Weekly points for a small chart, oldest first, in billions. */
  points: Obs[];
}

export interface FedBalanceSheet {
  lines: FedLine[];
  netLiquidity: { date: string; value: number; change4w?: number } | { missing: string };
  source: string;
}

/** Parses a FRED graph CSV into dated values (missing values "." are skipped). */
export function parseFredCsvSeries(csv: string): Obs[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2 || !/date/i.test(lines[0])) return [];
  const out: Obs[] = [];
  for (const l of lines.slice(1)) {
    const [d, v] = l.split(',');
    const value = Number(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test((d || '').trim()) || !v || v.trim() === '.' || !Number.isFinite(value)) continue;
    out.push({ date: d.trim(), value });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const DAY = 24 * 60 * 60 * 1000;

/** The last observation on or before a date, if within `maxGapDays` of it. */
function onOrBefore(obs: Obs[], date: string, maxGapDays: number): Obs | undefined {
  let hit: Obs | undefined;
  for (const o of obs) {
    if (o.date <= date) hit = o;
    else break;
  }
  if (!hit) return undefined;
  return (Date.parse(date) - Date.parse(hit.date)) / DAY <= maxGapDays ? hit : undefined;
}

function weeksBefore(date: string, weeks: number): string {
  return new Date(Date.parse(date) - weeks * 7 * DAY).toISOString().slice(0, 10);
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Builds the panel from raw FRED values per series id (as FRED gives them, before unit change). */
export function buildFedBalanceSheet(raw: Record<string, Obs[] | null | undefined>): FedBalanceSheet {
  const inBn: Record<string, Obs[]> = {};
  const lines: FedLine[] = FED_SERIES.map((def) => {
    const url = `https://fred.stlouisfed.org/series/${def.id}`;
    const series = raw[def.id];
    if (!series || !series.length) {
      return { id: def.id, label: def.label, note: def.note, url, points: [], missing: series === null ? 'FRED did not answer' : 'No observations in the download' };
    }
    const bn = series.map((o) => ({ date: o.date, value: o.value / def.toBillions }));
    inBn[def.id] = bn;
    const latest = bn[bn.length - 1];
    const back4 = onOrBefore(bn, weeksBefore(latest.date, 4), 6);
    const back52 = onOrBefore(bn, weeksBefore(latest.date, 52), 6);
    // Daily series: one point a week (the last of each 7-day step back from the latest) keeps the chart light.
    const points = def.id === 'RRPONTSYD' ? weekly(bn) : bn;
    return {
      id: def.id,
      label: def.label,
      note: def.note,
      url,
      latest: { date: latest.date, value: round1(latest.value) },
      ...(back4 ? { change4w: round1(latest.value - back4.value) } : {}),
      ...(back52 ? { change52w: round1(latest.value - back52.value) } : {}),
      points: points.map((p) => ({ date: p.date, value: round1(p.value) })),
    };
  });
  return { lines, netLiquidity: netLiquidity(inBn), source: FED_SOURCE };
}

function weekly(obs: Obs[]): Obs[] {
  if (!obs.length) return [];
  const out: Obs[] = [];
  let next = obs[obs.length - 1].date;
  for (let i = obs.length - 1; i >= 0; i--) {
    if (obs[i].date <= next) {
      out.push(obs[i]);
      next = weeksBefore(obs[i].date, 1);
    }
  }
  return out.reverse();
}

function netLiquidity(bn: Record<string, Obs[]>): FedBalanceSheet['netLiquidity'] {
  const assets = bn.WALCL;
  const tga = bn.WTREGEN;
  const rrp = bn.RRPONTSYD;
  const lacking = [!assets && 'total assets', !tga && 'the Treasury General Account', !rrp && 'reverse repos'].filter(Boolean);
  if (lacking.length) return { missing: `Needs ${lacking.join(', ')}, which did not load` };
  const at = (date: string) => {
    const a = assets!.find((o) => o.date === date);
    const t = tga!.find((o) => o.date === date);
    const r = rrp!.find((o) => o.date === date);
    return a && t && r ? a.value - t.value - r.value : undefined;
  };
  // The latest Wednesday on which all three parts have a value.
  for (let i = assets!.length - 1; i >= Math.max(0, assets!.length - 3); i--) {
    const date = assets![i].date;
    const value = at(date);
    if (value === undefined) continue;
    const before = assets!.find((o) => o.date === weeksBefore(date, 4));
    const v4 = before ? at(before.date) : undefined;
    return { date, value: round1(value), ...(v4 !== undefined ? { change4w: round1(value - v4) } : {}) };
  }
  return { missing: 'Total assets, the Treasury account and reverse repos have no recent Wednesday in common' };
}
