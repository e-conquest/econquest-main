/**
 * What the full council is told about a country. Only figures a live feed, an official series or
 * your own data filled are passed to the agents; every other figure is named as missing, with
 * the reason, so a model cannot treat a built-in value as data (Sam, 2026-11-04).
 */
import { ucdpInputLine, ucdpMissing } from './ucdpConflict';
import { v1Missing } from './gdeltDaily';
import { hcSpreadWhen } from './hardCurrencySpread';
import { CDS_HIDDEN } from './cdsHidden';
import type { OpenDataSnapshot } from '../types/council';
import { getSnapshotDataStatus } from './dataStatus';
import { pathMissing } from './countryNotes';

const FIGURES: Array<{ label: string; path: string; fmt: (v: number, s: OpenDataSnapshot) => string }> = [
  { label: 'IMF gross debt / GDP', path: 'imf.debtToGdpPct', fmt: (v) => `${v}%` },
  { label: 'IMF debt / GDP, 2027 forecast', path: 'imf.debtToGdpForecast2027Pct', fmt: (v) => `${v}%` },
  { label: 'IMF primary fiscal balance', path: 'imf.primaryFiscalBalancePct', fmt: (v) => `${v}% of GDP` },
  { label: 'IMF real GDP growth', path: 'imf.realGdpGrowthPct', fmt: (v) => `${v}%` },
  { label: 'IMF headline CPI', path: 'imf.cpiInflationPct', fmt: (v) => `${v}%` },
  { label: 'World Bank FX reserves', path: 'wb.fxReservesMonthsImport', fmt: (v) => `${v} months of imports` },
  { label: 'World Bank current account', path: 'wb.currentAccountPctGdp', fmt: (v) => `${v}% of GDP` },
  { label: 'World Bank political stability', path: 'wb.politicalStabilityPercentile', fmt: (v) => `${v} percentile` },
  { label: 'Central bank policy rate', path: 'market.policyRatePct', fmt: (v) => `${v}%` },
  { label: '10Y government yield', path: 'market.sovereign10YBondYieldPct', fmt: (v) => `${v}%` },
  // 5Y CDS is hidden for now (src/utils/cdsHidden.ts), so the council is not told it is missing.
  ...(CDS_HIDDEN ? [] : [{ label: '5Y USD CDS', path: 'market.cds5YSpreadBps', fmt: (v: number) => `${v} bps` }]),
  { label: 'USD bond spread over US Treasuries (J.P. Morgan EMBI Global via BCRP, monthly average; a bond spread, not CDS)', path: 'market.hcBondSpreadBps', fmt: (v, s) => `${v} bps${s.hcBondSpread ? `, ${hcSpreadWhen(s.hcBondSpread.period)}` : ''}` },
  { label: 'Spot FX', path: 'market.exchangeRatePerUsd', fmt: (v, s) => `${v} ${s.currencyCode}/USD` },
  { label: 'GDELT conflict index', path: 'gdelt.conflictIntensityIndex', fmt: (v) => `${v}/100` },
  { label: 'GDELT news tone', path: 'gdelt.averageTone', fmt: (v) => `${v}` },
];

/** The model desks (debt fan, crisis odds, restructuring NPV...) run on these; without them their outputs are left out. */
export const DESK_ENGINE_INPUTS = ['imf.debtToGdpPct', 'imf.realGdpGrowthPct', 'imf.cpiInflationPct', 'imf.primaryFiscalBalancePct', 'wb.fxReservesMonthsImport'];

export interface CouncilInputs {
  /** One line per figure: the value and its source, or MISSING with the reason. */
  lines: string[];
  live: string[];
  missing: string[];
  /** Whether the model desk outputs may be shown to the agents. */
  deskEnginesLive: boolean;
  missingDeskInputs: string[];
}

export function councilInputs(snapshot: OpenDataSnapshot): CouncilInputs {
  const status = getSnapshotDataStatus(snapshot);
  const live: string[] = [];
  const missing: string[] = [];
  const lines = FIGURES.map((f) => {
    const v = status.live(f.path);
    if (v === undefined) {
      missing.push(f.label);
      return `- ${f.label}: MISSING (${pathMissing(status, f.path).short})`;
    }
    live.push(f.label);
    return `- ${f.label}: ${f.fmt(v, snapshot)} (${snapshot.liveFields?.[f.path] || 'live'})`;
  });
  // Polymarket only when the feed answered in this pull; the built-in example contracts never count.
  const p = snapshot.liveFields?.['polymarket.contracts'] ? snapshot.polymarketContracts?.[0] : undefined;
  lines.push(`- Polymarket key contract: ${p ? `"${p.question}" (${p.probabilityPct}% odds, ${snapshot.liveFields?.['polymarket.contracts']})` : 'MISSING (Polymarket did not answer)'}`);
  // GDELT raw files (events and GKG): only when they have been pulled; never a built-in value.
  const raw = snapshot.gdeltRaw;
  if (raw?.events) {
    const e = raw.events;
    const base = e.baseline ? `; ${raw.baselineWeeks}-week average before: ${e.baseline.count} events, ${e.baseline.protests} protests, Goldstein ${e.baseline.goldsteinMean}` : '';
    lines.push(`- GDELT events, week of ${raw.weekStart}${raw.complete ? '' : ' (in progress)'}: ${e.count} events, ${e.protests} protests, ${e.sanctions} sanctions or embargoes, ${e.violence} violent, mean Goldstein ${e.goldsteinMean}${base} (GDELT 2.0 events files, pulled ${raw.pulledAt?.slice(0, 10) || 'date unknown'})`);
  } else lines.push('- GDELT weekly events: MISSING (GDELT raw files not pulled yet)');
  if (raw?.gkg?.themes.length) {
    const t = raw.gkg.themes.slice(0, 5).map((x) => `${x.label} ${x.sharePct}%${x.baselineSharePct !== undefined ? ` (before ${x.baselineSharePct}%)` : ''}`).join(', ');
    lines.push(`- GDELT economic themes, share of ${raw.gkg.articles} articles naming the country, week of ${raw.weekStart}: ${t}; GKG tone ${raw.gkg.toneMean} (GDELT Global Knowledge Graph, pulled ${raw.pulledAt?.slice(0, 10) || 'date unknown'})`);
  } else lines.push('- GDELT economic themes: MISSING (GDELT raw files not pulled yet)');
  // UCDP downloaded files (data/local/ucdp/): only when read; never a built-in value.
  lines.push(ucdpInputLine(snapshot.ucdp?.latest ? snapshot.ucdp : null, ucdpMissing(null, snapshot.iso3)));
  // GDELT 1.0 monthly history (data/live/gdelt-daily/): only when pulled; shares, not counts.
  const h = snapshot.gdeltDaily;
  lines.push(
    h
      ? `- GDELT long-run events, ${h.month}: protests ${h.protestPct}% of events (percentile ${h.protestPctile ?? 'n/a'}), violence ${h.violencePct}% (percentile ${h.violencePctile ?? 'n/a'}), Goldstein ${h.goldsteinMean} (percentile ${h.goldsteinPctile ?? 'n/a'}), against ${h.months} months from ${h.from} (GDELT 1.0 event files, pulled ${h.pulledAt?.slice(0, 10) || 'date unknown'})`
      : `- GDELT long-run events: MISSING (${v1Missing(false).short})`
  );
  const missingDeskInputs = DESK_ENGINE_INPUTS.filter((path) => !status.isLive(path));
  return { lines, live, missing, deskEnginesLive: missingDeskInputs.length === 0, missingDeskInputs };
}

/** The instruction that goes with the figures. */
export const MISSING_FIGURES_RULE =
  'Figures marked MISSING are unknown. Do not estimate, assume or quote a value for them; say the figure is missing where it matters to your view, and lower your confidence.';
