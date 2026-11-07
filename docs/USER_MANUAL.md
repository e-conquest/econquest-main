# User manual

How to use the terminal, page by page. For setup see the [README](../README.md); for every data
source and its settings see [DATA_SOURCES.md](./DATA_SOURCES.md); for what each source's terms allow
see [DATA_LICENCES.md](./DATA_LICENCES.md); for how each model and signal works and its backtest
verdict see [METHODS.md](./METHODS.md).

**Research, not validated advice.** The app is a research workspace. No model in it has been
independently validated, each signal shows its pre-registered backtest verdict (Menu > Models &
validation), and nothing in it is a recommendation to buy or sell. Every export ends with that line.

## Start here: a first hour

1. **Start the app** (README: Docker with `start-mac.command`, or `npm run dev`) and open it in the
   browser. Menu > Settings > AI model > *Test* checks the model; the Supreme Council and summaries use
   the referee model (qwen2.5:32b by default, `ollama pull qwen2.5:32b` first).
2. **Check the data.** Menu > Tools > *Data connections* shows each source as Connected, Needs setup
   or No answer. Add the free keys you want (FRED, EIA, UN Comtrade) under Menu > Settings.
3. **Save it for offline use.** Menu > Offline data > *Download all country data*. After that the app
   works without a connection and each figure shows the date it was saved.
4. **Ask the council.** On Workspace, type a question ("Is Brazil's policy rate too tight?"). Each
   agent answers with its figures, sources and dates; open a document for the full working, or
   *Explain* on any figure for where it came from and what moves it.
5. **Look closer.** Research > one country: Summary, Markets & signals, History & data (output gap,
   debt sustainability, fiscal multipliers), Sources.
6. **Write it up.** Save the answer to Reports, start a Policy review, or build a report. Download as
   Markdown or PDF.
7. **Before you share.** Check the badge on each signal (Menu > Models & validation) and the terms of
   each source in the figures (Menu > About & data licences): some ask for a credit line, a few need
   the provider's permission before figures go to clients or into a paid product.

The header has three pages: **Workspace · Research · Reports**. **Tools** is inside the **Settings**
window (Menu > Tools, or the Tools tab in Settings). Workspace is the daily start; Research is where
you look into one country, the watchlist side by side, or your own holdings.

**Reading any figure.** A figure is shown only when a real source supplied it. Hover it for the
source and date. A dash or **Missing** means no source answered, and the note beside it says why:

- *Needs setup*: a key or file is missing (Menu > Settings says which).
- *Feed did not answer*: the source was down or unreachable on the last pull; it is retried within
  the hour.
- *No source yet*: no free official source is wired in for that figure and country.
- *kept from the <date> pull*: the latest pull failed for that source, so the last good figure is
  shown with its original date.

Figures worked out by the app from live inputs (debt paths, policy rule gaps, currency valuation) are
labelled with the agent or rule that made them, for example "Fiscal & Debt Agent", and are never
shown when an input is missing.

---

## 1. Workspace

The page the app opens on is a chat page, laid out like an AI chat app: the conversation with the
council fills the screen and the question box sits at the bottom. **Briefing** (top right of the
chat; an amber dot means an input needs setup) opens a side panel with Your inputs, the watchlist,
What moved, Next two weeks and Watch alerts; on a phone it covers the screen, and *Close* hides it.
The app remembers whether you left it open.

**Your inputs.** One chip for each thing you set that changes what Workspace shows: watchlist, open
country, data feeds, free keys, AI model, holdings and saved research. Each chip shows its state
(green set, amber needs setup with the reason, grey optional and not used yet), names the panels it
feeds, and opens the place where you change it. On a new install, the amber chips are the setup
steps. Point at a chip to outline the panels it feeds. Under each panel title a *Uses:* line names
the inputs behind it, marks any that are Missing or need setup, and opens one when you press it.

**Since your last visit.** What moved on the watchlist since you last opened the app: policy rate
moves (BIS), new monthly inflation prints, turns in the OECD leading indicator, 10Y yield moves of 25
bp or more, and watch alerts that started firing. Each line has its date and source. On a first
visit it lists policy moves from the last 30 days. Your last visit is remembered in this browser only.
When no feed has answered for the watchlist it reads Missing with that reason, not "Nothing moved".

**Watchlist.** A compact card with your list, under Your inputs; the open country is marked *Open* and countries in your imported holdings are marked *Held*. *Pop out* opens the full table in its own window,
with your choice of columns; *Edit* adds or removes countries and switches lists.

**Council chat.** A chat with the council. Type a question in the box at the bottom, or pick one of
the suggestions. Your question appears as a message, and the council answers in the chat: the
summary first, then the documents (the synthesis and one per agent, with how many agents answered
with figures), the agent debate, and one row of actions on each answer: *Save to Reports* (keeps the
answer as the council brief and every document under Reports > Council documents; it then reads
*Saved to Reports* with a link to open Reports), *Copy*, and *Download* (Markdown or PDF). Earlier answers stay in
the chat above the newest one. *New conversation* clears it (saved conversations stay in Saved
research).

The chat is one conversation across the whole app. On Research and Reports, *Council chat* in the
header opens the same chat in a panel on the right (full screen on a phone); questions asked there
show on Workspace too, and an answer that is still being written keeps going when you change page.
*Close* hides the panel; the header button brings it back.

Under the question box, *Options* holds the rest: the countries to ask about, policy documents, the
full council and saved research.

- *Countries*: as named in the question, otherwise the whole watchlist. A country not on the
  watchlist is named as not covered rather than silently answered for the list; *Add … for this
  question* pulls its live figures (any country, up to five at a time) and asks again, without
  changing your watchlist.
- *Agents*: chosen from the question's topic (or by the AI model, if set up). Each answers with
  figures and their sources: Central Bank (policy rate, stance, cycle), Fiscal & Debt (debt path,
  stabilising primary balance, reserves against debt due), Politics & Events (GDELT tone, weekly
  event counts and economic news themes from the GDELT raw files, World Bank stability rank,
  Polymarket odds), Relative Value (cheap or rich against peers), FX (real exchange
  rate against its history), Global Spillover (Hormuz, Taiwan, Russia, commodity prices), Calendar
  (dates in the next 60 days) and Timing (catalysts, cycle clock, positioning, tone shifts; dates,
  never probabilities).
- *Policy documents*: add a PDF or text file, or paste text. The Document agent quotes passages, and
  figures in the document are checked against the app's own figures.
- *Brief*: with Gemini or Ollama set up, a summary agent writes a short brief from the agents'
  answers only. A number check marks any figure it cannot trace to an agent.
- *Follow-up*: once a conversation has started, the box asks follow-ups. "and the currency?" or
  "what about Egypt?" keeps the last question's countries or agents. Asking the same question later shows what changed since last time.
- *Explain*: ask why ("why is Brazil's real rate so high?"), what something means ("what does a weak
  lira mean for households?") or how it feeds through, and the council explains instead of ranking.
  The answer is split into **Data** (what the figures are, each with a numbered source) and
  **Interpretation** (why it is where it is, what it means through each lens: monetary policy,
  public finances, households and firms, trade and external, conflict and politics, markets, and
  what would change the reading). Name a lens ("for the budget", "for households") to get just that
  one; otherwise every lens the agents have figures for is covered. A lens with no figures reads
  *Missing* with the reason. Households and firms are read from inflation, rates and the currency;
  there are no surveys in the app. The same number check applies: a sentence with a number not in
  the agents' figures is removed.
- *Explain on a figure, chart or panel*: an *Explain* link sits beside every figure in an agent
  document and on the Research pages (point at a row on a wide screen to see it), at the top of
  each Research panel, and on every chat chart. It sends that exact figure, with its source and
  date (or the chart's latest points and test results), to Council chat and asks the council to
  explain it; on Research the chat opens in its side panel. Follow up with "and for households?" to
  narrow it.
- *Chat charts: Image and CSV*: each chart the Chart Agent draws in the chat has *Image* (an SVG
  file) and *CSV*. The image carries the title on top and, under the chart, its sources, the credit
  each source's terms ask for (from the licence register), the dates, the day it was made and the
  research notice, so it keeps them wherever it is pasted. The CSV lists the same credits as `#`
  lines. With Sharing mode on, both buttons are off for a chart that uses a source whose terms do
  not let its figures be passed on, and the card says which.
- *Chat charts: Replication pack*: a zip with the chart's data (`data.csv`), the same tests written
  out in Python (`replicate.py`, numpy, pandas and scipy), R (`replicate.R`, base R) and Stata
  (`replicate.do`) with the settings the app used, and a README listing each column with its
  source and credit and the app's own figures to check against. The scripts do the arithmetic by
  hand (OLS, the Granger F test, the ADF lag search, the HP filter), so they match the app rather
  than a package default. Sharing mode turns it off like the CSV.
- *Suggested questions*: the empty chat offers up to four questions picked from your own data, no
  AI: one on your largest holding (asked the way its asset class is judged), up to two on what moved
  on your watchlist (a BIS policy-rate move in the last three months, a 10Y yield change of half a
  point or more over three months, a debt path rising five points of GDP or more) and your last
  saved question (asking it again shows what changed). Point at one to see why it is offered. The
  fixed examples fill the rest.
- *Charts and statistical tests*: ask for a chart in words, for example "chart Brazil's policy rate
  against inflation and test which moves first". The Chart Agent draws the series the app holds
  (series it does not hold are listed as Missing, with the reason), puts them on their common
  frequency, and runs the tests asked for: correlation, regression (scatter with the line), lead/lag
  (which moves first), Granger (does one help predict the other), stationarity (ADF) and trend and
  cycle (HP filter). Each test comes with a plain-English reading and a caution when the sample is
  short.
  - *Econometrics lab*: on two series, also ask for "Newey-West errors" (the regression with
    errors robust to autocorrelation), "a VAR" or "impulse responses" (lag by AIC, the first
    series ordered first, 90% bootstrap band), "local projections", "cointegration" (Johansen
    trace test) or "structural breaks" (the largest Chow statistic over dates, then Bai-Perron's
    break dates by BIC). They are also switches in *Open larger*. The larger view draws the
    response paths. All are descriptions of the sample, not forecasts or causal estimates. Ask for "year-on-year", "changes", "indexed" or "z-scores" to show the lines another way.
  - *Ready-made charts*, asked for by name or from *Charts and statistical tests* under the welcome
    line: Phillips curve, Taylor rule gap (the policy rate against r* 2% + inflation + 0.5 x
    inflation gap + 0.5 x output gap, with the central bank's own target), real policy rate, real 10Y
    yield, yield curve slope (10Y minus policy rate), r minus g (10Y yield minus inflation minus real
    growth) and leading indicator vs policy rate. Worked-out lines show where they stand against
    their own history.
  - *Across countries*: "scatter government debt against bond yields across countries" puts one point
    per country at its latest figure, fits a line, and names the countries furthest above and below it.
  - *Talk about it*: follow-ups such as "is that relationship stable over time?", "what about Mexico?"
    or "what does this mean for the next policy move?" keep the chart and add the test or the desk
    agents; with an AI model, the summary agent writes from the chart's test results like any other
    agent's figures.
  - *Open larger* shows the lead/lag and rolling-correlation charts, and lets you show the lines
    another way or switch tests on and off. *CSV* downloads the figures with their sources and credits (for a cross-country scatter, one row per country). *Save to
    Reports* keeps the chart with the Chart Agent's document under Reports > Council documents.
- *Saved research*: every brief and document is kept on this computer
  (`data/local/research.json`). Open, copy, send to Reports or delete from the list.
- *Run the full council*: nine desk agents debate the open country, then pause in the chat for your
  approval before the final report, which also appears in the chat. It needs Gemini or Ollama (Menu > Settings > AI model). If no model answers, the
  council gives no assessment and no verdict and says so; a desk whose model did not answer is left
  empty. Agent confidence is shown only when the model gave one.
- *Pin this conversation to the figures held now*: answers in the conversation keep using those
  figures even if the feeds refresh. *Use the latest figures* under the box unpins it.

**Snapshots and Re-run.** Every AI summary or explanation is pinned to a snapshot, shown folded
under the answer (`Snapshot 715d5502 · latest data · qwen2.5:32b`). Open it to see when the
question was asked, which data it used, the AI model, the temperature (0) and seed (42), short
hashes of the instructions, the prompt, the inputs and the answer, each agent document read, and
every figure with its source and period. *Re-run on this snapshot* sends exactly the same inputs
to the model set now and says whether the answer is the same word for word, or what changed and
why (a different model, changed app instructions, or the model itself). Snapshots are kept in
`data/local/snapshots/`, named in Menu > Audit log, written into saved and downloaded briefs
(under Method), and included in Menu > Backup. A snapshot edited after it was saved is not
re-run.

**Regression check.** `npm run council:regress` (with the app running) sends a fixed set of
questions with frozen agent answers (`docs/validation/council-regression/cases.json`) through
the same summary step, on your AI model, and checks each reading: for example that Brazil's
policy is read as tight, or that Egypt's debt is not called sustainable when its debt figures are
missing. It prints PASS or FAIL per case with the reason and saves the report in
`data/local/validation/council-regression.json`; each case is a snapshot you can re-run. When a
recorded baseline exists it also says whether the answers match it.

**Recorded baseline (real-model regression in CI).** `npm run council:record` runs the same set
on your referee model (qwen2.5:32b) on a private copy of the server and records every model
reply. Once those are committed, CI replays them and fails when a code change alters what the
model is asked or what the checked answers say. See
`docs/validation/council-regression/README.md`.

**Watch alerts.** Rules you set on the timing figures, for example "CFTC positioning percentile at
or above 90 for any country". There are no built-in thresholds, and a missing figure never
triggers. Rules are kept in `data/local/watch-rules.json`.

**Next two weeks.** Official rate decisions, CPI releases, elections, budget deadlines and IMF
reviews, each linked to its source. Below it, the next three elections, budgets and IMF dates in the
coming year (*Show all* for the rest), with countries where data and price disagree first.

---

## 2. Research

One page, three scopes, chosen at the top: **One country: <name>**, **Compare countries** and **My
holdings**. Every scope has the same four sections, so you learn the page once:

| Section | One country | Compare countries | My holdings |
| --- | --- | --- | --- |
| **Summary** | The brief | Where data and price disagree; growth and inflation | Book brief; the book |
| **Markets & signals** | MarketEdge | MarketEdge table; scenarios | Signals on your holdings |
| **History & data** | Charts, As of, Replicate, Track record | Compare countries table | Import and edit holdings |
| **Sources** | What is live for the country | Each key figure, Live or Missing, per country | The same, for the countries you hold |

The section stays when you switch scope: from Brazil's *Markets & signals*, *Compare countries* opens
on markets for the whole watchlist. Click a country in Compare or My holdings to open it on its own;
*Back to Compare countries* (or *My holdings*) returns you. Research opens on the scope you used last.
On a phone the scopes read *<country> · Compare · Holdings*.

### Compare countries

Your watchlist side by side. Opening it does not count as a visit for *Since your last visit*.
**Summary** holds the first and third panels below, **Markets & signals** the second, fourth and fifth,
**History & data** the table, and **Sources** a grid of every country and key figure, each Live or
Missing with its reason.

**Where data and price disagree.** One line per country, biggest gap first: cheap or rich spread
against peers, policy rate against inflation, carry and currency valuation. Built from live figures
only. Stated rules for discussion, not trade advice.

**MarketEdge.** Your watchlist plus the US, China, Russia, UK, EU and India. Columns: 10Y yield,
spread over the US 10Y, 3-month and 12-month changes, CDS (your own data only), real FX
against its 10-year average, OECD leading indicator and last policy move. Sort by *Widest spread*
or *Moving most*. The screen makes no cheap or rich call: the old fit against the app's composite
risk score was never tested and has been removed.

**Growth and inflation.** Each country placed by the 6-month change in its OECD leading indicator
(right = picking up) and the 3-month change in its monthly inflation (up = rising), with a line on what
that quadrant means for policy. A country without both figures is listed with what is missing.

**Scenarios.** Who is most exposed to a Hormuz closure, a Taiwan blockade, tighter Russia
sanctions, and the last 12 months of commodity prices, from UN Comtrade trade shares, World Bank
Pink Sheet and EIA prices.

**Fed balance sheet.** The dollar liquidity backdrop from the Federal Reserve's weekly H.4.1 release
and the NY Fed, via FRED (no key needed): total assets, bank reserves, the Treasury General Account
and overnight reverse repos, in billions, each with its own date, its change over 4 and 52 weeks and
a two-year line. *Net liquidity* (total assets less the Treasury account less reverse repos) is a
market shorthand, not an official series; it shows only when all three have a value on the same
Wednesday. A series FRED does not answer for uses the last saved pull, with its dates, or reads Missing.

**Compare countries.** Tick countries and figures, then *Build table*. *Latest values* gives one cell per
country and figure, with its period underneath; hover for the source, or for the reason when it reads
Missing. *Full history* counts every observation; *Download CSV* saves either view, with unit, period,
source and the reason for every missing cell, ready for Excel, R or Stata.

---

### One country

Pick a country from the list at the top. **Refresh now** pulls every source for it again at once.
The sections are Summary (the brief), Markets & signals (MarketEdge), History & data and Sources.

**Summary (the brief).** Three views of the open country, each a list of observations with the rule behind it:

- *Economist*: growth, inflation, debt, reserves and the external position.
- *Issuer*: market access, external debt falling due in the next 12 months (World Bank/IMF QEDS and
  IDS, BIS debt securities), distress tests and pricing against peers.
- *Official sector*: debt sustainability. Debt path under a baseline and standard shocks, the
  stabilising primary balance and r minus g. Run only when debt, primary balance, growth, inflation
  and the official 10Y yield are all live; otherwise it lists what is missing.

**Markets & signals (MarketEdge).** Under three headings, *Economy and policy*, *Markets and positioning* and *Risks and
links*. The country against its peers: policy
stance (tight, neutral or loose), the cycle clock (hiking, cutting or on hold and for how long; the
leading indicator phase and last turning point; next decision date), a policy rule check (the policy rate against a simple
Taylor rule: r* of 2%, inflation, half the gap to the bank's own target and half the IMF output gap
where the IMF publishes one; the term is left out and said so elsewhere), FX valuation, carry per unit of
volatility, CFTC futures positioning, US Treasury TIC holdings, IMF reserves and balance of payments,
world reserve currency shares (COFER), shock early warning and the signal track record. The same
readings across the watchlist are under Compare countries.

**History & data.** Every figure that has a run of real observations, as a chart with its source, how often it
comes, the pull date and any gaps (named, never filled). Policy rate (BIS), monthly inflation, the OECD
leading indicator, CFTC positioning and TIC holdings come with their own history. The exchange rate
per US dollar comes daily from 1999 for the about 30 currencies the ECB publishes (ECB reference rates
via Frankfurter; first download in the background, also a step in Menu > Offline data); other
currencies keep the saved-pulls run and say why. Government debt,
primary balance, growth, IMF inflation, output gap, reserves (months of imports and USD), current
account, external debt, short-term debt and political stability come with every year the World Bank
or IMF WEO publish (saved in data/history/, refreshed weekly); IMF years from the current one on are
marked "IMF projection" and never shown as the latest figure. Any other figure gains one point per
weekly pull from the pull archive, each with what the source said that day. Click
a figure in the country header to open its history. *Show the numbers* lists every observation.
*Download this series* and *Download every series* save CSV files in long format (one row per
observation, with unit, frequency, source, the source that day and the pull date).
Figures with no history yet are listed with the reason.

**Gross financing need.** Research > History & data shows, year by year, the deficit plus external public debt falling due, as % of GDP (IMF Fiscal Monitor, World Bank IDS and QEDS, IMF WEO GDP in dollars). Domestic debt falling due has no free source, so the total is labelled "at least": a lower bound. Years at or above 15% of GDP, the IMF market-access flag for emerging markets, are highlighted.

**Reserve adequacy.** Research > History & data shows reserves in months of imports, against short-term external debt and against broad money, and reserves as a share of the IMF's reserve adequacy (ARA) metric for emerging markets. One term of that metric, other portfolio liabilities, has no free source, so the share shown is an upper bound: under 100% means short of the IMF floor for certain, above 100% does not prove adequacy. Both the floating and the fixed exchange rate weightings are shown.

**Debt fan chart.** Under Debt sustainability, a fan shows where debt could go over five years if the past shocks to growth, inflation, interest and the primary balance repeat: 2,000 paths drawn from whole past years around the IMF baseline, with the 10-90 and 25-75 percentile bands, the median and the share of paths ending above today's debt. It needs 10 past years with all four figures; otherwise it says what is missing.

**Inflation after rate changes.** Research > History & data shows how inflation has moved in the 0 to 24 months after a one-point policy rate change, estimated by local projections on the monthly CPI and BIS policy rate history, with 90% bands. It is a record of co-movement, not the effect of policy: central banks raise rates when they expect inflation to rise, so the first months often show inflation going up.

**Policy rules.** Research > History & data sets the policy rate against five standard rules on the same inputs (Taylor 1993, balanced approach, inflation only, inertial, first difference), with each rule's formula and prescription, the range they span and whether the policy rate sits above, below or inside it. The neutral real rate is fixed at 2% (Taylor's), and the panel says how each rule shifts if it is lower.

**Costed options.** Under Debt sustainability, a table shows four stated options (tighten 0.5, 1 or 2 points of GDP, or loosen 1 point) against the baseline: debt five years out, the change against the baseline and the output lost, each on the low and high end of the IMF's multiplier range for the country's group. When a tightening would push debt/GDP up in the first year because output falls faster than debt, the row says so.

**BEER fair value.** Research > History & data sets the BIS real effective exchange rate against the level its fundamentals have gone with in the country's own history: terms of trade, GDP per head at PPP against the US, and the current account summed over the years (standing in for net foreign assets, which have no free source). The chart shows the yearly rate and the fitted level, the table the coefficients (flagged when the sign is opposite to theory), and the sentence how far the latest month sits from the latest fair value. A yardstick fitted on 20-30 years, not a forecast; marked Not validated because it implies the gap closes.

**Currency around rate decisions.** Research > History & data shows how the currency has moved against the dollar in the 10 business days before and 20 after each policy rate change, its own central bank's or the Fed's (switch at the top): the average path after hikes and after cuts, with 90% bands and the number of events, from the BIS daily policy rates and ECB reference rates. A description of the past, not a forecast: many decisions were expected, so the move on the day is only the surprise part.

**Idea journal.** Menu > Idea journal (or Log idea under a Council chat answer, which fills in the country and the question) records a trade idea: a currency against the dollar or a policy rate, the direction, a horizon of 7 to 730 days, an optional invalidation for currency ideas, the thesis and a type. The entry level is the latest ECB or BIS figure on the day, the record is hashed and added to data/local/ideas.jsonl, and nothing in it can be edited from the app. At the horizon it is scored from the same feeds, and the journal shows the hit rate and average currency move by idea type. Scoring, not a signal.

**Global shock scenarios.** Research > History & data asks: if the Fed moves or the dollar swings, how have this country's currency and policy rate moved with it? Pick a preset (Fed +1 point, dollar +5%, both, or the reverse) or type your own moves; the implied currency and policy rate moves update as you type, with 90% bands, the size of a typical unexplained month and a warning when your shock is bigger than anything in the sample. Fitted on the last 15 years of monthly moves; co-movement, not a forecast.

**Fiscal reaction (Bohn test).** Research > History & data asks whether the government has raised
its primary balance when debt was higher: the IMF primary balance regressed on last year's IMF debt
and the app's output gap, outturn years only, with Newey-West errors. A positive, significant
response is Bohn's sufficient condition for sustainability; the panel says "responds", "weak" or
"no response found", shows the years used and has Explain. A record of past behaviour, not a
forecast.

**Nowcast and forecasts.** Research > History & data shows, for GDP growth, inflation, the policy
rate and government debt, the app's nowcast of periods not published yet and its forecast of the
next quarters with 50, 70 and 90% bands, beside the IMF projection where the IMF makes one. Each
model was scored out of sample before use, under a test fixed in advance
(`docs/validation/forecasts/`, run with `npm run forecast:evaluate`). The result shows above the chart:
*Evaluation passed*, *Evaluation failed*, *Too few cases* or *Not validated* (not run yet). A
forecast that failed is not drawn: the panel says so and *Show it anyway* draws it, labelled "failed
test", as an illustration. On the last run (6 November 2026) only the GDP nowcast passed; the GDP,
inflation, policy rate and debt forecasts and the inflation nowcast failed. A failed model is never
tuned and run again under the same name; a new method is a new test. The Nowcast and Forecast agent
in Council chat gives the same figures with the same verdicts. `npm run forecast:worst` lists the
series where a model missed most.

**Historical context.** Under each History chart a line puts the latest figure in its own
history: a record or "highest since" (only when that date is far enough back to matter), where it
sits among all the saved observations, and the change on a year earlier. IMF projections are left
out.

**Claim check.** Type a sentence with a figure or a ranking into Council chat, such as "Turkey's
inflation is 33%" or "Is it true Turkey's inflation is the highest in the G20?", and the Claim Check
answer puts it next to the app's own figure, with the source and date: matches, differs (by how
much), or a different period when the sentence names another year. A ranking is ranked among the
G20, G7 or watchlist countries the app holds a figure for; a higher figure elsewhere disproves it,
and members with no figure are named, since the app cannot rule them out.

**Story leads.** Research > Compare countries > Summary opens with a short list of places to look:
official yearly figures at a record or their highest or lowest in ten years or more, values the IMF
or World Bank revised by a lot in the last 30 days, and what moved since your last visit. Countries
with no saved yearly history are named; open their History once to download it.

**Publish a chart.** Under each History chart, Publish chart downloads it as PNG or SVG with
the title, source, period, the date and a credit line taken from the licence register (you can edit
it). Sources whose terms restrict free sharing, such as Kalshi or OECD yields served through FRED,
block the download until you tick that you hold permission.

**Unit converters.** Research > One country > History & data turns an amount in the country's
currency into real terms (prices of another year), US dollars, purchasing power parity and per
head, each line with the World Bank figure it used and its year. A year with no figure reads
Missing; the nearest year is never put in its place.

**Exercises.** Research > One country > History & data sets up to four questions for the month you
pick (the real policy rate, the Taylor rule, r minus g and the change in the debt ratio), each
worked out from the app's own figures. Type an answer and press Check; it counts as right within
the stated tolerance. The answer key shows the workings and every figure used with its source. In
exam mode the key is held back and answers are only marked right or not.

**Model sandboxes.** Research > One country > History & data has sliders on three of the app's
formulas, starting from the country's latest figures: the debt identity (debt, interest rate,
growth, inflation, primary balance and years ahead give the debt path and the balance that holds
debt steady), the Taylor rule (neutral rate, inflation, target, output gap and both weights) and
the output-gap filters (HP with any lambda against Hamilton with any horizon). A figure the app
does not have reads Missing until you type one. Illustration of the formulas, not a forecast.

**Event history.** Research > History & data shows protests and violence as a share of the
country's events each month, from the GDELT 1.0 daily event files (shares, not counts, because
GDELT's volume grew many times over the years). It is empty until the files are pulled with
`npm run gdelt:daily` (below); before that it says Missing and how to fill it.

**Unrest spikes.** Under the same panel, a month is a spike when protests or violence, as a share
of the country's events, stand 3 or more standard deviations above the country's previous 24
complete months (with a floor of 0.25 points on the deviation, so a flat history does not turn a
small move into a spike). Only past months enter the baseline, so each reading is what could have
been said at the time. The first month of a run is an episode. Whether a spike episode in a
country without armed conflict is followed by conflict the next year is the pre-registered test
`unrest_onset` (Menu > Models & validation), run with the other backtests once the GDELT files and
the UCDP files are on disk. UCDP is yearly, so the test can only ask about the next calendar year.
Until it passes, the badge says it is not validated.

**Country risk scorecard.** Research > History & data puts five sets of figures side by side, each
with its source and year: the six World Bank governance indicators (0 is the world average, 1 is one
standard deviation, with the change over five years), armed conflict and deaths from UCDP for the
latest year it has coded, this month's unrest reading from the GDELT files, the Caldara-Iacoviello geopolitical risk
index for the country and the world (save their monthly file as .xlsx or .csv in `data/local/gpr/`),
and the economy (debt,
growth, inflation, current account, reserves, external debt). There is no overall score, because
any weighting of them would be a guess. A figure that is not on file is listed as Missing with
the reason. The six governance indicators download with the rest of the country's official history,
so a history saved before this version downloads once more the next time the page is opened online.

**Geopolitical risk VaR.** Under Global shock scenarios, once the Caldara-Iacoviello file is saved
in `data/local/gpr/` (see the scorecard above), the panel shows how far the currency fell in its
worst months (95% VaR and expected shortfall) when geopolitical risk was in its top tenth, against
all months, using the world index and the country index where there is one. Beside it is the move
the US rate and dollar shifts of those months alone imply, from the scenario model. It is a record of
the past, not a forecast, and high-risk months come in runs, so there are fewer separate episodes than
months.

**Sanctions lists.** Research > History & data counts the people, firms, vessels and aircraft on
the OFAC and UN sanctions lists with an address or nationality in the country, by programme, and
has a name search across the lists. Run `npm run sanctions:pull` to save the lists in
`data/local/sanctions/` (or download them by hand: see docs/DATA_SOURCES.md). This is not a
compliance screen: aliases are not searched, there is no fuzzy matching, and firms owned by listed
people are not counted. A name that is not found is not cleared.

**Armed conflict (UCDP).** The Uppsala Conflict Data Program's yearly files (armed conflicts,
battle deaths, non-state and one-sided violence, CC BY 4.0) ship with the app in `datasets/ucdp/`. A
newer release saved in `data/local/ucdp/` (CSV or zip, from ucdp.uu.se/downloads) is read in their
place. They feed the Politics & Events agent, the full council and the Sources tab. No key is needed.

**Past IMF WEO editions (real-time vintages).** To see a figure as the IMF published it at the time
(for example the October 2018 forecast of Turkey's 2019 growth), download past editions of the WEO
database from the IMF site (the tab-delimited "By Countries" file for each edition, named like
WEOOct2018all.xls) and save them in `data/local/weo-vintages/`. The app fetches nothing by itself;
`npm run weo:pull` tries to download every April and October edition from 2005 into that folder
(each URL layout the IMF has used is tried in turn, and anything that does not read as a WEO table
is dropped), and lists any edition it could not get so you can save that one by hand. `npm run
weo:vintages` lists what it read and any file it skipped with the reason;
`npm run weo:vintages -- --country TUR --code NGDP_RPCH --as-of 2019-06-01` shows the edition that
was out on that date, each year tagged actual, estimate or projection. An edition counts as
published on the last day of its month, so a test never sees it early. The same files feed Research > History &
data > IMF forecasts by edition: pick an indicator and a year to see every edition's figure for it,
each marked data, IMF estimate or IMF projection at the time. They also feed the pre-registered
debt fan coverage test (`docs/validation/forecasts/debt_fan_coverage.json`, run by `npm run
forecast:evaluate`): at each past October edition the fan is rebuilt as the panel builds it today,
on that edition's actual years and projections, and the test checks that later debt outturns fall
inside the 10-90 band between 70% and 90% of the time at every horizon from 1 to 5 years.

**Sources.** Every figure the country pages use, with its source and date, or why it is missing and
what would fill it. *Download these figures* saves them as CSV: value, unit, period and source for each live
figure; "Missing" and the reason for the rest, never a number.

*Older than usual* lists any dated figure that is older than its source normally runs (how often it
comes out plus its usual delay: a daily yield more than 7 days old, a monthly CPI more than 2 months
back, a weekly CFTC report more than 14 days old), with why it runs behind and the fresher source that
would replace it, if there is one. Annual IMF and World Bank figures are not judged; their year is
shown beside them. When the Central Bank, Fiscal & Debt, Relative Value, FX or Timing agent answers
with such a figure, it says so under what it could not answer.

Every download (series, figures, *As of* figures, Compare countries) also comes as an Excel workbook:
the *Excel* button next to each CSV button. The workbook holds the same rows and columns as the CSV on a
*Data* sheet (bold, frozen header with filters; numbers stored as numbers, text as text so nothing runs as
a formula) and an *About* sheet naming the file and when it was made. Missing values stay Missing.

Every figures download also has a *licence* column, and every References list in a brief or note ends each source with *Licence:*. It gives the licence class of the figure's source from the licence register (Menu > About & data licences): open with attribution, allowed with conditions, permission needed for client or commercial use, or terms not confirmed. A figure worked out from several sources takes the strictest class among them; a source the register does not name says so.

*As of a past day* (below the chart): pick a date and see every figure the app held on that day,
from its saved pulls, beside today's, with the change where both sides are live. A day without a pull
uses the pull before it. Each value keeps its own source and period; hover for them, or for the
reason a value reads Missing. *Download these figures* saves that day's figures as CSV. The archive
gains a day with each pull, so the choice of dates grows from the day you install this version.

*Replicate a rate decision* (below that): pick one of the central bank's moves from the BIS series, or
any date, and see the policy rate the week before, the latest monthly inflation before the decision
month, the bank's target, the OECD leading indicator, what a simple Taylor rule pointed to (raise,
cut, or hold within 1 pt) and what the bank did. Two caveats are always shown: today's series may hold
revised figures rather than the first release, and the output gap is left out because the IMF's is
revised every vintage. A teaching and checking tool, not a model of how the bank decides.

*Track record* (below that): the Taylor rule signal on each saved pull (raise, cut or hold within 1 pt)
and what the central bank did in the 90 days after it. The policy rate and the IMF output gap are read
from that day's saved pull, as the app held them; monthly inflation uses only months at least 45 days
old on the pull day. A run of weekly pulls with the same signal counts as one call. Each call stays
*pending* until 90 days have passed and the BIS series reaches that day. The line on top counts calls
followed and says when there are too few (under 5) to lean on. No odds are given. *Download log* saves
every pull as CSV or Excel. The log starts with the archive, so it fills in week by week.

The older desks (Debt & fiscal, Markets, Politics & geo, Scenarios, Restructuring) ran on built-in
figures, so they have been removed from the app.

---

### My holdings

Import your holdings as CSV under **History & data** (a template is provided), or add positions one at
a time. **Summary** shows the book brief and the book, **Markets & signals** the signals on your
holdings, and **Sources** what is live for each country you hold. Holdings, watchlists,
countries you added and the AI model settings are kept in `data/local/workspace.json`, so the app
shows the same ones under Docker and `npm run dev`, and clearing the browser does not lose them. Without holdings the
page uses your watchlist at equal weight. The book brief shows concentration, where the risk sits,
the DV01 cost of a 10 bp move and dates to watch. The client brief says the same in plain language.

*Signals on your holdings* lays each imported holding over the app's signals that bear on it and marks
each signal as leaning with or against the position. Local-currency bonds get the Taylor rule check, the
policy cycle and the 3-month move in the 10Y yield (25 bps or more counts): lower rates lean with a long
bond and against a short. Every credit holding gets the shock early warning: an alert leans against a
long bond or sold protection and with bought protection. FX and other holdings are listed but not
marked, since the holdings file does not say which leg is long. The top line splits the gross notional
into against, mixed, with and nothing either way. Missing inputs are named; built-in figures never
count. A signal against a position is a reason to look, not a call to trade.

---

## 3. Reports

**Policy reviews.** At the top of Reports. A step-by-step case file for a principal, economist or
politician looking for ways to improve policy in one country, with the council's help. Start one with
*New policy review*, or with *Start a policy review* under any Council chat answer (the question
becomes the problem). Six steps, in order:

1. **Frame.** Country, the problem in a sentence or two, the goal (which indicator, lower / higher /
   stable, optional target and month), constraints, who it is for, and the **As of** day. Every later
   step reads the data the app had saved on or before that day.
2. **Diagnose.** Twelve standard indicators from that saved pull, each numbered [1] to [12] with its
   source and period, or Missing with the reason, plus the real policy rate and r minus g when their
   inputs are live.
3. **Options.** Add up to four options of your own if you like, then *Ask the council*. It ranks
   options for the goal from the frame and diagnosis only, at temperature 0, each with how it works,
   time to effect, trade-offs, who bears the cost, what must be true and risks, and one sentence from
   each council lens. Sentences with numbers that are not in the diagnosis are removed and listed. No
   AI model? *Save my options only* keeps yours, marked not assessed.
4. **Evidence.** Charts and tests (Taylor gap, real rate, does the policy rate lead inflation, r minus
   g, leading indicator), past policy-rate moves with inflation a year later, and the validation status
   of each signal the options lean on. Every series is cut at the As of day.
5. **Recommendation memo.** Pick the option, add your reasoning, what to watch and a review date. The
   memo is assembled from the steps above with no AI, cites every figure by number, and opens with
   "Research, not validated advice" until the signals behind it pass their backtests. Mark it Reviewed
   and Approved (with your name and the memo's hash); download Markdown or PDF.
6. **Track outcomes.** On the review date, *Check outcomes* sets the latest saved figures beside the
   ones the review started from and says whether the goal indicator moved the right way. *Review
   again* starts a new review with the same frame on today's data, linked to this one.

Changing an earlier step marks later ones **Out of date** until they are run again. Every step is
saved with a hash and written to the audit log. Kept in `data/local/reviews.json`; see
[POLICY_REVIEW.md](./POLICY_REVIEW.md) for the method.

Templates built on the briefs: country note, issuer note, sustainability assessment, portfolio
review, client portfolio review and the council brief. Each shows its sources, and missing inputs
are named rather than filled. Sourced figures carry a reference number, and a **References** list at
the end names each source once with the publisher's page and the date the app read it; figures
worked out by a stated rule keep their method beside them. Download as Markdown or PDF.

**Research notebooks.** Below the templates. Start a notebook for a topic ("Brazil fiscal"), or pick
a suggested country where you have two or more saved conversations. Tick the saved council
conversations and documents that belong in it and write your own notes. *Download notebook* gives one
Markdown file: your notes, each conversation as its full council brief with sources and references,
and the opening of each document. Deleting a notebook keeps the conversations and documents; deleting
a conversation takes it out of every notebook. Kept in `data/local/research.json`.

**Teaching episodes.** Below the notebooks. Give an episode a title, a country and a past decision
date (the moves listed under *Replicate a rate decision* make good dates), and write the questions,
one per line. *Student handout* is a Markdown file with the data as it stood the week before (policy
rate, latest inflation, target, leading indicator, each with its source and the replay's caveats) and
the questions. *Teacher copy* adds what the bank did, the Taylor rule reading and your notes. Episodes
hold no figures of their own; the handout reads them from the app's series when you download it.

---

## 4. Tools (Menu > Tools, inside Settings)

- **Groups**: every working tool, grouped by use (Council chat, Keep up, Screen and compare
  countries, Study one country, Look back, Your portfolio, Write and share). Click a group to open
  it; *Open all* opens every group and *Show sources* lists each tool's sources.
- **Data connections**: the same check as `npm run check:data`, one line per source. *Check again*
  re-runs it.
- **Hidden desks**: each older desk, what live input it would need to come back, and which ready
  tool already covers it.

---

## 5. Menu

- **Tools**: opens Settings on its Tools tab (section 6). Opening a tool closes Settings and goes to it.
- **Settings** (⌘, or Ctrl+,): free keys (FRED, EIA, UN Comtrade, Turkey EVDS), your own paid data
  (CDS source Off, My CSV or My LSEG), and the Gemini key. Each key has a Test button. Keys are
  saved on this computer, shown masked, and can be changed only from this computer.
- **AI model**: Ollama (local), Gemini, hybrid, or an OpenAI-compatible server such as LM Studio.
- **Offline data**: downloads every free feed for every country for fast, offline use (below). Shows
  countries ready, size on this computer, an estimate for what is left, and anything not saved with
  the reason.
- **Sharing mode**: for downloads that will be passed on (a public note, a chart in a write-up). The app is free, open-source research, so the only question is whether a source's terms let its figures be passed on for free (the *Free sharing* column of the licence register). On, every table download (figures, series, Compare countries, As of; CSV and Excel) holds back each value whose source is marked *Do not pass on* or *Sharing unclear*: the row stays with its source, and the value reads *Withheld* with the reason. Figures the app works out itself without naming an outside source pass. A *Sharing mode* pill in the header shows it is on; click it to turn it off. References in briefs and notes always end with which ones cannot be passed on. Saved in `data/local/workspace.json`.
- **Exam mode**: for a class or an exam, one switch for everyone using this app. On, no AI model writes anything: Council chat gives the agents' figures and sources with no summary (agents are picked by the words in the question, and they do not debate), Explain shows the data only, and the other AI steps (policy review diagnosis, options and memo, the morning brief, Try model) are refused. Every question asked and every country page opened goes to the audit log (Menu > Audit log), so the teacher can see what was looked at. Only the computer running the app, or an admin when sign-in is on, can switch it. An *Exam mode* pill in the header shows it is on; pages already open pick it up when reloaded. Saved in `data/local/exam-mode.json`.
- **Server alerts** (Settings > Server alerts): a webhook (Slack, Discord, Google Chat, ntfy.sh or
  your own) and/or email for when something breaks while nobody is looking: a data source that
  worked at the last nightly check fails now, a scheduled job fails, or a backtest that passed fails
  on its next run. *Test* sends a real message. Nothing is sent until one is set. Details and the
  `.env` names are in [HOME_SERVER.md](./HOME_SERVER.md#server-alerts).
- **Morning brief** (Settings > Morning brief): at a time you set, the council answers your standing
  questions (up to four; three starting ones on policy stance, cheap or rich, and coming dates) about
  the watchlist you pick, your AI model writes each summary, and each is saved to Reports > Saved
  research as "Morning brief: <question>", with what moved since the same question last ran. *Run
  now* runs it at once. The time is read in your browser's time zone (right under Docker too). The app
  must be running; a brief missed while it was closed runs when it next starts that day. Without an AI
  model the agents' answers are saved with no summary. Settings are kept in
  `data/local/morning-brief.json`.
- **Models & validation**: every rule in the app that turns figures into a call (policy rule check,
  leading-indicator turns, CFTC crowding, CDS cheap/rich, real exchange rate gap, shock early
  warning, the disagreement ranking, and the descriptive ones), with what it says, its rule, inputs,
  limits and status. The same status shows as a badge beside each panel; click it to open its row.
  *Not validated* stays until a backtest passes. *Run backtests* (or `npm run backtest`) runs the
  pre-registered tests in `docs/validation/preregistered/`: each file fixes the rule, the sample, the
  outcome window and the pass mark (enough cases, a lift over the base rate, a p-value) before any
  run, and its SHA-256 is listed in `manifest.json`; a file that no longer matches its hash is refused.
  The tests pull the long free histories (BIS policy rates since 1990, the OECD leading indicator,
  CFTC since 2006, OECD consumer prices), so they need a connection. A verdict (passed, failed, too few cases) replaces the
  badge and is saved in `data/local/validation/results.json` and in the audit log. A pass shows an
  evidence grade instead of plain *passed*: *Validated* (still holds after correcting for every test on
  record, or 24 months of forward record that beat its base rate), *Provisional pass* (passed alone,
  not after the correction), *Under review* or *Withdrawn* (the forward record falls below the base
  rate, Withdrawn when significantly below), or *Review due* (last run more than 12 months ago). The
  rules and the practice they follow are in `docs/METHODS.md` under Evidence grades. Tests: leading-
  indicator turn to policy move, CFTC crowding to unwind, and the policy rule check (Taylor gap:
  does a tight reading come before a cut, and a loose one before a hike, within 6 months, judged
  against each bank's inflation target as it stood at the time, from `src/data/inflationTargetHistory.ts`).
  Beside every verdict the dialog shows a **Holm-adjusted p** across all pre-registered tests on
  record (every version run of every backtest and nowcast/forecast evaluation, failed ones too) and
  the number of tests, with whether the verdict still holds at its own pass mark after the
  correction. The recorded verdict itself is not changed. Once a backtest passes, each run also
  keeps its **forward record** (`data/local/validation/forward.jsonl`): every new call the rule
  makes is written down while its window is still open, before anyone knows the outcome, and scored
  by the same rule when the window ends. The dialog shows, under Forward record, how many calls,
  how many followed against the base rate, and the latest calls. Lines are never edited, and each
  carries a hash over the line before it, so the dialog says if the file was changed. A passing
  currency factor test (`npm run signals:evaluate`) does the same with its book: the long and short
  currencies at the latest complete month-end are recorded before that month's return exists, and
  scored as recorded (net of the same flat cost) once the month ends. A passing nowcast
  (`npm run forecast:evaluate`) records its figure for each quarter that has ended but is not
  published, with the benchmark beside it, and scores both on the first published figure. Panels that describe the past or apply a
  stated what-if (fiscal reaction, gross financing need, reserve adequacy, inflation after rate
  changes, costed options, global shock scenarios) carry the badge *Description, not a tested
  signal*; the policy rule family and the debt fan chart make forward claims and read *Not
  validated* until their pre-registered tests run. **Currency carry, value and momentum** are
  pre-registered in `docs/validation/signals/` and run with `npm run signals:evaluate` (results in
  `data/local/validation/signals.json`): each month the top third of 25 floating currencies by the
  signal is held long and the bottom third short against the dollar, the monthly return is taken
  net of a flat 0.25% cost per unit traded, and it must beat holding dollars with whole years
  resampled (p at most 0.05). Policy rates stand in for money-market rates. A failed factor stays
  failed; it is not re-tuned.
  Every verdict also carries a *stricter check* (method 2). Method 1 counts each case as independent;
  but turns and policy moves bunch in global cycles, and CFTC entries in several USD crosses land in
  the same weeks, so method 1 overstates how sure a result is. Method 2 redraws whole calendar years
  of cases together 4,000 times (fixed seed, so the same data give the same answer), reports a 90%
  range for the lift and a p-value (how often the lift vanishes when the years are redrawn), and asks
  that the lift is positive in at least half the series with five or more cases. It also shows the
  lift by series and what is left when any one series is dropped. A test registered under method 1
  keeps its verdict; when it passed but fails method 2 the badge reads *Passed, fails stricter check*.
  A test file with `"framework": 2` is judged by method 2. A new version of a failed rule carries
  `retestOf` (the earlier version, its verdict and what changed) and is shown as a re-test.
  Later versions sit beside the first as `<id>.v2.json`, `<id>.v3.json`; every version runs, the
  badge shows the latest, and the row lists the earlier versions' verdicts. Registered so far:
  `cftc_crowding.v2.json`, the same rule as v1 judged by method 2, and `taylor_gap.v2.json`, a
  re-test of the failed Taylor gap that adds the output-gap term (0.5 x the app's real-time output
  gap from IMF real GDP growth, year t used from April of t+1), judged by method 2. The Taylor v2 run
  also pulls IMF real GDP growth for each country with a dated target.
  Also registered (method 2): the growth and inflation quadrant (`regime_quadrant.json`: both up
  before a hike, both down before a cut, within 6 months), the cycle clock (`cycle_clock.json`: once
  it reads hiking or cutting, another move the same way within 6 months) and the Timing Agent's one
  call (`timing_agent.json`: crowded and already turning before a further 3-point unwind within 8
  weeks). Until they are run these three read *Not validated*.
- **About & data licences**: the standing research notice and the licence register. One row per
  source: what the app reads from it, what its terms say about showing figures to others and about
  commercial use, the credit to print, quotes from the terms page with links, and the open questions
  (rows marked *Permission needed* or *Terms not confirmed*). The *Data licences* button on a
  country's Sources tab opens it too. The same register is in [DATA_LICENCES.md](./DATA_LICENCES.md).
- **Sign-off on saved research**: each saved council conversation (Saved research) shows Draft,
  Reviewed or Approved. *Mark reviewed*, then *Approve*, each with your name; the step records the
  SHA-256 of the report's content. If the report changes afterwards (a follow-up saved over it) it
  reads *Changed after sign-off* until reviewed again. While you are the only user the approval says
  "self-approved, no second reviewer". An approved report cannot be deleted until the approval is
  withdrawn. Steps are kept in `data/local/signoffs.json` and in the audit log.
- **Audit log**: every council answer (the question, the AI model that wrote the summary or "none",
  and each figure the agents used with its source and period, plus what was missing) and every save,
  delete, download, settings, key and AI model change, newest first. Search it or pick a kind, and
  download it as CSV or as the log file itself. Kept in `data/local/audit/audit-log.jsonl`; lines are
  only added, each chained to the one before by a SHA-256 hash, and the window checks the chain each
  time it opens: an entry changed or removed after it was written shows as "Check failed". Someone who
  rewrites the whole file could rebuild the chain, so keep the latest hash or an export elsewhere if
  that matters. Keys, document text and holdings amounts are never logged. The log is not in backups.
- **Data health**: whether the data is still coming in, and whether any of it changed under you.
  The menu shows how many sources failed at the last check and how many watchlist figures are
  missing now. Three tabs:
  - *Sources*: every source's state at the last check, failing first, with "No answer since <date>
    (n checks in a row)", how many of its last checks connected, and its last 14 checks as dots. The
    app checks every source once a night after 05:30 (`DATA_CHECK_TIME`, `DATA_CHECK_TZ` in `.env`;
    a Mac asleep then checks when it wakes, an offline one waits for the connection). *Check now*,
    *Check again* under Tools and `npm run check:data` add to the same history.
  - *Figure alerts*: each watchlist figure is compared with the last reading at every rebuild. An
    alert is kept when a figure went missing (and stayed missing 30 minutes), came back, got older
    than its source usually runs, jumped more than that kind of figure plausibly moves in one step,
    left its plausible range (a units slip, most likely), or came back with a new value for a period
    already read (a revision). *Open now* lists what is missing or old at this moment. Alerts never
    change a figure; they say what to check.
  - *Revisions*: IMF and World Bank yearly values that changed between full-history downloads, with
    the old value, the new one and the date the change was seen. Revised IMF projections are hidden
    unless you tick *Include IMF projections* (every WEO revises them). The History tab shows the same
    as "Revised from X on <date>" beside the year.
  Kept in `data/local/data-health/` and in `data/history/` (never keys).
- **Backup** (Settings > Backup): *Download backup* saves one file with your saved research
  (briefs, documents, notebooks, teaching episodes), policy reviews, watch alerts, holdings, watchlists, added
  countries and AI model settings. API keys are never in it. *Choose a backup file* shows what a
  file holds, then *Restore this backup* replaces what is saved here with it; a copy of what was
  here is saved first in `data/local/backups/`, and AI keys already on this computer are kept. Use it
  to move to another computer or to keep a copy.

### Download all country data (for offline use)

One pass over every free feed for every country the app covers: the world feeds once (BIS policy
rates, OECD leading indicators and inflation, national inflation, CFTC, TIC, IMF reserves and COFER,
commodity prices, UN Comtrade), then for each country its latest figures from every feed and the full
World Bank and IMF history, and last the GDELT raw files (see *GDELT events and news themes* below). Everything is saved under `data/` (live, history, archive), so pages,
charts and the History tab then load from disk and keep working without a connection. Screens still
show only the newest value; the full runs are behind History & data and the downloads.

In the app: Menu > Offline data > *Download all country data*. The window shows the step running,
countries ready, the size on disk and an estimate for what is left (the average of the countries
already saved; "known after the first country" until then). You can close it; the download carries
on. *Stop after this step* stops it; *Carry on downloading* picks up where it stopped.

**Offline.** When the free feeds cannot be reached from this computer, an *Offline* pill appears in
the top bar with the date of the saved data. Pages, History and downloads keep working from disk; the
app does not try its background refreshes until the feeds answer again (checked every minute).

From a terminal in the app folder:

```bash
npm run preload                        # every country
npm run preload -- --countries=BRA,TUR # only these
npm run preload -- --fresh             # download everything again, even what was saved today
docker compose exec econquest npm run preload   # when the app runs in Docker
```

Each step prints one line (ok, FAIL with the reason, or needs setup when a key is needed). Ctrl+C stops after
the current step; the next run skips every step saved within the last day and carries on. Progress is
kept in `data/local/preload.json`. A step that takes longer than 3 minutes (`PRELOAD_STEP_TIMEOUT_S`
in `.env` changes it) is recorded as not saved and the run moves on. GDELT allows few requests: the
run does not wait out its 15-minute pause; GDELT news tone fills in on a later hourly refresh. A feed that fails leaves its figures Missing with
the reason; nothing is filled in.

### GDELT events and news themes (raw files)

GDELT publishes its data as files every 15 minutes, free to download. The app reads two tables:

- **Events**: who did what to whom, coded by type (protest, sanction, assault and so on), with an
  intensity score (Goldstein: -10 most conflictual, +10 most cooperative) and a place. An event
  counts for a country when it happens there or the country is one of the two actors.
- **Global Knowledge Graph (GKG)**: one row per news article, with its themes, the places, people and
  organisations it names, and its tone. An article counts for a country when it names a place
  there. Themes are grouped: inflation and prices, central bank and interest rates, debt and default,
  currency and reserves, taxes and spending, IMF and other lenders, markets, jobs, trade, sanctions,
  protests.

Where it shows: Research > one country > Markets & signals > *News and events* (the latest complete
week against the weeks before, theme shares, the most-named people and organisations, and a
week-by-week table), the Politics & Events Agent, and the figures sent to the full council. Before
the files are pulled, all three say Missing.

How it is pulled: the last step of *Download all country data*, or from a terminal:

```bash
npm run gdelt:pull -- --estimate   # files left and download size, downloads nothing
npm run gdelt:pull                 # pull (Ctrl+C stops; the next run carries on)
```

The first pull covers `GDELT_RAW_WEEKS` weeks (default 8: about 5,400 events files and 450 GKG
files, roughly 3.4 GB to download). Each file is read and then thrown away; only a small summary per
day is kept in `data/live/gdelt-raw/`. GKG files are large, so one every `GDELT_GKG_EVERY_HOURS`
hours is read (default 3); theme figures are then shares of the articles read, and the panel says
so. After the first pull the app tops it up once a week by itself (only the new files). Run either
the app's download or the terminal pull, not both at once.

**Long history (GDELT 1.0 daily files).** The Event history panel and the Politics & Events agent's
long-run reading use GDELT's older daily event files, which go back to 1979. They are pulled
separately and kept as small monthly totals in `data/live/gdelt-daily/`:

```bash
npm run gdelt:daily -- --estimate   # files left and download size, downloads nothing
npm run gdelt:daily                 # pull from GDELT_DAILY_FROM (default 2016-01)
npm run gdelt:daily -- --from 1979  # the whole archive
```

From 2016 on is tens of gigabytes to download; `--estimate` says how much is left. Each zip is read
and thrown away. Ctrl+C stops it; the next run carries on.

---

## Checking the council on your own AI model

Two commands check that the council still answers the fixed test questions in
`docs/validation/council-regression/cases.json` correctly on your model:

- `npm run council:regress` runs the cases through the running app (Docker on port 3737, `npm run
  dev` on 3000, or `APP_URL`) on the model under Menu > Settings > AI model, prints each case and
  compares it with the recorded baseline. It warns when the running app is older than the folder:
  after `git pull`, rebuild the Docker app first.
- `npm run council:record -- --model qwen2.5:32b` records a new baseline on a private copy of the
  server (your data is not touched), at temperature 0 and seed 42. Read the answers it prints; if
  they are right, commit `tests/fixtures/council-recorded/` (or send `data/local/council-recording.zip`).
  CI then replays it on every change. A model of 8B or less is refused as referee.

## Checking everything on your Mac in one command

`npm run mac:validate` runs, one after the other: the data source check, the pre-registered
backtests, the saved WEO editions, the forecast evaluations, the currency signal tests, and (when the
app is running) the council regression. Each step saves its own results as usual, and one report is
written to `data/local/validation/mac-validate-<time>.md`, with the commit, Node, the running app and
the Ollama models at the top, a summary row per step and each step's output. Keys never reach the
report. Run `npm run update` first so the Docker app runs the code you pulled.

Leave steps out with `-- --skip council,backtest`, or pick them with `-- --only data,signals`
(steps: data, backtest, weo, forecast, signals, council). A FAILED verdict inside a test is a result,
not a fault; a step is marked failed only when its command stops with an error (the data check also
does so when a source is down).

---

## Sharing your work

Every export ends with the same notice: *Research, not validated advice*, that no model has been
independently validated, where to see each signal's backtest verdict, and that each source's own
terms still apply. That covers council briefs and documents (Markdown and PDF), policy review memos
(Markdown and PDF, under the memo's own banner), reports from Reports, research notebooks, teaching
handouts, chart CSVs, the model register CSV, the About sheet of every Excel download, and backups.
Plain CSV tables of figures (*Download these figures*, series) keep their rows clean for other tools,
so the notice is not inside them; it is on the Excel version's About sheet.

Before figures leave your computer, open Menu > About & data licences. Most sources ask only for a
credit line (shown on each row). Kalshi, Polymarket, ExchangeRate-API, UN Comtrade, the IMF, the OECD
yields on FRED and the Turkish central bank need the provider's permission for client or commercial
use; a few could not be confirmed and are marked so.

---

## 6. When something looks wrong

- **Everything reads Missing.** Open Menu > Tools > Data connections. If every source fails, the computer
  is offline or a VPN or firewall blocks it; figures fill in within the hour once it is back.
- **One panel shows "could not be drawn".** The rest of the app still works. Press Try again; if it
  keeps failing, the error text under it helps find the cause.
- **GDELT says it is paused.** GDELT allows few requests; after a refusal the app waits 15 minutes.
  Its figures are pulled weekly and show their pull date. The raw-file pull (events and news themes)
  is not limited this way; if it stops part way, run it again and it carries on.
- **"This app only answers on localhost".** You opened it by a name other than localhost or
  127.0.0.1. Use `http://localhost:<port>`, or list the name in `ALLOWED_HOSTS` in `.env` if you
  opened the app to your network on purpose.
- **The full council says no AI model answered.** Same check as below; nothing is filled in for it.
- **The AI summary does not appear.** Menu > Settings > AI model: check Ollama is running, or a Gemini key is
  saved. Every figure and agent answer works without it.
- **Ollama answers with errors, is very slow, or lacks your models.** Another Ollama, often one in
  Docker, may be holding port 11434 in front of the Ollama app. Check with `docker ps | grep ollama`;
  stop it (`docker stop ollama`) and open the Ollama app (`open -a Ollama` on a Mac). `ollama list`
  should then show your models. Starting that container again puts it back in front.
- **The full council is slow on Ollama.** Ollama answers one request at a time per model by default,
  so the nine desks queue behind each other. To let it answer several at once, quit the Ollama app
  and start it with `OLLAMA_NUM_PARALLEL=3` (on a Mac: `launchctl setenv OLLAMA_NUM_PARALLEL 3`, then
  open Ollama again). Each parallel slot needs its own memory for the context, so with a 32B model
  start at 2 or 3 and watch memory use; answers stay the same, only the wait changes.
- **Ollama is running but the app cannot reach it.** Use `http://127.0.0.1:11434` rather than
  `localhost` under Menu > Settings > AI model: on some Macs `localhost` goes to IPv6 first and fails.
- **A change you pulled does not show in the Docker app (port 3737).** `git pull` updates the folder,
  not the Docker image. Rebuild it: double-click `start-mac.command`, or run
  `docker compose up -d --build econquest`. After a pull that changed `package.json`, run
  `npm install` too (for `npm run dev` and the terminal commands). `npm run council:regress` warns when
  the running app is older than the folder.
- **`git pull` stops on untracked files under `tests/fixtures/recorded`.** A local feed recording is in
  the way of the committed one. Move it aside and pull again:
  `mv tests/fixtures/recorded ~/recorded-backup && git pull`.
- **Gemini stops working after Google renames a model.** Set `GEMINI_MODEL` in `.env` to the new name
  and restart.
