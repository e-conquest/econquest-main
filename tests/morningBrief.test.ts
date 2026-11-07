import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, isDue, localClock, morningQuestion, nextRunText, parseMorningFile, settingsProblem, type MorningBriefFile } from '../src/utils/morningBrief.ts';

const on = (over: Partial<MorningBriefFile> = {}): MorningBriefFile => ({ settings: { ...DEFAULT_SETTINGS, enabled: true, time: '07:00', timeZone: 'Europe/London' }, ...over });

test('local clock reads the time in the saved zone, not the server clock', () => {
  const t = new Date('2026-11-05T06:30:00Z');
  assert.deepEqual(localClock(t, 'Europe/London'), { day: '2026-11-05', time: '06:30' });
  assert.deepEqual(localClock(t, 'America/Sao_Paulo'), { day: '2026-11-05', time: '03:30' });
  assert.deepEqual(localClock(t, 'Asia/Tokyo'), { day: '2026-11-05', time: '15:30' });
});

test('due once a day, from the set time on, never twice the same day', () => {
  assert.equal(isDue(on(), new Date('2026-11-05T06:59:00Z')), false, 'before 07:00 London');
  assert.equal(isDue(on(), new Date('2026-11-05T07:00:00Z')), true);
  assert.equal(isDue(on(), new Date('2026-11-05T15:00:00Z')), true, 'missed while closed: runs when the app starts that day');
  assert.equal(isDue(on({ lastScheduledDay: '2026-11-05' }), new Date('2026-11-05T15:00:00Z')), false);
  assert.equal(isDue(on({ lastScheduledDay: '2026-11-04' }), new Date('2026-11-05T07:01:00Z')), true);
  assert.equal(isDue({ settings: { ...on().settings, enabled: false } }, new Date('2026-11-05T08:00:00Z')), false, 'off');
  assert.equal(isDue({ settings: { ...on().settings, questions: [] } }, new Date('2026-11-05T08:00:00Z')), false, 'no questions');
});

test('next run is said plainly', () => {
  assert.equal(nextRunText({ settings: DEFAULT_SETTINGS }, new Date()), 'Off');
  assert.equal(nextRunText(on(), new Date('2026-11-05T06:00:00Z')), 'Today at 07:00 (Europe/London)');
  assert.equal(nextRunText(on({ lastScheduledDay: '2026-11-05' }), new Date('2026-11-05T09:00:00Z')), 'Tomorrow at 07:00 (Europe/London)');
});

test('settings are checked before saving', () => {
  const good = { enabled: true, time: '06:45', timeZone: 'Europe/London', questions: ['Is Brazil tight?'] };
  assert.equal(settingsProblem(good), null);
  assert.match(settingsProblem({ ...good, time: '6:45' }) || '', /HH:MM/);
  assert.match(settingsProblem({ ...good, timeZone: 'Mars/Olympus' }) || '', /time zone/);
  assert.match(settingsProblem({ ...good, questions: [] }) || '', /at least one/);
  assert.equal(settingsProblem({ ...good, enabled: false, questions: [] }), null, 'off may have no questions');
  assert.match(settingsProblem({ ...good, questions: ['a', 'b', 'c', 'd', 'e'] }) || '', /At most/);
});

test('a broken file reads as the defaults, switched off', () => {
  assert.deepEqual(parseMorningFile(null), { settings: DEFAULT_SETTINGS });
  assert.deepEqual(parseMorningFile({ settings: { enabled: 'yes' } }), { settings: DEFAULT_SETTINGS });
  assert.equal(parseMorningFile({ settings: on().settings, lastScheduledDay: '2026-11-05' }).lastScheduledDay, '2026-11-05');
  assert.equal(morningQuestion('Q?'), 'Morning brief: Q?');
});
