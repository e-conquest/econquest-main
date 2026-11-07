/**
 * IMF SDMX 3.0 answers shaped like api.imf.org's SDMX-JSON 2.0 messages, for Brazil. Codes are
 * made up for the test; the app finds codes by their IMF names, so the test checks that path.
 */

const urn = (cl: string) => `urn:sdmx:org.sdmx.infomodel.codelist.Codelist=IMF.STA:${cl}(1.0.0)`;

export function imfStructureJson(flow: 'IL' | 'BOP'): unknown {
  if (flow === 'IL') {
    return {
      data: {
        dataStructures: [
          {
            id: 'DSD_IL',
            dataStructureComponents: {
              dimensionList: {
                dimensions: [
                  { id: 'COUNTRY', position: 0, localRepresentation: { enumeration: urn('CL_COUNTRY') } },
                  { id: 'INDICATOR', position: 1, localRepresentation: { enumeration: urn('CL_IL_INDICATOR') } },
                  { id: 'UNIT', position: 2 },
                  { id: 'FREQUENCY', position: 3 },
                ],
                timeDimension: { id: 'TIME_PERIOD' },
              },
            },
          },
        ],
        codelists: [
          { id: 'CL_COUNTRY', codes: [{ id: 'BRA', name: 'Brazil' }] },
          {
            id: 'CL_IL_INDICATOR',
            codes: [
              { id: 'TRXG', names: { en: 'Reserve assets excluding gold' } },
              { id: 'RSDR', names: { en: 'Reserve assets, SDR holdings' } },
              { id: 'FCR', names: { en: 'Foreign currency reserves' } },
              { id: 'TRA', names: { en: 'Reserve assets, Total' } },
            ],
          },
        ],
      },
    };
  }
  return {
    data: {
      dataStructures: [
        {
          id: 'DSD_BOP',
          dataStructureComponents: {
            dimensionList: {
              dimensions: [
                { id: 'COUNTRY', position: 0 },
                { id: 'BOP_ACCOUNTING_ENTRY', position: 1 },
                { id: 'INDICATOR', position: 2, localRepresentation: { enumeration: urn('CL_BOP_INDICATOR') } },
                { id: 'UNIT', position: 3 },
                { id: 'FREQUENCY', position: 4 },
              ],
            },
          },
        },
      ],
      codelists: [
        {
          id: 'CL_BOP_INDICATOR',
          codes: [
            { id: 'CAG', name: 'Current account, Goods' },
            { id: 'CAXEF', name: 'Current account excluding exceptional financing' },
            { id: 'CAB', name: 'Current account, Total' },
            { id: 'G', name: 'Goods' },
            { id: 'GS', name: 'Goods and services' },
          ],
        },
      ],
    },
  };
}

type Row = { dims: string[]; obs: Array<[string, number]> };

function message(dimIds: string[], names: Record<string, Record<string, string>>, rows: Row[]): unknown {
  const values = dimIds.map((d, i) => [...new Set(rows.map((r) => r.dims[i]))]);
  const periods = [...new Set(rows.flatMap((r) => r.obs.map((o) => o[0])))];
  const series: Record<string, unknown> = {};
  for (const r of rows) {
    const k = r.dims.map((v, i) => values[i].indexOf(v)).join(':');
    series[k] = { attributes: [0], observations: Object.fromEntries(r.obs.map(([p, v]) => [String(periods.indexOf(p)), [String(v)]])) };
  }
  return {
    data: {
      structures: [
        {
          dimensions: {
            series: dimIds.map((d, i) => ({ id: d, values: values[i].map((v) => ({ id: v, name: names[d]?.[v] ?? v })) })),
            observation: [{ id: 'TIME_PERIOD', values: periods.map((p) => ({ value: p })) }],
          },
          attributes: { series: [{ id: 'SCALE', values: [{ id: '6', name: 'Millions' }] }] },
        },
      ],
      dataSets: [{ series }],
    },
  };
}

const months = (from: [number, number], n: number, v: (i: number) => number): Array<[string, number]> =>
  Array.from({ length: n }, (_, i) => {
    const m = from[1] - 1 + i;
    return [`${from[0] + Math.floor(m / 12)}-M${String((m % 12) + 1).padStart(2, '0')}`, v(i)];
  });

const quarters = (vals: number[]): Array<[string, number]> => ['2024-Q3', '2024-Q4', '2025-Q1', '2025-Q2'].map((p, i) => [p, vals[i]]);

const NAMES = {
  COUNTRY: { BRA: 'Brazil' },
  UNIT: { USD: 'US dollar', XDC: 'Domestic currency' },
  FREQUENCY: { M: 'Monthly', Q: 'Quarterly' },
  BOP_ACCOUNTING_ENTRY: { NETCD: 'Net (credits less debits)', DB: 'Debit', CD: 'Credit' },
  INDICATOR: { TRA: 'Reserve assets, Total', CAB: 'Current account, Total', GS: 'Goods and services' },
};

export function imfDataJson(flow: 'IL' | 'BOP', iso3: string, indicator?: string): unknown {
  if (flow === 'IL') {
    // 2024-08 .. 2025-09: Sep 2024 = 337,000, Sep 2025 = 345,000 (USD millions).
    return message(['COUNTRY', 'INDICATOR', 'UNIT', 'FREQUENCY'], NAMES, [
      { dims: [iso3, 'TRA', 'USD', 'M'], obs: months([2024, 8], 14, (i) => (i === 1 ? 337000 : i === 13 ? 345000 : 340000)) },
      { dims: [iso3, 'TRA', 'XDC', 'M'], obs: months([2024, 8], 14, () => 1900000) },
    ]);
  }
  const ids = ['COUNTRY', 'BOP_ACCOUNTING_ENTRY', 'INDICATOR', 'UNIT', 'FREQUENCY'];
  if (indicator === 'CAB') {
    return message(ids, NAMES, [
      { dims: [iso3, 'NETCD', 'CAB', 'USD', 'Q'], obs: quarters([-12000, -15000, -15000, -18000]) },
      { dims: [iso3, 'CD', 'CAB', 'USD', 'Q'], obs: quarters([90000, 90000, 90000, 90000]) },
    ]);
  }
  return message(ids, NAMES, [
    { dims: [iso3, 'DB', 'GS', 'USD', 'Q'], obs: quarters([100000, 100000, 100000, 100000]) },
    { dims: [iso3, 'CD', 'GS', 'USD', 'Q'], obs: quarters([95000, 95000, 95000, 95000]) },
    { dims: [iso3, 'NETCD', 'GS', 'USD', 'Q'], obs: quarters([-5000, -5000, -5000, -5000]) },
  ]);
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

/** A fake fetch for api.imf.org and the WEO DataMapper; records each URL asked. */
export function imfFetch(urls: string[] = []) {
  return async (url: string): Promise<Response> => {
    urls.push(url);
    if (url.includes('/structure/dataflow/IMF.STA/COFER/')) return json(coferStructureJson());
    if (url.includes('/data/dataflow/IMF.STA/COFER/')) return json(coferDataJson());
    const s = /\/structure\/dataflow\/IMF\.STA\/(IL|BOP)\//.exec(url);
    if (s) return json(imfStructureJson(s[1] as 'IL' | 'BOP'));
    const d = /\/data\/dataflow\/IMF\.STA\/(IL|BOP)\/\+\/([^?]+)/.exec(url);
    if (d) {
      const key = d[2].split('.');
      const iso3 = key[0];
      return json(d[1] === 'IL' ? imfDataJson('IL', iso3) : imfDataJson('BOP', iso3, key[2]));
    }
    if (url.includes('datamapper/api/v1/NGDPD/BRA')) return json({ values: { NGDPD: { BRA: { '2024': 2200, '2025': 2400 } } } });
    return new Response('not found', { status: 404 });
  };
}

// ---- COFER (world only) ----------------------------------------------------------------------

export function coferStructureJson(): unknown {
  return {
    data: {
      dataStructures: [
        {
          id: 'DSD_COFER',
          dataStructureComponents: {
            dimensionList: {
              dimensions: [
                { id: 'COUNTRY', position: 0, localRepresentation: { enumeration: urn('CL_COFER_COUNTRY') } },
                { id: 'INDICATOR', position: 1, localRepresentation: { enumeration: urn('CL_COFER_INDICATOR') } },
                { id: 'UNIT', position: 2 },
                { id: 'FREQUENCY', position: 3 },
              ],
            },
          },
        },
      ],
      codelists: [
        { id: 'CL_COFER_COUNTRY', codes: [{ id: 'G110', name: 'Advanced Economies' }, { id: 'G001', name: 'World' }] },
        { id: 'CL_COFER_INDICATOR', codes: [{ id: 'AFXR', name: 'Allocated reserves' }, { id: 'SH_USD', name: 'Shares of U.S. dollars' }] },
      ],
    },
  };
}

const COFER_NAMES = {
  UNIT: { USD: 'US dollar', PT: 'Percent' },
  FREQUENCY: { Q: 'Quarterly' },
  INDICATOR: {
    SH_USD: 'Shares of U.S. dollars',
    SH_EUR: 'Shares of euros',
    SH_CNY: 'Shares of Chinese renminbi',
    SH_JPY: 'Shares of Japanese yen',
    SH_GBP: 'Shares of pounds sterling',
    AFXR: 'Allocated reserves',
    CL_USD: 'Allocated reserves, claims in U.S. dollars',
    CL_JPY: 'Allocated reserves, claims in Japanese yen',
  },
};

const q8 = ['2024-Q1', '2024-Q2', '2024-Q3', '2024-Q4', '2025-Q1', '2025-Q2'];
const qs = (v: (i: number) => number): Array<[string, number]> => q8.map((p, i) => [p, v(i)]);

/** withShares false: only value series, so shares are worked out as claims over allocated reserves. */
export function coferDataJson(withShares = true): unknown {
  const ids = ['COUNTRY', 'INDICATOR', 'UNIT', 'FREQUENCY'];
  if (withShares) {
    return message(ids, COFER_NAMES, [
      { dims: ['G001', 'SH_USD', 'PT', 'Q'], obs: qs((i) => (i === 1 ? 58.2 : i === 5 ? 56.3 : 57)) },
      { dims: ['G001', 'SH_EUR', 'PT', 'Q'], obs: qs(() => 20.1) },
      { dims: ['G001', 'SH_CNY', 'PT', 'Q'], obs: qs(() => 2.1) },
      { dims: ['G001', 'SH_JPY', 'PT', 'Q'], obs: qs((i) => (i === 1 ? 5.6 : i === 5 ? 5.9 : 5.7)) },
      { dims: ['G001', 'SH_GBP', 'PT', 'Q'], obs: qs(() => 4.7) },
      { dims: ['G001', 'AFXR', 'USD', 'Q'], obs: qs(() => 12000000) },
    ]);
  }
  return message(ids, COFER_NAMES, [
    { dims: ['G001', 'AFXR', 'USD', 'Q'], obs: qs((i) => (i === 5 ? 12000000 : 11000000)) },
    { dims: ['G001', 'CL_USD', 'USD', 'Q'], obs: qs((i) => (i === 5 ? 6756000 : 6400000)) },
    { dims: ['G001', 'CL_JPY', 'USD', 'Q'], obs: qs(() => 660000) },
  ]);
}
