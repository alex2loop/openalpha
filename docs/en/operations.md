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
| `trading.macro-extract` | 12 h | Reads Vietnam statistics-office reports and matching press into stored macro series, newest unread months first, 24 months back. At most 3 reports and 3 press items per run. A month not yet published costs a request, not a model call. A document the model cannot read is marked read with nothing kept, so it is not paid for again. |
| `trading.theme-outcomes` | 12 h | Measures `/themes` stock reads that reached 3, 6 or 12 months against VN-Index. No model call. |
| `trading.briefs` | 60 s | Sends morning briefs that are due. This is a check; the send time is `[trading.briefs] send_time`. |
| `trading.exits` | 60 s | Matches take-profit and stop-loss orders resting at the exchange against your ledger and records fills. An exit the exchange denies for five minutes straight is treated as gone. Runs only for a venue with exchange keys. |
| `trading.intents` | 5 min | Settles orders the book already holds; the rest wait for `/trade reconcile`. Same condition as `trading.exits`. |
| `trading.refresh` | after each market's close, 12 h at most | Refreshes market data for every market you still use and logs what degraded. Then it captures each market's factor board once its session settles and scores earlier boards that reached the end of their window. It also writes the day's portfolio snapshot (value, cash, net deposits). If a holding has no price, the snapshot is skipped and `trading.nav_snapshot_skipped` names the instruments; any other failure logs `trading.nav_snapshot_failed`. No model call. |
| `trading.intraday` | your send times | Sends the intraday report. **Off until `[trading.intraday] send_times` names a time.** |
| retention sweep | 6 h | Deletes rows past `[retention] days` / `history_days` / `inbox_days`, workspace temp files, old caches in each agent's shell home (`run/.cache`, `run/.npm`, `run/.bun/install/cache`, `run/.local/share/Trash`; `doctor` warns when an agent's `run/` passes 2 GB), and log folders of agents you no longer configure. Takes the daily SQLite backup into `backups/daily/` when the newest is about a day old (`daily_backups`; PostgreSQL skipped). Also runs once at boot. |
| workflow check | 30 s | Fires workflows that have a cron trigger. A failed pass replays its window, so no trigger is lost. |
| heartbeat check | 30 s | Scans each workspace's `HEARTBEAT.md`. |
| schedule check | 30 s | Looks for scheduled jobs that are due. |

With the API on, the app lists these loops, and any a plugin adds, as one board of what the daemon is doing in the
background: its name in plain words, how often it runs where it keeps a fixed pace, when its last pass began, the
last error if that pass failed (the next good pass clears it), when it runs next and whether it is working now. The
morning brief and the intraday report show when they are next due. The board lives in memory, so after a restart
each loop shows nothing until its next pass.

### When market data refreshes

`trading.refresh` does not run on a plain timer. It runs at the earliest of:

- shortly after each market's session closes, once the day's trading data is final;
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
`days`, `history_days` and `inbox_days` under `[retention]`. Everything else is fixed. Keys and defaults:
[Configuration](configuration.md#trading). Each run handles 50 rows, except `trading.macro-extract`
at 3, because each of its items is a model call. Restart the daemon after changing any of these.

### When a run throws

| Failure | Result |
| --- | --- |
| Storage, channel or LLM error, or a budget or rate stop | Logged as `trading.tick_failed` (warn) and retried on the next run. The outside world being unreachable is what the next run is for. |
| A model key not set yet | Logged once as `trading.tick_key_missing` (warn), again only after something else was logged, and retried on the next run. |
| Anything else: a validation failure, a broken invariant, a misconfiguration | That loop is quarantined and the rest keep running. It is logged as `trading.loop_quarantined` (error) and you get a notice naming the loop in plain words. The loop restarts after one hour, at most three times; the next failure leaves it stopped until the daemon restarts, and the notice says so. A loop that runs a full day before failing again gets its three restarts back. |
| Cancel | You stopped the daemon. Not a failure. |
| No network (a closed laptop's background wake) | The run is skipped, not failed. `trading.tick_offline` (warn) is logged once per offline stretch, then the network is re-checked every minute. Nothing burns a delivery attempt or trips a source breaker; the overdue run goes once the network is back. |
| Retention sweep fails | Logged as a warning; the next sweep tries again. |

Trading loops start after channel delivery is attached, so an alert on the first run has somewhere to
go.

### When a key is missing

`openalpha start` still starts without an AI key, a web search key, an MCP server's variable, the API
token or a channel's bot token, and prints one warning per item (see
[Commands](commands.md#daemon-and-diagnostics)). Data refresh, price alerts, the ledger and every loop
that needs no model keep running. Work that needs the model waits: the macro-figure loop logs
`trading.tick_key_missing` (warn) once and keeps trying each run; the morning brief still sends the
sections that need no model, and on a day it cannot build you get one message naming the variable and
how to set it; a scheduled job that needs the model skips that run without counting it as a failure,
so it is never switched off for a missing key. `status` lists what is waiting for a key. Save the key with
`openalpha key set <NAME>` and `restart --background`, and everything runs again.

### When the daemon stops, or misses a brief

A daemon that dies without stopping cleanly (a crash, a `kill -9`, a power cut) leaves its pid file behind,
and `status` then prints `daemon: stopped unexpectedly (started <time>)` with a pointer to `openalpha logs`
instead of the plain "not running". The next start also messages your chat once, saying alerts and the brief
were paused until now. If the brief could not go out before the open (the daemon was down, or every try
failed), the day's brief is skipped and the chat gets one line saying so; the next one stays on schedule. A brief whose build starts before the open but finishes after it is still sent, with a line first
saying prices have moved since it was written.

A chat channel that stays down is reported too. Every five minutes the daemon looks at each channel, and one
that has been down (or connected-but-failing) for 15 minutes is announced once, on another channel that is up,
with the reason: a refused bot token, an expired Zalo login, the account open somewhere else, or a connection
that keeps dropping. When it is back, you get one "is back" line. `status` lists the channel as `down: <reason>`
while it is. With no other channel to tell, it is logged only (`channel.watch_no_route`). A restart forgets it,
so a channel still down afterwards is announced once more.

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

A job can wait for an alert instead of a time; call it an event job. The office page creates these: the job runs when a held
name breaks its stop or reaches its take-profit, when a name moves sharply in the session, or when a
price you set is hit. It runs at most once per cooldown, a pause the job carries so a noisy name cannot run it again and again, and it
stays on after a run, except a price job, which its one crossing spends. `schedule list` shows it as `when FPT hit the
price you set` where other jobs show a time, `schedule edit` cannot give it a time, and `schedule
remove` also removes the price alert it armed, and `schedule resume` refuses a price job whose alert has already fired. A failed run of an event job is not counted toward switching it off, so one that keeps failing stays on and sends a failure notice at each crossing, at most once per cooldown.

Cron takes five fields with wildcards, ranges, steps (`*/15`, `1-5/2`) and comma lists. When both
day-of-month and weekday are restricted, **either** match is enough; a day field that starts with `*`
(such as `*/2`) counts as unrestricted, so it must match along with the other. Cron uses an IANA
timezone (`--tz`, defaulting to the configured one); intervals do not.

Across a daylight-saving change, a job pinned to a clock time (no `*` in the minute or hour field)
runs once in an hour the clock repeats, and in an hour it skips runs at the first minute that exists
afterwards. A job with `*` in either field simply follows the clock.

### How a run behaves

- A job never runs twice at once, and never twice for the same scheduled moment.
- `run-now` records a run but does not move the schedule or touch the failure count. The one exception is a one-time job: a successful `run-now` is its run, so the job is then done and disabled. It is refused
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

A missing key does not count either: a run that fails because an AI key variable is unset is
skipped with one warning in the log, and the job stays on and runs at its next time, so setting the
key and restarting is enough, with no `schedule resume`. The morning brief works the same way: that
day you get a message naming the variable and how to set it, instead of "didn't get through after
several tries".

A spent budget does not count either. When the daily or monthly cap, or an agent's own cap, stops a
run, the job skips to its next time, and a one-time job is asked again in 30 minutes. A run stopped
by the rate limit is asked again in 30 minutes too. So a busy day never switches a job off for good.

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

## Start at login

On a desktop, `openalpha autostart enable` registers `start --background` to run at every login, so the
morning brief and alerts keep coming after a restart: a launchd agent on macOS, a systemd user unit on
Linux (on a server with nobody logged in, also run `loginctl enable-linger $USER`) and a Run-key entry on
Windows. `openalpha autostart` shows whether it is on, and `autostart disable` removes it (a daemon running
now keeps running). It needs the installed binary, not a source checkout, and takes effect from the next
login. A login launch does not see variables exported only in your shell, so save keys with
`openalpha key set`; `enable` names every key your setup reads that is set only in the shell, a data source key such as `FRED_API_KEY` included. The unit it writes is `openalpha-autostart`, apart from
the hand-written service below, which stays the way to run an API server.

## Run the API on a server

Run the daemon on a server you own and point a client app at it.

1. **Install.** On Linux or macOS, run the install script from the
   [README](../../README.en.md#quick-start) with `OPENALPHA_NO_ONBOARD=1` set. The
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
   # Optional: the daemon also reads keys saved with `openalpha key set` from ~/.openalpha/env.
   EnvironmentFile=-%h/.openalpha/env
   Restart=on-failure

   [Install]
   WantedBy=default.target
   ```

   Run `systemctl --user enable --now openalpha`, then `loginctl enable-linger $USER` so it outlives
   your login. To upgrade, run `systemctl --user stop openalpha; openalpha upgrade; systemctl --user start openalpha`:
   a daemon the service owns is never restarted by `upgrade` itself.
4. **Open the office page.** Run `openalpha web` on the server (the daemon must be running). On the
   server's own screen it opens the browser. Over SSH it prints two things instead: a tunnel command
   to run on your own machine, such as
   `ssh -N -o ExitOnForwardFailure=yes -L 18765:127.0.0.1:8765 user@server`, and a link
   (`http://127.0.0.1:18765/#code=...`) to open once the tunnel is up. The tunnel's local port is the
   server's port plus 10000 (minus, past port 55535), so it stays clear of a daemon on your own machine, and `ssh` stops with
   an error if that port is taken. The link works once and for 5 minutes; run `openalpha web` again
   for a new one. For the desktop app, run `openalpha connect`: it prints the
   address and the token on two separate lines. Give the app that address and token, never a browser,
   and keep the token private.
5. **Reach it from outside.** The API listens on the server's `127.0.0.1` only, so the SSH tunnel
   above needs nothing more. To reach it without a tunnel, pick one in this order:
   - **SSH**, no domain needed: nothing to set up. `openalpha web` prints the tunnel.
   - **Tailscale**: `tailscale serve --bg 8765` on the server, then set `[api] public_url` to the
     `https://<machine>.<tailnet>.ts.net` address it shows and restart the daemon.
   - **Caddy** with a domain: `alpha.example.com { reverse_proxy 127.0.0.1:8765 }`, then set
     `[api] public_url = "https://alpha.example.com"` and restart the daemon.

   Anything in front of the daemon (a proxy, a tunnel, a domain) needs `public_url`: it is what turns on
   the exposure limits below and the `__Host-` sign-in cookie. Without it the daemon only catches a proxy
   that sends `X-Forwarded-For` or `Forwarded`, or a `Host` that is not a local name, and refuses those
   with a line naming `public_url`. A proxy that passes neither looks local. A bare nginx `proxy_pass`
   is one: it sends `Host: 127.0.0.1:<port>` and no forwarded header. So set `public_url` before you
   expose the daemon, and have nginx send `proxy_set_header Host $host;` and
   `proxy_set_header X-Forwarded-For $remote_addr;`. The daemon otherwise answers only a request
   addressed to `127.0.0.1`, `localhost` or `[::1]` (any port, so a tunnel works as is), which stops a
   DNS-rebinding page. With `public_url` set, `openalpha web` prints the `https://` link instead of a
   tunnel. Every request through a proxy reaches the daemon from `127.0.0.1`, so five wrong tokens or
   sign-in codes pause sign-ins for everyone for 30 seconds, doubling up to an hour. A right token or
   code is never refused by that pause and clears it.
6. **Connect the client.** Give the app the address and the token; every request carries the token
   as `Authorization: Bearer <token>`. At most 8 app streams (`/v1/ws`) are open at once; a ninth
   handshake is refused with 503 `too_many_streams`.

**What `public_url` changes.** Once the daemon is reachable from outside, the app is trusted with
less, so setting `public_url` also:

- turns orders off: the API's order routes and `/trade` from the app are refused (halting buys from
  the app goes with them) until you set `[api] orders = true`. Telegram and the CLI still halt;
- keeps shell commands, file writes, tools from MCP servers or plugins, and the social network tools,
  out of chats from the app and the page;
- lets the app make jobs that answer only in the app; a job for another chat is made on the server
  (`openalpha schedule add ... --to`);
- makes pairing approval and each channel's access keys server-only: approve with
  `openalpha pair approve <code>` and change `allowed_ids` and the like in the config file.

Exchange keys deserve the same care: make them trading-only, never allow withdrawals, and pin them to
the server's IP address on the exchange, so a leaked key cannot move money out.

**Upgrading.** If you ran Caddy with `header_up Host`, remove that line and set `public_url`: the
proxy now passes the public name as it does by default. Everyone then runs `openalpha api rotate`
once and restarts the daemon, so a token an older page saved in a browser stops working. After the
restart, `openalpha web` signs each browser in again.

Once connected, the office page is shown what the daemon is doing as it happens: each answer and long command that is
running with its latest step, every approval and question still waiting on any channel, a fill (a resting
stop or take-profit selling, or a `/trade` fill), each tool a run starts and finishes, what each debate role said once a `/suggest` is verified (shown on the office page only, never sent to a chat), a new agent joining, the moment a spend cap is reached, and when the alerts were last checked. These go to the bell and to no chat unless `[notices] chat` lists them: a call scored, news on a name you hold, and the index falling hard in a session. News on a holding covers only names the daemon has already read, since nothing fetches it for your holdings on a schedule. A page that
connects late asks for the picture as it stands, then follows the stream. A request asked on Telegram or another
channel appears on the office page but is answered where it was asked; the office page says so instead of answering it. The office page can stop any run you see, including one started on Telegram: stopping only tells it to stop, and it ends as stopped, whether it was an answer in progress or a command. A run that has already finished answers that it is gone. The office page also lists the chats paired on each channel and can unpair one, which does what `pair revoke` does: that chat is asked for a pairing code again on its next message.

The office page also reads what the daemon knows without a command: the history of every chat, Telegram's included, which it can search but only continue for chats it started itself; each data source and when it last answered; the hosts the daemon can reach and what is sent to each; the models in use with their prices and what a run on each usually costs; sector strength by market; and your watchlist, which it can edit.

When the daemon stops, the API stops accepting connections and requests first, before the runs drain;
requests already running finish. A chat or command sent on an open stream is answered with an
`unavailable` error, a run already going settles in the drain window, and the streams close after it.

The office page can also restart a daemon that was started with `--background`: choose to restart once nothing is working (it waits a couple of minutes at most, then restarts anyway) or right now. The daemon stops the usual way, so an approval still waiting is refused and a run that cannot finish within the grace it gets while stopping is cut off, and the office page warns about the approvals first. When the daemon is back, the bell shows "The daemon restarted." and nothing goes to a chat. If an accepted restart fails, the daemon keeps running as before and the bell says so, pointing to the restart log in the data folder. A daemon running in a terminal or under a service cannot be restarted from the office page: stop it with Ctrl+C or the service manager and start it again. A restart or update already under way, or a daemon that is shutting down, refuses another request.

### Commands run in the daemon

When a daemon is running with the API on, the commands that read or change its state run inside it,
instead of starting a second copy of the app beside it. That covers `chat`, `status`, `cost`,
`history`, `agent`, `memory`, `skill`, `plugin`, `workflow`, `social`, `schedule`, `pair`
(`approve`, `deny`, `list`, `revoke`), `db integrity` and `db stats`, and any command a plugin adds.
One place does the work, so a chat you start in the terminal shows on the office page like any other
run, on the `cli` channel. You see no difference at the prompt: same output, same questions, your own
editor, Ctrl+C, and the same exit codes.

These stay in your terminal: `help`, `version`, `upgrade`, `doctor`, `onboard`, `start`, `stop`,
`restart`, `autostart`, `provider`, `config`, `key`, `auth`, `zalo`, `logs`, `setup`, `connect`, `web`,
`api`, `mcp`, and every command that needs the daemon stopped (`schedule edit` is one). So do the
commands that read or write a file you name: `db backup --path`, `db export --out`, `plugin install`
and `skill install`. A relative path would otherwise resolve in the daemon's folder, and a daemon
started at login often cannot write to your Desktop, Documents or Downloads.

A command runs in your terminal instead when:

- you pass `--local`, to skip the daemon for a wedged one or to debug. Passing `--log-level` does the
  same, since it asks about this process;
- no live daemon owns this data folder, or it loaded a different config file;
- `[api] enabled` is `false`, the daemon reports the API as degraded, the token cannot be read or does
  not match the daemon's, or the daemon does not answer within a second;
- the daemon runs a different version from the CLI. This is the only case that says anything: one
  line names both versions and tells you to run `openalpha restart --background`.

A forwarded command runs with the config, the key file and the environment the daemon read when it
started, the same as a chat from the page or Telegram. After you edit `config.toml`, add a key to the
key file or export a provider key in this shell, run `openalpha restart --background` for it to
take effect. Your terminal's environment travels only for colors, width and your editor.

Ctrl+C once interrupts the command as it does in the terminal. A second Ctrl+C before it answers
closes the connection, the daemon stops everything the command started, and the CLI exits `130`.

If the daemon stops while a command is running (a restart, a crash, or it stops answering for about
five minutes), or does not take the command within a few seconds of the connection opening, the CLI says so and exits `17` (`daemon_lost`). It never runs the command again here, so
nothing happens twice. Check how far it got before you retry: `openalpha history list` for a chat,
then `openalpha chat --continue` to pick it up; for other commands, their own `list`.

The daemon logs each forwarded command's name, exit code and duration, never its arguments, answers
or output.

## The office page

With the API on, the daemon also serves a web page at its own address, `http://127.0.0.1:<port>/` (port 8765 unless you changed it). Think of it as a glass wall into the daemon: a small office where your assistant, the research crew and your own agents work while the daemon works. Everything you see moving is a real run, a real step or a real question waiting for you; nothing is scripted to look busy. The page never places an order and never starts an AI run by itself. A button either opens something or puts text in the command box for you to read and send.

### Opening it

Run `openalpha web` (see [Run the API on a server](#run-the-api-on-a-server)). It prints a one-time link and, on a desktop, opens your browser for you. The page swaps the code in the link for a sign-in on that browser and removes it from the address bar. Without a link, the page shows the command to run instead of asking for a token.

- The link works once and expires after 5 minutes. A used or expired one shows a line asking you to run the command again, and a handful of wrong tries makes the daemon pause sign-ins for a moment.
- A sign-in lasts 30 days from the last time you used it, and each visit renews it. The browser holds only a sign-in cookie that page scripts cannot read; the API token never reaches it.
- Settings > Display, under "This page's connection", lists the browsers signed in, with when each signed in and was last seen, and a button to sign any of them out, this one included. A browser signed out this way is dropped from the page at once.
- `openalpha api rotate` signs every browser out. Restart the daemon afterwards so the old token stops working too, then run `openalpha web` again.
- The page refuses to run inside a frame, and in the released binary it may talk only to the daemon that served it.
- The daemon answers only an address on this machine (`127.0.0.1`, `localhost` or `[::1]`) or your `public_url`, refuses an API call another website starts, and opens the live stream only for the page it served, so another local web app cannot use it.
- Safari before 16.4 does not send the header the daemon relies on, so the page says this browser blocks cookies for the address even though it does not. Update Safari.
- If the daemon cannot be reached, the page says so in one plain line. If the connection drops while you are signed in, a bar shows the retry countdown and a "Retry now" button, and says that runs keep going in the daemon. When the connection returns, the page asks for the picture as it stands and carries on. A page older than the daemon asks you to reload. A block that fails to refresh keeps its last good figures and says when they were read.

### What is on the screen

- **Header.** The running chip (what is running and what is next: stop a run, or run a scheduled job again), the 2D | 3D switch, the Focus button (hides the office and leaves only the information; it is not shown on narrow screens), the AI cost chip, the office clock, the bell, a "?" button that lists the keyboard shortcuts, and Settings.
- **Tape.** Over the office scene, under the floor switch, the benchmark (VN-Index, BTC) of each market you trade and your watchlist scroll past. A name past its stop and a fresh buy call are marked.
- **The office.** The scene on the left, described below.
- **Information panel.** Four tabs. *Today* opens with one line on your home market's day (whether its exchange, such as HOSE, is trading and until when, and when the prices were read), then what needs you (approvals waiting, names past their stop; Open shows them in the bell), then what is worth a look, your book with "See portfolio" (its value, what it holds, names past their stop, and the take-profit orders waiting at the exchange), the Vietnamese and other markets, upcoming events, top headlines, and what the agents did today, including work that ran while the page was closed; the macro and news blocks carry "See the full reading", which opens the Market tab. Anything the daemon started without, such as a missing exchange key, closes the tab. *Portfolio* holds overview, performance, history, rebalance and the watchlist with its price alerts, plus *Orders* where a venue can place orders; every kind of ledger row is recorded, edited and deleted here, with undo, and History checks the ledger against your venues (see [Trading](trading.md#on-the-office-page)). *Market* holds the full macro reading, the last closed session, the news and your themes (below). *Ideas* holds open plans, the opportunities screen, the track record and research results, with a count of new calls you have not seen. Click a ticker anywhere and its card opens: price (with "Refresh price", which reads that one name live), the last sessions charted on price and date axes with the plan levels, your holding, "Why?" for the reasoning behind a call, earlier calls and what your own agents think. Click one of your agents in the office and its tab opens (see [Agents](agents.md#from-the-office-page)). A back row returns to where you were, and the panel collapses to an icon strip.
- **Chat.** The conversation with the assistant, docked on the right. Earlier sessions, Telegram's included, are searchable, grouped into today, the last 7 days and older (by the daemon's day, not your browser's), and load older ones on demand; only chats the page started can be continued; while another channel's chat is open, the box at the bottom says so and offers to continue in a new session. Each row's menu opens the chat in a tab of its own, with nothing but the chat in it, and deletes a chat the page started: the row goes at once and a bar at the bottom offers Undo for a few seconds (the clock pauses while the tab is hidden; closing the tab first deletes nothing). A chat whose answer is still running cannot be deleted, and a Telegram chat is never deleted here. A `/research` answer shows its steps while it runs and numbered sources under the answer (see [Deep research](research.md#on-the-office-page)).
- **Command bar.** At the bottom: who receives what you type, and the box (Enter sends; a phone also shows Send). See [Commands](commands.md#the-command-bar-in-the-office-page).
- **Bell and jobs.** The bell lists notices and the requests waiting for you. An approval asked from this page is answered right in the bell: approve once, remember, or deny. A countdown shows when it times out, and a request that times out unanswered is refused. A request is answered once: if it shows in both the bell and the chat, only one answer is sent, and the other card shows that answer and says it was already answered if you chose differently there. One asked on Telegram or another channel is listed but answered where it was asked. The jobs list shows what is running (stop it, after a confirm), what is coming up, what is waiting for an event (checked on a timer at no AI cost) and the automatic upkeep jobs, with a way to fix one that is failing; "Add a schedule" files a job for the assistant.
- **Cost.** The chip shows today's spend against the daily cap; click for the month, the split by job and the budget row, and "See the full report" for today, the last 7 or 30 days, or this month. See [Budgets](budgets.md#in-the-office-page).
- **Settings.** The gear: investor profile, memory, schedules and watching, agents and AI, messaging channels, providers, exchanges, tools, data and connections, display, and advanced, which holds a raw `config.toml` editor. The editor shows each secret (an MCP server's `env` values, any token, secret, password or API key written in the file) as `********`; leave it as it is and the saved value stays. What decides what the daemon runs, which files it uses or where a key goes changes only from the CLI or in `config.toml` itself: plugins, an MCP server's command, arguments, `env`, address and transport, every `*_env` key and every other field naming an environment variable (`[trading.sources]`, `[trading.venues.<id>] credentials`), `base_url` and `fallback_base_url`, `[paths]`, `[log] file`, `[storage]`, `[api]`, `[update]` and `[trading.orders] allow_unattended`. While `[api] public_url` is set, a channel's `allowed_ids`, `operator_user_ids`, `pairing` and `dm_policy` change only on the server too. Checking or saving a change to one is refused with a line naming each such field; the model picker can still switch provider, which sets that provider's own key variable and drops the old address. Each row says whether saving applies at once or needs a restart; the gear counts the changes waiting for one, and the page can restart a daemon started with `--background` (see above). The keys themselves are set under Providers, Exchanges and Tools (below); the fields that name a key's variable and the `base_url` addresses stay CLI-only, as listed above.

### Settings worth knowing

- **Keys.** Providers, Exchanges and Tools list the keys the daemon reads for models, exchanges, web search and the optional data sources, each marked saved or not set. Change takes the key in a hidden field and saves it on the server in the same file `openalpha key set` writes (`<data dir>/env`, readable only by you); it is never shown again, and the daemon reads it after a restart, which the gear offers. Remove asks once. If the same variable is also set in the server's environment, the row says that one wins. The API token, a channel's bot token and an MCP server's variables are never listed: set those on the server. While `[api] public_url` is set, no key changes here; each row shows its `openalpha key set <NAME>` command to copy instead.
- **Providers.** One card per provider your models use or that has a saved key. "+ Add provider" offers the common ones and the full list; a card no model uses yet has "Add a model", which opens Agents and AI with a new line in the model chain. "Sign in to ChatGPT" uses the subscription you already have: the page shows a code and a link, waits while you sign in on that page, and stops waiting when you press Cancel or after 16 minutes. Sign out asks once. Like keys, signing in is server-only while `public_url` is set.
- **Exchanges.** One block per exchange with its key fields and "This key", which checks the key the daemon started with ("Check again" asks the exchange). A read-only key is enough to check balances and sync the ledger; `/trade` needs trade permission. Never turn on withdrawals.
- **Tools.** The web search provider (it applies after a restart) and the optional data source keys. A search provider that needs a key also needs its variable name in `config.toml`, which only the CLI or the file can set.
- **System health.** Data and connections runs the same checks as `openalpha doctor`, problems first, each with a plain line on how to fix it and a button to the section that fixes it. The first read stays on this machine; "Check again" also asks the outside services, but never calls a model, so the providers row points at Test connection. The checks that only make sense in a terminal (`config`, `daemon`, `trading`) say to run `openalpha doctor` on the server, and the database check here is the light one: the full integrity scan runs only from the terminal. The same section lists the data sources, the outside hosts the daemon calls with what it sends, and Credits for the map data, photos and weather the office draws on.
- **Updates.** When a newer release is out, the gear carries a dot and Settings opens with a line naming the new version. Its notes show what changed (an important release is marked), with the command to run on the server and a copy button; the page never updates itself, and your portfolio, ledger and settings stay as they are. "Later" hides the line until the next version. Display shows the version you run, with "What's new". With `[update] check` off, the page says checks are off.
- **Memory.** What the assistant remembers about you, grouped by agent and by who it was talking to (the CLI and the page share one group). "What you told me" holds the preferences it picked up in chats; the notes are what it saved, or what you added with "+ Remember", each forgotten `[memory] ttl_days` after its last update. Search filters what is listed; Forget hides a row with Undo for a few seconds, then removes it everywhere it is used. Under a chat answer, a line says when a preference was remembered or changed, and "Remember this" under a message you sent (not a slash command) opens the "+ Remember" dialog with it. Keys use plain letters, digits and `_ : . @ / -`, and a note that looks like a secret is refused. Notes are read by the AI, so leave account numbers and amounts out.
- **Level of detail.** Display offers Simple or Advanced (the default). Simple tucks away scores, sources, the macro scale and driver table and the health check details; every warning, price and level stays. It applies at once and is kept in this browser.

### Market, news and themes

The Market tab has three parts. *Market* shows the macro reading in full for the region you pick (the home one first, kept in this browser): the regime and lean, the drivers left out because they have no reading yet, how much of the model has data, and, in Advanced, the scale and a table of what makes the number, strongest pull first. Under it are the region's prices, and the last closed session as `/market` writes it, read when you open it and on Refresh, never on a timer. *News* lists the headlines grouped by day in the daemon's zone, with a filter over what is loaded; when the sources cannot be read it says so instead of showing an empty list. *Themes* (Vietnam only) lists the themes waiting for you, with Follow and Skip, and the ones you follow, with Stop following after a confirm. "Run again" puts `/themes` in the command box with its estimated cost; nothing runs until you send it.

### The office

Two floors, switched in the row above the scene's tape. **Office** holds the built-in crew in their rooms: the data store (the stock keeper refreshing data), the library (the scouts, planner, writer, reviewer and theme analyst doing research), the meeting room (the debate table behind `/suggest`), the lobby (today's agenda and the day's digest), the alert desk (the clerk watching price alerts and stops), the assistant's room and your own desk. **Your agents** is the team floor: one desk per agent of yours, with a card showing whether it is running, paused or idle, its schedule, its latest call and what it has spent today. With no agent yet it offers three starting points and a blank one, and the next free desk carries "+ Add an agent".

How to read it:

- A person moves only when the daemon says so. A run starting sends the right person to the right room; its steps and tools set what they do there; a finished run sends them back. A run the page cannot map to a scene sits at its desk typing, with the run's name; the page never invents steps.
- An amber "!" over a person means they brought you an approval; click it to open the bell. A red "!" over the clerk means a stop has been broken; click it to open that ticker's card.
- Speech bubbles carry real lines: what needs your approval, what a debate role said, a past call a person remembers. A lit screen shows what a scout is reading or the closes the analyst is looking at; click it for a larger view. Anyone else at work, on the team floor too, lights the screen of the computer they sit at and types their own run into it as a terminal: the command, each step done and the step under way, never the room's. Far off the screen shows the same lines as coloured bars; with reduced motion the lines are all there at once. A computer two people share lights only for the one sitting at it. Click a screen to open that run.
- The boards show progress (debate round, research question, prices refreshed so far): the meeting room's and the library's whiteboards write it in marker, only the step's number when far off, and the store's wall monitor fills a bar. The results board counts new calls. Over the alert desk the price board shows the first four names on the tape (from far off, how many rose and fell) and the LED strip carries the unread notices, else the newest one held still. Once you click into a room, a yellow note under the lobby's lower board gives the day's digest; click it for the details. The floor view leaves it out. The lobby's three clocks keep HOSE, NYSE and UTC time and name themselves when you point at them. The store's rack has a light per data source, green while it answers and amber once it fails. After office hours a room with no run in it says it is resting. The printer, shelf, clock and alert desk show a tip when you point at them, with a link to the matching view. A whiteboard with no run counting steps writes the day's last result instead, at any hour: the ticker of the last debate that finished and when, and how many questions the last research answered ("Question 5/5 · done"); far off, only "5" or the ticker's first two letters show. The one-line buttons over those boards, shown once a room is zoomed, say the same, and only a line counting a live run's steps opens that run. A reload keeps them, since they come from the day's activity list.
- Click a lamp to turn a room's light on or off, or the wall switch (or the bulb at the bottom right of the scene) for all of them. By day every lamp follows its own switch, kept in this browser. Once the sun is well below the horizon, and all of a market rest day, a lamp is lit only in a room where its own person is at work (on shift, on a real run, or the rest-day staff) unless you switch it; someone just passing through, or staying late with nothing to do, leaves it dark, and those night switches are forgotten at the next dawn or dusk. By default the office light follows the office clock; Settings > Display turns that off.
- The cat sleeps while nothing needs you and wakes for an approval, a holding past its stop or at its take-profit, an order filled at the exchange, a price alert you set, or the day's AI budget running out. The corgi and the fish are scenery and signal nothing; the corgi only stands and wags for a few seconds when the page opens or a new agent joins.
- Drag to pan and scroll or pinch to zoom. With the scene focused, the arrow keys Up and Down and Shift with Left or Right pan, and + and − zoom (Left and Right alone step through people, below). Esc or the ⟲ button ("See the whole floor") steps back. The + and − buttons at the bottom right zoom too, each greyed out at its limit; in 3D a thin bar beside them shows how far you are zoomed in. From the floor view, clicking a room zooms into it.

**Office clock.** The clock in the header shows office time. Click it to see the office at another hour: real time, or a preset (early morning, morning, midday, afternoon, evening, night) at normal speed, x10 or x60. Only the scene changes; figures, notices and run times stay on real time. The preview is never saved, so a reload returns to real time. With reduced motion on, a preview runs at normal speed. When the office keeps a market's time rather than yours, the clock shows both.

**Performance readout.** Add `?perf=1` to the page address to show the scene's frame cost and render rate against their budgets, the 3D draw calls, and two street lines: the street step (one tick of the traffic and people outside) and the street repaint (the still layer, redrawn at most once a minute). It is for diagnosing a slow machine and changes nothing else.

### Office life

When no one has asked for anything, the office is not frozen, but it never pretends to work. People who are free get on with small things: a lunch break, an afternoon coffee, a chat by the cooler, a quieter Friday afternoon, a quick huddle while the morning brief runs. Only free people do this. Anyone a run needs, or who owes a delivery or an answer, drops what they are doing and goes to work. None of it touches your data or spends a cent.

- The assistant walks a round of the rooms after it has been free for a short while during office hours, stopping at two or three doors in a row along the corridor, and when one of your agents finished a run in the last 5 minutes, it then takes the lift up and stops at that agent's desk before coming back. It starts a round only while the office floor is shown, never at night or with reduced motion. Any work, question or approval for it ends the round at once.
- Now and then, during office hours, one person who has been free for a while pops out to an open shop across the street: they leave by the street door, cross on the walk signal, queue, buy and come back with a drink, a bag or a takeaway box (a drink stays on their desk). In the session that is about two trips an hour at most; after the home market's close on a trading day, until the after-close mood ends, people are free sooner and go out more often (a trip every 6 to 10 minutes). Only one is out at a time, nobody leaves while anything waits for you, at night or with reduced motion, and any new work brings them straight back. While out they are off the floor: their label and the text list say where they are. Hiding the page puts them back at their seat.
- When nothing is running, nothing waits for you and no one is typing for about 15 minutes, the office goes quiet: people lean back, screens go dark, the small fidgets stop and the page does almost nothing. In a quiet office a round happens at most once every 25 idle minutes.
- A tab you are not looking at stops animating altogether and catches up when you return.

### Talking to a person

Point at a person for their name and one live line: what they are running and from where, which step they are on, that they are waiting for you or for their turn, that they are paused, or that they are free. Reaching someone with the keyboard shows the same label. Click them and they react (a wave when free, a glance up when busy), say a short line from real state, and a small ring of actions opens with only what is possible right now. Right-click, Enter or Space on a person the keyboard has reached, or a long press on a touch screen, opens the same ring with its first action focused.

- *Chat*, for your agents and the assistant: picks them in the command bar and opens the chat.
- *Give work*, for the same people and not while an agent is paused: picks them as the receiver and puts the cursor in the command box. Nothing is sent.
- *What it's doing*: their Progress tab. A helper an agent delegated to opens its parent agent's tab, and the assistant and the alert clerk have their own.
- *Work*: the Work tab of your agents and the assistant.
- *Stop the work*, only while their run is going: stops the run after a confirm.
- *Profile*: the profile of your own agents.
- *Follow*, for everyone: the camera follows them (below).

Arrow keys move around the ring, Esc closes it, and so does moving focus away. A person waiting at your desk opens the approval in the bell instead.

**Following someone.** Double-click a person with a mouse, or choose "Follow" in their ring, and the camera keeps them centred, across floors and the lift, until you move the camera yourself (drag, scroll, zoom or the arrow keys), press Esc, click empty floor, step to someone else with the keyboard, or switch between 2D and 3D.

**Stepping through people.** Tab into the scene and it lands on its first person. Tab and Shift+Tab move through everyone on the floor shown in a fixed order: the office crew first, then your agents by desk, then their helpers. The left and right arrows step the same way and wrap round. Each step centres the camera and announces the name and status, and Enter or Space opens the ring of the person it is on. Tab leaves the scene past either end.

### Two views of the same office

A "2D | 3D" switch in the header, before the Focus button, changes how the office is drawn. 2D is the default. 3D is loaded the first time you ask for it, and your choice is kept in this browser. It is the same office: positions, camera, selection, bubbles and everything above work in both, except that switching drops a follow and closes an open ring. 3D shows what 2D shows: the agenda screens, the results board and the news pins carry the same faces, a phone or a stamped sheet shows in hand, a back wall clears while it hides someone standing behind it, and the lamps of lit rooms cast a warm light. If the device cannot draw 3D the button is disabled and says why; if 3D fails to load or the graphics context is lost, the page returns to 2D and tells you.

**Desks.** Each desk in the office carries its owner's things (reports, monitors, a checklist, a plant and photo, headphones, sticky notes, the alert desk's phone and lamp) and grows untidy with the day's real work: a sheet for every run of theirs that finished, a cup after each coffee or dessert break. A page opened late lays the sheets for today's finished runs at once; cups come only from breaks seen while it is open. The desks are tidied at 06:00 on the office clock. A screen shows a screensaver while its owner is away from the desk, goes dark when the office is quiet, and turns grey at the lunch break and after the close; a desk whose owner works keeps its work screen. A scout sitting at its desk with nothing to read shows the home index's line under its browser tabs. Everyone at a desk sits with their back to you, facing their desk, its one kind of monitor standing at the far edge with its screen toward you so its text reads; the alert clerk's counter has one too. The alert desk's lamp glows amber while a fired alert is unread.

**Sun and weather.** The office light follows the real sun over the home region's city: night below -6 degrees, twilight, a golden hour under 10 degrees, cloud greying the day. It eases over 2 s when the clock or the sky changes. Shadows on the street point away from the sun and vanish at night; the sun throws a warm patch on the floor inside the glass it shines through, deeper the lower it stands, and the west or east blinds close while a low sun faces them (in the morning in the east, in the afternoon in the west), opening once it sets or clouds over; the patches and blinds ease to a new strength in under a second (at once under reduced motion), while a lamp's glow switches between its day and night strength the moment the sun crosses -6 degrees, and the lamps fade to their dimmer lunch-break glow and back over about a second. With "light follows the hour" off, the sun holds at solar noon under a clear sky. In real time, with motion not reduced, the page itself asks Open-Meteo (`api.open-meteo.com`) for the city's current weather every 30 minutes, sending only the city's latitude and longitude; a preview hour, reduced motion or a failed call uses a made-up sky seeded by the day (0 to 2 short showers). A failed call keeps the last reading for 3 hours. Rain brings umbrellas, people sheltering under awnings, a wet road and streaks on the north glass; a thunderstorm adds a short flash at most every 20 s (none under reduced motion, no sound); fog hazes the far blocks and turns car headlights on; at 33 degrees with the sun up, walkers wear hats and keep to the shade. The header shows a small weather chip beside the clock while a live reading is shown (not on a phone). The settings' outbound list names this call.

**Market rhythm.** The office keeps the home market's calendar, never a made-up one. On a weekend or a market holiday only the alert clerk and the assistant are in, and the agents whose focus names a market that still trades (crypto), plus anyone with a real run; every other desk and room goes dark, and the lobby screens say when the market reopens. On a trading day people walk in through the street door between 07:00 and 08:15 and go home between 17:00 and 19:00, each at their own minute; a run that is still going keeps its person at the desk with the lamp on, and a run started after hours brings its person in and sends them home when it ends. Nobody leaves their desk in the first minutes after the open. In the closing auction the free people stand and watch the lobby screens, and after the close the afternoon coffee window opens again and chats come sooner. A hard drop in the home index (the daemon's own notice, while the session is open) gathers two or three free people at the lobby screens, at most once every half hour, and a close well above the previous one makes one person raise both hands. In report season people from other rooms visit the library now and then. The derivatives' expiry Thursday keeps the trader and the risk analyst at their desks all session, and a held name's ex-dividend day (read once a day from the events feed) keeps the agent that hunts income at its desk until noon, with a calendar on its desk and the date circled; without such an agent the analyst stays at theirs. Each says why in its hover label. The office as a whole counts as shut, with the lobby dimmed and the alert desk saying the markets are closed, only once the home market and every other market you have switched on have shut; crypto never closes, so while it is switched on (`/profile enable crypto`) the office stays open, and with it off, only the markets you kept decide.

### The street and the city

The office sits on a real block of the home region's city. One city is drawn today: Ho Chi Minh City's financial district, with Hàm Nghi running past the front door between Hồ Tùng Mậu on the west and Hải Triều on the east (each street carries its name plate), the landmark tower one block behind the frontage across the road, and Bến Bạch Đằng park on the near side; every home region the daemon knows today draws it. Street, stop and park names are the city's own and never translated; shops, vehicles and uniforms carry no real brand or logo. Drag to look along the whole street at any zoom: the parks on both sides, the blocks beyond and the tower to its crown. In 3D, − zooms out past the floor until the whole street fits.

What is real and what is ambience:

- **Ambience.** The traffic (with the city's habits: motorbikes slip between the cars, bunch ahead of them at a red light and leave first, and rush hour jams), the people on the pavements, the school run, deliveries, the parks and their exercise hours, the street vendors, the birds, dogs and cats, the shops opening and shutting by their hours, a guard walking the frontage late at night, and the decorations for Tết, Mid-Autumn, National Day and Christmas. None of it stands for work, and none of it reads your data.
- **Real.** The sun and the weather (above); the market's calendar and hours, which set the office's day; and the office's rented LED board on the building across the road, which shows the product's name and the index rows of the page's market overview, from the page's own once-a-minute read. Its line is built from the reads since the page opened and says the time of the last one; outside a session it says closed, at the lunch break it says so, and a preview hour leaves it as it is. A person who crosses the street on an errand (above) is a real member of the office, and is shown as out.
- **The clock.** The street keeps the office clock: the home market's zone, else your `[locale] timezone`. A hidden page stops it, and on return it is rebuilt from the clock, never replayed. With reduced motion it stands still where the clock put it.

**The building crew.** A receptionist at the front desk on trading days, a cleaner who empties the bins and mops the corridor late in the afternoon (the "Wet floor" sign moves with the mop, and walkers go round it), and a guard at the gates who walks a round after dark. They are scenery, not agents: no menu, no status dot, no click; Tab skips them, the text list leaves them out and their label shows only their role.

**The lift.** One car runs between the two floors. Whoever rides it presses the call button, waits for the doors, and the floor indicator follows the car; the assistant's visit to an agent that just finished goes up this way.

**Small talk.** Two free colleagues on the sofa trade lines picked to fit the moment, such as rain, the lunch break, a down day, a Friday or a holiday. The lines come from fixed phrase tables, never a model; they never repeat the last pair and never say a number.

**Credits.** Settings > Data and connections > Credits names the map data (OpenStreetMap), the weather (Open-Meteo), the icons and every reference photo the streets were drawn from. The page ships none of the photos.

### Keys, screen readers and attention

Single keys work when the cursor is not in a text field, no dialog is open and no modifier is held: `/` or Cmd/Ctrl+K go to the command box (Cmd/Ctrl+K works from inside a field too); `1`, `2`, `3` and `4` open Today, Portfolio, Ideas and Market; `R` returns to the agent or ticker you were viewing; `B` the bell; `J` the jobs; `C` the chat; `F` Focus; `[` and `]` the previous and next agent; `?`, or the "?" button in the header, lists them all; Esc closes what is open or lets go of a follow. While the scene has the keyboard, the arrow keys, Tab, Enter, Space and Esc are the scene's own (above) and the letter keys still work. With the bell open, Up and Down choose a request, and `Y` approves it once or `N` denies it, only on the request that is outlined, and its buttons print the key. "Remember" has no key, the approval card inside the chat ignores these keys, and a stray key anywhere else approves nothing.

The page is built to be used without a mouse: every control shows a focus ring, a skip link leads to the information panel, the scene is one keyboard application with a plain-text list of who is doing what (it appears when you tab into it, and each entry opens what that person is doing or what needs you), and following or stepping to someone is announced. A new approval or a broken stop is announced to screen readers too. Dialogs trap focus and give it back.

How loudly the page tells you something follows the weight the daemon gives the event. A quiet event only moves the scene. A slightly louder one brightens the person's bubble for a few seconds. The next level also lights the dot on the bell and, while the chat is closed, on the chat button below; that dot then means "something new", not only an unread message. The loudest events can also send a browser notification, if you turned that on in Settings > Display (the browser asks permission only when you switch it on). A soft two-note chime, if you switched it on, plays only for a new approval request or a broken stop: once for each, and never more than once in 10 seconds. The tab title carries a count and the tab icon a dot while something needs you, meaning an approval waiting or a broken stop you have not seen yet. A clarifying question, a pairing request or a spent budget gives the notification and the dots but not the title or icon. Chime and notifications are off by default and kept in this browser.

### Narrow screens and touch

Below 900 px wide the page shows one pane at a time, switched with a bar under the header: Office, Information, Chat. A wider screen keeps the chat docked beside the rest. Opening a card (a ticker, an agent, a tab) brings Information forward; "See" on a run brings the Office forward, zoomed into that run's room; sending a message or choosing Chat brings the chat forward, and its close button goes back to the pane you came from. Nothing switches panes by itself, so a live event never pulls you away. Focus mode and its button are off at this width. Below 600 px, on a phone, the header trims to what fits (the brand word and chip icons go, the running chip shortens and the clock stays as a compact button), popovers fill the width, Settings goes full screen and the reader drops its contents column. On any narrow screen the floor is never drawn smaller than one screen pixel per world pixel, so you reach the rest by panning, and a hint says so.

Touch works as a mouse does: drag with one finger to pan and pinch with two to zoom. A first tap on a person, their tag or anything with a tip shows what hover would show, and a person greets; a second tap on the same thing, or a long press on a person, opens the ring. A tap on empty floor closes the label, the ring and a follow. Follow someone from their ring; everything you read on hover has a tap.

### Display preferences

Theme (light, dark or follow the system), the colours for up and down (green up or red up), motion (full, reduced or follow the system), the level of detail (above) and the office light are kept in this browser and apply at once. Reduced motion stills the characters and pets except for blinking, holds the office's dust, ribbons, LED strip, rack lights, approval light and bubbles still, stops the ticker scroll, pings and flashing prices, and runs the clock preview at normal speed; bubbles still update. Language and time zone are the daemon's own settings (they change the brief and Telegram too) and need a restart. The browser also remembers the lamps you switched off, the 2D or 3D choice, the Market tab's region, an update you put off, and the chime and notification choices; none of it goes to the daemon.

Internals: [dev/operations.md](dev/operations.md).

See also [safety and approvals](safety.md), [budgets](budgets.md), [trading](trading.md), and the
[`config.toml`](configuration.md) and [command](commands.md) references.
