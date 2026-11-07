# Security: accounts and sign-in

The app started as a one-person tool on one computer. This page says what protects it when more
than one person uses it, and what does not yet. It grows with each security change.

## When sign-in applies

| Situation | Sign-in |
| --- | --- |
| No accounts, app on this computer only (the default, `start-mac.command`, `npm run dev`) | Off. Everything works as before. Menu > Account offers to create the first admin account. |
| No accounts, app opened to a network (`HOST=0.0.0.0` or `ALLOWED_HOSTS` set) or `AUTH=on` | Set-up only. Nothing works until the first admin account is created, and creating it needs the one-time setup code printed in the server log. |
| At least one account | Required for everyone, on every page and API call, including on the computer running the app. |

The setup code stops someone else on the network from claiming the app before you do. Find it with
`docker logs econquest-orchestrator` (Docker) or in the terminal running `npm run dev`.

## What is in place

- **Passwords** are stored only as salted scrypt hashes in `data/local/auth/accounts.json` (mode 600).
  At least 12 characters; may not contain the username.
- **Sessions** are random 256-bit tokens in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` behind HTTPS
  with `COOKIE_SECURE=true`). The server keeps only each token's SHA-256 in `data/local/auth/sessions.json`,
  so a copy of that file cannot be used to sign in. A session ends after 12 hours without use or 7 days
  in all (`SESSION_IDLE_HOURS`, `SESSION_MAX_DAYS`).
- **Wrong passwords**: 5 for one username, or 20 from one address, within 15 minutes lock further tries
  for the rest of the 15 minutes. A wrong username takes as long to refuse as a wrong password.
- **Password change** (Menu > Account) signs the account out on every other browser.
- **Audit log** records the first account, each sign-in, failed sign-in, sign-out and password change,
  with the account name, never the password or token.
- **Who did it**: every audit entry written while someone is signed in names the account (Menu >
  Audit log, and a By column in the CSV). The name is part of the entry's hash, so changing who did
  something breaks the chain check. Entries from before accounts existed have no name and still check.
- **Sign-off**: the name on a review or approval is the signed-in account's, not typed. Approving is an
  Admin step, and the account that reviewed a report cannot approve it (no "self-approved" with accounts).
- **Own workspace per account**: holdings, watchlists and added countries are kept per account in
  `data/local/users/<account id>/workspace.json`. The first admin starts from what the single user had
  saved (`data/local/workspace.json`, which stays as the workspace while sign-in is off). When a different
  account signs in on the same browser, the previous account's browser copy is removed first. Saved
  research, policy reviews and sign-offs stay a shared team library, with who saved what in the audit log.
  The morning brief uses the first active admin's watchlists. A backup holds the team library and the
  workspace of the admin making it; other accounts' workspaces are in `data/local/users/` and are
  covered by copying the data folder.
- **Keys encrypted at rest**: with a master key set, the data and AI keys saved in Menu > Settings are
  written to `data/local/settings.json` with AES-256-GCM. The master key is never in the data folder; it
  comes from `ECONQUEST_SECRET_KEY` (32+ characters, e.g. `openssl rand -base64 32`), the file named by
  `ECONQUEST_SECRET_KEY_FILE`, or the Docker secret `/run/secrets/econquest_secret_key`. Keys saved
  before are encrypted at the next start. Without a master key they stay plain text in a mode-600 file,
  and Menu > Settings says so. Keep a copy of the master key: without it, encrypted keys cannot be
  opened and must be entered again (they are kept, not deleted, until then).
- **Accounts and sessions are never in a backup** (Menu > Settings > Backup lists what one holds).
- **CSRF token**: while signed in, every change must carry `X-CSRF-Token`, derived from that browser's
  session (the page gets it at start). A page on another site cannot read it.
- **Rate limits per account**: 600 requests a minute in all, and 10 a minute (20 at once) for calls that
  run the AI model. Over the limit the server answers 429 with Retry-After.
- **Security headers** on every reply: no framing (`X-Frame-Options: DENY`, `frame-ancestors 'none'`),
  `nosniff`, `Referrer-Policy: same-origin`, no camera, microphone or location, no `X-Powered-By`.
  A full Content-Security-Policy for scripts is not set yet.
- The earlier checks stay: only listed host names are answered (DNS rebinding), and changes sent from
  pages on other sites are refused.

## Roles

| Role | Can |
| --- | --- |
| Viewer | Read Research, Reports and saved council answers, and keep their own watchlists and holdings. Cannot ask the council or change anything shared. |
| Analyst | Ask the council, save research, run policy reviews and backtests, sign off, refresh data, change watchlists and holdings. Sees which keys are set (masked) but cannot change them. |
| Admin | Everything, plus data and AI keys, AI model settings, backup and restore, the audit log, connectors and webhooks, watch alerts, the morning brief, and accounts (Menu > Users). |

One table in `src/utils/permissions.ts` decides this for every API call; a new route is Analyst
unless listed. The server refuses, so hiding a button is never the only check. The last active
admin cannot be demoted or disabled. Disabling an account signs it out at once. A password set
or reset by an admin is random, shown once, and never logged.

With accounts, an admin may change keys from any browser; the old "only from the computer running
the app" rule applies only while sign-in is off.

## Locked out

On the server (picked up by a running app straight away):

```
npm run users -- list
npm run users -- reset-password <username>     # prints a new random password once
npm run users -- add-admin <username> "<Name>"
npm run users -- disable <username>
```

Under Docker: `docker compose exec econquest npm run users -- list`.

## Not yet (planned, in order)

1. HTTPS through a reverse proxy in the compose stack.

Accounts record a provider (`local` today) so Google or Microsoft sign-in can be added later.
