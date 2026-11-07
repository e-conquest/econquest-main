# Risk and compliance controls

What the app does today to make its answers traceable and its signals honest, what each control
can and cannot show, and what a multi-user (server) version would need. Written 2026-11-05,
following the change control and model risk policy of the Python econquest program, kept light:
every control here runs by itself in the app, with no forms to fill in.

## Controls in the app now

| Control | Where | What it shows | What it cannot show |
|---|---|---|---|
| Audit log | Menu > Audit log; `data/local/audit/audit-log.jsonl` | Every council answer (question, AI model, each figure with source and period, what was missing), every save, delete, download, settings, key, AI model, backtest and sign-off step. Each line is chained to the one before by SHA-256, and the window checks the chain when it opens. | Someone with access to the file who rewrites the whole chain. Keep the latest hash or an export elsewhere; a keyed seal is the next step (below). |
| Model and signal register | Menu > Models & validation; badges beside each panel | Every rule that turns figures into a call, with its rule, inputs, limits and status: Not validated, Descriptive, Model-assisted, or a backtest verdict. | Whether a rule is right, only whether it has passed a test fixed in advance. |
| Pre-registered backtests | `docs/validation/preregistered/` (hashes in `manifest.json`); Run backtests or `npm run backtest` | A verdict (passed, failed, too few cases) against a pass mark fixed before the run: enough cases, a lift over the base rate, a p-value. A changed test file is refused until it is registered again. | Out-of-sample performance after the run date; the leading indicator is today's vintage. |
| Report sign-off | Saved research | Draft, Reviewed, Approved with names, times and the content hash; "Changed after sign-off" when the report moves; approved reports cannot be deleted. | Who a name belongs to: there are no accounts, so a name is what was typed. |
| Number and stance checks | Council chat | A summary sentence whose number is not in an agent's figures, or that describes an agent's call in an opposing word, is removed and shown. | Wording and emphasis, which stay the model's. |
| No sample figures | Everywhere | A figure without a live or official source reads Missing with the reason. | — |

## Single user: what "self-approved" means

The app runs for one person on one computer (it answers on localhost only). The same person can
review and approve a report; the approval then says "self-approved, no second reviewer". This is
the same position as the Python program's EXC-002: the control is recorded honestly rather than
pretended. Nothing in the app treats a self-approved report as independently reviewed.

## What a multi-user server version would need

Status 2026-11-06: items 1 and 2 are built as local accounts and Viewer / Analyst / Admin roles
(the Approver duties sit with Admin for now); see [SECURITY.md](./SECURITY.md).

Only worth building once a second person uses the app. In order:

1. **Accounts.** Sign-in (an identity provider such as Google Workspace or Microsoft Entra, or
   passkeys) so a name on a sign-off or in the audit log is a verified person, not typed text.
2. **Three roles.**
   - *Viewer*: reads Research, Reports and approved notes; cannot ask the council or change settings.
   - *Analyst*: asks the council, saves research, marks reports reviewed, runs backtests.
   - *Approver*: approves reports and changes data keys, AI model settings and the register.
   Separation of duties: an approver cannot approve a report they reviewed; the server refuses it
   instead of labelling it self-approved.
3. **Server-side keys.** Data and AI keys held by the server, never sent to browsers; per-user
   settings kept apart from shared ones.
4. **Log seal and copy.** Each audit entry signed with a server key (HMAC) and the log copied, as it
   is written, to storage the app cannot rewrite (an append-only bucket with object lock). This
   closes the "whole chain rewritten" gap above. The Python program left the same decision open
   ("keyed ledger seals").
5. **Change control for the register and tests.** A new test version or a register status change
   goes through a pull request with a second approver, so "registered before it ran" is proven by
   someone other than its author.
6. **Licensed data.** Paid feeds (CDS, EMBI, ratings, consensus) stay behind each user's own
   account switch; a shared server needs a licence that covers every user.

## Files

- `src/utils/auditLog.ts`, `src/utils/auditStore.ts`: the log, chain and check.
- `src/data/modelRegister.ts`: the register.
- `src/utils/backtest.ts`, `src/utils/backtestRun.ts`, `docs/validation/preregistered/`: the tests.
- `src/utils/signoff.ts`: sign-off.
