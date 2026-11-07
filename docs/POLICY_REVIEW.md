# Policy review

A guided, repeatable case file for a principal, economist or politician who uses the council to look
for ways to improve policy and macroeconomic conditions in one country.

It lives in **Reports > Policy reviews**. A review can also be started from a Council chat answer.

> Everything a policy review produces is **research, not validated advice**. The memo says so until
> the backtests behind the signals it relies on pass (Menu > Models & validation).

## The six steps

| Step | What you do | What is recorded |
| --- | --- | --- |
| 1. Frame | Country, the problem in one or two sentences, the goal (indicator, lower / higher / stable, optional target and date), constraints (peg, fiscal room, election...), who it is for, and the **As of** day. | The frame as entered. |
| 2. Diagnose | The app fills a fixed set of indicators for the As of day: inflation vs target, growth and output gap, policy rate and real rate, Taylor gap, government debt, r minus g, primary balance, reserves, current account, leading indicator. Standard charts (Taylor gap, real rate, r minus g, Phillips curve). | Every figure with its value, source, period and the pull it came from; Missing figures with the reason. |
| 3. Options | The council answers a set question built from the frame. Agents write their standard documents; synthesis ranks the options with trade-offs, who bears the cost and what would need to be true. You can add your own options. | The question template version, the AI model, every agent and synthesis document, your options. |
| 4. Evidence | For each option: past episodes from the country's own history (Replicate a rate decision), Chart Agent tests (lead/lag, Granger, regression) with their settings, the number check, and the Models & validation status of each signal used. | Each test with its inputs, settings and result. |
| 5. Recommendation memo | Written only from steps 1 to 4. Cites every figure by number with source and as-of. States what to watch and the review date. Draft > Reviewed > Approved sign-off. Download as Markdown or PDF. | The memo text, its hash and the sign-off history. |
| 6. Track outcomes | On the review date the app sets what happened beside the starting point. **Review again** copies the frame onto newer data and shows what changed. | The figures at review time and the link to the next review. |

## Reproducibility

- Each saved step keeps its content, the time, the SHA-256 of the content and the hash of the step
  before it. Changing an earlier step marks every later step **Out of date** until it is run again,
  so a memo can never rest on figures it was not written from.
- Indicator [13] is the USD bond spread over US Treasuries (J.P. Morgan EMBI Global via the central bank of Peru, monthly; a bond spread, not CDS), Missing outside the eight Latin American countries BCRP covers. Model readings [14]-[20] follow the thirteen indicators: output gap (one-sided HP and Hamilton), r minus g, debt-stabilising primary balance, debt five years on at 10-year averages and under a combined shock, and the IMF bucket fiscal multiplier range. They use only IMF yearly outturns published by the As of day (from April, last year; before April, the year before), never projections; the figures are today's IMF vintage of those years, so later revisions show (src/utils/reviewModels.ts).
- The As of day fixes the data: running Diagnose again on the same review gives the same figures
  from the same archived pull. Statistical tests are deterministic given their inputs and settings.
- AI wording can differ between runs. Every run is kept, so two runs can be compared side by side.
- Every step is written to the audit log (Menu > Audit log). Opening a review re-checks every
  stored hash against its content and says if a step was edited outside the app.
- No sample or built-in figures: a figure the app does not have is shown as Missing with the reason.

## Storage

`data/local/reviews.json` (mode 600), next to the research library. Nothing is sent anywhere except
the questions sent to the AI model you chose in Menu > Settings.

## API

| Route | What it does |
| --- | --- |
| `GET /api/reviews` | Every review with the state of each step and the next step to do. |
| `GET /api/reviews/:id` | One review, its step states and any step whose stored hash no longer matches. |
| `POST /api/reviews` | Start a review from `{ frame, previousId? }`. |
| `PUT /api/reviews/:id/frame` | Change the frame (later steps go Out of date). |
| `DELETE /api/reviews/:id` | Delete a review. |

| `POST /api/reviews/:id/diagnose` | Step 2 from the saved pull on or before the As of day. |
| `POST /api/reviews/:id/options` | Step 3: `{ userOptions, runtimeConfig }` asks the council (temperature 0, prompt hashed, numbers checked); `{ ownOnly: true }` saves your options unassessed. |
| `POST /api/reviews/:id/evidence` | Step 4: the evidence pack (five charts and tests, past episodes, validation status), every series cut at the As of day. |
| `POST /api/reviews/:id/memo` | Step 5: `{ recommended, rationale, watch, reviewDate }`; the memo is assembled from the saved steps with no AI. |
| `POST /api/signoffs/review/:id` | Sign-off on the memo (Reviewed, Approved, Withdrawn) against the memo step's hash. An approved review cannot be deleted. |
| `POST /api/reviews/:id/outcomes` | Step 6: the latest saved pull beside the figures the review started from. |
