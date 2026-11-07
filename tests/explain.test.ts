import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCouncil, planFollowUp, runCouncil } from '../src/utils/askCouncil.ts';
import { checkExplain, cleanFocus, explainTask, focusAsText, focusQuestion, isExplainQuestion, lensCoverage, lensesInQuestion, withExplainAgents, type ExplainFocus } from '../src/utils/explain.ts';
import type { WatchlistItem } from '../src/types/council.ts';

const it = (iso3: string, countryName: string, o: Partial<WatchlistItem> = {}): WatchlistItem =>
  ({ iso3, countryName, compositeRisk: 0.5, cds5YBps: 150, cds5YSource: 'own', cds5YProvider: 'file', yield10YPct: 8, yield10YSource: 'official', yield10YPeriod: '2026-09', policyRateSource: 'bis', ...o }) as WatchlistItem;

const TUR = it('TUR', 'Turkey', {
  cpiInflationPct: 34,
  cpiSource: 'live',
  policyRatePct: 30,
  policyRateSource: 'bis',
  policyRateDate: '2026-10-27',
  reerGapPct: -12.4,
  reerPeriod: '2026-09',
});
const ZAF = it('ZAF', 'South Africa', { cpiInflationPct: 3.4, cpiSource: 'live', policyRatePct: 8 });
const ALL = [TUR, ZAF];

test('explain questions: why, what it means, what drives it, how it feeds through; rankings are not', () => {
  for (const q of [
    "Why is Turkey's real rate so negative?",
    'Explain the Phillips curve for South Africa',
    'What does a weak lira mean for households?',
    "What's behind the rise in yields?",
    'How would a Hormuz closure affect Turkish firms?',
    'What are the implications for the budget?',
  ])
    assert.ok(isExplainQuestion(q), q);
  for (const q of ['Which central banks look behind the curve?', 'Who is most exposed to a Hormuz closure?', 'What is coming up in the next month?']) assert.equal(isExplainQuestion(q), false, q);
  // A figure pressed on is always an explanation, whatever the words.
  assert.ok(isExplainQuestion('Turkey?', { kind: 'figure', label: 'Policy rate' }));
});

test('lenses: named after "for"/"on" when given, policy means monetary and fiscal, none means all', () => {
  assert.deepEqual(lensesInQuestion('Why is the policy rate so high for households?'), ['micro']);
  assert.deepEqual(lensesInQuestion('What does it mean for policy?'), ['monetary', 'fiscal']);
  assert.deepEqual(lensesInQuestion('What does this mean for conflict risk and the budget?'), ['fiscal', 'politics']);
  assert.deepEqual(lensesInQuestion("Why is Turkey's real rate so negative?"), []);
});

test('plan: explain questions bring each lens its agents, keep their own picks first, and record the lenses', () => {
  const q = 'What does a weak lira mean for households and firms in Turkey?';
  const plan = withExplainAgents(planCouncil(q, ALL), q);
  assert.deepEqual(plan.explain?.lenses, ['micro']);
  assert.equal(plan.explain?.named, true);
  assert.deepEqual(plan.agents.map((a) => a.id).sort(), ['cb', 'fx']);
  assert.match(plan.agents.find((a) => a.id === 'cb')!.why, /households and firms/);
  // Not an explanation: unchanged.
  const rank = planCouncil('Which central banks look behind the curve?', ALL);
  assert.equal(withExplainAgents(rank, 'Which central banks look behind the curve?'), rank);
  // Every lens: one agent per lens, at most six, in the usual order.
  const wide = withExplainAgents(planCouncil('Why is Turkey so different?', ALL), 'Why is Turkey so different?');
  assert.equal(wide.explain?.named, false);
  assert.ok(wide.agents.length <= 6);
  assert.deepEqual(wide.agents.map((a) => a.id), ['cb', 'fiscal', 'politics', 'rv', 'spill']);
});

test('plan: a follow-up "what does this mean for households?" keeps the countries and adds the lens agents', () => {
  const first = planCouncil("Is Turkey's currency weak?", ALL);
  const q = 'What does this mean for households?';
  const plan = withExplainAgents(planFollowUp(q, first, ALL), q);
  assert.deepEqual(plan.countries.map((c) => c.iso3), ['TUR']);
  assert.deepEqual(plan.explain?.lenses, ['micro']);
  assert.ok(plan.agents.some((a) => a.id === 'cb') && plan.agents.some((a) => a.id === 'fx'));
});

test('focus: an Explain press narrows to its country, is cleaned, and its value is quoted in the prompt', () => {
  const focus: ExplainFocus = { kind: 'figure', label: 'Real policy rate', value: '-4.0%', source: 'Central Bank Watcher rule', asOf: '2026-10', iso3: 'TUR', countryName: 'Turkey' };
  const q = focusQuestion(focus);
  assert.match(q, /^Explain Turkey: Real policy rate of -4.0%/);
  const plan = withExplainAgents(planCouncil(q, ALL), q, focus);
  assert.deepEqual(plan.countries.map((c) => c.iso3), ['TUR']);
  assert.deepEqual(plan.explain?.focus, focus);
  assert.match(focusAsText(focus), /Real policy rate: -4.0% \[Central Bank Watcher rule, 2026-10\]/);
  // Junk from the browser is dropped or trimmed.
  assert.equal(cleanFocus({ kind: 'script', label: 'x' }), undefined);
  assert.equal(cleanFocus({ kind: 'figure', label: '  ' }), undefined);
  const c = cleanFocus({ kind: 'chart', label: 'Phillips curve', iso3: 'tur', detail: Array(20).fill('line') });
  assert.equal(c?.iso3, undefined);
  assert.equal(c?.detail?.length, 8);
});

test('coverage: a lens whose agents brought no figures is Missing with the reason', () => {
  const q = 'Why is inflation high in Turkey, and what does it mean for politics?';
  const plan = withExplainAgents(planCouncil(q, ALL), q);
  const answers = runCouncil(q, plan, ALL);
  const cov = lensCoverage(['monetary', 'politics'], answers);
  assert.deepEqual(cov[0].agents, ['Central Bank Watcher']);
  assert.equal(cov[1].agents.length, 0);
  assert.match(cov[1].missing!, /Politics & Events Agent had no figures/);
  const task = explainTask(q, cov);
  assert.match(task, /- monetary: Monetary policy, from Central Bank Watcher/);
  assert.doesNotMatch(task, /- politics:/);
  assert.match(task, /Question to explain: Why is inflation high/);
});

test('check: facts and interpretation are kept apart, numbers must trace (focus numbers allowed), missing lenses say why', () => {
  const focus: ExplainFocus = { kind: 'figure', label: 'Ten-year yield', value: '27.5%', iso3: 'TUR', countryName: 'Turkey' };
  const q = 'Why is inflation high in Turkey, and what does it mean for households and politics?';
  const plan = withExplainAgents(planCouncil(q, ALL), q, focus);
  const answers = runCouncil(q, plan, ALL);
  const { brief, removed } = checkExplain(
    {
      headline: 'Inflation of 34.0% is far above the policy rate, so policy is still loose in real terms.',
      facts: ['CPI inflation is 34.0% and the policy rate is 30.00%.', 'The ten-year yield the user pointed at is 27.5%.', 'Inflation will be 41% next year.'],
      reasons: ['A weak currency keeps import prices rising.'],
      lenses: [
        { lens: 'micro', text: 'Real incomes fall when prices outrun wages; borrowers gain while savers lose.' },
        { lens: 'politics', text: 'Protests are likely.' },
        { lens: 'bogus', text: 'x' },
      ],
      watch: ['A move in the policy rate above inflation would change this reading.'],
      gaps: [],
    },
    q,
    answers,
    plan.explain!
  );
  const e = brief.explain;
  assert.equal(e.facts.length, 2);
  assert.deepEqual(removed, ['Inflation will be 41% next year.']);
  assert.equal(e.reasons.length, 1);
  const micro = e.lenses.find((l) => l.lens === 'micro')!;
  assert.equal(micro.sentences.length, 1);
  // Politics had no figures: the model's sentence is not shown; Missing with the reason is.
  const pol = e.lenses.find((l) => l.lens === 'politics')!;
  assert.deepEqual(pol.sentences, []);
  assert.match(pol.missing!, /no figures/);
  assert.equal(e.focus?.value, '27.5%');
  // The flat brief carries the same sentences for exports and saved documents.
  assert.ok(brief.points.includes('Households and firms: Real incomes fall when prices outrun wages; borrowers gain while savers lose.'));
  assert.ok(brief.points.some((p) => p.startsWith('What would change it:')));
});

test('references: a sentence cites a source only when it quotes that source\'s figure as written; rule readings are not cited', async () => {
  const { citedExplain } = await import('../src/utils/explain.ts');
  const answers = [
    {
      id: 'cb' as const,
      name: 'Central Bank Watcher',
      why: 'x',
      findings: [
        {
          iso3: 'TUR',
          countryName: 'Turkey',
          reading: 'Loose.',
          weight: 1,
          figures: [
            { label: 'CPI inflation', value: '34.0%', source: 'OECD, monthly', tag: 'live' as const },
            { label: 'Policy rate', value: '30.00%', source: 'BIS policy rates', tag: 'official' as const },
            { label: 'Real policy rate', value: '-4.0%', source: 'Central Bank Watcher rule', tag: 'model' as const },
          ],
        },
      ],
      missing: [],
    },
  ];
  const c = citedExplain(
    {
      facts: ['The policy rate is 30.00% and inflation 34.0%.', 'The real rate is -4.0%.'],
      reasons: ['Policy is loose.'],
      lenses: [{ lens: 'micro', label: 'Households and firms', sentences: ['Inflation of 34.0% erodes real incomes.'] }],
      watch: [],
      focus: { kind: 'figure', label: 'Ten-year yield', value: '27.5%', source: 'FRED', asOf: '2026-09' },
    },
    answers
  );
  // Numbered in reading order; the same source keeps its number.
  assert.deepEqual(c.facts[0].refs, [1, 2]);
  assert.equal(c.references[0].source, 'BIS policy rates');
  assert.deepEqual(c.facts[1].refs, []);
  assert.deepEqual(c.lenses[0].sentences[0].refs, [2]);
  assert.equal(c.references.length, 2);
});

test('chart focus: title, each line\'s latest point with source, test readings; one country narrows the plan', async () => {
  const { chartFocus } = await import('../src/utils/explainHandoff.ts');
  const f = chartFocus({
    title: 'Brazil: Real policy rate',
    freq: 'M',
    transform: 'level',
    lines: [
      { key: 'a', label: 'Brazil: Policy rate', unit: '%', axis: 'left', source: 'BIS policy rates', points: [{ date: '2026-10', value: 15 }, { date: '2026-11', value: 13.75 }] },
      { key: 'b', label: 'Empty', unit: '%', axis: 'left', source: 'x', points: [] },
    ],
    tests: [
      { test: 'adf', title: 'Stationarity (ADF test)', reading: 'Not stationary.', figures: [{ label: 'p', value: '0.41' }] },
      { test: 'hp', title: 'Trend', reading: 'Not run: too short.', figures: [] },
    ],
    missing: [],
    notes: [],
    first: '2023-01',
    last: '2026-11',
    request: { series: [{ iso3: 'BRA', countryName: 'Brazil', id: 'policy_rate', label: 'Policy rate' }] },
  } as never);
  assert.equal(f.kind, 'chart');
  assert.equal(f.iso3, 'BRA');
  assert.equal(f.asOf, '2023-01 to 2026-11');
  assert.deepEqual(f.detail, ['Brazil: Policy rate: latest 13.75% (2026-11) [BIS policy rates]', 'Stationarity (ADF test): Not stationary.']);
  assert.match(focusQuestion(f), /^Explain this chart \(Brazil: Real policy rate\)/);
});
