import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  keepSourcedFindings,
  offWatchlistCountries,
  planFollowUp,
  agentChoicePrompt,
  allowedNumbers,
  applyAgentChoice,
  checkBrief,
  councilBriefSections,
  countriesInQuestion,
  planCouncil,
  runCouncil,
  scenariosInQuestion,
  traces,
} from '../src/utils/askCouncil.ts';
import type { WatchlistItem } from '../src/types/council.ts';

const it = (iso3: string, countryName: string, o: Partial<WatchlistItem> = {}): WatchlistItem =>
  ({
    iso3,
    countryName,
    cds5YBps: 150,
    cds5YSource: 'own',
    cds5YProvider: 'file',
    yield10YPct: 8,
    yield10YSource: 'official',
    yield10YPeriod: '2026-09',
    policyRateSource: 'bis',
    ...o,
  }) as WatchlistItem;

const TUR = it('TUR', 'Turkey', {
  cds5YBps: 300,
  yield10YPct: 28,
  cpiInflationPct: 34,
  cpiSource: 'live',
  policyRatePct: 30,
  policyRateSource: 'bis',
  policyRateDate: '2026-10-27',
  policyRateBank: 'Central Bank of the Republic of Türkiye',
  reerGapPct: -12.4,
  reerPeriod: '2026-09',
  trade: { fuelImportsPctMerch: 15, fuelExportsPctMerch: 3, importsPctGdp: 32, exportsPctGdp: 30, wbYear: '2025', chinaExportSharePct: 2, witsYear: '2023' },
});
const ZAF = it('ZAF', 'South Africa', { cds5YBps: 250, cpiInflationPct: 3.4, cpiSource: 'live', policyRatePct: 8 });
const EGY = it('EGY', 'Egypt (Red Sea Corridor)', { cds5YBps: 600 });
const POL = it('POL', 'Poland', { cds5YBps: 70 });
const ALL = [TUR, ZAF, EGY, POL];

test('planner: countries by name, alias or ISO code; the whole watchlist when none is named', () => {
  assert.deepEqual(countriesInQuestion('How exposed is Türkiye?', ALL).map((c) => c.iso3), ['TUR']);
  assert.deepEqual(countriesInQuestion('Egypt and ZAF', ALL).map((c) => c.iso3), ['ZAF', 'EGY']);
  assert.deepEqual(countriesInQuestion('Poles apart', ALL), []); // no partial-word match
  const p = planCouncil('Which central banks look behind the curve?', ALL);
  assert.equal(p.countries.length, 4);
  assert.match(p.scopeNote, /whole watchlist \(4 countries\)/);
  // A country picked in the box overrides the question.
  assert.deepEqual(planCouncil('Turkey?', ALL, 'POL').countries.map((c) => c.iso3), ['POL']);
});

test('planner: agents by stated keyword rules, with the reason; all seven when no topic matches', () => {
  const p = planCouncil("Is Turkey's central bank behind the curve, and what would a Hormuz closure do?", ALL);
  assert.deepEqual(p.agents.map((a) => a.id), ['cb', 'spill']);
  assert.match(p.agents[0].why, /mentions "central bank"/);
  assert.match(p.agents[1].why, /mentions "hormuz"/i);
  // "exchange rate" is the FX agent's, not the central bank's.
  assert.deepEqual(planCouncil('Is the exchange rate weak?', ALL).agents.map((a) => a.id), ['fx']);
  const all = planCouncil('Tell me about Poland', ALL);
  assert.deepEqual(all.agents.map((a) => a.id), ['cb', 'fiscal', 'politics', 'rv', 'fx', 'spill', 'calendar', 'timing']);
  assert.match(all.agents[0].why, /every agent answers/);
});

test('agents answer only from figures on hand, each figure tagged, and say what is missing', () => {
  const q = 'Turkey: central bank, CDS, currency, Hormuz and what is next?';
  const answers = runCouncil(q, planCouncil(q, ALL), ALL, new Date('2026-11-04T12:00:00Z'));
  const by = Object.fromEntries(answers.map((a) => [a.id, a]));
  const cb = by.cb.findings[0];
  assert.match(cb.reading, /Behind the curve/);
  const tag = (label: string) => cb.figures.find((f) => f.label === label)!.tag;
  assert.equal(tag('CPI inflation'), 'live');
  assert.equal(tag('Policy rate'), 'official');
  assert.equal(tag('Real policy rate'), 'model');
  // The CDS fit against the retired composite risk score is gone.
  assert.ok(!(by.rv?.findings ?? []).some((f) => f.figures.some((x) => /risk peers|risk score/i.test(x.label))));
  assert.match(by.fx.findings[0].reading, /weak for its history: 12% below/);
  assert.deepEqual(scenariosInQuestion(q), ['hormuz']);
  assert.match(by.spill.findings[0].reading, /Strait of Hormuz closure/);
  assert.equal(by.spill.findings[0].figures.length, 1);
  assert.ok(by.calendar.findings.length + by.calendar.missing.length > 0);
  // Egypt has no inflation or policy rate figure: the central bank agent says which source is missing.
  const wide = runCouncil('inflation', planCouncil('inflation', ALL), ALL);
  assert.ok(wide[0].missing.some((m) => /Egypt.*missing inflation \(IMF did not answer\) and policy rate \(Not in BIS policy rates\)/.test(m)));
});

test('number check: a sentence survives only when its numbers trace back to an agent figure', () => {
  const q = 'Is Turkey behind the curve?';
  const answers = runCouncil(q, planCouncil(q, ALL), ALL);
  const allowed = allowedNumbers(q, answers);
  assert.ok(traces('34', allowed) && traces('34.0', allowed) && traces('-4.0'.replace('-', ''), allowed));
  assert.equal(traces('41.5', allowed), false);
  const { brief, removed } = checkBrief(
    {
      headline: 'Turkey looks behind the curve, with inflation at 34.0% and a real policy rate of -4.0%.',
      points: ['The policy rate is 30.00%, from the BIS.', 'Inflation will fall to 12% next year.', 'No number here.'],
      disagreements: [],
      gaps: [],
    },
    q,
    answers
  );
  assert.match(brief.headline, /behind the curve/);
  assert.deepEqual(brief.points, ['The policy rate is 30.00%, from the BIS.', 'No number here.']);
  assert.deepEqual(removed, ['Inflation will fall to 12% next year.']);
});

test('Reports: no saved brief says how to make one; a brief without a model says so, never invents a summary', () => {
  assert.match(councilBriefSections(null, () => true)[0].lines[0], /Ask a question in Council chat on Workspace/);
  const q = 'Is Turkey behind the curve?';
  const plan = planCouncil(q, ALL);
  const sections = councilBriefSections(
    { question: q, askedAt: '2026-11-04T22:10:00Z', scopeNote: plan.scopeNote, answers: runCouncil(q, plan, ALL), synthesis: { brief: null, removed: [], reason: 'No AI model answered.' } },
    () => true
  );
  const summary = sections.find((s) => s.heading === 'Summary')!;
  assert.match(summary.lines[0], /^No AI summary\. No AI model answered\./);
  const agents = sections.find((s) => s.heading === 'What each agent found')!;
  assert.match(agents.lines.join('\n'), /Central Bank Watcher Agent/);
  assert.match(agents.lines.join('\n'), /CPI inflation 34\.0% \(Live data\) \[1\]/);
  // Rule readings keep their method beside them; sourced figures are listed once under References.
  assert.match(agents.lines.join('\n'), /Real policy rate -4\.0% \(Central Bank Watcher Agent, policy rate minus inflation\)/);
  const refs = sections.find((s) => s.heading === 'References')!;
  assert.match(refs.lines[0], /^\[1\] IMF, live\. .*Read by the app on 2026-11-04\./);
});

test('follow-ups keep the last countries and agents unless the question names others', async () => {
  const { planFollowUp, suggestFollowUps, earlierAsText, CARRIED } = await import('../src/utils/askCouncil.ts');
  const first = planCouncil('Is Turkey behind the curve?', ALL);
  assert.deepEqual(first.countries.map((c) => c.iso3), ['TUR']);
  // A topic but no country: same country, new agent.
  const fx = planFollowUp('And the currency?', first, ALL);
  assert.deepEqual(fx.countries.map((c) => c.iso3), ['TUR']);
  assert.match(fx.scopeNote, new RegExp(CARRIED));
  assert.deepEqual(fx.agents.map((a) => a.id), ['fx']);
  // A country but no topic: new country, same agents.
  const egy = planFollowUp('What about Egypt?', first, ALL);
  assert.deepEqual(egy.countries.map((c) => c.iso3), ['EGY']);
  assert.deepEqual(egy.agents.map((a) => a.id), first.agents.map((a) => a.id));
  assert.ok(egy.agents.every((a) => a.why.includes(CARRIED)));
  // Suggestions cover agents not yet asked.
  const s = suggestFollowUps(first, runCouncil('Is Turkey behind the curve?', first, ALL));
  assert.ok(s.length > 0 && s.length <= 3);
  assert.ok(!s.includes('How does inflation compare with the policy rate?'), 'the Central Bank Watcher was already asked');
  // Earlier turns go to the model as context only.
  assert.match(earlierAsText([{ question: 'Is Turkey behind the curve?', headline: 'Policy looks tight.' }]), /context only.*\n- Q: Is Turkey behind the curve\? A: Policy looks tight\./s);
  assert.equal(earlierAsText([]), '');
});

test('the saved brief lists earlier questions of the conversation', () => {
  const q = 'And the currency?';
  const plan = planCouncil(q, ALL);
  const lines = councilBriefSections(
    { question: q, askedAt: '2026-11-05T00:30:00Z', scopeNote: 'Turkey', answers: runCouncil(q, plan, ALL), synthesis: null, earlier: [{ question: 'Is Turkey behind the curve?', headline: 'Policy looks tight.' }] },
    (id) => id === 'question'
  )[0].lines;
  assert.ok(lines.includes('- Is Turkey behind the curve? (Policy looks tight.)'));
});

test('AI-chosen agents: valid picks replace word matching, in agent order; bad picks fall back with the reason', () => {
  const base = planCouncil('Is Turkey cheap?', ALL);
  assert.deepEqual(base.agents.map((a) => a.id), ['rv']);
  const ai = applyAgentChoice(base, {
    agents: [
      { id: 'FX', why: 'the lira drives the answer.' },
      { id: 'rv', why: 'CDS against peers' },
      { id: 'rv', why: 'duplicate' },
      { id: 'astrology', why: 'not an agent' },
    ],
    provider: 'gemini',
  });
  assert.equal(ai.chosenBy, 'ai');
  assert.deepEqual(ai.agents.map((a) => a.id), ['rv', 'fx']);
  assert.equal(ai.agents[1].why, 'the AI model judged: the lira drives the answer');
  assert.match(ai.chooserNote!, /AI model \(gemini\)/);
  assert.deepEqual(ai.countries.map((c) => c.iso3), ['TUR'], 'countries untouched');

  const none = applyAgentChoice(base, { agents: null, reason: 'no AI model answered' });
  assert.equal(none.chosenBy, 'words');
  assert.deepEqual(none.agents, base.agents);
  assert.match(none.chooserNote!, /matching words in the question, as no AI model answered/);
  assert.match(applyAgentChoice(base, { agents: [{ id: 'x', why: '' }] }).chooserNote!, /named no agent on the list/);
  assert.equal(applyAgentChoice(base, null).chosenBy, 'words');
});

test('agent choice prompt lists every agent by id and the earlier questions', () => {
  const p = agentChoicePrompt('And the currency?', [{ question: 'Is Turkey cheap?' }]);
  for (const id of ['cb', 'rv', 'fx', 'spill', 'calendar']) assert.match(p, new RegExp(`- ${id}: `));
  assert.match(p, /Earlier questions[\s\S]*Is Turkey cheap\?[\s\S]*Question: And the currency\?/);
});

test('Central Bank Watcher answers with IMF reserves and current account even without a policy rate', async () => {
  const { runCouncil: run, planCouncil: plan } = await import('../src/utils/askCouncil.ts');
  const bra = {
    iso3: 'BRA',
    countryName: 'Brazil',
    imf: {
      iso3: 'BRA',
      pulledAt: '2026-11-05T03:00:00Z',
      reserves: { key: 'BRA.TRA.USD.M', period: '2025-09', usdBn: 345, change12mPct: 2.4 },
      imports4q: { usdBn: 400, through: '2025-Q2', key: 'BRA.DB.GS.USD.Q' },
      monthsOfImports: 10.3,
      currentAccount: { key: 'BRA.NETCD.CAB.USD.Q', period: '2025-Q2', usdBn: -18 },
      currentAccount4q: { usdBn: -60, through: '2025-Q2', pctGdp: -2.5, gdpYear: '2025', gdpUsdBn: 2400 },
    },
  } as never;
  const q = 'How strong are Brazil reserves and the current account?';
  const p = plan(q, [bra]);
  assert.ok(p.agents.some((a) => a.id === 'cb'));
  const cb = run(q, p, [bra]).find((a) => a.id === 'cb')!;
  const f = cb.findings[0];
  assert.match(f.reading, /Official reserves \$345\.0bn \(IMF, Sep 2025\)/);
  assert.ok(f.figures.some((x) => x.label === 'Reserves in months of imports' && x.tag === 'model'));
  assert.ok(f.figures.some((x) => x.label === 'Official reserves' && x.tag === 'official'));
  assert.match(cb.missing.join(' '), /policy rate/);
});

test('the council never uses an AI estimate or a built-in figure: the finding is left out and the gap says why', () => {
  const est = { ...TUR, policyRateSource: 'ai_estimate' } as WatchlistItem;
  const answers = runCouncil('Is Turkey behind the curve?', planCouncil('Is Turkey behind the curve?', [est, ZAF, EGY, POL]), [est, ZAF, EGY, POL]);
  const cb = answers.find((a) => a.id === 'cb')!;
  assert.equal(cb.findings.length, 0);
  assert.ok(cb.missing.some((m) => /Turkey: left out, as policy rate is not from a live feed, an official series or your own file/.test(m)));
  const { findings, missing } = keepSourcedFindings([
    { iso3: 'X', countryName: 'X', reading: 'r', weight: 1, figures: [{ label: 'A', value: '1', source: 's', tag: 'sample' }, { label: 'B', value: '2', source: 's', tag: 'estimate' }] },
    { iso3: 'Y', countryName: 'Y', reading: 'r', weight: 1, figures: [{ label: 'A', value: '1', source: 's', tag: 'official' }] },
  ]);
  assert.deepEqual(findings.map((f) => f.iso3), ['Y']);
  assert.match(missing[0], /X: left out, as a and b are not/);
});

test('a missing inflation target is a gap, not a figure tagged as sample data', () => {
  const q = 'Is South Africa behind the curve?';
  const zafNoTarget = { ...ZAF, iso3: 'ZZZ', countryName: 'Nowhere' } as WatchlistItem;
  const cb = runCouncil(q, planCouncil('Nowhere inflation', [zafNoTarget]), [zafNoTarget]).find((a) => a.id === 'cb')!;
  assert.equal(cb.findings.length, 1);
  assert.ok(!cb.findings[0].figures.some((f) => f.label === 'Inflation target'));
  assert.ok(cb.missing.some((m) => /Nowhere: inflation target not on file/.test(m)));
  const sections = councilBriefSections({ question: q, askedAt: '2026-11-05T04:00:00Z', scopeNote: 's', answers: [cb], synthesis: null }, () => true);
  assert.ok(!/\((AI estimate|Sample data),/.test(sections.map((x) => x.lines.join(' ')).join(' ')));
});

test('a country off the watchlist is named as such, never answered for the whole watchlist', () => {
  const four = [TUR, ZAF, POL, it('BRA', 'Brazil')];
  assert.deepEqual(offWatchlistCountries('What about Egypt?', four), ['Egypt']);
  const p = planCouncil('Is Egypt behind the curve?', four);
  assert.equal(p.countries.length, 0);
  assert.deepEqual(p.offWatchlist, ['Egypt']);
  assert.deepEqual(p.offWatchlistIso3, ['EGY']);
  assert.match(p.scopeNote, /Add for this question/);
  assert.match(p.scopeNote, /Egypt is not on the watchlist, so the agents hold no figures for it/);
  const answers = runCouncil('Is Egypt behind the curve?', p, four);
  assert.ok(answers.every((a) => a.findings.length === 0));
  assert.match(answers[0].missing[0], /Egypt is not on the watchlist/);
  // Mixed: the watchlist country is answered, the other is listed.
  const mixed = planCouncil('Compare Brazil and Argentina inflation', four);
  assert.deepEqual(mixed.countries.map((c) => c.iso3), ['BRA']);
  assert.match(mixed.scopeNote, /Brazil, named in the question\. Argentina is not on the watchlist/);
  // Longer names win; ISO-like words in capitals are not countries.
  assert.deepEqual(offWatchlistCountries('Papua New Guinea debt', four), ['Papua New Guinea']);
  assert.deepEqual(offWatchlistCountries('ARE RATES TOO HIGH?', four), []);
  // A follow-up naming an off-list country does not carry the last countries over.
  const f = planFollowUp('and Egypt?', planCouncil('Is Turkey behind the curve?', four), four);
  assert.equal(f.countries.length, 0);
});

test('"us" and "sa" in a sentence do not name the United States or South Africa; capitals do', () => {
  const usa = it('USA', 'United States');
  const list = [usa, ZAF, TUR];
  assert.deepEqual(countriesInQuestion('Can you tell us which central banks are tight?', list), []);
  assert.deepEqual(countriesInQuestion('Is the US behind the curve?', list).map((c) => c.iso3), ['USA']);
  assert.deepEqual(countriesInQuestion('UK and SA policy', [it('GBR', 'United Kingdom'), ZAF]).map((c) => c.iso3), ['GBR', 'ZAF']);
  assert.deepEqual(countriesInQuestion('turkey and the lira', list).map((c) => c.iso3), ['TUR']);
});

test('Relative Value Agent: no cheap or rich call against a risk score (the score is retired)', () => {
  const noCds = (iso3: string, y: number, cpi: number) =>
    ({ iso3, countryName: iso3, yield10YPct: y, yield10YSource: 'official', yield10YPeriod: '2026-09', cpiInflationPct: cpi, cpiSource: 'live' }) as unknown as WatchlistItem;
  const all = [noCds('AAA', 6, 4), noCds('BBB', 8, 5), noCds('CCC', 7, 3), noCds('DDD', 9, 4), noCds('EEE', 10, 3)];
  const plan = planCouncil('Which bonds look cheap for their risk?', all);
  const rv = runCouncil('Which bonds look cheap for their risk?', plan, all).find((a) => a.id === 'rv')!;
  for (const f of rv.findings) assert.ok(!f.figures.some((x) => /risk score|risk peers/i.test(x.label)));
  assert.ok(!rv.missing.some((m) => /CDS/.test(m)));
});

test('synthesis task: asks for an interpreted answer and ends with the question', async () => {
  const { synthesisTask, SYNTHESIS_INSTRUCTION } = await import('../src/utils/askCouncil.ts');
  const t = synthesisTask('Is Brazil policy tight?');
  assert.match(t, /headline: one sentence that directly answers/);
  assert.match(t, /interprets the evidence/);
  assert.ok(t.trim().endsWith('Question to answer: Is Brazil policy tight?'));
  assert.match(SYNTHESIS_INSTRUCTION, /interpret, not to list/);
  assert.match(SYNTHESIS_INSTRUCTION, /do not calculate new numbers/);
});

test('whole-list note counts benchmark markets apart from the watchlist', async () => {
  const { wholeListNote } = await import('../src/utils/askCouncil.ts');
  assert.equal(wholeListNote([{}, {}, {}, {}, {}, { isBenchmark: true }]), 'the whole watchlist (5 countries) and 1 benchmark market');
  assert.equal(wholeListNote([{}, {}]), 'the whole watchlist (2 countries)');
});
