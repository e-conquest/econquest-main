import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_REPORTS, visibleReport } from '../src/utils/simpleMode.ts';
import { COUNTRY_TABS } from '../src/components/CountryPage.tsx';
import { DEFAULT_REPORT, NAV, NAV_LABEL } from '../src/data/navigation.ts';

test('Country page: the four Research sections only (the old desk tabs are gone)', () => {
  assert.deepEqual(COUNTRY_TABS.map((t) => t.id).sort(), ['brief', 'history', 'macro', 'overview']);
});

test('the default report template is shown; old templates open the nearest one', () => {
  assert.ok(CORE_REPORTS.includes(visibleReport(DEFAULT_REPORT)));
  assert.equal(visibleReport('ic'), 'book');
  assert.equal(visibleReport('client'), 'client_review');
});

test('no roles: Workspace leads the navigation, labels as Sam set them (2026-11-04)', () => {
  assert.equal(NAV[0], 'today');
  assert.equal(NAV_LABEL.today, 'Workspace');
  assert.equal(NAV_LABEL.research, 'Research');
  // Country Research, Compare and Portfolio are one Research page (Sam, 2026-11-05).
  assert.deepEqual(NAV.slice(0, 3), ['today', 'research', 'reports']);
});
