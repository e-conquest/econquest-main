/**
 * Loaded into the server under test with NODE_OPTIONS="--import ...".
 * Replaces fetch so the server never touches the network: the official yield feeds answer with
 * fixed fixtures, and every other host fails at once, as if the machine were offline.
 * Each request is logged to stderr as "[offline-fetch] <url> key=<present|missing>" so tests can
 * check what the server asked for.
 */
const TESOURO_CSV = [
  'Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha;PU Base Manha',
  'Tesouro Prefixado com Juros Semestrais;01/01/2037;30/10/2026;15,23;15,35;800,10;795,22;795,01',
  'Tesouro Prefixado com Juros Semestrais;01/01/2035;30/10/2026;14,90;15,02;850,10;845,22;845,01',
].join('\r\n');

import { CBPOL_DAILY_LIVE, CBPOL_MONTHLY } from '../fixtures/bisCbpol.mjs';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
  process.stderr.write(`[offline-fetch] ${url} key=${headers.has('key') ? 'present' : 'missing'}\n`);
  // OFFLINE_HANG=<host part>: that host never answers (for the preload step time limit).
  if (process.env.OFFLINE_HANG && url.includes(process.env.OFFLINE_HANG)) return new Promise(() => {});

  // A stand-in Ollama for the council synthesis test: one traceable sentence, one invented number.
  // The fast model and the default referee model (src/utils/refereeModel.ts) are both downloaded.
  if (url === 'http://fake-ollama.test:11434/api/tags') return json({ models: [{ name: 'qwen2.5:7b' }, { name: 'qwen2.5:32b' }] });
  if (url.startsWith('http://fake-ollama.test:11434/api/chat')) {
    await new Promise((r) => setTimeout(r, 900)); // long enough to see a step running
    const brief = {
      headline: 'Turkey looks behind the curve.',
      points: ['Inflation is 34.0%, from live IMF data.', 'Inflation should fall to 21% next year.'],
      disagreements: [],
      gaps: ['No CDS reading was asked for.'],
    };
    // Explain mode (src/utils/explain.ts) asks for facts apart from interpretation, by lens.
    const explain = {
      headline: 'Inflation is far above the policy rate, so policy is loose in real terms.',
      facts: ['CPI inflation is 34.0%.', 'The figure you pointed at is 27.5%.', 'Inflation should fall to 21% next year.'],
      reasons: ['Prices are rising faster than the policy rate, so borrowing is cheap in real terms.'],
      lenses: [
        { lens: 'micro', text: 'Savers lose and borrowers gain while prices outrun the policy rate.' },
        { lens: 'politics', text: 'Protests are likely.' },
      ],
      watch: ['A policy rate above inflation would change this reading.'],
      gaps: [],
    };
    // Policy review Options (src/utils/reviewOptions.ts): one usable option resting on [1], one sentence with an invented number.
    const options = {
      options: [
        {
          title: 'Hold the policy rate and guide expectations',
          lever: 'monetary',
          how: 'Keep the rate where it is and say what would change it.',
          effect: 'Inflation should drift down. It falls to 2.1% next year.',
          timeToEffect: 'a year or two',
          tradeoffs: 'Slower credit growth.',
          whoBears: 'Borrowers.',
          mustBeTrue: 'Expectations stay anchored.',
          risks: 'A commodity shock.',
          refs: [1, 99],
          views: { cb: 'Supports holding.' },
        },
      ],
      ranking: 'Only one option fits the constraints.',
      gaps: ['Government debt is missing, so the fiscal lever is not assessed.'],
    };
    const text = String(init.body || '');
    const isExplain = text.includes('explaining a number or a pattern');
    const isOptions = text.includes('sovereign research council advising');
    const content = JSON.stringify(isOptions ? options : isExplain ? explain : brief);
    if (JSON.parse(String(init.body || '{}')).stream) {
      // Streamed the way Ollama does: one JSON line per piece, then done.
      const lines = content.match(/.{1,40}/g).map((c) => JSON.stringify({ message: { role: 'assistant', content: c }, done: false }) + '\n');
      lines.push(JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) + '\n');
      return new Response(new ReadableStream({ start(ctl) { for (const l of lines) ctl.enqueue(new TextEncoder().encode(l)); ctl.close(); } }), { status: 200 });
    }
    return json({ message: { role: 'assistant', content } });
  }
  // Brazil's central bank: IPCA over 12 months, as it answered on 2026-11-05.
  if (url.startsWith('https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/')) {
    return json([{ data: '01/07/2026', valor: '4.44' }, { data: '01/08/2026', valor: '4.22' }, { data: '01/09/2026', valor: '4.58' }]);
  }
  // GDELT: always refuses for too many requests, as it did on Sam's Mac (2026-11-05).
  if (url.includes('api.gdeltproject.org')) return new Response('Please limit requests to one every 5 seconds', { status: 429 });
  // FRED API: answers for Mexico only, refuses South Africa so the CSV fallback is exercised.
  if (url.includes('api.stlouisfed.org')) {
    if (url.includes('IRLTLT01MXM156N')) {
      return json({ observations: [{ date: '2026-09-01', value: '9.35' }, { date: '2026-08-01', value: '9.28' }] });
    }
    return json({ error_code: 400, error_message: 'Bad Request' }, 400);
  }
  // FRED CSV download (no key).
  if (url.includes('fredgraph.csv')) {
    const id = new URL(url).searchParams.get('id');
    return new Response(`observation_date,${id}\n2026-07-01,8.60\n2026-08-01,8.71\n2026-09-01,.\n`, { status: 200 });
  }
  // Brazil Treasury, Tesouro Direto.
  if (url.includes('tesourotransparente.gov.br')) return new Response(TESOURO_CSV, { status: 200 });
  // Turkey, CBRT EVDS3: the key must arrive in the "key" header and never in the URL.
  if (url.includes('evds3.tcmb.gov.tr')) {
    if (!headers.has('key') || /[?&]key=/i.test(url)) return json({ error: "Required request header 'key' is not present" }, 403);
    return json({ totalCount: 2, items: [{ Tarih: '29-10-2026', TP_TEST_Y10: '31.85' }, { Tarih: '30-10-2026', TP_TEST_Y10: '31.92' }] });
  }
  // World Bank QEDS (source 22) and IDS (source 6): answer for Indonesia only.
  if (url.includes('api.worldbank.org') && url.includes('/IDN/')) {
    if (url.includes('source=22')) {
      const v = { '03': 3.1e9, '36': 2.4e9, '69': 4.0e9, '0912': 1.5e9 };
      return json([
        { page: 1, pages: 1, per_page: 200, total: 8 },
        ...[Object.entries(v).flatMap(([k, val]) => [
          { indicator: { id: `DT.AMT.DECT.CD.GG.${k}` }, countryiso3code: 'IDN', date: '2026Q2', value: val },
          { indicator: { id: `DT.AMT.DECT.CD.GG.${k}` }, countryiso3code: 'IDN', date: '2026Q1', value: val / 2 },
        ])],
      ]);
    }
    if (url.includes('/sources/6/')) {
      const rec = (series, year, value) => ({
        variable: [
          { concept: 'Country', id: 'IDN' },
          { concept: 'Series', id: series },
          { concept: 'Counterpart-Area', id: 'WLD' },
          { concept: 'Time', id: `YR${year}` },
        ],
        value,
      });
      return json({
        page: 1,
        source: {
          id: '6',
          data: [rec('DT.TDS.DPPG.CD', 2027, 25276253138.8), rec('DT.AMT.DPPG.CD', 2027, 17e9), rec('DT.TDS.DPPG.CD', 2028, 29924084687.9)],
        },
      });
    }
  }
  // BIS central bank policy rates: the live daily rows (UK, Mexico, US, euro area) and the monthly fixture.
  if (url.includes('stats.bis.org') && url.includes('/WS_CBPOL/D.')) return new Response(CBPOL_DAILY_LIVE, { status: 200 });
  if (url.includes('stats.bis.org') && url.includes('/WS_CBPOL/M.')) return new Response(CBPOL_MONTHLY, { status: 200 });
  // BIS debt securities (CSV): answer for Indonesia (ID) only, values from the live 2026-11-04 answers.
  if (url.includes('stats.bis.org') && url.includes('/WS_DEBT_SEC2_PUB/Q.ID.')) {
    const head =
      'FREQ,ISSUER_RES,ISSUER_NAT,ISSUER_BUS_IMM,ISSUER_BUS_ULT,MARKET,ISSUE_TYPE,ISSUE_CUR_GROUP,ISSUE_CUR,ISSUE_OR_MAT,ISSUE_RE_MAT,ISSUE_RATE,ISSUE_RISK,ISSUE_COL,MEASURE,DECIMALS,UNIT_MEASURE,UNIT_MULT,COLLECTION,TIME_FORMAT,TIME_PERIOD,OBS_VALUE,OBS_STATUS,OBS_PRE_BREAK,OBS_CONF';
    const r = (cur, re, v) => `Q,ID,3P,2,1,C,A,${cur},TO1,A,${re},A,A,A,I,0,USD,6,,,2026-Q2,${v},A,,F`;
    return new Response([head, r('A', 'A', '88044'), r('A', 'U', '3615')].join('\n'), { status: 200 });
  }
  if (url.includes('stats.bis.org') && url.includes('/WS_NA_SEC_DSS/Q.N.ID.')) {
    const head =
      'FREQ,ADJUSTMENT,REF_AREA,COUNTERPART_AREA,REF_SECTOR,COUNTERPART_SECTOR,CONSOLIDATION,ACCOUNTING_ENTRY,STO,INSTR_ASSET,MATURITY,EXPENDITURE,UNIT_MEASURE,CURRENCY_DENOM,VALUATION,PRICES,TRANSFORMATION,CUST_BREAKDOWN,TITLE,UNIT_MULT,TIME_PERIOD,OBS_VALUE,OBS_STATUS';
    return new Response(`${head}\nQ,N,ID,XW,S13,S1,N,L,LE,F3,T,_Z,USD,_T,N,V,N,_T,"Indonesia - Debt sec, issued by gen govt",9,2026-Q1,507.4643714097,A\n`, { status: 200 });
  }
  // World Bank WDI trade shares (one call per indicator, all countries): Turkey and Egypt only.
  if (url.includes('api.worldbank.org') && /\/indicator\/(TM\.VAL\.FUEL|TX\.VAL\.FUEL|NE\.IMP\.GNFS|NE\.EXP\.GNFS)/.test(url)) {
    const code = url.match(/\/indicator\/([A-Z.]+)/)[1];
    const v = { 'TM.VAL.FUEL.ZS.UN': [20, 15], 'TX.VAL.FUEL.ZS.UN': [5, 10], 'NE.IMP.GNFS.ZS': [35, 25], 'NE.EXP.GNFS.ZS': [30, 15] }[code];
    const row = (iso, value) => ({ indicator: { id: code }, countryiso3code: iso, date: '2025', value });
    return json([{ page: 1, pages: 1, total: 2 }, [row('TUR', v[0]), row('EGY', v[1])]]);
  }
  // WITS partner shares: Turkey 2023 only (China exports 2.5%, Russia exports 4%, Russia imports 12.6%).
  if (url.includes('wits.worldbank.org')) {
    const m = url.match(/reporter\/(\w+)\/year\/(\d+)\/partner\/(\w+)\/product\/all\/indicator\/([A-Z-]+)/);
    const val = m && m[1] === 'tur' && m[2] === '2023' ? { 'chn:XPRT-PRTNR-SHR': '2.5', 'rus:XPRT-PRTNR-SHR': '4', 'rus:MPRT-PRTNR-SHR': '12.5977' }[`${m[3]}:${m[4]}`] : undefined;
    if (!val) return new Response('not found', { status: 404 });
    return new Response(`<message:StructureSpecificData><message:DataSet><Series FREQ="A" REPORTER="TUR"><Obs TIME_PERIOD="2023" OBS_VALUE="${val}" DATASOURCE="WITS-CMT" /></Series></message:DataSet></message:StructureSpecificData>`, { status: 200 });
  }
  // BIS real effective exchange rates: South Africa only. 120 months at 100, latest month 85 (15% weak).
  if (url.includes('stats.bis.org') && url.includes('/WS_EER/M.R.B.ZA/')) {
    const head = 'FREQ,EER_TYPE,EER_BASKET,REF_AREA,UNIT_MEASURE,TIME_FORMAT,COLLECTION,TITLE_TS,TIME_PERIOD,OBS_VALUE,OBS_STATUS,OBS_CONF,OBS_PRE_BREAK';
    const lines = [];
    for (let i = 0; i < 120; i++) {
      const y = 2016 + Math.floor((i + 9) / 12);
      const m = ((i + 9) % 12) + 1;
      lines.push(`M,R,B,ZA,882,,A,South Africa - Real - Broad (64 economies),${y}-${String(m).padStart(2, '0')},${i === 119 ? '85' : '100'},A,F,`);
    }
    return new Response([head, ...lines].join('\n'), { status: 200 });
  }
  // Frankfurter (ECB reference rates): USD/ZAR alternating 18.0 and 18.18 over 60 trading days.
  if (url.includes('api.frankfurter.dev') && url.includes('to=ZAR')) {
    const rates = {};
    for (let i = 0; i < 60; i++) rates[`2026-${String(8 + Math.floor(i / 21)).padStart(2, '0')}-${String((i % 21) + 1).padStart(2, '0')}`] = { ZAR: i % 2 ? 18.18 : 18.0 };
    return json({ amount: 1, base: 'USD', start_date: '2026-08-01', end_date: '2026-10-21', rates });
  }
  // Full history for Mexico (src/utils/officialHistory.ts): World Bank reserves in months of imports
  // with a blank year, and the IMF WEO debt run with a projection year.
  if (url.includes('api.worldbank.org/v2/country/MEX/indicator/FI.RES.TOTL.MO') && url.includes('date=1960:')) {
    return json([{ page: 1, pages: 1, per_page: 200, total: 3 }, [
      { date: '2024', value: 3.9 }, { date: '2023', value: null }, { date: '2022', value: 4.1 },
    ]]);
  }
  if (url.includes('imf.org/external/datamapper/api/v1/GGXWDG_NGDP/MEX')) {
    return json({ values: { GGXWDG_NGDP: { MEX: { 2020: 58.5, 2021: 56.9, 2030: 61.2 } } } });
  }
  // The app's "are the feeds reachable" probe (Offline indicator). OFFLINE_PROBE=down plays offline.
  if (url === 'https://api.worldbank.org/v2/country?format=json&per_page=1') {
    if (process.env.OFFLINE_PROBE === 'down') throw new TypeError('offline: api.worldbank.org');
    return json([{ page: 1 }, []]);
  }
  // NY Fed effective federal funds rate.
  if (url.includes('markets.newyorkfed.org') && url.includes('/effr/')) {
    return json({ refRates: [{ effectiveDate: '2026-11-03', type: 'EFFR', percentRate: 3.83 }] });
  }
  throw new TypeError(`offline: ${new URL(url).host}`);
};
