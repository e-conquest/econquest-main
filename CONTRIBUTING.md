# Contributing to EconQuest Terminal

Thank you for helping. This project is open-source research software for emerging-market sovereign
and macro risk. Contributions of every size are welcome: a fixed feed, a methods check, a
replication, a test, a typo.

Please read the [code of conduct](CODE_OF_CONDUCT.md) first. Security problems go through
[SECURITY.md](SECURITY.md), not public issues.

## The research rules

Every change has to keep these. Pull requests that break them are not merged, however useful.

1. **Only real figures.** A number appears only when an official series, a live feed or the user's
   own file supplied it. When a figure is not available, the app shows **Missing** with the reason
   ("Needs setup", "Feed did not answer", "No source yet"). No built-in, sample or AI-estimated
   figures, and no web-search estimates.
2. **Paid data only from the user's own account**, behind a switch in Settings, with no stub values.
3. **Every new data source gets a licence row** in `src/data/dataLicences.ts` (quote the terms and
   the date you read them), then run `npm run docs:licences`. If the terms do not allow showing the
   figures to others, say so in the row.
4. **Signals and forecasts are pre-registered.** Add the spec under `docs/validation/` before the
   first run, and do not change it after you have seen a result. A failed test stays failed; a new
   idea is a new version with its own spec. See [docs/METHODS.md](docs/METHODS.md).
5. **Honest labels.** Say what a panel is ("Description, not a tested signal"), where a figure came
   from and how old it is.
6. **No bypassing bot checks** on data providers' sites (no fake browser user agents).

## Set up

You need Node.js 20 or later.

```bash
npm install
npm run dev          # http://localhost:3000
```

Every figure works without an AI model. For the council, choose Ollama on your computer or a Gemini
key in Menu > Settings > AI model. A free FRED key fills most 10-year yields. See
[docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

## Before you open a pull request

```bash
npm run lint         # TypeScript
npm test             # unit and server tests, network replaced by fixtures
npm run build
npx playwright install chromium   # once
npm run test:smoke   # every page with all feeds down
```

- Keep pull requests small and about one thing. Rebase on `main` rather than merging it in.
- Add or update a test in `tests/` for each module you change in `src/utils/` or `server.ts`.
  Tests must not reach the network; use `tests/helpers/offline-fetch.mjs`.
- New UI follows [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) and sits inside a `PanelBoundary`.
- Never commit keys, `.env`, or anything from `data/`.
- Recorded feed replies (`npm run record:feeds`) stay on your computer: several sources do not allow
  their data to be passed on, so `tests/fixtures/recorded/` is not part of the public repository.

## Sign off your commits (DCO)

By contributing you certify the [Developer Certificate of Origin](https://developercertificate.org/):
that you wrote the change or have the right to submit it under the project's licences. Add a
sign-off line to each commit:

```bash
git commit -s -m "Explain what changed"
```

which adds `Signed-off-by: Your Name <you@example.org>`. Code is contributed under the Apache License
2.0 and documentation and content under CC BY 4.0 ([LICENSE-docs.md](LICENSE-docs.md)).

AI coding tools are fine to use. You are responsible for the change as if you wrote it by hand: read
it, test it, and say in the pull request that a tool helped.

## Where things are

| Path | What |
| --- | --- |
| `server.ts` | Express API, data pulls, caches and the archive |
| `src/utils/` | One module per source or calculation, each with a test in `tests/` |
| `src/components/` | React pages and panels |
| `src/data/` | Navigation, official calendar, country list, licence register |
| `docs/validation/` | Pre-registered specs and recorded verdicts |
| `scripts/` | Command-line jobs (`npm run check:data`, backtests, evaluations) |

## Good first contributions

- A feed that broke: run `npm run check:data`, find the source that fails, fix its module and test.
- A licence row marked "Terms not confirmed": read the provider's terms and update the row.
- A methods note in `docs/METHODS.md` that is unclear or wrong.
- Issues labelled `good first issue`.

## Quests

A section on proposing and entering Quests will be added here when Quests launch.

## Questions

Open a Discussion or an issue. Decisions and who makes them are described in
[GOVERNANCE.md](GOVERNANCE.md).
