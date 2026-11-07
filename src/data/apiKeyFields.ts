import { isValidEvdsSeriesCode } from '../utils/officialYields';
import { parseRicMap } from '../utils/ownCds';

/**
 * The keys you can enter in Menu > Settings > Data API keys. Browser-safe (no Node imports): the
 * server's storage lives in src/utils/userSettings.ts. Add an entry here to add a key to Settings.
 */
export interface ApiKeyField {
  /** The .env name, also the id used by the app and the endpoints. */
  id: string;
  label: string;
  provider: string;
  /** What the key changes in the app, in plain words. */
  feeds: string;
  /** What happens without it. */
  withoutIt: string;
  getKeyUrl: string;
  getKeySteps: string;
  /** Connection check row that tests this key. */
  checkId: string;
  /** False for settings that are not secret (a series code, a file path): shown in full. Default true. */
  secret?: boolean;
  /** Where Settings lists it: free sources with your own key (default), or your own paid data. */
  section?: 'free_key' | 'own_account' | 'ai' | 'alerts';
  /** Hint in the empty box, for settings that are not keys. */
  placeholder?: string;
  /** A pick-one setting (shown as a list) instead of a typed value. */
  choices?: Array<{ value: string; label: string }>;
  /** Returns an error sentence, or null when the value looks right. */
  validate: (value: string) => string | null;
}

export const API_KEY_FIELDS: ApiKeyField[] = [
  {
    id: 'FRED_API_KEY',
    label: 'FRED API key',
    provider: 'Federal Reserve Bank of St. Louis (FRED)',
    feeds: '10-year government bond yields for the US, Mexico, South Africa, Japan, the UK, Poland and Chile, through the official FRED API.',
    withoutIt: 'Without a key the app reads the same yields from the FRED download, which needs no key but is less steady.',
    getKeyUrl: 'https://fred.stlouisfed.org/docs/api/api_key.html',
    getKeySteps: 'Free. Sign in at fred.stlouisfed.org, then My Account > API Keys > Request API Key.',
    checkId: 'fred_api',
    // FRED documents the key as a 32 character lower-case alphanumeric string.
    validate: (v) => (/^[a-z0-9]{32}$/.test(v) ? null : 'A FRED key is 32 lower-case letters and digits. Check it was copied in full.'),
  },
  {
    id: 'EIA_API_KEY',
    label: 'US EIA API key',
    provider: 'US Energy Information Administration (EIA open data)',
    feeds: 'Daily Brent and WTI spot oil prices, used in the commodity and Hormuz spillover lines.',
    withoutIt: 'Without a key oil prices come monthly from the World Bank Pink Sheet.',
    getKeyUrl: 'https://www.eia.gov/opendata/register.php',
    getKeySteps: 'Free. Register at eia.gov/opendata with your email; the key arrives by email.',
    checkId: 'eia',
    validate: (v) => (/^[A-Za-z0-9]{20,64}$/.test(v) ? null : 'An EIA key is a run of letters and digits (usually 40). Check it was copied in full.'),
  },
  {
    id: 'COMTRADE_API_KEY',
    label: 'UN Comtrade subscription key',
    provider: 'United Nations Comtrade',
    feeds: 'Trade partner shares (China, Taiwan, Russia, Gulf) and export mix, used on the Country tab and in the spillover scenarios.',
    withoutIt: 'Without a key the app uses the public preview, which answers but allows few requests.',
    getKeyUrl: 'https://comtradedeveloper.un.org/',
    getKeySteps: 'Free. Sign in at comtradeplus.un.org, then My Comtrade > My API portal, subscribe to "comtrade - v1" and copy the primary key.',
    checkId: 'comtrade',
    validate: (v) => (/^[A-Za-z0-9]{16,64}$/.test(v) ? null : 'A Comtrade key is a run of letters and digits (usually 32). Check it was copied in full.'),
  },
  {
    id: 'EVDS_API_KEY',
    label: 'Turkey central bank (EVDS) API key',
    provider: 'Central Bank of the Republic of Türkiye (EVDS)',
    feeds: "Turkey's monthly inflation from the central bank (months fresher than the OECD mirror), and Turkey's 10-year government bond yield once the 10Y series code below is set too.",
    withoutIt: "Without it Turkey's 10Y yield reads Missing and Turkey's inflation stays on the OECD series.",
    getKeyUrl: 'https://evds3.tcmb.gov.tr/',
    getKeySteps: 'Free. Register at evds3.tcmb.gov.tr, sign in, then open your profile and copy the API key.',
    checkId: 'evds',
    validate: (v) => (/^[A-Za-z0-9]{6,64}$/.test(v) ? null : 'An EVDS key is a run of letters and digits. Check it was copied in full.'),
  },
  {
    id: 'EVDS_TR10Y_SERIES',
    placeholder: 'TP.…',
    label: 'Turkey 10Y series code (EVDS)',
    provider: 'Central Bank of the Republic of Türkiye (EVDS)',
    feeds: 'Which EVDS series holds the 10-year bond yield. Not secret, shown in full.',
    withoutIt: "Without it Turkey's 10Y yield reads Missing, even with a key.",
    getKeyUrl: 'https://evds3.tcmb.gov.tr/',
    getKeySteps: 'Signed in to EVDS, find the 10-year government bond yield series and copy its code (it starts with "TP.").',
    checkId: 'evds',
    secret: false,
    validate: (v) => (isValidEvdsSeriesCode(v) ? null : 'An EVDS series code starts with "TP." followed by letters, digits and dots, for example TP.ABC.D10.'),
  },

  {
    id: 'EVDS_TR_CPI_SERIES',
    placeholder: 'TP.FG.J0 (used when empty)',
    label: 'Turkey CPI index series code (EVDS, optional)',
    provider: 'Central Bank of the Republic of Türkiye (EVDS)',
    feeds: 'Which EVDS series holds the monthly consumer price index (an index, not a % change). Leave empty to use TP.FG.J0. Not secret, shown in full.',
    withoutIt: 'Empty: the app reads TP.FG.J0. If that series has stopped, Turkey keeps the OECD inflation series.',
    getKeyUrl: 'https://evds3.tcmb.gov.tr/',
    getKeySteps: 'Only if TP.FG.J0 has stopped: signed in to EVDS, find the consumer price index (general) series and copy its code (it starts with "TP.").',
    checkId: 'evds',
    secret: false,
    validate: (v) => (isValidEvdsSeriesCode(v) ? null : 'An EVDS series code starts with "TP." followed by letters, digits and dots, for example TP.FG.J0.'),
  },

  {
    id: 'BANXICO_TOKEN',
    label: 'Banco de México (Banxico) token',
    provider: 'Banco de México, SIE API',
    feeds: "Mexico's monthly inflation (INPC over 12 months) straight from the central bank, months fresher than the OECD mirror.",
    withoutIt: 'Without a token Mexico keeps the OECD inflation series, which lags five to six months.',
    getKeyUrl: 'https://www.banxico.org.mx/SieAPIRest/service/v1/token',
    getKeySteps: 'Free. Open the token page, accept the terms, solve the check and copy the token it shows (64 letters and digits).',
    checkId: 'banxico',
    validate: (v) => (/^[A-Za-z0-9]{32,128}$/.test(v) ? null : 'A Banxico token is a long run of letters and digits (usually 64). Check it was copied in full.'),
  },

  {
    id: 'ACLED_EMAIL',
    placeholder: 'you@university.edu',
    label: 'ACLED account email',
    provider: 'ACLED (Armed Conflict Location & Event Data)',
    feeds: 'Conflict events (battles, violence against civilians, explosions, riots, protests) for each country over twelve months, for the Politics & Events Agent and the Sources tab. Needs the ACLED password below as well. Not secret, shown in full.',
    withoutIt: 'Without an ACLED account the conflict figures read Missing.',
    getKeyUrl: 'https://acleddata.com/register/',
    getKeySteps: 'Free for non-commercial use. Register a myACLED account. API access needs the Research level: a public email (gmail.com and similar) gets the Open level, which has no API; ask ACLED\'s access team to move your account.',
    checkId: 'acled',
    secret: false,
    validate: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'Enter the email address you use to sign in to myACLED.'),
  },
  {
    id: 'ACLED_PASSWORD',
    label: 'ACLED account password',
    provider: 'ACLED (Armed Conflict Location & Event Data)',
    feeds: 'Used only to ask ACLED for a 24-hour access token. Never written to backups, the audit log, logs or exports.',
    withoutIt: 'Without it the conflict figures read Missing, even with the email set.',
    getKeyUrl: 'https://acleddata.com/register/',
    getKeySteps: 'The password of your myACLED account.',
    checkId: 'acled',
    validate: (v) => (v.length >= 6 && v.length <= 200 ? null : 'Enter your myACLED password.'),
  },

  // ---- Your own paid data: off unless you switch it on (licensed to you, never built in) ----
  {
    id: 'CDS_FEED',
    label: 'Your 5Y CDS source',
    provider: 'Your own licensed data',
    feeds:
      '5-year sovereign CDS on the watchlist, MarketEdge and the Country tab. No free source of CDS exists, so the app shows only quotes from your own file or your own LSEG account, labelled with whose data they are.',
    withoutIt: 'Off: CDS reads Missing.',
    getKeyUrl: 'https://github.com/smcarus/econquest/blob/main/docs/DATA_SOURCES.md',
    getKeySteps: 'Pick a file you export yourself (Bloomberg, LSEG, S&P) or your LSEG Data Platform account, then fill in the settings for it below.',
    checkId: 'own_cds',
    secret: false,
    section: 'own_account',
    choices: [
      { value: 'off', label: 'Off' },
      { value: 'csv', label: 'My CSV file' },
      { value: 'lseg', label: 'My LSEG account' },
    ],
    validate: (v) => (['off', 'csv', 'lseg'].includes(v) ? null : 'Pick Off, My CSV file or My LSEG account.'),
  },
  {
    id: 'CDS_CSV_PATH',
    placeholder: '/Users/you/Documents/cds.csv',
    label: 'CDS file path (for "My CSV file")',
    provider: 'Your own licensed data',
    feeds: 'Full path to your CSV with columns iso3,date,cds5y_bps,source. The latest date per country is used.',
    withoutIt: 'Needed when the CDS source is My CSV file.',
    getKeyUrl: 'https://github.com/smcarus/econquest/blob/main/docs/DATA_SOURCES.md',
    getKeySteps: "Under Docker the app sees the project folder's data/local as /app/data/local, so put the file there and enter /app/data/local/cds.csv.",
    checkId: 'own_cds',
    secret: false,
    section: 'own_account',
    validate: (v) => (/^(\/|[A-Za-z]:[\\/])/.test(v) ? null : 'Use the full path, starting with / (or a drive letter on Windows).'),
  },
  {
    id: 'LSEG_APP_KEY',
    label: 'LSEG app key (for "My LSEG account")',
    provider: 'LSEG Data Platform (your account)',
    feeds: 'Used with your LSEG user name and password to price the CDS RICs below.',
    withoutIt: 'Needed when the CDS source is My LSEG account.',
    getKeyUrl: 'https://developers.lseg.com/',
    getKeySteps: 'In LSEG Workspace, open the App Key Generator and create a key for your machine account.',
    checkId: 'own_cds',
    section: 'own_account',
    validate: (v) => (/^\S{8,128}$/.test(v) ? null : 'An LSEG app key is a run of letters and digits with no spaces.'),
  },
  {
    id: 'LSEG_USERNAME',
    placeholder: 'Machine ID or user name',
    label: 'LSEG user name',
    provider: 'LSEG Data Platform (your account)',
    feeds: 'Your LSEG machine ID or user name.',
    withoutIt: 'Needed when the CDS source is My LSEG account.',
    getKeyUrl: 'https://developers.lseg.com/',
    getKeySteps: 'The machine ID or user name LSEG gave you for API access.',
    checkId: 'own_cds',
    secret: false,
    section: 'own_account',
    validate: (v) => (/^\S{2,200}$/.test(v) ? null : 'A user name has no spaces.'),
  },
  {
    id: 'LSEG_PASSWORD',
    placeholder: 'Your LSEG password',
    label: 'LSEG password',
    provider: 'LSEG Data Platform (your account)',
    feeds: 'Sent only to LSEG to sign in. Never shown, logged or put in the connection check.',
    withoutIt: 'Needed when the CDS source is My LSEG account.',
    getKeyUrl: 'https://developers.lseg.com/',
    getKeySteps: 'The password for the user name above.',
    checkId: 'own_cds',
    section: 'own_account',
    validate: (v) => (v.length >= 4 && v.length <= 256 ? null : 'Enter the password for your LSEG user name.'),
  },
  {
    id: 'LSEG_CDS_RICS',
    placeholder: 'BRA=<ric>,TUR=<ric>',
    label: 'LSEG CDS RICs',
    provider: 'LSEG Data Platform (your account)',
    feeds: 'Which RIC holds the 5Y CDS for each country, as BRA=<ric>,TUR=<ric>. They depend on your entitlement, so none are built in.',
    withoutIt: 'Needed when the CDS source is My LSEG account.',
    getKeyUrl: 'https://developers.lseg.com/',
    getKeySteps: "Find each country's 5Y sovereign CDS RIC in Workspace and list them separated by commas.",
    checkId: 'own_cds',
    secret: false,
    section: 'own_account',
    validate: (v) => (Object.keys(parseRicMap(v)).length ? null : 'List them as ISO3=RIC separated by commas, for example BRA=<ric>,TUR=<ric>.'),
  },
  // ---- AI model -------------------------------------------------------------------------------
  {
    id: 'GEMINI_API_KEY',
    label: 'Google Gemini API key',
    provider: 'Google Gemini',
    feeds: 'The council summary, agent debate replies and agent choice when the AI model is Gemini or hybrid. The key goes only to Google.',
    withoutIt: "Without it use Ollama or a local server under AI model; the app's figures do not need an AI model.",
    getKeyUrl: 'https://ai.google.dev/gemini-api/docs/api-key',
    getKeySteps: 'Open the Gemini API key page, sign in with a Google account, then create an API key.',
    checkId: 'gemini',
    section: 'ai',
    validate: (v) => (/^[A-Za-z0-9_-]{20,128}$/.test(v) ? null : 'A Gemini key is a run of letters, digits, dashes and underscores (usually starting AIza). Check it was copied in full.'),
  },
  // ---- Server alerts (src/utils/serverAlerts.ts) ---------------------------------------------
  // Test sends a real test message instead of a connection check, so checkId names no check row.
  {
    id: 'ALERT_WEBHOOK_URL',
    label: 'Webhook address',
    provider: 'Slack, Discord, Google Chat, ntfy or your own receiver',
    feeds: 'Where the server posts a short message when the nightly data check finds a source that broke, a scheduled job fails, or a backtest that passed fails.',
    withoutIt: 'Without it (and without email below) no alert is sent; Menu > Data health still shows everything.',
    getKeyUrl: 'https://api.slack.com/messaging/webhooks',
    getKeySteps: 'In Slack: create an app, turn on Incoming Webhooks and copy the address. In Discord: Channel settings > Integrations > Webhooks. The address works like a password, so it is kept masked.',
    checkId: 'alert_webhook',
    section: 'alerts',
    placeholder: 'https://hooks.slack.com/services/…',
    validate: (v) => (/^https?:\/\/[^\s]+$/.test(v) && !/\s/.test(v) ? null : 'A webhook address starts with https:// (or http:// on your own network).'),
  },
  {
    id: 'ALERT_SMTP_URL',
    label: 'Mail server for alert emails',
    provider: 'Your email provider (SMTP)',
    feeds: 'The mail server that sends alert emails, as smtps://user:password@host:465 (or smtp://…:587). It holds a password, so it is kept masked.',
    withoutIt: 'Without it no alert email is sent.',
    getKeyUrl: 'https://support.google.com/accounts/answer/185833',
    getKeySteps: 'Gmail: turn on 2-step verification, make an app password, then use smtps://you%40gmail.com:APP-PASSWORD@smtp.gmail.com:465 (write @ in the user name as %40).',
    checkId: 'alert_email',
    section: 'alerts',
    placeholder: 'smtps://user:password@smtp.example.com:465',
    validate: (v) => {
      try {
        const u = new URL(v);
        return /^smtps?:$/.test(u.protocol) && u.hostname ? null : 'The mail server starts with smtps:// or smtp://, then user:password@host:port.';
      } catch {
        return 'The mail server starts with smtps:// or smtp://, then user:password@host:port. Write @ in the user name as %40.';
      }
    },
  },
  {
    id: 'ALERT_EMAIL_TO',
    label: 'Send alert emails to',
    provider: 'Email',
    feeds: 'Who gets alert emails: one address, or several separated by commas.',
    withoutIt: 'Without it no alert email is sent.',
    getKeyUrl: 'https://github.com/smcarus/econquest/blob/main/docs/HOME_SERVER.md#server-alerts',
    getKeySteps: 'Any address you read.',
    checkId: 'alert_email',
    section: 'alerts',
    secret: false,
    placeholder: 'you@example.com',
    validate: (v) => (v.split(',').every((a) => /^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/.test(a.trim())) ? null : 'Use one email address, or several separated by commas.'),
  },
  {
    id: 'ALERT_EMAIL_FROM',
    label: 'Alert emails come from',
    provider: 'Email',
    feeds: 'The sender address on alert emails. Optional: without it the user name in the mail server address is used when it is an email address.',
    withoutIt: 'Many mail servers only accept their own account as the sender.',
    getKeyUrl: 'https://github.com/smcarus/econquest/blob/main/docs/HOME_SERVER.md#server-alerts',
    getKeySteps: 'Usually the same account as the mail server.',
    checkId: 'alert_email',
    section: 'alerts',
    secret: false,
    placeholder: 'econquest@example.com',
    validate: (v) => (/^([^<>]*<)?[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+>?$/.test(v.trim()) ? null : 'Use an email address, e.g. econquest@example.com.'),
  },
];

export const API_KEY_IDS = API_KEY_FIELDS.map((f) => f.id);

export function apiKeyField(id: string): ApiKeyField | undefined {
  return API_KEY_FIELDS.find((f) => f.id === id);
}

