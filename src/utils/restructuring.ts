/**
 * Restructuring calculator on terms you enter (seven-groups plan, group 1; gap analysis A3).
 *
 * Compares an old bond with the new bond offered for it, both per 100 of old face value, with
 * yearly payments. The new bond can cut face value, change the coupon, add years of grace (coupons
 * only, no principal) and repay in equal parts after the grace period.
 *
 *   Present value  PV = sum of payment(t) / (1 + y)^t at the exit yield y
 *   NPV haircut    1 - PV(new) / PV(old), both at the exit yield (Sturzenegger and Zettelmeyer 2008)
 *   Market haircut 1 - PV(new) / 100, against the old face value, the measure Cruces and Trebesch
 *                  (2013) also report
 *
 * Nothing is filled in from data: every term is the user's. Illustration of the arithmetic, not a
 * forecast of any deal. Browser-safe, pure.
 */

export interface BondTerms {
  /** Face value per 100 of old face. */
  face: number;
  /** Coupon, % a year of face outstanding. */
  couponPct: number;
  /** Years to final maturity. */
  years: number;
  /** Years at the start with coupons only, before principal starts to be repaid. Old bond: bullet when grace = years - 1. */
  graceYears: number;
}

export interface RestructuringInputs {
  oldBond: BondTerms;
  newBond: BondTerms;
  /** Exit yield, % a year: the yield the restructured debt trades at. */
  exitYieldPct: number;
}

export interface RestructuringResult {
  pvOld: number;
  pvNew: number;
  npvHaircutPct: number;
  marketHaircutPct: number;
  /** Face cut, %: 1 - new face / old face. */
  faceHaircutPct: number;
  cashflowsNew: number[];
  cashflowsOld: number[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Yearly payments: coupon on face outstanding, principal in equal parts after the grace years. */
export function cashflows(b: BondTerms): number[] {
  const years = Math.max(1, Math.round(b.years));
  const grace = Math.min(years - 1, Math.max(0, Math.round(b.graceYears)));
  const amortYears = years - grace;
  const part = b.face / amortYears;
  let out = b.face;
  const flows: number[] = [];
  for (let t = 1; t <= years; t++) {
    const coupon = (out * b.couponPct) / 100;
    const principal = t > grace ? part : 0;
    flows.push(coupon + principal);
    out -= principal;
  }
  return flows;
}

export function presentValue(flows: number[], yieldPct: number): number {
  return flows.reduce((a, c, i) => a + c / (1 + yieldPct / 100) ** (i + 1), 0);
}

/** Null when a term is out of range (non-positive face or years, yield at or below -100%). */
export function restructuring(x: RestructuringInputs): RestructuringResult | null {
  const okBond = (b: BondTerms) => b.face > 0 && b.years >= 1 && b.couponPct >= 0 && b.graceYears >= 0;
  if (!okBond(x.oldBond) || !okBond(x.newBond) || !(x.exitYieldPct > -100)) return null;
  const cashflowsOld = cashflows(x.oldBond);
  const cashflowsNew = cashflows(x.newBond);
  const pvOld = presentValue(cashflowsOld, x.exitYieldPct);
  const pvNew = presentValue(cashflowsNew, x.exitYieldPct);
  return {
    pvOld: r2(pvOld),
    pvNew: r2(pvNew),
    npvHaircutPct: r2((1 - pvNew / pvOld) * 100),
    marketHaircutPct: r2((1 - pvNew / x.oldBond.face) * 100),
    faceHaircutPct: r2((1 - x.newBond.face / x.oldBond.face) * 100),
    cashflowsNew: cashflowsNew.map(r2),
    cashflowsOld: cashflowsOld.map(r2),
  };
}

export const RESTRUCTURING_METHOD =
  'Both bonds per 100 of old face value, yearly payments: coupon on the face outstanding, principal repaid in equal parts after the grace years (grace one year short of maturity makes a bullet bond). Present values at the exit yield. NPV haircut = 1 - PV(new) / PV(old), both at the exit yield (Sturzenegger and Zettelmeyer 2008); market haircut = 1 - PV(new) / old face (also reported by Cruces and Trebesch 2013). Every term is yours; nothing comes from data. Illustration of the arithmetic, not a forecast of any deal.';
