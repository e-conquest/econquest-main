import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARKET_EDGE_ANCHORS, MARKET_EDGE_ANCHOR_ISO3, benchmarkRows, buildAnchor, marketEdgePeers } from '../src/utils/marketEdgeAnchors.ts';
import type { WatchlistItem } from '../src/types/council.ts';

const obs = (v: number, id = 'X') => ({ valuePct: v, period: '2026-09', source: 'OECD via FRED', seriesId: id, url: 'u' });
const def = (iso: string) => MARKET_EDGE_ANCHORS.find((a) => a.iso3 === iso)!;

test('always shown: US, China, Russia, UK, EU and India', () => {
  assert.deepEqual(MARKET_EDGE_ANCHOR_ISO3, ['USA', 'CHN', 'RUS', 'GBR', 'EUU', 'IND']);
  assert.equal(def('EUU').fredSeries, 'IRLTLT01DEM156N'); // Bund, not the euro-area series that stopped in Jan 2026
  assert.equal(def('IND').fredSeries, 'INDIRLTLT01STM');
  assert.equal(def('RUS').fredSeries, undefined);
  assert.equal(def('CHN').fredSeries, undefined);
});

test('a missing source is said, never filled in', () => {
  const rus = buildAnchor(def('RUS'), null, { iso3: 'RUS', bps: 999, date: '2026-11-03', source: 'Bloomberg' });
  assert.equal(rus.yield, undefined);
  assert.match(rus.noYieldReason!, /2018/);
  assert.equal(rus.cds, undefined); // no CDS market, even if a file has a row
  assert.match(rus.noCdsReason!, /2022/);
  assert.match(buildAnchor(def('EUU'), null).noYieldReason!, /FRED did not answer/);
});

test('benchmark rows: spread over the US, US row is the benchmark, peers not repeated', () => {
  const anchors = [
    buildAnchor(def('USA'), obs(4.1)),
    buildAnchor(def('EUU'), obs(2.65)),
    buildAnchor(def('IND'), obs(7.06), { iso3: 'IND', bps: 88, date: '2026-11-03', source: 'LSEG' }),
    buildAnchor(def('GBR'), obs(4.5)),
    buildAnchor(def('CHN'), null),
  ];
  const rows = benchmarkRows(anchors, ['GBR'], 4.1);
  assert.deepEqual(rows.map((r) => r.iso3), ['USA', 'EUU', 'IND', 'CHN']);
  const by = Object.fromEntries(rows.map((r) => [r.iso3, r]));
  assert.equal(by.USA.spreadBps, undefined);
  assert.equal(by.EUU.spreadBps, -145);
  assert.match(by.EUU.yieldNote, /German Bund 10Y, official, Sep 2026 avg/);
  assert.equal(by.IND.cdsBps, 88);
  assert.match(by.IND.cdsNote, /Your LSEG, 3 Nov 2026/);
  assert.match(by.EUU.cdsNote, /No CDS feed/);
  assert.equal(by.CHN.yieldPct, undefined);
});

test('the UK joins the peer list once', () => {
  const w = (iso3: string) => ({ iso3 }) as WatchlistItem;
  assert.deepEqual(marketEdgePeers([w('BRA'), w('GBR')], [w('GBR')]).map((x) => x.iso3), ['BRA', 'GBR']);
  assert.deepEqual(marketEdgePeers([w('BRA')], [w('GBR')]).map((x) => x.iso3), ['BRA', 'GBR']);
});
