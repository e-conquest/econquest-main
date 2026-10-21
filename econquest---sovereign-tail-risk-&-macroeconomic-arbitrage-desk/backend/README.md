# Local research backend

Python 3.11+; FastAPI/Pydantic with the standard-library SQLite driver. Manual
Yahoo ETF acquisition uses `yfinance`; monthly IMF and annual WEO use verified public SDMX routes, without
invented API key configuration. Outbound requests
for World Bank WDI and IDS use server-side `wbgapi`, also without credentials. Requests
for FRED/ALFRED use the official HTTPS API with backend-only `FRED_API_KEY`.
BIS quarterly banking/credit uses the public BIS SDMX API without credentials. All requests
for annual UN Comtrade goods use pinned `comtradeapicall` with backend-only `COMTRADE_API_KEY`.
Global GDELT 2.0 daily Events use pinned `gdelt==0.1.14`, without credentials.
ACLED core events use pinned `acled==1.0.2` and backend-only myACLED OAuth credentials.
Provider calls
occur only on an explicit provider pull. No periodic scheduler, trading alerts
or generated observations. Provider pulls and file imports are durable jobs.

## Run and test

Run from the repository root. Use a dedicated environment, not the quant `.venv`:

```sh
python3 -m venv .backend-venv
.backend-venv/bin/python -m pip install -r backend/requirements.txt
.backend-venv/bin/python -m backend serve --port 8766
# Equivalent ASGI entry point:
.backend-venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8766 --no-access-log
.backend-venv/bin/python -m unittest discover -s backend/tests -v
```

- `ECONQUEST_DB_PATH`: SQLite path; defaults to `research-data/research.sqlite3`.
  `serve --db PATH` overrides it.
- `ECONQUEST_ALLOWED_ORIGINS`: optional comma-separated, explicit loopback HTTP(S)
  origins; **replaces** the defaults. Defaults allow `localhost`, `127.0.0.1`,
  and `[::1]` on HTTP ports **5173 and 4179**. Same-origin requests are always
  accepted. Arbitrary domains, wildcard origins, `null` origins, paths, and
  non-loopback origins are rejected.
- Only literal `localhost`, `127.0.0.1`, and `[::1]` Host authorities are
  accepted. Forwarded headers do not relax this check. Bind to loopback only.
  The CLI fixes its bind address to `127.0.0.1`; run one worker per database.
- A random **process-wide**, nonpersisted session token is obtained from
  `GET /api/session`. Every mutation requires `X-Research-Token`. The token
  changes across process restarts; refresh it after reconnecting.
- Backend logs contain structured event names, IDs, counts and exception class
  names, not upload contents, file paths, source text, tokens, or tracebacks.
  Use `--no-access-log` with a manually launched uvicorn process.

## API

### ACLED core events contract

See [the private research workflow](../README.md#acled-conflict-and-protest-research).
`GET /api/providers/acled/config` advertises `acled-global-core-30d-v1`,
`acled==1.0.2`, the latest 30 completed UTC event-date days, OAuth, and a **configured
boolean only**. No credential or token is returned. `POST /api/providers/acled/pull`
requires exactly `{"researchUse":true}` and a session token. Missing configuration
blocks acquisition before a durable job is created. The window is frozen per run.

[The adapter](./acled.py) uses the installed package's core `AcledDataClient.get_data`
with an instance-local bounded session and in-memory auth strategy. A narrow pinned
parser override retains native JSON types instead of the library's in-place date/int
coercion; prevalidation rejects fractions/booleans masquerading as integer counts.
The package is not globally patched. Its automatic retries, auth refresh, cookie fallback,
environment-overridable route and file token cache are not used.

OAuth POSTs go only to `https://acleddata.com/oauth/token`, with form credentials,
`client_id=acled`, `grant_type=password`, `scope=authenticated`. Token and refresh-token
bodies, including authentication errors, are never persisted. Data GETs go only to the
fixed HTTPS `/api/acled/read` route with credentials in an Authorization header, never
query strings. Proxy environment routing and redirects are disabled. Credential/token
echoes are withheld from original storage; logs contain IDs/counts/exception classes,
not provider error bodies or authentication material.

Queries explicitly request dyadic JSON, `event_date=start|end`, `BETWEEN`, `with_total=true`,
5,000 records/page and consecutive page numbers. Each page's `count` must equal its actual
length, `total_count` must remain constant and page boundaries must match the expected
total. Two complete reads must have identical ID/native-record fingerprints, allowing
harmless ordering changes but not duplicates, revised records or skipped rows.
This detects observed pagination drift; it does not establish a transactional provider
vintage, account-wide entitlement or absence of reporting gaps. Empty results are retained
but do not stage/activate as evidence of no conflict.

Bounds: 100 HTTP requests including authentication, 0.5-second minimum spacing, 30-second
request timeout, 64 KiB OAuth response, 16 MiB data response, 128 MiB acquisition, 200,000
events and 600 seconds. No automatic retry/resume/scheduler. Cancellation is cooperative.
Interrupted/restarted snapshots keep captured data but cannot activate.

[Schema 12 storage](./acled_storage.py) has independent runs, immutable raw-response
manifests, completed page chunks and native event rows. Staging/activation recheck original
hashes, routes, page totals, native-row provenance and agreement of both captured reads.
Manual rollback skips withdrawn predecessors. Queries/exports use consistent SQLite read
snapshots. GDELT, other provider selections and fitted artifacts are unaffected.

- `GET /api/acled/{id}`: manifest, progress, validation report and original-response hashes.
- `GET /api/acled/{id}/events?country=&event_type=&offset=0&limit=100`: exact page/run/filter
  identity, native country names/event types; offset >= 0, limit 1–500.
- `GET /api/acled/{id}/sources/{ordinal}`: exact data-response bytes as a nosniff attachment.
- `GET /api/acled/{id}/export`: **private** NDJSON manifest and native events.
- `POST /api/providers/acled/{id}/cancel`: request cancellation.
- `POST /api/acled/{id}/commit` and `/rollback`: explicit independent research selection.

The browser preserves a prior valid page on failed fetch/contract checks, labeled with
its actual snapshot/filter identity. It displays native time/geography precision,
reported fatality estimates, source update time and unknown article-publication time;
source notes are text, not executable HTML. ACLED account/EULA/content/attribution terms
and the unofficial wrapper's GPL-3.0 license require review before redistribution.

### GDELT daily events contract

See [the workflow and limitations](../README.md#gdelt-global-daily-events).
`POST /api/providers/gdelt/pull` requires exactly `{"researchUse":true}` plus the session
token; it freezes the latest completed UTC day, global Events only, all 96 intervals.
`GET /api/providers/gdelt/config` advertises `gdelt2-global-events-day-v1`, the exact
library version, no-key requirement and scope. The browser checks this before acquisition;
an old backend is explicitly blocked until an approved restart.

[The bounded transport](./gdelt.py) uses deterministic HTTPS archive URLs, no redirects,
retries, proxies supplied by callers or fallback datasets: 96 requests, minimum 0.4-second
spacing, 20-second request timeout, 8 MiB compressed response, 128 MiB compressed day,
500,000 daily records and 600-second acquisition deadline. Captured partial bytes/status
remain diagnostic originals, never successful intervals.
[The isolated decoder](./gdelt_worker.py) has a sanitized environment without provider keys,
a 20-second subprocess timeout, 32 MiB expanded/50,000-row archive bounds and ZIP CRC checks.
It requires one unencrypted file, strict UTF-8 and exactly 61 TSV cells per row.

The public package search uses multiprocessing, default incomplete daily coverage, numeric
inference, skipped malformed lines and import-time metadata downloads. Instead this adapter
invokes the **installed package's archive worker** in an isolated process with local bundled
metadata and an already captured archive. Its pandas reader preserves every string cell;
the complete decoded matrix must equal independently parsed TSV, with no omitted records.
This deliberately uses a private worker pinned to 0.1.14; upgrades require contract/tests
and live acceptance, not a dependency-only bump. No upstream implementation is copied.

[Schema 11 storage](./gdelt_storage.py) keeps immutable source/chunk/row records.
All 96 expected intervals, exact per-interval counts, source paths/status and total rows
are checked transactionally before staging and activation. Source event IDs are unique per
snapshot; duplicates fail rather than silently deduplicating. Partial or restarted runs
remain inactive and interrupted. Manual rollback skips previously withdrawn predecessors.
Other provider snapshots and fitted-model artifacts are independent.

- `GET /api/gdelt/{id}`: consistent manifest/report, originals and completed intervals.
- `GET /api/gdelt/{id}/events`: exact `runId`, `country`, `root`, offset, limit, total and
  native events. Country is empty/global, `UNKNOWN`, or native two-character geography code;
  root is empty or CAMEO `01`–`20`. Offset >= 0, limit 1–500.
- `GET /api/gdelt/{id}/sources/{ordinal}`: exact original bytes as a nosniff attachment.
- `GET /api/gdelt/{id}/export`: consistent read-snapshot NDJSON manifest plus events.
- `POST /api/providers/gdelt/{id}/cancel`: cooperative cancellation, not partial activation.
- `POST /api/gdelt/{id}/commit` and `/rollback`: separate research selection only.

Pages retain the last valid response on fetch/contract failure, labeled with its actual
snapshot/filter identity. Native URLs are retained, but only credential-free HTTP(S) links
without whitespace/control characters are rendered. All 61 source fields remain inspectable.
No article text or inferred publication timestamp is acquired. Package GPL-3.0 obligations
must be reviewed before redistribution.

### UN Comtrade contract

See [the user workflow and limitations](../README.md#un-comtrade-annual-merchandise-trade).
`comtradeapicall==1.3.2` is used for final availability, count and data calls, never its
500-row preview, mirror/Trade Matrix, async, bulk or automatic-retry helpers.
The scoped, nonblocking library lock replaces only the package modules' transport
references; global `urllib3` is unchanged. Library requests receive an opaque placeholder;
the bounded standard-library HTTPS transport removes its query credential and sends the
real key only in `Ocp-Apim-Subscription-Key`. Redirects, unexpected paths/hosts,
API error envelopes, count mismatches, ambiguous record caps, mixed dimensions,
duplicate rows and non-original classifications block chunk completion.
Responses that echo the credential are not persisted. Logs contain event/ID/exception
class, not credentials or provider error bodies.

Reference catalogs use two fixed official URLs, not library lookup helpers that catch
errors and print success-shaped fallbacks. Discovery requests explicit frozen reporter
codes: the `SS` availability route without reporter codes returned no datasets in live
verification, whereas explicit global codes returned both original HS and SITC datasets.
Every completed year from 1962 is discovered before the data plan is frozen.
Original dataset ambiguity is an error. Data uses original `classificationSearchCode`
(`HS`, `S1`–`S4`) and validates the actual returned classification. Twelve-year
reporter/classification chunks are structurally small for TOTAL products and all partners;
queries at the 100,000-record Basic cap are rejected, not assumed complete.
Count-only responses have a **dictionary** `data` placeholder; normal responses require
an exact-count list. Provider dataset IDs exceed JavaScript's safe-integer range, so their
normalized identities are decimal strings; original numeric JSON remains immutable.

Each chunk verifies availability before and after its count/data calls. Definition changes
since discovery stop acquisition; newer revisions with the same definition are captured
and disclosed in `datasetsAcquired` / `revisedSinceDiscovery`. A mid-chunk revision change
leaves the task pending, with no observations committed. Completed chunks are never replaced.
This deliberately does not claim a single global as-of vintage across multiple days.
Native `primaryValue`, source flags and CIF/FOB fields are retained. The approved policy
retains `isReported=false` values without asserting direct reporting. No valuation
conversion, quantity-based value-estimation inference, interpolation or mirror fill.

Partner classification does not trust `isGroup=false` or ISO strings alone. World/group
categories and reviewed special codes are separate; individual identities require matching
the nongroup reporter catalog's code **and exact source name**. All other identities remain
explicitly **unreviewed**, retained and inspectable, never silently dropped or treated as
individual bilateral evidence. Historical identities are not mapped onto successor states.

Schema **10** adds independent `comtrade_runs`, immutable `comtrade_sources` with retrieval
times, immutable bilateral `comtrade_rows`, durable `comtrade_tasks` (completed tasks immutable)
and an append-only `comtrade_requests` ledger. Request reservation is transactional before
network access, capped at 450 requests/rolling 24 hours; public metadata requests count
conservatively too. Per-pass 40-request/300-second/128-MiB and per-response 32-MiB bounds apply.
An in-flight socket read may take its 20-second timeout beyond the pass time check.
Quota/429/cancellation pause without discarding completed work; status `interrupted`
means resumable, with an explicit reason. Restart recovery preserves the task plan and
rows; nothing resumes automatically. Backup verification includes all five tables.
Exports use a consistent SQLite read snapshot even during a running pass.

- `GET /api/providers/comtrade/config`: contract, configured **boolean**, bounds and manual-resume policy.
- `POST /api/providers/comtrade/pull`: only `{"researchUse":true}`; starts a new acquisition.
- `POST /api/providers/comtrade/{id}/resume`: same consent, resumes a paused acquisition.
- `POST /api/providers/comtrade/{id}/cancel`: stops this pass, retains verified chunks.
- `GET /api/comtrade/{id}`: frozen catalogs, report/progress and original-source manifests.
- `GET /api/comtrade/{id}/tasks`: task plan/results, offset/limit, maximum 500.
- `GET /api/comtrade/{id}/observations`: required numeric reporter/partner and `M`/`X` flow,
  offset/limit, maximum 500. Absence is unknown, not zero.
- `GET /api/comtrade/{id}/sources/{ordinal}`: exact captured response bytes.
- `GET /api/comtrade/{id}/export`: NDJSON manifest, complete task specifications/results and native rows.
- `POST /api/comtrade/{id}/commit` and `/rollback`: independent research selection.
  Activation requires all planned discovery/data tasks complete, matching stored task/row/
  usable-value counts and a completed compatible contract. Partial downloads never activate.

Mutations require the local session token; pull/resume consent bodies are bounded to 1 KiB.
All Comtrade routes return `Cache-Control: no-store`. Keys may be read through
`serve --prompt-comtrade-key`, optionally alongside `--prompt-fred-key`; neither is saved.

Monthly IMF also exposes `GET /api/providers/imf/config`. The UI requires exact
`imf-monthly-native-v2` / `available-monthly-pairs` before a new pull. Old running
backends retain inspectable revisions but require an approved restart for the new contract;
building frontend assets alone does not deploy backend changes or reprocess quarantines.

### World Bank IDS contract

`backend.ids` uses existing pinned `wbgapi` low-level `fetch`, **source 6**, separate
from WDI source 2. No credentials/new dependency. Its reviewed 18-code basket is listed
in [the research workflow](../README.md#world-bank-international-debt-statistics-ids).
Source identity, generic indicator definitions, source-specific series titles, source
economy membership, aggregate classification, four concepts and `WLD` = World must match.
The generic IMF-credit indicator title differs from the advanced source title, which
explicitly includes SDR allocations; both titles and their originals are preserved.

IDS now requires **Counterpart-Area**. The normal indicator route returns API error 175;
the adapter does not retry it, silently switch to WDI or sum creditor breakdowns.
Data paths are fixed to
`sources/6/country/all/series/{reviewed-code}/counterpart-area/WLD/data`.
Concept, series, time and country metadata are retrieved separately. No global `wb.db`
mutation, metadata cache or shared `requests.get` patch. IDS and WDI share a nonblocking
library lock while substituting only `wb.requests`, restored in `finally`.

- `POST /api/providers/ids/pull`: only `{"researchUse":true}`, session token,
  1 KiB body limit, 202 durable job. One supervised cancellable worker and one running
  job; 60-second per-provider cooldown.
- `POST /api/providers/ids/{id}/cancel`: interrupt without modifying active selections.
- `GET /api/ids/{id}`: report/progress plus immutable original manifests.
- `GET /api/ids/{id}/coverage`: independent economy/indicator coverage; optional country,
  indicator, offset and limit (maximum 500).
- `GET /api/ids/{id}/observations`: paginated normalized native annual rows, maximum 500.
  UI requests one full series (maximum 400 rows) and rejects truncated/mixed responses.
- `GET /api/ids/{id}/sources/{ordinal}`: exact captured bytes.
- `GET /api/ids/{id}/export`: NDJSON manifest, series metadata and normalized observations.
- `POST /api/ids/{id}/commit` and `/rollback`: separate IDS selection only; validated
  transport, source-6/WLD/nonempty numeric report and exact stored row-count gates.
  Rolling back skips previously withdrawn predecessors; no raw history is deleted.

Same fixed public World Bank host and shared WDI transport bounds: 16 MiB/response,
128 MiB total, 128 requests, 500,000 raw/normalized-row budget, 600-second deadline,
20-second HTTP timeout, no redirects/retries/fallback. Originals are SHA-256 addressed,
including explicitly marked partial response prefixes on failure. Pagination counts,
ordered pages, source IDs, revisions and total body budgets must validate. Every accepted
data page's source update must match the captured source metadata; this is not a
transactional provider publication/vintage guarantee.

Rows retain `country`, `indicator`, annual `year`, exact `value`/`rawValue` (including
null/negative), `sourceHash`, `sourceId:"6"`, `counterpart:"WLD"` and all additional
raw `attributes`. Four-dimensional identities and duplicate keys are checked even for
excluded aggregate/future cells. No fake empty WDI flags, precision, units or footnotes.
All rows are `reported_unverified`: **nonfuture dates do not establish actuals**;
source-update/retrieval times do not establish historical release availability.
The report records the UTC `historyCutoffYear`, `excludedFutureRows` (numeric plus null)
and `excludedFutureNumericRows`. Future-dated cells stay in originals, not normalized
history. No filling, independent-source corroboration, automatic aggregation or
backtest/model input. Three WDI overlaps are explicitly disclosed.

SQLite schema **9** creates independent `ids_runs`, `ids_sources`, `ids_series` and
`ids_rows` with immutable observation/series/source triggers and a single active run.
Restart recovery, backup verification and restore include IDS. Shared storage/UI helpers
do not mix its row contract or selection with WDI. Full panels never enter `/api/state`.

Acceptance acquisition: source update **2025-12-03**, 120 individual economies,
18 indicators/2,160 pairs (26 entirely absent), **123,120 rows**, **98,596 numeric**,
**24,524 explicit null**, 1970–2026. Excluded future cells: **12,960**, of which
**2,115 numeric**; dates alone do not make the retained 2025/2026 cells actuals.
All **26 originals / 46,495,951 bytes** and every normalized row/series were checked
against captured JSON and replayed through the final adapter without a second download.
Snapshots require separate manual activation; acquisition does not imply activation.
The local main database contains verified snapshot
`e414a1a3-f2e7-49e4-afb4-0f11c34c24bb`, **staged and inactive**, replayed from verification
run `a4db9313-4e6d-4630-a0c8-9d253c5286ca` with original retrieval time preserved.
Real built-dashboard coverage, Argentina total-debt values, unknown metadata, source
download and the complete 123,120-observation NDJSON export were checked after restart.
Prior provider states and fitted/holdout artifact hashes were unchanged.

### BIS quarterly contract

`backend.bis` uses `httpx`, `defusedxml` and pinned `pycountry` already installed;
`bis-fetcher` is not used because it extracts central-bank speech PDFs, not statistics.
Fixed host `https://stats.bis.org/api/v1`, LBS `WS_LBS_D_PUB` v1.0 and total credit
`WS_TC` v2.0. The [six-series definitions and interpretation limits](../README.md#bis-quarterly-banking-and-credit)
are fixed, not user-supplied SDMX keys/URLs.

- `POST /api/providers/bis/pull`, exactly `{"researchUse":true}`: token-protected
  bounded 1 KiB body, 202 durable job. One supervised worker, one running BIS job,
  60-second cooldown. No retries/redirects/fallback.
- `POST /api/providers/bis/{id}/cancel`: cooperative cancellation. Shutdown joins
  the worker before closing storage; restart interrupts unfinished jobs.
- `GET /api/bis/{id}`: report, native metadata/codelists, progress and original-response
  hashes. Compact state key `bis` excludes the full metadata, catalog and observations.
- `GET /api/bis/{id}/coverage?country=&indicator=&offset=0&limit=50`: catalog pages,
  up to 500 pairs; includes explicitly unavailable pairs and missing interior quarters.
- `GET /api/bis/{id}/observations?country=US&indicator=lbs_claims&offset=0&limit=1000`:
  required selectors, 1–1000 rows per page, native period `YYYY-Qn`. Browser assembles
  and checks the whole selected history before replacing a chart.
- `GET /api/bis/{id}/sources/{ordinal}` and `/export`: raw original XML and streaming
  NDJSON manifest/series/observations. Read responses are no-store.
- `POST /api/bis/{id}/commit` and `/rollback`: independent explicit selection.
  Activation requires completed validation, a nonempty numeric basket and matching
  persisted row count. Incomplete economy coverage alone is not a failure.

Budgets: 600-second job, 20-second HTTP inactivity timeout, at least 0.6 seconds
between request starts, 100 requests, 16 MiB decompressed per response, 128 MiB
captured total, 500,000 parsed rows. Queries use 25 current individual economies per
request with full available quarterly history. Metadata is captured before and
rechecked after the data pull; this does not establish a transactional cross-series
source vintage. Only the exact source-defined SDMX error 100/no-data envelope is
treated as unavailable coverage; arbitrary errors/HTML/404s cannot become empty success.
Unknown statuses, restricted values, changed definitions/units and duplicate or
unrequested series fail the acquisition with captured evidence.

Schema **8** adds independent `bis_runs`, `bis_sources`, `bis_series` and `bis_rows`.
Rows/series/source manifests are immutable with foreign keys and one active BIS run.
Other providers, annual/market selections and model artifacts are not altered.

Live acceptance on 2026-10-20 saved inactive snapshot
`2b14e345-ac65-49c9-8c71-1cb41979e2ac`: 102,640 native records (102,637 numeric,
three explicitly missing), all six indicators, 219 populated economies out of 249
in the union coverage catalog, 1947-Q4–2026-Q1. There are 885 absent pairs out
of 1,494. Original responses: 40 / 10,198,043 bytes. All rows and series metadata
matched original XML and a final full adapter replay; integrity/FKs/checksums passed.
The verified captured responses were replayed into the main database without a
second download; the original retrieval timestamp and verification-run identity
are retained. All other provider/model selections were confirmed unchanged.

### IMF monthly contract

The IMF connector is separate from file import limits and annual/market datasets.
The provider/view label is **Monthly IMF**; durable `imf` provider IDs and `/api/macro`
routes remain compatible. See the [data definitions and limitations](../README.md#monthly-imf).
Python uses `httpx`, `defusedxml` and pinned `pycountry`, not inferred pandas dimensions.
Flow identity, dimensions, code labels and versions are checked against captured metadata.
Series and observation attributes inherit dataset/group context. Explicit null/missing source
values stay null. Contract **`imf-monthly-native-v2`** excludes observations with a status absent
from captured metadata individually, even when numeric: `value:null`, exact `rawValue`,
source status/attributes/hash and explicit `exclusionReason` are retained, with warnings
and `unknownStatusRows` in the report. It does not infer the undocumented ER status `T`
or discard unaffected rows in the same response. Numeric/domain/scale validation still
runs before status exclusion. Forecast, non-IFS and source missing-status exclusions
also have explicit reasons. Estimated/provisional source flags remain visible.
Only public classifications are accepted, including observation-level overrides.
An invalid data response is retained but its rows are rejected with a blocking report
error; other responses may remain inspectable in the **quarantined** preview. No
rejected response participates in coverage or activation.

- `POST /api/providers/imf/pull`, exactly `{"researchUse":true}`: bounded 1 KiB body;
  returns **202** with durable running macro manifest. One supervised worker per service,
  one running IMF job, 60-second per-provider cooldown. Yahoo jobs are independently guarded.
- `POST /api/providers/imf/{id}/cancel`: requests cooperative cancellation. The last valid
  active basket is unchanged. Shutdown cancels and joins the worker before closing storage.
  Restart marks unfinished jobs interrupted. Interrupted jobs retain captured source responses.
- `GET /api/macro/{id}`: complete report, progress and immutable response manifest, without
  embedding the full observation panel. Compact summaries are returned in state `macro`.
- `GET /api/macro/{id}/coverage?offset=0&limit=50`: paginated coverage, optional country/indicator.
- `GET /api/macro/{id}/observations?country=CAN&indicator=cpi`: required series selectors,
  paginated at 240 rows by default; both endpoints allow at most 500 rows per request.
- `GET /api/macro/{id}/sources/{ordinal}`: original response bytes; SHA-256 in manifest.
  Transport prefixes captured before an interruption are explicitly marked `#incomplete-response`,
  not represented as complete originals.
- `GET /api/macro/{id}/export`: streaming NDJSON manifest, observations and coverage, retaining
  native values, statuses, reference metadata and per-row source hashes.
- `POST /api/macro/{id}/commit`: explicit whole-basket activation; quarantine/interruption
  returns 409. There is one independent active IMF selection. Historical committed versions can
  be activated without mutating observations. Exact v2 `coveragePolicy:"available-monthly-pairs"`
  permits disclosed absent pairs; source/parse/transport errors still block. Persisted row count,
  nonzero usable numeric count, report numeric/absent/pair totals and per-pair counts must match.
  Older strict snapshots still require zero absent pairs and are never automatically upgraded.
- `POST /api/macro/{id}/rollback`: invalidate a committed IMF revision, restoring its prior
  eligible macro selection if it was active. Does not change annual or ETF datasets.

No schedule or automatic retries. Job limits: 600-second acquisition deadline checked between
requests/chunks; individual HTTP inactivity timeout 20 seconds; 128 requests; 16 MiB decompressed
per response; 96 MiB captured basket; 200,000 parsed rows; 20 countries per data request.
An in-flight HTTP operation can take up to its inactivity timeout to observe cancellation.
Raw sources are persisted as each response arrives; final observations/coverage/report persist
atomically. The v2 report includes every economy/indicator pair and its missing months,
`numericCount`, `unknownStatusRows`, `coveragePolicy` and `coverageLimitation`. Missing coverage
alone no longer quarantines the panel; empty/unusable baskets do. No country/indicator is
silently dropped to manufacture completeness. Unknown release calendars keep freshness unverified.
UI histories retain their actual snapshot/economy/indicator identity after failed loads,
and complete-series pagination is validated before replacing the previous chart.

Verified reprocessing of the 69 captured original responses (23,884,141 bytes) recovers
**90,858 rows / 90,848 usable numeric values**, 249 economies × five indicators,
**419 absent pairs of 1,245**, October 2016–September 2026. Nine unknown-status rows remain
null with originals retained (five numeric ER `T` cells and four already-missing CPI cells).
The old four rejected ER batches are recovered except for those five unusable observations.
This is not a fresh provider pull; original retrieval time is preserved and the v1 quarantined
snapshot remains immutable. No automatic activation, WEO/other-provider/model changes.

SQLite schema **4** adds separate macro jobs, source manifests, immutable observations and coverage,
and per-provider concurrency guards. Existing Yahoo source originals/revisions/selections are
preserved. Database backups include all macro tables and source BLOBs. IMF native `SCALE` is not
assumed to multiply `OBS_VALUE`; converted monetary analytics remain unavailable.

### WEO annual contract

WEO is a third, independent manual provider (`imf-weo`). It uses the same fixed IMF
SDMX host, bounded transport and public access checks, but **not** the monthly
coverage gate, timestamps, observation schema or fitted annual-input schema.
See [release definitions and limitations](../README.md#imf-weo-annual-research-and-projections).

- `POST /api/providers/imf-weo/pull`, exactly `{"researchUse":true}` with mutation token:
  returns **202**, durable running manifest; at most 1 KiB body. Fixed latest WEO annual
  scope, all catalog indicators/history/horizon; no arbitrary URL, year, series or key.
  One supervised WEO worker, per-provider running guard and 60-second cooldown, separate
  from Yahoo and monthly IMF.
- `POST /api/providers/imf-weo/{id}/cancel`: cooperative cancellation, observed between
  requests/chunks and before final staging. Shutdown joins before closing storage;
  restart marks unfinished work interrupted, retaining sources and prior active release.
- `GET /api/weo/{id}`: release report, indicator/economy catalogs, progress and checksums.
  State `weo` contains compact summaries, not the full annual panel.
- `GET /api/weo/{id}/coverage?country=CAN&offset=0&limit=50`: complete catalog-pair coverage,
  including entirely absent pairs. Optional country/indicator filters; maximum page 500.
  Missing years are measured over the retrieved release's full annual range.
- `GET /api/weo/{id}/observations?country=CAN&indicator=BCA`: required series selectors,
  up to 400 annual rows by default, maximum 500; `rows,total,offset,limit,series`.
  `series` is null for absent pairs, not a generated series. Known catalog codes with
  no values return an empty page; unknown codes return 404.
- `GET /api/weo/{id}/sources/{ordinal}`: exact captured source bytes. Interrupted transport
  prefixes are labeled incomplete in the manifest.
- `GET /api/weo/{id}/export`: streaming NDJSON manifest, series metadata and annual rows,
  with classifications, original value text and source hashes. Series metadata carries
  native units/scales, cutoff, missing years, methodology and forecast-basis attributes.
- `POST /api/weo/{id}/commit`: explicitly select validated staged/committed WEO snapshot.
  Missing coverage is allowed; contract errors/unfinished acquisition are not. It does
  not replace monthly IMF, market or model-input selections.
- `POST /api/weo/{id}/rollback`: invalidates committed snapshot; restores prior eligible
  WEO selection only. Originals, immutable rows/series and audit history remain.

Acquisition budgets: 600-second deadline, 20-second HTTP inactivity timeout, 128 requests,
16 MiB decompressed response, 96 MiB total raw capture, **1,000,000 annual rows**.
Country chunks contain at most 20 economies. No automatic retries or scheduled acquisition.
Release publication and update metadata must stay consistent throughout a pull. A version
change, numeric-data contract violation or transport error fails explicitly; no vendor fallback.

SQLite schema **5** adds independent WEO runs, immutable raw manifests, normalized series
metadata and annual rows. Shared dataset/provider state is preserved. Snapshots/backups include
all WEO tables and original BLOBs. Retrieved-vintage comparisons count overlapping and changed
values/classifications, not an independent forecast backtest or complete metadata-diff audit.
Unknown units/scaling and fiscal-year boundary mappings are explicitly unavailable for analysis,
not silent defaults.

### World Bank WDI contract

`worldbank` is the fourth independent manual provider. The server uses pinned
`wbgapi==1.0.14`, specifically public `wb.fetch` for classic v2 JSON so source units,
precision, status and footnotes are retained. The high-level `wb.data.fetch` helper
drops those fields and is intentionally not used. No API key is needed.

- `POST /api/providers/worldbank/pull`, token and exactly `{"researchUse":true}`:
  returns **202** and a durable running snapshot. Maximum body 1 KiB. Fixed 17-indicator
  basket in [the adapter](./worldbank.py); source 2 only; source-specific economy
  membership intersected with explicitly non-aggregate country classifications.
  All available annual years, not a rolling window. Running guard and 60-second
  cooldown are per provider; one supervised World Bank worker with cancellation and
  shutdown/restart interruption handling. No automatic retry, scheduler or activation.
- `POST /api/providers/worldbank/{id}/cancel`: requests cancellation. Last valid active
  snapshot remains selected; partial captured responses remain inspectable.
- `GET /api/worldbank/{id}`: snapshot report, progress and immutable response manifest.
  WDI `sourceLastUpdated` is the source revision date, not historical observation
  availability. `retrievedAt` is collection time, not observation freshness.
- `GET /api/worldbank/{id}/observations?country=CAN&indicator=NY.GDP.MKTP.KD.ZG&offset=0&limit=400`:
  bounded native rows and series metadata, never the whole global panel. Rows retain
  exact decoded API numeric values/nulls, `rawValue`, `unit`, `status` (`obs_status`),
  `footnote`, `decimal` and source-page SHA-256. Classification is always
  `reported_unverified`, not a fabricated actual/forecast boundary. Original JSON
  bytes preserve the provider's exact numeric serialization.
- `GET /api/worldbank/{id}/coverage?country=&indicator=&offset=0&limit=50`:
  every requested economy × indicator pair, valid counts, complete absent pairs and
  missing annual years across the captured source window. Limits 1–500.
- `GET /api/worldbank/{id}/sources/{ordinal}`: original unmodified JSON response.
  HTTP-200 API error envelopes are failures, not observations. Known blank-ISO3
  aggregates are excluded only after exact captured two-letter code/name/class match.
- `GET /api/worldbank/{id}/export`: streaming manifest/series/observation NDJSON.
- `POST /api/worldbank/{id}/commit`: explicitly selects a validated staged/committed
  World Bank snapshot only. Incomplete coverage alone is allowed; transport/contract
  errors, empty history and row-count mismatches block activation.
- `POST /api/worldbank/{id}/rollback`: only committed snapshots; restores that
  provider's prior selection. No effect on imported model inputs, Yahoo, IMF or WEO.

All mutations require the existing session token. Read endpoints are `no-store`.
The fixed-host transport caps acquisition at **600 seconds**, **20 seconds** HTTP
inactivity, **128 requests**, **16 MiB** decompressed per response, **128 MiB** total
captured bytes and **500,000 individual-economy annual rows**. Every page is checked
for sequential numbering, counts, totals, source identity and consistent revision
date; duplicate keys, invalid periods or non-finite values fail rather than disappear.
Flags/footnotes, including unknown statuses, are retained and block affected derived
analysis. Missing source units remain blank; reviewed definitions describe conventions,
without scaling API numbers. Gaps/flags/unit changes disconnect chart segments.

Schema **6** creates separate World Bank runs/sources/series/rows, reusing the
schema-5 immutable annual table layout and namespace-whitelisted persistence without
sharing active selections. Backups verify those tables, foreign keys and original
checksums. `/api/state` contains compact summaries only. Retrieved-vintage comparisons
count overlapping native values, classifications, flags, footnotes, units and precision
changes; they are not a full metadata-diff audit or point-in-time archive. WDI is not
a source of sovereign-default labels, and central-government fiscal indicators must
not be silently harmonized with WEO general-government debt.

Real manual-API acceptance: source revision **2026-10-08**, **21 original responses**
(74,427,945 bytes), **243,474 rows including nulls / 135,799 numeric values**, **1960–2025**,
**217 requested individual economies**, **215 with values**, and all **17 indicators**.
**741 / 3,689** requested pairs have no numeric values. Snapshot
`3482bfbb-b04a-44ed-baa1-3e738f17ad61` remains **staged/inactive**. Every stored
value/null, status, footnote, unit, precision and source hash matched captured JSON.
Earlier failed attempts and source evidence remain visible rather than being erased.

### FRED/ALFRED contract

`fred` is the fifth manual provider. It uses the official FRED API for both current
history and date-selected ALFRED history. The fixed [18-series contract](./fred.py)
retains native frequency, unit definitions and seasonal adjustment. `GDP` is nominal,
and `DTWEXBGS` is not ICE DXY. No dependency or third-party proxy is needed.

Set `FRED_API_KEY` in the backend process environment; the backend does not load `.env`
automatically. Obtain your own key from <https://fredaccount.stlouisfed.org/apikeys>.
Never pass it in browser bodies, `VITE_*`, provider endpoint config, stored URLs or chat.
Use `python -m backend serve --port 8768 --prompt-fred-key` for a hidden terminal
prompt; it refuses noninteractive/echo-fallback input and validates key shape before
starting. A matching VS Code terminal task is included. See
[local setup](../README.md#fred-and-alfred-native-history-and-historical-snapshots)
for local setup. Restart the backend after configuring it.

- `GET /api/providers/fred/config`: boolean key-shape readiness, backend US Central date,
  earliest accepted date and the fixed basket. No key value, and no outbound request.
- `POST /api/providers/fred/pull`: token, 1 KiB body limit, exactly
  `{"researchUse":true,"mode":"current"}` or
  `{"researchUse":true,"mode":"historical","asOf":"2010-01-01"}`.
  Invalid/missing key fails **503** before starting a job; readiness does not guarantee
  provider access. Invalid dates/extra body fields fail **422**. Returns **202** with a
  durable running manifest. One supervised worker, running guard and 60-second cooldown
  shared between current and historical pulls.
- `POST /api/providers/fred/{id}/cancel`: requests cancellation; shutdown also cancels
  and joins the worker before closing SQLite. Restart marks running jobs interrupted
  while preserving requested mode/as-of identity and prior active selections.
- `GET /api/fred/{id}`: report, progress and credential-free source manifest.
- `GET /api/fred/{id}/series`: all requested series, native source metadata, explicit
  availability/reason, numeric/missing counts and captured archive-vintage dates.
- `GET /api/fred/{id}/observations?series_id=GDP&offset=0&limit=5000`: stable chronological
  pages, limits 1–5000. Rows contain `{seriesId,date,value,rawValue,realtimeStart,realtimeEnd,sourceHash}`.
  `"."` becomes null, not zero. Other invalid numeric/missing encodings fail.
  Browser validation assembles complete pages before replacing the prior chart.
- `GET /api/fred/{id}/sources/{ordinal}`: exact captured JSON response. Request manifests
  omit the key. Any response containing the key is deliberately not stored.
- `GET /api/fred/{id}/export`: streaming manifest/series/observation NDJSON.
- `POST /api/fred/{id}/commit`: explicit activation after transport/row-count/nonempty
  gates. Separate **current** and **historical** active selections, never model inputs.
- `POST /api/fred/{id}/rollback`: committed snapshots only; restores the preceding
  committed selection in the same mode, skipping rolled-back predecessors.

All reads are `no-store`; all mutations use the existing session token. Credential
transport uses standard-library `http.client` with HTTPS certificate verification,
no redirects, no URL logging, no retries or fallback vendor. Requests are paced at
least 0.6 seconds apart; rate-limit responses fail explicitly. Budgets are **600 seconds**,
**20 seconds** socket inactivity, **200 requests**, **16 MiB** per response,
**128 MiB** total source bytes and **1,000,000** native rows across the basket.
Content length, JSON error envelopes, chronological order, pagination identities/counts,
real-time bounds, numeric encodings and metadata are validated. Current series metadata
is re-read after observation acquisition; a change fails the job, though this cannot
guarantee a cross-series transactional source snapshot.

Full native history through the selected date is requested with `units=lin`, `output_type=1`
and no frequency/aggregation parameter. Current pulls are pinned to the start date in
US Central time. ALFRED snapshots use the explicit requested real-time day and vintage
lists, not the current calendar year as a forecast cutoff. A series lacking any captured
vintage on/before that date is unavailable; its current metadata remains labeled reference
only. Other available series may still stage. All-unavailable history fails.

Query-clipped real-time bounds do **not** supply each observation's actual release date
or intraday availability. Archive gaps are not proof that historical information did not
exist. Explicit nulls block full-window/derived analysis; implicit daily calendars are not
inferred. No rescaling, rate spreads, curve fitting, derived return, release-calendar
freshness or point-in-time backtest is implemented. Native-frequency charts disconnect
missing and nonconsecutive periods, conservatively including weekends/holidays.

Schema **7** adds independent FRED runs/sources/series/dated rows, immutable source/series/row
triggers, and one active snapshot per mode. It reuses the existing whitelisted provider
manifest/source/progress primitives but has distinct dated-row, activation and rollback
logic in [FredStore](./fred_storage.py). Backups require the new tables and verify all
original hashes/FKs. State summaries never contain the full global history or vintage list.

Real manual-API acceptance:

| Mode / as-of date | Native rows | Numeric | Missing dots | Populated series | Captured responses |
|---|---:|---:|---:|---:|---:|
| Current / 2026-10-20 | 163,319 | 153,953 | 9,366 | 18 / 18 | 81 |
| Historical / 2010-01-01 | 83,978 | 79,453 | 4,525 | 11 / 18 | 63 |

Current snapshot `9c069f6b-9a63-4b0e-bc36-2a7f73cf51b6` and historical snapshot
`0b54666d-f056-41db-bcb8-3f849f8a3220` remain **staged/inactive**. The historical
archive list has no eligible vintage for SOFR, EFFR, DTWEXBGS, VIXCLS, DCOILBRENTEU,
PCOPPUSDM or PWHEAMTUSDM on/before the selected date; none receives current values.
Every native row and series metadata record matched captured originals and a full parser
replay, and all stored provider originals passed checksum verification. Historical GDP
differs from current revised GDP in 251 of 255 overlapping periods, confirming this is
not current history relabeled as an old vintage. No other provider/model selection changed.

### State and existing ingestion API

`GET /api/state` returns exactly:

```text
{schemaVersion:1, datasets:Dataset[], runs:Run[], providers:Provider[], macro:MacroSummary[], weo:WeoSummary[], worldbank:WorldBankSummary[], fred:FredSummary[]}
Dataset = {id,version,kind,source,unit,createdAt,freshnessDays,observations,active,sessionPolicy,providerReport}
Run = {id,status,createdAt,source,kind,errors,datasetId,rowCount}
Provider = {id:'yfinance'|'imf'|'imf-weo'|'worldbank'|'fred',name,mode:'manual',status,lastAttemptAt,lastValidatedAt,errors}
```

`kind` is `annual|market`; run status is
`staged|quarantined|committed|rolled_back|interrupted`. Dataset version is a
monotonically increasing **string** revision per kind. `freshnessDays` and a
pending run's `datasetId` are explicitly `null` when unknown. Every observation
has an explicit `publishedAt` string or **null**. Annual observations contain
`country,year,inDefault,values`; market observations contain
`symbol,observedAt,value`. Annual `values` may contain nulls. Observation fields
for the other kind are absent. All state histories and import previews are
returned in full (up to 10,000 imported rows); display truncation is a UI concern.
Provider status is `available|running|staged|quarantined|interrupted`, not a
streaming "connected" claim. A staged provider job remains staged even after its
separate import run commits. `sessionPolicy` and `providerReport` are null for
ordinary file datasets. Runs are returned in ascending creation order.

- `POST /api/imports`: multipart `file,kind,source,unit`, optional
  `freshnessDays,sheet`; returns `{run,preview,sheets}`. A parsed invalid batch
  returns **HTTP 200** with a durable `quarantined` run, errors, and an empty
  preview. No rows from that batch become datasets. Invalid request metadata
  returns 422; malformed multipart returns 400. Requests exceeding the transport
  budget (5 MiB + 64 KiB multipart overhead) return 413 before parsing and have
  no import run. A bounded oversized file is quarantined; its complete received
  bytes are retained, not a truncated prefix.
- `POST /api/imports/{id}/commit`: atomic commit and returned state. Committing
  an already committed run is a no-op. Quarantined/interrupted/rolled-back runs
  cannot commit (409). Database failures roll back all dataset writes and
  persist a redacted `interrupted` job error when storage remains available.
- `POST /api/providers/yfinance/pull`: JSON `{"personalUse":true}` plus the normal
  mutation token; no arbitrary tickers, URLs or settings accepted (422).
  At most 1 KiB request body. Returns `{run,preview,sheets,providerReport}`.
  Nothing activates automatically. Network, timeout and validation failures
  produce a durable quarantined run with no preview; unexpected internal failures
  produce an interrupted provider job and HTTP 500. Concurrent/cooldown pulls return 409.
- `GET /api/imports/{id}/preview`: durable preview/report, including after restart,
  so staged batches can be reviewed and committed later.
- `GET /api/imports/{id}/metadata`: original checksum, filename, staged timestamp
  and provider report (null for file imports).
- `GET /api/imports/{id}/original`: exact captured source bytes as a local download.
- `POST /api/datasets/{id}/activate`: select a committed revision, returning state.
  **Exactly one dataset per kind** can be active; no mixing sources or implicit
  market merges.
- `POST /api/datasets/{id}/rollback`: explicit, audited invalidation; preserves
  observations, original bytes, and revision history. If active, restores the
  previous non-rolled-back revision, or leaves the kind without an active dataset.
  Rolled-back datasets cannot be reactivated.
- `GET /api/datasets/{id}/metadata`: source, retrieval timestamp, original SHA-256,
  filename, worksheet, latest known publication date (`vintageAsOf`, null when
  unknown), and whether all publication dates are known. This is not an invented
  provider vintage identifier. Yahoo datasets also expose the persisted validation
  report with actual request/retrieval times and library/adapter versions.
- `GET /api/health`: persists health observations (service, last import, datasets),
  including explicitly unknown freshness thresholds. Freshness groups market
  rows by symbol and annual rows by country, takes the latest observation
  period per series, and labels the dataset stale if **any** series exceeds
  the threshold. Annual periods end December 31 at 23:59:59 UTC; this is an
  observation-period convention, **not** an inferred publication date.
  Details include `seriesLatestObservationAt` (series-to-UTC-time map),
  `oldestLatestObservationAt`, and `ageDays` for the oldest latest series.
  `latestObservationAt` remains the globally newest observation period.
  Health is checked on demand and after mutations, not on a background timer.
  Yahoo datasets use the latest completed US ETF session rather than a generic
  age-in-days threshold. `sessionPolicy` contains `expectedCloseAt`, `nextCheckAt`
  and `checkedAt`; the browser expires eligibility locally at `nextCheckAt`.
  `connectorsActive:false` means no continuous/scheduled connectors; the manual
  adapter's actual job status is in `state.providers`.
- `GET /api/events`: persisted audit/data-health events
  `{sequence,event,createdAt,runId,datasetId,details}`. Timestamps are real UTC
  times; identical health states are deduplicated (age ticking alone is not an
  event). `GET /api/audit` also includes service-start events.
- `GET /api/backup`: downloadable consistent standalone SQLite snapshot,
  including WAL data, original BLOBs, jobs, datasets, health, and audit history.

Static `dist/` is served if it contains `index.html` at startup. Missing API
routes and assets return 404, never the SPA document.

## Yahoo data contract

Fixed allowlist: **EMB, PCY, ECH, TUR**, five calendar years of completed daily
US ETF sessions, USD/share. This is ETF Close monitoring, not CDS/yield data,
total-return analytics or annual macro inputs. Query settings explicitly disable
yfinance auto/back adjustment, repair, pre/post sessions and rounding while
retaining actions and missing rows for validation. Yahoo itself may split-adjust
or revise historical prices. Dividend-adjusted close is retained but not analyzed.

The [adapter](./yahoo.py) verifies exact Yahoo fund names, ETF type, symbol,
USD, exchange allowlist, New York timezone and daily granularity. It checks
finite positive OHLC/adjusted close, OHLC envelopes, nonnegative integral volume
(zero volume is reported as a warning), nonnegative finite corporate actions,
ordered unique local-midnight bar labels and every expected session for every ETF.
Missing sessions reject the whole batch, with no data repair or partial activation.
XNYS is the common US holiday/session schedule used for these listings; a
30-minute post-close buffer excludes current/incomplete sessions, including
early-close days. This does not certify Yahoo's publication/finalization time.
Bar timestamps are transformed from local-midnight labels to actual session close
UTC; publication times remain null.

Acquisition runs in an isolated Python subprocess with a temporary yfinance cache,
90-second deadline and no automatic retries. SQLite admits one running job and
enforces a 60-second cooldown. Restart converts abandoned running jobs to
interrupted; active data remains unchanged. Validation failures retain captured
partial responses; a killed/timed-out worker retains a failure report, not an
invented response body. Source originals are **yfinance library-response snapshots,
not raw HTTP**. They include OHLCV, adjusted close, actions and selected metadata.
Reports contain actual times, settings, versions, coverage, action summaries,
warnings and SHA-256 lineage. Schema migration 3 adds durable provider jobs.

Yahoo access is unofficial, may rate-limit/fail, and is for local personal
research only under [the provider's terms](https://ranaroussi.github.io/yfinance/).
Do not redistribute data. These checks validate a provider response's contract,
not independent price accuracy or investment suitability. Deterministic tests
mock all provider traffic; real network acceptance must be run separately.

Opt-in real acquisition plus a separate direct Yahoo chart query for every
historical OHLCV bar and corporate action (same vendor, **not** independent
price verification; no data is activated or written to the research database):

```sh
ECONQUEST_LIVE_YAHOO=1 .backend-venv/bin/python -m unittest backend.tests.test_yahoo_live -v
```

The live check measures response-to-response `Adj Close` differences without
substituting it for Close. During onboarding, unadjusted OHLCV/actions matched
exactly across 5,016 bars; adjusted-close responses differed by at most
0.00006104 USD/share. Adjusted close remains captured metadata, not an analyzed
price or claimed total return. Historical snapshots may differ on later pulls.

## File schema and validation

CSV is UTF-8, optionally with BOM. XLSX uses cached values; formulas without a
cached value are rejected, never executed. XLS is unsupported. Workbooks with
multiple worksheets require an explicit `sheet`; quarantined previews still
list available sheet names for selection.

Maximum accepted file size: **5 MiB**; **10,000** data rows; **20** sheets.
XLSX ZIP inspection limits entries (2,000), total expansion (25 MiB), individual
entries (10 MiB), compression ratio (100:1), and columns (16). Encrypted,
duplicate, and traversal entries are rejected. XML entity protections are
provided by pinned `defusedxml`. Limits reject the whole batch.

Annual required header (optional final `published_at`; column order is flexible):

```csv
country_code,year,in_default,externalDebtGni,shortTermDebtReserves,reservesMonths,gdpGrowth,inflation,currentAccountGdp,published_at
CHL,2022,false,60,20,3,2,4,-1,
CHL,2023,false,61,21,4,3,5,-2,2024-02-01
```

Annual `unit` must be `model-feature-units`. Codes are
`CHL BLZ LKA ARG TUR GHA IDN PAK ZAF`. Years must be integers from 1900 through
the **previous UTC calendar year**, ordered and consecutive per included
country, with at least two years per country. Defaults must be explicit
`true,false,1,0`. Each row needs at least four finite features; HMM indices
2/3/4 (reserves/GDP growth/inflation) must be observed. Debt and reserves
indices 0/1/2 cannot be negative.

Annual datasets preserve the complete sequence **as imported**, not a hidden
database merge. The selected dataset is an explicit overlay onto the bundled
`src/data/fittedAnnualModels.json` history: matching country/year keys replace
bundled rows, other bundled rows remain. The backend rejects overlays creating
gaps and rechecks the bundled history on commit/activation; if that artifact is
missing or incompatible, annual imports fail closed. Datasets do not implicitly
overlay earlier imported revisions. The frontend additionally validates its
merged histories before committing.

Market header:

```csv
symbol,observed_at,value,published_at
EXAMPLE,2024-01-01T00:00:00Z,100,
```

At least one observation, finite values, unique `(symbol,observed_at)` keys,
timezone-aware ISO timestamps normalized to UTC, and no future completed
observations. One file may contain multiple symbols sharing the supplied unit.
Each dataset is a **full replacement**, not an implicit merge. Unknown publication
dates remain null. Publication dates may be ISO dates or timezone-aware ISO
timestamps. No missing freshness threshold is guessed.

## Retention, migrations, and recovery

All received, bounded import bytes are immutable, content-addressed SQLite
BLOBs, including quarantined batches. Idempotency covers the original bytes,
parser version, file type, kind, source, unit, freshness threshold, and selected
sheet. Original inputs, observations, and audit events have SQL immutability
triggers. There is **no deletion/retention-purge API**; protect backups as local
research data. Staged jobs survive restarts and remain staged, rather than being
mislabelled as interrupted. SQLite migrations are transactional; newer unknown
database versions fail closed.

Back up online, without copying a live SQLite/WAL file manually:

```sh
.backend-venv/bin/python -m backend backup \
  --db research-data/research.sqlite3 --output research-backup.sqlite3
```

Restore only to an explicit **new, non-overwriting, offline target**:

```sh
.backend-venv/bin/python -m backend restore \
  --input research-backup.sqlite3 --target research-data/restored.sqlite3 --offline
ECONQUEST_DB_PATH=research-data/restored.sqlite3 \
  .backend-venv/bin/python -m backend serve --port 8766
```

Stop the old backend before switching which database is served. Restore refuses
existing targets, including a live database, and requires the `--offline`
acknowledgement. Integrity, foreign keys, supported schema, and original-byte
checksums are checked. Process locks prevent two backend processes from opening
the same database; SQLite transactions enforce atomic revisions and activation.
