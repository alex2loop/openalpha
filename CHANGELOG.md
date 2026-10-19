# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Each released section opens with an English summary paragraph followed by one `> ` line in
Vietnamese; OpenAlpha shows both in its update notice. A release that users should install soon
carries ` [IMPORTANT]` after its date.

## [Unreleased]

OpenAlpha is safer to leave running and easier to drive: a daily backup, start at login, keys kept in a
private file, typed answers to approval prompts on Zalo, a shorter `/record`, and notices for a crash, a
missed brief or a channel that stays down. No database change.
> OpenAlpha an toàn hơn khi để chạy lâu và dễ dùng hơn: sao lưu mỗi ngày, tự chạy khi đăng nhập, khóa lưu trong tệp riêng, trả lời duyệt lệnh bằng cách gõ trên Zalo, `/record` ngắn hơn, và báo khi daemon sập, lỡ bản tin hay kênh chat mất kết nối.

### Operations

- The daemon backs up the SQLite book once a day into `backups/daily/` and keeps the newest three
  (`[retention] daily_backups`, `0` turns it off). PostgreSQL is skipped; use `pg_dump`.
- `openalpha autostart enable|disable|status` starts OpenAlpha at login (launchd, systemd user unit,
  Windows Run key), so the brief and alerts survive a restart. The Linux and Windows launchers are
  untested on real machines.
- `status` says when the daemon stopped unexpectedly, and the next start tells your chat once. A morning
  brief skipped because the daemon was down before the open now says so. A brief whose build crosses the
  open still goes out, with a line first saying prices have moved.
- A chat channel that stays down for 15 minutes is reported on another channel (with the reason), once
  when it drops and once when it returns, and `status` lists it as `down`.
- A button tapped after its prompt was answered or timed out replies that it is already answered or
  expired.
- SQLite gets `PRAGMA optimize` in the retention sweep.

### Setup

- `openalpha key set NAME` saves a key you type hidden into `~/.openalpha/env` (mode `0600`);
  `openalpha key` lists which keys are set and where from; `key unset NAME` removes one. Every command
  reads that file at start, and a variable set in your shell still wins. `onboard` offers to save the
  model key and the Telegram token the same way, and every missing-key message now points at `key set`.
  Names starting with the brand prefix are never read from the file.
- `onboard` asks the currency of your book (VND, USD, or another 3-letter code) and writes it to
  `[locale] currency`, since it is fixed once a profile is saved.
- `openalpha provider list` works before any setup, without a config or a database.
- `config.sample.toml` starts with the `[budget]` daily cap (`max_daily_usd = 2`) and `[locale]` on, and the
  long guides carry a contents list.

### Chat

- `/help` and the Telegram menu lead with the trading commands (`/setup` first under the book), and the
  system commands (`/help`, `/stop` and the rest) close the list. The menu now lists `/help` and `/stop`.
- Approval prompts and `/research thorough` plan reviews work on Zalo: each choice arrives as a short
  code such as `/4821` to type back in the same chat. Only the operator's code counts, and a second
  answer says it was already answered or has expired.
- In a private Zalo Personal chat, replying to an answer continues from it, as on Telegram.
- Alerts and the morning brief armed from the terminal now go to your chat (the first configured channel,
  or `fallback_chat_id`) instead of being refused, while OpenAlpha runs in the background. A scheduled
  daemon run whose origin is the terminal arms to the default chat the same way.
- On Zalo a long command's progress line ends with `type /stop to cancel`, and a command waiting behind
  another says nothing until it starts.

### Trading

- `/record buy|sell|rights` takes shorter lines: leave out the venue when one holds the market, the
  currency, and the date (`/record buy FPT 100 58400`). A bare ticker is found only in lists already
  stored, never over the network, and only when exactly one market matches. Every confirmation now prints
  the market beside the ticker.
- Buttons where no money moves: the rate check of a USDT `/record` and a proposed `/themes` theme each
  offer their confirm as a button (a typed line on Zalo and the terminal).
- `/delete <id>` now shows the row first; `/delete <id> confirm` removes it. Scripts that delete in one
  step must add `confirm`.

### Reports

- Alerts open with the action: the headline, then for an exit the `/record sell` line to fill in, then a
  `/suggest` link. Alert ids are six characters, and `/alert disable` takes them.
- On a phone `/transactions` shows 10 rows, `/portfolio` puts positions right after the warnings and keeps
  three closed trips, and the brief shows what to do right under the verdict.
- The footer after a command shows only the elapsed time until the session has called a model.
- Failure and caveat messages say what to do next, and a failed command points at `openalpha logs`.

### For integrators

- `DaemonTask.start(signal, options?)` takes a `DaemonStartOptions` object (`onReady`, `onHealth`,
  `previousRun`) in place of the positional `onReady` handler.

## [1.0.7] - 2026-10-19

Telegram replies keep their context, a quiet chat rechecks prices, and web search can use DeepSeek.
No database change.
> Trả lời một tin trong Telegram là OpenAlpha biết bạn hỏi tiếp tin nào, chat để lâu thì xem lại giá trước khi trả lời, tìm kiếm web dùng được DeepSeek.

### Chat

- In a private Telegram chat, replying to an answer continues from it; replying to an alert or brief
  tells OpenAlpha which kind of message you mean, never your amounts.
- After a quiet spell, the next answer rechecks prices. `gap_note_minutes` sets the quiet time per
  channel (default `30`, `0` off).

### Search

- `[web_search] provider = "deepseek"`: about $0.75 per 1,000 searches, empty ones free, strong on
  Vietnamese sources. Uses `DEEPSEEK_API_KEY`; set `cost_per_search_usd = 0.00075` to count the spend.
  Queries over 128 characters are trimmed but keep the sites you chose.

### Setup

- `config validate`, `start` and `status` now name a wrong `[channels.*]` value or misspelt key
  instead of failing with an unexplained error.

### Fixes

- DeepSeek web search no longer returns a site's machine-translated copies (a Dutch or German page
  beside the Vietnamese original).
- A chat replaced by `/new` or an agent switch now reads "done" in `history list` instead of staying
  "open".
- Reinstalling over an existing install prints "you're on the latest release" once, and
  `upgrade` names the version you run.

## [1.0.6] - 2026-10-18

Updates are easy to see and install from chat, the debate reads its evidence more carefully, and
Windows on ARM gets a native build. No database change.
> Bản mới dễ thấy và cài được ngay trong chat, phần tranh luận đọc dữ liệu kỹ hơn, và Windows chip ARM có bản riêng.

### Updates

- The notice says what changed, how many releases behind and whether one is important; checked
  twice a day.
- `/upgrade` shows what is new; `/upgrade confirm` installs it, restarts the bot and reports back.
- `upgrade` and the install scripts restart a background daemon, roll back a release that will not
  start, and `upgrade --rollback` goes back. A daemon started by v1.0.5 or earlier needs one
  restart by hand. Outside Windows, a daemon in a terminal or under a service keeps running until
  you restart it.
- The operator is reminded in a private chat: weekly, daily for an important release.
- `[update] auto = true` installs patch releases between 00:00 and 06:00, never mid-session.
- A native build for Windows on ARM.

### The debate

- VN accounts show the five newest quarters; a failed news, coverage or calendar feed is said.
- The company and sector are named, a price says when it was read, and the roles share one set of
  rules.
- Gold headlines credit the real newspaper behind Google News.
- Win rates count only calls whose window has passed, and `/reflect` shows how certain each is.
- The last closed call on a name gives the day it was made and the day it closed, and the debate
  writes dates the way you do.

### Your book

- A buy too small to rest its stop-loss is refused.
- Binance and OKX sync picks up a limit order that filled in part before it was cancelled.
- A partial-profit plan rests only the stop; the target alert walks you through the sale.

### Commands and setup

- `doctor` warns about switches that act without asking and no longer flags the database after a
  failed start; `config validate` reports an unknown section with the `[trading]` mistakes.
- `config.minimal.en.toml`, an English starter config.
- Leaving the chat closes its session; `history` deletes an idle open session.
- `/overview` prints the gold macro table once; `plugin uninstall` refuses a plugin not installed.

### For contributors

- Release binaries are start-tested on their own platforms before publishing (`dry_run` rehearses
  it); dependencies are audited weekly.

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

[1.0.7]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.7
[1.0.6]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.6
[1.0.5]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.5
[1.0.4]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.4
[1.0.3]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.3
[1.0.2]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.2
