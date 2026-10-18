# Data sources

Where OpenAlpha's market numbers come from, who answers when a provider is down, and the few things you may need to set.

Short version: every provider is on by default, there is nothing to enable and no address to point at, and two providers take an optional key. The same subject from the trading side: [Trading](trading.md#market-data-and-suggestions).

## What you need to do

Nothing, to get started. Two providers take a key you can add later:

| Provider | Variable | Without it |
|---|---|---|
| `coingecko` | `COINGECKO_API_KEY` | The last fallback for the crypto market-cap board is gone, and so is the only lookup for a coin ranked past every board. It also drops out of the FX list for a settlement coin against a fiat currency. |
| `fred` | `FRED_API_KEY` | You lose the series only FRED publishes. US macro still reads from `treasury` and `bls`, which need no key. |

Set the variable in your shell or environment, never in a config file. OpenAlpha also reads the same name with the product prefix (`OPENALPHA_FRED_API_KEY`). A variable that is set but empty counts as unset. To use a different variable name, rename it in `config.toml`:

```toml
[trading.sources]
coingecko = "OPENALPHA_COINGECKO_API_KEY"
```

The key is a provider id and the value is a variable name, never a secret. Naming a provider that takes no key is a startup error.

A provider whose key is missing is simply not used, and its data falls through to the next provider. At startup OpenAlpha logs one `trading.source.skipped` warning naming each skipped provider and the variable it wanted. To check without starting anything:

```bash
openalpha doctor sources
```

It prints `every data source has the credential it needs`, or one `i` row per optional provider whose variable is unset, naming the variable and what setting it would add. Running without keys is a supported, reduced mode.

Endpoints and feed URLs are fixed in the code. No setting redirects a request to another host.

## Routing

For each kind of data and market there is an ordered list of providers. OpenAlpha asks the first one; if it fails or has nothing for that name, it asks the next. The first usable answer wins, and each figure carries the provider it came from.

Two exceptions:

- **Merged reads.** US macro, the Vietnamese gold boards and the exchange supervision list ask every provider and combine the answers, because no single provider has everything. Where two providers publish the same item, list order decides which wins. US macro lists `treasury` and `bls` first, so an install with no keys still reads macro.
- **Split reads.** For news, one provider serves a name's own headlines and another serves the market-wide read. They share the work; neither is the other's fallback.

A provider that failed on its most recent call, or is paused (see [When a provider fails](#when-a-provider-fails)), moves behind the healthy ones. Nothing moves up for answering recently.

### Who answers what

| Data | Providers, in order |
|---|---|
| **VN equities** | |
| Live price | `vndirect`, `vietcap-chart`, `entrade` |
| Daily history | `vndirect`, `entrade`, `vietcap-chart`, `vps` |
| Stock list; fundamentals, events, flows, analyst recommendations, valuation ratios | `vndirect` |
| Live board and foreign room | `vndirect`, `vietcap-board` |
| Financial statements (full years and quarters) | `vietcap-statements` |
| Proprietary-desk flows | `cafef` |
| Buy and sell sides of the day's trades | `kbsec`, `vietcap` |
| Exchange supervision list (merged) | `hsx`, `ssi` |
| Index membership (`vn30`, `vn100`) | `vietcap` |
| News | `vndirect`, `rss` |
| **Vietnam, region-wide** | |
| Macro series | `vndirect` |
| Policy and interbank rates | `sbv` |
| Statistics office monthly report | `nso` |
| **Crypto** | |
| Live price | `binance`, `okx`, `mexc` (the default venue for `crypto` goes first) |
| Daily history | `binance`, `bybit`, `mexc`, `yahoo` |
| Ranked market-cap board | `coinmarketcap`, `coinpaprika`, `coinlore`, `coingecko` |
| Sentiment | `alternative-me` |
| Funding | `binance-futures` |
| News | `google-news`, `rss` |
| **Gold (world)** | |
| Live price and history | `yahoo`, `binance` |
| Futures positioning (CFTC, weekly) | `cftc` |
| News | `rss` |
| **Gold (Vietnam)** | |
| Domestic gold board (merged) | `giavang`, `pnj` |
| Board history | `giavang` |
| News | `rss` |
| **Not tied to one market** | |
| US macro (merged) | `treasury`, `bls`, `fred` |
| FX rates | `coinbase`, `okx`, `coingecko`, `yahoo`, `er-api` |
| FX history | `yahoo` |
| Commodity prices | `vndirect`, `fred-csv` |
| News for the macro picture | `rss` |

What the less obvious ones do:

- `vndirect` leads VN prices because its row is written while the market trades. It does not serve indices: an index price goes to `vietcap-chart`, and index history to `entrade` then `vietcap-chart`. `vps` is last, and exists for the ETF benchmark indices (VNDIAMOND, VNX50 and the like) that neither `vndirect` nor `entrade` serves, so one refusal does not take them all out.
- `vietcap-board` reads the whole VN board in one call and backs `vndirect` for both the live board and foreign room.
- `cafef` is not a fallback for `vndirect`'s flows. It publishes the proprietary desk alone, two sessions sooner, and is asked only for the sessions still missing that part.
- `fred-csv` carries the monthly commodity series no daily feed has (coal, rice, pork, steel). `vndirect` carries the daily ones. They never compete for one commodity.
- `coinbase` and `okx` price a settlement coin (such as USDT) against a fiat currency. There is no fallback from `USDTVND` to `USDVND`: USDT is a different instrument, and a missing rate is reported rather than guessed.
- Crypto prices lead with your crypto default venue (`default_for` under `[trading.venues.<id>]`, `binance` unless you set one) when that venue is also a data provider. A plan priced anywhere else would quote a number you cannot get filled at.
- `mexc` backs `binance` for prices and is third for history. It lists coins the big venues do not, but volume on the long tail is the least trustworthy, so it answers only for a name the majors decline.
- `okx` does not list every coin; one it lacks is skipped without counting as a failure.
- `coingecko` serves the market-cap board and one FX rate, not the price path, because the alert loop reads a price for every watched coin on every tick and a monthly-metered provider would use its quota on that.

One kind is defined and has no provider: spot-ETF net flows for crypto. The brief's `etf-flows` section reports `unavailable`. That is expected, not an outage.

### Reading the Vietnamese sources

The Vietnamese scraping sources and the gold boards are fragile, and being on by default does not change that:

- `vndirect`, `entrade` and `vietcap` read undocumented internal broker endpoints with no service guarantee.
- `cafef` reads a consumer site's own handler, and publishes rows whose value and volume contradict each other. Those rows are dropped.
- `pnj` reads a storefront's own endpoint.
- `giavang` is a community API run by one operator.

They are registered anyway. When one cannot answer, you get an *unavailable* that names the source, which is more useful than an install that silently covers nothing.

`nso` can be unreachable from abroad. That is fine: the daemon job `trading.macro-extract` retries on its next tick, and a monthly report stays online for weeks. The job reads the statistics office's reports (and Vietnam PMI and public-investment headlines) with a model from `[[model_tiers.extraction]]`, falling back to `[[models]]`. It keeps a figure only if its quote appears word for word in the source and its number appears in the quote.

CFTC positioning is weekly and lagged, and says so. It carries the date of the Tuesday the positions were held and is published the Friday after. A figure dated last Tuesday is the report being honest about its lag, not a stale read.

## When a provider fails

You will see this in three places.

**On the answer.** When a later provider answers, the read carries a line like "`{source}` did not answer this read, so the data came from `{fallback}`". When every provider fails: "Every source for `{kind}` was tried and none came back with anything usable", and that section is shown as absent with the reason, not filled with a guess. A provider that looks and finds nothing (a suspended name, a small cap with no foreign flow) is not an outage and is not reported as one.

**In `/sources`.** It lists only the providers that are paused or whose last call failed, one row each, or a single line when everything is fine. A row shows the provider and kind, `paused until it is retried`, the last error and when it last answered. The last error is one of:

| Message | What happened |
|---|---|
| `took too long to answer` | the request ran out of time |
| `turned us away for calling too often` | the provider answered 429 |
| `could not be reached` | any other HTTP failure |
| `sent back something unreadable` | the reply was not what the provider normally sends |

The list is this process's own memory. A fresh command-line call says `no provider has been called since this process started - run a data command in the same session first, then ask again` instead of claiming everything is healthy.

**In the pause.** After repeated failures a provider is skipped for 5 minutes (see [Limits](#limits)), then tried again.

A parse failure on one kind of data (the provider changed its format) is reported for that kind only. It does not pause the provider's other kinds.

## Fresh prices only

A provider that stops updating does not report an error. It keeps answering with a bar from hours ago, stamped with today's date. So a price counts as live only if both are true:

- it belongs to a session newer than the last settled close, and
- it is at most 90 minutes old: 30 minutes for the closing print to land, plus up to 60 minutes for a quiet market (the one-hour halt in CME metals trading). During the Vietnamese lunch break the last print before the break stands for the whole break.

A price that fails either test is not an error. OpenAlpha shows the last settled close it holds and says so: "`{ticker}` has not printed a price newer than the last settled close, so that close is shown rather than a live one." It refuses only for a name it has no stored close for at all.

## Limits

Every provider is paced to a requests-per-minute rate that is either its published free-tier ceiling or, where it publishes none, a rate a full-universe sweep can sustain. The pace is enforced before each call, so a wide watchlist does not trip a provider's own limit. Requests per minute:

| Rate | Providers |
|---|---|
| 600 | `binance`, `binance-futures`, `bybit`, `okx`, `mexc` |
| 300 | `cafef`, `vndirect` |
| 120 | `fred`, `vietcap-statements` |
| 60 | `coinbase`, `coinlore`, `coinpaprika`, `entrade`, `google-news`, `hsx`, `kbsec`, `rss`, `ssi`, `treasury`, `vietcap`, `yahoo` |
| 30 | `alternative-me`, `coinmarketcap`, `fred-csv`, `giavang`, `pnj`, `vietcap-board`, `vietcap-chart`, `vps` |
| 20 | `bls`, `cftc` |
| 10 | `coingecko`, `er-api`, `nso`, `sbv` |

Three providers meter by a longer window that a per-minute pace cannot express: `bls` by day, `er-api` and `coingecko` by month (the `coingecko` adapter targets a Demo plan of 10,000 calls a month). In ordinary use none is close: `er-api` is last in the FX list and `bls` is asked once per macro refresh. `coinmarketcap` publishes no ceiling for its keyless use and answers `1022` once an anonymous caller has used it up; it recovers within a minute of going idle, and the next provider covers the gap.

OpenAlpha keeps no daily or monthly budget of its own for provider calls, because they are free at the tiers it targets. Spend limits exist for model calls: [Budgets](budgets.md).

Time and size:

- A request gets 35 seconds in all, including waiting its turn and retries. Each try gets 10 seconds, up to 3 tries, backing off from 0.5 s to 5 s.
- Prices (`/price`, the watchlist pulse, every alert tick) get 1 try of 8 seconds, so a dead provider costs one short wait before the next is asked. The US macro providers also get one try each, because the read waits for the slowest.
- Only timeouts and temporary errors (408, 425, 500, 502, 503, 504) are retried. A 429 is retried only if the provider says when to come back, and only if that wait fits in what is left of the 35 seconds; otherwise it is reported as rate-limited and the provider is paused for the time it asked.
- A reply over 2 MiB is rejected.
- A paged read follows at most 20 pages or 120 seconds. If it stops while the last page is still full, you get "This is the first slice only - there were more results than fit here."
- A provider is paused for 5 minutes after 3 failures in a row, half of its last 20 calls failing, or a reply telling OpenAlpha when to come back.

Some commands cap how much they read: a quote board shows at most 12 names at a time, a screen examines at most 50 candidates, and a news read returns at most 50 items. A name cut by a cap is reported as cut, never silently missing.

## Caching

Little is cached, and each cache is there for a measured reason.

- **Finished crypto days.** Daily history for days before today from `binance`, `bybit` and `mexc` is kept in memory (up to 8,000 entries) and fetched once. Today's still-forming bar is never used as evidence, so a window cannot score differently minute to minute. A newly finished day fetches only itself, not the 200 days before it. Equity history is never served this way, because adjusted prices are restated backwards.
- **Macro.** One merged macro read per region and day, shared by every market that scores against it. A read in which any provider did not answer is not kept, so the first pass of the day (before the US series publish) never becomes the day's answer.
- **The crypto board.** The ranked board is read once an hour and shared by every price and symbol lookup.
- **VN whole-market reads.** A refresh asks `vndirect` for one name at a time, but the provider serves a whole market per query, so the first caller reads the window and the rest take their slice. It lives 60 seconds idle and never beyond 5 minutes.
- **Identical simultaneous requests** share one download for as long as they are in flight, and nothing is answered from an earlier read.

Every figure carries `live` or `cached` with its provider. Live and stored are different jobs: prices, news, sentiment, funding, FX and the live board are read fresh each time, while history, fundamentals, flows, macro and accounts are fetched by a refresh, kept in your database and read from there, so evidence stays stable through a session. A refresh swaps a market's whole stock list or none of it.

## Plugins

A plugin can add a provider. It is always tried after the built-in providers for the same data, never first, and it needs `plugins.allow_code = true`. See [Extending](dev/extending.md#plugins).

Internals: [dev/data-sources.md](dev/data-sources.md).
