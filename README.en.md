<h1 align="center">OpenAlpha</h1>

<p align="center">
  <strong>A council of AI analysts that argues before every call, like <a href="https://github.com/TauricResearch/TradingAgents">TradingAgents</a>, running on your machine and chatting over Telegram and Zalo, like <a href="https://github.com/openclaw/openclaw">OpenClaw</a>.</strong><br/>
  Meet OpenAlpha, an open-source AI investment assistant you install on your own computer, for Vietnamese stocks, gold and crypto: the AI does the analysis, and placing the order is still your call.
</p>

<p align="center">
  <strong><a href="README.md">🇻🇳 Tiếng Việt</a></strong> &bull; <strong>🇬🇧 English</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/github/actions/workflow/status/alex2loop/openalpha/check.yml?branch=main&style=flat-square&label=check" alt="check" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT" />
</p>

<p align="center">
  <img src="assets/readme/hero.en.png" alt="Weak ideas are dropped before they reach you, across six steps: data, evidence, gate, debate, stages, verdict" width="100%" />
</p>

You ask about a name, and OpenAlpha gives you a plan back: where to buy, where to stop out, where to take profit, and how much fits the book you hold, with the case for buying next to the case against. It is for individual investors who run their own book and want the reasoning behind a call, not just a ticker.

- **Runs on your machine.** Your book, config and API keys stay local. The AI sees weights only, never a balance, a price paid or your total assets.
- **You approve every order.** It suggests by default. With exchange keys set, every order waits for your confirmation.
- **An AI council debates.** Bull, bear, a synthesizer, a trader, a risk analyst and a fact-checker. Code computes prices and size; the AI handles the *why*.
- **Four markets.** Vietnamese equities (the deepest, with local data sources), crypto, Vietnamese gold, and world gold for reference.

It is an analysis aid, not investment advice. Suggestions can be wrong, and every decision is yours.

<p><img src="assets/readme/new.en.svg" height="24" alt="New" /></p>

> [!TIP]
> Your whole AI team works in a pixel office right in your browser. See who is doing what, click a person to hand them work, and glance at the market panel beside it. Open it with `openalpha web` · [see how](#the-office-page).

<p align="center">
  <a href="https://zalo.me/g/yl7iqyfovvtyosujulea"><img src="https://img.shields.io/badge/Zalo-support%20group-0068FF?style=for-the-badge" alt="Zalo support group" /></a><br/>
  <sub>Stuck on setup, or want release news? Ask in the <a href="https://zalo.me/g/yl7iqyfovvtyosujulea">OpenAlpha Zalo group</a> (in Vietnamese).</sub>
</p>

<p align="center">
  <a href="#see-it-in-action">See it in action</a> · <a href="#why-openalpha">Why OpenAlpha</a> · <a href="#quick-start">Quick start</a> · <a href="#daily-use">Daily use</a> · <a href="#the-office-page">The office page</a> · <a href="#safety">Safety</a> · <a href="#faq">FAQ</a> · <a href="#documentation">Docs</a> · <a href="#contribute-to-openalpha">Contribute</a> · <a href="#stability-license-and-disclaimer">License</a>
</p>

## See it in action

Here is what one `/suggest FPT` looks like:

<p align="center">
  <img src="assets/readme/demo.en.gif" alt="Type /suggest and get a plan back: entry, stop, take-profit, size, how to manage it" width="100%" />
</p>

### A real run

Every suggestion also gives the case for buying, the case for waiting, and what would prove it wrong. Here is a real run, trimmed, with the ticker, prices and percentages masked:

```
You:  /suggest XXX

💡 XXX (16/10/2026): BUY, Medium confidence. Buy about 400 XXX (~9,280,000 VND, 4.65% of your portfolio).
  Entry xx.xx · Stop xx.xx (▼ -x.xx%) · Take 33% off at xx.xx (▲ x.xx%) · Far target xx.xx (▲ x.xx%)

🎯 How to manage it
  Don't chase it above xx.xx. Buy 200 XXX first, and add the rest later if the price comes back and holds.
  After fees: if the stop is hit you lose about 737,120 VND (0.37% of your portfolio).

🚩 I am wrong if
  The 2026 report shows operating cash flow below profit.

💬 Debate (3 review steps)
  🐂 Case for buying: cheap on earnings, profit rising, net cash.
  🐻 Case for waiting: profit runs well above its historical average; the last four quarters are unaudited.

This is analysis, not an order - the decision is always yours.
  Once you have traded, paste this: /record buy vps equity-vn:XXX 400 xxxxx VND 2026-10-16
```

### A day with OpenAlpha

https://github.com/user-attachments/assets/46ea9c20-cc72-4bfa-8bb6-272981615802

<p align="center">
  <sub>70 seconds</sub>
</p>

## Why OpenAlpha

- **Discipline, written down in advance.** The plan is fixed while you are calm, then keeps you on it, falling markets included.
- **Deepest in Vietnamese equities.** Local data, official macro figures with the source sentence quoted, and T+2 always accounted for.
- **Every call gets scored.** Each suggestion is tracked until it closes; `/reflect` shows how often it was right, and later calls get less confident when earlier ones missed.

**A bad fit if** you want a bot that trades by itself, or someone to decide for you. Neither exists here, and that is deliberate.

## Quick start

You need two things:

- **A computer** running macOS, Linux or Windows 10/11 (Windows on ARM needs Windows 11).
- **A way to use AI**, one of:
  - **An OpenRouter key** (easiest): sign up at [OpenRouter](https://openrouter.ai) and create a key at [openrouter.ai/keys](https://openrouter.ai/keys). Keep it like a password. OpenRouter lists some models at no charge; a paid model usually costs a few dollars a month.
  - **A paid ChatGPT plan**: sign in during install, no key needed.

The first four steps take about 15 minutes. After step 3 you have seen a suggestion; step 4 sizes suggestions to the money you have; step 5 can wait.

**1. Install.** Open a terminal (macOS: press ⌘ + Space and type `Terminal`; Windows: open PowerShell from the Start menu), paste the line for your machine and press Enter. Anything after `#` is a note, not something to type.

```bash
curl -fsSL https://raw.githubusercontent.com/alex2loop/openalpha/main/install.sh | sh   # macOS, Linux
```

```powershell
irm https://raw.githubusercontent.com/alex2loop/openalpha/main/install.ps1 | iex   # Windows
```

The installer downloads one self-contained binary, then asks a few questions; press Enter to take the suggested answer:

- **Language** and **the currency of your book.** The currency is chosen once, so pick the money you actually use.
- **AI service.** With an OpenRouter key, pick OpenRouter and paste the key when asked. On a ChatGPT plan, pick "ChatGPT (subscription)": your browser opens and you sign in to ChatGPT as usual; OpenAlpha runs on your plan, with no key and no extra AI charge.
- **A daily spending cap** for AI (in US dollars, spending stops there) and **Telegram** if you want messages on your phone.

At the end it sends the model one short test message; a reply means you are done. Run `openalpha onboard` any time to change any answer but the currency.

**2. Open a new window and check.** Close the old window and open a new one (so it finds the `openalpha` command), then run:

```bash
openalpha doctor --online              # sends the model one short test message
```

Skipped connecting AI during install, or the test says a key is missing? Do it now, then run the line above again:

```bash
openalpha key set OPENROUTER_API_KEY   # OpenRouter key: paste it and press Enter; nothing showing on screen is normal
openalpha auth login chatgpt           # or a ChatGPT plan: sign in in your browser
```

`openalpha key` lists which keys are set and where they come from; keys are kept in `~/.openalpha/env`, readable only by you. These commands work on Windows too. A Claude plan (Pro, Max) cannot sign in this way; to use Claude without a key, connect OpenAlpha to Claude Code over MCP ([Advanced](#advanced)).

**3. Open OpenAlpha and see your first suggestion.** There are two ways. Use either, and switch any time: both read the same book.

- **In your browser (easiest if the terminal is not your thing).** Run the two lines below; the [office page](#the-office-page) opens, with a command box at the bottom and the portfolio and suggestion tabs on the right.

  ```bash
  openalpha start --background   # runs the background service that serves the page
  openalpha web                  # opens the page in your browser (one-time sign-in link, 5 minutes)
  ```

  Next time, `openalpha web` alone opens it again.
- **In the terminal.** Run `openalpha chat` to talk to the assistant right in that window.

From here on, lines starting with `/` go into the page's command box or into `openalpha chat` (or Telegram, Zalo), not straight into the terminal. Type, one at a time:

```text
/refresh       # loads symbol lists, prices, statements (no AI call; about 5 minutes the first time)
/suggest FPT   # the assistant works through one name: buy or wait, entry, stop loss, take profit, and why
```

The first `/refresh` is slow because there is a lot to fetch; later ones are much quicker. Keep the window or page open while it runs.

**4. Say how much risk you want and record the money you have.** Type `/setup` and answer a few questions: how much risk you can take and the markets you trade. Then record the money you hold at each place; how much each suggestion buys is worked out from this book, so don't skip it. It is only a record on your machine: OpenAlpha does not connect to your brokerage account and moves no money. Swap the amounts and dates in the examples for yours; dates are year-month-day, amounts are written without separators. Open the section for the market you trade:

<details open>
<summary><b>Vietnamese stocks</b></summary>

```text
/record deposit vps 100000000 VND 2026-08-14              # 100 million VND into the VPS account
/suggest FPT                                              # take a deep look at one name
/record buy FPT 100 62000                                 # place the order in your VPS app, record it here once it fills (venue, VND, today filled in)
/record sell FPT all 65000                                # sell it all once the shares settle (T+2: two working days later); for part, give a quantity
```

Prices are in whole VND: a board price of `62.00` is recorded as `62000`, and a price ten times or more away from the latest one is asked back before it is saved. Leave the fee out and the book prices it. Only at VPS? Skip the rest of this section. With another broker (SSI, TCBS, VNDIRECT...), add it to `~/.openalpha/config.toml` with your own fee schedule, then record `ssi` instead of `vps`:

```toml
[trading.venues.ssi]
default_for = ["equity-vn"]                                # VN stocks book at SSI instead of VPS
fees = { buy = 0.0015, sell = 0.0015, sell_tax = 0.001 }
```

With accounts at both VPS and SSI, swap the `default_for` line for `markets = ["equity-vn"]`.

</details>

<details>
<summary><b>Crypto</b></summary>

USDT bought over P2P: add `fx` to the deposit, the rate you actually paid for each USDT. Buys then spend that USDT at that cost, so they take no `fx`:

```text
/record deposit binance 1000 USDT 2026-08-14 fx 26600
/record buy binance crypto:BTC 0.01 60000 USDT 2026-08-14
/record sell binance crypto:BTC all 65000                 # sell it all; USDT and today filled in
```

VND paid into the exchange: a USDT buy converts at that day's market rate. The assistant shows you first; if it looks right, type `/record confirm` to record it:

```text
/record deposit binance 26000000 VND 2026-08-14
/record buy binance crypto:BTC 0.01 60000 USDT 2026-08-14
/record confirm
```

- New to crypto? A round trip from USDT deposit to withdrawal, currency moves and checking USDT against the exchange: [trading guide](docs/en/trading.md#foreign-cash-at-a-venue).
- `binance` and `okx` are built in. For another exchange (Bybit, Bitget...), declare it like SSI above, with `markets = ["crypto"]` and `fees = { buy = 0.001, sell = 0.001, fee_asset = "base" }`.
- With Binance or OKX API keys set, `/record sync binance` pulls in your fills, and `/trade` stages a real order for you to approve:

```text
/trade spot binance:BTC buy 0.001 limit 60000 tp 70000 sl 56000   # limit buy with take-profit and stop-loss
/trade confirm                                                     # only now does the order reach the exchange
```

</details>

<details>
<summary><b>Vietnamese gold</b></summary>

This segment starts switched off. Switch it on, then record it like a stock; gold and the cash that buys it sit at the built-in `gold-shop`:

```text
/profile enable gold-vn
/price gold-vn:SJC             # today's buy-back, sell price and spread
```

```text
/record deposit gold-shop 150000000 VND 2026-08-14
/record buy gold-vn:SJC 1 140000000      # 1 tael; gold shop, VND and today filled in
/record sell gold-vn:SJC 1 145000000     # sold back to the shop at its buy-back price
```

The `gold-vn:` prefix says this is gold, not the stock that shares the SJC ticker. Smaller amounts are recorded in taels: 1 chỉ is `0.1`, and the price stays per tael. For ring gold use `PNJ-RING` or `DOJI-RING`. Stop and target are set from the shop's buy-back price, which is what you actually get when you sell. To keep each shop (SJC, PNJ...) apart, declare it like SSI above with `markets = ["gold-vn"]` and `fees = { buy = 0, sell = 0 }`, then record its name instead of `gold-shop`.

</details>

A few things that work the same in every market:

- **Taking money out:** type `/record withdrawal` with the venue, amount, currency and date, for example `/record withdrawal vps 1000000 VND 2026-08-21`.
- **Recorded something wrong?** Type `/transactions` to see each row's id. Fix it with `/update <id> ...`. To remove it, `/delete <id>` shows the row first so you can check, then `/delete <id> confirm`.
- **Dividends, splits, moving cash between two places:** type `/record` on its own and it lists every kind of row and how to write each one.
- **Just edited `config.toml`** (say, to add a broker or a gold shop)? Type `/exit`, open `openalpha chat` again, and that's it. If OpenAlpha runs in the background, run `openalpha restart` instead: it keeps the old settings until it restarts, and with `[api]` on the chat runs inside it.

Full guide to the ledger: [trading guide, the ledger](docs/en/trading.md#the-ledger).

**5. Run it in the background and get the morning brief (optional).** Skip this if you only open OpenAlpha when you need it. Do it when you want it to load data, send a brief every morning and raise price alerts while you are away. In the terminal, type `/exit` to leave the chat first; on the web page the background service has run since step 3, so skip the first line:

```bash
openalpha start --background   # run the daemon; data refreshes itself from here
openalpha autostart enable     # start it at every login, restarts included
openalpha status               # is it running? openalpha stop stops it
```

Connect Telegram or Zalo ([channels guide](docs/en/channels.md)), then type `/brief enable 08:00` in that chat for a brief before the open. A few weeks in, `/reflect` shows how the old suggestions did.

<details>
<summary><b>Using Windows, changing the AI model, updating and uninstalling</b></summary>

**Using Windows**

- **No admin rights needed.** OpenAlpha installs into `%USERPROFILE%\.local\bin`, a folder of your own account. Data and config live in `%USERPROFILE%\.openalpha`; this guide writes that folder as `~/.openalpha`.
- **`openalpha` is not recognized?** Open a new PowerShell window and try again. Still nothing? Run it directly: `& "$HOME\.local\bin\openalpha.exe"`.
- **Windows Defender blocks `openalpha.exe`?** The file is not code-signed, so it is sometimes flagged by mistake. The installer already checked it before installing. To check it yourself:
  1. Run `Get-FileHash "$HOME\.local\bin\openalpha.exe"` to get the file's hash.
  2. Compare it with the `openalpha-windows-x64.exe` line (ARM machines: `openalpha-windows-arm64.exe`) in `SHA256SUMS` on the [Releases](https://github.com/alex2loop/openalpha/releases) page.
  3. If it matches, open PowerShell as Administrator and allow that folder: `Add-MpPreference -ExclusionPath "$HOME\.local\bin"`. Don't turn your antivirus off.
- **ARM machine?** The installer picks the ARM build by itself. Installed the x64 build earlier? Run the install line again.
- **Vietnamese text shows as garbage?** Use Windows Terminal instead of the old console window.
- **Prefer WSL2?** The Linux install line (`curl ... | sh`) works there, and its data stays inside WSL2.

**Config and AI models**

- **Rather skip the questions during install?** Download [config.minimal.en.toml](config.minimal.en.toml) first: a minimal config that runs with just an OpenRouter key, every line commented. The line below **overwrites** an existing `config.toml`:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/alex2loop/openalpha/main/config.minimal.en.toml -o ~/.openalpha/config.toml --create-dirs
  ```

  ```powershell
  New-Item -ItemType Directory -Force "$HOME\.openalpha" | Out-Null; irm https://raw.githubusercontent.com/alex2loop/openalpha/main/config.minimal.en.toml -OutFile "$HOME\.openalpha\config.toml"
  ```

- **Change the AI model:** run `openalpha onboard` and pick "AI model". `openalpha provider list` lists over 70 providers; `openalpha provider models` shows models and prices.
- **Add a fallback model:** edit `[[models]]` in `config.toml`. The first entry is the main model; a later one is used only when the one before it fails or hangs:

  ```toml
  [[models]]                                   # main model
  provider = "openrouter"
  model = "deepseek/deepseek-v4.1-flash"
  api_key_env = "OPENROUTER_API_KEY"

  [[models]]                                   # fallback when OpenRouter fails
  provider = "anthropic"
  model = "claude-sonnet-4-6"
  api_key_env = "ANTHROPIC_API_KEY"
  ```

- **Rather not pay anyone for AI?** Run a model on your own machine through Ollama or vLLM.
- **More:** [models and providers](docs/en/agents.md#models-and-providers) · [`[[models]]` keys](docs/en/configuration.md#models-required-at-least-one) · [provider catalog](docs/en/configuration.md#provider-catalog) · [every config option](docs/en/configuration.md) · [config.sample.toml](config.sample.toml) (the full sample).

**Updating, backups and uninstalling**

- **Updates:** when a new release is out, the terminal mentions it once a day with what is worth knowing; in a private chat the bot mentions it weekly (daily for an important one). Run `openalpha upgrade` to move to it; your data and settings stay.
- **Backups:** `openalpha db backup` snapshots the book at any time, even while the background service runs. To go back to a snapshot, stop the background service (`openalpha stop`) and run `openalpha db restore <file> --yes`.
- **Rebuild the database and keep the book** (rarely needed):

  ```bash
  openalpha stop                        # stop the background service first
  openalpha db export --out ./keep      # export the book to ./keep
  openalpha db reset --yes              # wipe and recreate the database
  openalpha db import --in ./keep       # load the book back
  openalpha start --background          # start again, then type /refresh to reload market data
  ```

  Details: [export and import](docs/en/storage.md#export-and-import).
- **Installing on a server or in CI?** Set `OPENALPHA_NO_ONBOARD=1` to skip the questions. The top of [install.sh](install.sh) and [install.ps1](install.ps1) lists every option, such as `OPENALPHA_VERSION` to install one exact release.
- **Uninstall:**
  1. To keep your book, run `openalpha db export --out <folder>` first.
  2. Run `openalpha stop`.
  3. Delete the `openalpha` file in `~/.local/bin` (Windows: `openalpha.exe`, and `openalpha.exe.old` if present).
  4. Delete the `~/.openalpha` folder if you want the book and settings gone too.

</details>

## Daily use

Most everyday commands work on data already on your machine and never call the AI. The ones that do count against the spending cap you set during install.

| You want | Type | Calls the AI? |
|---|---|---|
| The morning read, before the open | `/brief` · `/brief enable 08:00` | yes: one short read per held or watched name; a name already read today is reused |
| A deep read on one name | `/suggest FPT` | yes |
| A question researched, with sources | `/research <question>` | yes (`quick` is the lightest depth) |
| Themes forming in Vietnam | `/themes` | yes, at most $1 a run by default |
| Rank a whole market | `/screen equity-vn 20` | no |
| Follow a few names' prices | `/watchlist add FPT HPG` · `/watchlist` | no |
| Load missing data for the markets you use (`force`: reload it all) | `/refresh` · `/refresh equity-vn force` | no |
| Boards, macro, one price | `/market` · `/overview` · `/price FPT` | no |
| See the book, steer it back to target | `/portfolio` · `/rebalance` | no |
| How the book has really done, deposits taken out | `/portfolio nav` | no |
| Catch the book up to the exchange (needs an exchange API key) | `/record sync okx` · `/reconcile` | no |
| Find out how past suggestions did | `/reflect` | no |

What a command that calls the AI costs depends on the model you pick: a cheaper model costs less, and `[budget]` caps it either way. `openalpha cost` shows what today, the week or the month cost (`--breakdown` splits it by model), and the office page shows beside each command what it usually costs, taken from its last few runs ([budgets](docs/en/budgets.md#finding-out-what-cost)).

The figures in this README only illustrate the syntax; they are not trade ideas. Every command: `/help` in chat, or [commands.md](docs/en/commands.md).

## The office page

<p align="center">
  <img src="assets/readme/office.en.gif" alt="The OpenAlpha office page: a top-down pixel office with a data store, library, meeting room, lobby, alert desk and assistant room; the staff move as the daemon's real runs start and finish, a price tape scrolls across the top and a command box sits at the bottom" width="100%" />
</p>

The office page is a glass wall into the daemon: your assistant, the research crew and your own agents work in their rooms, and everything that moves is a real run, a real step or a real question waiting for you; nothing is scripted to look busy. Beside it sit your portfolio, suggestions, chat and command box. The page never places an order and never starts an AI run by itself.

Open it with `openalpha web` while the background service runs ([step 3](#quick-start) above). What the page shows, how to use it and how to reach it from another machine: [the office page](docs/en/operations.md#the-office-page) · [run the API on a server](docs/en/operations.md#run-the-api-on-a-server). The same API serves your own app too: see [Advanced](#advanced).

## How it works

For every name you ask about, six AI analysts argue it over three rounds: bull, bear, a synthesizer, then a trader, a risk analyst and a fact-checker. For a Vietnamese stock, a whole series of checks can each stop the idea. **Not one of them is allowed to write a number.** Entry, stop, target and size are computed in code before the debate even opens. The model's job is the *why*, and the *what would make this wrong*.

<p align="center">
  <img src="assets/readme/debate.en.png" alt="An AI panel argues in three rounds: two sides, synthesis, plan and check" width="100%" />
</p>

### Discipline instead of emotion

<p align="center"><img src="assets/readme/discipline.en.png" alt="Lose the emotion, keep the discipline: emotional habits and the OpenAlpha rule that replaces each" width="100%" /></p>

**No FOMO, no hoping a loser comes back.** The hard part is rarely knowledge; it is the moment you press the button.

<details>
<summary><b>How it keeps you disciplined, including when the market turns down</b></summary>

- **A stop can only move up, never down.** There is no "just a little lower" button.
- **No need to stare at the price board.** Set a level with `/alert create FPT above 130000` (the full price, as in `/record`); when the price reaches it, OpenAlpha messages you on Telegram or Zalo.

**When the market turns down,** the goal is not to call the bottom but to keep enough capital to play the next round:

- **A weaker market means smaller positions.** Each segment's cap tightens and suggested sizes shrink.
- **A cap on the whole portfolio.** Many small positions cannot add up to one big bet.
- **One command stops buying.** With an exchange key set, `/trade halt` blocks every new buy through OpenAlpha until you type `/trade resume`; sells and stops keep working.

</details>

OpenAlpha does not promise you will never lose. It keeps each loss small, planned and known in advance.

<details>
<summary><b>Tuning your stop and take-profit</b></summary>

OpenAlpha does not use one flat percentage for every name, because 8% is a long way for a slow bank stock and just a few days of noise for a jumpy small cap. Instead, the stop sits at a distance set by each name's normal daily range, and the target is a few times that distance, so your reward-to-risk stays what you chose.

Want the familiar "never lose more than 8%" shape? Add this to `config.toml` and restart:

```toml
[trading.markets.equity-vn]
maximum_stop_loss = 0.08   # stop never sits more than 8% below entry
reward_risk = 3            # target 3x the risk: an 8% stop means a target near +24%
```

- **Taking profit in parts:** once the price has gone up by one stop distance, OpenAlpha suggests selling part of the position to lock in a gain (a third by default); the rest rides on, with the stop raised behind the price. To sell half instead, type `/profile set take-profit-tranche-pct 0.5`.
- **Changing these levels** starts a new track record for that market, so `/reflect` never mixes old plans with new ones.
- Details: [setting the stop and target](docs/en/trading.md#setting-the-stop-and-target-per-market).

</details>

### Markets and data

<p align="center">
  <img src="assets/readme/markets.en.png" alt="One assistant, four markets: VN equities, crypto, world gold, VN gold" width="100%" />
</p>

| Market | Market id | What it brings |
|---|---|---|
| **VN equities** | `equity-vn` | The deepest: follows foreign and proprietary flow, the disclosure calendar and financial health, and always plans around T+2. |
| **Crypto** | `crypto` | Spot only. Buys when price clears its recent high, with a stop that moves up behind the price, and reads the futures market to show how much leverage traders are using. |
| **VN gold** | `gold-vn` | Compared with the world price, so you can tell a real move from a shop widening its spread. Off by default; switch it on with `/profile enable gold-vn`. |
| **World gold** | `gold` | Reference only: its price, and the yardstick for VN gold. |

A bare ticker is usually enough (`/price FPT`). Qualify it only where two markets could claim the same name: `/suggest crypto:UNI`.

<p align="center">
  <img src="assets/readme/sources.en.png" alt="Data sources routed per market: VN equities, crypto, VN gold, world gold, VN macro, US macro and cross-market" width="100%" />
</p>

OpenAlpha routes 37 data sources per market; when one fails, a backup takes over by itself ([data sources](docs/en/data-sources.md)). Data lives in SQLite, already on your machine. Over 70 AI providers work, and when one stalls the run moves to the next. Talk to it from the terminal, Telegram, Zalo, Zalo Personal or the office page.

### Research with receipts

Ask a question that needs fresh outside data, and get back a report where every claim can show where it came from. The model never goes online itself: code searches and fetches the pages first, so the model cannot invent a source, and where evidence is missing the report says so.

**The search provider sets the depth.** The default is DuckDuckGo: keyless and costs nothing, but thin, so a question about fresh figures often comes back empty. Set `[web_search]` to Exa, Tavily, Brave, Serper or DeepSeek ([configuration](docs/en/configuration.md)) and the report draws on far more sources; of those, DeepSeek is the cheapest and strong on Vietnamese sources.

Details: [docs/en/research.md](docs/en/research.md)

## Safety

- **The AI never sees your money.** The analyst gets weights only, never a balance, a price paid or your total assets.
- **It places no orders on its own.** It suggests by default. Without exchange keys the order path does not exist; with them, every order waits for your confirmation.
- **Everything stays on your machine.** The book and the config live locally; keys come from your environment or from `~/.openalpha/env` (readable only by you). OpenAlpha writes that file only when you type a key into `onboard` or `openalpha key set`, and never prints a key back.
- **Your book is backed up every day.** While it runs in the background, OpenAlpha copies the SQLite book into `~/.openalpha/backups/daily/` and keeps the newest three ([backup and restore](docs/en/storage.md#sqlite-backup-and-restore)).
- **AI spend has a ceiling.** A daily cap is set during install; add a monthly or per-run cap in `[budget]`, so a bad loop cannot run up a bill ([budgets](docs/en/budgets.md)).

Every other safeguard: [safety.md](docs/en/safety.md) · [SECURITY.en.md](SECURITY.en.md).

## FAQ

- **What does it cost?** OpenAlpha itself is open source under MIT; you pay only your AI provider. The [Daily use](#daily-use) table says which commands call the AI, and `openalpha cost` shows what they cost. You set a daily spending cap during setup.
- **Do I need a powerful machine?** No. The AI runs on the provider's servers; your machine runs one light program. Only running a model locally (Ollama) needs real hardware.
- **Can I use it without coding?** Yes. You paste a few commands into a terminal once, at install; after that you ask in plain language on the web page, in the terminal, or over Telegram or Zalo.
- **Can I trust the suggestions?** They can be wrong, and it does not hide that: `/reflect` shows the real record of every past call.

## Documentation

New here? Start with the [docs index](docs/en/README.md): it points you to the pages for setup, everyday commands and what each number means. No code needed for any of the guides. Advanced below is for when you want to extend it; the table at the end points to the full page for each topic.

### Advanced

<details>
<summary><b>Your own analysts</b></summary>

Beside the main analyst, you can add analysts of your own, each one a TOML file: a brief, the tools it may use, and a spending cap. Give it a `[focus]` and it becomes a **second opinion** with its own taste. Its calls are scored apart and never touch the stops, alerts or morning brief of your main book:

```bash
openalpha agent add banks      # writes a starter file; `agent edit banks` to change it
```

```toml
system_prompt = "Look only at bank stocks, held long, with a steady dividend."
max_daily_usd = 0.5                 # its own daily cap

[focus]
markets = ["equity-vn"]
sectors = ["banks"]
horizon = "long"

[capabilities]
tools = ["suggestion_run", "suggestion_track_record", "market_screen", "market_price", "market_news"]
```

Ask it with `openalpha chat --agent banks`, or point a Telegram/Zalo chat at it with `/agent banks`. `openalpha agent list` shows how often it has been right and how often it agrees with your other agents; `agent pause banks` switches it off at once, with no restart. Details: [docs/en/agents.md](docs/en/agents.md)

</details>

<details>
<summary><b>Plug into Claude Code, Cursor, VS Code... (MCP)</b></summary>

Run OpenAlpha as an MCP server inside Claude Code, Codex, Cursor, VS Code or Gemini CLI: that app's own model does the thinking, so you need no AI provider key of your own.

```bash
openalpha mcp install      # or --host codex, cursor, vscode, gemini, muse, opencode, zed
```

Suggestions written that way are scored separately in `/reflect` under `client:<model>`, and orders are never placed from there. Details: [docs/en/dev/extending.md](docs/en/dev/extending.md)

</details>

<details>
<summary><b>Your own app (API)</b></summary>

The daemon serves a local HTTP and WebSocket API on `127.0.0.1`, behind a token (`[api] enabled = false` turns it off). A client app gets your book, quotes, suggestions and chat, plus a live feed of what the daemon is running right now: each run and its steps, approvals and questions waiting on any channel, fills, and spend caps reached. It is also the API the [office page](#the-office-page) uses. How to reach it from another machine: [docs/en/operations.md](docs/en/operations.md#run-the-api-on-a-server).

</details>

### Full reference

| Topic | Page |
|---|---|
| Markets, suggestions, the ledger, the portfolio, placing orders | [trading.md](docs/en/trading.md) |
| Every CLI and chat command | [commands.md](docs/en/commands.md) |
| Every key in `config.toml` | [configuration.md](docs/en/configuration.md) |
| Which data source answers what | [data-sources.md](docs/en/data-sources.md) |
| AI integration: your own analysts, skills, choosing models | [agents.md](docs/en/agents.md) |
| Web research with citations | [research.md](docs/en/research.md) |
| Telegram and Zalo | [channels.md](docs/en/channels.md) |
| Approvals and safeguards | [safety.md](docs/en/safety.md) |
| Budgets, the daemon and the office page, storage | [budgets.md](docs/en/budgets.md) · [operations.md](docs/en/operations.md) · [storage.md](docs/en/storage.md) |
| SDK, MCP and extending | [dev/extending.md](docs/en/dev/extending.md) |

## Contribute to OpenAlpha

OpenAlpha is open source and run by one person today, so every contribution makes a real difference. You do not need to write code to help.

- **Use it for real, then tell us.** A bug report with the command you ran, what you expected and what you got (and the market) beats any compliment. Open it on [GitHub Issues](https://github.com/alex2loop/openalpha/issues/new/choose).
- **Docs and wording.** A confusing sentence, a term that is off, a place where Vietnamese and English disagree: fix it in `docs/` or in the two catalogs under `src/i18n/locales/`.
- **Data sources, exchanges, brokers, new markets.** Each is a local change: one adapter, one registration line and the locale keys. Open an issue first for anything structural.
- **Agents and skills.** An analyst of your own is one TOML file; a plugin data source is one `sources.ts`.

**Good first steps:** issues labelled [good first issue](https://github.com/alex2loop/openalpha/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22). **Roadmap:** there is no separate page yet; planned work and new ideas are discussed in [Issues](https://github.com/alex2loop/openalpha/issues). The directions already ruled out (auto-trading, a backtest harness...) are in [CONTRIBUTING.en.md](CONTRIBUTING.en.md#things-that-will-be-turned-down), with the reasons.

### Run from source

```bash
git clone https://github.com/alex2loop/openalpha.git && cd openalpha
bun install
bun run dev -- onboard

bun run check       # lint + typecheck + the contract gates
bun run lint:arch   # the architecture gates
```

Both commands must pass before anything lands. House rules and the business invariants: [AGENTS.md](AGENTS.md). A clone updates with `git pull`.

Architecture: 16 modules with no cycles, every dependency pointing toward the kernel; 32 gates break the build the moment a boundary does. Contributing: [CONTRIBUTING.en.md](CONTRIBUTING.en.md) · [Code of conduct](CODE_OF_CONDUCT.en.md).

### Support and community

- **Setup and usage questions, release news:** the [OpenAlpha Zalo group](https://zalo.me/g/yl7iqyfovvtyosujulea), in Vietnamese. It covers using the software, never which name to buy. Mask your API keys before pasting a config. Admins never message you privately for keys or money.
- **Bugs and feature requests:** [GitHub Issues](https://github.com/alex2loop/openalpha/issues/new/choose). A bug is tracked only once it has an issue.
- **Security vulnerabilities:** report privately per [SECURITY.en.md](SECURITY.en.md), never in the group or an issue.

Find it useful? Give the repo a ⭐ so more people find it.

## Stability, license and disclaimer

**Stability.** This is an early-stage tool that has run live daily for months - so it is sure-footed at the things it does every day, and rough everywhere else. There is no test suite; breaking changes land between versions; and assets cannot yet move between venues.

**License.** MIT, for the code. Use it however you want. The name, logo and Bé Alpha are not part of the license: see [NOTICE.en.md](NOTICE.en.md#name-and-logo-are-not-licensed).

**The data is a separate question.** OpenAlpha ships no market data - it reads from each provider at run time, on your machine, and their terms are between you and them. [NOTICE.en.md](NOTICE.en.md) names every host it can reach and what to check before you point it at one.

OpenAlpha is a research and bookkeeping assistant. Its suggestions are educational, **can be wrong, and are not financial advice**. It does not know your full circumstances, it places an order only when you approve one, and markets do what they like. You own every decision. Never risk money you cannot afford to lose.
