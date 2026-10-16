<h1 align="center">OpenAlpha</h1>
<h3 align="center">An AI panel debates. Layer after layer of checks. Zero orders placed without you.</h3>

<p align="center">
  <strong><a href="README.md">🇻🇳 Tiếng Việt</a></strong> &bull; <strong>🇬🇧 English</strong>
</p>

<p align="center">
  A self-hosted AI analyst for people who run their own book. Deepest in <strong>Vietnamese equities</strong>, with local data sources, then <strong>crypto</strong> and gold.<br/>
  Every morning before the open, it screens the whole market, picks the few names worth a look, works out how much of each fits the book you hold, and gives the case for buying next to the case against.<br/>
  <strong>That is where it stops. Placing the order is your job, and only yours.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/github/actions/workflow/status/alex2loop/openalpha/check.yml?branch=main&style=flat-square&label=check" alt="check" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT" />
</p>

<p align="center">
  <a href="https://zalo.me/g/yl7iqyfovvtyosujulea"><img src="https://img.shields.io/badge/Zalo-support%20group-0068FF?style=for-the-badge" alt="Zalo support group" /></a><br/>
  <sub>Stuck on setup, or want release news? Ask in the <a href="https://zalo.me/g/yl7iqyfovvtyosujulea">OpenAlpha Zalo group</a> (in Vietnamese).</sub>
</p>

<p align="center">
  <img src="assets/readme/hero.en.png" alt="Weak ideas are dropped before they reach you, across six steps: data, evidence, gate, debate, stages, verdict" width="100%" />
</p>

<p align="center">
  <em>The model can read everything about the name you asked for, except one thing: your money.</em>
</p>

---

<p align="center">
  <a href="#try-it-in-3-commands">Try it</a> · <a href="#getting-started">Getting started</a> · <a href="#daily-use">Daily use</a> · <a href="#safety">Safety</a> · <a href="#faq">FAQ</a> · <a href="#advanced">Advanced</a>
</p>

## Why OpenAlpha

- **Code does the numbers, the AI explains them.** Entry, stop, target and size are computed in advance; the AI argues why to buy and why to stay away.
- **The AI never sees your money.** Sizes fit your own portfolio, but the model only ever sees weights.
- **Deepest in Vietnamese equities.** Local data, official macro figures with the source sentence quoted, and T+2 always accounted for.
- **It never places orders on its own.** You decide, you trade, then you record it. A few weeks in, `/reflect` shows how often it was right.

**A good fit if** you run your own book, you want the reasoning behind a call rather than just the ticker, and you want your API keys to stay on your own machine. **A bad fit if** you want a bot that trades by itself, or someone to decide for you. Neither exists here, and that is deliberate.

## Try it in 3 commands

```bash
curl -fsSL https://raw.githubusercontent.com/alex2loop/openalpha/main/install.sh | sh   # install
export OPENROUTER_API_KEY="..."   # AI key, from openrouter.ai
openalpha chat                    # then type /refresh, and once it finishes, /suggest FPT
```

<p align="center">
  <img src="assets/readme/demo.en.gif" alt="Type /suggest and get a plan back: entry, stop, take-profit, size, how to manage it" width="100%" />
</p>

Windows, brokers other than VPS, crypto, gold and the morning brief: see [Getting started](#getting-started).

## How it differs from asking an AI chatbot

| | A typical chatbot | OpenAlpha |
|---|---|---|
| Vietnamese figures | may guess, no source | from local sources, with the source sentence quoted |
| Entry and stop | the AI makes them up | computed in code, identical on every rerun |
| How much to buy | knows nothing about your portfolio | sized from your own book, the AI never sees the amount |
| Right or wrong | nobody keeps score | `/reflect` scores every past suggestion |
| Your book | sits on someone else's service | sits on your machine |

---

## Ask once, get this back

Every buy decision comes down to two questions: is this name worth buying, and what is that advice based on?

A real run, trimmed, ticker and prices masked:

```
You:  /suggest XXX

💡 XXX (16/10/2026): BUY, Medium conviction. Buy about 400 XXX (~9,280,000 VND, 4.65% of your portfolio).
  Entry xx.xx · Stop xx.xx (▼ -7.54%) · Take 33% off at xx.xx (▲ 7.97%) · Far target xx.xx (▲ 23.92%)

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

Six AI analysts argued this name: bull, bear, a synthesizer, then a trader, a risk analyst and a fact-checker. Ten Vietnamese-stock stages all had the power to kill it. **Not one of them was allowed to write a number.** Entry, stop, target, size - the code had finished all of it before the debate even opened. The model's job is the *why*, and the *what would make this wrong*.

<p align="center">
  <img src="assets/readme/debate.en.png" alt="An AI panel argues in three rounds: two sides, synthesis, plan and check" width="100%" />
</p>

---

https://github.com/user-attachments/assets/46ea9c20-cc72-4bfa-8bb6-272981615802

<p align="center">
  <sub>An office worker's day (70 s)</sub>
</p>

---

## Discipline instead of emotion

<p align="center"><img src="assets/readme/discipline.en.png" alt="Lose the emotion, keep the discipline: emotional habits and the OpenAlpha rule that replaces each" width="100%" /></p>

**No FOMO, no hoping a loser comes back.** The hard part is rarely knowledge; it is the moment you press the button. OpenAlpha fixes the plan while you are calm, then keeps you on it.

<details>
<summary><b>How it keeps you disciplined, including when the market turns down</b></summary>

- **Numbers set in advance, no haggling mid-trade.** Entry, stop, take-profit and size are computed by code, and the AI cannot change them.
- **A stop can only move up, never down.** There is no "just a little lower" button.
- **No need to stare at the price board.** In Telegram or Zalo, set a level with `/alert create FPT above 130` (board price) and you get a message when price reaches it.
- **Every wrong call is recorded, and the next one is less sure of itself.** The record in `/reflect` caps how confident later suggestions may be.

**When the market turns down,** the goal is not to call the bottom but to keep enough capital to play the next round:

- **A weaker market means smaller positions.** Each asset group's cap tightens and suggested sizes shrink.
- **A cap on the whole portfolio.** Many small positions cannot add up to one big bet.
- **One command stops buying.** With an exchange key set, `/trade halt` blocks every new buy through OpenAlpha until you type `/trade resume`; sells and stops keep working.

</details>

OpenAlpha does not promise you will never lose. It keeps each loss small, planned and known in advance.

---

## Markets and data

<p align="center">
  <img src="assets/readme/markets.en.png" alt="One assistant, four markets: VN equities, crypto, world gold, VN gold" width="100%" />
</p>

| Market | Market id | What it brings |
|---|---|---|
| **VN equities** | `equity-vn` | The deepest: follows foreign and proprietary flow, the disclosure calendar and financial health, and always plans around T+2. |
| **Crypto** | `crypto` | Spot only. Buys when price clears its recent high, with a stop that moves up behind the price, and reads the futures market to show how much leverage traders are using. |
| **VN gold** | `gold-vn` | Compared with the world price, so you can tell a real move from a shop widening its spread. |
| **World gold** | `gold` | Reference only: its price, and the yardstick for VN gold. |

A bare ticker is usually enough (`/price FPT`). Qualify it only where two markets could claim the same name: `/suggest crypto:UNI`.

<p align="center">
  <img src="assets/readme/sources.en.png" alt="35 data sources, routed per market" width="100%" />
</p>

Data lives in SQLite, already on your machine. Over 70 AI providers work, and when one stalls the run moves to the next. Talk to it from the terminal, Telegram, Zalo or Zalo Personal.

<details>
<summary><b>Supported AI providers</b></summary>

Already have a key from a lab? Use it directly: Anthropic, OpenAI, Google Gemini, xAI, Mistral, DeepSeek, Cohere, Meta AI, Moonshot Kimi, Z.AI, MiniMax, Alibaba Qwen, StepFun, Xiaomi MiMo, Perplexity and more.

For one key that reaches many models, go through a router such as OpenRouter, Requesty, Vercel AI Gateway, Hugging Face or GitHub Models. For speed or price there are Groq, Cerebras, SambaNova, Fireworks, Together, DeepInfra, Novita, Nebius, NVIDIA and Cloudflare Workers AI.

Paying for ChatGPT already? Sign in with `openalpha auth login`, no key needed. If your company runs on Azure, Google Cloud or AWS, reach the models through Azure OpenAI, Vertex AI or Bedrock with the account you have. In China there are Baidu ERNIE, Doubao, Hunyuan, Yi, Baichuan, iFlytek Spark, SiliconFlow, ModelScope, and mainland endpoints for Kimi, Qwen, GLM and MiniMax. To run everything on your own machine, use Ollama, LM Studio or vLLM.

Run `openalpha provider list` for the full list with the name each one takes in the config ([guide](docs/en/configuration.md)). No key at all works too: plug OpenAlpha into Claude Code, Codex or Cursor over MCP and that app's model does the thinking ([Advanced](#advanced)).

</details>

---

## Safety

- **The AI never sees your money.** The analyst gets weights only, never a balance, a price paid or your total assets.
- **It places no orders on its own.** It suggests by default. Without exchange keys the order path does not exist; with them, every order waits for your confirmation.
- **Everything stays on your machine.** The book and the config live locally; API keys are read from the environment only, never written to a file.
- **AI spend is capped** per day and per month, so a bad loop cannot run up a bill.

All 16 safeguards: [SECURITY.en.md](SECURITY.en.md).

---

## Getting started

You need a Mac, a Linux machine or Windows 10/11, and one AI provider key. [OpenRouter](https://openrouter.ai) has free models too; a paid model usually costs a few dollars a month.

**1. Install.** One line. It downloads one self-contained binary, then asks a few questions (language, AI model, a daily spending cap, Telegram if you want it). Run `openalpha onboard` any time to change them.

```bash
curl -fsSL https://raw.githubusercontent.com/alex2loop/openalpha/main/install.sh | sh
```

```powershell
powershell -c "irm https://raw.githubusercontent.com/alex2loop/openalpha/main/install.ps1 | iex"   # Windows
```

**2. Set your AI key and check.** Open a new terminal:

```bash
export OPENROUTER_API_KEY="..."   # add this line to the end of ~/.zshrc (macOS) or ~/.bashrc (Linux) to keep it
openalpha doctor --online         # sends the model one short test message
```

On Windows: `setx OPENROUTER_API_KEY "..."`, open a new PowerShell, then `openalpha doctor --online`.

**3. Load the data and say how much risk you want.** Run `openalpha chat`, then type:

```text
/refresh     # first time: loads symbol lists, prices, statements (free, a few minutes)
/setup       # pick your risk level and the markets you trade
```

**4. Record the money you have, for the markets you trade.** Every suggestion is sized from this book, so don't skip it.

<details open>
<summary><b>Vietnamese stocks</b></summary>

```text
/record deposit vps 100000000 VND 2026-08-14              # 100 million VND into the VPS account
/suggest FPT                                              # take a deep look at one name
/record buy vps equity-vn:FPT 100 62000 VND 2026-08-14    # place the order yourself, record it once it fills
```

Prices are in whole VND: a board price of `62.00` is recorded as `62000`. Leave the fee out and the book prices it. With another broker (SSI, TCBS, VNDIRECT...), add it to `~/.openalpha/config.toml` with your own fee schedule, then record `ssi` instead of `vps`:

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
```

VND paid into the exchange: a USDT buy converts at that day's market rate. The assistant shows you first; if it looks right, type `/record confirm` to record it:

```text
/record deposit binance 26000000 VND 2026-08-14
/record buy binance crypto:BTC 0.01 60000 USDT 2026-08-14
/record confirm
```

- New to crypto? A round trip from USDT deposit to withdrawal, currency moves and checking USDT against the exchange: [trading guide](docs/en/trading.md#foreign-cash-at-a-venue).
- `binance` and `okx` are built in. For another exchange (Bybit, Bitget...), declare it like SSI above, with `markets = ["crypto"]` and `fees = { buy = 0.001, sell = 0.001, fee_asset = "base" }`.
- With Binance or OKX API keys set, `/record sync binance` pulls in your fills, and `/trade` stages an order for you to approve:

```text
/trade spot binance:BTC buy 0.001 limit 60000 tp 70000 sl 56000   # limit buy with take-profit and stop-loss
/trade confirm                                                     # only now does the order reach the exchange
```

</details>

<details>
<summary><b>Vietnamese gold</b></summary>

This sleeve starts switched off. Switch it on, declare where you buy gold, then record it like a stock:

```text
/profile enable gold-vn
/price SJC                     # today's buy-back, sell price and spread
```

```toml
[trading.venues.sjc]
markets = ["gold-vn"]
fees = { buy = 0, sell = 0 }   # the shop charges no separate fee; the spread is in the price
```

```text
/record deposit sjc 150000000 VND 2026-08-14
/record buy sjc gold-vn:SJC 1 120000000 VND 2026-08-14   # 1 tael
```

Smaller amounts are recorded in taels: 1 chỉ is `0.1`, and the price stays per tael. For ring gold use `gold-vn:PNJ-RING` or `gold-vn:DOJI-RING`. Stop and target are set from the shop's buy-back price, which is what you actually get when you sell.

</details>

To sell: `/record sell vps equity-vn:FPT all 65000 VND 2026-08-20` (`all` sells the whole position, or give a quantity). To withdraw: `/record withdrawal vps 1000000 VND 2026-08-21`. Dates are always year-month-day. Recorded something wrong? `/transactions` shows each row's id, then `/update <id> ...` fixes it or `/delete <id>` removes it. Type `/record` on its own to see every kind of row (dividends, splits, transfers...).

**5. Turn on the morning brief.** `openalpha start --background` keeps it running (and data refreshes itself). Connect Telegram or Zalo ([channels guide](docs/en/channels.md)), then type `/brief enable 08:00` in that chat. `openalpha status` tells you whether it is running, `openalpha stop` stops it. A few weeks in, `/reflect` shows how the old suggestions did.

<details>
<summary><b>Windows, minimal config, updates, uninstall</b></summary>

- **No admin rights needed.** `openalpha.exe` goes in `%USERPROFILE%\.local\bin`, and that folder is added to your user PATH. If `openalpha` is not recognized, open a new PowerShell window, or run `& "$HOME\.local\bin\openalpha.exe"` directly. Data and config live in `%USERPROFILE%\.openalpha`, the `~/.openalpha` this guide refers to.
- **Windows Defender blocks `openalpha.exe`?** The binary is not code-signed, so it is sometimes flagged by mistake. The installer already checked it against the release's `SHA256SUMS`; to check yourself, run `Get-FileHash "$HOME\.local\bin\openalpha.exe"` and compare it with the `openalpha-windows-x64.exe` line on the [Releases](https://github.com/alex2loop/openalpha/releases) page. If it matches, exclude the folder, in PowerShell run as Administrator: `Add-MpPreference -ExclusionPath "$HOME\.local\bin"`. Don't turn antivirus off.
- **Vietnamese text shows garbage?** Use Windows Terminal instead of the old console window. **Prefer WSL2?** The `curl ... | sh` line works there, with its own `~/.openalpha`.
- **Rather not answer questions during install?** Take [config.minimal.toml](config.minimal.toml): it runs as is with just an OpenRouter key, every line commented. This overwrites an existing `config.toml`:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/alex2loop/openalpha/main/config.minimal.toml -o ~/.openalpha/config.toml --create-dirs
  ```

  ```powershell
  New-Item -ItemType Directory -Force "$HOME\.openalpha" | Out-Null; irm https://raw.githubusercontent.com/alex2loop/openalpha/main/config.minimal.toml -OutFile "$HOME\.openalpha\config.toml"
  ```

- **Every config option:** [config.sample.toml](config.sample.toml) · [docs/en/configuration.md](docs/en/configuration.md). No AI key? Run a local model through Ollama or vLLM.
- **Installing on a server or in CI?** Set `OPENALPHA_NO_ONBOARD=1` to skip the questions; the top of [install.sh](install.sh) and [install.ps1](install.ps1) lists every option, such as `OPENALPHA_VERSION` to install one exact release.
- **Updates:** the CLI mentions a new release once a day; `openalpha upgrade` takes you there and keeps your data and settings.
- **Uninstall:** `openalpha stop`, then delete the `openalpha` file (in `~/.local/bin` by default; on Windows `openalpha.exe`, and `openalpha.exe.old` if present). `~/.openalpha` holds your whole book and config: run `openalpha db export --out <folder>` first if you want to keep them.

</details>

---

## Daily use

Most of what you do every day is **free**: those commands work on data already on your machine and never call the AI. The figures below were measured on 2026-10-15 with cheap models (`gpt-6-luna` for the debate, `claude-haiku-5.5` for research); dearer models cost more, and `[budget]` caps it either way.

| You want | Type | Costs? |
|---|---|---|
| The morning read, before the open | `/brief` · `/brief enable 08:00` | yes: one short read per held or watched name; names already read today are free |
| A deep read on one name | `/suggest FPT` | about $0.01 |
| A question researched, with sources | `/research <question>` | about $0.03 (`quick`) |
| Themes forming in Vietnam | `/themes` | yes, at most $1 a run by default |
| Rank a whole market | `/screen equity-vn 20` | **free** |
| Follow a few names' prices | `/watchlist add FPT HPG` · `/watchlist` | **free** |
| Load missing data for the markets you use (`force`: reload it all) | `/refresh` · `/refresh equity-vn force` | **free** |
| Boards, macro, one price | `/market` · `/overview` · `/price FPT` | **free** |
| See the book, steer it back to target | `/portfolio` · `/rebalance` | **free** |
| How the book has really done, deposits taken out | `/portfolio nav` | **free** |
| Record deposits, withdrawals, buys, sells | `/record` | **free** |
| Catch the book up to the exchange (needs an exchange API key) | `/record sync okx` · `/reconcile` | **free** |
| Find out how your calls did | `/reflect` | **free** |
| Place a trade, deliberately (needs an exchange API key) | `/trade` then `/trade confirm` | - |

The figures in this README only illustrate the syntax; they are not trade ideas. Everything else: `/help` in chat, or [docs/en/commands.md](docs/en/commands.md).

---

## Research with receipts

Ask a question that needs fresh outside data, and get back a report where every claim can show where it came from. The example below is a real run, trimmed and translated from Vietnamese.

<details>
<summary><b>See a real run and how sources are checked</b></summary>

```
You:  /research quick What did FPT earn in the first eight months of 2026,
      and what do brokers forecast for the year?

2 searches · 3 pages read
2 sources used · 4 supported claims
⚠️ 2 evidence issues
  • Not enough source support was found for a claim. ×2
✓ Complete with gaps · Evidence level: mixed

⏺ No eight-month 2026 profit figure for FPT was found, and no broker full-year
forecast either. The latest figures found:
- Five months: net profit to parent VND 4,199 bn, +16% (Vietcap).
- Six months: pre-tax profit VND 5,714 bn, +18.1% (Bao Dau tu).
- FPT's own full-year plan (not a forecast): pre-tax profit VND 11,629 bn.

$0.0111 · done in 34.4 seconds
```

- **The model never touches the network.** Code searches and fetches first, and the model reads only what code collected, so it cannot invent a source.
- **Quotes are checked word for word.** A claim must rest on an excerpt that is really on the fetched page; a quote that does not match, or a claim short of sources, is flagged like the ⚠️ line above.
- **A forecast stays a forecast.** Price targets, estimates and company guidance are marked and presented as someone's forecast, never as an outcome.
- **Missing means missing.** With no eight-month figure, the report says so and gives the latest one instead of guessing. Two sources that disagree on a number are reported as a conflict.
- **Three depths:** `quick`, `standard` (the default) and `thorough`, where you see and can edit the research plan once before it runs.

</details>

- **The search provider sets the depth.** The default is DuckDuckGo: free and keyless, but thin, so a question about fresh figures often comes back empty. Set `[web_search]` to Exa, Tavily, Brave or Serper ([configuration](docs/en/configuration.md)) and the report draws on far more sources.

Details: [docs/en/research.md](docs/en/research.md)

---

## FAQ

- **What does it cost?** The software is free; you pay only your AI provider: about $0.01 to look at one name and about $0.03 for a quick research run on a cheap model. Most other commands call no AI. You set a daily spending cap during setup.
- **Do I need a powerful machine?** No. The AI runs at the provider; your machine runs one small binary. Only running a model locally (Ollama) needs real hardware.
- **Can I use it without coding?** Yes. You paste a few commands into a terminal once; after that you ask in plain language, or chat over Telegram or Zalo.
- **Does the AI see my money or place orders?** No. See [Safety](#safety).
- **I don't use VPS, or I hold crypto or gold?** All of them can be recorded. See the blocks in [Getting started](#getting-started).
- **Can I trust the suggestions?** They can be wrong. `/reflect` shows the real record, and later suggestions get lower conviction when earlier ones missed often.
- **Where does my data live?** In `~/.openalpha` on your machine. Back it up with `openalpha db export --out <folder>`.

---

## Advanced

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

Plug it into Claude Code, Codex, Cursor, VS Code or Gemini CLI as an MCP server, and that app's own model does the thinking - no AI provider key of your own required:

```bash
openalpha mcp install      # or --host codex, cursor, vscode, gemini, opencode, zed
```

Suggestions written that way are scored separately in `/reflect` under `client:<model>`, and orders are never placed from there. Details: [docs/en/dev/extending.md](docs/en/dev/extending.md)

</details>

<details>
<summary><b>Embed it as a library (SDK)</b></summary>

The runtime is an SDK as well as a binary. Embed it from a clone of this repo; the package is not published to npm:

```ts
import { boot } from '@openalpha/runtime/app'
const { app, dispose } = await boot({
  mode: 'cli',
  env: process.env,
  configPath: './config.toml',
  shutdownSignal: AbortSignal.timeout(60_000),
  tools: [],
  agents: [],
})
```

</details>

---

## Support

- **Setup and usage questions, release news:** the [OpenAlpha Zalo group](https://zalo.me/g/yl7iqyfovvtyosujulea), in Vietnamese. It covers using the software, never which name to buy. Mask your API keys before pasting a config. Admins never message you privately for keys or money.
- **Bugs and feature requests:** [GitHub Issues](https://github.com/alex2loop/openalpha/issues/new/choose). A bug is tracked only once it has an issue.
- **Security vulnerabilities:** report privately per [SECURITY.en.md](SECURITY.en.md), never in the group or an issue.

Find it useful? Give the repo a ⭐ so more people find it, and join the [Zalo group](https://zalo.me/g/yl7iqyfovvtyosujulea) for release news.

---

## Development

```bash
git clone https://github.com/alex2loop/openalpha.git && cd openalpha
bun install
bun run dev -- onboard

bun run check       # lint + typecheck + the contract gates
bun run lint:arch   # the architecture gates
```

Both commands must pass before anything lands. House rules and the business invariants: [AGENTS.md](AGENTS.md). A clone updates with `git pull`.

Architecture: 15 modules with no cycles, every dependency pointing toward the kernel; 30 gates break the build the moment a boundary does. Contributing: [CONTRIBUTING.en.md](CONTRIBUTING.en.md) · [Code of conduct](CODE_OF_CONDUCT.en.md).

**Straight talk about stability.** This is an early-stage tool that has run live daily for months - so it is sure-footed at the things it does every day, and rough everywhere else. There is no test suite; breaking changes land between versions; and assets cannot yet move between venues.

---

## License and disclaimer

MIT, for the code. Use it however you want. The name, logo and Bé Alpha are not part of the license:
see [NOTICE.en.md](NOTICE.en.md#name-and-logo-are-not-licensed).

**The data is a separate question.** OpenAlpha ships no market data - it reads from each provider at
run time, on your machine, and their terms are between you and them. [NOTICE.en.md](NOTICE.en.md) names
every host it can reach and what to check before you point it at one.

OpenAlpha is a research and bookkeeping assistant. Its suggestions are educational, **can be wrong, and are not financial advice**. It does not know your full circumstances, it places an order only when you approve one, and markets do what they like. You own every decision. Never risk money you cannot afford to lose.
