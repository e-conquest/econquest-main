# EconQuest terminal: who uses it, how, and the UI that follows

Status: Sam chose the **institutional investor** as the first user (2026-11-04). Builds on UI pass 1 (PR #1).

**Done so far:**
- **Phase 0, data truth.** The country bar shows Live / Partly live / Sample data, not live / Source not verified, plus a "Prices: AI estimate | sample" chip. Provenance badges no longer show a fixed "200 OK" or a made-up latency.
- **Phase 2, Today (renamed Workspace by Sam, 2026-11-04).** Workspace is the landing page, with a watchlist showing change since your last visit, signals with Why and Stage ticket, a two-week calendar of official central bank and statistics dates with source links (`src/data/officialCalendar.ts`), and staged IC tickets. Rows open the matching desk.
- **Phase 3, Country page.** A Country button opens one page per sovereign: a picker, the key figures and data status in one row, then tabs (Overview, Debt & fiscal, Markets, Politics & geo, Scenarios, plus Restructuring when CDS is 400 bps or more or the alert is critical). Each tab holds the existing desks as sub-tabs, so nothing was removed. Overview pairs the executive brief with the official schedule for the next 120 days (`src/components/CountryPage.tsx`).
- **Phase 1, frame.** The header is now the five workflow places: **Today · Countries · Portfolio · Reports · Tools**. The old three pillar menus live inside Tools as the full desk library (and Jump ⌘K still finds any desk).
- **Phase 5 (part), Portfolio.** The book (watchlist at equal weight until a holdings import exists, and it says so), averages, each country's share of risk, staged ideas, then tabs Book, Risk & contagion, Stress tests, Ideas over the existing desks.
- **Phase 4 (part), Reports.** Tabs IC memo & pitchbook, Risk sign-off, Council debate, Research & exports over the existing desks. Still to do: one report builder, role picker, Present mode.
- **Holdings import.** Portfolio → Import holdings: upload or paste a CSV (country, instrument, type, side, notional_usd_mm, duration) or add rows by hand; saved in the browser only. The summary then shows gross and net credit exposure, credit DV01, notional-weighted CDS and each country's share of risk. The desks under Portfolio still run on their own model book; wiring them to holdings is next.
- **Holdings drive the book.** The stress lab ("Your holdings" weighting) and the contagion desk ("Your holdings" basket) use imported holdings and select them by default.
- **Reports, memo builder.** Reports → IC memo & pitchbook → Memo builder drafts an editable IC memo (verdict, key figures with data status, thesis, trades, portfolio impact, risks, coming up, sources). Copy, Markdown or print/PDF.
- **Roles: removed (Sam, 2026-11-04).** There is one layout for everyone. The app opens on Workspace, Country Research opens on the Brief, and Reports opens on the Council brief. The role picker and Menu → My role are gone.
- **Present mode.** Header → Present: the same content as full-screen slides, with the data status on every slide.
- **Design system, desks.** 92 desk toggle buttons now use the shared pill style.
- **Holdings everywhere in Portfolio.** The EMBI pair book takes its active weights from imported holdings (sliders paused, with a note), and the trade blotter has "Add my <country> holdings", which loads your positions in the current country with DV01, CS01 and FX delta.
- **Client note.** The memo builder has a second version, Client note: plain-language sections (our view, why, what it means for your portfolio, key numbers, what could go wrong, dates to watch, important information) with no trade levels, scores or DV01. It opens first for the private wealth adviser role.
- **Labels.** The remaining all-caps labels and export headings in built-in text are now sentence case.

The default persona is now Institution.

## 1. The short version

The terminal is organised by **method**: 3 pillars, 10 hubs and 41 desks with names like "Matrix OLS (HAC) & ROC Econometrics". Real users think in terms of **jobs**: "what changed overnight", "is Egypt getting worse", "what does a Hormuz closure do to my book", "write the IC memo". Every one of the five user types below starts from a **country** or a **portfolio**, and every one of them ends with a **document they hand to someone else**.

So the plan is:

1. **Make every number say where it came from** before we polish anything. Today the app can show hard-coded baseline values under a "live" label (see section 4). Professional users drop a tool the first time they catch that.
2. **Restructure around four places** rather than 41 desks:
   - **Today** (home): watchlist, what changed, alerts, calendar.
   - **Country**: one page per sovereign with six tabs.
   - **Portfolio**: positions, stress, contagion.
   - **Reports**: one builder for every output.

   The 41 desks stay in a searchable **Tools** library, and they're still reachable from Jump (⌘K).
3. **Set the role at first run.** It picks the home layout, the default country tab, the detail level and the report template. The three persona chips that exist today grow into this.
4. **Ship in six small PRs** (section 6). Each one leaves the app working.

## 2. The five user types

For each user type: who they are, what triggers a session, the steps they take, which existing desks serve each step, and what they hand on at the end.

### 2.1 Sovereign or macro economist (bank research, think tank, central bank)

- **Who:** writes the country view and maintains forecasts. Defends every number to sales, clients and peers.
- **Cadence:** daily scan of 10 to 40 countries; deep work when data or a policy decision lands; a quarterly forecast round.
- **Workflow:**
  1. Check what was released or changed overnight across the coverage list.
  2. Open a country and compare the new print with their forecast and with consensus.
  3. Update the debt path (DSA): growth, rates, primary balance, FX. Look at the fan chart and the r−g dynamics.
  4. Test the scenarios: policy pivot, fiscal slippage, external shock.
  5. Read the policy documents (MPC minutes, IMF Article IV) and pull out quotes.
  6. Publish a note with charts and a table of forecasts, and keep an archive of past calls.
- **Desks that serve it today:**
  - Global Macro Map & Horizon Forecasts
  - Debt Sustainability (DSA) & Fan Charts
  - Taylor Rule & Fiscal Dominance
  - FX BEER/FEER
  - Macro Surprise Z-Score
  - Matrix OLS econometrics
  - MPC & IMF Article IV Document AI
  - Academic LaTeX & CSV exporter
  - Historical Crisis Replay
- **Gaps:**
  - No "what changed since my last visit" view.
  - No place for their own forecast against the model's.
  - Source and vintage aren't shown next to each number.
  - Charts can't be exported one by one into a note.
- **Hands on:** a research note (PDF or Word) with charts, plus a CSV of forecasts.
- **Needs from the UI:** dense tables, full detail on by default, a source and as-of date on every figure, and keyboard navigation.

### 2.2 Investment banker (sovereign DCM, sovereign advisory, liability management)

- **Who:** advises finance ministries on bond issues, buybacks and exchanges, and pitches mandates. Works to client deadlines.
- **Cadence:** episodic and urgent, usually a pitch due tomorrow or a deal window opening.
- **Workflow:**
  1. Pick the issuer and look at the curve, spreads against peers, rating and investor base.
  2. Check market conditions for a window: the event calendar, liquidity, comparable recent deals.
  3. Size and structure the deal: tenor, new-issue concession, auction or syndication calendar.
  4. For a distressed client, run the restructuring maths: NPV haircut, exit yield, CAC thresholds, IMF and Paris Club sequencing.
  5. Turn it into pitch-book pages in house style.
- **Desks that serve it today:**
  - Yield Curve & NSS Carry+Roll
  - CDS Hazard & Basis
  - Peer Relative Value Z-Score
  - 24M DMO Treasury Auction Simulator
  - Shadow Rating & Fallen-Angel Cliff
  - Investor Base & Bank Doom-Loop
  - IMF/Paris Club & CAC Waterfall
  - Sovereign Haircut & Exit-Yield NPV
  - Boardroom IC Pitchbook Exporter
  - Macro & MPC Catalyst Calendar
- **Gaps:**
  - The peer comparison is spread across three desks.
  - No issuance-window view that combines the calendar, liquidity and spreads.
  - The pitch-book export can't be edited and isn't brandable.
- **Hands on:** pitch pages (PowerPoint or PDF) and a term-sheet-style summary.
- **Needs from the UI:** issuer and peers side by side, a few clean charts, and export that looks like a bank's own.

### 2.3 Multilateral (IMF or World Bank country team, regional development bank, sovereign wealth or central bank reserve manager)

- **Who:** assesses debt sustainability and programme design, and monitors reserves and spillovers. The work is methodology-bound and gets peer-reviewed.
- **Cadence:** mission cycles and programme reviews. Monitoring is monthly.
- **Workflow:**
  1. Build the baseline: debt, financing needs, reserves adequacy, external position.
  2. Run the DSA under standard and tailored shocks (growth, rates, FX, contingent liabilities) and check the risk signals.
  3. Look at transmission: trade and chokepoint exposure, reserve custody and sanctions risk, contagion to neighbours.
  4. If debt is unsustainable, look at restructuring perimeter and burden-sharing options.
  5. Write the board or staff report section, with a documented method and sources.
- **Desks that serve it today:**
  - DSA & Fan Charts
  - Global Liquidity & XCCY Basis
  - Reserve Custody Freeze & Chokepoints
  - Chokepoint Supply-Chain Matrix
  - Portfolio Contagion (as a country network)
  - IMF/Paris Club & CAC Waterfall
  - NGFS Climate Stress
  - 4-Quadrant Macro Regime Matrix
  - Crisis Replay
- **Gaps:**
  - The method isn't documented next to each output.
  - No way to save and name a scenario set and rerun it at the next review.
  - Assumptions and data vintages aren't kept together in an audit trail.
- **Hands on:** tables and charts for a staff report, with an assumptions annex.
- **Needs from the UI:** a reproducible run (named scenarios, saved assumptions, a vintage stamp), a methodology link on every chart, and a calm, neutral look.

### 2.4 Institutional investor (EM debt PM, CIO, risk manager, investment committee)

- **Who:** runs money against a benchmark. The PM finds trades, risk sets limits, and the IC approves.
- **Cadence:** daily morning meeting, intraday when markets move, weekly IC.
- **Workflow:**
  1. Morning: what moved, which signals fired, what's on the calendar today and this week.
  2. Screen for dislocations, where the model and the market disagree, and look at the top signals.
  3. Drill into a candidate country: why the signal fired, the curve and CDS, the event risk.
  4. Size the trade against portfolio risk: VaR/CVaR, contagion, correlation, the stress scenarios.
  5. Take it to IC: thesis, risks, the pre-mortem and kill-switch, then the decision.
  6. Afterwards, log the decision and score it (decision ledger, Brier score).
- **Desks that serve it today:**
  - Morning Alpha Radar
  - Top Alpha Signal Scanner
  - Model vs Market Dislocation
  - Polymarket & Kalshi Event Arb
  - Catalyst Calendar
  - Curve and CDS desks
  - Portfolio Stress-Test Lab
  - EMBI Pair-Trade Book
  - Portfolio Contagion & CVaR
  - PCA Correlation
  - RV Trade Blotter
  - Pre-Mortem & Kill-Switch
  - Decision Ledger & Brier Audit
  - CRO Gate
  - IC Ticket / Tear-Sheet
  - 9-Agent Council
- **Gaps:**
  - The morning view is a drawer, not the home page.
  - The portfolio isn't a first-class object; positions are spread across desks.
  - No signal → country → trade → IC path; each step is a separate desk switch.
- **Hands on:** the IC memo, the trade ticket and the risk report.
- **Needs from the UI:** a home page that answers "what do I need to know today", one click from a signal to its explanation, and the portfolio always in view.

### 2.5 UHNW client and their adviser (private banker, family-office CIO)

- **Who:** the principal is not a specialist and has 5 minutes. The adviser has to explain risk to them and justify an allocation.
- **Cadence:** a monthly or quarterly review, and ad hoc when headlines worry the client ("should I be worried about Turkey?").
- **Workflow:**
  1. The adviser opens the client's holdings or countries of interest.
  2. A plain-English view of each: traffic light, what's driving it, what would change it.
  3. A scenario in one sentence: "If oil spikes, your EM sleeve falls about X%."
  4. A recommendation the client can act on: hold, trim or hedge.
  5. A short, branded PDF to send or present.
- **Desks that serve it today:**
  - Executive BLUF Scorecard
  - Plain English detail level
  - Guided Policy & IC Playbooks
  - Global Map
  - Geopolitical Wargaming (presets only)
  - PDF export
- **Gaps:**
  - No presentation or client mode. Jargon is everywhere ("Bayesian P(Crisis|Z)").
  - No portfolio-in-dollars view.
  - No branded short report.
- **Hands on:** a 2-page client brief.
- **Needs from the UI:** a read-only presentation mode, large type, traffic lights, no formulas, and the adviser's branding.

## 3. What the five have in common

| Need | Economist | Banker | Multilateral | Institution | UHNW |
|---|---|---|---|---|---|
| Starts from a **country** | yes | yes | yes | yes | yes |
| Starts from a **portfolio** | | | (reserves) | yes | yes |
| "What changed" home | yes | | monthly | **daily, critical** | |
| Scenarios / stress | yes | some | **critical** | yes | one-sentence |
| Restructuring maths | | **critical** | **critical** | some | |
| Source and as-of on every number | **critical** | yes | **critical** | yes | hidden but available |
| Saved, named, re-runnable runs | yes | | **critical** | yes | |
| Output document | note | pitch | staff-report annex | IC memo | client brief |
| Detail level | full | medium | full | medium | plain |

Three conclusions follow:

- **Country** and **Portfolio** should be the main objects.
- **Reports** should be one builder with five templates, not five scattered exporters.
- The role should set defaults, not hide features.

## 4. Problems to fix first, because they decide whether pros trust the tool

These came out of reading `server.ts` and `src/data/presetsAndBaselines.ts`:

1. **"Live" can label hard-coded numbers.** Each country starts from a baseline in `presetsAndBaselines.ts` whose `liveApiSourcesActive` already lists IMF, World Bank, Polymarket, GDELT and Treasury. `fetchLiveOpenDataSnapshot` only replaces that list when at least one fetch succeeds (`server.ts`, around line 684). So when every feed fails, offline or blocked, the UI still shows "PROVENANCE · World Bank Open Data v2 REST API" over preset values. The Polymarket contracts in the baseline are also presets with a generic polymarket.com link.
2. **Market prices come from an LLM web search.** When a Gemini key is set, the policy rate, yields, CDS and rating come from a Gemini search-grounding prompt (`fetchGroundedMarketTelemetry`). That is a reasonable stopgap, but it has to be labelled "AI-sourced estimate". A desk can't treat it as a price.
3. **Only 8 countries are covered** (BRA, TUR, EGY, ZAF, MEX, IDN, JPN, GBR). Economists and multilaterals will expect their whole coverage list. Custom ISO-3 onboarding exists, but it's hidden behind a "+ ISO-3" chip.
4. **No state survives across devices.** Watchlists and sessions live in browser storage, so an IC can't share a run.

**The fix:** one data-status badge on every figure, with four states:

- **Live**, with its as-of time
- **AI estimate**
- **Model output**
- **Baseline (not live)**

A header indicator should also say "3 of 5 feeds live" honestly. This is Phase 0 below.

## 5. The new structure

```
┌ EconQuest ── Today · Countries · Portfolio · Reports · Tools ──── Jump ⌘K · Menu · Run Council ┐
│ [Country bar: BRA ▾  Debt/GDP 86.4% · CDS 168 · 10Y 12.85% · Reserves 14.2 mo · as of 14:27 ●] │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Today** (home): watchlist table with change since last visit; signals that fired; the next 7 days of catalysts; open IC items. This replaces the Morning Alpha Radar drawer and the BLUF drawer. The institution and economist roles land here.
- **Countries → one country page** with six tabs. Each tab reuses existing desks as panels:
  - **Overview:** BLUF, traffic light, key figures with sources, what changed.
  - **Debt & fiscal:** DSA, fan chart, auction simulator, investor base, ratings.
  - **Markets:** curve, CDS, FX valuation, peer RV.
  - **Politics & geo:** wargaming, chokepoints, sanctions and custody, prediction markets.
  - **Scenarios:** named scenario sets, A vs B, crisis replay.
  - **Restructuring:** NPV, CAC waterfall, IMF and Paris Club. It's shown only when it's relevant (risk above a threshold) or when the banker or multilateral role is set.
- **Portfolio:** positions you enter or import from CSV; stress lab; contagion and CVaR; pair trades; blotter; kill-switch.
- **Reports:** pick a template, check the contents, export. The templates are research note, pitch pages, staff-report annex, IC memo and client brief. This brings together the PDF, the SMCR dossier, the IC pitchbook and the LaTeX/CSV exporter. The council run and the CRO gate attach to the IC memo.
- **Tools:** all 41 desks as a searchable library grouped by topic, for power users.
- **Present mode** (UHNW and boardroom): full-screen, read-only, large type, traffic lights, no formulas, a logo slot.

**Role at first run** (changeable in Menu), with five roles in place of today's three personas:

| Role | Lands on | Country tab default | Detail level | Report template |
|---|---|---|---|---|
| Economist | Today | Debt & fiscal | Full | Research note |
| Banker | Countries | Markets | Medium | Pitch pages |
| Multilateral | Countries | Debt & fiscal | Full | Staff-report annex |
| Institution | Today | Markets | Medium | IC memo |
| Adviser / UHNW | Portfolio | Overview | Plain + Present | Client brief |

**Frame budget.** Today five rows of controls sit above every desk, about 340px. The target is the header plus one country bar, about 100px. The sovereign chips, Sync, Compare and IC Ticket move into the country bar's dropdown and its actions.

## 6. Delivery plan (each step is one reviewable PR)

| # | PR | What the user sees | Size |
|---|---|---|---|
| 0 | **Data truth** | Status badge (Live / AI estimate / Model / Baseline) and as-of time on the country bar and on key figures; an honest "n of 5 feeds live" indicator; baseline never labelled live. | S–M |
| 1 | **Frame** | Five control rows become header + one country bar; nav becomes Today · Countries · Portfolio · Reports · Tools; the old pillar menus survive under Tools. | M |
| 2 | **Today page** | Home with watchlist changes, fired signals, the 7-day calendar and open IC items. | M |
| 3 | **Country page** | Six tabs reusing existing desk components; Restructuring tab shown only when relevant. | L |
| 4 | **Role setup + Reports builder** | First-run role picker (five roles) setting the defaults above; one Reports page with five templates over the existing exporters. | M–L |
| 5 | **Portfolio + Present mode** | Positions as a first-class object (CSV import); read-only presentation mode for clients and boards. | M–L |
| 6 | **Polish** | Typography (less monospace, nothing under 12px for body text), plain-English desk titles, code-split the 500 kB bundle, accessibility pass. | M |

Out of scope for UI work but worth noting: wider country coverage, a licensed market-data feed in place of AI-sourced prices, and server-side saved workspaces for sharing. The first two are data decisions for Sam.

### Polish backlog: Council chat

- **Summary can contradict an agent in words. Fixed 2026-11-05.** Each agent now states its call in fixed words (policy tight / neutral / loose, CDS cheap / in line / rich, real exchange rate strong / near average / weak), the synthesis prompt carries them, and `checkBrief` removes any summary sentence about a country that describes the call in an opposing word (`src/utils/stanceCheck.ts`). Removed sentences show under the summary with the agent's call. Sentences naming two or more countries are left alone, as the word-to-country link is unclear. Logged by Sam, 2026-11-04.

## 7. Questions for Sam

1. Which user comes first? The recommendation is **institutional investor**: their daily cadence exercises Today, Country and Portfolio, and the other roles are mostly subsets.
2. Should AI-sourced market prices stay on (labelled) or be off by default until a real feed exists?
3. Is Present mode (UHNW and boardroom) needed early, or after the core pages?
