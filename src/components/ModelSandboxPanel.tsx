import React, { useEffect, useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { SeriesPoint } from '../utils/seriesHistory';
import { debtSandbox, filterSandbox, taylorSandbox, SANDBOX_METHOD } from '../utils/modelSandboxes';
import { restructuring, RESTRUCTURING_METHOD } from '../utils/restructuring';

/**
 * Country Research > History & data > Model sandboxes (src/utils/modelSandboxes.ts): debt
 * dynamics, the Taylor rule and HP against Hamilton, with sliders starting from the latest figures.
 */

type Reply = {
  debt: { year: string; debt: number; i?: number; g: number; pi: number; pb: number } | null;
  taylor: { pi?: { value: number; year: string }; gap?: { value: number; year: string }; target?: { value: number; bank: string } };
  growth: SeriesPoint[];
  missing: string[];
};

type Num = number | null;
const r1 = (v: number) => Math.round(v * 10) / 10;

const Slider: React.FC<{ label: string; value: Num; set: (v: Num) => void; min: number; max: number; step: number; start?: string }> = ({ label, value, set, min, max, step, start }) => (
  <label className="flex items-center gap-2 text-xs">
    <span className="w-44 text-slate-500 dark:text-slate-400">{label}</span>
    <input type="range" min={min} max={max} step={step} value={value ?? min} disabled={value === null} onChange={(e) => set(Number(e.target.value))} className="flex-1" aria-label={label} />
    <input
      className="w-20 px-1.5 py-0.5 tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
      inputMode="decimal"
      value={value === null ? '' : String(value)}
      placeholder="Missing"
      onChange={(e) => {
        const t = e.target.value.trim();
        const n = Number(t.replace(',', '.'));
        set(t === '' ? null : Number.isFinite(n) ? n : value);
      }}
      aria-label={`${label}, value`}
    />
    <span className="w-28 text-slate-400">{start || ''}</span>
  </label>
);

export const ModelSandboxPanel: React.FC<{ iso3: string; countryName: string }> = ({ iso3, countryName }) => {
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [d, setD] = useState<Record<'debt' | 'i' | 'g' | 'pi' | 'pb', Num>>({ debt: null, i: null, g: null, pi: null, pb: null });
  const [years, setYears] = useState(5);
  const [t, setT] = useState<Record<'rStar' | 'pi' | 'target' | 'gap' | 'aPi' | 'aGap', Num>>({ rStar: 2, pi: null, target: null, gap: null, aPi: 0.5, aGap: 0.5 });
  const [lambda, setLambda] = useState(100);
  const [h, setH] = useState(2);
  // Restructuring calculator: every term is the user's; these are blank until typed (no example deal is assumed).
  const [rs, setRs] = useState<Record<'oldCoupon' | 'oldYears' | 'newFace' | 'newCoupon' | 'newYears' | 'newGrace' | 'exitYield', Num>>({ oldCoupon: null, oldYears: null, newFace: null, newCoupon: null, newYears: null, newGrace: null, exitYield: null });

  useEffect(() => {
    let live = true;
    setReply(null);
    setError(null);
    fetch(`/api/sandboxes/${encodeURIComponent(iso3)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: Reply) => {
        if (!live) return;
        setReply(b);
        setD({ debt: b.debt?.debt ?? null, i: b.debt?.i ?? null, g: b.debt?.g ?? null, pi: b.debt?.pi ?? null, pb: b.debt?.pb ?? null });
        setT((x) => ({ ...x, pi: b.taylor.pi?.value ?? null, target: b.taylor.target?.value ?? null, gap: b.taylor.gap?.value ?? null }));
      })
      .catch((e: Error) => live && setError(`The starting values could not be read (${e.message}).`));
    return () => {
      live = false;
    };
  }, [iso3]);

  const debtOut = useMemo(() => (Object.values(d).every((v) => v !== null) ? debtSandbox({ debt: d.debt!, i: d.i!, g: d.g!, pi: d.pi!, pb: d.pb!, years }) : null), [d, years]);
  const taylorOut = useMemo(() => (Object.values(t).every((v) => v !== null) ? taylorSandbox({ rStar: t.rStar!, pi: t.pi!, target: t.target!, gap: t.gap!, aPi: t.aPi!, aGap: t.aGap! }) : null), [t]);
  const filterOut = useMemo(() => (reply ? filterSandbox(reply.growth, lambda, h) : null), [reply, lambda, h]);
  const y = reply?.debt?.year;
  const rsOut = useMemo(
    () =>
      Object.values(rs).every((v) => v !== null)
        ? restructuring({
            oldBond: { face: 100, couponPct: rs.oldCoupon!, years: rs.oldYears!, graceYears: rs.oldYears! - 1 },
            newBond: { face: rs.newFace!, couponPct: rs.newCoupon!, years: rs.newYears!, graceYears: rs.newGrace! },
            exitYieldPct: rs.exitYield!,
          })
        : null,
    [rs]
  );

  return (
    <section className="ui-panel" data-model-sandbox="true" data-no-provenance-overlay="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Model sandboxes, {countryName}
        </h2>
        <p className="ui-label">Move each term of the debt identity, the Taylor rule and the output-gap filters, starting from {countryName}'s latest figures. Illustration, not a forecast.</p>
      </header>
      <div className="p-4 space-y-4 text-xs">
        {!reply && !error && <p className="ui-body">Loading…</p>}
        {error && <p className="text-amber-700 dark:text-amber-400">{error}</p>}
        {reply && (
          <>
            <div data-sandbox="debt" className="space-y-1">
              <h3 className="text-sm font-medium text-slate-900 dark:text-white">Debt dynamics</h3>
              <Slider label="Debt, % of GDP" value={d.debt} set={(v) => setD({ ...d, debt: v })} min={0} max={250} step={1} start={y ? `${y}: ${reply.debt?.debt}` : 'Missing'} />
              <Slider label="Interest rate i, %" value={d.i} set={(v) => setD({ ...d, i: v })} min={-2} max={40} step={0.1} start={reply.debt?.i !== undefined ? `${y}: ${r1(reply.debt.i)}` : 'Missing'} />
              <Slider label="Real growth g, %" value={d.g} set={(v) => setD({ ...d, g: v })} min={-10} max={12} step={0.1} start={y ? `${y}: ${reply.debt?.g}` : 'Missing'} />
              <Slider label="Inflation, %" value={d.pi} set={(v) => setD({ ...d, pi: v })} min={-2} max={80} step={0.1} start={y ? `${y}: ${reply.debt?.pi}` : 'Missing'} />
              <Slider label="Primary balance, % of GDP" value={d.pb} set={(v) => setD({ ...d, pb: v })} min={-10} max={10} step={0.1} start={y ? `${y}: ${reply.debt?.pb}` : 'Missing'} />
              <Slider label="Years ahead" value={years} set={(v) => setYears(Math.max(1, Math.min(30, Math.round(v ?? 5))))} min={1} max={30} step={1} />
              {debtOut ? (
                <p className="text-slate-900 dark:text-white" data-sandbox-result="debt">
                  Debt goes from {debtOut.path[0]} to {debtOut.end}% of GDP in {years} years (nominal growth {debtOut.nominalGrowth}%, i - n {debtOut.iMinusN} points). The primary balance that holds debt steady is {debtOut.stabilisingPb}% of GDP. Path: {debtOut.path.join(', ')}.
                </p>
              ) : (
                <p className="text-amber-700 dark:text-amber-400">Missing: set every term to run the identity.</p>
              )}
            </div>
            <div data-sandbox="taylor" className="space-y-1">
              <h3 className="text-sm font-medium text-slate-900 dark:text-white">Taylor rule</h3>
              <Slider label="Neutral real rate, %" value={t.rStar} set={(v) => setT({ ...t, rStar: v })} min={-2} max={6} step={0.1} start="Taylor 1993: 2" />
              <Slider label="Inflation, %" value={t.pi} set={(v) => setT({ ...t, pi: v })} min={-2} max={80} step={0.1} start={reply.taylor.pi ? `${reply.taylor.pi.year}: ${r1(reply.taylor.pi.value)}` : 'Missing'} />
              <Slider label="Inflation target, %" value={t.target} set={(v) => setT({ ...t, target: v })} min={0} max={10} step={0.1} start={reply.taylor.target ? `${reply.taylor.target.bank}` : 'Missing'} />
              <Slider label="Output gap, %" value={t.gap} set={(v) => setT({ ...t, gap: v })} min={-10} max={10} step={0.1} start={reply.taylor.gap ? `${reply.taylor.gap.year}: ${r1(reply.taylor.gap.value)}` : 'Missing'} />
              <Slider label="Weight on inflation gap" value={t.aPi} set={(v) => setT({ ...t, aPi: v })} min={0} max={2} step={0.05} start="Taylor 1993: 0.5" />
              <Slider label="Weight on output gap" value={t.aGap} set={(v) => setT({ ...t, aGap: v })} min={0} max={2} step={0.05} start="Taylor 1993: 0.5" />
              {taylorOut ? (
                <p className="text-slate-900 dark:text-white" data-sandbox-result="taylor">
                  The rule gives {taylorOut.rate}%: {taylorOut.terms.map((x) => `${x.label} ${x.value}`).join(' + ')}.
                </p>
              ) : (
                <p className="text-amber-700 dark:text-amber-400">Missing: set every term to run the rule.</p>
              )}
            </div>
            <div data-sandbox="filters" className="space-y-1">
              <h3 className="text-sm font-medium text-slate-900 dark:text-white">Output gap: HP against Hamilton</h3>
              <Slider label="HP lambda" value={lambda} set={(v) => setLambda(Math.max(0.1, v ?? 100))} min={1} max={1600} step={1} start="yearly: 100 or 6.25" />
              <Slider label="Hamilton horizon h, years" value={h} set={(v) => setH(Math.max(1, Math.min(8, Math.round(v ?? 2))))} min={1} max={8} step={1} start="yearly: 2" />
              {filterOut && 'reason' in filterOut ? (
                <p className="text-amber-700 dark:text-amber-400">Missing: {filterOut.reason}.</p>
              ) : filterOut?.latest ? (
                <p className="text-slate-900 dark:text-white" data-sandbox-result="filters">
                  {filterOut.latest.year}: HP gap {filterOut.latest.hp}%{filterOut.latest.hamilton !== undefined ? `, Hamilton gap ${filterOut.latest.hamilton}%` : ''}, on {filterOut.outturns} years of IMF real growth outturns. Last five years (HP / Hamilton):{' '}
                  {filterOut.years
                    .slice(-5)
                    .map((x) => `${x.year} ${x.hp}${x.hamilton !== undefined ? ` / ${x.hamilton}` : ''}`)
                    .join('; ')}
                  .
                </p>
              ) : null}
            </div>
            <div data-sandbox="restructuring" className="space-y-1">
              <h3 className="text-sm font-medium text-slate-900 dark:text-white">Restructuring calculator (terms you enter)</h3>
              <Slider label="Old bond coupon, %" value={rs.oldCoupon} set={(v) => setRs({ ...rs, oldCoupon: v })} min={0} max={15} step={0.125} start="bullet, face 100" />
              <Slider label="Old bond years left" value={rs.oldYears} set={(v) => setRs({ ...rs, oldYears: v === null ? null : Math.max(1, Math.round(v)) })} min={1} max={40} step={1} />
              <Slider label="New face per 100 old" value={rs.newFace} set={(v) => setRs({ ...rs, newFace: v })} min={1} max={100} step={0.5} />
              <Slider label="New coupon, %" value={rs.newCoupon} set={(v) => setRs({ ...rs, newCoupon: v })} min={0} max={15} step={0.125} />
              <Slider label="New bond years" value={rs.newYears} set={(v) => setRs({ ...rs, newYears: v === null ? null : Math.max(1, Math.round(v)) })} min={1} max={40} step={1} />
              <Slider label="New bond grace years" value={rs.newGrace} set={(v) => setRs({ ...rs, newGrace: v === null ? null : Math.max(0, Math.round(v)) })} min={0} max={39} step={1} start="coupons only" />
              <Slider label="Exit yield, %" value={rs.exitYield} set={(v) => setRs({ ...rs, exitYield: v })} min={0} max={30} step={0.25} />
              {rsOut ? (
                <p className="text-slate-900 dark:text-white" data-sandbox-result="restructuring">
                  At a {rs.exitYield}% exit yield the old bond is worth {rsOut.pvOld} and the new one {rsOut.pvNew} per 100 of old face: an NPV haircut of {rsOut.npvHaircutPct}% and a market haircut of {rsOut.marketHaircutPct}% (face cut {rsOut.faceHaircutPct}%).
                </p>
              ) : (
                <p className="text-amber-700 dark:text-amber-400">Missing: enter every term to run the calculator. Nothing is filled in.</p>
              )}
              <p className="text-slate-500 dark:text-slate-400">Method: {RESTRUCTURING_METHOD}</p>
            </div>
            {reply.missing.length > 0 && <p className="text-amber-700 dark:text-amber-400" data-missing="true">Missing: {reply.missing.join('; ')}.</p>}
            <p className="text-slate-500 dark:text-slate-400">Method: {SANDBOX_METHOD}</p>
          </>
        )}
      </div>
    </section>
  );
};
