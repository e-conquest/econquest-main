/**
 * Country risk scorecard (utils/countryRiskScorecard.ts): synthetic series check the arithmetic and
 * the missing reasons; no country's real figures.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countryRiskScorecard, latestOutturn, scorecardSentence, WGI_IDS } from '../src/utils/countryRiskScorecard.ts';
import type { Series } from '../src/utils/seriesHistory.ts';
import type { UcdpReading } from '../src/utils/ucdpConflict.ts';

const ser = (id: string, label: string, vals: Array<[number, number, string?]>): Series => ({
  id, label, unit: 'u', freq: 'annual', source: 'World Bank WGI (XX.EST)', points: vals.map(([y, v, note]) => ({ date: String(y), value: v, ...(note ? { note } : {}) })),
} as Series);

test('latest outturn skips IMF projections and finds the year five before', () => {
  const o = latestOutturn(ser('d', 'Debt', [[2019, 50], [2023, 60], [2024, 62], [2025, 70, 'IMF projection']]).points)!;
  assert.equal(o.last.date, '2024');
  assert.equal(o.prior?.date, '2019');
  assert.equal(latestOutturn([]), null);
});

test('governance rows read against the world average; missing figures say why', () => {
  const official: Record<string, any> = {
    wgi_voice: ser('wgi_voice', 'Voice and accountability', [[2018, 0.1], [2023, -1.2]]),
    wgi_stability: ser('wgi_stability', 'Political stability and absence of violence', [[2023, 0.1]]),
    wgi_corruption: { id: 'wgi_corruption', label: 'Control of corruption', reason: 'World Bank WGI publishes no figures for this country' },
  };
  const sc = countryRiskScorecard({ official });
  const gov = sc.pillars.find((p) => p.id === 'governance')!;
  assert.equal(gov.rows.length, 2);
  assert.deepEqual(gov.rows[0], { label: 'Voice and accountability', value: -1.2, unit: 'estimate', when: '2023', change5y: -1.3, context: 'well below the world average' });
  assert.equal(gov.rows[1].context, 'near the world average');
  assert.equal(gov.rows[1].change5y, undefined);
  assert.equal(gov.source, 'World Bank WGI');
  assert.ok(gov.missing.some((m) => m.startsWith('Control of corruption: World Bank WGI publishes no figures')));
  assert.equal(gov.missing.length, WGI_IDS.length - 2);
});

test('no inputs: every pillar is empty with a reason, and nothing is made up', () => {
  const sc = countryRiskScorecard({ official: {}, officialMissingReason: 'not downloaded', conflictMissing: 'UCDP files not added', spikesMissing: 'not pulled' });
  assert.equal(sc.filled, 0);
  assert.ok(sc.pillars.every((p) => p.rows.length === 0 && p.missing.length > 0));
  assert.equal(scorecardSentence('Nowhere', sc), 'Nowhere: no scorecard figures on file yet.');
});

test('conflict and unrest pillars, and the sentence', () => {
  const conflict: UcdpReading = {
    iso3: 'XXX', versions: { acd: 't' }, missingDatasets: ['brd', 'nonstate', 'onesided', 'dyadic'],
    latest: { year: 2025, conflicts: { n: 2, wars: 1, types: {}, opponents: [] } },
    prior: [{ year: 2024, conflicts: { n: 1, wars: 0, types: {}, opponents: [] } }, { year: 2023, conflicts: { n: 0, wars: 0, types: {}, opponents: [] } }, { year: 2022, conflicts: { n: 0, wars: 0, types: {}, opponents: [] } }],
  };
  const spikes = [
    { month: '2026-09', protestPct: 4, violencePct: 2, protestZ: 0.5, violenceZ: 0.1, spikes: [], episodes: [] },
    { month: '2026-10', protestPct: 9, violencePct: 2, protestZ: 4.1, violenceZ: 0.3, spikes: ['protests' as const], episodes: ['protests' as const] },
  ];
  const sc = countryRiskScorecard({ official: { wgi_rule_of_law: ser('wgi_rule_of_law', 'Rule of law', [[2023, -0.6]]) }, conflict, spikes });
  const con = sc.pillars.find((p) => p.id === 'conflict')!;
  assert.equal(con.rows.length, 1);
  assert.match(con.rows[0].context!, /1 at war level.*conflict in 2 of the last 4 coded years/);
  assert.equal(con.missing.length, 3);
  const un = sc.pillars.find((p) => p.id === 'unrest')!;
  assert.match(un.rows[0].context!, /\(spike\)/);
  assert.equal(un.rows[2].value, 1);
  assert.equal(
    scorecardSentence('Nowhere', sc),
    'Nowhere: weakest governance estimate is rule of law at -0.6 (2023, below the world average); 2 armed conflicts located in the country in 2025; 2026-10 is a spike in protests.',
  );
});
