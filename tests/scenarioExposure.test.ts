import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichTrade, parseWbLatest, parseWitsShare, rankScenario, scenarioImpact, wbIndicatorUrl, witsUrl } from '../src/utils/scenarioExposure.ts';

test('URLs: one World Bank call per indicator for all countries; WITS per partner and year', () => {
  assert.equal(wbIndicatorUrl(['BRA', 'TUR'], 'TM.VAL.FUEL.ZS.UN'), 'https://api.worldbank.org/v2/country/BRA;TUR/indicator/TM.VAL.FUEL.ZS.UN?format=json&mrnev=1&per_page=100');
  assert.equal(
    witsUrl('BRA', 'CHN', 'XPRT-PRTNR-SHR', 2023),
    'https://wits.worldbank.org/API/V1/SDMX/V21/datasource/tradestats-trade/reporter/bra/year/2023/partner/chn/product/all/indicator/XPRT-PRTNR-SHR'
  );
});

test('parsers: World Bank rows keyed by ISO3; WITS Obs value and year', () => {
  const m = parseWbLatest([{ page: 1 }, [{ countryiso3code: 'BRA', date: '2025', value: 11.09 }, { countryiso3code: 'EGY', date: '2025', value: null }]]);
  assert.deepEqual(m.get('BRA'), { value: 11.09, year: '2025' });
  assert.equal(m.has('EGY'), false);
  assert.deepEqual(parseWitsShare('<Series><Obs TIME_PERIOD="2023" OBS_VALUE="30.7112" DATASOURCE="WITS-CMT" /></Series>'), { pct: 30.7112, year: '2023' });
  assert.equal(parseWitsShare('<html>error</html>'), null);
});

test('scenarios: stated shocks on trade shares; exporters gain from Hormuz', () => {
  const importer = { fuelImportsPctMerch: 20, fuelExportsPctMerch: 5, importsPctGdp: 35, exportsPctGdp: 30, wbYear: '2025', chinaExportSharePct: 30, russiaExportSharePct: 4, russiaImportSharePct: 12.5, witsYear: '2023' };
  assert.equal(scenarioImpact('hormuz', importer)!.pctGdp, -2.75); // 0.5 x (7 - 1.5)
  assert.equal(scenarioImpact('taiwan', importer)!.pctGdp, -1.8); // 0.2 x 9
  assert.equal(scenarioImpact('russia', importer)!.pctGdp, -2.79); // 0.5 x (1.2 + 4.375)
  const exporter = { fuelImportsPctMerch: 5, fuelExportsPctMerch: 60, importsPctGdp: 20, exportsPctGdp: 40, wbYear: '2025' };
  assert.ok(scenarioImpact('hormuz', exporter)!.pctGdp > 0);
  assert.equal(scenarioImpact('taiwan', exporter), null); // no China share: says so, no guess
  const ranked = rankScenario('hormuz', [
    { iso3: 'X', countryName: 'Exporter', trade: exporter },
    { iso3: 'I', countryName: 'Importer', trade: importer },
    { iso3: 'N', countryName: 'No data' },
  ]);
  assert.deepEqual(ranked.map((r) => r.iso3), ['I', 'X']);
});

const BASE = { fuelImportsPctMerch: 20, fuelExportsPctMerch: 5, importsPctGdp: 35, exportsPctGdp: 30, wbYear: '2025', chinaExportSharePct: 30, russiaExportSharePct: 4, russiaImportSharePct: 12.5, witsYear: '2023' };
const COMTRADE = {
  year: '2024',
  exportSharePct: { china: 25, taiwan: 5, russia: 2, gulf: 1 },
  importSharePct: { china: 30, russia: 10, gulf: 8 },
  exportMixPct: { '27': 20, '15': 10, '84': 15 },
  productYear: '2024',
};
const MOVES = [
  { code: 'CRUDE_BRENT', source: 'pink_sheet', asOf: '2026-10', latest: 64, change12mPct: -10 },
  { code: 'NGAS_EUR', source: 'pink_sheet', asOf: '2026-10', latest: 11, change12mPct: -20 },
  { code: 'COAL_AUS', source: 'pink_sheet', asOf: '2026-10', latest: 110, change12mPct: 0 },
  { code: 'PALM_OIL', source: 'pink_sheet', asOf: '2026-10', latest: 950, change12mPct: 30 },
  { code: 'RBRTE', source: 'eia', asOf: '2026-11-03', latest: 65, change12mPct: -9 },
];

test('Comtrade replaces WITS shares and adds Taiwan; the source is named', () => {
  const t = enrichTrade(BASE, COMTRADE, null)!;
  assert.equal(t.chinaExportSharePct, 25);
  assert.equal(t.partnerSource, 'UN Comtrade 2024');
  const tw = scenarioImpact('taiwan', t)!;
  assert.equal(tw.pctGdp, -1.8); // 0.2 x (7.5 + 1.5)
  assert.match(tw.basis, /exports to China and Taiwan about 9\.0% of GDP \(25% of exports to China, 5\.0% to Taiwan, UN Comtrade 2024\)/);
  assert.match(scenarioImpact('russia', t)!.basis, /UN Comtrade 2024/);
  // Without Comtrade: China only, and it says Taiwan is not available.
  assert.match(scenarioImpact('taiwan', BASE)!.basis, /Taiwan not available, WITS 2023/);
  // Comtrade without Russia keeps the WITS shares rather than mixing years silently.
  const partial = enrichTrade(BASE, { year: '2024', exportSharePct: { china: 25 }, importSharePct: {} }, null)!;
  assert.equal(partial.chinaExportSharePct, 30);
  assert.equal(partial.partnerSource, undefined);
});

test('Hormuz keeps its formula and adds the Brent level and Gulf import share', () => {
  const h = scenarioImpact('hormuz', enrichTrade(BASE, COMTRADE, MOVES)!)!;
  assert.equal(h.pctGdp, -2.75);
  assert.match(h.basis, /Brent \$64 in 2026-10 would be about \$96 \(Pink Sheet\)/);
  assert.match(h.basis, /8\.0% of imports come from the Gulf producers \(UN Comtrade 2024\)/);
});

test('commodity prices: actual 12-month moves on the export mix, less the fuel bill change', () => {
  const t = enrichTrade(BASE, COMTRADE, MOVES)!;
  assert.deepEqual(t.priceMoves12m, { CRUDE_BRENT: -10, NGAS_EUR: -20, COAL_AUS: 0, PALM_OIL: 30 }, 'EIA daily is not mixed into the monthly moves');
  const p = scenarioImpact('prices', t)!;
  // fuels: 20% x 30 x avg(-10,-20,0)=-10% -> -0.6; palm oil: 10% x 30 x 30% -> +0.9; machinery unpriced.
  // fuel imports 20% x 35 = 7 of GDP x -10% -> bill falls 0.7 -> +0.7. Total +1.0.
  assert.equal(p.pctGdp, 1);
  assert.match(p.basis, /^palm oil 10% of exports, price \+30%; fuels 20% of exports, price -10%; fuel imports 7\.0% of GDP with Brent -10% \(Pink Sheet to 2026-10, UN Comtrade 2024, World Bank 2025\)$/);
  assert.equal(scenarioImpact('prices', enrichTrade(BASE, null, MOVES)!), null, 'no export mix: Missing, not a guess');
  assert.equal(scenarioImpact('prices', enrichTrade(BASE, COMTRADE, null)!), null, 'no prices: Missing');
  assert.equal(enrichTrade(undefined, null, null), undefined);
});
