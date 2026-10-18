# `trading/` — maintenance entry point

The bounded context that screens, scores, sizes, and debates trade ideas, keeps the operator's
ledger, and tracks how past suggestions performed.

This is the document to open before changing anything here. This is the map.

## The one rule that shapes everything

**OpenAlpha suggests by default and executes only through `/trade` and `order_place`.** One adapter
per venue (`venues/<id>/`), one shared service (`features/order/`), every order routed to exactly one
venue, approved and capped, every fill mirrored in the ledger — and an approved entry may leave one resting take-profit/stop-loss at the exchange.
That last clause is the part not to miss: after the run ends the operator has a standing order that
can fill while nothing here is watching. It is still not autonomous trading — no code chose the
levels or the moment — but a resting exit at the exchange can fill with no human present. Nothing
else places an order: no second broker client, no order type outside that feature, no submit path
anywhere else. The ledger records what the *operator* did, the pipeline produces written
suggestions, and every dangerous action is gated on a human.

## Where the module sits

```
core ← trading → engine        trading is self-contained: only app imports its API;
         ↓                     SDK and server access it through their public barrels.
    persistence
```

`@/trading/api` is the only import path other modules may use. There is no internal barrel and no
`export *` — a file inside `trading/` is internal until its name appears in `api.ts`.

## Internal layout

Nine vertical feature slices over three shared kernels, composed in one place. A feature owns its
whole stack — service, folds, stores, renderers, slash commands and agent tools — so a change to
one lands in one folder.

| Directory | Owns |
|---|---|
| `kernel/` | The vocabulary every other folder speaks: instruments, money, the book, caveats, factors, capabilities, page and store shapes. No policy, no finance decisions, and it imports nothing from the rest of `trading/`. |
| `render/` | The display contract: one owner per unit. `format` (magnitudes), `money` (prices and currency), `datetime` (days and clocks), `layout` (indents, separators, the block rule), `caveat`, `section`. A surface never calls `Intl` itself. |
| `markets/` | One folder per registered market, named by its `MarketRef`. A market is a manifest plus capabilities; `market.ts` is the only file outsiders import, and `api.ts` exists only where a sibling genuinely derives from it. |
| `sources/` | Provider adapters. They declare *what* they fetch and parse; `transport/http.ts` owns retries, timeouts, caching and the breaker. |
| `features/` | `alerts`, `brief`, `ledger`, `market-data`, `order`, `portfolio`, `profile`, `suggestion`, `themes`. One injected service each, its own `store/`, `render/`, `command`(`/`) and `tools`(`/`). |
| `wiring/` | Composition and nothing else: the registries, the service assembly, the command and tool contributions, the daemon ticks, the host facade, the config resolve. Nothing under `features/` may import it. |
| `agents/` `skills/` | Content, one folder per definition, like `markets/`. Only their *registration* lives in `wiring/`. |

`scripts/check-feature-isolation.ts` holds the shape: which feature may import which, that kernel
and render stay leaves, and that no data provider reads a feature. Its allowlist is the list of
documented exceptions and only ever shrinks.

## Policy → owner

Each row is a rule with exactly one enforcement path. If you find a second, that is the bug.

| Policy | Owner |
|---|---|
| A position's value | `features/portfolio/folds/valuation.ts` — a pure fold over the ledger, never a stored balance |
| Whether a portfolio is in breach | `features/portfolio/folds/health.ts` — every finding carries its `subject` |
| What the operator's policy is | `features/profile/profile.ts` — the book reads it and never decides it |
| Whether a suggestion may be made | `features/suggestion/pipeline/` stages; a blocked stage forces hold |
| Conviction | The debate may only *lower* it, never raise it. Bands and cut points: `kernel/conviction.ts` |
| How long a call has to work | `OUTCOME_WINDOW_DAYS` in `features/suggestion/pipeline/outcomes.ts` — calendar days per segment horizon, converted to each market's own sessions |
| Which market claims a ticker | The registry, closed in `wiring/composition/registration.ts` |
| Which source answers a kind | `SOURCE_ROUTES` in `sources/routes.ts` — adapters never choose |
| A day, a session, a holiday | The market's own calendar (`markets/calendar.ts`). Never `Date` arithmetic. |
| What a reading is old against | The region's last settled session (`resolveRegionSettledDay`), read by `features/portfolio/folds/staleness.ts`. Never the book's `asOf`, which is the calendar day. |
| What one session moved | `render/price-pair.ts` — `renderPricePair` for the stacked pair, `quoteBoardMoveOf` for a one-line board row. A surface never measures `last` against `previousClose.price` itself. |
| A *region's* trading day, and its macro composite | The one market whose manifest sets `ownsRegion`. Boot rejects a region with none or two; `regionOwner()` is the only way to reach it. |
| What session a macro composite is dated to | The owner's last settled session — `resolveSettledDay` on its calendar, at the refresh that stores it and at the region read that derives it. The calendar day dates a weekend composite to no session. |
| A factor's share of the composite | `markets/factor-scoring.ts` — published as `weight / firedWeight`, so contributions sum to the score |
| Whether a score is worth acting on | `markets/factor-scoring.ts` — `bullish` and `bearish` bracket a band where the composite has no opinion, and a read inside it holds |
| How a price prints | `QuoteConvention` from the registry, rendered by `render/money.ts` — currency, quote unit and board scale in one answer. A surface that can hold an index asks `instrumentQuoteConvention`, because a level takes no board scale |
| Whether a live price has left its settled close | `isGappedPastClose` in `markets/statistics.ts` — the screen's `gapped-past-close` caution and a buy's `suggestion.chasing-gap` read the same line |
| Display and request bounds | `surface-limits.ts` — one frozen object for tools and server |
| The default region | `TradingServices.defaultRegion`. A surface never holds a fallback. |
| The operator identity a request acts as | `wiring/host/`, closed over at composition |
| Theme lifecycle and evidence checks | `features/themes/` |
| What the pipeline may ask of storage | `features/suggestion/pipeline/types.ts` — the `SuggestionSink` seam |
| What an agent may never see | `AgentPortfolio` and `AgentProfile` — compile-time narrowings, gated again by `check-feature-isolation` |
| Every user-visible code string | The locale catalogs, validated at boot against `locale-manifest.ts` |
| Which headlines are kept, and for how long | `wiring/composition/news-archive.ts` writes them; `NEWS_RETENTION_MS` in `features/market-data/store/news-archive.ts` ages them out |
| Whether an extracted macro figure is kept | `features/market-data/macro-extract/verify.ts`; `store/macro-extract.ts` makes the office win over the press |

## Invariants worth re-reading before a change

- **The ledger is truth.** Positions, cash and NAV are derived by pure fold from the ledger rows.
  Rows are edited and deleted in place, so the book is the fold over the rows *as they stand now* —
  a correction re-bases every reading taken from it, past suggestions included.
- **Agents talk to tools; tools talk to the database.** No agent path reaches a store.
- **Relative vs absolute is structural, not a flag.** `viewRelative` returns weights and percentages
  and is what an agent can reach. `viewAbsolute` returns money and is reachable only from the host
  facade. The two are different types, so the boundary cannot be crossed by accident.
- **Unavailable is an answer, not an error.** `SourceResult` is `available | unavailable` with a
  typed reason and caveats. Nothing fabricates a number to fill a gap, and nothing throws because a
  free provider had no coverage.
- **Every instant is epoch-ms; every trading date is a `YYYY-MM-DD` string.** They are never
  compared against each other — `'2026-07-10T09:00' > '2026-07-10'` silently crosses a day boundary.
- **Read the clock once per logical operation** and thread the value. Two rows of one report must
  not disagree about what "now" is.

## Adding a market

A market is registration-only: adding one edits its own directory plus the one registration line.
No central switch, no union to extend.

1. Create `markets/<name>/` with a `manifest` (id, region, asset class, segment, currency,
   calendar, factor ids) and the capabilities the market supports. Decide `ownsRegion`:
   `true` means this market speaks for the region — its session defines the region's trading day,
   its brief schedule and every cross-market as-of date, and its macro capability publishes the
   region's composite. A region needs exactly one owner, so a second market in an existing region
   almost always sets it `false`.
2. Add `trading.market.<id>`, `trading.region.<region>`, `trading.segment.<segment>`, and one
   `trading.factor.<id>` per factor to **both** locale catalogs. Boot fails without them.
3. Register it in `wiring/composition/registration.ts` (`markets.register(...)`, before `markets.close()`).
4. Run `bun run lint:arch`. `check-registry-isolation` proves the new directory does not reach into a
   sibling market, and `check-trading-locale` proves the keys exist.

Adding a **source** is the same shape: an adapter in `sources/`, an optional `SOURCE_ENDPOINTS`
entry when a public default exists, and a scope entry in `SOURCE_ROUTES` (`sources/routes.ts`). An adapter declares
what it fetches and parses the payload; it never owns retries, timeouts, caching, or the breaker —
`sources/transport/http.ts` does. Providers that require credentials are registered only when their
credential resolves.

## Adding a surface command

A tool and a slash command are two audiences for one service call:

- **Tool** (`features/<name>/tools.ts`, or `tools/` where a feature has several) — an agent calls
  it. Relative views only, Zod-validated input.
- **Slash command** (`features/<name>/command.ts`, or `command/`) — terminal chat and channels.
  Terse acknowledgements, localized keys.

Both are registered in `wiring/catalog/{tools,commands}.ts`, which is the only place that knows every
feature. A command owns its concise positional grammar beside itself; tools keep their structured
schemas.

## Gates

```bash
bun run check      # typecheck, cycles, DAG, imports, server boundary, SDK surface, line limits
bun run lint       # Biome, autofix
bun run lint:arch  # depth, trading boundaries, market isolation, locale coverage, vi terminology
```

`check-trading-locale` catches a tuple member with no catalog entry **and** an orphaned catalog key
whose tuple member was deleted. The boot-time gate can only do the first; the second stays true
forever once it goes wrong, which is why it runs statically.
