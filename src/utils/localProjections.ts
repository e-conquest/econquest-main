/**
 * Local projections (Jordà 2005): how a monthly series has moved h months after a change in
 * another, estimated one horizon at a time by OLS.
 *
 *   y(t+h) - y(t-1) = a_h + b_h x dx(t) + sum over l = 1..L of [c_l dy(t-l) + d_l dx(t-l)] + e(t+h)
 *
 * b_h is the response at horizon h to a one-unit change in x in month t. Newey-West standard errors
 * with lag max(h + 1, floor(4 (n/100)^(2/9))), since the h-month-ahead errors overlap; bands at 90%.
 *
 * Used here for inflation (monthly CPI, % year on year) after a policy rate change (BIS month-ends).
 * This is a REDUCED-FORM response: the rate change is not an identified shock. Central banks raise
 * rates when inflation is expected to rise, so the early response is often positive (the "price
 * puzzle"); it records co-movement in the sample, not the effect of policy. Stated on the panel.
 *
 * Browser-safe.
 */
import { ols, tPValue } from './stats';
import { neweyWestLag, neweyWestSe } from './bohnTest';
import type { SeriesPoint } from './seriesHistory';

export const LP_HORIZONS = [0, 3, 6, 9, 12, 18, 24];
export const LP_LAGS = 3;
export const LP_MIN_OBS = 60;
/** Two-sided 90% band, normal approximation. */
export const LP_Z90 = 1.645;

export interface LpStep {
  h: number;
  beta: number;
  se: number;
  lo: number;
  hi: number;
  p: number;
  n: number;
}

export interface LpResult {
  ok: true;
  steps: LpStep[];
  from: string;
  to: string;
  /** Months in the sample at horizon 0. */
  n: number;
  /** Months in which x changed. */
  moves: number;
  lags: number;
  method: string;
}

export type LpOutcome = LpResult | { ok: false; reason: string };

export const LP_METHOD = `Local projections (Jordà 2005): y(t+h) - y(t-1) on the change in x in month t, with ${LP_LAGS} lags of both monthly changes; one OLS per horizon, Newey-West errors with lag at least h+1, 90% bands. Reduced form: the rate change is not an identified policy shock.`;

const r3 = (v: number) => Number(v.toFixed(3));

/** Month (YYYY-MM) to value; for daily points the last of the month. */
export function monthly(points: SeriesPoint[] | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of [...(points || [])].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (!Number.isFinite(p.value) || !/^\d{4}-\d{2}/.test(p.date)) continue;
    m.set(p.date.slice(0, 7), p.value);
  }
  return m;
}

const nextMonth = (ym: string, k: number) => {
  const [y, mo] = ym.split('-').map(Number);
  const t = y * 12 + (mo - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

export function localProjections(yPts: SeriesPoint[] | undefined, xPts: SeriesPoint[] | undefined, opts: { horizons?: number[]; lags?: number } = {}): LpOutcome {
  const Y = monthly(yPts);
  const X = monthly(xPts);
  if (!Y.size) return { ok: false, reason: 'No monthly history for the response series' };
  if (!X.size) return { ok: false, reason: 'No monthly history for the policy rate' };
  const horizons = opts.horizons ?? LP_HORIZONS;
  const L = opts.lags ?? LP_LAGS;
  const months = [...Y.keys()].filter((m) => X.has(m)).sort();
  const dy = (m: string) => {
    const a = Y.get(m);
    const b = Y.get(nextMonth(m, -1));
    return a !== undefined && b !== undefined ? a - b : undefined;
  };
  const dx = (m: string) => {
    const a = X.get(m);
    const b = X.get(nextMonth(m, -1));
    return a !== undefined && b !== undefined ? a - b : undefined;
  };

  const steps: LpStep[] = [];
  let n0 = 0;
  let moves = 0;
  let from = '';
  let to = '';
  for (const h of horizons) {
    const ys: number[] = [];
    const Xs: number[][] = [];
    const used: string[] = [];
    for (const m of months) {
      const lead = Y.get(nextMonth(m, h));
      const base = Y.get(nextMonth(m, -1));
      const shock = dx(m);
      if (lead === undefined || base === undefined || shock === undefined) continue;
      const row = [shock];
      let ok = true;
      for (let l = 1; l <= L && ok; l++) {
        const a = dy(nextMonth(m, -l));
        const b = dx(nextMonth(m, -l));
        if (a === undefined || b === undefined) ok = false;
        else row.push(a, b);
      }
      if (!ok) continue;
      ys.push(lead - base);
      Xs.push(row);
      used.push(m);
    }
    if (h === horizons[0]) {
      n0 = ys.length;
      moves = Xs.filter((r) => Math.abs(r[0]) > 1e-9).length;
      from = used[0] || '';
      to = used[used.length - 1] || '';
      if (n0 < LP_MIN_OBS) return { ok: false, reason: `Only ${n0} months with both series and their lags; local projections need ${LP_MIN_OBS}` };
      if (moves < 5) return { ok: false, reason: `The policy rate changed in only ${moves} months of the sample` };
    }
    if (ys.length < LP_MIN_OBS / 2) break;
    const reg = ols(ys, Xs);
    if ('error' in reg) break;
    const se = neweyWestSe(Xs, reg.residuals, Math.max(h + 1, neweyWestLag(ys.length)));
    if (!se) break;
    const beta = reg.coef[1];
    const s = se[1];
    const t = s > 0 ? beta / s : NaN;
    steps.push({ h, beta: r3(beta), se: r3(s), lo: r3(beta - LP_Z90 * s), hi: r3(beta + LP_Z90 * s), p: Number(tPValue(t, ys.length - reg.k).toFixed(3)), n: ys.length });
  }
  if (!steps.length) return { ok: false, reason: 'The regressions could not be solved on this sample' };
  return { ok: true, steps, from, to, n: n0, moves, lags: L, method: LP_METHOD };
}

/** One plain sentence on the 12-month (or last) response. */
export function lpSentence(r: LpResult, name: string): string {
  const s = r.steps.find((x) => x.h === 12) || r.steps[r.steps.length - 1];
  const sig = s.lo > 0 || s.hi < 0;
  const dir = s.beta >= 0 ? 'higher' : 'lower';
  return `${name}, ${r.from} to ${r.to}: ${s.h} months after a 1-point policy rate rise, inflation has on average been ${Math.abs(s.beta).toFixed(2)} points ${dir} than the month before the move (90% band ${s.lo.toFixed(2)} to ${s.hi.toFixed(2)}${sig ? '' : ', which includes zero'}). Co-movement, not the effect of policy.`;
}
