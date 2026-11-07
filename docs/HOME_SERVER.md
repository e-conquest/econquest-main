# Running EconQuest on a home server

This runs the app and Ollama together on one always-on machine: a Linux box or a NAS that runs
Docker. The Mac way of starting (`start-mac.command`, or `npm run dev`) keeps working as before.

Files: [`deploy/home-server/`](../deploy/home-server/) holds `compose.yml`, `compose.gpu.yml`
and `env.example`.

## What the machine needs

| Part | Enough for the 7B desks only | For the 32B referee (qwen2.5:32b) |
|---|---|---|
| Memory | 16 GB | 32 GB, or a GPU with 24 GB of video memory |
| Disk | 20 GB free | 60 GB free (the 32B model is about 20 GB; offline data and GDELT files add more) |
| Processor | any recent 64-bit (x86-64 or ARM64) | same; without a GPU a full council report can take 10 minutes or more |

The referee steps (Supreme Council, summaries, explanations, debate) always use the 32B model,
never an 8B one. On a machine without the memory for it, keep Ollama on the Mac or another
computer and point the server at it (see "Ollama on another computer").

The server needs outbound internet for the free data feeds. Nothing has to be opened inbound.

## Install (Linux)

1. Install Docker Engine and the compose plugin. On Debian or Ubuntu:

   ```sh
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker "$USER"    # then log out and back in
   ```

2. Get the code and make the two state folders. The app runs as user id 1000, so it must own
   `data`:

   ```sh
   git clone https://github.com/smcarus/econquest.git
   cd econquest/deploy/home-server
   cp env.example .env
   mkdir -p data ollama
   sudo chown -R 1000:1000 data
   ```

3. Edit `.env` if you need to (port, time zone, data keys). Every line is optional.

4. Start it, then download the models (once; the 32B one is about 20 GB):

   ```sh
   docker compose up -d --build
   docker compose exec ollama ollama pull qwen2.5:7b
   docker compose exec ollama ollama pull qwen2.5:32b
   ```

5. Check it:

   ```sh
   curl -s http://127.0.0.1:3737/healthz    # {"status":"ok"}  the process answers
   curl -s http://127.0.0.1:3737/readyz     # {"ready":true}   it can serve and save
   docker compose ps                        # econquest shows (healthy)
   ```

6. Fill the offline data and run the first data check (both take a while the first time):

   ```sh
   docker compose exec econquest npm run preload
   docker compose exec econquest npm run check:data
   ```

   Then open the app, Menu > Settings > AI model > Test, and Menu > Data health.

## Opening the app

The app listens on the server itself only (`BIND_ADDRESS=127.0.0.1`). While it has no accounts
and nobody else can reach it, there is no sign-in. Three ways in:

- **SSH tunnel.** From your Mac: `ssh -N -L 3737:127.0.0.1:3737 you@homeserver`, then open
  http://localhost:3737.
- **HTTPS with sign-in (recommended for more than one person).** See the next section.
- **Your home network, plain HTTP.** In `.env` set `BIND_ADDRESS=0.0.0.0` and list the names you
  type in the browser in `ALLOWED_HOSTS`, for example `ALLOWED_HOSTS=homeserver.local,192.168.1.20`.
  Passwords then cross your network unencrypted; prefer HTTPS. Do not forward the port on your router.

Whenever the app is reachable from other computers (`ALLOWED_HOSTS` set), it asks for the first
admin account before anything else. That needs the one-time setup code from the log:

```sh
docker compose logs econquest | grep "setup code"
```

After that everyone signs in; the admin adds accounts under Menu > Users. Locked out:
`docker compose exec econquest npm run users -- reset-password <username>`. Details:
[SECURITY.md](./SECURITY.md).

## HTTPS and sign-in

1. In `.env`:

   ```sh
   COMPOSE_PROFILES=ollama,https
   SITE_ADDRESS=homeserver.local
   ALLOWED_HOSTS=homeserver.local
   TRUST_PROXY=1
   COOKIE_SECURE=true
   ECONQUEST_SECRET_KEY=...        # openssl rand -base64 32; keep a copy elsewhere
   ```

   Leave `BIND_ADDRESS=127.0.0.1`: only Caddy is published (ports 80 and 443).
2. `docker compose up -d`, then open https://homeserver.local.
3. With `TLS_MODE=internal` (the default) the certificate comes from Caddy's own authority, so
   browsers warn until you trust it once on each computer. Copy it out with
   `docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt .` and add it to Keychain
   Access (Mac: set it to Always Trust) or the system store. For a real domain whose ports 80 and
   443 reach this box, set `TLS_MODE` to your email address instead and Caddy gets a Let's Encrypt
   certificate.
4. Get the setup code (above), create the admin account, then add the others under Menu > Users.

`ECONQUEST_SECRET_KEY` encrypts the keys you save in Menu > Settings. It is not in the data folder,
so the data folder backup does not hold it: keep it in your password manager.

## NAS (Synology, QNAP, Unraid, TrueNAS)

Use the NAS's Docker or "Container Manager" app and create a project from
`deploy/home-server/compose.yml` (copy the whole repository folder to the NAS so the build can
find the Dockerfile). Two things differ from Linux:

- Make the `data` folder owned by user id 1000, or set `DATA_PATH` to a shared folder and give
  uid 1000 read and write on it in the NAS permissions screen. If the owner is wrong, the app
  stops at start and its log says exactly which folder it could not write.
- Most NAS units lack the memory for the 32B model. Run the app on the NAS and Ollama on a
  stronger computer (next section).

## Ollama on another computer

Delete `COMPOSE_PROFILES=ollama` from `.env` and set the URL, for example
`OLLAMA_BASE_URL=http://192.168.1.30:11434`. On that computer Ollama must listen on the network:
on a Mac, `launchctl setenv OLLAMA_HOST 0.0.0.0` and restart Ollama. Then
`docker compose up -d`.

On a Mac, keep only one Ollama on port 11434. If another Docker stack also runs an Ollama container
there, it answers instead of the Mac app: it has no Apple GPU and only Docker's memory share, so
the 32B referee is killed while loading ("signal: killed") and desks time out. `docker ps` shows
it; stop it or move it to another port.

## NVIDIA GPU

Install the NVIDIA Container Toolkit, then start with both files:

```sh
docker compose -f compose.yml -f compose.gpu.yml up -d --build
```

## Day to day

| Task | Command (in `deploy/home-server`) |
|---|---|
| Update to the latest version | `git pull && docker compose up -d --build` |
| Logs (one JSON line per message) | `docker compose logs -f econquest` |
| Stop / start | `docker compose stop` / `docker compose start` |
| Data check | `docker compose exec econquest npm run check:data` |
| What ran overnight | Menu > Data health > Scheduled |

`docker compose stop` lets open requests finish (up to 8 seconds) before the app exits.

## Server alerts

A server left running should tell you when something breaks. Set a webhook, email, or both in
Menu > Settings > Server alerts (or in `.env`), and press Test: it sends a real test message.
Nothing is sent until one is set.

| Setting | Example | What it is |
|---|---|---|
| `ALERT_WEBHOOK_URL` | `https://hooks.slack.com/services/…` | Where to post the message |
| `ALERT_SMTP_URL` | `smtps://you%40gmail.com:APP-PASSWORD@smtp.gmail.com:465` | The mail server that sends alert emails (write `@` in the user name as `%40`) |
| `ALERT_EMAIL_TO` | `you@example.com` | Who gets them (several separated by commas) |
| `ALERT_EMAIL_FROM` | `econquest@example.com` | Optional sender; default the user name in `ALERT_SMTP_URL` |

What sends an alert:

| Event | When |
|---|---|
| Data source broke | The nightly data check (05:30, `DATA_CHECK_TIME`) finds a source that connected at the run before and fails now. One alert when it breaks, not every night it stays broken. |
| Scheduled job failed | A scheduled Download all or backtest run ends not ok: a failed step, stopped early, a feed that did not answer, or a crash. |
| Backtest regression | A pre-registered backtest, same id and version, that passed at its last run does not pass now. A new version is a new test, so it does not count. |

Checks and backtests you run yourself in the app send nothing: you see the result. Settings >
Server alerts shows the last alert and whether each route took it; `docker compose logs
econquest | grep alert` shows every one.

The webhook message is shaped for the address: `text` for Slack and Google Chat, `content` for
Discord, plain text for ntfy.sh. Any other address gets one JSON object (`text`, `title`, `lines`,
`kind`, `at`), which Mattermost and Rocket.Chat read as well, or your own receiver can sort by
`kind`. Gmail needs an app password (2-step verification on, then Google Account > Security >
App passwords).

Messages say what failed and when. They never carry a key or password: every line is checked
against every saved key and setting, and anything that looks like a key in a web address is
blanked, before it leaves the server. The webhook address and the mail server are kept like
keys (masked, encrypted on disk when `ECONQUEST_SECRET_KEY` is set, never in backups).

## Where things are kept

Everything the app saves is in one folder, `data` (or `DATA_PATH`): settings and keys you saved
in Menu > Settings, saved feed data, history, the pull archive, reports, the audit log and data
health history. The image holds no state, so updating or rebuilding never loses anything.
Models are in `ollama` and can always be downloaded again.

Back up the `data` folder. Menu > Backup makes a file without keys; how to restore it, and a
restore drill that proves a backup works, are in [Backup and restore](BACKUP_AND_RESTORE.md).

## Configuration

Config comes only from environment variables (`.env` here, or the full list in the repository's
`.env.example`). The main ones:

| Variable | Default | What it does |
|---|---|---|
| `PORT` | 3737 | Port on the server |
| `BIND_ADDRESS` | 127.0.0.1 | Address the port is published on |
| `ALLOWED_HOSTS` | empty | Host names accepted when opened to the network |
| `DATA_PATH` | ./data | The state folder on the server |
| `OLLAMA_BASE_URL` | http://ollama:11434 | Where Ollama is |
| `OLLAMA_QUICK_MODEL` | qwen2.5:7b | Desk agents |
| `OLLAMA_DEEP_MODEL` | qwen2.5:32b | Referee steps |
| `TZ` | UTC | Time zone for the morning brief, the nightly data check and scheduled jobs |
| `SCHEDULE_DOWNLOAD_ALL` | 02:30 | Daily Download all (every free feed for every country); `off` to stop |
| `SCHEDULE_BACKTESTS` | sun 03:30 | Weekly run of the pre-registered tests: backtests, then forecast evaluations and currency signal tests, each adding to its forward record; `off` to stop |
| `LOG_FORMAT` | json in the image | `json` or empty for plain text |
| `SHUTDOWN_TIMEOUT_MS` | 8000 | How long a stop waits for open requests |

## Later: Kubernetes

The image is built so a cluster needs no code change: config by environment, one volume at
`/app/data`, Ollama by URL, `/healthz` for liveness and `/readyz` for readiness, clean stop on
SIGTERM, logs on stdout. A Helm chart is a small step now that sign-in and multiple users exist.
