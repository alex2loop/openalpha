# Data sources internals

For contributors adding or changing a provider. Which providers exist, which keys they need and the limits you can hit: [Data sources](../data-sources.md).

Code: `src/trading/sources/` (adapters, routes, registry, transport), contracts in `src/trading/kernel/source/`,
composition in `src/trading/wiring/composition/`. Boundary rules: [AGENTS.md](../../../AGENTS.md).

## What a source is

A source feeds the deterministic evidence pipeline: rows are parsed into kernel types, stamped with provenance, scored into
factors and cited in the suggestion. That is a higher bar than an agent tool, which only informs reasoning a human reads.

- Data good enough to be evidence ships as a first-party adapter with a parser, a schema, a rate limit and a failover route.
- Data the agent may read but never conclude from is an MCP tool the operator connects.

A provider is one id serving one or more kinds. Each `(kind, id)` pair is its own `Source`, registered under `kind:id`.

## The contract

### `SourceKind` and `SourceKindMap`

`SourceKindMap` (`kernel/source/source-result.ts`) maps each kind to the value it returns. It is the closed list of what the
system can ask for.

| Kind | Value | Note |
|---|---|---|
| `instruments` | `InstrumentRecord[]` | the tradable universe |
| `quote` | `Quote` | live or last settled price, plus the session window where the provider has one |
| `bars` | `Candle[]` | oldest session first; consumers read the tail as most recent |
| `sessionQuotes` | `SessionQuote[]` | the whole board in one read |
| `fundamentals` | `FundamentalSnapshot[]` | |
| `accounts` | `FiledAccounts` | every full-year and quarterly report the provider serves for one name |
| `events` | `MarketEvent[]` | |
| `news` | `NewsItem[]` | |
| `macro` | `MacroSnapshot` | merged across providers |
| `policyRates` | `PolicyRateSnapshot` | the central bank's policy rates and interbank averages |
| `statReports` | `StatReport[]` | the statistics office's monthly report |
| `commodityPrices` | `CommodityHistory` | |
| `valuationRatios` | `ValuationRatios` | |
| `flows` | `FlowSnapshot[]` | |
| `proprietaryFlows` | `ProprietaryFlow[]` | the proprietary desk alone, from a provider that publishes it sooner than the `flows` provider |
| `tradeSides` | `DailyTradeSides` | |
| `foreignRoom` | `ForeignRoom[]` | |
| `supervision` | `SupervisionSnapshot` | only names under exchange supervision, over the boards the read covered; a name absent from a covered board is unsupervised |
| `indexMembership` | `IndexMembership[]` | |
| `recommendations` | `AnalystRecommendation[]` | |
| `sentiment` | `SentimentSnapshot` | |
| `funding` | `FundingSnapshot` | |
| `marketCap` | `MarketCapRecord[]` | |
| `fx` | `FxQuote` | |
| `fxHistory` | `FxRatePoint[]` | oldest first; gaps on days neither currency's market traded |
| `goldBoard` | `GoldBoard` | merged across vendors |
| `goldBoardHistory` | `GoldBoardPoint[]` | oldest first; only the sessions the vendor published |
| `positioning` | `PositioningSnapshot` | CFTC, weekly and lagged |
| `etfFlows` | `EtfFlowSnapshot` | defined but unrouted: no provider verified against a live response |

### `SourceContext`

The request. Every field is optional because one type serves every kind.

| Field | Meaning |
|---|---|
| `market` | the request's `MarketRef`; absent for kinds with no market (FX, macro) |
| `instrument` | market-qualified instrument |
| `instrumentKind` | for providers that serve each instrument class from a different endpoint or unit; absent means cash equity |
| `ticker` | a market-less symbol (FX pair, commodity); never a substitute for `instrument` |
| `tickers` | a batch of symbols, for a provider that answers many in one request |
| `region` | scope for cross-market kinds |
| `feedScope` | picks one feed group when no market or region is named (the macro tape's `economy` feed) |
| `searchSubject` / `searchTopic` | for a text provider that does not index by symbol: the caller's own spellings of the subject and its field, so a name that is also an ordinary word does not return every other use of it |
| `fromDay` / `toDay` | `YYYY-MM-DD` trading days |
| `limit` | row cap |
| `live` | the price as it stands now, not the last settled close |

### `SourceResult<T>`

```ts
{ kind: 'available',   value, provenance: SourceProvenance[], caveats: Caveat[] }
{ kind: 'unavailable', reason, attemptedSourceIds, caveats }
```

Both carry caveats, so a success with problems can say so. `reason` is `unconfigured` (nothing routed), `unsupported` (no
source's `covers` accepted the request), `stale`, `empty` (every provider answered with nothing - final) or `failed` (at least one
routed provider could not answer).

`SourceProvenance` is per stamp, not per result: `{ sourceId, fetchedAt, freshness, observedAt? }`. Freshness is `live` or
`cached` and sits on each row, because a value assembled from four providers has no single answer to "is this fresh?".
`provenanceOf` returns nothing for an unavailable result: the ids it tried are for diagnosis, never citation.

Nothing invents a number to fill a gap, and nothing throws because a free provider lacks coverage. The one exception is
cancellation: an aborted signal propagates as `AbortError` through every layer. A source that throws anyway is caught by the
registry, logged as `trading.source_threw`, and answers `unavailable('failed')` with `source.payload-rejected`.

### A reading has to be recent, not just from today

A provider that stops updating does not report a failure. It answers with a bar from hours ago that carries today's date:
well-formed, indistinguishable from a live price, and invisible to failover. `isLiveObservation` (`markets/calendar.ts`) asks two
questions and a reading must pass both:

- **Which session it belongs to.** Newer than the last settled close, judged by session, never by instant: a closing auction
  prints minutes after the bell, and an instant test alone would read today's settled close as live for the rest of the day.
- **How old it is.** No further behind the clock than `TAPE_SETTLE_LAG_MS` (30 min) plus the longest an open tape can go
  without printing, `QUIET_TAPE_MS` (60 min: the CME metals halt) - 90 minutes in all. A genuine closing print is already
  `TAPE_SETTLE_LAG_MS` old the moment its session settles, so the budget is built from the two. Lunch breaks are exempt: the
  last print before the break stands for the whole gap.

`toLiveReading` (`markets/live-reading.ts`), the path for `/overview` and `/market`, applies the same age test
(`isRecentObservation`) to the settled day its caller already holds. The settle rule underneath is in
[Trading](../trading.md#a-session-settles-when-its-data-does-not-when-its-bell-rings).

A reading that fails either test is not an error. The market answers with the settled close the store holds, tagged
`market-data.quote-not-live`, so the screen says which price it is; it refuses only for a name the store cannot price at all.
Crypto does this through `liveOrStoredQuote` (`markets/stored-quote.ts`), VN equities through the same file's `storedQuote`.

## Anatomy of an adapter

`createSource` (`sources/define.ts`) turns a spec into a `Source<K>`. Three shapes:

**Request spec** - declarative, one round trip. The adapter names the path and parses the payload; it never touches a client.

```ts
createSource({
  id: YAHOO_ID,
  kind: 'quote',
  format: 'json',
  http: options.http,
  covers: (context) => context.instrument !== undefined,
  request: (context) => {
    const listing = yahooListing(context)

    return listing
      ? { ...QUOTE_ATTEMPT_LIMITS, ...chartRequest(listing.symbol, { range: QUOTE_RANGE }) }
      : null
  },
  parse: (raw, context) => parsedSource(toQuote(firstResult(raw), context), proxyCaveats(context)),
  observedAt: (value) => value.observedAt,
})
```

**Loaded spec** - `load(context, signal)` for a read that is more than one request and a parse: several round trips in sequence
(a symbol resolution then a read, as in the shared `adapters/crypto-board.ts` builder that `coinmarketcap`, `coinpaprika`,
`coinlore` and `coingecko` use for their ranked board), a cursor walk (`vietcap` trade sides), or a result the declarative shape
cannot express. It returns the same `SourceFetchOutcome`, so failover and provenance behave identically.

**Paged** - `paged: { pageSize, pageParam?, extractRows }` on a request spec makes the transport fetch follow-up pages while a
page returns exactly `pageSize` rows, up to 20 pages or the page set's time budget, then hand all rows to `parse` once. No
adapter writes its own page loop. If a limit stops it while the last page is still full, the result carries `source.truncated`
instead of being silently cut off.

Rules for every adapter:

- **`covers` answers only about the shape of the request, never routing.** A source may *read* `context.market` to stamp what
  it parsed (`resolveRowTarget`), never *test* it to decide whether to serve, and never builds its own `MarketRef` or `Region`.
  `SOURCE_ROUTES` owns that.
- **`request` returning `null` means "not this request"** and resolves to `unavailable('unsupported')`.
- **Throwing from `parse` is the only way to reject a payload.** It maps to `source.payload-rejected`, never a transport failure:
  schema drift in one kind must not put every other kind of that provider on cooldown. A body that is not JSON at all (a
  bot-check or HTML page behind a 200) is different: it counts as a failed round trip and feeds the breaker. An adapter that
  folds after its transport call is outside that mapping and uses `mapOutcome` to get it.
- **Adapters do no I/O handling.** Timeouts, retries, the response cap, pacing, the breaker and request logging belong to
  `sources/transport/http.ts`.
- **The adapter owns its host's symbol vocabulary.** Yahoo's metals table is total because Yahoo answers 200 for an unrelated
  listing rather than 404 on an unmapped ticker.
- **A payload that states one quantity twice states it on two bases.** vndirect publishes both `EPS_TR` and
  `PRICE_TO_EARNINGS`. The first divides the trailing year's profit by that year's share count; the second uses the registry
  share count every other ratio in the payload carries, which takes effect on its own date after an issue or stock dividend.
  Taken as filed, `EPS_TR` priced a new share against the earnings of an old one: MBB read a P/E of 5.4 against the 6.2 the same
  payload published, and 66 of 652 names looked up to a fifth cheaper. The adapter reads the ratio and rebuilds the per-share
  line from it, so every field on a snapshot counts the same shares.

Shared parsing helpers live in `sources/rows/normalization.ts` (finite/positive guards, epoch-seconds to day in a named
timezone, candle construction, text sanitizing, tracking-parameter stripping) and `sources/rows/gold-board.ts`.

## Registration: facts are code-owned

`SourceFacts` is assembled once in `wiring/composition/source-registry.ts` from constants each adapter module exports:

| Fact | Owner | Why code-owned |
|---|---|---|
| `endpoints` | `SOURCE_ENDPOINTS` in `composition/source-facts.ts`, from each adapter's `*_DEFAULT_ENDPOINT` | no config can redirect a request at another host |
| `rateLimits` | `SOURCE_RATE_LIMITS` | the provider's published ceiling, or a rate a universe sweep sustains |
| `feeds` | `RSS_FEEDS` in `adapters/rss.ts` | a feed outside the allowlist is never fetched |
| `credentials` | resolved from the environment at composition | the raw secret never enters a config object |
| `plainUserAgentSources` | `PLAIN_USER_AGENT_SOURCES` in `composition/source-facts.ts` | which providers refuse a browser user agent - measured, not guessed |

Every request goes out with `BROWSER_HEADERS` from `core/http-client.ts` (also the default in `buildInit`, so venues, tools and
channels inherit it): a common browser user agent plus its language header, because a client sending neither is what
bot-detection fingerprints. The product name is never volunteered to a provider.

`PLAIN_USER_AGENT_SOURCES` is the opt-out list: `fred` and its keyless sibling `fred-csv`. FRED's edge resets the connection on a
browser string, which arrives as no HTTP status at all, so failover cannot read it as a refusal. Adding an id takes the same
two-way measurement: probed across every provider host (2026-09-21), the browser string is equal or faster everywhere else, and
`home.treasury.gov` tarpits the plain one at 18.0 s against 1.7 s - a guaranteed timeout under the attempt deadline.

An endpoint may be a list (`giavang` has a fallback origin). That is transport failover across the same backend, distinct from
route failover across providers. Each host gets its own attempt deadline, so a primary that hangs still leaves the fallback
its turn. `buildEndpointMaps` keeps the origin (the trusted-host list) and the endpoint's path prefix separately, so
CoinGecko's `/api/v3` is not lost.

Credentials: `SOURCE_CREDENTIALS` declares, per source, the default variable *name* (`COINGECKO_API_KEY`, `FRED_API_KEY`) and the catalog line saying what setting it adds (`trading.source.credential.<id>`, which `doctor` prints); `SOURCE_CREDENTIAL_ENV` is derived from it.
`[trading.sources]` may rename a variable, never name a value or a host. A rename aimed at a source that takes no credential is
a boot-time `OperatorConfigError` (`errors.configSourceNoCredential`). `resolveCredential` (`core/security/credentials.ts`) reads
the variable, then the same name with the product prefix (`OPENALPHA_FRED_API_KEY`). A request that declares a credential
placement (`header` with an optional prefix, or `query`) with no secret resolved is an `OperatorConfigError`.

A source that needs a key and has none is not registered, so its kind falls through to the next provider. Boot logs one
`trading.source.skipped` warning naming each skipped source and the variable it wanted. A keyless install is a supported reduced
mode. `unavailableSources` answers the same question as plain data, so `doctor` shares the check without booting (plugin
sources are outside it: their credential facts arrive with the module, which only boot loads).

Registration is phased: `createSourceRegistry` opens a phase, every built-in and plugin source registers, then `close()`. A
source whose `(kind, id)` has no position in the route table is rejected with `source <kind>:<id> has no failover position`: a
provider that cannot be reached is a composition bug, not a silent no-op.

## Routing

`SOURCE_ROUTES` (`sources/routes.ts`) is a table of `kind -> scope -> ordered source ids`. The table in reading order per market is
on the [user page](../data-sources.md#routing). Scope resolves in this order, first hit wins:

1. `context.market` (`equity-vn`, `crypto`, `gold`, `gold-vn`)
2. `context.region` (`us`, `vn`) - for the cross-market kinds
3. `'*'` (`ANY_SCOPE`) - where the kind has no owning scope at all (`fx`, the macro news tape)

`resolveRouteOrder` puts first-party ids ahead of plugin ids, so a plugin is never tried first. `withVenueQuoteLead` moves the
`crypto` default venue to the front of the crypto `quote` route when that venue is also a provider. `news` is per market plus `*`
for the macro tape; where a market has two providers (VN equities, crypto) they split requests rather than fail over: a name's
own headlines come from the first, a market-wide read from `rss`.

### Route order and adapter notes

Order is a judgment, not an accident.

**VN quotes and index levels.** `vndirect` leads because its session row is written while the market trades. It declines a level
outright, so an index or futures contract falls to `vietcap-chart`, whose one-minute series keeps updating through the session.
`entrade` stands behind because its intraday series cuts off the newest bars for some request windows and answers hours behind
without failing. Measured at 15:03 ICT: a 14-day window returned VNINDEX's 10:45 bar while 13- and 15-day windows both returned
the 14:45 close, and three identical 14-day calls returned three different tails. Neither that miss nor a stale close is visible to
failover, which is why the quote capability ages every reading it is handed (see
[A reading has to be recent](#a-reading-has-to-be-recent-not-just-from-today)).

**`vietcap-board` and `vietcap-chart` register under their own ids**, not `vietcap`: breaker, failure counter and pacer bucket are
keyed on the id alone. `vietcap-board` reads the whole board once and answers `sessionQuotes` and `foreignRoom` from one payload
(`vndirect` leads because its rows are the ones the settled evidence is built from, so a live count and a stored one measure one
population). Sharing `vietcap` would black out `indexMembership`, which has no second provider, for five minutes after three bad
board responses, and put a 4 MiB board read in the same token bucket as the per-name `tradeSides` sweep. `vietcap-chart` charts
every HOSE index, so a board sweep's failures must not black out the series the ETF factors score against; it serves `bars` and
`quote` under one id because they share host and path, so a fourth id would buy no isolation.

**VN `bars` order.** `vndirect` publishes no index rows (it declines them in `covers`, so an index costs it no request) and
`entrade` already charts some at the depths this tree reads, so `vietcap-chart` is third. Which indices `entrade` carries varies;
it answers `invalid symbol` for the rest and the route falls through. `vietcap-chart`'s `to` bound includes a bar stamped at
exactly that second and rounds up otherwise, and its daily series carries today's still-forming bar, so the adapter drops
anything past the settled day instead of trusting the bound.

`vps` is last. With three providers six indices still had one source: the ETF benchmarks VNDIAMOND, VNFINLEAD, VNFINSELECT,
VNMIDCAP, VNSHINE and VNX50 are declined by `vndirect` and answered `invalid symbol` by `entrade`, so one `vietcap-chart` refusal
took all six out. VPS Securities' feed carries them 707 sessions deep against vietcap's 673, every close identical over 125
sessions measured. Provider facts the adapter owns: the feed spells VNMIDCAP `VNMID`, and its `to` bound rounds **up** to the
day, so the settled day is applied to the parsed candles rather than trusted to the query. Its turnover is matched orders only,
17% under vietcap's (which adds the put-through leg after the session), so it may only back a provider whose volume no factor
reads. The ETF factor reads closes and `isRestated` weighs the close, so nothing downstream sees the difference.

**`sbv`** reads the State Bank's policy rates and interbank averages off its rate page. A page whose wording changes fails the
parse and writes nothing; no value is guessed. The page shows today only, so history is what `refreshPolicyRates` (the VN `macro`
kind, run beside `refreshFxSeries`) stores each pass: policy rates stamped with the refresh session, interbank rates with the day
the page states.

**`nso`** reads the statistics office's monthly report through its WordPress API. Every report carries one tag and is posted early
in the month after the one it covers (listing pages skip reports; the tag does not). The request is `/wp-json/wp/v2/posts` with
tag `727`, one per month: a covered month is fetched from the next month's posts, never found by slug (slugs carry typos), and
the series is valid from September 2024. The host is intermittently unreachable from abroad, so the extraction loop retries on
its next tick.

**`trading.macro-extract`** is a daemon job (`wiring/tasks.ts`); markets get no model. Each tick it reads up to its batch of unread
`nso` reports, plus Vietnam PMI and public-investment headlines from `news_items`, through `[[model_tiers.extraction]]` (falling
back to `[[models]]`). `macro-extract/verify.ts` keeps a figure only if its quote is verbatim in the source, its number appears
in the quote, a change series' sign matches the words before it (`giảm` is negative; levels such as PMI are never sign-checked),
its month is the document's, and it lies in the series' range. A kept figure and its quote land in `series_points` and
`series_provenance` in one transaction with the `macro_documents` row. A press figure never replaces the statistics office's.

**`vietcap-statements`, `vndirect` ratios, commodities.** `vietcap-statements` serves a name's full-year and quarterly accounts.
`vndirect` serves `valuationRatios` (daily P/E and P/B plus five-year averages). `commodityPrices` has two providers that never
rank one commodity against the other: `vndirect`'s exchange feed is daily and `fred-csv` (FRED's keyless chart download) carries
the monthly series no free daily feed has.

- A `vietcap-statements` call returns eight years, so `annual_accounts` is neither durable nor archived: a refetch rebuilds it.
  A quarter is kept with a balance sheet and income statement alone, because the provider files its cash flow later; a year still needs all three statements. A partial quarter leaves its cash lines absent, and every trailing sum, free cash flow and cash conversion that needs them goes absent with it, never zero. The `cash_flow_source_id` column is set when the cash lines came from `cafef-statements`.
  The 34 quarters go to `quarterly_accounts` and are read as a trailing year past the newest audited one, and the newest five also as quarter rows against the same quarter a year earlier (`AccountsHistory.quarters`, built in `markets/equity-vn/accounts/quarters.ts`).
- A bank is recognised from its balance sheet, never its sector. The provider zero-fills the codes of other families, so a
  positive customer-loans line (`bsb104`) marks a bank and `isBankLines` (`kernel/market/annual-accounts.ts`) tests for it. The
  optional `NOTE` section costs only the bank lines when absent. Outflow lines are stored sign-flipped (`OUTFLOW_LINES`).
- `cashFlowToDate` is `cafef-statements`' year-to-date cash-flow table for one quarter. The accounts refresh asks for it only when a non-bank name's newest quarter is the watched one and lacks cash flow, and every earlier quarter of that year is on file with it. The quarter's own figures are the year-to-date figure less those stored quarters (never one CafeF column less another: its earlier columns are the pre-review filing), and they are kept only when the year-to-date pre-tax profit matches the stored quarters' sum within `CASH_FLOW_MATCH_TOLERANCE`. CafeF leaves a zero blank, so a blank cell in a listed row reads as zero, but a blank operating cash flow or pre-tax profit refuses the page, since the fill is built and checked on those two; labels are matched in composed Unicode form, and a column with every cell blank is a quarter not published yet. Any quarter `vietcap-statements` still serves without cash flow keeps what an earlier fill stored while its pre-tax profit is unchanged, whether or not it is still the watched one, so CafeF is asked only when no fill is stored, and a refused answer or a failed check leaves the quarter partial. A quarter with no cash flow, or with CafeF's, is asked again once each settled session while it is the watched one (an interval from the run's start would miss by the minutes the previous fetch took); suggest never calls CafeF. Two caveats say what is missing: `factor.accounts-quarter-partial` and `factor.accounts-quarter-late`. Every accounts caveat reaches the report on the quality line when the name has a current score; these two also come through the accounts capability itself, so a name with no current score still shows them.
- Two provider lines are deliberately unread: its operating profit, because core operating profit is gross profit less selling
  and admin (`markets/equity-vn/accounts/history.ts`), and its EPS, which is not restated for stock dividends, so shares are
  common capital over `VN_SHARE_PAR_VND`.
- A line the provider stops filling raises `factor.accounts-lines-dropped` and reads as absent.
- `commodityPrices` and `valuationRatios` are read at analysis time and never stored. `vndirect` serves them from
  `/v4/commodities` and `/v4/ratios`, per name since `fromDay` or for all names on one `toDay` session with their five-year
  averages. A `fred-csv` body without the CSV header fails the parse rather than reading as empty. A loss-making year has no
  P/E, and missing is no reading; a non-trading session answers empty, so the reader steps back one session.

**`proprietaryFlows` is not a failover for `flows`.** `cafef` publishes the proprietary desk alone, with no foreign figures. It
leads that desk by two sessions, while `vndirect` drops whole sessions of it (four of 68 trading days, measured over four
months). The flows reader asks for it only over the sessions still missing that leg, never the newest: the desk publishes after
the close, so those are missing at every provider, and asking would sweep the universe daily for data nobody holds yet.

**Crypto quotes** lead with the `crypto` default venue (`default_for` under `[trading.venues.<id>]`, `binance` unless set) when it
is also a provider: a plan priced anywhere else quotes a number the operator cannot get filled at. `okx` does not list every
name; one it lacks answers code `51001`, which the adapter maps to a business miss so failover moves on without counting a
provider failure. The three quote providers are keyless and not metered by the month, which matters because the alert loop reads a
quote per watched coin every tick; a metered primary would burn its quota on a background loop. That is why CoinGecko serves the
market-cap board and one rate read, not the quote path.

Binance asks for `symbolStatus=TRADING`: a pair it has halted keeps answering with its last trade forever, and the filter turns it
into the 400 that failover already understands. Unfiltered, a halted LITUSDT would quote 0.743 while OKX, Bybit and MEXC trade it
at 4.6, an 82% gap that drives the ATR stop below zero and reports the plan as having too little data.

`mexc` lists far more spot bases than Binance and Bybit between them, so it serves some top-ranked coins neither carries (a
remainder is listed by no routed venue). It is third in `bars` on purpose: the long tail it uniquely covers is where reported
volume is least trustworthy, so it answers only for a name the majors decline. Its bars carry no `takerBuyVolume` (no aggressor
split), which `Candle` models as absent rather than zero.

**`fx`** is one `ANY_SCOPE` list whose members do not overlap. The coin providers lead and pick their own work: they cover only a
pair whose base is a coin they can price. `yahoo` and `er-api` split a pair into two ISO codes, so a seven-character `USDTVND`
fails their `covers`. `coinbase` leads the pair it trades because the crypto book is valued through that rate; `okx` backs it
because coinbase's book is the deeper one. `fxHistory` is `yahoo` alone: the coin providers quote spot, not dated history, and
`er-api` publishes today's board only. A fiat pair reaches `yahoo` untouched; a coin's dollar leg (`USDTUSD`, the bridge leg of a
`USDTVND` rate) reads Yahoo's `USDT-USD` listing, refused unless it answers as a cryptocurrency. Without it a past day's rate
carried today's peg and moved on every call while naming that day. There is no fallback from
`USDTVND` to `USDVND`: USDT is a different instrument in a different market, and a substituted rate is worse than the gap
`valuation.fx-missing` reports.

### Health demotes, it never promotes

After route order, `orderByHealth` does a stable sort that moves degraded providers behind healthy ones. Degraded means the
breaker is open or the newest recorded event was a failure (`recordSuccess` clears the failure code).

`lastFailureCode` is a `CaveatCode`, and `toCaveatCode` produces only four: `source.timeout`, `source.rate-limited`,
`source.unavailable`, `source.payload-rejected`. `/sources` shows each through `trading.source.failure.<code>` and
`renderProvidedValue` (`features/market-data/render/sources.ts`), so a code the catalog has not caught up with falls back to the
code itself rather than a raw key. The full `trading.caveat.<code>` sentence is the wrong shape for that row: it names the provider,
which the row already leads with.

Ordering by how recently a provider succeeded is rejected: it ranks a provider by work it did for another kind. One `marketCap`
call put CoinGecko ahead of Binance for every `bars` request that followed, and the paced fallback served a whole screen the
unpaced primary was routed first for.

### Failover vs merge

`SourceRegistry` has two operations; the difference is whether providers are interchangeable.

- **`resolve`** - failover. Walk the eligible providers in order; the first `available` result with a usable value (a non-empty
  array, or any non-array) wins. Outage notes from providers it passed over fold into one `source.recovered` line naming the one
  that failed and the one that answered. If none wins:
  - when every provider answered (empty, declined as `unsupported`, or only `source.symbol-not-found`,
    `source.ambiguous-symbol` or `source.empty-window` caveats), the result is `unavailable('empty')`, with each empty provider
    named by `source.empty-window`. A suspended name or a small cap with no foreign flow is healthy and must not read as an
    outage. That note is emitted only when the whole route came up empty, so a recovered request says nothing about providers it
    passed over;
  - otherwise `unavailable('failed')` listing every id attempted plus `source.no-available-provider`, and one
    `trading.source_route_exhausted` warning per scope per minute (a universe sweep exhausts the same route once per name).
- **`resolveAll`** - merge. Every routed, covering provider runs in parallel and the caller combines results in route order, which
  is also precedence. A leg whose breaker is open is skipped (one dark provider would spend its whole deadline on every merged
  read); only the breaker, never `isDegraded`, so one failure does not drop a leg having a bad minute. Callers merge for two
  reasons.

  Most merge because no single provider covers the subject:

  - `macro` - no provider publishes every series; the keyless `treasury`/`bls` pair leads so an unkeyed install still reads
    macro.
  - `goldBoard` - no vendor quotes every domestic form, so the first usable board would drop any form only a later vendor
    carries. `giavang` leads because it carries SJC's own quote; the SJC bar `pnj` resells is used only when `giavang` does not
    answer.
  - `supervision` - `hsx` is HOSE's own listing service and `ssi`'s broker board is the only free endpoint that also carries HNX,
    so the union covers the market. Each read states the boards it covered; a board no read covered leaves its names unknown,
    not clear.

  `proprietaryFlows` merges for the other reason. It has one provider, but failover would treat an answer of no rows as a
  failure, and here that answer is the useful fact: a desk that traded nothing still closes the gap.

Both check the caller's signal before doing work and throw on abort.

## Transport

`createSourceHttp` (`sources/transport/http.ts`) is the single client: one instance shared by every adapter, holding the pacer and
the health log. These constants are the global defaults - what a request gets when it asks for nothing specific.

| Knob | Value | Meaning |
|---|---|---|
| `REQUEST_BUDGET_MS` | 35,000 | wall-clock ceiling for the whole request, pacing and retry sleeps included |
| `ATTEMPT_TIMEOUT_MS` | 10,000 | per-attempt deadline inside that budget (bulk default) |
| `RETRY_MAXIMUM_ATTEMPTS` | 3 | bulk default |
| `RETRY_INITIAL_DELAY_MS` / `RETRY_MAXIMUM_DELAY_MS` | 500 / 5,000 | backoff bounds |
| `MAXIMUM_RESPONSE_BYTES` | 2 MiB | body cap |
| `MAXIMUM_PAGES` | 20 | follow-up pages one fetch chases |
| `PAGE_SET_BUDGET_MS` | 120,000 | ceiling over a whole page set; without it a twenty-page read is twenty request budgets in series |
| `BREAKER_FAILURE_THRESHOLD` | 3 | consecutive failures before the breaker opens |
| `BREAKER_FAILURE_WINDOW` / `BREAKER_FAILURE_RATE` | 20 / 0.5 | recent outcomes the failure *rate* is measured over, and the share that must have failed |
| `BREAKER_COOLDOWN_MS` | 300,000 | how long it stays open; it closes only when this runs out, since a success from a request sent before it opened says nothing about the provider now |

Two kinds of read share this transport. A **bulk read** (refresh sweep, bar history) takes the defaults, because finishing matters
more than finishing now. A **quote read** (`/price`, the watchlist pulse, every alert tick) adds `QUOTE_ATTEMPT_LIMITS` (8,000 ms,
1 attempt), so a dead primary costs one short wait before failover instead of three backed-off retries while somebody waits at
a prompt. The numbers live in one exported constant so quote adapters cannot drift apart. 8,000 is what a loaded run measured:
yahoo answers a lone quote in about a second but took 2.2 s to 5.3 s inside a brief sharing the process with a hundred other
requests, and a tighter bound reported a live provider dead on every run.

One request, in order:

1. **Guard.** An aborted caller signal throws. An open breaker returns `source.breaker-open` without touching the network.
2. **Resolve the target.** The provider's registered origin plus base path, or - for a feed request - the allowlisted feed URL
   named by `feedId`. Anything else is unroutable and reported as `source.unavailable`.
3. **Inject the credential.** The request declares placement only; the transport reads the resolved secret. Where the secret may
   travel: [Security invariants](#security-invariants).
4. **Pace.** A token bucket per provider that declared a limit, refilling continuously so the wait is computable without
   polling. The bucket holds a quarter of the minute's budget (`BURST_FRACTION`, at least one token): a cold process spending
   the whole minute at once is refused by a provider that meters a shorter window. Sustained throughput is still the declared
   rate. Pacing happens *before* the call rather than recovering after a 429: without it a wide watchlist trips the breaker and
   loses the provider for a cooldown. Every retry takes its own token, since a retry is another request the provider serves. A call whose budget runs out
   while it waits for a token never reached the provider, so it answers `source.timeout` without touching the breaker: a deep
   queue behind a healthy provider must not open it.
5. **Send, with retry.** `isRetryable` covers timeouts and `408 425 500 502 503 504`; any other status is the provider's answer
   and repeating it returns the same. A 429 is decided by its headers: retried only if it carries `Retry-After`, because an
   allowance that is used up says nothing and repeating the call spends more of what ran out - how a month's quota disappears in
   an afternoon. A `Retry-After` on a 429/503 is also a server-set floor: backoff applies on top but never waits less. A floor
   longer than what is left of the request budget is not waited out: the retry is skipped, so the 429 itself is what gets
   mapped (`source.rate-limited`, with its `Retry-After` handed to the breaker) rather than a budget that expired mid-sleep
   and read as `source.timeout`.
6. **Record health, then map.** The breaker sees the round trip whether or not the body maps, because a schema mismatch is not a
   transport failure.
7. **Log.** One `trading.source_request` debug line per round trip with `sourceId`, `path`, `status`, `elapsedMs` and `pacedMs`
   (queue wait timed apart from the wire; a pacer can hold a call for a minute and a wait counted as latency reads as a slow
   provider). Both use `performance.now()`; wall-clock deltas would go negative across an NTP step.

The breaker opens on any of three signals: the first response that names its own backoff; three consecutive failures (one
timeout inside a sweep of hundreds of requests says nothing about health); or half of the last twenty outcomes failing. The
streak catches a provider that stopped answering; the rate catches one that answers half the time, where a fan-out's successes
keep resetting the streak while every failure pays its full retry budget. `summary()` exposes `{ id, lastSuccessAt?,
lastFailureCode?, breaker }` and never a URL, credential or provider message: a health view is where a leaked key is least
noticed.

## Limits and caps

Which tier a cap lives in is the design decision: a number describing the *provider* is a fact owned by code; a number describing
the *call* travels with the request.

### 1. Global transport defaults

The table under [Transport](#transport): one value for every provider. Network tuning, not operator judgment: a provider answers
inside it or failover moves on.

### 2. Per-source facts

The only cap held per provider is the rate limit, `SOURCE_RATE_LIMITS` (`composition/source-facts.ts`): the published free-tier
ceiling or, where none is published, a rate a universe-wide sweep sustains without throttling. The per-minute numbers are on the
[user page](../data-sources.md#limits). Why the non-obvious ones are what they are:

- `binance` 600: leads crypto `bars`, and crypto `quote` as default venue; the alert loop reads a quote per watched coin every
  tick. `okx` 600: published ceiling of 20 requests per 2 s per IP. `mexc` 600: the host grants 3,000/min (500 weight per 10 s at
  weight 1); matches its two siblings in the route. `binance-futures` 600: the sole `funding` route. `bybit` 600, `fred` 120:
  published ceilings.
- `cafef` 300: per-name, so a gap fill sweeps the universe. `vndirect` 300: broker endpoint swept universe-wide.
- `cafef-statements` 60: publishes none; a page of about 33 KB, asked only for a name whose newest quarter lacks cash flow.
- `vietcap-statements` 120: publishes none; a name costs three requests (four for a bank) and a refresh asks for about 120 names
  only when their reports are due.
- 60: `coinpaprika` publishes 10/s and 20,000/month; `coinlore` and `treasury` publish none (sweep-safe rate); `entrade`, `kbsec`,
  `vietcap` are broker endpoints; `google-news` is one search per instrument read; `hsx` one `supervision` read per sweep; `rss`
  is shared across every feed the id serves; `ssi` is the `supervision` leg that carries HNX; `yahoo` serves gold `quote`/`bars`
  plus the fiat `fx` leg; `coinbase` is one pair per conversion.
- 30: `giavang` serves `goldBoard` and `goldBoardHistory` (history is the SJC bar only); `pnj` is the PNJ ring and the SJC bar when
  `giavang` does not answer; `vietcap-board` one board read is four requests; `vietcap-chart` per-name, the first provider that
  charts every HOSE index; `vps` per-name, the `bars` failover for the indices only it and `vietcap-chart` carry; `fred-csv`
  monthly commodity series; `alternative-me` one `sentiment` read per run.
- `cftc` 20: one weekly file. `sbv` 10, `nso` 10: publish none; one page / one monthly report.

**Every routed provider is paced, enforced at boot.** `assertEveryRoutedSourcePaced` refuses to compose with
`sources declare no rate limit: <ids>` when a routed id is missing from the table, so a route in one file and a limit in another are
caught there instead of as a 429 in production.

Three figures limit a burst rather than the quota that binds them, because a token bucket cannot express a day or a month: `bls`
(per day), `er-api` and `coingecko` (per month). None is near its allowance in ordinary use (`bls` is asked once per macro
refresh; `er-api` is last in the `fx` route). The numbers prevent a breaker storm spending an allowance in an afternoon. Set far
above the real peak they prevent nothing: a runaway at hundreds of requests a minute empties a monthly quota in an hour, whereas a
figure near the peak leaves half a day for the breaker and a human to react. `coinmarketcap` (30) publishes no ceiling for its
keyless subset and answers `1022` once an anonymous caller has used it up (measured recovering within a minute of going idle); the
figure stops the burst and the next provider covers a refusal. `coingecko` (10) is keyed (`COINGECKO_API_KEY`; the adapter
targets a Demo plan of 10,000 calls a month), so without the key it is not registered. It sits last on the market-cap route,
reached only when its key is set and the keyless boards have failed or a coin is past every window.

The pacer treats an absent limit as unpaced, not zero. No built-in reaches that path but a plugin can, so a manifest omitting
`rateLimitPerMinute` gets `PLUGIN_DEFAULT_RATE_LIMIT_PER_MINUTE` (30). A limit of zero is a `ConfigError` (the manifest schema
requires a positive integer, and the pacer refuses a non-positive one): the wait formula divides by it and `setTimeout` clamps the
resulting `Infinity` to fire immediately, silently unpaced instead of never granted. Pacing is per source id, not per kind: one
bucket serves every kind the provider answers, because the provider counts requests the same way.

### 3. Per-request overrides

A `SourceRequest` may override these fields. They only tighten: the 35 s budget wraps every attempt and retry sleep (via
`AbortSignal.any`).

| Field | Effect |
|---|---|
| `attemptTimeoutMs` | replaces the 10 s attempt deadline |
| `maxAttempts` | replaces the 3-attempt cap |
| `businessMissStatuses` | statuses that mean "unsupported here" instead of "provider failed" |

`QUOTE_ATTEMPT_LIMITS` (exported from `transport/http.ts`) is added by the adapters on every quote path (`vndirect`,
`vietcap-chart`, `entrade`, `okx`, `binance`, `mexc`, `yahoo`) and by the `fx` reads of `coinbase`, `okx` and `coingecko`. A merge
is the opposite case: `resolveAll` waits on every leg, so a retry delays every provider in it. `fred`, `treasury` and `bls` use
`COMPLEMENTARY_ATTEMPT_LIMITS` (1 attempt, default deadline), capping the macro merge at its slowest leg's single deadline.

Every quote route applies the quote limits to **both** legs. A primary left on the bulk default does not make the read likelier to
succeed; it spends three attempts and about 31 s reaching the failover that one attempt reaches in 8 s. Against a healthy provider
the deadline is never close (VN quote reads sit at a 502 ms median, 732 ms maximum). It is deliberately not a per-source fact:
the same provider serves a bulk sweep and an interactive quote, and the deadline belongs to which is asked for (`yahoo` gets 8 s
for a quote and 10 s for a bar history in the same run).

### 4. Per-adapter provider ceilings

What one call may ask a provider for, owned by the adapter because it is that host's API contract:

| Source | Cap | What it bounds |
|---|---|---|
| `binance`, `bybit` | 1,000 | klines per request |
| `mexc` | 500 | klines per request - measured; the documented cap is 1,000 but the endpoint returns 500 however high `limit` goes |
| `coingecko` | 250 | universe rows per page - a coin ranked past it resolves by name, one symbol per call |
| `coinpaprika` | 750 | the resolution window, in one request; no symbol lookup, so a coin past it falls through to coingecko |
| `coinmarketcap` | 750 | listing rows per request - the whole ranked window in one call, which is why it leads; the keyless subset has no per-symbol row, so a coin past it falls to the next provider |
| `coinlore` | 100 | tickers per request - no symbol lookup, so it answers only its own window |
| `vndirect` | 500 / 4,000 | standard / market-wide page size (`DEFAULT_PAGE_SIZE` / `MARKET_PAGE_SIZE`). Offset paging over the market repeats some rows and drops as many others whatever the sort (one month of bars lost about 1,400 of 34,893 rows), so a market-wide window is never paged: one that fits a page is read whole, one that does not is read a day at a time, and a day that fills its page fails the read |
| `vndirect` | 50 | news records per request |
| `vndirect` | 50 | codes per `/v4/ratios/latest` batch (`RATIO_BATCH_TICKERS`) - no market-wide form, about 83 ms per code on a cold CDN cache: 200 timed out every run, 100 measured 8.3 s against `REQUEST_BUDGET_MS`, 50 answers in 4.3 s and still sweeps the universe in under ten requests |
| `vndirect` | 45 | days per market-read bar window |
| `vietcap` | 8 | trade-sides pages |
| `vietcap-board` | 600 | symbols per board request - about 2.4 KB per name decoded, so the whole list at once lands near 4 MiB against the transport's 2 MiB ceiling |
| `fred` | 10 | observations per series |
| `giavang` | 24 h | tolerated timestamp skew before a row is dropped |

Pagination spans tiers: the adapter names `pageSize`, the transport follows up to `MAXIMUM_PAGES`, and hitting it with a full last
page yields `source.truncated`.

### What has no cap

There is **no per-source daily or monthly request budget**, and no per-source breaker tuning, response-size cap or page ceiling
(those three are global). A free-tier key is protected by the per-minute bucket alone. Cost caps exist for LLM spend
([budgets](../budgets.md)), not provider calls, because calls are free at the tiers these adapters target.

## Failure taxonomy

Everything a provider can do to you has a name, and the name reaches the reader as a caveat. These are the ones the transport and
registry raise; adapters and markets add their own, all in `kernel/caveat.ts`.

| Code | Cause | Health effect |
|---|---|---|
| `source.timeout` | attempt or budget deadline spent | counts as a failure; a budget that expired while the call was still queued behind the pacer is returned as a timeout but not counted, because nothing was sent |
| `source.rate-limited` | HTTP 429 | counts; `Retry-After` opens the breaker immediately, and without it the request is not retried |
| `source.unavailable` | any other HTTP failure, or an unroutable target | counts |
| `source.breaker-open` | request refused before the network | none - it is the effect |
| `source.payload-rejected` | `parse` threw, or the body was not the declared schema | none, by design |
| `source.symbol-not-found` | a provider-documented status listed in `businessMissStatuses` | none - a property of the request |
| `source.empty-window` | the provider answered with nothing | none |
| `source.truncated` | pagination hit `MAXIMUM_PAGES` or the page-set budget with a full last page | none |
| `source.market-read-truncated` | a market-wide `vndirect` read whose page was cut short; it fails for every ticker sharing the read, because a prefix would replace a full window | none |
| `source.no-available-provider` | every routed provider was tried and none could serve the request | none - it summarizes the others |

Two distinctions:

- **A business miss is not an outage.** `businessMissStatuses` lets an adapter declare which non-retryable statuses mean "this
  request is unsupported here" - Yahoo's 404 on an unlisted coin pair. It resolves to `unavailable('unsupported')` and the next
  provider is tried. Yahoo's metals tickers resolve through a *total* table, so their 404 is a broken mapping and must read as a
  failure.
- **A caller's cancel is not a provider failure.** Both outcomes of an expired budget are decided from the signals, not from an
  error's name (`AbortSignal.timeout` rejects with `TimeoutError`): the caller's own abort rethrows and never touches the
  breaker; our deadline expiring means the provider was too slow.

## Caching

The caches are narrow, each justified by a measured cost.

**Settled bars** (`sources/settled-bars.ts`) - a read-through day cache wrapping a bars source. A day before today is settled and
never changes, so it is fetched once. It wraps `binance`, `bybit` and `mexc` only, because it needs a raw, UTC-keyed, continuous
series. An adjusted series (equity-vn) is restated backwards and must never pass through it, and continuity matters because
coverage is checked over calendar days: a market with weekends would never hit.

- Today's still-forming bar is dropped before anything reads it. Keeping it would make one window score differently minute to
  minute and date the evidence to a session nobody has closed. Consumers read bars as settled evidence and take the live price
  from `quote`.
- The cache serves the longest *prefix* of settled days it holds and refetches only from the first gap, so one newly settled
  day does not refetch the two hundred before it, which every name on a board would cost each time the UTC day rolls over.
- Days a provider answered by publishing nothing are cached as absent, but only the leading run: a listing has no bars before
  its first, while a gap further in could be a truncated response, and recording it as absent would shorten every later
  lookback.
- Cached rows carry `freshness: 'cached'` in provenance. The key is market-qualified, because one ticker can name a different
  instrument on each market a source serves. Bound: 8,000 entries, LRU.

**Macro** (`markets/macro-cache.ts`) - one merged macro read per region and day, shared by every market that scores against it
(gold from several capabilities, VN equities from another), all asking the same `(region, day)` question. The slot holds the
in-flight promise, so callers arriving together share one fan-out. It holds two entries (today and the adjacent day, for a run
crossing midnight). A failed or aborted read clears its own slot, and so does a read in which any provider did not answer: the
day's first pass runs before the US series publish, and only a complete read is served to later callers.

**Universe** (`sources/adapters/crypto-universe.ts`) - one ranked board read per hour of work (`UNIVERSE_ROWS_TTL_MS`). A ranked
board reorders by a few places an hour and every quote and symbol lookup reads the same sweep. Five minutes cost one 750-row
listing per screen and tripped CoinMarketCap's unstated ceiling in bursts. Rows keep their own observation time, so nothing
reads fresher than it is.

**Market read** (`sources/adapters/vndirect/market-read.ts`) - a refresh sweep asks `vndirect` for one ticker at a time over the
same window, while the provider serves a whole market per query, so the first caller reads the window and every later one takes
its slice. The single slot slides forward on each hit (60 seconds idle) and cannot outlive five minutes. A failed read is each
caller's own failure rather than a fallback per ticker, which would turn one provider failure into one request per name.

Beside the caches, `resolve` shares one in-flight read between identical requests made under the same signal
(`sources/coalesce.ts`). The entry is dropped the moment it settles, so nothing is answered from an earlier read; it only stops
candidates scored together from each downloading the same market-wide board.

## How trading features use sources

Nothing outside `trading/` touches an adapter, and almost nothing inside it touches the registry:

```text
CLI / channel / agent tool
  -> feature          (features/market-data, brief, suggestion, portfolio, alerts)
    -> market capability   (markets/<ref>/..., reached through MarketRegistry)
      -> SourceRegistry.resolve | resolveAll
        -> Source.fetch -> SourceHttp -> provider
```

A market receives the registry as `MarketDeps.sources` (`markets/deps.ts`) and nothing else that reaches the network. Markets get
no logger and no clock; every instant arrives in a request, which keeps a capability testable and its results attributable.

Holders besides a market capability, each for a reason the market cannot serve:

- `runTapeNews` (`features/market-data/context.ts`): the macro tape prices every market and belongs to none.
- `createFxRates` (`features/market-data/reads/fx.ts`): valuation and the ledger both convert currency and neither may hold a
  registry, so the seam is `FxRates.convert`. Copy this pattern when a non-market feature needs a provider read: a consumer-side
  interface naming the operation, not the registry.
- The macro-extract job (`features/market-data/macro-extract/tick.ts`): reads `statReports`, which belongs to no market.
- Themes (`features/themes/evidence/`, `features/themes/chain/`): read `commodityPrices` and `valuationRatios` through a
  `Pick<SourceRegistry, 'resolve'>` view.
- Composition: builds it, wraps it so every `news` read is archived (`wiring/composition/news-archive.ts`), and builds
  `macroCache` over it.

### Capabilities are the feature-facing contract

`MarketCapabilities` (`markets/types.ts`) is a partial map over `MarketCapabilityMap`: `quote`, `bars`, `overview`, `events`,
`news`, `screen`, `sectors`, `sentiment`, `funding`, `recommendations`, `accounts`, `flows`, `tradeSides`, `statistics`,
`macroRisk`, `basis`, `brief`, `refresh`, `staleKinds`. A feature reading a capability the market does not publish gets
`market-data.kind-unsupported`, not a method that throws. Most results are `SourceResult<T>`, so caveats and provenance reach the
rendered line without a second vocabulary; the capability adds quote unit, currency, session state and the `asOf` day.

### Which market a read goes through

None of the rules is registration order:

| The caller gave | Resolution | Owner |
|---|---|---|
| a bare ticker | `resolveInstrument` qualifies it through the registry; an unknown or ambiguous name becomes `market.ticker-unknown` / `market.ticker-ambiguous`, never a fallback market | `features/market-data/resolve.ts` |
| a market ref | `requireMarket`, which throws naming every registered id | `features/market-data/market-data-run.ts` |
| nothing, on a market-scoped command | the owner of `[locale] region`: `markets.regionOwner(config.defaultRegion)` | `markets/registry.ts` |
| a region, for a regional read | `markets.regionOwner(region)`, whose macro capability publishes the region's composite | `markets/registry.ts` |
| a region, for a read every market in it contributes to | every market in the region that publishes the capability, merged (curated news) | `features/market-data/context.ts` |

A region can hold several markets (`vn` has domestic gold and VN equities), so taking the first would make the answer depend on
registration order: `/overview` would show domestic gold's global-only macro under a VN heading while `/brief`, `/rebalance` and
`/suggest` gate on the VN-adjusted one, which only lowers the band. The region-owner default is why `/screen`, `/price` and
`/suggest` take the market as an optional trailing word. `ownsRegion` is checked at boot: a region with no owner or two is a
`ConfigError`. A region whose owner publishes no calendar contributes nothing and the market stays required.

### Two read shapes: live, and stored evidence

**Live reads** hit a provider on every call, where the number is the answer and staleness is the failure: `quote`, `tradeSides`,
`news`, `sentiment`, `funding`, `fx`, `goldBoard`, `sessionQuotes`. They carry the quote SLA where a person waits.

**Stored evidence** goes through a refresh sweep. A market's `refresh` capability resolves its kinds from the registry, validates
the whole scope and writes it to `MarketDataStore`; features read the store. The swept kinds are `REFRESH_DATA_KINDS`
(`kernel/market/refresh.ts`): `instruments`, `bars`, `fundamentals`, `flows`, `macro`, `accounts`, `premium`.
`foreignRoom` and `indexMembership` resolve inside the universe refresh, because they only mean something attached to the listing
set being replaced. A screen cannot issue one live request per name, and evidence must be stable across a session.

- **Provenance is persisted with the row.** A `BarRecord` carries the `sourceId` and `fetchedAt` of its fetch, so a suggestion
  names the provider that published its latest bar, not the one routed today. One stamp per factor, not per bar.
- **Scope replacement is atomic.** `replaceInstruments` swaps a market's whole universe or none of it; a partial write would
  delist every name the provider omitted.
- **A rejected payload is a rejected target, not an empty result.** The evidence path turns a missing or inadmissible row into a
  per-instrument rejection carrying the caveat.
- **Retention is derived.** `MarketManifest.evidenceSessions` says how much history a market's factors read and the retention
  sweep sizes itself off the largest.
- **`staleKinds` decides what a refresh refetches**, because only the market knows each kind's cadence (a listing weekly,
  fundamentals every few sessions). A stored attempt must first pass one test: the day it claims must have settled by the time
  it was written, or a pass inside the settle gap pins the kind to a tape still forming.
- **Kinds run in stages.** `equity-vn` runs `bars`, `fundamentals` and `flows` together, then `macro`, then `accounts`: the
  last two read the cross-section the first three rewrite. A stage settles every kind before the next starts, so a kind that
  throws never leaves a sibling writing after the refresh failed. Each kind result carries `elapsedMs`, logged on
  `trading.market_data_refreshed`.

Crypto is the exception: `markets/crypto/screen-run.ts` ranks straight off `marketCap` and `bars` reads with no store, because its
universe is one ranked request rather than a swept board.

### Fan-out is bounded at the feature, not the transport

The pacer bounds requests per provider per minute, not how many a feature starts:

| Bound | Value | Where |
|---|---|---|
| quote board items / concurrency | 12 / 4 | `SURFACE_LIMITS.maximumQuoteBoardItems` (`trading/surface-limits.ts`), `reads/quote-board.ts` |
| screen quote concurrency | 4 | `features/market-data/market-data.ts` |
| statistics concurrency | 5 | `reads/statistics.ts` |
| alert evaluation concurrency | 4 | `features/alerts/alerts.ts` |
| candidate / valuation concurrency | 5 | `features/portfolio/candidates.ts`, `folds/valuation.ts` |
| suggestion batch concurrency | 5 | `wiring/config-defaults.ts` |
| VN evidence source / factor evidence concurrency | 5 / 8 | `markets/equity-vn/policy.ts`, `markets/equity-vn/factors/factors.ts` |
| crypto source concurrency | 10 | `markets/crypto/policy.ts` (`screen-run.ts` and the bar sweep) |
| calendar names / concurrency | 40 / 5 | `SURFACE_LIMITS` |
| screen candidates / news items | 50 / 50 | `SURFACE_LIMITS.maximumScreenCandidates`, `.maximumNewsItems` |

**A cap is not a ranking**: a name cut by a cap is explained with `market-data.universe-truncated`, not silently missing (the
watchlist pulse is the worked example, in [Trading](../trading.md#the-pulse-reads-live-twelve-names-at-a-time)). And **the pacer's
cost is paid per provider, not per market**, which is why a crypto screen bounds itself in flight: an unbounded one would starve a
concurrent suggestion of the same provider's tokens.

### What a feature does with a failure

Features never turn a `SourceResult` into an exception.

- **`unavailable` renders as an absent section** naming the reason and the ids attempted. The brief's `etf-flows` reporting
  `unavailable` is the designed behavior of an unrouted kind.
- **Caveats accumulate upward** and dedupe once per message: ready sections hoist theirs to one list, a *failed* section states
  its own.
- **A best-effort read propagates its caveats instead of collapsing to absent**, so an outage does not read as a closed session.
  The VN intraday breadth block returns `{ breadth?, caveats }` and the overview concatenates them.
- **A non-finite or missing value becomes a caveat, never a zero row.**
- **The pipeline degrades rather than guesses**: [Trading](../trading.md#the-suggestion-pipeline).

An agent calls a tool, the tool calls a feature, the feature reads the store or a capability. The market-data tools describe
themselves as answering from "our own sources" or filings store: a number the agent quotes went through an adapter, a schema and
a provenance stamp.

## Security invariants

- **Hosts are pinned.** An adapter names a provider-relative path; the origin comes from the boot-validated endpoint list. A
  `SourceRequest` cannot express an absolute URL.
- **Feeds are allowlisted.** `feedId` selects from the code-owned `RSS_FEEDS`; `path` and `query` are ignored on that path, and a
  feed outside the map is never fetched.
- **Secrets stay in the outbound request.** Never in provenance, a summary, a log line or a config file. `formatErrForLog`
  scrubs what is logged.
- **POST is a read.** `jsonBody` exists for providers with no GET equivalent, only for reads: the retry policy replays the
  request, so a body that mutated anything would replay too.
- **Bodies are capped** at 2 MiB, and non-2xx bodies are discarded by the core HTTP seam, which is why only a
  provider-documented *status* can mark a business miss.
- **Fetched text is sanitized** before it reaches an agent: `normalization.ts` runs the prompt-injection scan and raises
  `source.content-sanitized` rather than passing markup through.

## Plugin sources

A plugin adds a provider with `sources.ts` at its root. Presence is the declaration, as with `agents/`, `workflows/` and
`skills/`; there is no manifest section, and the module exports its own facts. The user-side view is
[Extending](extending.md#plugins).

```ts
export const manifest = {
  id: 'acme',
  endpoint: 'https://api.acme.com/v1',
  rateLimitPerMinute: 60,
  credentialEnv: 'ACME_API_KEY',
  routes: [{ kind: 'bars', scope: 'equity-vn' }],
}

export function createSources(kit) {
  return [kit.define({ kind: 'bars', covers, request, parse })]
}
```

- **The module imports nothing.** A user file cannot resolve runtime specifiers inside a compiled binary, so the toolkit arrives
  as an argument: `kit.define` is `createSource` with the module's id and a *pinned* transport already bound, `kit.ok` is
  `parsedSource`. A plugin can neither claim another provider's id nor reach another host through the shared client: every
  request is checked against the manifest origin, and `feedId` is refused outright (`sources/plugin-module.ts`).
- **Request specs only.** `kit.define` rejects a loaded spec.
- **Requires `plugins.allow_code = true`**, separate from `allow_untrusted`. Running a plugin's code grants it everything the
  process can do; the declared endpoint constrains an honest plugin, not a hostile one. `allow_code` is the consent boundary.
- **A plugin is never tried first.** Merged routes put every first-party id ahead of every plugin id for the same scope. A plugin
  may open a scope no built-in serves or stand behind one that exists. An id already owned by a built-in, or claimed by two
  plugins, is dropped.
- **Failures are contained.** An unreadable module, a throwing import, a 5-second import timeout (`IMPORT_TIMEOUT_MS`), a bad
  manifest, an id collision, or a defined kind its routes do not cover logs `trading.plugin_source_skipped` and drops that
  plugin. Boot continues. Modules import sequentially, because a module executes on import and boot should not run several
  unknown modules at once.

## Adding a first-party source

1. Write `sources/adapters/<provider>.ts` exporting `<PROVIDER>_DEFAULT_ENDPOINT` and
   `create<Provider>Sources(options: SourceAdapterOptions): readonly RegisteredSource[]`, one `createSource` call per kind.
2. Add the endpoint to `SOURCE_ENDPOINTS`, a rate to `SOURCE_RATE_LIMITS` (composition refuses a routed id without one), and a
   variable name and its `adds` catalog line to `SOURCE_CREDENTIALS` if it needs a key.
3. Spread the factory into `createBuiltInSources` (`composition/source-facts.ts`).
4. Give every `(kind, id)` a position in `SOURCE_ROUTES`. Registration throws without one.
5. If it introduces a caveat code, add it to `kernel/caveat.ts` with its severity, and its copy to both `en.json` and `vi.json`.

## Considered and rejected

- **Declarative source routing in `plugin.toml`.** A route asserts that an adapter can address instruments in a market, a
  capability only its code has. A route without the symbol mapping fetches the wrong instrument and stores it as evidence,
  silently.
- **Operator-declared custom sources with a field mapping.** `Candle.at` is a trading day while most providers return epoch ms,
  so any real provider needs a conversion; adding conversions to config is writing a language in TOML.
- **Per-market source folders.** Sources are shared (`vndirect` serves VN equities and VN macro, `yahoo` serves gold and FX), so
  no market owns them.
- **Ranking providers by recent success.** See [Health demotes, it never promotes](#health-demotes-it-never-promotes).

## Source map

- Contract: [kernel/source/source-result.ts](../../../src/trading/kernel/source/source-result.ts), [kernel/caveat.ts](../../../src/trading/kernel/caveat.ts)
- Routes and registry: [sources/routes.ts](../../../src/trading/sources/routes.ts), [sources/registry.ts](../../../src/trading/sources/registry.ts)
- Adapter factory: [sources/define.ts](../../../src/trading/sources/define.ts), [sources/adapters/](../../../src/trading/sources/adapters/), [sources/rows/](../../../src/trading/sources/rows/)
- Transport: [sources/transport/http.ts](../../../src/trading/sources/transport/http.ts), [pacer.ts](../../../src/trading/sources/transport/pacer.ts), [health.ts](../../../src/trading/sources/transport/health.ts), [http-failure.ts](../../../src/trading/sources/transport/http-failure.ts)
- Caches: [sources/settled-bars.ts](../../../src/trading/sources/settled-bars.ts), [sources/coalesce.ts](../../../src/trading/sources/coalesce.ts), [markets/macro-cache.ts](../../../src/trading/markets/macro-cache.ts)
- Composition and facts: [wiring/composition/source-facts.ts](../../../src/trading/wiring/composition/source-facts.ts), [wiring/composition/source-registry.ts](../../../src/trading/wiring/composition/source-registry.ts)
- Plugin sources: [sources/plugin-module.ts](../../../src/trading/sources/plugin-module.ts)
- Freshness rule: [markets/calendar.ts](../../../src/trading/markets/calendar.ts), [markets/live-reading.ts](../../../src/trading/markets/live-reading.ts), [markets/stored-quote.ts](../../../src/trading/markets/stored-quote.ts)
- Macro extraction: [features/market-data/macro-extract/](../../../src/trading/features/market-data/macro-extract/)
- `/sources` rendering: [features/market-data/render/sources.ts](../../../src/trading/features/market-data/render/sources.ts)
