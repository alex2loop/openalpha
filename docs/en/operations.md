# Recurring work

Three kinds of work repeat on their own. Know which is which before you ask why something did or did
not run.

| Kind | Who creates it | Where it lives |
|---|---|---|
| **Built-in loops** | The daemon, always | Fixed. One cadence is tunable |
| **Scheduled jobs** | You, with `schedule add` | The database, so they survive restarts |
| **Heartbeats** | A `HEARTBEAT.md` in an agent workspace | A file the daemon scans |

All three run through the normal agent engine with the same budgets, model limits and tools. They
differ on approval: a scheduled job with a channel target can ask you; a heartbeat never can, because
nobody is watching.

---

## Built-in loops

They start when `openalpha start` brings the daemon up and stop when `openalpha stop` takes it down.
Each loop waits, runs, then works out its next wait, so a slow run never overlaps itself. A run with
nothing to do returns at once.

| Job | Cadence | What it does |
| --- | --- | --- |
| `trading.alerts` | 60 s | Sends armed alerts, then arms exit and screener alerts against your book. A held name with no plan gets a levels-only plan. Sending comes first, so an alert armed on a run goes out on the next. |
| `trading.outcomes` | 12 h | Resolves pending suggestions against settled bars and updates the track record. |
| `trading.macro-extract` | 12 h | Reads Vietnam statistics-office reports and matching press into stored macro series, newest unread months first, 24 months back. At most 3 reports and 3 press items per run. A month not yet published costs a request, not a model call. |
| `trading.theme-outcomes` | 12 h | Measures `/themes` stock reads that reached 3, 6 or 12 months against VN-Index. No model call. |
| `trading.briefs` | 60 s | Sends morning briefs that are due. This is a check; the send time is `[trading.briefs] send_time`. |
| `trading.exits` | 60 s | Matches take-profit and stop-loss orders resting at the exchange against your ledger and records fills. An exit the exchange denies for five minutes straight is treated as gone. Runs only for a venue with exchange keys. |
| `trading.intents` | 5 min | Settles orders the book already holds; the rest wait for `/trade reconcile`. Same condition as `trading.exits`. |
| `trading.refresh` | after each market's close, 12 h at most | Refreshes market data for every market you still use and logs what degraded. Then it captures each market's factor board once its session settles and scores earlier boards that reached the end of their window. It also writes the day's portfolio snapshot (value, cash, net deposits). If a holding has no price, the snapshot is skipped and `trading.nav_snapshot_skipped` names the instruments; any other failure logs `trading.nav_snapshot_failed`. No model call. |
| `trading.intraday` | your send times | Sends the intraday report. **Off until `[trading.intraday] send_times` names a time.** |
| retention sweep | 6 h | Deletes rows past `[retention] days` / `inbox_days`, workspace temp files, and log folders of agents you no longer configure. Also runs once at boot. |
| workflow check | 30 s | Fires workflows that have a cron trigger. A failed pass replays its window, so no trigger is lost. |
| heartbeat check | 30 s | Scans each workspace's `HEARTBEAT.md`. |
| schedule check | 30 s | Looks for scheduled jobs that are due. |

### When market data refreshes

`trading.refresh` does not run on a plain timer. It runs at the earliest of:

- shortly after each market's session closes, once the tape is final;
- 60 minutes before each market's open, so briefs and screens read warm data (the earliest brief goes
  at 08:15 for a 09:00 open);
- the configured interval, which is only a ceiling.

A market that never closes, such as crypto, refreshes at the UTC day rollover. Anchors within 60
seconds of each other merge into one run.

At boot the first refresh runs before other parts start. It waits up to 60 seconds, then finishes in
the background with a warning. With no network at boot, the loop waits for it. A provider, storage or
channel failure in that refresh is a warning (`daemon.boot_refresh_failed`) whether it lands inside the
60 seconds or after them, and the daemon boots on; any other error stops the boot.

A run that leaves any data kind `unavailable` (nothing fetched at all) retries after 2, 4, 8 and 16
minutes, never past the next anchor. A fifth failure hands back to the anchor and the ladder starts
over. A run that only fell short (`partial`) waits for the next anchor; the missing names are
repaired on their own cooldown.

Every run logs one `trading.market_data_refreshed` line with how long each market took. A market
that loads several kinds also gives the time of each kind, so a slow refresh points at its own cause.

### What you can tune

One cadence: `[trading.refresh] interval_ms`, defaulting to the 12-hour ceiling above. Retention is
`days` and `inbox_days` under `[retention]`. Everything else is fixed. Keys and defaults:
[Configuration](configuration.md#trading). Each run handles 50 rows, except `trading.macro-extract`
at 3, because each of its items is a model call. Restart the daemon after changing any of these.

### When a run throws

| Failure | Result |
| --- | --- |
| Storage, channel or LLM error, or a budget or rate stop | Logged as `trading.tick_failed` (warn) and retried on the next run. The outside world being unreachable is what the next run is for. |
| Anything else: a validation failure, a broken invariant, a misconfiguration | That loop is quarantined and the rest keep running. It is logged as `trading.loop_quarantined` (error) and you get a notice naming the loop in plain words. The loop restarts after one hour, at most three times; the next failure leaves it stopped until the daemon restarts, and the notice says so. A loop that runs a full day before failing again gets its three restarts back. |
| Cancel | You stopped the daemon. Not a failure. |
| No network (a closed laptop's background wake) | The run is skipped, not failed. `trading.tick_offline` (warn) is logged once per offline stretch, then the network is re-checked every minute. Nothing burns a delivery attempt or trips a source breaker; the overdue run goes once the network is back. |
| Retention sweep fails | Logged as a warning; the next sweep tries again. |

Trading loops start after channel delivery is attached, so an alert on the first run has somewhere to
go.

---

## Scheduled jobs

The scheduler checks for due jobs every 30 seconds, starts at most 5 per check and runs at most 50 at
once. `[schedule]` holds `approval_timeout_ms` and `failure_target`; defaults and meaning are in
[Configuration](configuration.md#schedule).

### Managing them

```bash
openalpha schedule add morning-brief \
  --prompt "Prepare the morning market brief" \
  --cron "0 9 * * 1-5" --tz Asia/Ho_Chi_Minh --to telegram:-1001234567

openalpha schedule add scanner --agent chat \
  --prompt "Scan news for macro risk" --every 2h --allow-tools research

openalpha schedule list | show <id> | pause <id> | resume <id> | run-now <id> | remove <id>
```

`--agent` defaults to `chat`. Use `--every 30m` instead of `--cron` for an interval. `schedule edit`
can replace the prompt, schedule, timezone or target; to change the agent, remove the job and add it
again.

`--allow-tools` restricts the job to the tools on *both* lists: the agent's allowed tools and the
job's. `schedule show` prints the effective set with `(restricted)` or `(all)`.

Cron takes five fields with wildcards, ranges, steps (`*/15`, `1-5/2`) and comma lists. When both
day-of-month and weekday are restricted, **either** match is enough; a day field that starts with `*`
(such as `*/2`) counts as unrestricted, so it must match along with the other. Cron uses an IANA
timezone (`--tz`, defaulting to the configured one); intervals do not.

Across a daylight-saving change, a job pinned to a clock time (no `*` in the minute or hour field)
runs once in an hour the clock repeats, and in an hour it skips runs at the first minute that exists
afterwards. A job with `*` in either field simply follows the clock.

### How a run behaves

- A job never runs twice at once, and never twice for the same scheduled moment.
- `run-now` records a run but does not move the schedule or touch the failure count. It is refused
  while a scheduled run of the same job is still live, from the CLI as much as from the daemon.
- A run that died without finishing (the daemon was killed, say) is closed out as failed and the
  schedule moves on rather than re-running it. A one-time job has no next run, so a lost run counts as
  a failure: it comes due again after the retry delay below, and is disabled with a notice on the
  third.

### Retries and delivery

A successful cron or interval job schedules its next run from the moment it finished; a one-time job
disables itself. A failed run retries with a doubling delay, `60 s x 2^(failures - 1)` capped at 30
minutes: one minute after the first failure, two after the second, then **disabled on the third
consecutive failure**. A success resets the count.

Shutdown never counts toward auto-disable. A one-time job cut short by shutdown stays due and runs on
the next start. A denied or timed-out approval still ends it, because running it again would only
repeat the question. After a restart, runs that were still marked running become failed with a
daemon-restart reason.

Delivery happens after the paid run finishes, so a failed notification never turns the run into a
failure and never triggers a second paid run. A job without `--to` uses the default target if there is
one; otherwise its output is dropped with a warning. Auto-disable notices go to `failure_target`, not
to the job's own (possibly broken) destination.

### Approvals

A job with a channel target can ask that channel and waits up to `approval_timeout_ms`. A job without
one has no approver, so tools that need approval are simply unavailable. A denial ends that run
without retrying the denied action. Decisions apply to that job only and are never reused as chat
session state.

### Failure behavior

| Condition | Result |
| --- | --- |
| More jobs due than capacity allows | The rest stay due for the next check |
| Agent run fails | Recorded; the retry policy applies |
| Delivery fails after a successful run | The run stays successful; the delivery error is recorded |
| Third consecutive failure | Job disabled; optional notice sent |
| A run is still live | This check skips it; the schedule is untouched |
| A run's executor is gone | Closed out as failed; the schedule moves on |
| Daemon stops | New work stops, active jobs are aborted, shutdown waits up to five seconds |

---

## Heartbeats

A heartbeat is recurring work that belongs to an agent's workspace, not to a schedule. The daemon
scans each agent's `HEARTBEAT.md` every 30 seconds and runs the tasks that are due. Up to three agents
run at once; one agent's tasks run in sequence. A task never overlaps itself.

An agent on a social network also gets one task per membership, named `social:<network>`, added by
the runtime rather than written in the file. It runs even without a `HEARTBEAT.md`, never sees the
file's shared context, and has its own interval and active hours. See
[social networks](social.md#what-happens-on-a-visit). A paused agent's tasks are skipped, not counted
as failures, and so is a run cut short by shutdown: the task stays due and runs on the next start.

### The file

Everything above `tasks:` is shared context added to every task's prompt. A file with no `tasks:`
marker becomes one hourly task that uses the whole file as its prompt.

```yaml
Review this context before each task.

tasks:
  - name: market-news
    interval: 1h
    prompt: Check for material market news.
    deliver: telegram:123
    session: isolated
    duplicate_window: 24h
```

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Unique in the file, at most 128 characters |
| `interval` | yes | At least `60s` |
| `prompt` | yes | The instruction |
| `deliver` | no | Comma-separated `channel:chatId` targets |
| `session` | no | `shared` (default) continues one conversation; `isolated` starts fresh each run |
| `duplicate_window` | no | Suppress repeat notifications within this window, `1m` to `30d` |

A file is capped at 65,536 bytes and 20 tasks. A `session` or `duplicate_window` line with an empty
or invalid value **drops the task** rather than silently using a default.

### What a run can do

At the end of each run the agent either stays silent or sends you a summary. It can also ask to
revisit something on the task's own next due run (a commitment). Up to 5 commitments per run, each up
to 500 characters, due between one minute and thirty days out. A malformed reply sends nothing and
creates no commitments, but the run still counts as done, so a model that keeps answering badly does
not retry every 30 seconds. Commitment text comes back to the agent as untrusted context: it cannot
override the task or its rules. The reply format and storage rules are in
[Internals](dev/operations.md#the-response-protocol).

### Duplicate suppression

`duplicate_window` stops a notification that repeats the same text to the same target within the
window. It is best-effort and lives in memory only, in a bounded list of 200 entries, so a restart or
a full list forgets old entries and a duplicate may come back. A rejected notification is never
remembered, so the next eligible run retries it.

### Backoff

A run that never finishes (aborted, errored or halted) delays the task's next run by
`60 s x 2^(failures - 1)`, capped at 30 minutes - the same delay jobs use. A finished run clears it.
The same delay applies to a finished run whose result could not be saved (a storage error), and to a
run that throws: neither is allowed to repeat every 30 seconds.
A task that is backing off is simply not picked: it is never disabled, and nothing is delivered
while it waits.

### Failure behavior

| Condition | Result |
| --- | --- |
| File unreadable or over the size cap | No run |
| Task malformed or not due | Dropped or skipped |
| Engine abort or error | No notification; the failure count goes up and the next run is delayed |
| Result could not be saved | The run counts as failed: the failure count goes up and the next run is delayed |
| Invalid reply | Counted as done; nothing is sent |
| Invalid delivery target | Warning; other targets continue |
| Notifier rejects a target | Warning; that notification is not remembered |
| Commitment cap reached | Existing ones kept; the counts are logged |

## When the log file cannot be written

A full or failing disk does not silence the daemon for good. After five writes in a row fail, file
logging pauses for 30 seconds (one line on stderr says so) and then tries a fresh segment; when a
write lands again another line on stderr says it recovered. Records that arrive during the pause are
dropped, and a `fatal` crash line goes to the terminal instead.

## Run the API on a server

Run the daemon on a server you own and point a client app at it.

1. **Install.** On Linux or macOS, run the install script from the
   [README](../../README.en.md#getting-started-step-by-step) with `OPENALPHA_NO_ONBOARD=1` set. The
   command it installs is the path `command -v openalpha` prints (by default
   `~/.local/bin/openalpha`); the unit below must use it.
2. **Configure.** `openalpha setup write <provider> <model>` writes `~/.openalpha/config.toml` with
   `[api] enabled = true` and one model (`openalpha setup catalog` lists the providers). Or download
   [config.sample.toml](https://raw.githubusercontent.com/alex2loop/openalpha/main/config.sample.toml)
   there and set `[api] enabled = true` and your model chain yourself. Each model names the
   environment variable that holds its key (`api_key_env`); set it on the server.
3. **Keep it running.** A systemd user unit, with the keys in `~/.openalpha/env` (one `NAME=value`
   per line, mode 0600):

   ```ini
   [Unit]
   Description=OpenAlpha
   After=network-online.target

   [Service]
   ExecStart=%h/.local/bin/openalpha start
   EnvironmentFile=%h/.openalpha/env
   Restart=on-failure

   [Install]
   WantedBy=default.target
   ```

   Run `systemctl --user enable --now openalpha`, then `loginctl enable-linger $USER` so it outlives
   your login.
4. **Copy the token.** `openalpha api token` prints it (created on the first start).
5. **Reach it.** The API listens on the server's `127.0.0.1` only. Pick one:
   - **SSH tunnel**, no domain needed: `ssh -N -L 18765:127.0.0.1:8765 user@server`, then use
     `http://127.0.0.1:18765` as the address. A local port other than 8765 keeps it clear of a daemon
     on your own machine.
   - **HTTPS through Caddy** on the server: `alpha.example.com { reverse_proxy 127.0.0.1:8765 }`, then
     use `https://alpha.example.com`. Every request then reaches the daemon from `127.0.0.1`, so five
     wrong tokens lock out every client that sends a wrong one for 30 seconds, doubling up to an
     hour. A request with the right token is never refused by the lockout and clears it.
6. **Connect the client.** Give it the address and the token; every request carries the token as
   `Authorization: Bearer <token>`. At most 8 app streams (`/v1/ws`) are open at once; a ninth
   handshake is refused with 503 `too_many_streams`.

When the daemon stops, the API stops accepting connections and requests first, before the runs drain;
requests already running finish. A chat or command sent on an open stream is answered with an
`unavailable` error, a run already going settles in the drain window, and the streams close after it.

Internals: [dev/operations.md](dev/operations.md).

See also [safety and approvals](safety.md), [budgets](budgets.md), [trading](trading.md), and the
[`config.toml`](configuration.md) and [command](commands.md) references.
