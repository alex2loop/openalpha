# Trading

One page for the whole trading side: where a number comes from, how a suggestion is built from it, how your book is worked out from the ledger, and the one path that reaches an exchange.

If you read only one section, read [The book](#the-book). Sizing, drift, open risk and the track record are all calculated from your ledger rows, not stored separately. One wrong row throws off everything else.

---

## Market data and suggestions

OpenAlpha gathers the data, runs the numbers, argues both sides and hands you a call. Then it stops.

**It only suggests by default, and it has exactly one way to place an order.** `/trade` and the `order_place` tool place spot orders on a registered venue. Every order:

- needs your approval and stays within the caps;
- goes to exactly one venue - if more than one could fill it, the order is refused, not guessed;
- is recorded in the ledger once filled.

An approved entry may leave **one** resting take-profit/stop-loss at the exchange. Nothing else can submit an order. If no venue has trading credentials, `order_place` is not registered and `/trade` only tells you which keys to set.

### What ships

The **market id** and the **portfolio segment** are two different names; they differ only for VN equity. Commands take the market id.

| Market | Region | Asset class | Segment | Currency | Sets its region's trading day |
|---|---|---|---|---|---|
| `gold` | `global` | gold | `gold` | USD | yes |
| `gold-vn` | `vn` | gold | `gold-vn` | VND | no |
| `equity-vn` | `vn` | equity | `equity-vn` | VND | yes |
| `crypto` | `global` | crypto | `crypto` | USDT | no |

Two markets share region `vn`, so one of them has to define "a Vietnamese trading day". The brief's schedule and every cross-market as-of date rely on it. Equity does that for `vn`, world gold does it for `global`, and crypto never closes. Startup refuses to run if a region has no such market or two.

### Data sources

Every source is registered by default. There is nothing to enable and no host to point at: endpoints are fixed in code. What a source cannot cover comes back as an *unavailable* result that names the source.

A fixed route table decides which source serves a scope, and in what order. Health only **demotes**: a source whose newest answer failed, or whose circuit breaker is open, drops behind the healthy ones. Nothing is promoted for having answered recently. See [Data sources](data-sources.md).

| Source | Provides | Needs a key |
|---|---|---|
| `yahoo` | gold quotes and bars, fiat FX | no |
| `rss` | news feeds, by region or as the fallback for any scope | no |
| `google-news` | crypto headlines, ahead of `rss` | no |
| `okx` | crypto quotes when `okx` is the `crypto` default venue | no |
| `binance` `binance-futures` `alternative-me` | crypto quotes and bars; funding, open interest (with its change) and long/short ratio; sentiment | no |
| `bybit` | crypto bars for names `binance` spot does not list | no |
| `mexc` | crypto bars and quotes for names neither `binance` nor `bybit` list | no |
| `coingecko` | last fallback for the crypto board; the only source that looks up one symbol past every board; the rate a settlement coin trades at against a fiat | `COINGECKO_API_KEY` |
| `vndirect` | VN instruments, bars, fundamentals, events, flows, foreign room, street recommendations, VN macro, daily commodity prices, VN news | no |
| `entrade` | VN quotes and bars; behind `vietcap-chart` for a quote on a level, ahead of it for bars (it charts only the four headline indices) | no |
| `vietcap` | VN index basket membership (`vn30`, `vn100`) and per-name trade sides | no |
| `kbsec` | VN per-name trade sides, ahead of `vietcap` | no |
| `hsx` `ssi` | names under exchange supervision, merged across the HOSE listing service and a broker board that also carries HNX | no |
| `vietcap-board` | the live VN board in one read: session quotes and foreign room, behind `vndirect` for both | no |
| `vietcap-chart` | levels for every HOSE index: the daily series the ETF benchmarks are scored against, and the intraday one behind the live index price | no |
| `vps` | levels for the ETF benchmark indices only it and `vietcap-chart` carry; behind `vietcap-chart`, whose turnover includes the put-through leg this feed omits | no |
| `cafef` | VN proprietary-desk flows, for sessions `vndirect` has not published | no |
| `giavang` `pnj` | VN domestic gold boards, merged in that order | no |
| `sbv` | VN policy rates (refinancing, rediscount) and interbank averages, from the State Bank's rate page | no |
| `nso` | the statistics office's monthly socio-economic reports, read by the `trading.macro-extract` job | no |
| `fred-csv` | monthly commodity series no daily feed carries (coal, rice, pork, steel), behind `vndirect` | no |
| `vietcap-statements` | VN financial statements: full years plus discrete quarters (below) | no |
| `treasury` `bls` `fred` | US macro series, merged rather than failed over | `fred` needs `FRED_API_KEY` |
| `coinpaprika` | the ranked crypto board and seven-day change, keyless, one request; first fallback behind `coinmarketcap` | no |
| `coinmarketcap` `coinlore` | the ranked crypto board the screen picks its universe from, keyless, one request; `coinlore` sits third | no |
| `coinbase` | the USD price of a settlement coin, from a venue that trades the pair | no |
| `er-api` | fiat FX, behind `yahoo` | no |
| `cftc` | gold futures positioning: the weekly Commitments of Traders report | no |

One kind is defined but **unrouted**: crypto spot-ETF net flows. No provider has been verified against a live response, so the brief's `etf-flows` section reports `unavailable` instead of failing.

**The VN scraping sources and the gold boards are fragile**, and being on by default does not change that:

- `vndirect`, `entrade` and `vietcap` read undocumented internal broker endpoints with no SLA.
- `cafef` reads a consumer site's own AJAX handler and publishes rows whose value and volume contradict each other; those rows are dropped, not filed.
- `pnj` reads a storefront's own endpoint.
- `giavang` is a community API run by one operator.

They are registered anyway: when one cannot answer, you get an *unavailable* that names it, which beats a VN install that silently covers nothing.

CFTC positioning is **weekly and lagged**, and the report says so. It carries the date of the Tuesday the positions were held and is published the Friday after. A figure dated last Tuesday is the report being honest about its lag, not a stale read.

Macro is the only kind that **merges** instead of failing over: no provider publishes every series, and where two publish the same one, route order decides which wins. The keyless `treasury`/`bls` pair goes first, so an install without keys still reads US macro.

The macro composite renormalizes when published: a series with no reading today does not vote. Each driver publishes its share of the vote actually cast, and its contribution is measured against the score it moved. Published weights sum to one, contributions sum to the score, and partial data shows up in `coverage` and the missing list. A driver names its unit: rate series are percentages, while the dollar index (Jan-2006 = 100) and the VIX are levels and print without a percent sign.

This holds for what you see, not only what is stored. Shares printed under their whole are rounded together so the column adds up on screen. The same goes for a suggestion's factor contributions under its composite and for the profile's segment targets (renormalized to one). Only rows that print a share take part.

**A source that needs a key and has none is not registered**, so its kind falls through to the next source. At startup one `trading.source.skipped` warning names each skipped source and the variable it wanted. Running without keys is a supported, degraded mode, never fatal.

Credentials come from environment variables and never appear in config. Variable names, the `OPENALPHA_` prefix and `[trading.sources]` renaming are in [Data sources](data-sources.md#routing).

#### VN financial statements: audited years, then the newest quarters

`vietcap-statements` returns a name's full-year reports and discrete quarters together. Years that have cleared their audit window print one line each, oldest first.

When quarters run past the newest audited year, the four newest quarters published by the board day print as one more line, marked unaudited:

- flows (revenue, profit, cash flow, capex, dividends) are summed;
- balances are read at the last quarter's close;
- a flow missing from any of the four is left out, never read off fewer quarters.

A window that ends inside the newest audited year, or on its fourth quarter, restates the audit and prints nothing. The debate is told to weigh this line below an audit.

Beyond the audited years, OpenAlpha also shows the 5 newest quarters, each against the same quarter a year earlier, so you can see whether the business is improving or fading right now. Quarters are unaudited, so they are a reading, not a final figure.

Accounts are refetched every 30 days, and every two days while the latest quarter is due and not stored yet. That is 15 to 70 days after quarter end, the span in which 25 large names filed their 2025-26 quarters (Q1 and Q3 in 15-35 days, the reviewed half-year in 30-66). A name on a non-calendar fiscal year is read on calendar quarters, so it is only asked a few extra times.

#### Timeouts, retries and caching

Every source gets the same timeouts, retries, response-size cap, caching and circuit breaker, so no source drifts on its own.

A **quote read** - behind `/price`, the watchlist pulse and every alert tick - has a tight deadline and a single attempt. A dead primary costs one short wait before the next source takes over, rather than backed-off retries while you wait at a prompt. Bulk reads keep the defaults. Numbers are in [Data sources](data-sources.md).

#### A live quote carries the session so far

A quote from a source with an intraday series carries the session's **high, low and accumulated volume** beside the price, plus when that window opened. A price alone cannot say whether it sits at the high or the low. Three things need to know:

- alerts compare thresholds against the extremes, not the last print;
- `/price` shows the day's range beside the number;
- the standing check asks whether a stored suggestion's levels still pay their own risk.

The range is absent on a settled read and for any source with no intraday series. Nothing infers a range from one close.

Crypto headline rows are measured against the settled close from their own daily series, printed beside the row, not against a rolling 24-hour window that appears nowhere on screen.

The roll-ups beside those rows come off the market-cap board, where every source publishes a rolling 24 hours. So the mover list and the traded-value ranking are titled by that window, not by a session. The taker-buy share is the exception: it is a settled session's, and it names that session.

The market-size line also counts how many liquid names are up and down over that same rolling day, the one breadth read a market with no session can give. A morning brief at 07:00 in Vietnam shows whether the Asian hours moved the board, not only the two headline names.

A held or watched name that traded at least 2% above the settled close and is back at or below it is headed *opened up, then gave it all back*. Nothing else changes on the row.

#### The pulse reads live, twelve names at a time

`/watchlist` and the `cross-asset-pulse` brief section share one path: every watchlist and held name, deduped, capped at **twelve** instruments and fetched **four at a time**. The cap bounds spend and latency; it is not a ranking. A longer list is cut and says so with `market-data.universe-truncated`, so a missing name is explained.

Each row asks for a live quote. A market not in session answers with its stored close, so the same call is right at 10am and at midnight.

A name whose quote is unsupported, unavailable or non-finite becomes a caveat naming it, never a zero row. A fake price on a pulse line looks exactly like a real one.

#### A screen is ranked on settled evidence

A board pulled at 11am is ranked through yesterday's close even though its prices are live. The board's date is the market calendar's day at the run instant; the "evidence through" date is the last settled day the ranking actually covers, because today's forming bar is dropped.

For a continuous market (crypto, UTC calendar) the board's date is the UTC day, not your local day, and the settled day is always yesterday UTC. Example: 09:44 UTC on 2026-09-09 (16:44 ICT) screens `asOf 2026-09-09` over evidence through `2026-09-08`. From 00:00 to 06:59 ICT your local date already reads one day ahead of the UTC date.

The result carries `market-data.evidence-settled-only`: the price history runs to the last settled close, and readings the market publishes continuously are current. It names no session, because the board states its own and repeating it would put two stamps on one message.

Re-ranking on a partial session would move names up and down the board all morning on volume that has not finished arriving.

#### A session settles when its data does, not when its bell rings

A board stops trading at its close and publishes the closing auction some minutes later. In between, the source answers with a session that looks complete and is missing its last print. On HOSE that meant 18 of the 25 busiest names carried a wrong close and the market's traded value was 10% short.

So a day counts as settled only once the close **plus the auction lag** has passed. Nothing is stored for a day before then, and the scheduler's own anchor is that same instant. One rule decides what may be stored and what may be served.

**Declared closes.** A board with an auction has a real close: HOSE strikes its closing price at 14:45, and the lag past it covers the 14:45-15:00 put-through window plus source publication. A dealer board strikes nothing; it is revised until it stops. So its close is an estimate of when revisions end. `gold-vn` uses 17:30 because SJC was measured still revising at 17:15. An estimate that measurement contradicts is moved; a struck price is not.

**The domestic gold premium** is why the rule is shared. It prices a static vendor board against world gold, which keeps moving. A point taken between the counter's close and its settle measures a different spread than one taken after, and the series keeps whichever landed first. A day already on file reports as current, not as an update, and `force` is what re-derives it. Without that, the stored premium would stay frozen at the day's first reading while every screen recomputed a newer one.

The live pass writes only settled sessions. A backfill pass then fills the percentile window's other missing days from dated gold boards, priced against the newest world close and FX rate within their lag allowances. A day whose world close or FX rate never arrived is reported as missing, not skipped silently. A day on which the counter published nothing is not counted as missing: it cannot arrive, and counting it would make every pass look short. A vendor that stops publishing altogether is caught by the percentile's own coverage floor.

**Stored refresh stamps.** A refresh attempt is stamped with the day it covers, and the next run reuses it instead of refetching. A pass that ran inside the settle gap would stamp a day still forming, and every later run would read that stamp as current. It would not heal on its own: the kind stays pinned to that forming tape until the cadence window moves past it, which across a Friday is three days. So a stamp counts as current only if the day was already final when the pass claimed it, before age is even considered.

**Live prices.** A market's live quote is dropped when its own session is not newer than the settled close, or when its age is more than a closing print or a quiet market can explain. The market owns that call, not the source, the way `gold-vn` already checks board age. How a reading is judged is in [Data sources](data-sources.md). It catches three things that all arrive well-formed:

- A venue that halts a pair keeps serving its last trade indefinitely, so levels would anchor an entry on a market that stopped trading.
- A settled session answers every later request with the close it already holds. A screen would print that as the price the market is making now. On HOSE that is every request from 15:15 to the next open, about three quarters of the day.
- A feed that stops advancing keeps answering with a bar from hours ago that carries today's date. `/price`, `/overview` and `/market` could each print a different stale index bar, all showing a rise on a session the index spent down.

In each case the settled close stands instead, correctly dated. A live quote survives only as the last resort for a name the store cannot price at all: a book values on whatever mark it can get, and only the freshness stamp may go missing. Crypto and VN equities answer this way, so a market whose tape is shut still prints a price rather than refusing.

A refusal while the board is open says so. A shut market needs no explanation, but a name whose board is trading and has not printed is a halted ticker, something you can act on. It carries `market-data.quote-not-live` naming the ticker.

#### The screen marks an excluded name, and never hides one

A name you excluded still ranks and still prints, with `on your exclusion list` on its row. Hiding it would quietly narrow the board without telling you. The actual block sits elsewhere: the `profile-exclusion` stage in the suggestion pipeline and the rebalance candidate list.

Nothing from your profile shapes the board itself. Universe, ranking, scores and factors are identical under any profile, so the board carries no profile stamp. A policy header there would imply a filter that never ran.

If your profile cannot be read, the board loses its marks, never its rows, and says so with `profile.exclusions-unavailable`. That is what separates "nothing here is excluded" from "we could not check".

#### Unavailable is an answer

Every source call returns either data with its provenance and caveats, or *unavailable* with a reason - `unconfigured`, `unsupported`, `stale` or `failed` - the sources that were tried, and caveats. Nothing fabricates a number to fill a gap, and nothing breaks because a free source had no coverage.

Freshness (`live` or `cached`) sits on each provenance row, never as one aggregate: a result built from four sources has no single answer to "is this fresh?".

A block dated to one session reads every figure in it at that session or drops the ones it cannot. VN breadth counts each name at the settled session and withholds its index-trend figures whenever the index series stops short of it. The index endpoint holds the settled bar back for hours after the shares have theirs, and the block names the session that series actually reached. A heading whose window is missing states the heading alone.

That session is what dates the block, never the newest day anything in it reports. The two differ every morning until the refresh lands: the index endpoint publishes today while the stored price history still ends yesterday. Dating by the later one would stamp one session's breadth, turnover, flows, leaders, movers and boards under the next one's date. It would also suppress the note that today's turnover and foreign flow are not measured yet.

Each price row carries its own `closedOn` date. The agent tool groups the same roll-ups under `settledSession`.

### The suggestion pipeline

Five stages, in order: **detect, factors, debate, stages, persist**.

- A **blocked stage forces a hold.** A suggestion cannot route around a failed check.
- **Confidence only moves down.** The debate may lower it; nothing raises it.
- Every suggestion records its strategy version and calculation versions, including the skill versions. Editing a skill splits the recorded populations exactly as editing a strategy does.
- Every stored debate lists the chat models that answered its roles, so a model swap splits the track record too.

A run ends in one of four ways:

| Result | Meaning |
|---|---|
| `completed` | You get the suggestion. It is marked `reused` when the same name was already suggested today on the latest stored close, or an earlier buy still stands. |
| `unsupported` | No market claims the ticker, or two do and you must say which. |
| `cooldown` | The name was suggested too recently. Shows the day it becomes eligible again. |
| `error` | The run passed every stage guard, then failed to record (most likely storage). Rerunning is safe. |

An `error` is not a hold. A hold means "evaluated and rejected" and is a real answer with the reason codes that produced it. An error means the evaluation was never recorded.

#### Debate depth

Two modes, set by `[trading.suggestions] debate_mode` and overridable per request (`/suggest FPT lean`, or `mode` on the MCP `suggestion_run`):

- **`full`** (default) runs `bull-researcher`, `bear-researcher`, `portfolio-manager`, `trader`, `risk-analyst` and `claim-verifier`.
- **`lean`** runs `market-analyst` and `claim-verifier`.

Each role gets its own budget slice. If a role halts or uses up its slice, the whole run falls back to a hold rather than a partial debate.

A role is asked at most twice. If an answer fails its schema, it is re-asked with what failed (`trading.debate_role_repaired`). If the provider chain could not place the run at all, it is re-asked unchanged (`trading.debate_role_retried`), since the chain waits out its cooldown first.

Depth is chosen once, first match wins:

1. A mode you typed stands.
2. `force` means full.
3. A draft the book has already decided (`no-rebalance-needed`, `evidence-sold`, `increase-unfunded`, `segment-off`, `reference-only`, `factors-bearish`, `factors-neutral`, `factors-contested`) runs lean, since the debate can only lower and cannot change it. The report says whether the scores (the three `factors-*` reasons) or the portfolio settled it, and names `/suggest <ticker> full` for the whole argument.
4. Anything else uses the configured mode.

A row the book holds is also exempt from the depth ratchet on reuse. Otherwise the lean default would re-run it daily against a full config. A typed `full` is the exception: it re-runs past that lean row and replaces it, so asking for the argument never hands back the short one.

#### Checks on what the debate says

**A figure the evidence never printed is named, not judged.** After verification, every number in the material claims is compared by value with the numbers in the evidence. Units (`tỷ`, `bn`, `%` and the rest) are converted, a decimal comma and a decimal point both read, and a figure matches within half its last printed digit, so a rounded restatement still counts. Bare small counts and years are ignored.

Any figure left over raises `suggestion.figure-unmatched` as an information caveat. It never changes a verdict. A sum or gap the analyst worked out matches nothing, and a free-text claim names no metric or period to check against, so which figure belongs to which line stays the verifier's call.

**Headlines are read before anyone argues from them.** One request to the `decisions` model tier asks two questions per headline: what it is about (this instrument, its sector, the market, or nothing here) and whether it reports a conflict, sanctions or a state emergency. The read is told the company's name and sector, so a short ticker is not mistaken for another business.

- Confident answer: the headline moves between the instrument's own coverage and the market background, or is dropped.
- Unsure: the feed's grouping stays.
- Two or more distinct risk stories raise `market.risk-event-headlines`.
- Read unavailable: the run says `suggestion.headlines-unread`, keeps the feed grouping and uses a keyword table for the risk warning.

When a news, coverage or calendar feed is down, the analysis is told so and never reads the silence as calm.

None of this changes confidence, levels or size. The reads go to the `[[model_tiers.decisions]]` chain; with no `decisions` tier configured, they are off.

#### Selling a held name

`reduce` carries a reason. `over-target` is the plan's trim. The rest are evidence turning against a name you hold, each selling its own share of the position:

- `structure-broken` - a close below the low of the sessions before it, from the market's own read.
- `regime-risk-off` - the segment's market state turned defensive.
- `thesis-weakening`
- `overheated` - longs paying crowded funding.
- `stale` - a full holding window at cost.

`structure-broken` and `stale` are read on a short-horizon segment only. A long segment is not sold on a ten-session low or a flat quarter.

When a trim and an evidence reason both fire, the larger share wins and the row carries that reason. `over-target` fires on any drift that clears a board lot, and a name that rose into its own exit signal has drifted that far. Ranking them the other way would put a routine trim's size on a structure the market broke. The debate asks whether to keep or sell, as it does for a trim, and can only decline.

#### Two checks that run first

The pipeline's own stages run ahead of any market's gate, for every market:

- `profile-exclusion` - your exclusion list.
- `deployment` - refuses to add risk into a defensive market on a fully invested book.

#### Signals are settled; the price is live

Factors are computed only on settled bars. On a forming bar a factor would repaint. But the levels stage and the standing check ask for a live quote, so entry, stop and target are built against the price you are looking at.

Each market decides when a live quote can be answered and falls back to the last close, so pre-open and closed sessions are unchanged. Whether a reading is live depends on the session it belongs to, not its timestamp. A closing auction prints after the bell, so once the tape settles the market's own closing print becomes that session's close and the live row is dropped.

Evidence and price can end on different sessions, so every stored row carries an *evidence through* date: the newest settled session its factors and levels were read from. The report's closing lines print it whenever it differs from the run's own day. On a continuous market that is every run, because its bar for the calendar day closes at the next midnight UTC. The call's own date stays the day it was priced, which the reuse identity and the outcome window key on.

#### VN specifics

**A VN price outside its own session's band means stale history, not a halted name.** No trade prints outside the band. If the live price lands beyond the band built from the stored close, that close is on an old basis, usually an ex-rights day the source has not adjusted yet. The run holds with `history-not-adjusted` instead of pricing levels on it. This runs ahead of the band-edge block, which would otherwise read the drop as a stock pinned at its floor. The next refresh that sees the restated close rebuilds the name.

**A VN stock's factors print as an "at a glance" checklist** grouped by side: in its favour, against it, then context. Within a group the strongest reading leads. Each row carries its factor's own score gauge and headline readings, never a fixed threshold.

- Growth has no factor of its own, so it prints numbers only, under context. A factor reading near zero sits there too.
- Profitability and financial health share the quality score, so the second row leaves its gauge blank rather than counting it twice.
- A factor with no reading prints `—`.
- The REPL prints a grid; chat prints one row per line.

Readings the rows do not show stay in the calculation. Any market with a factor the checklist has no row for keeps the factor table.

**The VN market state holds until the score clearly leaves it.** A state is entered at +-0.25 and left only once the score is back inside +-0.15, so a composite hovering on the line does not move deployment every day. `macro.regime-held` says when the band held where the bare score would have flipped. The memory is the last stored rated read within five sessions; an older one means the daemon was off, not that the market was calm. It applies to VN only, the one market that stores its reads.

#### A held name is planned without being asked

A buy recorded with no plan standing gets a levels-only hold row (`recorded-entry`) at its fill price. It is written by the ledger's one write path, so the slash command, the agent's record tool, a venue sync and a mirrored fill all get it. Your write confirmation prints it; the agent's receipt does not.

The alert tick writes the same row, from the settled close, for any held name nothing watches, and sends one notice.

This is the plan the name is stopped, targeted and trailed against until `/suggest` replaces it. A recorded plan never satisfies the reuse gate or starts a cooldown. A run whose debate never answered (no model key, a role that failed, no budget left) decided nothing: it is shown with the reason but not stored, so it never replaces the plan already standing.

- A call's plan expires when the outcome tick resolves it; a recorded plan expires once the settled close has passed either level.
- Either way, the next tick plans afresh from where the name trades, floored at the old stop while that stop is still below the price.
- A plan priced by an older strategy version is replaced the same way, at most once a session, so a changed level policy reaches names already held. The notice goes out only when the stop or take-profit moved.

#### A stored suggestion whose levels the price has left comes back marked void

Each market declares the risk-reward its levels must still pay at the current price. `equity-vn` and `crypto` both use 1:1.

The plan's chase ceiling is that same threshold solved for price: (target + R x stop) / (1 + R). The plan and the reuse check read the same value, so when a market retunes its floor, the price the plan prints and the price the check enforces move together.

- Above the ceiling, today's answer stands.
- Below it, or past the stop or target, the row is served with `suggestion.levels-void`. `/suggest <ticker> force` runs a fresh call.
- The stop is ATR-derived, so the rule scales with each market's own volatility rather than a flat percent.
- A market that declares no floor reads no live quote and keeps its answer for the whole cooldown. One whose quote cannot be read says so with `suggestion.standing-unverified`.

#### Setting the stop and target per market

`[trading.markets.<id>]` takes:

- `stop_loss_atr` - the stop in ATRs;
- `reward_risk` - the target as a multiple of the risk;
- `maximum_stop_loss` - a hard ceiling as a fraction of entry.

`stop_loss_atr` and `reward_risk` replace the market's own value for both horizons. When the ATR stop would sit further out than the ceiling, the stop is pulled in to just inside it, never a tick past. The target and first take-profit are placed off that smaller risk, so reward/risk is unchanged and size grows into the shorter distance. The plan then carries `market.stop-capped`. For `gold-vn` the ceiling counts down from the shop's buy-back price, so the buy/sell gap comes on top.

Setting any of the three adds a suffix to that market's strategy version (`1.0.0+3f9a1c0b`). Plans priced under your keys keep their own track record, are never served back once the keys change, and a held name is re-planned once. A stop only ratchets up, so loosening the keys never lowers a stop you hold. Keys and ranges: [Configuration](configuration.md).

#### A crypto buy after a hot run rests below the quote

When a name has risen 25% or more over its last seven settled sessions, the entry is a buy limit half an ATR under the live quote, standing for five sessions. The stop, take-profit, target and void price are all priced from that limit.

Measured 2026-10-15 on 81 names' hourly bars, with the limit filled only on a trade through it after it went in: it beat buying at the quote by 2.4% a trade on the plan's own exits (t 3.2, 85% filled). The plan tells you to rest it on the exchange as good-til-cancelled, because `/trade` only places orders that fill on the spot. The rule is the market's level policy, not a setting.

#### Size

Size is budgeted on the entry stop; the market state scales the whole order. The risk ceiling divides the per-trade budget by the ATR distance from entry to stop, never by a stop that a trail or ratchet moved closer. A tighter exit is not a smaller bet.

The segment's market-state scale reduces the final size alongside confidence and the trader's intent. A defensive read therefore shrinks a buy even when cash is not the binding ceiling. `suggestion.size-scaled-by-regime` says when it was the tightest of the three.

Every name in one `/suggest` batch is sized against the same book as it stood before the batch, so each buy fits the cash and open-risk room alone. After the verdicts, "If you took every call above" lists what two or more buys would cross together: a sector or segment ceiling, the cash the book can spend (and, where one market's venues reach less, that market's cash), and the room left under the open-risk ceiling. A sale frees neither cash nor open risk until it settles, so only buys count. It is a note, never a refusal; the open-risk figure reads each buy's stored stop, so a stop lifted to a held one makes it err toward silence.

#### Reuse on a market with no session boundary

A crypto day is only a charting convention, so reuse goes by age, not date. A run at 23:00 UTC and one at 01:00 are two hours apart, not two days. A row younger than 4 hours satisfies the gate whichever day it landed in. The cooldown still counts sessions.

A buy also stands until it can no longer be taken as written. Its entry is the live quote, which moves far between runs; re-pricing the same crypto idea each day can move its stop by up to 21%. A run serves the same buy back as `reused` when all of these hold:

- the newest call on the name is an unresolved buy inside its outcome window;
- you have not traded the name;
- the live quote sits between its stop and its void price;
- no settled session since has traded through the stop.

Anything it cannot read runs fresh, and `force` always does.

#### One focus, one call a day

A suggestion is identified by market, ticker, strategy version, **focus key** and day. Your own calls are the `default` focus. An agent with `[focus]` set stores under a key derived from that table (sorted and de-duplicated, so reordering a list never splits a record).

Everything that reads "the previous call" reads it per focus: the cooldown and reuse gates, the standing thesis a new run checks, and the calibration that sizes a buy. A horizon-only focus must not blend into yours. The exit plan, the verdict `/rebalance` reads and the trail that raises stops read only `default`: one book, one plan. Every focus is scored, and a restated price history voids every focus's open calls on the name.

The calibration that tempers conviction and sizes a buy reads only calls whose window has finished, so quick stop-outs cannot make the record look worse than it is.

A name outside the calling agent's focus is refused before any model call, naming the focus. The screen it runs is narrowed to its markets and sectors before ranking, so its board and header count the sector, not the whole market. `/suggest`, the brief, `/suggest stops` and recorded plans are always your own focus.

A focus call reads as a second opinion. It opens with that line and carries levels, thesis, debate and caveats, but no size, units, amount, order notes or `/record` hint, and neither its JSON nor its card carries the holding. Acting on one would open a position no plan watches.

### Outcomes and track record

Suggestions are resolved against later bars: `target`, `stop` or `expired`, with the return and, where a benchmark exists, the benchmark's return over the same window.

**Window.** A call is read at the end of its own holding window. One left pending while the daemon was off past the one-year lookback is still scored as it would have been then. If the bars for that window no longer exist, the call closes with no result (not a flat `expired`) and stays out of every scored count. `/reflect` counts it with the rows closed by a restated price history.

A quote prints inside its own session's range. If a call's session bar no longer spans the quote it was priced on, a dividend or split has adjusted the series under it, and the call closes the same way instead of scoring levels on a scale the series has left.

**Fees.** Every resolved return is net of round-trip fees at the venue the market books to by default (each venue's `fees`, through its `default_for`). A VN call pays brokerage and sell tax, a crypto call pays taker fees, and a market with no priced venue pays a flat 0.1%. The outcome formula version separates rows scored either way.

**VN limit locks.** A session that traded all day at one price pinned at its limit had no counterparty on one side, and the scorer books nothing on that side.

- Locked at the floor: a long's stop is held until the board reopens, then fills at that session's open or at the stop, whichever is lower.
- Locked at the ceiling: a buy's entry moves to the open of the next session that trades, and T+2 and the benchmark comparison both count from that fill.
- A target sale into a ceiling lock still fills, because buyers are queued at the ceiling.
- A call the ceiling kept out for its whole window closes `unfilled`: no trade, no result, out of every scored count.

**Resting buys.** A resting buy fills on the first session that trades below its limit (a touch is not a fill), at that session's open where it opened below. On the call's own day only the move from the quote to the close counts, since the day's low may have printed before the order existed. On the fill session itself the target counts only when the session opened below the limit (a gap fill at the open); a session that opened at or above it filled partway through, and a daily bar cannot say whether its high printed first, so the target is read from the next session. The stop is still tested on the fill session, as it is on every session before the target. A limit unfilled by its last day closes `unfilled` the same way. `/reflect` counts those apart from calls that played out.

The band read is the one stored for the order session, so a new listing's wider first-day band applies to its later sessions too, and a lock in its first weeks can be missed.

**What the track record shows.** It opens with the calls it is drawn from: how many suggestions were made, how many played out, how many are open, and how many sit on a market with no price series and can never be scored. Then it reports win rate, mean and median return, the benchmark comparison and **calibration by confidence band**. A rate without its denominator says nothing. If high-confidence calls win no more often than low-confidence ones, that is the number worth seeing next to the headline.

Every rate counts independent calls. A call repeating one still open on the same name and side rides the same move, so it is folded into the first. The brief re-issues a held idea every session, and each row would otherwise count as another outcome. `/reflect` says how many it folded. The per-focus and per-agent records below fold the same way, each over its own focus's calls (as `/reflect` reads one focus), so a focus reaches the reporting minimum on independent calls and its sample matches what `/reflect` says for it.

The range next to each rate shows how sure that number is: with few calls it is wide, and two rates whose ranges overlap are not really different.

`/reflect` also says what you did with the calls that played out, read from the ledger when the report is made and never stored. A call counts as taken when a fill on its side of the same instrument landed between its order session and the day it was scored out. It prints two figures, each only once its group reaches the track record's reporting minimum:

- the average return of taken calls against passed-on ones;
- the mean gap between each fill and the suggested entry (implementation shortfall; positive means a worse fill).

A VN gold fill is recorded in the shop's unit while its suggestion is quoted per tael, so check one recorded gold buy against its suggestion before trusting the shortfall line for gold.

#### The board's own record

Suggestions are a handful of names a session; the screen scores a hundred. Every settled session the daemon logs each market's whole board (composite, factor scores and close) and scores each row on its close-to-close return over the market's own horizon window, against the benchmark where the market names one. Both closes come off the series as it stands when the row is scored, so a later dividend or split moves neither. No stop, no target, no fees: this measures the evidence, not a trade.

`/reflect` prints it as a second attribution block. It is the sample the factor weights and confidence bands are fitted to as it grows. Each factor is scored per strategy version, newest two per market, because a version change redefines what the factor measures.

A research script measures the VN factors on history ([developer page](dev/trading.md)). Measured over 2025-01 to 2026-07, it is why the VN stock composite carries no `size` or `sector-strength`, why `quality` is read but carries no weight in the score, and why the confidence cut points are fitted on its 75 weekly boards. Over that stretch a sector that had already run picked weaker names, and the best-run businesses did not beat the board; both pulled medium-confidence buys back to where low ones sat. The population is today's listings, so read it as a shape. Quality still prints on the profit and health lines, still shortlists theme names, and still decides a long holding's thesis sale where no annual report scores.

A name that stops trading while its market's benchmark keeps printing resolves at its last close, marked as stopped, once the benchmark has printed ten sessions without it and has reached the window end. `/reflect` says how many. Nothing is imputed.

A name the market's listing still calls active waits thirty sessions instead of ten. The listing comes from a different source than the bars, so a feed that loses one name's series gets six weeks to be repaired before it reads as a stop. A suspension the listing never reports still books.

#### Records per focus, and agreement

`/reflect` shows your own record (the `default` focus only), then a "By focus" block once an agent has called under its own focus. Per focus it shows:

- its resolved calls (independent calls, as above) and win rate;
- how often it takes the action the others take on the same name and day;
- where it went against them and both sides were scored, who was right.

An agent's record across every focus it has used is on `agent show`. Editing a focus never starts a fresh one, and old and new keys are never compared with each other.

The rules are the same everywhere they are measured:

- Calls group by name and day. "The others" are every other focus except the same agent's own.
- The majority is the action more than half of them took. A tie or three-way split is not compared.
- Holding is an action. An undecided hold (a run that failed) and a recorded plan are not a call and do not vote.
- A contrarian case needs both sides scored and a non-hold majority, so a hold majority is left out.
- Two focuses are flagged as one view when they reach the same call 95% of the time or more over at least 20 names both called, not counting names both held. Two agents that wait on everything are not shown as copies.
- Below 20 comparable cases only a count is printed, never a rate.

The `suggestion_track_record` tool returns the asking agent's own focus record and agreement. `GET /v1/suggestions?focus=` lists one focus's calls.

### Alerts and briefs

**Alerts** are price thresholds (`above` / `below`) that fire once and deliver to a channel.

**Delivery.** Each claim on a delivery expires after 60 seconds. A failed send backs off over three attempts, from 30 seconds to an hour, then that delivery is given up rather than retried forever:

- a system-armed alert is disabled, then armed again once 15 minutes have passed while its level is still expected, since the notice never reached you; one a reconcile pass disabled stays retired;
- a brief's day is dropped and tomorrow's is scheduled;
- an alert you created with `/alert` is never disabled for a failed send. It is yours alone and nothing re-arms it, so it keeps retrying, waiting at most an hour between tries, until the channel accepts it or you run `/alert disable`.

**Evaluation** is bounded and shared:

- A tick pages through every active alert, so a stop or target is checked each minute however many are live.
- One quote is fetched **per instrument per tick** and reused by every alert watching that name. That is faster and kinder to the source's rate limit. It lives for one tick only.
- Thresholds compare against the **session's high and low**, not just the last price, so a level touched between two polls still fires. An alert created after its session opened reads the last price alone for that session, because the extremes include moves from before it was watching.
- Alerts on a hard-closed market (a weekend, the lunch break) are skipped rather than burning live quotes. Pre-open and post-close still evaluate against the settled close.
- A missing or non-finite quote leaves the alert active and reports why. An alert that silently stops watching is worse than one that says it could not look.

**Two kinds of alert.** An **operator alert** is one you create with `/alert`. A **system-armed alert** carries a fixed identity the arming pass reconciles against. Crossing detection, retries and disabling work the same for both.

| Armed for | Threshold |
|---|---|
| Each actionable suggestion behind a position you hold (exit alerts) | The plan's stop as trailed today, and its target |
| Every watchlist and held name (screener alerts) | One band either side of the settled close |

A market that declares a trail raises the stored stop every settled session. The raised level arms as a new alert and the old one retires. A write that fails is tried again on the next tick rather than waiting for the next session. A same-day `/suggest` re-run that replaces a buy keeps the level the trail had reached when it sits above the new plan's stop: a stop never moves down.

One alert tick delivers what is due first, then runs the two arming passes, each on its own. A failing pass is logged (`trading.alert_arming_failed`) and the other still runs, so price alerts keep delivering whatever the arming passes do. Inside the exit pass one holding's planning failure is logged with its ticker (`trading.exit_holding_failed`) and that holding keeps the plan it had, while the other holdings are planned as usual. A failure of the delivery step itself still stops the loop, as before.

Both passes **reconcile** rather than append: they work out which alerts should exist now, arm what is missing, and disable what is no longer expected. An exit alert follows the book, so a ledger edit that re-bases positions enables or disables alerts on the next tick. A screener band is tied to its settled day, so yesterday's bands retire on the first tick after the next settle.

The screener band is `average daily range x breakout_range` either side of the settled close, measured over `breakout_sessions` (both under `[trading.alerts]`). They govern when you are notified, not what a suggestion means. A name with fewer than five usable sessions in the window arms nothing: an average built on missing history fires on noise.

**Briefs** are the one daily run: a single pre-open morning brief. There is no after-close run. Resolved suggestions and fired alerts fold into the next morning's brief.

- Sections that could not be built are marked `unavailable`.
- Sections with nothing to say that day (no alert fired, no market-state change) are `omitted-by-policy`.

The two are kept apart because only one of them is a problem.

A brief reads in this order: an **operator** block opening with the book (what you hold, before any market commentary); one **market** block per market, headed by that market's own name and glyph and carrying only the sections that market publishes; and an **actions** block last.

| Block | Sections |
|---|---|
| Operator | `session-delta` `book-summary` `resolved-suggestions` `fired-alerts` `position-exits` `unwatched-positions` `stale-positions` `positions-in-loss` `cross-asset-pulse` `trade-sides` `drift-nudge` `monthly-scorecard` |
| Macro backdrop | `regime-shift` `macro` `deposit-rate` `macro-headlines` `economy-headlines` |
| Per market | `reading` `market-prices` `market-quotes` `market-board` `tape` `breadth` `turnover` `range` `market-cap` `sector-rotation` `foreign-desk-flow` `proprietary-flow` `derivatives` `taker-flow` `etf-flows` `positioning` `premium` `leaders` `leaders-24h` `movers-session` `movers-24h` `sentiment` `basis` `fx` |
| Watchlist | `watchlist-leading` `watchlist-dropped` `screen-delta` |
| News | `disclosures` `index-review` `events` `headlines` |
| Actions | `cost` `suggestions` `cross-asset-suggestions` `next-actions` `discipline` |

Each market publishes only the per-market sections it has data for, so adding a market adds its block and no new section. A market that publishes its own composite and does not own its region (crypto) carries it on its own `/overview` block, with the same score, driver, missing and coverage rows. The region read above it is the owner's.

**Reading order.** Every report opens with its answer and closes with its fine print:

- `/suggest` heads with the call (`BUY`, `NO ENTRY today`...), then one price level per line, then the reasoning and what would prove it wrong, then the factors and debate. The evidence day, profile, board scale and index-tier note close the report.
- `/rebalance` titles itself with the plan in one line (how many names to buy or sell and the money involved); each order keeps its first slice and weight, and NAV and profile close the page.
- `/portfolio` puts a cash-above-target warning right under the headline, and splits cash on hand from profit and loss.
- `/overview` prints a macro driver table once: a second market reading the same composite says so in one line instead of repeating it.
- Headlines and citations print as their sources publish them; one in a language other than yours is marked, e.g. `(Vietnamese)`.

**Ladders** show where a reading sits between two ends. The left end is always the one against the reader, and `●` is the reading itself. A reading past either end sits outside the bracket.

- `/overview` draws the composite on a `-1`..`+1` gauge with `┼` at the market-state thresholds, and each driver between its bearish and bullish anchors. For a rate the bearish anchor is the larger number, so the ladder does the flip for you.
- Each `/portfolio` row with a plan draws its live price between the stop and the take-profit, on its own line and labelled with both prices.
- A suggestion draws none. A fresh plan's first take-profit sits one risk unit above entry, so the dot would always sit in the middle and say nothing.
- Tool results relayed by the model print plain wording, with no glyphs to copy.

**Segment bars** appear only on phones, under each segment's head line: 20 cells of 5% of NAV, so bars compare across rows. `█` is held (`▌` a half cell) and `○` is the one level the row is read against: the target in `/rebalance`, the cap in `/portfolio`. A legend under each table names it. The `○` is hollow so it stays visible inside the filled part. The REPL keeps the plain grid, whose aligned numbers already carry the reading. `/profile` draws no bar: it shows settings, not holdings.

**Next index rebalance.** The brief names the next FTSE GEIS or VN30 rebalance session, worked out from the review rule rather than a maintained list. On the eve, every VN suggestion on an index constituent carries the date as a caveat. On the session itself a new buy is refused and held names read the caveat instead. There is no setting: the dates are the exchange's.

**Suggestion sections run last and cost the most**, on the brief's own share of the budget. If it runs out, those sections are lost, never the whole brief. Each runs a **lean** debate over every held name in its scope first, then the watchlist: `suggestions` for VN, `cross-asset-suggestions` for every other market.

A held name is never cut, because its run is what re-prices the plan:

- a fresh stop (ratcheted, never below the standing one);
- a fresh target;
- the standing take-profit, kept until its first slice is sold;
- any reduce reason, which the exit alerts arm on the next tick.

A name already suggested today is served from its row at no cost.

`next-actions` runs after everything because it reads the other sections' real results. It suggests `/rebalance` only when something drifted and `/alert` only when one fired.

What the read cost sits below a rule at the very end, since it belongs to the whole brief. The per-market split stops a figure being reported twice under two headings: the domestic gold premium belongs to `gold-vn`'s block, futures positioning to `gold`'s.

**Timing.** The default send time is 08:15 in the **market's** timezone (08:15 in Ho Chi Minh City, not 08:15 UTC and not wherever you are). A brief is only sent while the session is pre-open (a market that trades round the clock, or a day it is shut, counts as pre-open), so one is never built or sent mid-session or after the close, and a pre-flight check confirms the previous session produced a bar before any tokens are spent.

After downtime the missed mornings are not replayed. A scheduled day that has already passed is skipped with a `trading.brief_stale_day_skipped` warning and the schedule moves to today. Today's brief still goes out late if the daemon starts after the send time but before the open. If the daemon starts after the open, today's brief is skipped with a `trading.brief_past_open_skipped` warning and the next morning's is due.

A day whose three delivery attempts all fail is given up, not the subscription. The schedule moves to tomorrow, `trading.brief_day_abandoned` is logged, and a notice says today's brief was dropped (sent best-effort through the channel that just failed, so it may not arrive). Only `/brief disable` turns the morning brief off.

- `/brief enable 07:30` sets your own time.
- `/brief enable` with no time follows `[trading.briefs] send_time`, so editing config later still moves the brief.
- Enabling again after today's brief went out starts tomorrow, and is refused while a brief is being sent. The refusal is held at the write, so a send that starts between the check and the enable keeps its claim and the command says a brief is being sent.
- `/brief` alone shows the latest brief, building one if none exists.
- `/brief disable` stops delivery.

### Themes

`/themes` is the top-down read of Vietnamese equities, and it stops short of a trade. One run:

1. updates the themes you already track;
2. looks for new ones forming from macro figures, commodity prices, sector moves and news;
3. for each theme you have approved, maps the sectors it reaches, shortlists companies in code (up to five per benefiting sector) and reads them three at a time.

It gives no prices. `/suggest <ticker>` gives entry, stop, target and size.

Commands:

- `/themes` runs it. It costs model calls, capped by `[trading.themes] max_cost_usd`.
- `/themes run <id>` re-checks one tracked theme with its sectors and companies and looks for no new ones.
- `/themes show` shows each theme as it was last read, for free.
- `/themes approve|reject|retire <id>` moves a theme.
- Over MCP only the read-only `themes_view` tool is exposed.

The theme analyst uses `[[model_tiers.themes]]` when configured and `[[models]]` otherwise.

**Code scores, the model reads.** A theme, sector or company score is arithmetic over the model's ratings and the run's figures, never a number the model produced. It carries a confidence showing how much of the read it stands on. A proposal is judged on its own case and must name the sectors that stand to gain.

**Earnings are a base case.** A read prints `base case EPS {growth} over {months} months`, with no probability attached. A target P/E is refused only when it is above the name's own five-year high. Readings above the hard cap of 200 are left out of the range.

**Each stock read is scored later.** The `theme-outcomes` job compares it with VN-Index at 3, 6 and 12 months from stored bars (no model call), and `/themes show` prints how each score band has done. A name or sector read under several themes in one run counts as one bet, at the mean of its scores. A band is judged only once every bucket holds 20 reads.

**Code keeps the model honest.** Code builds the evidence bundle and mints every id in it (`M1`, `C3`, `N12`); the model only cites them. The theme analyst is the only trading persona with a tool, `research`.

- It updates `active` and `weakening` themes one at a time, then proposes new ones against the titles and theses already known.
- A claim citing an id the bundle lacks is dropped, the model is re-asked once, and a read still without counter-evidence is dropped.
- A proposal needs two origins of support, one of them macro or commodity, and one to three sectors that gain.
- A theme is marked `invalidated` only when one of its own conditions is backed by hard data.
- Only you make a theme `active`, reject it or retire it.

**One budget, one run at a time.** A run draws on one budget, the lower of `[trading.themes] max_cost_usd` and `[budget]`, and on one research quota. Only one run goes at a time per process.

- It writes nothing until every step has answered, and status changes touch only themes still tracked.
- A budget halt ends the stage and names the steps it skipped.
- A board that cannot be read skips the company stage and reports a `screen` gap.
- Each theme starts from its own latest read, so the last run is never the whole picture.

**From theme to company.** For each `active` theme, code reads the board, the sectors, the stored quarters and one day of valuation ratios once. The analyst maps the theme to at most three ICB super-sectors, each with a cited counter claim. Code then shortlists at most five names per sector from the board's survivors whose quality factor fired, dropping weak Piotroski scores, Beneish flags, negative free cash flow and non-positive return on invested capital. The analyst reads the names three at a time, without `research`.

**Company reads are checked.** Code re-asks once, then drops the name with a note, when a stock read's scenario odds do not sum to 100, its target P/E is above the name's five-year high, or an "earnings" verdict cites no accounts figure. Code, not the model, computes crowding and earnings surprise: an unread signal never makes a name crowded, and a quarter more than three behind the calendar is not read.

**How a score is built.** Theme, sector and stock reads each get a 0-100 score from fixed weights, stored with the run.

- A part that was not read drops out of the weights instead of counting as zero, and a read with under half its weight read stays unscored.
- An invalidated theme, and a sector it hurts, is never scored.
- Confidence comes from the weight read and from the figures the read's own case cites, never from how far apart the parts are.
- The parts are stored with the read, so a score can be recomputed.

### Background operations

These run in the daemon, with more when a venue has exchange credentials. Each runs at a default cadence built in and does nothing when nothing is eligible. Failure behavior is in [built-in jobs](operations.md).

| Operation | Every | Batch | Registered | What it does |
|---|---|---|---|---|
| `alerts` | 60s | 50 | always | Deliver what fired, then reconcile exit and screener alerts against the book |
| `briefs` | 60s | 50 | always | Build and deliver briefs on their schedule |
| `outcomes` | 12h | 50 | always | Resolve pending suggestions against later bars |
| `macro-extract` | 12h | 3 | always | Read statistics-office (`nso`) reports and matching press items into stored macro series, on the `extraction` model tier |
| `theme-outcomes` | 12h | 50 | always | Score `/themes` company reads against VN-Index at 3, 6 and 12 months, from stored bars; no model call |
| `refresh` | session-aligned | - | always | Refresh every market still in use, then record order flow, then log each market's settled board and score earlier boards that reached the end of their window (see [the board's own record](#the-boards-own-record)) |
| `intraday` | schedule-aligned | - | always | Deliver the intraday read on the region's configured fire times, idling between them |
| `exits` | 60s | 50 | a venue has trading credentials | Reconcile what rests at the exchange against the book, and trail the stops it holds |
| `intents` | 5m | - | an order service exists | Settle an order the exchange took that the book never got; reaches no venue |

The last two are absent on an install with no exchange credentials, which is why the loop count differs between two books. A venue with no credentials can rest no exit, and with no order service there is no unsettled order.

The alert loop runs in order (deliver, arm exits, arm screeners), so an alert can never be delivered by the tick that armed it. Order flow rides the refresh anchor because it records one row per name per settled session, the moment refresh already waits for.

Only the `[trading.refresh]` cadence is configurable. The alert loop and resting-exit reconciliation run every 60 seconds and missed-fill settlement every 5 minutes, fixed. The rest (`briefs`, `outcomes`, `macro-extract`, `theme-outcomes`) are paced by what they cost.

#### How refresh is scheduled

Refresh follows the trading calendar, not a fixed interval. It fires when each session settles (the close plus the auction lag, the same instant that decides whether a session counts as settled) and 60 minutes before each open, so the morning brief and the first screen read fresh data without paying for the fetch inline. Every market with its own hours anchors a tick. The configured interval survives as a ceiling for continuous markets and for an empty registry.

Refresh covers every market you still use: a segment switched on in the profile, or a market where you hold a name, watch one, wait on a call to be scored, or get a scheduled brief built on it. A switched-off segment drops out only when none of those still reads it, so a holding's stop is never left without prices. With no profile yet, every market refreshes. A failed read of that set refreshes everything. The morning brief describes the same set, and naming a market on `/refresh` refreshes it regardless.

Markets run together, not one after another. They share almost no source, the pacer meters the few they do, and making each wait for the last would only add up independent hosts.

Inside the VN board the same idea applies. Price history, financial ratios and trading flows load at the same time. The macro read and the financial reports wait for them, because both read what those three just stored.

**One sweep per market at a time.** A `/refresh` typed while the scheduled tick is running joins that fetch instead of racing it. `/refresh force` is the one pairing that queues instead of joining: an unforced sweep may skip scopes it considers fresh, which is exactly what `force` asks to redo.

`/refresh <market>` sweeps only that market. An unregistered name earns the usage line rather than a silent no-op. A command that joins a sweep in flight says so and names the market it waits on. Every progress line names its market, since an unnamed one would flicker between the markets sharing the line.

**What reading the board cost travels with the pass.** The crypto sweep plans against the ranked market-cap board, whose sources publish different depths (750 rows, 250 and 100). A sweep that failed over to a shallower one plans over a fraction of the field, and every count it reports would describe that fraction as the whole. So the board's own caveats and `market-data.universe-shallow` reach the result, as `/screen` and `/overview` already say about the same sweep. A result whose every target failed still earns `source.no-available-provider`.

**A refresh caveat names its own kind.** `/refresh` prints each kind as a row. `/overview` and `/brief` hoist every caveat into one deduped list, where a note reading `1 of 23 pulls landed` answers no question. So each caveat's sentence names its kind, wherever it lands, and the refresh view prints the notes under the market rather than under a row that would state the kind twice.

**Who was in charge of a session is recorded once, or not at all.** Every refresh records the buy/sell aggressor split for each name you hold or watch. Neither source behind it accepts a date: `kbsec` answers with whatever session its board currently holds, and `vietcap` pages backwards from the newest tape. So the split is readable only between the tape-settle instant and the next open.

The refresh anchors put two passes inside that window (15:15 and 08:00 for a VN board). After the open the session is gone for good. A name the sweep could not record is therefore named under its market in the `/refresh` view, since a miss no later pass can fill is a hole in the series. The sweep covers only the markets that refresh covered, so `/refresh crypto` spends no VN source's budget.

A name neither held nor watched is never swept, which is every buy candidate. `/suggest` reads the buy/sell split itself for the session it is judging and stores nothing; a stored row would otherwise join a brief section that lists what you follow. Both readers ask for the same day, so a stored row from an earlier session never stands in for the session being judged.

**One trading-flow signal on every VN screen row:** a *foreign flip*. Foreign net selling, as a share of turnover, is two standard deviations below a trailing mean that was net buying, after a rise of 3% or more over four sessions. It changes no score. A suggestion on a name showing it carries it as a caveat, and the factor log carries it so the forward record can say what it was worth before it earns a weight.

**Crypto reads its own trading flow.** Two signals ride on every crypto screen row and are logged with its factor scores:

- A *washout that held*: a session down at least 5% over four sessions, on relative volume of at least 1.5, closing in the bottom fifth of its range, whose low every later session has held, read for the two to four sessions after it.
- A *leverage-led rally*: open-interest contracts up at least twice as much as price over the same three sessions, on a rise of 5% or more.

Neither changes a score. A suggestion on a name showing one carries a caveat: the first says selling here sells the low, the second says the rise is carried by leverage rather than spot. There is no setting. The thresholds are strategy policy, versioned with the crypto strategy.

**Crypto factors, equal weight:** trend, funding, the retail long/short lean, turnover velocity and volatility.

- Trend is the only price-strength reading, on purpose. Momentum and the distance to the 200-session high were checked against what coins did over the next one to four weeks, added nothing, and moved in step with trend. Keeping all three meant counting one opinion three times.
- Funding and the long/short lean are contrarian: the side paying to stay in, and the crowd already in, have less left to buy.
- The lean is Binance's global long/short account ratio, stored with the funding row. There is no setting for it.

**Boot.** The first refresh runs under a **60-second budget** and is then detached. A warm store settles inside the budget. A cold one times out, the daemon starts accepting work, and the sweep finishes in the background: freshness eventually, correctness always. Nothing aborts the sweep at the deadline, because an aborted scope writes no attempt row and the next tick would redo all of it.

### Costs and limits

Costs are tracked per run. Daily, monthly and per-run caps are **opt-in**: `0` means uncapped, which is the default. A soft warning fires at 80%. Loops are bounded by turn and duration caps and a loop detector.

The loop detector does not halt a run:

- On the second near-identical call it blocks that one call with a redirect the model can read.
- On the third it **closes the tool surface** for the rest of the run. The transcript already holds every result the model fetched, so a run that ends in an answer built from them beats one that ends in a halt code.

The tool-call budget still halts, because it is a budget.

The debate runs its personas on the `debate` model tier when one is configured, else on the primary chain. A board debates five names at a time.

### Surfaces

Every capability is reachable through these surfaces, from the same services.

**Tools** (for agents), with `order_place` and `order_exits` added when a venue has trading credentials. Some are offered to the model up front: `market_overview`, `market_screen`, `market_price`, `market_bars`, `market_events`, `market_sector_strength`, `macro_risk`, `vn_foreign_flow`, `portfolio_view`, `portfolio_record`, `profile_update`, `suggestion_run`, `suggestion_batch` (and `skill_view`). The rest are found through tool search when a turn needs them.

The split is narrow on purpose. A tool is offered up front only when a model that cannot see it would answer from the open web, with plausible-sounding numbers for facts this product already holds. Every up-front tool costs tokens on every turn, so the whole up-front set is capped at 23.

Tool search only blocks a call it had to *guess* at. A call by exact name loads the tool and runs it. A call matched by similarity is blocked, and the result names the loaded tools and ends with a `hint` saying what to call. Up to eight searched tools stay loaded, oldest evicted first.

The full set:

`market_price` `market_bars` `market_overview` `market_events` `market_accounts` `market_news` `market_screen` `market_sector_strength` `market_sentiment` `market_funding` `macro_risk` `vn_foreign_flow` `vn_futures_basis` `portfolio_view` `portfolio_history` `portfolio_review` `portfolio_rebalance` `portfolio_record` `portfolio_update` `portfolio_remove` `watchlist_update` `profile_view` `profile_update` `profile_segment` `suggestion_run` `suggestion_batch` `suggestion_track_record` `alert_manage` `brief_build` `brief_manage` `themes_view`

**Slash commands** (chat, REPL): `/setup` `/record` `/update` `/delete` `/transactions` `/portfolio` `/profile` `/watchlist` `/price` `/market` `/overview` `/screen` `/sources` `/suggest` `/themes` `/rebalance` `/reconcile` `/reflect` `/alert` `/brief` `/refresh`, plus `/trade`. `/trade` places orders once a venue has trading credentials and otherwise names the keys it needs. Full grammar: [Commands](commands.md).

**Terminal chat** uses the same slash commands as every channel:

```bash
openalpha chat --message "/setup"
openalpha chat --message "/record deposit vps 100000000 VND 2026-08-03"
openalpha chat --message "/profile set risk-level balanced"
openalpha chat --message "/suggest FPT"
```

`/alert create` and `/brief enable` need a chat that can receive messages, such as Telegram or Zalo. The terminal refuses them; type them in a connected channel.

Use natural-language chat for anything the slash grammar does not cover: bars, curated news, sector strength, foreign flow, portfolio review, track record. The agent calls the typed trading tools.

You may omit the market when a ticker resolves uniquely. If two markets claim it, the suggestion reports `ambiguous-market` and asks for the market instead of guessing.

**HTTP** (loopback, bearer-authenticated). `openalpha start` serves a local API when `[api] enabled = true` (see [`[api]`](configuration.md)). Routes return **codes and data, never prose**: a client receives `{ code: 'suggestion.reused-same-day' }` and renders it in the reader's language. Every request acts as the single local operator, fixed at startup, so no payload can select or spoof a user. Route list: [developer page](dev/trading.md).

### Language

Every string you see is a locale key, in English and Vietnamese. Codes derive from fixed lists, so a new value cannot exist without a catalog entry: startup fails, and a build check fails even earlier.

Vietnamese terminology is checked at build time. The failure that matters is not a mistranslation that looks wrong, but one that looks fine: a `reduce` suggestion rendered as *bán* tells you to sell out when the product suggested trimming.

### Storage

The schema starts consolidated and grows by migration. Migrations run in id order, only those not yet applied, and an applied migration never changes.

Market data retention is **derived, not configured**: the longest evidence window any registered market declares, converted from sessions to calendar days by that market's own weekend rule, plus a 5% margin. A configured value was both wrong by default and unjudgeable. A sweep shorter than the longest evidence window deletes rows the factor pipeline re-requests on its next run.

---

## The book

The ledger is the only source of truth. Positions, cash and NAV are all calculated from the ledger rows, never stored as balances that could drift from the entries that produced them.

A position is keyed by instrument **and venue**. The same coin at two custodians is two positions, with two cost bases and two settled quantities. A sale on one releases that venue's basis, not an average that includes coins held elsewhere. `/portfolio` merges them back into one row (one exposure, one weight, one blended cost) and adds a venue line beneath only when a holding actually spans venues. Cash is held per venue too; the consequence is spelled out at the end of this page.

Recording a transaction updates your ledger. It never sends an order anywhere.

### The ledger

Every row has an id, the time it was first recorded, the time it was last edited, and the transaction itself. One trade is one row, edited and deleted in place. Mistyping a day means fixing that day, not adding a row to replace it.

This is a deliberate tradeoff: the book is calculated from the rows **as they stand right now**. Editing an entry recalculates every number derived from it, including suggestions made before the edit. There is no audit trail, and `/reflect` cannot prove what the book looked like on the day a suggestion was made. Convenience was chosen over that guarantee.

| Kind | Shape | Effect |
|---|---|---|
| `deposit` | amount, currency, day | cash in |
| `withdrawal` | amount, currency, day | cash out |
| `fee` | amount, currency, day | cash out |
| `loss` | amount, currency, day | cash out |
| `buy` | instrument, quantity, unit price, fee (optional), currency, day | cash out, quantity in |
| `sell` | instrument, quantity, unit price, fee (optional), currency, day | cash in, quantity out |
| `rights` | instrument, quantity, unit price, fee, currency, day | cash out, quantity in |
| `dividend` | instrument, amount, currency, day | cash in |
| `split` | instrument, signed quantity delta, day | quantity only |
| `distribution` | instrument, signed quantity delta, day | quantity only |
| `transfer` | from venue, to venue, amount, currency, fee, day | cash moves between two of your venues; net deposits do not move; the fee is charged at the source |

A share-count adjustment (`split`, `distribution`) moves no money, so it accepts no currency and no FX rate. The wrong entry is impossible to write, rather than checked after the fact.

**Every row naming an instrument names a venue.** A venue the registry does not know, or one that cannot hold the row's market, is refused. That includes splits: a venue that cannot hold the market has no position to adjust. A cash row names a venue and no instrument.

**Fees.** A `buy` or `sell` may leave its fee out. The `fees` rate you configured for that venue in `[trading.venues.<id>]` then prices it, never zero, which would understate the book forever. Every venue has a rate, because a broker declared by hand must state one. `rights` always states its own fee, since a rights issue is not brokered at the standard rate. A stored row always carries a fee; only what you have to type differs. The write confirmation says which rate the fee came from, or how far a stated fee sits from it.

**The quantity is asked of the venue, never derived from a rate.** A venue marked `fee_asset = "base"` in its `fees` (OKX and Binance by default, like most crypto exchanges) takes its **buy** fee out of the asset it delivers, so an order for 3 coins credits fewer than 3. The row must carry what was actually credited, because the position adds `quantity` as is and a fee only moves cash.

The shortfall cannot be computed from the configured rate. An order fills as maker or taker and only the exchange knows which, so a derived quantity would be a guess stored as a recorded fact. A sell is unaffected: its fee comes out of the proceeds, which the cash side already carries.

Recording a trade at a venue with trading credentials looks up what that venue actually filled that day, on that side, in that instrument. **Exactly one** fill within 1% of the size you stated makes the row, with its filled quantity net of a base-billed fee, its average price and its fee priced in the transaction currency.

Anything else leaves the row as typed: a venue with no client, a day outside the venue's history window, no match, two fills either could be, or a venue that does not answer. A fee you state is never overridden. Stating one is how you record a trade the exchange cannot be asked about. The confirmation says which of the two happened.

**`fee` vs `loss`.** Both take cash out and neither touches net deposits, but a fee is a cost of trading and a loss is the trading result. `loss` exists so money lost on trades that closed before the book started keeping records (what a snapshot import can only state as a total) is not filed as a brokerage charge.

**Days.** A row's day is a trading day (`YYYY-MM-DD`), never a datetime. Two entries on the same day are ordered by id, which keeps recording order within the day. Settlement is derived by the owning market's calendar: T+2 for Vietnamese equities, same day for every other market. It is re-derived whenever you edit the day.

#### Fixing an entry

`/transactions` prints a short handle beside every row. That handle is what you type back:

```text
🧾 Recent transactions
  [0f9838] 2026-06-14 Buy ACB 600 @ 22,400 VND
```

```bash
openalpha chat --message "/update 0f9838 buy VPS equity-vn:ACB 600 21900 VND 12000 2026-06-16"
openalpha chat --message "/delete 0f9838"
```

`/update` takes the handle followed by the same fields `/record` takes: the whole transaction, not a patch. It must state its own quantity and fee, where `/record` may write `all` or leave the fee to a rate. An edit names a row that already carries both, and re-resolving either against a later book or a changed rate would move a settled figure you never restated.

`/delete` removes the row outright (a duplicate, or a trade that never happened). Both accept a full entry id too, which is what the agent passes via `portfolio_update` or `portfolio_remove`.

The handle is the last six characters of the entry id, not the first: ids open with a timestamp, so rows recorded in the same millisecond share leading characters. A handle that matches more than one row is refused rather than guessed.

Any field can change, including the day. Backdating is not restricted.

#### What a write checks

Every insert, update and delete validates the **whole book as it will stand afterwards**, in the same transaction that writes it. An edit can invalidate a row it never touched. Shrinking a January buy can overdraw a February withdrawal that was affordable when you recorded it. Moving a buy before the deposit that funded it leaves you spending money you did not have yet. Both are refused with the day and the shortfall named:

```text
buy on 2026-06-11 needs 13152000 available cash, book has 0
sell of 600 ACB exceeds 0 settled on 2026-06-15
```

A row dated after today, on the home region's calendar, is refused too. A trade that has not happened yet is a typo, and the book would otherwise hold it out of sight until the day came.

#### What a write confirmation says about the fee

```text
🧾 Recorded
  Entry: da6319
  Type: Buy
  Day: 07/09/2026
  Venue: VPS
  Quantity: 1,000 E1VFVN30
  Price: 35.32/E1VFVN30
  Fee: 52,980 VND
  Fee taken at 0.15% - correct it with /update if it differs.
  Cash is now 64,627 VND
  E1VFVN30 is now 1,000 at an average cost of 35.32
  Cost basis incl. fee 35.37 (matches your broker app)
```

There are two cost bases, on purpose. The average cost is what the fills printed, and every valuation and P&L measures against it. The line below it is the same basis with the entry fee included, the number your broker's app shows. It appears only here, when you have the app open to check the row.

- A stated fee that sits far from the configured rate replaces the rate line with how far off it is, rather than being silently accepted.
- A market with no configured rate prints neither line: there is nothing to measure against, and a zero would read as agreement.

Every field is labelled here and nowhere else. A confirmation is read alone, against what you meant to store. `/transactions` keeps the unlabelled one-line row, since a field list repeated down a page cannot be scanned.

### Two views, enforced by type

This is a structural boundary, not a permission flag.

| | Relative view | Absolute view |
|---|---|---|
| Shows | weights, percentages, return percentages | money: NAV, cash, cost basis, P&L |
| Reachable from | agent tools, chat | your authenticated local HTTP API and slash commands |

They are different types with different fields. An agent cannot learn your account size by accident, because no code path hands it a money-valued book.

### Valuation

A holding below the venue's minimum order size is not listed. The venue will not trade it, so the row would describe something you can neither sell nor act on. Its value still counts toward NAV and the allocation table, and the section says how many rows it held back. A weight with nothing under it is what that count explains.

A valued position is either:

- **priced** - it has a price and a value;
- **unpriced** - it carries a **caveat** saying why, and no value at all.

A missing price is never rendered as zero. Zero is a claim the valuation did not make, and it matters when it is your whole position in a suspended name.

A coin held at two custodians is merged into one exposure, so it is quoted once, weighted once and converted at one rate. Sector caps, segment caps and the rebalancer all work from that merged exposure.

#### Two rates, and which currency each market settles in

A market value converts at today's rate for the market's own currency. A cost basis converts at the rate frozen on the row when the trade was recorded, so an old entry keeps the money it actually cost. The gap between them is the currency move on what you hold, and the book reports it as its own line rather than folding it into the price move.

The currency belongs to the market. Crypto settles in **USDT** and gold in **USD**, and each converts at the rate its own market trades against: `USDTVND` for coins, `USDVND` for gold. The interbank USD fixing is deliberately not used for coins, because USDT is not USD and the fixing is not a rate a crypto holder can transact at. Measured 2026-09-08, the two were 0.3% apart, all of it in the direction that overstated the book.

`USDTVND` comes from the coin sources only. When they are all out there is no fallback to `USDVND`, because a silently substituted rate is worse than none. The position reads as unpriced with `valuation.fx-missing` and NAV is withheld.

A row may carry the operator's own rate instead of the market's: `fx <rate>` at the end of a `/record` line stores the rate you actually paid, with its source recorded as `operator`, and `fx auto` takes the day's market rate on purpose. Cash rows may now also be in a currency a venue's markets are quoted in, so `/record deposit binance 1000 USDT 2026-08-14 fx 26600` is a valid row. Without `fx`, a row in a foreign currency is previewed and held for `/record confirm` rather than written at a rate you never chose; `/record sync` books at the market rate and says which currencies it did so for.

#### Foreign cash at a venue

A deposit in a venue's quote currency, such as `/record deposit binance 1000 USDT 2026-08-14 fx 26600`, makes that venue hold USDT as its own cash balance, with an average cost in the book's currency (26.6 million VND here).


A crypto round trip, step by step, with the rate you paid recorded once, on the deposit:

1. **Deposit USDT with the rate you paid.** `/record deposit binance 1000 USDT 2026-08-14 fx 26600`.
2. **Buy with that USDT, no `fx`.** `/record buy binance crypto:BTC 0.01 60000 USDT 2026-08-14`. It
   spends the USDT at its cost; an `fx` here is refused with the reason.
3. **Sell back into USDT.** `/record sell binance crypto:BTC all 65000 USDT 2026-09-01`.
4. **Withdraw USDT with the rate you sold at.** `/record withdrawal binance 500 USDT 2026-09-20 fx 26900`
   books the gap between the two rates as realized P/L.
5. **Check** with `/portfolio`, `/transactions`, and `/reconcile` once the venue's key is set.

Already holding USDT or coins at the venue when you start the book? Record today's balance, not the
history:

- **USDT only:** one deposit of the USDT you hold, with `fx <its average cost>`, or `fx auto` if you
  do not know it (currency P/L before that day is then not counted).
- **USDT and coins:** deposit the USDT you hold plus what the coins cost, then one buy per coin at its
  current quantity, average cost and a fee of `0`. The book's USDT then matches the exchange. The `0`
  fee prints a "fee differs" note, which an opening balance can ignore.

```text
/record deposit okx 1300 USDT 2026-10-16 fx auto        # 1,000 USDT held + 300 spent on BTC
/record buy okx crypto:BTC 0.005 60000 USDT 0 2026-10-16
```

`/record sync` reads fills only from the book's first row on, so it cannot book coins bought earlier.
With the venue's key set, `/reconcile` checks the result against the real balance.

Holding a few shares, sold a few at a loss, and don't want to retype every old trade? You don't have
to. The book needs three things: what you put in, what you hold at what cost, and what you lost on what
you sold.

```text
/record deposit vps 200000000 VND 2026-10-01                 # everything you deposited
/record buy vps equity-vn:FPT 1000 95000 VND 0 2026-10-01    # one line per name you hold
/record buy vps equity-vn:HPG 2000 26000 VND 0 2026-10-01
/record loss vps 15000000 VND 2026-10-16                     # the total lost on what you sold
```

- **Holdings:** take quantity and average cost from your broker's app, with a fee of `0`. That average
  already includes fees; leave the fee out and the book charges it again. The confirmation adds a
  "Fee is -100% off" note; ignore it.
- **Date the buys a few days back.** VN shares settle T+2, so a buy dated today cannot be sold in the
  book for two sessions.
- **Book the loss as `loss`**, not `withdrawal` or `fee`. A withdrawal reads as money you took home and
  flatters your return; a fee reads as brokerage. `loss` takes the cash out but leaves what you deposited
  alone, so `/portfolio` shows it as "Realised P/L on closed trades: ▼ -15,000,000 VND".
- **The deposit has to come first.** Every write checks the whole book, and a buy or loss with no cash
  behind it is refused.
- **Each name gets an exit plan straight away**, measured from the cost you typed. A name trading well
  below that cost may already sit under its stop, and `/portfolio` then says it is "through its stop".
  That is a prompt to review the name, not a booking error.

Then open `/portfolio` and compare its cash with your broker's balance. Here: 200 million in, less 95
million FPT, 52 million HPG and the 15 million loss, leaves 38 million. A gap usually means the loss or
an average cost is off; fix it with `/update <id>` rather than adding a row.

**Crypto works the same way**, in USDT:

```text
/record deposit binance 2000 USDT 2026-10-16 fx 26500        # all the USDT you deposited, at the rate you paid
/record buy binance crypto:BTC 0.01 60000 USDT 0 2026-10-16  # one line per coin you hold
/record buy binance crypto:ETH 0.2 2500 USDT 0 2026-10-16
/record loss binance 300 USDT 2026-10-16                     # the total lost on coins you sold
```

- **No `fx` on the loss.** The venue already holds USDT, so the loss comes out of it at the cost on your
  deposit line. Add `fx` and the book refuses it and asks you to drop it.
- **Today's date is fine**, since coins don't wait for T+2.
- A coin buy with a `0` fee prints two notes, "Fee is -100% off" and "Binance takes the fee in BTC...".
  For an opening balance ignore both, as long as the quantity matches what the exchange shows.
- **Each coin gets an exit plan straight away** (stop and take-profit), measured from the cost you
  typed. A coin that has run far from its cost can have levels well away from today's price;
  `/portfolio` shows how far.
- **Check:** the USDT in `/portfolio` should equal the exchange's. Here: 2,000 in, less 600 on BTC, 500
  on ETH and the 300 loss, leaves 600 USDT. With the venue's key set, `/reconcile` checks it for you.

If the book doesn't need to remember the old loss, skip it: deposit your current cash plus what your
holdings cost, and drop the `loss` line. Profit and loss then start from today.

Either way, the history of each name you sold is gone: `/transactions` shows one loss line. `/reflect`
is unaffected, because it scores the assistant's calls, not your trades.

- **Which rows move it.** A USDT deposit, withdrawal, fee, loss or transfer always does. Once a venue holds USDT, every USDT buy and sale there does too: a buy spends USDT at its average cost and carries that cost into what it buys, and a sale returns its proceeds to the USDT. The first USDT recorded at a venue changes how later trades there are paid, a deposit dated before trades the venue funded in VND included, and those trades can then be refused. To switch a VND-funded venue over, withdraw the VND, then deposit the USDT with `fx`.
- **The rate goes on the deposit, not the buy.** A buy, sale, fee or transfer paid from USDT the venue holds takes no rate, so `fx` on that row is refused with the reason rather than dropped. The P2P price you paid belongs on the USDT deposit.
- **A withdrawal realizes the currency move.** The USDT leaves at its average cost, but net deposits fall by what it was worth that day. Deposit 1,000 at 26,600, then withdraw 1,000 at 27,000, and realized P/L is +400,000 VND with cash back at zero.
- **Neither currency quietly converts into the other.** A USDT trade at a venue spends only its USDT and is refused with the currency and venue named when it runs short. A VND withdrawal, fee or transfer there spends only its VND, even if the venue holds USDT.
- **The currency line starts negative after a P2P deposit.** USDT is marked at the market USD/VND rate while its cost is the P2P rate you paid, so right after a deposit at 26,600 the line reads about -2% when the market rate is about 26,036.
- **Where you see it.** `/portfolio` lists the USDT beside cash with its cost and today's value, and prints its currency move. `/reconcile` compares it with the exchange's own USDT balance.

#### Every mark says how it was taken

A priced position is marked either:

- `live` - its observation is later than the last settled session close on that instrument's own market calendar;
- `close` - it is that settled close.

Each market answers on its own calendar, so one book can hold both at once: VN equities settled at 15:00 Hanoi while crypto never stopped trading.

The book as a whole is `live` only when **every** priced position is live, otherwise `close`. A live book shows the clock time of its freshest mark. A settled book names the session it was priced at. A mixed book reads as settled and labels its exceptional legs on their own rows, so the headline never claims a freshness only some holdings have. That is what stops a total pulled at 11am from reading as a closing value, and one pulled at midnight from reading as live.

**Realized P/L** is the exception. It is cash + cost basis - net deposits, so no price enters it and it is present even when NAV is not. Every deposit that is neither cash on hand nor basis in an open position was spent or lost on a trade that has closed. Unrealized P/L is the paper move on what you still hold; realized P/L is what is settled and gone. They render as separate lines.

When any holding is unpriced, NAV is withheld and the assessment carries `portfolio.valuation-partial`. Weight-based checks skip themselves rather than divide by a partial total, and a buy placed through `/trade` or `order_place` is refused for the same reason. The exclusion and liquidity checks still run, because "you still hold something on your exclusion list" is true regardless of pricing.

### How your book has done

`/portfolio nav [1m|3m|6m|1y|all]` (default `3m`) shows how the book has done over time. It is built from one snapshot a day:

- **One snapshot a day.** After each `trading.refresh` pass the daemon values the book exactly as `/portfolio` does and keeps one row for the day; the last pass of the day wins. History starts when you upgrade. Nothing is rebuilt from the ledger, because stored VN closes are back-adjusted and ledger quantities are not.
- **Time-weighted return.** A deposit or withdrawal moves the book's value without being a gain, so it comes out of the day it lands on. A dividend, fee or loss stays inside the return.
- **Drops from a peak.** The deepest drop and how far below the peak you sit today, both on the same index.
- **A yardstick from your own target mix.** Each segment you gave a target earns its market's benchmark index and cash earns nothing. A segment whose market has no benchmark is left out and the rest are scaled back to a whole; gold has none today. The reply names the legs. If no segment you target has a benchmark, there is no yardstick and the reply says so. If an index has no prices covering the whole window (none back to the first snapshot, or none near the last), the yardstick is left out rather than computed from part of it.
- **Gaps.** A day with a holding that has no price writes no row and logs `trading.nav_snapshot_skipped` naming the instruments; that day's earlier row stays. A day the daemon was off has no point, but the return across the gap is still exact, because deposits are read from the ledger. An empty book writes nothing.

These are your own figures. They appear only on slash commands and the loopback API (`GET /v1/portfolio/nav`), never to a model or an MCP tool.

### Health findings

The health rules produce these findings, each carrying the **subject** it is about, so two breaches of one kind read differently:

| Finding | Fires when |
|---|---|
| `segment-cap-breach` | a segment is above its ceiling |
| `etf-cap-breach` | a segment's ETFs together are above that segment's ETF ceiling |
| `segment-drift` | a segment is 5 points or more from its target |
| `position-cap-breach` | one name is above the per-position ceiling for its segment |
| `concentration` | one name is 20% or more of NAV (a fund under its segment's ETF ceiling is exempt) |
| `sector-cap-breach` | a sector is above `maximum-sector-pct-nav` |
| `reserve-below-target` | cash is below `reserve-pct-nav` |
| `excluded-holding` | you still hold something on your exclusion list |
| `illiquid-position` | a position would take more than 5 sessions to exit |

An ETF never counts toward a sector weight: its source sector names the vehicle, not the basket, so the segment's ETF ceiling bounds it instead. That ceiling replaces the per-name cap for the fund, here and when a suggestion sizes one; a segment with no ETF ceiling keeps the per-name cap for its funds too.

Every finding that crosses a numeric limit names both sides of it, the weight it measured and the cap or target it breached, so you can check the sentence against the book. Both are printed at one resolution on every surface. `excluded-holding` and `illiquid-position` carry no such pair: neither breaches a number, and the second already names its own sessions.

### Profile

The profile is your policy, and the pipeline reads it rather than guessing.

```bash
openalpha chat --message "/profile show"
openalpha chat --message "/profile set risk-level balanced"
openalpha chat --message "/profile reset"
```

`/profile set` takes one field name and one value. Each write is a single atomic update of your profile. If two chats edit at once, the last edit wins and neither is rejected.

**Settable fields:**

- `preferred-locale`, `risk-level`, `risk-capacity`, `risk-willingness`, `horizon`, `goal`
- `maximum-sector-pct-nav` - the most of your total assets one sector may take
- `reserve-pct-nav` - the cash you always keep
- `regime-scale` - the most of a planned buy that is used each time (0.75 uses 75%); a defensive market can lower it further
- `risk-per-trade-pct-nav` - the most one new buy may lose at its stop-loss
- `maximum-open-risk-pct-nav` - the most every holding may lose together at their stops
- `entry-tranche-pct` - the share of a new buy placed first (0.5 by default)
- `take-profit-tranche-pct` - the share sold at the first target and in a reduce (a third by default)

Both fields take 0.2 to 1.

**Segment policy** has its own forms:

- `horizon <segment> <short|long>`
- `segment-target`, `segment-cap` and `position-cap`, each taking a segment and a fraction
- `/profile enable|disable <segment>` turns a segment on or off

A segment no venue trades (world gold, kept for its price and the `gold-vn` premium) stays off, and enabling it is refused. `/suggest` on one of its names still gives the factor read and levels, as a hold with the reason `reference-only`, and runs no debate. The usage text of `/profile`, `/record` and `/rebalance` leaves it out, and `/overview` prints its macro read without the line on how much of a planned buy to spend, since nothing is bought there.

`maximum-open-risk-pct-nav` bounds what every held name may lose at its planned stop together. A new buy is sized into the room left under it, and a held name with no planned stop is reported rather than counted as safe.

`risk-level` and the pair `risk-capacity`/`risk-willingness` are **mutually exclusive**. The level is the shorthand and the pair is the derivation behind it. A write that sends both is rejected. The `profile_update` tool builds that rule into its own schema, so the model is told to retry before you are asked to approve a write that cannot land.

**Units.** Profile policy fields are **fractions** (`0.25`), while every weight shown in a view is a **percentage** (`25`). The suffix `pct-nav` means a share of NAV, your total assets, and appears on both.

Risk level sets the defaults, and bounds limit what you may set. A per-trade risk of 40% of NAV is rejected, not accepted and then quietly ignored. The refusal names the field you typed and the range it allows.

Changing the risk level re-seeds the caps for the new level, but two things you set yourself stay: a segment's target and a segment's ETF core. A core above the new ETF cap is held at the cap and comes back to your number once the cap widens again. Turning a segment off and on keeps it too. `/profile reset` clears both.

Every screen whose numbers the profile shaped names it once, in the last line of its headline: `/portfolio`, `/rebalance` and a stored suggestion. The stamp is identity only (risk, horizon, goal, plus a marker when nothing was saved), because every limit already prints where it binds. A stored suggestion carries the stamp it was sized under, so viewing it again states the policy its numbers came from, not the one in force when you look. `/reflect` carries none for the same reason: its rows were sized under whatever applied on each of their days.

### Advice

Advice is either **ready** (segment allocation, per-position rebalance, a cash segment posture and weak holdings) or **unavailable**, with one of four reasons:

| Reason | Meaning |
|---|---|
| `zero-nav` | there is nothing to allocate |
| `incomplete-valuation` | at least one holding could not be priced |
| `insufficient-policy-input` | a held instrument has no screening data |
| `unresolved-names` | a ticker you named does not match a registered market |

An unavailable answer still carries the findings, because "you are over your sector cap" stays true when one holding is unpriced.

A segment the plan could not fund to target raises one caveat naming that segment. Each segment gets its own slice of the deployable pool, so a plan-wide shortfall would otherwise blame a neighbour's exhausted budget on whichever name sat below target.

The deployment ceiling that gets printed is the whole book's, not one segment's. The pool is split by profile target weight and each slice is held to its own segment's macro read, so a defensive segment beside a neutral one produces a blend that matches neither. Every screen that prints the figure also states the market state of each segment behind it.

**`/rebalance` and `/suggest` size the same name against different things, and both answers are correct.**

- The plan takes the gap to target and holds it to the segment budget, the per-name cap and the board lot.
- The suggestion takes the tightest of its own ceilings and scales it by the tightest of confidence, the trader's intent and the market state (never their product).

So a name the plan lists may be one the suggestion declines that day. The plan says so where it lists a buy. It does not run the debate, so it costs nothing in model calls.

A gap the plan cannot close in one lot is said out loud rather than left to look like convergence, but only while it is a gap you can act on. Below the resolution the sentence prints at, the name is at target for every practical purpose, and a note claiming it sits `0%` off would read as the plan arguing with itself.

One verdict the plan does not step around: a held name whose newest stored verdict is a `reduce` on evidence takes no increase, however far under target it sits, and the plan names it rather than leaving the row silently absent. An `over-target` trim is not that verdict. It is this plan's own drift rule written back to the store, so acting on it would let the plan veto itself. Nothing else about the plan changes: the segment's unfilled gap stays unfilled and is reported as cash.

With no names, `/rebalance` sizes your holdings plus the saved watchlist. Naming tickers sizes exactly those. Each order line states the amount in the book's base currency and the price in the market's own quote currency (what the venue takes), so a board-scaled market prints its points with no currency while a coin prints its own. A price takes the decimals its currency actually has: VND, JPY and KRW have no minor unit, so a dong price prints whole.

```bash
openalpha chat --message "/portfolio"
openalpha chat --message "/rebalance"
openalpha chat --message "/rebalance FPT MWG"
openalpha chat "Show my valued portfolio and its risk findings."
```

### Surfaces of the book

| Surface | Reach |
|---|---|
| Tools | `portfolio_view` `portfolio_history` `portfolio_review` `portfolio_rebalance` `portfolio_record` `portfolio_update` `portfolio_remove` `watchlist_update` `profile_view` `profile_update` `profile_segment` |
| Slash | `/record` `/update` `/delete` `/transactions` `/portfolio` `/portfolio nav` `/profile` `/watchlist` `/rebalance` `/reconcile` |
| Terminal chat | The same slash commands plus natural-language tool use |
| HTTP | `GET /v1/portfolio` `GET /v1/portfolio/nav` `GET /v1/profile` `POST /v1/profile` |

Terminal chat and channels share one slash-command registry, so a transaction syntax or profile field cannot drift between them.

A fill placed through `/trade` or `order_place` is written to the ledger the same way a manual `/record` is. The book stays one calculation over one set of rows, and a position opened at the exchange looks the same as one typed in by hand. A sell written by a triggered exit names which leg filled (`stopped out` / `target hit`); a sale you make yourself names none.

**`/record sync <venue>`** is the third way those rows are created, and it takes the same path. It differs only in how it selects: it asks the venue what it filled, then books what the book has no row for. Validation, calculation and confirmation are shared.

A limit order that filled only partly before you cancelled it is now synced for the part that filled.

- A fill is matched by the venue's own order id (`<venue>:<orderId>`, the key `/trade` books its own fills under too), and by the figures themselves against a row you typed by hand. A fill is left alone when it matches a hand-typed row that no fill has claimed yet, on venue, instrument, day, side and quantity. Each typed row absorbs at most one fill.
- Each fill's market is resolved against the markets that venue holds, and no others. When no detector can be reached, the venue's own listing answers instead, read at most once per run, and only when exactly one of the venue's markets could claim the ticker. A ticker no market lists, or one that two claim, is skipped rather than guessed.
- Fills are booked oldest first across instruments. A name the book could take only part of is not taken at all: if a sync fails or is cancelled part way, it takes back what it had booked of any name it had not finished, so it never leaves a half-booked position. Rows an earlier run left behind are yours to delete.

Allocation has no surface of its own: `portfolio_rebalance` and `/rebalance` report segment targets and per-name changes as one plain-language plan.

### Venues, and the one thing this book does not do

A venue is where the assets actually sit (OKX, Binance, VPS) and every row with an instrument names one. Some venues have an exchange client and can be ordered on. A venue you trade by hand has none and is only ever recorded against. Both hold positions the same way.

**Binance lists trades coin by coin.** `/record sync binance` reads the coins your book has recorded there plus every coin the account holds now, and says so at the end of the reply. A trade you opened and closed on a coin you never recorded will not be found, so record that one by hand. The per-order trade reads are paced, so a long book does not spend the exchange's request weight in a burst.

Coins you park in Binance Simple Earn leave the spot balance and show up as `LD<coin>`. `/reconcile` then shows the coin short and, say, `LDBTC` unclaimed, side by side. That is the same coins in two places, not a loss.

Every cash row names its custodian, and a buy is capped by the cash at the venue routing would send it to. `/portfolio` splits the cash line once more than one venue holds any, and a `transfer` row moves money between venues without touching net deposits.

**Assets cannot move between venues.** The only way left to express it is a sale and a purchase, which fabricates a realized gain and two fees that were never charged. A book whose assets have moved is wrong, and you correct it by editing rows.

---

## Orders

**Start on a demo account.** In 1.0.4 the order path has been checked statically, not yet against a live OKX or Binance account. Work through this page on an OKX demo or Binance testnet book, including the checks in step 9, before you use live keys.

`/trade` and the `order_place` tool place spot orders on **OKX** or **Binance**: market and limit, buy and sell, with an optional take-profit/stop-loss on a buy. Every order is capped before you are asked, approved by you before it goes out, and mirrored into the ledger when it fills.

### 1. Get a demo key

Demo trading is a mode inside your normal OKX account, and **its keys are separate from live ones**. A live key with the demo header fails auth, and so does a demo key without it.

1. Log in to OKX, then **Trade**, then **Demo Trading**.
2. While in demo mode: **User / Personal Center**, then **Demo Trading API**.
3. **Apply for Demo Trading V5 API**.

A key created anywhere else is a live key. If step 5 returns an auth error, suspect this before you suspect the signature.

#### Binance

Binance's practice account is **Demo Trading**, and its keys are separate from live ones too. Log in, open **Demo Trading**, and create the key on its **API Key Management** page. A live key sent to the demo host fails auth, and so does the reverse.

For a live key, tick **Enable Reading** and **Enable Spot & Margin Trading** only, never **Enable Withdrawals**, and restrict it to your server's IP. `openalpha doctor venues --online` reads the key's permissions and warns on each one that is wider than that.

### 2. Configure

```toml
[trading.orders]
maximum_stake_quote = 200      # cap the notional while testing
maximum_open_trades = 3

[trading.venues.okx]
simulated = true                 # sends x-simulated-trading: 1
fees = { buy = 0.0008, sell = 0.0008, fee_asset = "base" }   # fractions of notional, not percents
```

```bash
export OKX_API_KEY=... OKX_API_SECRET=... OKX_API_PASSPHRASE=...
```

For Binance:

```toml
[trading.venues.binance]
simulated = true                 # every call goes to demo-api.binance.com
```

```bash
export BINANCE_API_KEY=... BINANCE_API_SECRET=...
```

With keys for both exchanges, name the venue on every buy: `/trade spot binance:BTC buy 0.001 sl 100000`.

You can rename the variables in `credentials` under `[trading.venues.okx]`, and each also works with an `OPENALPHA_` prefix. `simulated` is not a dry run: OpenAlpha signs, submits and polls a real API, and OKX runs the order against its demo book. Nothing fabricates a fill locally.

### 3. Confirm it registered

`/trade` exists only when a registered venue has an exchange client. For OKX that means all three credentials resolve. Without them OKX is still a venue you record trades against; it just has nothing to place through. There is no `/help`. Type `/trade` with no arguments and read the reply:

- **the usage line** - registered, you are ready;
- **unknown command** - credentials did not resolve. The boot log says which: `trading.order_credentials_missing` names the exact variables it looked for.

The `order_place` and `order_exits` tools follow the same gate, so an install that never configures an exchange has no order surface at all.

**Approval.** `order_place` asks you on every call, offers no remembered decision, and refuses outright when the run's approval mode is `bypass`, unless `[trading.orders] allow_unattended` is set. A take-profit or stop-loss rides a buy only: `order_place` refuses one on a sell, as `/trade` does. Orders are sized and checked against a live price only; when the exchange reading is a stored close or a stale print, the order is held back with a plain note to try again. A buy that would take a holding, sector or segment past its cap is refused there too, and the agent tells you which; place it with `/trade`, which shows the breach before you confirm. A buy of an ETF into a segment whose ETF share cannot be measured (a holding there has no resolved kind) counts as a breach of any ETF ceiling the segment declares: the caps cannot be checked, so it is not waved through.

With a saved profile, a buy is refused while any holding in the book has no price (`order.book_unpriced`), on `/trade` and `order_place` alike. Without a price for every holding there is no total, so no position, segment or ETF cap can be measured, and an order that skipped them would clear them all. `/portfolio` names the holding; `/refresh` its market to load a price, then place the order again. A sell, and a buy with no saved profile, are not held back.

When an order is refused for size (a sale larger than what has settled, or than what a resting exit has frozen), the figure appears in your `/trade` reply but never in what an agent reads.

**Safety against double placing and crashes:**

- Each staged order has its own token, claimed before the exchange is reached. A token already used, placed or expired is refused, so a bare `/trade confirm` can never place the same order twice. An order that already carries an order id or a failure is never listed as waiting for `/trade confirm`.
- Before an order leaves, an in-flight marker is written. If the process dies while the exchange holds the order, the marker survives, `/trade reconcile` lists it, and the caps count it until it is settled. An order that cannot be recorded this way is not sent. Every later outcome replaces the marker.
- `/trade` books its fill under the venue's own order id, the same key `/record sync` uses, and dates the row by the session the fill traded in rather than the moment you confirmed. Whichever of the two writes second finds the row already there, inside the ledger's write lock, and books nothing, so the cash is debited once even when both run at the same moment. If `/record sync` booked the fill while `/trade` was still waiting on it, `/trade` adopts that row.
- A run cancelled after the exchange took an order still marks it for `/trade reconcile` and, for an order left resting, tries to cancel it.
- One cancelled between the fill and the ledger write leaves an unrecorded row with the reason `order.mirror_aborted`, still charged against the caps and listed by `/trade reconcile`.

`/trade reconcile` also asks each venue that rests exits what it holds under a client id this setup minted, and lists any with no live row. The exit check reads rows alone, so such an exit (a crash between the exchange taking it and the row landing, or anything older) is never checked or trailed. It only reports. `/trade cancel` cannot reach it, so cancel it in the exchange app if unwanted, and leave one that is protecting a position. A venue that could not be read is named rather than skipped. `POST /v1/trade/reconcile` returns the same two lists (`orphanExits` and `unreadExitVenues`).

A `/trade exit` seeds the exit's client id from the request, so a Telegram message redelivered after a crash finds the exit it already placed. The CLI and the app mint a fresh id per command. `POST /v1/trade/exits` takes an `Idempotency-Key` header for a client that retries: the same key finds the exit the first call placed, and a call without one is its own request.

A venue that answers 418 or 429 surfaces as `order.rate_limited` and is not retried. Replaying inside the retry window only deepens the ban.

`order_exits` is the read beside it: whether each position has a take-profit/stop-loss standing at its exchange, as a share of the position, never a quantity (the line `portfolio_view` already draws). Without it a model can see a holding but not whether a stop stands under it, and would advise a trim as though the downside were open.

### 4. Fund the book first

The cash cap calculates available cash from the ledger rows, so a first buy on an empty book is refused, correctly, and the refusal names the remedy:

```text
/record deposit okx 1000 USDT 2026-09-07
```

This is bookkeeping, not a transfer. It tells the ledger what you hold so the book can fund what you place. Skip it and every buy is refused for cash.

### 5. Place one

```text
/trade spot BTC buy 0.001 sl 100000
/trade spot BTC buy 0.001 limit 109000 sl 100000
/trade spot okx:BTC buy 0.001 limit 109000 tp 120000 sl 100000
```

- The ticker is the **base asset alone**: `BTC`, never `BTC/USDT`. The pair is built for you.
- The quantity is always in **base units**: `0.001` means 0.001 BTC, not 0.001 USDT's worth.
- `tp`/`sl` ride a buy only, since a sell is itself the exit.
- A buy needs `sl` by default. Set `require_stop_loss = false` under `[trading.orders]` to allow one without.

The `venue:` prefix is optional and only needed when more than one venue could answer. Routing picks the single venue that can fill the order, narrows a sell to the venues actually holding a sellable parcel, and refuses anything else with the candidates named. It never picks one for you, because a real-money order must not depend on a default nobody re-reads. A sell is refused above what is settled and not guarded at the routed venue:

- above the settled parcel: `order.sell_unsettled`;
- above the sellable share, where a resting exit has frozen coins at the exchange: `order.sell_guarded`.

Staging places nothing. It prices the order, rounds it to the exchange's lot and tick, runs the caps, and prints an approval prompt carrying a token. The prompt includes an **estimated fee** from the routed venue's `fees` rate, so what the order will cost is on the prompt you approve, not only on the receipt. Quote the token back to place:

```text
/trade confirm <token>
```

The token is good for **five minutes**, is single-use, and is checked against a stored intent, so an invented one places nothing.

Quote, drift and caps are re-run at confirm against a fresh quote, so a market that moved while you were reading is refused rather than filled at a price nobody checked. A limit order is held to the live quote and a market order to the quote it was staged at, both within `maximum_price_drift`.

The cash cap counts the buy fee the routed venue's `fees` rate bills (a fee taken in the coin you buy adds nothing). On a market order it also adds the same drift again as room for the fill, so a buy sized to all the cash is refused rather than filled at the exchange and then unbookable. A sell is checked again at confirm against the quantity still free.

To remove a resting take-profit/stop-loss:

```text
/trade cancel BTC
/trade cancel okx:BTC
```

Name the venue when two of them hold a resting exit on the same instrument. That is refused rather than guessed, since cancelling either silently would leave the other resting behind a message saying it is gone. Two exits at one venue are not ambiguous, and the newest is taken.

### 6. Guard a position you already hold

`/trade spot ... tp ... sl ...` attaches an exit to the buy that opens a position. To set one on a position that is already open, or to move the one that is there, name it on its own:

```text
/trade exit BTC sl 100000
/trade exit BTC tp 120000 sl 100000
/trade exit okx:BTC tp 125000 sl 105000
/trade exit BTC qty 0.5 sl 100000
```

The size defaults to the position the **book** says you hold at that venue, rounded to the exchange lot. `qty` covers part of it instead. Anything above what the venue holds is refused rather than trimmed: on OKX a resting spot trigger freezes nothing, so one sized past the balance is accepted now and quietly under-fills when it fires. Binance locks the coins behind a resting exit, so an oversized one is refused on the spot.

A partial exit says what it leaves behind, on the receipt and again in `/trade`, because nothing else will: half a position with a stop under it is not a guarded position.

There is one exit per instrument per venue, whatever size it covers. A second would have no name you could amend it by, and every guard here reads the single row. Scaling out across two different triggers is not something this command expresses.

This command can never leave you with less protection than you had. There are three outcomes and no fourth:

- **nothing resting** - the exit is placed;
- **one resting with the same two sides** - it is moved in place, size included, with no moment where the position is unguarded;
- **anything else** - refused, naming `/trade cancel`.

The third case is a stop-only exit you now want paired with a take-profit, or two exits resting on one instrument at one venue. Both are a deliberate two-step: cancel, then set the pair. The command will not take down protection on your behalf, and no flag makes it.

Because it cannot spend cash, cannot open a position and cannot reduce protection, it places directly, with no confirmation token. A pair that would fire the moment it is placed is refused before anything reaches the exchange.

This is also the answer to the divergence warning: when the reconcile tick logs `order.exit_diverged`, a resting exit covers more than the book says you hold. Running `/trade exit` re-sizes it to the position.

**A stop you set in the OKX app counts.** `/portfolio` asks OKX for live sell orders with a stop leg (TP/SL, OCO and trailing stops), so a position you protected in the app does not read "no stop placed". When the plan raises a stop on such a position, the notice tells you to move it in the app rather than suggesting `/trade exit`, which would place a second one beside it. If OKX can't be read, the line is left out rather than guessed. A plain trigger order is not counted: without the price beside it, a sell trigger can't be told from a take-profit.

**On Binance an exit can't be moved.** Binance has no way to change a resting stop, so a second `/trade exit` on a name that already rests one there is refused with `order.exit_not_amendable`, and the reply says what to do:

```text
/trade cancel binance:BTC
/trade exit binance:BTC tp 125000 sl 105000
```

Nothing protects the position between those two lines. Run them back to back.

**A plan that trails rests only its stop.** A plan that sells part of the position at its target and lets the rest run is scored that way, so only the stop should rest on the exchange: a take-profit set to the plan's target would sell the whole position there. When the target alert arrives, sell that part yourself and keep a stop on the rest:

- **OKX:** the resting exit holds the coins behind it, so a sale comes after it shrinks. First `/trade exit <ticker> qty <quantity> sl <price>` amends it in place to the part you keep, then sell the take-profit part.
- **Binance:** an exit cannot be amended and the coins behind it are locked, so run `/trade cancel <ticker>`, sell the part, then `/trade exit <ticker> sl <price>` on the rest. Nothing protects the position between the steps, so run them back to back.
- **A hand-traded venue (VN shares, VN gold):** sell the part in the app of the place you trade with.

### What each venue can do

A venue declares what its API can do, and a venue that cannot do something fails at boot, not at first use.

- A venue that accepts no orders (one you trade by hand) cannot rest an exit. Setting or moving an exit on one is refused with `order.exit_unsupported`, and the position stays guarded by alerts alone. An entry there still books, and its receipt leads with the unprotected position.
- **OKX** can move a resting exit in place. **Binance** rests exits but cannot move them (above).
- Where a venue can list its fills, `/record` can take a trade's figures from it and `/record sync` works. Binance lists them per coin, so it reads only the coins the book and the account name, and the sync says so.
- Where a venue can report balances, `/reconcile` holds the book against the custodian.

### 7. See what is outstanding

A bare `/trade` answers one question, what is live right now, in sections. Any section is absent when empty, and one line heads them all when buying is switched off:

- **Buying is off since ...** - present only after `/trade halt`, and first because it changes what every other line means.
- **Waiting for your confirmation** - every staged order still inside its five-minute window, each with the token that places it.
- **Resting exits** - what stands at a venue, with its triggers.
- **Nothing is guarding these** - positions at a venue you can place at, with less exit under them than the book says you hold, each naming the command that fixes it.
- **Placed at the exchange, missing from your book** - the reconcile list, with its remedy.

It reaches no venue. A status that needs every exchange up goes blank exactly when you most need to know what is standing out there.

`/trade confirm` with no token places the one order waiting. With two or more it refuses and lists both, the same way routing refuses a venue it would have to pick between.

#### Two venues in one market

Routing narrows to exactly one venue or refuses. If a second venue both serves the market and takes orders, every buy without a venue name becomes ambiguous:

```text
/trade spot BTC buy 1 sl 100000       -> order.venue_ambiguous, naming both
/trade spot okx:BTC buy 1 sl 100000   -> routed
```

A sell needs no qualifier: it narrows to the venues that actually hold the position, and only a name held at both is ambiguous.

A venue you trade by hand takes no orders, so routing never sees it and `/trade` is unaffected. Its catalog is still read, exactly as for a venue with credentials.

### 8. One write goes out at a time

Every write to an exchange (a confirm, an exit, a cancel) runs one at a time. That closes two races of the same shape, *read the state, decide, then act*:

- The caps are whole-book: spendable cash and the open-trade count. Two confirms running together would each measure a book the other has not written to, and both clear a ceiling only one may.
- Two `/trade exit` calls running together would each read *nothing resting* and place, leaving the second exit the conflict guard exists to prevent.

The caps are read **again** inside that window. An order the book no longer allows is refused with `order.book_moved` rather than trimmed, because the size and the levels are what you said yes to. A holding that lost its price in the meantime refuses the buy with `order.book_unpriced`.

### 9. Verify, in this order

Each step is a distinct failure this design exists to prevent. The early ones stop you diagnosing a signature bug with money moving.

- [ ] **Missing credential** - unset one variable: the log names it, `/trade` is unknown, the daemon still starts.
- [ ] **Signing** - reaching a prompt at all proves the timestamp, digest, signed path and body are right. They fail identically, so isolate this first.
- [ ] **Confirm within one minute**, same chat, same user - it places, rather than silently doing nothing.
- [ ] **Base-unit sizing** - a market buy of `0.001 BTC` fills about 0.001 BTC. Read the receipt, not the request.
- [ ] **Rest and cancel** - a limit far from the market rests, then is cancelled at the poll cap (about 20s).
- [ ] **Partial fill** - one near the market that half-fills keeps polling rather than booking the half.
- [ ] **Exit round trip** - the receipt shows both legs, one live OCO at OKX. Move the demo price through the take-profit and the next reconcile tick (about 60s) books the exit. **Run it twice: one ledger row, not two.**
- [ ] **Exit on a held position** - with a position open and no exit resting, `/trade exit <ticker> sl <price>` places one OCO leg at OKX and the receipt names the covered quantity.
- [ ] **Moving an exit** - run it again with a different `sl`: OKX reports the same algo order id with the new trigger, not a second algo order. This path is built from OKX's published parameter list, so check it here before trusting it.
- [ ] **A refused amendment keeps the old exit** - send an `sl` the venue rejects (above the last price): the amendment fails and the original exit is still live at OKX.
- [ ] **Leg-shape refusal** - with a stop-only exit resting, `/trade exit <ticker> tp <price> sl <price>` refuses and names the cancel, leaving the stop untouched.
- [ ] **Re-size after a manual sale** - `/record sell` part of the position, then `/trade exit`: the resting exit's size drops to what the book now holds.
- [ ] **Partial coverage** - `/trade exit <ticker> qty <half> sl <price>`: the receipt names what it leaves unguarded, and bare `/trade` lists the position under *Nothing is guarding these*.
- [ ] **Oversized coverage** - a `qty` above the position refuses with nothing placed.
- [ ] **Bare confirm** - with exactly one order staged, `/trade confirm` places it. Stage a second and it refuses with both tokens rather than picking.
- [ ] **Status** - bare `/trade` lists what is staged, resting, unguarded and missing from the book, and answers while the exchange is unreachable.
- [ ] **Reconcile settles a recovered fill** - force an unreconciled intent, book the fill with `/record sync okx`, then `/trade reconcile`: it reports the row settled for you and the caps free up with no token typed.
- [ ] **Sync names its skips** - with a fill the book cannot take, `/record sync okx` names the symbol and the reason rather than printing a count.
- [ ] **Inverted exit** - `sl` above `tp` refuses with no algo order placed.
- [ ] **Fee-netted size** - a buy whose fee came out in BTC places an exit sized on the booked quantity, never more than the balance OKX shows.
- [ ] **Fee estimate** - the prompt's estimated fee is within a quarter of what the receipt charges. Further off, the receipt says so, and the venue's tier in its `fees` is what to correct.
- [ ] **Routing** - with one venue serving the market, no venue argument is needed. Register a second and a bare `/trade spot BTC buy` is refused with both named.
- [ ] **No auto-cancel** - delete the entry row: the next tick warns about the divergence and the OCO is still live.
- [ ] **A plan is not protection** - with a suggestion's stop on a holding and no exit resting, `/portfolio` reads `... from its stop · no stop order placed`. Place one with `/trade exit` and the qualifier goes.
- [ ] **A blip does not bury an exit** - a not-found that the venue answers again on a later tick restarts the window rather than counting toward it. Only five unbroken minutes of not-found mark the row gone.
- [ ] **Unattended refusal** - under `--mode bypass` an order is refused until `[trading.orders] allow_unattended` is set.
- [ ] **No remember button** - the `order_place` prompt offers deny and allow-once only.
- [ ] **Binance signing** - with `simulated = true` and demo keys, `/trade spot binance:BTC buy 0.001 sl 100000` reaches a prompt. An auth error here is the key, not the code.
- [ ] **Binance clock** - set the local clock 2 s ahead: `/trade` refuses with the clock message before anything is sent.
- [ ] **Binance receipt** - the fill shows average price, the fee in BTC, and a fill time from Binance's clock.
- [ ] **Binance dust** - try to sell less than 5 USDT worth: refused as below the minimum before anything is sent.
- [ ] **Binance exit** - `/trade exit binance:BTC tp <p> sl <p>` rests one OCO. Running it again refuses and names `/trade cancel`. `/trade cancel binance:BTC` removes both legs. A fresh `/trade exit` places again.
- [ ] **Binance exit fires** - rest an exit whose take-profit sits just above the last price. When it triggers, the next reconcile tick (about 60s) books the sale. **One ledger row, not two.**
- [ ] **Binance sync** - `/record sync binance` books the demo fills and ends with the line saying it checked coin by coin, in both languages.
- [ ] **Key audit** - `openalpha doctor venues --online` on a live key warns while Withdrawals is on or no IP is pinned.
- [ ] **Halt** - `/trade halt`, then confirm a staged buy: refused. A sell still places. Restart the daemon and `/trade` still shows buying off.

Two of these probe error codes taken from a third-party client rather than OKX's own reference: the cancel-race codes in **Rest and cancel**, and the not-found code in **No auto-cancel**, where a lookup misread as "gone" would close an exit that is still live. Both fail loudly, so a wrong guess shows up as an error, never as a wrong book.

### 10. Switch buying off

`/trade halt` stops every new buy until `/trade resume`.

- **Blocked:** `/trade spot ... buy`, a `/trade confirm` of a buy staged before the halt, and an `order_place` buy. The confirm is refused before any venue is called, so a token minted a minute before the halt cannot slip through.
- **Still works:** sells, `/trade exit`, `/trade cancel` and `/trade reconcile`. A halt exists to stop adding risk, and each of these takes it off.
- **Never touched:** a resting exit. The halt cancels nothing and never calls an exchange's cancel-all, so every stop stays where it stands.
- **Durable:** the switch is stored in the database, so it survives a restart and a DB export/reset.

The manual backstop sits at the exchange itself. On Binance, switch off **Enable Spot & Margin Trading** on the key in API Management. On OKX, remove the key's Trade permission. That stops sells too, which is exactly why the halt in `/trade` does not.

Internals: [dev/trading.md](dev/trading.md).
