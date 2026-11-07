# EconQuest Sovereign Council Terminal

A research terminal for emerging-market sovereign and macro risk. It pulls free public data (World
Bank, IMF, BIS, OECD, FRED, CFTC, US Treasury, UN Comtrade, GDELT, Polymarket and more), shows it
country by country with its source and date, and lets you ask a council of desk agents about your
watchlist. Every agent answers from those figures only, and a summary agent may quote nothing else.

**The one rule: only real figures.** A number appears only when a live feed, an official series or
your own file supplied it. Anything else reads **Missing**, with the reason ("Needs setup", "Feed did
not answer", "No source yet"). There are no built-in, sample or AI-estimated figures. Paid data (CDS,
LSEG, EPFR, ratings, consensus) is used only from your own account or file, behind a switch in
Settings.

- [docs/USER_MANUAL.md](./docs/USER_MANUAL.md): how to use each page
- [docs/DATA_SOURCES.md](./docs/DATA_SOURCES.md): every source, what it fills, how to set it up
- [docs/DATA_LICENCES.md](./docs/DATA_LICENCES.md): what each source's terms allow (showing figures to others, commercial use, credit)
- [docs/METHODS.md](./docs/METHODS.md): a methods note per model and signal, with its pre-registered backtests and recorded verdicts
- [docs/RISK_AND_COMPLIANCE.md](./docs/RISK_AND_COMPLIANCE.md): audit log, model register, pre-registered backtests, report sign-off, and what a multi-user version would need
- [docs/SECURITY.md](./docs/SECURITY.md): accounts, sign-in, sessions, and what is not protected yet
- [docs/DESIGN_SYSTEM.md](./docs/DESIGN_SYSTEM.md): UI rules for contributors
- [CONTRIBUTING.md](./CONTRIBUTING.md): how to contribute, the research rules, and signing off commits

---

## Start it

You need Node.js 20 or later. Everything else is optional.

```bash
npm install
npm run dev          # http://localhost:3000, this computer only
```

On a Mac you can instead double-click `start-mac.command`, which runs the app in Docker on
http://localhost:3737 (Windows: `scripts/start-windows.bat`). Both ways read and write the same
`data/` folder, so keys and saved research carry over.

To update later, run `npm run update` (or double-click `update-mac.command`): it pulls, runs
`npm install` when the packages changed, and rebuilds the Docker app, which `git pull` alone does
not update. It also warns when a Docker Ollama holds port 11434 in front of the Ollama app.

To run it on an always-on Linux box or NAS with Ollama on the same machine, see
[docs/HOME_SERVER.md](docs/HOME_SERVER.md). On a Kubernetes cluster, use the Helm chart in
`deploy/helm/econquest/` ([docs/KUBERNETES.md](docs/KUBERNETES.md)).

### First run

A new install shows dashes everywhere until a source answers. Workspace opens with a **Getting
started** card that ticks itself off:

1. **See which sources answer.** Menu > Tools > Data connections (or `npm run check:data`) lists every
   source as connected (with a figure it returned), needs setup, off, or why it failed.
2. **Add a free FRED key** in Menu > Settings (⌘, or Ctrl+,). It fills official 10Y yields for the
   US, Mexico, South Africa, Japan, the UK, Poland and Chile.
3. **Choose an AI model** in Menu > Settings > AI model: Ollama on this computer, or Gemini with a key. Needed
   only for the council summary, the debate and agent picks; every figure works without it.
4. **Pick your countries** with Edit on the watchlist card.

Keys saved in Settings go to `data/local/settings.json` (not in git) and take effect without a
restart. They win over the same key in `.env`. A few advanced switches stay in `.env` only; start
from `.env.example`.

### How data is kept

Each country's snapshot is pulled once a week and saved in `data/live/`. If a source fails during a
pull, the last good figure from that source is kept with "kept from the <date> pull" on its label,
and the pull is retried within the hour. **Refresh now** on the country page pulls everything for
that country again at once. Slower sources (IMF reserves, CFTC, TIC, OECD, Comtrade, Pink Sheet,
GDELT) keep their own caches; [DATA_SOURCES.md](./docs/DATA_SOURCES.md) lists each one's interval.
Your holdings, watchlists, added countries and AI model settings are kept in
`data/local/workspace.json` (shared by Docker and `npm run dev`), with saved research in
`data/local/research.json` and keys in `data/local/settings.json`. Menu > Settings > Backup downloads all of it
except the keys as one file, and restores such a file on another computer.
Every pull is also kept by day in `data/archive/`, so the data as it stood on a past date is never
lost ([DATA_SOURCES.md](./docs/DATA_SOURCES.md#pull-archive)).

---

## What is in it

| Page | What it is for |
| --- | --- |
| **Workspace** | A chat page: Council chat fills the screen with the question box at the bottom; **Briefing** opens your inputs, watchlist, what moved, next two weeks and watch alerts in a side panel |
| **Research** | One page, three scopes: **One country**, **Compare countries** (the watchlist side by side) and **My holdings**. Each scope has the same four sections: **Summary** (country brief / where data and price disagree, growth and inflation / book brief), **Markets & signals** (MarketEdge / MarketEdge table and scenarios / signals on your holdings), **History & data** (charts, As of, Replicate, Track record / Compare countries table / holdings import) and **Sources** (what is live, or why not). CSV and Excel downloads |
| **Reports** | Country note, issuer note, sustainability assessment, portfolio and client reviews, council brief; Markdown or PDF |
| **Tools** (Settings > Tools) | Every ready tool grouped by use, data connections, and what each hidden desk would need to come back |

About 40 older desks ran on built-in figures and are switched off; no menu item brings them back.

**History & data** on a country also holds the research panels: nowcast and forecasts (each with its
out-of-sample verdict; a failed forecast is not drawn by default), gross financing need, reserve
adequacy, debt fan and costed fiscal options, policy rule family, inflation after rate changes, the
Bohn fiscal reaction test, IMF forecasts by WEO edition and GDELT event history. Armed conflict data
(UCDP) ships in `datasets/ucdp/`.

### Council chat

Type a question about your watchlist ("Is Brazil's debt sustainable?", "Who is most exposed to a
Hormuz closure?"). The agents that cover the question answer from the app's figures, each with its
source: Central Bank, Fiscal & Debt, Politics & Events, Relative Value, FX, Global Spillover,
Calendar and Timing, plus a Document agent for policy files you upload. A summary agent then writes a
short brief that may quote only their figures; a number check flags any figure that is not traceable.
Briefs and documents are saved on this computer in `data/local/research.json`.
The chat is the same conversation on every page: on Research and Reports, *Council chat* in the header
opens it in a side panel.

For a deeper view, **Run the full council** debates the open country across nine desk agents and
stops for your approval before the final report.

---

## For developers

```bash
npm run lint         # TypeScript
npm test             # unit and server tests (Node's built-in runner, network replaced by fixtures)
npm run build        # production bundle
npm run test:smoke   # opens every page of the built app in Chromium with all feeds down
npm run check:data   # live check of every source from this computer
npm run check:imf    # prints the IMF series codes the app matches
npm run record:feeds # records every free feed's real reply for the tests (run where the feeds answer)
npm run preload      # downloads every free feed for every country, for fast offline use
```

Every pull request runs lint, tests, build and the UI smoke test on GitHub
(`.github/workflows/ci.yml`). The smoke test needs Playwright's Chromium once:
`npx playwright install chromium`. `tests/server.test.ts` and the smoke test start the real server
with `tests/helpers/offline-fetch.mjs` in place of the network.

**Tests on real replies.** The offline fixtures are hand-written. `npm run record:feeds`, run on a
computer that reaches the feeds, saves what every free feed really sends (gzipped, keys taken out of
every URL, own paid data and AI switched off) in `tests/fixtures/recorded/`, with what the app made of
it. `tests/recorded.test.ts` replays those replies through the real server with the clock set back to
the recording, and fails, naming the source, if a source connected then no longer is or a figure
filled then is now Missing. It is skipped until a recording exists. Record again after adding a feed.

Layout: `server.ts` (Express API, data pulls and caches), `src/utils/` (one module per source or
calculation, each with a test in `tests/`), `src/components/` (React pages and panels),
`src/data/` (navigation, official calendar, country list). Each panel sits inside a crash guard
(`PanelBoundary`), so one failing panel never blanks the app.

### Integration API

Other apps can read council output from `/api/v1/integration/*` (desks, bundle, publish, an SSE
stream, deliveries, and `openapi.json`). It answers `404 NO_COUNCIL_RUN` until you have run the full
council on that country, and never sends built-in figures. Set `SMCR_INTEGRATION_API_KEY` and
`SMCR_WEBHOOK_HMAC_SECRET` in `.env` to fix the key and signing secret.

### Network

`npm run dev` listens on 127.0.0.1, so only this computer can open the app. Docker publishes on
127.0.0.1 too. Set `HOST="0.0.0.0"` in `.env` only if you want other machines on your network to
reach it; Settings can still be changed only from this computer unless `SETTINGS_ALLOW_REMOTE` is
"true".

The server answers only to localhost names (localhost, 127.0.0.1, [::1]), so a website cannot reach
it by pointing its own domain at this computer, and it refuses changes sent from pages on other
sites. If you open it to your network, list the names it may be reached by in `ALLOWED_HOSTS`. The
connector test and webhook buttons work only from this computer and cannot be pointed at the app
itself or at cloud metadata addresses.

---

## Licence

Code: [Apache License 2.0](./LICENSE). Documentation, methods notes, validation records and Quest
content: [CC BY 4.0](./LICENSE-docs.md). Figures fetched from outside sources keep their own terms
([docs/DATA_LICENCES.md](./docs/DATA_LICENCES.md)); the bundled UCDP datasets are CC BY 4.0 ([NOTICE](./NOTICE)).

This is research and teaching software, not investment advice. Contributions are welcome: see
[CONTRIBUTING.md](./CONTRIBUTING.md), the [code of conduct](./CODE_OF_CONDUCT.md),
[GOVERNANCE.md](./GOVERNANCE.md) and, for security problems, [SECURITY.md](./SECURITY.md). To cite
the software, use [CITATION.cff](./CITATION.cff).
