# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

- The accounts table now shows the five newest quarters next to the audited years, so a turn in the business is visible before the annual report.

## [1.0.5] - 2026-10-18

A friendlier first run: OpenAlpha starts without any key, says what each missing key holds back, and
the README walks you from install to a daily routine. No database change.

### Running without keys

- **`start` never stops for a missing key.** An unset AI, web search or MCP variable, a missing or
  rejected bot token and a short API token each print one `!` line; data, alerts and the ledger run
  on.
- **`start` lists only what opened**, and `start --background` waits until the channels are up.
- **`status` repeats what is missing** and flags a daemon left on an older release; `upgrade` stops
  it.
- **Commands that need a key name it.** `/suggest` shows the numbers and stores no undecided call;
  `/trade` still prints its syntax; search refuses rather than fall back to DuckDuckGo; a scheduled
  job or brief waits for the key instead of switching itself off.
- **`doctor` and `config validate` list every problem in one pass**, suggest the nearest name for a
  typo, and count an unset key once.
- `config.minimal.toml` starts at a 2 USD daily AI cap, like `onboard`.

### Your book

- **Grouped numbers are refused, not guessed:** `100.000.000` or `58.400 VND` gets its plain form.
- **A holding recorded near the price limit gets its exit plan**, and keeps it after `/brief`.
- **Bring in an existing book** in a few lines, past losses included (trading guide).

### Words and commands

- **One word for a portfolio bucket: segment** (Vietnamese: nhóm); plain words replace jargon.
- **`/suggest <ticker> full` always runs the whole debate**; a short run says who settled the hold.
- **`openalpha help`, `--version`, `-v`**; `/help <name>` works with or without `/` and suggests the
  nearest command.
- **`/continue`** finds a stopped run; **`db reset`** offers a backup first; `db restore`, plugin
  errors and `history` read in plain words.
- Piped output shows progress on stderr only; English counts read "1 problem"; the brief says its
  deployment figure covers the whole portfolio.
- **README rebuilt** around a three-command try-out, a five-step install and a daily routine.

### For integrators

- `/v1/state` adds `degraded`: what the daemon started without, worded in its language.
- `/v1/rebalance` renames the text field `sleeves` to `segments`.
- An unset model key answers `unavailable` with the operator's sentence, and as an `error` frame on
  `/v1/ws` chat.

## [1.0.4] - 2026-10-16

A readability and bookkeeping release: every report opens with its answer, and the ledger records
the rate you actually paid for USDT. No database change.

### Your book in USDT

- **`fx <rate>` or `fx auto` on a `/record` line** books the rate you paid or that day's market rate;
  put it on the USDT deposit (`/record deposit binance 1000 USDT 2026-08-14 fx 26600`).
- **A venue holds USDT as its own cash** at an average cost. Buys spend it at that cost, so `fx` on
  them is refused; a trade that runs short in one currency is refused, naming it.
- **A USDT row with no rate waits** - `/record` shows the market rate and cash change, and
  `/record confirm` writes it. `/update`, `portfolio_record` and `portfolio_update` ask for the rate.
- **`/portfolio`, `/rebalance` and `/reconcile` read USDT** - cost, today's value, the currency move,
  and the exchange balance. `/record sync` says which currencies it booked at market rates.

### Reports

- **`/suggest` opens with the call** (`BUY`, `NO ENTRY today`, `SIT TIGHT`), one price level per
  line, reasons before evidence, fine print at the end.
- **`/rebalance` titles itself with the plan** ("Today: BUY 4 names, ...") in three lines per order;
  `/portfolio` splits cash from profit and loss.
- **`/overview <market>`** shows one market; the brief's rows read as sentences and mark headlines in
  another language; `/reflect` is half as long.
- **`/help` lists commands in groups**, and system commands open with a titled heading.

### Fixes

- `/suggest` re-runs once a newer close is stored; `/rebalance` and the brief size on the settled
  macro read.
- Clearer errors for a mistyped `/record`, a short balance, a removed venue and a wrong config type.
- Smaller fixes to `/themes`, `/profile`, `/price`, `config show`, `api rotate` and gold prices.

## [1.0.3] - 2026-10-15

A hardening release: the same commands, with safer orders, a more honest track record and a daemon
that rides out bad moments. The first start adds one database column by itself (after a backup).

### Orders and your book

- A buy waits until every holding has a price, and an unclassified holding leaves no ETF room.
- One fill books one row, whether `/trade`, `/record sync` or the exit check lands it first; OKX
  sync reads its archive too and names a clock that needs syncing.

### Suggestions and alerts

- Win rates count a repeated call once, a resting buy that touched the target is scored
  conservatively, and one damaged stored row no longer breaks `/suggest`.
- Price alerts, trailing stops and the morning brief keep running after one failure; providers that
  ask you to wait are rested instead of retried.

### Channels and daemon

- Telegram, Zalo and social posts retry with back-off and are never sent twice by mistake.
- Shutdown, startup, logging, backups and retention each recover on their own; secrets are scrubbed
  before tool output is cut, and a remembered shell approval covers exactly that command.

## [1.0.2] - 2026-10-15

The first public release: a self-hosted trading research analyst for Vietnamese stocks, gold and
crypto. It finds ideas, argues both sides, sizes the trade against your whole book and keeps an
honest record of its calls. It never places an order you did not approve.

### Getting started

- **One-line install** for macOS, Linux and Windows, checked against the release's checksums;
  `openalpha onboard` sets up language, model, spending cap and Telegram.
- **Keys stay out of files** - the config names the environment variable; a missing key stops only
  what needs the model.
- **`openalpha upgrade`** swaps in the latest release and keeps your data; `doctor` checks the rest.

### Analysis

- **A staged pipeline** with a seven-persona debate. Entry, stop, target, size and conviction are
  fixed in code, and twelve stages can turn a call into a hold.
- **Markets** - VN equities, crypto, VN gold, and world gold as a reference, each with its own
  factors, sources and calendar. Stops and targets are tunable per market.
- **A track record** - `/reflect` scores past calls against the index and caps the next call's
  conviction.
- **`/themes` and `/research`** - macro themes scored 0-100 in code, and web research with claim
  checks.

### Your book and orders

- **The ledger is the truth** - positions are folds over your rows; `/portfolio`, `/rebalance` and
  `/reconcile` read them.
- **One order path** (`/trade`, `order_place`) on OKX and Binance: approved, capped, mirrored into
  the ledger and crash-safe. Other brokers are recorded by hand.

### Where you use it

- **CLI, Telegram, Zalo, an HTTP/WS API and MCP**, with SQLite or PostgreSQL, many LLM providers
  behind a fallback chain, and daily, monthly and per-run cost caps.
- **The model never sees your money** - personas get weights and percentages, never amounts.

[1.0.5]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.5
[1.0.4]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.4
[1.0.3]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.3
[1.0.2]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.2
