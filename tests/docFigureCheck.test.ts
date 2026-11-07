import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareClaims, extractClaims } from '../src/utils/docFigureCheck.ts';
import { allowedNumbers, docCountry, planCouncil, runCouncil } from '../src/utils/askCouncil.ts';
import type { PolicyDoc } from '../src/utils/policyDocs.ts';
import type { WatchlistItem } from '../src/types/council.ts';

const COPOM: PolicyDoc = {
  id: 'copom',
  title: 'Copom statement, October 2026',
  addedAt: '2026-11-05',
  text: [
    'The Copom unanimously decided to maintain the Selic rate at 15.00% per year.',
    'Headline inflation stood at 4.6% over twelve months, above the target.',
    'The Committee expects inflation to reach 3.5% in 2027.',
    'Gross public debt reached 78.1% of GDP. The primary deficit was 0.4% of GDP.',
    'International reserves stood at US$ 360.5 billion.',
    'Brazil remains exposed to external shocks; Brazil’s fiscal outlook is uncertain.',
  ].join(' '),
};

test('figures a document states are found; targets and forecasts are left out', () => {
  const c = extractClaims(COPOM.text);
  const by = Object.fromEntries(c.map((x) => [x.measure, x.value]));
  assert.equal(by.policy, 15);
  assert.equal(by.cpi, 4.6); // not the 3.5% expectation
  assert.equal(by.debt, 78.1);
  assert.equal(by.primary, -0.4); // a deficit is a negative balance
  assert.equal(by.reserves, 360.5);
  assert.equal(extractClaims('The inflation target is 3%. We forecast growth of 2.5%.').length, 0);
});

const BRA = {
  iso3: 'BRA',
  countryName: 'Brazil',
  policyRatePct: 15,
  policyRateSource: 'bis',
  policyRateDate: '2026-10-27',
  cpiInflationPct: 4.2,
  cpiSource: 'oecd',
  cpiMonth: '2026-04',
  fiscal: { debtPctGdp: { value: 87.3, year: '2025' }, primaryBalancePctGdp: { value: -0.4, year: '2025' } },
  imf: { reserves: { usdBn: 363.1, period: '2026-09' }, pulledAt: '2026-11-05' },
} as unknown as WatchlistItem;
const TUR = { iso3: 'TUR', countryName: 'Turkey' } as WatchlistItem;

test('each figure sits next to the app figure, with a stated tolerance', () => {
  const r = compareClaims(extractClaims(COPOM.text), BRA);
  const m = Object.fromEntries(r.map((x) => [x.claim.measure, x]));
  assert.equal(m.policy.matches, true);
  assert.equal(m.cpi.matches, false);
  assert.equal(m.cpi.gap!.toFixed(1), '0.4'); // 4.6 against 4.2
  assert.equal(m.debt.matches, false);
  assert.equal(m.primary.matches, true);
  assert.equal(m.reserves.matches, true); // within 2%
});

test('the document is matched to its country; the agent says where it differs, and the figures pass the number check', () => {
  assert.equal(docCountry(COPOM, [BRA, TUR], [])?.iso3, 'BRA');
  assert.equal(docCountry({ ...COPOM, title: 'Statement', text: 'Rates are 15%.' }, [BRA, TUR], [TUR])?.iso3, 'TUR');
  const q = 'Is Brazil policy tight?';
  const plan = planCouncil(q, [BRA, TUR]);
  const doc = runCouncil(q, plan, [BRA, TUR], new Date(), [COPOM]).find((a) => a.id === 'doc')!;
  const check = doc.findings.find((f) => f.iso3 === 'doc:copom:check')!;
  assert.match(check.countryName, /checked against the app's Brazil figures/);
  assert.match(check.reading, /Government debt differs: the document says 78\.1% of GDP, the app's figure is 87\.3% of GDP \(IMF WEO, 2025\)/);
  assert.match(check.reading, /may be older than the app's figure/);
  const verdict = check.figures.find((g) => g.label === 'Policy rate: document against the app')!;
  assert.equal(verdict.value, 'matches');
  assert.ok(allowedNumbers(q, [doc]).includes(78.1));
  // A question about another country does not check a Brazil document.
  const turQ = 'Is Turkey policy tight?';
  const other = runCouncil(turQ, planCouncil(turQ, [BRA, TUR]), [BRA, TUR], new Date(), [COPOM]).find((a) => a.id === 'doc')!;
  assert.ok(!other.findings.some((f) => f.iso3.endsWith(':check')));
});
