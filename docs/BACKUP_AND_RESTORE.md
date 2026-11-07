# Backup and restore

There are two kinds of backup. Use the first for what you made, the second for the whole install.

| | Backup file (Menu > Backup) | Data folder copy |
|---|---|---|
| Holds | saved research (briefs, documents, notebooks, teaching episodes), policy reviews, answer snapshots, watch alerts, holdings, watchlists, countries you added, AI model settings | everything the app saved: the above plus saved feed data, history, pull archive, audit log, data health history, **and your keys** |
| Keys | never; any key, secret or token is removed before the file is written | yes (`data/local/settings.json`) |
| Safe to email or keep in cloud storage | yes | no, keep it private |
| Restore | Menu > Backup > Restore | copy the folder back while the app is stopped |

## Backup file

**Make one:** Menu > Backup > Download. The file is `econquest-backup-<date>.json`.

**Restore it:** Menu > Backup > Restore, pick the file, check the summary it shows, confirm.
Before restoring, the app saves what was there in `data/local/backups/before-restore-<time>.json`,
so a restore can be undone by restoring that file. Keys are never in the file, so on a fresh
install add them again in Menu > Settings. AI keys already on the computer you restore onto are
kept.

A restore is only accepted from the computer running the app (under Docker the compose files
allow it, because the port is published on that computer only).

## Restore drill

Check, on a schedule you choose (monthly is plenty), that your latest backup file really restores:

```sh
npm run backup:drill -- ~/Downloads/econquest-backup-2026-11-06.json
```

The drill starts the real app on an empty, throwaway data folder, restores the file through the
same route as Menu > Backup > Restore, downloads a new backup from that fresh install and checks:

- everything in the file came back (research, alerts, reviews, snapshots, workspace items);
- no key, secret or token is in the file or anywhere the restore wrote;
- no settings file (where keys live) was created.

It ends with `PASS` or `FAIL` and the reason. Your own data folder is never touched. CI runs the
same drill on every change (`tests/backupDrill.test.ts`).

On the home server (`deploy/home-server`):

```sh
docker compose cp ~/econquest-backup-2026-11-06.json econquest:/tmp/backup.json
docker compose exec econquest npm run backup:drill -- /tmp/backup.json
```

## Data folder copy

Stop the app first so nothing is half written, copy the folder, start again.

On the Mac (app started with `npm run dev`; stop it with Ctrl+C):

```sh
tar -czf ~/econquest-data-$(date +%F).tgz data
```

On the home server:

```sh
cd deploy/home-server
docker compose stop econquest
sudo tar -czf ~/econquest-data-$(date +%F).tgz data
docker compose start econquest
```

To restore, stop the app, move the current `data` folder aside, unpack the copy in its place,
then on the home server make sure the app's user owns it (`sudo chown -R 1000:1000 data`) and
start again.

The copy holds your keys: keep it on a disk you control, not in shared cloud storage.

## Moving from the Mac to the home server

Either way works:

- **Backup file:** Menu > Backup > Download on the Mac, open the app on the server,
  Menu > Backup > Restore, then add your keys in Menu > Settings and run Offline data >
  Download all.
- **Whole folder:** copy the Mac's `data` folder to `deploy/home-server/data` on the server
  (for example with `rsync -a data/ you@homeserver:econquest/deploy/home-server/data/`), then
  `sudo chown -R 1000:1000 data` and `docker compose up -d`. Keys and saved feed data come along.
