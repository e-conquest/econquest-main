/**
 * Unrest spikes (seven-groups plan, Phase 4): a month in which protests or violence, as a share of
 * the country's reported events (GDELT 1.0, utils/gdeltDaily.ts), stand far above the country's
 * own previous two years. Shares, not counts, since GDELT's volume grew many times over.
 *
 *   z = (share this month - mean of the previous 24 complete months) / max(their sd, floor)
 *
 * A spike is z at or above the threshold; an episode is the first month of a run of spikes. Only
 * past months enter the baseline, so a reading is what could have been said at the time.
 *
 * Browser-safe, pure.
 */
import type { V1MonthPoint, V1Series } from './gdeltDaily';

export const SPIKE_BASELINE_MONTHS = 24;
export const SPIKE_Z = 3;
export const SPIKE_SD_FLOOR = 0.25;

export type SpikeMeasure = 'protests' | 'violence';

export interface SpikeMonth {
  month: string;
  protestPct: number;
  violencePct: number;
  protestZ: number;
  violenceZ: number;
  /** Measures at or above the threshold this month. */
  spikes: SpikeMeasure[];
  /** Measures whose run of spikes starts this month. */
  episodes: SpikeMeasure[];
}

/** Months whose daily files cover the month (or backfile months), with events. */
export function completeMonths(points: V1MonthPoint[]): V1MonthPoint[] {
  return points.filter((p) => p.events > 0 && (p.dailyFiles === undefined || p.dailyFiles >= (p.daysInMonth || 31) - 2));
}

/** z-scores and spikes for every complete month with a full baseline, oldest first. */
export function spikeMonths(s: V1Series | null | undefined, opts: { baseline?: number; z?: number; sdFloor?: number } = {}): SpikeMonth[] {
  if (!s) return [];
  const n = opts.baseline ?? SPIKE_BASELINE_MONTHS;
  const zMin = opts.z ?? SPIKE_Z;
  const floor = opts.sdFloor ?? SPIKE_SD_FLOOR;
  const pts = completeMonths(s.points);
  const out: SpikeMonth[] = [];
  const zOf = (v: number, hist: number[]) => {
    const m = hist.reduce((a, x) => a + x, 0) / hist.length;
    const sd = Math.sqrt(hist.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, hist.length - 1));
    return Number(((v - m) / Math.max(sd, floor)).toFixed(2));
  };
  let prev: SpikeMeasure[] = [];
  for (let i = n; i < pts.length; i++) {
    const hist = pts.slice(i - n, i);
    const p = pts[i];
    const protestZ = zOf(p.protestPct, hist.map((h) => h.protestPct));
    const violenceZ = zOf(p.violencePct, hist.map((h) => h.violencePct));
    const spikes: SpikeMeasure[] = [];
    if (protestZ >= zMin) spikes.push('protests');
    if (violenceZ >= zMin) spikes.push('violence');
    // A gap in the months breaks a run.
    const consecutive = i > 0 && out.length > 0 && out[out.length - 1].month === prevMonth(p.month);
    const episodes = spikes.filter((m) => !(consecutive && prev.includes(m)));
    out.push({ month: p.month, protestPct: p.protestPct, violencePct: p.violencePct, protestZ, violenceZ, spikes, episodes });
    prev = spikes;
  }
  return out;
}

function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function spikeSentence(name: string, rows: SpikeMonth[]): string {
  if (!rows.length) return `${name}: not enough GDELT months on disk for a two-year baseline.`;
  const last = rows[rows.length - 1];
  const recent = rows.slice(-24).filter((r) => r.episodes.length);
  const now = last.spikes.length ? `${last.month} is a spike in ${last.spikes.join(' and ')}` : `${last.month} is not a spike (protests z ${last.protestZ}, violence z ${last.violenceZ})`;
  return `${name}: ${now}; ${recent.length} spike episode${recent.length === 1 ? '' : 's'} in the last 24 months.`;
}

export const SPIKE_METHOD = `Protests and violence as a share of the country's GDELT events each month, against the mean and standard deviation of its previous ${SPIKE_BASELINE_MONTHS} complete months (floor ${SPIKE_SD_FLOOR} points). A spike is z of ${SPIKE_Z} or more; an episode is the first month of a run. Only past months enter the baseline.`;
