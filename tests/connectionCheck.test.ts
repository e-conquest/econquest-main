/**
 * The data connection check, with the network replaced by a fake: each source must come back in
 * the right state with a plain reason, read through the app's own parsers, and never show a key.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkConnections, describeNetworkError, formatReport, isErrorPageRedirect, type FetchFn } from '../src/utils/connectionCheck.ts';
import { imfFetch } from './helpers/imfFixtures.ts';
import { makeXlsx, pinkSheetRows } from './helpers/makeXlsx.ts';

const PINK_XLSX = makeXlsx('Monthly Prices', pinkSheetRows([{ code: 'CRUDE_BRENT', heading: 'Crude oil, Brent', unit: '$/bbl', values: Array.from({ length: 46 }, (_, i) => 60 + i) }]));
const PINK_LINK = 'https://thedocs.worldbank.org/en/doc/abc-0050012026/related/CMO-Historical-Data-Monthly.xlsx';

const NOW = new Date('2026-11-05T12:00:00Z');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const dnsFail = () => {
  const e = new TypeError('fetch failed') as TypeError & { cause?: unknown };
  e.cause = { code: 'ENOTFOUND' };
  throw e;
};

/** Answers like the real sources, for Brazil and the US. */
const healthy: FetchFn = async (url) => {
  if (url.includes('api.worldbank.org/v2/country/BRA/indicator/FI.RES.TOTL.MO')) return json([{ page: 1 }, [{ date: '2025', value: null }, { date: '2024', value: 5.94 }]]);
  if (url.includes('api.worldbank.org/v2/sources/6')) return json({ source: [{ data: [] }] });
  if (url.includes('api.imf.org') || url.includes('datamapper/api/v1/NGDPD')) return imfFetch()(url);
  if (url.includes('imf.org')) return json({ values: { GGXWDG_NGDP: { BRA: { '2025': 91.4 } } } });
  if (url.includes('gdeltproject')) return json({ articles: [{ title: 'Brazil central bank holds rates' }] });
  if (url.includes('polymarket')) return json([{ title: 'Fed cut in December?' }]);
  if (url.includes('kalshi')) return json({ markets: [{ title: 'CPI above 3%?' }] });
  if (url.includes('newyorkfed')) return json({ refRates: [{ effectiveDate: '2026-11-04', percentRate: 3.88 }] });
  if (url.includes('open.er-api.com')) return json({ rates: { BRL: 5.412 } });
  if (url.includes('frankfurter')) {
    const rates: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 60; i++) rates[new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10)] = { BRL: 5.4 + Math.sin(i) * 0.05 };
    return json({ rates });
  }
  if (url.includes('WS_EER')) {
    const head = 'FREQ,EER_TYPE,EER_BASKET,REF_AREA,TIME_PERIOD,OBS_VALUE';
    const rows = Array.from({ length: 72 }, (_, i) => `M,R,B,BR,${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')},${100 + (i === 71 ? 8 : 0)}`);
    return new Response([head, ...rows].join('\n'));
  }
  if (url.includes('WS_DEBT_SEC2_PUB')) return new Response('nothing usable');
  if (url.includes('WS_CBPOL/D.BR/'))
    return new Response(
      'FREQ,REF_AREA,UNIT_MEASURE,UNIT_MULT,TIME_FORMAT,COMPILATION,DECIMALS,SOURCE_REF,SUPP_INFO_BREAKS,TITLE,TIME_PERIOD,OBS_VALUE,OBS_STATUS,OBS_CONF,OBS_PRE_BREAK\nD,BR,368,0,,From 5 Mar 1999 onwards: SELIC target rate.,4,Central Bank of Brazil,, Central bank policy rates - Brazil - Daily - End of period,2026-10-27,15,A,F,\n'
    );
  if (url.includes('wits.worldbank.org')) return new Response('<Obs TIME_PERIOD="2023" OBS_VALUE="30.71" />');
  if (url.includes('publicreporting.cftc.gov'))
    return json([
      { report_date_as_yyyy_mm_dd: '2026-10-20T00:00:00.000', cftc_contract_market_code: '095741', open_interest_all: '278165', asset_mgr_positions_long: '53063', asset_mgr_positions_short: '77127', lev_money_positions_long: '91748', lev_money_positions_short: '27934' },
      { report_date_as_yyyy_mm_dd: '2026-10-27T00:00:00.000', cftc_contract_market_code: '095741', open_interest_all: '279359', asset_mgr_positions_long: '48101', asset_mgr_positions_short: '73302', lev_money_positions_long: '99625', lev_money_positions_short: '31290' },
    ]);
  if (url.includes('api.db.nomics.world') && url.includes('DF_CLI'))
    return json({ series: { num_found: 1, docs: [{ series_code: 'BRA.M.LI.IX._Z.AA.IX._Z.H', dimensions: { REF_AREA: 'BRA', FREQ: 'M', MEASURE: 'LI', UNIT_MEASURE: 'IX', ADJUSTMENT: 'AA', METHODOLOGY: 'H' }, period: ['2026-08', '2026-09'], value: [99.71, 99.8] }] } });
  if (url.includes('api.db.nomics.world') && url.includes('DF_PRICES_ALL'))
    return json({ series: { num_found: 1, docs: [{ series_code: 'BRA.M.N.CPI.PA._T.N.GY', dimensions: { REF_AREA: 'BRA', FREQ: 'M', METHODOLOGY: 'N', MEASURE: 'CPI', UNIT_MEASURE: 'PA', EXPENDITURE: '_T', ADJUSTMENT: 'N', TRANSFORMATION: 'GY' }, period: ['2026-08', '2026-09'], value: ['NA', 4.2] }] } });
  if (url.includes('ticdata.treasury.gov')) return new Response('Table 5\nCountry\t2026-08\t2026-07\nJapan\t1068.3\t1103.9\nBrazil\t168.4\t168.0\nGrand Total\t9331.7\t9248.4\n');
  if (url.includes('www.worldbank.org/en/research/commodity-markets')) return new Response(`<a href="${PINK_LINK}">October 2026 (XLS)</a>`);
  if (url === PINK_LINK) return new Response(PINK_XLSX as BodyInit);
  if (url.includes('api.eia.gov'))
    return url.includes('api_key=good-eia')
      ? json({ response: { data: [{ period: '2026-11-03', series: 'RBRTE', value: '64.10' }, { period: '2026-10-03', series: 'RBRTE', value: '62.00' }] } })
      : json({ error: { code: 'API_KEY_INVALID', message: 'bad key' } }, 403);
  if (url.includes('comtradeapi.un.org')) {
    if (url.includes('/data/v1/get/') ) return json({ statusCode: 401, message: 'Access denied due to invalid subscription key.' }, 401);
    if (!url.includes('period=2024')) return json({ data: [] });
    return json({
      count: 4,
      data: [
        { period: '2024', reporterCode: 76, flowCode: 'X', partnerCode: 0, partnerDesc: 'World', cmdCode: 'TOTAL', partner2Code: 0, customsCode: 'C00', motCode: 0, primaryValue: 337e9 },
        { period: '2024', reporterCode: 76, flowCode: 'X', partnerCode: 156, partnerDesc: 'China', cmdCode: 'TOTAL', partner2Code: 0, customsCode: 'C00', motCode: 0, primaryValue: 94.4e9 },
        { period: '2024', reporterCode: 76, flowCode: 'M', partnerCode: 0, partnerDesc: 'World', cmdCode: 'TOTAL', partner2Code: 0, customsCode: 'C00', motCode: 0, primaryValue: 262e9 },
        { period: '2024', reporterCode: 76, flowCode: 'M', partnerCode: 643, partnerDesc: 'Russian Federation', cmdCode: 'TOTAL', partner2Code: 0, customsCode: 'C00', motCode: 0, primaryValue: 10.5e9 },
      ],
    });
  }
  if (url.includes('fredgraph.csv')) return new Response('observation_date,IRLTLT01USM156N\n2026-08-01,4.21\n2026-09-01,4.12\n');
  if (url.includes('api.stlouisfed.org')) return json({ error_code: 400, error_message: 'Bad Request. The value for variable api_key is not registered.' }, 400);
  if (url.includes('tesourotransparente')) return new Response('Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha\nTesouro Prefixado com Juros Semestrais;01/01/2037;30/10/2026;15,23\n');
  if (url.includes('generativelanguage')) return json({ name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash' });
  if (url.includes('11434/api/tags')) return json({ models: [{ name: 'qwen2.5:7b' }] });
  return dnsFail();
};

const byId = async (opts: Parameters<typeof checkConnections>[0]) => {
  const rep = await checkConnections({ now: NOW, oecdGapMs: 0, ...opts });
  return { rep, row: (id: string) => rep.results.find((r) => r.id === id)! };
};

test('free sources connect and show a figure read by the app parser', async () => {
  const { row } = await byId({ env: {}, fetchFn: healthy });
  assert.equal(row('worldbank').state, 'connected');
  assert.match(row('worldbank').sample!, /5\.9 months of imports \(2024\)/);
  assert.match(row('imf').sample!, /91\.4% of GDP \(2025\)/);
  assert.match(row('nyfed').sample!, /3\.88% \(2026-11-04\)/);
  assert.match(row('fred_csv').sample!, /US 10Y 4\.12% \(2026-09/);
  assert.match(row('wits').sample!, /30\.7%/);
  assert.match(row('bis_reer').sample!, /real exchange rate/);
  assert.equal(row('cftc').state, 'connected');
  assert.equal(row('bis_cbpol').state, 'connected');
  assert.equal(row('bis_cbpol').sample, 'Brazil policy rate 15.00% (Central Bank of Brazil, 2026-10-27)');
  assert.equal(row('imf_cofer').sample, 'World FX reserves Q2 2025: US dollar 56.3%, euro 20.1%, yen 5.9%');
  assert.equal(row('imf_reserves').state, 'connected');
  assert.match(row('imf_reserves').sample!, /Brazil reserves \$345\.0bn \(Sep 2025\), 10\.3 months of imports, current account -2\.5% of GDP \(4 quarters to Q2 2025\)/);
  assert.match(row('oecd_cpi').sample!, /Brazil inflation 4\.2% y\/y \(Sep 2026\)/);
  assert.match(row('oecd_cli').sample!, /Brazil leading indicator 99\.80 \(Sep 2026, recovery\)/);
  assert.match(row('tic').sample!, /Brazil holds \$168\.4bn of US Treasuries \(Aug 2026\)/);
  assert.match(row('cftc').sample!, /Leveraged funds net MXN \+24\.5% of open interest \(as of 2026-10-27, 2 weeks\)/);
  assert.equal(row('worldbank_debt').state, 'connected', 'an empty but valid reply still proves the connection');
  assert.equal(row('pink_sheet').state, 'connected');
  assert.match(row('pink_sheet').sample!, /Brent crude \$105\/bbl \(2026-10\), \+1\.0% on the month/);
  assert.equal(row('pink_sheet').host, 'thedocs.worldbank.org');
});

test('Comtrade: the preview reads Brazil with no key; a rejected key needs setup and is never shown', async () => {
  const { row } = await byId({ env: {}, fetchFn: healthy });
  assert.equal(row('comtrade').state, 'connected');
  assert.match(row('comtrade').sample!, /Brazil: Exports \$337\.0bn: China 28\.0%, Taiwan 0\.0%, Russia 0\.0%, Gulf 0\.0% of the total \(UN Comtrade 2024\)/);
  const bad = await byId({ env: { COMTRADE_API_KEY: 'secret-ct-777' }, fetchFn: healthy });
  assert.equal(bad.row('comtrade').state, 'needs_setup');
  assert.doesNotMatch(JSON.stringify(bad.rep), /secret-ct-777/);
});

test('Pink Sheet: a page without the link, or a workbook in another layout, says what to do', async () => {
  const noLink = await byId({ env: {}, fetchFn: async (u) => (u.includes('commodity-markets') ? new Response('<p>moved</p>') : healthy(u)) });
  assert.equal(noLink.row('pink_sheet').state, 'bad_reply');
  assert.match(noLink.row('pink_sheet').detail, /PINK_SHEET_URL/);
  const override = await byId({ env: { PINK_SHEET_URL: PINK_LINK }, fetchFn: async (u) => (u.includes('commodity-markets') ? dnsFail() : healthy(u)) });
  assert.equal(override.row('pink_sheet').state, 'connected', 'PINK_SHEET_URL skips the page');
  const html = await byId({ env: {}, fetchFn: async (u) => (u === PINK_LINK ? new Response('<html>error</html>') : healthy(u)) });
  assert.equal(html.row('pink_sheet').state, 'bad_reply');
});

test('EIA: optional without a key; a good key reads Brent; a bad key needs setup and is never shown', async () => {
  assert.equal((await byId({ env: {}, fetchFn: healthy })).row('eia').state, 'optional');
  const good = await byId({ env: { EIA_API_KEY: 'good-eia' }, fetchFn: healthy });
  assert.equal(good.row('eia').state, 'connected');
  assert.match(good.row('eia').sample!, /Brent crude \(EIA daily\) \$64\.1\/bbl \(2026-11-03\), \+3\.4% on the month/);
  const bad = await byId({ env: { EIA_API_KEY: 'secret-eia-999' }, fetchFn: healthy });
  assert.equal(bad.row('eia').state, 'needs_setup');
  assert.doesNotMatch(JSON.stringify(bad.rep), /secret-eia-999|good-eia/);
  assert.doesNotMatch(JSON.stringify(good.rep), /good-eia/);
});

test('an answer in the wrong shape is reported as unreadable, not connected', async () => {
  const { row } = await byId({ env: {}, fetchFn: healthy });
  assert.equal(row('bis_debt').state, 'bad_reply');
  assert.match(row('bis_debt').detail, /format/);
});

test('a source with no network says why in words', async () => {
  const { row, rep } = await byId({ env: {}, fetchFn: async () => dnsFail() });
  assert.equal(row('imf').state, 'no_answer');
  assert.match(row('imf').detail, /Address not found/);
  assert.equal(row('imf').host, 'www.imf.org');
  assert.ok(rep.counts.no_answer >= 14);
});

test('GDELT text instead of JSON points at its rate limit', async () => {
  const fetchFn: FetchFn = async (u) => (u.includes('gdelt') ? new Response('Please limit requests to one every 5 seconds') : healthy(u));
  const { row } = await byId({ env: {}, fetchFn });
  assert.equal(row('gdelt').state, 'bad_reply');
  assert.match(row('gdelt').detail, /5 seconds/);
});

test('GDELT news search not answering says the event files are separate and the last pull is kept', async () => {
  const fetchFn: FetchFn = async (u) => {
    if (u.includes('api.gdeltproject.org')) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } });
    return healthy(u);
  };
  const { row } = await byId({ env: {}, fetchFn });
  assert.equal(row('gdelt').state, 'no_answer');
  assert.match(row('gdelt').detail, /timed out/);
  assert.match(row('gdelt').detail, /data\.gdeltproject\.org/);
  assert.match(row('gdelt').detail, /last saved headlines/);
});

test('HTTP errors are refused with the status', async () => {
  const fetchFn: FetchFn = async (u) => (u.includes('imf.org') ? new Response('busy', { status: 503 }) : healthy(u));
  const { row } = await byId({ env: {}, fetchFn });
  assert.equal(row('imf').state, 'refused');
  assert.equal(row('imf').httpStatus, 503);
  assert.match(row('imf').detail, /HTTP 503/);
});

test('FRED: no key is optional (the download is used); a rejected key needs setup and is never shown', async () => {
  const none = await byId({ env: {}, fetchFn: healthy });
  assert.equal(none.row('fred_api').state, 'optional');
  const bad = await byId({ env: { FRED_API_KEY: 'secret-fred-123' }, fetchFn: healthy });
  assert.equal(bad.row('fred_api').state, 'needs_setup');
  assert.match(bad.row('fred_api').detail, /did not accept the key/);
  assert.doesNotMatch(JSON.stringify(bad.rep), /secret-fred-123/);
  assert.doesNotMatch(formatReport(bad.rep), /secret-fred-123/);
});

test('EVDS: missing pieces each get their own reason; the key goes in a header', async () => {
  assert.match((await byId({ env: {}, fetchFn: healthy })).row('evds').detail, /Not set up/);
  const cpiOnly: FetchFn = async (u, init) => {
    if (u.includes('evds3') && u.includes('TP.FG.J0') && new Headers(init?.headers).get('key') === 'k') {
      return json({ items: [{ Tarih: '2025-9', TP_FG_J0: '3000' }, { Tarih: '2026-9', TP_FG_J0: '3990' }] });
    }
    return healthy(u);
  };
  const keyOnly = (await byId({ env: { EVDS_API_KEY: 'k' }, fetchFn: cpiOnly })).row('evds');
  assert.equal(keyOnly.state, 'connected');
  assert.match(keyOnly.sample!, /Turkey CPI 33\.00% over 12 months \(Sep 2026\)/);
  assert.match(keyOnly.detail, /10Y series code is empty, so Turkey's 10Y yield reads Missing \(Menu > Settings or EVDS_TR10Y_SERIES\)/);
  assert.match((await byId({ env: { EVDS_API_KEY: 'k', EVDS_TR_CPI_SERIES: 'cpi' }, fetchFn: cpiOnly })).row('evds').detail, /not a series code.*TP\.FG\.J0/);
  assert.match((await byId({ env: { EVDS_API_KEY: 'k', EVDS_TR10Y_SERIES: 'bond' }, fetchFn: healthy })).row('evds').detail, /not a series code/);
  let sawHeader = false;
  const fetchFn: FetchFn = async (u, init) => {
    if (u.includes('evds3')) {
      sawHeader = new Headers(init?.headers).get('key') === 'evds-secret' && !u.includes('evds-secret');
      return json({ items: [{ Tarih: '30-10-2026', TP_TEST_Y10: '31.92' }] });
    }
    return healthy(u);
  };
  const ok = await byId({ env: { EVDS_API_KEY: 'evds-secret', EVDS_TR10Y_SERIES: 'TP.TEST.Y10' }, fetchFn });
  assert.equal(ok.row('evds').state, 'connected');
  assert.ok(sawHeader);
  assert.doesNotMatch(JSON.stringify(ok.rep), /evds-secret/);
});

test('Banxico: optional without a token; the token goes only in the Bmx-Token header', async () => {
  assert.equal((await byId({ env: {}, fetchFn: healthy })).row('banxico').state, 'optional');
  let sawHeader = false;
  const fetchFn: FetchFn = async (u, init) => {
    if (u.includes('banxico.org.mx')) {
      sawHeader = new Headers(init?.headers).get('Bmx-Token') === 'bmx-secret-token-0123456789abcdef' && !u.includes('bmx-secret');
      if (!sawHeader) return json({ error: { mensaje: 'Token invalido' } }, 401);
      return json({ bmx: { series: [{ idSerie: 'SP30578', titulo: 'Inflación anual', datos: [{ fecha: '01/08/2026', dato: '3.57' }, { fecha: '01/09/2026', dato: '3.76' }] }] } });
    }
    return healthy(u);
  };
  const ok = await byId({ env: { BANXICO_TOKEN: 'bmx-secret-token-0123456789abcdef' }, fetchFn });
  assert.equal(ok.row('banxico').state, 'connected');
  assert.match(ok.row('banxico').sample!, /Mexico INPC 3\.76% over 12 months/);
  assert.ok(sawHeader);
  assert.doesNotMatch(JSON.stringify(ok.rep), /bmx-secret/);
  const bad = await byId({ env: { BANXICO_TOKEN: 'wrong' }, fetchFn });
  assert.equal(bad.row('banxico').state, 'needs_setup');
  assert.doesNotMatch(JSON.stringify(bad.rep), /wrong/);
});

test('own CDS: off by default, then file checks (missing, unreadable, read, stale)', async () => {
  assert.equal((await byId({ env: {}, fetchFn: healthy })).row('own_cds').state, 'off');
  const env = { CDS_FEED: 'csv', CDS_CSV_PATH: '/x/cds.csv' };
  assert.match((await byId({ env, fetchFn: healthy, readFile: () => null })).row('own_cds').detail, /No file at CDS_CSV_PATH/);
  const junk = await byId({ env, fetchFn: healthy, readFile: () => ({ text: 'a,b\n1,2\n', modified: NOW }) });
  assert.equal(junk.row('own_cds').state, 'bad_reply');
  const good = await byId({ env, fetchFn: healthy, readFile: () => ({ text: 'iso3,date,cds5y_bps,source\nMEX,2026-10-20,117.4,Bloomberg\n', modified: NOW }) });
  assert.equal(good.row('own_cds').state, 'connected');
  assert.match(good.row('own_cds').sample!, /MEX 5Y CDS 117\.4 bp/);
  assert.match(good.row('own_cds').warning!, /16 days old/);
  assert.match((await byId({ env: { CDS_FEED: 'bloomberg' }, fetchFn: healthy })).row('own_cds').detail, /must be "csv" or "lseg"/);
  assert.match((await byId({ env: { CDS_FEED: 'lseg', LSEG_APP_KEY: 'a' }, fetchFn: healthy })).row('own_cds').detail, /LSEG_USERNAME, LSEG_PASSWORD, LSEG_CDS_RICS are not set/);
});

test('AI: the chosen provider is required, the others are optional; missing Ollama models are named', async () => {
  const g = await byId({ env: { DEFAULT_AI_PROVIDER: 'gemini' }, fetchFn: async () => dnsFail() });
  assert.equal(g.row('gemini').state, 'needs_setup');
  assert.equal(g.row('ollama').state, 'optional');
  const o = await byId({ env: { DEFAULT_AI_PROVIDER: 'ollama', GEMINI_API_KEY: 'gk' }, fetchFn: healthy });
  assert.equal(o.row('ollama').state, 'connected');
  assert.match(o.row('ollama').warning!, /ollama pull qwen2.5:32b/);
  assert.equal(o.row('gemini').state, 'connected');
  const down = await byId({ env: { DEFAULT_AI_PROVIDER: 'ollama' }, fetchFn: async () => dnsFail() });
  assert.equal(down.row('ollama').state, 'no_answer');
  assert.match(down.row('ollama').detail, /ollama serve/);
});

test('network errors in words', () => {
  assert.match(describeNetworkError({ name: 'AbortError' }, 8000), /No answer within 8 s/);
  assert.match(describeNetworkError({ cause: { code: 'ECONNREFUSED' } }, 8000), /refused/);
  assert.match(describeNetworkError({ message: 'Request was cancelled.' }, 8000), /proxy or firewall/);
});

test('only= limits the check', async () => {
  const { rep } = await byId({ env: {}, fetchFn: healthy, only: ['imf', 'nyfed'] });
  assert.deepEqual(rep.results.map((r) => r.id), ['imf', 'nyfed']);
});

test('OECD: own headers on every call, and a Cloudflare bot check reads as that, not as a data error', async () => {
  const seen: Array<{ url: string; headers: Record<string, string> }> = [];
  const cf: FetchFn = async (url, init) => {
    seen.push({ url, headers: (init?.headers || {}) as Record<string, string> });
    if (url.includes('api.db.nomics.world'))
      return new Response('<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/x"></script></body></html>', { status: 429 });
    return healthy(url, init);
  };
  const { row } = await byId({ env: {}, fetchFn: cf, only: ['oecd_cli', 'oecd_cpi'] });
  for (const id of ['oecd_cli', 'oecd_cpi']) {
    assert.equal(row(id).state, 'refused');
    assert.match(row(id).detail, /bot check \(a Cloudflare "Just a moment" page, HTTP 429\)/);
  }
  const oecd = seen.filter((s) => s.url.includes('api.db.nomics.world'));
  assert.equal(oecd.length, 2);
  for (const s of oecd) {
    assert.equal(s.headers.Accept, 'application/json');
    assert.match(s.headers['User-Agent'], /^EconQuest\//);
  }
});

test('a redirect to the source own error page reads as a site error, not a format change', async () => {
  const down: FetchFn = async (url, init) => {
    if (url.includes('markets.newyorkfed.org')) {
      const res = new Response('<html><body>Something went wrong</body></html>', { status: 200 });
      Object.defineProperty(res, 'url', { value: 'https://www.newyorkfed.org/errors/500' });
      return res;
    }
    return healthy(url, init);
  };
  const { row } = await byId({ env: {}, fetchFn: down, only: ['nyfed'] });
  assert.equal(row('nyfed').state, 'refused');
  assert.match(row('nyfed').detail, /^Site error: .*errors\/500.*not a format change/);
  assert.ok(isErrorPageRedirect('https://www.newyorkfed.org/errors/500'));
  assert.ok(!isErrorPageRedirect('https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json'));
  assert.ok(!isErrorPageRedirect(undefined));
});
