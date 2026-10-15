# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.3] - 2026-10-15

A hardening release. Nothing new to learn: the same commands, with safer orders, a more honest
track record and a daemon that rides out bad moments instead of losing your messages. The first
start after upgrading adds one column to the database by itself (SQLite takes a backup first).

### Orders and your book

- **A buy waits until every holding has a price** - if something you hold can't be priced right
  now, `/trade` and `order_place` hold the buy instead of skipping the caps they can't check. The
  message says which command names the holding and that `/refresh` fixes it.
- **ETF ceilings count when a holding's type is unknown** - a sleeve holding a name that hasn't been
  classified yet now reads as having no ETF room, on orders and on `/suggest` alike, instead of as
  holding no ETFs at all.
- **One fill, one row** - a `/trade` fill, `/record sync` and the exit check now book a venue fill
  under the same key, so running `/record sync` while an order fills can no longer record it twice.
  A fill is dated on the session it filled in, not the moment you confirmed it.
- **`/record sync` on OKX sees today's fills** - a book older than a week reads both OKX's recent
  history and its archive, so the newest fills are no longer missed.
- **OKX clock problems say so** - a refused timestamp reads as a clock that needs syncing, not as
  bad credentials, and the clock check keeps a safety margin like Binance's.

### Suggestions and track record

- **Win rates count each idea once** - an agent's and a focus's record now fold a repeated call on
  a still-open idea into the first, the same way `/reflect` does, so a held idea re-issued every
  morning no longer inflates the numbers.
- **Resting buys are scored conservatively** - when a limit fills on a bar that also touched the
  target, that bar no longer counts as a win unless the price opened below your limit.
- **A batch that asks for too much says so** - when the calls in one `/suggest` together need more
  cash or open risk than the book has, the summary tells you.
- **One damaged row no longer breaks `/suggest`** - an unreadable stored suggestion is skipped and
  logged instead of failing every item or the whole `/suggestions` page.

### Alerts, brief and data

- **Price alerts keep running** - a problem planning one holding's exit, or arming a screener, no
  longer stops price alerts for everything else; the other holdings carry on.
- **A trailing stop is retried after a failed save** instead of waiting for the next session.
- **The morning brief can't be sent twice** when you run `/brief enable` at the moment it goes out.
- **`/refresh gold-vn force` rebuilds the gold premium history**, so a bad stored day is replaced
  as the docs always said.
- **Data providers that ask you to wait are believed** - a "come back in N seconds" longer than a
  request can wait is now read as a rate limit and the provider is rested, instead of being logged
  as a timeout and asked again. Waiting in our own queue no longer counts against a provider.

### Telegram, Zalo and social

- **Messages survive a network blip** - a reply that fails to send waits 10 s, then 20 s, before
  trying again, instead of using up every attempt within a second and being dropped.
- **Every button tap counts** - approving one draft and then another from the same `/social drafts`
  list now works; the second tap used to be ignored for five minutes.
- **Zalo personal finds your groups after a restart** - briefs and notices to a group chat no longer
  go out as a direct message that never arrives.
- **Telegram** - link previews stay off when an answer is filled in, and a reply still arrives if
  you deleted the message it answers.
- **Social posts are never sent twice by mistake** - when a network times out on a post, it is
  counted as possibly live, and the agent is told to check before trying again.

### Daemon and safety

- **Shutdown stops taking new requests first** - the API closes its door before the daemon drains
  running work, so nothing new starts on the way down.
- **A slow provider at startup no longer stops the daemon** - it starts with what it has and catches
  up, whether the refresh fails early or late.
- **Background tasks back off after a failure** - a heartbeat task whose result could not be saved
  waits before running again instead of re-running (and re-billing) every 30 seconds.
- **Logging comes back by itself** after a full disk or a write error, instead of staying silent
  until a restart.
- **Backups are private from the first byte** - `openalpha db backup` writes inside a private folder
  and only then moves the file into place.
- **Retention cleans each table on its own**, so one slow table no longer holds up or rolls back the
  rest.
- **Secrets are removed before a tool's output is shortened**, so a key cut in half at the edge can
  no longer slip through, and a tool result now stays within its size limit. A result over 4 MiB
  is replaced by a short note rather than read.
- **"Remember this approval" for shell commands covers exactly that command** and its arguments as
  given, and stores only a fingerprint of them.
- **Safer CLI** - keys typed while reviewing a research plan no longer leak into your next message,
  and `agent show`/`agent list` strip terminal control codes from agent descriptions.
- **The app API rejects a connection over the stream limit up front** with a clear error, and no
  longer reports a notice as delivered when it was dropped.
- **Remote plugins install under their repository name** when they don't declare an id, so
  installing one twice no longer leaves two copies.

## [1.0.2] - 2026-10-15

The first public release of OpenAlpha: a self-hosted trading research analyst for Vietnamese
stocks, gold and crypto. It finds ideas, argues both sides, sizes the trade against your whole
book, and keeps an honest record of how its calls turned out. It never places an order you did not
approve.

### Getting started

- **One-line install** on macOS and Linux (x64 or arm64):
  `curl -fsSL https://raw.githubusercontent.com/alex2loop/openalpha/main/install.sh | sh`.
  It downloads one self-contained binary, checks it against the release's SHA256SUMS, puts the
  command on your PATH and starts the setup. It never touches your data folder or your config.
- **Windows 10/11**:
  `powershell -c "irm https://raw.githubusercontent.com/alex2loop/openalpha/main/install.ps1 | iex"`
  installs `openalpha.exe` into `%USERPROFILE%\.local\bin` and adds it to your user PATH.
- **A guided setup** - `openalpha onboard` asks your language, AI service and model, a daily
  spending cap ($2 to start) and, if you like, a Telegram bot. A typo is simply asked again. If your
  key is already set, the model gets a short test message, and the setup ends with a numbered list
  of what is left to do. Run it again any time to change one part; the old file is kept as a
  backup. Typing `openalpha` with no config, or any command that needs one, offers the setup.
- **Keys stay out of files** - the config names the environment variable that holds each key or
  token, never the secret itself. ChatGPT plans sign in from the setup, and Google Vertex AI and
  Azure OpenAI use your cloud account. A key that isn't set stops only what needs the model:
  `status`, `stop` and the free commands still run, a chat message names the variable to set, and
  `openalpha start` waits until it is there. A model key that is not set yet blocks only the daemon and
  calls to the model; `/price`, `/portfolio`, `/record` and the other free commands still run.
- **Two config templates** - `config.minimal.toml` runs with nothing but `OPENROUTER_API_KEY`;
  `config.sample.toml` lists every key with a comment.
- **A daemon that says what it runs** - `openalpha start` prints the model, the channels, the API
  port and the log file. `--background` detaches it, for both `start` and `restart`.
- **`openalpha upgrade`** fetches the latest release, verifies it, and pauses the daemon only for
  the swap. A failed download leaves the old binary and the running daemon as they were. A short
  notice tells you once a day when a newer release is out; `[update] check = false` turns it off.

### How a suggestion is made

- **A staged pipeline** - resolve, cooldown, portfolio, factors, levels, gate, debate, stages,
  persist. Only the debate calls a model, and the steps around it can overrule it.
- **A seven-persona debate** - bull and bear researchers on symmetric briefs, a market analyst, a
  risk analyst, a portfolio manager, a claim verifier and a trader. Entry, stop, target, size and
  conviction are fixed in code before any persona reads a word, so no persona can move a level.
- **Twelve stages that can say no**:
  - before a token is spent: `admission`, `deployment`, `profile-exclusion`,
    `equity-vn-solvency`;
  - against the session: `crypto-tape-signals`, `equity-vn-distribution`,
    `equity-vn-tape-signals`;
  - against the verdict: `round-trip`, `averaging-down`, `crypto-crowding`,
    `equity-vn-disclosure`, `equity-vn-index-review`.

  A blocked stage turns the call into a hold, whether it refused or simply could not run.
- **Evidence you can trace** - every figure in a suggestion's case points to the data behind it,
  and one that does not says so.
- **A track record** - `/reflect` scores past calls against the index, compares the calls you took
  with the ones you passed on, and shows how far your fills landed from the suggested entry. That
  record caps how much conviction the next call may carry.
- **Your own agents** - an agent is a TOML file with a prompt, a model chain and a ceiling on what it
  may touch. Give it a `[focus]` and it becomes a second opinion, scored apart from your book, with
  its own daily cap and a pause switch.

### Markets

Each market brings its own factors, sources, calendar and execution playbook.

- **VN equities** (`equity-vn`) - HOSE and HNX stocks, ETFs, indices and index futures. Vietnamese
  sources, T+2 settlement, foreign and proprietary flow, distribution sessions, a disclosure
  calendar and solvency floors.
- **Crypto** (`crypto`) - spot, with funding and long/short positioning read from the perpetual
  market. Donchian breakout entries and Turtle exits. Quotes come first from the venue your crypto
  books at (Binance unless you choose another).
- **World gold** (`gold`) - real rates, the dollar, the gold-silver ratio, official demand,
  inflation and the safe-haven bid. It is a reference market: no venue holds it, and it is the
  price `gold-vn` is measured against.
- **VN gold** (`gold-vn`) - SJC bars and PNJ and DOJI rings, priced as a premium over world gold,
  with Saturday quotes and revisions on the calendar.
- **Stops and targets you can tune** per market: `maximum_stop_loss`, `stop_loss_atr` and
  `reward_risk` under `[trading.markets.<id>]`. Plans priced under your own settings keep their own
  track record.
- **Patient crypto entries** - a coin up 25% or more over its last seven sessions gets a buy limit
  half an ATR under the live price, good for five sessions. A limit that never fills closes as
  `unfilled` and stays out of every score.

### Your book

- **The ledger is the truth** - positions are worked out from the rows you recorded, by instrument
  and venue, never kept as a stored balance. Every write checks the whole book as it will stand
  afterwards, and a row dated after today is refused.
- **`/setup`** in chat asks your risk appetite and whether you trade VN stocks, crypto or both, then
  switches off the sleeve you don't trade.
- **`/record sync <venue>`** books the fills a connected exchange has and the ledger is missing.
  An exchange without its key names the variables it is waiting for.
- **Whole-book risk** - open risk is counted across every priced holding, with sleeve caps and a
  regime scale that only ever shrink a position.
- **`/rebalance`** moves drift back toward target over several runs, not in one jump.
- **`/reconcile`** compares the book with what the venue actually holds, and says when an exchange
  is only waiting for its key.
- **`/portfolio`** shows holdings, open risk, sleeve weights and recent closed positions with fees
  included; **`/portfolio nav`** shows your time-weighted return, deepest drop and a yardstick built
  from your own target mix.
- **Tranches** - `entry-tranche-pct` and `take-profit-tranche-pct` choose how much of a buy goes in
  first and how much is sold at the first target.

### Orders

- **One order path** (`/trade` and `order_place`): approved by you, capped, and mirrored into the
  ledger. Without exchange credentials there is no order path at all, and `/trade` names the keys
  to set. An order is sized only on a live price; on a stale one it is held back with a note to
  try again.
- **Crash-safe** - an order is recorded as in flight before it reaches the exchange, and the
  whole-book caps are re-read for every write. If the daemon dies mid-order, `/trade reconcile`
  lists what the exchange still holds, and the caps count it until it is settled.
- **Protection stays put** - an approved entry may leave one resting take-profit or stop-loss at
  the exchange; only `/trade cancel` removes it. `/trade reconcile` also lists exit orders at the
  exchange that OpenAlpha has no record of.
- **Venues** - OKX and Binance for crypto orders with your API keys, plus manual venues for
  anything bought elsewhere: `vps` for VN stocks, any other broker you declare under
  `[trading.venues.<id>]`, and `gold-shop`, where stops, targets and valuation use the shop's own
  buying price.
- **A stop loss by default** - a buy without one is refused unless you set
  `[trading.orders] require_stop_loss = false`.

### Research

- **`/themes`** reads the latest Vietnamese macro figures, commodity prices, sector moves and news,
  proposes the investment themes taking shape, and re-checks the ones you approve, with the case
  against each spelled out. Themes, sectors and stocks are scored 0-100 in code and checked against
  VN-Index at 3, 6 and 12 months.
- **Vietnam's economy on record** - GDP, inflation, industrial output, retail sales, trade, FDI,
  credit, investment and tourism from the statistics office, plus PMI and public-investment
  progress from the press. Every number keeps the sentence it came from; one that cannot be found
  word for word is dropped rather than guessed.
- **Policy rates, daily** - the State Bank's refinancing, rediscount and interbank rates, kept day
  by day so a history builds up.
- **Headlines kept for a year** - title, link, summary and date, so a story can be traced back to
  where it started.
- **`/research`** runs a bounded web research with plan review and claim verification. Each
  question can read several pages, so a claim can rest on more than one publisher, and a source's
  forecast is labelled as a forecast, never as an outcome.

### Where you use it

- **CLI, Telegram, Zalo and Zalo Personal** - allow-listed and paired, failing closed. Opening the
  Telegram bot shows the command list. Zalo Personal links by QR with `openalpha zalo login` and
  reconnects on its own. A channel that cannot reach its server at start stays up as degraded and
  keeps retrying in the background.
- **HTTP/WS API** - with `[api] enabled = true`, `openalpha start` serves `/v1` behind a bearer
  token, covering every trading feature with the same wording as the CLI. See
  [Operations](docs/en/operations.md#run-the-api-on-a-server) for a server set-up.
- **MCP** - `openalpha mcp serve` exposes the analyst to an MCP client, and outside MCP servers plug
  in as tools.
- **Agent social networks** - your focused agents can join networks such as Moltbook. DMs, deletes
  and posts with outside links wait for your OK. See [Social networks](docs/en/social.md).

### Under the hood

- **Many data sources** - exchanges, dealer boards, macro series and news feeds, each rate-limited,
  stamped with where it came from, and failed over in a ranked order. Endpoints are fixed in code,
  so no setting can redirect a request.
- **Refreshes follow what you use** - `/refresh` and the morning brief cover the sleeves you
  switched on and the markets where you hold, watch or wait on a call. A screen run before any data
  is loaded says to run `/refresh`. On the VN board, price
  history, financial ratios and trading flows load at the same time.
- **Deterministic factor scoring** - every contribution is published as its share of the vote; a
  factor with no reading today does not vote, and the score says so.
- **Many LLM providers** behind a fallback chain that moves down the list on provider trouble:
  hosted APIs, routers such as OpenRouter, a ChatGPT plan, Google Vertex AI and Azure OpenAI with
  your cloud account, Amazon Bedrock with a Bedrock API key, and servers on your own machine such
  as Ollama. A provider that refuses a reasoning setting gets the call once more without it.
- **Vietnamese search** - a company is found by name with or without accents.
- **Vietnamese by default**, English with `[locale] language = "en"`, and a check that stops a
  missing translation from shipping.
- **SQLite by default, PostgreSQL optional**, with reversible migrations, export/import and
  retention sweeps.
- **Cost caps** - daily, monthly and per-run in USD, with a warning at 80%. Every answer ends with
  what it cost, a brief's suggestions included.
- **`openalpha doctor`** checks config, keys, storage and the daemon, and builds the app once
  without starting it, so a config that `chat` would refuse (a home region no venue trades, a
  `default_for` naming the wrong venue, a currency other than the one your book opened in) shows
  up here first. `--online` sends each provider's first model a short test message and says
  plainly when a server on your machine is simply not running.
- **The model never sees your money** - personas get weights, percentages and lot counts; amounts,
  prices paid, cash and quantities are left out by type, not filtered at runtime.
- **Self-healing background loops** - a loop that hits an unexpected error tells you in plain words
  and restarts after an hour, up to three times, while the rest of the daemon keeps running.

[1.0.3]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.3
[1.0.2]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.2
