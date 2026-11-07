/**
 * Country-years for the unrest onset test (backtest method unrest_onset): GDELT spike episodes per
 * year (utils/unrestSpikes.ts) beside UCDP/PRIO armed conflict located in the country. Pure.
 */
import type { OnsetYear } from './backtest';
import { v1Series, type V1Month } from './gdeltDaily';
import { ISO3_IN_UCDP, type UcdpData } from './ucdpConflict';
import { spikeMonths } from './unrestSpikes';

export function onsetYears(months: V1Month[], ucdp: UcdpData, params: { baselineMonths?: number; zSpike?: number; sdFloorPts?: number } = {}): OnsetYear[] {
  const acd = ucdp.files.acd;
  if (!acd || !months.length) return [];
  const isos = new Set<string>();
  for (const m of months) for (const k of Object.keys(m.countries)) if (ISO3_IN_UCDP.has(k)) isos.add(k);
  const out: OnsetYear[] = [];
  for (const iso of [...isos].sort()) {
    const rows = spikeMonths(v1Series(iso, months), { baseline: params.baselineMonths, z: params.zSpike, sdFloor: params.sdFloorPts });
    const byYear = new Map<number, { months: number; episodes: string[] }>();
    for (const r of rows) {
      const y = Number(r.month.slice(0, 4));
      const e = byYear.get(y) || { months: 0, episodes: [] };
      e.months++;
      for (const m of r.episodes) e.episodes.push(`${r.month} ${m}`);
      byYear.set(y, e);
    }
    const conflict = (y: number) => (ucdp.countries[iso]?.[String(y)]?.conflicts?.n ?? 0) > 0;
    for (const [year, e] of byYear) {
      if (year < acd.minYear || year > acd.maxYear) continue;
      out.push({ where: iso, year, months: e.months, episodes: e.episodes, quiet: !conflict(year), next: year + 1 <= acd.maxYear ? conflict(year + 1) : null });
    }
  }
  return out;
}
