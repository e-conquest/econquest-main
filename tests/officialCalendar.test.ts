import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OFFICIAL_CALENDAR, daysUntil, upcomingOfficialEvents, nextOfficialEvent } from '../src/data/officialCalendar.ts';

test('every calendar entry is a real date with a source', () => {
  for (const e of OFFICIAL_CALENDAR) {
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, `${e.iso3} ${e.title}`);
    const d = new Date(`${e.date}T00:00:00Z`);
    assert.equal(d.toISOString().slice(0, 10), e.date, `${e.date} is not a calendar date`);
    assert.match(e.sourceUrl, /^https:\/\//, `${e.iso3} ${e.date} has no https source`);
    assert.ok(e.sourceName.trim(), `${e.iso3} ${e.date} has no source name`);
  }
});

test('no duplicate entries', () => {
  const keys = OFFICIAL_CALENDAR.map((e) => `${e.iso3}|${e.category}|${e.date}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('daysUntil and the upcoming window', () => {
  const now = new Date(2026, 10, 4);
  assert.equal(daysUntil('2026-11-04', now), 0);
  assert.equal(daysUntil('2026-11-11', now), 7);
  const list = upcomingOfficialEvents(['BRA', 'MEX'], 60, now);
  assert.ok(list.every((e) => e.daysUntil >= 0 && e.daysUntil <= 60));
  assert.deepEqual(list.map((e) => e.daysUntil), [...list.map((e) => e.daysUntil)].sort((a, b) => a - b));
  const next = nextOfficialEvent('BRA', 'MPC_DECISION', now);
  if (next) assert.ok(next.daysUntil >= 0);
});
