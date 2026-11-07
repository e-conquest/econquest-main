import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callsIn, contradiction, policyCall, type StancedFinding } from '../src/utils/stanceCheck.ts';
import { checkBrief, planCouncil, runCouncil } from '../src/utils/askCouncil.ts';
import type { WatchlistItem } from '../src/types/council.ts';

test('policy wording maps to one call', () => {
  assert.equal(policyCall('tight, with inflation still above target'), 'tight');
  assert.equal(policyCall('a negative real rate'), 'loose');
  assert.equal(policyCall('not very tight with inflation above target'), 'neutral');
  assert.equal(policyCall('close to neutral with inflation near target'), 'neutral');
});

test('calls in a sentence: only on topic, and negated words do not count', () => {
  assert.deepEqual(callsIn('Turkish monetary policy is loose.', 'policy'), ['loose']);
  assert.deepEqual(callsIn('Policy is not loose.', 'policy'), []);
  assert.deepEqual(callsIn('The weather is tight.', 'policy'), [], 'off topic');
  assert.deepEqual(callsIn("Turkey's CDS looks rich against its peers.", 'cds'), ['rich']);
  assert.deepEqual(callsIn('The lira is weak for its history.', 'fx'), ['weak']);
});

const F: StancedFinding[] = [
  { iso3: 'TUR', countryName: 'Turkey', agent: 'Central Bank Watcher', stance: [{ dim: 'policy', call: 'tight' }] },
  { iso3: 'TUR', countryName: 'Turkey', agent: 'FX Valuation', stance: [{ dim: 'fx', call: 'weak' }] },
  { iso3: 'ZAF', countryName: 'South Africa', agent: 'Relative Value', stance: [{ dim: 'cds', call: 'cheap' }] },
];

test('a sentence that contradicts an agent is caught, with the reason; agreeing or unclear sentences pass', () => {
  const c = contradiction('Turkey runs a loose monetary policy.', F);
  assert.ok(c);
  assert.match(c!.reason, /Turkey's monetary policy loose; the Central Bank Watcher Agent reads it as tight/);
  assert.equal(contradiction('Turkey keeps policy tight.', F), undefined);
  assert.equal(contradiction('Türkiye’s policy is not loose.', F), undefined, 'negated opposite agrees');
  assert.ok(contradiction('The Turkish lira looks strong.', F), 'alias and FX');
  // Only one country has a CDS call, so an unnamed CDS sentence is about it.
  assert.ok(contradiction('CDS looks rich against peers.', F));
  // Two countries named: which word belongs to which is unclear, so it is left alone.
  assert.equal(contradiction('Turkey and South Africa both have loose policy.', F), undefined);
});

test('checkBrief removes a contradicting sentence and keeps the rest', () => {
  const it = (iso3: string, countryName: string, o: Partial<WatchlistItem> = {}): WatchlistItem =>
    ({ iso3, countryName, compositeRisk: 0.5, cds5YBps: 150, cds5YSource: 'own', yield10YPct: 8, yield10YSource: 'official', yield10YPeriod: '2026-09', cpiSource: 'live', policyRateSource: 'bis', ...o }) as WatchlistItem;
  const ALL = [
    it('TUR', 'Turkey', { cpiInflationPct: 34, policyRatePct: 45, reerGapPct: -12.4 }),
    it('ZAF', 'South Africa', { cpiInflationPct: 3.4, policyRatePct: 8 }),
  ];
  const q = 'Is Turkey behind the curve, and is the lira cheap?';
  const answers = runCouncil(q, planCouncil(q, ALL), ALL);
  const cb = answers.find((a) => a.id === 'cb')!.findings.find((f) => f.iso3 === 'TUR')!;
  assert.deepEqual(cb.stance, [{ dim: 'policy', call: 'tight' }]);
  const { brief, contradicted } = checkBrief(
    { headline: 'Turkey looks loose on monetary policy.', points: ['The lira is weak for its history.', 'Nothing to check here.'], disagreements: [], gaps: [] },
    q,
    answers
  );
  assert.equal(brief.headline, '');
  assert.deepEqual(brief.points, ['The lira is weak for its history.', 'Nothing to check here.']);
  assert.equal(contradicted.length, 1);
  assert.match(contradicted[0].reason, /reads it as tight/);
});
