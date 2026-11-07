import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALFRED_SERIES, alfredReply, alfredUrl, figureOn, parseAlfred, releasesOf } from '../src/utils/alfredVintages.ts';

const GDP = ALFRED_SERIES.find((d) => d.id === 'GDPC1')!;
const CPI = ALFRED_SERIES.find((d) => d.id === 'CPIAUCSL')!;
const UN = ALFRED_SERIES.find((d) => d.id === 'UNRATE')!;

// Shaped like the FRED API real-time reply (output_type 1: realtime_start, realtime_end, date,
// value as strings); values made up. 2020 Q1 was revised once, and a base-year change on
// 2021-07-29 moved both quarters' levels.
const reply = {
  observations: [
    { realtime_start: '2020-04-29', realtime_end: '2021-07-28', date: '2020-01-01', value: '100.0' },
    { realtime_start: '2021-07-29', realtime_end: '9999-12-31', date: '2020-01-01', value: '200.0' },
    { realtime_start: '2020-07-30', realtime_end: '2020-08-26', date: '2020-04-01', value: '90.0' },
    { realtime_start: '2020-08-27', realtime_end: '2021-07-28', date: '2020-04-01', value: '91.0' },
    { realtime_start: '2021-07-29', realtime_end: '9999-12-31', date: '2020-04-01', value: '182.0' },
    { realtime_start: '2021-07-29', realtime_end: '9999-12-31', date: '2020-07-01', value: '.' },
  ],
};

test('real-time rows parse; "." skipped; URL asks for every vintage', () => {
  const rows = parseAlfred(reply);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], { date: '2020-01-01', value: 100, from: '2020-04-29', to: '2021-07-28' });
  const u = alfredUrl('GDPC1', 'k', '1999-01-01');
  assert.match(u, /realtime_start=1776-07-04/);
  assert.match(u, /realtime_end=9999-12-31/);
  assert.deepEqual(parseAlfred({ error_message: 'Bad Request' }), []);
});

test('growth is computed inside one vintage, so a base-year change is not a revision', () => {
  const rows = parseAlfred(reply);
  // First release: 90 vs 100 -> (0.9^4 - 1) x 100.
  assert.equal(figureOn(GDP, rows, '2020-04-01', '2020-07-30'), -34.39);
  assert.equal(figureOn(GDP, rows, '2020-04-01', '2020-07-01'), undefined, 'not yet published');
  const rel = releasesOf(GDP, rows, '2020-04-01');
  assert.deepEqual(rel.map((r) => r.day), ['2020-07-30', '2020-08-27']);
  // The 2021-07-29 rebasing (182 vs 200) gives the same 91/100 growth: no new release listed.
  assert.equal(rel[1].value, figureOn(GDP, rows, '2020-04-01', '2022-01-01'));
});

test('levels (unemployment) and y/y (CPI, needs the month a year back in the same release)', () => {
  const un = parseAlfred({ observations: [{ realtime_start: '2020-05-08', realtime_end: '2020-06-04', date: '2020-04-01', value: '14.7' }, { realtime_start: '2020-06-05', realtime_end: '9999-12-31', date: '2020-04-01', value: '14.8' }] });
  assert.deepEqual(releasesOf(UN, un, '2020-04-01'), [{ day: '2020-05-08', value: 14.7 }, { day: '2020-06-05', value: 14.8 }]);
  const cpi = parseAlfred({ observations: [{ realtime_start: '2019-05-10', realtime_end: '9999-12-31', date: '2019-04-01', value: '255' }, { realtime_start: '2020-05-12', realtime_end: '9999-12-31', date: '2020-04-01', value: '256.02' }] });
  assert.equal(figureOn(CPI, cpi, '2020-04-01', '2020-06-01'), 0.4);
});

test('the panel reply: latest period by default, a sentence, an as-of read, Missing with no data', () => {
  const rows = parseAlfred(reply);
  const r = alfredReply(GDP, { id: 'GDPC1', rows }, undefined, '2020-08-01');
  assert.equal(r.ok, true);
  assert.equal(r.period, '2020-04-01');
  assert.equal(r.periodLabel, '2020 Q2');
  assert.match(r.sentence!, /first published on 2020-07-30 at -34\.39/);
  assert.deepEqual(r.asOf, { day: '2020-08-01', value: -34.39 });
  assert.equal(alfredReply(GDP, null).ok, false);
});
