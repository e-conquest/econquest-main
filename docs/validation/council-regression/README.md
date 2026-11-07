# Council regression: real-model baseline in CI

The council regression set (`cases.json`) holds fixed questions with frozen inputs and the reading
a good answer must give. It runs through the same steps as the app, on the referee model, at
temperature 0 with seed 42.

Cases by step (`kind` in `cases.json`):

- `summary` (default): the Council chat summary, from frozen agent answers.
- `supreme`: the Supreme Council's final report (SMCR-1.0), from frozen figures, desk readings and
  CRO scores; every other figure is MISSING in the prompt. Only what the model wrote is checked;
  fields it leaves out are filled from the built-in report in the app and are not counted.
- `options`: Policy review step 3 (Options), from a frozen frame and diagnosis figures; every other
  diagnosis figure is Missing ("not in this test case"). The model readings [13]+ read the app's
  saved history, so they are left out to keep the case the same on every computer. This step now
  runs on the referee model too (it ranks options, so it judges).

## Three commands

| Command | Where | What it does |
| --- | --- | --- |
| `npm run council:regress` | Mac, app running | Runs the set live on your AI model, prints PASS/FAIL per case, and compares with the recorded baseline. |
| `npm run council:record` | Mac, Ollama open | Runs the set on a private copy of the server (your app and data are not touched) and records every model reply plus the report in `tests/fixtures/council-recorded/`, and a zip in `data/local/council-recording.zip`. |
| `npm test` | CI | Replays the recorded replies through the real server (`tests/councilRecorded.test.ts`). |

`npm run council:record -- --model qwen2.5:32b` picks the model; without it the referee model saved
under Settings > AI model is used. A model of 8B or less is refused. Set `OLLAMA_URL` if Ollama is
not at `http://localhost:11434`.

Before recording, check that the Mac's own Ollama app answers on port 11434, not a Docker container:
`docker ps` must not list an Ollama container publishing 11434, and `ollama ps` should show
`100% GPU`. A Docker Ollama on a Mac runs on the CPU with Docker's memory cap, so a 32B model is
killed while loading (`HTTP 500: llama-server process has terminated: signal: killed`) and desks
time out. Stop it (`docker stop <name>`), open the Ollama app, and pull the models again there if
`ollama list` no longer shows them.

## What fails the build

1. **A step asks the model something that was not recorded.** Each model call is named by a hash of
   the model, the messages (instruction, template, frozen inputs) and the sampling options. A change
   to any of them means the recorded answer no longer applies. The failure names the step and the
   first line that changed.
2. **The answers differ from the baseline.** Same model replies, different checked answer: a change
   to the number checks, the parsing or the case file.
3. **A case that passed in the baseline fails.** Cases that already failed when recorded are listed
   as known failures, not hidden and not edited to pass.
4. **A structural check fails** for any case: no model named, a small model, not temperature 0 with
   a seed, or a number in the answer that no input gave.

Until a recording is committed, the replay test is skipped with a note; the recorder and replayer
themselves are always tested on a stand-in model.

## Accepting a new baseline

When a change to a prompt or template is meant (CI fails with "these model steps changed"):

1. On the Mac: `git pull`, then `npm run council:record`.
2. Read the answers it prints. They are what the referee model now says.
3. If they are right, send `data/local/council-recording.zip` in the project thread (or commit
   `tests/fixtures/council-recorded/`). It goes in with the change, and CI is green again.
4. If they are wrong, the change made the council worse: fix the prompt, not the baseline.

`npm run council:regress` also reports drift between the live model and the baseline, for example
after an Ollama or model update. Accept it the same way if the new answers are right.

## Limits

- The replay proves the code still asks the model the same thing and handles its answer the same
  way. It does not re-ask the model in CI: the cloud cannot reach Ollama on the Mac.
- Ollama at temperature 0 with a fixed seed repeats itself on the same machine and version; another
  machine or version can word answers differently. The baseline records the Ollama version.
- The frozen inputs are test inputs, never shown as data in the app.
