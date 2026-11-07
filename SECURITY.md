# Reporting a security problem

Please do not open a public issue for a security problem.

Report it privately through GitHub: on the repository page, open **Security > Report a
vulnerability**. Only the maintainers can see the report. Include what you found, how to reproduce
it, and which version or commit you tested.

You should get a first answer within 7 days. Once a fix is released, the advisory is published with
credit to you unless you ask otherwise.

## What counts

- Anything that lets someone read or change data, keys or settings without signing in, or as the
  wrong account
- Ways around the host-name check, the cross-site request check or the CSRF token
- Saved keys leaking into logs, backups, exports or the audit log
- Code execution through an uploaded file, a feed reply or an AI model answer

A data source returning a wrong figure is a bug, not a security problem: open a normal issue.

## Supported versions

Only the latest release and `main` get fixes.

How the app protects accounts, sessions and keys is described in
[docs/SECURITY.md](docs/SECURITY.md).
