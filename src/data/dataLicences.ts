/**
 * Licence register: each outside source the app reads, what its own terms say about showing the
 * figures to other people and about commercial use, and the attribution it asks for.
 *
 * Every quote below was read on the source's own terms page on the date in `checked`. Where a page
 * could not be read, or the terms do not answer the question, the row says so and is marked
 * `not_verified`: nothing here is filled in from memory. This is a research note, not legal advice;
 * a licence question that matters for a client or a sale should go to the provider in writing.
 *
 * docs/DATA_LICENCES.md is generated from this file (`npm run docs:licences`) and a test fails if
 * the two differ, so the in-app register (Menu > About & data licences) and the document never drift.
 */

export type LicenceShare = 'allowed' | 'restricted' | 'unclear';

export const LICENCE_SHARE_LABEL: Record<LicenceShare, string> = {
  allowed: 'Free sharing allowed',
  restricted: 'Do not pass on',
  unclear: 'Sharing unclear',
};

export type LicenceStatus = 'open' | 'conditions' | 'permission' | 'not_verified';

export interface LicenceRow {
  id: string;
  name: string;
  /** What the app reads from it (matches docs/DATA_SOURCES.md). */
  usedFor: string;
  terms: { label: string; url: string }[];
  status: LicenceStatus;
  /** Showing the figures to people outside your own use (clients, colleagues, a published note). */
  display: string;
  commercial: string;
  /** The attribution to print beside the figures, as the source asks for it. */
  attribution: string;
  /** Short verbatim quotes from the terms page(s). */
  quotes: string[];
  /** What is unclear or needs action. Rows with a flag are listed in "Open questions". */
  flag?: string;
  /** Free, non-commercial sharing of the figures with other people (an open-source research note, a
   * public chart). Judged from the quotes above; 'unclear' when the terms do not settle it. */
  share: LicenceShare;
  shareNote: string;
  checked: string;
}

export const LICENCE_STATUS_LABEL: Record<LicenceStatus, string> = {
  open: 'Open with attribution',
  conditions: 'Allowed with conditions',
  permission: 'Permission needed for client or commercial use',
  not_verified: 'Terms not confirmed',
};

export const LICENCE_STATUS_HELP: Record<LicenceStatus, string> = {
  open: 'The terms allow redistribution and commercial use as long as the source is credited.',
  conditions: 'Display to others is allowed, but the terms add conditions beyond a credit (a notice, no extra charge, no changes).',
  permission: 'Your own research use is fine; showing the figures to clients, publishing them or using them commercially needs the provider\'s written permission (or a paid licence).',
  not_verified: 'The terms page could not be read or does not answer the question. Treat as personal research use only until confirmed.',
};

const D = '2026-11-06';

export const DATA_LICENCES: LicenceRow[] = [
  {
    id: 'worldbank',
    name: 'World Bank indicators and debt statistics (IDS, QEDS)',
    usedFor: 'Reserves, current account, external debt, political stability, trade shares; external debt falling due; who holds public external debt and terms of new loans (IDS)',
    terms: [{ label: 'Terms of Use for Datasets', url: 'https://www.worldbank.org/ext/en/legal/terms-conditions/datasets' }],
    status: 'open',
    display: 'Allowed: the data may be shared with third parties under CC BY 4.0.',
    commercial: 'Allowed (CC BY 4.0 sets no commercial limit).',
    attribution: 'The World Bank: <dataset name>: <data source>, e.g. "The World Bank: World Development Indicators".',
    quotes: [
      'Unless specifically labeled otherwise, these Datasets are provided to you under a Creative Commons Attribution 4.0 International License (CC BY 4.0), with the additional terms below.',
      'You may extract, download, and make copies of the data contained in the Datasets, and you may share that data with third parties according to these terms of use.',
      'Some datasets and indicators are provided by third parties, and may not be redistributed or reused without the consent of the original data provider',
    ],
    flag: 'Third-party indicators inside World Bank datasets can carry their own terms (stated in each indicator\'s metadata); the per-dataset licence for IDS and QEDS in the Data Catalog was not read.',
    share: 'allowed',
    shareNote: 'CC BY 4.0 allows sharing with credit.',
    checked: D,
  },
  {
    id: 'pinksheet',
    name: 'World Bank Pink Sheet (commodity prices)',
    usedFor: 'Monthly commodity prices: oil, gas, metals, farm goods',
    terms: [
      { label: 'Terms of Use for Datasets', url: 'https://www.worldbank.org/ext/en/legal/terms-conditions/datasets' },
      { label: 'Data Catalog', url: 'https://datacatalog.worldbank.org' },
    ],
    status: 'not_verified',
    display: 'Likely covered by the World Bank dataset terms (CC BY 4.0), but the Pink Sheet\'s own catalog entry could not be read.',
    commercial: 'Not confirmed.',
    attribution: 'The World Bank: Commodity Price Data (The Pink Sheet).',
    quotes: [],
    flag: 'Read the Pink Sheet licence field in the World Bank Data Catalog before showing commodity prices to clients. Some prices in it come from third parties.',
    share: 'unclear',
    shareNote: 'Catalog licence not read.',
    checked: D,
  },
  {
    id: 'imf',
    name: 'IMF (World Economic Outlook, Fiscal Monitor, International Liquidity, Balance of Payments, COFER)',
    usedFor: 'Debt/GDP, inflation, growth, primary balance, output gap, reserves, current account, imports, COFER shares',
    terms: [{ label: 'Copyright and Usage (Special Terms for Statistical Data)', url: 'https://www.imf.org/en/About/copyright-and-terms' }],
    status: 'permission',
    display: 'Allowed with attribution: the IMF lets users publish and distribute its Data.',
    commercial: 'Needs permission: email copyright@imf.org. Systematic or bulk automated download also needs permission.',
    attribution: 'Source: International Monetary Fund, <database name>, <link to the dataset>.',
    quotes: [
      'Users may download, extract, copy, create derivative works, publish, distribute, and use Data obtained from IMF Sites subject to these conditions:',
      'Distributed or reproduced Data must appear accurately with attribution to the IMF as the source, e.g. "Source: International Monetary Fund, Database Name, <<link to the dataset>>."',
      'For any potential commercial reuse of IMF Data, email copyright@imf.org to request permission.',
      'The IMF prohibits bulk download of information by automated technology without explicit permission',
    ],
    flag: 'Commercial reuse (for example a paid service or client deliverables) needs the IMF\'s permission. Whether the app\'s "Download all country data" counts as bulk automated download is not addressed by the terms. COFER and Fiscal Monitor are not named, but fall under "statistical data ... that explicitly identify the International Monetary Fund as the source".',
    share: 'allowed',
    shareNote: 'IMF Data may be published and distributed with attribution; only commercial reuse needs permission.',
    checked: D,
  },
  {
    id: 'comtrade',
    name: 'UN Comtrade',
    usedFor: 'Goods trade by partner and export mix by HS chapter',
    terms: [
      { label: 'Policy on Comtrade data use', url: 'https://uncomtrade.org/docs/policy-on-comtrade-data-use/' },
      { label: 'Re-dissemination of data (FAQ)', url: 'https://uncomtrade.org/docs/re-dissemination-of-data/' },
    ],
    status: 'permission',
    display: 'Internal use only. Free, not-for-profit visualisation is exempt; a paid report or dashboard is exempt only below 100,000 original records.',
    commercial: 'Paid, subscription or otherwise monetised use counts as commercial; commercial APIs need a premium subscription.',
    attribution: 'Source: UN Comtrade.',
    quotes: [
      'UN Comtrade data are provided for internal use only and may not be re-disseminated in any form without UNSD\'s permission.',
      'Internal use explicitly excludes data dissemination to any entity outside the institutional unit.',
      'Free visualization and analytics applications are exempt.',
      'A paid report or chargeable dashboard is exempt when the database used for re-dissemination contains fewer than 100,000 original UN Comtrade records.',
      'Use "Source: UN Comtrade."',
    ],
    flag: 'The policy page and the FAQ read differently (blanket "internal use only" against the FAQ\'s exemptions). The app stores a few hundred rows per country, well under 100,000, but confirm with comtrade@un.org before a paid product.',
    share: 'allowed',
    shareNote: 'The FAQ exempts free, not-for-profit visualisation and analytics applications.',
    checked: D,
  },
  {
    id: 'wits',
    name: 'WITS (World Integrated Trade Solution)',
    usedFor: 'Export and import shares with China and Russia',
    terms: [{ label: 'WITS FAQ, Databases (usage conditions)', url: 'https://wits.worldbank.org/faqs.html' }],
    status: 'permission',
    display: 'The trade shares come from UN Comtrade data, which WITS says is for internal use only.',
    commercial: 'Needs UNSD\'s written permission (see UN Comtrade).',
    attribution: 'Source: UN Comtrade via WITS (World Bank).',
    quotes: [
      'These data are copyrighted by the United Nations. They are made available for internal use only and may not be re-disseminated in any form without written permission of the United Nations Statistics Division (UNSD).',
    ],
    flag: 'Same position as UN Comtrade. Where Comtrade has the shares the app already uses Comtrade instead.',
    share: 'restricted',
    shareNote: 'WITS states its Comtrade-derived data is for internal use only.',
    checked: D,
  },
  {
    id: 'bis',
    name: 'BIS statistics (policy rates, real exchange rates, debt securities, credit cycle)',
    usedFor: 'Central bank policy rates and their history, real exchange rates, government debt securities, credit-to-GDP gaps, debt service ratios and residential property prices',
    terms: [
      { label: 'Terms of permitted use of BIS statistics', url: 'https://data.bis.org/help/legal' },
      { label: 'BIS terms and conditions', url: 'https://www.bis.org/terms_conditions.htm' },
    ],
    status: 'conditions',
    display: 'Allowed if the BIS is cited as the source.',
    commercial: 'Allowed, provided including the statistics adds no extra charge for subscribers or users.',
    attribution: 'Source: BIS (Bank for International Settlements), <dataset>, e.g. "Source: BIS central bank policy rates".',
    quotes: [
      'The use of the statistics is unrestricted, provided that:',
      'if the statistics are reproduced, the BIS must be cited in your publication or product as the source of the statistics;',
      'if the statistics will be used in a commercial publication or product, their inclusion in the publication or product will not result in any additional charge to subscribers or other users;',
    ],
    flag: 'In a paid product the BIS figures must not be what is charged for. The general bis.org terms allow redistribution "for non-commercial purposes", which the statistics terms override for statistics.',
    share: 'allowed',
    shareNote: 'Use is unrestricted with the BIS cited.',
    checked: D,
  },
  {
    id: 'ecb',
    name: 'ECB statistics: euro reference rates (through Frankfurter), Survey of Professional Forecasters',
    usedFor: 'Daily exchange rate history per US dollar since 1999; FX volatility; last year\'s closing rate for the year-to-date move; Survey of Professional Forecasters inflation expectations (ECB Data Portal, dataset SPF, quarterly world series)',
    terms: [
      { label: 'ECB statistics reuse policy', url: 'https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html' },
      { label: 'Frankfurter licence', url: 'https://frankfurter.dev/license/' },
    ],
    status: 'open',
    display: 'Allowed, free of charge, if the source is quoted and the statistics are not modified.',
    commercial: 'Allowed ("irrespective of any subsequent commercial or non-commercial use").',
    attribution: 'Source: ECB statistics (via Frankfurter). Volatility and year-to-date moves are the app\'s own calculations from them.',
    quotes: [
      'All publicly available ESCB statistics may be reused free of charge on the condition that the source is quoted (e.g. "Source: ECB statistics.")',
      'Frankfurter doesn\'t own the rates, so it can\'t give you rights the provider doesn\'t. If a provider publishes terms of use, they apply.',
    ],
    flag: 'Derived figures (volatility, year-to-date change) should be labelled as the app\'s calculation so they are not presented as ECB statistics.',
    share: 'allowed',
    shareNote: 'Free reuse with the source quoted and the figures unmodified.',
    checked: D,
  },
  {
    id: 'erapi',
    name: 'ExchangeRate-API open access (open.er-api.com)',
    usedFor: 'Spot exchange rates against the dollar',
    terms: [
      { label: 'Free / open access docs', url: 'https://www.exchangerate-api.com/docs/free' },
      { label: 'Terms of use', url: 'https://www.exchangerate-api.com/terms' },
    ],
    status: 'permission',
    display: 'Not allowed to redistribute; rates may be used for your own end purposes with a credit link on the page.',
    commercial: 'Allowed for your own currency conversion, not in a product that passes rates on to others.',
    attribution: 'Rates By Exchange Rate API (linked to https://www.exchangerate-api.com) on every page that uses the rates.',
    quotes: [
      'You\'re welcome to cache the data we respond with and to use it for either personal or commercial currency conversion purposes. You are, however, not allowed to re-distribute it.',
      'ExchangeRate-API data may only be used for your end purposes and not in any product or service that offers programmatic or automatic access to exchange rate data.',
      'Use of the exchange rates we provide for actual transactions or as financial data is explicitly not recommended.',
    ],
    flag: 'Spot rates shown to clients or in exports would be redistribution. Options: switch spot FX to the ECB rates (Frankfurter, already the backup) for anything shared, or ask ExchangeRate-API in writing.',
    share: 'restricted',
    shareNote: 'The terms forbid redistributing the rates.',
    checked: D,
  },
  {
    id: 'nyfed',
    name: 'New York Fed markets data',
    usedFor: 'Fed funds, SOFR, reverse repo; Global Supply Chain Pressure Index (GSCPI, a factor in the global shock scenarios and a world series; built by the New York Fed from transport and manufacturing data)',
    terms: [{ label: 'Terms of Use', url: 'https://www.newyorkfed.org/privacy/termsofuse' }],
    status: 'conditions',
    display: 'Allowed for personal or business purposes; reference rates (SOFR, EFFR and others) must carry the New York Fed\'s notice.',
    commercial: 'Allowed for business purposes; no general ban on data.',
    attribution: '"© <year> Federal Reserve Bank of New York. Content from the New York Fed subject to the Terms of Use at newyorkfed.org." For SOFR and EFFR also: "The <rate> is subject to the Terms of Use posted at newyorkfed.org. The New York Fed is not responsible for publication of the <rate> by <publisher>, does not sanction or endorse any particular republication, and has no liability for your use."',
    quotes: [
      'The New York Fed grants you a non-exclusive license, subject to the Terms, to use, copy, and distribute Content for your personal or business purposes.',
      'None of the Content is investment advice.',
    ],
    flag: 'Exports that include SOFR or the fed funds rate should carry the reference-rate notice above.',
    share: 'allowed',
    shareNote: 'The licence covers use, copying and distribution, with the notice for reference rates.',
    checked: D,
  },
  {
    id: 'fred',
    name: 'FRED (St. Louis Fed): 10Y government yields from the OECD; St. Louis Fed and Chicago Fed stress indices; US inflation expectations',
    usedFor: 'US data as first published and as known on a past day (ALFRED vintages of GDPC1 real GDP, CPIAUCSL CPI and UNRATE unemployment, with your FRED API key; government statistics from BEA and BLS); US inflation expectations: 5- and 10-year breakevens and the 5y5y forward (T5YIE, T10YIE, T5YIFR, computed by the St. Louis Fed from US Treasury yields, labelled "Copyrighted: Citation Required") and the Cleveland Fed 1- and 10-year expected inflation (EXPINF1YR, EXPINF10YR, labelled "Public Domain: Citation Requested"); St. Louis Fed Financial Stress Index (STLFSI4, the default stress factor in the global shock scenarios; owned by the St. Louis Fed itself, labelled "Copyrighted: Citation Required"); Chicago Fed NFCI and adjusted NFCI (NFCI, ANFCI, alternative stress factors and world series; owned by the Federal Reserve Bank of Chicago, labelled "Copyrighted: Citation Required"); 10Y yields for the US, Mexico, South Africa, Japan, UK, Poland, Chile, India, Korea, Israel, Canada, Australia, New Zealand, Switzerland, the Nordics, Czechia, Hungary, Slovakia and 11 euro-area countries (all OECD series on FRED)',
    terms: [
      { label: 'FRED legal', url: 'https://fred.stlouisfed.org/legal/' },
      { label: 'FRED API terms', url: 'https://fred.stlouisfed.org/docs/api/terms_of_use.html' },
      { label: 'Example series: Mexico 10Y', url: 'https://fred.stlouisfed.org/series/IRLTLT01MXM156N' },
    ],
    status: 'permission',
    display: 'The series are labelled "Copyrighted: Citation Required" (owner: OECD). FRED\'s terms say to contact the data owner before any use beyond personal use, and that FRED cannot give that permission.',
    commercial: 'Unclear in FRED\'s own terms (one section allows reports to clients with attribution for citation-required series; others require the owner\'s permission).',
    attribution: 'OECD (year), Main Economic Indicators, long-term interest rates, retrieved from FRED, Federal Reserve Bank of St. Louis. With the FRED API key: "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis."',
    quotes: [
      'BEFORE USING DATA SERIES OWNED BY THIRD PARTIES FOR ANYTHING OTHER THAN YOUR OWN PERSONAL USE, YOU MUST CONTACT THE DATA OWNER TO OBTAIN PERMISSION.',
      'Data in this graph are copyrighted. Please review the copyright information in the series notes before sharing.',
      'This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.',
    ],
    flag: 'The yields belong to the OECD; FRED\'s terms conflict on client display. Settle it through the OECD\'s own licence (see the OECD row, not yet confirmed).',
    share: 'unclear',
    shareNote: 'The OECD owns the series; FRED says to ask the owner before any use beyond personal use.',
    checked: D,
  },
  {
    id: 'oecd',
    name: 'OECD leading indicators and consumer prices (via DBnomics)',
    usedFor: 'Composite leading indicator; headline CPI inflation',
    terms: [
      { label: 'OECD terms and conditions', url: 'https://www.oecd.org/en/about/terms-conditions.html' },
      { label: 'DBnomics legal terms', url: 'https://docs.db.nomics.world/legal-terms/' },
    ],
    status: 'not_verified',
    display: 'DBnomics passes on the OECD\'s own licence. The OECD terms page could not be read past its navigation, so the OECD data licence is not confirmed here.',
    commercial: 'Not confirmed.',
    attribution: 'OECD (year), <dataset name>, <data source>, via DBnomics (citation form quoted on FRED\'s OECD series notes).',
    quotes: [
      'Data distributed by DBnomics is subject to the same license and terms of use as its original source provider.',
      'All OECD data should be cited as follows: OECD (year), (dataset name), (data source) DOI or https://data-explorer.oecd.org/. (accessed on (date)).',
    ],
    flag: 'Read the OECD data licence on oecd.org in a browser (the page needs JavaScript) and update this row; the FRED yields depend on it too.',
    share: 'unclear',
    shareNote: 'The OECD data licence was not confirmed.',
    checked: D,
  },
  {
    id: 'eurostat',
    name: 'Eurostat HICP',
    usedFor: 'Monthly inflation for EU members (Poland on the defaults)',
    terms: [{ label: 'Eurostat copyright and reuse', url: 'https://ec.europa.eu/eurostat/about-us/policies/copyright' }],
    status: 'open',
    display: 'Allowed without a licence if Eurostat is named and any change to the data is stated.',
    commercial: 'Allowed for EU, EFTA and candidate countries (the app reads EU members only).',
    attribution: 'Source: Eurostat (prc_hicp_minr).',
    quotes: [
      'Eurostat has a policy of encouraging free re-use of its data, both for non-commercial and commercial purposes.',
      'when re-use involves modifications to the data or text, this must be stated clearly to the end user of the information.',
    ],
    share: 'allowed',
    shareNote: 'Free reuse with Eurostat named.',
    checked: D,
  },
  {
    id: 'cftc',
    name: 'CFTC Commitments of Traders',
    usedFor: 'Weekly currency futures positioning',
    terms: [{ label: 'CFTC web policy', url: 'https://www.cftc.gov/webpolicy/index.htm' }],
    status: 'open',
    display: 'Public domain.',
    commercial: 'Allowed.',
    attribution: 'Source: CFTC Commitments of Traders (acknowledgement requested).',
    quotes: [
      'Government information at the CFTC website is in the public domain. Public domain information may be freely distributed and copied, but it is requested that in any subsequent use the CFTC be given appropriate acknowledgement.',
    ],
    share: 'allowed',
    shareNote: 'Public domain.',
    checked: D,
  },
  {
    id: 'tic',
    name: 'US Treasury TIC (major foreign holders)',
    usedFor: 'Holdings of US Treasuries by country',
    terms: [
      { label: 'TIC system page', url: 'https://home.treasury.gov/data/treasury-international-capital-tic-system' },
      { label: 'Treasury site policies', url: 'https://home.treasury.gov/subfooter/site-policies-and-notices' },
    ],
    status: 'not_verified',
    display: 'No terms, licence or copyright statement was found on the TIC or Treasury site-policy pages.',
    commercial: 'Not stated.',
    attribution: 'Source: US Treasury, Treasury International Capital (TIC) system.',
    quotes: [],
    flag: 'Treasury does not state a licence for TIC. Its Fiscal Data site says its data is "free, without restriction" for commercial use, but that page does not cover TIC.',
    share: 'unclear',
    shareNote: 'No terms found.',
    checked: D,
  },
  {
    id: 'eia',
    name: 'US EIA open data',
    usedFor: 'Daily Brent and WTI spot prices (with your free key)',
    terms: [{ label: 'EIA copyrights and reuse', url: 'https://www.eia.gov/about/copyrights_reuse.php' }],
    status: 'open',
    display: 'Public domain.',
    commercial: 'No restriction stated.',
    attribution: 'Source: U.S. Energy Information Administration (<publication date>).',
    quotes: [
      'U.S. government publications are in the public domain and are not subject to copyright protection. You may use and/or distribute any of our data, files, databases, reports, graphs, charts, and other information products',
    ],
    share: 'allowed',
    shareNote: 'Public domain.',
    checked: D,
  },
  {
    id: 'gdelt',
    name: 'GDELT (DOC API, raw GDELT 2.0 files and GDELT 1.0 event files)',
    usedFor: 'Headlines and news tone; weekly event counts and news themes per country; monthly event history back to 1979',
    terms: [{ label: 'GDELT terms of use', url: 'https://www.gdeltproject.org/about.html#termsofuse' }],
    status: 'open',
    display: 'Allowed in any form, with a citation and link.',
    commercial: 'Allowed, without fee.',
    attribution: 'Source: The GDELT Project (https://www.gdeltproject.org/).',
    quotes: [
      'You may redistribute, rehost, republish, and mirror any of the GDELT datasets in any form. However, any use or redistribution of the data must include a citation to the GDELT Project and a link to this website (https://www.gdeltproject.org/).',
      'available for unlimited and unrestricted use for any academic, commercial, or governmental use of any kind without fee.',
    ],
    flag: 'Headlines link to news articles owned by their publishers; GDELT\'s terms cover GDELT\'s data, not the articles.',
    share: 'allowed',
    shareNote: 'Any redistribution allowed with a citation and link.',
    checked: D,
  },
  {
    id: 'ucdp',
    name: 'UCDP (Uppsala Conflict Data Program) downloaded files',
    usedFor: 'Armed conflicts, battle deaths, non-state and one-sided violence per country and year; preliminary monthly Candidate events since the yearly release (files you put in data/local/ucdp/)',
    terms: [{ label: 'UCDP downloads (licence and citations)', url: 'https://ucdp.uu.se/downloads/' }],
    status: 'open',
    display: 'Allowed: free to use and redistribute under CC BY 4.0, citing the publications listed with each dataset.',
    commercial: 'Allowed (CC BY 4.0 sets no commercial limit).',
    attribution:
      'UCDP, Uppsala University (ucdp.uu.se), CC BY 4.0; cite the dataset publications, e.g. Davies, Pettersson & Öberg (2026), Journal of Peace Research, and Gleditsch et al. (2002), Journal of Peace Research 39(5).',
    quotes: [
      'All datasets are free of charge and licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) — you are free to use and redistribute them provided you cite the relevant publications listed with each dataset.',
    ],
    share: 'allowed',
    shareNote: 'CC BY 4.0 allows sharing with a citation of the dataset publications.',
    checked: D,
  },
  {
    id: 'ofac',
    name: 'OFAC sanctions lists (US Treasury)',
    usedFor: 'SDN and non-SDN sanctions list entries by country and programme (files you put in data/local/sanctions/)',
    terms: [{ label: 'OFAC Sanctions List Service', url: 'https://ofac.treasury.gov/sanctions-list-service' }],
    status: 'not_verified',
    display: 'Not confirmed: the terms page could not be read from where this register was written.',
    commercial: 'Not confirmed.',
    attribution: 'Office of Foreign Assets Control, US Department of the Treasury.',
    quotes: [],
    flag: 'Read the terms on the OFAC Sanctions List Service page and update this row before showing list counts to others.',
    share: 'unclear',
    shareNote: 'Terms not read.',
    checked: D,
  },
  {
    id: 'unsc',
    name: 'UN Security Council Consolidated List',
    usedFor: 'UN sanctions list entries by country, regime and year listed (consolidated.xml in data/local/sanctions/)',
    terms: [{ label: 'UN Security Council Consolidated List', url: 'https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list' }],
    status: 'not_verified',
    display: 'Not confirmed: the terms page could not be read from where this register was written.',
    commercial: 'Not confirmed.',
    attribution: 'United Nations Security Council Consolidated List.',
    quotes: [],
    flag: 'Read the UN terms of use for the consolidated list and update this row before showing list counts to others.',
    share: 'unclear',
    shareNote: 'Terms not read.',
    checked: D,
  },
  {
    id: 'gpr',
    name: 'Caldara-Iacoviello Geopolitical Risk index',
    usedFor: 'Monthly geopolitical risk index, world and 44 countries (file you save in data/local/gpr/), in the country risk scorecard',
    terms: [{ label: 'Geopolitical Risk Index page', url: 'https://www.matteoiacoviello.com/gpr.htm' }],
    status: 'not_verified',
    display: 'Not confirmed: the data page could not be read from where this register was written.',
    commercial: 'Not confirmed.',
    attribution: 'Caldara, Dario and Matteo Iacoviello (2022), "Measuring Geopolitical Risk", American Economic Review 112(4), 1194-1225.',
    quotes: [],
    flag: 'Read the terms and citation request on the GPR data page and update this row before showing the index to others.',
    share: 'unclear',
    shareNote: 'Terms not read.',
    checked: D,
  },
  {
    id: 'polymarket',
    name: 'Polymarket',
    usedFor: 'Prediction-market odds',
    terms: [{ label: 'Terms of Use (effective 11 Aug 2026)', url: 'https://polymarket.com/tos' }],
    status: 'permission',
    display: 'Personal, limited licence only. Redistribution to capital-markets firms or data distributors needs written agreement.',
    commercial: 'Professional capital-markets users (including investment managers and financial technology companies) may not access the data through an API without written agreement.',
    attribution: 'None stated.',
    quotes: [
      'Access or use any data, content, or information contained on our Site, any Interface or Features directly or through an API ... if you are (i) a non-retail, professional entity that engages in capital markets activities',
      'Sell, resell, sublicense, redistribute, or otherwise commercially exploit the Data to any Capital Market Client or market data distributor, unless otherwise agreed to in writing by us;',
    ],
    flag: 'A desk, fund or fintech using the app professionally falls inside the restriction. Keep Polymarket odds to personal research, or agree terms with Polymarket.',
    share: 'unclear',
    shareNote: 'A personal licence; redistribution is barred only to capital-markets firms and data distributors, and sharing with others is not addressed.',
    checked: D,
  },
  {
    id: 'kalshi',
    name: 'Kalshi',
    usedFor: 'Prediction-market odds',
    terms: [
      { label: 'Developer Agreement v1.1', url: 'https://assets.kalshi.com/Kalshi-Developer-Agreement.pdf' },
      { label: 'Data Terms of Use', url: 'https://kalshi-public-docs.s3.amazonaws.com/kalshi-data-terms-of-service.pdf' },
    ],
    status: 'permission',
    display: 'Not allowed without Kalshi\'s written authorization.',
    commercial: 'Not allowed: personal, non-commercial use only; API use is limited to a member\'s own trading.',
    attribution: 'None stated.',
    quotes: [
      'Use of Kalshi APIs is expressly limited to facilitating a members own trading on the Exchange; all other usages are disallowed',
      'You may not share such data or content with third parties in any manner without prior written authorization from Kalshi.',
      'You may access content only for your personal use for non-commercial purposes.',
    ],
    flag: 'The strictest terms in the app. Showing Kalshi odds to anyone else, or using them in a professional setting, needs Kalshi\'s written authorization.',
    share: 'restricted',
    shareNote: 'Sharing with third parties needs Kalshi\'s written authorization.',
    checked: D,
  },
  {
    id: 'bcrp',
    name: 'Central Reserve Bank of Peru (BCRPData): J.P. Morgan EMBI spreads; interbank PEN rate',
    usedFor: 'USD bond spread over Treasuries for Argentina, Brazil, Chile, Colombia, Ecuador, Mexico, Peru, Venezuela (the free stand-in for CDS); daily soles per US dollar (PD04638PD), the BCRP\'s own series',
    terms: [
      { label: 'BCRPData Condiciones de Uso', url: 'https://estadisticas.bcrp.gob.pe/estadisticas/series/ayuda/condiciones-de-uso' },
      { label: 'Example series: EMBIG Peru', url: 'https://estadisticas.bcrp.gob.pe/estadisticas/series/diarias/resultados/PD04709XD/html' },
    ],
    status: 'not_verified',
    display: 'The BCRP allows reproduction without permission if it is cited, but the spreads are J.P. Morgan\'s index and the BCRP says responsibility for outside data rests with the original provider. J.P. Morgan\'s own terms were not read.',
    commercial: 'Not stated by the BCRP; J.P. Morgan index terms not confirmed.',
    attribution: 'Fuente: BCRP (BCRPData), from J.P. Morgan EMBI Global.',
    quotes: [
      'Puede reproducirse total o parcialmente, sin autorización expresa, siempre y cuando se cite la fuente.',
      'La responsabilidad sobre las estadísticas cuya fuente es externa al Banco recae en la entidad que provee el dato original.',
    ],
    flag: 'EMBI is a J.P. Morgan index, usually licensed. Keep the spreads to your own research until J.P. Morgan\'s terms for republished EMBI levels are confirmed.',
    share: 'unclear',
    shareNote: 'The BCRP allows reproduction with citation, but J.P. Morgan\'s terms for the EMBI levels were not read.',
    checked: D,
  },
  {
    id: 'trm_colombia',
    name: 'Colombia TRM (Superintendencia Financiera) on datos.gov.co',
    usedFor: 'Daily pesos per US dollar (Tasa Representativa del Mercado), dataset 32sa-8pi3',
    terms: [{ label: 'Dataset 32sa-8pi3 on datos.gov.co', url: 'https://www.datos.gov.co/d/32sa-8pi3' }],
    status: 'not_verified',
    display: 'The dataset\'s licence was not read.',
    commercial: 'Not confirmed.',
    attribution: 'Fuente: Superintendencia Financiera de Colombia, TRM (datos.gov.co).',
    quotes: [],
    flag: 'Read the licence shown on the datos.gov.co dataset page for 32sa-8pi3 and update this row.',
    share: 'unclear',
    shareNote: 'Licence not read yet.',
    checked: '2026-11-07',
  },
  {
    id: 'bcra',
    name: 'Banco Central de la República Argentina (Cotizaciones API)',
    usedFor: 'Daily pesos per US dollar, the BCRA official quote',
    terms: [{ label: 'BCRA website (API terms still to find)', url: 'https://www.bcra.gob.ar/' }],
    status: 'not_verified',
    display: 'The API terms were not read.',
    commercial: 'Not confirmed.',
    attribution: 'Fuente: Banco Central de la República Argentina.',
    quotes: [],
    flag: 'Find and read the terms for the BCRA public APIs (api.bcra.gob.ar) and update this row.',
    share: 'unclear',
    shareNote: 'Terms not read yet.',
    checked: '2026-11-07',
  },
  {
    id: 'bcb',
    name: 'Banco Central do Brasil (SGS 13522, IPCA 12 months; Focus market expectations)',
    usedFor: 'Brazil\'s IPCA inflation over 12 months; Focus survey median IPCA expected over the next 12 months (Olinda OData, Expectativas)',
    terms: [
      { label: 'Open data portal: about', url: 'https://dadosabertos.bcb.gov.br/pages/sobre-o-portal' },
      { label: 'Focus dataset page (licence: ODbL)', url: 'https://dadosabertos.bcb.gov.br/dataset/expectativas-mercado' },
    ],
    status: 'not_verified',
    display: 'The open data portal names no licence and its footer reads "Todos os direitos reservados" (all rights reserved). The copyright page needs JavaScript and was not read.',
    commercial: 'Not stated.',
    attribution: 'Fonte: Banco Central do Brasil, SGS série 13522.',
    quotes: ['© Banco Central do Brasil - Todos os direitos reservados'],
    flag: 'The Focus dataset page names the Open Data Commons Open Database License (ODbL), read 2026-11-07, while the site footer reads all rights reserved. Read https://www.bcb.gov.br/acessoinformacao/direitosautorais in a browser and update this row.',
    share: 'unclear',
    shareNote: 'No licence stated; the footer reads all rights reserved.',
    checked: D,
  },
  {
    id: 'banxico',
    name: 'Banco de México (SIE API, INPC), with your token',
    usedFor: 'Mexico\'s INPC inflation over 12 months (only when you add your own Banxico token)',
    terms: [{ label: 'SIE API page (terms shown when you request a token)', url: 'https://www.banxico.org.mx/SieAPIRest/service/v1/?locale=en' }],
    status: 'not_verified',
    display: 'Not confirmed. The terms are shown on the token page, which could not be read from the build machine.',
    commercial: 'Not stated here.',
    attribution: 'Fuente: Banco de México, SIE (serie SP30578).',
    quotes: [],
    flag: 'Read the terms on the token page when you request the token and update this row.',
    share: 'unclear',
    shareNote: 'Terms not read yet; treated as unclear until they are.',
    checked: D,
  },
  {
    id: 'tesouro',
    name: 'Brazil Treasury (Tesouro Direto price history)',
    usedFor: 'Brazil 10Y yield (NTN-F)',
    terms: [{ label: 'Dataset page (licence)', url: 'https://www.tesourotransparente.gov.br/ckan/dataset/taxas-dos-titulos-ofertados-pelo-tesouro-direto' }],
    status: 'open',
    display: 'Allowed under the Open Database License (ODbL).',
    commercial: 'Allowed under ODbL (attribution; a shared derived database stays under ODbL).',
    attribution: 'Fonte: Tesouro Transparente, Taxas dos Títulos Ofertados pelo Tesouro Direto (ODbL).',
    quotes: ['Licença Aberta para Bases de Dados (ODbL) do Open Data Commons'],
    share: 'allowed',
    shareNote: 'Open Database License (ODbL), with credit.',
    checked: D,
  },
  {
    id: 'evds',
    name: 'Central Bank of Turkey (EVDS), with your key',
    usedFor: 'Turkey monthly CPI inflation and 10Y yield',
    terms: [{ label: 'TCMB terms of use (Kullanım Şartları)', url: 'https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Bottom+Menu/Diger/Kullanim+Sartlari' }],
    status: 'permission',
    display: 'May be published with the source cited.',
    commercial: 'Needs the TCMB\'s written permission.',
    attribution: 'Kaynak: TCMB EVDS (Central Bank of the Republic of Türkiye).',
    quotes: ['Sitede yer alan bilgiler, kaynak gösterilmek suretiyle yayımlanabilir; ancak bu bilgilerin ticari amaçlarla kullanımı TCMB\'nin yazılı iznine tabidir.'],
    flag: 'These are the TCMB website terms; they do not name EVDS, whose own pages need JavaScript and were not read.',
    share: 'allowed',
    shareNote: 'May be published with the source cited; only commercial use needs permission.',
    checked: D,
  },
  {
    id: 'acled',
    name: 'ACLED (Armed Conflict Location & Event Data), with your account or your downloaded files',
    usedFor: 'Conflict events per country over twelve months (only when you add your own ACLED account, or put an aggregated file you downloaded from myACLED in data/local/acled/)',
    terms: [
      { label: 'ACLED End User License Agreement (1 Nov 2026)', url: 'https://acleddata.com/eula/' },
      { label: 'ACLED Attribution Policy (5 Nov 2026)', url: 'https://acleddata.com/attributionpolicy' },
      { label: 'myACLED access levels (FAQ)', url: 'https://acleddata.com/myacled-faqs' },
    ],
    status: 'conditions',
    display: 'Free for non-commercial use, including internal research. Anything published must be transformative and must not let the underlying data be rebuilt; ACLED must be named as the source.',
    commercial: 'Not allowed without a corporate licence from ACLED; governments and multilateral bodies need a public-sector licence.',
    attribution: 'ACLED (Armed Conflict Location & Event Data), accessed [date], www.acleddata.com; filters and any changes stated.',
    quotes: [
      'a royalty-free, non-exclusive, non-transferable, non-sublicensable license ... for non-commercial purposes, which may include internal use',
      'Commercial entities may not access or use the Content and/or Platforms without first obtaining a corporate license from the Licensor.',
      'The Licensee may only publish or distribute materials incorporating ACLED\'s Data where such materials are transformative in nature and do not allow reverse engineering of the underlying dataset.',
      'ACLED as the source of the data must be clearly and prominently acknowledged. This applies to uses of the original ACLED data as well as any manipulation of or additions to the data.',
    ],
    flag: 'Monthly counts per country may count as "reorganized" data, which the EULA says is not enough to publish. Keep ACLED figures to your own research and leave them out of anything shared until ACLED confirms. API access needs the Research level; Open accounts get aggregated downloads only, which the app reads from data/local/acled/. The same EULA covers the downloaded files: they stay on your computer and are never shipped with the app.',
    share: 'restricted',
    shareNote: 'Non-commercial research use only; publishing needs transformative work that cannot be reversed into the data.',
    checked: '2026-11-06',
  },
  {
    id: 'boc_boe',
    name: 'Bank of Canada and Bank of England Sovereign Default Database (BoC-BoE)',
    usedFor: 'Government debt in default each year since 1960, by creditor (IMF, Paris Club, China, foreign-currency bonds and bank loans, local-currency debt)',
    terms: [
      { label: 'Bank of Canada Terms of Use, Disclosures and Disclaimers', url: 'https://www.bankofcanada.ca/terms/' },
      { label: 'BoC-BoE Sovereign Default Database: What\'s new in 2026? (Staff Analytical Paper 2026-48)', url: 'https://www.bankofcanada.ca/2026/10/staff-analytical-paper-2026-48/' },
    ],
    status: 'conditions',
    display: 'Allowed: the Bank lets anyone use, copy and distribute its website content, crediting the Bank and saying if anything was changed, without suggesting the Bank endorses the use.',
    commercial: 'Not limited by the terms for the Bank\'s own content; a paid product that includes it must tell buyers the content is free on the Bank\'s website.',
    attribution: 'Source: Bank of Canada and Bank of England, BoC-BoE Sovereign Default Database (<edition>), Bank of Canada Valet API; figures as published, US$ millions.',
    quotes: [
      'You must attribute the Bank of Canada as the source of the content, and indicate if changes were made. You may do so in any reasonable manner, but not in any way that suggests that the Bank endorses you or your use of the content.',
      'You must exercise due diligence in ensuring the accuracy of any content you reproduce.',
      'The Bank does not grant You permission to re-use such third-party content unless it expressly indicates that You may do so.',
    ],
    flag: 'The database is compiled from published sources (IMF, World Bank, Paris Club and others); the Bank\'s terms withhold permission for third-party content unless stated, and no database-specific licence was found. The Valet API must not be queried around its request limits: the app reads the file at most once a day.',
    share: 'allowed',
    shareNote: 'The Bank\'s terms allow free use and distribution with credit; the third-party caveat is noted above.',
    checked: '2026-11-07',
  },
  {
    id: 'own',
    name: 'Your own paid data (CDS file, LSEG account)',
    usedFor: '5Y sovereign CDS (hidden for now)',
    terms: [{ label: 'Your own contract with the vendor', url: 'https://developers.lseg.com' }],
    status: 'not_verified',
    display: 'Set by your own licence with the vendor. Market data licences usually limit display to licensed users.',
    commercial: 'Set by your own licence.',
    attribution: 'As your vendor contract requires.',
    quotes: [],
    flag: 'Check your vendor contract before CDS figures go into anything shared. The app never ships paid data and never stores the password in exports, backups or the audit log.',
    share: 'restricted',
    shareNote: 'Set by your vendor contract; treated as restricted unless it says otherwise.',
    checked: D,
  },
];

/** The rows with an open question, in register order. */
export function openLicenceQuestions(rows: LicenceRow[] = DATA_LICENCES): LicenceRow[] {
  return rows.filter((r) => r.flag && r.status !== 'open');
}

/** docs/DATA_LICENCES.md, generated from the register. */
export function licencesMarkdown(rows: LicenceRow[] = DATA_LICENCES): string {
  const esc = (s: string) => s.replace(/\|/g, '\\|');
  const out: string[] = [
    '# Data licences',
    '',
    '<!-- Generated from src/data/dataLicences.ts by `npm run docs:licences`. Edit that file, not this one. -->',
    '',
    'What each outside source\'s own terms say about showing its figures to other people (clients, colleagues, a',
    'published note) and about commercial use, with the credit it asks for. Each quote was read on the source\'s',
    'terms page on the date shown. Where a page could not be read or does not answer the question, the row says',
    '"Terms not confirmed" rather than guessing. This is a research note, not legal advice: a question that',
    'matters for a client or a sale should go to the provider in writing.',
    '',
    'The same register is in the app under **Menu > About & data licences**. Every export (council briefs and',
    'documents, policy memos, reports, notebooks, chart CSVs, Excel downloads, backups) ends with the line',
    '"Research, not validated advice." and points here (src/utils/disclaimer.ts).',
    '',
    '| Status | Meaning |',
    '| --- | --- |',
    ...(Object.keys(LICENCE_STATUS_LABEL) as LicenceStatus[]).map((s) => `| ${LICENCE_STATUS_LABEL[s]} | ${LICENCE_STATUS_HELP[s]} |`),
    '',
    '## Summary',
    '',
    '| Source | Status | Free non-commercial sharing | Show to others | Commercial use | Credit |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${esc(r.name)} | ${LICENCE_STATUS_LABEL[r.status]} | ${LICENCE_SHARE_LABEL[r.share]} | ${esc(r.display)} | ${esc(r.commercial)} | ${esc(r.attribution)} |`),
    '',
    '## Sources',
    '',
  ];
  for (const r of rows) {
    out.push(`### ${r.name}`, '');
    out.push(`- **Used for:** ${r.usedFor}`);
    out.push(`- **Status:** ${LICENCE_STATUS_LABEL[r.status]}`);
    out.push(`- **Free non-commercial sharing:** ${LICENCE_SHARE_LABEL[r.share]}. ${r.shareNote}`);
    out.push(`- **Terms read:** ${r.terms.map((t) => `[${t.label}](${t.url})`).join('; ')} (checked ${r.checked})`);
    out.push(`- **Show to others:** ${r.display}`);
    out.push(`- **Commercial use:** ${r.commercial}`);
    out.push(`- **Credit:** ${r.attribution}`);
    if (r.flag) out.push(`- **Open question:** ${r.flag}`);
    if (r.quotes.length) {
      out.push('', 'From the terms:', '');
      for (const q of r.quotes) out.push(`> ${q}`, '>');
      out.pop();
    }
    out.push('');
  }
  const open = openLicenceQuestions(rows);
  out.push('## Open questions', '');
  if (!open.length) out.push('None.', '');
  open.forEach((r, i) => out.push(`${i + 1}. **${r.name}** (${LICENCE_STATUS_LABEL[r.status]}): ${r.flag}`));
  out.push('');
  return out.join('\n');
}
