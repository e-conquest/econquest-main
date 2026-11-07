/**
 * Fiscal multipliers: a cited reference view, not an estimate (Sam, 2026-11-05).
 *
 * The app does not estimate multipliers. It places a country in the IMF's "bucket approach"
 * (Batini, Eyraud, Forni and Weber 2014, IMF Technical Notes and Manuals 14/04) using only figures
 * it holds, says which of the six characteristics it cannot judge, and shows the published
 * literature ranges beside it. Every number below is copied from its source, with the place in the
 * source; a characteristic the app has no data for stays "not known", and widens the range rather
 * than being guessed.
 *
 * Bucket approach (TNM 14/04): one point each for (1) low trade openness, (2) rigid labour market,
 * (3) small automatic stabilisers, (4) fixed or quasi-fixed exchange rate, (5) low public debt
 * (about 100% of GDP for advanced economies, 40% for emerging markets), (6) effective public
 * expenditure management and revenue administration. Score 0-3 = low, 3-4 = medium, 4-6 = large
 * (p.12). First-year multipliers in normal times: low 0.1-0.3, medium 0.4-0.6, large 0.7-1.0
 * (Table 6, p.13). Calibrated on advanced economies; emerging and low-income countries "would
 * generally be placed in the low-multiplier bucket" (pp.13-14). Adjustments (p.14): at the trough of
 * the cycle both bounds up 60%, at the peak down 40%, none at a zero output gap; at the effective
 * lower bound up 30%; M = M_normal x (1 + cycle) x (1 + monetary).
 *
 * Browser-safe.
 */

export interface Bucket {
  id: 'low' | 'medium' | 'large';
  low: number;
  high: number;
}

/** TNM 14/04 Table 6, p.13: first-year overall multipliers, normal times. */
export const BUCKETS: Bucket[] = [
  { id: 'low', low: 0.1, high: 0.3 },
  { id: 'medium', low: 0.4, high: 0.6 },
  { id: 'large', low: 0.7, high: 1.0 },
];

/** TNM 14/04 p.14: bounds scale at the cycle trough (+60%), peak (-40%), and at the effective lower bound (+30%). */
export const CYCLE_TROUGH = 0.6;
export const CYCLE_PEAK = -0.4;
export const LOWER_BOUND = 0.3;
/** TNM 14/04 pp.11-12: "low public debt" thresholds, % of GDP. */
export const LOW_DEBT_THRESHOLD = { advanced: 100, emerging: 40 } as const;
/** Policy rate at or below this counts as at the effective lower bound for the +30% adjustment. */
export const LOWER_BOUND_RATE_PCT = 0.5;

export const TNM_CITATION =
  'Batini, N., Eyraud, L., Forni, L. and Weber, A. (2014), "Fiscal Multipliers: Size, Determinants, and Use in Macroeconomic Projections", IMF Technical Notes and Manuals 14/04, Table 6 p.13, pp.11-14.';

/**
 * IMF World Economic Outlook advanced economies (country composition of WEO groups). Every other
 * country is treated as an emerging market or developing economy.
 */
export const IMF_ADVANCED = new Set([
  'AND', 'AUS', 'AUT', 'BEL', 'CAN', 'HRV', 'CYP', 'CZE', 'DNK', 'EST', 'FIN', 'FRA', 'DEU', 'GRC', 'HKG', 'ISL', 'IRL', 'ISR', 'ITA', 'JPN', 'KOR', 'LVA', 'LTU', 'LUX', 'MAC', 'MLT', 'NLD', 'NZL', 'NOR', 'PRT', 'PRI', 'SMR', 'SGP', 'SVK', 'SVN', 'ESP', 'SWE', 'CHE', 'TWN', 'GBR', 'USA',
]);

export interface LiteratureRange {
  id: string;
  finding: string;
  value: string;
  /** Applies when this is true of the country; undefined = general. */
  appliesTo?: 'advanced' | 'emerging' | 'high_debt' | 'recession' | 'lower_bound';
  source: string;
}

/** Published findings, each number as printed in its source (verified 2026-11-05). */
export const LITERATURE: LiteratureRange[] = [
  {
    id: 'imv_high_income',
    finding: 'Government consumption, high-income countries',
    value: 'impact 0.39; cumulative long-run 0.66',
    appliesTo: 'advanced',
    source: 'Ilzetzki, Mendoza and Végh (2013), "How big (small?) are fiscal multipliers?", Journal of Monetary Economics 60(2), 239-254, section 4.4.',
  },
  {
    id: 'imv_developing',
    finding: 'Government consumption, developing countries',
    value: 'impact -0.03, not significant; long-run negative, not significant',
    appliesTo: 'emerging',
    source: 'Ilzetzki, Mendoza and Végh (2013), Journal of Monetary Economics 60(2), section 4.4.',
  },
  {
    id: 'imv_fixed',
    finding: 'Predetermined (fixed) exchange rate',
    value: 'impact 0.15; rises to 1.4 in the long run',
    source: 'Ilzetzki, Mendoza and Végh (2013), Journal of Monetary Economics 60(2), section 4.5.',
  },
  {
    id: 'imv_flexible',
    finding: 'Flexible exchange rate',
    value: 'negative at any horizon; the abstract calls it zero',
    source: 'Ilzetzki, Mendoza and Végh (2013), Journal of Monetary Economics 60(2), section 4.5 and abstract.',
  },
  {
    id: 'imv_closed_open',
    finding: 'Closed vs open economies (trade to GDP)',
    value: 'closed: impact 0.6, long-run 1.1; open: negative, never significant',
    source: 'Ilzetzki, Mendoza and Végh (2013), Journal of Monetary Economics 60(2), section 4.6.',
  },
  {
    id: 'imv_high_debt',
    finding: 'Central government debt above 60% of GDP',
    value: 'impact close to zero; long-run negative (-3)',
    appliesTo: 'high_debt',
    source: 'Ilzetzki, Mendoza and Végh (2013), Journal of Monetary Economics 60(2), section 4.7.',
  },
  {
    id: 'ag_cycle',
    finding: 'Spending multipliers, recession vs expansion (US)',
    value: 'peak: expansion 0.49, recession 2.12; cumulative 20 quarters: expansion -0.80, recession 2.17',
    appliesTo: 'recession',
    source: 'Auerbach and Gorodnichenko, "Measuring the Output Responses to Fiscal Policy", NBER Working Paper 16311, revised June 2013 (corrects the AEJ: Economic Policy 4(2), 1-27, 2012 figures), Table 1.',
  },
  {
    id: 'ramey',
    finding: 'Survey of estimates (mostly US)',
    value: 'spending 0.6 to 1; tax changes -2 to -3; at the zero lower bound possibly 1.5 or higher',
    appliesTo: 'lower_bound',
    source: 'Ramey (2019), "Ten Years after the Financial Crisis: What Have We Learned from the Renaissance in Fiscal Research?", Journal of Economic Perspectives 33(2), 89-114, abstract; NBER WP 25531 pp.2-3.',
  },
  {
    id: 'blanchard_leigh',
    finding: 'Multipliers early in the 2010s consolidations (European forecasts)',
    value: 'forecasts assumed about 0.5; actual multipliers substantially above 1 early in the crisis',
    source: 'Blanchard and Leigh (2013), "Growth Forecast Errors and Fiscal Multipliers", IMF Working Paper WP/13/1, pp.4, 19 (also American Economic Review 103(3), 117-120).',
  },
];

export interface MultiplierInputs {
  iso3: string;
  /** General government gross debt, % of GDP, with its year (IMF WEO). */
  debtPctGdp?: { value: number; year: string };
  /** Output gap, % of potential GDP, and where it came from. */
  outputGap?: { pct: number; year: string; source?: 'imf' | 'estimate' };
  /** BIS policy rate, %. */
  policyRatePct?: number;
}

export interface Characteristic {
  id: 'trade' | 'labour' | 'stabilisers' | 'fx' | 'debt' | 'pfm';
  label: string;
  /** 1 = adds a point, 0 = does not, undefined = the app cannot judge it. */
  point?: 0 | 1;
  why: string;
}

export interface MultiplierView {
  iso3: string;
  group: 'advanced' | 'emerging';
  characteristics: Characteristic[];
  /** Score range given the characteristics the app cannot judge. */
  score: { min: number; max: number };
  /** Normal-times first-year range the score can map to. */
  normal: { low: number; high: number; buckets: Bucket['id'][] };
  /** Normal-times range the paper's guidance points to for this group. */
  guide: { low: number; high: number; bucket: Bucket['id']; why: string };
  cycle: { note: string; trough: { low: number; high: number }; peak: { low: number; high: number } };
  lowerBound?: { low: number; high: number; why: string };
  literature: LiteratureRange[];
  sentence: string;
  method: string;
}

const r2 = (v: number) => Number(v.toFixed(2));

function bucketsForScore(min: number, max: number): Bucket[] {
  // p.12: 0-3 low, 3-4 medium, 4-6 large; 3 and 4 sit in two buckets.
  const out = new Set<Bucket['id']>();
  for (let s = min; s <= max; s++) {
    if (s <= 3) out.add('low');
    if (s >= 3 && s <= 4) out.add('medium');
    if (s >= 4) out.add('large');
  }
  return BUCKETS.filter((b) => out.has(b.id));
}

export function multiplierView(inp: MultiplierInputs): MultiplierView {
  const group: MultiplierView['group'] = IMF_ADVANCED.has(inp.iso3) ? 'advanced' : 'emerging';
  const threshold = LOW_DEBT_THRESHOLD[group];
  const notHeld = (what: string) => `The app holds no ${what}, so it cannot judge this one`;
  const characteristics: Characteristic[] = [
    { id: 'trade', label: 'Low trade openness (imports under 30% of domestic demand)', why: notHeld('imports-to-domestic-demand figure') },
    { id: 'labour', label: 'Rigid labour market', why: notHeld('labour market rigidity measure') },
    { id: 'stabilisers', label: 'Small automatic stabilisers (public spending under about 40% of GDP)', why: notHeld('public spending-to-GDP series yet') },
    { id: 'fx', label: 'Fixed or quasi-fixed exchange rate', why: notHeld('exchange rate regime classification (the IMF AREAER is not a free feed)') },
    inp.debtPctGdp
      ? {
          id: 'debt',
          label: `Low public debt (under ${threshold}% of GDP for ${group === 'advanced' ? 'advanced' : 'emerging'} economies)`,
          point: inp.debtPctGdp.value < threshold ? 1 : 0,
          why: `IMF WEO ${inp.debtPctGdp.year}: ${inp.debtPctGdp.value.toFixed(1)}% of GDP`,
        }
      : { id: 'debt', label: `Low public debt (under ${threshold}% of GDP)`, why: 'IMF WEO debt is Missing for this country' },
    { id: 'pfm', label: 'Effective public expenditure management and revenue administration', why: notHeld('PEFA or tax productivity score') },
  ];
  const known = characteristics.filter((c) => c.point !== undefined);
  const min = known.reduce((s, c) => s + (c.point || 0), 0);
  const max = min + (characteristics.length - known.length);
  const bs = bucketsForScore(min, max);
  const normal = { low: Math.min(...bs.map((b) => b.low)), high: Math.max(...bs.map((b) => b.high)), buckets: bs.map((b) => b.id) };
  const guideBucket = group === 'emerging' ? BUCKETS[0] : BUCKETS[1];
  const guide = {
    low: guideBucket.low,
    high: guideBucket.high,
    bucket: guideBucket.id,
    why:
      group === 'emerging'
        ? 'TNM 14/04 pp.13-14: emerging and low-income countries would generally be placed in the low-multiplier bucket.'
        : 'TNM 14/04 p.12: the medium range is the one found for advanced economies (Mineshima and others 2014).',
  };
  const scale = (f: number) => ({ low: r2(guide.low * (1 + f)), high: r2(guide.high * (1 + f)) });
  const gap = inp.outputGap;
  const cycleNote = gap
    ? `Output gap ${gap.year} ${gap.pct >= 0 ? '+' : ''}${gap.pct.toFixed(1)}% (${gap.source === 'estimate' ? 'app estimate' : 'IMF'}): ${gap.pct < -0.5 ? 'below potential, so toward the trough adjustment' : gap.pct > 0.5 ? 'above potential, so toward the peak adjustment' : 'close to zero, so little cycle adjustment'}. The paper scales from 0 at a zero gap to +60% at the trough and -40% at the peak.`
    : 'No output gap for this country, so the cycle adjustment cannot be placed; trough and peak bounds shown.';
  const atLb = inp.policyRatePct !== undefined && inp.policyRatePct <= LOWER_BOUND_RATE_PCT;
  const literature = LITERATURE.filter(
    (l) =>
      !l.appliesTo ||
      l.appliesTo === group ||
      (l.appliesTo === 'high_debt' && (inp.debtPctGdp?.value ?? 0) > 60) ||
      (l.appliesTo === 'recession' && gap !== undefined && gap.pct < -0.5) ||
      (l.appliesTo === 'lower_bound' && atLb),
  );
  const unknown = characteristics.length - known.length;
  const sentence = `First-year fiscal multiplier, normal times: ${guide.low}-${guide.high} by the IMF bucket approach for ${group === 'advanced' ? 'an advanced economy' : 'an emerging market'} (${guide.bucket} bucket)${unknown ? `; ${unknown} of 6 characteristics are not known to the app, so its own scoring spans ${normal.low}-${normal.high}` : ''}. A cited reference range, not an estimate for this country.`;
  return {
    iso3: inp.iso3,
    group,
    characteristics,
    score: { min, max },
    normal,
    guide,
    cycle: { note: cycleNote, trough: scale(CYCLE_TROUGH), peak: scale(CYCLE_PEAK) },
    ...(atLb ? { lowerBound: { ...scale(LOWER_BOUND), why: `Policy rate ${inp.policyRatePct!.toFixed(2)}% (BIS), at or under ${LOWER_BOUND_RATE_PCT}%: TNM 14/04 adds 30% at the effective lower bound.` } } : {}),
    literature,
    sentence,
    method: `IMF bucket approach (${TNM_CITATION}); characteristics the app has no data for are left open and widen the score range; group from the IMF WEO advanced-economy list.`,
  };
}
