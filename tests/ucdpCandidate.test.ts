/**
 * UCDP Candidate Events (D8): monthly preliminary event files, kept apart from the yearly totals.
 * The yearly rows are the real 26.1 fixtures; the candidate rows below follow the codebook v1.5
 * columns (a subset, in its order) with made-up events.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addUcdpCsv, candidateVersion, emptyUcdpData, isCandidateHeader, latestUcdpYear, ucdpFigures, ucdpInputLine, ucdpMissing, ucdpReading } from '../src/utils/ucdpConflict.ts';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ucdp');
const HEAD = 'id,relid,year,active_year,code_status,type_of_violence,conflict_new_id,side_a,side_b,country,country_id,date_start,date_end,best,high,low';
const AUG = `${HEAD}
9001,UKR-1,2026,1,Clear,1,13243,"Government of Russia (Soviet Union)",Government of Ukraine,Ukraine,369,2026-08-03 00:00:00.000,2026-08-03 00:00:00.000,40,55,30
9002,UKR-2,2026,1,Check Deaths,3,0,"Government of Russia (Soviet Union)",Civilians,Ukraine,369,2026-08-30,2026-09-01,5,9,5
9003,SYR-1,2026,1,Clear,2,0,A,B,Syria,652,2026-08-10,2026-08-10,7,7,7`;
// The September file repeats event 9002 (it ends in September) with revised deaths.
const SEP = `${HEAD}
9002,UKR-2,2026,1,Clear,3,0,"Government of Russia (Soviet Union)",Civilians,Ukraine,369,2026-08-30,2026-09-01,6,9,5
9004,UKR-3,2026,1,Clear,1,13243,"Government of Russia (Soviet Union)",Government of Ukraine,Ukraine,369,2026-09-12,2026-09-12,100,120,90
9005,OLD-1,2025,1,Clear,1,13243,x,y,Ukraine,369,2025-12-31,2025-12-31,999,999,999`;

function yearly() {
  const data = emptyUcdpData();
  for (const f of readdirSync(fixtures).filter((x) => x.endsWith('.csv'))) addUcdpCsv(data, f, readFileSync(path.join(fixtures, f), 'utf8'));
  return data;
}

test('candidate files: read by columns, counted once by id, months after the yearly release only', () => {
  assert.ok(isCandidateHeader(HEAD.split(',')));
  assert.equal(candidateVersion('GEDEvent_v26_0_9.csv'), '26.0.9');
  assert.equal(candidateVersion('GEDEvent_v26_01_26_09.csv'), '26.01.26.09');
  const data = yearly();
  const lastYear = latestUcdpYear(data);
  assert.equal(lastYear, 2025);
  const before = ucdpReading(data, 'UKR')!;
  assert.equal(addUcdpCsv(data, 'GEDEvent_v26_0_8.csv', AUG), 'candidate');
  assert.equal(addUcdpCsv(data, 'GEDEvent_v26_0_9.csv', SEP), 'candidate');
  // Candidate rows never change the yearly figures or the latest year.
  assert.equal(latestUcdpYear(data), 2025);
  const r = ucdpReading(data, 'UKR')!;
  assert.deepEqual(r.latest, before.latest);
  const c = r.candidate!;
  assert.deepEqual(c.versions, ['26.0.8', '26.0.9']);
  assert.equal(c.from, '2026-08');
  assert.equal(c.to, '2026-09');
  const [aug, sep] = c.months;
  // Event 9002 counted once, in August (its start), with the September file's revision (6, now Clear).
  assert.deepEqual(aug, { month: '2026-08', stateBased: 40, nonState: 0, oneSided: 6, total: 46, low: 35, high: 64, events: 2, flagged: 0 });
  assert.equal(sep.total, 100);
  // The 2025 event is in the yearly release's year: not shown as preliminary.
  assert.ok(!c.months.some((m) => m.month < '2026-01'));
  const f = ucdpFigures(r);
  assert.ok(f.figures.some((x) => /since the yearly release, 2026-08 to 2026-09 \(preliminary\)/.test(x.label) && /^146 /.test(x.value)));
  assert.match(ucdpInputLine(r, ucdpMissing(data, 'UKR')), /preliminary 2026-08 to 2026-09: 146 deaths \(UCDP Candidate 26\.0\.8, 26\.0\.9\)/);
  // A country with no candidate event that period reads zeros, not a gap.
  const nor = ucdpReading(data, 'NOR')!;
  assert.ok(nor.candidate && nor.candidate.months.every((m) => m.total === 0));
});

test('without candidate files the reading and council line are unchanged', () => {
  const data = yearly();
  const r = ucdpReading(data, 'UKR')!;
  assert.equal(r.candidate, undefined);
  assert.doesNotMatch(ucdpInputLine(r, ucdpMissing(data, 'UKR')), /preliminary/);
});
