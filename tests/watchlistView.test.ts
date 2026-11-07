import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLUMN_BY_ID,
  DEFAULT_COLUMNS,
  VISIBLE_COLUMNS,
  addToList,
  cleanView,
  moveColumn,
  removeFromList,
  sortBy,
  sortRows,
  toggleColumn,
  yieldChangeBp,
  cellMissing,
} from '../src/utils/watchlistView.ts';
import { toLive } from '../src/utils/liveFigures.ts';
import type { WatchlistGroup, WatchlistItem } from '../src/types/council.ts';

const it = (iso3: string, countryName: string, o: Partial<WatchlistItem> = {}): WatchlistItem =>
  ({ iso3, countryName, currencyCode: 'X', cds5YBps: 150, yield10YPct: 8, debtToGdpPct: 60, fxReservesMonths: 5, ...o }) as WatchlistItem;
const TUR = it('TUR', 'Turkey', { cds5YBps: 300, cpiInflationPct: 34, cpiSource: 'live' });
const POL = it('POL', 'Poland', { cds5YBps: 70 });
const ZAF = it('ZAF', 'South Africa', { cds5YBps: 250, cpiInflationPct: 3.4 });

test('default view: country, A to Z (the composite risk column is retired)', () => {
  const v = cleanView(null);
  assert.deepEqual(v.columns, DEFAULT_COLUMNS);
  assert.ok(!(DEFAULT_COLUMNS as string[]).includes('risk'));
  assert.deepEqual(sortRows([POL, TUR, ZAF], v).map((r) => r.iso3), ['POL', 'ZAF', 'TUR']);
});

test('saved choices are cleaned: unknown or repeated columns dropped, empty falls back to defaults', () => {
  assert.deepEqual(cleanView({ columns: ['cpi', 'bogus', 'cpi', 'debt'] }).columns, ['cpi', 'debt']);
  // CDS is hidden for now (src/utils/cdsHidden.ts): saved CDS columns are dropped, never shown.
  assert.deepEqual(cleanView({ columns: ['cds', 'cdsChange', 'cpi'], sort: { key: 'cds', dir: 'asc' } }).columns, ['cpi']);
  assert.equal(cleanView({ sort: { key: 'cds', dir: 'asc' } }).sort.key, 'country');
  // The retired composite risk column is dropped from saved views.
  const old = cleanView({ columns: ['risk', 'cpi'], sort: { key: 'risk', dir: 'desc' } });
  assert.deepEqual([old.columns, old.sort.key], [['cpi'], 'country']);
  assert.ok(!DEFAULT_COLUMNS.includes('cds') && !VISIBLE_COLUMNS.some((c) => c.id === 'cds' || c.id === 'cdsChange'));
  assert.deepEqual(cleanView({ columns: [] }).columns, DEFAULT_COLUMNS);
  assert.deepEqual(cleanView({ sort: { key: 'nope', dir: 'sideways' } }).sort, { key: 'country', dir: 'asc' });
  assert.equal(cleanView({ watchlistId: 'wl-1' }).watchlistId, 'wl-1');
});

test('columns toggle and move; the last column cannot be turned off', () => {
  let v = cleanView({ columns: ['debt'] });
  assert.deepEqual(toggleColumn(v, 'debt').columns, ['debt']);
  v = toggleColumn(v, 'cpi');
  assert.deepEqual(v.columns, ['debt', 'cpi']);
  assert.deepEqual(moveColumn(v, 'cpi', -1).columns, ['cpi', 'debt']);
  assert.deepEqual(moveColumn(v, 'cpi', 1).columns, ['debt', 'cpi']); // already last
});

test('sorting: a header flips direction; text starts A to Z; rows with no figure go last', () => {
  let v = sortBy(cleanView(null), 'cpi');
  v = sortBy(v, 'country');
  assert.deepEqual(sortRows([TUR, POL, ZAF], v).map((r) => r.iso3), ['POL', 'ZAF', 'TUR']);
  v = sortBy(v, 'country');
  assert.equal(v.sort.dir, 'desc');
  v = sortBy(v, 'cpi');
  assert.deepEqual(sortRows([POL, ZAF, TUR], v).map((r) => r.iso3), ['TUR', 'ZAF', 'POL']);
  v = sortBy(v, 'cpi');
  assert.deepEqual(sortRows([POL, ZAF, TUR], v).map((r) => r.iso3), ['ZAF', 'TUR', 'POL']);
});

test('figures keep their source labels; a missing figure shows a dash and why, never a number', () => {
  assert.equal(COLUMN_BY_ID.cpi.note!(TUR), 'Live, IMF');
  const zaf = toLive(ZAF); // inflation with no live source: dropped
  assert.equal(zaf.cpiInflationPct, undefined);
  assert.equal(COLUMN_BY_ID.cpi.text(zaf), '–');
  assert.equal(cellMissing(COLUMN_BY_ID.cpi, zaf)?.short, 'IMF did not answer');
  assert.equal(cellMissing(COLUMN_BY_ID.cds, zaf)?.kind, 'setup');
  assert.equal(cellMissing(COLUMN_BY_ID.cpi, TUR), undefined);
  assert.equal(COLUMN_BY_ID.policy.note!(it('A', 'A', { policyRatePct: 5, policyRateSource: 'ai_estimate' })), undefined);
  assert.equal(COLUMN_BY_ID.policy.note!(it('A', 'A', { policyRatePct: 6.5, policyRateSource: 'bis', policyRateDate: '2026-10-27' })), 'BIS, 2026-10-27');
  assert.equal(COLUMN_BY_ID.policy.note!(it('A', 'A', { policyRatePct: 37, policyRateSource: 'bis', policyRateDate: '2026-09', policyRateStale: true })), 'BIS, 2026-09, may be out of date');
  assert.equal(COLUMN_BY_ID.data.text(POL), 'No live feed');
});

test('yield change only between figures of the same kind of source', () => {
  const now = it('TUR', 'Turkey', { yield10YPct: 28.5, yield10YSource: 'official' });
  assert.equal(yieldChangeBp(now, { TUR: { cds5YBps: 300, yield10YPct: 28, yieldSource: 'official' } }), 50);
  assert.equal(yieldChangeBp(now, { TUR: { cds5YBps: 300, yield10YPct: 28 } }), undefined);
  assert.equal(COLUMN_BY_ID.cdsChange.text(TUR, { TUR: { cds5YBps: 280, yield10YPct: 28 } }), '+20');
  // A CDS change only between figures of the same kind of source.
  const own = it('TUR', 'Turkey', { cds5YBps: 300, cds5YSource: 'own' });
  assert.equal(COLUMN_BY_ID.cdsChange.text(own, { TUR: { cds5YBps: 280, cdsSource: 'ai_estimate' } }), '–');
});

test('pop-out add and remove change only the chosen list, without duplicates', () => {
  const groups: WatchlistGroup[] = [
    { id: 'a', name: 'A', description: '', items: [TUR] },
    { id: 'b', name: 'B', description: '', items: [TUR] },
  ];
  const added = addToList(groups, 'a', POL);
  assert.deepEqual(added.map((g) => g.items.map((i) => i.iso3)), [['TUR', 'POL'], ['TUR']]);
  assert.deepEqual(addToList(added, 'a', POL)[0].items.length, 2);
  assert.deepEqual(removeFromList(added, 'a', 'TUR').map((g) => g.items.map((i) => i.iso3)), [['POL'], ['TUR']]);
});
