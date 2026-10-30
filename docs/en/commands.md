# Commands

There are two ways in, and one list of commands behind both:

- `openalpha <command>` is the CLI, typed in a terminal.
- `/command` works in terminal chat and in every channel you set up.

Trading has slash commands only. It has no CLI command of its own.

Treat this page as a map. For the exact syntax of the version you installed, run `openalpha help`,
`openalpha help <command>` or `openalpha <command> --help`.

**Contents**

- [Trading chat](#trading-chat)
- [Global behavior](#global-behavior)
- [Command catalog](#command-catalog)
- [Chat](#chat)
- [Research](#research)
- [Daemon and diagnostics](#daemon-and-diagnostics)
- [Configuration and onboarding](#configuration-and-onboarding)
- [Provider logins](#provider-logins)
- [Agents, plugins, skills](#agents-plugins-skills)
- [Memory, history, cost](#memory-history-cost)
- [Pairing](#pairing)
- [Zalo Personal login](#zalo-personal-login)
- [Scheduling and workflows](#scheduling-and-workflows)
- [Database and workspace maintenance](#database-and-workspace-maintenance)
- [Logs](#logs)
- [MCP](#mcp)

## Global behavior

- Success exits `0`. Unknown commands and ordinary failures exit `1`. Asking for help (`openalpha` alone,
  `help`, `--help`) is not a failure and exits `0`.
- `--version` and `-v` do what `version` does.
- Invalid flags, missing values, invalid choices, and validation errors exit `2` **before** the
  command does anything. A malformed command never half-runs.
- A broken `config.toml` exits `2` the same way on every command that needs it. Four still run and say
  what is wrong: `version` exits `0`, and `doctor`, `onboard` and `config validate` exit `1`.
- Global flags may come before or after the command, but not after a `--`.
- `--` ends option parsing: every token after it is a positional argument. A negative number (`-5`,
  `-3.2`, `-5%`) is a value, never an unknown flag.
- Terminal output is credential-scrubbed. `--verbose` adds bounded diagnostic detail.
- `--quiet` and `--verbose` are mutually exclusive.

| Flag | Purpose |
|---|---|
| `-q`, `--quiet` | Hide routine success and information output |
| `--verbose` | Include scrubbed stack and cause details |
| `--config <path>` | Use exactly this config file |
| `--data-dir <path>` | Override the data folder and the default config location |
| `--log-level <level>` | `debug`, `info`, `warn`, `error` or `fatal` |
| `--no-color` | Disable ANSI color |
| `--local` | Run in this process even when a daemon is running (`--log-level` implies it) |

Log level priority: the flag, `OPENALPHA_LOG_LEVEL`, the TOML, then the default. `NO_COLOR` turns
color off outright; `FORCE_COLOR` only applies when you have not turned color off.

### Exit codes

If you script against the CLI: the code tells you why a run stopped, not just that it did.

| Code | Reason |
|---:|---|
| `0` | `completed` |
| `1` | `error` |
| `3` | `budget` |
| `6` | `turn_limit` |
| `12` | `timeout` |
| `15` | `loop` |
| `16` | `agent_paused` |
| `17` | `daemon_lost` |
| `130` | `aborted` |

Other failures: `2` for usage, config and validation; `5` for a final LLM failure; `11` for storage;
`13` for channels; `14` for tools; `18` for a write that conflicted with another edit; `143` for a
command stopped by SIGTERM. Other halt
reasons use the code listed in [Safety](safety.md), so `11` is also `hook_failed` and `12` is also
`session_busy`. `doctor` exits `1` when any check fails.

`17` is not a run halt: the daemon stopped while a command forwarded to it was running, and the command
was not run again. See [Commands run in the daemon](operations.md#commands-run-in-the-daemon).

The interactive REPL is the exception. It prints per-turn failures inline and exits normally when you
leave, because one failed turn is not a failed session.

## Command catalog

| Command | Purpose | Subcommands |
|---|---|---|
| `chat` | Interactive or one-shot agent chat | none |
| `start` | Run channels and the scheduler | none; `--background`/`-b` to detach |
| `stop` | Stop the daemon | none |
| `restart` | Restart the daemon | none; `--now` does not wait for running work, `--background`/`-b` to stop it and start it again detached |
| `status` | Daemon, channel and spend overview | none |
| `version` | Print the version and whether a newer release is out; `--version` and `-v` work too | none |
| `help` | Print help: `help` for the list, `help <command> [subcommand]` for one command | none; a command name |
| `upgrade` | Install the latest release | none; `--check` only reports, `--rollback` goes back to the previous release |
| `doctor` | Check config, credentials and storage | none; optional check name (`config`, `models`, `data-dir`, `logging`, `database`, `daemon`, `channels`, `delivery`, `sources`, `trading`, `safety`, `venues`, `web-search`, `providers`, `telegram`, `zalo`, `version`) and `--online` |
| `onboard` | First setup, or change the model, Telegram bot, budget or language | none |
| `setup` | Desktop app only. A client app's first run: provider catalog, and a starter config (one JSON line) | `catalog`, `write <provider> <model>` |
| `api` | The `/v1` API's bearer token | `token`, `rotate` |
| `web` | Open the office page, signed in with a one-time link | none |
| `connect` | Print the address and token the desktop app needs | none |
| `agent` | Agents and chat bindings | `list`, `show`, `add`, `edit`, `remove`, `pause`, `resume`, `bind`, `unbind`, `bindings` |
| `social` | Your agents on agent social networks | `list`, `add`, `update`, `rollback`, `remove`, `pause`, `resume`, `join`, `leave`, `rekey`, `review`, `drafts`, `approve`, `discard`, `log` |
| `config` | Resolved configuration | `show`, `get`, `path`, `validate`, `edit` |
| `provider` | Provider and model catalog | `list`, `models` |
| `key` | Save, list and remove the keys OpenAlpha reads, in `<data dir>/env` | `set <NAME>` (typed hidden or piped, never an argument), `list` (default; every name in the file plus every variable your setup reads, data source keys such as `FRED_API_KEY` included, each with its source and the last 4 characters of a long key), `unset <NAME>` |
| `autostart` | Start OpenAlpha when you log in | `enable`, `disable`, `status` (default) |
| `auth` | Logins for subscription providers | `login`, `status`, `logout` |
| `plugin` | Installed plugins | `list`, `install` (`--yes`), `update`, `uninstall` |
| `skill` | Discovered skills | `list`, `install` (`--force`) |
| `memory` | Agent memory | `store`, `recall`, `search`, `list`, `remove` |
| `history` | Session history | `list`, `show`, `delete`, `clear` |
| `cost` | Spend for a period | none; period or date flags, `--breakdown` |
| `pair` | Channel pairing | `list`, `approve`, `deny`, `revoke` |
| `schedule` | Scheduled jobs | `list`, `show`, `add`, `edit`, `remove`, `pause`, `resume`, `run-now` |
| `workflow` | Registered workflows | `list`, `run` |
| `db` | Database maintenance | `migrate` (`up`, `down`), `integrity`, `cleanup`, `stats`, `backup`, `export`, `import`, `restore`, `reset` |
| `logs` | Read, follow or clear global and agent logs | `tail` (the default, so bare `logs` reads), `clear` |
| `mcp` | MCP server and exposed surface | `serve`, `surface`, `install` |
| `workspace` | Agent scratch cleanup | `cleanup` |
| `zalo` | Link a personal Zalo account for `zalo_personal` | `login` (`--profile`) |

## Chat

```text
openalpha chat [-m <text>] [-a <agent>] [--mode manual|bypass]
             [-c] [--max-turns <n>] [--max-cost-usd <usd>]
```

Without `--message` you get the REPL, an ongoing conversation. With it you get one shot: one question,
one answer.

A one shot can ask you to approve something only while stdin is a terminal. With piped or empty stdin
there is nobody to ask. So in manual mode a dangerous call is blocked as approval-unavailable. It is
never approved quietly. `--mode bypass` always has to be typed by you.

`--continue` picks up the CLI's previous chat session. It refuses an `--agent` that names a different
agent from the one that session used.

The turn and cost flags can only make a run smaller, never larger. The global daily and monthly caps
always apply.

### Slash commands

One catalog decides the help text, who may run what, cooldowns, where each command works and the
Telegram menu. So a command behaves the same in the REPL and in a group chat.

| Command | Purpose |
|---|---|
| `/agent` | Show the entry agent; an authorized channel operator can change it. In the terminal, pick it with `chat --agent <id>` |
| `/model` | Show a configured model selector anywhere; select one in a chat channel |
| `/research` | Run bounded, cited research without changing the selected agent |
| `/health` | Show runtime and channel health codes |
| `/upgrade` | Operator only: shows your version, the latest release and what it brings; `/upgrade confirm` (or the button) installs it from Telegram/Zalo |
| `/memory` | Recall an entry by key (`/memory <key>`), search (`find <query>`), save (`remember <key> <value>`) or remove (`forget <key>`) |
| `/cost` | Show this chat's usage and today's spend against the cap |
| `/schedule` | List, inspect, pause, resume, run or remove one of your jobs (`/schedule remove <id>` deletes it). It lists only the jobs made from this chat, each by its id and what it does. A job made in the terminal or on the office page belongs to no chat, so it does not appear here: manage it with `schedule` in the terminal or on the page, where one that waits for an alert instead of a time shows the alert it waits for (`when FPT broke its stop`) in place of a time |
| `/config` | Show the live language, model, budget and channels |
| `/new` | Switch to a fresh chat session (the office page's chat moves to it too); commands waiting in the chat's line are dropped and the ones running are stopped |
| `/continue` | Resume a run that stopped before finishing, without retyping the request; says so when nothing stopped |
| `/social` | `/social drafts` lists what your agents are waiting to post; `/social approve <id>` sends one and `/social discard <id>` drops it. Operator only. See [Social networks](social.md) |
| `/pair` | Operator only, in a chat listed in `allowed_ids`: lists the pairing codes waiting for approval. See [Channels](channels.md#pairing) |
| `/approve` | Operator only, in a chat listed in `allowed_ids`: `/approve <code>` lets the chat that asked for that pairing code in. See [Channels](channels.md#pairing) |
| `/deny` | Operator only, in a chat listed in `allowed_ids`: `/deny <code>` turns that pairing request down. See [Channels](channels.md#pairing) |

`/help` lists commands in groups: portfolio and trades (starting with `/setup`), markets, analysis and suggestions, then system (`/help`, `/stop` and the commands that belong to no group). The Telegram menu follows the same order.
`/help <name>` (with or without the leading `/`) shows one command's description and usage; a misspelt
name gets the closest command.

Trading commands read their words in any case: `/refresh crypto FORCE`, `/profile enable Crypto` and
`/delete 0f9838 CONFIRM` work as typed. The system commands (`/memory`, `/schedule`, `/social`,
`/research`, `/agent`) take their keywords in lower case. A setting name typed short or slightly wrong is answered with
the one it most likely means, such as `reserve-pct-nav` for `/profile set reserve 0.2`.

Channels add `/stop` and the pairing controls. `/stop` and `/help` also answer to a bot-addressed form
such as `/stop@MyBot`, the way a Telegram group sends them. The REPL has `/help`, `/exit` and `/quit`,
and Ctrl+D leaves too. A line typed while a turn is still running is never sent, not even afterwards,
so it cannot answer an approval prompt by accident; the REPL says so at once.

Commands that run on their own - `/suggest`, `/screen`, `/rebalance`, `/brief`, `/refresh`, `/price`,
`/overview`, `/market`, `/portfolio`, `/reconcile`, `/themes`, `/schedule run` and plugin workflows - do not wait
behind your chat.

- Each chat runs up to three at once. Up to ten more wait in order.
- In a channel, a command that has to wait tells you its place in line. It starts when a slot frees up.
- A command past the end of the line is refused, and you are asked to send it again in a moment.
- `/new` and `/stop` both drop the waiting commands without a word, and stop the ones already running.

A plain chat message still waits for the answer in front of it.

Two habits of the output are worth knowing:

- A command that waits on the network shows a progress line while it runs and a footer when it
  finishes. A command that answers from local data (`/profile`, `/sources`)
  has neither. When the output is not a terminal (piped, or a one-shot `chat -m "/refresh"`), the
  progress shows as plain lines on stderr. They appear only once the command has run a moment, and at
  most one every ten seconds. So stdout carries only the answer, and an instant reply prints nothing.
- If a run switched providers, one line above the footer says what it moved from, to, and why - one
  line per distinct switch. That line explains a footer with no model name. It covers a slash
  command's child runs as well as the chat turn's own calls.

Trading adds `/setup`, `/record`, `/update`, `/delete`, `/transactions`, `/portfolio`, `/profile`,
`/watchlist`, `/price`, `/market`, `/overview`, `/screen`, `/sources`, `/suggest`, `/themes`,
`/rebalance`, `/reconcile`, `/reflect`, `/alert`, `/brief` and `/refresh`, plus `/trade`, which places
orders once a venue has exchange keys. They are under [Trading chat](#trading-chat).

### The command bar in the office page

The box at the bottom of the [office page](operations.md#the-office-page) takes everything the chat takes: plain questions, tickers and the slash commands above.

A chip on its left says who receives what you type: the assistant, or one of your own agents (a paused agent is marked). Enter sends it, and a phone also shows a Send button. The list that opens over the box ends with a send row. It reads "Send to <agent>" when an agent is picked, and "Run the command" once the text starts with `/`.

- **Typing.** Plain words ask a question. A ticker looks it up. Type `/`, or press Tab on an empty box, to see the commands; Tab on text completes the first ticker or command that matches. Up and Down choose a row (on an empty box, Up recalls what you sent before), Enter sends, Esc closes the list. If the connection is down the text stays in the box and a line says it was not sent.
- **Sub-commands and arguments.** After a command name and a space, the list offers what that command accepts next, the same words Tab completes in the terminal (for example `add` and `remove` after `/watchlist`, or the agent names after `/agent`), narrowed as you type; Tab, Enter or a click fills the word and a space. A faint line at the top shows the command's usage, such as `/alert create <ticker> above|below <price>`, even when it has no words to offer. A ticker that is also on offer is listed once. If the suggestions cannot be read, the box still sends what you typed.
- **What it suggests.** A focused empty box offers the usual starts: read the brief, see the portfolio, suggest for one name, research a topic. With a ticker card open it offers to suggest again, set a price alert or add the name to the watchlist; with one of your agents open it offers to send your next line to that agent, or to look at its schedules.
- **Estimates.** Beside each command, and on the "Run the command" row, the page shows what it usually costs (for example "about 0.05-0.20 USD"), or "no AI cost" for a command that answers from local data, together with what is left of today's cap when you have one. The figure is the middle half of what the command's last few runs cost, so it appears only after a few runs and never for a command that hands the turn to an agent. A command whose cost depends on what you type, such as `/suggest` on different names, pools every use, so read it as a rough guide. See [Budgets](budgets.md#in-the-office-page).
- **The queue.** Commands that run on their own do not wait behind each other, within the limits above. In the chat column a command that has to wait says its place in line and how many are running at once, and can be dropped from the line. A command that runs beside others says what it runs alongside.
- **Stopping and adding.** A running answer or command shows "See it in the office" and Stop, which asks you to confirm and keeps the work already done in the log. While an answer (not a command) is in progress you can type a further thought and press "Add to it": the answer reads it at its next step. A line that starts with `/` is a command, never an addition.

A button that names a whole command sends it when you click it: "/suggest VPB", "Analyze this name" on a ticker card and on each Opportunities row (where `/suggest` would hand back a stored call, meaning an open call on the ticker card, or on Opportunities a call made that day or a buy still open, the same button reads "Analyze again from scratch" and sends `/suggest <ticker> force`; a failed run or the plan written for a holding when you bought it is not a call, so the button stays "Analyze this name" there; "Analyze again from scratch" also sits under every `/suggest <ticker>` answer that was not already forced and runs that same line again with `force`), the brief on the first-run card, a scheduled job's "Run again", "Dig deeper". While the run a button started is still going, that button spins and stays locked, so a second press never costs a second run.

A button whose result shows where it sits runs its command without writing anything to the chat or the chat's history: "Refresh data" (`/refresh`, never with `force`) on Market for the markets of the region in view, and on a ticker card with no price for that name's market alone (a market you switched off, and world gold, gets no button); "Write today's brief again" at the foot of the morning brief (`/brief force`), where the reader stays open and loads the new brief once it is written; "Run again" on Themes (`/themes`, or `/themes run <id>` for one theme), which needs an AI model and stays locked until one is set up; "Screen again" on Opportunities, which ranks the board again. To follow or stop one, open "Running" at the top of the page; a command refused before it starts (over a spending cap, say) says why right under its button, and "Run again" on Themes also stays locked while a themes run asked from another channel is going. A button that needs more from you, such as Set alert or quoting a report, only fills the box (or picks the receiver) and leaves the rest to you.

## Research

There is no standalone research command. Research runs inside ordinary `chat` turns - one shot, REPL
or channel - whenever the agent decides it needs current evidence from several outside sources.
`/research` forces one such foreground turn through the deep-research agent, without changing your
`/agent` binding.

```text
/research <query>
/research quick <query>
/research standard <query>
/research thorough <query>
```

Without a level you get `standard`. The header names them `light` (quick), `medium` (standard)
and `deep` (thorough).

Research is **foreground-only and tied to the run that called it**. It shares that run's abort
signal, budget and deadline, and leaves behind no background task, no research id and no saved
state. Cancel the run (Ctrl+C or `/stop`) and it stops cleanly. There is no async control command
and no resuming in a later run.

### What you see while it runs

The CLI shows a depth header. For depths that plan, the plan follows as numbered questions. Each
running question gets one live line (`q N/M · question · elapsed`), with the current search or fetch
indented beneath it. A finished question leaves one line: attempts, elapsed, findings and sources, or
the failure code. Totals close the run: searches, fetches, sources, elapsed time and the run's actual
spend.

`--verbose` adds search and fetch completion lines and retrieval detail. Piped output keeps only the
milestone lines and never prompts or animates.

### Reviewing the plan

A top-level `thorough` run never starts unreviewed. It shows its plan before spending anything: the
original and normalized objective, dimensions, assumptions, freshness window, complexity, the numbered
questions, and the real limits - maximum duration, question limit, review rounds, remaining run
budget and branch budget weight. Then it waits for one decision:

| Input | Decision |
|---|---|
| Enter | Start with the displayed plan |
| `e` | Edit: give one revision instruction; the plan is regenerated and shown again |
| `q` or Escape | Cancel the run |

You get **exactly one** edit. After that the plan offers only start or cancel. With nobody to ask
(piped stdin or no terminal), a `thorough` run is cancelled before it spends anything. `quick` and
`standard` show no plan selector, and delegated research never prompts.

In a channel the plan arrives as a message with Start and Cancel buttons and no edit. Only an
operator's tap decides. No tap within three minutes cancels the run, and so does a channel without
inline buttons.

The agent then writes one final answer in the same chat stream, leading with the verdict, evidence
level, gaps and source summary, with full visible URLs. An editable channel folds the progress
milestones into the run's live status; others receive a few milestone messages. The final answer
arrives as the normal reply.

## Daemon and diagnostics

```text
openalpha start [--background]
openalpha stop
openalpha restart [--now] [--background]
openalpha status
openalpha doctor [check] [--online]
```

**Starting.** Bare `start` runs in the foreground, and Ctrl-C stops it. `--background`/`-b` runs the
same command detached. It then waits until the daemon is actually ready: the API open and the chat
channels started. That usually takes a few seconds. Only then does it report success, with the pid and
the output path. Market data keeps loading in the background after that.

- A daemon that dies while starting (say its database cannot be opened) is reported at once, with
  its own error message and exit code. The command exits non-zero.
- After 90 seconds, a daemon that is running but not ready yet (a slow chat login, say) is left running.
  The command says how to follow it and exits zero. One that never came up exits non-zero.
- `stop` and `status` work the same in both modes.

A start prints the version it runs, the model, the channels it opens, the API port and a
line naming `web` when `[api]` is on, and the log file. The log records when the channels open.

It then says which automatic jobs are at work at that moment, such as the market data load every
start runs, and why any task's last pass failed. In the foreground, each of those prints one "Done"
line when it finishes; after that the terminal stays quiet.

**Restarting.** When a daemon is running and `[api]` is on, `restart` asks that daemon to restart
itself in place (same pid, same terminal). It waits until the daemon is ready and prints the result.

- It waits for running work to finish, about two minutes at most. `--now` does not wait.
- The daemon stops the usual way, so an approval still waiting is refused.
- `restart --background`, or `restart` when no daemon runs, stops it (if it runs) and starts it again
  from this shell, with this shell's variables, in the background or in this window.
- A plain `restart` does the same when `[api]` is off or the daemon cannot be asked (its token cannot
  be read or is not accepted). `--now` then changes nothing.
- On Windows a daemon cannot restart in place, so `restart` always stops and starts again.
- `kill -USR2 <pid>` restarts the daemon in place at once, like `--now`, whether `[api]` is on or not.

**A missing key does not stop `start`.** Each of these takes down only the parts that need it:

- an unset key variable for a model (the main one, a tier or a fallback), for web search or for an
  MCP server;
- a Telegram or Zalo bot token that is unset, or that the platform rejects.

You get one warning line per item (marked `!`, on stderr) saying what waits and how to fix it. In the
foreground, the variable warnings print right under the summary. The channel warnings print when the
channels open. With `--background` they sit under the success line.

Everything else keeps running: data refresh, price alerts, the ledger and every job that needs no
model. Chat over a channel, `/suggest`, research and the brief's model sections wait until you save
the key with `openalpha key set <NAME>` and `restart --background`. A channel without a token accepts
no messages from anyone. `doctor` still reports a missing key as a failure on its models row, and runs
every other check as usual.

Some problems do still stop `start`: a configuration error (bad TOML, an invalid value), a daemon
already running, and a storage failure. An API port already taken does not: the API stays closed,
`start` warns and names the port, and the rest of the daemon runs.

**Status.** `status` names the version the running daemon was started from, and which automatic
jobs are at work now (a few seconds behind at most), with why any task's last pass failed.

- Re-running the install script restarts a background daemon on the new binary.
- An install pinned with `OPENALPHA_VERSION` keeps the daemon on its old release until you restart it.
  `status` flags it, with the `stop` and `start --background` that switch it over.
- When the running daemon started without some keys, `status` repeats the `start` warnings: which
  channels were skipped and why, which keys are unset and what waits for them. It does this even after
  a reboot.
- Exchange keys and the keys of optional data sources are listed apart under "optional keys". Without
  them you record trades by hand, and `start` does not warn.

The desktop app reads the same list from `/v1/state`. `upgrade` brings a background daemon back up on
the new release itself.

**Doctor.** `doctor` is always read-only. Offline, it checks only what it can see locally. `--online`
adds live probes of PostgreSQL, providers, channel tokens, web search and exchange keys. The provider
probe sends the first model of each provider one short message. It tells you plainly when a server on
your machine is not running.

Rows are labelled in your `[locale] language`. A row marked `i` is a state that needs no action yet,
never a warning. Examples: a database, log folder or data folder that the first run creates; a daemon
that has not been started; an optional data source whose key is unset. The source row says what the
key would add.

When `config.toml` cannot be read, only the config, daemon and version rows are checked. The rest say
they wait on the config fix, since checking them now would check the defaults, not your settings. A
single check such as `doctor web-search` then prints the config row above it, so you see what to fix.

`doctor models` also names the cloud-account variables a keyless Vertex or Azure entry still needs.
`doctor trading` composes the app the way `chat` would, without starting or migrating anything. So a
home region no venue trades, or a `default_for` on the wrong venue, shows up here first. It waits until
the database exists.

`doctor version` reads the last answer GitHub gave (at most a day old); `doctor version --online`
asks again. Being behind is a warning, never a failure.

`doctor safety` warns for each switch that lets OpenAlpha act without asking: `orders.allow_unattended`, `plugins.allow_untrusted`, and `plugins.allow_code` when it is on beside the second. With none on, it reports one clean row. It never fails the run.

Run `doctor venues --online` once after you add an exchange key. It reads what the live Binance key
may actually do and warns while it can withdraw funds, works from any IP, or has spot trading
switched off. A demo key is not audited.

### Staying up to date

When a newer release is out, the CLI tells you once a day, under the command's output. It says what
changed, how many releases you are behind, and whether one of them is important. In a private chat
with the operator, the bot tells you weekly, or daily while an important release is waiting.

`upgrade` downloads the release binary for your machine next to the installed one and checks it
against the release's SHA256SUMS. Only then does it swap the binary in. What happens to a running
daemon depends on how you started it:

- Started with `start --background`: it is paused for the swap, then started again on the new release
  by itself, from the same config file and data folder. If it will not start, `upgrade` goes back to
  the release that ran, says so, and keeps the new release's startup error in
  `daemon.stderr.failed.log`.
- Running in a terminal window or under a service: it keeps running the old release until you restart
  it. `upgrade` prints the commands.
- On Windows, which cannot replace a running binary: it is stopped for the swap, and you start it
  again.

Your data folder and config are never touched. If the swap itself fails, the old version stays in
place and the stopped daemon is started again, or the message says how to. A cut download, a checksum
mismatch or Ctrl-C all end before the swap. So your current version stays, and a running daemon keeps
running.

The release you replaced stays next to the new one as `openalpha.old` (`openalpha.exe.old` on
Windows), and `upgrade --rollback` swaps back to it.

If the newer release changed the database, `--rollback` first takes it back to what the older release
reads, with `db migrate down --to`. It asks before doing so, and on SQLite it saves a copy in
`backups/pre-rollback/` first. Say no and nothing changes.

- When `upgrade` started the newer release and it would not start, the same step runs without asking.
- A release that is still starting after 90 seconds, often busy updating a large database, is left
  running rather than rolled back.
- A release installed by the install script, a reinstall of the same release included, has no such
  record. So after its rollback, the older release refuses to start on the newer schema. It says why
  and names the way back.

`upgrade --check` only reports. A source checkout updates with `git pull`.

On a Windows machine with an ARM chip, the installer picks the native ARM build. An older x64 install
keeps upgrading as x64 until you re-run the install command, which moves it to the native one.

## Configuration and onboarding

```text
openalpha onboard
openalpha config show
openalpha config get <dotted-path>
openalpha config path
openalpha config validate
openalpha config edit
```

- `show` masks secrets, and `get` refuses any path through a secret key.
- `validate` runs every check boot does, `[trading]` included. So a config it accepts is a config that
  boots. When it does not accept it, it exits `1` and lists every reason in one pass, a mistyped
  provider name and an unset key variable included.
- `config get` takes a path into the resolved config, which is camelCase (`budget.maxDailyUsd`).
- `edit` uses `VISUAL`, then `EDITOR`, then `nano`; a blank value counts as unset. The value is read
  the way git reads it, so it may carry flags or a quoted path
  (`"/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl" -w`).

`onboard` walks you through a first setup: language, AI provider and model, an endpoint URL for a
provider that needs one, the environment variable that holds your key, a daily spending cap ($2
unless you change it) and, if you want, a Telegram bot.

- You answer a list with ↑ and ↓ and Enter. ← goes back to the list question before it, with your
  earlier answer still marked.
- A value the list does not hold (another currency, model or provider) is its last line, which then
  asks you to type it.
- Without a terminal, the list is numbered and you type the number.
- A wrong answer is asked again instead of ending the setup.

When the key is already set, it sends the model one short test message. It offers the ChatGPT sign-in
when you picked that plan. It ends with a numbered list of what is left.

Run it again on an existing config to change one part at a time: the model, the Telegram bot, the
budget or the language. After each save the menu comes back so you can change another, until you pick
"Done, exit". ← on a part's first list question takes you back to the menu.

That rewrite drops the file's comments, so the old file is saved first beside it as
`config.toml.<time>.bak`. Each change leaves its own backup. The newest 5 are kept, and older ones are
deleted for you. When no config exists, a bare `openalpha` and any command that needs one offer to
start the setup.

`setup write` writes the same starter file for the desktop app and refuses to
replace an existing config.

```text
openalpha api token
openalpha api rotate
openalpha web
openalpha connect
```

`api token` prints the bearer token the app and other `/v1` clients send.

`api rotate` replaces it and prints the new one. It also signs every browser out and restarts a
running daemon at once, without waiting for work in progress, so the old token stops working. If that
restart fails, it says so: run `openalpha restart`.

With `[api] token_env` set, the token is that variable and `rotate` leaves it alone. While `[api]` is
off, `api token` and `api rotate` say so instead of printing anything.

`web` opens the office page. It needs the daemon running and `[api]` on, and asks the daemon for a
one-time link that works once, within 5 minutes. It never prints the token. What you see depends
on where you run it:

- On the machine's own screen (macOS, or Linux with a display), it opens your browser and prints the
  link in case that did not work.
- Over SSH, it prints the tunnel command to run on your own machine, then the link to open. The
  tunnel uses the server's port plus 10000 (18765 for 8765; minus, past port 55535). So it never lands
  on a daemon you run locally. If that port is taken, `ssh` stops with an error instead of quietly
  using another. If it cannot tell the address you SSH to, it uses the server's host name and says so;
  swap in the address you actually use.
- With `[api] public_url` set, it prints only the `https://` link, wherever you run it.

Run it again whenever you need a new link: a used or expired one is refused. After a few wrong tries
the daemon pauses sign-ins from that machine for a moment; `web` says so.

`connect` is for the desktop app. It prints the address and the token on two separate lines: the
address is your `public_url` when it is set, otherwise an `openalpha+ssh://user@server?api=<port>`
spec the app opens through SSH. It does not need the daemon to be running, but it does need `[api]`
on. Give the app the address and the token, never a browser: the token is the key to your server, so
keep it private.

## Provider logins

```text
openalpha auth login <provider> [--paste] [--device]
openalpha auth status [provider]
openalpha auth logout <provider>
```

These are for providers that authenticate with a subscription rather than an API key.

- `login` defaults to a browser round trip. It prints the authorization URL, waits on a loopback
  listener at `127.0.0.1:1455` (or `:1457` when that port is taken), and checks the `state` it issued.
- `--paste` skips the listener and reads the code you paste in, bare or as the whole redirect URL.
- `--device` uses the device-code flow where the provider offers it. It prints a user code and a URL
  to open on another device.

All three time out after 15 minutes.

`status` with no argument reports every provider that supports login. These commands do not boot the
runtime and work before a config file exists. Token storage, refresh and cost treatment are in
[Agents](agents.md).

## Agents, plugins, skills

Your agents live in the data folder in use. Built-in and bundled agents cannot be edited or deleted.
Binding commands take a channel id and map a channel and chat to an agent; bindings are saved and take
effect on the next inbound message.

```text
openalpha agent bind <chat-id> <agent-id> --channel <id>
openalpha agent unbind <chat-id> --channel <id>
```

`--channel` is required on both.

```text
openalpha plugin list
openalpha plugin install <source>
openalpha plugin update <id>
openalpha plugin uninstall <id>

openalpha skill list
openalpha skill install <source>
```

Plugin and skill installs validate ids, paths and source trust. A plugin takes its `id` from its
`plugin.toml`. Without one, a plugin from a git URL takes the repository name (without `.git`), and a
local folder takes its own name. So installing the same source again replaces the plugin instead of
adding a copy. An agent run sees only the read-only `skill_view` tool; package management stays on the
CLI.

### Pausing agents

```text
openalpha agent pause <id> | --all     # switch one of your own agents off
openalpha agent resume <id> | --all    # and back on, with no restart
```

Only agents in your data folder can be paused. A paused agent refuses every run it owns with exit
code `16` (see [Exit codes](#exit-codes)), and `agent list` marks it.

### Social networks

```text
openalpha social add <skill.md URL>              # pin a network after you read what it allows
openalpha social update <network>                # review a changed skill; rollback goes back
openalpha social join <agent> <network>          # put one of your agents on it
openalpha social drafts                          # what waits for your OK; approve or discard by id
openalpha social log <agent> [<network>]         # what the agent published
openalpha social pause|resume <network> [<agent>]
```

An agent needs its own `[focus]` and only allowed tools to join, and `agent remove` refuses an agent
that still holds a membership. Details are in [Social networks](social.md).

## Memory, history, cost

Memory operations are checked for secrets, prompt injection, size, scope and TTL. Search uses the
full-text index. `memory list --prefix <text>` keeps only the keys that start with it.

`memory search <query>` returns 10 results unless you pass `--limit <n>`. `history list` shows the 20
most recent sessions unless you pass `--limit <n>`.

`history clear` deletes every session, or every session of one agent. Read its help and confirmation
prompt before you run it.

`cost` takes `--period day|week|month` (`week` starts on Monday, like `/transactions week`) or an
inclusive `--from`/`--to` ISO-day range. It reads the stored per-call records instead of estimating
from transcripts, so it agrees with your provider's invoice.

`--breakdown` lists the same window per assistant and model, most expensive first: calls, failures,
typical answer time, tokens from cache, and tokens spent thinking.

## Pairing

```text
openalpha pair list --channel <id>
openalpha pair approve <code>
openalpha pair deny <code>
openalpha pair revoke <chat-id> --channel <id>
```

For channels that use pairing admission: Telegram and Zalo, when configured for it. Only configured
operators can run the in-channel pairing controls, and a paired chat cannot approve another chat.

## Zalo Personal login

```text
openalpha zalo login [--profile <name>]
```

Links a personal Zalo account for the `zalo_personal` channel. It saves a QR image and prints where.
Scan it with the Zalo app and confirm on the phone. A fresh code replaces it every couple of minutes,
and the command gives up after five. The login is saved under `--profile`, or the channel's `profile`
when you leave it out, and the QR image is deleted when you are done. A running daemon picks the login
up on its next reconnect.

## Scheduling and workflows

Schedules support cron or fixed intervals, delivery targets you choose, pause and resume, immediate
runs, and per-job tool limits via `--allow-tools`. `--agent` defaults to `chat`. A cron job stores an
IANA timezone with it; an interval job does not accept one.

```text
openalpha schedule add <id> --prompt <text> (--cron <expr> | --every <interval>)
    [--tz <timezone>] [--to <channel:chat-id>] [--agent <id>] [--allow-tools <names>]
openalpha schedule edit <id> [--prompt <text>] [--cron <expr> | --every <interval>]
    [--tz <timezone>] [--to <channel:chat-id>]
```

`--prompt` is required on `add`, plus exactly one of `--cron` or `--every` (`"0 9 * * *"`, `30m`, `1h`).
`--tz` defaults to `[locale] timezone`. `--to` is where the result goes, such as `telegram:-1001234567`.

When a scheduled job makes a dangerous call, approval goes through the channel if the job's target has
an approver. Otherwise the call is refused.

```text
openalpha workflow list
openalpha workflow run <id>
```

`workflow run` executes a registered workflow, stops if the CLI is shut down, and reports the steps
and cost. Having no workflows is normal, not an error.

## Database and workspace maintenance

Commands that write to the database (`db migrate`, `cleanup`, `import`, `restore`, `reset`) run only
while the daemon is stopped.

- `restore`, `reset` and a migration rollback ask for confirmation unless you pass `--yes`.
- On SQLite, `reset` first offers a backup (Enter means yes). The copy lands in `backups/` like
  `db backup`, so a mistake can be undone with `db restore`. `--yes` answers that question with its
  default, so the backup is still taken.
- `db cleanup` needs `--older-than` (at least `1d`); `--dry-run` previews what it would prune.

`db integrity`, `db stats`, `db export` and `db backup` start only the storage layer, so they run
with no model credentials configured. Backup and restore, export and import, and what each keeps
through a `db reset` are in [Storage](storage.md).

`workspace cleanup` visits only `run/` and `tmp/` inside the agent workspaces you select with
`--agent <id>` or `--all` (exactly one is required). `--older-than`, `--dry-run` and `--yes` work as
elsewhere, and the daemon must be stopped. `--all` without `--older-than` empties every agent's scratch, so it
always asks you to type `DELETE`, even with `--yes`. It does not delete durable workspace-root files or agent
logs. As always, the workspace is a safe place to start in, not a locked box enforced by the operating
system.

## Logs

```text
openalpha logs [--lines <n>] [-f] [--agent <id>] [--since <instant|duration>]
openalpha logs clear [--agent <id> | --daemon] [--older-than <duration>] [--dry-run] [--yes]
```

Reading is the default, so bare `logs` reads. You can choose a tail length, follow mode, one agent's
own log, and a start point (an ISO instant or a duration). Output stays credential-scrubbed.

`logs clear` deletes per-agent log folders under `<data_dir>/logs/agents/`:

- `--agent` limits it to one agent.
- `--older-than` age-gates it (omit it to clear regardless of age; the minimum is `1d` when set).
- `--dry-run` previews counts and bytes without deleting.
- `--daemon` switches the target to the global daemon log and its rotated files, age-gated on the
  newest one. It cannot be combined with `--agent`.

It needs a stopped daemon and asks first unless you pass `--yes`.

This differs from the daemon's automatic sweep, which removes only logs of agents no longer in the
config (see [`[retention]`](configuration.md#retention)). Without `--daemon`, `logs clear` removes
whatever matches, configured agents' logs included (the log writer recreates them on the next run),
and never touches the active global log, which stays bounded by `[log].max_file_mb` and
`[log].max_files`. Agent scratch (`run/`, `tmp/`) is `workspace cleanup`'s job.

## Trading chat

Trading has no CLI command tree of its own. Terminal chat and every configured channel share the same
localized slash commands, so what you learn in the REPL works from your phone.

Three commands carry enough grammar for their own section below: `/record`, `/suggest` and `/trade`.
The rest fit in a line.

| Command | Grammar and notes |
|---|---|
| `/setup` | `/setup` - what the assistant does and how to set it up |
| `/record` | Writes a ledger row. See [The ledger](#the-ledger) |
| `/update` | `/update <handle> <the full /record line>` - edit one entry in place, venue included. A bare ticker is found as `/record` finds it; every other field is written out. The reply shows the row as it was, then the confirmation. A row in a currency other than VND needs `fx <rate>` or `fx auto` where the rate applies; a row paid from USDT the venue already holds takes none. An edit states its own quantity and fee. Only `/record` writes `all` or leaves the fee to a rate, because working either out again against a later book or a changed rate would quietly move a settled figure. The row's note and, on a sale, which exit leg filled (stopped out or target hit) carry over, since no `/record` line can state them |
| `/delete` | `/delete <handle>` - show one entry; `/delete <handle> confirm` removes it |
| `/transactions` | `/transactions [count] [days] [handle]` - recorded transactions, newest first, each with the handle `/update` and `/delete` take. In a chat the default is the last 10 rows (the terminal keeps 100), and the next-page button keeps the same size. `days` is `a..b`, `a..`, `..b`, one date, `today`, `week`, `month`, or `7d`/`30d`; pass a handle to keep reading back from there |
| `/portfolio` | `/portfolio` - value and allocation, each row stating how far the holding sits from its stop. See [A planned stop is not a resting order](#a-planned-stop-is-not-a-resting-order) |
| `/portfolio nav [1m\|3m\|6m\|1y\|all]` | `/portfolio nav 3m` - how your book has done: the return with deposits and withdrawals taken out, the deepest drop from a peak, and a yardstick from your own target mix. Default `3m` |
| `/profile` | `/profile` or `/profile show` shows it; `/profile set <field> <value>` (a share takes `20%` or `0.2`); `/profile enable\|disable <segment>`; `/profile reset` |
| `/watchlist` | `/watchlist` - live quotes for the names you follow, at most twelve (what you hold is on `/portfolio`) (a longer list is truncated and says so); `/watchlist add <ticker>...`; `/watchlist remove <ticker>...` |
| `/price` | `/price <ticker>`, or `market:ticker` where a bare name is ambiguous. A market that quotes a two-sided dealer board (VN gold) prints both sides and the spread instead of a settled/live pair: a board states no last trade and keeps no daily series to close against |
| `/market` | `/market` - where one market is right now, beside the last session that settled; `/market enable\|disable` - turn the scheduled sends on or off (they go to the default chat, not necessarily this one) |
| `/overview` | `/overview` - how every market is doing, macro block included; `/overview <market>...` - only those markets, e.g. `/overview crypto` |
| `/screen` | `/screen [market] [count] [kind]`, in any order. The market defaults to the one whose calendar `[locale] region` names; `kind` narrows to one instrument kind the market lists. A name on your exclusion list still ranks and is marked, never hidden |
| `/suggest` | Spends LLM budget on one name. See [Suggestions](#suggestions) |
| `/themes` | `/themes` - looks for investment themes forming in Vietnam and spends LLM budget; `/themes run <id>` - re-checks one tracked theme, looks for no new ones and reports on it alone, for a fraction of the cost; `/themes show` - reads the stored report, no model call; `/themes approve\|reject\|retire <id>` - moves one theme. Operator only |
| `/rebalance` | `/rebalance`; `/rebalance <ticker>...` - sizes the gap to target, weighing no evidence and calling no model. See [What /rebalance sizes](#what-rebalance-sizes) |
| `/reflect` | `/reflect` - how past suggestions actually performed |
| `/alert` | `/alert` or `/alert list [count]` lists them; `/alert create <ticker> above\|below <threshold>`, or `market:ticker` where a bare name is ambiguous; `/alert disable <id>` (the short id the list and the notice print; if it matches several, the reply lists their full ids). The list includes system-armed exit and screener rows beside your own |
| `/brief` | `/brief`; `/brief force`; `/brief enable [HH:mm]`; `/brief disable`. `force` rebuilds past today's stored snapshot. The brief opens with the market story and a look back at earlier ones. See [A brief with no watchlist](#a-brief-with-no-watchlist) and [A brief with no book](#a-brief-with-no-book) |
| `/refresh` | `/refresh [market] [force]`, in either order. With no market it refreshes the markets you still use: a segment switched on in your profile, or one where you hold, watch or wait on a scored call. The rest are listed as skipped; naming one refreshes it anyway. `force` refetches regardless of what is already current. World gold is read live, so there is nothing to refresh and the command says so. A kind that fans out over instruments reports how far through it is |
| `/sources` | `/sources` - which providers have stopped answering, or a single line when none has. Breaker state is this process's own memory, so a fresh CLI invocation reports that no provider has been called rather than claiming health |
| `/reconcile` | `/reconcile` - compare the book against what the venue reports; an exchange with no API key yet is named with the variables it is waiting for |
| `/trade` | Stages, confirms and cancels real orders. See [Orders](#orders) |

#### A planned stop is not a resting order

The stop a `/portfolio` row names is the level its latest plan set, **not** an order anyone placed.
Where a stop is planned and nothing rests at the exchange, the row says `no stop order placed`. Where
no venue holding the name could carry one, it says nothing either way. `/trade` is where resting
exits are stated precisely.

#### What /rebalance sizes

Names passed to `/rebalance` stand in for the saved watchlist for that run and are never saved. What
you hold is always sized. With no names, holdings plus the saved watchlist are used. Write
`market:ticker` where a bare name is ambiguous.

Rows are sized to close the gap to target under the segment budget, the per-name cap and the board
lot. No evidence is weighed and no model is called. So a block containing a buy ends by naming
`/suggest <ticker>`: that command scales the same ceiling by confidence, and can decline a name the
plan lists.

A held name whose latest read still leans toward selling some is not added to, and is not counted
when the plan says how many names are left to buy.

A holding past its per-name or sector cap by more than the 5/25 band is sold back to the cap, whatever its score.

#### A brief with no watchlist

The leading and dropped blocks cover your own watchlist and are absent when it is empty. The
calendar, corporate-event and headline blocks still cover the market's most-traded names, so a brief
without a watchlist is shorter, not emptier.

#### A brief with no book

Before your first recorded trade, the brief leaves out what only a book can fill: the cash-reserve
block, the discipline block and the `/rebalance` and `/transactions` buttons. Its first action asks
you to record your trades with `/record`. The market story and every market block read as usual.

A holding with no price yet is not an empty book. The brief keeps everything above, and only says it
cannot total the book this morning.

#### On /watchlist names

Write `market:ticker` where a bare name is ambiguous. A bare name on `remove` drops it from every
market holding it.

```text
openalpha chat --message "/setup"
openalpha chat --message "/record deposit vps 100000000 VND 2026-08-03"
openalpha chat --message "/profile set risk-level balanced"
openalpha chat --message "/suggest FPT"
```

`/alert create` and `/brief enable` need a chat that can receive messages, such as Telegram or Zalo.
Typed in the terminal, they deliver to your default chat (`fallback_chat_id`, or the one paired chat);
with no chat to deliver to they are refused.

For anything without a command of its own - bars, news, sector strength, foreign flow, portfolio
review, track record - just ask in plain language. The agent calls the matching trading tools.

Only `/price`, `/overview`, `/screen` and `/themes` write their reply into the chat session, so your
next message can ask about them. The replies of `/portfolio`, `/rebalance`, `/transactions`,
`/market`, `/brief`, `/suggest` and `/reflect` are only shown; the session does not remember them.

Slash commands take their delivery target from the terminal chat or channel they ran in. A profile
write takes no version number. If two chats edit at once, the last edit wins and neither is rejected;
for a single operator, "apply my edit" is the right answer.

### The ledger

Every row that names an instrument also names the venue holding it. The same coin at two custodians
is two positions with two cost bases.

A row names the market in the same token as the ticker (`equity-vn:FPT`), or leaves it out when the
lists already stored name exactly one market for that ticker. The market is never guessed over the
network, and the confirmation names it. That matters because a ledger row changes every later reading
of the book.

```text
/record deposit|withdrawal|fee|loss <venue> <amount> <currency> <day>
/record buy|sell [venue] <ticker> <quantity|all> <unit-price> [currency] [fee] [day]
/record rights [venue] <ticker> <quantity> <unit-price> [currency] <fee> [day]
/record dividend <venue> <ticker> <amount> <currency> <day>
/record split|distribution <venue> <ticker> <quantity-delta> <day>
/record transfer <from-venue> <to-venue> <amount> <currency> <fee> <day>
/record sync <venue>
/record confirm
```

Any row that moves money, cash deposits, withdrawals and transfers included, may end with `fx <rate>` or
`fx auto`. It is the rate into VND for the row's currency, and only applies to a row in a currency other
than VND, such as USDT.

A mistyped field (a ticker without its market, a bad date, a negative number, an unreadable `fx`)
writes nothing. The reply names that field and the form it expects, then points at `/record` on its
own for the full syntax. A line of the wrong shape (too few or too many fields) prints the usage.
`/update` does the same.

Write numbers without thousands separators: `100000000`, not `100.000.000`. The dot is the decimal
point (`0.5`, `1.250` USDT). A grouped number such as `100.000.000` or `1,000,000` is refused with its
plain form, never guessed.

In a currency with no minor units, such as VND, a price, amount, fee or quantity written `58.400` or
`1.000` is refused the same way. There is no 58.4 đồng, and `1.000` could be a thousand shares or one
tael of gold. The same goes for a rate after `fx` in a đồng book, and for the share change of a split
or distribution in any market. The reply says to write `1000` for a thousand, or `1.5` for a decimal.

A price ten times or more away from the name's latest price is not saved straight away. The reply
shows both and asks. Tap the button, or send the same line again ending in `confirm`, to save it as
typed. `/update` and `/alert create` ask the same way. Details: [Trading](trading.md).

A line with the right shape but one unreadable token, such as a quantity of `-1`, a threshold of `0`
or a condition other than `above` or `below`, names that token rather than reprinting the usage.

**Buy and sell.** A sale may write `all` instead of a count. The ledger turns it into the settled
quantity held *at that venue* on that day. You may leave out the fee, and the venue's `fees` rate in
`[trading.venues.<id>]` prices it. A fee you state is never replaced.

**Quantity is stored as typed**, so enter the count the venue credited, not the one you ordered. A
venue with exchange credentials takes the row from the one matching fill instead. Why, and how the
fill is matched, is in [Trading](trading.md).

**Short lines.** You can leave out three things:

- the venue, when exactly one holds the market;
- the currency, to use the market's own;
- the day, for today.

A bare ticker is looked up only in the lists already stored, among the markets a venue holds (only the
named venue's, when one is named). No network request is made. It is accepted only when exactly one
market matches; otherwise the reply names the `market:ticker` forms to type. Every confirmation prints
the market beside the ticker.

The line expands to the full form before any number is read. So a grouped number such as `58.400` is
refused exactly as in the full form. Example: `/record buy FPT 100 58400`.

**Other row types.** A rights issue is not brokered at the standard rate, so it always states its
fee. A `transfer` moves cash between two of your own venues without touching net deposits. A 2:1
split on a name held at two brokers is two rows, not one applied pro rata.

**Exchange rate (`fx`).**

- `fx <rate>` books the row at what you actually paid per unit of the currency. The rate's source is
  stored as `operator`.
- `fx auto` books it at that day's market rate with no question asked.
- A row in a currency other than VND with no `fx` is not recorded yet. The assistant shows a preview
  (the market rate it would use, the cash change, and why P2P can differ) and waits. Type
  `/record confirm` to record it exactly as previewed, or type the command again with `fx <rate>`.

- A row waiting for confirmation is held for 10 minutes. Each chat holds one, and a new one replaces it.
- Any other `/record` that parses drops the held row and says so. One that fails to parse keeps it.
- `/record confirm` with nothing waiting says so and writes nothing.
- `/update` of a row in a currency other than VND requires `fx <rate>` or `fx auto` only where the
  rate changes the book (the same rows `/record confirm` asks about). A row paid from currency cash
  the venue holds takes none. It never holds a row.
- `/record confirm` asks only where the rate changes the book: deposits and withdrawals, and trades at
  a venue holding none of that currency. A venue that already holds USDT pays its USDT trades from it
  at cost, so they are not asked. `/reconcile` now compares a venue's USDT too.
- `/record sync` never asks: it books at each day's market rate and ends with one line per currency booked
  that way, so you can fix a row with `/update` if you bought over P2P.

**`/record sync <venue>`** books every fill the venue reports that your book has no row for, using
the exchange's own quantity, price and fee. A limit order that filled only partly before you cancelled
it is synced for the part that filled.

- Binance lists trades coin by coin, so its sync reads the coins in your book plus the ones you hold,
  and says so.
- It reaches back to your book's first row (the opening snapshot already counts what came before it)
  and pages the exchange to the end of that window.
- An exchange with no API key yet gets a reply naming the variables it is waiting for. A venue you
  trade by hand sends no fills, so the reply points you to `/record buy` or `/record sell`.
- Each fill is keyed on the venue's own order id, and a fill matching a row you typed by hand is left
  alone. Running it twice books nothing the second time, and the reply says how many it recognised.
- A fill matching one of your rows on everything *but* the date is reported, not booked. Fix the date
  on that row and run it again.
- If any fill for a name cannot be booked, none of that name's are. Half a name's history would be a
  position that never existed, with a cost basis nothing later can correct. So the run reports the
  name and leaves your book exactly as it was.

### Suggestions

```text
/suggest <ticker> [full|lean] [force]
/suggest stops [full|lean] [force]
```

Options go in any order after the ticker; use `market:ticker` where a bare name is ambiguous. This
spends LLM budget, so it is built to avoid spending it twice.

Today's answer is reused for free (on a continuous market, any answer under 4 hours old) until a
newer close is stored than the one it read. So a call made while the session traded runs again after
`/refresh` loads that session.

`force` re-runs past that and past the cooldown, at full depth unless you type a mode. A name the book
already holds at target runs `lean` by default, because the expensive question is already answered.

While a `/suggest` for a name is running, the same request for it from any chat or the app joins that run and
shows its result, instead of paying for a second debate. Only the request that started it is billed. A request for
a deeper debate never joins a lighter run, and `force` always starts its own.

`/suggest stops` covers every held position whose latest plan is missing a stop or a target, plus
every one that has passed the window an outcome is measured over without moving. It runs `lean` by
default and tells you when nothing needs a fresh read.

### Orders

```text
/trade
/trade spot <[venue:]ticker> buy|sell <quantity> [limit <price>] [tp <price>] [sl <price>]
/trade exit <[venue:]ticker> [qty <size>] [tp <price>] [sl <price>]
/trade halt|resume
/trade confirm [token]
/trade cancel <[venue:]ticker>
/trade reconcile [token]
```

A buy needs `sl` by default. Set `require_stop_loss = false` under `[trading.orders]` to allow one
without.

Bare `/trade` tells you what is outstanding: staged orders and their tokens, resting exits, positions
nothing is guarding, and what the exchange took that your book is missing. It reaches no venue.

- **`spot`** stages the order and prints a confirmation token. Nothing goes out until you type
  `/trade confirm`.
- **`exit`** sets or moves the resting take-profit and stop-loss on a position the book already holds,
  covering all of it unless `qty` names less. It is placed without a token because it can never reduce
  protection. Binance cannot move a resting exit, so there a second `/trade exit` is refused and names
  `/trade cancel`.
- **`halt`** switches every new buy off until you `resume`, and survives a restart. Sells, exits and
  cancels still go out, and no resting exit is touched.
- **`confirm`** places a staged order; bare where exactly one is waiting.
- **`cancel`** cancels a resting take-profit or stop-loss.
- **`reconcile`** lists orders the exchange took that your book never got, and settles any the book
  has since recovered.

The ticker is the base asset alone and the quantity is always in base units. `tp` and `sl` ride a buy
only - a sell is the way out already.

The `venue:` prefix is optional and needed only when more than one venue could answer. An ambiguous
order is refused with the candidates named, never routed by guess.

`/trade` places orders only once a registered venue carries exchange credentials. Until then, it
answers with the variables each exchange is waiting for and points you to `/record`. `/trade help` (or
a mistyped line) still prints the full syntax, so you can learn it first. Routing, setup and the first
run are in [Trading](trading.md).

## MCP

```text
openalpha mcp surface
openalpha mcp serve
openalpha mcp install
```

`surface` previews the exposed tools. `serve` runs a stdio MCP server. It serves no MCP prompts: the
connected model loads a research skill with `skill_view` from the skill list it is given. External MCP
tools stay approval-gated at top level and are unavailable to delegated child runs.

### What the server exposes, and what it withholds

The served surface has its own instructions: evidence discipline, suggests-never-executes, and where
alerts and briefs actually deliver. It does not use the chat agent's system prompt, because that prompt
names tools this surface withholds and rules that apply only to an interactive session.

These tools are withheld, and why:

| Tool | Why |
|---|---|
| `shell_exec` | Runs code the caller could run itself |
| `delegate`, `delegate_parallel`, `research` | They spend this operator's model budget driving a loop for a host that has its own |
| `schedule_add`, `schedule_list`, `schedule_remove` | A fired job delivers to the operator's default channel, not to the caller |
| `ask_clarification`, `todo_write` | Need the interactive chat loop |
| `file_read`, `file_list`, `file_search`, `file_write`, `file_edit` | Reach only the agent scratch folder, and approval would come from a program, not a person; the host has its own file tools |
| `memory_store`, `memory_remove` | Rewrite durable operator memory |
| `social_request`, `social_skill` | Would speak as one of your own agents on a public network; a client program must never do that |
| `order_place` | Irreversible at a real exchange; a program answering the approval is not the human the gate exists for |
| `web_search`, `web_fetch` | The host brings its own search; `mcp serve` reads no search configuration |

A withheld tool stays withheld when a client calls it by name, over stdio and over the HTTP API alike:
the call answers that no such tool exists.

Tools contributed by plugins or other MCP servers are withheld too. Re-advertising them would put
another server's tools behind this one's name, and a host can connect that server directly anyway. Domain
writes stay exposed, because this server validates them itself. Slash commands such as `/refresh` and
`/trade` are not tools, so they have no MCP counterpart.

Exposed tools:

| Area | Tools |
|---|---|
| Market data | `market_price`, `market_bars`, `market_overview`, `market_screen`, `market_sector_strength`, `market_sentiment`, `market_funding`, `market_accounts`, `market_events`, `market_news`, `macro_risk`, `vn_foreign_flow`, `vn_futures_basis` |
| Suggestions and themes | `suggestion_run`, `suggestion_batch`, `suggestion_track_record`, `themes_view`, `order_exits` |
| Portfolio and ledger | `portfolio_view`, `portfolio_history`, `portfolio_review`, `portfolio_rebalance`, `portfolio_record`, `portfolio_update`, `portfolio_remove` |
| Profile and watchlist | `profile_view`, `profile_update`, `profile_segment`, `watchlist_update` |
| Brief and alerts | `brief_build`, `brief_manage`, `alert_manage` |
| Memory and utilities | `memory_recall`, `memory_fts_recall`, `skill_view`, `calc`, `now` |
| Model requests | `model_request_view`, `model_answer`, `model_resume` |

**Depth and freshness.** `suggestion_run` and `brief_build` take `force: true` for a fresh run that
replaces today's suggestion or brief. It needs no approval: no money moves, and most clients cannot
answer an approval prompt. The model passes it when you ask for a fresh run. On `suggestion_run` it
also passes it when you ask for a deep, thorough or detailed analysis, in whatever language you write.

`suggestion_run` argues the full debate by default. The model passes `mode: "lean"` (one analyst and a
claim check, about half the wait) only when you ask for a quick or short analysis.

**What the client's model may see.** The served tools return relative figures - weights, suggestion
outcomes, `sizePctNav` - plus exactly one absolute figure: the order quantity (`units`) on a
suggestion and on each `portfolio_rebalance` line, which you need in order to place the order. NAV,
cash, costs, P&L and transaction amounts are never served:

- a suggestion's averaging-down and recent-exit warnings reach the model without their cost and loss
  figures;
- `portfolio_view` carries no return;
- the brief's losing-holdings return stays on your screen;
- a ledger write answers with the row's identity and fee check, never its quantity, price, fee or
  amount.

So the client's AI provider sees at most what an order quantity implies.

A hold places no order and carries `holdReasons` - its reason codes in your language - so the model
explains why instead of reading the hold's levels as an order.

**Writes and approval.** The write arms of `alert_manage` and `brief_manage` need approval, so a
client without elicitation can only list and show.

**Model requests.** These tools sit beside the surface. The connected client's model answers every
model call, one round of the debate at a time.

- `mcp install --host claude-code` also writes `~/.claude/agents/openalpha-analyst.md`, a subagent
  with only the request tools and no CLAUDE.md. So each role is answered in a small context of its
  own, and the round's last answer hands back the next round.
- A host without subagents, or whose model refuses subagent calls (like opencode's free tier), answers
  inline. One `model_answer` call per round carries every answer and returns the next round whole.

Answers go in as a batch, all or nothing. While requests of the round are still open, `model_answer`
returns `answered`. The call that answers the last one waits for the next step and returns it: the
next round, `working` or `finished`. A subagent hands back `finished`, and the result then waits for
`model_resume`. Inline (`inline: true` on each call), the closing answer returns the result itself.

No served call waits more than 45 s. Past that it returns `working`, and the client calls
`model_resume` to keep waiting. A call that has returned never cancels its job. A job expires when a
request goes unanswered past the limit set under [`[loop]`](configuration.md#loop).

A debate the client wrote records its model as `client:<model>`. So its calls stay apart in the track
record from the same model reached through a configured provider.

### How replies are written

Every tool reply reads the way the CLI prints it. Money and prices arrive written in your language, a
board-scaled price with its scale beside it (`43,00 (giá bảng điện, ×1.000 VND)`). A field ending in
`Pct` is percent points; every other share, ratio, rate, return or weight is a fraction of one. A
score arrives as its band, and stray float digits are rounded off. `market_bars` is the one numeric
series, in whole currency units.

A price the model types *back* into a tool - an alert threshold, a recorded price, an order level - is
in whole currency units too, and each of those inputs says so.

On a name already held, `heldTakeProfit` gives the share of the holding to sell at the take-profit,
rounded to whole board lots as `/suggest` rounds it, without the unit count.

`suggestion_run` and `suggestion_batch` also return a `report`: the compact text `/suggest` prints, as
markdown headings and bullets, without its folded detail. The holding is written as its weight - no
units held, no cost, no return on cost, and exit levels measured from today's price instead of from
cost. The order quantity appears only where `units` itself is served. The server tells the host to
show the report word for word, and to offer a matching tool wherever it names a slash command.

### Wiring it into an assistant

```text
openalpha mcp install
```

It prints the app's own add command (where it has one), plus the server entry in the app's own config
format, pointing at the binary and config file this server actually runs with. Then it writes the
skill file the app reads.

`--host` picks the app: `claude-code` (the default), `claude-desktop`, `codex`, `cursor`, `gemini`,
`kilo-code`, `muse` (Muse Code), `opencode`, `vscode`, `windsurf`, `zed`, or `agents` for the neutral Agent Skills
location (`~/.agents/skills`). One skill body serves every app. Claude Desktop, Windsurf and Zed have
no skills folder, so nothing is written for them unless you pass `--skill-dir`; they read the rules
from the server when they connect.

Muse Code has no add command: merge the printed entry into `~/.config/muse/settings.json`, keeping
the keys already there. The entry sets `mode` to `optional`, so when OpenAlpha cannot start, Muse Code
warns and carries on instead of aborting the run. The skill goes to `~/.config/muse/skills`.

opencode and Kilo Code time out a local server within 5-10 s by default, so for them the entry also
sets the server `timeout` and `experimental.mcp_timeout` to twice the 45 s a served call waits before
answering `working`. `--skill-dir` overrides the skill folder.
