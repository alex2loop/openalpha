---
name: recover
description: Restores a usable state after an interrupted, failed, or half-applied operation. Use when a command failed midway, a run was cut off, or the book looks inconsistent.
metadata:
  version: "1.0.0"
---

# Recover

Use after an aborted run, a failed delivery, a rejected ledger write, or any point where the operator asks "did that actually happen?".

## Establish what is true before doing anything

The ledger is the only record of truth, and positions are derived from it by fold - there is no stored balance to disagree with it. Read state before writing:

1. `portfolio_history` for the last recorded entries, each carrying the id that `portfolio_update` and `portfolio_remove` address. A transaction that is not there did not happen.
2. `portfolio_view` for the derived position, which is recomputed from those events every time.
3. `alert_manage` with `list` and `brief_manage` with `list` for scheduled work.

## The rules that make recovery safe

- **Ledger writes are idempotent by key.** A record retried under the same run and call identity returns the original receipt rather than appending a duplicate. Retrying a call you are unsure about is safe; re-typing it as a new call is not.
- **Rows are edited and deleted in place.** `portfolio_update` fixes a wrong value on the row itself and `portfolio_remove` takes a row out; neither leaves a superseded copy behind. The book is the fold over the rows as they stand now, so a fix re-bases every reading taken from it, past suggestions included - and every write validates the whole book as it will stand afterwards, because an edit can invalidate a row it never touched.
- **Delivery may duplicate, never silently vanish.** An alert or brief that crashed after sending may arrive twice; each carries a stable id, so a duplicate is identifiable rather than a second event.
- **Suggestions are day-scoped and versioned.** Re-running the same instrument on the same day reuses the existing result instead of creating an economic duplicate.

## Common situations

| Situation | Action |
| --- | --- |
| Transaction may not have saved | Read history first. If absent, record it again; if present, stop. |
| Wrong amount, price, or day recorded | `portfolio_update` on that entry's id from the history. Never a second record plus a mental note. |
| The same transaction recorded twice | `portfolio_remove` on the duplicate's id. Bookkeeping only: it reverses nothing at a broker. |
| Alert stopped firing | List alerts; a fired alert is terminal by design and is not a fault. |
| Brief did not arrive | Read the delivery state with `brief_manage`. A skipped day is not a failure: delivery reschedules when the session was not pre-open, or when the previous session produced no bar. Repeated send failures disable delivery - re-enable it rather than waiting. |
| Run aborted mid-suggestion | Nothing partial persists. Re-run it. |

## Output

State what the records show, what you changed, and what remains unresolved. Never assert that a write succeeded without having read it back.
