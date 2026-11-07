import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BCRP_EMBIG_SERIES, bcrpEmbigUrl, describeHcSpread, hcSpreadMissing, parseBcrpEmbig, parseBcrpMonth } from '../src/utils/hardCurrencySpread.ts';
import { countrySeries } from '../src/utils/seriesHistory.ts';

const NAMES = ['Perú', 'Argentina', 'Brasil', 'Chile', 'Colombia', 'Ecuador', 'México', 'Venezuela'].map(
  (c) => ({ name: `Diferencial de Rendimientos del Índice de Bonos de Mercados Emergentes (EMBIG) - ${c}`, dec: '0' }),
);
const SERIES = [...NAMES, { name: 'Latin EMBIG Países Latinoamericanos', dec: '0' }, { name: 'EMBIG Países Emergentes', dec: '0' }];
const row = (name: string, vals: Array<number | string>) => ({ name, values: vals.map(String) });
// Columns: PER ARG BRA CHL COL ECU MEX VEN LATAM EM
const reply = {
  config: { title: 'Indicadores de riesgo para países emergentes: EMBIG', series: SERIES },
  periods: [
    row('Sep.2025', [150, 900, 210, 120, 300, 1500, 320, 'n.d.', 400, 330]),
    row('Jun.2026', [140, 700, 195, 110, 280, 1200, 300, 'n.d.', 380, 310]),
    row('Aug.2026', [135, 650, 190, 105, 270, 1100, 295, 'n.d.', 370, 300]),
    row('Sep.2026', [130, 600, 185, 100, 260, 1000, 290, 'n.d.', 360, 295]),
    row('Oct.2026', ['n.d.', 'n.d.', 'n.d.', 'n.d.', 'n.d.', 'n.d.', 'n.d.', 'n.d.', 'n.d.', 'n.d.']),
  ],
};

test('BCRP months in English and Spanish', () => {
  assert.equal(parseBcrpMonth('Sep.2026'), '2026-09');
  assert.equal(parseBcrpMonth('Set.2026'), '2026-09');
  assert.equal(parseBcrpMonth('Dic.25'), '2025-12');
  assert.equal(parseBcrpMonth('2026-1'), '2026-01');
  assert.equal(parseBcrpMonth('01.Oct.26'), null);
});

test('one request for every series, monthly periods', () => {
  const u = bcrpEmbigUrl(new Date(Date.UTC(2026, 10, 6)));
  assert.match(u, /PN43672XM-.*-PN43681XM\/json\/2023-7\/2026-11\/ing$/);
});

test('latest real month per country, with changes and history; n.d. never a value', () => {
  const p = parseBcrpEmbig(JSON.stringify(reply), 'u', '2026-11-06T00:00:00Z');
  assert.ok(p);
  assert.equal(p.countries.BRA.bps, 185);
  assert.equal(p.countries.BRA.period, '2026-09');
  assert.equal(p.countries.BRA.seriesId, BCRP_EMBIG_SERIES.BRA);
  assert.equal(p.countries.BRA.change3mBps, -10);
  assert.equal(p.countries.BRA.change12mBps, -25);
  assert.equal(p.countries.BRA.history.length, 4);
  assert.equal(p.countries.VEN, undefined, 'all n.d. -> no figure');
  assert.equal(p.aggregates.em?.bps, 295);
  assert.match(describeHcSpread(p.countries.MEX), /290 bps over US Treasuries \(Sep 2026 avg, -30 bps on a year earlier;.*not CDS\)/);
});

test('a reply whose columns do not match the countries is refused', () => {
  const swapped = { ...reply, config: { ...reply.config, series: [SERIES[2], SERIES[0], ...SERIES.slice(1, 2), ...SERIES.slice(3)] } };
  assert.equal(parseBcrpEmbig(swapped, 'u'), null);
  assert.equal(parseBcrpEmbig('<html>', 'u'), null);
  assert.equal(parseBcrpEmbig({ config: { series: SERIES.slice(0, 3) }, periods: [] }, 'u'), null);
});

test('missing reasons say whether a source exists', () => {
  assert.equal(hcSpreadMissing('BRA').kind, 'unreachable');
  assert.equal(hcSpreadMissing('TUR').kind, 'setup');
  assert.match(hcSpreadMissing('TUR').help, /No free official source/);
});

test('history series is labelled a bond spread, not CDS', () => {
  const p = parseBcrpEmbig(reply, 'u', '2026-11-06T00:00:00Z');
  const set = countrySeries('COL', { hcSpread: p });
  const s = set.series.find((x) => x.id === 'hc_spread');
  assert.ok(s);
  assert.equal(s.points.at(-1)?.value, 260);
  assert.match(s.label, /not CDS/);
  const tur = countrySeries('TUR', { hcSpread: p });
  assert.match(tur.missing.find((x) => x.id === 'hc_spread')!.reason, /No free official source/);
});

test('watchlist rows: the spread shows only with its month, and Missing says why', async () => {
  const { hasFigure, toLive, missingReason } = await import('../src/utils/liveFigures.ts');
  const { COLUMN_BY_ID, DEFAULT_COLUMNS } = await import('../src/utils/watchlistView.ts');
  const base = { iso3: 'BRA', countryName: 'Brazil' } as never;
  const withSpread = { ...(base as object), hcSpreadBps: 185, hcSpreadPeriod: '2026-09', hcSpreadChange12mBps: -25 } as never;
  assert.ok(hasFigure(withSpread, 'hcspread'));
  assert.equal(toLive({ ...(base as object), hcSpreadBps: 185 } as never).hcSpreadBps, undefined, 'no month, no figure');
  assert.equal(COLUMN_BY_ID.hcSpread.note!(withSpread), 'Sep 2026 avg');
  assert.match(COLUMN_BY_ID.hcSpread.help, /not CDS/);
  assert.ok(DEFAULT_COLUMNS.includes('hcSpread'));
  assert.equal(missingReason('hcspread', 'TUR').short, 'No free source');
});

test('council inputs carry the spread as a bond spread, or name it missing with the reason', async () => {
  const { councilInputs } = await import('../src/utils/councilInputs.ts');
  const p = parseBcrpEmbig(reply, 'u', '2026-11-06T00:00:00Z')!;
  const snap = {
    iso3: 'BRA', countryName: 'Brazil', currencyCode: 'BRL',
    imfIndicators: {}, worldBankIndicators: {}, gdeltMetrics: {},
    monetaryAndMarket: { hcBondSpreadBps: 185 },
    liveFields: { 'market.hcBondSpreadBps': 'BCRP EMBIG (USD bond spread)' },
    dataStatus: { verifiedLiveSources: ['BCRP EMBIG (USD bond spread), 2026-09'], checkedAt: '' },
    hcBondSpread: p.countries.BRA,
  } as never;
  const out = councilInputs(snap);
  const line = out.lines.find((l: string) => /USD bond spread/.test(l));
  assert.ok(line && /185 bps, Sep 2026 avg/.test(line) && /not CDS/.test(line), line);
  assert.ok(!out.lines.some((l: string) => /\bCDS\b/.test(l) && !/not CDS/.test(l)), 'no CDS line while CDS is hidden');
});

test('the real BCRP reply (fetched 2026-11-06) is read: names with the title prefix, long decimals', async () => {
  const { describeBcrpReply } = await import('../src/utils/hardCurrencySpread.ts');
  const pre = 'Indicadores de riesgo para países emergentes: EMBIG - ';
  const long = ['Perú', 'Argentina', 'Brasil', 'Chile', 'Colombia', 'Ecuador', 'México', 'Venezuela'].map((c) => ({ name: `${pre}Diferencial de Rendimientos del Índice de Bonos de Mercados Emergentes (EMBIG) - ${c}`, dec: '0' }));
  const real = {
    config: { title: 'Indicadores de riesgo para países emergentes: EMBIG', series: [...long, { name: `${pre}Latin EMBIG Países Latinoamericanos`, dec: '0' }, { name: `${pre}EMBIG Países Emergentes`, dec: '0' }] },
    periods: [
      { name: 'Aug.2026', values: ['108.684404761905', '486.392461333333', '179.180609571429', '89.5565324761905', '191.845119619048', '429.914052047619', '198.310637047619', '4605.34294585714', '225.663616619048', '188.462424476191'] },
      { name: 'Sep.2026', values: ['107.328391571429', '534.483593619048', '166.759403952381', '89.1163553809524', '206.775517761905', '444.028545047619', '198.469487380952', '4261.9536797619', '189.125041571429', '168.346195142857'] },
    ],
  };
  const p = parseBcrpEmbig('﻿' + JSON.stringify(real), 'u');
  assert.ok(p);
  assert.equal(Math.round(p.countries.BRA.bps), 167);
  assert.equal(p.countries.BRA.period, '2026-09');
  assert.equal(Math.round(p.countries.VEN.bps), 4262);
  assert.equal(Math.round(p.aggregates.em!.bps), 168);
  // What the check says when the site sends its script-only page instead.
  const page = '<!DOCTYPE html>\n<html>\n<head><script src="/oly-Almost-That" async></script>\n<title></title>\n</head>\n<body>\n</body>\n</html>';
  assert.match(describeBcrpReply(page), /bot check/);
  assert.match(describeBcrpReply(''), /empty/);
  assert.match(describeBcrpReply('{"config":{"series":[{"name":"x - Bolivia"}]},"periods":[{"name":"Sep.2026","values":["1"]}]}'), /Bolivia/);
});

test('a BCRP reply with something after the JSON, or a raw line break in a name, is still read', () => {
  const pre = 'Indicadores de riesgo para países emergentes: EMBIG - ';
  const names = ['Perú', 'Argentina', 'Brasil', 'Chile', 'Colombia', 'Ecuador', 'México', 'Venezuela'].map((c) => ({ name: `${pre}EMBIG - ${c}`, dec: '0' }));
  const body = JSON.stringify({ config: { title: 'x', series: [...names, { name: `${pre}Latin EMBIG` }, { name: `${pre}EMBIG Países Emergentes` }] }, periods: [{ name: 'Sep.2026', values: ['107.3', '534.5', '166.8', '89.1', '206.8', '444.0', '198.5', '4262.0', '189.1', '168.3'] }] });
  const withScript = `${body}\n<script src="/oly-Almost-That" async></script>`;
  assert.equal(Math.round(parseBcrpEmbig(withScript, 'u')!.countries.BRA.bps), 167);
  const withBreak = body.replace('EMBIG - Chile', 'EMBIG -\nChile');
  assert.equal(parseBcrpEmbig(withBreak, 'u')!.countries.CHL.period, '2026-09');
});
