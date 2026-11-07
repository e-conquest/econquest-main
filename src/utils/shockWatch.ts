/**
 * Shock early warning (Sam, 2026-11-05): stated rules on figures the app already pulls, flagging
 * pressure that tends to come before an external or market shock. Each warning names its rule and
 * its inputs. It says where pressure is building, not that a shock will happen.
 *
 * Rules (level "alert" is the stronger one):
 * - Debt due against reserves: government external principal due in 12 months (World Bank QEDS)
 *   plus international government bonds due within a year (BIS), against IMF official reserves.
 *   Under 1x = alert, 1x to 2x = watch.
 * - Reserves falling: IMF reserves down 10% or more on the year = alert, 5% to 10% = watch.
 * - Import cover: under 3 months of imports = alert (IMF reserves over 4 quarters of imports).
 * - External gap: current account (last 4 quarters, IMF) worse than -4% of GDP = watch; alert when
 *   reserves are also falling.
 * - Terms-of-trade swing: the actual 3-month Pink Sheet moves applied to the export mix and fuel bill
 *   come to -1% of GDP or worse (as if prices held a year) = watch; -2% or worse = alert.
 * - Yield jump: official 10Y yield up 100 bps or more in 3 months = alert, 50 to 100 bps = watch.
 * - News tone: GDELT tone turning more negative by 1 point or more = watch.
 */
import type { LiveWatchlistItem } from '../types/council';
import { formatQuarter } from './fiscalDebt';
import { formatImfPeriod } from './imfReserves';
import { priceShock } from './scenarioExposure';
import { formatPeriod } from './officialYields';
import { GDELT_SHIFT_PTS } from './gdeltTone';

export type ShockLevel = 'alert' | 'watch';
export type ShockKey = 'debt_due' | 'reserves_falling' | 'import_cover' | 'external_gap' | 'terms_of_trade' | 'yield_jump' | 'news_tone';

export interface ShockWarning {
  key: ShockKey;
  level: ShockLevel;
  label: string;
  /** The figures, in words, with their sources. */
  detail: string;
  /** The stated rule. */
  rule: string;
}

export const SHOCK_LABEL: Record<ShockKey, string> = {
  debt_due: 'Debt due within a year is large against reserves',
  reserves_falling: 'Reserves falling',
  import_cover: 'Thin import cover',
  external_gap: 'Wide current-account deficit',
  terms_of_trade: 'Terms-of-trade swing',
  yield_jump: 'Sharp rise in the 10Y yield',
  news_tone: 'News tone turning more negative',
};

/** How many checks shockWatch runs. */
export const SHOCK_CHECKS = 7;

const bn = (v: number) => `$${v >= 100 ? v.toFixed(0) : v.toFixed(1)}bn`;
const sg = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`;

export interface ShockWatch {
  warnings: ShockWarning[];
  /** Checks that could not run, with the missing input. */
  notChecked: string[];
}

export function shockWatch(it: LiveWatchlistItem): ShockWatch {
  const w: ShockWarning[] = [];
  const notChecked: string[] = [];
  const res = it.imf?.reserves;

  // Debt due against reserves
  const f = it.fiscal;
  const dueParts: string[] = [];
  let due = 0;
  if (f?.extDue12m) {
    due += f.extDue12m.usdBn;
    dueParts.push(`${bn(f.extDue12m.usdBn)} external principal due in 12 months (World Bank QEDS, from ${formatQuarter(f.extDue12m.asOf)})`);
  }
  if (f?.intlBonds?.due1yUsdBn !== undefined) {
    due += f.intlBonds.due1yUsdBn;
    dueParts.push(`${bn(f.intlBonds.due1yUsdBn)} international bonds due within a year (BIS, ${f.intlBonds.asOf})`);
  }
  if (dueParts.length && res && due > 0) {
    const cover = res.usdBn / due;
    if (cover < 2)
      w.push({
        key: 'debt_due',
        level: cover < 1 ? 'alert' : 'watch',
        label: SHOCK_LABEL.debt_due,
        detail: `Reserves ${bn(res.usdBn)} (IMF, ${formatImfPeriod(res.period)}) cover ${cover.toFixed(1)}x the ${dueParts.join(' plus ')}.`,
        rule: 'reserves over debt due within a year: under 1x = alert, 1x to 2x = watch',
      });
  } else notChecked.push(!res ? 'debt due against reserves (needs IMF reserves)' : 'debt due against reserves (needs World Bank QEDS or BIS debt due)');

  // Reserves falling
  if (res?.change12mPct !== undefined) {
    if (res.change12mPct <= -5)
      w.push({
        key: 'reserves_falling',
        level: res.change12mPct <= -10 ? 'alert' : 'watch',
        label: SHOCK_LABEL.reserves_falling,
        detail: `Official reserves ${sg(res.change12mPct)}% on the year to ${formatImfPeriod(res.period)} (IMF), now ${bn(res.usdBn)}.`,
        rule: '12-month change: −10% or worse = alert, −5% to −10% = watch',
      });
  } else notChecked.push('reserves trend (needs 13 months of IMF reserves)');

  // Import cover
  const months = it.imf?.monthsOfImports;
  if (months !== undefined) {
    if (months < 3)
      w.push({
        key: 'import_cover',
        level: 'alert',
        label: SHOCK_LABEL.import_cover,
        detail: `Reserves cover ${months.toFixed(1)} months of imports (IMF reserves over the last 4 quarters of imports).`,
        rule: 'under 3 months of imports = alert',
      });
  } else notChecked.push('import cover (needs IMF reserves and imports)');

  // External gap
  const ca = it.imf?.currentAccount4q;
  if (ca?.pctGdp !== undefined) {
    if (ca.pctGdp < -4) {
      const falling = (res?.change12mPct ?? 0) <= -5;
      w.push({
        key: 'external_gap',
        level: falling ? 'alert' : 'watch',
        label: SHOCK_LABEL.external_gap,
        detail: `Current account ${sg(ca.pctGdp)}% of GDP over the 4 quarters to ${formatImfPeriod(ca.through)} (IMF)${falling ? ', while reserves are falling' : ''}.`,
        rule: 'worse than −4% of GDP = watch; alert when reserves are also down 5% or more on the year',
      });
    }
  } else notChecked.push('current account (needs IMF balance of payments and WEO GDP)');

  // Terms-of-trade swing over 3 months
  const t = it.trade;
  const shock = t ? priceShock(t, t.priceMoves3m) : null;
  if (shock) {
    if (shock.pctGdp <= -1)
      w.push({
        key: 'terms_of_trade',
        level: shock.pctGdp <= -2 ? 'alert' : 'watch',
        label: SHOCK_LABEL.terms_of_trade,
        detail: `Commodity moves over the last 3 months come to ${sg(shock.pctGdp)}% of GDP if prices held a year: ${shock.basis}.`,
        rule: '3-month price moves on the export mix and fuel bill: −1% of GDP or worse = watch, −2% or worse = alert',
      });
  } else notChecked.push('terms-of-trade swing (needs Pink Sheet 3-month moves, UN Comtrade export mix and World Bank trade)');

  // Yield jump
  if (it.yield10YChange3mPts !== undefined && it.yield10YPeriod) {
    const bps = Math.round(it.yield10YChange3mPts * 100);
    if (bps >= 50)
      w.push({
        key: 'yield_jump',
        level: bps >= 100 ? 'alert' : 'watch',
        label: SHOCK_LABEL.yield_jump,
        detail: `Official 10Y yield +${bps} bps over the 3 months to ${formatPeriod(it.yield10YPeriod)}.`,
        rule: '3-month rise: 100 bps or more = alert, 50 to 100 bps = watch',
      });
  } else notChecked.push('10Y yield move (needs an official monthly yield)');

  // News tone
  const g = it.gdelt?.toneShift;
  if (g) {
    if (g.shift <= -GDELT_SHIFT_PTS)
      w.push({
        key: 'news_tone',
        level: 'watch',
        label: SHOCK_LABEL.news_tone,
        detail: `GDELT tone ${g.recent.toFixed(1)} in the latest week against ${g.earlier.toFixed(1)} over the ${g.earlierDays} days before (pulled ${it.gdelt!.pulledAt.slice(0, 10)}).`,
        rule: `tone down ${GDELT_SHIFT_PTS} point or more against the earlier weeks = watch`,
      });
  } else notChecked.push('news tone shift (needs a GDELT pull with its timeline)');

  w.sort((a, b) => (a.level === b.level ? 0 : a.level === 'alert' ? -1 : 1));
  return { warnings: w, notChecked };
}

/** "2 alerts, 1 watch" or "No warning on the checks that could run (5 of 7)". */
export function shockSummary(s: ShockWatch): string {
  const a = s.warnings.filter((x) => x.level === 'alert').length;
  const wch = s.warnings.length - a;
  if (!s.warnings.length) return s.notChecked.length ? `No warning on the checks that could run (${SHOCK_CHECKS - s.notChecked.length} of ${SHOCK_CHECKS})` : 'No warning';
  return [a ? `${a} alert${a === 1 ? '' : 's'}` : '', wch ? `${wch} watch` : ''].filter(Boolean).join(', ');
}
