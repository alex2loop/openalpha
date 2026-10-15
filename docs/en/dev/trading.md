# Trading internals

For contributors. The user guide is [trading.md](../trading.md). This page holds the contracts behind it.

## Sources

Every source call returns a `SourceResult<T>` ([source-result.ts](../../../src/trading/kernel/source/source-result.ts)):

```ts
type SourceResult<T> = SourceAvailable<T> | SourceUnavailable

interface SourceUnavailable {
  readonly kind: 'unavailable'
  readonly reason: SourceUnavailableReason // 'unconfigured' | 'unsupported' | 'stale' | 'failed'
  readonly attemptedSourceIds: readonly SourceId[]
  readonly caveats: readonly Caveat[]
}
```

- Freshness (`live` or `cached`) sits on each provenance row, never as one aggregate.
- An adapter declares what it fetches and parses the payload. Timeouts, retries, the size cap, caching and the circuit breaker belong to [`sources/transport/http.ts`](../../../src/trading/sources/transport/http.ts).
- A quote read declares a tight deadline and one attempt. Bulk reads keep the transport defaults.
- `SOURCE_ROUTES` ([routes.ts](../../../src/trading/sources/routes.ts)) decides which sources serve a scope, in order. `SOURCE_RATE_LIMITS` ([source-facts.ts](../../../src/trading/wiring/composition/source-facts.ts)) lists every shipped source. A keyed source with no credential is not registered, and boot logs `trading.source.skipped`.
- Every `news` result passes through `withNewsArchive` ([news-archive.ts](../../../src/trading/wiring/composition/news-archive.ts)).

## When a day is settled

One predicate owns it, in [calendar.ts](../../../src/trading/markets/calendar.ts):

```ts
isSettled(calendar, day, now) // calendar.isTradingDay(day) && now >= calendar.tapeFinalAt(day)
resolveSettledDay(calendar, now) // today if settled, else the previous trading day
```

`tapeFinalAt(day)` is the session close plus the auction lag. Every writer and reader asks it; none restates it. Callers:

- the refresh scheduler anchors a tick at `tapeFinalAt` ([refresh-schedule.ts](../../../src/trading/features/market-data/ops/refresh-schedule.ts));
- a refresh writes a row stamped `asOf` only once that instant has passed;
- `isAttemptCurrent` ([equity-vn refresh](../../../src/trading/markets/equity-vn/refresh/refresh.ts)) asks `isSettled(calendar, attempt.asOf, attempt.attemptedAt)` before it looks at age, so a stamp written inside the settle gap is never read as current;
- a market's quote capability drops a reading through `isLiveObservation` and falls back through `liveOrStoredQuote` ([stored-quote.ts](../../../src/trading/markets/stored-quote.ts)). The market owns the question, never the adapter.

`upsertSeriesPoint` ([market-data store](../../../src/trading/features/market-data/store/market-data.ts)) answers whether the row landed. A pass counts only what it wrote, and `force` is what re-derives a stored day. A day the gold board history found no board on is not a `missingTargets` entry.

## The screen and the exclusion list

`ScreenRequest` carries `market`, `limit`, `instrumentKind` and `sectors`. No market reads a profile. The mark `on your exclusion list` arrives through an `ExclusionReader` ([types.ts](../../../src/trading/features/market-data/types.ts)) that composition binds, so `market-data` reaches no operator-scoped feature.

## Alerts

A system-armed alert carries an origin string the arming pass reconciles against ([alerts/types.ts](../../../src/trading/features/alerts/types.ts)):

| Origin | Armed for |
|---|---|
| `exit:<suggestionId>:<stop\|target>:<threshold>` | each actionable suggestion behind a position you hold |
| `screen:<market>:<ticker>:<up\|down>:<day>` | every watchlist and held name |

The threshold is part of the exit identity, so a stop the trail raised is a new origin: it arms, and the old one retires. Operator alerts carry no origin.

The trail's per-session memo (`trailedThrough`) is set only once the raise has settled: written, lost to a concurrent raise, or not asked for. A failed write leaves it unset, so the next tick retries instead of waiting a session. The failure isolation of the alert loop is in [operations](operations.md#tick-failure-classification).

## Track record and batches

- `independentCalls` (`pipeline/reporting.ts`) is the one fold of a repeat of a still-open call on the same name and side. It reads only `FoldableCall` (`at`, `instrument`, `action`, `outcome.exitDay`), so the per-focus record folds the lean `FocusCall` rows `listFocusCalls` returns (no payload, no row limit) with the same rule `summarizeTrackRecord` uses, one focus at a time. No second implementation lives in SQL; `LATEST_OF_SAME_CALL_SQL` still keeps the newest row of a same-day call across versions.
- A row whose payload no longer parses is dropped from a list rather than failing it: `readableRow` (`store/readable-row.ts`) catches `StorageError`, logs `trading.suggestion_row_unreadable` with the row id and rethrows anything else. The pending, resolved, exit-plan and page reads share it. `findLatestExitPlan` then falls back to the older rows in its look-back window, so a bad newest row does not read as "no plan".
- A batch item sizes against the pre-batch book. `breachedSleeves` (`pipeline/exposure.ts`) reports sector, segment and ETF ceilings crossed by two or more buys; `overcommittedBook` (`pipeline/overcommit.ts`) reports the cash (whole book, and a market whose venues reach less) and open-risk room the same buys spend past, as `SuggestionBatchResult.overcommit` in fractions of NAV. It is advisory: a failed read of the held names' plans drops that finding and logs `trading.batch_open_risk_unread`.
- A resting buy fills on the first session that trades below its limit. On that fill session the scorer reads the target only when the session opened under the limit; the stop is tested there as on every session.

## Brief sections

Some per-market sections (`reading`, `market-prices`, `market-quotes`, `market-board`, `market-cap`, `turnover`, `derivatives`, `taker-flow`, `etf-flows`, `positioning`, `premium`, `range`, `leaders`, `leaders-24h`, `movers-session`, `movers-24h`, `sentiment`) come from each market's overview converter, off one shared per-market template, not from a brief builder. A market adds a block, never a section kind.

## Themes scoring

Theme, sector and stock reads share the `theme_reads` table (a level and a subject). Code scores each 0-100 in [`features/themes/score/`](../../../src/trading/features/themes/score/) from fixed weights; `SCORE_VERSION` is stored on the run, and the parts ride in the payload so a score can be recomputed.

## Valuation and the book

[portfolio/types.ts](../../../src/trading/features/portfolio/types.ts):

- `viewRelative` (weights, percentages) is what agent tools reach. `viewAbsolute` (money) is reachable only from the operator's surfaces. `ValuedBook` is never handed to a model.
- A `ValuedPosition` is `kind: 'priced'` (price and value) or `kind: 'unpriced'` (a `caveat`, no value). A missing price is never zero.
- A `Holding` is the per-venue positions of one instrument merged into one exposure.
- `PriceFreshness.markKind` is `live` or `close`, folded in [valuation.ts](../../../src/trading/features/portfolio/folds/valuation.ts): `live` only when every priced position is live.
- `realizedPnlBase` is cash + cost basis - net deposits, so it exists when `navBase` does not. With any unpriced holding `navBase` is absent and the assessment carries `portfolio.valuation-partial`.
- Findings come from `assessPortfolio` ([health.ts](../../../src/trading/features/portfolio/folds/health.ts)). A finding is a typed code with typed evidence; detail fields that are shares carry the raw fraction and the renderer stamps the unit (`check-caveat-details` fails a `%` after a placeholder).
- A fill from `/trade`, `order_place` or `/record sync` writes its row through `portfolio.record`, the path `/record` uses. Sync keys a fill `<venue>:<orderId>` (`buildVenueFillKey`, [sync.ts](../../../src/trading/features/ledger/sync.ts)). The confirmation names each figure's provenance (`FillSource`, [ledger/types.ts](../../../src/trading/features/ledger/types.ts)).

## Venue capabilities

A venue declares what its API can do ([venues/types.ts](../../../src/trading/venues/types.ts)); the registry refuses a manifest and an adapter that disagree.

```ts
interface VenueExecution {
  readonly exit: 'attached' | 'none'   // resting exit: placeExit, fetchExit, cancelExit
  readonly amend: boolean              // move an exit in place: amendExit
  readonly fills: 'enumerable' | 'by-symbol' | 'none' // fetchFilledOrders, listFilledOrders
  readonly balances: boolean           // fetchBalances, for /reconcile
}
```

A venue that accepts no orders has no adapter (`manifest.acceptsOrders` is false). Its catalog is read independently. A venue without `amend` is never given a cancel-then-place. Adding a venue: see [AGENTS.md](../../../AGENTS.md).

## Orders

- The durable halt lives in the `order_settings` table, checked for buys only.
- Confirm, exit and cancel are serialised, and the whole-book caps are re-read inside that window.
- Order code: [`features/order/`](../../../src/trading/features/order/). Routing is `routing.ts` only; the in-flight marker, mirror and orphan-exit checks are `intents.ts`, `mirror.ts` and `orphan-exits.ts`.

## HTTP routes

The routes the trading feature adds, served when `[api] enabled = true`. The rest of the API and every wire shape are in [CONTRACT.md](../../../src/app/server/CONTRACT.md).

| Route | Capability flag |
|---|---|
| `GET /v1/quotes` | `quotes` |
| `GET /v1/ohlcv` | `ohlcv` |
| `GET /v1/events` | `ohlcv` |
| `GET /v1/news` | - |
| `GET /v1/profile`, `POST /v1/profile` | - |
| `GET /v1/portfolio` | `portfolio` |
| `GET /v1/portfolio/nav` | `portfolio` |
| `GET /v1/suggestions` | `suggestions` |
| `GET /v1/suggestions/:id/card` | `suggestions` |
| `GET /v1/track-record` | `suggestions` |
| `GET /v1/brief`, `PATCH /v1/brief` | - |

## VN factor research

[`scripts/research-vn-factor-history.ts`](../../../scripts/research-vn-factor-history.ts) measures the VN factors on history. It copies the book into a directory you name and seeds it with older bars, the ratio history as it stood on each board day (a quarter counts from the day it was first filed, not from its reviewed or audited revision) and earlier flows. It screens every fifth session with the live scorer and reports each factor's rank IC against the return over the long outcome window, with a Newey-West t, each half apart, and the composite with each factor left out. It never writes to the book or the board log. The population is today's listings, so read it as a shape.

## Source map

- [`src/trading/kernel/source/source-result.ts`](../../../src/trading/kernel/source/source-result.ts) - `SourceResult`.
- [`src/trading/sources/`](../../../src/trading/sources/) - adapters, `routes.ts`, `transport/`.
- [`src/trading/markets/calendar.ts`](../../../src/trading/markets/calendar.ts) - settle predicate.
- [`src/trading/features/market-data/`](../../../src/trading/features/market-data/) - store, refresh schedule, screen types.
- [`src/trading/features/alerts/`](../../../src/trading/features/alerts/) - alert origins and arming.
- [`src/trading/features/themes/`](../../../src/trading/features/themes/) - `/themes`, scoring.
- [`src/trading/features/portfolio/`](../../../src/trading/features/portfolio/) - valuation, health, advice.
- [`src/trading/features/ledger/`](../../../src/trading/features/ledger/) - ledger writes, sync.
- [`src/trading/features/order/`](../../../src/trading/features/order/) - `/trade` and `order_place`.
- [`src/trading/venues/`](../../../src/trading/venues/) - venue manifests and adapters.
- [`src/app/server/CONTRACT.md`](../../../src/app/server/CONTRACT.md) - `/v1` API.
