import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOVEREIGN_CATALOG } from '../src/data/presetsAndBaselines.ts';
import { toLive } from '../src/utils/liveFigures.ts';
import {
  RESEARCH_SECTIONS,
  countryTabForSection,
  sectionForAnchor,
  sectionForCountryTab,
  sourcesGrid,
} from '../src/utils/researchSections.ts';

test('Research: the same four sections on every scope (Sam, 2026-11-05)', () => {
  assert.deepEqual(
    RESEARCH_SECTIONS.map((s) => s.label),
    ['Summary', 'Markets & signals', 'History & data', 'Sources']
  );
});

test('one country keeps its old tab ids (brief, macro, history, overview) so old links land', () => {
  assert.deepEqual(RESEARCH_SECTIONS.map((s) => countryTabForSection(s.id)), ['brief', 'macro', 'history', 'overview']);
  for (const s of RESEARCH_SECTIONS) assert.equal(sectionForCountryTab(countryTabForSection(s.id)), s.id);
  // A specialist desk tab is not a section.
  assert.equal(sectionForCountryTab('debt'), undefined);
});

test('Tools links land on the right section', () => {
  assert.equal(sectionForAnchor('tool-marketedge'), 'markets');
  assert.equal(sectionForAnchor('tool-panel'), 'history');
  assert.equal(sectionForAnchor('tool-holdings-signals'), 'markets');
  assert.equal(sectionForAnchor(undefined), 'summary');
});

test('sources grid: with no feed answering, every figure reads Missing with a reason, never a number', () => {
  const rows = sourcesGrid(SOVEREIGN_CATALOG.slice(0, 3).map(toLive));
  assert.equal(rows.length, 3);
  for (const r of rows) {
    assert.equal(r.liveCount, 0);
    for (const c of r.cells) {
      assert.equal(c.live, false);
      assert.ok(c.short.length > 0, `${r.iso3} ${c.key} has a reason`);
    }
  }
  // CDS is hidden for now (src/utils/cdsHidden.ts): no CDS cell at all.
  assert.equal(rows[0].cells.find((c) => c.key === 'cds'), undefined);
});

test('sources grid: a figure from a live feed reads Live', () => {
  const bra = { ...SOVEREIGN_CATALOG.find((c) => c.iso3 === 'BRA')!, debtToGdpPct: 86.4, debtSource: 'live' as const };
  const row = sourcesGrid([toLive(bra)])[0];
  assert.equal(row.cells.find((c) => c.key === 'debt')!.live, true);
  assert.equal(row.liveCount, 1);
});
